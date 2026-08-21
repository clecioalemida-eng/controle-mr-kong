import React, { useState, useEffect, useCallback } from "react";
import {
  Loader2, AlertTriangle, Plus, Trash2, Check, Link2, Flag,
  Calendar, Trophy, Settings, ChevronLeft, Lock, Info,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";

// ---------------------------------------------------------------------------
// Pista do Marketing
//
// Calendário semanal com checklist, metas vindas do diagnóstico, e uma
// pontuação que vale bônus.
//
// Como vale dinheiro, cinco regras valem — e todas moram no banco, não aqui:
//   1. Stories são registrados na mão e NÃO entram na pontuação
//   2. Semana fechada congela; coleta futura não mexe em bônus pago
//   3. Post apagado não conta (a confirmação vem de coleta posterior)
//   4. Piso de qualidade: post que engaja pouco não conta como cumprido
//   5. Esforço pesa mais que resultado (padrão 70/30)
//
// Esta tela não calcula nada. Lê de v_pontos_semana, que é onde a conta
// acontece. Se a tela e o banco discordassem, o operador descobriria na
// pior hora possível — a do pagamento.
// ---------------------------------------------------------------------------

const DIAS_CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const TIPOS = [
  { v: "reels", n: "Reels" },
  { v: "carrossel", n: "Carrossel" },
  { v: "foto", n: "Foto" },
  { v: "video", n: "Vídeo" },
];

// Segunda-feira da semana de uma data (o banco usa date_trunc('week'),
// que no Postgres também começa na segunda).
function segundaDa(data) {
  const d = new Date(data);
  const dia = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - dia);
  return d.toISOString().slice(0, 10);
}
function hoje() { return new Date().toISOString().slice(0, 10); }
function somaDias(iso, n) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function dataBR(iso) {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export default function PistaMarketing({ perfil }) {
  const [vista, setVista] = useState("pista"); // pista | calendario | placar | config
  const ehAdmin = !!perfil?.is_admin;

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        <Aba atual={vista} v="pista" set={setVista} icone={<Flag size={13} />} label="Pista" />
        <Aba atual={vista} v="calendario" set={setVista} icone={<Calendar size={13} />} label="Calendário" />
        <Aba atual={vista} v="placar" set={setVista} icone={<Trophy size={13} />} label="Placar" />
        {ehAdmin && (
          <Aba atual={vista} v="config" set={setVista} icone={<Settings size={13} />} label="Metas" />
        )}
      </div>

      {vista === "pista" && <Pista />}
      {vista === "calendario" && <Calendario />}
      {vista === "placar" && <Placar ehAdmin={ehAdmin} />}
      {vista === "config" && ehAdmin && <Config />}
    </div>
  );
}

function Aba({ atual, v, set, icone, label }) {
  const ativo = atual === v;
  return (
    <button onClick={() => set(v)}
      style={{ ...subAba, ...(ativo ? subAbaAtiva : {}) }}>
      {icone} {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// A PISTA — duas raias, nós e o fantasma da praça
// ---------------------------------------------------------------------------
function Pista() {
  const [semana, setSemana] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [pendentes, setPendentes] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const inicio = segundaDa(hoje());

  useEffect(() => {
    (async () => {
      const [s, c, p] = await Promise.all([
        supabase.from("v_pontos_semana").select("*").eq("semana_inicio", inicio).maybeSingle(),
        supabase.from("config_marketing").select("*").eq("id", 1).maybeSingle(),
        supabase.from("postagens_planejadas").select("*")
          .gte("data_prevista", inicio).lte("data_prevista", somaDias(inicio, 6))
          .is("confirmado_em", null).eq("publicado_manual", false)
          .order("data_prevista"),
      ]);
      setSemana(s.data);
      setCfg(c.data);
      setPendentes(p.data || []);
      setCarregando(false);
    })();
  }, [inicio]);

  if (carregando) return <Carregando />;
  if (!cfg) return <Aviso texto="Configuração de metas não encontrada. Rode a migração 037." />;

  const metas = [
    { nome: "Reels", feito: semana?.reels_feitos || 0, meta: cfg.meta_reels },
    { nome: "Posts feed", feito: semana?.posts_feitos || 0, meta: cfg.meta_posts },
    { nome: "Stories", feito: semana?.stories_feitos || 0, meta: cfg.meta_stories, naMao: true },
    { nome: "Seguidores", feito: semana?.seguidores_ganhos || 0, meta: cfg.meta_seguidores },
  ];
  if (cfg.janela_dia != null && cfg.janela_hora != null) {
    metas.splice(3, 0, {
      nome: `${DIAS_CURTO[cfg.janela_dia]} ${String(cfg.janela_hora).padStart(2, "0")}h`,
      feito: semana?.janela_cumprida ? 1 : 0, meta: 1,
    });
  }

  // O progresso da pista usa só as metas que valem pontos (stories fora).
  const contam = metas.filter((m) => !m.naMao);
  const nosso = Math.round(
    (contam.reduce((s, m) => s + Math.min(m.feito / (m.meta || 1), 1), 0) / (contam.length || 1)) * 100
  );

  // O fantasma: quanto da semana já passou. Se estamos à frente do tempo
  // decorrido, estamos ganhando da própria semana.
  const diaDaSemana = (new Date().getDay() + 6) % 7;
  const praca = Math.round(((diaDaSemana + 1) / 7) * 100);

  return (
    <div>
      <div style={{ ...cardStyle, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 3 }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>
            Semana {dataBR(inicio)} a {dataBR(somaDias(inicio, 6))}
          </div>
          <div style={{ fontSize: 10.5, color: "#8A8778" }}>
            {6 - diaDaSemana === 0 ? "último dia" : `faltam ${6 - diaDaSemana} dias`}
          </div>
        </div>
        <div style={{ fontSize: 11.5, color: "#8A8778", marginBottom: 12 }}>
          {nosso}% da meta ·{" "}
          {nosso >= praca ? "você está na frente do calendário" : "o calendário está na sua frente"}
        </div>

        <Raias nosso={nosso} praca={praca} />

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginTop: 2, color: "#8A8778" }}>
          <span>Mr. Kong {nosso}%</span>
          <span>Ritmo da semana {praca}%</span>
        </div>
      </div>

      <div style={sectionLabel}>Metas da semana</div>
      <div style={{ ...cardStyle, display: "grid", gap: 10 }}>
        {metas.map((m) => {
          const pct = Math.min((m.feito / (m.meta || 1)) * 100, 100);
          const cor = pct >= 100 ? "#2F8F5B" : pct >= 60 ? "#C9A227" : "#22231F";
          return (
            <div key={m.nome} style={{ display: "grid", gridTemplateColumns: "82px 1fr 54px", gap: 8, alignItems: "center", fontSize: 11.5 }}>
              <span style={{ color: "#22231F", display: "flex", alignItems: "center", gap: 4 }}>
                {m.nome}
                {m.naMao && <span style={seloMao} title="Registrado na mão — não vale bônus">mão</span>}
              </span>
              <span style={{ height: 8, borderRadius: 999, background: "#E8E2D2", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${pct}%`, background: cor, borderRadius: 999 }} />
              </span>
              <span style={{ textAlign: "right", color: "#8A8778", fontVariantNumeric: "tabular-nums" }}>
                {m.nome === "Seguidores" ? `+${m.feito}` : m.feito}/{m.meta}
              </span>
            </div>
          );
        })}
      </div>

      {pendentes.length > 0 && (
        <div style={{ ...cardStyle, marginTop: 12, background: "#22231F", borderColor: "#22231F" }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778", marginBottom: 5 }}>
            Falta para a linha de chegada
          </div>
          <div style={{ fontSize: 12.5, color: "#F3EFE3", lineHeight: 1.5 }}>
            {pendentes.slice(0, 3).map((p) => (
              <div key={p.id}>
                {DIAS_CURTO[new Date(p.data_prevista + "T12:00:00").getDay()]}
                {p.hora_prevista ? ` ${String(p.hora_prevista).slice(0, 5)}` : ""} · {p.tema || TIPOS.find((t) => t.v === p.tipo)?.n}
              </div>
            ))}
            {pendentes.length > 3 && (
              <div style={{ color: "#8A8778", marginTop: 3 }}>e mais {pendentes.length - 3}</div>
            )}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: "#8A8778", marginTop: 12, lineHeight: 1.5 }}>
        Stories aparecem na pista mas não entram na pontuação do bônus — são
        registrados na mão, e número marcado na mão não vira dinheiro.
      </div>
    </div>
  );
}

// Desenho da pista. Duas raias, corredor e fantasma, bandeira quadriculada.
function Raias({ nosso, praca }) {
  const L = 326;
  const x1 = Math.max(10, Math.min((nosso / 100) * L, L));
  const x2 = Math.max(9, Math.min((praca / 100) * L, L));
  return (
    <svg viewBox="0 0 340 78" style={{ width: "100%", height: 78, display: "block" }}
      role="img" aria-label={`Pista da semana: Mr. Kong em ${nosso}%, ritmo do calendário em ${praca}%`}>
      <rect x="0" y="14" width={L} height="24" rx="12" fill="#E8E2D2" />
      <rect x="0" y="46" width={L} height="24" rx="12" fill="#E8E2D2" />
      <rect x="0" y="14" width={x1} height="24" rx="12" fill="#C4432B22" />
      <rect x="0" y="46" width={x2} height="24" rx="12" fill="#8A877822" />

      <rect x={L} y="8" width="3" height="68" fill="#22231F" />
      <rect x={L + 3} y="8" width="5" height="5" fill="#22231F" />
      <rect x={L + 8} y="13" width="5" height="5" fill="#22231F" />
      <rect x={L + 3} y="18" width="5" height="5" fill="#22231F" />
      <rect x={L + 8} y="23" width="5" height="5" fill="#22231F" />

      <circle cx={x1} cy="26" r="10" fill="#C4432B" />
      <text x={x1} y="30" textAnchor="middle" fontSize="9" fontWeight="800" fill="#FFF"
        fontFamily="Inter, sans-serif">MK</text>

      <circle cx={x2} cy="58" r="9" fill="none" stroke="#8A8778" strokeWidth="1.5" strokeDasharray="3 2" />
      <text x={x2} y="61" textAnchor="middle" fontSize="8" fontWeight="700" fill="#8A8778"
        fontFamily="Inter, sans-serif">RT</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// CALENDÁRIO — os cartões com checklist
// ---------------------------------------------------------------------------
function Calendario() {
  const [inicio, setInicio] = useState(segundaDa(hoje()));
  const [lista, setLista] = useState([]);
  const [stories, setStories] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const fim = somaDias(inicio, 6);
    const [p, s] = await Promise.all([
      supabase.from("postagens_planejadas").select("*")
        .gte("data_prevista", inicio).lte("data_prevista", fim)
        .order("data_prevista").order("hora_prevista", { nullsFirst: false }),
      supabase.from("registros_stories").select("*").gte("dia", inicio).lte("dia", fim),
    ]);
    setLista(p.data || []);
    const mapa = {};
    for (const r of s.data || []) mapa[r.dia] = r.quantidade;
    setStories(mapa);
    setCarregando(false);
  }, [inicio]);

  useEffect(() => { carregar(); }, [carregar]);

  const alternar = async (post, campo) => {
    await supabase.from("postagens_planejadas").update({ [campo]: !post[campo] }).eq("id", post.id);
    carregar();
  };

  const colarLink = async (post) => {
    const url = window.prompt("Cole o link do post publicado:");
    if (!url) return;
    // O robô confirma de novo na próxima coleta. Se o post tiver sido
    // apagado até lá, ele não é encontrado e deixa de contar.
    await supabase.from("postagens_planejadas")
      .update({ url_post: url.trim(), publicado_manual: true })
      .eq("id", post.id);
    carregar();
  };

  const remover = async (post) => {
    await supabase.from("postagens_planejadas").delete().eq("id", post.id);
    carregar();
  };

  const salvarStories = async (dia, valor) => {
    const q = Math.max(0, Number(valor) || 0);
    await supabase.from("registros_stories").upsert({ dia, quantidade: q }, { onConflict: "dia" });
    setStories((s) => ({ ...s, [dia]: q }));
  };

  const dias = Array.from({ length: 7 }, (_, i) => somaDias(inicio, i));

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => setInicio(somaDias(inicio, -7))} style={btnSecondary}>‹</button>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: "#22231F" }}>
          {dataBR(inicio)} a {dataBR(somaDias(inicio, 6))}
        </div>
        <button onClick={() => setInicio(somaDias(inicio, 7))} style={btnSecondary}>›</button>
        <button onClick={() => setCriando(true)} style={{ ...btnPrimary, marginLeft: "auto" }}>
          <Plus size={14} /> Postagem
        </button>
      </div>

      {erro && <Aviso texto={erro} />}

      {criando && (
        <NovaPostagem
          inicio={inicio}
          onFechar={() => setCriando(false)}
          onSalvo={() => { setCriando(false); carregar(); }}
          onErro={setErro}
        />
      )}

      {carregando ? <Carregando /> : (
        <div style={{ display: "grid", gap: 14 }}>
          {dias.map((dia) => {
            const doDia = lista.filter((p) => p.data_prevista === dia);
            const ehHoje = dia === hoje();
            return (
              <div key={dia}>
                <div style={{ ...sectionLabel, display: "flex", alignItems: "center", gap: 6 }}>
                  {DIAS_CURTO[new Date(dia + "T12:00:00").getDay()]} · {dataBR(dia)}
                  {ehHoje && <span style={seloHoje}>hoje</span>}
                </div>

                <div className="list-grid">
                  {doDia.map((p) => (
                    <Cartao key={p.id} post={p} ehHoje={ehHoje}
                      onAlternar={alternar} onLink={colarLink} onRemover={remover} />
                  ))}

                  {/* Stories do dia — registro na mão, sempre visível */}
                  <div style={{ ...itemRow, background: "#F6F1E7" }}>
                    <span style={{ fontSize: 12, color: "#8A8778", display: "flex", alignItems: "center", gap: 5 }}>
                      Stories <span style={seloMao}>mão</span>
                    </span>
                    <input
                      type="number" min="0" inputMode="numeric"
                      value={stories[dia] ?? 0}
                      onChange={(e) => salvarStories(dia, e.target.value)}
                      style={{ ...inputStyle, width: 62, textAlign: "right", padding: "5px 8px" }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Cartao({ post, ehHoje, onAlternar, onLink, onRemover }) {
  const publicado = post.confirmado_em || post.publicado_manual;
  const passou = post.data_prevista < hoje();
  const cor = publicado ? "#2F8F5B" : passou ? "#C4432B" : ehHoje ? "#C9A227" : "#E8E2D2";
  const rotulo = publicado ? "publicado" : passou ? "não saiu" : ehHoje ? "em aberto" : "planejado";

  return (
    <div style={{ ...cardStyle, borderLeft: `3px solid ${cor}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 5, alignItems: "center" }}>
        <b style={{ fontSize: 12.5 }}>
          {TIPOS.find((t) => t.v === post.tipo)?.n || post.tipo}
          {post.hora_prevista ? ` · ${String(post.hora_prevista).slice(0, 5)}` : ""}
        </b>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ ...tagBase, color: cor, borderColor: cor }}>{rotulo}</span>
          <button onClick={() => onRemover(post)} style={iconMini}><Trash2 size={12} color="#C4432B" /></button>
        </div>
      </div>

      {post.tema && (
        <div style={{ fontSize: 12, lineHeight: 1.4, marginBottom: 7, color: "#22231F" }}>{post.tema}</div>
      )}

      <Item post={post} campo="midia_ok" rotulo="Mídia gravada" onAlternar={onAlternar} />
      <Item post={post} campo="legenda_ok" rotulo="Legenda escrita" onAlternar={onAlternar} />

      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 0" }}>
        <span style={{ ...boxStyle, ...(publicado ? (post.confirmado_em ? boxAuto : boxOn) : {}) }}>
          {publicado ? "✓" : ""}
        </span>
        <span style={{ color: publicado ? "#8A8778" : "#22231F", textDecoration: publicado ? "line-through" : "none" }}>
          Publicado
        </span>
        <span style={{ fontSize: 9.5, color: "#8A8778", marginLeft: "auto" }}>
          {post.confirmado_em ? "conferido pelo robô" : "aguardando o robô"}
        </span>
      </div>

      {!post.confirmado_em && (
        <button onClick={() => onLink(post)} style={{ ...btnSecondary, marginTop: 7, width: "100%", justifyContent: "center", padding: "6px 10px", fontSize: 12 }}>
          <Link2 size={12} /> {post.url_post ? "Trocar link" : "Colar link do post"}
        </button>
      )}
    </div>
  );
}

function Item({ post, campo, rotulo, onAlternar }) {
  const on = post[campo];
  return (
    <button onClick={() => onAlternar(post, campo)}
      style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, padding: "3px 0",
        background: "none", border: "none", cursor: "pointer", font: "inherit", width: "100%", textAlign: "left" }}>
      <span style={{ ...boxStyle, ...(on ? boxOn : {}) }}>{on ? "✓" : ""}</span>
      <span style={{ color: on ? "#8A8778" : "#22231F", textDecoration: on ? "line-through" : "none" }}>
        {rotulo}
      </span>
    </button>
  );
}

function NovaPostagem({ inicio, onFechar, onSalvo, onErro }) {
  const [data, setData] = useState(hoje() >= inicio && hoje() <= somaDias(inicio, 6) ? hoje() : inicio);
  const [hora, setHora] = useState("19:00");
  const [tipo, setTipo] = useState("reels");
  const [tema, setTema] = useState("");
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    setSalvando(true);
    const { error } = await supabase.from("postagens_planejadas").insert({
      data_prevista: data, hora_prevista: hora || null, tipo, tema: tema.trim() || null,
    });
    setSalvando(false);
    if (error) { onErro(error.message); return; }
    onSalvo();
  };

  return (
    <div style={{ ...cardStyle, marginBottom: 14 }}>
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={inputStyle} />
          <input type="time" value={hora} onChange={(e) => setHora(e.target.value)} style={inputStyle} />
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} style={inputStyle}>
            {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.n}</option>)}
          </select>
        </div>
        <input value={tema} onChange={(e) => setTema(e.target.value)}
          placeholder="Tema — ex.: bastidor da chapa" style={inputStyle} />
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={salvar} disabled={salvando} style={btnPrimary}>
            {salvando ? <Loader2 size={14} /> : <Check size={14} />} Salvar
          </button>
          <button onClick={onFechar} style={btnSecondary}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PLACAR — o operador vê também, então tudo tem que se explicar
// ---------------------------------------------------------------------------
function Placar({ ehAdmin }) {
  const [semanas, setSemanas] = useState([]);
  const [fechadas, setFechadas] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [aberto, setAberto] = useState(null);
  const [erro, setErro] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [v, f, c] = await Promise.all([
      supabase.from("v_pontos_semana").select("*").order("semana_inicio", { ascending: false }).limit(12),
      supabase.from("semanas_marketing").select("*").order("semana_inicio", { ascending: false }).limit(12),
      supabase.from("config_marketing").select("*").eq("id", 1).maybeSingle(),
    ]);
    setSemanas(v.data || []);
    setFechadas(f.data || []);
    setCfg(c.data);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const fechar = async (inicio) => {
    setErro(null);
    const { error } = await supabase.rpc("fechar_semana_marketing", { p_inicio: inicio });
    if (error) { setErro(error.message); return; }
    carregar();
  };

  if (carregando) return <Carregando />;

  const congeladas = new Set(fechadas.map((f) => f.semana_inicio));
  const pontosMes = fechadas
    .filter((f) => f.semana_inicio.slice(0, 7) === hoje().slice(0, 7))
    .reduce((s, f) => s + Number(f.pontos_total || 0), 0);
  const semanasMes = fechadas.filter((f) => f.semana_inicio.slice(0, 7) === hoje().slice(0, 7)).length;
  const media = semanasMes ? Math.round(pontosMes / semanasMes) : null;

  const faixas = Array.isArray(cfg?.faixas_bonus) ? cfg.faixas_bonus : [];
  const faixaAtual = media != null
    ? [...faixas].sort((a, b) => b.pontos - a.pontos).find((f) => media >= f.pontos)
    : null;
  const proxima = media != null
    ? [...faixas].sort((a, b) => a.pontos - b.pontos).find((f) => media < f.pontos)
    : null;

  if (aberto) return <DetalheSemana semana={aberto} onVoltar={() => setAberto(null)} />;

  return (
    <div>
      {erro && <Aviso texto={erro} />}

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <div style={statBox}>
          <div style={statNum}>{semanasMes}</div>
          <div style={statLabel}>semanas fechadas no mês</div>
        </div>
        <div style={statBox}>
          <div style={statNum}>{media ?? "—"}</div>
          <div style={statLabel}>média de pontos</div>
        </div>
      </div>

      {/* -------------------------------------------------- bônus */}
      <div style={{ ...cardStyle, background: "#22231F", borderColor: "#22231F", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7 }}>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778" }}>
            Pontos que valem bônus
          </span>
          <b style={{ fontSize: 19, color: "#F3EFE3", fontVariantNumeric: "tabular-nums" }}>{media ?? "—"}</b>
        </div>
        <div style={{ height: 9, borderRadius: 999, background: "#3A3B34", overflow: "hidden", marginBottom: 8 }}>
          <div style={{ height: "100%", width: `${Math.min(media || 0, 100)}%`, borderRadius: 999, background: "#2F8F5B" }} />
        </div>
        <div style={{ fontSize: 11, color: "#B9B5A6", lineHeight: 1.5 }}>
          {faixas.length === 0
            ? "As faixas de bônus ainda não foram definidas. O admin cadastra em Metas."
            : faixaAtual
              ? `Faixa atual: ${faixaAtual.pontos} pontos${faixaAtual.valor ? ` · R$ ${faixaAtual.valor}` : ""}.` +
                (proxima ? ` Faltam ${(proxima.pontos - media).toFixed(1)} pontos para a próxima.` : " É a faixa mais alta.")
              : proxima
                ? `Ainda abaixo da primeira faixa. Faltam ${(proxima.pontos - (media || 0)).toFixed(1)} pontos.`
                : "—"}
          {" "}Stories não entram nesta conta.
        </div>
      </div>

      {/* -------------------------------------------------- semanas */}
      <div style={sectionLabel}>Semanas</div>
      <div className="list-grid">
        {semanas.map((s) => {
          const congelada = congeladas.has(s.semana_inicio);
          const dados = congelada ? fechadas.find((f) => f.semana_inicio === s.semana_inicio) : s;
          const emAndamento = s.semana_inicio === segundaDa(hoje());
          return (
            <div key={s.semana_inicio} style={itemRow}>
              <button onClick={() => setAberto({ ...dados, congelada })}
                style={{ background: "none", border: "none", font: "inherit", cursor: "pointer", textAlign: "left", padding: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, color: "#22231F", display: "flex", alignItems: "center", gap: 5 }}>
                  {dataBR(s.semana_inicio)} a {dataBR(somaDias(s.semana_inicio, 6))}
                  {congelada && <Lock size={11} color="#8A8778" />}
                </div>
                <div style={{ fontSize: 10.5, color: "#8A8778" }}>
                  {dados.publicadas || 0} de {dados.planejadas || 0} publicadas
                  {emAndamento && " · em andamento"}
                </div>
              </button>
              <span style={{ fontSize: 13, fontWeight: 800, color: "#22231F", fontVariantNumeric: "tabular-nums" }}>
                {Number(dados.pontos_total || 0).toFixed(0)}
              </span>
              {ehAdmin && !congelada && !emAndamento && (
                <button onClick={() => fechar(s.semana_inicio)} style={{ ...btnSecondary, padding: "5px 9px", fontSize: 11 }}>
                  Fechar
                </button>
              )}
            </div>
          );
        })}
        {semanas.length === 0 && (
          <div style={{ ...cardStyle, fontSize: 12.5, color: "#8A8778" }}>
            Nenhuma semana com atividade ainda. Planeje postagens no calendário.
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, color: "#8A8778", marginTop: 12, lineHeight: 1.5, display: "flex", gap: 6 }}>
        <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          O cadeado marca semana congelada: os números não mudam mais, mesmo
          que uma coleta futura traga dado novo. Toque em qualquer semana para
          ver de onde os pontos saíram.
        </div>
      </div>
    </div>
  );
}

function DetalheSemana({ semana, onVoltar }) {
  const linhas = [
    ["Postagens planejadas", semana.planejadas ?? 0],
    ["Publicadas", semana.publicadas ?? 0],
    ["— destas, conferidas pelo robô", semana.confirmadas_robo ?? "—"],
    ["No dia planejado", semana.no_dia ?? 0],
    ["Reels", semana.reels_feitos ?? 0],
    ["Posts no feed", semana.posts_feitos ?? 0],
    ["Stories (na mão, fora do bônus)", semana.stories_feitos ?? 0],
    ["Janela alvo cumprida", semana.janela_cumprida ? "sim" : "não"],
    ["Seguidores ganhos", `+${semana.seguidores_ganhos ?? 0}`],
    ["Nosso engajamento", semana.eng_nosso != null ? `${semana.eng_nosso}%` : "—"],
    ["Engajamento da praça", semana.eng_praca != null ? `${semana.eng_praca}%` : "—"],
    ["Nosso crescimento", semana.cresc_nosso_pct != null ? `${semana.cresc_nosso_pct}%` : "—"],
    ["Crescimento da praça", semana.cresc_praca_pct != null ? `${semana.cresc_praca_pct}%` : "—"],
  ];

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
        <button onClick={onVoltar} style={iconBtn}><ChevronLeft size={17} /></button>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: "#22231F" }}>
            {dataBR(semana.semana_inicio)} a {dataBR(somaDias(semana.semana_inicio, 6))}
          </div>
          <div style={{ fontSize: 11, color: "#8A8778" }}>
            {semana.congelada ? "semana congelada" : "ainda pode mudar"}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <div style={statBox}>
          <div style={statNum}>{Number(semana.pontos_esforco || 0).toFixed(0)}</div>
          <div style={statLabel}>pontos de esforço</div>
        </div>
        <div style={statBox}>
          <div style={statNum}>{Number(semana.pontos_resultado || 0).toFixed(0)}</div>
          <div style={statLabel}>pontos de resultado</div>
        </div>
        <div style={statBox}>
          <div style={{ ...statNum, color: "#2F8F5B" }}>{Number(semana.pontos_total || 0).toFixed(0)}</div>
          <div style={statLabel}>total</div>
        </div>
      </div>

      <div style={sectionLabel}>De onde saiu cada número</div>
      <div className="list-grid">
        {linhas.map(([r, v]) => (
          <div key={r} style={itemRow}>
            <span style={{ fontSize: 12.5, color: "#22231F" }}>{r}</span>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: "#22231F", fontVariantNumeric: "tabular-nums" }}>{v}</span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, color: "#8A8778", marginTop: 12, lineHeight: 1.5 }}>
        Esforço vem do que foi planejado e cumprido — 60% publicar, 40% publicar
        no dia. Resultado compara nosso engajamento e crescimento com a praça,
        limitado a 2× para um pico isolado não distorcer o bônus.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// METAS — só admin. São os números que viram dinheiro.
// ---------------------------------------------------------------------------
function Config() {
  const [cfg, setCfg] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [ok, setOk] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("config_marketing").select("*").eq("id", 1).maybeSingle();
      setCfg(data);
    })();
  }, []);

  if (!cfg) return <Carregando />;

  const campo = (k, v) => setCfg((c) => ({ ...c, [k]: v }));

  const salvar = async () => {
    setSalvando(true); setErro(null); setOk(false);
    const { error } = await supabase.from("config_marketing").update({
      meta_reels: Number(cfg.meta_reels) || 0,
      meta_posts: Number(cfg.meta_posts) || 0,
      meta_stories: Number(cfg.meta_stories) || 0,
      meta_seguidores: Number(cfg.meta_seguidores) || 0,
      janela_dia: cfg.janela_dia === "" ? null : Number(cfg.janela_dia),
      janela_hora: cfg.janela_hora === "" ? null : Number(cfg.janela_hora),
      peso_esforco: Number(cfg.peso_esforco),
      peso_resultado: Number(cfg.peso_resultado),
      piso_qualidade: Number(cfg.piso_qualidade),
      faixas_bonus: cfg.faixas_bonus,
      atualizado_em: new Date().toISOString(),
    }).eq("id", 1);
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    setOk(true);
  };

  const faixas = Array.isArray(cfg.faixas_bonus) ? cfg.faixas_bonus : [];
  const mudarFaixa = (i, k, v) => {
    const novas = faixas.map((f, j) => (j === i ? { ...f, [k]: Number(v) || 0 } : f));
    campo("faixas_bonus", novas);
  };

  return (
    <div>
      <div style={sectionLabel}>Metas semanais</div>
      <div style={{ ...cardStyle, display: "grid", gap: 9, marginBottom: 14 }}>
        <Campo rotulo="Reels" valor={cfg.meta_reels} onChange={(v) => campo("meta_reels", v)} />
        <Campo rotulo="Posts no feed" valor={cfg.meta_posts} onChange={(v) => campo("meta_posts", v)} />
        <Campo rotulo="Stories (fora do bônus)" valor={cfg.meta_stories} onChange={(v) => campo("meta_stories", v)} />
        <Campo rotulo="Novos seguidores" valor={cfg.meta_seguidores} onChange={(v) => campo("meta_seguidores", v)} />
      </div>

      <div style={sectionLabel}>Janela alvo</div>
      <div style={{ ...cardStyle, display: "flex", gap: 8, marginBottom: 14, alignItems: "center" }}>
        <select value={cfg.janela_dia ?? ""} onChange={(e) => campo("janela_dia", e.target.value)} style={{ ...inputStyle, flex: 1 }}>
          <option value="">sem janela</option>
          {DIAS_CURTO.map((d, i) => <option key={i} value={i}>{d}</option>)}
        </select>
        <input type="number" min="0" max="23" value={cfg.janela_hora ?? ""}
          onChange={(e) => campo("janela_hora", e.target.value)}
          placeholder="hora" style={{ ...inputStyle, width: 78 }} />
      </div>

      <div style={sectionLabel}>Pesos do bônus</div>
      <div style={{ ...cardStyle, display: "grid", gap: 9, marginBottom: 14 }}>
        <Campo rotulo="Peso do esforço" valor={cfg.peso_esforco} passo="0.05"
          onChange={(v) => campo("peso_esforco", v)} />
        <Campo rotulo="Peso do resultado" valor={cfg.peso_resultado} passo="0.05"
          onChange={(v) => campo("peso_resultado", v)} />
        <Campo rotulo="Piso de qualidade" valor={cfg.piso_qualidade} passo="0.05"
          onChange={(v) => campo("piso_qualidade", v)} />
        <div style={{ fontSize: 10.5, color: "#8A8778", lineHeight: 1.45 }}>
          Os dois pesos devem somar 1. O piso é a fração da nossa média de
          engajamento abaixo da qual um post não conta como cumprido.
        </div>
      </div>

      <div style={sectionLabel}>Faixas de bônus</div>
      <div style={{ ...cardStyle, display: "grid", gap: 8, marginBottom: 14 }}>
        {faixas.length === 0 && (
          <div style={{ fontSize: 12, color: "#8A8778" }}>Nenhuma faixa cadastrada.</div>
        )}
        {faixas.map((f, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="number" value={f.pontos ?? 0} onChange={(e) => mudarFaixa(i, "pontos", e.target.value)}
              style={{ ...inputStyle, width: 84 }} />
            <span style={{ fontSize: 12, color: "#8A8778" }}>pontos →</span>
            <input type="number" value={f.valor ?? 0} onChange={(e) => mudarFaixa(i, "valor", e.target.value)}
              style={{ ...inputStyle, flex: 1 }} placeholder="R$" />
            <button onClick={() => campo("faixas_bonus", faixas.filter((_, j) => j !== i))} style={iconMini}>
              <Trash2 size={12} color="#C4432B" />
            </button>
          </div>
        ))}
        <button onClick={() => campo("faixas_bonus", [...faixas, { pontos: 70, valor: 0 }])} style={btnSecondary}>
          <Plus size={13} /> Faixa
        </button>
      </div>

      {erro && <Aviso texto={erro} />}
      {ok && (
        <div style={{ ...avisoOk, marginBottom: 12 }}>
          <Check size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>Metas salvas. Valem a partir da próxima semana aberta — semanas já congeladas não mudam.</div>
        </div>
      )}

      <button onClick={salvar} disabled={salvando} style={btnPrimary}>
        {salvando ? <Loader2 size={14} /> : <Check size={14} />} Salvar metas
      </button>
    </div>
  );
}

function Campo({ rotulo, valor, onChange, passo }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ fontSize: 12.5, color: "#22231F", flex: 1 }}>{rotulo}</span>
      <input type="number" step={passo || "1"} value={valor ?? ""}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...inputStyle, width: 92, textAlign: "right" }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
function Carregando() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#8A8778", fontSize: 13 }}>
      <Loader2 size={16} /> Carregando…
    </div>
  );
}
function Aviso({ texto }) {
  return (
    <div style={{ ...avisoStyle, marginBottom: 12 }}>
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
      <div>{texto}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estilos (mesma paleta do resto do painel)
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
const iconBtn = {
  width: 32, height: 32, borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#22231F",
};
const iconMini = {
  width: 24, height: 24, borderRadius: 6, border: "1px solid #E8E2D2", background: "#F6F1E7",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
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
const statBox = {
  flex: 1, background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12,
  padding: "11px 9px", textAlign: "center",
};
const statNum = { fontSize: 17, fontWeight: 800, color: "#22231F", fontVariantNumeric: "tabular-nums" };
const statLabel = { fontSize: 10.5, color: "#8A8778", marginTop: 2, lineHeight: 1.25 };
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
const boxStyle = {
  width: 15, height: 15, borderRadius: 4, border: "1.5px solid #E8E2D2", background: "#FFFFFF",
  flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 10, color: "#F3EFE3", fontWeight: 800,
};
const boxOn = { background: "#2F8F5B", borderColor: "#2F8F5B" };
const boxAuto = { background: "#22231F", borderColor: "#22231F" };
const tagBase = {
  fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999,
  border: "1px solid #E8E2D2", background: "#F6F1E7",
};
const seloMao = {
  fontSize: 8.5, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase",
  background: "#C9A22722", color: "#8A6E12", border: "1px solid #C9A22770",
  borderRadius: 999, padding: "0 5px",
};
const seloHoje = {
  fontSize: 8.5, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase",
  background: "#22231F", color: "#F3EFE3", borderRadius: 999, padding: "1px 6px",
};
