import React, { useState, useEffect, useCallback } from "react";
import {
  ChevronLeft, Loader2, AlertTriangle, RefreshCw, Search, Users, Megaphone,
  MessageCircle, ChevronDown, ChevronUp, CheckCircle2, XCircle, Phone, GraduationCap, Download,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { podeEditar } from "../lib/permissoes";
import CrmAtendimento from "./CrmAtendimento";
import CrmAgente from "./CrmAgente";

// ---------------------------------------------------------------------------
// Módulo CRM
//
// Clientes (fase 1): a base é montada no banco (migração 120) a partir do
// pedidos_cache, todo dia às 04h30. Só leitura, fora o aceite de mensagens.
// O cadastro inteiro do CardápioWeb entra pelo botão "Trazer do
// CardápioWeb" (migração 122 + Edge Function crm-importar-clientes).
//
// Atendimento e Treinar o agente (fase 2): o agente no WhatsApp (migração 121
// + Edge Function whatsapp-agente). Ficam em CrmAtendimento.jsx e CrmAgente.jsx.
//
// Campanhas entram na fase 3.
// ---------------------------------------------------------------------------

const ABAS = [
  { chave: "atendimento", label: "Atendimento", icone: MessageCircle },
  { chave: "clientes", label: "Clientes", icone: Users },
  { chave: "agente", label: "Treinar o agente", icone: GraduationCap },
  { chave: "campanhas", label: "Campanhas", icone: Megaphone },
];

const SEGMENTOS = {
  novo:       { nome: "Novo",       fundo: "#E4ECF7", cor: "#244C7A" },
  recorrente: { nome: "Recorrente", fundo: "#E0EFE3", cor: "#1F5134" },
  vip:        { nome: "VIP",        fundo: "#FBEFC4", cor: "#6B4E00" },
  em_risco:   { nome: "Em risco",   fundo: "#FBE3DC", cor: "#8A2E1F" },
  perdido:    { nome: "Perdido",    fundo: "#ECEAE3", cor: "#4A574D" },
  cadastro:   { nome: "Cadastro",   fundo: "#F1ECE0", cor: "#6B6758" },
};

const FILTROS = [
  { chave: "todos", label: "Todos" },
  { chave: "novo", label: "Novos" },
  { chave: "recorrente", label: "Recorrentes" },
  { chave: "vip", label: "VIP" },
  { chave: "em_risco", label: "Em risco" },
  { chave: "perdido", label: "Perdidos" },
  { chave: "cadastro", label: "Só cadastro" },
  { chave: "sem_optin", label: "Sem resposta de mensagens" },
];

const NOMES_CANAL = {
  catalog: "Cardápio digital", portal: "Portal", ifood: "iFood", food99: "99Food",
  pdv: "Balcão", whatsapp: "WhatsApp", app: "Aplicativo",
};

const POR_PAGINA = 50;

const brl = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// Mesmo corte do banco: pedido até as 5h conta para o dia anterior.
function diaOperacionalHoje() {
  const agoraSP = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  agoraSP.setHours(agoraSP.getHours() - 5);
  return agoraSP.toISOString().slice(0, 10);
}

function diasDesde(dia) {
  if (!dia) return null;
  const a = new Date(`${diaOperacionalHoje()}T12:00:00`);
  const b = new Date(`${dia}T12:00:00`);
  return Math.round((a - b) / 86400000);
}

function textoDias(n) {
  if (n == null) return "—";
  if (n <= 0) return "hoje";
  if (n === 1) return "ontem";
  return `há ${n} dias`;
}

function formataTelefone(t) {
  const d = String(t || "");
  const local = d.startsWith("55") ? d.slice(2) : d;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return `+${d}`;
}

function iniciais(nome) {
  const partes = String(nome || "?").trim().split(/\s+/);
  return ((partes[0]?.[0] || "") + (partes.length > 1 ? partes[partes.length - 1][0] : "")).toUpperCase() || "?";
}

function faltaMigracao(msg) {
  return /does not exist|não existe|schema cache|Could not find/i.test(msg || "");
}

export default function Crm({ onVoltar, permissoes }) {
  // Abre no Atendimento: é a tela que a atendente usa o tempo todo.
  const [aba, setAba] = useState("atendimento");

  return (
    <div style={pageStyle}>
      <div className="app-shell">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <button onClick={onVoltar} style={iconBtn} aria-label="Voltar"><ChevronLeft size={18} /></button>
          <div style={{ fontWeight: 800, fontSize: 17, color: "#22231F" }}>CRM</div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {ABAS.map((a) => {
            const Icone = a.icone;
            return (
              <button key={a.chave} onClick={() => setAba(a.chave)}
                style={{ ...tabBtn, ...(aba === a.chave ? tabBtnAtivo : {}) }}>
                <Icone size={14} /> {a.label}
              </button>
            );
          })}
        </div>

        {aba === "clientes" && <AbaClientes permissoes={permissoes} />}
        {aba === "campanhas" && (
          <EmBreve titulo="Campanhas"
            texto="O agente monta a campanha, vocês aprovam vendo o custo antes, e o envio sai compassado pelo WhatsApp. Entra na fase 3." />
        )}
        {aba === "atendimento" && <CrmAtendimento permissoes={permissoes} />}
        {aba === "agente" && <CrmAgente permissoes={permissoes} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aba Clientes
// ---------------------------------------------------------------------------
function AbaClientes({ permissoes }) {
  const editar = podeEditar(permissoes, "crm");
  const [resumo, setResumo] = useState(null);
  const [lista, setLista] = useState([]);
  const [temMais, setTemMais] = useState(false);
  const [filtro, setFiltro] = useState("todos");
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [erro, setErro] = useState("");
  const [atualizando, setAtualizando] = useState(false);
  const [avisoAtualizacao, setAvisoAtualizacao] = useState("");
  const [aberto, setAberto] = useState(null);

  // Espera a pessoa parar de digitar antes de consultar.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);

  const carregarResumo = useCallback(async () => {
    const { data, error } = await supabase.rpc("crm_resumo");
    if (error) {
      setErro(faltaMigracao(error.message)
        ? "A base de clientes ainda não foi instalada no banco — falta rodar a migração 120."
        : error.message);
      return;
    }
    setResumo(data);
  }, []);

  const montarConsulta = useCallback((de) => {
    let q = supabase
      .from("clientes")
      .select("id, telefone, nome, bairro, pedidos, total_gasto, ticket_medio, ultimo_dia, intervalo_medio_dias, favorito, canal_preferido, segmento, aceita_mensagens, consentimento_em, consentimento_origem, email, aniversario, cw_cadastro_em, cw_pontos, cw_cashback")
      .order("ultimo_dia", { ascending: false, nullsFirst: false })
      .order("pedidos", { ascending: false })
      .range(de, de + POR_PAGINA - 1);

    if (filtro === "sem_optin") q = q.is("aceita_mensagens", null);
    else if (filtro !== "todos") q = q.eq("segmento", filtro);

    if (buscaAplicada) {
      // Vírgula e parêntese quebram o filtro "or" do Supabase.
      const texto = buscaAplicada.replace(/[,()*%"\\]/g, " ").replace(/\s+/g, " ").trim();
      const digitos = buscaAplicada.replace(/\D/g, "");
      const partes = [];
      if (texto) partes.push(`nome.ilike."*${texto}*"`);
      if (digitos.length >= 3) partes.push(`telefone.ilike.*${digitos}*`);
      if (partes.length) q = q.or(partes.join(","));
    }
    return q;
  }, [filtro, buscaAplicada]);

  const carregarLista = useCallback(async () => {
    setCarregando(true);
    setAberto(null);
    const { data, error } = await montarConsulta(0);
    setCarregando(false);
    if (error) {
      setErro(faltaMigracao(error.message)
        ? "A base de clientes ainda não foi instalada no banco — falta rodar a migração 120."
        : error.message);
      return;
    }
    setErro("");
    setLista(data || []);
    setTemMais((data || []).length === POR_PAGINA);
  }, [montarConsulta]);

  const carregarMais = async () => {
    setCarregandoMais(true);
    const { data, error } = await montarConsulta(lista.length);
    setCarregandoMais(false);
    if (error) { setErro(error.message); return; }
    setLista((l) => [...l, ...(data || [])]);
    setTemMais((data || []).length === POR_PAGINA);
  };

  useEffect(() => { carregarResumo(); }, [carregarResumo]);
  useEffect(() => { carregarLista(); }, [carregarLista]);

  const atualizarAgora = async () => {
    setAtualizando(true);
    setAvisoAtualizacao("");
    const { data, error } = await supabase.rpc("crm_atualizar_base");
    setAtualizando(false);
    if (error) { setAvisoAtualizacao(error.message); return; }
    const novos = data?.clientes_novos_nesta_rodada || 0;
    setAvisoAtualizacao(
      `Base atualizada: ${data?.clientes ?? 0} clientes` +
      (novos ? `, ${novos} novos.` : ", nenhum novo.") +
      " Os pedidos de hoje entram depois que o cache da madrugada roda."
    );
    carregarResumo();
    carregarLista();
  };

  const marcarConsentimento = async (cliente, aceita) => {
    const { error } = await supabase.rpc("crm_definir_consentimento", {
      p_cliente: cliente.id, p_aceita: aceita, p_origem: "painel",
    });
    if (error) { setErro(error.message); return; }
    setLista((l) => l.map((c) => (c.id === cliente.id
      ? { ...c, aceita_mensagens: aceita, consentimento_em: new Date().toISOString(), consentimento_origem: "painel" }
      : c)));
    carregarResumo();
  };

  if (erro && !resumo && !lista.length) {
    return (
      <div style={avisoStyle}>
        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <div>{erro}</div>
      </div>
    );
  }

  const r = resumo || {};
  const pctAtivos = r.total ? Math.round((r.ativos_30d / r.total) * 100) : 0;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* ------------------------------------------------ números do topo */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        <Stat numero={r.total ?? "—"} rotulo="clientes na base"
          detalhe={r.novos_7d ? `+${r.novos_7d} nos últimos 7 dias` : null} corDetalhe="#2F8F5B" />
        <Stat numero={r.ativos_30d ?? "—"} rotulo="pediram nos últimos 30 dias"
          detalhe={r.total ? `${pctAtivos}% da base` : null} />
        <Stat numero={r.em_risco ?? "—"} rotulo="em risco (sumindo)" cor="#8A2E1F" fundo="#FFF4F1" borda="#F0CFC6"
          onClick={() => setFiltro("em_risco")} />
        <Stat numero={r.aceitam ?? "—"} rotulo="aceitam receber mensagens"
          detalhe={r.nao_perguntados != null ? `${r.nao_perguntados} ainda não perguntados` : null} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, color: "#8A8778" }}>
        <span style={{ flex: 1, minWidth: 180 }}>
          {r.atualizado_em
            ? `Atualizada em ${new Date(r.atualizado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · roda sozinha às 04h30`
            : "Ainda não atualizada"}
        </span>
        {editar && (
          <button onClick={atualizarAgora} disabled={atualizando} style={btnSecondary}>
            {atualizando ? <Loader2 size={14} /> : <RefreshCw size={14} />}
            {atualizando ? "Atualizando…" : "Atualizar agora"}
          </button>
        )}
      </div>
      {avisoAtualizacao && <div style={{ ...okStyle }}>{avisoAtualizacao}</div>}

      {editar && (
        <ImportarCardapioWeb jaImportados={r.do_cardapioweb}
          onTerminou={() => { carregarResumo(); carregarLista(); }} />
      )}
      {erro && (resumo || lista.length) ? <div style={avisoStyle}><AlertTriangle size={16} />{erro}</div> : null}

      {/* ------------------------------------------------ busca e filtros */}
      <label style={buscaStyle}>
        <Search size={15} color="#8A8778" />
        <input value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar nome ou telefone" aria-label="Buscar cliente"
          style={{ border: 0, outline: 0, background: "transparent", fontSize: 14, flex: 1, color: "#22231F" }} />
      </label>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {FILTROS.map((f) => (
          <button key={f.chave} onClick={() => setFiltro(f.chave)}
            style={{ ...chipBtn, ...(filtro === f.chave ? chipBtnAtivo : {}) }}>
            {f.label}
            {contagemFiltro(r, f.chave) != null && (
              <span style={{ opacity: 0.7, marginLeft: 5 }}>{contagemFiltro(r, f.chave)}</span>
            )}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------ lista */}
      {carregando ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#8A8778", fontSize: 13, padding: 12 }}>
          <Loader2 size={16} /> Carregando clientes…
        </div>
      ) : lista.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", color: "#8A8778", fontSize: 13 }}>
          {r.total === 0
            ? "A base está vazia. Se o cache de pedidos já tem histórico, toque em “Atualizar agora”."
            : "Nenhum cliente com esse filtro."}
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {lista.map((c) => (
            <CartaoCliente key={c.id} c={c} aberto={aberto === c.id} editar={editar}
              onAlternar={() => setAberto(aberto === c.id ? null : c.id)}
              onConsentimento={(v) => marcarConsentimento(c, v)} />
          ))}
          {temMais && (
            <button onClick={carregarMais} disabled={carregandoMais} style={{ ...btnSecondary, justifyContent: "center" }}>
              {carregandoMais ? <Loader2 size={14} /> : null} Carregar mais
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function contagemFiltro(r, chave) {
  if (!r || r.total == null) return null;
  return {
    todos: r.total, novo: r.novos, recorrente: r.recorrentes, vip: r.vip,
    em_risco: r.em_risco, perdido: r.perdidos, cadastro: r.cadastro, sem_optin: r.nao_perguntados,
  }[chave];
}

// ---------------------------------------------------------------------------
// Um cliente
// ---------------------------------------------------------------------------
function CartaoCliente({ c, aberto, editar, onAlternar, onConsentimento }) {
  const seg = SEGMENTOS[c.segmento] || SEGMENTOS.novo;
  const dias = diasDesde(c.ultimo_dia);
  const sumindo = c.segmento === "em_risco" || c.segmento === "perdido";

  return (
    <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
      <button onClick={onAlternar} aria-expanded={aberto}
        style={{ all: "unset", cursor: "pointer", display: "flex", gap: 12, padding: 12, width: "100%", boxSizing: "border-box", alignItems: "center" }}>
        <div style={{ width: 38, height: 38, borderRadius: 999, background: seg.fundo, color: seg.cor, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13, flexShrink: 0 }}>
          {iniciais(c.nome)}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "#22231F" }}>{c.nome || "Sem nome"}</span>
            <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "2px 8px", background: seg.fundo, color: seg.cor }}>{seg.nome}</span>
          </div>
          <div style={{ fontSize: 12, color: "#8A8778", marginTop: 2 }}>
            {c.pedidos > 0 ? (
              <>
                {c.pedidos} {c.pedidos === 1 ? "pedido" : "pedidos"} · {brl(c.ticket_medio)} de ticket ·{" "}
                <span style={sumindo ? { color: "#8A2E1F", fontWeight: 600 } : undefined}>{textoDias(dias)}</span>
              </>
            ) : (
              <>
                {c.cw_cadastro_em
                  ? `Cadastrado no CardápioWeb em ${new Date(c.cw_cadastro_em).toLocaleDateString("pt-BR", { month: "short", year: "numeric" })}`
                  : "Cadastrado no CardápioWeb"}
                {" "}· sem pedido no histórico
              </>
            )}
          </div>
          {c.favorito && <div style={{ fontSize: 12, color: "#22231F", marginTop: 2 }}>Favorito: {c.favorito}</div>}
        </div>
        {aberto ? <ChevronUp size={16} color="#8A8778" /> : <ChevronDown size={16} color="#8A8778" />}
      </button>

      {aberto && <DetalheCliente c={c} editar={editar} onConsentimento={onConsentimento} />}
    </div>
  );
}

function DetalheCliente({ c, editar, onConsentimento }) {
  const [pedidos, setPedidos] = useState(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    supabase
      .from("pedidos_cliente")
      .select("pedido_id, display_id, criado_em, total, canal, tipo, itens")
      .eq("cliente_id", c.id)
      .order("criado_em", { ascending: false })
      .limit(5)
      .then(({ data }) => { if (vivo) setPedidos(data || []); });
    return () => { vivo = false; };
  }, [c.id]);

  const marcar = async (v) => {
    setSalvando(true);
    await onConsentimento(v);
    setSalvando(false);
  };

  const consentimento =
    c.aceita_mensagens === true ? { txt: "Aceita receber mensagens", cor: "#2F8F5B", Icone: CheckCircle2 } :
    c.aceita_mensagens === false ? { txt: "Não quer receber mensagens", cor: "#C4432B", Icone: XCircle } :
    { txt: "Ainda não perguntado", cor: "#8A8778", Icone: MessageCircle };

  return (
    <div style={{ borderTop: "1px solid #EFE9DA", padding: 12, display: "grid", gap: 12, background: "#FCFAF5" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8, fontSize: 12 }}>
        <Info rotulo="Telefone" valor={formataTelefone(c.telefone)} />
        <Info rotulo="Bairro" valor={c.bairro || "—"} />
        <Info rotulo="Total gasto" valor={brl(c.total_gasto)} />
        <Info rotulo="Volta a cada" valor={c.intervalo_medio_dias ? `${Number(c.intervalo_medio_dias).toLocaleString("pt-BR")} dias` : "—"} />
        <Info rotulo="Pede mais pelo" valor={NOMES_CANAL[c.canal_preferido] || c.canal_preferido || "—"} />
        <Info rotulo="Último pedido" valor={c.ultimo_dia ? new Date(`${c.ultimo_dia}T12:00:00`).toLocaleDateString("pt-BR") : "—"} />
        <Info rotulo="Aniversário" valor={c.aniversario ? new Date(`${c.aniversario}T12:00:00`).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" }) : "—"} />
        <Info rotulo="Cliente desde" valor={c.cw_cadastro_em ? new Date(c.cw_cadastro_em).toLocaleDateString("pt-BR") : "—"} />
        {c.email && <Info rotulo="E-mail" valor={c.email} />}
        {(c.cw_pontos > 0 || Number(c.cw_cashback) > 0) && (
          <Info rotulo="Fidelidade" valor={[c.cw_pontos > 0 ? `${c.cw_pontos} pontos` : null, Number(c.cw_cashback) > 0 ? `${brl(c.cw_cashback)} de cashback` : null].filter(Boolean).join(" · ")} />
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <consentimento.Icone size={15} color={consentimento.cor} />
        <span style={{ fontSize: 13, fontWeight: 600, color: consentimento.cor, flex: 1 }}>
          {consentimento.txt}
          {c.consentimento_em && (
            <span style={{ fontWeight: 400, color: "#8A8778" }}>
              {" "}· {new Date(c.consentimento_em).toLocaleDateString("pt-BR")}{c.consentimento_origem ? ` (${c.consentimento_origem})` : ""}
            </span>
          )}
        </span>
        {editar && (
          <div style={{ display: "flex", gap: 6 }}>
            <button disabled={salvando || c.aceita_mensagens === true} onClick={() => marcar(true)} style={btnMini}>Aceita</button>
            <button disabled={salvando || c.aceita_mensagens === false} onClick={() => marcar(false)} style={btnMini}>Não aceita</button>
          </div>
        )}
      </div>

      <div>
        <div style={sectionLabel}>Últimos pedidos</div>
        {pedidos == null ? (
          <div style={{ fontSize: 12, color: "#8A8778" }}><Loader2 size={13} /> carregando…</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {pedidos.map((p) => (
              <div key={p.pedido_id} style={{ display: "flex", gap: 10, fontSize: 12, alignItems: "baseline" }}>
                <span style={{ color: "#8A8778", width: 74, flexShrink: 0 }}>
                  {new Date(p.criado_em).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" })}
                </span>
                <span style={{ flex: 1, color: "#22231F" }}>
                  {(p.itens || []).map((i) => `${Number(i.qtd) > 1 ? `${Number(i.qtd)}× ` : ""}${i.nome}`).join(", ") || "—"}
                </span>
                <span style={{ fontWeight: 700, color: "#22231F" }}>{brl(p.total)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <a href={`https://wa.me/${c.telefone}`} target="_blank" rel="noreferrer" style={waBtn}>
        <Phone size={14} /> Abrir conversa no WhatsApp
      </a>
    </div>
  );
}

function Info({ rotulo, valor }) {
  return (
    <div>
      <div style={{ color: "#8A8778" }}>{rotulo}</div>
      <div style={{ color: "#22231F", fontWeight: 600, marginTop: 1 }}>{valor}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trazer o cadastro do CardápioWeb
//
// A Edge Function busca 1.000 clientes por chamada e diz em que página
// parou; aqui a gente chama de novo até acabar, mostrando o andamento.
// Pode fechar no meio: rodar de novo não duplica ninguém (a chave é o
// telefone), só completa.
// ---------------------------------------------------------------------------
function ImportarCardapioWeb({ jaImportados, onTerminou }) {
  const [rodando, setRodando] = useState(false);
  const [andamento, setAndamento] = useState(null);
  const [erro, setErro] = useState("");
  const [fim, setFim] = useState(null);

  const lerErro = async (error) => {
    let msg = error.message || "Erro ao falar com o CardápioWeb.";
    try {
      if (error.context && typeof error.context.json === "function") {
        const corpo = await error.context.json();
        if (corpo?.error) msg = corpo.error + (corpo.detalhe ? ` — ${corpo.detalhe}` : "");
      }
    } catch (_) { /* fica a mensagem genérica */ }
    if (/Failed to send|not found|404/i.test(msg)) {
      msg = "A função crm-importar-clientes ainda não foi criada no Supabase.";
    }
    return msg;
  };

  const importar = async () => {
    setRodando(true);
    setErro("");
    setFim(null);
    const soma = { recebidos: 0, novos: 0, atualizados: 0, sem_telefone: 0 };
    let pagina = 1;
    let totalPaginas = null;
    let totalClientes = null;

    for (let voltas = 0; voltas < 200; voltas++) {
      setAndamento({ pagina, totalPaginas, totalClientes, ...soma });
      const { data, error } = await supabase.functions.invoke("crm-importar-clientes", { body: { pagina } });
      if (error || data?.error) {
        setErro(error ? await lerErro(error) : data.error + (data.detalhe ? ` — ${data.detalhe}` : ""));
        break;
      }
      soma.recebidos += data.recebidos || 0;
      soma.novos += data.novos || 0;
      soma.atualizados += data.atualizados || 0;
      soma.sem_telefone += data.sem_telefone || 0;
      totalPaginas = data.total_paginas ?? totalPaginas;
      totalClientes = data.total_clientes ?? totalClientes;

      if (data.terminou) { setFim({ ...soma, totalClientes }); break; }
      if (data.esperar_segundos) {
        setAndamento({ pagina: data.proxima_pagina, totalPaginas, totalClientes, ...soma, esperando: true });
        await new Promise((r) => setTimeout(r, data.esperar_segundos * 1000));
      }
      pagina = data.proxima_pagina;
    }

    setRodando(false);
    setAndamento(null);
    onTerminou();
  };

  const pct = andamento?.totalPaginas
    ? Math.min(100, Math.round(((andamento.pagina - 1) / andamento.totalPaginas) * 100))
    : 0;

  return (
    <div style={{ ...cardStyle, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#22231F" }}>Cadastro do CardápioWeb</div>
          <div style={{ fontSize: 12, color: "#8A8778", marginTop: 2, lineHeight: 1.4 }}>
            {jaImportados
              ? `${Number(jaImportados).toLocaleString("pt-BR")} clientes já vieram de lá. Rodar de novo só completa, não duplica.`
              : "Traz todos os clientes cadastrados, com aniversário, e-mail, pontos e cashback."}
          </div>
        </div>
        <button onClick={importar} disabled={rodando} style={btnSecondary}>
          {rodando ? <Loader2 size={14} /> : <Download size={14} />}
          {rodando ? "Trazendo…" : jaImportados ? "Trazer de novo" : "Trazer do CardápioWeb"}
        </button>
      </div>

      {andamento && (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ height: 8, borderRadius: 999, background: "#EFE9DA", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "#1F5134", transition: "width .4s" }} />
          </div>
          <div style={{ fontSize: 12, color: "#8A8778" }}>
            {andamento.esperando
              ? "O CardápioWeb pediu uma pausa. Continua sozinho em 1 minuto…"
              : andamento.totalPaginas
                ? `${pct}% · ${andamento.recebidos.toLocaleString("pt-BR")} de ${Number(andamento.totalClientes || 0).toLocaleString("pt-BR")} clientes lidos · ${andamento.novos.toLocaleString("pt-BR")} novos na base`
                : "Conectando no CardápioWeb…"}
            {" "}Deixe esta tela aberta até terminar.
          </div>
        </div>
      )}

      {fim && (
        <div style={okStyle}>
          Pronto: {fim.recebidos.toLocaleString("pt-BR")} clientes lidos. {fim.novos.toLocaleString("pt-BR")} entraram na base
          e {fim.atualizados.toLocaleString("pt-BR")} que já estavam foram completados
          {fim.sem_telefone ? ` · ${fim.sem_telefone.toLocaleString("pt-BR")} sem telefone ficaram de fora` : ""}.
          Ninguém foi marcado como "aceita mensagens": isso só muda quando a pessoa responder no WhatsApp.
        </div>
      )}
      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div>{erro}</div></div>}
    </div>
  );
}

function Stat({ numero, rotulo, detalhe, cor, fundo, borda, corDetalhe, onClick }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick}
      style={{ ...statBox, background: fundo || "#FFFFFF", borderColor: borda || "#E8E2D2", cursor: onClick ? "pointer" : "default", font: "inherit" }}>
      <div style={{ ...statNum, color: cor || "#22231F" }}>{numero}</div>
      <div style={{ ...statLabel, color: cor || "#8A8778" }}>{rotulo}</div>
      {detalhe && <div style={{ fontSize: 11, marginTop: 4, fontWeight: 600, color: corDetalhe || "#8A8778" }}>{detalhe}</div>}
    </Tag>
  );
}

function EmBreve({ titulo, texto }) {
  return (
    <div style={{ ...cardStyle, textAlign: "center", padding: "28px 16px" }}>
      <div style={{ fontWeight: 700, fontSize: 15, color: "#22231F", marginBottom: 6 }}>{titulo} · em breve</div>
      <div style={{ fontSize: 13, color: "#8A8778", maxWidth: 360, margin: "0 auto", lineHeight: 1.5 }}>{texto}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estilos (mesma paleta do resto do painel)
// ---------------------------------------------------------------------------
const pageStyle = {
  fontFamily: "'Inter', system-ui, sans-serif",
  background: "#F6F1E7",
  padding: 20,
  minHeight: "100vh",
  boxSizing: "border-box",
};
const iconBtn = {
  width: 34, height: 34, borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#22231F",
};
const cardStyle = {
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14,
};
const btnSecondary = {
  display: "flex", alignItems: "center", gap: 6,
  background: "#FFFFFF", color: "#22231F", border: "1px solid #E8E2D2",
  borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
};
const btnMini = {
  background: "#FFFFFF", color: "#22231F", border: "1px solid #E8E2D2",
  borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer",
};
const waBtn = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  background: "#1F5134", color: "#FFFFFF", borderRadius: 8, padding: "10px 12px",
  fontSize: 13, fontWeight: 700, textDecoration: "none",
};
const tabBtn = {
  display: "flex", alignItems: "center", gap: 6,
  padding: "8px 14px", borderRadius: 999, borderWidth: 1, borderStyle: "solid", borderColor: "#E8E2D2",
  background: "#FFFFFF", color: "#8A8778", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const tabBtnAtivo = { background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" };
const chipBtn = {
  padding: "6px 11px", borderRadius: 999, borderWidth: 1, borderStyle: "solid", borderColor: "#E8E2D2",
  background: "#FFFFFF", color: "#22231F", fontSize: 12, fontWeight: 600, cursor: "pointer",
};
const chipBtnAtivo = { background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" };
const buscaStyle = {
  display: "flex", alignItems: "center", gap: 8, background: "#FFFFFF",
  border: "1px solid #E8E2D2", borderRadius: 10, padding: "10px 12px",
};
const avisoStyle = {
  display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A",
  color: "#7A6A1E", borderRadius: 10, padding: 14, fontSize: 13,
};
const okStyle = {
  background: "#E8F3EC", border: "1px solid #B9DCC6", color: "#1F5134",
  borderRadius: 10, padding: "10px 12px", fontSize: 12,
};
const statBox = {
  border: "1px solid #E8E2D2", borderRadius: 12, padding: "12px 14px", textAlign: "left",
};
const statNum = { fontSize: 22, fontWeight: 800 };
const statLabel = { fontSize: 12, marginTop: 2, lineHeight: 1.3 };
const sectionLabel = {
  fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
  color: "#8A8778", marginBottom: 6,
};
