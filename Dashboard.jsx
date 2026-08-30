// ===== Dashboard.jsx =====
import React, { useState, useRef } from "react";
import { AlertTriangle, Loader2, RefreshCw, TrendingUp, TrendingDown, Trophy, Layers } from "lucide-react";
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

// Padrão, usado enquanto os rótulos não chegam do banco (ou se a
// migração 080 ainda não rodou). A lista de verdade fica em
// `listas_opcoes` e é editada em DRE → Listas.
const CENTRO_CUSTO_PADRAO = {
  pessoas: "Pessoas", insumos: "Insumos", utensilios: "Utensílios", manutencao: "Consertos e manutenção",
  imobilizado: "Imobilizado", ocupacao: "Ocupação", utilidades: "Utilidades", impostos: "Impostos e taxas",
  marketing: "Marketing e vendas", administrativo: "Administrativo",
};

// Piso pro ranking de crescimento e queda: produto que custa menos que
// isso fica de fora. Bala, bombom e refrigerante sobem e descem muito em
// percentual sem mover o caixa — sem esse piso, uma bala que vendeu 10
// no mês passado e 30 nesse vira "+200%" e empurra pra fora da lista o
// combo que cresceu de verdade. O preço é o MÉDIO praticado nos dois
// períodos, não o de tabela: pega também o item que ainda não está no
// cadastro de pratos.
const PISO_PRECO = 9;
// Mesma lista de Fichas técnicas. Fica repetida de propósito: são dois
// módulos independentes, e um importar o outro só por causa de um array
// amarraria as duas telas por nada.
const LINHAS_PRODUTO = [
  "Hambúrguer Gourmet", "Hambúrguer Tradicional", "Bebidas", "Bombons e Balas",
  "Milkshake e Sorvetes", "Cremes", "Petiscos", "Chapa", "Combos", "Batatas Fritas", "Açaí",
];
// Palavras que não ajudam a reconhecer um produto renomeado — aparecem em
// meio cardápio e casariam qualquer coisa com qualquer coisa.
// Como o banco chama a fatia dos produtos que ainda nao tem linha. E o
// rotulo que aparece no quadro — e agora tambem o gancho: e nessa linha
// que o botao de preencher mora, porque e ali que a pessoa procura.
const ROTULO_SEM_LINHA = "Sem linha definida";
// "sem linha" pode chegar como vazio (se algum dia a consulta mudar) ou
// como o rótulo. As duas formas significam a mesma coisa.
function semLinhaDefinida(linha) {
  const t = String(linha || "").trim().toLowerCase();
  return t === "" || t === ROTULO_SEM_LINHA.toLowerCase();
}
// Palavras que não ajudam a reconhecer um produto renomeado — aparecem em
// meio cardápio e casariam qualquer coisa com qualquer coisa.
const PALAVRAS_VAZIAS = new Set(["com", "sem", "de", "da", "do", "e", "ml", "gr", "kg", "un", "und"]);
function palavrasDoNome(nome) {
  return String(nome || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !PALAVRAS_VAZIAS.has(t));
}
// Quanto dois nomes se parecem, de 0 a 1. Serve pra desconfiar de
// renomeação: "Fritas pequena" some e "Batata frita pequena" aparece no
// mesmo período — provavelmente é o mesmo produto com nome novo, e não
// uma queda de 100% seguida de um lançamento.
// Ordens da lista completa. Produto sem base de comparação (não vendeu no
// período anterior) não tem percentual — nas duas ordens por variação ele
// vai pro fim, em vez de fingir 0% e se misturar com quem ficou parado.
const ORDENS_LISTA = [
  { chave: "maior_venda",       rotulo: "Maior venda" },
  { chave: "menor_venda",       rotulo: "Menor venda" },
  { chave: "maior_crescimento", rotulo: "Maior crescimento" },
  { chave: "maior_queda",       rotulo: "Maior queda" },
];
function ordenarLista(lista, ordem) {
  const copia = [...lista];
  const pctDe = (p) => variacao(p.valor_atual, p.valor_ant);
  if (ordem === "menor_venda") return copia.sort((a, b) => a.valor_atual - b.valor_atual);
  if (ordem === "maior_crescimento" || ordem === "maior_queda") {
    const semBase = copia.filter((p) => pctDe(p) == null).sort((a, b) => b.valor_atual - a.valor_atual);
    const comBase = copia.filter((p) => pctDe(p) != null);
    comBase.sort((a, b) => ordem === "maior_queda" ? pctDe(a) - pctDe(b) : pctDe(b) - pctDe(a));
    return [...comBase, ...semBase];
  }
  return copia.sort((a, b) => b.valor_atual - a.valor_atual);
}
function parecenca(a, b) {
  const pa = palavrasDoNome(a);
  const pb = palavrasDoNome(b);
  if (pa.length === 0 || pb.length === 0) return 0;
  const setB = new Set(pb);
  const comuns = pa.filter((t) => setB.has(t)).length;
  return comuns / Math.min(pa.length, pb.length);
}
const QUANTOS_NO_RANKING = 5;

// Janela de comparação. "mes" casa com o bloco semana a semana que já
// existe na tela: do dia 1 até hoje, contra os mesmos dias do mês
// passado. As outras duas terminam ONTEM, porque o dia de hoje ainda
// não fechou no CardápioWeb.
function janelas(modo) {
  const hoje = new Date();
  if (modo === "mes") {
    const iniAnt = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
    const ultimoDiaAnt = diasNoMes(iniAnt.getFullYear(), iniAnt.getMonth());
    return {
      ini: new Date(hoje.getFullYear(), hoje.getMonth(), 1),
      fim: hoje,
      iniAnt,
      fimAnt: new Date(iniAnt.getFullYear(), iniAnt.getMonth(), Math.min(hoje.getDate(), ultimoDiaAnt)),
      titulo: "Mês atual até hoje",
      comparado: "mesmos dias do mês passado",
    };
  }
  const n = modo === "7" ? 7 : 30;
  return {
    ini: somarDias(hoje, -n),
    fim: somarDias(hoje, -1),
    iniAnt: somarDias(hoje, -2 * n),
    fimAnt: somarDias(hoje, -n - 1),
    titulo: `Últimos ${n} dias`,
    comparado: `os ${n} dias anteriores`,
  };
}

function variacao(atual, anterior) {
  if (!anterior || anterior <= 0) return null;
  return ((atual - anterior) / anterior) * 100;
}

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
  const [periodo, setPeriodo] = useState("mes");   // mes | 30 | 7
  const [produtos, setProdutos] = useState(null);  // linhas de desempenho_produtos
  // Cadastro de pratos, só pra conseguir gravar a linha daqui. O
  // desempenho_produtos devolve o NOME do prato, não o id — então o
  // casamento é por nome, que é de onde o nome veio.
  const [pratosCadastro, setPratosCadastro] = useState([]);
  const [abrirSemLinha, setAbrirSemLinha] = useState(false);
  const [salvandoLinha, setSalvandoLinha] = useState(null);
  const [erroLinha, setErroLinha] = useState("");
  const [linhas, setLinhas] = useState(null);      // linhas de desempenho_linhas
  const [cobertura, setCobertura] = useState(null);
  const [erroProdutos, setErroProdutos] = useState("");
  const [verTodos, setVerTodos] = useState(false);
  const [ordemLista, setOrdemLista] = useState("maior_venda");
  const [centroLabel, setCentroLabel] = useState(CENTRO_CUSTO_PADRAO);
  const [cmv, setCmv] = useState(null); // { cmv, receita_com_ficha, receita_sem_ficha }

  // Os nomes dos centros de custo agora são editáveis (DRE → Listas).
  // Se um centro novo aparecer aqui sem rótulo, cai no próprio código —
  // feio, mas nunca some da tela.
  React.useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("listas_opcoes").select("valor, rotulo")
        .eq("lista", "centro_custo").eq("ativo", true);
      if (data && data.length > 0) {
        setCentroLabel({ ...CENTRO_CUSTO_PADRAO, ...Object.fromEntries(data.map((c) => [c.valor, c.rotulo])) });
      }
    })();
  }, []);

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

  // Custo dos ingredientes do mês até hoje, pela ficha técnica de cada
  // prato vendido. É a mesma função que o DRE usa — não inventei conta
  // nova, pra os dois números nunca discordarem.
  const buscarCmv = React.useCallback(async () => {
    const hoje = new Date();
    const ini = `${ymd(hoje).slice(0, 7)}-01`;
    const { data, error } = await supabase.rpc("dre_cmv_periodo", { p_inicio: ini, p_fim: ymd(hoje) });
    if (error || !data?.[0]) { setCmv(null); return; }
    setCmv(data[0]);
  }, []);

  // ------------------------------------------------------------------
  // Desempenho por linha e por produto
  //
  // Vem do detalhe dos pedidos (`pedidos_cache`), não do total diário —
  // é a única fonte que sabe QUAL item foi vendido. Três funções do
  // banco, chamadas de uma vez só pra não pesar no celular.
  // ------------------------------------------------------------------
  const buscarProdutos = React.useCallback(async (modo) => {
    const j = janelas(modo);
    const args = { p_inicio: ymd(j.ini), p_fim: ymd(j.fim), p_inicio_ant: ymd(j.iniAnt), p_fim_ant: ymd(j.fimAnt) };
    const [rProd, rLinhas, rCob] = await Promise.all([
      supabase.rpc("desempenho_produtos", args),
      supabase.rpc("desempenho_linhas", args),
      supabase.rpc("cobertura_produtos", { p_inicio: args.p_inicio, p_fim: args.p_fim }),
    ]);
    const falha = rProd.error || rLinhas.error || rCob.error;
    if (falha) {
      setErroProdutos(
        /does not exist|não existe|schema cache/i.test(falha.message || "")
          ? "O desempenho por produto ainda não foi instalado no banco — falta rodar a migração 079."
          : falha.message
      );
      setProdutos(null); setLinhas(null); setCobertura(null);
      return;
    }
    setErroProdutos("");
    {
      const { data: pr } = await supabase.from("pratos").select("id, nome, linha_produto");
      setPratosCadastro(pr || []);
    }
    setProdutos((rProd.data || []).map((l) => ({
      ...l,
      qtd_atual: Number(l.qtd_atual) || 0,
      valor_atual: Number(l.valor_atual) || 0,
      qtd_ant: Number(l.qtd_ant) || 0,
      valor_ant: Number(l.valor_ant) || 0,
      preco_medio: Number(l.preco_medio) || 0,
    })));
    setLinhas((rLinhas.data || []).map((l) => ({
      ...l,
      valor_atual: Number(l.valor_atual) || 0,
      valor_ant: Number(l.valor_ant) || 0,
      qtd_atual: Number(l.qtd_atual) || 0,
    })));
    setCobertura((rCob.data && rCob.data[0]) || null);
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
    const diasCache = data || [];
    const presentes = new Set(diasCache.map((l) => l.dia));
    const faltando = dias.filter((d) => !presentes.has(d));
    let atualizadoEm = null;
    diasCache.forEach((l) => {
      if (l.atualizado_em && (!atualizadoEm || l.atualizado_em > atualizadoEm)) atualizadoEm = l.atualizado_em;
    });
    setCache({
      total: diasCache.length,
      ultimoDia: diasCache.length ? diasCache[diasCache.length - 1].dia : null,
      atualizadoEm,
      faltando,
    });
    return diasCache;
  }, [listaDaJanela]);

  // ------------------------------------------------------------------
  // Toda a matemática de previsão — idêntica à versão anterior, só que
  // alimentada pelo cache em vez da resposta do CardápioWeb
  // ------------------------------------------------------------------
  const calcularFaturamento = React.useCallback((diasCache) => {
    if (!diasCache || diasCache.length === 0) { setFaturamento(null); return; }
    const hoje = new Date();
    const porDia = {};
    diasCache.forEach((l) => { porDia[l.dia] = Number(l.faturamento_bruto) || 0; });

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
    const dias = await buscarCache();
    calcularFaturamento(dias);
    await Promise.all([buscarCustos(), buscarProdutos(periodo), buscarCmv()]);
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
    const diasCache = await buscarCache();
    const presentes = new Set((diasCache || []).map((l) => l.dia));

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
      const [dias] = await Promise.all([buscarCache(), buscarCustos(), buscarCmv()]);
      calcularFaturamento(dias);
      setCarregando(false);
    })();
  }, [buscarCache, buscarCustos, buscarCmv, calcularFaturamento]);

  // troca de período recarrega só a parte de produtos
  React.useEffect(() => { buscarProdutos(periodo); }, [buscarProdutos, periodo]);

  const lucroPrevisto = faturamento && custos ? round2(faturamento.totalMes - custos.totalPrevisto) : null;

  // Margem de contribuição projetada = faturamento previsto menos o que
  // esse faturamento vai consumir de ingrediente.
  //
  // A taxa vem do mix REAL do mês — o que você de fato vendeu —, não da
  // média das margens do cardápio. Um mês puxado por hambúrguer tem uma
  // taxa diferente de um puxado por bebida, e assim o número acompanha.
  //
  // Divide por `receita_com_ficha`, não pela receita toda: prato sem
  // ficha entra com custo zero e derrubaria a taxa artificialmente.
  const projecao = React.useMemo(() => {
    if (!faturamento || !cmv) return null;
    const comFicha = Number(cmv.receita_com_ficha) || 0;
    const semFicha = Number(cmv.receita_sem_ficha) || 0;
    const receita = comFicha + semFicha;
    if (comFicha <= 0) return null;
    const taxa = (Number(cmv.cmv) || 0) / comFicha;
    const cmvPrevisto = round2(faturamento.totalMes * taxa);
    return {
      taxa: taxa * 100,
      cmvPrevisto,
      margem: round2(faturamento.totalMes - cmvPrevisto),
      margemPct: faturamento.totalMes > 0 ? ((faturamento.totalMes - cmvPrevisto) / faturamento.totalMes) * 100 : 0,
      cobertura: receita > 0 ? (comFicha / receita) * 100 : 0,
      semFicha,
    };
  }, [faturamento, cmv]);

  // Rankings de produto. Tudo derivado da mesma lista que veio do banco,
  // então os números do topo e das variações nunca discordam entre si.
  const ranking = React.useMemo(() => {
    if (!produtos || produtos.length === 0) return null;
    const total = produtos.reduce((s, p) => s + p.valor_atual, 0);
    const vendidos = produtos.filter((p) => p.valor_atual > 0);
    const maiores = [...vendidos].sort((a, b) => b.valor_atual - a.valor_atual).slice(0, QUANTOS_NO_RANKING);
    // só entra na variação o produto acima do piso de preço E que tenha
    // vendido no período anterior — sem base anterior não existe % de
    // variação, só entrada nova (que tem quadro próprio logo abaixo)
    const comparaveis = produtos
      .filter((p) => p.preco_medio > PISO_PRECO && p.valor_ant > 0)
      .map((p) => ({ ...p, pct: variacao(p.valor_atual, p.valor_ant), delta: round2(p.valor_atual - p.valor_ant) }));
    const crescimentos = comparaveis.filter((p) => p.pct > 0).sort((a, b) => b.pct - a.pct).slice(0, QUANTOS_NO_RANKING);
    // Vender ZERO não é queda — é sumiço, e sumiço quase sempre é item
    // tirado do cardápio ou renomeado, não produto perdendo espaço. Se
    // entrasse aqui, ocupava as cinco vagas com −100% e escondia a queda
    // de verdade: o produto que continua vendendo, só que menos.
    const quedas = comparaveis
      .filter((p) => p.pct < 0 && p.valor_atual > 0)
      .sort((a, b) => a.pct - b.pct).slice(0, QUANTOS_NO_RANKING);
    const novos = produtos
      .filter((p) => p.valor_ant === 0 && p.valor_atual > 0 && p.preco_medio > PISO_PRECO)
      .sort((a, b) => b.valor_atual - a.valor_atual);
    // Quem vendia e parou. Fica em quadro próprio, e cada um tenta achar
    // entre os que ENTRARAM no período alguém com nome parecido — que é
    // o sinal de renomeação.
    const sumiram = comparaveis
      .filter((p) => p.valor_atual === 0)
      .map((p) => {
        let melhor = null;
        for (const n of novos) {
          const forca = parecenca(p.produto, n.produto);
          if (forca >= 0.5 && (!melhor || forca > melhor.forca)) melhor = { produto: n.produto, forca };
        }
        return { ...p, provavelRenome: melhor };
      })
      .sort((a, b) => b.valor_ant - a.valor_ant);
    return { total, maiores, crescimentos, quedas, novos, vendidos, sumiram };
  }, [produtos]);

  // Quem está segurando o quadro "Por linha de produto".
  //
  // Dois casos que o aviso antigo embolava num só: produto FORA DO
  // CADASTRO (vendeu e não achei prato com aquele código — escolher linha
  // não resolve, não existe prato pra receber) e prato SEM LINHA (existe,
  // está casado, só falta o campo). Só o segundo tem seletor.
  const semLinhaDetalhe = React.useMemo(() => {
    if (!produtos) return [];
    const porNome = new Map();
    const repetidos = new Set();
    pratosCadastro.forEach((p) => {
      if (porNome.has(p.nome)) repetidos.add(p.nome);
      porNome.set(p.nome, p);
    });
    return produtos
      // O banco NUNCA devolve linha vazia: desempenho_produtos faz
      // coalesce(linha, 'Sem linha definida'). Eu filtrava por vazio, a
      // lista dava sempre zero, e o botão nunca aparecia — o dado estava
      // certo e a pergunta é que estava errada. Compara pelo rótulo, que
      // é o que existe de verdade.
      .filter((p) => p.valor_atual > 0 && semLinhaDefinida(p.linha))
      .map((p) => {
        const prato = p.no_cadastro && !repetidos.has(p.produto) ? porNome.get(p.produto) : null;
        return { ...p, pratoId: prato?.id || null };
      })
      .sort((a, b) => b.valor_atual - a.valor_atual);
  }, [produtos, pratosCadastro]);

  // Pra que o aviso la de cima consiga levar a pessoa ate a fatia certa
  // do quadro, em vez de so avisar e deixar ela procurando.
  const refSemLinha = React.useRef(null);
  const irParaSemLinha = () => {
    setAbrirSemLinha(true);
    setTimeout(() => {
      refSemLinha.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
  };

  const salvarLinhaDoProduto = async (item, linha) => {
    if (!item.pratoId || !linha) return;
    setSalvandoLinha(item.produto);
    setErroLinha("");
    const { error } = await supabase.from("pratos").update({ linha_produto: linha }).eq("id", item.pratoId);
    setSalvandoLinha(null);
    if (error) { setErroLinha(error.message); return; }
    // Recarrega o desempenho: a linha nova muda o quadro de cima, e ver o
    // número andar é o que diz que valeu a pena preencher.
    await buscarProdutos(periodo);
  };

  const janela = janelas(periodo);
  const semLinha = cobertura && Number(cobertura.pct_com_linha) < 70;
  const semPedidos = cobertura && Number(cobertura.dias_com_pedido) === 0;
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
              {projecao && (
                <div style={{ ...cardStyle, marginBottom: 16 }}>
                  <div style={labelStyle}>Margem de contribuição projetada</div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#8A8778", padding: "3px 0" }}>
                    <span>Faturamento previsto</span>
                    <span style={{ color: "#22231F" }}>{brl(faturamento.totalMes)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#8A8778", padding: "3px 0" }}>
                    <span>(–) Custo dos ingredientes</span>
                    <span style={{ color: "#A32D2D" }}>{brl(projecao.cmvPrevisto)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8px 0 2px", borderTop: "1px solid #F0EBDD", marginTop: 5 }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: "#22231F" }}>Sobra pra pagar o resto</span>
                    <span style={{ fontSize: 17, fontWeight: 800, color: "#0F6E56" }}>
                      {brl(projecao.margem)}
                      <span style={{ fontSize: 12, marginLeft: 6 }}>{projecao.margemPct.toFixed(1)}%</span>
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "#8A8778", marginTop: 6, lineHeight: 1.6 }}>
                    Os ingredientes comem <strong>{projecao.taxa.toFixed(1)}%</strong> da venda, pelo que suas fichas técnicas
                    dizem sobre o que você realmente vendeu esse mês — não pela média do cardápio.
                    Isso é <strong>margem de contribuição, não lucro</strong>: pessoal, aluguel, energia e imposto
                    ainda saem daí, e estão no DRE.
                  </div>
                  {projecao.cobertura < 90 && (
                    <div style={{ fontSize: 10.5, color: "#7A6A1E", background: "#FBF3D9", border: "1px solid #E8D48A", borderRadius: 8, padding: "8px 10px", marginTop: 8, lineHeight: 1.5 }}>
                      Só {projecao.cobertura.toFixed(0)}% da venda do mês veio de prato com ficha cadastrada.
                      Os {brl(projecao.semFicha)} restantes entram com custo zero, então a margem real é menor que essa.
                    </div>
                  )}
                </div>
              )}

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
              {/* ---------------------------------------------------------
                  Desempenho por linha e por produto
                  --------------------------------------------------------- */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                <div style={{ ...sectionLabel, marginBottom: 0 }}>Desempenho por produto</div>
                <select value={periodo} onChange={(e) => { setPeriodo(e.target.value); setVerTodos(false); }} style={selectPeriodo}>
                  <option value="mes">Mês atual</option>
                  <option value="30">Últimos 30 dias</option>
                  <option value="7">Últimos 7 dias</option>
                </select>
              </div>
              <div style={{ fontSize: 10, color: "#8A8778", marginBottom: 10 }}>
                {janela.titulo} contra {janela.comparado}.
              </div>

              {erroProdutos && (
                <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erroProdutos}</div></div>
              )}

              {!erroProdutos && semPedidos && (
                <div style={avisoStyle}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ fontSize: 13 }}>
                    O detalhe dos pedidos desse período ainda não foi baixado. O faturamento total acima vem do resumo diário, que não sabe qual item foi vendido — por isso essa parte fica vazia.
                  </div>
                </div>
              )}

              {!erroProdutos && !semPedidos && semLinha && (
                <div style={avisoStyle}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div style={{ fontSize: 13 }}>
                    Só {cobertura.pct_com_linha}% do faturamento tem linha de produto definida — o resto cai
                    em "Sem linha definida" e não aparece separado no quadro abaixo.
                    {semLinhaDetalhe.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <button onClick={irParaSemLinha}
                          style={{ background: "#22231F", color: "#F3EFE3", border: "none", borderRadius: 8,
                                   padding: "8px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                          Ver os {semLinhaDetalhe.length} produtos que faltam
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {!erroProdutos && ranking && (
                <>
                  {/* por linha de produto */}
                  {linhas && linhas.length > 0 && (
                    <div style={{ ...blocoStyle, marginBottom: 14 }}>
                      <div style={blocoTitulo}><Layers size={13} /> Por linha de produto</div>
                      {linhas.map((l, idx) => {
                        const share = ranking.total > 0 ? (l.valor_atual / ranking.total) * 100 : 0;
                        const pct = variacao(l.valor_atual, l.valor_ant);
                        const ehSemLinha = String(l.linha || "").trim().toLowerCase() === ROTULO_SEM_LINHA.toLowerCase();
                        return (
                          <div key={l.linha} ref={ehSemLinha ? refSemLinha : null}
                            style={{ padding: "10px 14px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none",
                                     background: ehSemLinha && abrirSemLinha ? "#FCFAF4" : "transparent" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, color: "#22231F" }}>
                              <span style={nomeStyle}>{l.linha}</span>
                              <span style={{ fontWeight: 700, flexShrink: 0 }}>{brl(l.valor_atual)}</span>
                            </div>
                            <div style={barraShare}><div style={{ ...barraShareFill, width: `${Math.min(100, share)}%` }} /></div>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10, color: "#8A8778" }}>
                              <span>{share.toFixed(1)}% do total · {l.produtos} {l.produtos === 1 ? "produto" : "produtos"}</span>
                              {pct != null
                                ? <span style={{ color: pct >= 0 ? "#0F6E56" : "#A32D2D", fontWeight: 700 }}>{pct >= 0 ? "+" : ""}{pct.toFixed(1)}%</span>
                                : <span>sem base anterior</span>}
                            </div>

                            {/* O botao mora AQUI, na propria fatia "Sem linha
                                definida", e nao num aviso la em cima que so
                                aparecia quando a cobertura estava abaixo de
                                70%. Era exatamente esse o buraco: assim que
                                voce preencheu o suficiente pra passar dos
                                70%, o aviso sumia — e com ele a unica porta
                                pra terminar o servico. Agora a porta esta na
                                linha que incomoda, e some so quando nao
                                sobra nenhum produto pra preencher. */}
                            {ehSemLinha && semLinhaDetalhe.length > 0 && (
                              <button onClick={() => setAbrirSemLinha((v) => !v)}
                                style={{ marginTop: 8, background: abrirSemLinha ? "#FFFFFF" : "#22231F",
                                         color: abrirSemLinha ? "#22231F" : "#F3EFE3",
                                         border: abrirSemLinha ? "1px solid #E8E2D2" : "none",
                                         borderRadius: 8, padding: "7px 12px", fontSize: 11.5,
                                         fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                                {abrirSemLinha
                                  ? "Esconder a lista"
                                  : `Definir a linha desses ${semLinhaDetalhe.length}`}
                              </button>
                            )}

                            {ehSemLinha && abrirSemLinha && semLinhaDetalhe.length > 0 && (
                              <div style={{ marginTop: 10 }}>
                          <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden",
                                        background: "#FFFFFF", marginBottom: 14 }}>
                            <div style={{ padding: "10px 12px", background: "#F6F1E7", borderBottom: "1px solid #E8E2D2" }}>
                              <div style={{ fontSize: 12.5, fontWeight: 800 }}>
                                {semLinhaDetalhe.length} produtos sem linha · {brl(semLinhaDetalhe.reduce((t, p) => t + p.valor_atual, 0))}
                              </div>
                              <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 2, lineHeight: 1.5 }}>
                                Escolha a linha aqui mesmo — grava na hora e esta fatia encolhe na sua
                                frente. Ordenados pelo que mais fatura: o primeiro é o que mais muda o resultado.
                              </div>
                            </div>
                            {erroLinha && (
                              <div style={{ padding: "9px 12px", fontSize: 12, color: "#A32D2D", borderBottom: "1px solid #F0EBDD" }}>{erroLinha}</div>
                            )}
                            {semLinhaDetalhe.slice(0, 40).map((p, idx) => (
                              <div key={p.produto} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                                                            padding: "9px 12px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none" }}>
                                <div style={{ flex: 1, minWidth: 150 }}>
                                  <div style={{ fontSize: 12.5, fontWeight: 600, ...nomeStyle }}>{p.produto}</div>
                                  <div style={{ fontSize: 10.5, color: p.pratoId ? "#8A8778" : "#A32D2D", marginTop: 1 }}>
                                    {p.qtd_atual.toLocaleString("pt-BR")} un
                                    {p.pratoId ? "" : " · fora do cadastro de pratos"}
                                  </div>
                                </div>
                                <span style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" }}>{brl(p.valor_atual)}</span>
                                {p.pratoId ? (
                                  <select defaultValue="" disabled={salvandoLinha === p.produto}
                                    onChange={(e) => salvarLinhaDoProduto(p, e.target.value)}
                                    style={{ padding: "6px 8px", fontSize: 11.5, border: "1px solid #E8E2D2",
                                             borderRadius: 7, background: "#FFFFFF", fontFamily: "inherit",
                                             color: "#22231F", minWidth: 150 }}>
                                    <option value="">{salvandoLinha === p.produto ? "salvando…" : "Escolher linha…"}</option>
                                    {LINHAS_PRODUTO.map((l) => <option key={l} value={l}>{l}</option>)}
                                  </select>
                                ) : (
                                  <span style={{ fontSize: 11, color: "#8A8778", minWidth: 150 }}>rode o Importar pratos</span>
                                )}
                              </div>
                            ))}
                            {semLinhaDetalhe.length > 40 && (
                              <div style={{ padding: "9px 12px", borderTop: "1px solid #F0EBDD", fontSize: 10.5, color: "#8A8778" }}>
                                Mostrando os 40 que mais faturam, de {semLinhaDetalhe.length}. Preencha esses e a lista se refaz com os próximos.
                              </div>
                            )}
                          </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* 5 maiores faturamentos */}
                  <div style={{ ...blocoStyle, marginBottom: 14 }}>
                    <div style={blocoTitulo}><Trophy size={13} /> 5 maiores faturamentos</div>
                    {ranking.maiores.map((p, idx) => (
                      <div key={p.produto} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none" }}>
                        <span style={posicaoStyle}>{idx + 1}</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 13, color: "#22231F", ...nomeStyle }}>{p.produto}</div>
                          <div style={{ fontSize: 10, color: "#8A8778" }}>
                            {p.qtd_atual.toLocaleString("pt-BR")} un · {ranking.total > 0 ? ((p.valor_atual / ranking.total) * 100).toFixed(1) : "0"}% do total
                          </div>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#22231F", flexShrink: 0 }}>{brl(p.valor_atual)}</span>
                      </div>
                    ))}
                  </div>

                  {/* crescimentos */}
                  <div style={{ ...blocoStyle, marginBottom: 14 }}>
                    <div style={{ ...blocoTitulo, color: "#0F6E56" }}><TrendingUp size={13} /> 5 maiores crescimentos</div>
                    {ranking.crescimentos.length === 0 && <div style={vazioStyle}>Nenhum produto com base de comparação cresceu nesse período.</div>}
                    {ranking.crescimentos.map((p, idx) => (
                      <div key={p.produto} style={{ padding: "10px 14px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, color: "#22231F" }}>
                          <span style={nomeStyle}>{p.produto}</span>
                          <span style={{ fontWeight: 800, color: "#0F6E56", flexShrink: 0 }}>+{p.pct.toFixed(0)}%</span>
                        </div>
                        <div style={{ fontSize: 10, color: "#8A8778" }}>{brl(p.valor_ant)} → {brl(p.valor_atual)} · {p.delta >= 0 ? "+" : ""}{brl(p.delta)} · {brl(p.preco_medio)} a un.</div>
                      </div>
                    ))}
                  </div>

                  {/* quedas */}
                  <div style={{ ...blocoStyle, marginBottom: 14 }}>
                    <div style={{ ...blocoTitulo, color: "#A32D2D" }}><TrendingDown size={13} /> 5 maiores quedas</div>
                    {ranking.quedas.length === 0 && <div style={vazioStyle}>Nenhum produto com base de comparação caiu nesse período.</div>}
                    {ranking.quedas.map((p, idx) => (
                      <div key={p.produto} style={{ padding: "10px 14px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, color: "#22231F" }}>
                          <span style={nomeStyle}>{p.produto}</span>
                          <span style={{ fontWeight: 800, color: "#A32D2D", flexShrink: 0 }}>{p.pct.toFixed(0)}%</span>
                        </div>
                        <div style={{ fontSize: 10, color: "#8A8778" }}>
                          {brl(p.valor_ant)} → {brl(p.valor_atual)} · {brl(p.delta)} · {brl(p.preco_medio)} a un.
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={{ fontSize: 10, color: "#8A8778", marginTop: -6, marginBottom: 14, padding: "0 2px" }}>
                    Crescimento e queda só consideram produtos acima de {brl(PISO_PRECO)}. Bala, bombom e refrigerante variam muito em percentual sem mover o caixa — entrariam no lugar do que interessa.
                    Produto que vendeu <b>zero</b> no período não entra na queda: −100% é sumiço, não queda, e ocuparia as cinco vagas escondendo o que caiu de verdade.
                  </div>

                  {/* pararam de vender — fora do ranking, em quadro próprio */}
                  {ranking.sumiram.length > 0 && (
                    <div style={{ ...blocoStyle, marginBottom: 14 }}>
                      <div style={blocoTitulo}>Pararam de vender</div>
                      {ranking.sumiram.slice(0, 8).map((p, idx) => (
                        <div key={p.produto} style={{ padding: "10px 14px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13, color: "#22231F" }}>
                            <span style={nomeStyle}>{p.produto}</span>
                            <span style={{ fontSize: 12, color: "#8A8778", flexShrink: 0 }}>vendia {brl(p.valor_ant)}</span>
                          </div>
                          {p.provavelRenome ? (
                            <div style={{ fontSize: 10, color: "#8A6A0F", marginTop: 2 }}>
                              provavelmente virou <b>{p.provavelRenome.produto}</b>, que entrou no período — confira no cardápio
                            </div>
                          ) : (
                            <div style={{ fontSize: 10, color: "#8A8778", marginTop: 2 }}>
                              sem nome parecido entre os que entraram — saiu do cardápio ou parou mesmo
                            </div>
                          )}
                        </div>
                      ))}
                      <div style={{ fontSize: 10, color: "#8A8778", padding: "9px 14px", borderTop: "1px solid #F0EBDD", lineHeight: 1.55 }}>
                        Vendeu no período anterior e zero neste. Quase sempre é item tirado do cardápio ou <b>renomeado</b> — quando é renome, o produto reaparece aqui do lado, em "Entraram no período", com o nome novo.
                      </div>
                    </div>
                  )}

                  {ranking.novos.length > 0 && (
                    <div style={{ ...blocoStyle, marginBottom: 14 }}>
                      <div style={blocoTitulo}>Entraram no período</div>
                      {ranking.novos.slice(0, QUANTOS_NO_RANKING).map((p, idx) => (
                        <div key={p.produto} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "9px 14px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", fontSize: 12 }}>
                          <span style={{ ...nomeStyle, color: "#22231F" }}>{p.produto}</span>
                          <span style={{ color: "#22231F", flexShrink: 0 }}>{brl(p.valor_atual)}</span>
                        </div>
                      ))}
                      <div style={{ fontSize: 10, color: "#8A8778", padding: "0 14px 10px" }}>Não venderam nada no período anterior, então não entram no ranking de crescimento.</div>
                    </div>
                  )}

                  <button onClick={() => setVerTodos((v) => !v)} style={{ ...btnGhost, width: "100%", marginBottom: verTodos ? 8 : 16 }}>
                    {verTodos ? "Esconder a lista completa" : `Ver todos os ${ranking.vendidos.length} produtos`}
                  </button>

                  {verTodos && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                      {ORDENS_LISTA.map((o) => (
                        <button key={o.chave} onClick={() => setOrdemLista(o.chave)}
                          style={{
                            border: "1px solid #E8E2D2", borderRadius: 999, padding: "6px 12px",
                            fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                            background: ordemLista === o.chave ? "#22231F" : "#FFFFFF",
                            color: ordemLista === o.chave ? "#F3EFE3" : "#8A8778",
                            borderColor: ordemLista === o.chave ? "#22231F" : "#E8E2D2",
                          }}>
                          {o.rotulo}
                        </button>
                      ))}
                    </div>
                  )}

                  {verTodos && (
                    <div style={{ ...blocoStyle, marginBottom: 16 }}>
                      {ordenarLista(ranking.vendidos, ordemLista).map((p, idx) => {
                        const pct = variacao(p.valor_atual, p.valor_ant);
                        return (
                          <div key={p.produto} style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 14px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none" }}>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 12, color: "#22231F", ...nomeStyle }}>{p.produto}</div>
                              <div style={{ fontSize: 10, color: p.no_cadastro ? "#8A8778" : "#A32D2D" }}>
                                {p.no_cadastro ? p.linha : "fora do cadastro de pratos"} · {p.qtd_atual.toLocaleString("pt-BR")} un
                              </div>
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div style={{ fontSize: 12, color: "#22231F" }}>{brl(p.valor_atual)}</div>
                              {pct != null && <div style={{ fontSize: 10, fontWeight: 700, color: pct >= 0 ? "#0F6E56" : "#A32D2D" }}>{pct >= 0 ? "+" : ""}{pct.toFixed(0)}%</div>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              <div style={sectionLabel}>Custos por centro de custo</div>
              <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF" }}>
                {Object.entries(custos.porCentroCusto).sort((a, b) => b[1] - a[1]).map(([centro, valor], idx) => (
                  <div key={centro} style={{ display: "flex", justifyContent: "space-between", padding: "8px 14px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", fontSize: 12 }}>
                    <span style={{ color: centro === "sem_centro" ? "#A32D2D" : "#22231F" }}>{centro === "sem_centro" ? "Sem centro de custo" : (centroLabel[centro] || centro)}</span>
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
const blocoStyle = { border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF" };
const blocoTitulo = { display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase", color: "#55534A", padding: "10px 14px", background: "#F6F1E7", borderBottom: "1px solid #E8E2D2" };
const nomeStyle = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
const posicaoStyle = { width: 20, height: 20, borderRadius: 999, background: "#F6F1E7", color: "#55534A", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const barraShare = { height: 5, borderRadius: 99, background: "#F0EBDD", overflow: "hidden", margin: "6px 0 5px" };
const barraShareFill = { height: "100%", background: "#22231F", borderRadius: 99 };
const vazioStyle = { padding: "12px 14px", fontSize: 12, color: "#8A8778" };
const selectPeriodo = { padding: "6px 8px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 12, background: "#FFFFFF", color: "#22231F", flexShrink: 0 };
