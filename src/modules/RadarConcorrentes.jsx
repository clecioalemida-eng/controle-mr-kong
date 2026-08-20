import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2, AlertTriangle, Play, Plus, Pencil, Trash2, Check, X,
  ChevronRight, ChevronLeft, TrendingUp, TrendingDown, Minus, Instagram,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";

// ---------------------------------------------------------------------------
// Radar de Concorrentes — aba do módulo Marketing
//
// Acompanha semanalmente o Instagram dos concorrentes e o do Mr. Kong.
// A série histórica de seguidores é NOSSA: o Instagram não guarda isso pra
// ninguém, então cada coleta deixa o histórico mais valioso que na semana
// anterior.
//
// Nenhum número é calculado aqui. Seguidores, variação, ritmo e engajamento
// vêm prontos da view v_perfis_radar, calculados em SQL — mesmo princípio
// do estoque e do custo de insumo composto.
//
// A coleta roda de forma assíncrona: a Edge Function dispara o ator na
// APIFY e devolve na hora; esta tela pergunta de tempos em tempos se
// terminou. Coleta demora minutos, e Edge Function não pode esperar tanto.
// ---------------------------------------------------------------------------

const INTERVALO_CHECAGEM = 8000;   // 8s entre uma checagem e outra
const TENTATIVAS_MAX = 45;         // desiste depois de ~6 minutos

const NOMES_TIPO = {
  reels: "Reels",
  carrossel: "Carrossel",
  foto: "Foto",
  video: "Vídeo",
  outro: "Outro",
};

function dataCurta(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function dataHora(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

function milhar(n) {
  if (n === null || n === undefined) return "—";
  return Number(n).toLocaleString("pt-BR");
}

export default function RadarConcorrentes() {
  const [perfis, setPerfis] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [aberto, setAberto] = useState(null);       // perfil sendo detalhado
  const [editando, setEditando] = useState(false);  // modo cadastro/edição

  // estado da coleta
  const [coletando, setColetando] = useState(false);
  const [statusColeta, setStatusColeta] = useState(null);
  const [resultado, setResultado] = useState(null);
  const timer = useRef(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase
      .from("v_perfis_radar")
      .select("*")
      .order("eh_proprio", { ascending: false })
      .order("seguidores", { ascending: false, nullsFirst: false });
    setCarregando(false);
    if (error) { setErro(error.message); return; }
    setPerfis(data || []);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // Limpa o timer se a pessoa sair da tela no meio de uma coleta.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const coletar = async () => {
    setColetando(true);
    setErro(null);
    setResultado(null);
    setStatusColeta("Acionando a APIFY…");

    const { data, error } = await supabase.functions.invoke("apify-proxy", {
      body: { acao: "iniciar_coleta" },
    });

    if (error || data?.error) {
      setColetando(false);
      setStatusColeta(null);
      setErro(await mensagemDeErro(error, data));
      return;
    }

    setStatusColeta(`Coletando ${data.perfis} perfis… costuma levar de 1 a 3 minutos.`);
    acompanhar(data.coleta_id, 0);
  };

  const acompanhar = (coletaId, tentativa) => {
    if (tentativa >= TENTATIVAS_MAX) {
      setColetando(false);
      setStatusColeta(null);
      setErro("A coleta está demorando mais que o normal. Ela continua rodando na APIFY — volte daqui a pouco e atualize a tela.");
      return;
    }

    timer.current = setTimeout(async () => {
      const { data, error } = await supabase.functions.invoke("apify-proxy", {
        body: { acao: "verificar_coleta", coleta_id: coletaId },
      });

      if (error || data?.error) {
        setColetando(false);
        setStatusColeta(null);
        setErro(await mensagemDeErro(error, data));
        return;
      }

      if (data.status === "rodando") {
        setStatusColeta(`Coletando… (${Math.round((tentativa + 1) * INTERVALO_CHECAGEM / 1000)}s)`);
        acompanhar(coletaId, tentativa + 1);
        return;
      }

      setColetando(false);
      setStatusColeta(null);

      if (data.status === "erro") {
        setErro("A coleta falhou na APIFY. Isso costuma ser o ator quebrando após uma mudança do Instagram — tente de novo em alguns minutos.");
        return;
      }

      setResultado(data);
      carregar();
    }, INTERVALO_CHECAGEM);
  };

  if (aberto) {
    return <Detalhe perfil={aberto} onVoltar={() => setAberto(null)} />;
  }

  if (editando) {
    return <Cadastro onVoltar={() => { setEditando(false); carregar(); }} />;
  }

  const proprio = perfis.find((p) => p.eh_proprio);
  const semColeta = perfis.every((p) => !p.ultima_coleta);

  return (
    <div>
      {/* ----------------------------------------------------- topo */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <button onClick={coletar} disabled={coletando} style={btnPrimary}>
          {coletando ? <Loader2 size={15} /> : <Play size={15} />}
          {coletando ? "Coletando…" : "Coletar agora"}
        </button>
        <button onClick={() => setEditando(true)} style={btnSecondary}>
          <Plus size={14} /> Perfis
        </button>
      </div>

      {statusColeta && (
        <div style={{ ...avisoNeutro, marginBottom: 14 }}>
          <Loader2 size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>{statusColeta}</div>
        </div>
      )}

      {erro && (
        <div style={{ ...avisoStyle, marginBottom: 14 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>{erro}</div>
        </div>
      )}

      {resultado && (
        <div style={{ ...avisoOk, marginBottom: 14 }}>
          <Check size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <b>{resultado.perfis_coletados} perfis coletados.</b>{" "}
            {resultado.posts_novos} posts novos, {resultado.posts_atualizados} atualizados.
            {resultado.custo_usd != null && (
              <> Custo desta coleta: US$ {Number(resultado.custo_usd).toFixed(3)}.</>
            )}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------- números do topo */}
      {!carregando && perfis.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <div style={statBox}>
            <div style={statNum}>{perfis.filter((p) => p.ativo).length}</div>
            <div style={statLabel}>perfis monitorados</div>
          </div>
          <div style={statBox}>
            <div style={statNum}>{proprio?.engajamento_pct != null ? `${proprio.engajamento_pct}%` : "—"}</div>
            <div style={statLabel}>nosso engajamento</div>
          </div>
          <div style={statBox}>
            <div style={statNum}>{proprio?.posts_7d ?? 0}</div>
            <div style={statLabel}>nossos posts na semana</div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------- lista */}
      {carregando ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#8A8778", fontSize: 13 }}>
          <Loader2 size={16} /> Carregando…
        </div>
      ) : perfis.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", color: "#8A8778", fontSize: 13, padding: 26 }}>
          <Instagram size={22} style={{ marginBottom: 8 }} />
          <div style={{ marginBottom: 12 }}>Nenhum perfil cadastrado ainda.</div>
          <button onClick={() => setEditando(true)} style={btnPrimary}>
            <Plus size={14} /> Cadastrar perfis
          </button>
        </div>
      ) : (
        <>
          {semColeta && (
            <div style={{ ...avisoStyle, marginBottom: 12 }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                Os perfis estão cadastrados, mas nenhuma coleta rodou ainda.
                Clique em <b>Coletar agora</b> para preencher a primeira semana.
              </div>
            </div>
          )}

          <div className="list-grid">
            {perfis.map((p) => (
              <button key={p.id} onClick={() => setAberto(p)} style={linhaPerfil}>
                <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                  <div style={{ ...avatarStyle, ...(p.eh_proprio ? avatarProprio : {}) }}>
                    {(p.nome || p.usuario).slice(0, 2).toUpperCase()}
                  </div>
                  <div style={{ minWidth: 0, textAlign: "left" }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#22231F", display: "flex", alignItems: "center", gap: 5 }}>
                      @{p.usuario}
                      {p.eh_proprio && <span style={selo}>nós</span>}
                    </div>
                    <div style={{ fontSize: 11, color: "#8A8778" }}>
                      {p.posts_7d} posts na semana
                      {p.engajamento_pct != null && ` · ${p.engajamento_pct}% eng.`}
                    </div>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#22231F", fontVariantNumeric: "tabular-nums" }}>
                      {milhar(p.seguidores)}
                    </div>
                    <Variacao valor={p.variacao_seguidores} />
                  </div>
                  <ChevronRight size={15} color="#8A8778" />
                </div>
              </button>
            ))}
          </div>

          <div style={{ fontSize: 11, color: "#8A8778", marginTop: 12, lineHeight: 1.5 }}>
            Última coleta: {dataHora(perfis.map((p) => p.ultima_coleta).filter(Boolean).sort().reverse()[0])}.
            Alcance e salvamentos de concorrente não aparecem aqui porque não
            existem em fonte nenhuma — nem na API oficial da Meta.
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variação de seguidores desde a coleta anterior
// ---------------------------------------------------------------------------
function Variacao({ valor }) {
  if (valor === null || valor === undefined) {
    return <span style={{ ...tagBase, color: "#8A8778" }}>1ª coleta</span>;
  }
  if (valor > 0) {
    return (
      <span style={{ ...tagBase, ...tagUp }}>
        <TrendingUp size={10} /> +{milhar(valor)}
      </span>
    );
  }
  if (valor < 0) {
    return (
      <span style={{ ...tagBase, ...tagDown }}>
        <TrendingDown size={10} /> {milhar(valor)}
      </span>
    );
  }
  return (
    <span style={{ ...tagBase, ...tagFlat }}>
      <Minus size={10} /> 0
    </span>
  );
}

// ---------------------------------------------------------------------------
// Detalhe de um perfil
// ---------------------------------------------------------------------------
function Detalhe({ perfil, onVoltar }) {
  const [snapshots, setSnapshots] = useState([]);
  const [posts, setPosts] = useState([]);
  const [formatos, setFormatos] = useState([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    (async () => {
      const [s, p, f] = await Promise.all([
        supabase.from("perfil_snapshots")
          .select("coletado_em, seguidores")
          .eq("perfil_id", perfil.id)
          .order("coletado_em", { ascending: true })
          .limit(52),
        supabase.from("posts_sociais")
          .select("*")
          .eq("perfil_id", perfil.id)
          .order("publicado_em", { ascending: false })
          .limit(12),
        supabase.from("v_formato_posts")
          .select("*")
          .eq("perfil_id", perfil.id)
          .order("qtd", { ascending: false }),
      ]);
      setSnapshots((s.data || []).filter((x) => x.seguidores != null));
      setPosts(p.data || []);
      setFormatos(f.data || []);
      setCarregando(false);
    })();
  }, [perfil.id]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
        <button onClick={onVoltar} style={iconBtn}><ChevronLeft size={17} /></button>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: "#22231F" }}>@{perfil.usuario}</div>
          <div style={{ fontSize: 11, color: "#8A8778" }}>
            {milhar(perfil.seguidores)} seguidores · {perfil.posts_30d} posts em 30 dias
          </div>
        </div>
      </div>

      {carregando ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#8A8778", fontSize: 13 }}>
          <Loader2 size={16} /> Carregando…
        </div>
      ) : (
        <>
          {/* --------------------------------------------- seguidores no tempo */}
          <div style={{ ...cardStyle, marginBottom: 12 }}>
            <div style={sectionLabel}>Seguidores · nosso histórico</div>
            {snapshots.length < 2 ? (
              <div style={{ fontSize: 12, color: "#8A8778", lineHeight: 1.5 }}>
                Só uma coleta até agora. A linha aparece a partir da segunda —
                e vai ficando mais útil a cada semana, porque esse histórico
                não existe em nenhuma outra ferramenta.
              </div>
            ) : (
              <Grafico pontos={snapshots} />
            )}
          </div>

          {/* --------------------------------------------- formatos */}
          {formatos.length > 0 && (
            <>
              <div style={sectionLabel}>Formato dos posts · 30 dias</div>
              <div style={{ ...cardStyle, marginBottom: 12, display: "grid", gap: 9 }}>
                {formatos.map((f) => (
                  <div key={f.tipo} style={{ display: "grid", gridTemplateColumns: "68px 1fr 38px", gap: 8, alignItems: "center", fontSize: 11.5 }}>
                    <span style={{ color: "#22231F" }}>{NOMES_TIPO[f.tipo] || f.tipo}</span>
                    <span style={{ height: 7, borderRadius: 999, background: "#E8E2D2", overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", width: `${f.percentual || 0}%`, background: "#22231F", borderRadius: 999 }} />
                    </span>
                    <span style={{ textAlign: "right", color: "#8A8778", fontVariantNumeric: "tabular-nums" }}>
                      {f.percentual}%
                    </span>
                  </div>
                ))}
                <div style={{ fontSize: 10.5, color: "#8A8778", borderTop: "1px solid #E8E2D2", paddingTop: 8 }}>
                  Média de interações por formato:{" "}
                  {formatos.map((f) => `${NOMES_TIPO[f.tipo] || f.tipo} ${milhar(f.interacao_media)}`).join(" · ")}
                </div>
              </div>
            </>
          )}

          {/* --------------------------------------------- posts */}
          <div style={sectionLabel}>Posts recentes</div>
          {posts.length === 0 ? (
            <div style={{ ...cardStyle, fontSize: 12, color: "#8A8778" }}>
              Nenhum post coletado ainda para este perfil.
            </div>
          ) : (
            <div className="list-grid">
              {posts.map((post) => (
                <div key={post.id} style={cardStyle}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                    <span style={tagNeutra}>{NOMES_TIPO[post.tipo] || post.tipo || "—"}</span>
                    <span style={{ fontSize: 11, color: "#8A8778" }}>
                      {post.publicado_em
                        ? new Date(post.publicado_em).toLocaleString("pt-BR", {
                            weekday: "short", day: "2-digit", month: "2-digit",
                            hour: "2-digit", minute: "2-digit",
                          })
                        : "—"}
                    </span>
                  </div>
                  {post.legenda && (
                    <div style={{ fontSize: 12.5, color: "#22231F", lineHeight: 1.4, marginBottom: 7 }}>
                      {post.legenda.length > 160 ? post.legenda.slice(0, 160) + "…" : post.legenda}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: "#8A8778", display: "flex", gap: 12 }}>
                    <span>♥ {milhar(post.curtidas)}</span>
                    <span>💬 {milhar(post.comentarios)}</span>
                    {post.visualizacoes != null && <span>▷ {milhar(post.visualizacoes)}</span>}
                    {post.url && (
                      <a href={post.url} target="_blank" rel="noreferrer"
                        style={{ marginLeft: "auto", color: "#8A8778" }}>
                        abrir
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gráfico de linha — desenhado à mão em SVG, sem biblioteca
// ---------------------------------------------------------------------------
function Grafico({ pontos }) {
  const L = 320, A = 56, pad = 3;
  const valores = pontos.map((p) => p.seguidores);
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const faixa = max - min || 1;

  const coords = pontos.map((p, i) => {
    const x = pontos.length === 1 ? L : (i / (pontos.length - 1)) * L;
    const y = A - pad - ((p.seguidores - min) / faixa) * (A - pad * 2);
    return [x, y];
  });

  const linha = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${linha} L${L},${A} L0,${A} Z`;
  const [ux, uy] = coords[coords.length - 1];
  const primeiro = valores[0];
  const ultimo = valores[valores.length - 1];
  const variacao = primeiro > 0 ? ((ultimo - primeiro) / primeiro) * 100 : 0;

  return (
    <>
      <svg viewBox={`0 0 ${L} ${A}`} preserveAspectRatio="none"
        style={{ width: "100%", height: 56, display: "block" }}
        role="img" aria-label="Seguidores ao longo das coletas">
        <path d={area} fill="#22231F14" />
        <path d={linha} fill="none" stroke="#22231F" strokeWidth="1.6" strokeLinejoin="round" />
        <circle cx={ux} cy={uy} r="3" fill="#C4432B" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8A8778", marginTop: 3 }}>
        <span>{dataCurta(pontos[0].coletado_em)} · {milhar(primeiro)}</span>
        <span style={{ fontWeight: 700, color: variacao >= 0 ? "#2F8F5B" : "#C4432B" }}>
          {variacao >= 0 ? "+" : ""}{variacao.toFixed(1)}% no período
        </span>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Cadastro de perfis — lápis e lixeira, igual às fichas técnicas
// ---------------------------------------------------------------------------
function Cadastro({ onVoltar }) {
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [novo, setNovo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [editandoId, setEditandoId] = useState(null);
  const [rascunho, setRascunho] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase
      .from("perfis_sociais")
      .select("*")
      .order("eh_proprio", { ascending: false })
      .order("usuario");
    setCarregando(false);
    if (error) { setErro(error.message); return; }
    setLista(data || []);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const limpar = (v) => v.trim().replace(/^@/, "").replace(/\s+/g, "").toLowerCase();

  const adicionar = async () => {
    const usuario = limpar(novo);
    if (usuario.length < 2) { setErro("Digite o @ do perfil."); return; }
    setSalvando(true);
    setErro(null);
    const { error } = await supabase.from("perfis_sociais").insert({
      plataforma: "instagram", usuario, eh_proprio: false, ativo: true,
    });
    setSalvando(false);
    if (error) {
      setErro(/duplicate|unique/i.test(error.message)
        ? "Esse perfil já está na lista."
        : error.message);
      return;
    }
    setNovo("");
    carregar();
  };

  const salvarEdicao = async (id) => {
    const usuario = limpar(rascunho);
    if (usuario.length < 2) return;
    await supabase.from("perfis_sociais").update({ usuario }).eq("id", id);
    setEditandoId(null);
    carregar();
  };

  const alternarAtivo = async (p) => {
    await supabase.from("perfis_sociais").update({ ativo: !p.ativo }).eq("id", p.id);
    carregar();
  };

  const remover = async (p) => {
    await supabase.from("perfis_sociais").delete().eq("id", p.id);
    carregar();
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
        <button onClick={onVoltar} style={iconBtn}><ChevronLeft size={17} /></button>
        <div style={{ fontWeight: 800, fontSize: 15, color: "#22231F" }}>Perfis monitorados</div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <input
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && adicionar()}
          placeholder="@ do concorrente"
          style={{ ...inputStyle, flex: 1 }}
        />
        <button onClick={adicionar} disabled={salvando} style={btnPrimary}>
          {salvando ? <Loader2 size={14} /> : <Plus size={14} />} Adicionar
        </button>
      </div>

      {erro && (
        <div style={{ ...avisoStyle, marginBottom: 12 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>{erro}</div>
        </div>
      )}

      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <div className="list-grid">
          {lista.map((p) => (
            <div key={p.id} style={{ ...itemRow, opacity: p.ativo ? 1 : 0.55 }}>
              {editandoId === p.id ? (
                <>
                  <input
                    value={rascunho}
                    onChange={(e) => setRascunho(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && salvarEdicao(p.id)}
                    style={{ ...inputStyle, flex: 1, padding: "6px 9px" }}
                    autoFocus
                  />
                  <button onClick={() => salvarEdicao(p.id)} style={iconMini}><Check size={14} color="#2F8F5B" /></button>
                  <button onClick={() => setEditandoId(null)} style={iconMini}><X size={14} color="#8A8778" /></button>
                </>
              ) : (
                <>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#22231F", display: "flex", alignItems: "center", gap: 5 }}>
                      @{p.usuario}
                      {p.eh_proprio && <span style={selo}>nós</span>}
                    </div>
                    {!p.ativo && <div style={{ fontSize: 10.5, color: "#8A8778" }}>pausado</div>}
                  </div>
                  <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
                    <button onClick={() => alternarAtivo(p)} style={iconMini} title={p.ativo ? "Pausar coleta" : "Voltar a coletar"}>
                      {p.ativo ? <Minus size={14} color="#8A8778" /> : <Play size={13} color="#2F8F5B" />}
                    </button>
                    <button onClick={() => { setEditandoId(p.id); setRascunho(p.usuario); }} style={iconMini}>
                      <Pencil size={13} color="#8A8778" />
                    </button>
                    {!p.eh_proprio && (
                      <button onClick={() => remover(p)} style={iconMini}>
                        <Trash2 size={13} color="#C4432B" />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 11, color: "#8A8778", marginTop: 12, lineHeight: 1.5 }}>
        Pausar um perfil para de coletar mas mantém todo o histórico já
        guardado. Apagar remove o perfil e o histórico junto — pausar é quase
        sempre a escolha certa.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// A mensagem de erro de verdade vem no corpo da resposta, que o supabase-js
// esconde atrás de um "non-2xx status code" genérico.
// ---------------------------------------------------------------------------
async function mensagemDeErro(error, data) {
  if (data?.error) return data.error + (data.detalhe ? ` — ${data.detalhe}` : "");
  let msg = error?.message || "Erro ao falar com a APIFY.";
  try {
    if (error?.context && typeof error.context.json === "function") {
      const corpo = await error.context.json();
      if (corpo?.error) msg = corpo.error + (corpo.detalhe ? ` — ${corpo.detalhe}` : "");
    }
  } catch (_) { /* mantém a genérica */ }
  return msg;
}

// ---------------------------------------------------------------------------
// Estilos (mesma paleta do resto do painel)
// ---------------------------------------------------------------------------
const cardStyle = {
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 13,
};
const itemRow = {
  display: "flex", alignItems: "center", gap: 8,
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10, padding: "9px 11px",
};
const linhaPerfil = {
  ...itemRow, justifyContent: "space-between", width: "100%",
  cursor: "pointer", font: "inherit", textAlign: "left",
};
const btnPrimary = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  background: "#22231F", color: "#F3EFE3", border: "none",
  borderRadius: 8, padding: "9px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer",
};
const btnSecondary = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F",
  borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const iconBtn = {
  width: 32, height: 32, borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#22231F",
};
const iconMini = {
  width: 26, height: 26, borderRadius: 7, border: "1px solid #E8E2D2", background: "#F6F1E7",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
};
const inputStyle = {
  padding: "9px 10px", borderRadius: 8, border: "1px solid #E8E2D2",
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
const avisoNeutro = {
  display: "flex", gap: 8, background: "#FFFFFF", border: "1px solid #E8E2D2",
  color: "#8A8778", borderRadius: 10, padding: "12px 13px", fontSize: 12.5,
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
const avatarStyle = {
  width: 30, height: 30, borderRadius: 999, flexShrink: 0,
  background: "#F6F1E7", border: "1px solid #E8E2D2",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontSize: 10.5, fontWeight: 800, color: "#8A8778",
};
const avatarProprio = { background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" };
const selo = {
  fontSize: 9, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase",
  background: "#22231F", color: "#F3EFE3", borderRadius: 999, padding: "1px 6px",
};
const tagBase = {
  display: "inline-flex", alignItems: "center", gap: 3,
  fontSize: 10.5, fontWeight: 700, padding: "1px 6px", borderRadius: 999,
  border: "1px solid #E8E2D2", background: "#F6F1E7",
};
const tagUp = { color: "#2F8F5B", borderColor: "#2F8F5B", background: "#2F8F5B14" };
const tagDown = { color: "#C4432B", borderColor: "#C4432B", background: "#C4432B14" };
const tagFlat = { color: "#C9A227", borderColor: "#C9A227", background: "#C9A22714" };
const tagNeutra = {
  fontSize: 10.5, fontWeight: 600, padding: "2px 7px", borderRadius: 999,
  border: "1px solid #E8E2D2", background: "#F6F1E7", color: "#8A8778",
};
