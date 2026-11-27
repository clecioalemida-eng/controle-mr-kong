// ===== EncargosRiscos.jsx =====
// Gente e Gestão › Encargos e riscos
//
// Cinco partes, numa aba só:
//   - FGTS do mês de cada registrado (8% de salário + comissão)
//   - Férias: período aquisitivo, prazo para conceder, quem venceu
//   - 13º: quanto já está provisionado e a 1ª parcela
//   - Sem carteira: diarista/freela vindo com frequência, e o risco
//   - Pendências de cadastro: falta documento, telefone, endereço, CPF
//
// TUDO aqui é estimativa de apoio. O número oficial é o do holerite e da
// guia do contador — a tela diz isso no topo e não deixa esquecer.
//
// De onde vem cada número:
//   - salário: pessoas.salario_base
//   - comissão: premiacoes_diarias.comissao (o que a escala gravou)
//   - noites trabalhadas: presencas_diarias
//   - admissão: pessoas.data_admissao (migração 198)
//   - férias tiradas: ferias_concedidas (migração 198)
//   - endereço: pessoas.endereco (migração 199)
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, AlertTriangle, ChevronLeft, ChevronRight, Trash2, Check } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

// ---------------------------------------------------------------------------
// Datas — sempre no relógio local, nunca toISOString() (em Rio Verde, das
// 21h em diante o UTC já virou o dia seguinte).
// ---------------------------------------------------------------------------
const p2 = (n) => String(n).padStart(2, "0");
function iso(d) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
function lerData(s) {
  if (!s) return null;
  const [a, m, d] = String(s).slice(0, 10).split("-").map(Number);
  return new Date(a, m - 1, d);
}
function hojeData() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function somaAnos(d, n) {
  // 29/02 + 1 ano cai em 01/03 — igual a qualquer calendário de RH.
  return new Date(d.getFullYear() + n, d.getMonth(), d.getDate());
}
function somaDias(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function diasEntre(a, b) { return Math.round((b - a) / 86400000); }
function br(d) { return d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}` : "—"; }
function chaveMes(d) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}`; }
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function brl(v) { return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function porNome(a, b) { return (a.nome || "").localeCompare(b.nome || "", "pt-BR", { sensitivity: "base" }); }

const PAPEL_LABEL = { garcom: "Garçom", interno: "Equipe interna", caixa: "Caixa", bar: "Bar", chapa: "Chapa", cozinha: "Cozinha", limpeza: "Limpeza", gerente: "Gerente" };
const VINCULO_LABEL = { registrado: "Registrado", diarista: "Diarista", freela: "Freela" };
const semCarteira = (p) => p?.tipo_contrato === "diarista" || p?.tipo_contrato === "freela";

// Alíquotas da estimativa. FGTS é 8% (aprendiz seria 2%, não temos).
// Férias + 1/3 e 13º provisionados por mês = 1/12 cada (férias com o
// terço: 4/3 ÷ 12). INSS patronal fica de fora: depende do regime
// tributário, e no Simples quase não existe — quem sabe é o contador.
const FGTS = 0.08;
const PROV_13 = 1 / 12;
const PROV_FERIAS = (4 / 3) / 12;
const ENCARGO_PASSIVO = FGTS + PROV_13 + PROV_FERIAS; // ≈ 0,274

// Critério do painel para o risco de quem não tem carteira. Não é regra
// da lei — a lei não tem número mágico. É o que faz a pessoa parecer
// empregada: vir sempre, nas mesmas noites, há meses.
const NOITES_MES_CONTA = 4; // mês com 4+ noites conta como "veio no mês"

// Supabase devolve no máximo 1.000 linhas por consulta. Presença de 40
// pessoas em 12 meses passa disso — então busca em páginas.
async function buscarTudo(montar) {
  const tudo = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await montar().range(de, de + 999);
    if (error) throw error;
    tudo.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return tudo;
}

// ---------------------------------------------------------------------------
// Cálculos
// ---------------------------------------------------------------------------

// Períodos aquisitivos desde a admissão até hoje, com o que já foi tirado
// de cada um. O "pendente" é o mais antigo completo que ainda não teve os
// 30 dias — é ele que decide se está vencido.
function periodosDeFerias(admissao, feriasDaPessoa, hoje) {
  const periodos = [];
  for (let k = 0; k < 50; k++) {
    const ini = somaAnos(admissao, k);
    if (ini > hoje) break;
    const fim = somaDias(somaAnos(admissao, k + 1), -1);
    const limite = somaDias(somaAnos(admissao, k + 2), -1);
    const tirados = feriasDaPessoa
      .filter((f) => f.aquisitivo_inicio === iso(ini))
      .reduce((t, f) => t + (Number(f.dias) || 0), 0);
    periodos.push({ ini, fim, limite, completo: fim < hoje, tirados });
  }
  const pendentes = periodos.filter((p) => p.completo && p.tirados < 30);
  const vencidos = pendentes.filter((p) => hoje > p.limite);
  const atual = periodos[periodos.length - 1] || null;
  return { periodos, pendente: pendentes[0] || null, vencidos, atual };
}

function situacaoFerias(info, hoje) {
  const { pendente, atual } = info;
  if (pendente) {
    const falta = diasEntre(hoje, pendente.limite);
    const corrido = Math.min(1, Math.max(0, diasEntre(somaDias(pendente.fim, 1), hoje) / Math.max(1, diasEntre(pendente.fim, pendente.limite))));
    if (falta < 0) return { nivel: "alto", texto: "VENCIDA", detalhe: `prazo era ${br(pendente.limite)} — pagar em dobro`, corrido: 1 };
    if (falta <= 90) return { nivel: "alto", texto: `vence em ${falta} dia(s)`, detalhe: `dar férias até ${br(pendente.limite)}`, corrido };
    return { nivel: "medio", texto: "tem direito", detalhe: `dar férias até ${br(pendente.limite)}`, corrido };
  }
  if (atual) {
    const corrido = Math.min(1, Math.max(0, diasEntre(atual.ini, hoje) / 365));
    return { nivel: "baixo", texto: "no prazo", detalhe: `completa o direito em ${br(somaDias(atual.fim, 1))}`, corrido };
  }
  return { nivel: "baixo", texto: "admissão futura", detalhe: "", corrido: 0 };
}

// Avos de 13º no ano: 1/12 por mês com 15 dias ou mais de contrato.
function avosDe13(admissao, ano, hoje) {
  let ateAgora = 0;
  let noAno = 0;
  for (let m = 0; m < 12; m++) {
    const mesIni = new Date(ano, m, 1);
    const mesFim = new Date(ano, m + 1, 0);
    if (admissao > mesFim) continue;
    const comeco = admissao > mesIni ? admissao : mesIni;
    if (diasEntre(comeco, mesFim) + 1 >= 15) noAno++;
    const fimContado = hoje < mesFim ? hoje : mesFim;
    if (fimContado >= comeco && diasEntre(comeco, fimContado) + 1 >= 15) ateAgora++;
  }
  return { ateAgora, noAno };
}

function nivelDeRisco(noitesSemana, mesesSeguidos) {
  if (noitesSemana >= 3 && mesesSeguidos >= 3) return "alto";
  if (noitesSemana >= 2 && mesesSeguidos >= 2) return "medio";
  if (noitesSemana >= 3) return "medio";
  return "baixo";
}

// O que falta no cadastro de cada pessoa. Registrado também precisa da
// admissão — sem ela, férias e 13º não têm de onde contar.
function pendenciasDe(p) {
  const falta = [];
  if (!p.documento_path) falta.push("documento");
  if (!String(p.cpf || "").trim()) falta.push("CPF");
  if (!String(p.telefone || "").trim()) falta.push("telefone");
  if (!String(p.endereco || "").trim()) falta.push("endereço");
  if (p.tipo_contrato === "registrado" && !p.data_admissao) falta.push("data de admissão");
  return falta;
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------
const PARTES = [
  { chave: "fgts", label: "FGTS" },
  { chave: "ferias", label: "Férias" },
  { chave: "decimo", label: "13º" },
  { chave: "risco", label: "Sem carteira" },
  { chave: "cadastro", label: "Pendências de cadastro" },
];

export default function EncargosRiscos({ verValores, irParaPessoas }) {
  const hoje = useMemo(() => hojeData(), []);
  const [parte, setParte] = useState("risco");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [pessoas, setPessoas] = useState([]);
  const [presencas, setPresencas] = useState([]);
  const [premiacoes, setPremiacoes] = useState([]);
  const [ferias, setFerias] = useState([]);
  const [primeiroDia, setPrimeiroDia] = useState({});
  const [folhas, setFolhas] = useState([]);

  // 12 meses para trás, começando no dia 1º — o gráfico do ano e a
  // média de 3 meses saem daqui.
  const inicioJanela = useMemo(() => new Date(hoje.getFullYear(), hoje.getMonth() - 11, 1), [hoje]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    try {
      const desde = iso(inicioJanela);
      const [resPessoas, pres, prem, resFerias, resFolhas] = await Promise.all([
        supabase.from("pessoas").select("*").order("nome"),
        buscarTudo(() => supabase.from("presencas_diarias").select("id, pessoa_id, dia").gte("dia", desde).order("id")),
        buscarTudo(() => supabase.from("premiacoes_diarias").select("id, pessoa_id, dia, comissao, total_dia").gte("dia", desde).order("id")),
        supabase.from("ferias_concedidas").select("*").order("inicio", { ascending: false }),
        supabase.from("folhas_pagamento").select("id, competencia, desfeita_em").is("desfeita_em", null)
          .order("competencia", { ascending: false }).limit(24),
      ]);
      if (resPessoas.error) throw resPessoas.error;
      if (resFerias.error) throw resFerias.error;
      const lista = (resPessoas.data || []).slice().sort(porNome);
      setPessoas(lista);
      setPresencas(pres);
      setPremiacoes(prem);
      setFerias(resFerias.data || []);
      setFolhas(resFolhas.error ? [] : (resFolhas.data || []));

      // Para quem é registrado e ainda não tem admissão: o primeiro dia
      // dessa pessoa na escala vira sugestão. São poucas pessoas, então
      // uma consulta curta para cada.
      const semAdmissao = lista.filter((p) => p.ativo && p.tipo_contrato === "registrado" && !p.data_admissao);
      const sugestoes = await Promise.all(semAdmissao.map((p) =>
        supabase.from("presencas_diarias").select("dia").eq("pessoa_id", p.id).order("dia").limit(1)
          .then(({ data }) => [p.id, data?.[0]?.dia || null])
      ));
      setPrimeiroDia(Object.fromEntries(sugestoes));
    } catch (e) {
      setErro(e.message || String(e));
    }
    setCarregando(false);
  }, [inicioJanela]);

  useEffect(() => { carregar(); }, [carregar]);

  const registrados = useMemo(
    () => pessoas.filter((p) => p.ativo && p.tipo_contrato === "registrado"),
    [pessoas]
  );

  // ----- Sem carteira -------------------------------------------------------
  const risco = useMemo(() => {
    const mesesJanela = [];
    for (let i = 0; i < 12; i++) mesesJanela.push(new Date(inicioJanela.getFullYear(), inicioJanela.getMonth() + i, 1));
    const corte90 = iso(somaDias(hoje, -90));
    const porPessoa = {};
    presencas.forEach((pr) => {
      const r = porPessoa[pr.pessoa_id] || (porPessoa[pr.pessoa_id] = { meses: {}, ult90: 0 });
      const k = String(pr.dia).slice(0, 7);
      r.meses[k] = (r.meses[k] || 0) + 1;
      if (pr.dia >= corte90) r.ult90++;
    });
    const ganhoPorMes = {};
    premiacoes.forEach((pr) => {
      const k = `${pr.pessoa_id}|${String(pr.dia).slice(0, 7)}`;
      ganhoPorMes[k] = (ganhoPorMes[k] || 0) + (Number(pr.total_dia) || 0);
    });

    return pessoas
      .filter((p) => semCarteira(p) && porPessoa[p.id])
      .map((p) => {
        const r = porPessoa[p.id];
        const noitesSemana = r.ult90 / (90 / 7);
        const noitesMes = r.ult90 / 3;
        // Meses seguidos com 4+ noites, contando de trás pra frente. O mês
        // corrente só entra se já bateu 4 noites — começo de mês não pode
        // zerar a sequência de quem vem sempre.
        let seguidos = 0;
        const mesesDaSequencia = [];
        for (let i = mesesJanela.length - 1; i >= 0; i--) {
          const k = chaveMes(mesesJanela[i]);
          const n = r.meses[k] || 0;
          const corrente = i === mesesJanela.length - 1;
          if (n >= NOITES_MES_CONTA) { seguidos++; mesesDaSequencia.push(k); continue; }
          if (corrente) continue;
          break;
        }
        const ganhoSequencia = mesesDaSequencia.reduce((t, k) => t + (ganhoPorMes[`${p.id}|${k}`] || 0), 0);
        const mediaMensal = seguidos ? ganhoSequencia / seguidos : 0;
        return {
          pessoa: p,
          noitesSemana, noitesMes, seguidos,
          nivel: nivelDeRisco(noitesSemana, seguidos),
          meses: mesesJanela.map((d) => ({ rotulo: MESES_CURTOS[d.getMonth()], n: r.meses[chaveMes(d)] || 0 })),
          mediaMensal,
          passivo: round2(mediaMensal * seguidos * ENCARGO_PASSIVO),
          custoRegistrar: round2(mediaMensal * (1 + ENCARGO_PASSIVO)),
        };
      })
      .filter((x) => x.pessoa.ativo || x.noitesMes > 0)
      .sort((a, b) => ({ alto: 0, medio: 1, baixo: 2 }[a.nivel] - { alto: 0, medio: 1, baixo: 2 }[b.nivel]) || b.noitesSemana - a.noitesSemana);
  }, [pessoas, presencas, premiacoes, hoje, inicioJanela]);

  // ----- Férias -------------------------------------------------------------
  const linhasFerias = useMemo(() => registrados.map((p) => {
    const adm = lerData(p.data_admissao);
    if (!adm) return { pessoa: p, adm: null };
    const info = periodosDeFerias(adm, ferias.filter((f) => f.pessoa_id === p.id), hoje);
    return { pessoa: p, adm, info, sit: situacaoFerias(info, hoje) };
  }), [registrados, ferias, hoje]);

  // ----- 13º ----------------------------------------------------------------
  const ano = hoje.getFullYear();
  const linhas13 = useMemo(() => registrados.map((p) => {
    const adm = lerData(p.data_admissao);
    const sal = Number(p.salario_base) || 0;
    if (!adm) return { pessoa: p, adm: null, sal };
    const { ateAgora, noAno } = avosDe13(adm, ano, hoje);
    return {
      pessoa: p, adm, sal, ateAgora, noAno,
      provisionado: round2(sal / 12 * ateAgora),
      primeira: round2(sal / 12 * noAno / 2),
      total: round2(sal / 12 * noAno),
    };
  }), [registrados, ano, hoje]);

  // ----- Pendências ---------------------------------------------------------
  const pendencias = useMemo(() => pessoas
    .filter((p) => p.ativo)
    .map((p) => ({ pessoa: p, falta: pendenciasDe(p) }))
    .filter((x) => x.falta.length)
    .sort((a, b) => (semCarteira(b.pessoa) - semCarteira(a.pessoa)) || b.falta.length - a.falta.length || porNome(a.pessoa, b.pessoa)),
  [pessoas]);

  // ----- Resumo -------------------------------------------------------------
  const mesAtual = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const fgtsMesAtual = useMemo(() => {
    const k = chaveMes(mesAtual);
    return round2(registrados.reduce((t, p) => {
      const com = premiacoes.filter((x) => x.pessoa_id === p.id && String(x.dia).slice(0, 7) === k)
        .reduce((s, x) => s + (Number(x.comissao) || 0), 0);
      return t + ((Number(p.salario_base) || 0) + com) * FGTS;
    }, 0));
  }, [registrados, premiacoes]); // eslint-disable-line react-hooks/exhaustive-deps
  const feriasVencidas = linhasFerias.filter((l) => l.info?.vencidos.length).length;
  const feriasPerto = linhasFerias.filter((l) => l.sit && l.sit.nivel === "alto" && !l.info.vencidos.length).length;
  const semAdmissao = registrados.filter((p) => !p.data_admissao).length;
  const primeiraParcela = round2(linhas13.reduce((t, l) => t + (l.primeira || 0), 0));
  const altos = risco.filter((r) => r.nivel === "alto").length;
  const medios = risco.filter((r) => r.nivel === "medio").length;
  const vence1a = new Date(ano, 10, 30);
  const faltam1a = diasEntre(hoje, vence1a);

  if (carregando) return <div style={{ fontSize: 13, color: "#8A8778", display: "flex", gap: 8, alignItems: "center" }}><Loader2 size={15} /> Carregando…</div>;

  return (
    <div>
      {erro && <div style={avisoErro}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div>{erro}</div></div>}

      <div style={avisoEstimativa}>
        <b>Estimativa de apoio — não substitui o contador.</b> Os valores saem do salário cadastrado, da comissão
        e das noites lançadas na escala. O número oficial é o do holerite e da guia do contador.
      </div>

      <div style={grade}>
        <Bloco titulo={`FGTS de ${MESES_LONGOS[hoje.getMonth()]}`} onClick={() => setParte("fgts")}
          valor={verValores ? brl(fgtsMesAtual) : `${registrados.length} registrados`}
          nota={`guia vence 20/${p2(((hoje.getMonth() + 1) % 12) + 1)} · confirme com o contador`} />
        <Bloco titulo="13º · 1ª parcela" onClick={() => setParte("decimo")}
          valor={verValores ? brl(primeiraParcela) : `${linhas13.filter((l) => l.adm).length} pessoas`}
          nota={faltam1a >= 0 ? `vence 30/11 · faltam ${faltam1a} dia(s)` : "1ª parcela venceu 30/11 · 2ª até 20/12"}
          cor={faltam1a >= 0 && faltam1a <= 15 ? COR.alto : null} />
        <Bloco titulo="Férias" onClick={() => setParte("ferias")}
          valor={feriasVencidas ? `${feriasVencidas} vencida(s)` : feriasPerto ? `${feriasPerto} perto de vencer` : "em dia"}
          nota={semAdmissao ? `${semAdmissao} sem data de admissão` : "conforme o que foi marcado"}
          cor={feriasVencidas || feriasPerto ? COR.alto : null} />
        <Bloco titulo="Sem carteira" onClick={() => setParte("risco")}
          valor={`${altos} em risco alto`} nota={`${medios} em risco médio`} cor={altos ? COR.alto : null} />
        <Bloco titulo="Cadastro incompleto" onClick={() => setParte("cadastro")}
          valor={`${pendencias.length} pessoa(s)`}
          nota={`${pendencias.filter((x) => semCarteira(x.pessoa)).length} sem carteira`}
          cor={pendencias.length ? COR.medio : null} />
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {PARTES.map((p) => (
          <button key={p.chave} onClick={() => setParte(p.chave)}
            style={{ ...pillBtn, ...(parte === p.chave ? pillBtnAtivo : {}) }}>{p.label}</button>
        ))}
      </div>

      {parte === "fgts" && <ParteFgts registrados={registrados} premiacoes={premiacoes} folhas={folhas}
        verValores={verValores} hoje={hoje} inicioJanela={inicioJanela} />}
      {parte === "ferias" && <ParteFerias linhas={linhasFerias} ferias={ferias} primeiroDia={primeiroDia}
        verValores={verValores} hoje={hoje} recarregar={carregar} setErro={setErro} />}
      {parte === "decimo" && <ParteDecimo linhas={linhas13} verValores={verValores} ano={ano} irParaFerias={() => setParte("ferias")} />}
      {parte === "risco" && <ParteRisco linhas={risco} verValores={verValores} />}
      {parte === "cadastro" && <ParteCadastro linhas={pendencias} irParaPessoas={irParaPessoas} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FGTS
// ---------------------------------------------------------------------------
function ParteFgts({ registrados, premiacoes, folhas, verValores, hoje, inicioJanela }) {
  const [mes, setMes] = useState(() => new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  const [fgtsFolha, setFgtsFolha] = useState(null); // null = carregando/sem folha
  const k = chaveMes(mes);
  const folhaDoMes = folhas.find((f) => String(f.competencia).slice(0, 7) === k) || null;

  // O FGTS que o contador pôs na folha do mês, se a folha já foi lançada.
  // Compara só o total: no holerite o FGTS fica no rodapé e não é ligado
  // à pessoa de um jeito confiável.
  useEffect(() => {
    let vivo = true;
    setFgtsFolha(null);
    if (!folhaDoMes) return undefined;
    supabase.from("folha_itens").select("valor, rubrica").eq("folha_id", folhaDoMes.id).ilike("rubrica", "%fgts%")
      .then(({ data, error }) => {
        if (!vivo) return;
        if (error) { setFgtsFolha({ erro: error.message }); return; }
        setFgtsFolha({ total: round2((data || []).reduce((t, x) => t + (Number(x.valor) || 0), 0)), qtd: (data || []).length });
      });
    return () => { vivo = false; };
  }, [folhaDoMes?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const fimMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
  const linhas = registrados
    .filter((p) => !p.data_admissao || lerData(p.data_admissao) <= fimMes)
    .map((p) => {
      const comissao = premiacoes.filter((x) => x.pessoa_id === p.id && String(x.dia).slice(0, 7) === k)
        .reduce((s, x) => s + (Number(x.comissao) || 0), 0);
      const sal = Number(p.salario_base) || 0;
      const base = round2(sal + comissao);
      return { pessoa: p, sal, comissao: round2(comissao), base, fgts: round2(base * FGTS) };
    });
  const total = round2(linhas.reduce((t, l) => t + l.fgts, 0));
  const totalBase = round2(linhas.reduce((t, l) => t + l.base, 0));
  const podeVoltar = mes > inicioJanela;
  const podeAvancar = mes < new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  const vence = new Date(mes.getFullYear(), mes.getMonth() + 1, 20);

  if (!verValores) return <div style={cardStyle}><span style={{ fontSize: 13, color: "#8A8778" }}>O FGTS mostra salário — só aparece para quem tem acesso a <b>Salários e dados pessoais</b>.</span></div>;

  return (
    <div>
      <div style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button disabled={!podeVoltar} onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))} style={setaBtn}><ChevronLeft size={16} /></button>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{MESES_LONGOS[mes.getMonth()]} de {mes.getFullYear()}</div>
        <button disabled={!podeAvancar} onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))} style={setaBtn}><ChevronRight size={16} /></button>
      </div>

      <div style={tabela}>
        <Cab colunas="1.5fr 1fr 1fr 1fr" itens={["Pessoa", "Salário", "Comissão", "FGTS 8%"]} />
        {linhas.map((l) => (
          <Lin key={l.pessoa.id} colunas="1.5fr 1fr 1fr 1fr">
            <div><b>{l.pessoa.nome}</b><div style={pequeno}>{PAPEL_LABEL[l.pessoa.papel] || l.pessoa.papel}
              {l.pessoa.data_admissao ? ` · desde ${br(lerData(l.pessoa.data_admissao))}` : ""}</div>
              {!l.sal && <div style={{ ...pequeno, color: COR.alto.txt }}>sem salário cadastrado</div>}</div>
            <div style={dir}>{brl(l.sal)}</div>
            <div style={dir}>{brl(l.comissao)}</div>
            <div style={{ ...dir, fontWeight: 700 }}>{brl(l.fgts)}</div>
          </Lin>
        ))}
        <Lin colunas="1.5fr 1fr 1fr 1fr" fundo="#FBF9F3">
          <div style={{ fontWeight: 700 }}>Total · {linhas.length} pessoa(s)</div>
          <div /><div style={dir}>base {brl(totalBase)}</div>
          <div style={{ ...dir, fontWeight: 700 }}>{brl(total)}</div>
        </Lin>
      </div>

      <div style={{ ...cardStyle, fontSize: 13, marginBottom: 10 }}>
        {!folhaDoMes && <span style={{ color: "#8A8778" }}>A folha de {MESES_LONGOS[mes.getMonth()]} ainda não foi lançada em <b>Folha de pagamento</b> — sem número do contador para comparar.</span>}
        {folhaDoMes && fgtsFolha === null && <span style={{ color: "#8A8778" }}>Buscando o FGTS da folha…</span>}
        {folhaDoMes && fgtsFolha?.erro && <span style={{ color: COR.alto.txt }}>Não consegui ler a folha: {fgtsFolha.erro}</span>}
        {folhaDoMes && fgtsFolha && !fgtsFolha.erro && (fgtsFolha.qtd === 0
          ? <span style={{ color: "#8A8778" }}>A folha do mês foi lançada, mas não tem linha de FGTS.</span>
          : (() => {
              const dif = round2(total - fgtsFolha.total);
              const bate = Math.abs(dif) <= Math.max(5, total * 0.03);
              return <span>Folha do contador: <b>{brl(fgtsFolha.total)}</b> ·{" "}
                <span style={{ ...pill, ...(bate ? COR.baixo : COR.medio) }}>{bate ? "bate com a estimativa" : `diferença de ${brl(dif)}`}</span></span>;
            })())}
      </div>

      <div style={nota}>
        Base = salário + comissão das noites do mês. Guia do FGTS Digital vence em <b>{br(vence)}</b> — confirme o dia com o contador.
        Diferença grande para a folha costuma ser comissão que não chegou ao contador, adicional noturno ou hora extra.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Férias
// ---------------------------------------------------------------------------
function ParteFerias({ linhas, ferias, primeiroDia, verValores, hoje, recarregar, setErro }) {
  const [abertoId, setAbertoId] = useState(null);
  const [form, setForm] = useState({ aquisitivo: "", inicio: "", fim: "" });
  const [admissao, setAdmissao] = useState({});
  const [salvando, setSalvando] = useState(false);

  const salvarAdmissao = async (p) => {
    const valor = admissao[p.id] ?? primeiroDia[p.id];
    if (!valor) return;
    setSalvando(true);
    const { error } = await supabase.from("pessoas").update({ data_admissao: valor }).eq("id", p.id);
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    recarregar();
  };

  const abrir = (l) => {
    const sugestao = l.info?.pendente || l.info?.atual;
    setForm({ aquisitivo: sugestao ? iso(sugestao.ini) : "", inicio: "", fim: "" });
    setAbertoId(abertoId === l.pessoa.id ? null : l.pessoa.id);
  };

  const salvarFerias = async (p) => {
    if (!form.aquisitivo || !form.inicio || !form.fim) { setErro("Preencha o período aquisitivo, o início e o fim das férias."); return; }
    if (form.fim < form.inicio) { setErro("O fim das férias está antes do início."); return; }
    setSalvando(true);
    const { error } = await supabase.from("ferias_concedidas").insert({
      pessoa_id: p.id, aquisitivo_inicio: form.aquisitivo, inicio: form.inicio, fim: form.fim,
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    setAbertoId(null);
    recarregar();
  };

  const apagar = async (f) => {
    if (!window.confirm(`Apagar as férias de ${br(lerData(f.inicio))} a ${br(lerData(f.fim))}?`)) return;
    const { error } = await supabase.from("ferias_concedidas").delete().eq("id", f.id);
    if (error) { setErro(error.message); return; }
    recarregar();
  };

  const provisao = round2(linhas.reduce((t, l) => t + (l.adm ? (Number(l.pessoa.salario_base) || 0) * PROV_FERIAS : 0), 0));

  return (
    <div>
      <div style={{ ...avisoEstimativa, background: "#F6F1E7", borderColor: "#E8E2D2" }}>
        O painel só sabe das férias que forem marcadas aqui. Se alguém já tirou férias antes, use
        <b> “Marcar férias tiradas”</b> — senão a linha aparece como vencida.
      </div>
      <div style={tabela}>
        <Cab colunas="1.3fr 1.5fr .9fr" itens={["Pessoa", "Período aquisitivo", "Situação"]} />
        {linhas.map((l) => {
          const p = l.pessoa;
          if (!l.adm) {
            const sugestao = primeiroDia[p.id];
            return (
              <Lin key={p.id} colunas="1fr">
                <div>
                  <b>{p.nome}</b> <span style={{ ...pill, ...COR.neutro }}>sem data de admissão</span>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                    <input type="date" value={admissao[p.id] ?? sugestao ?? ""} style={inputStyle}
                      onChange={(e) => setAdmissao((a) => ({ ...a, [p.id]: e.target.value }))} />
                    <button onClick={() => salvarAdmissao(p)} disabled={salvando} style={btnSecondary}>Salvar admissão</button>
                    {sugestao && <span style={pequeno}>sugestão: 1º dia na escala, {br(lerData(sugestao))} — confira na carteira</span>}
                  </div>
                </div>
              </Lin>
            );
          }
          const { info, sit } = l;
          const ref = info.pendente || info.atual;
          const cor = sit.nivel === "alto" ? COR.alto : sit.nivel === "medio" ? COR.medio : COR.baixo;
          const daPessoa = ferias.filter((f) => f.pessoa_id === p.id);
          return (
            <div key={p.id}>
              <Lin colunas="1.3fr 1.5fr .9fr">
                <div><b>{p.nome}</b><div style={pequeno}>admissão {br(l.adm)}</div></div>
                <div>
                  {ref ? `${br(ref.ini)} → ${br(ref.fim)}` : "—"}
                  {ref?.tirados > 0 && ref.tirados < 30 && <div style={pequeno}>{ref.tirados} de 30 dias tirados</div>}
                  <div style={barra}><i style={{ display: "block", height: "100%", width: `${Math.round(sit.corrido * 100)}%`, background: cor.txt }} /></div>
                  <div style={pequeno}>{sit.detalhe}</div>
                  {info.vencidos.length > 1 && <div style={{ ...pequeno, color: COR.alto.txt }}>{info.vencidos.length} períodos vencidos</div>}
                </div>
                <div style={dir}><span style={{ ...pill, ...cor }}>{sit.texto}</span>
                  <div><button onClick={() => abrir(l)} style={{ ...linkBtn, fontSize: 11.5, marginTop: 6 }}>Marcar férias tiradas</button></div></div>
              </Lin>
              {abertoId === p.id && (
                <div style={{ padding: "4px 10px 12px", borderTop: "1px solid #F0EBDD", display: "grid", gap: 8 }}>
                  <label style={pequeno}>Período aquisitivo a que se referem</label>
                  <select value={form.aquisitivo} onChange={(e) => setForm((f) => ({ ...f, aquisitivo: e.target.value }))} style={inputStyle}>
                    {info.periodos.map((per) => (
                      <option key={iso(per.ini)} value={iso(per.ini)}>
                        {br(per.ini)} → {br(per.fim)}{per.tirados ? ` · ${per.tirados} dia(s) já tirados` : ""}{per.completo ? "" : " · em andamento"}
                      </option>
                    ))}
                  </select>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <div style={{ flex: 1, minWidth: 140 }}><label style={pequeno}>Primeiro dia</label>
                      <input type="date" value={form.inicio} onChange={(e) => setForm((f) => ({ ...f, inicio: e.target.value }))} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} /></div>
                    <div style={{ flex: 1, minWidth: 140 }}><label style={pequeno}>Último dia</label>
                      <input type="date" value={form.fim} onChange={(e) => setForm((f) => ({ ...f, fim: e.target.value }))} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} /></div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => salvarFerias(p)} disabled={salvando} style={{ ...btnSecondary, display: "flex", gap: 6, alignItems: "center" }}><Check size={14} /> Salvar férias</button>
                    <button onClick={() => setAbertoId(null)} style={linkBtn}>Cancelar</button>
                  </div>
                  {daPessoa.length > 0 && (
                    <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
                      <div style={pequeno}>Já marcadas:</div>
                      {daPessoa.map((f) => (
                        <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                          <span style={{ flex: 1 }}>{br(lerData(f.inicio))} a {br(lerData(f.fim))} · {f.dias} dia(s) · ref. {br(lerData(f.aquisitivo_inicio))}</span>
                          <button onClick={() => apagar(f)} style={ghostBtn} aria-label="Apagar férias"><Trash2 size={14} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {linhas.length === 0 && <Lin colunas="1fr"><span style={pequeno}>Nenhum registrado ativo.</span></Lin>}
      </div>
      <div style={nota}>
        Cada 12 meses trabalhados dão direito a 30 dias. A empresa tem os 12 meses seguintes para conceder;
        passou disso, a lei manda pagar <b>em dobro</b>. A barra mostra quanto do prazo já correu.
        Faltas no período podem reduzir os dias — o contador confere.
        {verValores && <> Provisão estimada de férias + 1/3 por mês: <b>{brl(provisao)}</b>.</>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 13º
// ---------------------------------------------------------------------------
function ParteDecimo({ linhas, verValores, ano, irParaFerias }) {
  const comAdm = linhas.filter((l) => l.adm);
  const sem = linhas.filter((l) => !l.adm);
  const soma = (c) => round2(comAdm.reduce((t, l) => t + (l[c] || 0), 0));
  return (
    <div>
      <div style={tabela}>
        <Cab colunas="1.4fr .7fr 1fr 1fr" itens={["Pessoa", "Avos", "Provisionado", "1ª parcela"]} />
        {comAdm.map((l) => (
          <Lin key={l.pessoa.id} colunas="1.4fr .7fr 1fr 1fr">
            <div><b>{l.pessoa.nome}</b><div style={pequeno}>{verValores ? `salário ${brl(l.sal)}` : `admissão ${br(l.adm)}`}</div></div>
            <div style={dir}>{l.ateAgora}/12<div style={pequeno}>{l.noAno}/12 no ano</div></div>
            <div style={dir}>{verValores ? brl(l.provisionado) : "—"}</div>
            <div style={{ ...dir, fontWeight: 700 }}>{verValores ? brl(l.primeira) : "—"}</div>
          </Lin>
        ))}
        {comAdm.length > 0 && (
          <Lin colunas="1.4fr .7fr 1fr 1fr" fundo="#FBF9F3">
            <div style={{ fontWeight: 700 }}>Total · {comAdm.length} pessoa(s)</div><div />
            <div style={dir}>{verValores ? brl(soma("provisionado")) : "—"}</div>
            <div style={{ ...dir, fontWeight: 700 }}>{verValores ? brl(soma("primeira")) : "—"}</div>
          </Lin>
        )}
        {sem.length > 0 && (
          <Lin colunas="1fr">
            <div style={{ fontSize: 12.5 }}>
              <span style={{ ...pill, ...COR.neutro }}>sem data de admissão</span>{" "}
              {sem.map((l) => l.pessoa.nome).join(", ")} —{" "}
              <button onClick={irParaFerias} style={{ ...linkBtn, fontSize: 12.5 }}>preencher em Férias</button>
            </div>
          </Lin>
        )}
      </div>
      <div style={nota}>
        13º de {ano}: 1/12 do salário por mês com 15 dias ou mais de contrato. 1ª parcela até <b>30/11</b> (metade, sem desconto);
        2ª até <b>20/12</b> (o resto, com INSS e IR). A média da comissão do ano também entra no 13º — esse pedaço o contador fecha.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sem carteira
// ---------------------------------------------------------------------------
function ParteRisco({ linhas, verValores }) {
  const [abertoId, setAbertoId] = useState(null);
  return (
    <div>
      <div style={{ ...cardStyle, fontSize: 12.5, lineHeight: 1.55, marginBottom: 12 }}>
        Quanto mais a pessoa vem toda semana, nas mesmas noites, recebendo e seguindo escala, mais parece emprego — e mais fácil
        a Justiça do Trabalho reconhecer o vínculo e cobrar carteira, FGTS, férias e 13º de todo o período.
        O nível abaixo é um <b>critério do painel</b> para chamar atenção, não uma regra da lei.
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
          <span style={{ ...pill, ...COR.baixo }}>Baixo · até 1 noite/semana, ou poucos meses</span>
          <span style={{ ...pill, ...COR.medio }}>Médio · 2 noites/semana há 2+ meses</span>
          <span style={{ ...pill, ...COR.alto }}>Alto · 3+ noites/semana há 3+ meses</span>
        </div>
      </div>
      <div style={tabela}>
        <Cab colunas="1.3fr .75fr .75fr .8fr .8fr" itens={["Pessoa", "Noites/sem", "Noites/mês", "Há quanto", "Risco"]} />
        {linhas.map((r) => {
          const cor = COR[r.nivel];
          const aberto = abertoId === r.pessoa.id;
          return (
            <div key={r.pessoa.id}>
              <div onClick={() => setAbertoId(aberto ? null : r.pessoa.id)} style={{ cursor: "pointer" }}>
                <Lin colunas="1.3fr .75fr .75fr .8fr .8fr">
                  <div><b>{r.pessoa.nome}</b><div style={pequeno}>{PAPEL_LABEL[r.pessoa.papel] || r.pessoa.papel} · {VINCULO_LABEL[r.pessoa.tipo_contrato]}{r.pessoa.ativo ? "" : " · inativo"}</div></div>
                  <div style={{ ...dir, fontWeight: 700 }}>{r.noitesSemana.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</div>
                  <div style={dir}>{Math.round(r.noitesMes)}</div>
                  <div style={dir}>{r.seguidos ? `${r.seguidos} ${r.seguidos === 1 ? "mês" : "meses"}` : "—"}</div>
                  <div style={dir}><span style={{ ...pill, ...cor }}>{r.nivel === "medio" ? "MÉDIO" : r.nivel.toUpperCase()}</span></div>
                </Lin>
              </div>
              {aberto && (
                <div style={{ padding: "2px 10px 12px" }}>
                  <div style={pequeno}>Últimos 12 meses · noites trabalhadas em cada mês</div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 3, marginTop: 6 }}>
                    {r.meses.map((m, i) => (
                      <div key={i} title={`${m.rotulo}: ${m.n} noite(s)`} style={{
                        height: 30, borderRadius: 4, fontSize: 9.5, textAlign: "center", lineHeight: "14px", paddingTop: 1,
                        background: m.n >= 12 ? "#E5484D" : m.n >= 8 ? "#E0A030" : m.n >= 1 ? "#7FBF95" : "#E8E2D2",
                        color: m.n >= 1 ? "#FFFFFF" : "#8A8778",
                      }}>{m.rotulo}<br />{m.n}</div>
                    ))}
                  </div>
                  {verValores && r.seguidos > 0 && (
                    <div style={{ fontSize: 12, marginTop: 8, lineHeight: 1.55, color: r.nivel === "alto" ? COR.alto.txt : "#22231F" }}>
                      Recebeu em média <b>{brl(r.mediaMensal)}</b> por mês nesses {r.seguidos} meses.
                      Se virasse processo hoje, ordem de grandeza do que seria cobrado: <b>≈ {brl(r.passivo)}</b>
                      {" "}(FGTS + férias + 1/3 + 13º do período, sem multa, sem INSS e sem advogado).
                      Registrar a partir de agora custaria cerca de <b>{brl(r.custoRegistrar)}/mês</b> com essas provisões.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {linhas.length === 0 && <Lin colunas="1fr"><span style={pequeno}>Ninguém sem carteira trabalhou nos últimos 12 meses.</span></Lin>}
      </div>
      <div style={nota}>
        Noites/semana e noites/mês = média dos últimos 90 dias na Escala do dia. “Há quanto” = meses seguidos com
        {` ${NOITES_MES_CONTA}`} noites ou mais. Toque na linha para ver o ano. O valor do processo é ordem de grandeza para
        decidir se registra — quem fecha o número é o contador.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pendências de cadastro
// ---------------------------------------------------------------------------
function ParteCadastro({ linhas, irParaPessoas }) {
  return (
    <div>
      <div style={tabela}>
        <Cab colunas="1.2fr 2fr" itens={["Pessoa", "Falta no cadastro"]} />
        {linhas.map(({ pessoa: p, falta }) => (
          <Lin key={p.id} colunas="1.2fr 2fr">
            <div><b>{p.nome}</b><div style={pequeno}>{PAPEL_LABEL[p.papel] || p.papel} · {VINCULO_LABEL[p.tipo_contrato] || p.tipo_contrato}</div></div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {falta.map((f) => <span key={f} style={{ ...pill, ...(semCarteira(p) ? COR.alto : COR.medio) }}>{f}</span>)}
            </div>
          </Lin>
        ))}
        {linhas.length === 0 && <Lin colunas="1fr"><span style={pequeno}>Todo mundo ativo está com documento, CPF, telefone e endereço.</span></Lin>}
      </div>
      <div style={nota}>
        Quem não tem carteira vem primeiro: se um dia precisar registrar — ou responder a um processo — é o documento,
        o endereço e o telefone dessa pessoa que vão fazer falta.{" "}
        {irParaPessoas && <button onClick={irParaPessoas} style={{ ...linkBtn, fontSize: 11.5 }}>Completar em Pessoas →</button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças pequenas
// ---------------------------------------------------------------------------
function Bloco({ titulo, valor, nota: n, cor, onClick }) {
  return (
    <button onClick={onClick} style={{ ...cardStyle, padding: "10px 12px", textAlign: "left", cursor: "pointer", font: "inherit", color: "inherit" }}>
      <div style={pequeno}>{titulo}</div>
      <div style={{ fontSize: 16, fontWeight: 700, margin: "2px 0" }}>{valor}</div>
      <div style={{ fontSize: 11, color: cor ? cor.txt : "#8A8778" }}>{n}</div>
    </button>
  );
}
function Cab({ colunas, itens }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: colunas, gap: 6, padding: "8px 10px", background: "#F6F1E7", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#8A8778" }}>
      {itens.map((t, i) => <div key={t} style={i ? dir : undefined}>{t}</div>)}
    </div>
  );
}
function Lin({ colunas, children, fundo }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: colunas, gap: 6, alignItems: "center", padding: 10, borderTop: "1px solid #F0EBDD", fontSize: 13, background: fundo }}>
      {children}
    </div>
  );
}

const COR = {
  baixo: { background: "#2F8F5B22", color: "#1F6B42", txt: "#2F8F5B" },
  medio: { background: "#FAC77555", color: "#854F0B", txt: "#B07A12" },
  alto: { background: "#E5484D22", color: "#A32D2D", txt: "#A32D2D" },
  neutro: { background: "#E8E2D2", color: "#5F5E5A", txt: "#5F5E5A" },
};
const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const tabela = { border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF", marginBottom: 12 };
const grade = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 14 };
const avisoEstimativa = { background: "#FFF8E6", border: "1px solid #F2DDA6", borderRadius: 12, padding: "12px 14px", fontSize: 12.5, lineHeight: 1.55, marginBottom: 14, color: "#22231F" };
const avisoErro = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 14 };
const nota = { fontSize: 11.5, color: "#8A8778", lineHeight: 1.55, marginBottom: 8 };
const pequeno = { fontSize: 11, color: "#8A8778" };
const dir = { textAlign: "right" };
const pill = { display: "inline-block", fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999 };
const barra = { height: 7, borderRadius: 99, background: "#F0EBDD", overflow: "hidden", margin: "5px 0 3px" };
const pillBtn = { padding: "6px 12px", borderRadius: 999, border: "1px solid #E8E2D2", background: "#FFFFFF", color: "#8A8778", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const pillBtnAtivo = { background: "#2F8F5B", color: "#FFFFFF", borderColor: "#2F8F5B" };
const setaBtn = { width: 32, height: 32, borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
const inputStyle = { padding: "8px 10px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF", color: "#22231F" };
const btnSecondary = { background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8, padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const linkBtn = { background: "none", border: "none", color: "#8A6A0F", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, textAlign: "left" };
const ghostBtn = { border: "none", background: "none", color: "#8A8778", cursor: "pointer", padding: 2, display: "flex" };
