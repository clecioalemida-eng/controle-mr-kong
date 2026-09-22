import React, { useState, useEffect, useCallback } from "react";
import {
  ChevronLeft, AlertTriangle, CheckCircle2, Clock, Copy, TrendingUp, TrendingDown,
} from "lucide-react";
import { supabase, TABELA_CHECKLIST } from "../lib/supabaseClient";

// ---------------------------------------------------------------------------
// Módulo Comercial — Relatório do dia
//
// É a tela que a secretária abre todo dia (inclusive domingo) para mandar o
// relatório no grupo: vendas do dia, mês atual × mesmo período do mês
// passado, meta, e o checklist do dia (pendências e não conformidades).
// O botão "Copiar relatório" monta o texto pronto para o WhatsApp.
// Painel comercial (abaixo das vendas): 3 meses, linhas, hambúrgueres,
// altas/quedas e previsão do mês — ver PainelComercial.
//
// Vendas: função relatorio_vendas (migrações 126/127). Checklist: as mesmas
// tabelas do Checklist Operacional (checklist_itens e registros_checklist).
// ---------------------------------------------------------------------------

const TURNOS = ["abertura", "fechamento"];
const NOMES_DEPTO = { caixa: "Caixa", bar: "Bar", chapa: "Chapa", gerencia: "Gerência", garcom: "Garçom", cozinha: "Cozinha" };
function aparenciaDe(chave) {
  return { label: NOMES_DEPTO[chave] || String(chave || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) };
}
function pad(n) { return String(n).padStart(2, "0"); }
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
// Dia operacional: o turno das 17h às 3h é do dia em que abriu. Antes das
// 17h, a tela abre no dia anterior (de manhã a secretária reporta ontem).
function diaOperacional(date = new Date()) {
  const d = new Date(date);
  if (d.getHours() < 17) d.setDate(d.getDate() - 1);
  return toDateStr(d);
}
function formatDiaLabel(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
}

// ---------------------------------------------------------------------------
// Relatório diário (vendas) — migração 126
//
// Regra do dia: o turno das 17h às 3h é venda do dia em que ABRIU (sábado
// 17h → domingo 3h = sábado). O mês vem do cache (relatorio_vendas); o dia
// escolhido é conferido ao vivo no CardápioWeb, porque a madrugada do
// último dia pode ainda não ter entrado no cache.
// ---------------------------------------------------------------------------
const META_MES = 140000;
const DIAS_SEMANA = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

function brlInt(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function brl2(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function variacaoPct(atual, anterior) {
  if (!anterior) return null;
  return ((atual - anterior) / anterior) * 100;
}
function textoVar(p) {
  if (p == null) return "sem base";
  return `${p >= 0 ? "▲" : "▼"} ${Math.abs(p).toFixed(1).replace(".", ",")}%`;
}
function diaCurto(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return `${DIAS_SEMANA[dt.getDay()]} ${pad(d)}/${pad(m)}`;
}
function somarDiasStr(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return toDateStr(dt);
}
const NOMES_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

async function carregarVendasDoDia(dia) {
  const { data, error } = await supabase.rpc("relatorio_vendas", { p_dia: dia });
  if (error) {
    if (/sem_acesso/.test(error.message)) return { semAcesso: true };
    if (/does not exist|Could not find|schema cache/i.test(error.message)) {
      return { erro: "Falta rodar a migração 126 no banco." };
    }
    return { erro: error.message };
  }
  const v = { ...data, conferidoAoVivo: false };
  // confere o dia no CardápioWeb (5h do dia até 5h do dia seguinte)
  try {
    const { data: vivo, error: e2 } = await supabase.functions.invoke("cardapioweb-proxy", {
      body: {
        acao: "faturamento_periodo",
        data_inicio: `${dia}T05:00:00-03:00`,
        data_fim: `${somarDiasStr(dia, 1)}T04:59:59-03:00`,
      },
    });
    if (!e2 && vivo && typeof vivo.faturamento_bruto === "number") {
      v.mes_total = Number(v.mes_total) - Number(v.dia_total) + vivo.faturamento_bruto;
      v.mes_pedidos = Number(v.mes_pedidos) - Number(v.dia_pedidos) + (vivo.pedidos_fechados || 0);
      v.dia_total = vivo.faturamento_bruto;
      v.dia_pedidos = vivo.pedidos_fechados || 0;
      v.conferidoAoVivo = true;
    }
  } catch { /* fica o número do cache */ }
  return { vendas: v };
}

function montarTextoRelatorio({ dia, vendas, statusDia, alertas, deptKeys, previsaoMes }) {
  const linhas = [`*Mr. Kong · Relatório de ${diaCurto(dia)}*`, ""];
  if (vendas) {
    const ticket = vendas.dia_pedidos ? vendas.dia_total / vendas.dia_pedidos : 0;
    const [, mesAnt] = String(vendas.ant_ini).split("-").map(Number);
    const [, mesAt, diaNum] = dia.split("-").map(Number);
    const fimAnt = Number(String(vendas.ant_fim).slice(8, 10));
    linhas.push(`💰 *Vendas do dia:* ${brlInt(vendas.dia_total)} (${vendas.dia_pedidos} pedidos, ticket ${brl2(ticket)})`);
    linhas.push(`vs ${diaCurto(vendas.semana_passada)}: ${textoVar(variacaoPct(vendas.dia_total, vendas.semana_passada_total))}`);
    linhas.push("");
    linhas.push(`📅 *${NOMES_MES[mesAt - 1][0].toUpperCase() + NOMES_MES[mesAt - 1].slice(1)} até dia ${diaNum}:* ${brlInt(vendas.mes_total)}`);
    linhas.push(`vs ${NOMES_MES[mesAnt - 1]} 1–${fimAnt}: ${brlInt(vendas.ant_total)} → ${textoVar(variacaoPct(vendas.mes_total, vendas.ant_total))}`);
    const faltam = Math.max(0, META_MES - vendas.mes_total);
    const diasRest = vendas.dias_no_mes - diaNum;
    linhas.push(`Meta: ${Math.round((vendas.mes_total / META_MES) * 100)}%${faltam > 0 && diasRest > 0 ? ` · faltam ${brlInt(faltam / diasRest)}/dia` : ""}`);
    if (previsaoMes) linhas.push(`📈 Previsão do mês: ${brlInt(previsaoMes)} (${Math.round((previsaoMes / META_MES) * 100)}% da meta)`);
    linhas.push("");
  }
  let completos = 0;
  let totalEtapas = 0;
  const pendentes = [];
  deptKeys.forEach((k) => {
    TURNOS.forEach((etapa) => {
      const st = statusDia[`${k}:${etapa}`];
      if (!st || !st.total) return;
      totalEtapas += 1;
      if (st.ok) completos += 1;
      else pendentes.push(`${aparenciaDe(k).label} ${etapa === "abertura" ? "abert." : "fech."}`);
    });
  });
  linhas.push(`✅ *Checklist:* ${completos} de ${totalEtapas} completos`);
  if (pendentes.length) linhas.push(`⏳ Pendentes: ${pendentes.join(", ")}`);
  if (alertas.length) {
    linhas.push(`⚠️ ${alertas.length} não conformidade${alertas.length > 1 ? "s" : ""}:`);
    alertas.forEach((a) => linhas.push(`• ${a.dept} · ${a.item}${a.responsavel ? ` (${a.responsavel})` : ""}`));
  } else {
    linhas.push("Nenhuma não conformidade.");
  }
  return linhas.join("\n");
}

function VendasDoDia({ dia, vendas, erro, carregando }) {
  if (carregando) return <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando vendas…</div>;
  if (erro) return <div style={avisoBloqueio}><AlertTriangle size={16} /> {erro}</div>;
  if (!vendas) return null;
  const [, mesAt, diaNum] = dia.split("-").map(Number);
  const [, mesAnt] = String(vendas.ant_ini).split("-").map(Number);
  const fimAnt = Number(String(vendas.ant_fim).slice(8, 10));
  const ticket = vendas.dia_pedidos ? vendas.dia_total / vendas.dia_pedidos : 0;
  const ticketMes = vendas.mes_pedidos ? vendas.mes_total / vendas.mes_pedidos : 0;
  const ticketAnt = vendas.ant_pedidos ? vendas.ant_total / vendas.ant_pedidos : 0;
  const vDia = variacaoPct(vendas.dia_total, vendas.semana_passada_total);
  const vMes = variacaoPct(vendas.mes_total, vendas.ant_total);
  const faltam = Math.max(0, META_MES - vendas.mes_total);
  const diasRest = vendas.dias_no_mes - diaNum;
  const pctMeta = Math.min(100, Math.round((vendas.mes_total / META_MES) * 100));
  const cor = (p) => (p == null ? "#8A8778" : p >= 0 ? "#2F8F5B" : "#C4432B");
  const Seta = ({ p }) => (p == null ? null : p >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />);
  const Linha = ({ rot, children }) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "7px 0", borderBottom: "1px solid #EFE9DA", fontSize: 13 }}>
      <span style={{ color: "#5C5A4E" }}>{rot}</span><span style={{ textAlign: "right" }}>{children}</span>
    </div>
  );
  const nomeMes = NOMES_MES[mesAt - 1];
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ ...statBox, textAlign: "left" }}>
          <div style={statLabel}>{diaCurto(dia)}</div>
          <div style={statNum}>{brlInt(vendas.dia_total)}</div>
          <div style={statLabel}>{vendas.dia_pedidos} pedidos · ticket {brl2(ticket)}</div>
          <div style={{ fontSize: 12, marginTop: 6, color: cor(vDia), display: "flex", alignItems: "center", gap: 4, fontWeight: 700 }}>
            <Seta p={vDia} /> {textoVar(vDia)} <span style={{ color: "#8A8778", fontWeight: 400 }}>vs {diaCurto(vendas.semana_passada)}</span>
          </div>
        </div>
        <div style={{ ...statBox, textAlign: "left" }}>
          <div style={statLabel}>{nomeMes} até dia {diaNum}</div>
          <div style={statNum}>{brlInt(vendas.mes_total)}</div>
          <div style={statLabel}>média {brlInt(vendas.mes_total / Math.max(diaNum, 1))} por dia</div>
          <div style={{ fontSize: 12, marginTop: 6, color: cor(vMes), display: "flex", alignItems: "center", gap: 4, fontWeight: 700 }}>
            <Seta p={vMes} /> {textoVar(vMes)} <span style={{ color: "#8A8778", fontWeight: 400 }}>vs {NOMES_MES[mesAnt - 1]}</span>
          </div>
        </div>
      </div>
      <div style={cardStyle}>
        <div style={{ ...sectionLabel, marginBottom: 4 }}>Mês atual × mesmo período do mês passado</div>
        <Linha rot={`${nomeMes}, dias 1 a ${diaNum}`}><b>{brl2(vendas.mes_total)}</b></Linha>
        <Linha rot={`${NOMES_MES[mesAnt - 1]}, dias 1 a ${fimAnt}`}><b>{brl2(vendas.ant_total)}</b></Linha>
        <Linha rot="Diferença">
          <b style={{ color: cor(vMes) }}>{vendas.mes_total - vendas.ant_total >= 0 ? "+ " : "− "}{brl2(Math.abs(vendas.mes_total - vendas.ant_total))} ({textoVar(vMes)})</b>
        </Linha>
        <Linha rot="Pedidos">
          {vendas.mes_pedidos} × {vendas.ant_pedidos}{" "}
          <span style={{ color: cor(variacaoPct(vendas.mes_pedidos, vendas.ant_pedidos)), fontWeight: 700 }}>{textoVar(variacaoPct(vendas.mes_pedidos, vendas.ant_pedidos))}</span>
        </Linha>
        <Linha rot="Ticket médio">
          {brl2(ticketMes)} × {brl2(ticketAnt)}{" "}
          <span style={{ color: cor(variacaoPct(ticketMes, ticketAnt)), fontWeight: 700 }}>{textoVar(variacaoPct(ticketMes, ticketAnt))}</span>
        </Linha>
        <div style={{ fontSize: 12, color: "#8A8778", marginTop: 10 }}>
          Meta do mês {brlInt(META_MES)}
          {faltam > 0 && diasRest > 0 ? ` · faltam ${brlInt(faltam)} em ${diasRest} dias (${brlInt(faltam / diasRest)} por dia)` : faltam === 0 ? " · batida! 🎉" : ""}
        </div>
        <div style={{ height: 8, borderRadius: 99, background: "#EFE9DA", overflow: "hidden", margin: "6px 0 4px" }}>
          <div style={{ width: `${pctMeta}%`, height: "100%", background: "#2F8F5B" }} />
        </div>
        <div style={{ fontSize: 12, color: "#8A8778" }}>{pctMeta}% da meta</div>
        <div style={{ fontSize: 11, color: "#8A8778", marginTop: 8 }}>
          Turno das 17h às 3h conta no dia em que abriu. {vendas.conferidoAoVivo ? "O dia foi conferido agora no CardápioWeb." : "Dia pelo cache da madrugada (não deu para conferir ao vivo)."}
        </div>
      </div>
    </div>
  );
}


// ===========================================================================
// Painel comercial — últimos 3 meses, linhas, hambúrgueres, altas e quedas,
// previsão do mês.
//
// Regra de comparação: sempre os MESMOS DIAS de cada mês (1 até o dia do
// relatório). Comparar setembro até dia 21 com agosto inteiro seria injusto.
//
// Fontes (nada novo no banco):
//   • vendas_diarias           → faturamento por dia (cache da madrugada)
//   • desempenho_produtos/linhas → o que foi vendido, item a item
//     (migração 079, lê pedidos_cache). Chamada 2x: (mês, mês-1) e
//     (mês-1, mês-2), e as duas respostas são juntadas por produto.
//   • Previsão: o que já vendeu + para cada dia que falta, a média do MESMO
//     dia da semana nas últimas 8 semanas (sexta vende diferente de terça).
// ===========================================================================
const QUANTOS = 6;

function ymdDe(y, m0, d) { return toDateStr(new Date(y, m0, d)); }
function diasDoMes(y, m0) { return new Date(y, m0 + 1, 0).getDate(); }
function nomeMesCurto(m0) { const n = NOMES_MES[((m0 % 12) + 12) % 12]; return n.slice(0, 3); }
function nomeMesLongo(m0) { const n = NOMES_MES[((m0 % 12) + 12) % 12]; return n[0].toUpperCase() + n.slice(1); }
function pctTxt(p) { if (p == null) return "novo"; const r = Math.round(p); return r === 0 ? "0%" : `${r > 0 ? "+" : "−"}${Math.abs(r)}%`; }
function corVar(p) { return p == null ? "#2F6FA3" : p >= 0 ? "#2F8F5B" : "#C4432B"; }
function brlK(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1000) return `R$ ${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return brlInt(n);
}

// três janelas "dias 1..d": m0 = mês do relatório, m1 = anterior, m2 = retrasado
function janelas3(dia) {
  const [y, m, d] = dia.split("-").map(Number);
  const out = [0, 1, 2].map((k) => {
    const base = new Date(y, m - 1 - k, 1);
    const yy = base.getFullYear(), mm = base.getMonth();
    const dd = Math.min(d, diasDoMes(yy, mm));
    return { y: yy, m0: mm, ini: ymdDe(yy, mm, 1), fim: ymdDe(yy, mm, dd), fimMes: ymdDe(yy, mm, diasDoMes(yy, mm)), ate: dd, diasMes: diasDoMes(yy, mm) };
  });
  return out; // [atual, anterior, retrasado]
}

async function carregarPainel(dia) {
  const J = janelas3(dia);
  const [at, an, re] = J;
  const inicioHist = somarDiasStr(dia, -63) < re.ini ? somarDiasStr(dia, -63) : re.ini;
  const a1 = { p_inicio: at.ini, p_fim: at.fim, p_inicio_ant: an.ini, p_fim_ant: an.fim };
  const a2 = { p_inicio: an.ini, p_fim: an.fim, p_inicio_ant: re.ini, p_fim_ant: re.fim };
  const [rDias, rP1, rP2, rL1, rL2] = await Promise.all([
    supabase.from("vendas_diarias").select("dia, faturamento_bruto").gte("dia", inicioHist).lte("dia", at.fimMes).order("dia"),
    supabase.rpc("desempenho_produtos", a1),
    supabase.rpc("desempenho_produtos", a2),
    supabase.rpc("desempenho_linhas", a1),
    supabase.rpc("desempenho_linhas", a2),
  ]);
  const erroDias = rDias.error ? rDias.error.message : "";
  const fProd = rP1.error || rP2.error || rL1.error || rL2.error;
  let erroProd = "";
  if (fProd) {
    erroProd = /sem_acesso|permission|denied/i.test(fProd.message || "")
      ? "Seu cargo não vê o desempenho por produto."
      : /does not exist|schema cache|Could not find/i.test(fProd.message || "")
        ? "Falta a migração 079 (desempenho por produto) no banco."
        : fProd.message;
  }

  // ---- faturamento por dia
  const porDia = new Map();
  (rDias.data || []).forEach((l) => porDia.set(String(l.dia).slice(0, 10), Number(l.faturamento_bruto) || 0));
  const somaEntre = (ini, fim) => {
    let s = 0, n = 0;
    porDia.forEach((v, k) => { if (k >= ini && k <= fim) { s += v; n += 1; } });
    return { s, n };
  };
  const meses = J.map((j, k) => {
    const periodo = somaEntre(j.ini, j.fim);
    const inteiro = k === 0 ? null : somaEntre(j.ini, j.fimMes);
    return { ...j, periodo: periodo.s, diasNoCache: periodo.n, inteiro: inteiro ? inteiro.s : null, diasInteiroCache: inteiro ? inteiro.n : 0 };
  });

  // ---- média por dia da semana nas últimas 8 semanas (até o dia do relatório)
  const iniMedia = somarDiasStr(dia, -56);
  const porSemana = [[], [], [], [], [], [], []];
  porDia.forEach((v, k) => {
    if (k > iniMedia && k <= dia) {
      const [y, m, d] = k.split("-").map(Number);
      porSemana[new Date(y, m - 1, d).getDay()].push(v);
    }
  });
  const todos = porSemana.flat();
  const mediaGeral = todos.length ? todos.reduce((a, b) => a + b, 0) / todos.length : 0;
  const mediaSemana = porSemana.map((l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : mediaGeral));
  const diasQueFaltam = [];
  for (let k = at.ate + 1; k <= at.diasMes; k++) {
    const dt = new Date(at.y, at.m0, k);
    diasQueFaltam.push({ dia: toDateStr(dt), dow: dt.getDay(), media: mediaSemana[dt.getDay()] });
  }

  // ---- produtos: junta as duas respostas
  const prod = new Map();
  const pega = (nome) => {
    if (!prod.has(nome)) prod.set(nome, { produto: nome, linha: "", v: [0, 0, 0], q: [0, 0, 0] });
    return prod.get(nome);
  };
  (rP1.data || []).forEach((l) => {
    const p = pega(l.produto);
    p.linha = p.linha || l.linha || "";
    p.v[0] = Number(l.valor_atual) || 0; p.q[0] = Number(l.qtd_atual) || 0;
    p.v[1] = Number(l.valor_ant) || 0; p.q[1] = Number(l.qtd_ant) || 0;
  });
  (rP2.data || []).forEach((l) => {
    const p = pega(l.produto);
    p.linha = p.linha || l.linha || "";
    if (!p.v[1]) { p.v[1] = Number(l.valor_atual) || 0; p.q[1] = Number(l.qtd_atual) || 0; }
    p.v[2] = Number(l.valor_ant) || 0; p.q[2] = Number(l.qtd_ant) || 0;
  });
  const produtos = [...prod.values()].filter((p) => p.produto);

  const lin = new Map();
  const pegaL = (nome) => {
    const k = String(nome || "").trim() || "Sem linha definida";
    if (!lin.has(k)) lin.set(k, { linha: k, v: [0, 0, 0] });
    return lin.get(k);
  };
  (rL1.data || []).forEach((l) => { const x = pegaL(l.linha); x.v[0] = Number(l.valor_atual) || 0; x.v[1] = Number(l.valor_ant) || 0; });
  (rL2.data || []).forEach((l) => { const x = pegaL(l.linha); if (!x.v[1]) x.v[1] = Number(l.valor_atual) || 0; x.v[2] = Number(l.valor_ant) || 0; });
  const linhas = [...lin.values()].filter((l) => l.v.some((x) => x > 0));

  // quanto do faturamento de cada mês está detalhado item a item
  const detalhado = [0, 1, 2].map((k) => {
    const soma = linhas.reduce((s, l) => s + l.v[k], 0);
    return meses[k].periodo ? Math.round((soma / meses[k].periodo) * 100) : null;
  });

  return { meses, diasQueFaltam, produtos, linhas, detalhado, erroDias, erroProd: fProd ? erroProd : "" };
}

// Previsão = já vendido (número do topo, conferido ao vivo) + média por dia da semana dos dias que faltam
function calcularPrevisao(dados, mesTotal) {
  if (!dados) return null;
  const at = dados.meses[0];
  const jaVendido = mesTotal != null ? Number(mesTotal) : at.periodo;
  const resto = dados.diasQueFaltam.reduce((s, d) => s + d.media, 0);
  const ritmo = at.ate ? (jaVendido / at.ate) * at.diasMes : 0;
  return { jaVendido, resto, previsao: jaVendido + resto, ritmo, diasRestantes: dados.diasQueFaltam.length };
}

function Barra({ valor, max, cor = "#22231F", fundo = "#EFE9DA", altura = 8 }) {
  const w = max > 0 ? Math.max(2, Math.round((valor / max) * 100)) : 0;
  return (
    <div style={{ height: altura, borderRadius: 99, background: fundo, overflow: "hidden" }}>
      <div style={{ width: `${w}%`, height: "100%", background: cor, borderRadius: 99 }} />
    </div>
  );
}

function Chip({ p, sufixo }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: corVar(p), background: p == null ? "#E6EFF6" : p >= 0 ? "#E4F2E9" : "#F8E3DE",
      borderRadius: 99, padding: "2px 7px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
      {pctTxt(p)}{sufixo ? ` ${sufixo}` : ""}
    </span>
  );
}

function PainelComercial({ dia, mesTotal, onPrevisao }) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [verTodasLinhas, setVerTodasLinhas] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCarregando(true); setErro("");
    carregarPainel(dia).then((r) => { if (vivo) { setDados(r); setCarregando(false); } })
      .catch((e) => { if (vivo) { setErro(e.message || String(e)); setCarregando(false); } });
    return () => { vivo = false; };
  }, [dia]);

  const prev = calcularPrevisao(dados, mesTotal);
  useEffect(() => { if (onPrevisao) onPrevisao(prev ? prev.previsao : null); }, [prev && Math.round(prev.previsao)]); // eslint-disable-line

  if (carregando) return <div style={{ fontSize: 13, color: "#8A8778" }}>Montando o painel dos últimos 3 meses…</div>;
  if (erro) return <div style={avisoBloqueio}><AlertTriangle size={16} /> {erro}</div>;
  if (!dados) return null;

  const { meses, produtos, linhas, detalhado } = dados;
  const [at, an, re] = meses;
  const rotulo = (k) => nomeMesCurto(meses[k].m0);
  const faixa = `dias 1 a ${at.ate}`;
  const periodoAtual = mesTotal != null ? Number(mesTotal) : at.periodo;
  const valoresPeriodo = [periodoAtual, an.periodo, re.periodo];
  const maxMes = Math.max(prev ? prev.previsao : 0, an.inteiro || 0, re.inteiro || 0, 1);
  const vs = (a, b) => (b ? ((a - b) / b) * 100 : null);

  // ---- linhas
  const linhasOrd = [...linhas].sort((a, b) => b.v[0] - a.v[0]);
  const maxLinha = Math.max(...linhasOrd.map((l) => Math.max(l.v[0], l.v[1], l.v[2])), 1);
  const linhasVisiveis = verTodasLinhas ? linhasOrd : linhasOrd.slice(0, 8);
  const linhasComBase = linhasOrd.filter((l) => l.v[1] > 0 && l.linha !== "Sem linha definida");
  const linhaSobe = [...linhasComBase].sort((a, b) => (b.v[0] - b.v[1]) - (a.v[0] - a.v[1]))[0];
  const linhaCai = [...linhasComBase].sort((a, b) => (a.v[0] - a.v[1]) - (b.v[0] - b.v[1]))[0];

  // ---- hambúrgueres (linha com "hamb"; se ninguém tiver linha, usa os mais vendidos)
  const ehHamb = (p) => /hamb|burg|lanche/i.test(p.linha || "");
  let hamb = produtos.filter(ehHamb);
  const hambPorLinha = hamb.length > 0;
  if (!hambPorLinha) hamb = produtos;
  hamb = [...hamb].sort((a, b) => b.q[0] - a.q[0] || b.v[0] - a.v[0]).filter((p) => p.q[0] > 0 || p.q[1] > 0).slice(0, 10);
  const maxQ = Math.max(...hamb.map((p) => Math.max(...p.q)), 1);

  // ---- altas e quedas (R$ vs mesmo período do mês passado)
  const comDelta = produtos.map((p) => ({ ...p, delta: p.v[0] - p.v[1], pct: vs(p.v[0], p.v[1]) }));
  const altas = comDelta.filter((p) => p.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, QUANTOS);
  const quedas = comDelta.filter((p) => p.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, QUANTOS);
  const tresSeguidos = comDelta.filter((p) => p.v[2] > p.v[1] && p.v[1] > p.v[0] && p.v[2] > 0).sort((a, b) => (a.v[0] - a.v[2]) - (b.v[0] - b.v[2])).slice(0, 5);

  const cel = { fontSize: 12, fontVariantNumeric: "tabular-nums", textAlign: "right", whiteSpace: "nowrap" };
  const cab = { ...cel, fontSize: 10.5, color: "#8A8778", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 };
  const nome = { fontSize: 12.5, color: "#22231F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 };
  const grade = "repeat(3, minmax(0,1fr)) 56px";

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {/* ---------------- Previsão ---------------- */}
      {prev && (
        <div style={{ ...cardStyle, background: "#22231F", border: "none", color: "#F3EFE3" }}>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#B9B4A2" }}>
            Previsão de {NOMES_MES[at.m0]}
          </div>
          <div style={{ fontSize: 30, fontWeight: 800, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{brlInt(prev.previsao)}</div>
          <div style={{ fontSize: 12, color: "#D6D1BF", marginTop: 2 }}>
            {brlInt(prev.jaVendido)} vendidos + {brlInt(prev.resto)} esperados nos {prev.diasRestantes} dias que faltam
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, marginTop: 12 }}>
            {[
              { r: "vs meta", p: vs(prev.previsao, META_MES), sub: brlK(META_MES) },
              { r: `vs ${rotulo(1)} inteiro`, p: vs(prev.previsao, an.inteiro), sub: brlK(an.inteiro) },
              { r: `vs ${rotulo(2)} inteiro`, p: vs(prev.previsao, re.inteiro), sub: brlK(re.inteiro) },
            ].map((c) => (
              <div key={c.r} style={{ background: "#2E2F2A", borderRadius: 10, padding: "8px 10px" }}>
                <div style={{ fontSize: 10.5, color: "#B9B4A2" }}>{c.r}</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: c.p == null ? "#F3EFE3" : c.p >= 0 ? "#7FD19E" : "#F08A73", fontVariantNumeric: "tabular-nums" }}>
                  {c.p == null ? "—" : pctTxt(c.p)}
                </div>
                <div style={{ fontSize: 10.5, color: "#B9B4A2" }}>{c.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "#B9B4A2", marginTop: 10, lineHeight: 1.45 }}>
            Cada dia que falta vale a média do mesmo dia da semana nas últimas 8 semanas.
            No ritmo simples (média do mês × {at.diasMes} dias) daria {brlInt(prev.ritmo)}.
            {prev.previsao < META_MES ? ` Para bater a meta faltam ${brlInt(META_MES - prev.previsao)} além do previsto.` : " No ritmo previsto, a meta sai."}
          </div>
        </div>
      )}

      {/* ---------------- 3 meses ---------------- */}
      <div style={cardStyle}>
        <div style={{ ...sectionLabel, marginBottom: 10 }}>Últimos 3 meses</div>
        <div style={{ display: "grid", gap: 12 }}>
          {[0, 1, 2].map((k) => {
            const m = meses[k];
            const inteiro = k === 0 ? (prev ? prev.previsao : null) : m.inteiro;
            return (
              <div key={k}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, marginBottom: 5 }}>
                  <span style={{ fontWeight: 700, color: "#22231F" }}>{nomeMesLongo(m.m0)}{k === 0 ? " (previsto)" : ""}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", fontWeight: 700 }}>{inteiro != null ? brlInt(inteiro) : "—"}</span>
                </div>
                <div style={{ position: "relative", height: 14, borderRadius: 6, background: "#EFE9DA", overflow: "hidden" }}>
                  <div style={{ position: "absolute", inset: 0, width: `${Math.round(((inteiro || 0) / maxMes) * 100)}%`, background: k === 0 ? "#CFC7B1" : "#D9D2BE" }} />
                  <div style={{ position: "absolute", inset: 0, width: `${Math.round((valoresPeriodo[k] / maxMes) * 100)}%`, background: k === 0 ? "#2F8F5B" : "#5C5A4E" }} />
                </div>
                <div style={{ fontSize: 11, color: "#8A8778", marginTop: 4, display: "flex", justifyContent: "space-between", gap: 8 }}>
                  <span>{faixa}: <b style={{ color: "#22231F", fontVariantNumeric: "tabular-nums" }}>{brlInt(valoresPeriodo[k])}</b> · {brlInt(valoresPeriodo[k] / Math.max(m.ate, 1))}/dia</span>
                  {k < 2 && <Chip p={vs(valoresPeriodo[k], valoresPeriodo[k + 1])} sufixo={`vs ${rotulo(k + 1)}`} />}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: "#8A8778", marginTop: 10 }}>
          Barra escura = {faixa} de cada mês (comparação justa). Barra clara = mês inteiro.
          {an.diasInteiroCache < an.diasMes || re.diasInteiroCache < re.diasMes ? " Alguns dias antigos ainda não estão no cache de vendas — o total do mês pode estar menor." : ""}
        </div>
      </div>

      {dados.erroProd ? (
        <div style={avisoBloqueio}><AlertTriangle size={16} /> {dados.erroProd}</div>
      ) : (
        <>
          {/* ---------------- Linhas ---------------- */}
          <div style={cardStyle}>
            <div style={{ ...sectionLabel, marginBottom: 4 }}>Linhas de produto · {faixa}</div>
            {(linhaSobe || linhaCai) && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "6px 0 10px" }}>
                {linhaSobe && linhaSobe.v[0] > linhaSobe.v[1] && (
                  <span style={{ fontSize: 12, background: "#E4F2E9", color: "#1F6B43", borderRadius: 8, padding: "5px 9px" }}>
                    <TrendingUp size={12} style={{ verticalAlign: -2 }} /> Mais cresceu: <b>{linhaSobe.linha}</b> (+{brlInt(linhaSobe.v[0] - linhaSobe.v[1])})
                  </span>
                )}
                {linhaCai && linhaCai.v[0] < linhaCai.v[1] && (
                  <span style={{ fontSize: 12, background: "#F8E3DE", color: "#8E2F1D", borderRadius: 8, padding: "5px 9px" }}>
                    <TrendingDown size={12} style={{ verticalAlign: -2 }} /> Mais caiu: <b>{linhaCai.linha}</b> (−{brlInt(linhaCai.v[1] - linhaCai.v[0])})
                  </span>
                )}
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: grade, gap: "0 6px", alignItems: "center" }}>
              <span style={cab}>{rotulo(2)}</span><span style={cab}>{rotulo(1)}</span><span style={cab}>{rotulo(0)}</span><span style={cab}>vs {rotulo(1)}</span>
            </div>
            {linhasVisiveis.map((l) => {
              const p = vs(l.v[0], l.v[1]);
              return (
                <div key={l.linha} style={{ padding: "7px 0", borderTop: "1px solid #EFE9DA" }}>
                  <div style={{ ...nome, fontWeight: 600, marginBottom: 2 }} title={l.linha}>{l.linha}</div>
                  <div style={{ display: "grid", gridTemplateColumns: grade, gap: "0 6px", alignItems: "center" }}>
                    <span style={{ ...cel, color: "#8A8778" }}>{brlK(l.v[2])}</span>
                    <span style={{ ...cel, color: "#5C5A4E" }}>{brlK(l.v[1])}</span>
                    <span style={{ ...cel, fontWeight: 700 }}>{brlK(l.v[0])}</span>
                    <span style={cel}><Chip p={l.v[1] ? p : null} /></span>
                  </div>
                  <div style={{ marginTop: 4 }}><Barra valor={l.v[0]} max={maxLinha} cor={p == null || p >= 0 ? "#2F8F5B" : "#C4432B"} altura={4} /></div>
                </div>
              );
            })}
            {linhasOrd.length > 8 && (
              <button onClick={() => setVerTodasLinhas((v) => !v)} style={{ ...linkBtn, marginTop: 6 }}>
                {verTodasLinhas ? "Mostrar menos" : `Ver as ${linhasOrd.length} linhas`}
              </button>
            )}
          </div>

          {/* ---------------- Hambúrgueres ---------------- */}
          <div style={cardStyle}>
            <div style={{ ...sectionLabel, marginBottom: 4 }}>{hambPorLinha ? "Hambúrgueres mais vendidos" : "Produtos mais vendidos"} · unidades · {faixa}</div>
            {!hambPorLinha && (
              <div style={{ fontSize: 11, color: "#8A6A0F", marginBottom: 6 }}>Nenhum prato tem linha "Hambúrguer" ainda — mostrando todos. Defina a linha no Dashboard.</div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: grade, gap: "0 6px", alignItems: "center" }}>
              <span style={cab}>{rotulo(2)}</span><span style={cab}>{rotulo(1)}</span><span style={cab}>{rotulo(0)}</span><span style={cab}>vs {rotulo(1)}</span>
            </div>
            {hamb.map((p, i) => (
              <div key={p.produto} style={{ padding: "7px 0", borderTop: "1px solid #EFE9DA" }}>
                <div style={{ ...nome, marginBottom: 2 }} title={p.produto}><b style={{ color: "#8A8778", fontWeight: 700, marginRight: 6 }}>{i + 1}</b>{p.produto}</div>
                <div style={{ display: "grid", gridTemplateColumns: grade, gap: "0 6px", alignItems: "center" }}>
                  <span style={{ ...cel, color: "#8A8778" }}>{p.q[2]}</span>
                  <span style={{ ...cel, color: "#5C5A4E" }}>{p.q[1]}</span>
                  <span style={{ ...cel, fontWeight: 700 }}>{p.q[0]}</span>
                  <span style={cel}><Chip p={p.q[1] ? vs(p.q[0], p.q[1]) : null} /></span>
                </div>
                <div style={{ marginTop: 4 }}><Barra valor={p.q[0]} max={maxQ} altura={4} cor="#22231F" /></div>
              </div>
            ))}
          </div>

          {/* ---------------- Altas e quedas ---------------- */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
            {[
              { titulo: "Maiores crescimentos", lista: altas, cor: "#2F8F5B", vazio: "Nenhum produto cresceu." },
              { titulo: "Maiores perdas", lista: quedas, cor: "#C4432B", vazio: "Nenhum produto caiu." },
            ].map((b) => (
              <div key={b.titulo} style={cardStyle}>
                <div style={{ ...sectionLabel, marginBottom: 2 }}>{b.titulo}</div>
                <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 6 }}>em R$, {rotulo(0)} × {rotulo(1)} ({faixa})</div>
                {b.lista.length === 0 ? <div style={{ fontSize: 12, color: "#8A8778" }}>{b.vazio}</div> : b.lista.map((p) => (
                  <div key={p.produto} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0", borderTop: "1px solid #EFE9DA" }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={nome} title={p.produto}>{p.produto}</div>
                      <div style={{ fontSize: 11, color: "#8A8778", fontVariantNumeric: "tabular-nums" }}>
                        {brlInt(p.v[1])} → {brlInt(p.v[0])}{p.linha ? ` · ${p.linha}` : ""}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: b.cor, fontVariantNumeric: "tabular-nums" }}>
                        {p.delta >= 0 ? "+" : "−"}{brlInt(Math.abs(p.delta))}
                      </div>
                      <div style={{ fontSize: 11, color: b.cor }}>{p.v[1] ? pctTxt(p.pct) : "novo"}</div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>

          {tresSeguidos.length > 0 && (
            <div style={{ ...cardStyle, background: "#FBF3D9", borderColor: "#E8D48A" }}>
              <div style={{ ...sectionLabel, color: "#7A6A1E", marginBottom: 6 }}>Caindo há 3 meses seguidos</div>
              {tresSeguidos.map((p) => (
                <div key={p.produto} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "4px 0" }}>
                  <span style={nome}>{p.produto}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", color: "#7A6A1E", whiteSpace: "nowrap" }}>
                    {brlK(p.v[2])} → {brlK(p.v[1])} → {brlK(p.v[0])}
                  </span>
                </div>
              ))}
            </div>
          )}

          {detalhado.some((x) => x != null && x < 80) && (
            <div style={{ fontSize: 11, color: "#8A8778" }}>
              Parte da venda ainda não tem o detalhe item a item ({[0, 1, 2].map((k) => `${rotulo(k)} ${detalhado[k] == null ? "—" : detalhado[k] + "%"}`).join(" · ")}).
              Os números de produto e linha usam só a parte detalhada.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ===========================================================================
export default function Comercial({ onVoltar }) {
  const [dia, setDia] = useState(diaOperacional());
  const [vendas, setVendas] = useState(null);
  const [vendasErro, setVendasErro] = useState("");
  const [vendasSemAcesso, setVendasSemAcesso] = useState(false);
  const [carregandoVendas, setCarregandoVendas] = useState(true);
  const [deptKeys, setDeptKeys] = useState([]);
  const [statusDia, setStatusDia] = useState({});
  const [alertas, setAlertas] = useState([]);
  const [checkErro, setCheckErro] = useState("");
  const [carregandoCheck, setCarregandoCheck] = useState(true);
  const [copiado, setCopiado] = useState(false);
  const [previsaoMes, setPrevisaoMes] = useState(null);

  useEffect(() => {
    let vivo = true;
    setCarregandoVendas(true);
    setVendasErro("");
    carregarVendasDoDia(dia).then((r) => {
      if (!vivo) return;
      setCarregandoVendas(false);
      setVendasSemAcesso(!!r.semAcesso);
      setVendas(r.vendas || null);
      setVendasErro(r.erro || "");
    });
    return () => { vivo = false; };
  }, [dia]);

  const carregarChecklist = useCallback(async (d) => {
    setCarregandoCheck(true);
    setCheckErro("");
    const [itensR, regsR] = await Promise.all([
      supabase.from("checklist_itens").select("departamento, turno").eq("ativo", true),
      supabase.from(TABELA_CHECKLIST).select("*").eq("dia_operacional", d),
    ]);
    setCarregandoCheck(false);
    if (itensR.error || regsR.error) {
      setCheckErro("Não deu para ler o checklist: " + (itensR.error || regsR.error).message);
      return;
    }
    const totais = {};
    (itensR.data || []).forEach((i) => {
      const k = `${i.departamento}:${i.turno}`;
      totais[k] = (totais[k] || 0) + 1;
    });
    const deps = [...new Set((itensR.data || []).map((i) => i.departamento))];
    const status = {};
    deps.forEach((dep) => TURNOS.forEach((t) => {
      status[`${dep}:${t}`] = { preenchido: 0, total: totais[`${dep}:${t}`] || 0, ok: false };
    }));
    const novos = [];
    (regsR.data || []).forEach((row) => {
      const total = totais[`${row.departamento}:${row.etapa}`] || 0;
      const entries = Object.entries(row.itens || {});
      status[`${row.departamento}:${row.etapa}`] = { preenchido: entries.length, total, ok: entries.length === total && total > 0 };
      entries.forEach(([item, st]) => {
        if (st === "nao_conforme") novos.push({ dept: aparenciaDe(row.departamento).label, etapa: row.etapa, item, responsavel: row.responsavel });
      });
    });
    setDeptKeys(deps);
    setStatusDia(status);
    setAlertas(novos);
  }, []);

  useEffect(() => { carregarChecklist(dia); }, [dia, carregarChecklist]);

  const pronto = !carregandoVendas && !carregandoCheck;
  const texto = pronto ? montarTextoRelatorio({ dia, vendas, statusDia, alertas, deptKeys, previsaoMes }) : "";

  const copiar = async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(texto); ok = true; } catch {
      const a = document.createElement("textarea");
      a.value = texto; document.body.appendChild(a); a.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
      a.remove();
    }
    if (ok) { setCopiado(true); setTimeout(() => setCopiado(false), 2500); }
  };

  return (
    <div style={pageStyle}>
      <div className="app-shell">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <button onClick={onVoltar} style={iconBtn} aria-label="Voltar"><ChevronLeft size={18} /></button>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: "#22231F" }}>Comercial · Relatório do dia</div>
            <div style={{ fontSize: 12, color: "#8A8778", textTransform: "capitalize" }}>{formatDiaLabel(dia)}</div>
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={sectionLabel}>Dia do relatório</div>
          <div style={{ display: "flex", gap: 8 }}>
            <input type="date" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} style={{ ...inputStyle, flex: 1 }} />
            <button onClick={() => setDia(somarDiasStr(dia, -1))} style={{ ...iconBtn, width: "auto", padding: "0 12px", fontSize: 13, fontWeight: 600 }}>‹ dia antes</button>
          </div>
          <div style={{ fontSize: 12, color: "#8A8778", marginTop: 6 }}>
            Abre no dia anterior: domingo de manhã mostra o sábado. O turno das 17h às 3h conta no dia em que abriu.
          </div>
        </div>

        <div style={{ marginBottom: 18 }}>
          <div style={sectionLabel}>Vendas</div>
          {vendasSemAcesso ? (
            <div style={avisoBloqueio}><AlertTriangle size={16} /> Seu cargo não vê as vendas. O admin libera em Cargos → Comercial.</div>
          ) : (
            <VendasDoDia dia={dia} vendas={vendas} erro={vendasErro} carregando={carregandoVendas} />
          )}
        </div>

        {!vendasSemAcesso && (
          <div style={{ marginBottom: 18 }}>
            <div style={sectionLabel}>Painel comercial</div>
            <PainelComercial dia={dia} mesTotal={carregandoVendas || !vendas ? null : vendas.mes_total} onPrevisao={setPrevisaoMes} />
          </div>
        )}

        <div style={{ marginBottom: 18 }}>
          <div style={sectionLabel}>Checklist do dia</div>
          {carregandoCheck ? (
            <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
          ) : checkErro ? (
            <div style={avisoBloqueio}><AlertTriangle size={16} /> {checkErro}</div>
          ) : (
            <div style={cardStyle}>
              {deptKeys.map((k) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "7px 0", borderBottom: "1px solid #EFE9DA", fontSize: 13 }}>
                  <span style={{ fontWeight: 600, color: "#22231F" }}>{aparenciaDe(k).label}</span>
                  <span style={{ display: "flex", gap: 12 }}>
                    {TURNOS.map((t) => {
                      const s = statusDia[`${k}:${t}`] || { preenchido: 0, total: 0, ok: false };
                      if (!s.total) return null;
                      return (
                        <span key={t} style={{ display: "flex", alignItems: "center", gap: 4, color: s.ok ? "#2F8F5B" : "#8A6A0F" }}>
                          {t === "abertura" ? "Abert." : "Fech."} {s.ok ? <CheckCircle2 size={14} /> : <><Clock size={14} /> {s.preenchido}/{s.total}</>}
                        </span>
                      );
                    })}
                  </span>
                </div>
              ))}
              <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                {alertas.length === 0 ? (
                  <div style={{ fontSize: 12, color: "#8A8778" }}>Nenhuma não conformidade.</div>
                ) : alertas.map((a, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, fontSize: 12, color: "#22231F" }}>
                    <AlertTriangle size={14} color="#C4432B" style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>{a.item} <span style={{ color: "#8A8778" }}>· {a.dept} · {a.etapa}{a.responsavel ? ` · ${a.responsavel}` : ""}</span></span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
          <div style={sectionLabel}>Relatório para enviar</div>
          <div style={cardStyle}>
            <div style={{ background: "#EFE7DC", borderRadius: 10, padding: 10 }}>
              <div style={{ background: "#E7F8D8", borderRadius: 8, padding: "10px 12px", fontSize: 13, whiteSpace: "pre-wrap", color: "#22231F", lineHeight: 1.45 }}>
                {pronto ? texto : "Montando o relatório…"}
              </div>
            </div>
            <button onClick={copiar} disabled={!pronto}
              style={{ ...btnPrimary, width: "100%", marginTop: 10, background: copiado ? "#2F8F5B" : "#22231F" }}>
              {copiado ? <CheckCircle2 size={16} /> : <Copy size={16} />} {copiado ? "Copiado! Cole no WhatsApp" : "Copiar relatório"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estilos (mesma paleta do painel)
// ---------------------------------------------------------------------------
const pageStyle = {
  fontFamily: "'Inter', system-ui, sans-serif", background: "#F6F1E7", padding: 20,
  minHeight: "100vh", boxSizing: "border-box",
};
const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const iconBtn = {
  width: 34, height: 34, borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#22231F",
};
const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10,
  border: "1px solid #E8E2D2", fontSize: 14, background: "#FFFFFF", color: "#22231F",
};
const sectionLabel = {
  fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778", marginBottom: 8,
};
const avisoBloqueio = {
  display: "flex", alignItems: "center", gap: 8, background: "#FBF3D9",
  border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13,
};
const btnPrimary = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#22231F", color: "#F3EFE3",
  border: "none", borderRadius: 10, padding: "12px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer",
};
const statBox = {
  flex: 1, background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: "12px 14px", textAlign: "center",
};
const statNum = { fontSize: 22, fontWeight: 800, color: "#22231F" };
const statLabel = { fontSize: 11, color: "#8A8778", marginTop: 2 };
const linkBtn = { background: "none", border: "none", padding: 0, color: "#2F6FA3", fontSize: 12, fontWeight: 700, cursor: "pointer" };
