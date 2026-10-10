import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2, AlertTriangle, Search, ChevronLeft, Check, X,
  RefreshCw, Clock, CheckCircle2,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { podeEditar } from "../lib/permissoes";

// ---------------------------------------------------------------------
// Desempenho — onde o tempo da operação vai
//
// O pedido não é uma esteira: ele se DIVIDE. Hambúrguer vai pra chapa,
// milk-shake pro bar, batata pra cozinha, chopp pro caixa — tudo ao mesmo
// tempo. O pedido só fica pronto quando a ÚLTIMA estação termina, e as
// outras ficam com a comida parada esperando.
//
// Por isso o tempo é por ESTAÇÃO dentro do pedido, não por pedido. E por
// isso existe a "espera de montagem", que é o tempo entre a primeira
// estação terminar e a última — o número que não existe em relatório
// nenhum e que é onde mora o "chegou tudo junto, mas frio".
//
// De onde vêm os dados:
//   delivery/balcão  → webhook do CardápioWeb, sozinho
//   salão            → a estação lança a comanda (o CardápioWeb só manda
//                      mesa depois que ela fecha, tarde demais pra medir)
// ---------------------------------------------------------------------

const ABAS = [
  { chave: "agora",    label: "Agora" },
  { chave: "hoje",     label: "Hoje" },
  { chave: "produtos", label: "Produtos" },
  { chave: "ajustes",  label: "Ajustes" },
];

function hojeISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function semAcento(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function chaveNome(s) {
  return semAcento(s).trim().toLowerCase().replace(/\s+/g, " ");
}
function relogio(seg) {
  const s = Math.max(0, Math.floor(Number(seg) || 0));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
function min1(v) {
  if (v === null || v === undefined) return "—";
  return Number(v).toFixed(1).replace(".", ",");
}
function brl(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ---------------------------------------------------------------------
// Modo tablet
//
// O KDS nao e uma tela que a pessoa "visita": e um tablet que fica ligado
// na chapa a noite inteira. Ate aqui a estacao escolhida era estado de
// tela comum — recarregou, dormiu, alguem fechou a aba sem querer, e quem
// esta com a mao na chapa tinha que navegar de novo ate a Chapa.
//
// A escolha agora fica no APARELHO. Cada tablet lembra a estacao dele, e
// abre direto nela. O tablet do bar abre no bar; o da chapa, na chapa.
//
// Fica no aparelho de proposito, e nao no cadastro do usuario: o login
// costuma ser o mesmo em todos os tablets, entao guardar por usuario
// faria um tablet mudar o outro. E se o navegador nao deixar guardar
// (aba privada, armazenamento cheio), a tela volta a se comportar como
// antes em vez de quebrar.
// ---------------------------------------------------------------------
const CHAVE_ESTACAO = "mrkong.kds.estacao";

// ---------------------------------------------------------------------
// Entrega — estação de DESPACHO, não de produção
//
// O Kong Duplo vai pra chapa do mesmo jeito, seja delivery ou mesa 12.
// Quem produz não muda nada; o que muda é o destino depois de pronto.
// Por isso a Entrega não está no cadastro de setores: ela não pode
// aparecer como destino na aba Produtos, nem virar setor de contagem de
// estoque. Ela existe só aqui, como um chip a mais no tablet.
//
// A tela dela olha PEDIDO, não item — é a única que faz isso.
// ---------------------------------------------------------------------
const ENTREGA = { chave: "entrega", label: "Entrega", despacho: true };

const DESTINO_ROTULO = {
  entrega: "vai de entrega",
  balcao: "cliente retira",
  salao: "é do salão",
  indefinido: "sem canal",
};

function lerEstacaoFixada() {
  try { return window.localStorage.getItem(CHAVE_ESTACAO) || null; } catch { return null; }
}
function gravarEstacaoFixada(chave) {
  try {
    if (chave) window.localStorage.setItem(CHAVE_ESTACAO, chave);
    else window.localStorage.removeItem(CHAVE_ESTACAO);
    return true;
  } catch { return false; }
}

export default function Desempenho({ perfil, permissoes, onVoltar }) {
  const editarProdutos = podeEditar(permissoes, "desempenho.produtos") || perfil?.is_admin;
  const [aba, setAba] = useState("agora");
  const [setores, setSetores] = useState([]);
  const [setorAberto, setSetorAberto] = useState(null);
  const [fixada, setFixada] = useState(() => lerEstacaoFixada());
  const [semMemoria, setSemMemoria] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await supabase
        // `estacao` separa quem PRODUZ de quem so faz checklist e conta
        // estoque. A Gerencia continua existindo nos dois outros lugares,
        // mas nao aparece no KDS — senao ficaria ali zerada, fazendo volume.
        .from("setores_estoque").select("chave, label, ordem")
        .eq("ativo", true).eq("estacao", true).order("ordem");
      if (!vivo) return;
      if (error) setErro(error.message);
      const lista = data || [];
      setSetores(lista);
      setCarregando(false);
      // Abre direto na estacao fixada, se ela ainda existir. Estacao
      // apagada do cadastro nao pode prender o tablet numa tela vazia.
      const guardada = lerEstacaoFixada();
      // A Entrega vale como estação fixável mesmo não estando no cadastro.
      if (guardada && (guardada === ENTREGA.chave || lista.some((x) => x.chave === guardada))) {
        setSetorAberto(guardada);
      } else if (guardada) {
        gravarEstacaoFixada(null);
        setFixada(null);
      }
    })();
    return () => { vivo = false; };
  }, []);

  // Chips do tablet: as estações de produção mais a Entrega. A lista
  // `setores` (só produção) continua sendo a que Produtos e Ajustes
  // enxergam — prato nenhum pode apontar pra Entrega.
  const estacoes = [...setores, ENTREGA];

  if (setorAberto === ENTREGA.chave) {
    return (
      <Despacho
        setores={estacoes}
        fixada={fixada}
        semMemoria={semMemoria}
        onFixar={(k) => {
          const ok = gravarEstacaoFixada(k);
          if (!ok) { setSemMemoria(true); return; }
          setSemMemoria(false);
          setFixada(k);
        }}
        onTrocar={(k) => {
          setSetorAberto(k);
          if (fixada) { gravarEstacaoFixada(k); setFixada(k); }
        }}
        onVoltar={() => setSetorAberto(null)}
      />
    );
  }

  if (setorAberto) {
    const s = setores.find((x) => x.chave === setorAberto);
    return (
      <Estacao
        setor={setorAberto}
        label={s?.label || setorAberto}
        setores={estacoes}
        fixada={fixada}
        semMemoria={semMemoria}
        onFixar={(k) => {
          const ok = gravarEstacaoFixada(k);
          if (!ok) { setSemMemoria(true); return; }
          setSemMemoria(false);
          setFixada(k);
        }}
        onTrocar={(k) => {
          setSetorAberto(k);
          // Tablet fixado que troca de estacao passa a lembrar da nova.
          // Senao, na proxima abertura ele voltaria pra antiga e a pessoa
          // trocaria de novo, todo dia.
          if (fixada) { gravarEstacaoFixada(k); setFixada(k); }
        }}
        onVoltar={() => setSetorAberto(null)}
      />
    );
  }

  return (
    <Shell titulo="Desempenho" subtitulo="Tempo por estação, gargalo e fila ao vivo" onVoltar={onVoltar}>
      {erro && (
        <div style={avisoErro}><AlertTriangle size={16} /> {erro}</div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {ABAS.map((a) => (
          <button key={a.chave} onClick={() => setAba(a.chave)}
            style={{ ...chip, ...(aba === a.chave ? chipAtivo : {}) }}>
            {a.label}
          </button>
        ))}
      </div>

      {carregando ? (
        <div style={vazio}><Loader2 size={16} /> Carregando…</div>
      ) : setores.length === 0 ? (
        <div style={avisoAmarelo}>
          <AlertTriangle size={16} />
          <div>
            Nenhuma estação cadastrada. As estações vêm dos departamentos do
            Checklist — crie lá e elas aparecem aqui sozinhas.
          </div>
        </div>
      ) : aba === "agora" ? (
        <Agora setores={estacoes} aoAbrirSetor={setSetorAberto} />
      ) : aba === "hoje" ? (
        <Hoje />
      ) : aba === "produtos" ? (
        <Produtos setores={setores} editar={editarProdutos} />
      ) : (
        <Ajustes setores={setores} editar={perfil?.is_admin} />
      )}
    </Shell>
  );
}

// =====================================================================
// AGORA — o que está aberto neste minuto
// =====================================================================
function Agora({ setores, aoAbrirSetor }) {
  const [resumo, setResumo] = useState(null);
  const [porSetor, setPorSetor] = useState({});
  // A porta nao tem item: ela tem pedido. Conta separado.
  const [naPorta, setNaPorta] = useState({ esperando: 0, na_rua: 0 });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    setErro("");
    const [{ data: r, error: e1 }, { data: itens, error: e2 }, { data: porta, error: e3 }] =
      await Promise.all([
        supabase.rpc("desempenho_agora"),
        supabase.from("producao_itens")
          .select("setor, pedido_id, pego_em")
          .is("pronto_em", null),
        supabase.rpc("fila_despacho"),
      ]);
    if (e1) setErro(e1.message);
    if (e2) setErro(e2.message);
    // Se a 115 ainda nao rodou, a funcao nao existe. A tela nao pode
    // quebrar por causa disso — a Entrega so aparece zerada.
    if (!e3) {
      const lista = porta || [];
      setNaPorta({
        esperando: lista.filter((x) => !x.saiu).length,
        na_rua: lista.filter((x) => x.saiu).length,
      });
    }
    setResumo(Array.isArray(r) ? r[0] : r);

    const mapa = {};
    (itens || []).forEach((i) => {
      if (!i.setor) return;
      if (!mapa[i.setor]) mapa[i.setor] = { pedidos: new Set(), pegos: 0 };
      mapa[i.setor].pedidos.add(i.pedido_id);
      if (i.pego_em) mapa[i.setor].pegos += 1;
    });
    const final = {};
    Object.entries(mapa).forEach(([k, v]) => {
      final[k] = { pedidos: v.pedidos.size, pegos: v.pegos };
    });
    setPorSetor(final);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // Atualiza sozinho: quem está olhando isso quer ver mudar.
  useEffect(() => {
    const t = setInterval(carregar, 20000);
    return () => clearInterval(t);
  }, [carregar]);

  if (carregando) return <div style={vazio}><Loader2 size={16} /> Carregando…</div>;

  const abertos = Number(resumo?.pedidos_abertos || 0);

  return (
    <div>
      {erro && <div style={avisoErro}><AlertTriangle size={16} /> {erro}</div>}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <Numero valor={abertos} label="Pedidos abertos" />
        <Numero valor={resumo?.maior_espera_min == null ? "—" : `${min1(resumo.maior_espera_min)} min`}
                label="Maior espera" alerta={Number(resumo?.maior_espera_min) > 20} />
        <Numero valor={Number(resumo?.esperando_uma_estacao || 0)}
                label="Falta só uma estação"
                alerta={Number(resumo?.esperando_uma_estacao) > 0} />
        <Numero valor={Number(resumo?.prontos_sem_sair || 0)} label="Prontos, sem sair"
                alerta={Number(resumo?.prontos_sem_sair) > 0} />
        <Numero valor={resumo?.media_ultima_hora_min == null ? "—" : `${min1(resumo.media_ultima_hora_min)} min`}
                label="Média da última hora" />
      </div>

      <div style={{ fontSize: 11.5, color: "#8A8778", marginBottom: 14, lineHeight: 1.6 }}>
        <b>"Falta só uma estação"</b> é o número pra olhar no sábado: são pedidos em que
        tudo já ficou pronto e falta um item. Cada minuto ali é comida esfriando.
      </div>

      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: "#8A8778",
                    fontWeight: 800, marginBottom: 8 }}>
        Estações
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {setores.map((s) => {
          const porta = !!s.despacho;
          const info = porta
            ? { pedidos: naPorta.esperando, pegos: naPorta.na_rua }
            : (porSetor[s.chave] || { pedidos: 0, pegos: 0 });
          return (
            <button key={s.chave} onClick={() => aoAbrirSetor(s.chave)}
              style={{ ...linha, cursor: "pointer", textAlign: "left" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{s.label}</div>
                <div style={{ fontSize: 11.5, color: "#8A8778" }}>
                  {porta
                    ? (info.pedidos === 0 && info.pegos === 0
                        ? "nada esperando na porta"
                        : `${info.pedidos} pronto${info.pedidos === 1 ? "" : "s"} esperando · ${info.pegos} na rua`)
                    : info.pedidos === 0
                      ? "sem pedido na fila"
                      : `${info.pedidos} pedido${info.pedidos > 1 ? "s" : ""} · ${info.pegos} em produção`}
                </div>
              </div>
              <div style={{
                fontSize: 20, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                color: info.pedidos === 0 ? "#B9B2A4" : "#C72B2E",
              }}>
                {info.pedidos}
              </div>
            </button>
          );
        })}
      </div>

      <button onClick={carregar} style={{ ...btnSec, marginTop: 14, width: "100%" }}>
        <RefreshCw size={14} /> Atualizar
      </button>
      <div style={{ fontSize: 11, color: "#B9B2A4", textAlign: "center", marginTop: 6 }}>
        atualiza sozinho a cada 20 segundos
      </div>
    </div>
  );
}

// =====================================================================
// CABEÇALHO DO TABLET — fixar, e trocar de estação
//
// Trocar de estação num tablet fixado tem que ser deliberado. Num
// aparelho de cozinha, com mão suja e pressa, um toque errado no chip
// manda a chapa pro bar — e a fila da chapa some da vista no meio do
// sábado. Por isso, fixado, os chips ficam atrás de um segundo toque.
//
// Mora aqui, num lugar só, porque a Estação e o Despacho precisam se
// comportar igual: dois cabeçalhos parecidos viram dois cabeçalhos
// diferentes na terceira alteração.
// =====================================================================
function CabecalhoEstacao({ setor, label, setores, fixada, semMemoria, onFixar, onTrocar }) {
  const [trocando, setTrocando] = useState(false);
  return (
    <>
      {/* -------- modo tablet -------- */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <button
          onClick={() => onFixar(fixada === setor ? null : setor)}
          style={{ display: "flex", alignItems: "center", gap: 6, borderRadius: 999,
                   padding: "7px 13px", fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                   cursor: "pointer",
                   border: fixada === setor ? "none" : "1px solid #E8E2D2",
                   background: fixada === setor ? "#0F6E56" : "#FFFFFF",
                   color: fixada === setor ? "#EAF6F1" : "#6B685C" }}>
          {fixada === setor ? "📌 Este tablet abre no " + label : "Fixar este tablet no " + label}
        </button>

        {setores.length > 1 && (
          fixada === setor && !trocando ? (
            <button onClick={() => setTrocando(true)}
              style={{ background: "none", border: "none", color: "#8A6A0F", fontSize: 11.5,
                       fontWeight: 600, cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
              trocar de estação
            </button>
          ) : (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#8A8778" }}>Estação:</span>
              {setores.map((s) => (
                <button key={s.chave}
                  onClick={() => { if (s.chave !== setor) onTrocar(s.chave); setTrocando(false); }}
                  style={{ ...chip, ...(s.chave === setor ? chipAtivo : {}) }}>
                  {s.label}
                </button>
              ))}
              {fixada === setor && (
                <button onClick={() => setTrocando(false)}
                  style={{ background: "none", border: "none", color: "#8A8778", fontSize: 11,
                           cursor: "pointer", fontFamily: "inherit", padding: 0 }}>
                  cancelar
                </button>
              )}
            </div>
          )
        )}
      </div>

      {fixada === setor && (
        <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: -6, marginBottom: 12, lineHeight: 1.55 }}>
          Ao abrir o painel neste aparelho, o Desempenho vai direto para o {label}. Vale só
          para este tablet — cada um guarda a estação dele.
        </div>
      )}

      {semMemoria && (
        <div style={{ ...avisoErro, marginBottom: 12 }}>
          <AlertTriangle size={16} />
          Este navegador não deixou guardar a estação (aba privada ou armazenamento bloqueado).
          A tela funciona igual, mas não vai abrir sozinha aqui.
        </div>
      )}
    </>
  );
}

// =====================================================================
// ESTAÇÃO — a tela de quem produz
// =====================================================================
function Estacao({ setor, label, setores, fixada, semMemoria, onFixar, onTrocar, onVoltar }) {
  const [fila, setFila] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [msg, setMsg] = useState("");
  const [ocupado, setOcupado] = useState(null);
  const [mesa, setMesa] = useState("");
  const [agora, setAgora] = useState(Date.now());
  // Quando a fila foi buscada. O banco manda os segundos daquele
  // instante; o relogio da tela soma o que passou desde entao, em vez
  // de confiar no horario do celular da chapa.
  const [buscadoEm, setBuscadoEm] = useState(Date.now());

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("estacao_fila_agrupada", { p_setor: setor });
    if (error) setErro(error.message); else setErro("");
    setFila(data || []);
    setBuscadoEm(Date.now());
    setCarregando(false);
  }, [setor]);

  useEffect(() => { setCarregando(true); carregar(); }, [carregar]);
  useEffect(() => {
    const t = setInterval(carregar, 15000);
    return () => clearInterval(t);
  }, [carregar]);
  // O relógio anda sozinho entre uma busca e outra, senão o número
  // congela na tela e a pessoa acha que travou.
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const marcar = async (pedidoId, acao) => {
    setOcupado(pedidoId + acao);
    setErro("");
    const { error } = await supabase.rpc("marcar_estacao_pedido", {
      p_pedido: pedidoId, p_setor: setor, p_acao: acao,
    });
    setOcupado(null);
    if (error) { setErro(error.message); return; }
    carregar();
  };

  const abrirComanda = async (jaPegou) => {
    const ref = mesa.trim();
    if (!ref) { setErro("Digite o número da mesa ou da comanda."); return; }
    setOcupado("nova");
    setErro("");
    const { error } = await supabase.rpc("abrir_comanda_estacao", {
      p_referencia: ref, p_setor: setor, p_ja_pegou: jaPegou, p_itens: null,
    });
    setOcupado(null);
    if (error) { setErro(error.message); return; }
    setMesa("");
    setMsg(`Mesa ${ref} entrou na fila do ${label}.`);
    carregar();
  };

  return (
    <Shell titulo={`${label} · Estação`} subtitulo="Peguei e terminei, e só" onVoltar={onVoltar}>
      <CabecalhoEstacao
        setor={setor} label={label} setores={setores}
        fixada={fixada} semMemoria={semMemoria}
        onFixar={onFixar} onTrocar={onTrocar} />

      {erro && <div style={avisoErro}><AlertTriangle size={16} /> {erro}</div>}
      {msg && <div style={avisoVerde}><CheckCircle2 size={16} /> {msg}</div>}

      {/* Lançamento do salão */}
      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6,
                      color: "#8A8778", fontWeight: 800, marginBottom: 8 }}>
          Chegou comanda do salão
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={mesa}
            onChange={(e) => setMesa(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") abrirComanda(false); }}
            placeholder="Mesa"
            inputMode="numeric"
            style={{ ...inputStyle, width: 110, fontSize: 20, fontWeight: 800, textAlign: "center" }} />
          <button onClick={() => abrirComanda(false)} disabled={ocupado === "nova"}
            style={{ ...btnSec, flex: 1, minWidth: 120 }}>
            Chegou
          </button>
          <button onClick={() => abrirComanda(true)} disabled={ocupado === "nova"}
            style={{ ...btnPri, flex: 1, minWidth: 140 }}>
            Chegou e peguei
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#8A8778", marginTop: 8, lineHeight: 1.55 }}>
          Delivery entra sozinho. Só a mesa precisa ser digitada — e só o número,
          nunca os itens.
        </div>
      </div>

      {carregando ? (
        <div style={vazio}><Loader2 size={16} /> Carregando…</div>
      ) : fila.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", color: "#8A8778", fontSize: 13, padding: 22 }}>
          <Clock size={20} style={{ marginBottom: 8 }} />
          <div>Nenhum pedido na fila do {label}.</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {fila.map((p) => {
            const base = Number(p.segundos) || 0;
            const seg = base + Math.floor((agora - buscadoEm) / 1000);
            const amarelo = Number(p.amarelo_min || 6) * 60;
            const vermelho = Number(p.vermelho_min || 12) * 60;
            const cor = seg >= vermelho ? "#C4432B" : seg >= amarelo ? "#B3701A" : "#8A8778";
            const borda = seg >= vermelho ? "#F0C0B8" : seg >= amarelo ? "#E8C489" : "#E8E2D2";
            const pego = !!p.pego_em;
            const itens = Array.isArray(p.itens) ? p.itens : [];
            const outras = Array.isArray(p.outras) ? p.outras : [];

            return (
              <div key={p.pedido_id} style={{ ...cardStyle, borderColor: borda, padding: 0, overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                              padding: "10px 13px", background: "#FCFAF6", borderBottom: "1px solid " + borda }}>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>
                    {p.referencia}
                    {p.canal && p.canal !== "mesa" && (
                      <span style={selo}>{p.canal}</span>
                    )}
                  </div>
                  <div style={{ fontWeight: 800, fontSize: 15, color: cor, fontVariantNumeric: "tabular-nums" }}>
                    {relogio(seg)}
                  </div>
                </div>

                <div style={{ padding: "10px 13px", fontSize: 13.5 }}>
                  {itens.length === 0 ? (
                    <span style={{ color: "#8A8778" }}>sem detalhe de itens</span>
                  ) : (
                    itens.map((i, n) => (
                      <div key={n} style={{ padding: "2px 0" }}>
                        {Number(i.quantidade) > 1 ? `${i.quantidade}× ` : ""}{i.nome}
                      </div>
                    ))
                  )}
                </div>

                {outras.length > 0 && (
                  <div style={{ padding: "8px 13px", borderTop: "1px dashed #EFE7D9",
                                fontSize: 11, color: "#8A8778", display: "flex", gap: 6,
                                flexWrap: "wrap", alignItems: "center" }}>
                    resto do pedido:
                    {outras.map((o, n) => (
                      <span key={n} style={{ ...selo, background: o.pronto ? "#E7F1EC" : "#F1EEE2",
                                             color: o.pronto ? "#2F8F5B" : "#6B6558" }}>
                        {o.setor}{o.pronto ? " ok" : ""}
                      </span>
                    ))}
                    {outras.length > 0 && outras.every((o) => o.pronto) && (
                      <b style={{ color: "#C4432B" }}>— o pedido está esperando você</b>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, padding: "10px 13px", borderTop: "1px solid #F3EDE2" }}>
                  {!pego ? (
                    <button onClick={() => marcar(p.pedido_id, "pegar")}
                      disabled={ocupado === p.pedido_id + "pegar"}
                      style={{ ...btnPri, flex: 1 }}>
                      Peguei
                    </button>
                  ) : (
                    <button onClick={() => marcar(p.pedido_id, "pronto")}
                      disabled={ocupado === p.pedido_id + "pronto"}
                      style={{ ...btnEscuro, flex: 1 }}>
                      <Check size={15} /> Terminei
                    </button>
                  )}
                  <button onClick={() => marcar(p.pedido_id, "desfazer")}
                    style={{ ...btnSec, width: 110 }}>
                    Desfazer
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}

// =====================================================================
// DESPACHO — a porta
//
// Todas as outras telas medem até o lanche ficar PRONTO. Esta mede o
// pedaço que ninguém media: quanto tempo ele ficou pronto parado no
// balcão esperando alguém levar.
//
// É onde mora a briga mais cara da operação. A chapa entrega em 7
// minutos e está certa. O cliente recebe 40 minutos depois e também
// está certo. A conta some no meio — e quem não enxerga esse pedaço
// contrata mais gente pra chapa quando o que falta é moto.
//
// Diferente de todas as outras estações, esta olha PEDIDO, não item.
// Um pedido só chega aqui quando nenhuma estação está mais devendo.
// =====================================================================
function Despacho({ setores, fixada, semMemoria, onFixar, onTrocar, onVoltar }) {
  const [fila, setFila] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(null);
  const [agora, setAgora] = useState(Date.now());
  const [buscadoEm, setBuscadoEm] = useState(Date.now());

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("fila_despacho");
    if (error) setErro(error.message); else setErro("");
    setFila(data || []);
    setBuscadoEm(Date.now());
    setCarregando(false);
  }, []);

  useEffect(() => { setCarregando(true); carregar(); }, [carregar]);
  useEffect(() => {
    const t = setInterval(carregar, 15000);
    return () => clearInterval(t);
  }, [carregar]);
  // O relógio anda sozinho entre uma busca e outra, senão o número
  // congela na tela e a pessoa acha que travou.
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const marcar = async (pedidoId, acao) => {
    setOcupado(pedidoId + acao);
    setErro("");
    const { error } = await supabase.rpc("marcar_despacho", {
      p_pedido: pedidoId, p_acao: acao,
    });
    setOcupado(null);
    if (error) { setErro(error.message); return; }
    carregar();
  };

  // Três filas, e a ordem importa: o que sai pela porta primeiro, o que
  // já está na rua por último.
  const vaiSair = fila.filter((p) => !p.saiu && p.destino === "entrega");
  const aqui    = fila.filter((p) => !p.saiu && p.destino !== "entrega");
  const naRua   = fila.filter((p) => p.saiu);

  const Cartao = ({ p, acoes }) => {
    const base = Number(p.segundos) || 0;
    const seg = base + Math.floor((agora - buscadoEm) / 1000);
    const amarelo = Number(p.amarelo_min || 5) * 60;
    const vermelho = Number(p.vermelho_min || 10) * 60;
    const cor = seg >= vermelho ? "#C4432B" : seg >= amarelo ? "#B3701A" : "#8A8778";
    const borda = seg >= vermelho ? "#F0C0B8" : seg >= amarelo ? "#E8C489" : "#E8E2D2";
    const itens = Array.isArray(p.itens) ? p.itens : [];

    return (
      <div style={{ ...cardStyle, borderColor: borda, padding: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "10px 13px", background: "#FCFAF6", borderBottom: "1px solid " + borda }}>
          <div style={{ fontWeight: 800, fontSize: 15 }}>
            {p.referencia}
            <span style={selo}>{DESTINO_ROTULO[p.destino] || p.destino}</span>
          </div>
          <div style={{ fontWeight: 800, fontSize: 15, color: cor, fontVariantNumeric: "tabular-nums" }}>
            {relogio(seg)}
          </div>
        </div>

        <div style={{ padding: "10px 13px", fontSize: 13.5 }}>
          {itens.length === 0 ? (
            <span style={{ color: "#8A8778" }}>sem detalhe de itens</span>
          ) : (
            itens.map((i, n) => (
              <div key={n} style={{ padding: "2px 0" }}>
                {Number(i.quantidade) > 1 ? `${i.quantidade}× ` : ""}{i.nome}
              </div>
            ))
          )}
        </div>

        {p.saiu && !p.saiu_no_dedo && (
          <div style={{ padding: "7px 13px", borderTop: "1px dashed #EFE7D9",
                        fontSize: 11, color: "#8A8778" }}>
            saída marcada no CardápioWeb, não no tablet — o horário pode estar atrasado
          </div>
        )}

        <div style={{ display: "flex", gap: 8, padding: "10px 13px", borderTop: "1px solid #F3EDE2" }}>
          {acoes}
        </div>
      </div>
    );
  };

  const Bloco = ({ titulo, ajuda, lista, children }) => (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6,
                    color: "#8A8778", fontWeight: 800, marginBottom: 4 }}>
        {titulo} {lista.length > 0 && <span style={{ color: "#C72B2E" }}>· {lista.length}</span>}
      </div>
      {ajuda && (
        <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 8, lineHeight: 1.55 }}>
          {ajuda}
        </div>
      )}
      {lista.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", color: "#8A8778",
                      fontSize: 12.5, padding: 16 }}>
          nada aqui
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{children}</div>
      )}
    </div>
  );

  return (
    <Shell titulo="Entrega · Despacho" subtitulo="Saiu comigo, e entreguei" onVoltar={onVoltar}>
      <CabecalhoEstacao
        setor={ENTREGA.chave} label={ENTREGA.label} setores={setores}
        fixada={fixada} semMemoria={semMemoria}
        onFixar={onFixar} onTrocar={onTrocar} />

      {erro && <div style={avisoErro}><AlertTriangle size={16} /> {erro}</div>}

      <div style={{ fontSize: 11.5, color: "#8A8778", marginBottom: 14, lineHeight: 1.6 }}>
        O relógio aqui conta desde que o pedido ficou <b>pronto</b> — não desde que
        entrou. Cada minuto nesta tela é comida esfriando em cima do balcão.
      </div>

      {carregando ? (
        <div style={vazio}><Loader2 size={16} /> Carregando…</div>
      ) : (
        <>
          <Bloco titulo="Vai sair" lista={vaiSair}
                 ajuda="Pronto e esperando o entregador pegar.">
            {vaiSair.map((p) => (
              <Cartao key={p.pedido_id} p={p} acoes={
                <button onClick={() => marcar(p.pedido_id, "saiu")}
                  disabled={ocupado === p.pedido_id + "saiu"}
                  style={{ ...btnPri, flex: 1 }}>
                  Saiu comigo
                </button>
              } />
            ))}
          </Bloco>

          <Bloco titulo="É daqui" lista={aqui}
                 ajuda="Mesa e balcão. Não sai pela porta — está aqui só pra ninguém levar embora o que é do salão.">
            {aqui.map((p) => (
              <Cartao key={p.pedido_id} p={p} acoes={
                <button onClick={() => marcar(p.pedido_id, "entregue")}
                  disabled={ocupado === p.pedido_id + "entregue"}
                  style={{ ...btnEscuro, flex: 1 }}>
                  <Check size={15} /> Entregue
                </button>
              } />
            ))}
          </Bloco>

          <Bloco titulo="Na rua" lista={naRua}
                 ajuda="Já saiu com o entregador e ainda não voltou como entregue.">
            {naRua.map((p) => (
              <Cartao key={p.pedido_id} p={p} acoes={
                <>
                  <button onClick={() => marcar(p.pedido_id, "entregue")}
                    disabled={ocupado === p.pedido_id + "entregue"}
                    style={{ ...btnEscuro, flex: 1 }}>
                    <Check size={15} /> Entreguei
                  </button>
                  <button onClick={() => marcar(p.pedido_id, "desfazer")}
                    style={{ ...btnSec, width: 110 }}>
                    Desfazer
                  </button>
                </>
              } />
            ))}
          </Bloco>

          <button onClick={carregar} style={{ ...btnSec, width: "100%" }}>
            <RefreshCw size={14} /> Atualizar
          </button>
          <div style={{ fontSize: 11, color: "#B9B2A4", textAlign: "center", marginTop: 6 }}>
            atualiza sozinho a cada 15 segundos
          </div>
        </>
      )}
    </Shell>
  );
}

// =====================================================================
// HOJE — como cada estação foi
// =====================================================================
function Hoje() {
  const [linhas, setLinhas] = useState([]);
  const [espera, setEspera] = useState(null);
  const [ranking, setRanking] = useState([]);
  const [piores, setPiores] = useState([]);
  const [porLinha, setPorLinha] = useState([]);
  const [inicioMedicao, setInicioMedicao] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const dia = hojeISO();

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [{ data: est, error: e1 }, { data: esp, error: e2 },
              { data: rank }, { data: piores }, { data: linhasProd },
              { data: cfg }, { data: tempos }] = await Promise.all([
        supabase.rpc("desempenho_estacoes", { p_inicio: dia, p_fim: dia }),
        supabase.rpc("espera_montagem", { p_inicio: dia, p_fim: dia }),
        // 048, 049 e 050 sao opcionais para esta tela: se ainda nao rodaram,
        // os blocos novos somem e o resto continua igual. Erro aqui nao
        // quebra nada — por isso nenhum destes tem `error` lido.
        supabase.rpc("kds_ranking_pratos", { p_inicio: dia, p_fim: dia }),
        supabase.rpc("kds_pedidos_espera", { p_inicio: dia, p_fim: dia, p_limite: 6 }),
        supabase.rpc("kds_ranking_linhas", { p_inicio: dia, p_fim: dia }),
        supabase.from("kds_config").select("inicio_medicao").maybeSingle(),
        supabase.rpc("kds_tempo_estacao", { p_inicio: dia, p_fim: dia }),
      ]);
      if (!vivo) return;
      if (e1) setErro(e1.message);
      if (e2) setErro(e2.message);
      // desempenho_estacoes continua sendo a fonte de "segurou", que depende
      // de comparar itens do mesmo pedido. kds_tempo_estacao (051) traz o
      // tempo de um item medido item a item, que e o que nao dava pra obter
      // somando duas medias. Se a 051 nao rodou, `tempos` vem vazio e a
      // coluna cai no total antigo — a tela nao quebra, so fica menos exata.
      const porSetor = {};
      for (const t of tempos || []) porSetor[t.setor] = t;
      setLinhas((est || []).map((l) => ({ ...l, tempo: porSetor[l.setor] || null })));
      setEspera(Array.isArray(esp) ? esp[0] : esp);
      setRanking(rank || []);
      setPiores(piores || []);
      setPorLinha(linhasProd || []);
      setInicioMedicao(cfg?.inicio_medicao || null);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [dia]);

  if (carregando) return <div style={vazio}><Loader2 size={16} /> Carregando…</div>;

  const comDado = linhas.filter((l) => Number(l.itens) > 0);
  // O KDS foi zerado: numero de antes do corte e fila presa e treino, nao
  // desempenho. Se o dia aberto e anterior ao corte, a tela diz isso em vez
  // de deixar alguem ler um 34,8 min de fila como se fosse real.
  const corte = inicioMedicao ? new Date(inicioMedicao) : null;
  const antesDoCorte = corte && new Date(dia + "T23:59:59") < corte;

  return (
    <div>
      {erro && <div style={avisoErro}><AlertTriangle size={16} /> {erro}</div>}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between",
                    gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ ...rotulo, marginBottom: 0 }}>Tempo médio de um item</div>
        {corte && (
          <div style={{ fontSize: 11, color: "#8A8778" }}>
            medindo desde {corte.toLocaleString("pt-BR", {
              day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
            })}
          </div>
        )}
      </div>

      {antesDoCorte && (
        <div style={avisoAmarelo}>
          <AlertTriangle size={16} />
          <div>
            Este dia é anterior ao início da medição. O que aparece aqui é do período
            de treino e de fila presa — não vale como desempenho.
          </div>
        </div>
      )}

      {comDado.length === 0 ? (
        <div style={avisoAmarelo}>
          <AlertTriangle size={16} />
          <div>
            Nada produzido hoje ainda. Os números aparecem conforme as estações
            forem tocando "peguei" e "terminei".
          </div>
        </div>
      ) : (
        <>
          <ColunasEstacao linhas={comDado} />

          {espera && Number(espera.pedidos_com_varias) > 0 && (
            <>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6,
                            color: "#8A8778", fontWeight: 800, marginBottom: 8 }}>
                Espera de montagem
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Numero valor={`${min1(espera.espera_media_min)} min`} label="Média por pedido" alerta />
                <Numero valor={`${min1(espera.espera_p90_min)} min`} label="P90" alerta />
                <Numero valor={`${min1(espera.espera_total_horas)} h`} label="Somado no dia" />
                <Numero valor={`${espera.pct_varias_estacoes || 0}%`} label="Pedidos com 2+ estações" />
              </div>
              <div style={{ fontSize: 11.5, color: "#8A8778", marginTop: 10, lineHeight: 1.6 }}>
                É o tempo em que a comida ficou pronta esperando o resto do pedido.
                Não dá pra zerar — pedido de quatro estações sempre tem alguma espera —
                mas dá pra escalonar: se a chapa leva 9 min e a batata 4, a cozinha não
                devia começar a batata no minuto zero.
              </div>
            </>
          )}

          <MaisLentoPorLinha linhas={porLinha} />
          <PontosMelhoria estacoes={comDado} porLinha={porLinha} />

          <PioresPedidos pedidos={piores} />
          <MaisLentosRapidos pratos={ranking} />

          <ComoLer estacoes={comDado} temLinhas={porLinha.length > 0} />
        </>
      )}
    </div>
  );
}

// =====================================================================
// PIORES PEDIDOS — onde a comida mais esperou hoje
//
// A tabela de estações diz ONDE o tempo vai. Esta lista diz em QUAL pedido,
// e abre a linha do tempo dele. Sem isso, "a espera média foi 7 minutos"
// não aponta para nada que dê pra investigar na segunda-feira.
// =====================================================================
function PioresPedidos({ pedidos }) {
  const [aberto, setAberto] = useState(null);
  if (!pedidos || pedidos.length === 0) return null;

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6,
                    color: "#8A8778", fontWeight: 800, marginBottom: 8 }}>
        Pedidos que mais esperaram
      </div>
      <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
        <table style={tabela}>
          <thead>
            <tr>
              <th style={th}>Pedido</th>
              <th style={{ ...th, textAlign: "right" }}>Estações</th>
              <th style={{ ...th, textAlign: "right" }}>Total</th>
              <th style={{ ...th, textAlign: "right" }}>Esperando</th>
              <th style={{ ...th, textAlign: "right" }}>Do pedido</th>
            </tr>
          </thead>
          <tbody>
            {pedidos.map((p) => {
              const grave = Number(p.espera_pct) >= 50;
              return (
                <React.Fragment key={p.pedido_id}>
                  <tr onClick={() => setAberto(aberto === p.pedido_id ? null : p.pedido_id)}
                      style={{ cursor: "pointer" }}>
                    <td style={td}>
                      <b>{p.pedido_id}</b>
                      <div style={{ fontSize: 11, color: "#8A8778" }}>
                        {p.itens} itens · {aberto === p.pedido_id ? "fechar" : "ver a linha do tempo"}
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>{p.estacoes}</td>
                    <td style={{ ...td, textAlign: "right" }}>{min1(p.total_min)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 800,
                                 color: grave ? "#C4432B" : "#22231F" }}>{min1(p.espera_min)}</td>
                    <td style={{ ...td, textAlign: "right",
                                 color: grave ? "#C4432B" : "#8A8778" }}>
                      {p.espera_pct == null ? "—" : `${p.espera_pct}%`}
                    </td>
                  </tr>
                  {aberto === p.pedido_id && (
                    <tr>
                      <td colSpan={5} style={{ ...td, background: "#F6F1E7", padding: "12px 14px" }}>
                        <LinhaDoTempo pedido={p.pedido_id} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: "#8A8778", marginTop: 9, lineHeight: 1.6 }}>
        <b>Esperando</b> é quanto tempo já havia comida pronta na janela enquanto o resto
        do pedido não saía. <b>Do pedido</b> é o quanto isso representou do tempo total:
        acima de 50% quer dizer que a maior parte do pedido foi comida parada, não comida
        sendo feita. Clique numa linha para ver em qual estação o tempo foi embora.
      </div>
    </div>
  );
}

// =====================================================================
// A LINHA DO TEMPO DE UM PEDIDO
//
// Uma barra por item, posicionada pelo relógio. A faixa vermelha é o
// intervalo em que já havia comida pronta esperando — é o desenho que
// mostra que o problema costuma ser QUANDO a estação foi acionada, não a
// velocidade dela.
// =====================================================================
function LinhaDoTempo({ pedido }) {
  const [itens, setItens] = useState(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await supabase.rpc("kds_pedido_linha", { p_pedido: pedido });
      if (!vivo) return;
      if (error) { setErro(error.message); setItens([]); return; }
      setItens(data || []);
    })();
    return () => { vivo = false; };
  }, [pedido]);

  if (erro) return <div style={{ fontSize: 12, color: "#C4432B" }}>{erro}</div>;
  if (!itens) return <div style={{ fontSize: 12, color: "#8A8778" }}>Carregando…</div>;
  if (itens.length === 0) return <div style={{ fontSize: 12, color: "#8A8778" }}>Sem itens.</div>;

  const total = Math.max(1, Number(itens[0].total_seg) || 1);
  const prim = Number(itens[0].primeiro_pronto) || 0;
  const ult = Number(itens[0].ultimo_pronto) || total;
  const pc = (s) => `${(100 * Number(s)) / total}%`;
  const corDe = (setor) =>
    setor === "chapa" ? "#22231F" : setor === "cozinha" ? "#6E6F63" : "#A9A496";

  return (
    <div>
      <div style={{ position: "relative", display: "grid", gap: 5 }}>
        {/* a faixa da espera, atrás de tudo */}
        {ult > prim && (
          <div aria-hidden="true" style={{
            position: "absolute", left: pc(prim), width: pc(ult - prim),
            top: 0, bottom: 0, background: "#C4432B", opacity: 0.09, pointerEvents: "none",
          }} />
        )}
        {itens.map((i, k) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "minmax(90px,150px) 1fr 54px",
                                gap: 8, alignItems: "center", position: "relative" }}>
            <span style={{ fontSize: 11, color: "#22231F", overflow: "hidden",
                           textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.nome}</span>
            <span style={{ position: "relative", height: 16, background: "#FFFFFF",
                           border: "1px solid #E8E2D2", display: "block" }}>
              <span style={{
                position: "absolute", top: 0, bottom: 0,
                left: pc(i.inicio_seg),
                width: `max(3px, ${(100 * (Number(i.fim_seg) - Number(i.inicio_seg))) / total}%)`,
                background: i.aberto ? "#C9A227" : corDe(i.setor),
              }} />
            </span>
            <span style={{ fontSize: 10.5, color: "#8A8778", textAlign: "right",
                           fontVariantNumeric: "tabular-nums" }}>
              {i.aberto ? "aberto" : `${min1(i.producao_min)}m`}
            </span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#8A8778", marginTop: 8, lineHeight: 1.5 }}>
        A faixa vermelha é o intervalo com comida pronta esperando. Barra que começa
        tarde não é estação lenta — é estação acionada tarde.
      </div>
    </div>
  );
}

// =====================================================================
// MAIS LENTOS E MAIS RÁPIDOS
//
// O módulo media por estação e nunca por prato. A coluna FILA é a que
// costuma explicar o problema: prato com produção curta e fila longa não
// é difícil de fazer, é esquecido na comanda — e aí aparecer entre os
// "mais rápidos" não quer dizer nada de bom.
//
// Prato que não foi produzido não aparece: sem produção não existe tempo
// para medir. O que não vendeu é pergunta do fechamento mensal.
//
// A mediana, e não a média: um pedido travado sozinho entorta a média de
// um prato feito cinco vezes.
// =====================================================================
function MaisLentosRapidos({ pratos }) {
  if (!pratos || pratos.length === 0) return null;
  const comAmostra = pratos.filter((p) => Number(p.itens) > 0);
  if (comAmostra.length === 0) return null;

  // Com poucos pratos, duas listas mostrariam os MESMOS itens dos dois
  // lados — "mais lento" e "mais rápido" do mesmo conjunto de cinco é
  // ridículo. Abaixo de seis pratos vira uma lista só, ordenada.
  const poucos = comAmostra.length < 6;
  const n = Math.min(5, Math.floor(comAmostra.length / 2));
  const lentos = comAmostra.slice(0, n);
  const rapidos = comAmostra.slice(comAmostra.length - n).reverse();

  return (
    <div style={{ marginTop: 34 }}>
      <div style={rotulo}>
        {poucos ? "Do mais lento ao mais rápido" : "Mais lentos e mais rápidos"}
      </div>
      {poucos ? (
        <ListaPratos itens={comAmostra} />
      ) : (
        <div style={{ display: "grid", gap: 26,
                      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <ListaPratos titulo="Mais lentos" itens={lentos} />
          <ListaPratos titulo="Mais rápidos" itens={rapidos} />
        </div>
      )}
      <div style={{ ...paragrafo, marginTop: 12 }}>
        O número é a <b style={forte}>mediana da produção</b> daquele prato — do
        "peguei" ao "terminei". Prato com produção curta e <b style={forte}>fila</b> longa
        não é difícil de fazer, é esquecido: estar entre os rápidos aí não é elogio.
      </div>
    </div>
  );
}

function ListaPratos({ titulo, itens }) {
  return (
    <div>
      {titulo && (
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4,
                      letterSpacing: -0.1 }}>
          {titulo}{" "}
          <span style={{ fontWeight: 400, color: "#8A8778", fontSize: 11 }}>
            · mediana por prato
          </span>
        </div>
      )}
      {itens.map((p, k) => {
        const filaAlta = Number(p.fila_mediana) > Number(p.producao_mediana);
        return (
          <div key={k} style={{ display: "flex", alignItems: "baseline", gap: 8,
                                padding: "9px 0", fontSize: 12.5,
                                borderTop: "1px solid #E8E2D2" }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", overflow: "hidden",
                             textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.nome}
              </span>
              <small style={{ display: "block", fontSize: 10.5, color: "#8A8778",
                              fontVariantNumeric: "tabular-nums" }}>
                {p.setor} · {p.itens} {Number(p.itens) === 1 ? "medição" : "medições"}
                {" · pior "}{min1(p.producao_pior)}m
                {filaAlta && (
                  <b style={{ color: "#C4432B" }}>
                    {" · fila "}{min1(p.fila_mediana)}m
                  </b>
                )}
              </small>
            </span>
            <b style={{ flex: "none", fontVariantNumeric: "tabular-nums",
                        color: filaAlta ? "#C4432B" : "#22231F" }}>
              {min1(p.producao_mediana)}m
            </b>
          </div>
        );
      })}
    </div>
  );
}

// =====================================================================
// PRODUTOS — em que estação cada produto é feito
// =====================================================================
function Produtos({ setores, editar }) {
  const [pratos, setPratos] = useState([]);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("sem");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [marcados, setMarcados] = useState(() => new Set());

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from("pratos").select("id, nome, setor").order("nome");
    if (error) setErro(error.message);
    setPratos(data || []);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const semEstacao = pratos.filter((p) => !p.setor).length;

  const lista = useMemo(() => {
    const q = chaveNome(busca);
    return pratos.filter((p) => {
      if (q && !chaveNome(p.nome).includes(q)) return false;
      if (filtro === "sem" && p.setor) return false;
      if (filtro.startsWith("setor:") && p.setor !== filtro.slice(6)) return false;
      return true;
    });
  }, [pratos, busca, filtro]);

  const definir = async (prato, setor) => {
    setErro("");
    const valor = setor || null;
    const { error } = await supabase.from("pratos").update({ setor: valor }).eq("id", prato.id);
    if (error) { setErro(error.message); return; }
    setPratos((atual) => atual.map((p) => (p.id === prato.id ? { ...p, setor: valor } : p)));
  };

  const definirMarcados = async (setor) => {
    if (marcados.size === 0) return;
    setErro("");
    const ids = [...marcados];
    const { error } = await supabase.from("pratos").update({ setor }).in("id", ids);
    if (error) { setErro(error.message); return; }
    setPratos((atual) => atual.map((p) => (marcados.has(p.id) ? { ...p, setor } : p)));
    setMarcados(new Set());
  };

  const alterna = (id) => {
    setMarcados((s) => {
      const novo = new Set(s);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });
  };

  if (carregando) return <div style={vazio}><Loader2 size={16} /> Carregando…</div>;

  return (
    <div>
      {erro && <div style={avisoErro}><AlertTriangle size={16} /> {erro}</div>}

      {semEstacao > 0 && (
        <div style={avisoAmarelo}>
          <AlertTriangle size={16} />
          <div style={{ fontSize: 13 }}>
            <b>{semEstacao} produto(s) sem estação.</b> Enquanto estiverem assim, eles
            não aparecem em tela nenhuma da produção — e o pedido que tiver um deles
            nunca fica 100% pronto, porque não existe ninguém pra dar o "terminei".
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "#8A8778" }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar produto…"
            style={{ ...inputStyle, width: "100%", paddingLeft: 30 }} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={() => setFiltro("sem")}
          style={{ ...chip, ...(filtro === "sem" ? chipAtivo : {}) }}>
          Sem estação ({semEstacao})
        </button>
        <button onClick={() => setFiltro("todos")}
          style={{ ...chip, ...(filtro === "todos" ? chipAtivo : {}) }}>
          Todos ({pratos.length})
        </button>
        {setores.map((s) => {
          const chave = `setor:${s.chave}`;
          const n = pratos.filter((p) => p.setor === s.chave).length;
          return (
            <button key={s.chave} onClick={() => setFiltro(chave)}
              style={{ ...chip, ...(filtro === chave ? chipAtivo : {}) }}>
              {s.label} ({n})
            </button>
          );
        })}
      </div>

      {editar && marcados.size > 0 && (
        <div style={{ ...cardStyle, marginBottom: 12, display: "flex", gap: 6,
                      flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{marcados.size} marcado(s) →</span>
          {setores.map((s) => (
            <button key={s.chave} onClick={() => definirMarcados(s.chave)} style={chip}>
              {s.label}
            </button>
          ))}
          <button onClick={() => setMarcados(new Set())} style={{ ...chip, marginLeft: "auto" }}>
            <X size={12} /> Limpar
          </button>
        </div>
      )}

      {lista.length === 0 ? (
        <div style={vazio}>Nenhum produto com esse filtro.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {lista.map((p) => (
            <div key={p.id} style={{ ...linha, borderColor: p.setor ? "#E8E2D2" : "#F0D8CE",
                                     background: p.setor ? "#FFFFFF" : "#FFFBFA" }}>
              {editar && (
                <input type="checkbox" checked={marcados.has(p.id)}
                  onChange={() => alterna(p.id)} style={{ marginRight: 4 }} />
              )}
              <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}>{p.nome}</div>
              <select value={p.setor || ""} disabled={!editar}
                onChange={(e) => definir(p, e.target.value)}
                style={{ ...inputStyle, width: 128, padding: "7px 8px", fontSize: 13 }}>
                <option value="">sem estação</option>
                {setores.map((s) => (
                  <option key={s.chave} value={s.chave}>{s.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 11, color: "#8A8778", marginTop: 12, lineHeight: 1.6 }}>
        Produto que passa por duas estações (o lanche que leva batata junto, por
        exemplo) deve ficar na estação que <b>produz</b> o item, não na que monta.
        Se ele é vendido como um item só no cardápio, escolhe a estação que leva
        mais tempo — é ela que segura o pedido.
      </div>
    </div>
  );
}

// =====================================================================
// AJUSTES — o SLA de cada estação
// =====================================================================
function Ajustes({ setores, editar }) {
  const [sla, setSla] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from("setor_sla").select("setor, amarelo_min, vermelho_min");
    if (error) setErro(error.message);
    setSla(data || []);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async (setor, campo, valor) => {
    const n = parseInt(valor, 10);
    if (isNaN(n) || n <= 0) return;
    setErro("");
    const { error } = await supabase.from("setor_sla")
      .upsert({ setor, [campo]: n }, { onConflict: "setor" });
    if (error) { setErro(error.message); return; }
    setSla((atual) => {
      const achou = atual.some((s) => s.setor === setor);
      if (achou) return atual.map((s) => (s.setor === setor ? { ...s, [campo]: n } : s));
      return [...atual, { setor, amarelo_min: 6, vermelho_min: 12, [campo]: n }];
    });
  };

  if (carregando) return <div style={vazio}><Loader2 size={16} /> Carregando…</div>;

  return (
    <div>
      {erro && <div style={avisoErro}><AlertTriangle size={16} /> {erro}</div>}

      <div style={{ fontSize: 13, color: "#8A8778", marginBottom: 14, lineHeight: 1.6 }}>
        A partir de quantos minutos o relógio da estação fica <b style={{ color: "#B3701A" }}>amarelo</b> e
        depois <b style={{ color: "#C4432B" }}>vermelho</b>. Chapa e caixa não podem ter o mesmo limite:
        tirar um chopp leva um minuto, montar três Kong Duplo não.
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {setores.map((s) => {
          const atual = sla.find((x) => x.setor === s.chave) || { amarelo_min: 6, vermelho_min: 12 };
          return (
            <div key={s.chave} style={linha}>
              <div style={{ flex: 1, fontWeight: 700, fontSize: 14 }}>{s.label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontSize: 11, color: "#B3701A", fontWeight: 700 }}>amarelo</span>
                <input defaultValue={atual.amarelo_min} disabled={!editar} inputMode="numeric"
                  onBlur={(e) => salvar(s.chave, "amarelo_min", e.target.value)}
                  style={{ ...inputStyle, width: 56, textAlign: "center", padding: "7px 4px" }} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontSize: 11, color: "#C4432B", fontWeight: 700 }}>vermelho</span>
                <input defaultValue={atual.vermelho_min} disabled={!editar} inputMode="numeric"
                  onBlur={(e) => salvar(s.chave, "vermelho_min", e.target.value)}
                  style={{ ...inputStyle, width: 56, textAlign: "center", padding: "7px 4px" }} />
              </div>
              <span style={{ fontSize: 11, color: "#8A8778" }}>min</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================================
// Peças de tela
// =====================================================================
function Shell({ titulo, subtitulo, children, onVoltar }) {
  return (
    <div style={pagina}>
      <div className="app-shell">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          {onVoltar && (
            <button onClick={onVoltar} style={iconBtn}><ChevronLeft size={18} /></button>
          )}
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: "#22231F" }}>{titulo}</div>
            {subtitulo && <div style={{ fontSize: 12, color: "#8A8778" }}>{subtitulo}</div>}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// CARTÕES DE ESTAÇÃO
//
// Isto aqui era uma tabela com quatro colunas de jargão e números sem
// unidade. "0,1" e "34,8" na mesma linha não dizem nada: o bar levava
// 6 segundos para tirar uma bebida que tinha ficado 35 minutos parada,
// e isso — que é o achado mais caro do dia — se perdia entre as colunas.
//
// Agora cada estação é uma barra e uma frase. A barra mostra o caminho
// do item: quanto ficou parado na fila e quanto a estação trabalhou de
// fato. São dois problemas diferentes com dois remédios diferentes:
// fila grande é gente e ordem de acionar, produção grande é processo.
// A tabela crua continua embaixo, dobrada, para conferência.
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// COLUNAS DE ESTAÇÃO
//
// Isto era uma tabela com quatro colunas de jargão e números sem unidade.
// "0,1" e "34,8" na mesma linha não dizem nada: o bar levava 6 segundos
// para tirar uma bebida que tinha ficado 35 minutos parada, e isso — que
// é o achado mais caro do dia — se perdia entre as colunas.
//
// Agora cada estação é uma coluna, TODAS NA MESMA ESCALA: a mais alta do
// dia define a altura e as outras ficam proporcionais a ela. Essa
// comparação entre estações é a coisa mais útil da tela e não existia,
// porque antes cada barra ia de 0 a 100% dela mesma.
//
// Verde embaixo é a estação trabalhando; o bloco de cima é o item parado
// na fila. São dois problemas com dois remédios: fila é gente e ordem de
// acionar, produção é processo da estação.
// ---------------------------------------------------------------------
function tempoCurto(min) {
  const v = Number(min);
  if (min === null || min === undefined || Number.isNaN(v)) return "—";
  if (v > 0 && v < 1) return `${Math.round(v * 60)} s`;
  return `${min1(v)} min`;
}

// A espera só é o problema quando ela domina o tempo do item. Estação que
// faz em 7 min e espera 5 está equilibrada; a que faz em 6 segundos e
// espera 35 minutos não é lenta, é esquecida.
function esperaDomina(l) {
  const prod = Number(l.producao_media) || 0;
  const fila = Number(l.fila_media) || 0;
  return fila >= 5 && fila > prod;
}

const ALTURA_TORRE = 150;

function ColunasEstacao({ linhas }) {
  // O tempo de um item vem medido item a item pela 051. Somar a fila media
  // com a producao media NAO devolve isso: com medianas a soma nem e valida
  // (mediana de a + mediana de b nao e a mediana de a+b). A soma fica so
  // como ultimo recurso, para a tela nao ficar vazia antes da 051 rodar.
  const total = (l) =>
    l.tempo && l.tempo.total_medio != null
      ? Number(l.tempo.total_medio)
      : (Number(l.fila_media) || 0) + (Number(l.producao_media) || 0);
  const ordenadas = [...linhas].sort((a, b) => total(b) - total(a));
  const teto = Math.max(...ordenadas.map(total), 0.0001);

  return (
    <div>
      <div style={{ display: "grid", gap: 14, alignItems: "end",
                    gridTemplateColumns: `repeat(${Math.max(ordenadas.length, 1)}, 1fr)` }}>
        {ordenadas.map((l) => {
          const prod = Number(l.producao_media) || 0;
          const fila = Number(l.fila_media) || 0;
          const seg = l.segurou_pct == null ? null : Number(l.segurou_pct);
          const grave = esperaDomina(l);
          // A torre tem a altura do tempo medido, repartida na proporcao
          // entre fila e producao. Sem reescalar, uma coluna cujo total
          // medido e menor que fila+producao estouraria a propria altura.
          const soma = fila + prod;
          const escala = soma > 0 ? total(l) / soma : 0;
          return (
            <div key={l.setor} style={{ display: "flex", flexDirection: "column",
                                        alignItems: "center", textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700,
                            fontVariantNumeric: "tabular-nums", letterSpacing: -0.3 }}>
                {min1(total(l))}
                <span style={{ fontSize: 11, color: "#8A8778", fontWeight: 400,
                               marginLeft: 1 }}>min</span>
              </div>
              <div style={{ fontSize: 10, color: "#8A8778", marginBottom: 7,
                            letterSpacing: 0.2, minHeight: 13 }}>
                {l.tempo && l.tempo.total_mediana != null
                  ? `mediana ${min1(l.tempo.total_mediana)}`
                  : ""}
              </div>

              <div style={{ width: 44, height: ALTURA_TORRE, display: "flex",
                            flexDirection: "column", justifyContent: "flex-end",
                            borderRadius: 4, overflow: "hidden" }}>
                {/* piso de 2px: sem ele a bebida (6 s contra 35 min de fila)
                    some da coluna e a legenda promete um verde que nao existe */}
                <div style={{ width: "100%", background: grave ? "#C4432B" : "#C9C3B1",
                              height: fila > 0
                                ? `max(2px, ${(fila * escala / teto) * ALTURA_TORRE}px)` : 0 }} />
                <div style={{ width: "100%", background: "#2F8F5B",
                              height: prod > 0
                                ? `max(2px, ${(prod * escala / teto) * ALTURA_TORRE}px)` : 0 }} />
              </div>

              <div style={{ marginTop: 9, paddingTop: 9, width: "100%",
                            borderTop: "1px solid #E8E2D2" }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{l.label || l.setor}</div>
                <div style={{ fontSize: 11, color: "#8A8778", marginTop: 1 }}>
                  {l.itens} {Number(l.itens) === 1 ? "item" : "itens"}
                </div>
                <div style={{ fontSize: 11, color: "#8A8778", marginTop: 7,
                              lineHeight: 1.65, fontVariantNumeric: "tabular-nums" }}>
                  <span style={grave ? { color: "#C4432B", fontWeight: 700 } : undefined}>
                    {tempoCurto(fila)} esperando
                  </span><br />
                  {tempoCurto(prod)} fazendo<br />
                  {seg === null ? "—" : (
                    <span style={seg >= 50 ? { color: "#C4432B", fontWeight: 700 } : undefined}>
                      segurou {seg}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 18,
                    fontSize: 11, color: "#8A8778", flexWrap: "wrap" }}>
        <span>
          <i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2,
                      marginRight: 5, verticalAlign: -1, background: "#C9C3B1" }} />
          parado na fila
        </span>
        <span>
          <i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2,
                      marginRight: 5, verticalAlign: -1, background: "#C4432B" }} />
          fila dominando o tempo
        </span>
        <span>
          <i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2,
                      marginRight: 5, verticalAlign: -1, background: "#2F8F5B" }} />
          estação trabalhando
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// O MAIS LENTO DE CADA LINHA  (precisa da 049)
//
// Um ranking geral de pratos é sempre dominado pelos hambúrgueres: o
// petisco mais lento da casa nunca apareceria. Separando por linha de
// produto, cada categoria mostra o seu pior.
//
// Prato sem linha_produto preenchida cai em "(sem linha)" e fica marcado
// em vermelho — é a lista do que falta classificar em Fichas Técnicas.
// Escondê-lo faria a tela mentir por omissão.
// ---------------------------------------------------------------------
function MaisLentoPorLinha({ linhas }) {
  if (!linhas || linhas.length === 0) return null;

  return (
    <div style={{ marginTop: 34 }}>
      <div style={rotulo}>O mais lento de cada linha</div>
      {linhas.map((l, i) => {
        const sem = String(l.linha || "").startsWith("(sem");
        return (
          <div key={l.linha} style={{ display: "flex", alignItems: "baseline", gap: 10,
                                      padding: "11px 0", flexWrap: "wrap",
                                      borderTop: i === 0 ? "none" : "1px solid #E8E2D2" }}>
            <span style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5,
                           fontWeight: 800, width: 118, flex: "none", lineHeight: 1.35,
                           color: sem ? "#C4432B" : "#8A8778" }}>
              {sem ? "Sem linha" : l.linha}
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 600, flex: "1 1 55%", minWidth: 0 }}>
              {l.pior_prato || "—"}
              <small style={{ display: "block", fontSize: 11, color: "#8A8778",
                              fontWeight: 400, marginTop: 1,
                              fontVariantNumeric: "tabular-nums" }}>
                {sem
                  ? `${l.pratos} ${Number(l.pratos) === 1 ? "prato" : "pratos"} sem categoria — classifique em Fichas Técnicas`
                  : `${l.pior_prato_itens} ${Number(l.pior_prato_itens) === 1 ? "medição" : "medições"} · linha inteira ${min1(l.producao_mediana)}m`}
              </small>
            </span>
            <span style={{ fontSize: 15, fontWeight: 700, flex: "none",
                           fontVariantNumeric: "tabular-nums" }}>
              {min1(l.pior_prato_mediana)}
              <span style={{ fontSize: 10.5, color: "#8A8778", fontWeight: 400 }}>m</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
// PONTOS DE MELHORIA
//
// Os mesmos números de cima, escritos como ação. A ordem é a do custo:
// quem comeu mais tempo aparece primeiro. Nada aqui é texto fixo — se a
// estação melhorar, o ponto some sozinho.
// ---------------------------------------------------------------------
function pontosDeMelhoria(estacoes, porLinha) {
  const pontos = [];
  const total = (l) => (Number(l.fila_media) || 0) + (Number(l.producao_media) || 0);
  const ordenadas = [...estacoes].sort((a, b) => total(b) - total(a));

  for (const l of ordenadas) {
    const nome = String(l.label || l.setor).toLowerCase();
    const prod = Number(l.producao_media) || 0;
    const fila = Number(l.fila_media) || 0;
    const seg = l.segurou_pct == null ? null : Number(l.segurou_pct);

    if (prod < 1 && fila >= 5) {
      pontos.push({
        titulo: `Acione ${nome === "bar" ? "o bar" : `a estação ${nome}`} junto com a chapa, não no fim.`,
        corpo: `O item leva ${tempoCurto(prod)} pra ficar pronto, mas ficou ${tempoCurto(fila)} parado esperando alguém apertar "peguei". É o tempo mais barato de recuperar da casa inteira.`,
      });
    } else if (fila > prod && fila >= 5) {
      const pct = Math.round((fila / (fila + prod)) * 100);
      pontos.push({
        titulo: `Alguém precisa olhar a tela ${nome === "cozinha" ? "da cozinha" : `de ${nome}`}.`,
        corpo: `Dos ${min1(total(l))} min de um item, ${min1(fila)} foram antes de qualquer um pegar — ${pct}% do tempo não foi comida sendo feita, foi comida esperando.`,
      });
    } else if (seg !== null && seg >= 50) {
      pontos.push({
        titulo: `A ${nome} dita o tempo do pedido.`,
        corpo: `Em ${seg}% dos pedidos foi ela a última a terminar. Reforço de gente entra aqui primeiro.`,
      });
    }
  }

  // O gargalo escondido: um prato muito acima da própria linha. Só vale
  // apontar com medição suficiente — um prato feito uma vez é anedota.
  for (const l of porLinha || []) {
    const pior = Number(l.pior_prato_mediana) || 0;
    const linha = Number(l.producao_mediana) || 0;
    if (Number(l.pior_prato_itens) >= 3 && Number(l.pratos) > 1 &&
        linha > 0 && pior >= linha * 1.8) {
      pontos.push({
        titulo: `${l.pior_prato} é o gargalo escondido de ${String(l.linha).toLowerCase()}.`,
        corpo: `${min1(pior)} min de mediana contra ${min1(linha)} min da linha inteira. Item que demora mais que os vizinhos da própria categoria quebra a ordem de servir.`,
      });
    }
  }

  return pontos.slice(0, 5);
}

function PontosMelhoria({ estacoes, porLinha }) {
  const pontos = pontosDeMelhoria(estacoes, porLinha);
  if (pontos.length === 0) {
    return (
      <div style={{ marginTop: 34 }}>
        <div style={rotulo}>Pontos de melhoria</div>
        <div style={{ fontSize: 13, color: "#8A8778", lineHeight: 1.7 }}>
          Nada gritando hoje: nenhuma estação com fila dominando o tempo e nenhuma
          segurando mais da metade dos pedidos. Os números crus continuam abaixo.
        </div>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 34 }}>
      <div style={rotulo}>Pontos de melhoria</div>
      <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {pontos.map((p, i) => (
          <li key={i} style={{ position: "relative", paddingLeft: 26, marginBottom: 14,
                               fontSize: 13.5, lineHeight: 1.6 }}>
            <span style={{ position: "absolute", left: 0, top: 1, width: 17, height: 17,
                           borderRadius: "50%", background: "#22231F", color: "#F7F1E6",
                           fontSize: 10, fontWeight: 800, display: "flex",
                           alignItems: "center", justifyContent: "center" }}>
              {i + 1}
            </span>
            <b>{p.titulo}</b> {p.corpo}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------
// COMO LER + os números crus, dobrados
// ---------------------------------------------------------------------
function ComoLer({ estacoes, temLinhas }) {
  return (
    <>
      <div style={{ marginTop: 34 }}>
        <div style={rotulo}>Como ler</div>
        <p style={paragrafo}>
          Cada coluna é o caminho de um item naquela estação, e todas estão na mesma
          escala — a altura dá pra comparar entre si. A parte de cima é o tempo{" "}
          <b style={forte}>parado na fila</b>, antes de alguém apertar "peguei"; a verde
          é a estação <b style={forte}>trabalhando</b> de fato. Coluna alta e clara é
          problema de <b style={forte}>gente e ordem de acionar</b>. Coluna alta e verde
          é problema de <b style={forte}>processo da estação</b>. São dois remédios
          diferentes.
          <br /><br />
          O número grande de cada coluna é o <b style={forte}>tempo médio de um item</b>{" "}
          — medido de uma vez só, da abertura do pedido até o item ficar pronto, item a
          item, e só então tirada a média. Não é a soma da fila com a produção: somar
          duas médias não devolve o tempo de nada. A <b style={forte}>mediana</b> logo
          abaixo é o item do meio, e quando ela fica bem menor que a média é porque um
          item travado está puxando o dia.
          <br /><br />
          <b style={forte}>Segurou</b> é quantas vezes a estação foi a última a terminar
          o pedido — é esse número que decide onde entra gente. <b style={forte}>P90</b>{" "}
          é o pior 1 em cada 10: média boa com P90 alto quer dizer que às vezes trava
          feio, e é desse "às vezes" que o cliente reclama.
          {temLinhas && (
            <>
              <br /><br />
              <b style={forte}>O mais lento de cada linha</b> existe porque um ranking
              geral de pratos é sempre dominado pelos hambúrgueres: o petisco mais lento
              da casa nunca apareceria. Separando por linha, cada categoria mostra o seu
              pior.
            </>
          )}
          <br /><br />
          A fila presa é zerada todo dia às 04:00, então item esquecido de ontem não
          suja a conta de hoje.
        </p>
      </div>

      <details style={{ marginTop: 30, borderTop: "1px solid #E8E2D2", paddingTop: 14 }}>
        <summary style={{ ...rotulo, marginBottom: 0, cursor: "pointer" }}>
          Ver os números crus
        </summary>
        <div style={{ ...cardStyle, marginTop: 12, padding: 0, overflow: "hidden" }}>
          <table style={tabela}>
            <thead>
              <tr>
                <th style={th}>Estação</th>
                <th style={{ ...th, textAlign: "right" }}>Itens</th>
                <th style={{ ...th, textAlign: "right" }}>Fila</th>
                <th style={{ ...th, textAlign: "right" }}>Produção</th>
                <th style={{ ...th, textAlign: "right" }}>P90</th>
                <th style={{ ...th, textAlign: "right" }}>Segurou</th>
              </tr>
            </thead>
            <tbody>
              {estacoes.map((l) => (
                <tr key={l.setor}>
                  <td style={td}><b>{l.label || l.setor}</b></td>
                  <td style={{ ...td, textAlign: "right" }}>{l.itens}</td>
                  <td style={{ ...td, textAlign: "right" }}>{min1(l.fila_media)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{min1(l.producao_media)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{min1(l.producao_p90)}</td>
                  <td style={{ ...td, textAlign: "right",
                               color: Number(l.segurou_pct) >= 50 ? "#C4432B" : "#22231F",
                               fontWeight: Number(l.segurou_pct) >= 50 ? 800 : 400 }}>
                    {l.segurou_pct == null ? "—" : `${l.segurou_pct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11.5, color: "#8A8778", marginTop: 10, lineHeight: 1.6 }}>
          Tudo em minutos. <b>Produção</b> é do "peguei" ao "terminei" — a estação em si.
          <b> Fila</b> é o tempo antes de alguém pegar, que é falta de gente, não da estação.
        </div>
      </details>
    </>
  );
}

const rotulo = {
  fontSize: 11, textTransform: "uppercase", letterSpacing: 0.7,
  color: "#8A8778", fontWeight: 800, marginBottom: 11,
};
const paragrafo = { fontSize: 13, color: "#8A8778", lineHeight: 1.75, margin: 0 };
const forte = { color: "#22231F", fontWeight: 600 };

function Numero({ valor, label, alerta }) {
  return (
    <div style={{ ...cardStyle, flex: 1, minWidth: 128, textAlign: "center", padding: "12px 10px" }}>
      <div style={{ fontSize: 21, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                    color: alerta ? "#C4432B" : "#22231F" }}>
        {valor}
      </div>
      <div style={{ fontSize: 11, color: "#8A8778", marginTop: 2 }}>{label}</div>
    </div>
  );
}

// =====================================================================
// Estilos
// =====================================================================
const pagina = { minHeight: "100vh", background: "#F7F1E6", padding: "18px 14px 40px" };
const cardStyle = {
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14,
};
const linha = {
  display: "flex", alignItems: "center", gap: 10,
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10, padding: "10px 12px",
};
const inputStyle = {
  boxSizing: "border-box", padding: "9px 11px", borderRadius: 9,
  border: "1px solid #E8E2D2", fontSize: 14, background: "#FFFFFF", color: "#22231F",
  fontFamily: "inherit",
};
const chip = {
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "7px 12px", borderRadius: 999, border: "1px solid #E8E2D2",
  background: "#FFFFFF", color: "#8A8778", fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit",
};
const chipAtivo = { background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" };
const btnPri = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  background: "#C72B2E", color: "#FFFFFF", border: "none", borderRadius: 9,
  padding: "12px 14px", fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
};
const btnEscuro = { ...btnPri, background: "#22231F" };
const btnSec = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  background: "#F6F1E7", color: "#22231F", border: "1px solid #E8E2D2", borderRadius: 9,
  padding: "12px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
const iconBtn = {
  width: 34, height: 34, borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#22231F",
};
const selo = {
  fontSize: 10, fontWeight: 800, padding: "2px 7px", borderRadius: 5,
  background: "#F1EEE2", color: "#6B6558", marginLeft: 7, whiteSpace: "nowrap",
};
const vazio = {
  display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#8A8778", padding: "16px 0",
};
const avisoErro = {
  display: "flex", gap: 8, background: "#FDECEA", border: "1px solid #F0C0B8",
  color: "#A32D2D", borderRadius: 10, padding: "11px 13px", fontSize: 13,
  alignItems: "flex-start", marginBottom: 12,
};
const avisoVerde = {
  display: "flex", gap: 8, background: "#EAF6EF", border: "1px solid #BFE0CE",
  color: "#2F8F5B", borderRadius: 10, padding: "11px 13px", fontSize: 13,
  alignItems: "flex-start", marginBottom: 12,
};
const avisoAmarelo = {
  display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A",
  color: "#7A6A1E", borderRadius: 10, padding: "11px 13px", fontSize: 13,
  alignItems: "flex-start",
};
const tabela = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const th = {
  textAlign: "left", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.6,
  color: "#8A8778", fontWeight: 800, padding: "10px 10px 8px", borderBottom: "1px solid #E8E2D2",
};
const td = { padding: "10px", borderBottom: "1px solid #F4EEE3", fontVariantNumeric: "tabular-nums" };
