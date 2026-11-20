// ===== PainelOperacao.jsx =====
// Dashboard → aba Operação. Faturamento, canais, linhas de produto,
// cancelamentos e checklists do período, sempre comparando com o período
// anterior de mesmo tamanho.
//
// Os números vêm do banco, já somados:
//   * painel_operacao (migração 190): faturamento, canais, cancelamentos,
//     checklists e setores
//   * desempenho_linhas (migração 079): faturamento por linha de produto
// As duas leem o cache de pedidos, que o robô grava de madrugada. Por isso
// o período termina na noite de ontem.
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, TrendingUp, TrendingDown, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function brl(v) { return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function brlCurto(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function somarDias(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function dataBR(iso) { const [, m, d] = String(iso).split("-"); return `${d}/${m}`; }
function variacao(atual, anterior) {
  if (!anterior || anterior <= 0) return null;
  return ((atual - anterior) / anterior) * 100;
}
function pctTexto(v) {
  if (v == null) return "novo";
  const s = Math.abs(v).toFixed(1).replace(".", ",");
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${s}%`;
}

// Mesma regra de período do resto do Dashboard: 7 e 30 dias terminam
// ontem (a noite de hoje ainda não está no cache); "mês" compara com os
// mesmos dias do mês passado.
function janelas(modo) {
  const hoje = new Date();
  if (modo === "mes") {
    const ontem = somarDias(hoje, -1);
    const ini = new Date(ontem.getFullYear(), ontem.getMonth(), 1);
    const iniAnt = new Date(ini.getFullYear(), ini.getMonth() - 1, 1);
    const ultimoAnt = new Date(ini.getFullYear(), ini.getMonth(), 0).getDate();
    return {
      ini, fim: ontem, iniAnt,
      fimAnt: new Date(iniAnt.getFullYear(), iniAnt.getMonth(), Math.min(ontem.getDate(), ultimoAnt)),
      comparado: "mesmos dias do mês passado",
    };
  }
  const n = modo === "7" ? 7 : 30;
  return {
    ini: somarDias(hoje, -n), fim: somarDias(hoje, -1),
    iniAnt: somarDias(hoje, -2 * n), fimAnt: somarDias(hoje, -n - 1),
    comparado: `os ${n} dias anteriores`,
  };
}

// Motivo de cancelamento como chega das plataformas, em português.
function motivoBonito(m) {
  if (!m) return "sem motivo";
  if (/order_late|atrasad/i.test(m)) return "atraso";
  if (/sem entregador/i.test(m)) return "sem entregador";
  if (/cliente (solicitou|desistiu)/i.test(m)) return "cliente desistiu";
  if (/fechou/i.test(m)) return "loja fechou";
  return m.replace(/_+/g, " ");
}

const CANAIS = ["Mesa", "Delivery próprio", "Retirada", "iFood", "Keeta"];
const ETAPAS = [["abertura", "Entrada"], ["fechamento", "Saída"]];

// ---------------------------------------------------------------------------
// Peças de tela
// ---------------------------------------------------------------------------
function Delta({ v, inverso = false, grande = false, novo = false }) {
  if (v == null) return <span style={{ fontSize: grande ? 13 : 11.5, color: "#8A8778" }}>{novo ? "novo" : "sem comparação"}</span>;
  const bom = inverso ? v < 0 : v >= 0;
  const Icone = v >= 0 ? TrendingUp : TrendingDown;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: grande ? 13 : 11.5, fontWeight: 700,
                   color: bom ? "#0F6E56" : "#A32D2D" }}>
      <Icone size={grande ? 15 : 13} /> {pctTexto(v)}
    </span>
  );
}

function Kpi({ rotulo, valor, delta, inverso, extra, cor }) {
  return (
    <div style={cardStyle}>
      <div style={labelStyle}>{rotulo}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: cor || "#22231F", fontVariantNumeric: "tabular-nums" }}>{valor}</div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 2 }}>
        {delta !== undefined && <Delta v={delta} inverso={inverso} />}
        {extra && <span style={{ fontSize: 11.5, color: "#8A8778" }}>{extra}</span>}
      </div>
    </div>
  );
}

// Faturamento por noite: o período atual em área azul e o anterior em
// linha tracejada, alinhados pela posição da noite (1ª com 1ª…).
function GraficoNoites({ atual, anterior, ini, iniAnt, dias }) {
  const [foco, setFoco] = useState(null);
  const mapaA = Object.fromEntries((atual || []).map((n) => [n.dia, Number(n.valor) || 0]));
  const mapaP = Object.fromEntries((anterior || []).map((n) => [n.dia, Number(n.valor) || 0]));
  const pontos = Array.from({ length: dias }, (_, i) => {
    const dA = ymd(somarDias(ini, i));
    const dP = ymd(somarDias(iniAnt, i));
    return { dia: dA, a: mapaA[dA] ?? null, p: mapaP[dP] ?? null, diaAnt: dP };
  });
  const max = Math.max(1, ...pontos.map((x) => Math.max(x.a || 0, x.p || 0)));
  const W = 640, H = 190, PE = 44, PD = 8, PT = 10, PB = 22;
  const x = (i) => PE + (dias <= 1 ? 0 : (i * (W - PE - PD)) / (dias - 1));
  const y = (v) => PT + (H - PT - PB) * (1 - v / max);
  const caminho = (k) => {
    let d = "", aberto = false;
    pontos.forEach((pt, i) => {
      if (pt[k] == null) { aberto = false; return; }
      d += `${aberto ? "L" : "M"}${x(i).toFixed(1)},${y(pt[k]).toFixed(1)} `;
      aberto = true;
    });
    return d;
  };
  const area = (() => {
    const seg = [];
    let atualSeg = [];
    pontos.forEach((pt, i) => {
      if (pt.a == null) { if (atualSeg.length) seg.push(atualSeg); atualSeg = []; return; }
      atualSeg.push(i);
    });
    if (atualSeg.length) seg.push(atualSeg);
    return seg.map((s) => `M${x(s[0])},${y(0)} ` + s.map((i) => `L${x(i)},${y(pontos[i].a)}`).join(" ") + ` L${x(s[s.length - 1])},${y(0)} Z`).join(" ");
  })();
  const grades = [0, 0.5, 1].map((f) => max * f);
  const passo = Math.max(1, Math.ceil(dias / 8));
  const pt = foco != null ? pontos[foco] : null;
  return (
    <div style={{ position: "relative" }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}
           onMouseLeave={() => setFoco(null)}
           onMouseMove={(e) => {
             const r = e.currentTarget.getBoundingClientRect();
             const px = ((e.clientX - r.left) / r.width) * W;
             const i = Math.round(((px - PE) / (W - PE - PD)) * (dias - 1));
             setFoco(Math.max(0, Math.min(dias - 1, i)));
           }}>
        {grades.map((g, i) => (
          <g key={i}>
            <line x1={PE} x2={W - PD} y1={y(g)} y2={y(g)} stroke="#EFE9DA" strokeWidth="1" />
            <text x={PE - 6} y={y(g) + 4} textAnchor="end" fontSize="10" fill="#8A8778">
              {g >= 1000 ? `${(g / 1000).toFixed(1).replace(".", ",")}k` : Math.round(g)}
            </text>
          </g>
        ))}
        <path d={area} fill="#2A78D6" opacity="0.10" />
        <path d={caminho("p")} fill="none" stroke="#A9A496" strokeWidth="1.5" strokeDasharray="5 4" strokeLinejoin="round" />
        <path d={caminho("a")} fill="none" stroke="#2A78D6" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        {pontos.map((p, i) => (i % passo === 0 || i === dias - 1) && (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#8A8778">{dataBR(p.dia)}</text>
        ))}
        {pt && (
          <g>
            <line x1={x(foco)} x2={x(foco)} y1={PT} y2={y(0)} stroke="#D8D1BF" strokeWidth="1" />
            {pt.a != null && <circle cx={x(foco)} cy={y(pt.a)} r="4.5" fill="#2A78D6" stroke="#FFFFFF" strokeWidth="2" />}
          </g>
        )}
      </svg>
      {pt && (
        <div style={{ position: "absolute", top: 4, left: `${Math.min(72, (x(foco) / W) * 100)}%`, background: "#22231F", color: "#FFFFFF",
                      borderRadius: 8, padding: "6px 9px", fontSize: 11.5, pointerEvents: "none", whiteSpace: "nowrap" }}>
          <div><b>{dataBR(pt.dia)}</b> · {pt.a == null ? "fechado" : brl(pt.a)}</div>
          <div style={{ opacity: 0.75 }}>{dataBR(pt.diaAnt)} · {pt.p == null ? "fechado" : brl(pt.p)}</div>
        </div>
      )}
    </div>
  );
}

// Barra de checklist: verde = no horário, amarelo = fora, fundo = não feito.
function BarraChecklist({ noHorario, fora, esperado }) {
  if (!esperado) return <span style={{ fontSize: 11, color: "#B4AF9E" }}>sem tarefas</span>;
  const pc = (n) => `${Math.min(100, (n / esperado) * 100)}%`;
  return (
    <div>
      <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: "#EFE9DA", gap: 2 }}>
        {noHorario > 0 && <div style={{ width: pc(noHorario), background: "#1BAF7A" }} />}
        {fora > 0 && <div style={{ width: pc(fora), background: "#EDA100" }} />}
      </div>
      <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
        {noHorario + fora}/{esperado}{fora > 0 ? ` · ${fora} fora do horário` : ""}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------
export default function PainelOperacao() {
  const [modo, setModo] = useState("30");
  const [dados, setDados] = useState(null);
  const [linhas, setLinhas] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [erroLinhas, setErroLinhas] = useState("");
  const [setorAberto, setSetorAberto] = useState(null);

  const j = useMemo(() => janelas(modo), [modo]);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(""); setErroLinhas("");
    const args = { p_inicio: ymd(j.ini), p_fim: ymd(j.fim), p_inicio_ant: ymd(j.iniAnt), p_fim_ant: ymd(j.fimAnt) };
    const [rOp, rLin] = await Promise.all([
      supabase.rpc("painel_operacao", args),
      supabase.rpc("desempenho_linhas", args),
    ]);
    if (rOp.error) {
      setErro(/does not exist|não existe|schema cache/i.test(rOp.error.message || "")
        ? "O painel da operação ainda não foi instalado no banco: falta rodar a migração 190."
        : rOp.error.message);
      setDados(null);
    } else {
      setDados(rOp.data || {});
    }
    if (rLin.error) { setErroLinhas(rLin.error.message); setLinhas(null); }
    else setLinhas(rLin.data || []);
    setCarregando(false);
  }, [j]);
  useEffect(() => { carregar(); }, [carregar]);

  // ---- contas ----
  const c = useMemo(() => {
    if (!dados) return null;
    const at = dados.atual || {}, an = dados.anterior || {};
    const fat = Number(at.faturamento) || 0, fatAnt = Number(an.faturamento) || 0;
    const ped = Number(at.pedidos) || 0, pedAnt = Number(an.pedidos) || 0;
    const ticket = ped ? fat / ped : 0, ticketAnt = pedAnt ? fatAnt / pedAnt : 0;

    const canalMapa = (lista) => Object.fromEntries((lista || []).map((k) => [k.canal, k]));
    const cA = canalMapa(at.por_canal), cP = canalMapa(an.por_canal);
    const canais = CANAIS.map((nome) => ({
      nome,
      valor: Number(cA[nome]?.valor) || 0,
      pedidos: Number(cA[nome]?.pedidos) || 0,
      ant: Number(cP[nome]?.valor) || 0,
    }));

    const cancel = dados.cancelados || [];
    const perdidos = cancel.filter((x) => !x.interno);
    const internos = cancel.filter((x) => x.interno);
    const valorPerdido = perdidos.reduce((s, x) => s + (Number(x.valor) || 0), 0);
    const valorInterno = internos.reduce((s, x) => s + (Number(x.valor) || 0), 0);
    const porCanal = {};
    perdidos.forEach((x) => {
      const k = x.canal;
      if (!porCanal[k]) porCanal[k] = { canal: k, qtd: 0, valor: 0, motivos: {} };
      porCanal[k].qtd += 1;
      porCanal[k].valor += Number(x.valor) || 0;
      const m = motivoBonito(x.motivo);
      porCanal[k].motivos[m] = (porCanal[k].motivos[m] || 0) + 1;
    });
    const perdasCanal = Object.values(porCanal)
      .map((p) => ({ ...p, motivo: Object.entries(p.motivos).sort((a, b) => b[1] - a[1])[0][0] }))
      .sort((a, b) => b.valor - a.valor);
    // "Teste" com valor dentro do horário da casa (17h às 4h): é o que
    // merece conferência com quem lançou.
    const testesSuspeitos = internos
      .filter((x) => Number(x.valor) > 0 && /teste/i.test(x.motivo || "")
        && (x.hora >= "17:00" || x.hora < "04:00"))
      .sort((a, b) => Number(b.valor) - Number(a.valor));

    // checklists
    const noites = [...(dados.noites || [])].sort();
    const reg = {};
    (dados.checklists || []).forEach((r) => { reg[`${r.dia}|${r.setor}|${r.etapa}`] = r; });
    const setores = (dados.setores || []).map((s) => {
      const etapas = {};
      ETAPAS.forEach(([et]) => {
        const temItens = !!s[et];
        let noHorario = 0, fora = 0;
        noites.forEach((n) => {
          const r = reg[`${n}|${s.chave}|${et}`];
          if (!r) return;
          if (r.no_horario) noHorario += 1; else fora += 1;
        });
        etapas[et] = { esperado: temItens ? noites.length : 0, noHorario, fora };
      });
      return { ...s, etapas };
    });
    let esperado = 0, feitos = 0, noHorarioTotal = 0;
    setores.forEach((s) => ETAPAS.forEach(([et]) => {
      esperado += s.etapas[et].esperado;
      if (s.etapas[et].esperado) {
        feitos += s.etapas[et].noHorario + s.etapas[et].fora;
        noHorarioTotal += s.etapas[et].noHorario;
      }
    }));
    const noitesSemSaida = noites.filter((n) => !setores.some((s) => reg[`${n}|${s.chave}|fechamento`])).length;

    // não conformes repetidos
    const nc = {};
    (dados.checklists || []).forEach((r) => (r.nao_conformes || []).forEach((it) => {
      const k = `${r.setor}|${it.item}`;
      if (!nc[k]) nc[k] = { setor: r.setor, item: it.item, vezes: 0, motivo: null, dia: "" };
      nc[k].vezes += 1;
      if (r.dia >= nc[k].dia) { nc[k].dia = r.dia; nc[k].motivo = it.motivo; }
    }));
    const rotuloSetor = Object.fromEntries(setores.map((s) => [s.chave, s.label]));
    const repetidos = Object.values(nc).filter((x) => x.vezes >= 2).sort((a, b) => b.vezes - a.vezes);

    const antCancel = dados.cancelados_anterior || {};
    return {
      fat, fatAnt, ped, pedAnt, ticket, ticketAnt, canais,
      valorPerdido, qtdPerdidos: perdidos.length, valorInterno, qtdInternos: internos.length,
      valorPerdidoAnt: Number(antCancel.valor) || 0,
      perdasCanal, testesSuspeitos,
      noites, reg, setores, esperado, feitos, noHorarioTotal, noitesSemSaida, repetidos, rotuloSetor,
    };
  }, [dados]);

  const linhasProduto = useMemo(() => {
    if (!linhas) return null;
    const ls = linhas.map((l) => ({ nome: l.linha || "Sem linha definida", atual: Number(l.valor_atual) || 0, ant: Number(l.valor_ant) || 0 }))
      .filter((l) => l.atual > 0 || l.ant > 0)
      .sort((a, b) => b.atual - a.atual);
    return { ls, max: Math.max(1, ...ls.map((l) => l.atual)) };
  }, [linhas]);

  const dias = Math.round((j.fim - j.ini) / 86400000) + 1;

  // ---- render ----
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <select value={modo} onChange={(e) => setModo(e.target.value)} style={selectStyle}>
          <option value="30">Últimos 30 dias</option>
          <option value="7">Últimos 7 dias</option>
          <option value="mes">Este mês</option>
        </select>
        <span style={{ fontSize: 12, color: "#8A8778" }}>
          {dataBR(ymd(j.ini))} a {dataBR(ymd(j.fim))} · comparado com {j.comparado}
        </span>
        {carregando && <Loader2 size={15} color="#8A8778" />}
      </div>

      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div>{erro}</div></div>}

      {c && (
        <>
          {/* Faturamento em destaque + KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 10 }}>
            <div style={{ ...cardStyle, gridColumn: "span 2", background: "#22231F", border: "none" }}>
              <div style={{ ...labelStyle, color: "#B9B3A4" }}>Faturamento</div>
              <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 40, lineHeight: 1.1, color: "#FFFFFF",
                            fontVariantNumeric: "tabular-nums" }}>
                {brlCurto(c.fat)}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
                <span style={{ background: "#FFFFFF", borderRadius: 99, padding: "2px 9px" }}><Delta v={variacao(c.fat, c.fatAnt)} grande /></span>
                <span style={{ fontSize: 12, color: "#B9B3A4" }}>eram {brlCurto(c.fatAnt)}</span>
              </div>
            </div>
            <Kpi rotulo="Pedidos" valor={c.ped.toLocaleString("pt-BR")} delta={variacao(c.ped, c.pedAnt)} />
            <Kpi rotulo="Ticket médio" valor={brl(c.ticket)} delta={variacao(c.ticket, c.ticketAnt)} />
            <Kpi rotulo="Vendas perdidas" valor={brlCurto(c.valorPerdido)} cor="#A32D2D"
                 delta={variacao(c.valorPerdido, c.valorPerdidoAnt)} inverso extra={`${c.qtdPerdidos} cancelados`} />
          </div>

          {/* Faturamento por noite */}
          <div style={{ ...cardStyle, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
              <div style={tituloStyle}>Faturamento por noite</div>
              <div style={{ display: "flex", gap: 14, fontSize: 11.5, color: "#8A8778" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, height: 3, background: "#2A78D6", borderRadius: 2 }} />Este período</span>
                <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 14, borderTop: "2px dashed #A9A496" }} />Período anterior</span>
              </div>
            </div>
            <GraficoNoites atual={dados.atual?.por_noite} anterior={dados.anterior?.por_noite} ini={j.ini} iniAnt={j.iniAnt} dias={dias} />
          </div>

          {/* Canais */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 10 }}>
            {c.canais.map((k) => (
              <div key={k.nome} style={cardStyle}>
                <div style={labelStyle}>{k.nome}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#22231F", fontVariantNumeric: "tabular-nums" }}>{brlCurto(k.valor)}</div>
                <Delta v={variacao(k.valor, k.ant)} />
                <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 2 }}>
                  {k.pedidos} pedidos · {c.fat ? Math.round((k.valor / c.fat) * 100) : 0}% do total
                </div>
              </div>
            ))}
          </div>

          {/* Linhas de produto */}
          <div style={{ ...cardStyle, marginBottom: 10 }}>
            <div style={tituloStyle}>Faturamento por linha de produto</div>
            {erroLinhas && <div style={{ fontSize: 12, color: "#A32D2D" }}>{erroLinhas}</div>}
            {linhasProduto && linhasProduto.ls.length === 0 && <div style={{ fontSize: 12, color: "#8A8778" }}>Sem vendas com item no período.</div>}
            {linhasProduto && linhasProduto.ls.map((l) => (
              <div key={l.nome} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 160px) minmax(0, 1fr) 96px 64px", gap: 8,
                                         alignItems: "center", fontSize: 12.5, padding: "5px 0" }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#22231F" }}>{l.nome}</span>
                <div style={{ background: "#F3EFE4", borderRadius: "0 5px 5px 0", height: 12 }}>
                  <div style={{ width: `${(l.atual / linhasProduto.max) * 100}%`, height: "100%", background: "#2A78D6", borderRadius: "0 5px 5px 0" }} />
                </div>
                <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{brlCurto(l.atual)}</span>
                <span style={{ textAlign: "right" }}><Delta v={variacao(l.atual, l.ant)} novo={!l.ant} /></span>
              </div>
            ))}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 10, marginBottom: 10 }}>
            {/* Cancelamentos */}
            <div style={cardStyle}>
              <div style={tituloStyle}>Cancelamentos</div>
              <div style={{ display: "flex", gap: 20, marginBottom: 8, flexWrap: "wrap" }}>
                <div>
                  <div style={labelStyle}>Venda perdida</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#A32D2D" }}>{brl(c.valorPerdido)}</div>
                  <div style={{ fontSize: 11, color: "#8A8778" }}>{c.qtdPerdidos} pedidos</div>
                </div>
                <div>
                  <div style={labelStyle}>Internos (teste, transferência…)</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: "#854F0B" }}>{brl(c.valorInterno)}</div>
                  <div style={{ fontSize: 11, color: "#8A8778" }}>{c.qtdInternos} lançamentos</div>
                </div>
              </div>
              {c.perdasCanal.length === 0 && <div style={{ fontSize: 12, color: "#8A8778" }}>Nenhuma venda perdida no período.</div>}
              {c.perdasCanal.map((p) => (
                <div key={p.canal} style={{ display: "grid", gridTemplateColumns: "92px minmax(0, 1fr) 84px", gap: 8, fontSize: 12.5,
                                            padding: "6px 0", borderTop: "1px solid #F0EBDD" }}>
                  <span>{p.canal}</span>
                  <span style={{ color: "#8A8778", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.motivo}>
                    {p.qtd} · {p.motivo}
                  </span>
                  <span style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{brl(p.valor)}</span>
                </div>
              ))}
              {c.testesSuspeitos.length > 0 && (
                <div style={{ marginTop: 10, background: "#FBF0D5", borderRadius: 10, padding: "9px 11px" }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, fontWeight: 700, color: "#854F0B", marginBottom: 4 }}>
                    <AlertTriangle size={14} /> "Teste" com valor em horário de serviço
                  </div>
                  {c.testesSuspeitos.map((t, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "44px 42px 78px minmax(0, 1fr)", gap: 6, fontSize: 12, color: "#633806", padding: "2px 0" }}>
                      <span>{dataBR(t.dia)}</span><span>{t.hora}</span>
                      <span style={{ textAlign: "right", fontWeight: 700 }}>{brl(t.valor)}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.quem || "sem nome"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Checklists */}
            <div style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                <div style={tituloStyle}>Checklists</div>
                <div style={{ fontSize: 12, color: "#8A8778" }}>
                  <b style={{ color: "#22231F" }}>{c.esperado ? Math.round((c.feitos / c.esperado) * 100) : 0}%</b> feitos ·{" "}
                  {c.noites.length} noites · {c.noitesSemSaida} sem nenhuma saída
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "92px 1fr 1fr", gap: 10, fontSize: 11, color: "#8A8778", margin: "6px 0 2px" }}>
                <span /><span>Entrada · 17h–20h</span><span>Saída · 23h–04h</span>
              </div>
              {c.setores.map((s) => {
                const aberto = setorAberto === s.chave;
                return (
                  <div key={s.chave} style={{ borderTop: "1px solid #F0EBDD" }}>
                    <div onClick={() => setSetorAberto(aberto ? null : s.chave)}
                         style={{ display: "grid", gridTemplateColumns: "92px 1fr 1fr", gap: 10, alignItems: "center", padding: "7px 0", cursor: "pointer" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 12.5, color: "#22231F" }}>
                        {aberto ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{s.label}
                      </span>
                      {ETAPAS.map(([et]) => <BarraChecklist key={et} {...s.etapas[et]} />)}
                    </div>
                    {aberto && (
                      <div style={{ background: "#FBF8F1", borderRadius: 8, padding: "6px 8px", marginBottom: 8 }}>
                        {[...c.noites].reverse().map((n) => (
                          <div key={n} style={{ display: "grid", gridTemplateColumns: "44px 1fr 1fr", gap: 8, fontSize: 11.5, padding: "3px 0" }}>
                            <span style={{ color: "#8A8778" }}>{dataBR(n)}</span>
                            {ETAPAS.map(([et]) => {
                              const r = c.reg[`${n}|${s.chave}|${et}`];
                              if (!s.etapas[et].esperado) return <span key={et} style={{ color: "#B4AF9E" }}>—</span>;
                              if (!r) return <span key={et} style={{ color: "#A32D2D" }}>não fez</span>;
                              return (
                                <span key={et} style={{ color: r.no_horario ? "#0F6E56" : "#854F0B" }} title={(r.nao_conformes || []).map((x) => `${x.item}: ${x.motivo || "sem motivo"}`).join("\n")}>
                                  {r.quando?.slice(6)} · {String(r.responsavel || "").split(" ")[0]}
                                  {(r.nao_conformes || []).length > 0 && ` · ${r.nao_conformes.length} NC`}
                                </span>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 12, marginTop: 8, fontSize: 11, color: "#8A8778", flexWrap: "wrap" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: "#1BAF7A" }} />no horário</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: "#EDA100" }} />fora do horário</span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: "#EFE9DA" }} />não feito</span>
              </div>
            </div>
          </div>

          {/* Não conformes que se repetem */}
          {c.repetidos.length > 0 && (
            <div style={cardStyle}>
              <div style={tituloStyle}>Não conformes que se repetem</div>
              {c.repetidos.map((r) => (
                <div key={`${r.setor}|${r.item}`} style={{ display: "grid", gridTemplateColumns: "90px minmax(0, 1fr) 54px minmax(0, 1fr)", gap: 8,
                                                          fontSize: 12.5, padding: "6px 0", borderTop: "1px solid #F0EBDD" }}>
                  <span style={{ color: "#8A8778" }}>{c.rotuloSetor[r.setor] || r.setor}</span>
                  <span>{r.item}</span>
                  <span style={{ textAlign: "right", fontWeight: 700 }}>{r.vezes}×</span>
                  <span style={{ color: "#8A8778", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    último ({dataBR(r.dia)}): {r.motivo || "sem motivo"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 14, padding: "14px 16px" };
const labelStyle = { fontSize: 10.5, color: "#8A8778", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 };
const tituloStyle = { fontSize: 14, fontWeight: 800, color: "#22231F", marginBottom: 8 };
const selectStyle = { padding: "8px 10px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF", color: "#22231F" };
const avisoStyle = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 14 };
