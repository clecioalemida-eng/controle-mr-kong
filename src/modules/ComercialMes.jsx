import React, { useState, useRef, useEffect } from "react";
import { CheckCircle2, AlertTriangle, TrendingDown, TrendingUp, CalendarDays, Target } from "lucide-react";

// ---------------------------------------------------------------------------
// Comercial → aba Mês, parte de cima: a leitura didática do mês.
//
// Só desenha. Os números chegam prontos do PainelComercial (Comercial.jsx):
//   * manchete em frase + régua da meta
//   * três perguntas: quanto já vendi, quanto vendo por dia, quanto falta
//   * curva do mês somando noite a noite, contra os dois meses anteriores
//   * o que puxou para cima e para baixo (por linha de produto)
//   * "o que isso quer dizer": frases montadas a partir dos números
//   * qual noite da semana vende mais (é a média que faz a previsão)
// ---------------------------------------------------------------------------

const VERDE = "#2F8F5B";
const VERDE_CLARO = "#BFE3CD";
const VERMELHO = "#C4432B";
const ESCURO = "#22231F";
const CINZA = "#8A8778";
const CINZA_MEDIO = "#5C5A4E";
const CINZA_CLARO = "#B9B4A2";
const FUNDO = "#EFE9DA";
const AZUL = "#2A78D6";
const AZUL_CLARO = "#BCD6F2";

const card = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 16 };
const titulo = { fontSize: 15, fontWeight: 800, color: ESCURO };
const explica = { fontSize: 12, color: CINZA, marginTop: 2, lineHeight: 1.45 };
const num = { fontVariantNumeric: "tabular-nums" };

function brl(v) {
  return "R$ " + Math.round(Number(v) || 0).toLocaleString("pt-BR");
}
function mil(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) < 1000) return brl(n);
  return "R$ " + (n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil";
}
function pct(a, b) {
  return b ? ((a - b) / b) * 100 : null;
}
function pctAbs(p) {
  return `${Math.abs(Math.round(p))}%`;
}

// ============================================================================
// 1. Manchete + régua da meta
// ============================================================================
export function MancheteMes({ nomeMes, diaAte, noitesFaltam, previsao, jaVendido, resto, meta, porDiaAtual, porDiaAnterior, nomeAnterior, inteiroAnterior }) {
  const vsMeta = pct(previsao, meta);
  const difDia = porDiaAtual - porDiaAnterior;
  const max = Math.max(previsao, meta, inteiroAnterior || 0) * 1.04 || 1;
  const pos = (v) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;

  return (
    <div style={card}>
      <div style={{ fontSize: 12, color: CINZA }}>
        {nomeMes} · até a noite de {diaAte}{noitesFaltam > 0 ? ` · faltam ${noitesFaltam} ${noitesFaltam === 1 ? "dia" : "dias"}` : " · mês fechado"}
      </div>
      <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 22, lineHeight: 1.35, color: ESCURO, marginTop: 6 }}>
        {nomeMes} deve fechar em <b style={{ color: vsMeta >= 0 ? VERDE : VERMELHO }}>{mil(previsao)}</b>
        {vsMeta == null ? "." : Math.round(vsMeta) === 0 ? (vsMeta >= 0 ? ", em cima da meta." : ", quase na meta.") : vsMeta > 0 ? `, ${pctAbs(vsMeta)} acima da meta.` : `, ${pctAbs(vsMeta)} abaixo da meta.`}
        {porDiaAnterior > 0 && Math.abs(difDia) >= 1 && (
          <> Cada dia está rendendo <b style={{ color: difDia >= 0 ? VERDE : VERMELHO }}>{brl(Math.abs(difDia))} {difDia >= 0 ? "a mais" : "a menos"}</b> que em {nomeAnterior}.</>
        )}
      </div>

      <div style={{ fontSize: 12, color: CINZA, marginTop: 16, marginBottom: 6 }}>Régua da meta</div>
      <div style={{ position: "relative", height: 26, borderRadius: 7, background: FUNDO }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pos(jaVendido), background: VERDE, borderRadius: "7px 0 0 7px" }} />
        <div style={{ position: "absolute", left: pos(jaVendido), top: 0, bottom: 0, width: `calc(${pos(previsao)} - ${pos(jaVendido)})`,
          background: `repeating-linear-gradient(45deg, ${VERDE_CLARO} 0 6px, #E4F2E9 6px 12px)` }} />
        {inteiroAnterior > 0 && (
          <div title={`${nomeAnterior} inteiro`} style={{ position: "absolute", left: pos(inteiroAnterior), top: -5, bottom: -5, width: 2, background: CINZA_CLARO }} />
        )}
        <div title="meta" style={{ position: "absolute", left: pos(meta), top: -7, bottom: -7, width: 3, background: ESCURO, borderRadius: 2 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, marginTop: 8, flexWrap: "wrap" }}>
        <span style={{ color: VERDE, fontWeight: 700, ...num }}>vendido {mil(jaVendido)}</span>
        <span style={{ color: CINZA, ...num }}>
          <b style={{ color: ESCURO }}>▍meta {mil(meta)}</b>
          {inteiroAnterior > 0 ? <> · <span style={{ color: CINZA_CLARO }}>▍</span>{nomeAnterior} {mil(inteiroAnterior)}</> : null}
        </span>
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11.5, color: CINZA, marginTop: 8 }}>
        <Legenda cor={VERDE}>já vendido</Legenda>
        {resto > 0 && <Legenda listrado>esperado nos dias que faltam ({mil(resto)})</Legenda>}
      </div>
    </div>
  );
}

function Legenda({ cor, listrado, linha, tracejado, children }) {
  const amostra = linha
    ? { width: 16, height: 0, borderTop: `${linha}px ${tracejado ? "dashed" : "solid"} ${cor}` }
    : { width: 10, height: 10, borderRadius: 2, background: listrado ? `repeating-linear-gradient(45deg, ${VERDE_CLARO} 0 3px, #E4F2E9 3px 6px)` : cor };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={amostra} />{children}
    </span>
  );
}

// ============================================================================
// 2. Três perguntas
// ============================================================================
export function TresPerguntas({ jaVendido, anteriorMesmoDia, nomeAnterior, porDia, porDiaAnt, porDiaRet, nomeRetrasado, falta, noitesAbertas, normalPorNoite }) {
  const dif = jaVendido - anteriorMesmoDia;
  const precisaPorNoite = noitesAbertas > 0 ? falta / noitesAbertas : 0;
  const caixa = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: "12px 14px" };
  const pergunta = { fontSize: 12.5, color: CINZA_MEDIO };
  const grande = { fontSize: 22, fontWeight: 800, color: ESCURO, marginTop: 2, ...num };
  const sub = (cor) => ({ fontSize: 11.5, color: cor, marginTop: 3, lineHeight: 1.4, ...num });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
      <div style={caixa}>
        <div style={pergunta}>Quanto já vendi?</div>
        <div style={grande}>{brl(jaVendido)}</div>
        {anteriorMesmoDia > 0 && (
          <div style={sub(dif >= 0 ? VERDE : VERMELHO)}>
            {dif >= 0 ? "▲" : "▼"} {brl(Math.abs(dif))} {dif >= 0 ? "a mais" : "a menos"} que {nomeAnterior} no mesmo dia
          </div>
        )}
      </div>
      <div style={caixa}>
        <div style={pergunta}>Quanto vendo por dia, em média?</div>
        <div style={grande}>{brl(porDia)}</div>
        <div style={sub(porDia >= porDiaAnt ? VERDE : VERMELHO)}>
          {porDia >= porDiaAnt ? "▲" : "▼"} {nomeAnterior} {brl(porDiaAnt)}{porDiaRet > 0 ? ` · ${nomeRetrasado} ${brl(porDiaRet)}` : ""}
        </div>
      </div>
      <div style={caixa}>
        <div style={pergunta}>Quanto falta para a meta?</div>
        {falta <= 0 ? (
          <>
            <div style={{ ...grande, color: VERDE }}>Meta batida</div>
            <div style={sub(VERDE)}>{brl(-falta)} acima da meta</div>
          </>
        ) : (
          <>
            <div style={grande}>{brl(falta)}</div>
            {noitesAbertas > 0 ? (
              <div style={sub(precisaPorNoite <= normalPorNoite ? VERDE : VERMELHO)}>
                {brl(precisaPorNoite)} por noite aberta · o normal é {brl(normalPorNoite)}
              </div>
            ) : (
              <div style={sub(VERMELHO)}>O mês acabou sem bater a meta</div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// 3. Curva do mês (acumulado noite a noite)
// ============================================================================
// series: [{ nome, cor, pontos: [valor acumulado no dia 1, 2, ...], inicio (dia do 1º ponto), tracejado, grossa, area }]
export function CurvaDoMes({ series, meta, frase, aviso }) {
  const [hover, setHover] = useState(null);
  const ref = useRef(null);
  const caixa = useRef(null);
  // O desenho acompanha a largura real da tela, para a letra não encolher no celular.
  const [largura, setLargura] = useState(640);
  useEffect(() => {
    const el = caixa.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setLargura(Math.round(e.contentRect.width) || 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = Math.max(280, largura), H = W < 500 ? 210 : 230, L = 46, R = 12, T = 10, B = 24;
  const dias = 31;
  const todos = series.flatMap((s) => s.pontos.filter((v) => v != null));
  const maxY = Math.max(meta || 0, ...todos, 1) * 1.06;
  const x = (d) => L + ((d - 1) / (dias - 1)) * (W - L - R);
  const y = (v) => T + (1 - v / maxY) * (H - T - B);
  const passo = maxY > 120000 ? 40000 : maxY > 60000 ? 20000 : 10000;
  const marcas = [];
  for (let v = 0; v <= maxY; v += passo) marcas.push(v);

  const caminho = (s) => {
    const ini = s.inicio || 1;
    return s.pontos.map((v, i) => (v == null ? null : `${x(ini + i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
  };

  const mover = (ev) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = ((ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left) / r.width * W;
    const d = Math.round(((cx - L) / (W - L - R)) * (dias - 1)) + 1;
    setHover(d >= 1 && d <= dias ? d : null);
  };
  const valorNoDia = (s, d) => {
    const i = d - (s.inicio || 1);
    return i >= 0 && i < s.pontos.length ? s.pontos[i] : null;
  };

  return (
    <div style={card}>
      <div style={titulo}>{frase}</div>
      <div style={explica}>
        Soma do mês noite a noite. Quanto mais alta a linha no mesmo dia, melhor está o mês. Onde a linha fica reta, a casa não abriu.
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11.5, color: CINZA, margin: "10px 0 4px" }}>
        {series.map((s) => (
          <Legenda key={s.nome} cor={s.cor} linha={s.grossa ? 3 : 2} tracejado={s.tracejado}>{s.nome}</Legenda>
        ))}
        {meta > 0 && <Legenda cor={VERMELHO} linha={1} tracejado>meta</Legenda>}
      </div>
      <div ref={caixa} style={{ position: "relative" }}>
        <svg ref={ref} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", touchAction: "pan-y" }}
          onMouseMove={mover} onMouseLeave={() => setHover(null)} onTouchStart={mover} onTouchMove={mover}>
          {marcas.map((v) => (
            <g key={v}>
              <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#ECE6D6" strokeWidth="1" />
              <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill={CINZA}>{v === 0 ? "0" : `${Math.round(v / 1000)} mil`}</text>
            </g>
          ))}
          {(W < 500 ? [1, 10, 20, 30] : [1, 5, 10, 15, 20, 25, 30]).map((d) => (
            <text key={d} x={x(d)} y={H - 6} textAnchor="middle" fontSize="11" fill={CINZA}>{d}</text>
          ))}
          {meta > 0 && meta < maxY && (
            <line x1={L} x2={W - R} y1={y(meta)} y2={y(meta)} stroke={VERMELHO} strokeWidth="1" strokeDasharray="3 4" />
          )}
          {series.map((s) => {
            const pts = caminho(s);
            if (pts.length < 1) return null;
            const ini = s.inicio || 1;
            const ultimo = ini + s.pontos.length - 1;
            return (
              <g key={s.nome}>
                {s.area && pts.length > 1 && (
                  <polygon points={`${x(ini)},${y(0)} ${pts.join(" ")} ${x(ultimo)},${y(0)}`} fill={s.cor} opacity="0.1" />
                )}
                <polyline points={pts.join(" ")} fill="none" stroke={s.cor} strokeWidth={s.grossa ? 3 : 2}
                  strokeDasharray={s.tracejado ? "5 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}
          {hover && (
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke={CINZA_CLARO} strokeWidth="1" />
          )}
          {hover && series.map((s) => {
            const v = valorNoDia(s, hover);
            return v == null ? null : <circle key={s.nome} cx={x(hover)} cy={y(v)} r="4" fill={s.cor} stroke="#fff" strokeWidth="2" />;
          })}
        </svg>
        {hover && (
          <div style={{ position: "absolute", top: 4, [hover > 15 ? "left" : "right"]: W < 500 ? 8 : 54, background: "#FFFFFF", border: "1px solid #E8E2D2",
            borderRadius: 8, padding: "6px 9px", fontSize: 11.5, pointerEvents: "none", minWidth: 130 }}>
            <div style={{ fontWeight: 800, color: ESCURO, marginBottom: 2 }}>Dia {hover}</div>
            {series.map((s) => {
              const v = valorNoDia(s, hover);
              return v == null ? null : (
                <div key={s.nome} style={{ display: "flex", justifyContent: "space-between", gap: 10, ...num }}>
                  <span style={{ color: s.cor, fontWeight: 700 }}>{s.nome}</span><span>{mil(v)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {aviso && <div style={{ fontSize: 11, color: CINZA, marginTop: 6 }}>{aviso}</div>}
    </div>
  );
}

// ============================================================================
// 4. O que puxou para cima e para baixo (linhas de produto)
// ============================================================================
export function LinhasQuePuxaram({ linhas, comparacao }) {
  // linhas: [{ linha, atual, anterior }]
  const comDelta = linhas.map((l) => ({ ...l, delta: l.atual - l.anterior }))
    .filter((l) => Math.abs(l.delta) >= 1)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 8)
    .sort((a, b) => b.delta - a.delta);
  const max = Math.max(...comDelta.map((l) => Math.abs(l.delta)), 1);

  return (
    <div style={card}>
      <div style={titulo}>O que puxou para cima e para baixo</div>
      <div style={explica}>Por linha de produto, em R$, contra {comparacao}. Barra para a direita ganhou, para a esquerda perdeu.</div>
      {comDelta.length === 0 ? (
        <div style={{ fontSize: 12, color: CINZA, marginTop: 10 }}>Sem diferença por linha ainda.</div>
      ) : (
        <div style={{ display: "grid", gap: 9, marginTop: 12 }}>
          {comDelta.map((l) => {
            const w = `${Math.max(2, (Math.abs(l.delta) / max) * 50)}%`;
            const sobe = l.delta >= 0;
            return (
              <div key={l.linha} style={{ display: "grid", gridTemplateColumns: "minmax(0, 104px) 1fr 74px", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 12.5, color: ESCURO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={l.linha}>{l.linha}</span>
                <div style={{ position: "relative", height: 14 }}>
                  <div style={{ position: "absolute", left: "50%", top: -3, bottom: -3, width: 1, background: "#D9D2BE" }} />
                  <div style={{ position: "absolute", top: 0, bottom: 0, [sobe ? "left" : "right"]: "50%", width: w,
                    background: sobe ? VERDE : VERMELHO, borderRadius: sobe ? "0 4px 4px 0" : "4px 0 0 4px" }} />
                </div>
                <span style={{ fontSize: 12, fontWeight: 800, textAlign: "right", color: sobe ? VERDE : VERMELHO, ...num }}>
                  {sobe ? "+" : "−"}{mil(Math.abs(l.delta))}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// 5. O que isso quer dizer (frases)
// ============================================================================
const ICONES = {
  bom: { Icone: CheckCircle2, cor: VERDE },
  sobe: { Icone: TrendingUp, cor: VERDE },
  atencao: { Icone: AlertTriangle, cor: "#B07D12" },
  cai: { Icone: TrendingDown, cor: VERMELHO },
  semana: { Icone: CalendarDays, cor: CINZA_MEDIO },
  meta: { Icone: Target, cor: CINZA_MEDIO },
};

export function Leitura({ frases }) {
  return (
    <div style={card}>
      <div style={titulo}>O que isso quer dizer</div>
      <div style={explica}>Leitura em frases, montada com os números da tela.</div>
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {frases.length === 0 && <div style={{ fontSize: 12, color: CINZA }}>Ainda sem dados suficientes para comentar.</div>}
        {frases.map((f, i) => {
          const { Icone, cor } = ICONES[f.tipo] || ICONES.semana;
          return (
            <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 13, lineHeight: 1.5, color: ESCURO }}>
              <Icone size={17} color={cor} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>{f.texto}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// 6. Qual noite da semana vende mais
// ============================================================================
const NOMES_SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
// Ordem da semana do Mr Kong: abre na terça.
const ORDEM_SEMANA = [2, 3, 4, 5, 6, 0, 1];

export function NoitesDaSemana({ semana }) {
  // semana: [{ media, noites }] indexado por getDay()
  const abertas = semana.map((s, i) => ({ ...s, i })).filter((s) => s.noites > 0 && s.media >= 50);
  const max = Math.max(...abertas.map((s) => s.media), 1);
  const melhor = abertas.reduce((a, b) => (b.media > (a ? a.media : -1) ? b : a), null);
  const [toque, setToque] = useState(null);

  return (
    <div style={card}>
      <div style={titulo}>Qual noite da semana vende mais</div>
      <div style={explica}>Média de cada dia da semana nas últimas 8 semanas. É essa média que faz a previsão dos dias que faltam.</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 8, alignItems: "end", height: 150, marginTop: 14 }}>
        {ORDEM_SEMANA.map((i) => {
          const s = semana[i] || { media: 0, noites: 0 };
          const fechado = !(s.noites > 0 && s.media >= 50);
          const h = fechado ? 0 : Math.max(4, (s.media / max) * 110);
          const destaque = melhor && melhor.i === i;
          return (
            <div key={i} onClick={() => setToque(toque === i ? null : i)} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", cursor: "pointer" }}>
              <div style={{ fontSize: 10.5, color: destaque ? AZUL : CINZA, fontWeight: destaque ? 800 : 600, marginBottom: 4, whiteSpace: "nowrap", ...num }}>
                {fechado ? "fechado" : mil(s.media).replace("R$ ", "")}
              </div>
              <div style={{ width: "100%", maxWidth: 30, height: h, background: destaque ? AZUL : AZUL_CLARO, borderRadius: "4px 4px 0 0" }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 8, borderTop: "1px solid #D9D2BE", paddingTop: 5 }}>
        {ORDEM_SEMANA.map((i) => (
          <div key={i} style={{ textAlign: "center", fontSize: 11.5, color: CINZA_MEDIO, fontWeight: 700 }}>{NOMES_SEMANA[i]}</div>
        ))}
      </div>
      {toque != null && semana[toque] && semana[toque].noites > 0 && (
        <div style={{ fontSize: 11.5, color: CINZA, marginTop: 8 }}>
          {NOMES_SEMANA[toque]}: {brl(semana[toque].media)} em média, em {semana[toque].noites} {semana[toque].noites === 1 ? "noite" : "noites"}.
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Frases automáticas
// ============================================================================
export function montarFrases({ linhas, produtos, tresSeguidos, semana, previsao, meta, noitesAbertas }) {
  const frases = [];
  const comDelta = linhas.map((l) => ({ ...l, delta: l.atual - l.anterior }));
  const subiu = [...comDelta].sort((a, b) => b.delta - a.delta)[0];
  const caiu = [...comDelta].sort((a, b) => a.delta - b.delta)[0];
  const prodDelta = produtos.map((p) => ({ ...p, delta: p.atual - p.anterior }));

  if (subiu && subiu.delta >= 100) {
    const p = prodDelta.filter((x) => x.linha === subiu.linha && x.delta > 0).sort((a, b) => b.delta - a.delta)[0];
    frases.push({ tipo: "bom", texto: `A linha ${subiu.linha} é quem mais segura o mês: +${mil(subiu.delta)}${p ? `. Só ${p.produto} fez +${mil(p.delta)}` : ""}.` });
  }
  if (caiu && caiu.delta <= -100) {
    const p = prodDelta.filter((x) => x.linha === caiu.linha && x.delta < 0).sort((a, b) => a.delta - b.delta)[0];
    frases.push({ tipo: "atencao", texto: `A linha ${caiu.linha} caiu ${mil(-caiu.delta)}${p ? `, puxada por ${p.produto} (−${mil(-p.delta)})` : ""}. Vale oferecer mais no atendimento.` });
  }
  if (tresSeguidos[0]) {
    const t = tresSeguidos[0];
    frases.push({ tipo: "cai", texto: `${t.produto} cai há 3 meses seguidos: ${mil(t.v[2])} → ${mil(t.v[1])} → ${mil(t.v[0])}.` });
  }
  const abertas = semana.map((s, i) => ({ ...s, i })).filter((s) => s.noites > 0 && s.media >= 50);
  if (abertas.length >= 2) {
    const ord = [...abertas].sort((a, b) => b.media - a.media);
    const nome = (i) => ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"][i];
    const m = nome(ord[0].i), p = nome(ord[ord.length - 1].i);
    frases.push({ tipo: "semana", texto: `${m[0].toUpperCase() + m.slice(1)} é a melhor noite (${brl(ord[0].media)} em média). ${p[0].toUpperCase() + p.slice(1)} é a mais fraca (${brl(ord[ord.length - 1].media)}).` });
  }
  if (previsao < meta && noitesAbertas > 0) {
    const falta = meta - previsao;
    frases.push({ tipo: "meta", texto: `No ritmo de hoje a meta não sai: faltam ${mil(falta)} além do previsto, ou ${brl(falta / noitesAbertas)} a mais em cada noite aberta.` });
  } else if (previsao >= meta) {
    frases.push({ tipo: "sobe", texto: `No ritmo previsto a meta sai, com folga de ${mil(previsao - meta)}.` });
  }
  return frases;
}
