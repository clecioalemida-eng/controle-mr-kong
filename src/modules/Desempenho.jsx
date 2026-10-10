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
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const dia = hojeISO();

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [{ data: est, error: e1 }, { data: esp, error: e2 },
              { data: rank }, { data: piores }] = await Promise.all([
        supabase.rpc("desempenho_estacoes", { p_inicio: dia, p_fim: dia }),
        supabase.rpc("espera_montagem", { p_inicio: dia, p_fim: dia }),
        // A 048 e opcional para esta tela: se ainda nao rodou, os blocos
        // novos somem e o resto continua igual. Erro aqui nao quebra nada.
        supabase.rpc("kds_ranking_pratos", { p_inicio: dia, p_fim: dia }),
        supabase.rpc("kds_pedidos_espera", { p_inicio: dia, p_fim: dia, p_limite: 6 }),
      ]);
      if (!vivo) return;
      if (e1) setErro(e1.message);
      if (e2) setErro(e2.message);
      setLinhas(est || []);
      setEspera(Array.isArray(esp) ? esp[0] : esp);
      setRanking(rank || []);
      setPiores(piores || []);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [dia]);

  if (carregando) return <div style={vazio}><Loader2 size={16} /> Carregando…</div>;

  const comDado = linhas.filter((l) => Number(l.itens) > 0);

  return (
    <div>
      {erro && <div style={avisoErro}><AlertTriangle size={16} /> {erro}</div>}

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
          <CartoesEstacao linhas={comDado} />

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

          <PioresPedidos pedidos={piores} />
          <RankingPratos pratos={ranking} />
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
// RANKING POR PRATO
//
// O módulo media por estação e nunca por prato. A coluna FILA é a que
// costuma explicar o problema: prato com produção curta e fila longa não
// é difícil de fazer, é esquecido na comanda.
//
// Prato que não foi produzido não aparece: sem produção não existe tempo
// para medir. O que não vendeu é pergunta do fechamento mensal.
// =====================================================================
function RankingPratos({ pratos }) {
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
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6,
                    color: "#8A8778", fontWeight: 800, marginBottom: 8 }}>
        Tempo por prato
      </div>
      {poucos ? (
        <ListaPratos titulo="Do mais lento ao mais rápido" itens={comAmostra} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 10 }}>
          <ListaPratos titulo="Mais lentos" itens={lentos} />
          <ListaPratos titulo="Mais rápidos" itens={rapidos} />
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "#8A8778", marginTop: 9, lineHeight: 1.6 }}>
        <b>Produção</b> é do "peguei" ao "terminei". <b>Fila</b> é quanto o item esperou
        desde a abertura do pedido até alguém pegar. Prato com produção curta e fila longa
        não é difícil de fazer — é esquecido. Prato que não foi produzido hoje não aparece
        aqui; o que não vendeu é assunto do fechamento mensal.
      </div>
    </div>
  );
}

function ListaPratos({ titulo, itens }) {
  return (
    <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "9px 12px", borderBottom: "1px solid #E8E2D2",
                    fontSize: 12.5, fontWeight: 800 }}>{titulo}</div>
      {itens.map((p, k) => {
        const filaAlta = Number(p.fila_mediana) > Number(p.producao_mediana);
        return (
          <div key={k} style={{ padding: "9px 12px",
                                borderTop: k === 0 ? "none" : "1px solid #E8E2D2" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
              <span style={{ fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis",
                             whiteSpace: "nowrap" }}>{p.nome}</span>
              <b style={{ fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{min1(p.producao_mediana)}m</b>
            </div>
            <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 2 }}>
              {p.setor} · {p.itens} {Number(p.itens) === 1 ? "medição" : "medições"}
              {" · pior "}{min1(p.producao_pior)}m
              {filaAlta && (
                <span style={{ color: "#C4432B", fontWeight: 700 }}>
                  {" · fila "}{min1(p.fila_mediana)}m
                </span>
              )}
            </div>
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
function tempoCurto(min) {
  const v = Number(min);
  if (min === null || min === undefined || Number.isNaN(v)) return "—";
  if (v > 0 && v < 1) return `${Math.round(v * 60)} s`;
  return `${min1(v)} min`;
}

function diagnostico(l) {
  const prod = Number(l.producao_media) || 0;
  const fila = Number(l.fila_media) || 0;
  const seg = l.segurou_pct == null ? null : Number(l.segurou_pct);

  // Estação rápida com fila enorme: o problema não é ela, é que ninguém
  // apertou "peguei". É o tempo mais fácil de recuperar da casa.
  if (prod < 1 && fila >= 5) {
    return { texto: "Ninguém olha a tela", tom: "ruim", causa: "fila" };
  }
  if (fila > prod && fila >= 5) {
    return { texto: "Demora pra começar", tom: "aviso", causa: "fila" };
  }
  if (seg !== null && seg >= 50) {
    return { texto: "É aqui que o pedido trava", tom: "ruim", causa: "producao" };
  }
  if (seg !== null && seg >= 30) {
    return { texto: "Segura o pedido às vezes", tom: "aviso", causa: "producao" };
  }
  return { texto: "Fluindo", tom: "ok", causa: null };
}

function CartaoEstacao({ l }) {
  const prod = Number(l.producao_media) || 0;
  const fila = Number(l.fila_media) || 0;
  const total = prod + fila;
  const seg = l.segurou_pct == null ? null : Number(l.segurou_pct);
  const dg = diagnostico(l);
  const nome = l.label || l.setor;

  // Piso de 3% para que um lado minúsculo (bebida: 6 s contra 35 min)
  // ainda apareça como um traço em vez de sumir.
  let pctFila = total > 0 ? (fila / total) * 100 : 0;
  if (fila > 0 && pctFila < 3) pctFila = 3;
  if (fila > 0 && pctFila > 97) pctFila = 97;
  const pctProd = 100 - pctFila;
  const filaGrave = dg.causa === "fila";

  // Só vale falar de P90 quando ele de fato se afasta da média. Com o bar
  // (média 0,1 e P90 0,1) a frase virava "levou 6 s em vez de 6 s".
  const p90 = Number(l.producao_p90) || 0;
  const instavel = p90 >= prod * 1.3 && p90 - prod >= 0.5;

  const tons = {
    ruim: { fundo: "#F7E2DD", texto: "#C4432B" },
    aviso: { fundo: "#F6EDD3", texto: "#8A6F13" },
    ok: { fundo: "#E2F0E8", texto: "#2F8F5B" },
  }[dg.tom];

  return (
    <div style={{ ...cardStyle, marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8,
                    flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontSize: 17, fontWeight: 800 }}>{nome}</span>
        <span style={{ fontSize: 12, color: "#8A8778" }}>
          {l.itens} {Number(l.itens) === 1 ? "item" : "itens"} hoje
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800,
                       padding: "3px 9px", borderRadius: 999, letterSpacing: 0.3,
                       background: tons.fundo, color: tons.texto }}>
          {dg.texto}
        </span>
      </div>

      <div style={{ display: "flex", height: 26, borderRadius: 6, overflow: "hidden",
                    border: "1px solid #E8E2D2", background: "#F7F1E6", marginBottom: 6 }}>
        {fila > 0 && (
          <div style={{ width: `${pctFila}%`, background: filaGrave ? "#C4432B" : "#B9B4A2",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, fontWeight: 700, color: "#FFFFFF", whiteSpace: "nowrap" }}>
            {pctFila >= 22 ? `esperou ${tempoCurto(fila)}` : ""}
          </div>
        )}
        {prod > 0 && (
          <div style={{ width: `${pctProd}%`, background: "#2F8F5B",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 11, fontWeight: 700, color: "#FFFFFF", whiteSpace: "nowrap" }}>
            {pctProd >= 22 ? `fez em ${tempoCurto(prod)}` : ""}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11,
                    color: "#8A8778", marginBottom: 12 }}>
        <span>
          <i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2,
                      marginRight: 5, verticalAlign: "middle",
                      background: filaGrave ? "#C4432B" : "#B9B4A2" }} />
          parado, esperando alguém pegar — {tempoCurto(fila)}
        </span>
        <span>
          <i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2,
                      marginRight: 5, verticalAlign: "middle", background: "#2F8F5B" }} />
          {String(nome).toLowerCase()} trabalhando — {tempoCurto(prod)}
        </span>
      </div>

      <div style={{ fontSize: 14, lineHeight: 1.65, marginBottom: 10 }}>
        Cada item ficou{" "}
        <b style={{ color: filaGrave ? "#C4432B" : "#22231F" }}>{tempoCurto(fila)}</b>{" "}
        parado até alguém apertar "peguei", e depois a estação levou{" "}
        <b>{tempoCurto(prod)}</b> pra fazer.
        {seg !== null && (
          <>
            {" "}Em{" "}
            <b style={{ color: seg >= 50 ? "#C4432B" : "#22231F" }}>{seg}% dos pedidos</b>{" "}
            ela foi a última a terminar — o resto da comida ficou esperando.
          </>
        )}
        {dg.causa === "fila" && prod < 1 && (
          <>
            {" "}<b>Não é a estação que está lenta</b> — ela só é acionada quando o
            pedido já vai sair. É o tempo mais fácil de recuperar da casa.
          </>
        )}
        {dg.causa === "fila" && prod >= 1 && (
          <>
            {" "}<b>A maior parte do tempo foi item na fila</b>, não comida sendo feita:
            isso é falta de gente ou de alguém olhando a tela, não lentidão da estação.
          </>
        )}
      </div>

      <div style={{ fontSize: 12.5, color: "#8A8778", borderTop: "1px dashed #E8E2D2",
                    paddingTop: 10 }}>
        {instavel ? (
          <>
            No pior dia-a-dia: 1 em cada 10 itens levou{" "}
            <b style={{ color: "#22231F" }}>{tempoCurto(l.producao_p90)}</b> em vez de{" "}
            {tempoCurto(prod)}. É desse item que o cliente reclama.
          </>
        ) : (
          <>
            Tempo estável: o pior caso ({tempoCurto(l.producao_p90)}) é praticamente
            igual à média. Quando a estação trabalha, ela trabalha sempre no mesmo tempo.
          </>
        )}
      </div>
    </div>
  );
}

function CartoesEstacao({ linhas }) {
  // Pior primeiro: onde o item passou mais tempo no total, somando a
  // fila com a produção. É a ordem de quem está procurando o que doeu.
  const ordenadas = [...linhas].sort(
    (a, b) =>
      ((Number(b.fila_media) || 0) + (Number(b.producao_media) || 0)) -
      ((Number(a.fila_media) || 0) + (Number(a.producao_media) || 0))
  );

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6,
                    color: "#8A8778", fontWeight: 800, marginBottom: 8 }}>
        Onde o tempo foi embora
      </div>

      {ordenadas.map((l) => <CartaoEstacao key={l.setor} l={l} />)}

      <div style={{ fontSize: 12.5, color: "#8A8778", lineHeight: 1.7, marginTop: 12 }}>
        <b style={{ color: "#22231F" }}>Como ler:</b> a barra é o caminho de um item.
        A parte clara é o tempo que ele ficou parado na fila; a verde é a estação
        trabalhando de fato. Barra com muito cinza ou vermelho é problema de{" "}
        <b style={{ color: "#22231F" }}>gente e ordem de acionar</b>. Barra verde e
        comprida é problema de <b style={{ color: "#22231F" }}>processo da estação</b>.
        São dois remédios diferentes.
      </div>

      <details style={{ marginTop: 14, borderTop: "1px solid #E8E2D2", paddingTop: 12 }}>
        <summary style={{ fontSize: 11, color: "#8A8778", cursor: "pointer", fontWeight: 800,
                          textTransform: "uppercase", letterSpacing: 0.5 }}>
          Ver os números crus
        </summary>
        <div style={{ ...cardStyle, marginTop: 10, padding: 0, overflow: "hidden" }}>
          <table style={tabela}>
            <thead>
              <tr>
                <th style={th}>Estação</th>
                <th style={{ ...th, textAlign: "right" }}>Itens</th>
                <th style={{ ...th, textAlign: "right" }}>Produção</th>
                <th style={{ ...th, textAlign: "right" }}>P90</th>
                <th style={{ ...th, textAlign: "right" }}>Fila</th>
                <th style={{ ...th, textAlign: "right" }}>Segurou</th>
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((l) => (
                <tr key={l.setor}>
                  <td style={td}><b>{l.label || l.setor}</b></td>
                  <td style={{ ...td, textAlign: "right" }}>{l.itens}</td>
                  <td style={{ ...td, textAlign: "right" }}>{min1(l.producao_media)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{min1(l.producao_p90)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{min1(l.fila_media)}</td>
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
          <b>Produção</b> é do "peguei" ao "terminei" — a estação em si.
          <b> Fila</b> é o tempo antes de alguém pegar, que é falta de gente, não da estação.
          <b> P90</b> é o pior 1 em cada 10: média boa com P90 alto quer dizer que
          às vezes trava feio, e é desse "às vezes" que o cliente reclama.
          <b> Segurou</b> é quantas vezes aquela estação foi a última a terminar —
          é essa coluna que decide onde entra gente. Tudo em minutos.
        </div>
      </details>
    </div>
  );
}

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
