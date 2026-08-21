import React, { useState, useEffect, useCallback } from "react";
import {
  Loader2, AlertTriangle, Sparkles, Clock, History, Download,
  TrendingUp, AlertCircle, CircleAlert, Lightbulb,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";

// ---------------------------------------------------------------------------
// Diagnóstico do Radar — a terceira tela do mockup
//
// Mostra três coisas, nesta ordem:
//   1. Os números frios: que formato engaja mais, em que janela, quem lidera
//   2. A leitura da IA sobre esses números
//   3. O histórico — cada diagnóstico fica salvo com data e hora, pra dar
//      pra reabrir daqui a três meses e conferir se a leitura estava certa
//
// Nenhum número desta tela é calculado aqui nem pela IA. Tudo vem pronto
// das views do banco. A IA só interpreta.
// ---------------------------------------------------------------------------

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

const NOMES_TIPO = {
  reels: "Reels",
  carrossel: "Carrossel",
  foto: "Foto",
  video: "Vídeo",
  outro: "Outro",
};

const ESTILO_ACHADO = {
  positivo: { cor: "#2F8F5B", Icone: TrendingUp, rotulo: "vai bem" },
  atencao: { cor: "#C9A227", Icone: AlertCircle, rotulo: "oportunidade" },
  alerta: { cor: "#C4432B", Icone: CircleAlert, rotulo: "atenção" },
};

function dataHora(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}

export default function DiagnosticoSocial() {
  const [ultimo, setUltimo] = useState(null);
  const [historico, setHistorico] = useState([]);
  const [formatos, setFormatos] = useState([]);
  const [janelas, setJanelas] = useState([]);
  const [ranking, setRanking] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState(null);
  const [vendoHistorico, setVendoHistorico] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [d, f, h, r] = await Promise.all([
      supabase.from("diagnosticos_sociais").select("*").order("gerado_em", { ascending: false }).limit(20),
      supabase.from("v_desempenho_formato").select("*"),
      supabase.from("v_desempenho_horario").select("*").order("eng_medio_pct", { ascending: false }).limit(6),
      supabase.from("v_desempenho_perfil").select("*").order("eng_medio_pct", { ascending: false }),
    ]);
    setHistorico(d.data || []);
    setUltimo((d.data || [])[0] || null);
    setFormatos(f.data || []);
    setJanelas(h.data || []);
    setRanking(r.data || []);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const gerar = async () => {
    setGerando(true);
    setErro(null);
    const { data, error } = await supabase.functions.invoke("diagnostico-social", { body: {} });
    setGerando(false);
    if (error || data?.error) {
      setErro(await mensagemDeErro(error, data));
      return;
    }
    carregar();
  };

  if (carregando) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#8A8778", fontSize: 13 }}>
        <Loader2 size={16} /> Carregando…
      </div>
    );
  }

  if (vendoHistorico) {
    return <Historico lista={historico} onVoltar={() => setVendoHistorico(false)} />;
  }

  // Formato: separa o que é nosso do que é da praça, para comparar lado a lado
  const porTipo = {};
  for (const f of formatos) {
    if (!porTipo[f.tipo]) porTipo[f.tipo] = {};
    porTipo[f.tipo][f.lado] = f;
  }
  const tiposOrdenados = Object.entries(porTipo)
    .sort((a, b) => (b[1].concorrentes?.eng_medio_pct || 0) - (a[1].concorrentes?.eng_medio_pct || 0));

  const nos = ranking.find((p) => p.eh_proprio);
  const posicao = ranking.findIndex((p) => p.eh_proprio) + 1;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <button onClick={gerar} disabled={gerando} style={btnPrimary}>
          {gerando ? <Loader2 size={15} /> : <Sparkles size={15} />}
          {gerando ? "Analisando…" : ultimo ? "Gerar novo diagnóstico" : "Gerar diagnóstico"}
        </button>
        {ultimo && (
          <button
            onClick={() => baixarPdf({ diagnostico: ultimo, ranking, formatos, janelas })}
            style={btnSecondary}
            title="Abre o diálogo de impressão; escolha Salvar como PDF"
          >
            <Download size={14} /> Baixar PDF
          </button>
        )}
        {historico.length > 0 && (
          <button onClick={() => setVendoHistorico(true)} style={btnSecondary}>
            <History size={14} /> Anteriores ({historico.length})
          </button>
        )}
      </div>

      {erro && (
        <div style={{ ...avisoStyle, marginBottom: 14 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>{erro}</div>
        </div>
      )}

      {/* ------------------------------------------------ posição na praça */}
      {nos && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <div style={statBox}>
            <div style={statNum}>{posicao}º</div>
            <div style={statLabel}>em engajamento, entre {ranking.length}</div>
          </div>
          <div style={statBox}>
            <div style={statNum}>{nos.eng_medio_pct ?? "—"}%</div>
            <div style={statLabel}>nosso engajamento médio</div>
          </div>
          <div style={statBox}>
            <div style={statNum}>{nos.interacao_media ?? "—"}</div>
            <div style={statLabel}>interações por post</div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ a leitura da IA */}
      {ultimo ? (
        <div style={{ marginBottom: 20 }}>
          <div style={{ ...cardStyle, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginBottom: 7 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: "#22231F" }}>Leitura da semana</div>
              <div style={{ fontSize: 10.5, color: "#8A8778", display: "flex", alignItems: "center", gap: 4 }}>
                <Clock size={11} /> {dataHora(ultimo.gerado_em)}
              </div>
            </div>
            <div style={{ fontSize: 13, color: "#22231F", lineHeight: 1.55 }}>{ultimo.resumo}</div>
            <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 9, borderTop: "1px solid #E8E2D2", paddingTop: 8 }}>
              {ultimo.posts_analisados} posts de {ultimo.perfis_analisados} perfis · 60 dias
            </div>
          </div>

          <div className="list-grid">
            {(ultimo.achados || []).map((a, i) => {
              const e = ESTILO_ACHADO[a.tipo] || ESTILO_ACHADO.atencao;
              const Icone = e.Icone;
              return (
                <div key={i} style={{ ...cardStyle, borderLeft: `3px solid ${e.cor}` }}>
                  <div style={{ display: "flex", gap: 7, alignItems: "flex-start" }}>
                    <Icone size={15} color={e.cor} style={{ flexShrink: 0, marginTop: 1 }} />
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: "#22231F" }}>{a.titulo}</div>
                      <div style={{ fontSize: 12.5, color: "#8A8778", marginTop: 3, lineHeight: 1.5 }}>{a.texto}</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {ultimo.sugestao && (
            <div style={{ ...cardStyle, marginTop: 10, background: "#22231F", borderColor: "#22231F" }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <Lightbulb size={15} color="#C9A227" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778", marginBottom: 5 }}>
                    Para a próxima semana
                  </div>
                  <div style={{ fontSize: 13, color: "#F3EFE3", lineHeight: 1.55 }}>{ultimo.sugestao}</div>
                </div>
              </div>
            </div>
          )}

          <div style={{ fontSize: 11, color: "#8A8778", marginTop: 10, lineHeight: 1.5 }}>
            A leitura é da IA; os números são do banco. Ela interpreta, não calcula —
            e a decisão continua sendo sua.
          </div>
        </div>
      ) : (
        <div style={{ ...cardStyle, textAlign: "center", padding: 24, marginBottom: 20 }}>
          <Sparkles size={20} color="#8A8778" style={{ marginBottom: 8 }} />
          <div style={{ fontSize: 13, color: "#8A8778", lineHeight: 1.5 }}>
            Nenhum diagnóstico gerado ainda. Os números abaixo já estão prontos —
            clique em <b>Gerar diagnóstico</b> para a IA lê-los.
          </div>
        </div>
      )}

      {/* ------------------------------------------------ formato */}
      {tiposOrdenados.length > 0 && (
        <>
          <div style={sectionLabel}>Que formato engaja mais</div>
          <div style={{ ...cardStyle, marginBottom: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 62px 62px", gap: 6, fontSize: 10.5, color: "#8A8778", fontWeight: 700, marginBottom: 7, textTransform: "uppercase", letterSpacing: 0.3 }}>
              <span>Formato</span>
              <span style={{ textAlign: "right" }}>Praça</span>
              <span style={{ textAlign: "right" }}>Nós</span>
            </div>
            {tiposOrdenados.map(([tipo, lados]) => {
              const praca = lados.concorrentes;
              const nosso = lados.nos;
              const melhor = nosso && praca && nosso.eng_medio_pct > praca.eng_medio_pct;
              return (
                <div key={tipo} style={{ display: "grid", gridTemplateColumns: "1fr 62px 62px", gap: 6, alignItems: "center", padding: "6px 0", borderTop: "1px solid #F1EDE1", fontSize: 12.5 }}>
                  <span style={{ color: "#22231F" }}>
                    {NOMES_TIPO[tipo] || tipo}
                    <span style={{ color: "#8A8778", fontSize: 11 }}>
                      {" "}· {(praca?.posts || 0) + (nosso?.posts || 0)} posts
                    </span>
                  </span>
                  <span style={{ textAlign: "right", color: "#8A8778", fontVariantNumeric: "tabular-nums" }}>
                    {praca?.eng_medio_pct != null ? `${praca.eng_medio_pct}%` : "—"}
                  </span>
                  <span style={{ textAlign: "right", fontWeight: 700, fontVariantNumeric: "tabular-nums", color: nosso ? (melhor ? "#2F8F5B" : "#22231F") : "#8A8778" }}>
                    {nosso?.eng_medio_pct != null ? `${nosso.eng_medio_pct}%` : "—"}
                  </span>
                </div>
              );
            })}
            <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 8, lineHeight: 1.45 }}>
              Engajamento por seguidor, últimos 60 dias. Comparar assim é o que
              permite pôr um perfil de 28 mil ao lado de um de 4 mil.
            </div>
          </div>
        </>
      )}

      {/* ------------------------------------------------ janelas */}
      {janelas.length > 0 && (
        <>
          <div style={sectionLabel}>Melhores janelas de publicação</div>
          <div className="list-grid" style={{ marginBottom: 16 }}>
            {janelas.map((j, i) => (
              <div key={i} style={itemRow}>
                <span style={{ fontSize: 12.5, color: "#22231F" }}>
                  {DIAS[j.dia_semana]} · {String(j.hora).padStart(2, "0")}h
                  <span style={{ color: "#8A8778", fontSize: 11 }}>
                    {" "}· {j.posts} posts
                    {j.posts_nossos > 0 ? `, ${j.posts_nossos} nossos` : ", nenhum nosso"}
                  </span>
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: j.posts_nossos === 0 ? "#C9A227" : "#22231F", fontVariantNumeric: "tabular-nums" }}>
                  {j.eng_medio_pct}%
                </span>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "#8A8778", marginTop: -8, marginBottom: 16, lineHeight: 1.5 }}>
            Em amarelo, janelas que engajam bem e onde a gente não publica.
            Só entram horários com pelo menos 2 posts — uma publicação sortuda
            não vira "o melhor horário da praça".
          </div>
        </>
      )}

      {/* ------------------------------------------------ ranking */}
      {ranking.length > 0 && (
        <>
          <div style={sectionLabel}>Ranking de engajamento</div>
          <div className="list-grid">
            {ranking.map((p, i) => (
              <div key={p.perfil_id} style={{ ...itemRow, ...(p.eh_proprio ? { borderColor: "#22231F", borderWidth: 2 } : {}) }}>
                <span style={{ fontSize: 12.5, color: "#22231F", display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ color: "#8A8778", fontVariantNumeric: "tabular-nums", minWidth: 14 }}>{i + 1}</span>
                  @{p.usuario}
                  {p.eh_proprio && <span style={selo}>nós</span>}
                </span>
                <span style={{ fontSize: 11, color: "#8A8778", marginLeft: "auto", marginRight: 10 }}>
                  {p.interacao_media} int./post
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#22231F", fontVariantNumeric: "tabular-nums" }}>
                  {p.eng_medio_pct}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Histórico — é o que permite conferir depois se a leitura estava certa
// ---------------------------------------------------------------------------
function Historico({ lista, onVoltar }) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
        <button onClick={onVoltar} style={btnSecondary}>Voltar</button>
        <div style={{ fontWeight: 800, fontSize: 15, color: "#22231F" }}>Diagnósticos anteriores</div>
      </div>

      <div className="list-grid">
        {lista.map((d) => (
          <div key={d.id} style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "#8A8778", display: "flex", alignItems: "center", gap: 4 }}>
                <Clock size={11} /> {dataHora(d.gerado_em)}
              </span>
              <span style={{ fontSize: 10.5, color: "#8A8778" }}>
                {d.posts_analisados} posts
              </span>
            </div>
            <div style={{ fontSize: 12.5, color: "#22231F", lineHeight: 1.5 }}>{d.resumo}</div>
            {d.sugestao && (
              <div style={{ fontSize: 12, color: "#8A8778", marginTop: 7, borderTop: "1px solid #E8E2D2", paddingTop: 7, lineHeight: 1.5 }}>
                <b style={{ color: "#22231F" }}>Sugeriu:</b> {d.sugestao}
              </div>
            )}
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, color: "#8A8778", marginTop: 12, lineHeight: 1.5 }}>
        Guardar os diagnósticos antigos é o que permite descobrir se vale
        confiar na leitura da IA. Daqui a três meses, abra o de hoje e veja
        se o que ela sugeriu deu certo.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Baixar em PDF
//
// Sem biblioteca nenhuma: monta uma página limpa, formatada para A4, dentro
// de um iframe escondido e chama o diálogo de impressão do próprio sistema.
// No Mac, é só escolher "Salvar como PDF" no canto do diálogo.
//
// Por que não jsPDF ou html2canvas: as duas adicionariam dependência ao
// projeto (e risco no build da Vercel) para gerar um PDF de qualidade pior
// — imagem rasterizada em vez de texto selecionável e pesquisável.
//
// Usamos iframe em vez de window.open porque bloqueador de pop-up derruba
// a segunda opção mesmo quando o clique parte do usuário.
// ---------------------------------------------------------------------------
function baixarPdf({ diagnostico, ranking, formatos, janelas }) {
  const html = montarPaginaImpressao({ diagnostico, ranking, formatos, janelas });

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed", right: "0", bottom: "0",
    width: "0", height: "0", border: "0", visibility: "hidden",
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  // Espera o layout assentar antes de abrir o diálogo; sem isso, o Safari
  // às vezes imprime a página ainda em branco.
  setTimeout(() => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (_) { /* diálogo bloqueado — nada a fazer */ }
    // Só remove bem depois: tirar o iframe cedo demais cancela a impressão.
    setTimeout(() => {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 30000);
  }, 350);
}

function escapar(t) {
  return String(t ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function montarPaginaImpressao({ diagnostico, ranking, formatos, janelas }) {
  const gerado = new Date(diagnostico.gerado_em);
  // O nome do arquivo sugerido no diálogo vem do título da página.
  const titulo = `Diagnostico Radar ${gerado.toLocaleDateString("pt-BR").replace(/\//g, "-")}`;

  const cores = { positivo: "#2F8F5B", atencao: "#C9A227", alerta: "#C4432B" };
  const rotulos = { positivo: "Vai bem", atencao: "Oportunidade", alerta: "Atenção" };

  const achados = (diagnostico.achados || []).map((a) => `
    <div class="achado" style="border-left-color:${cores[a.tipo] || cores.atencao}">
      <div class="achado-topo">
        <span class="marcador" style="color:${cores[a.tipo] || cores.atencao}">
          ${rotulos[a.tipo] || rotulos.atencao}
        </span>
        <b>${escapar(a.titulo)}</b>
      </div>
      <p>${escapar(a.texto)}</p>
    </div>`).join("");

  const linhasRanking = (ranking || []).map((p, i) => `
    <tr${p.eh_proprio ? ' class="nosso"' : ""}>
      <td class="num">${i + 1}</td>
      <td>@${escapar(p.usuario)}${p.eh_proprio ? " <span class='selo'>nós</span>" : ""}</td>
      <td class="num">${p.seguidores != null ? Number(p.seguidores).toLocaleString("pt-BR") : "—"}</td>
      <td class="num">${p.posts_60d ?? "—"}</td>
      <td class="num">${p.interacao_media ?? "—"}</td>
      <td class="num forte">${p.eng_medio_pct != null ? p.eng_medio_pct + "%" : "—"}</td>
    </tr>`).join("");

  const nomesTipo = { reels: "Reels", carrossel: "Carrossel", foto: "Foto", video: "Vídeo", outro: "Outro" };
  const porTipo = {};
  for (const f of formatos || []) {
    if (!porTipo[f.tipo]) porTipo[f.tipo] = {};
    porTipo[f.tipo][f.lado] = f;
  }
  const linhasFormato = Object.entries(porTipo)
    .sort((a, b) => (b[1].concorrentes?.eng_medio_pct || 0) - (a[1].concorrentes?.eng_medio_pct || 0))
    .map(([tipo, l]) => `
      <tr>
        <td>${nomesTipo[tipo] || escapar(tipo)}</td>
        <td class="num">${(l.concorrentes?.posts || 0) + (l.nos?.posts || 0)}</td>
        <td class="num">${l.concorrentes?.eng_medio_pct != null ? l.concorrentes.eng_medio_pct + "%" : "—"}</td>
        <td class="num forte">${l.nos?.eng_medio_pct != null ? l.nos.eng_medio_pct + "%" : "—"}</td>
      </tr>`).join("");

  const dias = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const linhasJanela = (janelas || []).map((j) => `
    <tr>
      <td>${dias[j.dia_semana]} · ${String(j.hora).padStart(2, "0")}h</td>
      <td class="num">${j.posts}</td>
      <td class="num">${j.posts_nossos}</td>
      <td class="num forte">${j.eng_medio_pct}%</td>
    </tr>`).join("");

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>${titulo}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    color: #22231F; margin: 0; font-size: 10.5pt; line-height: 1.5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  h1 { font-size: 17pt; margin: 0 0 3px; letter-spacing: -0.2px; }
  h2 {
    font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.8px;
    color: #8A8778; margin: 20px 0 7px; border-bottom: 1px solid #E8E2D2;
    padding-bottom: 4px;
  }
  .cabecalho { border-bottom: 2px solid #22231F; padding-bottom: 9px; margin-bottom: 16px; }
  .meta { font-size: 9pt; color: #8A8778; }
  .resumo { font-size: 11pt; line-height: 1.6; margin: 0 0 4px; }
  .achado {
    border-left: 3px solid #C9A227; padding: 7px 0 7px 11px;
    margin-bottom: 9px; page-break-inside: avoid;
  }
  .achado-topo { display: flex; gap: 8px; align-items: baseline; }
  .achado p { margin: 3px 0 0; color: #55534A; font-size: 10pt; }
  .marcador { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; }
  .sugestao {
    background: #F6F1E7; border: 1px solid #E8E2D2; border-radius: 6px;
    padding: 11px 13px; page-break-inside: avoid;
  }
  .sugestao b { display: block; font-size: 8pt; text-transform: uppercase;
    letter-spacing: 0.6px; color: #8A8778; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  th {
    text-align: left; font-size: 7.5pt; text-transform: uppercase;
    letter-spacing: 0.5px; color: #8A8778; padding: 0 6px 5px 0; font-weight: 700;
  }
  td { padding: 5px 6px 5px 0; border-top: 1px solid #EFEBE0; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .forte { font-weight: 700; }
  tr.nosso td { background: #F6F1E7; font-weight: 600; }
  .selo {
    font-size: 7pt; background: #22231F; color: #F3EFE3;
    border-radius: 20px; padding: 1px 5px; font-weight: 700;
  }
  .rodape {
    margin-top: 22px; padding-top: 9px; border-top: 1px solid #E8E2D2;
    font-size: 8pt; color: #8A8778; line-height: 1.45;
  }
</style></head><body>

  <div class="cabecalho">
    <h1>Radar de Concorrentes</h1>
    <div class="meta">
      Mr. Kong Fast Food · Rio Verde (GO) &nbsp;·&nbsp;
      Gerado em ${gerado.toLocaleString("pt-BR")} &nbsp;·&nbsp;
      ${diagnostico.posts_analisados} posts de ${diagnostico.perfis_analisados} perfis
    </div>
  </div>

  <h2>Leitura da semana</h2>
  <p class="resumo">${escapar(diagnostico.resumo)}</p>

  ${achados ? `<h2>Achados</h2>${achados}` : ""}

  ${diagnostico.sugestao ? `
  <h2>Para a próxima semana</h2>
  <div class="sugestao"><b>Sugestão</b>${escapar(diagnostico.sugestao)}</div>` : ""}

  ${linhasRanking ? `
  <h2>Ranking de engajamento · 60 dias</h2>
  <table>
    <thead><tr>
      <th class="num">#</th><th>Perfil</th><th class="num">Seguidores</th>
      <th class="num">Posts</th><th class="num">Int./post</th><th class="num">Engaj.</th>
    </tr></thead>
    <tbody>${linhasRanking}</tbody>
  </table>` : ""}

  ${linhasFormato ? `
  <h2>Desempenho por formato</h2>
  <table>
    <thead><tr>
      <th>Formato</th><th class="num">Posts</th>
      <th class="num">Praça</th><th class="num">Nós</th>
    </tr></thead>
    <tbody>${linhasFormato}</tbody>
  </table>` : ""}

  ${linhasJanela ? `
  <h2>Melhores janelas de publicação</h2>
  <table>
    <thead><tr>
      <th>Janela</th><th class="num">Posts</th>
      <th class="num">Nossos</th><th class="num">Engaj.</th>
    </tr></thead>
    <tbody>${linhasJanela}</tbody>
  </table>` : ""}

  <div class="rodape">
    Engajamento = (curtidas + comentários) ÷ seguidores. É a métrica que
    permite comparar perfis de tamanhos diferentes.
    Os números são calculados no banco de dados a partir das coletas
    semanais; a leitura e a sugestão são geradas por IA sobre esses números.
    Alcance e salvamentos de concorrentes não constam porque não existem em
    fonte pública alguma.
  </div>

</body></html>`;
}

async function mensagemDeErro(error, data) {
  if (data?.error) return data.error + (data.detalhe ? ` — ${data.detalhe}` : "");
  let msg = error?.message || "Erro ao gerar o diagnóstico.";
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
  borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const avisoStyle = {
  display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A",
  color: "#7A6A1E", borderRadius: 10, padding: "12px 13px", fontSize: 12.5, lineHeight: 1.5,
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
const selo = {
  fontSize: 9, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase",
  background: "#22231F", color: "#F3EFE3", borderRadius: 999, padding: "1px 6px",
};
