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

  // competência: "08/2026", "COMPETENCIA AGOSTO/2026", "REF. 08/2026"
  let competencia = "";
  for (const l of linhas) {
    const t = semAcento(l);
    let m = t.match(/(?:compet[eê]ncia|refer[eê]ncia|ref\.?|m[eê]s)\D{0,12}(\d{2})\s*[\/\-.]\s*(\d{4})/);
    if (m) { competencia = `${m[2]}-${m[1]}`; break; }
    const nome = MESES.findIndex((mes) => t.includes(semAcento(mes)));
    if (nome >= 0) {
      m = t.match(/(\d{4})/);
      if (m) { competencia = `${m[1]}-${String(nome + 1).padStart(2, "0")}`; break; }
    }
  }
  if (!competencia) {
    for (const l of linhas) {
      const m = semAcento(l).match(/\b(\d{2})\s*\/\s*(\d{4})\b/);
      if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) { competencia = `${m[2]}-${m[1]}`; break; }
    }
  }

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
  const [arquivo, setArquivo] = useState(null);
  const [texto, setTexto] = useState("");
  const [paginas, setPaginas] = useState(0);
  const [competencia, setCompetencia] = useState("");
  const [pessoas, setPessoas] = useState("");
  const [itens, setItens] = useState([]);
  const [naoEncaixadas, setNaoEncaixadas] = useState([]);
  const [avisos, setAvisos] = useState([]);
  const [verTexto, setVerTexto] = useState(false);
  const [arrastando, setArrastando] = useState(false);

  const [plano, setPlano] = useState([]);
  const [regras, setRegras] = useState({});
  const [historico, setHistorico] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [desfazendo, setDesfazendo] = useState(null);
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
    setFase("vazio"); setArquivo(null); setTexto(""); setPaginas(0);
    setCompetencia(""); setPessoas(""); setItens([]); setNaoEncaixadas([]);
    setAvisos([]); setVerTexto(false); setErro("");
  };

  const receberArquivo = async (file) => {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) { setErro("Por enquanto só PDF. Se o contador manda em outro formato, me diga qual."); return; }
    setErro(""); setOk(""); setFase("lendo"); setArquivo(file);
    try {
      const { texto: txt, paginas: np } = await lerPdf(file);
      setTexto(txt); setPaginas(np);

      // PDF que é foto não tem texto pra extrair. Vale dizer isso com
      // todas as letras em vez de mostrar uma tela vazia.
      if (txt.replace(/\s/g, "").length < 40) {
        setErro("Esse PDF parece ser uma imagem (papel escaneado ou foto), não texto. " +
          "Não dá pra ler os números dele. Peça ao contador o PDF gerado pelo sistema — " +
          "aquele em que dá pra selecionar o texto com o mouse.");
        setFase("vazio"); setArquivo(null);
        return;
      }

      const lido = analisarFolha(txt, regras);
      setCompetencia(lido.competencia);
      setPessoas(lido.pessoas != null ? String(lido.pessoas) : "");
      setItens(lido.itens);
      setNaoEncaixadas(lido.naoEncaixadas);
      setAvisos(lido.avisos);
      setFase("conferindo");
    } catch (e) {
      setErro("Não consegui ler o PDF: " + (e.message || e));
      setFase("vazio"); setArquivo(null);
    }
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
      // O PDF sobe primeiro. Se o upload falhar, a folha entra sem ele —
      // perder o anexo é chato, perder o lançamento é pior.
      let caminho = null;
      try {
        const { data: userData } = await supabase.auth.getUser();
        const nome = (arquivo?.name || "folha.pdf").replace(/[^a-zA-Z0-9.\-_]/g, "_");
        caminho = `folhas/${userData?.user?.id || "anon"}/${Date.now()}-${nome}`;
        const { error: errUp } = await supabase.storage.from("notas-fiscais").upload(caminho, arquivo);
        if (errUp) caminho = null;
      } catch { caminho = null; }

      const { data, error } = await supabase.rpc("lancar_folha", {
        p_competencia: competencia,
        p_itens: aLancar.map((i) => ({
          rubrica: i.rubrica, detalhe: i.detalhe || null,
          valor: Number(i.valor), plano_conta: i.plano_conta,
          vencimento: i.vencimento || null, pago: !!i.pago,
        })),
        p_arquivo_path: caminho,
        p_arquivo_nome: arquivo?.name || null,
        p_texto: texto,
        p_pessoas: pessoas ? Number(pessoas) : null,
        p_observacao: null,
      });
      if (error) throw error;
      setOk(`Folha de ${competenciaTexto(competencia)} lançada: ${aLancar.length} conta(s), ${brl(total)}.` +
        (caminho ? "" : " (o PDF não subiu, mas o lançamento entrou)"));
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
          onDrop={(e) => { e.preventDefault(); setArrastando(false); receberArquivo(e.dataTransfer.files?.[0]); }}
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
              <div style={{ fontSize: 15, fontWeight: 800, margin: "9px 0 4px" }}>Solte aqui o PDF da folha</div>
              <div style={{ fontSize: 12.5, color: "#8A8778", lineHeight: 1.6 }}>
                Ou clique pra escolher. Nada é lançado até você conferir.
              </div>
              <div style={{ marginTop: 13 }}>
                <button onClick={() => inputArquivo.current?.click()} style={btnEscuro}>
                  <Upload size={14} /> Escolher o arquivo
                </button>
              </div>
              <input ref={inputArquivo} type="file" accept="application/pdf,.pdf" style={{ display: "none" }}
                onChange={(e) => { receberArquivo(e.target.files?.[0]); e.target.value = ""; }} />
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
                  {pessoas ? `${pessoas} pessoas · ` : ""}{itens.length} rubrica(s) lida(s)
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
              <span style={{ fontSize: 11, color: "#8A8778", display: "inline-flex", alignItems: "center", gap: 5 }}>
                <FileText size={12} /> {arquivo?.name}{paginas ? ` · ${paginas} pág.` : ""}
              </span>
              <button onClick={limpar} style={{ ...btnClaro, marginLeft: "auto" }}><X size={13} /> Trocar arquivo</button>
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
                  {i.aprendidaDe > 0 ? (
                    <div style={{ fontSize: 10.5, color: "#4C3E77", marginTop: 3 }}>
                      aprendido de {i.aprendidaDe} folha{i.aprendidaDe === 1 ? "" : "s"} anterior{i.aprendidaDe === 1 ? "" : "es"}
                    </div>
                  ) : (
                    <div style={{ fontSize: 10.5, color: "#8A6A0F", marginTop: 3 }}>
                      primeira vez dessa rubrica — você decide, e eu guardo
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
                <button onClick={() => abrirPdf(f.arquivo_path)} style={btnClaro}><Eye size={13} /> Ver o PDF</button>
              )}
              <button onClick={() => desfazer(f)} disabled={desfazendo === f.id} style={btnClaro}>
                {desfazendo === f.id ? <><Loader2 size={13} /> desfazendo…</> : <><RotateCcw size={13} /> Desfazer</>}
              </button>
            </div>
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
