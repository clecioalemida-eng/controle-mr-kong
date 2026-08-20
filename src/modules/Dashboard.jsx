import React, { useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { supabase, extrairErroFuncao } from "../lib/supabaseClient";

function brl(v) { return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function round2(n) { return Math.round((n || 0) * 100) / 100; }
function ehFimDeSemana(data) { const dia = data.getDay(); return dia === 0 || dia === 5 || dia === 6; }
function diasNoMes(ano, mesIndex0) { return new Date(ano, mesIndex0 + 1, 0).getDate(); }

const CENTRO_CUSTO_LABEL = {
  pessoas: "Pessoas", insumos: "Insumos", utensilios: "Utensílios", manutencao: "Consertos e manutenção",
  imobilizado: "Imobilizado", ocupacao: "Ocupação", utilidades: "Utilidades", impostos: "Impostos e taxas",
  marketing: "Marketing e vendas", administrativo: "Administrativo",
};

// Dashboard: junta previsão de faturamento (resto do mês, mês seguinte,
// comparativo semana a semana vs mês anterior) com os custos do Plano
// de Contas (o que já foi lançado nesse mês + a média histórica dos
// meses anteriores pro que falta), pra chegar num lucro previsto.
export default function Dashboard() {
  const [carregando, setCarregando] = useState(true);
  const [buscandoVendas, setBuscandoVendas] = useState(false);
  const [erro, setErro] = useState("");
  const [faturamento, setFaturamento] = useState(null);
  const [custos, setCustos] = useState(null);

  const buscarCustos = React.useCallback(async () => {
    const { data } = await supabase.from("contas_pagar").select("valor_total, data_vencimento, centro_custo, categoria");
    const hoje = new Date();
    const anoMesAtual = hoje.toISOString().slice(0, 7);

    // já lançado esse mês (por vencimento) — o que já sabemos que vem
    const jaLancadoMes = (data || []).filter((c) => c.data_vencimento?.startsWith(anoMesAtual));
    const totalJaLancado = jaLancadoMes.reduce((s, c) => s + (c.valor_total || 0), 0);
    const porCentroCusto = {};
    jaLancadoMes.forEach((c) => {
      const chave = c.centro_custo || "sem_centro";
      porCentroCusto[chave] = (porCentroCusto[chave] || 0) + (c.valor_total || 0);
    });

    // média histórica dos meses anteriores, por centro de custo — só
    // pra estimar o que ainda não foi lançado esse mês (ex.: conta de
    // luz que só chega dia 20)
    const porMesPorCentro = {};
    (data || []).forEach((c) => {
      if (!c.data_vencimento || c.data_vencimento.startsWith(anoMesAtual)) return;
      const mes = c.data_vencimento.slice(0, 7);
      const chave = c.centro_custo || "sem_centro";
      if (!porMesPorCentro[mes]) porMesPorCentro[mes] = {};
      porMesPorCentro[mes][chave] = (porMesPorCentro[mes][chave] || 0) + (c.valor_total || 0);
    });
    const mesesHistorico = Object.keys(porMesPorCentro);
    const mediaMensalPorCentro = {};
    mesesHistorico.forEach((mes) => {
      Object.entries(porMesPorCentro[mes]).forEach(([centro, valor]) => {
        if (!mediaMensalPorCentro[centro]) mediaMensalPorCentro[centro] = [];
        mediaMensalPorCentro[centro].push(valor);
      });
    });
    const mediaPorCentro = {};
    Object.entries(mediaMensalPorCentro).forEach(([centro, valores]) => {
      mediaPorCentro[centro] = round2(valores.reduce((s, v) => s + v, 0) / valores.length);
    });

    // previsto do mês = o que já foi lançado + a média histórica dos
    // centros que ainda não tiveram nada lançado esse mês (evita somar
    // duas vezes um centro que já lançou)
    let totalPrevisto = totalJaLancado;
    Object.entries(mediaPorCentro).forEach(([centro, media]) => {
      if (!(centro in porCentroCusto)) totalPrevisto += media;
    });

    setCustos({ totalJaLancado, totalPrevisto, porCentroCusto, mediaPorCentro });
  }, []);

  const buscarFaturamento = async () => {
    setBuscandoVendas(true);
    setErro("");
    const hoje = new Date();
    const inicio = new Date(hoje);
    inicio.setDate(inicio.getDate() - 90); // cobre o mês atual + anterior + uma base de 30 dias pra média

    const { data, error } = await supabase.functions.invoke("cardapioweb-proxy", {
      body: { data_inicio: `${inicio.toISOString().slice(0, 10)}T00:00:00-03:00`, data_fim: `${hoje.toISOString().slice(0, 10)}T23:59:59-03:00` },
    });
    if (error) { setErro(await extrairErroFuncao(error)); setBuscandoVendas(false); return; }
    if (data?.error) { setErro(data.error); setBuscandoVendas(false); return; }

    const porDia = {};
    (data.pedidos || []).forEach((p) => {
      if (p.status !== "closed") return;
      const dia = String(p.created_at).slice(0, 10);
      porDia[dia] = (porDia[dia] || 0) + (p.total || 0);
    });

    // médias de dia útil e fim de semana, últimos 30 dias
    let somaUtil = 0, nUtil = 0, somaFds = 0, nFds = 0;
    for (let i = 1; i <= 30; i++) {
      const d = new Date(hoje); d.setDate(d.getDate() - i);
      const chave = d.toISOString().slice(0, 10);
      const valor = porDia[chave] || 0;
      if (ehFimDeSemana(d)) { somaFds += valor; nFds++; } else { somaUtil += valor; nUtil++; }
    }
    const mediaUtil = nUtil > 0 ? somaUtil / nUtil : 0;
    const mediaFds = nFds > 0 ? somaFds / nFds : 0;

    // mês atual: realizado até hoje + previsto pros dias que faltam
    const anoAtual = hoje.getFullYear(), mesAtual = hoje.getMonth();
    const totalDiasMes = diasNoMes(anoAtual, mesAtual);
    let realizadoMes = 0;
    for (let dia = 1; dia <= hoje.getDate(); dia++) {
      const chave = `${anoAtual}-${String(mesAtual + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
      realizadoMes += porDia[chave] || 0;
    }
    let previstoRestoMes = 0;
    for (let dia = hoje.getDate() + 1; dia <= totalDiasMes; dia++) {
      const d = new Date(anoAtual, mesAtual, dia);
      previstoRestoMes += ehFimDeSemana(d) ? mediaFds : mediaUtil;
    }

    // mês seguinte inteiro, só com a média (não tem realizado ainda)
    const proxMesIndex = mesAtual + 1, proxAno = proxMesIndex > 11 ? anoAtual + 1 : anoAtual, proxMesNorm = proxMesIndex % 12;
    const diasProxMes = diasNoMes(proxAno, proxMesNorm);
    let previstoProxMes = 0;
    for (let dia = 1; dia <= diasProxMes; dia++) {
      const d = new Date(proxAno, proxMesNorm, dia);
      previstoProxMes += ehFimDeSemana(d) ? mediaFds : mediaUtil;
    }

    // comparativo semana a semana: mês atual (até hoje) vs mesmas
    // semanas do mês anterior — semana = blocos de 7 dias corridos do
    // mês (1-7, 8-14, 15-21, 22-28, 29+)
    const mesAnteriorIndex = mesAtual - 1, anoAnterior = mesAnteriorIndex < 0 ? anoAtual - 1 : anoAtual, mesAnteriorNorm = (mesAnteriorIndex + 12) % 12;
    const semanas = [];
    for (let semana = 0; semana < 5; semana++) {
      const diaIni = semana * 7 + 1;
      const diaFimAtual = Math.min(diaIni + 6, totalDiasMes);
      if (diaIni > totalDiasMes) break;
      let somaAtual = 0;
      for (let dia = diaIni; dia <= Math.min(diaFimAtual, hoje.getDate()); dia++) {
        const chave = `${anoAtual}-${String(mesAtual + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
        somaAtual += porDia[chave] || 0;
      }
      const diasNoMesAnterior = diasNoMes(anoAnterior, mesAnteriorNorm);
      const diaFimAnterior = Math.min(diaIni + 6, diasNoMesAnterior);
      let somaAnterior = 0;
      for (let dia = diaIni; dia <= diaFimAnterior; dia++) {
        const chave = `${anoAnterior}-${String(mesAnteriorNorm + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
        somaAnterior += porDia[chave] || 0;
      }
      if (somaAtual === 0 && somaAnterior === 0 && diaIni > hoje.getDate()) continue;
      semanas.push({ label: `Semana ${semana + 1}`, atual: round2(somaAtual), anterior: round2(somaAnterior) });
    }

    setFaturamento({
      realizadoMes: round2(realizadoMes),
      previstoRestoMes: round2(previstoRestoMes),
      totalMes: round2(realizadoMes + previstoRestoMes),
      previstoProxMes: round2(previstoProxMes),
      mediaUtil: round2(mediaUtil),
      mediaFds: round2(mediaFds),
      semanas,
    });
    setBuscandoVendas(false);
  };

  React.useEffect(() => {
    (async () => {
      setCarregando(true);
      await buscarCustos();
      setCarregando(false);
    })();
  }, [buscarCustos]);

  const lucroPrevisto = faturamento && custos ? round2(faturamento.totalMes - custos.totalPrevisto) : null;

  return (
    <div>
      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}

      {!faturamento && (
        <button onClick={buscarFaturamento} disabled={buscandoVendas} style={{ ...btnPrimary, width: "100%", display: "flex", justifyContent: "center", gap: 6, marginBottom: 16 }}>
          {buscandoVendas ? <Loader2 size={16} /> : <RefreshCw size={16} />} Calcular previsão de faturamento
        </button>
      )}

      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <>
          {faturamento && custos && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
                <div style={cardStyle}>
                  <div style={labelStyle}>Faturamento previsto (mês)</div>
                  <div style={valorGrande}>{brl(faturamento.totalMes)}</div>
                  <div style={{ fontSize: 10, color: "#8A8778" }}>Realizado {brl(faturamento.realizadoMes)} + previsto {brl(faturamento.previstoRestoMes)}</div>
                </div>
                <div style={cardStyle}>
                  <div style={labelStyle}>Custos previstos (mês)</div>
                  <div style={valorGrande}>{brl(custos.totalPrevisto)}</div>
                  <div style={{ fontSize: 10, color: "#8A8778" }}>Já lançado {brl(custos.totalJaLancado)}</div>
                </div>
              </div>

              <div style={{ ...cardStyle, textAlign: "center", background: "#F6F1E7", marginBottom: 16 }}>
                <div style={labelStyle}>Lucro previsto do mês</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: lucroPrevisto >= 0 ? "#0F6E56" : "#A32D2D" }}>{brl(lucroPrevisto)}</div>
              </div>

              <div style={{ ...cardStyle, marginBottom: 16 }}>
                <div style={labelStyle}>Previsão pro mês seguinte</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#22231F" }}>{brl(faturamento.previstoProxMes)}</div>
                <div style={{ fontSize: 10, color: "#8A8778" }}>Baseado na média de dia útil ({brl(faturamento.mediaUtil)}) e fim de semana ({brl(faturamento.mediaFds)}) dos últimos 30 dias</div>
              </div>

              {faturamento.semanas.length > 0 && (
                <>
                  <div style={sectionLabel}>Semana a semana — mês atual vs mês anterior</div>
                  <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF", marginBottom: 16 }}>
                    {faturamento.semanas.map((s, idx) => {
                      const diferenca = s.anterior > 0 ? ((s.atual - s.anterior) / s.anterior) * 100 : null;
                      return (
                        <div key={s.label} style={{ padding: "10px 14px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#22231F", marginBottom: 2 }}>
                            <span>{s.label}</span>
                            {diferenca != null && <span style={{ color: diferenca >= 0 ? "#0F6E56" : "#A32D2D", fontWeight: 700 }}>{diferenca >= 0 ? "+" : ""}{diferenca.toFixed(1)}%</span>}
                          </div>
                          <div style={{ fontSize: 11, color: "#8A8778" }}>Esse mês {brl(s.atual)} · Mês anterior {brl(s.anterior)}</div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              <div style={sectionLabel}>Custos por centro de custo</div>
              <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF" }}>
                {Object.entries(custos.porCentroCusto).sort((a, b) => b[1] - a[1]).map(([centro, valor], idx) => (
                  <div key={centro} style={{ display: "flex", justifyContent: "space-between", padding: "8px 14px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", fontSize: 12 }}>
                    <span style={{ color: centro === "sem_centro" ? "#A32D2D" : "#22231F" }}>{centro === "sem_centro" ? "Sem centro de custo" : (CENTRO_CUSTO_LABEL[centro] || centro)}</span>
                    <span style={{ color: "#22231F" }}>{brl(valor)}</span>
                  </div>
                ))}
                {Object.keys(custos.porCentroCusto).length === 0 && <div style={{ padding: 14, fontSize: 13, color: "#8A8778" }}>Nenhuma conta lançada esse mês ainda.</div>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const sectionLabel = { fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778", marginBottom: 8 };
const labelStyle = { fontSize: 10, color: "#8A8778", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 4 };
const valorGrande = { fontSize: 17, fontWeight: 700, color: "#22231F" };
const btnPrimary = { background: "#22231F", color: "#F3EFE3", border: "none", borderRadius: 10, padding: "12px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer" };
const avisoStyle = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 14 };
