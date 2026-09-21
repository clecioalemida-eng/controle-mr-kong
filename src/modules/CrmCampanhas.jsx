import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2, AlertTriangle, CheckCircle2, Sparkles, Save, Send, Pause, Play, XCircle,
  ChevronLeft, Megaphone, Trash2, RefreshCw, CalendarClock,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { podeEditar } from "../lib/permissoes";

// ---------------------------------------------------------------------------
// CRM › Campanhas (fase 3)
//
// Caminho de uma campanha:
//   1. rascunho — escolhe o segmento, o agente escreve o texto, salva
//   2. manda o texto para a Meta aprovar (promoção só sai com modelo aprovado)
//   3. testa no próprio celular
//   4. aprova vendo o custo → o banco espalha os envios na janela de horário
//   5. o robô (a cada minuto) manda aos poucos; a tela mostra o resultado
//
// Banco: migração 123. Envio e modelos: Edge Function crm-campanhas.
// Regra fixa: só recebe quem ACEITOU mensagens; no máximo 1 campanha por
// cliente por semana; funcionário fica de fora.
// ---------------------------------------------------------------------------

// Ofertas combinadas com o Clecio (19/09/2026). Brinde só com compra, prazo
// curto e cupom do CardápioWeb (para medir). Os cupons precisam existir no
// CardápioWeb e a oferta precisa estar em "Treinar o agente", senão o agente
// não sabe explicar quando o cliente perguntar.
const SEGMENTOS = [
  { chave: "novo", nome: "Novos", desc: "fizeram 1 pedido", fundo: "#E4ECF7", cor: "#244C7A",
    ideia: "2º pedido com batata",
    texto: "Oi, {nome}! Curtiu o Mr. Kong? 🐒 Seu segundo pedido ganha *batata M de presente* até sábado, com o cupom VOLTEI." },
  { chave: "em_risco", nome: "Em risco", desc: "3 a 8 semanas sem pedir", fundo: "#FBE3DC", cor: "#8A2E1F",
    ideia: "Saudade: refri 2L",
    texto: "Oi, {nome}! Faz tempo que o {favorito} não sai daqui pra você 🐒 Até quinta, pedido acima de R$ 50 leva *refri 2L de presente* com o cupom SAUDADE." },
  { chave: "aniversario_mes", nome: "Aniversariantes", desc: "fazem aniversário este mês", fundo: "#F3E6F7", cor: "#6A2C7A",
    ideia: "Lanche do aniversariante",
    texto: "Oi, {nome}! A selva inteira sabe que esse mês é seu aniversário 🎉 Na semana do seu dia, comprando um lanche *o seu sai de presente* com o cupom NIVER." },
  { chave: "recorrente", nome: "Recorrentes", desc: "pedem sempre", fundo: "#E0EFE3", cor: "#1F5134",
    ideia: "Pontos em dobro",
    texto: "Oi, {nome}! Essa semana todo pedido vale *pontos em dobro* no Mr. Kong 🦍 Junta mais um pouco e o próximo {favorito} sai por conta dos pontos." },
  { chave: "vip", nome: "VIP", desc: "os que mais gastam", fundo: "#FBEFC4", cor: "#6B4E00",
    ideia: "Clube da Selva",
    texto: "Oi, {nome}! Você está no *Clube da Selva*, os clientes mais fiéis do Mr. Kong 🦍 No seu próximo pedido até domingo vai um mimo surpresa, por nossa conta." },
  { chave: "perdido", nome: "Perdidos", desc: "mais de 2 meses sem pedir", fundo: "#ECEAE3", cor: "#4A574D",
    ideia: "Última chamada: Sagui",
    texto: "Oi, {nome}! O Mr. Kong mudou: agora é só hambúrguer, e tá caprichado 🍔 Pra você voltar, qualquer pedido ganha *um Sagui de presente* até domingo com o cupom REI." },
  { chave: "cadastro", nome: "Só cadastro", desc: "cadastrados sem pedido recente", fundo: "#F1ECE0", cor: "#6B6758",
    ideia: "Primeiro pedido: entrega grátis",
    texto: "Oi, {nome}! Você tem cadastro no Mr. Kong e ainda não provou nosso hambúrguer 🍔 De terça a sexta, pedindo até as 22h, *a entrega é grátis*. Bora?" },
  { chave: "sem_aniversario", nome: "Sem aniversário", desc: "ainda não sabemos a data", fundo: "#FDEBD8", cor: "#8A4B12",
    ideia: "Conta seu aniversário",
    texto: "Oi, {nome}! Queremos comemorar seu aniversário com você 🎂 Responde aqui com o dia e o mês (ex.: 15/03) e no seu mês tem *Sagui de presente* no Mr. Kong." },
];
const SEG = Object.fromEntries(SEGMENTOS.map((s) => [s.chave, s]));

const STATUS = {
  rascunho: { nome: "Rascunho", fundo: "#ECEAE3", cor: "#4A574D" },
  agendada: { nome: "Agendada", fundo: "#E4ECF7", cor: "#244C7A" },
  enviando: { nome: "Enviando", fundo: "#E0EFE3", cor: "#1F5134" },
  pausada: { nome: "Pausada", fundo: "#FBEFC4", cor: "#6B4E00" },
  concluida: { nome: "Concluída", fundo: "#E0EFE3", cor: "#1F5134" },
  cancelada: { nome: "Cancelada", fundo: "#FBE3DC", cor: "#8A2E1F" },
};
const MODELO = {
  nao_enviado: { nome: "Ainda não mandada para a Meta", cor: "#8A8778" },
  pendente: { nome: "Esperando a Meta aprovar", cor: "#6B4E00" },
  aprovado: { nome: "Aprovada pela Meta", cor: "#1F5134" },
  rejeitado: { nome: "Recusada pela Meta", cor: "#C4432B" },
};

const brl = (v) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (v) => (Number(v) || 0).toLocaleString("pt-BR");

function amanha() {
  const d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function exemplo(texto) {
  return String(texto || "").replace(/\{nome\}/g, "Ana").replace(/\{favorito\}/g, "Orangotango");
}

async function lerErroDaFuncao(error) {
  let msg = error?.message || "Erro ao falar com o servidor.";
  try {
    if (error?.context && typeof error.context.json === "function") {
      const corpo = await error.context.json();
      if (corpo?.error) msg = corpo.error;
    }
  } catch { /* fica a genérica */ }
  if (/Failed to send|not found|404/i.test(msg)) msg = "A função crm-campanhas ainda não foi criada no Supabase.";
  return msg;
}

async function chamar(body) {
  const { data, error } = await supabase.functions.invoke("crm-campanhas", { body });
  if (error) return { error: await lerErroDaFuncao(error) };
  if (data?.error) return { error: data.error };
  return data;
}

function faltaMigracao(msg) {
  return /does not exist|não existe|schema cache|Could not find/i.test(msg || "");
}

// ===========================================================================
export default function CrmCampanhas({ permissoes }) {
  const editar = podeEditar(permissoes, "crm");
  const [segs, setSegs] = useState(null);
  const [lista, setLista] = useState([]);
  const [resumo, setResumo] = useState(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [tela, setTela] = useState({ tipo: "lista" }); // lista | editor | detalhe

  const carregar = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      supabase.rpc("crm_segmentos_campanha"),
      supabase.rpc("crm_campanhas_lista"),
      supabase.rpc("crm_resumo"),
    ]);
    setCarregando(false);
    const e = a.error || b.error || c.error;
    if (e) {
      setErro(faltaMigracao(e.message) ? "As campanhas ainda não foram instaladas no banco: falta rodar a migração 123." : e.message);
      return;
    }
    setErro("");
    setSegs(a.data || {});
    setLista(b.data || []);
    setResumo(c.data || {});
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // enquanto tem campanha andando, atualiza sozinho a cada 30s
  useEffect(() => {
    if (!lista.some((c) => ["agendada", "enviando"].includes(c.status) || c.modelo_status === "pendente")) return;
    const t = setInterval(carregar, 30000);
    return () => clearInterval(t);
  }, [lista, carregar]);

  if (carregando) return <div style={carregandoStyle}><Loader2 size={16} /> Carregando campanhas…</div>;
  if (erro && !segs) return <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0 }} /><div>{erro}</div></div>;

  if (tela.tipo === "editor") {
    return (
      <Editor inicial={tela.campanha} editar={editar}
        onVoltar={() => setTela(tela.campanha?.id ? { tipo: "detalhe", id: tela.campanha.id } : { tipo: "lista" })}
        onSalvo={async (id) => { await carregar(); setTela({ tipo: "detalhe", id }); }} />
    );
  }
  if (tela.tipo === "detalhe") {
    const c = lista.find((x) => x.id === tela.id);
    if (!c) return <div style={carregandoStyle}><Loader2 size={16} /> Carregando…</div>;
    return (
      <Detalhe c={c} editar={editar} recarregar={carregar}
        onVoltar={() => setTela({ tipo: "lista" })}
        onEditar={() => setTela({ tipo: "editor", campanha: c })}
        onExcluido={async () => { await carregar(); setTela({ tipo: "lista" }); }} />
    );
  }

  const r = resumo || {};
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ ...avisoStyle, display: "block" }}>
        <b>Campanha só vai para quem aceitou receber.</b> Hoje: <b>{num(r.aceitam)} de {num(r.total)}</b>.
        {" "}O agente pergunta no fim de cada conversa boa. Para crescer mais rápido: QR code no balcão e na
        embalagem (“Quer as promoções da semana? Manda OI”). Mandar para quem não aceitou é o que faz a Meta
        bloquear o número.
      </div>

      <div>
        <div style={sectionLabel}>Montar campanha por segmento</div>
        <div style={gridCards}>
          {SEGMENTOS.map((s) => {
            const n = segs?.[s.chave] || {};
            return (
              <div key={s.chave} style={{ ...cardStyle, display: "grid", gap: 8 }}>
                <span style={{ ...pill, background: s.fundo, color: s.cor, justifySelf: "start" }}>{s.nome}</span>
                <div style={{ fontSize: 12, color: "#8A8778" }}>{s.desc}</div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <span style={{ fontSize: 20, fontWeight: 800, color: "#22231F" }}>{num(n.aceitam)}</span>
                  <span style={{ fontSize: 12, color: "#8A8778" }}>podem receber · {num(n.total)} no segmento</span>
                </div>
                {editar && (
                  <button style={btnSecondary}
                    onClick={() => setTela({ tipo: "editor", campanha: {
                      nome: `${s.ideia} · ${s.nome}`, segmentos: [s.chave], texto: s.texto, filtros: {},
                      botao_cardapio: true, dia: amanha(), hora_inicio: "17:30", hora_fim: "20:00",
                    } })}>
                    <Megaphone size={14} /> Montar
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
          <div style={{ ...sectionLabel, marginBottom: 0, flex: 1 }}>Campanhas</div>
          <button style={btnGhost} onClick={carregar}><RefreshCw size={13} /> Atualizar</button>
        </div>
        {lista.length === 0 ? (
          <div style={{ ...cardStyle, textAlign: "center", color: "#8A8778", fontSize: 13 }}>
            Nenhuma campanha ainda. Escolha um segmento acima e toque em “Montar”.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {lista.map((c) => <LinhaCampanha key={c.id} c={c} onAbrir={() => setTela({ tipo: "detalhe", id: c.id })} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function LinhaCampanha({ c, onAbrir }) {
  const st = STATUS[c.status] || STATUS.rascunho;
  const total = Number(c.total) || 0;
  const feitos = total - (Number(c.pendentes) || 0);
  return (
    <button onClick={onAbrir} style={{ ...cardStyle, cursor: "pointer", display: "grid", gap: 6, width: "100%",
      textAlign: "left", font: "inherit", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 14, color: "#22231F", flex: 1 }}>{c.nome}</span>
        <span style={{ ...pill, background: st.fundo, color: st.cor }}>{st.nome}</span>
      </div>
      <div style={{ fontSize: 12, color: "#8A8778" }}>
        {(c.segmentos || []).map((s) => SEG[s]?.nome || s).join(", ")}
        {c.status === "rascunho"
          ? ` · ${MODELO[c.modelo_status]?.nome || ""}`
          : ` · ${num(c.enviados)} enviadas de ${num(total)} · ${num(c.pediram)} pediram · ${brl(c.receita)} em pedidos`}
      </div>
      {["agendada", "enviando", "pausada"].includes(c.status) && total > 0 && (
        <div style={barra}><i style={{ ...barraCheia, width: `${Math.round((feitos / total) * 100)}%` }} /></div>
      )}
    </button>
  );
}

// ===========================================================================
// Editor (rascunho)
// ===========================================================================
function Editor({ inicial, editar, onVoltar, onSalvo }) {
  const [c, setC] = useState(() => ({
    nome: "", segmentos: [], texto: "", filtros: {}, botao_cardapio: true,
    dia: amanha(), ...inicial,
    hora_inicio: String(inicial?.hora_inicio || "17:30").slice(0, 5),
    hora_fim: String(inicial?.hora_fim || "20:00").slice(0, 5),
  }));
  const [publico, setPublico] = useState(null);
  const [ideia, setIdeia] = useState("");
  const [escrevendo, setEscrevendo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [bairros, setBairros] = useState((inicial?.filtros?.bairros || []).join(", "));

  const filtros = useMemo(() => {
    const f = {};
    const b = bairros.split(",").map((x) => x.trim()).filter(Boolean);
    if (b.length) f.bairros = b;
    if (c.filtros?.favorito) f.favorito = c.filtros.favorito;
    if (c.filtros?.canal) f.canal = c.filtros.canal;
    return f;
  }, [bairros, c.filtros]);

  useEffect(() => {
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc("crm_campanha_publico", { p_segmentos: c.segmentos, p_filtros: filtros });
      setPublico(data || null);
    }, 350);
    return () => clearTimeout(t);
  }, [c.segmentos, filtros]);

  const alternarSeg = (k) =>
    setC((x) => ({ ...x, segmentos: x.segmentos.includes(k) ? x.segmentos.filter((s) => s !== k) : [...x.segmentos, k] }));

  const escrever = async () => {
    setEscrevendo(true);
    setErro("");
    const r = await chamar({ acao: "escrever", segmentos: c.segmentos, ideia, texto_atual: c.texto });
    setEscrevendo(false);
    if (r.error) { setErro(r.error); return; }
    setC((x) => ({ ...x, texto: r.texto }));
    if (r.problema) setErro(r.problema);
  };

  const salvar = async () => {
    if (!c.nome.trim()) { setErro("Dê um nome para a campanha."); return; }
    if (!c.segmentos.length) { setErro("Escolha pelo menos um segmento."); return; }
    if (!c.texto.trim()) { setErro("Escreva a mensagem."); return; }
    setSalvando(true);
    setErro("");
    const mudouMensagem = inicial?.id && (inicial.texto !== c.texto || inicial.botao_cardapio !== c.botao_cardapio);
    const dados = {
      nome: c.nome.trim(), segmentos: c.segmentos, filtros, texto: c.texto.trim(),
      botao_cardapio: c.botao_cardapio, dia: c.dia || null, hora_inicio: c.hora_inicio, hora_fim: c.hora_fim,
      ...(mudouMensagem ? { modelo_status: "nao_enviado", modelo_nome: null, modelo_motivo: null } : {}),
    };
    const q = inicial?.id
      ? supabase.from("crm_campanhas").update(dados).eq("id", inicial.id).select("id").single()
      : supabase.from("crm_campanhas").insert(dados).select("id").single();
    const { data, error } = await q;
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo(data.id);
  };

  const elegiveis = Number(publico?.elegiveis) || 0;
  const custoUnit = Number(publico?.custo_unit) || 0.33;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={onVoltar} style={iconBtn} aria-label="Voltar"><ChevronLeft size={18} /></button>
        <div style={{ fontWeight: 800, fontSize: 16, color: "#22231F" }}>{inicial?.id ? "Editar campanha" : "Nova campanha"}</div>
      </div>

      <div style={cardStyle}>
        <label style={rotulo}>Nome (só vocês veem)</label>
        <input value={c.nome} onChange={(e) => setC({ ...c, nome: e.target.value })} style={inputStyle} disabled={!editar} />

        <div style={{ ...rotulo, marginTop: 14 }}>Público</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {SEGMENTOS.map((s) => (
            <button key={s.chave} onClick={() => alternarSeg(s.chave)} disabled={!editar}
              style={{ ...chip, ...(c.segmentos.includes(s.chave) ? chipOn : {}) }}>{s.nome}</button>
          ))}
        </div>

        <div style={{ ...rotulo, marginTop: 14 }}>Filtrar mais (opcional)</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
          <input placeholder="Bairros, separados por vírgula" value={bairros} onChange={(e) => setBairros(e.target.value)} style={inputStyle} disabled={!editar} />
          <input placeholder="Favorito contém… (ex.: Orangotango)" value={c.filtros?.favorito || ""}
            onChange={(e) => setC({ ...c, filtros: { ...c.filtros, favorito: e.target.value } })} style={inputStyle} disabled={!editar} />
          <select value={c.filtros?.canal || ""} onChange={(e) => setC({ ...c, filtros: { ...c.filtros, canal: e.target.value } })} style={inputStyle} disabled={!editar}>
            <option value="">Qualquer canal</option>
            <option value="catalog">Pede pelo cardápio digital</option>
            <option value="ifood">Pede pelo iFood</option>
            <option value="whatsapp">Pede pelo WhatsApp</option>
            <option value="pdv">Pede no balcão</option>
          </select>
        </div>

        <div style={{ ...contaStyle, marginTop: 12 }}>
          {publico ? (
            <>
              <b>{num(elegiveis)}</b> vão receber · {num(publico.no_segmento)} no público,
              {" "}{num(publico.aceitam)} aceitam mensagens
              {Number(publico.recentes) > 0 && `, ${num(publico.recentes)} já receberam campanha nesta semana`}
              <span style={{ marginLeft: "auto", fontWeight: 800 }}>{brl(elegiveis * custoUnit)}</span>
            </>
          ) : <span>Contando…</span>}
        </div>
      </div>

      <div style={gridCards}>
        <div style={cardStyle}>
          <div style={rotulo}>Mensagem</div>
          <textarea value={c.texto} onChange={(e) => setC({ ...c, texto: e.target.value })} rows={5}
            style={{ ...inputStyle, resize: "vertical", lineHeight: 1.45 }} disabled={!editar} />
          <div style={{ fontSize: 12, color: "#8A8778", marginTop: 4 }}>
            Use {"{nome}"} e {"{favorito}"}: trocam sozinhos para cada cliente. Não comece nem termine com eles (regra da Meta).
          </div>
          {editar && (
            <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
              <input placeholder="Ideia para o agente (opcional): ex. batata M na terça" value={ideia}
                onChange={(e) => setIdeia(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
              <button onClick={escrever} disabled={escrevendo} style={btnSecondary}>
                {escrevendo ? <Loader2 size={14} /> : <Sparkles size={14} />} {c.texto ? "Reescrever com o agente" : "Escrever com o agente"}
              </button>
            </div>
          )}
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginTop: 12, color: "#22231F" }}>
            <input type="checkbox" checked={c.botao_cardapio} onChange={(e) => setC({ ...c, botao_cardapio: e.target.checked })} disabled={!editar} />
            Botão “Ver cardápio” (usa o link da tela Treinar o agente)
          </label>
        </div>

        <div style={cardStyle}>
          <div style={rotulo}>Como o cliente vê</div>
          <Previa texto={c.texto} botao={c.botao_cardapio} />
        </div>
      </div>

      <div style={cardStyle}>
        <div style={rotulo}>Quando sai</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8 }}>
          <label style={miniRotulo}>Dia<input type="date" value={c.dia || ""} onChange={(e) => setC({ ...c, dia: e.target.value })} style={inputStyle} disabled={!editar} /></label>
          <label style={miniRotulo}>Das<input type="time" value={c.hora_inicio} onChange={(e) => setC({ ...c, hora_inicio: e.target.value })} style={inputStyle} disabled={!editar} /></label>
          <label style={miniRotulo}>Até<input type="time" value={c.hora_fim} onChange={(e) => setC({ ...c, hora_fim: e.target.value })} style={inputStyle} disabled={!editar} /></label>
        </div>
        <div style={{ fontSize: 12, color: "#8A8778", marginTop: 8 }}>
          As mensagens saem espalhadas nesse horário, em ordem aleatória, no máximo 3 por minuto somando todas as
          campanhas (e 200 por dia). O que não couber sai no dia seguinte, no mesmo horário.
        </div>
      </div>

      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0 }} /><div>{erro}</div></div>}

      {editar && (
        <button onClick={salvar} disabled={salvando} style={btnPrimary}>
          {salvando ? <Loader2 size={15} /> : <Save size={15} />} Salvar rascunho
        </button>
      )}
    </div>
  );
}

function Previa({ texto, botao }) {
  const partes = exemplo(texto).split(/(\*[^*\n]+\*)/g);
  return (
    <div style={{ background: "#EFE7DC", borderRadius: 12, padding: 14 }}>
      <div style={{ background: "#FFFFFF", borderRadius: 10, padding: "10px 12px", maxWidth: 340, fontSize: 13.5, color: "#22231F", whiteSpace: "pre-wrap" }}>
        {texto
          ? partes.map((p, i) => (/^\*[^*]+\*$/.test(p) ? <b key={i}>{p.slice(1, -1)}</b> : <span key={i}>{p}</span>))
          : <span style={{ color: "#8A8778" }}>A mensagem aparece aqui.</span>}
        {botao && <span style={botaoWa}>↗ Ver cardápio</span>}
        <span style={botaoWa}>↩ Não quero mais promoções</span>
      </div>
      <div style={{ fontSize: 11, color: "#8A8778", marginTop: 6 }}>Exemplo com a cliente “Ana”, favorito “Orangotango”.</div>
    </div>
  );
}

// ===========================================================================
// Detalhe: aprovação da Meta, teste, agendar, acompanhar, resultado
// ===========================================================================
function Detalhe({ c, editar, recarregar, onVoltar, onEditar, onExcluido }) {
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [telTeste, setTelTeste] = useState("");
  const [publico, setPublico] = useState(null);

  const st = STATUS[c.status] || STATUS.rascunho;
  const md = MODELO[c.modelo_status] || MODELO.nao_enviado;
  const rascunho = c.status === "rascunho";

  useEffect(() => {
    if (!rascunho) return;
    supabase.rpc("crm_campanha_publico", { p_segmentos: c.segmentos, p_filtros: c.filtros || {} })
      .then(({ data }) => setPublico(data || null));
  }, [rascunho, c.segmentos, c.filtros]);

  const acao = async (nome, fn) => {
    setOcupado(nome); setErro(""); setOk("");
    try { await fn(); } catch (e) { setErro(String(e?.message || e)); }
    setOcupado("");
  };

  const mandarParaMeta = () => acao("meta", async () => {
    const r = await chamar({ acao: "enviar_modelo", campanha_id: c.id });
    if (r.error) throw new Error(r.error);
    setOk(r.modelo_status === "aprovado" ? "A Meta já aprovou!" : "Mandada. A Meta costuma responder em minutos (às vezes algumas horas). A tela confere sozinha.");
    await recarregar();
  });
  const conferirMeta = () => acao("conferir", async () => {
    const r = await chamar({ acao: "status_modelo", campanha_id: c.id });
    if (r.error) throw new Error(r.error);
    await recarregar();
  });
  const testar = () => acao("teste", async () => {
    const r = await chamar({ acao: "teste", campanha_id: c.id, telefone: telTeste });
    if (r.error) throw new Error(r.error);
    setOk("Teste enviado. Confira no WhatsApp desse número.");
  });
  const agendar = () => acao("agendar", async () => {
    const n = Number(publico?.elegiveis) || 0;
    const custo = n * (Number(publico?.custo_unit) || 0.33);
    if (!window.confirm(`Aprovar e agendar para ${num(n)} clientes?\n\nCusto estimado na Meta: ${brl(custo)}.\n\nAs mensagens saem em ${new Date(`${c.dia}T12:00:00`).toLocaleDateString("pt-BR")} entre ${String(c.hora_inicio).slice(0, 5)} e ${String(c.hora_fim).slice(0, 5)}.`)) return;
    const { data, error } = await supabase.rpc("crm_campanha_agendar", { p_campanha: c.id });
    if (error) throw new Error(error.message);
    setOk(`Agendada para ${num(data.publico)} clientes · ${brl(data.custo)}.`);
    await recarregar();
  });
  const mudar = (a) => acao(a, async () => {
    if (a === "cancelar" && !window.confirm("Cancelar o que ainda não foi enviado?")) return;
    if (a === "excluir" && !window.confirm("Excluir este rascunho?")) return;
    const { error } = await supabase.rpc("crm_campanha_mudar", { p_campanha: c.id, p_acao: a });
    if (error) throw new Error(error.message);
    if (a === "excluir") { onExcluido(); return; }
    await recarregar();
  });

  const total = Number(c.total) || 0;
  const feitos = total - (Number(c.pendentes) || 0);
  const gasto = (Number(c.enviados) || 0) * (Number(c.custo_unit) || 0);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={onVoltar} style={iconBtn} aria-label="Voltar"><ChevronLeft size={18} /></button>
        <div style={{ fontWeight: 800, fontSize: 16, color: "#22231F", flex: 1 }}>{c.nome}</div>
        <span style={{ ...pill, background: st.fundo, color: st.cor }}>{st.nome}</span>
      </div>

      <div style={gridCards}>
        <div style={cardStyle}>
          <div style={rotulo}>Mensagem</div>
          <Previa texto={c.texto} botao={c.botao_cardapio} />
          <div style={{ fontSize: 12, color: "#8A8778", marginTop: 8 }}>
            Público: {(c.segmentos || []).map((s) => SEG[s]?.nome || s).join(", ")}
            {c.filtros?.bairros?.length ? ` · bairros: ${c.filtros.bairros.join(", ")}` : ""}
            {c.filtros?.favorito ? ` · favorito: ${c.filtros.favorito}` : ""}
            {c.dia ? ` · ${new Date(`${c.dia}T12:00:00`).toLocaleDateString("pt-BR")}, ${String(c.hora_inicio).slice(0, 5)} às ${String(c.hora_fim).slice(0, 5)}` : ""}
          </div>
          {rascunho && editar && (
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <button onClick={onEditar} style={btnSecondary}>Editar</button>
              <button onClick={() => mudar("excluir")} style={btnGhost}><Trash2 size={13} /> Excluir</button>
            </div>
          )}
        </div>

        {rascunho ? (
          <div style={{ ...cardStyle, display: "grid", gap: 14, alignContent: "start" }}>
            <Passo n="1" titulo="Aprovação da Meta" feito={c.modelo_status === "aprovado"}>
              <div style={{ fontSize: 13, fontWeight: 600, color: md.cor }}>{md.nome}</div>
              {c.modelo_status === "rejeitado" && (
                <div style={{ fontSize: 12, color: "#8A8778" }}>
                  Motivo: {c.modelo_motivo || "não informado"}. Edite o texto (sem promessa exagerada, sem começar/terminar com variável) e mande de novo.
                </div>
              )}
              {editar && ["nao_enviado", "rejeitado"].includes(c.modelo_status) && (
                <button onClick={mandarParaMeta} disabled={!!ocupado} style={btnSecondary}>
                  {ocupado === "meta" ? <Loader2 size={14} /> : <Send size={14} />} Mandar para a Meta aprovar
                </button>
              )}
              {c.modelo_status === "pendente" && (
                <button onClick={conferirMeta} disabled={!!ocupado} style={btnSecondary}>
                  {ocupado === "conferir" ? <Loader2 size={14} /> : <RefreshCw size={14} />} Ver se já aprovou
                </button>
              )}
            </Passo>

            <Passo n="2" titulo="Testar no seu celular" feito={false} opcional>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <input placeholder="64 99999-0000" value={telTeste} onChange={(e) => setTelTeste(e.target.value)}
                  style={{ ...inputStyle, flex: 1, minWidth: 140 }} disabled={c.modelo_status !== "aprovado"} />
                <button onClick={testar} disabled={!!ocupado || c.modelo_status !== "aprovado"} style={btnSecondary}>
                  {ocupado === "teste" ? <Loader2 size={14} /> : <Send size={14} />} Mandar teste
                </button>
              </div>
              <div style={{ fontSize: 12, color: "#8A8778" }}>Libera depois da aprovação da Meta. Custa 1 mensagem.</div>
            </Passo>

            <Passo n="3" titulo="Aprovar e agendar" feito={false}>
              <div style={contaStyle}>
                {publico
                  ? <><span>{num(publico.elegiveis)} clientes × {brl(publico.custo_unit)}</span><b style={{ marginLeft: "auto" }}>{brl((Number(publico.elegiveis) || 0) * (Number(publico.custo_unit) || 0))}</b></>
                  : <span>Contando…</span>}
              </div>
              {editar && (
                <button onClick={agendar} disabled={!!ocupado || c.modelo_status !== "aprovado" || !(Number(publico?.elegiveis) > 0)} style={btnPrimary}>
                  {ocupado === "agendar" ? <Loader2 size={15} /> : <CalendarClock size={15} />} Aprovar e agendar
                </button>
              )}
              {publico && Number(publico.elegiveis) === 0 && (
                <div style={{ fontSize: 12, color: "#C4432B" }}>Ninguém desse público aceitou receber mensagens ainda.</div>
              )}
            </Passo>
          </div>
        ) : (
          <div style={{ ...cardStyle, display: "grid", gap: 10, alignContent: "start" }}>
            <div style={rotulo}>Andamento</div>
            <div style={barra}><i style={{ ...barraCheia, width: `${total ? Math.round((feitos / total) * 100) : 0}%` }} /></div>
            <div style={{ fontSize: 13, color: "#22231F" }}>
              {num(feitos)} de {num(total)} processadas
              {c.proximo && ["agendada", "enviando"].includes(c.status) &&
                ` · próxima ${new Date(c.proximo).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`}
            </div>
            {editar && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["agendada", "enviando"].includes(c.status) && (
                  <button onClick={() => mudar("pausar")} disabled={!!ocupado} style={btnSecondary}><Pause size={14} /> Pausar</button>
                )}
                {c.status === "pausada" && (
                  <button onClick={() => mudar("retomar")} disabled={!!ocupado} style={btnSecondary}><Play size={14} /> Retomar</button>
                )}
                {["agendada", "enviando", "pausada"].includes(c.status) && (
                  <button onClick={() => mudar("cancelar")} disabled={!!ocupado} style={btnGhost}><XCircle size={14} /> Cancelar o resto</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0 }} /><div>{erro}</div></div>}
      {ok && <div style={okStyle}><CheckCircle2 size={15} style={{ flexShrink: 0 }} /> {ok}</div>}

      {!rascunho && (
        <>
          <div style={gridCards}>
            <div style={cardStyle}><div style={statNum}>{brl(gasto)}</div><div style={statLabel}>gasto na Meta (estimado)</div></div>
            <div style={cardStyle}>
              <div style={{ ...statNum, color: "#1F5134" }}>{brl(c.receita)}</div>
              <div style={statLabel}>em pedidos de quem recebeu, até 7 dias depois · {num(c.pediram)} clientes</div>
            </div>
          </div>
          <div style={cardStyle}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {[
                  ["Enviadas", c.enviados], ["Entregues", c.entregues], ["Lidas", c.lidos],
                  ["Responderam", c.responderam], ["Pediram em 7 dias", c.pediram],
                  ["Pediram para sair", c.sairam], ["Falharam", c.falhas],
                ].map(([rot, v]) => (
                  <tr key={rot}>
                    <td style={td}>{rot}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{num(v)}</td>
                    <td style={{ ...td, textAlign: "right", color: "#8A8778", width: 60 }}>
                      {Number(c.enviados) ? `${Math.round((Number(v) / Number(c.enviados)) * 100)}%` : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 12, color: "#8A8778", marginTop: 8 }}>
              Pedidos entram no CRM na atualização da madrugada. “Responderam” = mandaram mensagem em até 3 dias.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Passo({ n, titulo, feito, opcional, children }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 22, height: 22, borderRadius: 99, display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontSize: 12, fontWeight: 800, background: feito ? "#1F5134" : "#22231F", color: "#F3EFE3" }}>
          {feito ? "✓" : n}
        </span>
        <span style={{ fontWeight: 700, fontSize: 14, color: "#22231F" }}>{titulo}</span>
        {opcional && <span style={{ fontSize: 11, color: "#8A8778" }}>opcional</span>}
      </div>
      <div style={{ display: "grid", gap: 6, paddingLeft: 30 }}>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estilos (mesma paleta do painel)
// ---------------------------------------------------------------------------
const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const gridCards = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 10 };
const sectionLabel = { fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778", marginBottom: 6 };
const rotulo = { fontSize: 12, fontWeight: 700, color: "#8A8778", marginBottom: 6, display: "block" };
const miniRotulo = { fontSize: 12, fontWeight: 600, color: "#8A8778", display: "grid", gap: 4 };
const pill = { fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "2px 8px" };
const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 8, border: "1px solid #E8E2D2",
  fontSize: 14, background: "#FFFFFF", color: "#22231F", fontFamily: "inherit",
};
const btnPrimary = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#1F5134", color: "#FFFFFF",
  border: "none", borderRadius: 10, padding: "12px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer",
};
const btnSecondary = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 6, background: "#FFFFFF", color: "#22231F",
  border: "1px solid #E8E2D2", borderRadius: 8, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer",
};
const btnGhost = { ...btnSecondary, border: "none", background: "transparent", color: "#8A8778" };
const iconBtn = {
  width: 34, height: 34, borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#22231F",
};
const chip = {
  padding: "6px 11px", borderRadius: 999, borderWidth: 1, borderStyle: "solid", borderColor: "#E8E2D2",
  background: "#FFFFFF", color: "#22231F", fontSize: 12, fontWeight: 600, cursor: "pointer",
};
const chipOn = { background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" };
const contaStyle = {
  display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", background: "#FCFAF5",
  border: "1px solid #EFE9DA", borderRadius: 8, padding: "10px 12px", fontSize: 13, color: "#22231F",
};
const avisoStyle = {
  display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A",
  color: "#7A6A1E", borderRadius: 10, padding: 14, fontSize: 13, lineHeight: 1.5,
};
const okStyle = {
  display: "flex", gap: 8, alignItems: "center", background: "#E8F3EC", border: "1px solid #B9DCC6",
  color: "#1F5134", borderRadius: 10, padding: "10px 12px", fontSize: 13,
};
const carregandoStyle = { display: "flex", alignItems: "center", gap: 8, color: "#8A8778", fontSize: 13, padding: 12 };
const barra = { height: 8, borderRadius: 99, background: "#EFE9DA", overflow: "hidden" };
const barraCheia = { display: "block", height: "100%", background: "#1F5134" };
const botaoWa = {
  display: "block", textAlign: "center", borderTop: "1px solid #EFE9DA", marginTop: 8, paddingTop: 8,
  color: "#1E88E5", fontWeight: 600, fontSize: 13,
};
const statNum = { fontSize: 22, fontWeight: 800, color: "#22231F" };
const statLabel = { fontSize: 12, color: "#8A8778", marginTop: 2 };
const td = { padding: "8px 4px", borderBottom: "1px solid #EFE9DA" };
