import React, { useState, useRef } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { supabase, extrairErroFuncao } from "../lib/supabaseClient";

function brl(v) { return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function round2(n) { return Math.round((n || 0) * 100) / 100; }
function ehFimDeSemana(data) { const dia = data.getDay(); return dia === 0 || dia === 5 || dia === 6; }
function diasNoMes(ano, mesIndex0) { return new Date(ano, mesIndex0 + 1, 0).getDate(); }

// Data no fuso local (America/Sao_Paulo), NUNCA via toISOString().
// toISOString() converte pra UTC e, como estamos em UTC-3, depois das 21h
// ele já devolve o dia seguinte — o que fazia o Dashboard contar um dia a
// mais no "realizado do mês".
function ymd(d) {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${ano}-${mes}-${dia}`;
}
function somarDias(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function esperar(ms) { return new Promise((r) => setTimeout(r, ms)); }

const JANELA_DIAS = 90;       // histórico usado nas médias e no comparativo
const TAMANHO_FATIA = 4;      // dias por chamada da Edge Function
const SEGUNDOS_POR_DIA = 25;  // estimativa: histórico + detalhe de cada pedido
const PAUSA_ENTRE_FATIAS = 20000;   // 20s — a função já espera 12s entre dias
const PAUSA_APOS_LIMITE = 75000;    // se o CardápioWeb reclamar, espera mais

const CENTRO_CUSTO_LABEL = {
  pessoas: "Pessoas", insumos: "Insumos", utensilios: "Utensílios", manutencao: "Consertos e manutenção",
  imobilizado: "Imobilizado", ocupacao: "Ocupação", utilidades: "Utilidades", impostos: "Impostos e taxas",
  marketing: "Marketing e vendas", administrativo: "Administrativo",
};

// Dashboard: junta previsão de faturamento (resto do mês, mês seguinte,
// comparativo semana a semana vs mês anterior) com os custos do Plano
// de Contas (o que já foi lançado nesse mês + a média histórica dos
// meses anteriores pro que falta), pra chegar num lucro previsto.
//
// O faturamento vem da tabela `vendas_diarias` (cache), populada pela
// Edge Function `sincronizar-vendas-diarias` — que roda sozinha todo dia
// às 4h via pg_cron. NÃO chama mais o CardápioWeb ao vivo: 90 dias de
// histórico estouravam o limite de 5 consultas/minuto.
export default function Dashboard() {
  const [carregando, setCarregando] = useState(true);
  const [recalculando, setRecalculando] = useState(false);
  const [erro, setErro] = useState("");
  const [faturamento, setFaturamento] = useState(null);
  const [custos, setCustos] = useState(null);
  const [cache, setCache] = useState(null); // { total, ultimoDia, atualizadoEm, faltando }
  const [sincronizando, setSincronizando] = useState(false);
  const [progresso, setProgresso] = useState(null); // { fatia, totalFatias, diasFeitos, totalDias, de, ate }
  const cancelarRef = useRef(false);

  // ------------------------------------------------------------------
  // Custos (Plano de Contas) — igual ao que já existia
  // ------------------------------------------------------------------
  const buscarCustos = React.useCallback(async () => {
    const { data } = await supabase.from("contas_pagar").select("valor_total, data_vencimento, centro_custo, categoria");
    const hoje = new Date();
    const anoMesAtual = ymd(hoje).slice(0, 7);
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

  // ------------------------------------------------------------------
  // Cache de vendas — um select simples, sem chamada externa
  // ------------------------------------------------------------------
  const listaDaJanela = React.useCallback(() => {
    // do dia (hoje - 90) até ONTEM. Hoje fica de fora porque o dia ainda
    // não fechou no CardápioWeb.
    const hoje = new Date();
    const dias = [];
    for (let i = JANELA_DIAS; i >= 1; i--) dias.push(ymd(somarDias(hoje, -i)));
    return dias;
  }, []);

  const buscarCache = React.useCallback(async () => {
    const dias = listaDaJanela();
    const { data, error } = await supabase
      .from("vendas_diarias")
      .select("dia, faturamento_bruto, atualizado_em")
      .gte("dia", dias[0])
      .lte("dia", dias[dias.length - 1])
      .order("dia", { ascending: true });
    if (error) { setErro(error.message); return null; }
    const linhas = data || [];
    const presentes = new Set(linhas.map((l) => l.dia));
    const faltando = dias.filter((d) => !presentes.has(d));
    let atualizadoEm = null;
    linhas.forEach((l) => {
      if (l.atualizado_em && (!atualizadoEm || l.atualizado_em > atualizadoEm)) atualizadoEm = l.atualizado_em;
    });
    setCache({
      total: linhas.length,
      ultimoDia: linhas.length ? linhas[linhas.length - 1].dia : null,
      atualizadoEm,
      faltando,
    });
    return linhas;
  }, [listaDaJanela]);

  // ------------------------------------------------------------------
  // Toda a matemática de previsão — idêntica à versão anterior, só que
  // alimentada pelo cache em vez da resposta do CardápioWeb
  // ------------------------------------------------------------------
  const calcularFaturamento = React.useCallback((linhas) => {
    if (!linhas || linhas.length === 0) { setFaturamento(null); return; }
    const hoje = new Date();
    const porDia = {};
    linhas.forEach((l) => { porDia[l.dia] = Number(l.faturamento_bruto) || 0; });

    // médias de dia útil e fim de semana, últimos 30 dias
    let somaUtil = 0, nUtil = 0, somaFds = 0, nFds = 0;
    for (let i = 1; i <= 30; i++) {
      const d = somarDias(hoje, -i);
      const chave = ymd(d);
      if (!(chave in porDia)) continue; // dia sem cache não entra na média
      const valor = porDia[chave];
      if (ehFimDeSemana(d)) { somaFds += valor; nFds++; } else { somaUtil += valor; nUtil++; }
    }
    const mediaUtil = nUtil > 0 ? somaUtil / nUtil : 0;
    const mediaFds = nFds > 0 ? somaFds / nFds : 0;

    // mês atual: realizado até hoje + previsto pros dias que faltam.
    // O cache vai só até ONTEM (o dia de hoje ainda não fechou no
    // CardápioWeb), então hoje entra como PREVISTO, não como realizado —
    // senão o dia sumiria da conta, não entrando em nenhum dos dois.
    const anoAtual = hoje.getFullYear(), mesAtual = hoje.getMonth();
    const totalDiasMes = diasNoMes(anoAtual, mesAtual);
    const temHojeNoCache = ymd(hoje) in porDia;
    let realizadoMes = 0;
    for (let dia = 1; dia <= hoje.getDate(); dia++) {
      const chave = `${anoAtual}-${String(mesAtual + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
      realizadoMes += porDia[chave] || 0;
    }
    let previstoRestoMes = 0;
    for (let dia = hoje.getDate() + (temHojeNoCache ? 1 : 0); dia <= totalDiasMes; dia++) {
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
      diasNaMedia: nUtil + nFds,
      semanas,
    });
  }, []);

  const atualizar = async () => {
    setRecalculando(true);
    setErro("");
    const linhas = await buscarCache();
    calcularFaturamento(linhas);
    await buscarCustos();
    setRecalculando(false);
  };

  // ------------------------------------------------------------------
  // Carga inicial do histórico — fatiada, com pausa, e retomável
  // ------------------------------------------------------------------
  const popularHistorico = async () => {
    setErro("");
    cancelarRef.current = false;
    setSincronizando(true);

    const dias = listaDaJanela();
    // relê o cache na hora, pra não trabalhar em cima de estado velho
    const linhas = await buscarCache();
    const presentes = new Set((linhas || []).map((l) => l.dia));

    // fatias de dias corridos; pula inteira a fatia que já está toda no cache
    const fatias = [];
    for (let i = 0; i < dias.length; i += TAMANHO_FATIA) {
      const bloco = dias.slice(i, i + TAMANHO_FATIA);
      if (bloco.every((d) => presentes.has(d))) continue;
      fatias.push(bloco);
    }

    if (fatias.length === 0) {
      setSincronizando(false);
      setProgresso(null);
      await atualizar();
      return;
    }

    const totalDias = fatias.reduce((s, f) => s + f.length, 0);
    let diasFeitos = 0;

    for (let i = 0; i < fatias.length; i++) {
      if (cancelarRef.current) break;
      const bloco = fatias[i];
      const de = bloco[0], ate = bloco[bloco.length - 1];
      setProgresso({ fatia: i + 1, totalFatias: fatias.length, diasFeitos, totalDias, de, ate });

      let tentativas = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { data, error } = await supabase.functions.invoke("sincronizar-vendas-diarias", {
          body: { data_inicio: de, data_fim: ate },
        });
        let msg = "";
        if (error) msg = await extrairErroFuncao(error);
        else if (data?.error) msg = data.error;
        if (!msg) break;

        const ehLimite = /limit|429|consultas por minuto|rate/i.test(msg);
        if (ehLimite && tentativas < 2) {
          tentativas++;
          setProgresso({ fatia: i + 1, totalFatias: fatias.length, diasFeitos, totalDias, de, ate, esperando: true });
          await esperar(PAUSA_APOS_LIMITE);
          if (cancelarRef.current) break;
          continue;
        }
        setErro(`${msg} — parou em ${de}. Clique de novo em "Continuar carga" que ele retoma daqui.`);
        setSincronizando(false);
        setProgresso(null);
        await atualizar();
        return;
      }

      if (cancelarRef.current) break;
      diasFeitos += bloco.length;
      setProgresso({ fatia: i + 1, totalFatias: fatias.length, diasFeitos, totalDias, de, ate });
      if (i < fatias.length - 1) await esperar(PAUSA_ENTRE_FATIAS);
    }

    setSincronizando(false);
    setProgresso(null);
    if (cancelarRef.current) setErro("Carga interrompida. Os dias já baixados ficaram salvos — clique em \"Continuar carga\" quando quiser retomar.");
    await atualizar();
  };

  React.useEffect(() => {
    (async () => {
      setCarregando(true);
      const [linhas] = await Promise.all([buscarCache(), buscarCustos()]);
      calcularFaturamento(linhas);
      setCarregando(false);
    })();
  }, [buscarCache, buscarCustos, calcularFaturamento]);

  const lucroPrevisto = faturamento && custos ? round2(faturamento.totalMes - custos.totalPrevisto) : null;
  const faltando = cache?.faltando?.length || 0;
  const cacheVazio = !cache || cache.total === 0;
  const cacheParcial = !cacheVazio && faltando > 0;
  const pct = progresso && progresso.totalDias > 0 ? Math.round((progresso.diasFeitos / progresso.totalDias) * 100) : 0;

  function dataHoraCurta(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  return (
    <div>
      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}

      {/* Carga inicial em andamento */}
      {sincronizando && progresso && (
        <div style={{ ...cardStyle, marginBottom: 14 }}>
          <div style={labelStyle}>Carregando histórico</div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#22231F" }}>Fatia {progresso.fatia} de {progresso.totalFatias}</div>
          <div style={barraStyle}><div style={{ ...barraFillStyle, width: `${pct}%` }} /></div>
          <div style={{ fontSize: 10, color: "#8A8778" }}>
            {progresso.diasFeitos} de {progresso.totalDias} dias · buscando {progresso.de} a {progresso.ate}
          </div>
          {progresso.esperando && (
            <div style={{ fontSize: 10, color: "#7A6A1E", marginTop: 4 }}>
              O CardápioWeb pediu pra esperar — aguardando pra tentar essa fatia de novo.
            </div>
          )}
          <div style={{ fontSize: 10, color: "#8A8778", marginTop: 6 }}>
            Pausa de {PAUSA_ENTRE_FATIAS / 1000}s entre fatias, pra respeitar o limite de 5 consultas/min. Pode deixar a aba aberta e ir fazer outra coisa.
          </div>
          <button onClick={() => { cancelarRef.current = true; }} style={{ ...btnGhost, width: "100%", marginTop: 10 }}>Interromper</button>
        </div>
      )}

      {/* Cache vazio ou incompleto */}
      {!carregando && !sincronizando && (cacheVazio || cacheParcial) && (
        <>
          <div style={avisoStyle}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 13 }}>
              {cacheVazio
                ? "O histórico de vendas ainda não foi carregado. Sem ele a previsão não tem base de cálculo."
                : `Faltam ${faltando} dias no histórico. A previsão até funciona, mas fica menos confiável.`}
            </div>
          </div>
          <button onClick={popularHistorico} style={{ ...btnPrimary, width: "100%", display: "flex", justifyContent: "center", gap: 6, marginBottom: 6 }}>
            <RefreshCw size={16} /> {cacheVazio ? "Popular histórico inicial" : "Continuar carga"}
          </button>
          <div style={{ fontSize: 10, color: "#8A8778", textAlign: "center", marginBottom: 16 }}>
            {faltando} dias faltando · cerca de {Math.max(1, Math.round((faltando / TAMANHO_FATIA) * (PAUSA_ENTRE_FATIAS / 1000 + TAMANHO_FATIA * SEGUNDOS_POR_DIA) / 60))} min
          </div>
        </>
      )}

      {/* Status do cache */}
      {!carregando && !cacheVazio && (
        <div style={statusStyle}>
          <span style={{ ...dotStyle, background: cacheParcial ? "#C08A2E" : "#0F6E56" }} />
          Cache com {cache.total} dias · atualizado {dataHoraCurta(cache.atualizadoEm)}
        </div>
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
                <div style={{ fontSize: 10, color: "#8A8778" }}>Baseado na média de dia útil ({brl(faturamento.mediaUtil)}) e fim de semana ({brl(faturamento.mediaFds)}) dos últimos 30 dias{faturamento.diasNaMedia < 30 ? ` — só ${faturamento.diasNaMedia} dias disponíveis no cache` : ""}</div>
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

              {!sincronizando && (
                <button onClick={atualizar} disabled={recalculando} style={{ ...btnGhost, width: "100%", display: "flex", justifyContent: "center", gap: 6, marginTop: 16 }}>
                  {recalculando ? <Loader2 size={14} /> : <RefreshCw size={14} />} Atualizar
                </button>
              )}
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
const btnGhost = { background: "#FFFFFF", color: "#55534A", border: "1px solid #E8E2D2", borderRadius: 10, padding: "10px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" };
const avisoStyle = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 14 };
const statusStyle = { display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#8A8778", marginBottom: 12, padding: "0 2px" };
const dotStyle = { width: 6, height: 6, borderRadius: "50%", flex: "none" };
const barraStyle = { height: 7, borderRadius: 99, background: "#E3DDCB", overflow: "hidden", margin: "10px 0 7px" };
const barraFillStyle = { height: "100%", background: "#22231F", borderRadius: 99, transition: "width .3s" };
