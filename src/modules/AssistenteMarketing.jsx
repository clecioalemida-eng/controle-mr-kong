import React, { useState, useEffect, useCallback } from "react";
import {
  Loader2, AlertTriangle, Send, Sparkles, CalendarPlus, Check, X,
  History, Settings, Info, Database, ChevronDown, ChevronRight, Lock,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";

// ---------------------------------------------------------------------------
// Assistente de Marketing
//
// A pergunta nunca viaja sozinha. Antes de cada chamada, a Edge Function
// monta um DOSSIÊ com os números que já existem no painel — Radar,
// Diagnóstico, Pista e (só para administrador) Anúncios — e manda junto.
//
// Três coisas que esta tela faz de propósito:
//
//   1. Mostra o dossiê ANTES da pergunta. Você vê o que ele tem em mãos e
//      o que está faltando antes de gastar dinheiro perguntando.
//
//   2. Mostra o recibo DEPOIS da resposta: quais blocos foram lidos, e um
//      botão que abre o JSON cru que foi mandado ao modelo. Se a leitura
//      parecer estranha, você não precisa confiar nem desconfiar — confere.
//
//   3. A proposta de pauta é proposta. Vira postagem planejada na Pista só
//      depois de alguém clicar em aceitar, e cada linha carrega o motivo,
//      porque quem aceita está definindo o que vai ser cobrado.
//
// O bloco de dinheiro não é escondido aqui: ele simplesmente não é lido no
// servidor quando quem pergunta não é administrador. Esconder na tela não
// esconderia de ninguém — o dado já teria chegado ao navegador.
// ---------------------------------------------------------------------------

const ATALHOS = [
  "Como estamos contra a praça, de verdade?",
  "Quem está crescendo mais rápido que a gente, e por quê?",
  "O que mudou desde a semana passada?",
  "Que tipo de conteúdo eu devia repetir mais?",
];
const ATALHO_ADMIN = "Meu orçamento de anúncio está bem distribuído?";

const TIPOS = { reels: "Reels", carrossel: "Carrossel", foto: "Foto", video: "Vídeo" };

export default function AssistenteMarketing({ perfil }) {
  const ehAdmin = !!perfil?.is_admin;
  const [vista, setVista] = useState("perguntar");

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        <Aba atual={vista} v="perguntar" set={setVista} icone={<Sparkles size={13} />} label="Perguntar" />
        <Aba atual={vista} v="historico" set={setVista} icone={<History size={13} />} label="Histórico" />
        {ehAdmin && (
          <Aba atual={vista} v="ajustes" set={setVista} icone={<Settings size={13} />} label="Ajustes" />
        )}
      </div>

      {vista === "perguntar" && <Perguntar ehAdmin={ehAdmin} />}
      {vista === "historico" && <Historico ehAdmin={ehAdmin} />}
      {vista === "ajustes" && ehAdmin && <Ajustes />}
    </div>
  );
}

function Aba({ atual, v, set, icone, label }) {
  const ativo = atual === v;
  return (
    <button onClick={() => set(v)} style={{ ...subAba, ...(ativo ? subAbaAtiva : {}) }}>
      {icone} {label}
    </button>
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
  const [rodando, setRodando] = useState("");
  const [erro, setErro] = useState("");
  const [res, setRes] = useState(null);
  const [proposta, setProposta] = useState(null);
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

  const chamar = async (acao) => {
    setRodando(acao); setErro(""); setRes(null); setProposta(null); setVerCru(false);
    try {
      const { data, error } = await supabase.functions.invoke("assistente-marketing", {
        body: { acao, pergunta },
      });
      if (error) {
        // A mensagem útil vem no corpo da resposta, não em error.message.
        let msg = error.message;
        try { const j = await error.context?.json?.(); if (j?.error) msg = j.error; } catch { /* não era json */ }
        setErro(msg);
      } else if (data?.error) {
        setErro(data.error);
      } else {
        setRes(data);
        setProposta(data.proposta || null);
      }
    } catch (e) {
      setErro(String(e));
    }
    setRodando("");
    carregar();
  };

  if (carregando) return <Carregando />;

  const bloqueado = !!gasto?.bloqueado;
  const ocupado = !!rodando;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {/* dossiê / estado */}
      <div style={{ ...cardStyle, background: "#F6F1E7", borderStyle: "dashed" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <div style={{ fontSize: 11.5, lineHeight: 1.55 }}>
            <strong>O assistente lê os seus dados antes de responder.</strong>
            <div style={{ color: "#8A8778", marginTop: 2 }}>
              Radar, Diagnóstico e Pista
              {ehAdmin ? " e Anúncios." : "."}{" "}
              {!ehAdmin && (
                <span>
                  <Lock size={10} style={{ verticalAlign: -1 }} /> Gasto e margem não entram —
                  essa parte é com o administrador.
                </span>
              )}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 9, flexWrap: "wrap" }}>
          <span style={chip}>modelo: {cfg?.modelo || "—"}</span>
          <span style={chip}>
            mês: {dinheiro(gasto?.gasto_brl)} de {dinheiro(gasto?.teto_brl)}
          </span>
          <span style={chip}>{numero(gasto?.perguntas)} perguntas</span>
        </div>
      </div>

      {bloqueado && (
        <div style={avisoErro}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            O teto de gasto do mês foi atingido ({dinheiro(gasto?.gasto_brl)} de{" "}
            {dinheiro(gasto?.teto_brl)}). Novas perguntas ficam bloqueadas até o mês
            virar. {ehAdmin ? "Você pode aumentar o limite em Ajustes." : "Só o administrador pode aumentar o limite."}
          </span>
        </div>
      )}

      {/* pergunta */}
      <div style={cardStyle}>
        <textarea
          value={pergunta}
          onChange={(e) => setPergunta(e.target.value)}
          placeholder="O que você quer saber?"
          rows={3}
          disabled={ocupado || bloqueado}
          style={{
            ...inputStyle, width: "100%", resize: "vertical", minHeight: 62,
            fontFamily: "inherit", lineHeight: 1.5,
          }}
        />
        <div style={{ display: "flex", gap: 7, marginTop: 9, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button style={{ ...btnSecondary, opacity: ocupado || bloqueado ? 0.5 : 1 }}
                  disabled={ocupado || bloqueado}
                  onClick={() => chamar("pauta")}>
            {rodando === "pauta" ? <Loader2 size={13} /> : <CalendarPlus size={13} />} Montar pauta da semana
          </button>
          <button style={{ ...btnPrimary, opacity: ocupado || bloqueado || !pergunta.trim() ? 0.5 : 1 }}
                  disabled={ocupado || bloqueado || !pergunta.trim()}
                  onClick={() => chamar("perguntar")}>
            {rodando === "perguntar" ? <Loader2 size={13} /> : <Send size={13} />} Perguntar
          </button>
        </div>
      </div>

      {/* atalhos */}
      {!res && !ocupado && (
        <div style={cardStyle}>
          <div style={sectionLabel}>Perguntas que rendem</div>
          <div style={{ display: "grid", gap: 6 }}>
            {[...ATALHOS, ...(ehAdmin ? [ATALHO_ADMIN] : [])].map((a) => (
              <button key={a} onClick={() => setPergunta(a)} disabled={bloqueado}
                style={{ ...itemRow, textAlign: "left", cursor: "pointer", fontSize: 12, border: "1px solid #E8E2D2" }}>
                <span>{a}</span>
                <ChevronRight size={13} style={{ color: "#8A8778", flexShrink: 0 }} />
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: "#8A8778", marginTop: 8, lineHeight: 1.5 }}>
            Campo em branco produz pergunta vaga, e pergunta vaga gasta dinheiro e
            devolve conselho de blog. Os atalhos mostram o formato que a base
            responde bem.
          </div>
        </div>
      )}

      {ocupado && (
        <div style={{ ...cardStyle, display: "flex", gap: 9, alignItems: "center", fontSize: 12.5, color: "#8A8778" }}>
          <Loader2 size={15} /> Montando o dossiê e perguntando…
        </div>
      )}

      {erro && <Aviso texto={erro} />}

      {/* resposta */}
      {res && (
        <>
          <div style={cardStyle}>
            <div style={{ fontSize: 12.5, lineHeight: 1.62, whiteSpace: "pre-wrap" }}>
              {semBlocoJson(res.resposta)}
            </div>
          </div>

          {/* recibo */}
          <div style={{ ...cardStyle, background: "#F6F1E7", borderStyle: "dashed" }}>
            <div style={{ ...sectionLabel, marginBottom: 6 }}>O que eu olhei</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {Object.keys(res.dossie || {})
                .filter((k) => !["gerado_em", "fuso", "quem_pergunta"].includes(k))
                .map((k) => <span key={k} style={chip}>{k}</span>)}
            </div>
            {(res.blocos_ausentes || []).length > 0 && (
              <div style={{ fontSize: 10.5, color: "#A5351F", marginTop: 8, lineHeight: 1.5 }}>
                Não consegui ler: {res.blocos_ausentes.join(", ")}. A resposta foi
                dada sem esses dados.
              </div>
            )}
            <div style={{ display: "flex", gap: 7, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
              <button style={btnSecondary} onClick={() => setVerCru((v) => !v)}>
                <Database size={13} /> {verCru ? "Esconder" : "Ver"} dados crus
                {verCru ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </button>
              <span style={{ fontSize: 10, color: "#8A8778", fontVariantNumeric: "tabular-nums" }}>
                {dinheiro(res.custo_brl)} · {numero(res.tokens?.entrada)} + {numero(res.tokens?.saida)} tokens · {res.segundos}s
              </span>
            </div>
            {verCru && (
              <pre style={preStyle}>{JSON.stringify(res.dossie, null, 2)}</pre>
            )}
          </div>

          {proposta && (
            <Proposta proposta={proposta} onDecidido={() => { setProposta(null); }} />
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PROPOSTA DE PAUTA
//
// O único ponto em que o assistente encosta na Pista — e só depois do
// clique. Quem aceita pode ser a operadora: foi decisão de projeto dar
// autonomia a ela. Por isso cada linha carrega o motivo: discordar antes
// é barato, depois de virar cobrança é caro.
// ---------------------------------------------------------------------------
function Proposta({ proposta, onDecidido }) {
  const [linhas, setLinhas] = useState(proposta.linhas || []);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState("");

  const remover = (i) => setLinhas((l) => l.filter((_, idx) => idx !== i));

  const aceitar = async () => {
    if (!linhas.length) return;
    setSalvando(true); setErro("");
    // "titulo" na proposta vira "tema" na Pista — é o nome da coluna lá.
    const { error } = await supabase.from("postagens_planejadas").insert(
      linhas.map((l) => ({
        data_prevista: l.data,
        hora_prevista: l.hora || null,
        tipo: l.tipo,
        tema: l.titulo,
      }))
    );
    if (error) { setErro(error.message); setSalvando(false); return; }

    const { data: u } = await supabase.auth.getUser();
    await supabase.from("assistente_propostas").update({
      status: "aceita",
      decidida_por: u?.user?.id ?? null,
      decidida_em: new Date().toISOString(),
    }).eq("id", proposta.id);

    setSalvando(false);
    setFeito(`${linhas.length} postagem(ns) criada(s) no calendário da Pista.`);
  };

  const descartar = async () => {
    setSalvando(true);
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("assistente_propostas").update({
      status: "descartada",
      decidida_por: u?.user?.id ?? null,
      decidida_em: new Date().toISOString(),
    }).eq("id", proposta.id);
    setSalvando(false);
    onDecidido();
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
      <div style={sectionLabel}>
        Proposta · semana de {dataBR(proposta.semana_inicio)}
      </div>

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
                {l.hora ? `${l.hora} · ` : ""}{l.motivo || "sem motivo declarado"}
              </div>
            </div>
            <span style={{ ...tagBase, ...(l.tipo === "reels" ? tagOk : {}) }}>
              {TIPOS[l.tipo] || l.tipo}
            </span>
            <button onClick={() => remover(i)} style={iconMini} title="Tirar da pauta">
              <X size={12} />
            </button>
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
        <button style={btnSecondary} disabled={salvando} onClick={descartar}>
          Descartar
        </button>
      </div>

      <div style={{ fontSize: 10, color: "#8A8778", marginTop: 8, lineHeight: 1.5 }}>
        Enquanto não for aceita, esta pauta não conta para meta nenhuma. Cada linha
        traz o motivo: se o motivo não convence, tire a linha antes — depois de
        aceita ela vira cobrança em cima de alguém.
      </div>
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
      const { data } = await supabase
        .from("assistente_conversas")
        .select("id, pergunta, resposta, erro, custo_brl, criado_em, modelo, blocos_ausentes")
        .order("criado_em", { ascending: false })
        .limit(40);
      setLinhas(data || []);
      setCarregando(false);
    })();
  }, []);

  if (carregando) return <Carregando />;
  if (!linhas.length) {
    return (
      <div style={avisoStyle}>
        <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>Nenhuma pergunta ainda.</span>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      {!ehAdmin && (
        <div style={{ fontSize: 10.5, color: "#8A8778", lineHeight: 1.5 }}>
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
              {c.erro
                ? <span style={{ color: "#A5351F" }}>{c.erro}</span>
                : semBlocoJson(c.resposta)}
              {(c.blocos_ausentes || []).length > 0 && (
                <div style={{ fontSize: 10.5, color: "#A5351F", marginTop: 9 }}>
                  Blocos ausentes: {c.blocos_ausentes.join(", ")}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AJUSTES (admin)
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
    setCfg(c.data || null);
    setGasto(g.data?.[0] || null);
    setCarregando(false);
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
          dica="Quando o gasto do mês passa daqui, todo mundo para de perguntar até o mês virar. Só administrador muda este número." />
      </div>

      <div style={cardStyle}>
        <div style={sectionLabel}>Modelo</div>
        <CampoTexto rotulo="Identificador do modelo" valor={cfg.modelo}
          ao={(v) => salvar({ modelo: v })} salvando={salvando}
          dica="É texto livre de propósito: nome de modelo muda com o tempo, e um identificador gravado em pedra derrubaria a função. Um modelo mais forte responde melhor e custa mais." />
        <CampoNumero rotulo="Tamanho máximo da resposta (tokens)" valor={cfg.max_tokens}
          ao={(v) => salvar({ max_tokens: Math.round(v) })} salvando={salvando}
          dica="Resposta longa custa mais e ajuda menos. 1600 dá umas quatro a cinco frases densas." />
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
          O painel não sabe o preço da Anthropic nem a cotação do dia — os dois
          mudam. Por isso o custo aparece como <strong>estimativa</strong> e os três
          valores ficam abertos aqui. A fatura de verdade é a da Anthropic.
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
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{texto}</span>
    </div>
  );
}

// O bloco json da pauta é instrução para a máquina, não texto para ler.
function semBlocoJson(t) {
  return String(t || "").replace(/```json[\s\S]*?```/gi, "").trim();
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
const chip = {
  fontFamily: "ui-monospace, monospace", fontSize: 9.5, padding: "2px 6px",
  borderRadius: 5, background: "#FFFFFF", border: "1px solid #E8E2D2", color: "#8A8778",
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
