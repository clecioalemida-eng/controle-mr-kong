import React, { useState, useEffect, useCallback } from "react";
import {
  Loader2, AlertTriangle, CheckCircle2, Info, ExternalLink, Rocket, MapPin, RefreshCw,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";

// ---------------------------------------------------------------------------
// Patrocinar — impulsionar um post que já existe no Instagram
//
// O painel prepara, você aprova aqui, a Edge Function chama a Meta.
// Esta tela nunca fala com a Meta direto e nunca vê token.
//
// O que NÃO mora aqui, de propósito:
//   - O teto do mês. Quem barra é o banco (gatilho em `patrocinios`):
//     esconder o botão não protege nada.
//   - Quem pode aprovar. A lista fica em `patrocinio_aprovador` e só muda
//     pelo SQL Editor. A tela só pergunta e obedece.
// ---------------------------------------------------------------------------

export { Rocket as IconePatrocinar };

async function chamarProxy(acao, corpo = {}) {
  const { data, error } = await supabase.functions.invoke("meta-ads-proxy", {
    body: { acao, ...corpo },
  });
  if (error) {
    let detalhe = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) detalhe = j.error; } catch { /* não era json */ }
    return { erro: detalhe };
  }
  if (data?.error && !data?.etapas) return { erro: data.error };
  return { data };
}

export default function Patrocinar() {
  const [d, setD] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [sel, setSel] = useState(null);
  const [valor, setValor] = useState("");
  const [dias, setDias] = useState("");
  const [confirmo, setConfirmo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const r = await chamarProxy("patrocinio_dados");
    if (r.erro) setErro(r.erro);
    else { setErro(""); setD(r.data); }
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const escolher = (post) => {
    setSel(post);
    setValor(String(d?.config?.valor_padrao ?? ""));
    setDias(String(d?.config?.dias_padrao ?? ""));
    setConfirmo(false);
    setResultado(null);
  };

  const aprovar = async () => {
    if (!sel || !confirmo) return;
    setEnviando(true);
    setResultado(null);
    const r = await chamarProxy("patrocinar", {
      midia_id: sel.id,
      valor: Number(String(valor).replace(",", ".")),
      dias: Number(dias),
      confirmo: true,
    });
    setEnviando(false);
    if (r.erro) {
      setResultado({ tipo: "erro", texto: r.erro });
    } else if (r.data?.ok) {
      setResultado({ tipo: "ok", texto: `No ar. Termina em ${dataBR(r.data.termina)}. A Meta ainda analisa o anúncio; costuma levar de minutos a algumas horas.` });
      setSel(null);
      await carregar();
    } else {
      const feitas = (r.data?.etapas || []).map((e) => e.etapa).join(", ");
      setResultado({
        tipo: "erro",
        texto: `A Meta recusou: ${r.data?.error || "erro sem detalhe"}.${feitas ? ` Chegou a criar (pausado, gastando zero): ${feitas}.` : ""} Não conta no teto.`,
      });
      await carregar();
    }
  };

  if (carregando && !d) return <Carregando />;
  if (erro) return <Aviso tipo="erro" texto={erro} />;
  if (!d) return null;

  const { config: cfg, mes, posts, ultimos, avisos, pode_aprovar: podeAprovar } = d;
  const sobra = Math.max(0, (mes?.teto || 0) - (mes?.aprovado || 0));
  const pct = mes?.teto ? Math.min(100, (mes.aprovado / mes.teto) * 100) : 0;
  const valorNum = Number(String(valor).replace(",", "."));
  const semPonto = cfg.centro_lat == null;

  return (
    <div style={{ display: "grid", gap: 10, paddingBottom: sel ? 190 : 0 }}>
      {resultado && <Aviso tipo={resultado.tipo} texto={resultado.texto} />}
      {(avisos || []).map((a, i) => <Aviso key={i} tipo="info" texto={a} />)}

      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={sectionLabel}>Teto do mês</div>
          <button style={btnGhost} onClick={carregar} disabled={carregando}>
            {carregando ? <Loader2 size={12} /> : <RefreshCw size={12} />} Atualizar
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 13 }}>
          <strong>{dinheiro(mes?.aprovado)} aprovados de {dinheiro(mes?.teto)}</strong>
          <span style={{ color: "#8A8778" }}>sobram {dinheiro(sobra)}</span>
        </div>
        <div style={{ height: 9, background: "#F0ECE2", borderRadius: 99, overflow: "hidden", margin: "8px 0 4px" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: pct >= 90 ? "#C4432B" : "#22231F" }} />
        </div>
        <div style={dica}>
          O teto é barrado no banco: um patrocínio que passe dele é recusado antes de chegar na Meta.
          {!podeAprovar && " Você vê, mas não aprova: só quem está na lista de aprovadores."}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionLabel}>Posts do Instagram {cfg.instagram_usuario ? `@${cfg.instagram_usuario}` : ""}</div>
        {posts.length === 0 ? (
          <div style={dica}>Nenhum post encontrado.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(165px, 1fr))", gap: 9 }}>
            {posts.map((p) => (
              <Post key={p.id} p={p} escolhido={sel?.id === p.id}
                    onClick={() => podeAprovar && !semPonto && escolher(p)} clicavel={podeAprovar && !semPonto} />
            ))}
          </div>
        )}
        <div style={{ ...dica, marginTop: 8 }}>
          Quer patrocinar um vídeo novo? Poste primeiro no Instagram; ele aparece aqui sozinho.
        </div>
      </div>

      {ultimos?.length > 0 && (
        <div style={cardStyle}>
          <div style={sectionLabel}>Últimas aprovações</div>
          {ultimos.map((u) => (
            <div key={u.id} style={{ borderTop: "1px solid #E8E2D2", padding: "7px 0", fontSize: 12.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {u.midia_texto || `post ${u.midia_id}`}
                </span>
                <span style={{ whiteSpace: "nowrap", fontWeight: 700 }}>
                  {dinheiro(u.valor)} · {u.dias}d · <Estado e={u.estado} />
                </span>
              </div>
              <div style={dica}>
                aprovado {dataBR(u.aprovado_em)}
                {u.erro && <span style={{ color: "#A5351F" }}> · {u.erro}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Configuracao cfg={cfg} podeEditar={podeAprovar} aoSalvar={carregar} />

      {sel && (
        <div style={barraFixa}>
          <div style={{ maxWidth: 980, margin: "0 auto", padding: "11px 16px", display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 700, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              Patrocinar: “{sel.texto?.slice(0, 70) || `post ${sel.id}`}”
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }}>
              <label>Valor R$ <input style={{ ...inputStyle, width: 80 }} inputMode="decimal"
                     value={valor} onChange={(e) => { setValor(e.target.value); setConfirmo(false); }} /></label>
              <label>Dias <input style={{ ...inputStyle, width: 56 }} inputMode="numeric"
                     value={dias} onChange={(e) => { setDias(e.target.value); setConfirmo(false); }} /></label>
              <span style={chip}>{cfg.raio_km} km</span>
              <span style={chip}>{cfg.idade_min}–{cfg.idade_max} anos</span>
              <span style={chip}>WhatsApp</span>
            </div>
            <label style={{ fontSize: 12.5, display: "flex", gap: 7, alignItems: "flex-start" }}>
              <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} />
              <span>
                Confirmo gastar até <strong>{dinheiro(valorNum)}</strong> em <strong>{dias || "?"} dias</strong>
                {Number.isFinite(valorNum) && ` (sobram ${dinheiro(Math.max(0, sobra - valorNum))} no mês depois deste)`}.
              </span>
            </label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={btnSecondary} onClick={() => setSel(null)} disabled={enviando}>Cancelar</button>
              <button style={{ ...btnPrimary, opacity: confirmo ? 1 : 0.45 }} onClick={aprovar} disabled={!confirmo || enviando}>
                {enviando ? <Loader2 size={13} /> : <Rocket size={13} />} {enviando ? "Criando na Meta…" : "Aprovar e patrocinar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Post({ p, escolhido, onClick, clicavel }) {
  const h = p.historico;
  return (
    <div onClick={onClick}
         style={{ background: "#fff", border: escolhido ? "2px solid #22231F" : "1px solid #E8E2D2",
                  borderRadius: 11, overflow: "hidden", cursor: clicavel ? "pointer" : "default" }}>
      <div style={{ aspectRatio: "4 / 5", background: "#F0ECE2" }}>
        {p.foto && <img src={p.foto} alt="" loading="lazy"
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
      </div>
      <div style={{ padding: 8 }}>
        <div style={{ fontSize: 12, lineHeight: 1.35, height: 32, overflow: "hidden", marginBottom: 5 }}>
          {p.texto || <span style={{ color: "#8A8778" }}>sem legenda</span>}
        </div>
        {!h ? (
          <span style={{ ...tagBase, color: "#8A8778" }}>Nunca patrocinado</span>
        ) : h.no_ar ? (
          <span style={{ ...tagBase, ...tagOk }}>No ar · {dinheiro(h.gasto)}</span>
        ) : (
          <span style={{ ...tagBase, color: "#555" }}>{cap(h.situacao || "encerrado")} · {dinheiro(h.gasto)}</span>
        )}
        <div style={{ ...dica, marginTop: 5 }}>
          {resumoPost(p)}
        </div>
        <div style={{ ...dica, marginTop: 2 }}>
          {h ? `${numero(h.conversas)} conversas` : "sem anúncio"}
          {h?.no_ar && h.termina ? ` · até ${dataCurta(h.termina)}` : ""}
          {p.link && (
            <> · <a href={p.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                    style={{ color: "#8A8778" }}>ver <ExternalLink size={10} /></a></>
          )}
        </div>
      </div>
    </div>
  );
}

// "vídeo · 8 curtidas · 1 comentário · 25/09", como no painel da Dinâmico.
const TIPOS = { VIDEO: "vídeo", IMAGE: "foto", CAROUSEL_ALBUM: "carrossel" };
function resumoPost(p) {
  const partes = [TIPOS[p.tipo] || "post"];
  if (p.curtidas != null) partes.push(`${numero(p.curtidas)} ${p.curtidas === 1 ? "curtida" : "curtidas"}`);
  if (p.comentarios != null) partes.push(`${numero(p.comentarios)} ${p.comentarios === 1 ? "comentário" : "comentários"}`);
  partes.push(dataCurta(p.data));
  return partes.join(" · ");
}

function Configuracao({ cfg, podeEditar, aoSalvar }) {
  const [f, setF] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);

  const abrir = () => setF({
    ponto: cfg.centro_lat != null ? `${cfg.centro_lat}, ${cfg.centro_lng}` : "",
    raio_km: cfg.raio_km, quem_conta: cfg.quem_conta,
    idade_min: cfg.idade_min, idade_max: cfg.idade_max,
    teto_mensal: cfg.teto_mensal, valor_padrao: cfg.valor_padrao, dias_padrao: cfg.dias_padrao,
  });

  const salvar = async () => {
    // Aceita "-17.79, -50.93" ou um link do Google Maps com "@-17.79,-50.93".
    const m = String(f.ponto).match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
    if (!m) { setMsg({ tipo: "erro", texto: "Ponto inválido. Cole as coordenadas do Google Maps, por exemplo -17.7923, -50.9194." }); return; }
    const n = (v) => Number(String(v).replace(",", "."));
    setSalvando(true);
    const { error } = await supabase.from("patrocinio_config").update({
      centro_lat: n(m[1]), centro_lng: n(m[2]),
      raio_km: n(f.raio_km), quem_conta: f.quem_conta,
      idade_min: n(f.idade_min), idade_max: n(f.idade_max),
      teto_mensal: n(f.teto_mensal), valor_padrao: n(f.valor_padrao), dias_padrao: n(f.dias_padrao),
    }).eq("conta_id", cfg.conta_id);
    setSalvando(false);
    if (error) setMsg({ tipo: "erro", texto: traduzir(error.message) });
    else { setMsg({ tipo: "ok", texto: "Salvo." }); setF(null); aoSalvar(); }
  };

  const campo = (k, rotulo, props = {}) => (
    <label style={{ display: "grid", gap: 3, fontSize: 11.5, color: "#8A8778" }}>
      {rotulo}
      <input style={campoStyle} value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
    </label>
  );

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={sectionLabel}>Configuração do patrocínio</div>
        {podeEditar && !f && <button style={btnGhost} onClick={abrir}>Editar</button>}
      </div>
      {msg && <div style={{ marginBottom: 8 }}><Aviso tipo={msg.tipo} texto={msg.texto} /></div>}

      {!f ? (
        <>
          <Linha nome="Página" valor={cfg.pagina_nome || "—"} />
          <Linha nome="Instagram" valor={cfg.instagram_usuario ? `@${cfg.instagram_usuario}` : "—"} />
          <Linha nome="Para onde a pessoa vai" valor="WhatsApp ligado à Página" />
          <Linha nome="Onde" valor={cfg.centro_lat != null
            ? <a style={{ color: "#22231F" }} target="_blank" rel="noreferrer"
                 href={`https://www.google.com/maps?q=${cfg.centro_lat},${cfg.centro_lng}`}>
                <MapPin size={11} /> {cfg.raio_km} km do ponto
              </a>
            : <span style={{ color: "#A5351F" }}>falta marcar o ponto</span>} />
          <Linha nome="Quem" valor={`${cfg.idade_min} a ${cfg.idade_max} anos · ${cfg.quem_conta === "mora" ? "quem mora na área" : "quem mora ou esteve na área"}`} />
          <Linha nome="Teto do mês" valor={dinheiro(cfg.teto_mensal)} />
          <Linha nome="Padrão de cada patrocínio" valor={`${dinheiro(cfg.valor_padrao)} · ${cfg.dias_padrao} dias`} />
        </>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {campo("ponto", "Ponto do restaurante (cole do Google Maps: botão direito no local → clicar nos números)", { placeholder: "-17.7923, -50.9194" })}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
            {campo("raio_km", "Raio (km)", { inputMode: "numeric" })}
            <label style={{ display: "grid", gap: 3, fontSize: 11.5, color: "#8A8778" }}>
              Quem conta
              <select style={campoStyle} value={f.quem_conta} onChange={(e) => setF({ ...f, quem_conta: e.target.value })}>
                <option value="mora_ou_esteve">Mora ou esteve na área</option>
                <option value="mora">Só quem mora</option>
              </select>
            </label>
            {campo("idade_min", "Idade mínima", { inputMode: "numeric" })}
            {campo("idade_max", "Idade máxima", { inputMode: "numeric" })}
            {campo("teto_mensal", "Teto do mês (R$)", { inputMode: "decimal" })}
            {campo("valor_padrao", "Valor padrão (R$)", { inputMode: "decimal" })}
            {campo("dias_padrao", "Dias padrão", { inputMode: "numeric" })}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button style={btnSecondary} onClick={() => { setF(null); setMsg(null); }} disabled={salvando}>Cancelar</button>
            <button style={btnPrimary} onClick={salvar} disabled={salvando}>
              {salvando ? <Loader2 size={13} /> : null} Salvar
            </button>
          </div>
        </div>
      )}
      <div style={{ ...dica, marginTop: 8 }}>
        Página e Instagram vêm da própria Meta; não se digitam. O número do WhatsApp é o que está ligado à Página no Facebook.
      </div>
    </div>
  );
}

// As travas do banco falam em nome de restrição; aqui vira frase.
function traduzir(m) {
  if (/pc_padrao/.test(m)) return "O valor padrão tem que ser maior que zero e caber no teto do mês.";
  if (/pc_teto/.test(m)) return "O teto tem que ser maior que zero (e no máximo R$ 20.000).";
  if (/pc_idade/.test(m)) return "Idade de 18 a 65, e a mínima não pode passar da máxima.";
  if (/pc_raio/.test(m)) return "Raio de 1 a 80 km.";
  if (/pc_dias/.test(m)) return "Dias padrão de 1 a 30.";
  if (/pc_centro/.test(m)) return "O ponto tem que estar no Brasil.";
  if (/permission|policy|row-level/i.test(m)) return "Só quem aprova patrocínio muda esta configuração.";
  return m;
}

function Estado({ e }) {
  if (e === "publicado") return <span style={{ color: "#2F8F5B" }}>publicado</span>;
  if (e === "falhou") return <span style={{ color: "#C4432B" }}>falhou</span>;
  return <span style={{ color: "#8A6E12" }}>aprovado</span>;
}

function Linha({ nome, valor }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0",
                  borderTop: "1px solid #E8E2D2", fontSize: 12.5 }}>
      <span style={{ color: "#8A8778" }}>{nome}</span>
      <span style={{ fontWeight: 700, textAlign: "right" }}>{valor}</span>
    </div>
  );
}

function Carregando() {
  return <div style={{ ...cardStyle, color: "#8A8778", fontSize: 12.5 }}><Loader2 size={13} /> Buscando posts e gastos na Meta…</div>;
}

function Aviso({ tipo, texto }) {
  const estilo = tipo === "ok" ? avisoOk : tipo === "erro" ? avisoErro : avisoInfo;
  const Icone = tipo === "ok" ? CheckCircle2 : tipo === "erro" ? AlertTriangle : Info;
  return (
    <div style={estilo}>
      <Icone size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{texto}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------
function dinheiro(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : "—";
}
function dataBR(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function dataCurta(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// ---------------------------------------------------------------------------
// estilos (os mesmos do MetaAds.jsx)
// ---------------------------------------------------------------------------
const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 13 };
const sectionLabel = {
  fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
  color: "#8A8778", marginBottom: 7,
};
const dica = { fontSize: 10.5, color: "#8A8778", lineHeight: 1.5 };
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
const btnGhost = {
  display: "inline-flex", alignItems: "center", gap: 5, background: "transparent",
  border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8, padding: "4px 9px",
  fontSize: 11.5, fontWeight: 600, cursor: "pointer",
};
const inputStyle = {
  padding: "7px 9px", borderRadius: 8, border: "1px solid #E8E2D2",
  fontSize: 13, background: "#FFFFFF", color: "#22231F", boxSizing: "border-box",
};
// No formulário o campo ocupa a célula inteira e nunca passa da borda.
const campoStyle = { ...inputStyle, width: "100%", minWidth: 0 };
const chip = { border: "1px solid #E8E2D2", borderRadius: 999, padding: "3px 9px", fontWeight: 600 };
const tagBase = {
  fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
  border: "1px solid #E8E2D2", background: "#F6F1E7", display: "inline-block",
};
const tagOk = { color: "#2F8F5B", borderColor: "#2F8F5B", background: "#2F8F5B14" };
const barraFixa = {
  position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50,
  background: "#FFFFFF", borderTop: "1px solid #E8E2D2", boxShadow: "0 -6px 20px rgba(0,0,0,.07)",
};
const avisoInfo = {
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
