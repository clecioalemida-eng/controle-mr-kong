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
      if (guardada && lista.some((x) => x.chave === guardada)) {
        setSetorAberto(guardada);
      } else if (guardada) {
        gravarEstacaoFixada(null);
        setFixada(null);
      }
    })();
    return () => { vivo = false; };
  }, []);

  if (setorAberto) {
    const s = setores.find((x) => x.chave === setorAberto);
    return (
      <Estacao
        setor={setorAberto}
        label={s?.label || setorAberto}
        setores={setores}
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
        <Agora setores={setores} aoAbrirSetor={setSetorAberto} />
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
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    setErro("");
    const [{ data: r, error: e1 }, { data: itens, error: e2 }] = await Promise.all([
      supabase.rpc("desempenho_agora"),
      supabase.from("producao_itens")
        .select("setor, pedido_id, pego_em")
        .is("pronto_em", null),
    ]);
    if (e1) setErro(e1.message);
    if (e2) setErro(e2.message);
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
          const info = porSetor[s.chave] || { pedidos: 0, pegos: 0 };
          return (
            <button key={s.chave} onClick={() => aoAbrirSetor(s.chave)}
              style={{ ...linha, cursor: "pointer", textAlign: "left" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{s.label}</div>
                <div style={{ fontSize: 11.5, color: "#8A8778" }}>
                  {info.pedidos === 0
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
// ESTAÇÃO — a tela de quem produz
// =====================================================================
function Estacao({ setor, label, setores, fixada, semMemoria, onFixar, onTrocar, onVoltar }) {
  // Trocar de estacao num tablet fixado tem que ser deliberado. Num
  // aparelho de cozinha, com mao suja e pressa, um toque errado no chip
  // manda a chapa pro bar — e a fila da chapa some da vista no meio do
  // sabado. Por isso, fixado, os chips ficam atras de um segundo toque.
  const [trocando, setTrocando] = useState(false);
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
// HOJE — como cada estação foi
// =====================================================================
function Hoje() {
  const [linhas, setLinhas] = useState([]);
  const [espera, setEspera] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const dia = hojeISO();

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [{ data: est, error: e1 }, { data: esp, error: e2 }] = await Promise.all([
        supabase.rpc("desempenho_estacoes", { p_inicio: dia, p_fim: dia }),
        supabase.rpc("espera_montagem", { p_inicio: dia, p_fim: dia }),
      ]);
      if (!vivo) return;
      if (e1) setErro(e1.message);
      if (e2) setErro(e2.message);
      setLinhas(est || []);
      setEspera(Array.isArray(esp) ? esp[0] : esp);
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
          <div style={{ ...cardStyle, marginBottom: 12, padding: 0, overflow: "hidden" }}>
            <table style={tabela}>
              <thead>
                <tr>
                  <th style={th}>Estação</th>
                  <th style={{ ...th, textAlign: "right" }}>Produção</th>
                  <th style={{ ...th, textAlign: "right" }}>P90</th>
                  <th style={{ ...th, textAlign: "right" }}>Fila</th>
                  <th style={{ ...th, textAlign: "right" }}>Segurou</th>
                </tr>
              </thead>
              <tbody>
                {comDado.map((l) => (
                  <tr key={l.setor}>
                    <td style={td}><b>{l.label}</b><div style={{ fontSize: 11, color: "#8A8778" }}>{l.itens} itens</div></td>
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

          <div style={{ fontSize: 11.5, color: "#8A8778", marginBottom: 16, lineHeight: 1.6 }}>
            <b>Produção</b> é do "peguei" ao "terminei" — a estação em si.
            <b> Fila</b> é o tempo antes de alguém pegar, que é falta de gente, não da estação.
            <b> P90</b> é o pior 1 em cada 10: média boa com P90 alto quer dizer que
            às vezes trava feio, e é desse "às vezes" que o cliente reclama.
            <b> Segurou</b> é quantas vezes aquela estação foi a última a terminar —
            é essa coluna que decide onde entra gente.
          </div>

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
        </>
      )}
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
