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

function montarTextoRelatorio({ dia, vendas, statusDia, alertas, deptKeys }) {
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
  const texto = pronto ? montarTextoRelatorio({ dia, vendas, statusDia, alertas, deptKeys }) : "";

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
