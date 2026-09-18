import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2, AlertTriangle, ChevronLeft, Send, Bell, BellOff, Bot, UserRound, CheckCircle2,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { podeEditar } from "../lib/permissoes";

// ---------------------------------------------------------------------------
// CRM › Atendimento
//
// As conversas do WhatsApp. O agente responde sozinho; quando ele passa uma
// conversa (reclamação, pergunta que não sabe, pedido grande...), ela cai em
// "Para você" com aviso sonoro. A atendente responde por aqui mesmo.
//
// Quem grava mensagem é a Edge Function whatsapp-agente. A tela lê as tabelas
// wa_conversas / wa_mensagens e recebe as novidades em tempo real.
// ---------------------------------------------------------------------------

const MOTIVOS = {
  reclamacao: "Reclamação",
  pedido_problema: "Problema no pedido",
  pediu_humano: "Pediu uma pessoa",
  nao_sabe: "Pergunta que o agente não sabe",
  pedido_grande: "Pedido grande",
  irritado: "Cliente irritado",
  status_pedido: "Onde está o pedido",
  outro: "Outro",
};

const JANELA_24H = 24 * 60 * 60 * 1000;

function horaCurta(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const hoje = new Date();
  if (d.toDateString() === hoje.toDateString()) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function minutosDesde(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function formataTelefone(t) {
  const d = String(t || "");
  const local = d.startsWith("55") ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return `+${d}`;
}

// Bipe curto sem arquivo de som: o navegador gera o tom.
function tocarAviso() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [0, 0.22].forEach((t) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    });
  } catch { /* sem som, sem problema */ }
}

function lerPreferenciaSom() {
  try { return localStorage.getItem("crm_aviso_som") !== "nao"; } catch { return true; }
}
function gravarPreferenciaSom(v) {
  try { localStorage.setItem("crm_aviso_som", v ? "sim" : "nao"); } catch { /* ignora */ }
}

async function lerErroDaFuncao(error) {
  let msg = error?.message || "Erro ao falar com o servidor.";
  try {
    if (error?.context && typeof error.context.json === "function") {
      const corpo = await error.context.json();
      if (corpo?.error) msg = corpo.error;
    }
  } catch { /* fica a genérica */ }
  return msg;
}

export default function CrmAtendimento({ permissoes }) {
  const editar = podeEditar(permissoes, "crm");
  const [conversas, setConversas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [filtro, setFiltro] = useState("para_voce");
  const [abertaId, setAbertaId] = useState(null);
  const [som, setSom] = useState(lerPreferenciaSom);
  const statusAnterior = useRef(new Map());
  const somRef = useRef(som);
  somRef.current = som;

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from("wa_conversas")
      .select("id, telefone, nome, status, motivo, resumo_passagem, passada_em, ultima_msg_em, ultima_msg_cliente_em, ultima_previa, nao_lidas, cliente_id")
      .order("ultima_msg_em", { ascending: false, nullsFirst: false })
      .limit(200);
    setCarregando(false);
    if (error) {
      setErro(/does not exist|schema cache|Could not find/i.test(error.message)
        ? "O atendimento ainda não foi instalado no banco — falta rodar a migração 121."
        : error.message);
      return;
    }
    setErro("");
    const lista = data || [];
    // bipe quando uma conversa acabou de ser passada para a atendente
    let novaParaVoce = false;
    lista.forEach((c) => {
      const antes = statusAnterior.current.get(c.id);
      if (c.status === "atendente" && antes !== undefined && antes !== "atendente") novaParaVoce = true;
      statusAnterior.current.set(c.id, c.status);
    });
    if (novaParaVoce && somRef.current) tocarAviso();
    setConversas(lista);
  }, []);

  useEffect(() => {
    carregar();
    const canal = supabase
      .channel("crm-conversas")
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_conversas" }, () => carregar())
      .subscribe();
    // rede do celular às vezes derruba o tempo real: recarrega de tempos em tempos
    const t = setInterval(carregar, 30000);
    return () => { supabase.removeChannel(canal); clearInterval(t); };
  }, [carregar]);

  const alternarSom = () => {
    const v = !som;
    setSom(v);
    gravarPreferenciaSom(v);
    if (v) tocarAviso();
  };

  if (abertaId) {
    const c = conversas.find((x) => x.id === abertaId);
    return <Conversa conversaInicial={c} id={abertaId} editar={editar} onVoltar={() => { setAbertaId(null); carregar(); }} />;
  }

  const paraVoce = conversas.filter((c) => c.status === "atendente");
  const comAgente = conversas.filter((c) => c.status === "agente");
  const lista = filtro === "para_voce" ? paraVoce : filtro === "agente" ? comAgente : conversas;
  const maisAntiga = paraVoce.length
    ? Math.max(...paraVoce.map((c) => minutosDesde(c.passada_em || c.ultima_msg_em) || 0))
    : null;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => setFiltro("para_voce")} style={{ ...chipBtn, ...(filtro === "para_voce" ? chipAmarelo : {}) }}>
          Para você · {paraVoce.length}
        </button>
        <button onClick={() => setFiltro("agente")} style={{ ...chipBtn, ...(filtro === "agente" ? chipAtivo : {}) }}>
          Com o agente · {comAgente.length}
        </button>
        <button onClick={() => setFiltro("todas")} style={{ ...chipBtn, ...(filtro === "todas" ? chipAtivo : {}) }}>
          Todas
        </button>
        <button onClick={alternarSom} style={{ ...chipBtn, marginLeft: "auto", display: "flex", alignItems: "center", gap: 5 }}
          aria-label={som ? "Desligar aviso com som" : "Ligar aviso com som"}>
          {som ? <Bell size={14} /> : <BellOff size={14} />} {som ? "Som ligado" : "Som desligado"}
        </button>
      </div>

      {paraVoce.length > 0 && (
        <div style={avisoAmarelo}>
          {paraVoce.length === 1 ? "1 cliente esperando você" : `${paraVoce.length} clientes esperando você`}
          {maisAntiga != null ? `. A mais antiga há ${maisAntiga} min.` : "."}
        </div>
      )}

      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0 }} />{erro}</div>}

      {carregando ? (
        <div style={{ color: "#8A8778", fontSize: 13, display: "flex", gap: 8, alignItems: "center" }}><Loader2 size={16} /> Carregando conversas…</div>
      ) : lista.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", color: "#8A8778", fontSize: 13 }}>
          {filtro === "para_voce"
            ? "Ninguém esperando. O agente está dando conta."
            : "Nenhuma conversa ainda. Assim que um cliente mandar mensagem no WhatsApp, ela aparece aqui."}
        </div>
      ) : (
        <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
          {lista.map((c) => <LinhaConversa key={c.id} c={c} onAbrir={() => setAbertaId(c.id)} />)}
        </div>
      )}
    </div>
  );
}

function LinhaConversa({ c, onAbrir }) {
  const comVoce = c.status === "atendente";
  const espera = comVoce ? minutosDesde(c.passada_em || c.ultima_msg_em) : null;
  const nome = c.nome || formataTelefone(c.telefone);
  const pill = comVoce
    ? { txt: `${MOTIVOS[c.motivo] || "Com a atendente"}${espera != null ? ` · ${espera} min` : ""}`, fundo: "#FBE3DC", cor: "#8A2E1F" }
    : { txt: "Com o agente", fundo: "#E0EFE3", cor: "#1F5134" };
  return (
    <button onClick={onAbrir}
      style={{ all: "unset", cursor: "pointer", display: "flex", gap: 12, padding: "12px 14px", borderBottom: "1px solid #EFE9DA", width: "100%", boxSizing: "border-box", background: comVoce ? "#FFFFFF" : "#FCFAF5" }}>
      <div style={{ width: 40, height: 40, borderRadius: 999, background: pill.fundo, color: pill.cor, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
        {(nome.match(/[A-Za-zÀ-ú]/g) || ["?"]).slice(0, 1).join("").toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: "#22231F" }}>{nome}</span>
          <span style={{ fontSize: 12, color: "#8A8778", flexShrink: 0 }}>{horaCurta(c.ultima_msg_em)}</span>
        </div>
        <div style={{ fontSize: 13, color: "#5E5C52", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 2 }}>
          {c.ultima_previa || "—"}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "3px 8px", background: pill.fundo, color: pill.cor }}>{pill.txt}</span>
          {c.nao_lidas > 0 && (
            <span style={{ fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "3px 7px", background: "#22231F", color: "#F3EFE3" }}>{c.nao_lidas}</span>
          )}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Uma conversa
// ---------------------------------------------------------------------------
function Conversa({ id, conversaInicial, editar, onVoltar }) {
  const [conversa, setConversa] = useState(conversaInicial || null);
  const [cliente, setCliente] = useState(null);
  const [mensagens, setMensagens] = useState(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [linkCardapio, setLinkCardapio] = useState("");
  const fimRef = useRef(null);

  const recarregarConversa = useCallback(async () => {
    const { data } = await supabase.from("wa_conversas").select("*").eq("id", id).maybeSingle();
    if (data) setConversa(data);
    return data;
  }, [id]);

  const recarregarMensagens = useCallback(async () => {
    const { data } = await supabase
      .from("wa_mensagens")
      .select("id, direcao, autor, texto, status, erro, criado_em")
      .eq("conversa_id", id)
      .order("criado_em", { ascending: true })
      .limit(300);
    setMensagens(data || []);
  }, [id]);

  useEffect(() => {
    recarregarConversa().then((c) => {
      const buscaCliente = c?.cliente_id
        ? supabase.from("clientes").select("nome, pedidos, favorito, segmento, ultimo_dia").eq("id", c.cliente_id).maybeSingle()
        : null;
      if (buscaCliente) buscaCliente.then(({ data }) => setCliente(data || null));
    });
    recarregarMensagens();
    supabase.rpc("crm_marcar_lida", { p_conversa: id });
    supabase.from("agente_config").select("link_cardapio").eq("id", 1).maybeSingle()
      .then(({ data }) => setLinkCardapio(data?.link_cardapio || ""));

    const canal = supabase
      .channel(`crm-conversa-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "wa_mensagens", filter: `conversa_id=eq.${id}` }, () => recarregarMensagens())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "wa_conversas", filter: `id=eq.${id}` }, () => recarregarConversa())
      .subscribe();
    const t = setInterval(() => { recarregarMensagens(); recarregarConversa(); }, 20000);
    return () => { supabase.removeChannel(canal); clearInterval(t); supabase.rpc("crm_marcar_lida", { p_conversa: id }); };
  }, [id, recarregarConversa, recarregarMensagens]);

  useEffect(() => { fimRef.current?.scrollIntoView({ block: "end" }); }, [mensagens]);

  const enviar = async (conteudo) => {
    const t = String(conteudo ?? texto).trim();
    if (!t) return;
    setEnviando(true);
    setErro("");
    const { data, error } = await supabase.functions.invoke("whatsapp-agente", {
      body: { acao: "enviar", conversa_id: id, texto: t },
    });
    setEnviando(false);
    if (error || data?.error) { setErro(error ? await lerErroDaFuncao(error) : data.error); return; }
    if (conteudo == null) setTexto("");
    recarregarMensagens();
    recarregarConversa();
  };

  const assumir = async () => {
    const { error } = await supabase.rpc("crm_assumir_conversa", { p_conversa: id });
    if (error) setErro(error.message); else { recarregarConversa(); recarregarMensagens(); }
  };

  const devolver = async () => {
    const { error } = await supabase.rpc("crm_devolver_conversa", { p_conversa: id });
    if (error) setErro(error.message); else onVoltar();
  };

  const comVoce = conversa?.status === "atendente";
  const janelaAberta = conversa?.ultima_msg_cliente_em
    && Date.now() - new Date(conversa.ultima_msg_cliente_em).getTime() < JANELA_24H;
  const nome = conversa?.nome || cliente?.nome || formataTelefone(conversa?.telefone);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={onVoltar} style={iconBtn} aria-label="Voltar para a lista"><ChevronLeft size={18} /></button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: "#22231F" }}>{nome}</div>
          <div style={{ fontSize: 12, color: "#8A8778" }}>
            {formataTelefone(conversa?.telefone)}
            {cliente ? ` · ${cliente.pedidos} pedidos${cliente.favorito ? ` · favorito ${cliente.favorito}` : ""}` : " · sem pedidos na base"}
          </div>
        </div>
      </div>

      {comVoce ? (
        <div style={{ ...faixa, background: "#FBE3DC", color: "#8A2E1F" }}>
          <UserRound size={15} style={{ flexShrink: 0 }} />
          <span>
            Com a atendente{conversa?.motivo ? ` · ${MOTIVOS[conversa.motivo] || conversa.motivo}` : ""}.
            {conversa?.resumo_passagem ? ` ${conversa.resumo_passagem}.` : ""} O agente está em silêncio nesta conversa.
          </span>
        </div>
      ) : (
        <div style={{ ...faixa, background: "#E0EFE3", color: "#1F5134" }}>
          <Bot size={15} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>O agente está respondendo este cliente.</span>
          {editar && <button onClick={assumir} style={btnMini}>Assumir</button>}
        </div>
      )}

      <div style={{ background: "#EFEADB", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 8, minHeight: 260, maxHeight: "55vh", overflowY: "auto" }}>
        {mensagens == null ? (
          <div style={{ color: "#8A8778", fontSize: 13 }}><Loader2 size={14} /> carregando…</div>
        ) : mensagens.length === 0 ? (
          <div style={{ color: "#8A8778", fontSize: 13 }}>Sem mensagens.</div>
        ) : mensagens.map((m) => <Balao key={m.id} m={m} />)}
        <div ref={fimRef} />
      </div>

      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0 }} />{erro}</div>}

      {editar && (
        janelaAberta ? (
          <>
            {linkCardapio && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button onClick={() => enviar(`Pede pelo nosso cardápio: ${linkCardapio}`)} disabled={enviando} style={chipBtn}>
                  Mandar link do cardápio
                </button>
              </div>
            )}
            <div style={{ display: "flex", gap: 8 }}>
              <label style={{ flex: 1, display: "flex", alignItems: "center", background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10, padding: "0 12px" }}>
                <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Responder como atendente"
                  aria-label="Mensagem para o cliente" onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && enviar()}
                  style={{ border: 0, outline: 0, background: "transparent", fontSize: 14, flex: 1, minHeight: 42, color: "#22231F" }} />
              </label>
              <button onClick={() => enviar()} disabled={enviando || !texto.trim()} style={{ ...btnPrimary, width: 46, padding: 0 }} aria-label="Enviar">
                {enviando ? <Loader2 size={16} /> : <Send size={16} />}
              </button>
            </div>
            {!comVoce && <div style={{ fontSize: 12, color: "#8A8778" }}>Se você escrever, a conversa passa para você e o agente fica em silêncio.</div>}
          </>
        ) : (
          <div style={{ ...cardStyle, fontSize: 13, color: "#5E5C52" }}>
            Faz mais de 24h que o cliente não escreve. Pelo WhatsApp oficial, só dá para mandar mensagem de novo
            com modelo pago. Quando ele chamar, a conversa abre de novo.
          </div>
        )
      )}

      {editar && comVoce && (
        <button onClick={devolver} style={{ ...btnSecondary, justifyContent: "center" }}>
          <CheckCircle2 size={15} /> Resolvido · devolver ao agente
        </button>
      )}
    </div>
  );
}

function Balao({ m }) {
  if (m.direcao === "interna") {
    return (
      <div style={{ alignSelf: "center", fontSize: 11.5, color: "#5E5C52", background: "#E3DDC9", borderRadius: 999, padding: "4px 10px", textAlign: "center", maxWidth: "90%" }}>
        {m.texto} · {horaCurta(m.criado_em)}
      </div>
    );
  }
  const doCliente = m.direcao === "entrada";
  const quem = doCliente ? "Cliente" : m.autor === "atendente" ? "Atendente" : "Agente";
  const fundo = doCliente ? "#FFFFFF" : m.autor === "atendente" ? "#C9E8BC" : "#DDF2D4";
  return (
    <div style={{
      alignSelf: doCliente ? "flex-start" : "flex-end", maxWidth: "85%", background: fundo,
      borderRadius: doCliente ? "12px 12px 12px 3px" : "12px 12px 3px 12px", padding: "7px 10px",
      fontSize: 14, color: "#22231F", lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word",
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: doCliente ? "#8A8778" : "#1F5134", marginBottom: 2 }}>
        {quem} · {horaCurta(m.criado_em)}
      </div>
      {m.texto}
      {m.status === "failed" && (
        <div style={{ fontSize: 11, color: "#C4432B", marginTop: 4 }}>Não enviada{m.erro ? `: ${m.erro}` : ""}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estilos (paleta do painel)
// ---------------------------------------------------------------------------
const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const iconBtn = {
  width: 34, height: 34, borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#22231F", flexShrink: 0,
};
const chipBtn = {
  padding: "7px 12px", borderRadius: 999, borderWidth: 1, borderStyle: "solid", borderColor: "#E8E2D2",
  background: "#FFFFFF", color: "#22231F", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
};
const chipAtivo = { background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" };
const chipAmarelo = { background: "#F2D742", color: "#231A18", borderColor: "#F2D742" };
const btnPrimary = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
  background: "#1F5134", color: "#FFFFFF", border: "none", borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: "pointer",
};
const btnSecondary = {
  display: "flex", alignItems: "center", gap: 6, background: "#FFFFFF", color: "#1F5134",
  border: "1px solid #1F5134", borderRadius: 10, padding: "11px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer",
};
const btnMini = {
  background: "#1F5134", color: "#FFFFFF", border: "none", borderRadius: 8,
  padding: "6px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
};
const faixa = { display: "flex", alignItems: "center", gap: 8, borderRadius: 10, padding: "9px 12px", fontSize: 12.5, fontWeight: 600 };
const avisoAmarelo = { background: "#FBF3D9", border: "1px solid #E8D48A", color: "#6B5A12", borderRadius: 10, padding: "10px 12px", fontSize: 13, fontWeight: 600 };
const avisoStyle = {
  display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A",
  color: "#7A6A1E", borderRadius: 10, padding: 12, fontSize: 13,
};
