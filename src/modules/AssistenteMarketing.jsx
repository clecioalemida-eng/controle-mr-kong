import React, { useState, useEffect, useCallback } from "react";
import {
  Loader2, AlertTriangle, Send, Sparkles, Check, X, History, Settings,
  Info, Database, ChevronDown, ChevronRight, Lock, FileText, Target,
  CalendarRange, CalendarDays, Pencil,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";

// ---------------------------------------------------------------------------
// Assistente de Marketing — a cascata da estratégia
//
// O prompt-mestre do dono é a base de TODO raciocínio. Ele entra na íntegra
// como instrução de sistema em toda chamada, do trimestre até a pauta de
// sexta. Não é resumido nem reinterpretado.
//
//   Base  →  Trimestre  →  Mês  →  Semana  →  calendário da Pista
//
// Regras que moram no banco (migração 041) e que a tela só reflete:
//
//   1. Nenhum nível é gerado sem o de cima aprovado. Não é acordo de
//      cavalheiros: o banco recusa o insert.
//   2. Editar a base cria uma VERSÃO nova, nunca sobrescreve — e marca o
//      que foi construído sobre a versão anterior como "revisar". Nada é
//      apagado, e a pauta já aceita continua no calendário.
//   3. A operadora LÊ base e estratégia (executar sem entender é executar
//      no escuro) mas não edita. Ela ainda aceita a pauta da semana.
//   4. O bloco de dinheiro não é escondido aqui: ele não é lido no servidor
//      quando quem pergunta não é administrador.
// ---------------------------------------------------------------------------

const ATALHOS = [
  "Como estamos contra a praça, de verdade?",
  "Quem está crescendo mais rápido que a gente, e por quê?",
  "O que mudou desde a semana passada?",
  "A estratégia deste mês está funcionando?",
];
const ATALHO_ADMIN = "Meu orçamento de anúncio está bem distribuído?";
const TIPOS = { reels: "Reels", carrossel: "Carrossel", foto: "Foto", video: "Vídeo" };

export default function AssistenteMarketing({ perfil }) {
  const ehAdmin = !!perfil?.is_admin;
  const [vista, setVista] = useState("base");
  const [cascata, setCascata] = useState(null);
  const [carregando, setCarregando] = useState(true);

  const carregarCascata = useCallback(async () => {
    const { data } = await supabase.rpc("assistente_cascata");
    setCascata(data?.[0] || null);
    setCarregando(false);
  }, []);

  useEffect(() => { carregarCascata(); }, [carregarCascata]);

  if (carregando) return <Carregando />;

  const podeMicro = !!cascata?.pode_micro;
  const podePauta = !!cascata?.pode_pauta;

  return (
    <div>
      {/* a cascata, na ordem */}
      <div style={{ display: "flex", gap: 6, marginBottom: 7, flexWrap: "wrap" }}>
        <Aba atual={vista} v="base" set={setVista} icone={<FileText size={13} />} label="Base" />
        <Aba atual={vista} v="macro" set={setVista} icone={<Target size={13} />} label="Trimestre" />
        <Aba atual={vista} v="micro" set={setVista} icone={<CalendarRange size={13} />} label="Mês"
             travado={!podeMicro} dica="Aprove o trimestre primeiro" />
        <Aba atual={vista} v="semana" set={setVista} icone={<CalendarDays size={13} />} label="Semana"
             travado={!podePauta} dica="Aprove o mês primeiro" />
      </div>

      {/* o que não é cascata */}
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        <Aba atual={vista} v="perguntar" set={setVista} icone={<Sparkles size={12} />} label="Perguntar" pequeno />
        <Aba atual={vista} v="historico" set={setVista} icone={<History size={12} />} label="Histórico" pequeno />
        {ehAdmin && (
          <Aba atual={vista} v="ajustes" set={setVista} icone={<Settings size={12} />} label="Ajustes" pequeno />
        )}
      </div>

      <Trilha c={cascata} vista={vista} />

      {vista === "base" && <Base ehAdmin={ehAdmin} onMudou={carregarCascata} />}
      {vista === "macro" && <Nivel nivel="macro" ehAdmin={ehAdmin} cascata={cascata} onMudou={carregarCascata} />}
      {vista === "micro" && (podeMicro
        ? <Nivel nivel="micro" ehAdmin={ehAdmin} cascata={cascata} onMudou={carregarCascata} />
        : <Travado texto="O mês nasce do trimestre. Aprove a estratégia trimestral primeiro — gerar um mês sem ela seria conteúdo sem estratégia." />)}
      {vista === "semana" && (podePauta
        ? <Semana ehAdmin={ehAdmin} cascata={cascata} />
        : <Travado texto="A pauta é a execução do mês. Sem o mês aprovado, cada post recomeça do zero na cabeça de quem vê." />)}
      {vista === "perguntar" && <Perguntar ehAdmin={ehAdmin} />}
      {vista === "historico" && <Historico ehAdmin={ehAdmin} />}
      {vista === "ajustes" && ehAdmin && <Ajustes />}
    </div>
  );
}

function Aba({ atual, v, set, icone, label, travado, dica, pequeno }) {
  const ativo = atual === v;
  return (
    <button onClick={() => set(v)} title={travado ? dica : undefined}
      style={{
        ...subAba,
        ...(pequeno ? { padding: "5px 10px", fontSize: 11.5 } : {}),
        ...(ativo ? subAbaAtiva : {}),
        ...(travado && !ativo ? { opacity: 0.45 } : {}),
      }}>
      {travado && !ativo ? <Lock size={11} /> : icone} {label}
    </button>
  );
}

// A trilha é o recibo da cascata: em qualquer tela dá para ver a linhagem
// completa daquilo e subir até onde o raciocínio virou.
function Trilha({ c, vista }) {
  if (!c) return null;
  const passos = [
    { k: "base", t: `base v${c.briefing_versao}`, on: true },
    { k: "macro", t: c.macro_titulo ? cortar(c.macro_titulo) : "sem trimestre", on: !!c.macro_id },
    { k: "micro", t: c.micro_titulo ? cortar(c.micro_titulo) : "sem mês", on: !!c.micro_id },
  ];
  const precisaRevisar = c.macro_revisar || c.micro_revisar;
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap",
                    fontFamily: "ui-monospace, monospace", fontSize: 9.5, color: "#8A8778" }}>
        {passos.map((p, i) => (
          <React.Fragment key={p.k}>
            {i > 0 && <span>→</span>}
            <span style={{ ...chip, ...(p.on ? { background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" } : {}) }}>
              {p.t}
            </span>
          </React.Fragment>
        ))}
      </div>
      {precisaRevisar && vista !== "ajustes" && (
        <div style={{ ...avisoStyle, marginTop: 8 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            A base mudou depois que {c.micro_revisar && c.macro_revisar ? "trimestre e mês foram aprovados" : "isso foi aprovado"}.
            Nada foi apagado e a pauta já aceita continua no calendário — mas
            vale reconferir se a estratégia ainda serve.
          </span>
        </div>
      )}
    </div>
  );
}

function cortar(t) { return String(t).length > 26 ? String(t).slice(0, 24) + "…" : String(t); }

// ---------------------------------------------------------------------------
// NÍVEL 0 — A BASE
// ---------------------------------------------------------------------------
function Base({ ehAdmin, onMudou }) {
  const [b, setB] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [f, setF] = useState({ prompt_mestre: "", nao_fazemos: "", objetivo_agora: "", restricoes: "" });

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("assistente_briefing").select("*")
      .order("versao", { ascending: false }).limit(1).maybeSingle();
    setB(data || null);
    if (data) setF({
      prompt_mestre: data.prompt_mestre || "", nao_fazemos: data.nao_fazemos || "",
      objetivo_agora: data.objetivo_agora || "", restricoes: data.restricoes || "",
    });
    setCarregando(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async () => {
    if (!f.prompt_mestre.trim()) { setErro("O prompt-mestre não pode ficar vazio — ele é a base de tudo."); return; }
    setSalvando(true); setErro("");
    const { data: u } = await supabase.auth.getUser();
    // Versão nova, nunca sobrescrita. É o que permite saber depois o que
    // foi decidido sobre qual premissa.
    const { error } = await supabase.from("assistente_briefing").insert({
      versao: (b?.versao || 0) + 1, ...f, criado_por: u?.user?.id ?? null,
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    setEditando(false); carregar(); onMudou();
  };

  if (carregando) return <Carregando />;
  if (!b) return <Aviso texto="Base não encontrada. Rode a migração 041 no SQL Editor." />;

  const vazio = !String(b.prompt_mestre || "").trim();

  if (editando) {
    return (
      <div style={{ display: "grid", gap: 10 }}>
        {erro && <Aviso texto={erro} />}
        <div style={cardStyle}>
          <div style={sectionLabel}>Prompt-mestre</div>
          <textarea value={f.prompt_mestre} onChange={(e) => setF({ ...f, prompt_mestre: e.target.value })}
            rows={14} disabled={salvando}
            style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5, fontSize: 12.5 }} />
          <div style={{ fontSize: 10, color: "#8A8778", marginTop: 6, lineHeight: 1.5 }}>
            Entra na íntegra, como instrução de sistema, em toda chamada. Não é
            resumido nem reinterpretado.
          </div>
        </div>
        <div style={cardStyle}>
          <div style={sectionLabel}>O que o Mr Kong não faz</div>
          <textarea value={f.nao_fazemos} onChange={(e) => setF({ ...f, nao_fazemos: e.target.value })}
            rows={7} disabled={salvando}
            style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} />
          <div style={{ fontSize: 10, color: "#8A8778", marginTop: 6, lineHeight: 1.5 }}>
            É a restrição mais dura do sistema e vale acima de qualquer
            oportunidade. Estratégia se define mais pelo que recusa do que pelo
            que promete — sem essas linhas, um dia ele sugere guerra de preço
            com quem tem seis vezes mais seguidores, e com boa fundamentação.
          </div>
        </div>
        <div style={cardStyle}>
          <div style={sectionLabel}>Objetivo do momento</div>
          <textarea value={f.objetivo_agora} onChange={(e) => setF({ ...f, objetivo_agora: e.target.value })}
            rows={3} disabled={salvando}
            style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} />
          <div style={{ ...sectionLabel, marginTop: 13 }}>Outras restrições</div>
          <textarea value={f.restricoes} onChange={(e) => setF({ ...f, restricoes: e.target.value })}
            rows={3} disabled={salvando}
            style={{ ...inputStyle, width: "100%", resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }} />
        </div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          <button style={btnPrimary} disabled={salvando} onClick={salvar}>
            {salvando ? <Loader2 size={13} /> : <Check size={13} />} Salvar versão {(b.versao || 0) + 1}
          </button>
          <button style={btnSecondary} disabled={salvando}
                  onClick={() => { setEditando(false); carregar(); }}>Cancelar</button>
        </div>
        <div style={{ fontSize: 10, color: "#8A8778", lineHeight: 1.5 }}>
          Salvar cria uma versão nova. A versão {b.versao} continua guardada, e o
          que foi aprovado em cima dela fica marcado para revisão — sem ser apagado.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {vazio && (
        <div style={avisoStyle}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            O prompt-mestre está vazio. Enquanto ele não existir, o assistente não
            gera estratégia — qualquer coisa que ele propusesse seria dele, não sua.
          </span>
        </div>
      )}

      <div style={cardStyle}>
        <div style={sectionLabel}>Prompt-mestre · versão {b.versao}</div>
        {vazio
          ? <div style={{ fontSize: 12.5, color: "#8A8778", fontStyle: "italic" }}>vazio</div>
          : <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", maxHeight: 320,
                          overflowY: "auto", paddingRight: 4 }}>{b.prompt_mestre}</div>}
      </div>

      <div style={cardStyle}>
        <div style={sectionLabel}>O que o Mr Kong não faz</div>
        <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {b.nao_fazemos || <span style={{ color: "#8A8778", fontStyle: "italic" }}>nada informado</span>}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionLabel}>Objetivo do momento</div>
        <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
          {b.objetivo_agora || <span style={{ color: "#8A8778", fontStyle: "italic" }}>nada informado</span>}
        </div>
        {b.restricoes && (
          <>
            <div style={{ ...sectionLabel, marginTop: 13 }}>Outras restrições</div>
            <div style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{b.restricoes}</div>
          </>
        )}
      </div>

      {ehAdmin ? (
        <div style={{ display: "flex", gap: 7 }}>
          <button style={btnPrimary} onClick={() => setEditando(true)}>
            <Pencil size={13} /> Editar (cria a versão {(b.versao || 0) + 1})
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 10.5, color: "#8A8778", lineHeight: 1.5 }}>
          Você lê a base para saber por que a estratégia é o que é. Editar é do
          administrador.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// NÍVEIS 1 e 2 — TRIMESTRE e MÊS
// ---------------------------------------------------------------------------
function Nivel({ nivel, ehAdmin, cascata, onMudou }) {
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState(null);

  const eMacro = nivel === "macro";
  const nome = eMacro ? "trimestre" : "mês";

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("assistente_estrategias").select("*")
      .eq("nivel", nivel).neq("status", "descartada")
      .order("periodo_inicio", { ascending: false }).limit(6);
    setLinhas(data || []);
    setCarregando(false);
  }, [nivel]);
  useEffect(() => { carregar(); }, [carregar]);

  const gerar = async () => {
    setRodando(true); setMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("assistente-marketing", {
        body: { acao: eMacro ? "gerar_macro" : "gerar_micro" },
      });
      if (error) {
        let m = error.message;
        try { const j = await error.context?.json?.(); if (j?.error) m = j.error; } catch { /* não era json */ }
        setMsg({ tipo: "erro", texto: m });
      } else if (data?.error) setMsg({ tipo: "erro", texto: data.error });
      else { setMsg({ tipo: "ok", texto: `Proposta gerada · ${dinheiro(data.custo_brl)}` }); carregar(); }
    } catch (e) { setMsg({ tipo: "erro", texto: String(e) }); }
    setRodando(false);
  };

  const decidir = async (id, status) => {
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("assistente_estrategias").update({
      status, revisar: false, decidida_por: u?.user?.id ?? null, decidida_em: new Date().toISOString(),
    }).eq("id", id);
    if (error) setMsg({ tipo: "erro", texto: error.message });
    else { carregar(); onMudou(); }
  };

  if (carregando) return <Carregando />;

  const proposta = linhas.find((l) => l.status === "proposta");
  const aprovada = linhas.find((l) => l.status === "aprovada");

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {msg && (
        <div style={msg.tipo === "ok" ? avisoOk : avisoErro}>
          {msg.tipo === "ok" ? <Check size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                             : <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />}
          <span>{msg.texto}</span>
        </div>
      )}

      {aprovada && <CartaoEstrategia e={aprovada} eMacro={eMacro} />}

      {proposta && (
        <CartaoEstrategia e={proposta} eMacro={eMacro} proposta
          acoes={ehAdmin && (
            <div style={{ display: "flex", gap: 7, marginTop: 11, flexWrap: "wrap" }}>
              <button style={btnPrimary} onClick={() => decidir(proposta.id, "aprovada")}>
                <Check size={13} /> Aprovar {nome}
              </button>
              <button style={btnSecondary} onClick={() => decidir(proposta.id, "descartada")}>
                Descartar
              </button>
            </div>
          )} />
      )}

      {ehAdmin && !proposta && (
        <div style={cardStyle}>
          <div style={{ fontSize: 12.5, lineHeight: 1.55, marginBottom: 10 }}>
            {aprovada
              ? `Já existe ${nome} aprovado. Gerar de novo cria uma proposta nova para você comparar — o atual continua valendo até você aprovar outro.`
              : eMacro
                ? "Nenhum trimestre proposto ainda. O assistente vai ler o seu prompt-mestre e os números do painel para propor o problema central, a meta e três pilares com peso."
                : "Nenhum mês proposto ainda. Ele vai distribuir os pilares do trimestre aprovado sobre os posts do mês, e declarar uma hipótese que possa ser derrubada."}
          </div>
          <button style={{ ...btnPrimary, opacity: rodando ? 0.5 : 1 }} disabled={rodando} onClick={gerar}>
            {rodando ? <Loader2 size={13} /> : <Sparkles size={13} />} Gerar proposta
          </button>
        </div>
      )}

      {!ehAdmin && !aprovada && !proposta && (
        <div style={avisoStyle}>
          <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Ainda não há {nome} definido. Quem define é o administrador.</span>
        </div>
      )}

      {!ehAdmin && (
        <div style={{ fontSize: 10.5, color: "#8A8778", lineHeight: 1.5 }}>
          Você lê a estratégia para executar sabendo por quê. Aprovar é do administrador.
        </div>
      )}
    </div>
  );
}

function CartaoEstrategia({ e, eMacro, proposta, acoes }) {
  const c = e.conteudo || {};
  return (
    <div style={{ ...cardStyle, borderLeft: `3px solid ${proposta ? "#C9A227" : "#2F8F5B"}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
        <div style={sectionLabel}>
          {periodoBR(e.periodo_inicio, e.periodo_fim)}
        </div>
        <span style={{ ...tagBase, ...(proposta ? tagWarn : tagOk) }}>
          {proposta ? "proposta" : "aprovada"}
        </span>
      </div>

      {e.revisar && (
        <div style={{ ...avisoStyle, marginBottom: 9 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>Construída sobre a base v{e.briefing_versao}, que já mudou. Vale reconferir.</span>
        </div>
      )}

      {e.texto && (
        <div style={{ fontSize: 12.5, lineHeight: 1.62, whiteSpace: "pre-wrap", marginBottom: 11 }}>
          {e.texto}
        </div>
      )}

      {eMacro ? (
        <>
          {c.meta && (
            <div style={{ ...destaque, marginBottom: 10 }}>
              <strong>Meta:</strong> {c.meta}
            </div>
          )}
          {Array.isArray(c.pilares) && c.pilares.length > 0 && (
            <>
              <div style={sectionLabel}>Pilares</div>
              <div style={{ display: "grid", gap: 6 }}>
                {c.pilares.map((p, i) => (
                  <div key={i} style={pilarStyle}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <span style={{ fontWeight: 700 }}>{p.nome}</span>
                      <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, color: "#8A8778" }}>
                        {p.peso}%
                      </span>
                    </div>
                    {p.descricao && <div style={{ color: "#8A8778", marginTop: 3, lineHeight: 1.5 }}>{p.descricao}</div>}
                    {p.base && (
                      <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid #E8E2D2", fontSize: 10, color: "#8A8778" }}>
                        vem de: <strong style={{ color: "#22231F" }}>{p.base}</strong>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <PesoConfere pilares={c.pilares} />
            </>
          )}
        </>
      ) : (
        <>
          {c.tema && <div style={{ ...destaque, marginBottom: 10 }}><strong>Tema do mês:</strong> {c.tema}</div>}
          {Array.isArray(c.distribuicao) && c.distribuicao.length > 0 && (
            <>
              <div style={sectionLabel}>Distribuição</div>
              <div style={{ display: "grid", gap: 6 }}>
                {c.distribuicao.map((d, i) => (
                  <div key={i} style={pilarStyle}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <span style={{ fontWeight: 700 }}>{d.pilar}</span>
                      <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, color: "#8A8778" }}>
                        {d.posts} post{Number(d.posts) === 1 ? "" : "s"}
                      </span>
                    </div>
                    {d.formatos && <div style={{ color: "#8A8778", marginTop: 3, fontSize: 10 }}>{d.formatos}</div>}
                  </div>
                ))}
              </div>
            </>
          )}
          {c.teste && (
            <>
              <div style={{ ...sectionLabel, marginTop: 13 }}>O que estamos testando</div>
              <div style={{ fontSize: 11.5, color: "#6C6959", lineHeight: 1.55 }}>
                {c.teste}
                {c.criterio && <><br /><strong>Confirma se:</strong> {c.criterio}</>}
                {c.prazo && <><br /><strong>Prazo:</strong> {dataBR(c.prazo)}</>}
              </div>
            </>
          )}
        </>
      )}

      {acoes}
    </div>
  );
}

// Os pesos governam a distribuição do mês. Se não somam 100, a aritmética
// do nível de baixo fica errada — e é melhor a tela dizer isso agora.
function PesoConfere({ pilares }) {
  const soma = pilares.reduce((s, p) => s + (Number(p.peso) || 0), 0);
  if (soma === 100) return null;
  return (
    <div style={{ ...avisoStyle, marginTop: 9 }}>
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>
        Os pesos somam {soma}%, não 100%. A distribuição do mês sai da
        aritmética desses pesos — vale pedir para refazer antes de aprovar.
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NÍVEL 3 — SEMANA
// ---------------------------------------------------------------------------
function Semana({ ehAdmin, cascata }) {
  const [proposta, setProposta] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [rodando, setRodando] = useState(false);
  const [msg, setMsg] = useState(null);

  const carregar = useCallback(async () => {
    const { data } = await supabase.from("assistente_propostas").select("*")
      .eq("status", "proposta").order("criado_em", { ascending: false }).limit(1);
    setProposta(data?.[0] || null);
    setCarregando(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const gerar = async () => {
    setRodando(true); setMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("assistente-marketing", { body: { acao: "pauta" } });
      if (error) {
        let m = error.message;
        try { const j = await error.context?.json?.(); if (j?.error) m = j.error; } catch { /* não era json */ }
        setMsg({ tipo: "erro", texto: m });
      } else if (data?.error) setMsg({ tipo: "erro", texto: data.error });
      else { setMsg({ tipo: "ok", texto: `Pauta proposta · ${dinheiro(data.custo_brl)}` }); carregar(); }
    } catch (e) { setMsg({ tipo: "erro", texto: String(e) }); }
    setRodando(false);
  };

  if (carregando) return <Carregando />;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {msg && (
        <div style={msg.tipo === "ok" ? avisoOk : avisoErro}>
          {msg.tipo === "ok" ? <Check size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                             : <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />}
          <span>{msg.texto}</span>
        </div>
      )}

      {proposta
        ? <Proposta proposta={proposta} onDecidido={carregar} />
        : (
          <div style={cardStyle}>
            <div style={{ fontSize: 12.5, lineHeight: 1.55, marginBottom: 10 }}>
              Nenhuma pauta proposta. Ela vai executar o mês aprovado —
              <strong> {cascata?.micro_titulo || "o mês vigente"}</strong> — respeitando
              as metas da Pista e a janela de melhor horário.
            </div>
            <button style={{ ...btnPrimary, opacity: rodando ? 0.5 : 1 }} disabled={rodando} onClick={gerar}>
              {rodando ? <Loader2 size={13} /> : <Sparkles size={13} />} Montar pauta da semana
            </button>
          </div>
        )}
    </div>
  );
}

function Proposta({ proposta, onDecidido }) {
  const [linhas, setLinhas] = useState(proposta.linhas || []);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState("");

  const remover = (i) => setLinhas((l) => l.filter((_, idx) => idx !== i));

  const decidir = async (status) => {
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("assistente_propostas").update({
      status, decidida_por: u?.user?.id ?? null, decidida_em: new Date().toISOString(),
    }).eq("id", proposta.id);
  };

  const aceitar = async () => {
    if (!linhas.length) return;
    setSalvando(true); setErro("");
    // "titulo" aqui vira "tema" na Pista — é o nome da coluna lá.
    const { error } = await supabase.from("postagens_planejadas").insert(
      linhas.map((l) => ({
        data_prevista: l.data, hora_prevista: l.hora || null, tipo: l.tipo, tema: l.titulo,
      }))
    );
    if (error) { setErro(error.message); setSalvando(false); return; }
    await decidir("aceita");
    setSalvando(false);
    setFeito(`${linhas.length} postagem(ns) criada(s) no calendário da Pista.`);
  };

  if (feito) {
    return (
      <div style={avisoOk}>
        <Check size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{feito} Confira em <strong>Pista › Calendário</strong>.</span>
      </div>
    );
  }

  return (
    <div style={{ ...cardStyle, borderLeft: "3px solid #22231F" }}>
      <div style={sectionLabel}>Proposta · semana de {dataBR(proposta.semana_inicio)}</div>
      {erro && <div style={{ ...avisoErro, marginBottom: 9 }}>
        <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span>{erro}</span>
      </div>}

      <div style={{ display: "grid", gap: 6 }}>
        {linhas.map((l, i) => (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "42px 1fr auto auto", gap: 9, alignItems: "center",
            background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10, padding: "9px 11px",
          }}>
            <div style={{ textAlign: "center", lineHeight: 1.25 }}>
              <div style={{ fontSize: 9.5, color: "#8A8778", textTransform: "uppercase", fontWeight: 700 }}>
                {diaSemana(l.data)}
              </div>
              <div style={{ fontSize: 13, fontWeight: 800 }}>{(l.data || "").slice(8, 10)}</div>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{l.titulo}</div>
              <div style={{ fontSize: 10, color: "#8A8778", marginTop: 1 }}>
                {l.pilar ? <strong style={{ color: "#22231F" }}>{l.pilar}</strong> : null}
                {l.pilar && (l.hora || l.motivo) ? " · " : ""}
                {l.hora ? `${l.hora} · ` : ""}{l.motivo || "sem motivo declarado"}
              </div>
            </div>
            <span style={{ ...tagBase, ...(l.tipo === "reels" ? tagOk : {}) }}>{TIPOS[l.tipo] || l.tipo}</span>
            <button onClick={() => remover(i)} style={iconMini} title="Tirar da pauta"><X size={12} /></button>
          </div>
        ))}
      </div>

      {!linhas.length && (
        <div style={{ fontSize: 12, color: "#8A8778", padding: "8px 0" }}>
          Você tirou todas as linhas. Descarte a proposta ou peça outra.
        </div>
      )}

      <div style={{ display: "flex", gap: 7, marginTop: 11, flexWrap: "wrap" }}>
        <button style={{ ...btnPrimary, opacity: salvando || !linhas.length ? 0.5 : 1 }}
                disabled={salvando || !linhas.length} onClick={aceitar}>
          {salvando ? <Loader2 size={13} /> : <Check size={13} />} Aceitar e criar no calendário
        </button>
        <button style={btnSecondary} disabled={salvando}
                onClick={async () => { await decidir("descartada"); onDecidido(); }}>Descartar</button>
      </div>

      <div style={{ fontSize: 10, color: "#8A8778", marginTop: 8, lineHeight: 1.5 }}>
        Cada linha nomeia o pilar de onde veio. Se o motivo não convence, tire a
        linha antes — depois de aceita ela vira cobrança em cima de alguém.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PERGUNTAR
// ---------------------------------------------------------------------------
function Perguntar({ ehAdmin }) {
  const [pergunta, setPergunta] = useState("");
  const [gasto, setGasto] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState("");
  const [res, setRes] = useState(null);
  const [verCru, setVerCru] = useState(false);

  const carregar = useCallback(async () => {
    const [g, c] = await Promise.all([
      supabase.rpc("assistente_gasto_mes"),
      supabase.from("assistente_config").select("modelo, teto_mensal_brl").eq("id", true).maybeSingle(),
    ]);
    setGasto(g.data?.[0] || null);
    setCfg(c.data || null);
    setCarregando(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const perguntar = async () => {
    setRodando(true); setErro(""); setRes(null); setVerCru(false);
    try {
      const { data, error } = await supabase.functions.invoke("assistente-marketing", {
        body: { acao: "perguntar", pergunta },
      });
      if (error) {
        let m = error.message;
        try { const j = await error.context?.json?.(); if (j?.error) m = j.error; } catch { /* não era json */ }
        setErro(m);
      } else if (data?.error) setErro(data.error);
      else setRes(data);
    } catch (e) { setErro(String(e)); }
    setRodando(false); carregar();
  };

  if (carregando) return <Carregando />;
  const bloqueado = !!gasto?.bloqueado;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ ...cardStyle, background: "#F6F1E7", borderStyle: "dashed" }}>
        <div style={{ fontSize: 11.5, lineHeight: 1.55 }}>
          <strong>A resposta sai de dentro da estratégia vigente</strong>, não de um
          lugar neutro.
          {!ehAdmin && (
            <span style={{ color: "#8A8778" }}>
              {" "}<Lock size={10} style={{ verticalAlign: -1 }} /> Gasto e margem não entram.
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
          <span style={chip}>modelo: {cfg?.modelo || "—"}</span>
          <span style={chip}>mês: {dinheiro(gasto?.gasto_brl)} de {dinheiro(gasto?.teto_brl)}</span>
        </div>
      </div>

      {bloqueado && (
        <div style={avisoErro}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Teto do mês atingido ({dinheiro(gasto?.gasto_brl)}).{" "}
            {ehAdmin ? "Aumente em Ajustes." : "Só o administrador aumenta o limite."}
          </span>
        </div>
      )}

      <div style={cardStyle}>
        <textarea value={pergunta} onChange={(e) => setPergunta(e.target.value)}
          placeholder="O que você quer saber?" rows={3} disabled={rodando || bloqueado}
          style={{ ...inputStyle, width: "100%", resize: "vertical", minHeight: 62, fontFamily: "inherit", lineHeight: 1.5 }} />
        <div style={{ display: "flex", marginTop: 9, justifyContent: "flex-end" }}>
          <button style={{ ...btnPrimary, opacity: rodando || bloqueado || !pergunta.trim() ? 0.5 : 1 }}
                  disabled={rodando || bloqueado || !pergunta.trim()} onClick={perguntar}>
            {rodando ? <Loader2 size={13} /> : <Send size={13} />} Perguntar
          </button>
        </div>
      </div>

      {!res && !rodando && (
        <div style={cardStyle}>
          <div style={sectionLabel}>Perguntas que rendem</div>
          <div style={{ display: "grid", gap: 6 }}>
            {[...ATALHOS, ...(ehAdmin ? [ATALHO_ADMIN] : [])].map((a) => (
              <button key={a} onClick={() => setPergunta(a)} disabled={bloqueado}
                style={{ ...itemRow, textAlign: "left", cursor: "pointer", fontSize: 12 }}>
                <span>{a}</span>
                <ChevronRight size={13} style={{ color: "#8A8778", flexShrink: 0 }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {rodando && (
        <div style={{ ...cardStyle, display: "flex", gap: 9, alignItems: "center", fontSize: 12.5, color: "#8A8778" }}>
          <Loader2 size={15} /> Montando o dossiê e perguntando…
        </div>
      )}

      {erro && <Aviso texto={erro} />}

      {res && (
        <>
          <div style={cardStyle}>
            <div style={{ fontSize: 12.5, lineHeight: 1.62, whiteSpace: "pre-wrap" }}>{res.resposta}</div>
          </div>
          <div style={{ ...cardStyle, background: "#F6F1E7", borderStyle: "dashed" }}>
            <div style={{ ...sectionLabel, marginBottom: 6 }}>O que eu olhei</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {Object.keys(res.dossie || {})
                .filter((k) => !["gerado_em", "fuso", "quem_pergunta"].includes(k))
                .map((k) => <span key={k} style={chip}>{k}</span>)}
            </div>
            {(res.blocos_ausentes || []).length > 0 && (
              <div style={{ fontSize: 10.5, color: "#A5351F", marginTop: 8, lineHeight: 1.5 }}>
                Não consegui ler: {res.blocos_ausentes.join(", ")}.
              </div>
            )}
            <div style={{ display: "flex", gap: 7, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button style={btnSecondary} onClick={() => setVerCru((v) => !v)}>
                <Database size={13} /> {verCru ? "Esconder" : "Ver"} dados crus
              </button>
              <span style={{ fontSize: 10, color: "#8A8778", fontVariantNumeric: "tabular-nums" }}>
                {dinheiro(res.custo_brl)} · {res.segundos}s
              </span>
            </div>
            {verCru && <pre style={preStyle}>{JSON.stringify(res.dossie, null, 2)}</pre>}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HISTÓRICO
// ---------------------------------------------------------------------------
function Historico({ ehAdmin }) {
  const [linhas, setLinhas] = useState([]);
  const [aberta, setAberta] = useState(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("assistente_conversas")
        .select("id, pergunta, resposta, erro, custo_brl, criado_em, blocos_ausentes")
        .order("criado_em", { ascending: false }).limit(40);
      setLinhas(data || []);
      setCarregando(false);
    })();
  }, []);

  if (carregando) return <Carregando />;
  if (!linhas.length) {
    return (
      <div style={avisoStyle}>
        <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span>Nenhuma pergunta ainda.</span>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {!ehAdmin && (
        <div style={{ fontSize: 10.5, color: "#8A8778" }}>
          Você vê as suas perguntas. O administrador vê as de todo mundo.
        </div>
      )}
      {linhas.map((c) => (
        <div key={c.id} style={cardStyle}>
          <button onClick={() => setAberta(aberta === c.id ? null : c.id)}
            style={{ display: "flex", gap: 9, alignItems: "flex-start", width: "100%",
                     background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
            {aberta === c.id ? <ChevronDown size={14} style={{ marginTop: 2, flexShrink: 0, color: "#8A8778" }} />
                             : <ChevronRight size={14} style={{ marginTop: 2, flexShrink: 0, color: "#8A8778" }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{c.pergunta}</div>
              <div style={{ fontSize: 10, color: "#8A8778", marginTop: 2, fontVariantNumeric: "tabular-nums" }}>
                {dataHoraBR(c.criado_em)} · {dinheiro(c.custo_brl)}
                {c.erro && <span style={{ color: "#C4432B" }}> · falhou</span>}
              </div>
            </div>
          </button>
          {aberta === c.id && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #F1ECE0",
                          fontSize: 12.5, lineHeight: 1.62, whiteSpace: "pre-wrap" }}>
              {c.erro ? <span style={{ color: "#A5351F" }}>{c.erro}</span> : c.resposta}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AJUSTES
// ---------------------------------------------------------------------------
function Ajustes() {
  const [cfg, setCfg] = useState(null);
  const [gasto, setGasto] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);

  const carregar = useCallback(async () => {
    const [c, g] = await Promise.all([
      supabase.from("assistente_config").select("*").eq("id", true).maybeSingle(),
      supabase.rpc("assistente_gasto_mes"),
    ]);
    setCfg(c.data || null); setGasto(g.data?.[0] || null); setCarregando(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const salvar = async (campos) => {
    setSalvando(true); setMsg(null);
    const { error } = await supabase.from("assistente_config")
      .update({ ...campos, atualizado_em: new Date().toISOString() }).eq("id", true);
    setSalvando(false);
    if (error) setMsg({ tipo: "erro", texto: error.message });
    else { setMsg({ tipo: "ok", texto: "Salvo." }); carregar(); }
  };

  if (carregando) return <Carregando />;
  if (!cfg) return <Aviso texto="Configuração não encontrada. Rode a migração 040 no SQL Editor." />;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {msg && (
        <div style={msg.tipo === "ok" ? avisoOk : avisoErro}>
          {msg.tipo === "ok" ? <Check size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                             : <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />}
          <span>{msg.texto}</span>
        </div>
      )}

      <div style={cardStyle}>
        <div style={sectionLabel}>Gasto deste mês</div>
        <Linha nome="Já gasto" valor={dinheiro(gasto?.gasto_brl)} />
        <Linha nome="Teto" valor={dinheiro(gasto?.teto_brl)} />
        <Linha nome="Restante" valor={dinheiro(gasto?.restante_brl)} />
        <Linha nome="Perguntas" valor={numero(gasto?.perguntas)} />
        <CampoNumero rotulo="Teto mensal (R$)" valor={cfg.teto_mensal_brl}
          ao={(v) => salvar({ teto_mensal_brl: v })} salvando={salvando}
          dica="Quando o gasto do mês passa daqui, todo mundo para de perguntar até o mês virar. Só administrador muda." />
      </div>

      <div style={cardStyle}>
        <div style={sectionLabel}>Modelo</div>
        <CampoTexto rotulo="Identificador do modelo" valor={cfg.modelo}
          ao={(v) => salvar({ modelo: v })} salvando={salvando}
          dica="Texto livre: nome de modelo muda com o tempo. Um modelo mais forte responde melhor e custa mais — e para estratégia isso pesa." />
        <CampoNumero rotulo="Tamanho máximo da resposta (tokens)" valor={cfg.max_tokens}
          ao={(v) => salvar({ max_tokens: Math.round(v) })} salvando={salvando}
          dica="Estratégia de trimestre precisa de mais espaço que uma pergunta solta. 2500 é uma boa medida se as propostas saírem cortadas." />
      </div>

      <div style={cardStyle}>
        <div style={sectionLabel}>A conta do custo <span style={seloEstimado}>estimado</span></div>
        <CampoNumero rotulo="Preço por milhão de tokens de entrada (US$)" valor={cfg.preco_entrada_mtok}
          ao={(v) => salvar({ preco_entrada_mtok: v })} salvando={salvando} />
        <CampoNumero rotulo="Preço por milhão de tokens de saída (US$)" valor={cfg.preco_saida_mtok}
          ao={(v) => salvar({ preco_saida_mtok: v })} salvando={salvando} />
        <CampoNumero rotulo="Dólar (R$)" valor={cfg.dolar}
          ao={(v) => salvar({ dolar: v })} salvando={salvando} />
        <div style={{ fontSize: 10, color: "#8A8778", marginTop: 8, lineHeight: 1.5 }}>
          O painel não sabe o preço da Anthropic nem a cotação do dia. Por isso o
          custo é <strong>estimativa</strong> e os três valores ficam abertos aqui.
        </div>
      </div>
    </div>
  );
}

function CampoNumero({ rotulo, valor, ao, salvando, dica }) {
  const [v, setV] = useState(valor ?? "");
  useEffect(() => { setV(valor ?? ""); }, [valor]);
  const mudou = String(v) !== String(valor ?? "");
  return (
    <div style={{ padding: "9px 0", borderTop: "1px solid #F1ECE0" }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 5 }}>{rotulo}</div>
      <div style={{ display: "flex", gap: 7 }}>
        <input type="number" step="0.01" value={v} onChange={(e) => setV(e.target.value)}
               style={{ ...inputStyle, flex: 1 }} disabled={salvando} />
        <button style={{ ...btnSecondary, opacity: mudou ? 1 : 0.4 }}
                disabled={!mudou || salvando} onClick={() => ao(Number(v))}>Salvar</button>
      </div>
      {dica && <div style={{ fontSize: 10, color: "#8A8778", marginTop: 6, lineHeight: 1.5 }}>{dica}</div>}
    </div>
  );
}

function CampoTexto({ rotulo, valor, ao, salvando, dica }) {
  const [v, setV] = useState(valor ?? "");
  useEffect(() => { setV(valor ?? ""); }, [valor]);
  const mudou = v !== (valor ?? "");
  return (
    <div style={{ padding: "9px 0", borderTop: "1px solid #F1ECE0" }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 5 }}>{rotulo}</div>
      <div style={{ display: "flex", gap: 7 }}>
        <input type="text" value={v} onChange={(e) => setV(e.target.value)}
               style={{ ...inputStyle, flex: 1, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
               disabled={salvando} />
        <button style={{ ...btnSecondary, opacity: mudou ? 1 : 0.4 }}
                disabled={!mudou || salvando} onClick={() => ao(v.trim())}>Salvar</button>
      </div>
      {dica && <div style={{ fontSize: 10, color: "#8A8778", marginTop: 6, lineHeight: 1.5 }}>{dica}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------
function Travado({ texto }) {
  return (
    <div style={avisoStyle}>
      <Lock size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{texto}</span>
    </div>
  );
}

function Linha({ nome, valor }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0",
                  fontSize: 12.5, borderTop: "1px solid #F1ECE0" }}>
      <span style={{ color: "#6C6959" }}>{nome}</span>
      <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{valor}</span>
    </div>
  );
}

function Carregando() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 28, color: "#8A8778" }}>
      <Loader2 size={20} />
    </div>
  );
}

function Aviso({ texto }) {
  return (
    <div style={avisoErro}>
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} /><span>{texto}</span>
    </div>
  );
}

function numero(v) {
  if (v == null) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR") : "—";
}
function dinheiro(v) {
  if (v == null) return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : "—";
}
function dataBR(iso) {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function periodoBR(a, b) {
  if (!a) return "—";
  const f = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
  return `${f(a)} a ${f(b)}`;
}
function dataHoraBR(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function diaSemana(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T12:00:00");
  return ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()];
}

// ---------------------------------------------------------------------------
// estilos
// ---------------------------------------------------------------------------
const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 13 };
const itemRow = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10, padding: "9px 11px",
};
const btnPrimary = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  background: "#22231F", color: "#F3EFE3", border: "none",
  borderRadius: 8, padding: "9px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer",
};
const btnSecondary = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F",
  borderRadius: 8, padding: "8px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
};
const iconMini = {
  width: 24, height: 24, borderRadius: 6, border: "1px solid #E8E2D2", background: "#F6F1E7",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
  flexShrink: 0, color: "#8A8778",
};
const inputStyle = {
  padding: "8px 10px", borderRadius: 8, border: "1px solid #E8E2D2",
  fontSize: 13, background: "#FFFFFF", color: "#22231F", boxSizing: "border-box",
};
const avisoStyle = {
  display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A",
  color: "#7A6A1E", borderRadius: 10, padding: "12px 13px", fontSize: 12.5, lineHeight: 1.5,
};
const avisoOk = {
  display: "flex", gap: 8, background: "#2F8F5B14", border: "1px solid #2F8F5B",
  color: "#256F47", borderRadius: 10, padding: "12px 13px", fontSize: 12.5, lineHeight: 1.5,
};
const avisoErro = {
  display: "flex", gap: 8, background: "#C4432B12", border: "1px solid #C4432B",
  color: "#A5351F", borderRadius: 10, padding: "12px 13px", fontSize: 12.5, lineHeight: 1.5,
};
const sectionLabel = {
  fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
  color: "#8A8778", marginBottom: 7,
};
const subAba = {
  display: "inline-flex", alignItems: "center", gap: 5,
  padding: "7px 12px", borderRadius: 999, border: "1px solid #E8E2D2",
  background: "#FFFFFF", color: "#8A8778", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
};
const subAbaAtiva = { background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" };
const tagBase = {
  fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999,
  border: "1px solid #E8E2D2", background: "#F6F1E7", color: "#8A8778", whiteSpace: "nowrap",
};
const tagOk = { color: "#2F8F5B", borderColor: "#2F8F5B", background: "#2F8F5B14" };
const tagWarn = { color: "#8A6E12", borderColor: "#C9A227", background: "#C9A22714" };
const chip = {
  fontFamily: "ui-monospace, monospace", fontSize: 9.5, padding: "2px 6px",
  borderRadius: 5, background: "#FFFFFF", border: "1px solid #E8E2D2", color: "#8A8778",
};
const destaque = {
  borderLeft: "2px solid #22231F", padding: "3px 0 3px 10px",
  fontSize: 12.5, lineHeight: 1.55,
};
const pilarStyle = {
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10,
  padding: "10px 11px", fontSize: 11.5,
};
const seloEstimado = {
  fontSize: 9, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase",
  background: "#C9A22722", color: "#8A6E12", border: "1px solid #C9A22770",
  borderRadius: 999, padding: "1px 6px", marginLeft: 4,
};
const preStyle = {
  marginTop: 10, background: "#22231F", color: "#E7E1D2", borderRadius: 8,
  padding: 11, fontSize: 10, lineHeight: 1.45, overflowX: "auto", maxHeight: 320,
  fontFamily: "ui-monospace, monospace",
};
