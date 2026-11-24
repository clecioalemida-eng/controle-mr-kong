import React, { useState, useEffect, useCallback } from "react";
import {
  ChevronLeft, AlertTriangle, CheckCircle2, Clock, Copy, TrendingUp, TrendingDown,
} from "lucide-react";
import { supabase, TABELA_CHECKLIST } from "../lib/supabaseClient";
import { podeVer } from "../lib/permissoes";
// O Dashboard deixou de ser um card próprio na tela inicial: ele é a
// terceira aba daqui. Eram duas portas para a mesma pergunta — "como
// estão as vendas" — e quem abria uma nunca sabia que a outra existia.
import Dashboard from "./DashboardModulo";
import ComercialLinhaTempo, { ultimoDiaFechado } from "./ComercialLinhaTempo";
import { MancheteMes, TresPerguntas, CurvaDoMes, LinhasQuePuxaram, Leitura, NoitesDaSemana, montarFrases, Comparando, faixaDatas } from "./ComercialMes";
import { VendaDosItens, desmontarItens } from "./ComercialItens";
// Aba Dia: o que saiu no dia, em números (combos, artesanal, tradicional…)
import ComercialDiaItens from "./ComercialDiaItens";
// Aba Mês: o que saiu no mês, e a linha do tempo de trimestre, semestre e ano
import ComercialPeriodo from "./ComercialPeriodo";

// ---------------------------------------------------------------------------
// Módulo Comercial — Relatório do dia
//
// É a tela que a secretária abre todo dia (inclusive domingo) para mandar o
// relatório no grupo: vendas do dia, mês atual × mesmo período do mês
// passado, meta, e o checklist do dia (pendências e não conformidades).
// O botão "Copiar relatório" monta o texto pronto para o WhatsApp.
// Painel comercial (abaixo das vendas): 3 meses, linhas, venda de cada item,
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
// Painel comercial — últimos 3 meses, linhas, venda de cada item, altas e quedas,
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
function brlK(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1000) return `R$ ${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return brlInt(n);
}

// janelas "dias 1..d": [0] = mês do relatório, [1] = anterior, [2] = retrasado…
function janelas(dia, quantas) {
  const [y, m, d] = dia.split("-").map(Number);
  return Array.from({ length: quantas }, (_, k) => {
    const base = new Date(y, m - 1 - k, 1);
    const yy = base.getFullYear(), mm = base.getMonth();
    const dd = Math.min(d, diasDoMes(yy, mm));
    return { y: yy, m0: mm, ini: ymdDe(yy, mm, 1), fim: ymdDe(yy, mm, dd), fimMes: ymdDe(yy, mm, diasDoMes(yy, mm)), ate: dd, diasMes: diasDoMes(yy, mm) };
  });
}
const mediaDe = (l) => (l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0);

// nMeses: com quem o mês é comparado. 1 = mês passado; 3, 6 ou 12 = média
// dos mesmos dias nesses meses. Mês sem venda no cache fica fora da média.
async function carregarPainel(dia, nMeses = 1) {
  const M = Math.max(2, nMeses);          // sempre até o retrasado ("caindo há 3 meses")
  const J = janelas(dia, M + 1);
  const [at, an] = J;
  // A previsão olha o mês do relatório, mas tudo que COMPARA usa só dias já
  // fechados. Noite em andamento contra dia inteiro dava −89%, e o detalhe
  // por item, que só chega depois, dava −100%. No dia 1 ainda sem dia
  // fechado, a comparação passa a ser o último mês inteiro.
  const fechado = ultimoDiaFechado();
  const diaComparacao = dia < fechado ? dia : fechado;
  const JC = janelas(diaComparacao, M + 1);
  const inicioHist = [somarDiasStr(dia, -63), J[M].ini, JC[M].ini].sort()[0];
  // Cada chamada devolve duas janelas (atual e anterior): pares 0-1, 2-3, …
  const pares = [];
  for (let k = 0; k <= M; k += 2) pares.push([k, Math.min(k + 1, M)]);
  const args = ([a, b]) => ({ p_inicio: JC[a].ini, p_fim: JC[a].fim, p_inicio_ant: JC[b].ini, p_fim_ant: JC[b].fim });
  const [rDias, ...resto] = await Promise.all([
    supabase.from("vendas_diarias").select("dia, faturamento_bruto").gte("dia", inicioHist).lte("dia", at.fimMes).order("dia"),
    ...pares.map((pr) => supabase.rpc("desempenho_produtos", args(pr))),
    ...pares.map((pr) => supabase.rpc("desempenho_linhas", args(pr))),
    ...pares.map((pr) => supabase.rpc("venda_por_item", args(pr))),
  ]);
  const rP = resto.slice(0, pares.length), rL = resto.slice(pares.length, 2 * pares.length), rI = resto.slice(2 * pares.length);
  const erroDias = rDias.error ? rDias.error.message : "";
  const fProd = [...rP, ...rL].map((r) => r.error).find(Boolean);
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

  // ---- produtos e linhas: junta as respostas, uma posição por mês (0 = atual)
  const vazio = () => Array(M + 1).fill(0);
  const prod = new Map();
  const pega = (nome) => {
    if (!prod.has(nome)) prod.set(nome, { produto: nome, linha: "", v: vazio(), q: vazio() });
    return prod.get(nome);
  };
  pares.forEach(([a, b], i) => (rP[i].data || []).forEach((l) => {
    const p = pega(l.produto);
    p.linha = p.linha || l.linha || "";
    p.v[a] = Number(l.valor_atual) || 0; p.q[a] = Number(l.qtd_atual) || 0;
    if (b !== a) { p.v[b] = Number(l.valor_ant) || 0; p.q[b] = Number(l.qtd_ant) || 0; }
  }));
  const lin = new Map();
  const pegaL = (nome) => {
    const k = String(nome || "").trim() || "Sem linha definida";
    if (!lin.has(k)) lin.set(k, { linha: k, v: vazio() });
    return lin.get(k);
  };
  pares.forEach(([a, b], i) => (rL[i].data || []).forEach((l) => {
    const x = pegaL(l.linha);
    x.v[a] = Number(l.valor_atual) || 0;
    if (b !== a) x.v[b] = Number(l.valor_ant) || 0;
  }));
  const linhas = [...lin.values()].filter((l) => l.v.some((x) => x > 0));

  // ---- com quem comparar
  // Topo (vendas_diarias): mês com pelo menos 80% dos dias no cache.
  // Itens e linhas (pedidos_cache): mês que tem alguma venda detalhada.
  const ks = Array.from({ length: nMeses }, (_, i) => i + 1);
  const kTopo = nMeses === 1 ? ks : ks.filter((k) => meses[k].diasNoCache >= Math.ceil(meses[k].ate * 0.8));
  const kItens = nMeses === 1 ? ks : ks.filter((k) => linhas.reduce((s, l) => s + l.v[k], 0) > 0);
  const naBase = (arr, lista) => mediaDe(lista.map((k) => arr[k]));
  const produtos = [...prod.values()].filter((p) => p.produto).map((p) => ({ ...p, vb: naBase(p.v, kItens), qb: naBase(p.q, kItens) }));
  linhas.forEach((l) => { l.vb = naBase(l.v, kItens); });
  const base = {
    nMeses, kTopo, kItens,
    periodo: mediaDe(kTopo.map((k) => meses[k].periodo)),
    inteiro: mediaDe(kTopo.map((k) => meses[k].inteiro || 0)),
    porDia: mediaDe(kTopo.map((k) => meses[k].periodo / Math.max(meses[k].ate, 1))),
  };

  // quanto do faturamento de cada mês está detalhado item a item
  const detalhado = JC.map((j, k) => {
    const soma = linhas.reduce((s, l) => s + l.v[k], 0);
    const faturado = somaEntre(j.ini, j.fim).s;
    return faturado ? Math.round((soma / faturado) * 100) : null;
  });

  // Mês do relatório contra os mesmos dias do anterior, só com dias fechados.
  // `ate` zero quer dizer que este mês ainda não tem dia fechado.
  const fimFechado = at.fim < fechado ? at.fim : fechado;
  const ateFechado = fimFechado >= at.ini ? Number(fimFechado.slice(8, 10)) : 0;
  const fechados = {
    ate: ateFechado,
    atual: ateFechado ? somaEntre(at.ini, fimFechado).s : 0,
    anterior: ateFechado ? somaEntre(an.ini, ymdDe(an.y, an.m0, Math.min(ateFechado, an.diasMes))).s : 0,
  };

  // Média de cada dia da semana (para o gráfico das noites) e venda dia a dia
  // (para a curva do mês).
  const semana = porSemana.map((l) => ({ noites: l.filter((v) => v > 0).length, media: l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0 }));
  const vendaPorDia = Object.fromEntries(porDia);

  // Venda de cada item: soma o que saiu sozinho com o que saiu em combo
  // (migração 193). Se a função ainda não existir, só esse bloco avisa.
  // A coluna "antes" é o mês passado ou a média dos meses escolhidos.
  let itens = null, erroItens = "";
  const fItens = rI.map((r) => r.error).find(Boolean);
  if (fItens) {
    erroItens = /does not exist|schema cache|Could not find/i.test(fItens.message || "")
      ? "Falta rodar a migração 193 (venda por item) no Supabase."
      : /sem_acesso|permission|denied/i.test(fItens.message || "")
        ? "Seu cargo não vê a venda por item."
        : fItens.message;
  } else {
    const porItem = new Map();
    pares.forEach(([a, b], i) => (rI[i].data || []).forEach((l) => {
      const chave = `${l.nome}\u0000${l.opcao || ""}`;
      if (!porItem.has(chave)) porItem.set(chave, { nome: l.nome, opcao: l.opcao, q: vazio() });
      const x = porItem.get(chave);
      x.q[a] = Number(l.qtd_atual) || 0;
      if (b !== a) x.q[b] = Number(l.qtd_ant) || 0;
    }));
    const linhasItens = [...porItem.values()].map((x) => ({ nome: x.nome, opcao: x.opcao, qtd_atual: x.q[0], qtd_ant: naBase(x.q, kItens) }));
    itens = desmontarItens(linhasItens, produtos);
  }

  return { meses, janelasComparacao: JC, base, fechados, diasQueFaltam, produtos, linhas, detalhado, semana, vendaPorDia, itens, erroItens, erroDias, erroProd: fProd ? erroProd : "" };
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

// "Comparar com": mês passado ou a média dos mesmos dias de 3, 6 ou 12 meses.
const OPCOES_COMPARAR = [
  { n: 1, label: "Mês passado" },
  { n: 3, label: "Média de 3 meses" },
  { n: 6, label: "Média de 6 meses" },
  { n: 12, label: "Média de 1 ano" },
];
const CHAVE_COMPARAR = "comercial_comparar_com";
function lerComparar() {
  try { const n = Number(localStorage.getItem(CHAVE_COMPARAR)); return OPCOES_COMPARAR.some((o) => o.n === n) ? n : 1; } catch { return 1; }
}

function PainelComercial({ dia, mesTotal, onPrevisao, oculto }) {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  // O painel escondido (só para a previsão do relatório) sempre usa o mês passado.
  const [nMeses, setNMeses] = useState(() => (oculto ? 1 : lerComparar()));
  const escolher = (n) => { setNMeses(n); try { localStorage.setItem(CHAVE_COMPARAR, String(n)); } catch { /* sem armazenamento */ } };

  useEffect(() => {
    let vivo = true;
    setCarregando(true); setErro("");
    carregarPainel(dia, nMeses).then((r) => { if (vivo) { setDados(r); setCarregando(false); } })
      .catch((e) => { if (vivo) { setErro(e.message || String(e)); setCarregando(false); } });
    return () => { vivo = false; };
  }, [dia, nMeses]);

  const prev = calcularPrevisao(dados, mesTotal);
  useEffect(() => { if (onPrevisao) onPrevisao(prev ? prev.previsao : null); }, [prev && Math.round(prev.previsao)]); // eslint-disable-line

  if (carregando && !dados) return <div style={{ fontSize: 13, color: "#8A8778" }}>Montando o painel do mês…</div>;
  if (erro) return <div style={avisoBloqueio}><AlertTriangle size={16} /> {erro}</div>;
  if (!dados) return null;

  const { meses, janelasComparacao, produtos, detalhado, base } = dados;
  const [at, an, re] = meses;
  const media = base.nMeses > 1;              // comparando com a média, não com o mês passado
  // O que compara produtos usa só dias fechados, e pode já ser o mês anterior.
  const rotuloC = (k) => nomeMesCurto(janelasComparacao[k].m0);
  const vs = (a, b) => (b ? ((a - b) / b) * 100 : null);

  // ---- altas e quedas (R$ contra o mês passado ou a média escolhida: vb)
  const comDelta = produtos.map((p) => ({ ...p, delta: p.v[0] - p.vb, pct: vs(p.v[0], p.vb) }));
  const altas = comDelta.filter((p) => p.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, QUANTOS);
  const quedas = comDelta.filter((p) => p.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, QUANTOS);
  const tresSeguidos = comDelta.filter((p) => p.v[2] > p.v[1] && p.v[1] > p.v[0] && p.v[2] > 0).sort((a, b) => (a.v[0] - a.v[2]) - (b.v[0] - b.v[2])).slice(0, 5);

  const nome = { fontSize: 12.5, color: "#22231F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 };

  // ---- leitura didática do mês (desenho em ComercialMes.jsx)
  const nomeAt = nomeMesLongo(at.m0);
  const nomeAn = NOMES_MES[an.m0], nomeRe = NOMES_MES[re.m0];
  const jaVendido = prev.jaVendido;
  const faltamAbertos = dados.diasQueFaltam.filter((d) => d.dow !== 1);
  const normalPorNoite = faltamAbertos.length ? faltamAbertos.reduce((s, d) => s + d.media, 0) / faltamAbertos.length : 0;
  const porDiaAt = jaVendido / Math.max(at.ate, 1);
  const porDiaAn = an.periodo / Math.max(an.ate, 1);
  const porDiaRe = re.periodo / Math.max(re.ate, 1);

  const acumula = (j, ate) => {
    const out = [];
    let soma = 0;
    for (let d = 1; d <= ate; d++) { soma += dados.vendaPorDia[ymdDe(j.y, j.m0, d)] || 0; out.push(Math.round(soma)); }
    return out;
  };
  const curvaAt = acumula(at, at.ate);
  if (curvaAt.length) curvaAt[curvaAt.length - 1] = Math.round(jaVendido); // último dia conferido ao vivo
  const curvaPrev = [Math.round(jaVendido)];
  dados.diasQueFaltam.reduce((soma, d) => { const v = soma + d.media; curvaPrev.push(Math.round(v)); return v; }, jaVendido);
  const curvaAn = acumula(an, an.diasMes);
  const curvaRe = acumula(re, re.diasMes);
  const noMesmoDia = (c) => c[Math.min(at.ate, c.length) - 1] || 0;
  // Curva da média: em cada dia do mês, a média do acumulado dos meses da base.
  const curvasBase = base.kTopo.map((k) => acumula(meses[k], meses[k].diasMes));
  const curvaMedia = [];
  for (let d = 1; d <= 31; d++) {
    const vals = curvasBase.filter((c) => c.length >= d).map((c) => c[d - 1]);
    if (!vals.length) break;
    curvaMedia.push(Math.round(mediaDe(vals)));
  }
  const nomeMedia = `média de ${base.nMeses === 12 ? "1 ano" : `${base.nMeses} meses`}`;
  let fraseCurva;
  if (media) {
    fraseCurva = `${nomeAt} está ${jaVendido >= noMesmoDia(curvaMedia) ? "à frente" : "atrás"} da ${nomeMedia}`;
  } else {
    const frenteAn = jaVendido >= noMesmoDia(curvaAn), frenteRe = jaVendido >= noMesmoDia(curvaRe);
    fraseCurva = frenteAn && frenteRe ? `${nomeAt} está à frente de ${nomeAn} e ${nomeRe}`
      : !frenteAn && !frenteRe ? `${nomeAt} está atrás de ${nomeAn} e ${nomeRe}`
        : frenteAn ? `${nomeAt} está à frente de ${nomeAn}, mas atrás de ${nomeRe}`
          : `${nomeAt} está atrás de ${nomeAn}, mas à frente de ${nomeRe}`;
  }
  const seriesCurva = [
    { nome: nomeMesCurto(at.m0), cor: "#2F8F5B", pontos: curvaAt, grossa: true, area: true },
    dados.diasQueFaltam.length ? { nome: `${nomeMesCurto(at.m0)} previsto`, cor: "#2F8F5B", pontos: curvaPrev, inicio: at.ate, tracejado: true } : null,
    ...(media
      ? [{ nome: nomeMedia, cor: "#5C5A4E", pontos: curvaMedia }]
      : [{ nome: nomeMesCurto(an.m0), cor: "#5C5A4E", pontos: curvaAn }, { nome: nomeMesCurto(re.m0), cor: "#B9B4A2", pontos: curvaRe, tracejado: true }]),
  ].filter(Boolean);
  const avisoCache = !media && (an.diasInteiroCache < an.diasMes || re.diasInteiroCache < re.diasMes)
    ? "Alguns dias antigos ainda não estão no cache de vendas: a linha desses meses pode estar mais baixa do que foi." : "";

  // ---- o que cada bloco compara, com datas (etiqueta "Comparando X com Y")
  // Topo: o mês até a noite do relatório, contra os mesmos dias dos anteriores
  // (ou a média deles). Por item e por linha: só noites já fechadas.
  const faixaAt = faixaDatas(at.ini, at.fim), faixaAn = faixaDatas(an.ini, an.fim), faixaRe = faixaDatas(re.ini, re.fim);
  const [jc0, jc1, jc2] = janelasComparacao;
  const fechadasAt = faixaDatas(jc0.ini, jc0.fim, true), fechadasAn = faixaDatas(jc1.ini, jc1.fim, true);
  // "média de 1 a 21 de maio a outubro" + "· 6 meses" (avisa os que ficaram de fora)
  const textoMedia = (lista, ate, curto) => {
    if (!lista.length) return "média (nenhum mês com venda no cache)";
    const mais = Math.max(...lista), menos = Math.min(...lista);
    // Quando a média atravessa a virada do ano, o ano aparece: "nov/25 a out/26".
    const viraAno = janelasComparacao[mais].y !== janelasComparacao[menos].y;
    const nomeM = (k) => (curto ? nomeMesCurto : (x) => NOMES_MES[x])(janelasComparacao[k].m0) + (viraAno ? `/${String(janelasComparacao[k].y).slice(2)}` : "");
    return `média de 1 a ${ate} de ${mais === menos ? nomeM(mais) : `${nomeM(mais)} a ${nomeM(menos)}`}`;
  };
  const fimMedia = (lista) => {
    const n = lista.length, faltam = base.nMeses - n;
    return `· ${n} ${n === 1 ? "mês" : "meses"}${faltam > 0 ? ` de ${base.nMeses} (${faltam} sem venda no cache)` : ""}`;
  };
  const etqTopo = media
    ? <Comparando agora={faixaAt} ligacao="com a" antes={textoMedia(base.kTopo, at.ate, false)} fim={fimMedia(base.kTopo)} />
    : <Comparando agora={faixaAt} antes={faixaAn} />;
  const etqFechadas = media
    ? <Comparando agora={fechadasAt} ligacao="com a" antes={textoMedia(base.kItens, jc0.ate, true)} fim={`${fimMedia(base.kItens)} · só noites já fechadas`} />
    : <Comparando agora={fechadasAt} antes={fechadasAn} fim="· só noites já fechadas" />;
  const fimSemanas = dia, iniSemanas = somarDiasStr(dia, -55);

  // Números do topo contra a base escolhida
  const anteriorTopo = media ? base.periodo : an.periodo;
  const porDiaBase = media ? base.porDia : porDiaAn;
  const textoJaVendido = media ? `a ${textoMedia(base.kTopo, at.ate, false)}` : `de ${faixaAn}`;
  let textoPorDia, extraPorDia = "";
  if (media) {
    textoPorDia = `a ${nomeMedia} é ${brlInt(porDiaBase)}`;
    const porMes = base.kTopo.map((k) => ({ nome: NOMES_MES[meses[k].m0], v: meses[k].periodo / Math.max(meses[k].ate, 1) })).sort((a, b) => b.v - a.v);
    if (porMes.length > 1) extraPorDia = `melhor mês: ${porMes[0].nome} ${brlInt(porMes[0].v)} · pior: ${porMes[porMes.length - 1].nome} ${brlInt(porMes[porMes.length - 1].v)}`;
  } else {
    textoPorDia = `era ${brlInt(porDiaAn)} de ${faixaAn}`;
    if (porDiaRe > 0) extraPorDia = `e ${brlInt(porDiaRe)} de ${faixaRe}`;
  }

  const linhasDelta = dados.linhas.map((l) => ({ linha: l.linha, atual: l.v[0], anterior: l.vb }));
  const frases = montarFrases({
    linhas: linhasDelta,
    produtos: produtos.map((p) => ({ produto: p.produto, linha: String(p.linha || "").trim() || "Sem linha definida", atual: p.v[0], anterior: p.vb })),
    tresSeguidos, semana: dados.semana, previsao: prev.previsao, meta: META_MES, noitesAbertas: faltamAbertos.length,
    contra: media ? `a ${nomeMedia}` : fechadasAn,
  });

  const chipComparar = (ativo) => ({
    padding: "6px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
    border: ativo ? "1px solid #22231F" : "1px solid #E8E2D2",
    background: ativo ? "#22231F" : "#FFFFFF", color: ativo ? "#F3EFE3" : "#55534A",
  });

  return (
    <div style={{ display: "grid", gap: 10, opacity: carregando ? 0.55 : 1, transition: "opacity .2s" }}>
      {!oculto && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12.5, color: "#5C5A4E", marginRight: 2 }}>Comparar com</span>
          {OPCOES_COMPARAR.map((o) => (
            <button key={o.n} onClick={() => escolher(o.n)} style={chipComparar(nMeses === o.n)}>{o.label}</button>
          ))}
          {carregando && <span style={{ fontSize: 12, color: "#8A8778" }}>Atualizando…</span>}
        </div>
      )}

      <MancheteMes nomeMes={nomeAt} diaAte={`${pad(at.ate)}/${pad(at.m0 + 1)}`} noitesFaltam={dados.diasQueFaltam.length}
        previsao={prev.previsao} jaVendido={jaVendido} resto={prev.resto} meta={META_MES}
        porDiaAtual={porDiaAt} porDiaAnterior={porDiaBase} nomeAnterior={nomeAn} inteiroAnterior={media ? base.inteiro : an.inteiro}
        textoContra={media ? `a ${nomeMedia}` : `nos mesmos dias de ${nomeAn}`}
        rotuloInteiro={media ? `média de um mês inteiro (${base.nMeses === 12 ? "1 ano" : `${base.nMeses} meses`})` : `${nomeAn} inteiro`}
        etiqueta={etqTopo} />

      <TresPerguntas jaVendido={jaVendido} anteriorMesmoDia={anteriorTopo} textoJaVendido={textoJaVendido}
        porDia={porDiaAt} porDiaAnt={porDiaBase} textoPorDia={textoPorDia} extraPorDia={extraPorDia}
        ultimoDia={faixaDatas(at.fimMes, at.fimMes, true)}
        falta={META_MES - jaVendido} noitesAbertas={faltamAbertos.length} normalPorNoite={normalPorNoite} />

      <CurvaDoMes series={seriesCurva} meta={META_MES} frase={fraseCurva} aviso={avisoCache}
        etiqueta={media
          ? <Comparando agora={nomeAt.toLowerCase()} ligacao="com a" antes={textoMedia(base.kTopo, 31, false).replace("de 1 a 31 ", "")} fim={`${fimMedia(base.kTopo)} · dia a dia do mês`} />
          : <Comparando agora={nomeAt.toLowerCase()} antes={`${nomeAn} e ${nomeRe}`} fim="· dia a dia do mês" />} />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
        {!dados.erroProd && <LinhasQuePuxaram linhas={linhasDelta} etiqueta={etqFechadas} />}
        <Leitura frases={frases} etiqueta={!dados.erroProd ? etqFechadas : null} />
      </div>

      <NoitesDaSemana semana={dados.semana}
        etiqueta={<Comparando calendario inicio="Média das últimas 8 semanas:" agora={faixaDatas(iniSemanas, fimSemanas, true)} />} />
      {dados.erroProd ? (
        <div style={avisoBloqueio}><AlertTriangle size={16} /> {dados.erroProd}</div>
      ) : (
        <>
          {/* ---------------- Linha do tempo ---------------- */}
          {/* Ela faz uma chamada por ponto do gráfico: não roda com o painel
              escondido, que existe só para a previsão do relatório. */}
          {!oculto && <ComercialLinhaTempo />}

          {/* ---------------- O que saiu no período (ComercialPeriodo.jsx) ---------------- */}
          {!oculto && <ComercialPeriodo dia={dia} />}

          {/* ---------------- Venda de cada item (ComercialItens.jsx) ---------------- */}
          <VendaDosItens itens={dados.itens} erro={dados.erroItens} rotuloAn={media ? nomeMedia : fechadasAn} etiqueta={etqFechadas} />

          {/* ---------------- Altas e quedas ---------------- */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
            {[
              { titulo: "Maiores crescimentos", lista: altas, cor: "#2F8F5B", vazio: "Nenhum produto cresceu." },
              { titulo: "Maiores perdas", lista: quedas, cor: "#C4432B", vazio: "Nenhum produto caiu." },
            ].map((b) => (
              <div key={b.titulo} style={cardStyle}>
                <div style={{ ...sectionLabel, marginBottom: 2 }}>{b.titulo}</div>
                <div style={{ margin: "4px 0 6px" }}>{etqFechadas}</div>
                <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 6 }}>Em R$, de quem mais ganhou ou perdeu.</div>
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
              <div style={{ ...sectionLabel, color: "#7A6A1E", marginBottom: 4 }}>Caindo há 3 meses seguidos</div>
              <div style={{ marginBottom: 6 }}>
                <Comparando calendario inicio="Os mesmos dias de cada mês:" agora={`${faixaDatas(jc0.ini, jc0.fim).replace(/ de .*/, "")} de ${NOMES_MES[jc2.m0]}, ${NOMES_MES[jc1.m0]} e ${NOMES_MES[jc0.m0]}`} style={{ background: "#F5E8B8" }} />
              </div>
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
              Parte da venda ainda não tem o detalhe item a item ({[0, 1, 2].map((k) => `${rotuloC(k)} ${detalhado[k] == null ? "—" : detalhado[k] + "%"}`).join(" · ")}).
              Os números de produto e linha usam só a parte detalhada.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ===========================================================================
const ABAS = [
  { chave: "dia",    label: "Dia" },
  { chave: "mes",    label: "Mês" },
  { chave: "custos", label: "Previsão e custos", chavePermissao: "dashboard" },
];

export default function Comercial({ onVoltar, perfil, permissoes, abaInicial, onAba }) {
  // a aba vai para o endereço: recarregar a página volta nela
  const [aba, setAbaInterna] = useState(() => (ABAS.some((a) => a.chave === abaInicial) ? abaInicial : "dia"));
  const setAba = (a) => { setAbaInterna(a); if (onAba) onAba(a, null); };
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

  const abasVisiveis = ABAS.filter((a) => !a.chavePermissao
    || perfil?.is_admin || podeVer(permissoes, a.chavePermissao));
  const abaAtual = abasVisiveis.some((a) => a.chave === aba) ? aba : "dia";
  const subtitulo = abaAtual === "dia" ? formatDiaLabel(dia)
    : abaAtual === "mes" ? "Três meses, linhas, produtos e previsão"
    : "Faturamento previsto, custos e margem";

  return (
    <div style={pageStyle}>
      <div className="app-shell">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <button onClick={onVoltar} style={iconBtn} aria-label="Voltar"><ChevronLeft size={18} /></button>
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: "#22231F" }}>Comercial</div>
            <div style={{ fontSize: 12, color: "#8A8778", textTransform: "capitalize" }}>{subtitulo}</div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 7, marginBottom: 18, flexWrap: "wrap" }}>
          {abasVisiveis.map((a) => (
            <button key={a.chave} onClick={() => setAba(a.chave)}
              style={{
                border: "1px solid " + (abaAtual === a.chave ? "#22231F" : "#E8E2D2"),
                background: abaAtual === a.chave ? "#22231F" : "#FFFFFF",
                color: abaAtual === a.chave ? "#F3EFE3" : "#55534A",
                borderRadius: 999, padding: "7px 14px", fontSize: 13, fontWeight: 700,
                cursor: "pointer", fontFamily: "inherit",
              }}>
              {a.label}
            </button>
          ))}
        </div>

        {abaAtual === "dia" && (<>
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
            <>
              <VendasDoDia dia={dia} vendas={vendas} erro={vendasErro} carregando={carregandoVendas} />
              <div style={{ marginTop: 10 }}>
                <ComercialDiaItens dia={dia} pedidos={vendas && !carregandoVendas ? vendas.dia_pedidos : null} />
              </div>
            </>
          )}
        </div>


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
        </>)}

        {abaAtual === "mes" && (
          vendasSemAcesso ? (
            <div style={avisoBloqueio}><AlertTriangle size={16} /> Seu cargo não vê as vendas.</div>
          ) : (
            <PainelComercial dia={dia} mesTotal={carregandoVendas || !vendas ? null : vendas.mes_total}
              onPrevisao={setPrevisaoMes} />
          )
        )}

        {/* A antiga tela Dashboard, inteira, sem perder nada: carga do
            histórico, margem de contribuição, desempenho por produto e
            custos por centro de custo. Só mudou de endereço. */}
        {abaAtual === "custos" && <Dashboard onVoltar={() => setAba("dia")} />}

        {/* O relatório do WhatsApp só é montado na aba Dia, mas a previsão
            que entra nele vem do painel do mês. Por isso ele fica montado
            fora da tela quando a pessoa está em outra aba: sem isso, abrir
            o Comercial e copiar o relatório mandaria o texto sem previsão. */}
        {abaAtual === "dia" && !vendasSemAcesso && (
          <div style={{ display: "none" }} aria-hidden="true">
            <PainelComercial dia={dia} mesTotal={carregandoVendas || !vendas ? null : vendas.mes_total}
              onPrevisao={setPrevisaoMes} oculto />
          </div>
        )}
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
