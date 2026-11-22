// ===== HistoricoPrecos.jsx =====
// Supply Chain → Preços: o histórico de preço de cada produto, para o
// departamento de compras.
//
// Funções da migração 195:
//   precos_em_alta(dias)  → o que mais subiu (e caiu) nas compras recentes,
//                           contra a média de 90 dias ponderada pela quantidade
//   historico_precos(id)  → cada compra do produto: data, fornecedor,
//                           quantidade e preço por unidade do insumo
//
// O preço é sempre o da unidade do insumo (kg, l, un), já convertido da
// embalagem da nota. Tocar numa compra que veio de nota abre a nota.

import React, { useState, useEffect, useMemo, useRef } from "react";
import { Loader2, AlertTriangle, Search, TrendingUp, TrendingDown, ExternalLink } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { chaveNome } from "../lib/insumoParecido";

const ESCURO = "#22231F", CINZA = "#8A8778", VERDE = "#2F8F5B", VERMELHO = "#C4432B", AZUL = "#2A78D6";

function brl(v, casas = 2) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: casas, maximumFractionDigits: casas });
}
function preco(v) { return brl(v, Number(v) < 1 ? 4 : 2); }
function dataBR(d) { if (!d) return ""; const [y, m, dd] = String(d).slice(0, 10).split("-"); return `${dd}/${m}/${y.slice(2)}`; }
function pctTxt(p) { if (p == null) return ""; const r = Math.round(p); return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)}%`; }
function diasAtras(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

async function abrirNota(caminho) {
  const aba = window.open("", "_blank"); // o Safari só abre aba no mesmo instante do clique
  const { data, error } = await supabase.storage.from("notas-fiscais").createSignedUrl(caminho, 3600);
  if (error || !data?.signedUrl) { if (aba) aba.close(); alert("Não consegui abrir a nota: " + (error?.message || "")); return; }
  if (aba) aba.location.href = data.signedUrl; else window.location.href = data.signedUrl;
}

export default function HistoricoPrecos() {
  const [alta, setAlta] = useState(null);
  const [insumos, setInsumos] = useState([]);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [escolhido, setEscolhido] = useState(null);
  const detalheRef = useRef(null);

  useEffect(() => {
    (async () => {
      const [ra, ri] = await Promise.all([
        supabase.rpc("precos_em_alta", { p_dias: 30 }),
        supabase.from("insumos").select("id, nome, unidade").order("nome"),
      ]);
      if (ra.error) {
        setErro(/does not exist|schema cache|Could not find/i.test(ra.error.message || "")
          ? "Falta rodar a migração 195 no Supabase." : ra.error.message);
        return;
      }
      setAlta(ra.data || []);
      setInsumos(ri.data || []);
    })();
  }, []);

  const escolher = (i) => {
    setEscolhido(i); setBusca("");
    setTimeout(() => detalheRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const achados = useMemo(() => {
    const t = chaveNome(busca);
    if (!t) return [];
    return insumos.filter((i) => chaveNome(i.nome).includes(t)).slice(0, 8);
  }, [busca, insumos]);

  if (erro) return <div style={aviso}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> {erro}</div>;
  if (!alta) return <div style={{ fontSize: 13, color: CINZA, display: "flex", gap: 6, alignItems: "center" }}><Loader2 size={14} /> Lendo as compras…</div>;

  const subiram = alta.filter((x) => Number(x.variacao) >= 3).slice(0, 10);
  const cairam = [...alta].filter((x) => Number(x.variacao) <= -3).sort((a, b) => a.variacao - b.variacao).slice(0, 6);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={card}>
        <div style={titulo}>Procurar um produto</div>
        <div style={{ position: "relative", marginTop: 8 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: CINZA }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Mussarela, batata, coca…"
            style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px 9px 30px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13.5, fontFamily: "inherit" }} />
        </div>
        {achados.map((i) => (
          <div key={i.id} onClick={() => escolher(i)} style={{ padding: "8px 2px", borderTop: "1px solid #EFE9DA", fontSize: 13, cursor: "pointer" }}>
            {i.nome} <span style={{ color: CINZA }}>· {i.unidade}</span>
          </div>
        ))}
      </div>

      <div style={card}>
        <div style={{ ...titulo, display: "flex", gap: 6, alignItems: "center" }}><TrendingUp size={16} color={VERMELHO} /> Subiram de preço</div>
        <div style={explica}>Comprados nos últimos 30 dias: o último preço pago contra a média de 90 dias, ponderada pela quantidade. Comece a negociar por aqui.</div>
        {subiram.length === 0 && <div style={{ fontSize: 12.5, color: VERDE, marginTop: 8 }}>Nenhum produto subiu mais de 3%.</div>}
        {subiram.map((x) => <LinhaAlta key={x.insumo_id} x={x} onAbrir={() => escolher({ id: x.insumo_id, nome: x.nome, unidade: x.unidade })} />)}
        {cairam.length > 0 && (
          <>
            <div style={{ ...titulo, fontSize: 13.5, display: "flex", gap: 6, alignItems: "center", marginTop: 14 }}><TrendingDown size={15} color={VERDE} /> Caíram</div>
            {cairam.map((x) => <LinhaAlta key={x.insumo_id} x={x} onAbrir={() => escolher({ id: x.insumo_id, nome: x.nome, unidade: x.unidade })} />)}
          </>
        )}
      </div>

      <div ref={detalheRef}>{escolhido && <Detalhe insumo={escolhido} />}</div>
    </div>
  );
}

function LinhaAlta({ x, onAbrir }) {
  const sobe = Number(x.variacao) > 0;
  const maisBarato = Number(x.menor_preco) < Number(x.ultimo_preco) - 0.0001;
  return (
    <div onClick={onAbrir} style={{ padding: "8px 0", borderTop: "1px solid #EFE9DA", cursor: "pointer" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.nome}</span>
        <span style={{ fontSize: 13.5, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{preco(x.ultimo_preco)}<span style={{ fontWeight: 400, color: CINZA, fontSize: 11 }}>/{x.unidade}</span></span>
        <span style={{ minWidth: 44, textAlign: "right", fontSize: 12, fontWeight: 700, color: sobe ? VERMELHO : VERDE }}>{pctTxt(x.variacao)}</span>
      </div>
      <div style={{ fontSize: 11, color: CINZA, fontVariantNumeric: "tabular-nums" }}>
        média {preco(x.media_90d)} · {dataBR(x.ultima_data)} · {x.ultimo_fornecedor}
        {maisBarato && <> · <span style={{ color: VERDE }}>mais barato: {preco(x.menor_preco)} em {x.menor_fornecedor}</span></>}
      </div>
    </div>
  );
}

function Detalhe({ insumo }) {
  const [linhas, setLinhas] = useState(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    setLinhas(null); setErro("");
    supabase.rpc("historico_precos", { p_insumo: insumo.id }).then(({ data, error }) => {
      if (error) setErro(error.message); else setLinhas(data || []);
    });
  }, [insumo.id]);

  if (erro) return <div style={aviso}><AlertTriangle size={16} /> {erro}</div>;
  if (!linhas) return <div style={card}><Loader2 size={14} /> Buscando as compras de {insumo.nome}…</div>;
  if (linhas.length === 0) {
    return <div style={card}><div style={titulo}>{insumo.nome}</div><div style={explica}>Nenhuma compra com preço registrada para este produto.</div></div>;
  }

  const ini90 = diasAtras(90);
  const r90 = linhas.filter((l) => String(l.data) >= ini90);
  const base = r90.length ? r90 : linhas;
  const qtdTotal = base.reduce((s, l) => s + Math.abs(Number(l.quantidade) || 0), 0);
  const media = qtdTotal ? base.reduce((s, l) => s + Math.abs(Number(l.quantidade) || 0) * Number(l.preco), 0) / qtdTotal
    : base.reduce((s, l) => s + Number(l.preco), 0) / base.length;
  const ultimo = linhas[0];
  const menor = [...base].sort((a, b) => a.preco - b.preco)[0];
  const vsMedia = media ? (ultimo.preco / media - 1) * 100 : null;

  // por fornecedor (90 dias, ou tudo se não houver compra recente)
  const porForn = new Map();
  base.forEach((l) => {
    const x = porForn.get(l.fornecedor) || { nome: l.fornecedor, q: 0, v: 0, vezes: 0, ultima: l.data };
    const q = Math.abs(Number(l.quantidade) || 0);
    x.q += q; x.v += q * Number(l.preco); x.vezes += 1;
    if (String(l.data) > String(x.ultima)) x.ultima = l.data;
    porForn.set(l.fornecedor, x);
  });
  const fornecedores = [...porForn.values()].map((f) => ({ ...f, media: f.q ? f.v / f.q : 0 })).sort((a, b) => a.media - b.media);

  return (
    <div style={card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
        <div style={titulo}>{insumo.nome} · {insumo.unidade}</div>
        <span style={{ fontSize: 12, color: CINZA }}>{linhas.length} compra{linhas.length > 1 ? "s" : ""} · desde {dataBR(linhas[linhas.length - 1].data)}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, margin: "10px 0" }}>
        <Numero titulo="Último preço" valor={preco(ultimo.preco)} sub={vsMedia != null ? `${vsMedia > 0 ? "▲" : "▼"} ${pctTxt(vsMedia)} contra a média` : ""} cor={vsMedia > 0 ? VERMELHO : VERDE} />
        <Numero titulo={r90.length ? "Média de 90 dias" : "Média (tudo)"} valor={preco(media)} sub="ponderada pela quantidade" cor={CINZA} />
        <Numero titulo="Mais barato" valor={preco(menor.preco)} sub={`${menor.fornecedor} · ${dataBR(menor.data)}`} cor={VERDE} />
      </div>
      <Grafico linhas={[...linhas].reverse()} media={media} />

      {fornecedores.length > 1 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: ESCURO, marginBottom: 4 }}>Por fornecedor{r90.length ? ", nos últimos 90 dias" : ""}</div>
          {fornecedores.map((f, k) => (
            <div key={f.nome} style={{ display: "flex", gap: 8, fontSize: 12.5, padding: "4px 0", borderTop: "1px solid #EFE9DA" }}>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.nome}{k === 0 && <span style={{ color: VERDE, fontWeight: 700 }}> · mais barato</span>}</span>
              <span style={{ color: CINZA }}>{f.vezes}×</span>
              <span style={{ fontWeight: 700, minWidth: 90, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{preco(f.media)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 420 }}>
          <thead>
            <tr style={{ color: CINZA, fontSize: 11 }}>
              <th style={th}>Data</th><th style={th}>Fornecedor</th><th style={{ ...th, textAlign: "right" }}>Qtd</th>
              <th style={{ ...th, textAlign: "right" }}>Preço/{insumo.unidade}</th><th style={{ ...th, textAlign: "right" }}>vs média</th><th style={th} />
            </tr>
          </thead>
          <tbody>
            {linhas.slice(0, 60).map((l, k) => {
              const p = media ? (l.preco / media - 1) * 100 : null;
              return (
                <tr key={k} onClick={() => l.arquivo_path && abrirNota(l.arquivo_path)} style={{ cursor: l.arquivo_path ? "pointer" : "default" }}>
                  <td style={td}>{dataBR(l.data)}</td>
                  <td style={{ ...td, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.fornecedor}</td>
                  <td style={{ ...td, textAlign: "right" }}>{Number(l.quantidade).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}</td>
                  <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{preco(l.preco)}</td>
                  <td style={{ ...td, textAlign: "right", color: p > 0.5 ? VERMELHO : p < -0.5 ? VERDE : CINZA }}>{pctTxt(p)}</td>
                  <td style={{ ...td, width: 18 }}>{l.arquivo_path && <ExternalLink size={12} color={CINZA} />}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {linhas.length > 60 && <div style={{ ...explica, marginTop: 6 }}>Mostrando as 60 compras mais recentes, de {linhas.length}.</div>}
      </div>
    </div>
  );
}

// preço por compra ao longo do tempo, com a média tracejada
function Grafico({ linhas, media }) {
  const caixa = useRef(null);
  const [largura, setLargura] = useState(600);
  useEffect(() => {
    const el = caixa.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setLargura(Math.round(e.contentRect.width) || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  if (linhas.length < 2) return null;
  const W = Math.max(260, largura), H = 140, L = 8, R = 8, T = 14, B = 20;
  const valores = linhas.map((l) => Number(l.preco));
  const min = Math.min(...valores, media) * 0.95, max = Math.max(...valores, media) * 1.05;
  const t0 = new Date(linhas[0].data).getTime(), t1 = new Date(linhas[linhas.length - 1].data).getTime();
  const x = (d) => L + (t1 > t0 ? (new Date(d).getTime() - t0) / (t1 - t0) : 0.5) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
  const pts = linhas.map((l) => `${x(l.data).toFixed(1)},${y(l.preco).toFixed(1)}`).join(" ");
  return (
    <div ref={caixa}>
      <svg width={W} height={H} style={{ display: "block" }}>
        <line x1={L} x2={W - R} y1={y(media)} y2={y(media)} stroke={CINZA} strokeDasharray="5 4" />
        <text x={W - R} y={y(media) - 4} textAnchor="end" fontSize="11" fill={CINZA}>média {preco(media)}</text>
        <polyline fill="none" stroke={AZUL} strokeWidth="2" points={pts} />
        {linhas.map((l, k) => <circle key={k} cx={x(l.data)} cy={y(l.preco)} r="3" fill={AZUL}><title>{`${dataBR(l.data)} · ${l.fornecedor} · ${preco(l.preco)}`}</title></circle>)}
        <text x={L} y={H - 5} fontSize="11" fill={CINZA}>{dataBR(linhas[0].data)}</text>
        <text x={W - R} y={H - 5} fontSize="11" fill={CINZA} textAnchor="end">{dataBR(linhas[linhas.length - 1].data)}</text>
      </svg>
    </div>
  );
}

function Numero({ titulo, valor, sub, cor }) {
  return (
    <div style={{ background: "#F7F3E9", borderRadius: 10, padding: "10px 12px", minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "#5C5A4E" }}>{titulo}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: ESCURO, fontVariantNumeric: "tabular-nums" }}>{valor}</div>
      {sub && <div style={{ fontSize: 11.5, color: cor, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</div>}
    </div>
  );
}

const card = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const titulo = { fontSize: 15, fontWeight: 800, color: ESCURO };
const explica = { fontSize: 12, color: CINZA, marginTop: 2, lineHeight: 1.45 };
const aviso = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: 12, fontSize: 13, alignItems: "flex-start" };
const th = { textAlign: "left", fontWeight: 700, padding: "6px 4px", borderBottom: "1px solid #E8E2D2" };
const td = { padding: "6px 4px", borderBottom: "1px solid #F0EBDD", fontVariantNumeric: "tabular-nums" };
