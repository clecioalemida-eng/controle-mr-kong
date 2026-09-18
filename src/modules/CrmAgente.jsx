import React, { useState, useEffect, useCallback } from "react";
import {
  Loader2, AlertTriangle, CheckCircle2, XCircle, Plus, Trash2, Send, PlugZap, Save, Sparkles,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { podeEditar } from "../lib/permissoes";

// ---------------------------------------------------------------------------
// CRM › Treinar o agente
//
// Tudo que o agente sabe e como ele se comporta fica aqui, no banco
// (agente_config e agente_conhecimento). Mudou e salvou, a próxima conversa
// já usa — não precisa mexer em código nem publicar nada.
// ---------------------------------------------------------------------------

// Preços da IA (Claude Haiku 4.5, US$ por milhão de tokens) e dólar de
// referência para a estimativa. É estimativa: a conta real vem da Anthropic.
const PRECO_USD = { entrada: 1, saida: 5, cache_lido: 0.1, cache_gravado: 1.25 };
const DOLAR = 5.14;

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

export default function CrmAgente({ permissoes }) {
  const editar = podeEditar(permissoes, "crm");
  const [cfg, setCfg] = useState(null);
  const [saber, setSaber] = useState([]);
  const [sugestoes, setSugestoes] = useState([]);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    const [c, k, s] = await Promise.all([
      supabase.from("agente_config").select("*").eq("id", 1).maybeSingle(),
      supabase.from("agente_conhecimento").select("*").order("ordem").order("tema"),
      supabase.from("agente_sugestoes").select("*").eq("status", "pendente").order("criado_em", { ascending: false }),
    ]);
    setCarregando(false);
    const falha = c.error || k.error || s.error;
    if (falha) {
      setErro(/does not exist|schema cache|Could not find/i.test(falha.message)
        ? "O agente ainda não foi instalado no banco — falta rodar a migração 121."
        : falha.message);
      return;
    }
    setCfg(c.data);
    setSaber(k.data || []);
    setSugestoes(s.data || []);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando) return <div style={{ color: "#8A8778", fontSize: 13 }}><Loader2 size={16} /> Carregando…</div>;
  if (erro && !cfg) return <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0 }} />{erro}</div>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {!editar && (
        <div style={avisoStyle}>Seu cargo pode ver o treinamento, mas não mudar. Quem muda é quem tem o CRM em “editar”.</div>
      )}
      <StatusAgente cfg={cfg} editar={editar} onMudou={carregar} />
      {sugestoes.length > 0 && <Sugestoes lista={sugestoes} editar={editar} onMudou={carregar} />}
      <Conhecimento lista={saber} editar={editar} onMudou={carregar} />
      <Comportamento cfg={cfg} editar={editar} onMudou={carregar} />
      <Testar />
      <Custo />
    </div>
  );
}

// ---------------------------------------------------------------------------
function StatusAgente({ cfg, editar, onMudou }) {
  const [diag, setDiag] = useState(null);
  const [testando, setTestando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const alternar = async () => {
    setSalvando(true);
    await supabase.from("agente_config").update({ ligado: !cfg.ligado, atualizado_em: new Date().toISOString() }).eq("id", 1);
    setSalvando(false);
    onMudou();
  };

  const diagnosticar = async () => {
    setTestando(true);
    setDiag(null);
    const { data, error } = await supabase.functions.invoke("whatsapp-agente", { body: { acao: "diagnostico" } });
    setTestando(false);
    setDiag(error ? { erroGeral: await lerErroDaFuncao(error) } : data);
  };

  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ width: 10, height: 10, borderRadius: 99, background: cfg.ligado ? "#2F8F5B" : "#C4432B" }} />
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: "#22231F" }}>
            {cfg.ligado ? "Agente ligado" : "Agente desligado"}
          </div>
          <div style={{ fontSize: 12, color: "#8A8778" }}>
            {cfg.ligado
              ? "Responde sozinho e passa para a atendente quando precisa."
              : "Toda mensagem nova vai direto para a atendente."}
          </div>
        </div>
        {editar && (
          <button onClick={alternar} disabled={salvando} style={cfg.ligado ? btnSecondary : btnPrimary}>
            {salvando ? <Loader2 size={14} /> : null}{cfg.ligado ? "Desligar" : "Ligar"}
          </button>
        )}
        {editar && (
          <button onClick={diagnosticar} disabled={testando} style={btnSecondary}>
            {testando ? <Loader2 size={14} /> : <PlugZap size={14} />} Testar ligação com a Meta
          </button>
        )}
      </div>
      {diag && <ResultadoDiagnostico d={diag} />}
    </section>
  );
}

function ResultadoDiagnostico({ d }) {
  if (d.erroGeral) return <div style={{ ...avisoStyle, marginTop: 12 }}><AlertTriangle size={16} />{d.erroGeral}</div>;
  if (d.faltando?.length) {
    return (
      <div style={{ ...avisoStyle, marginTop: 12 }}>
        <AlertTriangle size={16} style={{ flexShrink: 0 }} />
        <div>Faltam segredos no Supabase: {d.faltando.join(", ")}.</div>
      </div>
    );
  }
  const n = d.numero || {};
  return (
    <div style={{ marginTop: 12, display: "grid", gap: 6, fontSize: 13 }}>
      <Linha ok={!n.erro} texto={n.erro ? `Número: ${n.erro}` : `Número ${n.display_phone_number} · ${n.verified_name} · qualidade ${traduzQualidade(n.quality_rating)}`} />
      <Linha ok={!d.inscricao?.erro && d.inscricao?.success} texto={d.inscricao?.erro ? `Inscrição do app: ${d.inscricao.erro}` : "App inscrito para receber as mensagens"} />
      <div style={{ fontSize: 12, color: "#8A8778", wordBreak: "break-all" }}>Endereço do webhook: {d.webhook}</div>
    </div>
  );
}

function traduzQualidade(q) {
  return { GREEN: "alta", YELLOW: "média", RED: "baixa" }[q] || (q ? q.toLowerCase() : "sem nota ainda");
}

function Linha({ ok, texto }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "flex-start", color: ok ? "#1F5134" : "#C4432B" }}>
      {ok ? <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} /> : <XCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />}
      <span>{texto}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Sugestoes({ lista, editar, onMudou }) {
  return (
    <section style={{ ...cardStyle, background: "#FFFBEA", borderColor: "#EFD98A" }}>
      <div style={tituloSecao}><Sparkles size={15} /> Aprendido com a atendente</div>
      <div style={{ fontSize: 12.5, color: "#6B5A12", marginBottom: 10 }}>
        Perguntas que o agente não sabia e a atendente respondeu. Ensinando, ele passa a responder sozinho.
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {lista.map((s) => <Sugestao key={s.id} s={s} editar={editar} onMudou={onMudou} />)}
      </div>
    </section>
  );
}

function Sugestao({ s, editar, onMudou }) {
  const [pergunta, setPergunta] = useState(s.pergunta);
  const [resposta, setResposta] = useState(s.resposta);
  const [salvando, setSalvando] = useState(false);
  const ensinar = async () => {
    setSalvando(true);
    await supabase.rpc("agente_ensinar", { p_sugestao: s.id, p_pergunta: pergunta, p_resposta: resposta });
    setSalvando(false);
    onMudou();
  };
  const ignorar = async () => { await supabase.rpc("agente_ignorar", { p_sugestao: s.id }); onMudou(); };
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #EFE3B8", borderRadius: 10, padding: 10, display: "grid", gap: 6 }}>
      <input value={pergunta} onChange={(e) => setPergunta(e.target.value)} disabled={!editar} aria-label="Pergunta do cliente"
        style={{ ...inputStyle, fontWeight: 700 }} />
      <textarea value={resposta} onChange={(e) => setResposta(e.target.value)} disabled={!editar} aria-label="Resposta"
        rows={2} style={{ ...inputStyle, resize: "vertical" }} />
      {editar && (
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={ensinar} disabled={salvando} style={btnPrimary}>{salvando ? <Loader2 size={14} /> : null}Ensinar</button>
          <button onClick={ignorar} style={btnGhost}>Ignorar</button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function Conhecimento({ lista, editar, onMudou }) {
  const [novo, setNovo] = useState(false);
  const faltando = lista.filter((k) => k.ativo && /\[PREENCHER/i.test(k.conteudo)).length;
  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <div style={{ ...tituloSecao, marginBottom: 0, flex: 1 }}>O que ele sabe</div>
        {editar && <button onClick={() => setNovo(true)} style={btnGhost}><Plus size={14} /> Novo assunto</button>}
      </div>
      <div style={{ fontSize: 12.5, color: "#8A8778", marginBottom: 10 }}>
        O cardápio e os preços vêm sozinhos do CardápioWeb. Aqui fica o resto.
        {faltando > 0 && <b style={{ color: "#C4432B" }}> {faltando} assunto(s) com [PREENCHER]: o agente ignora até vocês completarem.</b>}
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {novo && <ItemConhecimento k={{ tema: "", conteudo: "", ativo: true, ordem: 100 }} novo editar={editar} onMudou={() => { setNovo(false); onMudou(); }} onCancelar={() => setNovo(false)} />}
        {lista.map((k) => <ItemConhecimento key={k.id} k={k} editar={editar} onMudou={onMudou} />)}
      </div>
    </section>
  );
}

function ItemConhecimento({ k, novo, editar, onMudou, onCancelar }) {
  const [tema, setTema] = useState(k.tema);
  const [conteudo, setConteudo] = useState(k.conteudo);
  const [ativo, setAtivo] = useState(k.ativo);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const mudou = novo || tema !== k.tema || conteudo !== k.conteudo || ativo !== k.ativo;
  const preencher = /\[PREENCHER/i.test(conteudo);

  const salvar = async () => {
    if (!tema.trim() || !conteudo.trim()) { setErro("Preencha o assunto e o texto."); return; }
    setSalvando(true);
    const dados = { tema: tema.trim(), conteudo: conteudo.trim(), ativo, atualizado_em: new Date().toISOString() };
    const { error } = novo
      ? await supabase.from("agente_conhecimento").insert({ ...dados, ordem: 150 })
      : await supabase.from("agente_conhecimento").update(dados).eq("id", k.id);
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    setErro("");
    onMudou();
  };
  const apagar = async () => {
    if (!window.confirm(`Apagar "${k.tema}"? O agente deixa de saber isso.`)) return;
    await supabase.from("agente_conhecimento").delete().eq("id", k.id);
    onMudou();
  };

  return (
    <div style={{ border: `1px solid ${preencher ? "#F0CFC6" : "#EFE9DA"}`, background: preencher ? "#FFF7F4" : "#FCFAF5", borderRadius: 10, padding: 10, display: "grid", gap: 6, opacity: ativo ? 1 : 0.6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={tema} onChange={(e) => setTema(e.target.value)} disabled={!editar} placeholder="Assunto (ex.: Entrega)"
          aria-label="Assunto" style={{ ...inputStyle, fontWeight: 700, flex: 1 }} />
        {k.origem === "aprendido" && <span style={{ fontSize: 11, fontWeight: 700, color: "#6B5A12", background: "#FBEFC4", borderRadius: 99, padding: "3px 8px" }}>aprendido</span>}
      </div>
      <textarea value={conteudo} onChange={(e) => setConteudo(e.target.value)} disabled={!editar} rows={3}
        placeholder="O que o agente deve saber sobre isso" aria-label="Conteúdo" style={{ ...inputStyle, resize: "vertical" }} />
      {erro && <div style={{ color: "#C4432B", fontSize: 12 }}>{erro}</div>}
      {editar && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, color: "#5E5C52", flex: 1 }}>
            <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Ele usa isso
          </label>
          {novo && <button onClick={onCancelar} style={btnGhost}>Cancelar</button>}
          {!novo && <button onClick={apagar} style={btnGhost} aria-label="Apagar assunto"><Trash2 size={14} /></button>}
          <button onClick={salvar} disabled={salvando || !mudou} style={mudou ? btnPrimary : btnSecondary}>
            {salvando ? <Loader2 size={14} /> : <Save size={14} />} Salvar
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function Comportamento({ cfg, editar, onMudou }) {
  const [tom, setTom] = useState(cfg.tom || "");
  const [link, setLink] = useState(cfg.link_cardapio || "");
  const [regras, setRegras] = useState(cfg.regras_passagem || []);
  const [nunca, setNunca] = useState((cfg.nunca || []).join("\n"));
  const [consentimento, setConsentimento] = useState(cfg.perguntar_consentimento);
  const [salvando, setSalvando] = useState(false);
  const [ok, setOk] = useState(false);

  const salvar = async () => {
    setSalvando(true);
    setOk(false);
    const { error } = await supabase.from("agente_config").update({
      tom: tom.trim(),
      link_cardapio: link.trim() || null,
      regras_passagem: regras,
      nunca: nunca.split("\n").map((l) => l.trim()).filter(Boolean),
      perguntar_consentimento: consentimento,
      atualizado_em: new Date().toISOString(),
    }).eq("id", 1);
    setSalvando(false);
    if (!error) { setOk(true); onMudou(); }
  };

  return (
    <section style={cardStyle}>
      <div style={tituloSecao}>Como ele se comporta</div>
      <div style={{ display: "grid", gap: 14 }}>
        <div>
          <label htmlFor="agente-link" style={rotulo}>Link do cardápio (onde o cliente faz o pedido)</label>
          <input id="agente-link" value={link} onChange={(e) => setLink(e.target.value)} disabled={!editar}
            placeholder="https://…" style={{ ...inputStyle, width: "100%" }} />
          {!link.trim() && <div style={{ fontSize: 12, color: "#C4432B", marginTop: 4 }}>Sem o link, quem quiser pedir é passado para a atendente.</div>}
        </div>

        <div>
          <div style={rotulo}>Quando passa para a atendente</div>
          <div style={{ display: "grid", gap: 4 }}>
            {regras.map((r, i) => (
              <label key={r.chave} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13.5, color: "#22231F", minHeight: 30 }}>
                <input type="checkbox" checked={!!r.ligado} disabled={!editar}
                  onChange={(e) => setRegras((lista) => lista.map((x, j) => (j === i ? { ...x, ligado: e.target.checked } : x)))} />
                {r.texto}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="agente-nunca" style={rotulo}>O que ele nunca faz (uma regra por linha)</label>
          <textarea id="agente-nunca" value={nunca} onChange={(e) => setNunca(e.target.value)} disabled={!editar} rows={5}
            style={{ ...inputStyle, width: "100%", resize: "vertical" }} />
        </div>

        <div>
          <label htmlFor="agente-tom" style={rotulo}>Jeito de falar</label>
          <textarea id="agente-tom" value={tom} onChange={(e) => setTom(e.target.value)} disabled={!editar} rows={3}
            style={{ ...inputStyle, width: "100%", resize: "vertical" }} />
        </div>

        <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13.5, color: "#22231F" }}>
          <input type="checkbox" checked={consentimento} disabled={!editar} onChange={(e) => setConsentimento(e.target.checked)} style={{ marginTop: 3 }} />
          <span>Perguntar uma vez, no fim de uma conversa boa, se o cliente quer receber as promoções da semana</span>
        </label>

        {editar && (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button onClick={salvar} disabled={salvando} style={btnPrimary}>
              {salvando ? <Loader2 size={14} /> : <Save size={14} />} Salvar comportamento
            </button>
            {ok && <span style={{ fontSize: 12.5, color: "#1F5134" }}>Salvo. A próxima conversa já usa.</span>}
          </div>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
function Testar() {
  const [conversa, setConversa] = useState([]);
  const [texto, setTexto] = useState("");
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState("");

  const mandar = async () => {
    const t = texto.trim();
    if (!t) return;
    const nova = [...conversa, { de: "cliente", texto: t }];
    setConversa(nova);
    setTexto("");
    setRodando(true);
    setErro("");
    const { data, error } = await supabase.functions.invoke("whatsapp-agente", {
      body: { acao: "testar", mensagens: nova.filter((m) => m.de !== "acao") },
    });
    setRodando(false);
    if (error || data?.error) { setErro(error ? await lerErroDaFuncao(error) : data.error); return; }
    const extra = (data.acoes || []).map((a) => ({ de: "acao", texto: descreverAcao(a) }));
    setConversa([...nova, ...extra, ...(data.resposta ? [{ de: "agente", texto: data.resposta }] : [])]);
  };

  return (
    <section style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ ...tituloSecao, marginBottom: 0, flex: 1 }}>Testar antes de valer</div>
        {conversa.length > 0 && <button onClick={() => { setConversa([]); setErro(""); }} style={btnGhost}>Recomeçar</button>}
      </div>
      <div style={{ fontSize: 12.5, color: "#8A8778", margin: "4px 0 10px" }}>
        Escreva como se fosse um cliente. Usa o treinamento salvo; não sai nada pelo WhatsApp.
      </div>
      <div style={{ background: "#EFEADB", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 6, minHeight: 120 }}>
        {conversa.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Ex.: “que horas vocês abrem?”, “tem sem glúten?”, “o lanche veio frio”.</div>}
        {conversa.map((m, i) => (
          m.de === "acao" ? (
            <div key={i} style={{ alignSelf: "flex-start", fontSize: 11.5, color: "#8A2E1F", background: "#FBE3DC", borderRadius: 99, padding: "3px 10px" }}>{m.texto}</div>
          ) : (
            <div key={i} style={{
              alignSelf: m.de === "cliente" ? "flex-end" : "flex-start", maxWidth: "85%",
              background: m.de === "cliente" ? "#DDF2D4" : "#FFFFFF", borderRadius: 10, padding: "7px 10px",
              fontSize: 13.5, color: "#22231F", whiteSpace: "pre-wrap",
            }}>{m.texto}</div>
          )
        ))}
        {rodando && <div style={{ fontSize: 12, color: "#8A8778" }}><Loader2 size={13} /> pensando…</div>}
      </div>
      {erro && <div style={{ ...avisoStyle, marginTop: 8 }}><AlertTriangle size={16} />{erro}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <label style={{ flex: 1, display: "flex", alignItems: "center", background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10, padding: "0 12px" }}>
          <input value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => e.key === "Enter" && mandar()}
            placeholder="Pergunte como um cliente" aria-label="Mensagem de teste"
            style={{ border: 0, outline: 0, background: "transparent", fontSize: 14, flex: 1, minHeight: 42 }} />
        </label>
        <button onClick={mandar} disabled={rodando || !texto.trim()} style={{ ...btnPrimary, width: 46, padding: 0 }} aria-label="Enviar teste">
          <Send size={16} />
        </button>
      </div>
    </section>
  );
}

const NOMES_MOTIVO = {
  reclamacao: "reclamação", pedido_problema: "problema no pedido", pediu_humano: "pediu uma pessoa",
  nao_sabe: "não sabe responder", pedido_grande: "pedido grande", irritado: "cliente irritado",
  status_pedido: "onde está o pedido", outro: "outro",
};

function descreverAcao(a) {
  if (a.ferramenta === "passar_para_atendente") return `Passaria para a atendente · ${NOMES_MOTIVO[a.entrada?.motivo] || a.entrada?.motivo}`;
  if (a.ferramenta === "registrar_consentimento") {
    return a.entrada?.resposta === "perguntei" ? "Perguntou sobre receber promoções" : `Registraria: ${a.entrada?.resposta === "sim" ? "aceita" : "não aceita"} promoções`;
  }
  if (a.ferramenta === "registrar_avaliacao") return `Registraria nota ${a.entrada?.nota}`;
  return a.ferramenta;
}

// ---------------------------------------------------------------------------
function Custo() {
  const [dados, setDados] = useState(null);
  useEffect(() => {
    const desde = new Date(Date.now() - 30 * 86400000).toISOString();
    supabase.from("wa_mensagens").select("uso").eq("autor", "agente").not("uso", "is", null)
      .gte("criado_em", desde).limit(5000)
      .then(({ data }) => {
        const t = { respostas: 0, entrada: 0, saida: 0, cache_lido: 0, cache_gravado: 0 };
        (data || []).forEach(({ uso }) => {
          t.respostas += 1;
          ["entrada", "saida", "cache_lido", "cache_gravado"].forEach((k) => { t[k] += Number(uso?.[k]) || 0; });
        });
        const usd = ["entrada", "saida", "cache_lido", "cache_gravado"].reduce((s, k) => s + (t[k] / 1e6) * PRECO_USD[k], 0);
        setDados({ ...t, reais: usd * DOLAR });
      });
  }, []);
  if (!dados) return null;
  return (
    <section style={{ ...cardStyle, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ ...tituloSecao, marginBottom: 2 }}>Custo da IA nos últimos 30 dias</div>
        <div style={{ fontSize: 12, color: "#8A8778" }}>Estimativa pelo consumo registrado (dólar a R$ {DOLAR.toFixed(2).replace(".", ",")}). WhatsApp: R$ 0, só respostas.</div>
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#22231F" }}>
          {dados.reais.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
        </div>
        <div style={{ fontSize: 12, color: "#8A8778" }}>{dados.respostas} respostas do agente</div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Estilos (paleta do painel)
// ---------------------------------------------------------------------------
const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const tituloSecao = { fontWeight: 800, fontSize: 14, color: "#22231F", marginBottom: 8, display: "flex", alignItems: "center", gap: 6 };
const rotulo = { display: "block", fontSize: 12, fontWeight: 700, color: "#5E5C52", marginBottom: 6 };
const inputStyle = {
  padding: "9px 10px", borderRadius: 8, border: "1px solid #E8E2D2", boxSizing: "border-box",
  fontSize: 13.5, background: "#FFFFFF", color: "#22231F", fontFamily: "inherit",
};
const btnPrimary = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  background: "#1F5134", color: "#FFFFFF", border: "1px solid #1F5134", borderRadius: 8,
  padding: "8px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 38,
};
const btnSecondary = {
  display: "flex", alignItems: "center", gap: 6, background: "#FFFFFF", color: "#22231F",
  border: "1px solid #E8E2D2", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 700, cursor: "pointer", minHeight: 38,
};
const btnGhost = {
  display: "flex", alignItems: "center", gap: 5, background: "transparent", color: "#5E5C52",
  border: "1px solid transparent", borderRadius: 8, padding: "7px 10px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
};
const avisoStyle = {
  display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A",
  color: "#7A6A1E", borderRadius: 10, padding: 12, fontSize: 13,
};
