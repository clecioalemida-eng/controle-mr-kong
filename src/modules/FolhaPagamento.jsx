// ===== FolhaPagamento.jsx =====
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2, AlertTriangle, Check, Upload, FileText, Trash2,
  Plus, Eye, RotateCcw, X,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";

// =====================================================================
// Folha de pagamento
//
// O PDF do contador vira contas a pagar e linha no DRE sem ninguém
// redigitar. A leitura é a parte frágil — cada escritório imprime de um
// jeito — então a tela foi montada em cima dessa fragilidade, não
// fingindo que ela não existe:
//
//   1. NADA é lançado pela leitura. Ela preenche; a pessoa confirma.
//   2. O texto cru do PDF fica visível. Se um número saiu errado, dá
//      pra ver comparando com o papel, na hora, sem abrir o banco.
//   3. O que não foi entendido aparece dito em voz alta, separado, e
//      NÃO é lançado. Silêncio é o que esconde erro por quatro meses.
//   4. Bruto e líquido juntos = folha dobrada. Essa é a armadilha mais
//      cara da folha, e tem trava própria (veja CONFLITO_SALARIO).
// =====================================================================

// ---------------------------------------------------------------------
// pdf.js pelo CDN, carregado só quando alguém abre a aba.
//
// Vem de fora em vez de virar dependência do projeto porque instalar
// pacote exige mexer no package.json e rodar build — um caminho que
// ninguém aqui percorre hoje. O custo é depender da rede na primeira
// leitura; o ganho é a aba existir sem reconstruir o projeto.
// ---------------------------------------------------------------------
const PDFJS_URL = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
let promessaPdfJs = null;

function carregarPdfJs() {
  if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (promessaPdfJs) return promessaPdfJs;
  promessaPdfJs = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PDFJS_URL;
    s.onload = () => {
      if (!window.pdfjsLib) { reject(new Error("pdf.js carregou mas não apareceu.")); return; }
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
      resolve(window.pdfjsLib);
    };
    s.onerror = () => { promessaPdfJs = null; reject(new Error("Não consegui carregar o leitor de PDF. Verifique a internet.")); };
    document.head.appendChild(s);
  });
  return promessaPdfJs;
}

// Texto do PDF, linha por linha.
//
// pdf.js devolve pedacinhos soltos com coordenada. Juntar pelo Y é o que
// remonta a linha: "FGTS A RECOLHER" e "2.014,40" saem separados, e é
// justamente essa dupla que interessa.
async function lerPdf(arquivo) {
  const pdfjsLib = await carregarPdfJs();
  const buffer = await arquivo.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buffer }).promise;
  const paginas = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const conteudo = await pagina.getTextContent();
    const porLinha = new Map();
    conteudo.items.forEach((item) => {
      const y = Math.round((item.transform?.[5] || 0) / 3);   // tolera 3pt de diferença
      const x = item.transform?.[4] || 0;
      if (!porLinha.has(y)) porLinha.set(y, []);
      porLinha.get(y).push({ x, texto: item.str });
    });
    const linhas = [...porLinha.entries()]
      .sort((a, b) => b[0] - a[0])                            // de cima pra baixo
      .map(([, pedacos]) => pedacos.sort((a, b) => a.x - b.x).map((p) => p.texto).join(" ")
        .replace(/\s+/g, " ").trim())
      .filter(Boolean);
    paginas.push(linhas.join("\n"));
  }
  return { texto: paginas.join("\n"), paginas: doc.numPages };
}

// ---------------------------------------------------------------------
// Números e datas
// ---------------------------------------------------------------------
function paraNumero(txt) {
  if (!txt) return null;
  const limpo = String(txt).replace(/\./g, "").replace(",", ".");
  const n = parseFloat(limpo);
  return Number.isFinite(n) ? n : null;
}
// Todo dinheiro que aparece na linha. Pega "1.234,56" e "234,56";
// exige os centavos pra não confundir com matrícula, CPF ou quantidade.
function valoresDaLinha(linha) {
  const achados = String(linha).match(/\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/g) || [];
  return achados.map(paraNumero).filter((v) => v != null);
}
function brl(v) { return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function chaveRubrica(txt) {
  // Tem que ser IDÊNTICA à função chave_rubrica() do banco (migração 095).
  return String(txt || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}
function semAcento(txt) {
  return String(txt || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function diaDoMesSeguinte(competencia, dia) {
  // competencia: "YYYY-MM"
  const [a, m] = competencia.split("-").map(Number);
  // Dia 30 em fevereiro não existe: sem travar, o Date do JS empurra pro
  // dia 2 de março e a provisão vence no mês errado, calada. Prende no
  // último dia do mês.
  const ultimo = new Date(a, m + 1, 0).getDate();
  const d = new Date(a, m, Math.min(dia, ultimo));   // m (1-based) vira o mês seguinte em base 0
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
function competenciaTexto(comp) {
  if (!comp) return "";
  const [a, m] = comp.split("-").map(Number);
  return `${MESES[m - 1]} de ${a}`;
}

// ---------------------------------------------------------------------
// O dicionário das rubricas
//
// `familia` é o que impede folha dobrada: duas linhas da mesma família
// salário (bruto e líquido) são o mesmo dinheiro contado duas vezes.
// `despesa: false` marca o que NÃO é despesa da empresa — IRRF e INSS do
// empregado já estão descontados dentro do líquido; lançar de novo
// inflaria o custo de pessoal sem que ninguém percebesse.
// ---------------------------------------------------------------------
const RUBRICAS = [
  // `prefere` decide quem fica ligado quando a mesma familia aparece
  // duas vezes. O BRUTO ganha do liquido: o custo da empresa e o bruto
  // — o liquido e o que sobra depois de IRRF e INSS do funcionario, que
  // a empresa tambem pagou, so que direto pro governo. Lancar o liquido
  // com o bruto disponivel esconde despesa real.
  { familia: "salario", conta: "4.1", dia: 5, despesa: true, prefere: 1,
    termos: ["liquido a receber", "total liquido", "liquido a pagar", "salarios liquidos", "salario liquido", "valor liquido", "total dos liquidos"] },
  { familia: "salario", conta: "4.1", dia: 5, despesa: true, prefere: 2,
    termos: ["total de vencimentos", "total vencimentos", "total de proventos", "total proventos", "salario bruto", "total bruto", "folha bruta"] },
  { familia: "fgts", conta: "4.3", dia: 7, despesa: true,
    termos: ["fgts", "f.g.t.s", "fundo de garantia"] },
  { familia: "inss_empresa", conta: "4.3", dia: 20, despesa: true,
    termos: ["inss parte empresa", "inss patronal", "parte patronal", "contribuicao patronal", "inss empresa", "previdencia patronal", "gps", "inss a recolher"] },
  { familia: "transporte", conta: "4.5", dia: 5, despesa: true,
    termos: ["vale transporte", "vale-transporte", "vt "] },
  { familia: "alimentacao", conta: "4.5", dia: 5, despesa: true,
    termos: ["vale alimentacao", "vale refeicao", "cesta basica", "vale-alimentacao", "vale-refeicao"] },
  { familia: "provisao", conta: "4.6", dia: 30, despesa: true,
    termos: ["provisao", "13o salario", "decimo terceiro", "13 salario", "ferias", "1/12"] },
  { familia: "prolabore", conta: "4.4", dia: 5, despesa: true,
    termos: ["pro labore", "pro-labore", "prolabore"] },
  { familia: "rescisao", conta: "4.1", dia: 5, despesa: true,
    termos: ["rescisao", "aviso previo", "verbas rescisorias"] },
  // Não são despesa: já estão dentro do líquido, ou são dinheiro do
  // funcionário passando pela empresa.
  { familia: "desconto", conta: null, dia: 5, despesa: false,
    termos: ["irrf", "imposto de renda retido", "inss retido", "inss do empregado", "desconto", "adiantamento", "vale quinzena", "adiant", "faltas", "pensao alimenticia"] },
];
const CONFLITO_SALARIO =
  "Duas linhas de salário na mesma folha — bruto e líquido são o mesmo dinheiro. " +
  "Lançar as duas dobra a folha no DRE. Deixei ligado o bruto: é o custo real da empresa; " +
  "o líquido é o que sobra depois do IRRF e do INSS do funcionário, que também saem do seu caixa.";

// ---------------------------------------------------------------------
// Holerite individual — o formato que o contador do Mr Kong usa
//
// Um PDF por pessoa, rubricas numeradas:
//
//   001 SALARIO BASE 23,00 ......... 1.613,33
//   009 ADIC PRODUTIVIDADE .............. 81,61
//   012 ADICIONAL NOTURNO .............. 173,52
//   18  ADIANTAMENTO .................. 173,40   ← desconto
//   2.066,16                                     ← total de vencimentos
//   1.892,76                                     ← líquido
//
// Aqui está a armadilha desse formato: as nove linhas somam o mesmo
// dinheiro TRÊS vezes. Provento por provento dá 2.066,16, que é o total
// impresso; o total menos o adiantamento dá 1.892,76, que é o líquido.
// Lançar linha por linha somaria mais de R$ 4.000 num holerite de
// R$ 2.066. Por isso o holerite vira UMA linha só: o total dos
// proventos, que é o que a empresa gastou com aquela pessoa.
//
// E dá pra conferir sem confiar: se a soma que eu fiz aparece impressa
// no PDF, li certo. É a diferença entre "acho que entendi" e "confere".
// ---------------------------------------------------------------------
const DESCONTOS_HOLERITE = [
  "adiantamento", "adiant", "inss", "irrf", "imposto de renda", "falta", "atraso",
  "pensao", "desconto", "desc ", "contrib sindical", "sindical", "plano de saude",
  "farmacia", "emprestimo", "consignado", "seguro", "coparticipacao", "arredondamento",
];
function ehDesconto(rotulo) {
  const t = " " + semAcento(rotulo) + " ";
  return DESCONTOS_HOLERITE.some((d) => t.includes(d));
}
// Linha de rubrica: começa com o código (2 ou 3 dígitos) e termina em dinheiro.
const RE_RUBRICA = /^(\d{2,3})\s+(.*)$/;

function pareceHolerite(linhas) {
  const comCodigo = linhas.filter((l) => RE_RUBRICA.test(l) && valoresDaLinha(l).length > 0).length;
  const t = semAcento(linhas.join(" "));
  const palavra = /(holerite|recibo de pagamento|demonstrativo de pagamento|periodo sem registro|recibo de salario)/.test(t);
  return comCodigo >= 3 || (comCodigo >= 1 && palavra);
}

// A competência costuma estar no NOME do arquivo, não no papel:
// "LIDIANE ANDRADE ROSSI MES 07 2026 PERIODO SEM REGISTRO.pdf".
function competenciaDoNome(nome) {
  const t = semAcento(nome || "").replace(/[_.-]+/g, " ");
  let m = t.match(/m[eê]s\s*(\d{1,2})\s*(?:de\s*)?(\d{4})/);
  if (m) return `${m[2]}-${String(Number(m[1])).padStart(2, "0")}`;
  m = t.match(/\b(\d{2})\s*[\/-]\s*(\d{4})\b/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1]}`;
  const mes = MESES.findIndex((x) => t.includes(semAcento(x)));
  if (mes >= 0) {
    const ano = t.match(/\b(20\d{2})\b/);
    if (ano) return `${ano[1]}-${String(mes + 1).padStart(2, "0")}`;
  }
  return "";
}

// Nome da pessoa: o pedaço do arquivo antes de "MES", ou a primeira
// linha do PDF que seja só nome em maiúsculas.
function pessoaDoNome(nomeArquivo, linhas) {
  let base = String(nomeArquivo || "").replace(/\.pdf$/i, "").replace(/[_-]+/g, " ");
  const corte = semAcento(base).search(/\bmes\b|\bcompetencia\b|\d{2}\s*[\/-]\s*\d{4}/);
  if (corte > 3) base = base.slice(0, corte);
  base = base.replace(/\s+/g, " ").trim();
  if (base.length >= 5 && /[a-zA-Z]/.test(base) && !/^\d+$/.test(base)) return titulo(base);
  const cand = (linhas || []).find((l) =>
    /^[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ ]{8,50}$/.test(l.trim()) && l.trim().split(/\s+/).length >= 2);
  return cand ? titulo(cand.trim()) : "";
}
function titulo(txt) {
  const miudas = new Set(["da", "de", "do", "das", "dos", "e"]);
  return String(txt).toLowerCase().split(/\s+/)
    .map((p) => (miudas.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join(" ");
}

// competência dentro do papel: "08/2026", "COMPETENCIA AGOSTO/2026", "REF. 08/2026"
function competenciaDoTexto(linhas) {
  for (const l of linhas) {
    const t = semAcento(l);
    let m = t.match(/(?:competencia|referencia|ref\.?|mes)\D{0,12}(\d{1,2})\s*[\/\-.]\s*(\d{4})/);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) {
      return `${m[2]}-${String(Number(m[1])).padStart(2, "0")}`;
    }
    const nome = MESES.findIndex((mes) => t.includes(semAcento(mes)));
    if (nome >= 0) {
      m = t.match(/\b(20\d{2})\b/);
      if (m) return `${m[1]}-${String(nome + 1).padStart(2, "0")}`;
    }
  }
  for (const l of linhas) {
    const m = semAcento(l).match(/\b(\d{2})\s*\/\s*(\d{4})\b/);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return `${m[2]}-${m[1]}`;
  }
  return "";
}

function analisarHolerite(texto, nomeArquivo) {
  const linhas = String(texto || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const proventos = [];
  const descontos = [];
  const soltos = [];

  linhas.forEach((linha) => {
    const valores = valoresDaLinha(linha);
    if (valores.length === 0) return;
    const valor = valores[valores.length - 1];
    if (!valor || valor <= 0) return;
    const m = linha.match(RE_RUBRICA);
    if (!m) { soltos.push(valor); return; }
    const rotulo = linha.replace(/[\d.,]+\s*$/, "").replace(/[.\s]{3,}/g, " ").trim() || linha;
    (ehDesconto(rotulo) ? descontos : proventos).push({ rotulo, valor });
  });

  const somaProventos = round2(proventos.reduce((t, r) => t + r.valor, 0));
  const somaDescontos = round2(descontos.reduce((t, r) => t + r.valor, 0));
  const liquido = round2(somaProventos - somaDescontos);

  // A conferência: os totais impressos batem com a minha soma?
  const todos = linhas.flatMap(valoresDaLinha).map(round2);
  const bateBruto = somaProventos > 0 && todos.some((v) => Math.abs(v - somaProventos) < 0.02);
  const bateLiquido = liquido > 0 && todos.some((v) => Math.abs(v - liquido) < 0.02);

  return {
    modo: "holerite",
    pessoa: pessoaDoNome(nomeArquivo, linhas),
    competencia: competenciaDoNome(nomeArquivo) || competenciaDoTexto(linhas),
    proventos, descontos,
    somaProventos, somaDescontos, liquido,
    bateBruto, bateLiquido,
  };
}
function round2(v) { return Math.round((Number(v) || 0) * 100) / 100; }

// A regra "toda folha vai pra Salários" mora numa chave só, ao lado das
// regras de rubrica. Guardada no banco, ela sobrevive à sessão: você diz
// uma vez, e nos meses seguintes a tela já vem preenchida.
const CHAVE_FOLHA = "folhadepagamento";

function reconhecer(linha) {
  const t = " " + semAcento(linha) + " ";
  for (const r of RUBRICAS) {
    if (r.termos.some((termo) => t.includes(termo))) return r;
  }
  return null;
}

// ---------------------------------------------------------------------
// A leitura em si
//
// Devolve o que entendeu E o que não entendeu. As duas listas importam:
// a segunda é a que evita que uma rubrica suma sem ninguém notar.
// ---------------------------------------------------------------------
function analisarFolha(texto, regras) {
  const linhas = String(texto || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const competencia = competenciaDoTexto(linhas);

  let pessoas = null;
  for (const l of linhas) {
    const t = semAcento(l);
    if (/(funcionarios|empregados|colaboradores|total de pessoas|qtde?\.? de emp)/.test(t)) {
      const m = t.match(/\b(\d{1,4})\b/);
      if (m) { pessoas = Number(m[1]); break; }
    }
  }

  const itens = [];
  const naoEncaixadas = [];
  const familiasVistas = new Set();

  linhas.forEach((linha, idx) => {
    const valores = valoresDaLinha(linha);
    if (valores.length === 0) return;
    // O valor da rubrica é o último da linha: relatório de folha põe o
    // total na direita, depois de código, base de cálculo e alíquota.
    const valor = valores[valores.length - 1];
    if (!valor || valor <= 0) return;

    const rotulo = linha.replace(/[\d.,]+\s*$/, "").replace(/[.\s]{3,}/g, " ").trim() || linha;
    const r = reconhecer(linha);

    if (!r) { naoEncaixadas.push({ linha, valor, rotulo, motivo: "não reconheci essa rubrica" }); return; }
    if (!r.despesa) {
      naoEncaixadas.push({ linha, valor, rotulo,
        motivo: "é desconto do funcionário, não despesa da empresa — já está dentro do líquido" });
      return;
    }

    familiasVistas.add(r.familia);

    const chave = chaveRubrica(rotulo);
    const aprendida = regras[chave];

    itens.push({
      id: `${idx}-${rotulo}`,
      rubrica: rotulo,
      detalhe: "",
      valor,
      plano_conta: aprendida ? aprendida.plano_conta : r.conta,
      vencimento: competencia ? diaDoMesSeguinte(competencia, r.dia) : "",
      pago: false,
      lancar: true,
      familia: r.familia,
      prefere: r.prefere || 0,
      aprendidaDe: aprendida ? aprendida.vezes_usada || 1 : 0,
      conflito: "",
    });
  });

  // Familia repetida = mesmo dinheiro lido duas vezes. Desliga as
  // sobras e diz por que, em vez de somar tudo e entregar uma folha
  // dobrada com cara de certa. Fica ligada a de maior preferencia (o
  // bruto, no caso do salario); empate, a primeira que apareceu.
  const porFamilia = new Map();
  itens.forEach((i) => {
    if (!porFamilia.has(i.familia)) porFamilia.set(i.familia, []);
    porFamilia.get(i.familia).push(i);
  });
  porFamilia.forEach((grupo, familia) => {
    if (grupo.length < 2) return;
    let escolhida = grupo[0];
    grupo.forEach((i) => { if ((i.prefere || 0) > (escolhida.prefere || 0)) escolhida = i; });
    grupo.forEach((i) => {
      if (i === escolhida) return;
      i.lancar = false;
      i.conflito = familia === "salario" ? CONFLITO_SALARIO
        : `Outra linha de "${escolhida.rubrica}" já entrou com o mesmo tipo de valor. ` +
          "Confira se não é o mesmo dinheiro contado duas vezes.";
    });
  });

  const avisos = [];
  if (!competencia) avisos.push("Não achei a competência (mês) no PDF — escolha embaixo antes de lançar.");
  if (itens.length === 0) avisos.push("Não achei nenhuma rubrica conhecida. Confira o texto lido ou adicione as linhas à mão.");

  return { competencia, pessoas, itens, naoEncaixadas, avisos };
}

// =====================================================================
// A tela
// =====================================================================
export default function FolhaPagamento() {
  const [fase, setFase] = useState("vazio");      // vazio | lendo | conferindo | lancando
  const [erro, setErro] = useState("");
  const [ok, setOk] = useState("");
  const [arquivos, setArquivos] = useState([]);   // [{ nome, texto, paginas, file }]
  const [texto, setTexto] = useState("");
  const [competencia, setCompetencia] = useState("");
  const [pessoas, setPessoas] = useState("");
  const [itens, setItens] = useState([]);
  const [naoEncaixadas, setNaoEncaixadas] = useState([]);
  const [avisos, setAvisos] = useState([]);
  const [verTexto, setVerTexto] = useState(false);
  const [aberto, setAberto] = useState({});      // detalhe das rubricas por holerite
  const [arrastando, setArrastando] = useState(false);

  const [plano, setPlano] = useState([]);
  const [regras, setRegras] = useState({});
  const [historico, setHistorico] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [desfazendo, setDesfazendo] = useState(null);
  const [linhasFolha, setLinhasFolha] = useState({});   // folha_id -> itens
  const inputArquivo = useRef(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [{ data: pl }, { data: rs }, { data: hs }] = await Promise.all([
      supabase.from("plano_contas").select("codigo, nome, entra_dre")
        .eq("ativo", true).like("codigo", "%.%").order("ordem"),
      supabase.from("folha_rubrica_regras").select("rubrica_chave, rubrica_exemplo, plano_conta, vezes_usada"),
      supabase.from("folhas_pagamento")
        .select("id, competencia, arquivo_path, arquivo_nome, pessoas, valor_total, criado_em, desfeita_em")
        .is("desfeita_em", null).order("competencia", { ascending: false }).limit(24),
    ]);
    setPlano(pl || []);
    setRegras(Object.fromEntries((rs || []).map((r) => [r.rubrica_chave, r])));
    setHistorico(hs || []);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const limpar = () => {
    setFase("vazio"); setArquivos([]); setTexto("");
    setCompetencia(""); setPessoas(""); setItens([]); setNaoEncaixadas([]);
    setAvisos([]); setVerTexto(false); setErro("");
  };

  // A conta pra onde a folha vai. Você já disse: é sempre Salários. Fica
  // guardada como regra, aplicada sozinha, e visível num lugar só — não
  // repetida em catorze seletores pedindo o mesmo sim catorze vezes.
  const contaPadrao = regras[CHAVE_FOLHA]?.plano_conta || "4.1";
  const vezesPadrao = regras[CHAVE_FOLHA]?.vezes_usada || 0;
  const trocarContaPadrao = (codigo) => {
    if (!codigo) return;
    setRegras((r) => ({ ...r, [CHAVE_FOLHA]: { ...(r[CHAVE_FOLHA] || {}), plano_conta: codigo } }));
    setItens((atual) => atual.map((i) => (i.familia === "holerite" ? { ...i, plano_conta: codigo } : i)));
  };

  // Vários PDFs de uma vez: o contador manda um holerite por pessoa, e
  // subir catorze arquivos em catorze idas e vindas seria o mesmo
  // trabalho manual que essa tela existe pra tirar.
  const receberArquivos = async (lista) => {
    const files = [...(lista || [])].filter((f) => /\.pdf$/i.test(f.name));
    if (files.length === 0) { setErro("Por enquanto só PDF. Se o contador manda em outro formato, me diga qual."); return; }
    setErro(""); setOk(""); setFase("lendo");

    const lidos = [];
    const novosItens = [];
    const novasNao = [];
    const novosAvisos = [];
    let comp = competencia;
    let quantasPessoas = 0;

    for (const file of files) {
      let txt = "", np = 0;
      try {
        const r = await lerPdf(file);
        txt = r.texto; np = r.paginas;
      } catch (e) {
        novosAvisos.push(`Não consegui ler "${file.name}": ${e.message || e}`);
        continue;
      }
      if (txt.replace(/\s/g, "").length < 40) {
        novosAvisos.push(`"${file.name}" parece ser imagem (papel escaneado ou foto), não texto — ` +
          "não dá pra ler os números. Peça ao contador o PDF em que dá pra selecionar o texto com o mouse.");
        continue;
      }
      lidos.push({ nome: file.name, texto: txt, paginas: np, file });

      const linhas = txt.split("\n").map((l) => l.trim()).filter(Boolean);

      if (pareceHolerite(linhas)) {
        const h = analisarHolerite(txt, file.name);
        if (!comp && h.competencia) comp = h.competencia;
        if (h.somaProventos <= 0) {
          novosAvisos.push(`"${file.name}": não achei nenhum provento com valor.`);
          continue;
        }
        quantasPessoas += 1;
        novosItens.push({
          id: `hol-${file.name}-${novosItens.length}`,
          rubrica: h.pessoa || file.name.replace(/\.pdf$/i, ""),
          detalhe: `${h.proventos.length} provento(s) · líquido ${brl(h.liquido)}`,
          valor: h.somaProventos,
          plano_conta: regras[CHAVE_FOLHA]?.plano_conta || "4.1",
          vencimento: "", pago: false, lancar: true,
          familia: "holerite",
          aprender: false,           // nome de pessoa não vira regra
          aprendidaDe: 0, conflito: "",
          conferido: h.bateBruto,
          liquido: h.liquido,
          proventos: h.proventos,
          descontos: h.descontos,
          arquivoNome: file.name,
          file,
        });
      } else {
        const lido = analisarFolha(txt, regras);
        if (!comp && lido.competencia) comp = lido.competencia;
        if (lido.pessoas) quantasPessoas += lido.pessoas;
        lido.itens.forEach((i) => novosItens.push({ ...i, id: `${file.name}-${i.id}`, aprender: true, arquivoNome: file.name, file }));
        lido.naoEncaixadas.forEach((n) => novasNao.push({ ...n, arquivo: file.name }));
        lido.avisos.filter((a) => !/compet[eê]ncia/i.test(a))
          .forEach((a) => novosAvisos.push(files.length > 1 ? `"${file.name}": ${a}` : a));
      }
    }

    if (lidos.length === 0) {
      setErro(novosAvisos.join(" ") || "Nenhum PDF pôde ser lido.");
      setFase("vazio");
      return;
    }

    // Vencimento: dia 5 do mês seguinte à competência, pra todo mundo.
    const venc = comp ? diaDoMesSeguinte(comp, 5) : "";
    novosItens.forEach((i) => { if (!i.vencimento) i.vencimento = venc; });

    const naoConferidos = novosItens.filter((i) => i.familia === "holerite" && !i.conferido);
    if (naoConferidos.length > 0) {
      novosAvisos.push(
        `${naoConferidos.length} holerite(s) em que a minha soma NÃO bateu com o total impresso no PDF: ` +
        naoConferidos.map((i) => i.rubrica).join(", ") +
        ". Abra o detalhe e confira antes de lançar."
      );
    }
    if (!comp) novosAvisos.push("Não achei o mês nem no nome do arquivo nem no PDF — escolha embaixo antes de lançar.");
    if (novosItens.length === 0) novosAvisos.push("Não achei nada pra lançar. Confira o texto lido ou adicione as linhas à mão.");

    setArquivos((a) => [...a, ...lidos]);
    setTexto((t) => [t, ...lidos.map((l) => `===== ${l.nome} =====\n${l.texto}`)].filter(Boolean).join("\n\n"));
    setCompetencia(comp);
    setPessoas(quantasPessoas ? String(quantasPessoas) : "");
    setItens((atual) => [...atual, ...novosItens]);
    setNaoEncaixadas((atual) => [...atual, ...novasNao]);
    setAvisos(novosAvisos);
    setFase("conferindo");
  };

  const mudarItem = (id, patch) =>
    setItens((atual) => atual.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const adicionarLinha = (base) =>
    setItens((atual) => [...atual, {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      rubrica: base?.rotulo || "", detalhe: "", valor: base?.valor || 0,
      plano_conta: "", vencimento: competencia ? diaDoMesSeguinte(competencia, 5) : "",
      pago: false, lancar: true, familia: "manual", aprendidaDe: 0, conflito: "", manual: true,
    }]);

  const promover = (nao) => {
    adicionarLinha(nao);
    setNaoEncaixadas((atual) => atual.filter((n) => n !== nao));
  };

  const aLancar = itens.filter((i) => i.lancar && Number(i.valor) > 0);
  const conferidas = itens.filter((i) => i.conferido).length;
  const temHolerite = itens.some((i) => i.familia === "holerite");
  const total = aLancar.reduce((t, i) => t + Number(i.valor || 0), 0);
  const totalPago = aLancar.filter((i) => i.pago).reduce((t, i) => t + Number(i.valor || 0), 0);
  const semConta = aLancar.filter((i) => !i.plano_conta);

  const lancar = async () => {
    setErro("");
    if (!competencia) { setErro("Escolha o mês da folha antes de lançar."); return; }
    if (aLancar.length === 0) { setErro("Nenhuma linha marcada pra lançar."); return; }
    if (semConta.length > 0) {
      setErro(`${semConta.length} linha(s) sem conta do DRE escolhida: ${semConta.map((i) => i.rubrica).join(", ")}.`);
      return;
    }
    if (!window.confirm(
      `Lançar ${aLancar.length} conta(s) da folha de ${competenciaTexto(competencia)}?\n\n` +
      `Total ${brl(total)} — ${brl(totalPago)} como já pago.\n\n` +
      "Dá pra desfazer tudo de uma vez depois, aqui mesmo."
    )) return;

    setFase("lancando");
    try {
      // Os PDFs sobem primeiro, um por pessoa — assim o "ver o PDF" da
      // linha da Lidiane abre o holerite dela, não o de outra pessoa.
      // Se o upload falhar, a folha entra sem anexo: perder o arquivo é
      // chato, perder o lançamento é pior.
      const { data: userData } = await supabase.auth.getUser();
      const pasta = `folhas/${userData?.user?.id || "anon"}/${Date.now()}`;
      const caminhos = {};
      let subiram = 0;
      for (const a of arquivos) {
        try {
          const nome = a.nome.replace(/[^a-zA-Z0-9.\-_]/g, "_");
          const caminho = `${pasta}/${nome}`;
          const { error: errUp } = await supabase.storage.from("notas-fiscais").upload(caminho, a.file);
          if (!errUp) { caminhos[a.nome] = caminho; subiram += 1; }
        } catch { /* segue sem esse anexo */ }
      }

      const { data, error } = await supabase.rpc("lancar_folha", {
        p_competencia: competencia,
        p_itens: aLancar.map((i) => ({
          rubrica: i.rubrica, detalhe: i.detalhe || null,
          valor: Number(i.valor), plano_conta: i.plano_conta,
          vencimento: i.vencimento || null, pago: !!i.pago,
          aprender: i.aprender !== false,
          arquivo_path: caminhos[i.arquivoNome] || null,
        })),
        p_arquivo_path: caminhos[arquivos[0]?.nome] || null,
        p_arquivo_nome: arquivos.length === 1 ? arquivos[0].nome : `${arquivos.length} arquivos`,
        p_texto: texto,
        p_pessoas: pessoas ? Number(pessoas) : null,
        p_observacao: null,
      });
      if (error) throw error;

      // Guarda a resposta que você já deu: toda folha vai pra essa conta.
      // No mês que vem a tela já vem assim e não pergunta de novo.
      if (temHolerite && contaPadrao) {
        const anterior = regras[CHAVE_FOLHA];
        const vezes = anterior && anterior.plano_conta === contaPadrao ? (anterior.vezes_usada || 0) + 1 : 1;
        await supabase.from("folha_rubrica_regras").upsert({
          rubrica_chave: CHAVE_FOLHA,
          rubrica_exemplo: "Folha de pagamento",
          plano_conta: contaPadrao,
          vezes_usada: vezes,
          atualizada_em: new Date().toISOString(),
          criado_por: userData?.user?.id || null,
        }, { onConflict: "rubrica_chave" });
      }

      setOk(`Folha de ${competenciaTexto(competencia)} lançada: ${aLancar.length} conta(s), ${brl(total)}.` +
        (subiram === arquivos.length ? "" : ` (${arquivos.length - subiram} PDF(s) não subiram, mas o lançamento entrou)`));
      limpar();
      carregar();
      void data;
    } catch (e) {
      setErro(e.message || String(e));
      setFase("conferindo");
    }
  };

  const desfazer = async (folha) => {
    if (!window.confirm(
      `Desfazer a folha de ${competenciaTexto(String(folha.competencia).slice(0, 7))}?\n\n` +
      "As contas que ela criou serão apagadas e o valor sai do DRE.\n" +
      "Conta que já recebeu pagamento por fora fica de pé — eu aviso quais."
    )) return;
    setDesfazendo(folha.id); setErro(""); setOk("");
    const { data, error } = await supabase.rpc("desfazer_folha", { p_folha_id: folha.id });
    setDesfazendo(null);
    if (error) { setErro(error.message); return; }
    setOk(String(data || "Folha desfeita."));
    carregar();
  };

  // O holerite pertence a PESSOA, nao a folha. Abrir "o PDF da folha de
  // julho" quando ela tem catorze holerites abriria sempre o mesmo, o
  // primeiro. Entao a folha abre a LISTA, e cada linha abre o seu.
  const verLinhas = async (folha) => {
    if (linhasFolha[folha.id]) { setLinhasFolha((l) => { const n = { ...l }; delete n[folha.id]; return n; }); return; }
    const { data, error } = await supabase.from("folha_itens")
      .select("id, rubrica, valor, plano_conta, data_vencimento, pago, arquivo_path")
      .eq("folha_id", folha.id).order("ordem");
    if (error) { setErro(error.message); return; }
    setLinhasFolha((l) => ({ ...l, [folha.id]: data || [] }));
  };

  const abrirPdf = async (path) => {
    if (!path) { setErro("Essa folha foi lançada sem o PDF anexado."); return; }
    const { data, error } = await supabase.storage.from("notas-fiscais").createSignedUrl(path, 300);
    if (error || !data?.signedUrl) { setErro("Não consegui abrir o PDF: " + (error?.message || "")); return; }
    window.open(data.signedUrl, "_blank");
  };

  if (carregando) return <div style={vazioStyle}><Loader2 size={16} /> Carregando…</div>;

  return (
    <div>
      <div style={{ fontSize: 12, color: "#8A8778", marginBottom: 12, lineHeight: 1.6 }}>
        Solte aqui o PDF da folha que o contador manda. O painel lê, mostra o que entendeu,
        e <b>só lança depois que você confirmar</b> — rubrica por rubrica, cada uma com sua
        conta do DRE, seu vencimento e a marca de já pago ou a pagar.
      </div>

      {erro && <div style={{ ...avisoStyle, marginBottom: 10 }}><AlertTriangle size={16} style={{ flexShrink: 0 }} /><div>{erro}</div></div>}
      {ok && <div style={{ ...okStyle, marginBottom: 10 }}><Check size={16} style={{ flexShrink: 0 }} /><div>{ok}</div></div>}

      {/* ---------------- passo 1: o arquivo ---------------- */}
      {(fase === "vazio" || fase === "lendo") && (
        <div
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={(e) => { e.preventDefault(); setArrastando(false); receberArquivos(e.dataTransfer.files); }}
          style={{
            border: `2px dashed ${arrastando ? "#4C3E77" : "#D8D0BC"}`,
            background: arrastando ? "#FBFAFE" : "#FCFAF4",
            borderRadius: 14, padding: "30px 20px", textAlign: "center", marginBottom: 14,
          }}
        >
          {fase === "lendo" ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13.5 }}>
              <Loader2 size={17} /> Lendo o PDF…
            </div>
          ) : (
            <>
              <FileText size={26} color="#8A8778" />
              <div style={{ fontSize: 15, fontWeight: 800, margin: "9px 0 4px" }}>Solte aqui os PDFs da folha</div>
              <div style={{ fontSize: 12.5, color: "#8A8778", lineHeight: 1.6 }}>
                Pode soltar <b>todos os holerites do mês de uma vez</b> — vira uma linha por pessoa.<br />
                Nada é lançado até você conferir.
              </div>
              <div style={{ marginTop: 13 }}>
                <button onClick={() => inputArquivo.current?.click()} style={btnEscuro}>
                  <Upload size={14} /> Escolher os arquivos
                </button>
              </div>
              <input ref={inputArquivo} type="file" accept="application/pdf,.pdf" multiple style={{ display: "none" }}
                onChange={(e) => { receberArquivos(e.target.files); e.target.value = ""; }} />
            </>
          )}
        </div>
      )}

      {/* ---------------- passo 2: conferir ---------------- */}
      {(fase === "conferindo" || fase === "lancando") && (
        <div style={{ ...cardStyle, padding: 0, marginBottom: 14 }}>
          <div style={{ padding: "14px 16px", background: "#F6F1E7", borderBottom: "1px solid #E8E2D2" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800 }}>
                  Folha de {competencia ? competenciaTexto(competencia) : "— escolha o mês"}
                </div>
                <div style={{ fontSize: 11.5, color: "#8A8778", marginTop: 3 }}>
                  {arquivos.length} arquivo{arquivos.length === 1 ? "" : "s"} ·{" "}
                  {itens.length} linha{itens.length === 1 ? "" : "s"}
                  {conferidas > 0 ? ` · ${conferidas} conferida(s) contra o total impresso` : ""}
                </div>
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{brl(total)}</div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
              <label style={rotuloMini}>Mês da folha</label>
              <input type="month" value={competencia} onChange={(e) => setCompetencia(e.target.value)}
                style={{ ...inputStyle, padding: "6px 9px", fontSize: 12 }} />
              <label style={rotuloMini}>Pessoas</label>
              <input type="number" value={pessoas} onChange={(e) => setPessoas(e.target.value)}
                style={{ ...inputStyle, padding: "6px 9px", fontSize: 12, width: 72 }} />
              <button onClick={() => inputArquivo.current?.click()} style={btnClaro}>
                <Plus size={13} /> Somar mais arquivos
              </button>
              <input ref={inputArquivo} type="file" accept="application/pdf,.pdf" multiple style={{ display: "none" }}
                onChange={(e) => { receberArquivos(e.target.files); e.target.value = ""; }} />
              <button onClick={limpar} style={{ ...btnClaro, marginLeft: "auto" }}><X size={13} /> Recomeçar</button>
            </div>
          </div>

          {avisos.length > 0 && (
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #F0EBDD" }}>
              {avisos.map((a, i) => (
                <div key={i} style={{ ...avisoStyle, marginBottom: i === avisos.length - 1 ? 0 : 8 }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0 }} /><div>{a}</div>
                </div>
              ))}
            </div>
          )}

          {/* A pergunta que voce ja respondeu, feita UMA vez.
              Antes cada linha trazia seu proprio seletor pedindo o mesmo
              sim. Com catorze holerites isso e catorze cliques pra dizer
              a mesma coisa — e a decima quarta ninguem le mais. */}
          {temHolerite && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                          background: "#FBFAFE", borderBottom: "1px solid #C9BEE8",
                          padding: "11px 16px" }}>
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase",
                             padding: "3px 9px", borderRadius: 999, background: "#EAE4F7", color: "#4C3E77" }}>
                aprendido
              </span>
              <span style={{ fontSize: 12.5 }}>Toda folha vai para</span>
              <select value={contaPadrao} onChange={(e) => trocarContaPadrao(e.target.value)}
                style={{ ...inputStyle, padding: "6px 9px", fontSize: 12, minWidth: 200,
                         borderColor: "#C9BEE8", background: "#FFFFFF", fontWeight: 600, color: "#4C3E77" }}>
                {plano.map((p) => (
                  <option key={p.codigo} value={p.codigo}>{p.codigo} — {p.nome}</option>
                ))}
              </select>
              <span style={{ fontSize: 11, color: "#4C3E77" }}>
                {vezesPadrao > 0
                  ? `você já usou essa conta em ${vezesPadrao} folha${vezesPadrao === 1 ? "" : "s"} — não pergunto mais`
                  : "escolha uma vez; nas próximas folhas já vem assim"}
              </span>
            </div>
          )}

          <div style={tituloBloco}>O que vai virar conta</div>

          {itens.length === 0 && (
            <div style={{ padding: "16px", fontSize: 12.5, color: "#8A8778" }}>
              Nenhuma rubrica reconhecida. Use o texto lido embaixo e adicione as linhas à mão.
            </div>
          )}

          {itens.map((i, idx) => (
            <div key={i.id} style={{ padding: "12px 16px", borderTop: idx === 0 ? "none" : "1px solid #F0EBDD",
                                     background: i.lancar ? "transparent" : "#FBFAF6" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 190 }}>
                  {i.manual ? (
                    <input value={i.rubrica} placeholder="Nome da rubrica"
                      onChange={(e) => mudarItem(i.id, { rubrica: e.target.value })}
                      style={{ ...inputStyle, padding: "6px 9px", fontSize: 13, width: "100%", maxWidth: 320 }} />
                  ) : (
                    <div style={{ fontSize: 13.5, fontWeight: 700, opacity: i.lancar ? 1 : 0.55 }}>{i.rubrica}</div>
                  )}

                  {i.familia === "holerite" ? (
                    <div style={{ fontSize: 10.5, marginTop: 3, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {/* Conferencia: a soma que eu fiz aparece impressa no
                          proprio PDF? Se aparece, li certo — e isso e
                          diferente de "achei que entendi". */}
                      {i.conferido ? (
                        <span style={{ color: "#0F6E56", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3 }}>
                          <Check size={11} /> confere com o total impresso no PDF
                        </span>
                      ) : (
                        <span style={{ color: "#A32D2D", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 3 }}>
                          <AlertTriangle size={11} /> minha soma NÃO bateu com o total do PDF — confira
                        </span>
                      )}
                      <span style={{ color: "#8A8778" }}>{i.detalhe}</span>
                      <button onClick={() => setAberto((a) => ({ ...a, [i.id]: !a[i.id] }))} style={btnTexto}>
                        {aberto[i.id] ? "esconder as rubricas" : `ver as ${(i.proventos || []).length + (i.descontos || []).length} rubricas`}
                      </button>
                    </div>
                  ) : i.aprendidaDe > 0 ? (
                    <div style={{ fontSize: 10.5, color: "#4C3E77", marginTop: 3 }}>
                      aprendido de {i.aprendidaDe} folha{i.aprendidaDe === 1 ? "" : "s"} anterior{i.aprendidaDe === 1 ? "" : "es"}
                    </div>
                  ) : (
                    <div style={{ fontSize: 10.5, color: "#8A6A0F", marginTop: 3 }}>
                      primeira vez dessa rubrica — você decide, e eu guardo
                    </div>
                  )}

                  {i.familia === "holerite" && aberto[i.id] && (
                    <div style={{ marginTop: 8, background: "#FCFAF4", border: "1px solid #F0EBDD",
                                  borderRadius: 9, padding: "8px 10px", maxWidth: 460 }}>
                      {(i.proventos || []).map((r, k) => (
                        <div key={`p${k}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, padding: "2px 0" }}>
                          <span style={{ color: "#6B685C" }}>{r.rotulo}</span>
                          <span style={{ fontVariantNumeric: "tabular-nums" }}>{brl(r.valor)}</span>
                        </div>
                      ))}
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11.5,
                                    fontWeight: 800, padding: "5px 0 2px", borderTop: "1px solid #EDE6D6", marginTop: 4 }}>
                        <span>total de proventos — é isso que vira conta</span>
                        <span style={{ fontVariantNumeric: "tabular-nums" }}>{brl(i.valor)}</span>
                      </div>
                      {(i.descontos || []).length > 0 && (
                        <>
                          {(i.descontos || []).map((r, k) => (
                            <div key={`d${k}`} style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, padding: "2px 0", color: "#8A6A0F" }}>
                              <span>− {r.rotulo}</span>
                              <span style={{ fontVariantNumeric: "tabular-nums" }}>{brl(r.valor)}</span>
                            </div>
                          ))}
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 11, padding: "4px 0 0", color: "#8A8778" }}>
                            <span>líquido que a pessoa recebe</span>
                            <span style={{ fontVariantNumeric: "tabular-nums" }}>{brl(i.liquido)}</span>
                          </div>
                          <div style={{ fontSize: 10, color: "#8A8778", marginTop: 5, lineHeight: 1.5 }}>
                            O desconto não é lançado à parte: ele já está dentro do total de proventos.
                            Lançar os dois contaria o mesmo dinheiro duas vezes.
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
                {i.manual ? (
                  <input type="number" step="0.01" value={i.valor}
                    onChange={(e) => mudarItem(i.id, { valor: e.target.value })}
                    style={{ ...inputStyle, padding: "6px 9px", fontSize: 13, width: 120, textAlign: "right" }} />
                ) : (
                  <div style={{ fontSize: 14, fontWeight: 800, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap",
                                opacity: i.lancar ? 1 : 0.55 }}>{brl(i.valor)}</div>
                )}
              </div>

              {i.conflito && (
                <div style={{ ...avisoStyle, marginTop: 8, marginBottom: 0, fontSize: 12 }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0 }} /><div>{i.conflito}</div>
                </div>
              )}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 9 }}>
                {/* Holerite nao repete o seletor: a conta ja foi decidida
                    la em cima, uma vez, pra folha inteira. */}
                {i.familia !== "holerite" && (
                  <select value={i.plano_conta} onChange={(e) => mudarItem(i.id, { plano_conta: e.target.value })}
                    style={{ ...inputStyle, padding: "6px 9px", fontSize: 11.5, minWidth: 200,
                             ...(i.plano_conta ? { borderColor: "#C9BEE8", background: "#FBFAFE", fontWeight: 600, color: "#4C3E77" } : {}) }}>
                    <option value="">Escolha a conta do DRE…</option>
                    {plano.map((p) => (
                      <option key={p.codigo} value={p.codigo}>
                        {p.codigo} — {p.nome}{p.entra_dre ? "" : "  (fora do DRE)"}
                      </option>
                    ))}
                  </select>
                )}

                <input type="date" value={i.vencimento} onChange={(e) => mudarItem(i.id, { vencimento: e.target.value })}
                  style={{ ...inputStyle, padding: "6px 9px", fontSize: 11.5 }} />

                <div style={{ display: "inline-flex", border: "1px solid #E8E2D2", borderRadius: 8, overflow: "hidden" }}>
                  <button onClick={() => mudarItem(i.id, { pago: true })}
                    style={{ ...segmento, ...(i.pago ? segmentoPago : {}) }}>Já pago</button>
                  <button onClick={() => mudarItem(i.id, { pago: false })}
                    style={{ ...segmento, ...(!i.pago ? segmentoAtivo : {}) }}>A pagar</button>
                </div>

                <button onClick={() => mudarItem(i.id, { lancar: !i.lancar })}
                  style={{ ...btnTexto, marginLeft: "auto" }}>
                  {i.lancar ? "não lançar" : "voltar a lançar"}
                </button>
                {i.manual && (
                  <button onClick={() => setItens((a) => a.filter((x) => x.id !== i.id))} style={btnTexto}>
                    <Trash2 size={12} /> remover
                  </button>
                )}
              </div>
            </div>
          ))}

          <div style={{ padding: "11px 16px", borderTop: "1px solid #F0EBDD" }}>
            <button onClick={() => adicionarLinha(null)} style={btnClaro}><Plus size={13} /> Adicionar linha à mão</button>
          </div>

          {/* o que não coube */}
          {naoEncaixadas.length > 0 && (
            <div style={{ padding: "13px 16px", borderTop: "1px solid #F0EBDD" }}>
              <div style={{ ...avisoStyle, marginBottom: 0, display: "block" }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                  <div>
                    <b>{naoEncaixadas.length} linha(s) com valor que eu não vou lançar.</b> Confira:
                    se alguma for despesa de verdade, clique em "lançar essa".
                  </div>
                </div>
                {naoEncaixadas.slice(0, 25).map((n, idx) => (
                  <div key={idx} style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap",
                                          padding: "6px 0", borderTop: idx === 0 ? "none" : "1px solid #EFE3BC" }}>
                    <div style={{ flex: 1, minWidth: 170, fontSize: 12 }}>
                      {n.rotulo}
                      <div style={{ fontSize: 10.5, opacity: 0.8, marginTop: 1 }}>{n.motivo}</div>
                    </div>
                    <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{brl(n.valor)}</span>
                    <button onClick={() => promover(n)} style={btnClaro}>lançar essa</button>
                  </div>
                ))}
                {naoEncaixadas.length > 25 && (
                  <div style={{ fontSize: 11, marginTop: 7 }}>
                    …e mais {naoEncaixadas.length - 25}. Estão todas no texto lido abaixo.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* texto cru */}
          <div style={{ padding: "11px 16px", borderTop: "1px solid #F0EBDD" }}>
            <button onClick={() => setVerTexto((v) => !v)} style={btnTexto}>
              <Eye size={13} /> {verTexto ? "Esconder" : "Ver"} o texto que eu li do PDF
            </button>
            {verTexto && (
              <pre style={{
                margin: "9px 0 0", background: "#FCFAF4", border: "1px solid #F0EBDD", borderRadius: 9,
                padding: 11, fontSize: 10.5, lineHeight: 1.65, color: "#6B685C", maxHeight: 340,
                overflow: "auto", whiteSpace: "pre-wrap", fontFamily: "ui-monospace, Menlo, monospace",
              }}>{texto}</pre>
            )}
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12,
                        flexWrap: "wrap", padding: "14px 16px", background: "#FCFAF4", borderTop: "1px solid #E8E2D2" }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
              Vai lançar <b>{aLancar.length} conta(s)</b> · <b>{brl(total)}</b><br />
              <span style={{ color: "#8A8778" }}>
                {aLancar.filter((i) => i.pago).length} como já paga(s) ({brl(totalPago)}) ·{" "}
                {aLancar.filter((i) => !i.pago).length} a pagar ({brl(total - totalPago)})
              </span>
            </div>
            <button onClick={lancar} disabled={fase === "lancando" || aLancar.length === 0} style={btnRoxo}>
              {fase === "lancando" ? <><Loader2 size={14} /> lançando…</> : `Conferi — pode lançar ${aLancar.length}`}
            </button>
          </div>
        </div>
      )}

      {/* ---------------- histórico ---------------- */}
      <div style={{ ...cardStyle, padding: 0 }}>
        <div style={tituloBloco}>Folhas já lançadas</div>
        {historico.length === 0 ? (
          <div style={{ padding: 16, fontSize: 12.5, color: "#8A8778" }}>Nenhuma folha lançada ainda.</div>
        ) : historico.map((f, idx) => (
          <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                                   gap: 12, flexWrap: "wrap", padding: "11px 16px",
                                   borderTop: idx === 0 ? "none" : "1px solid #F0EBDD" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700 }}>
                {competenciaTexto(String(f.competencia).slice(0, 7))} · {brl(f.valor_total)}
              </div>
              <div style={{ fontSize: 11, color: "#8A8778", marginTop: 2 }}>
                {f.pessoas ? `${f.pessoas} pessoas · ` : ""}
                lançada em {new Date(f.criado_em).toLocaleDateString("pt-BR")}
                {f.arquivo_nome ? ` · ${f.arquivo_nome}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 7 }}>
              {f.arquivo_path && (
                <button onClick={() => verLinhas(f)} style={btnClaro}>
                  <Eye size={13} /> {linhasFolha[f.id] ? "Esconder" : "Ver as linhas"}
                </button>
              )}
              <button onClick={() => desfazer(f)} disabled={desfazendo === f.id} style={btnClaro}>
                {desfazendo === f.id ? <><Loader2 size={13} /> desfazendo…</> : <><RotateCcw size={13} /> Desfazer</>}
              </button>
            </div>

            {linhasFolha[f.id] && (
              <div style={{ flexBasis: "100%", marginTop: 9, border: "1px solid #F0EBDD",
                            borderRadius: 10, overflow: "hidden" }}>
                {linhasFolha[f.id].length === 0 && (
                  <div style={{ padding: "9px 12px", fontSize: 11.5, color: "#8A8778" }}>Sem linhas guardadas.</div>
                )}
                {linhasFolha[f.id].map((l, k) => (
                  <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                                           padding: "8px 12px", borderTop: k === 0 ? "none" : "1px solid #F5F1E6" }}>
                    <div style={{ flex: 1, minWidth: 150, fontSize: 12 }}>
                      {l.rubrica}
                      <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 1 }}>
                        {l.plano_conta || "sem conta"}
                        {l.data_vencimento ? ` · vence ${String(l.data_vencimento).split("-").reverse().join("/")}` : ""}
                        {l.pago ? " · pago" : " · a pagar"}
                      </div>
                    </div>
                    <span style={{ fontSize: 12.5, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{brl(l.valor)}</span>
                    {l.arquivo_path
                      ? <button onClick={() => abrirPdf(l.arquivo_path)} style={btnClaro}><Eye size={12} /> PDF</button>
                      : <span style={{ fontSize: 10.5, color: "#8A8778", minWidth: 52 }}>sem PDF</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        <div style={{ padding: "11px 16px", borderTop: "1px solid #F0EBDD", fontSize: 11.5, color: "#8A8778", lineHeight: 1.6 }}>
          Uma folha por mês. Subir o mesmo mês duas vezes é barrado no banco — folha duplicada
          some no meio do DRE e só aparece quando o ano fecha. Desfazer libera o mês de novo.
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const inputStyle = { padding: "9px 10px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF", color: "#22231F", fontFamily: "inherit" };
const avisoStyle = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13 };
const okStyle = { display: "flex", gap: 8, background: "#EDF7F2", border: "1px solid #B6DDCC", color: "#14503F", borderRadius: 10, padding: "12px 14px", fontSize: 13 };
const vazioStyle = { display: "flex", alignItems: "center", gap: 8, padding: 16, fontSize: 13, color: "#8A8778" };
const tituloBloco = { padding: "11px 16px", fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778", borderBottom: "1px solid #F0EBDD" };
const rotuloMini = { fontSize: 11, color: "#8A8778", fontWeight: 600 };
const btnBase = { display: "inline-flex", alignItems: "center", gap: 6, border: "none", borderRadius: 8, padding: "8px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnEscuro = { ...btnBase, background: "#22231F", color: "#F3EFE3" };
const btnRoxo = { ...btnBase, background: "#4C3E77", color: "#F5F2FC", padding: "9px 15px" };
const btnClaro = { ...btnBase, background: "#FFFFFF", color: "#22231F", border: "1px solid #E8E2D2", padding: "6px 11px", fontSize: 11.5 };
const btnTexto = { ...btnBase, background: "none", color: "#8A6A0F", padding: "4px 2px", fontSize: 11.5, fontWeight: 600 };
const segmento = { border: "none", background: "#FFFFFF", color: "#8A8778", padding: "6px 11px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const segmentoAtivo = { background: "#22231F", color: "#F3EFE3" };
const segmentoPago = { background: "#0F6E56", color: "#EAF7F2" };
