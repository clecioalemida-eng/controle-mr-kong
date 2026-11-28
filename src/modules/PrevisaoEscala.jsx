// ===== PrevisaoEscala.jsx =====
// Gente e Gestão › Previsão de escala — feita pela gerente, aprovada pelo
// administrador.
//
// A gerente entra pelo link #gente/previsao (com o login dela) e monta a
// escala de hoje até 7 dias à frente. A tela ajuda:
//   - áreas descobertas (cobertura_minima, migração 215), em faixas das
//     16h às 03h, com sugestões que se aplicam com um toque
//   - mais de 8 h de trabalho no dia, intervalo que falta
//   - registrado passando das horas da semana (regras da Jornada)
//   - freela vindo muitas noites (risco de vínculo)
//   - nome escalado sem documentação — sempre, até completar o cadastro
// Depois ela envia para aprovação; o administrador aprova ou devolve com
// comentário. Aprovada, a Escala do dia já abre com essas pessoas e
// horários.
//
// Registrado com horário na Jornada: quem decide é a Jornada (folga e
// horário). Mexer aqui grava lá — um lugar só. Os demais (freela,
// diarista, registrado sem horário) ficam em previsoes_escala, com horário
// e função do dia.
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, AlertTriangle, Send, Check, X, RotateCcw, Settings, Search, UserPlus } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import {
  contaNoite, planoDoDia, casaFechada, diaEspecial, avisosDaSemana,
  iso, lerData, somaDias, segundaDa, horas,
} from "./Jornada";
import DocumentosPessoa, { cpfValido } from "./DocumentosPessoa";

// ---------------------------------------------------------------------------
// Regras — mude aqui
// ---------------------------------------------------------------------------
const DIAS_A_FRENTE = 7;               // de hoje até 7 dias depois
const MAX_DIA = 8 * 60;                // ninguém passa de 8 h de trabalho no dia
const INTERVALO_LONGA = 60;            // mais de 6 h: 1 h de intervalo
const INTERVALO_ACORDO = 30;           // com acordo individual (convenção cl. 34ª)
const INTERVALO_CURTA = 15;            // de 4 h a 6 h
const PICO_INI = 20 * 60, PICO_FIM = 23 * 60;
const NOITES_ATENCAO = 3;              // freela com 3 noites na semana: atenção
const NOITES_RISCO = 4;                // 4 ou mais: risco de vínculo
const EIXO_INI = 16 * 60, EIXO_FIM = 27 * 60;   // 16:00 às 03:00
const PASSO = 15;                      // minutos de cada fatia da conta de cobertura
const HORARIO_PADRAO = { entrada: "18:00", saida: "02:00" };

const PAPEL_LABEL = { garcom: "Garçom", interno: "Equipe interna", caixa: "Caixa", bar: "Bar", chapa: "Chapa", cozinha: "Cozinha", limpeza: "Limpeza", gerente: "Gerente", espeteiro: "Espeteiro" };
const PAPEIS = ["garcom", "caixa", "bar", "chapa", "espeteiro", "cozinha", "limpeza", "gerente"];
const VINCULO = { registrado: "registrado", diarista: "diarista", freela: "freela" };
const DIAS_SEM = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DIAS_LONGO = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

const p2 = (n) => String(n).padStart(2, "0");
const br = (d) => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`;
function hojeData() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function minutos(t) { if (!t) return null; const [h, m] = String(t).split(":").map(Number); return Number.isNaN(h) ? null : h * 60 + (m || 0); }
// Hora da noite: o que é antes do meio-dia é madrugada (+24 h).
function minNoite(t) { const m = minutos(t); return m == null ? null : (m < 12 * 60 ? m + 1440 : m); }
function hhmm(min) { return min == null ? "" : `${p2(Math.floor(min / 60) % 24)}:${p2(Math.round(min % 60))}`; }
// Busca sem acento e sem diferença de maiúscula: "joao" acha "João".
function semAcento(t) { return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase(); }
function primeiroNome(n) { return String(n || "").split(" ")[0]; }
function jornadaAtiva(p) { return p?.tipo_contrato === "registrado" && !!p.jornada_entrada && !!p.jornada_saida; }
// Risco de vínculo só existe para quem não tem carteira.
function semCarteira(p) { return p?.tipo_contrato === "diarista" || p?.tipo_contrato === "freela"; }
function pendenciasDe(p) {
  const f = [];
  if (!p.documento_path) f.push("documento");
  if (!String(p.cpf || "").trim()) f.push("CPF");
  if (!String(p.telefone || "").trim()) f.push("telefone");
  if (!String(p.endereco || "").trim()) f.push("endereço");
  return f;
}

// ---------------------------------------------------------------------------
// Turnos de um dia: quem trabalha, em que função e horário
// ---------------------------------------------------------------------------
function turnosDoDia(dia, pessoas, prev, ajustes, cal) {
  if (casaFechada(dia, cal)) return [];
  const lista = [];
  pessoas.forEach((p) => {
    if (jornadaAtiva(p)) {
      const plano = planoDoDia(p, dia, ajustes, cal);
      if (plano.folga || !plano.conta) return;
      const c = plano.conta;
      lista.push({ p, papel: p.papel, origem: "jornada", e: c.e, s: c.s, i1: c.i1, i2: c.i2, trabalhado: c.trabalhado, intervalo: c.intervalo,
        horario: plano.horario });
      return;
    }
    const r = prev[`${p.id}|${dia}`];
    if (!r) return;
    const c = contaNoite({ entrada: r.entrada, intervaloInicio: r.intervalo_inicio, intervaloFim: r.intervalo_fim, saida: r.saida });
    lista.push(c
      ? { p, papel: r.papel_no_dia || p.papel, origem: "previsao", linha: r, e: c.e, s: c.s, i1: c.i1, i2: c.i2, trabalhado: c.trabalhado, intervalo: c.intervalo }
      : { p, papel: r.papel_no_dia || p.papel, origem: "previsao", linha: r, semHorario: true });
  });
  return lista;
}

function conta(t, regra) {
  const papeis = regra.papeis || [];
  if (!papeis.length) return true;
  if (papeis.includes("responsavel") && (t.papel === "gerente" || t.p.responde_pela_casa)) return true;
  return papeis.includes(t.papel);
}
function trabalhaNa(t, m) { return !t.semHorario && t.e <= m && m < t.s && !(t.i1 != null && t.i1 <= m && m < t.i2); }

// Faixas descobertas de uma regra num dia. `extra` permite testar um
// turno a mais ou trocado (para as sugestões).
export function faixasDaRegra(regra, turnos) {
  const ini = minNoite(regra.inicio);
  let fim = minNoite(regra.fim);
  if (fim <= ini) fim += 1440;
  const fatias = [];
  for (let m = ini; m < fim; m += PASSO) {
    const n = turnos.filter((t) => conta(t, regra) && trabalhaNa(t, m)).length;
    fatias.push({ m, n, nivel: n >= regra.minimo ? "ok" : n === 0 ? "vazio" : "baixo" });
  }
  const faixas = [];
  fatias.forEach((f) => {
    const ult = faixas[faixas.length - 1];
    if (ult && ult.nivel === f.nivel && ult.fim === f.m) { ult.fim = f.m + PASSO; ult.n = Math.min(ult.n, f.n); }
    else faixas.push({ ini: f.m, fim: f.m + PASSO, nivel: f.nivel, n: f.n });
  });
  return faixas;
}
function regrasDoDia(dia, regras, cal) {
  if (casaFechada(dia, cal)) return [];
  const dow = lerData(dia).getDay();
  return regras.filter((r) => r.ativo !== false && (r.dias || []).includes(dow));
}

// Intervalo de 1 h para um turno, fora do pico se der.
function intervaloSugerido(e, s) {
  if (s - e <= 6 * 60) return null;
  const candidatos = [19 * 60, 18 * 60 + 30, 18 * 60, 23 * 60, 23 * 60 + 30, 17 * 60 + 30];
  const ok = candidatos.find((i) => i >= e + 90 && i + 60 <= s - 60);
  if (ok != null) return [ok, ok + 60];
  const meio = Math.round((e + (s - e) / 2) / 30) * 30;
  return [meio, meio + 60];
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------
export default function PrevisaoEscala() {
  const hoje = useMemo(() => hojeData(), []);
  const dias = useMemo(() => Array.from({ length: DIAS_A_FRENTE + 1 }, (_, i) => iso(somaDias(hoje, i))), [hoje]);
  const [diaSel, setDiaSel] = useState(dias[0]);
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [mostrarConfig, setMostrarConfig] = useState(false);
  const [busca, setBusca] = useState("");
  const [mostrarOutros, setMostrarOutros] = useState(false);
  const [novaAberta, setNovaAberta] = useState(false);
  const [completarId, setCompletarId] = useState(null);

  // Da segunda da semana de hoje até o domingo da semana do último dia:
  // é o que precisa para contar noites e horas da semana.
  const de = iso(segundaDa(hoje));
  const ate = iso(somaDias(segundaDa(lerData(dias[dias.length - 1])), 6));

  const carregar = useCallback(async () => {
    setErro("");
    const { data: usuario } = await supabase.auth.getUser();
    const [rp, rprev, rdias, raj, rcal, rcob, rpres, rperfil] = await Promise.all([
      // Todo mundo: os ativos na lista, os outros em "Outras pessoas".
      supabase.from("pessoas").select("*").order("nome"),
      supabase.from("previsoes_escala").select("*").gte("dia", de).lte("dia", ate),
      supabase.from("previsoes_escala_dias").select("*").gte("dia", dias[0]).lte("dia", dias[dias.length - 1]),
      supabase.from("escala_jornada").select("*").gte("dia", de).lte("dia", ate),
      supabase.from("calendario_casa").select("*").gte("dia", de).lte("dia", ate),
      supabase.from("cobertura_minima").select("*").order("ordem"),
      supabase.from("presencas_diarias").select("pessoa_id, dia, papel_no_dia, hora_entrada, hora_saida")
        .gte("dia", iso(somaDias(hoje, -60))).lte("dia", ate),
      usuario?.user ? supabase.from("perfis").select("nome, is_admin").eq("id", usuario.user.id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const falta = [rprev, rcob].find((r) => r.error);
    if (rp.error) setErro(rp.error.message);
    else if (falta) setErro(/cobertura_minima|entrada|papel_no_dia/.test(falta.error.message)
      ? "Falta rodar a migração 215 no Supabase." : falta.error.message);
    setDados({
      pessoas: (rp.data || []).filter((p) => p.ativo).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })),
      inativos: (rp.data || []).filter((p) => !p.ativo).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })),
      prev: Object.fromEntries((rprev.data || []).map((r) => [`${r.pessoa_id}|${r.dia}`, r])),
      status: Object.fromEntries((rdias.data || []).map((r) => [r.dia, r])),
      ajustes: Object.fromEntries((raj.data || []).map((a) => [`${a.pessoa_id}|${a.dia}`, a])),
      cal: Object.fromEntries((rcal.data || []).map((c) => [c.dia, c])),
      regras: rcob.data || [],
      presencas: rpres.data || [],
      eu: { nome: rperfil.data?.nome || "", admin: !!rperfil.data?.is_admin },
    });
  }, [de, ate, dias, hoje]);
  useEffect(() => { carregar(); }, [carregar]);

  if (!dados) return <div style={{ fontSize: 13, color: "#8A8778", display: "flex", gap: 8, alignItems: "center" }}><Loader2 size={15} /> Carregando…</div>;

  const { pessoas, inativos, prev, status, ajustes, cal, regras, presencas, eu } = dados;
  const statusDe = (dia) => status[dia]?.status || "rascunho";
  const podeEditar = (dia) => eu.admin || !["enviada", "aprovada"].includes(statusDe(dia));

  // ----- análise de cada dia -----
  const analise = (dia) => {
    const turnos = turnosDoDia(dia, pessoas, prev, ajustes, cal);
    const rs = regrasDoDia(dia, regras, cal).map((r) => ({ regra: r, faixas: faixasDaRegra(r, turnos) }));
    const descobertas = rs.flatMap(({ regra, faixas }) => faixas.filter((f) => f.nivel !== "ok").map((f) => ({ regra, ...f })));
    const semana = iso(segundaDa(lerData(dia)));
    const diasSemana = [0, 1, 2, 3, 4, 5, 6].map((i) => iso(somaDias(lerData(semana), i)));
    const alertas = [];
    turnos.forEach((t) => {
      const nome = primeiroNome(t.p.nome);
      if (t.semHorario) { alertas.push({ t, nivel: "medio", texto: `${nome}: sem horário` }); return; }
      const minInt = t.p.acordo_intervalo_reduzido ? INTERVALO_ACORDO : INTERVALO_LONGA;
      if (t.trabalhado > MAX_DIA) alertas.push({ t, nivel: "alto", texto: `${nome}: ${horas(t.trabalhado)} de trabalho — passa de 8 h` });
      if (t.trabalhado > 6 * 60 && t.intervalo < minInt) alertas.push({ t, nivel: "alto", texto: `${nome}: ${horas(t.trabalhado)} sem ${minInt === 60 ? "1 h" : "30 min"} de intervalo` });
      else if (t.trabalhado > 4 * 60 && t.trabalhado <= 6 * 60 && t.intervalo < INTERVALO_CURTA) alertas.push({ t, nivel: "medio", texto: `${nome}: sem os 15 min de intervalo` });
      if (jornadaAtiva(t.p)) {
        const r = avisosDaSemana(t.p, diasSemana, ajustes, {}, cal);
        const para = r.total - r.minFeriado - r.minCategoria;
        if (para > r.regime.semanal * 60 + 0.5) alertas.push({ t, nivel: "alto", texto: `${nome}: semana com ${horas(para)} — passa das ${r.regime.semanal} h (ver Jornada)` });
      } else if (semCarteira(t.p)) {
        const noites = diasSemana.filter((d) => prev[`${t.p.id}|${d}`] || presencas.some((x) => x.pessoa_id === t.p.id && x.dia === d)).length;
        if (noites >= NOITES_RISCO) alertas.push({ t, nivel: "alto", texto: `${nome}: ${noites} noites nesta semana — ${VINCULO[t.p.tipo_contrato] || "sem carteira"} vindo sempre vira risco de vínculo` });
        else if (noites >= NOITES_ATENCAO) alertas.push({ t, nivel: "medio", texto: `${nome}: ${noites} noites nesta semana — atenção ao risco de vínculo` });
      }
    });
    // Dois ou mais da mesma área em intervalo juntos no pico.
    return { turnos, rs, descobertas, alertas };
  };

  // Sem documentação: todo mundo escalado em algum dia da janela.
  const escaladosJanela = new Map();
  dias.forEach((d) => turnosDoDia(d, pessoas, prev, ajustes, cal).forEach((t) => escaladosJanela.set(t.p.id, t.p)));
  const semDoc = [...escaladosJanela.values()].map((p) => ({ p, falta: pendenciasDe(p) })).filter((x) => x.falta.length);

  const resumoDias = dias.map((d) => {
    const a = analise(d);
    return { dia: d, fechada: casaFechada(d, cal), vazio: a.turnos.length === 0, problemas: a.descobertas.length + a.alertas.filter((x) => x.nivel === "alto").length };
  });
  const atual = analise(diaSel);
  const esp = diaEspecial(diaSel, cal);

  // ----- gravações -----
  const gravarPrevisao = async (p, dia, campos) => {
    setOcupado(true);
    const { error } = await supabase.from("previsoes_escala").upsert({ pessoa_id: p.id, dia, ...campos }, { onConflict: "pessoa_id,dia" });
    setOcupado(false);
    if (error) { setErro(/papel_no_dia|entrada/.test(error.message) ? "Falta rodar a migração 215 no Supabase." : error.message); return false; }
    await carregar();
    return true;
  };
  // Marcar alguém de "Outras pessoas": volta para a equipe ativa (assim
  // aparece também na Escala do dia) e já entra na previsão do dia.
  const voltarParaEquipe = async (p) => {
    if (!window.confirm(`Voltar ${p.nome} para a equipe ativa e escalar em ${br(lerData(diaSel))}?`)) return;
    setOcupado(true);
    const { error } = await supabase.from("pessoas").update({ ativo: true }).eq("id", p.id);
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    const ultima = presencas.filter((x) => x.pessoa_id === p.id && x.hora_entrada && x.hora_saida).sort((a, b) => (a.dia < b.dia ? 1 : -1))[0];
    await gravarPrevisao(p, diaSel, {
      entrada: ultima ? String(ultima.hora_entrada).slice(0, 5) : HORARIO_PADRAO.entrada,
      saida: ultima ? String(ultima.hora_saida).slice(0, 5) : HORARIO_PADRAO.saida,
    });
  };
  const tirarPrevisao = async (p, dia) => {
    setOcupado(true);
    const { error } = await supabase.from("previsoes_escala").delete().eq("pessoa_id", p.id).eq("dia", dia);
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    carregar();
  };
  // Registrado da Jornada: folga ou horário do dia vão para escala_jornada.
  const gravarJornada = async (p, dia, campos) => {
    setOcupado(true);
    const atualLinha = ajustes[`${p.id}|${dia}`] || {};
    const linha = { ...atualLinha, pessoa_id: p.id, dia, atualizado_em: new Date().toISOString(), ...campos };
    delete linha.id;
    const vazio = !linha.folga && !linha.entrada && !linha.saida && !linha.intervalo_inicio && !linha.intervalo_fim;
    const { error } = vazio
      ? await supabase.from("escala_jornada").delete().eq("pessoa_id", p.id).eq("dia", dia)
      : await supabase.from("escala_jornada").upsert(linha, { onConflict: "pessoa_id,dia" });
    setOcupado(false);
    if (error) { setErro(error.message); return false; }
    await carregar();
    return true;
  };
  const mudarHorario = (t, dia, h) => (t.origem === "jornada"
    ? gravarJornada(t.p, dia, { folga: false, entrada: h.entrada, intervalo_inicio: h.intervalo_inicio || null, intervalo_fim: h.intervalo_fim || null, saida: h.saida })
    : gravarPrevisao(t.p, dia, { entrada: h.entrada, intervalo_inicio: h.intervalo_inicio || null, intervalo_fim: h.intervalo_fim || null, saida: h.saida }));

  // ----- sugestões para as faixas descobertas -----
  const sugestoes = [];
  if (podeEditar(diaSel)) {
    const semana = iso(segundaDa(lerData(diaSel)));
    const diasSemana = [0, 1, 2, 3, 4, 5, 6].map((i) => iso(somaDias(lerData(semana), i)));
    const noitesDe = (p) => diasSemana.filter((d) => prev[`${p.id}|${d}`] || presencas.some((x) => x.pessoa_id === p.id && x.dia === d)).length;
    const experiencia = (p, papeis) => presencas.filter((x) => x.pessoa_id === p.id && papeis.includes(x.papel_no_dia || p.papel)).length;
    const jaSugeridos = new Set();
    atual.descobertas.slice(0, 6).forEach((f) => {
      const papeis = f.regra.papeis || [];
      const papelAlvo = papeis.find((x) => x !== "responsavel") || null;
      // a) Mudar um intervalo que cai na faixa.
      const noIntervalo = atual.turnos.find((t) => conta(t, f.regra) && t.i1 != null && t.i1 < f.fim && t.i2 > f.ini);
      if (noIntervalo) {
        const dur = noIntervalo.i2 - noIntervalo.i1;
        const opcoes = [-60, -90, -120, -30, 60, 90, 120].map((d) => noIntervalo.i1 + d)
          .filter((i) => i >= noIntervalo.e + 60 && i + dur <= noIntervalo.s - 60);
        const boa = opcoes.find((i) => {
          const trocado = atual.turnos.map((t) => (t === noIntervalo ? { ...t, i1: i, i2: i + dur } : t));
          return faixasDaRegra(f.regra, trocado).every((x) => x.nivel === "ok" || x.fim <= f.ini || x.ini >= f.fim);
        });
        if (boa != null) {
          sugestoes.push({
            chave: `int-${noIntervalo.p.id}-${f.ini}`,
            texto: `${primeiroNome(noIntervalo.p.nome)} fazer o intervalo das ${hhmm(boa)} às ${hhmm(boa + dur)} — cobre ${f.regra.area.toLowerCase()} das ${hhmm(f.ini)} às ${hhmm(f.fim)}.`,
            aplicar: () => mudarHorario(noIntervalo, diaSel, { entrada: hhmm(noIntervalo.e), saida: hhmm(noIntervalo.s), intervalo_inicio: hhmm(boa), intervalo_fim: hhmm(boa + dur) }),
          });
          return;
        }
      }
      // b) Antecipar quem já está escalado nessa função e entra depois.
      const depois = atual.turnos.find((t) => !t.semHorario && conta(t, f.regra) && t.e > f.ini && t.e <= f.fim + 60 && t.origem === "previsao");
      if (depois && !jaSugeridos.has(depois.p.id)) {
        const e = f.ini;
        const s = Math.min(depois.s, e + MAX_DIA + 60);
        const int = intervaloSugerido(e, s);
        const trab = s - e - (int ? 60 : 0);
        jaSugeridos.add(depois.p.id);
        sugestoes.push({
          chave: `ant-${depois.p.id}-${f.ini}`,
          texto: `${primeiroNome(depois.p.nome)} entrar às ${hhmm(e)} e sair às ${hhmm(s)}${int ? `, intervalo das ${hhmm(int[0])} às ${hhmm(int[1])}` : ""} — ${horas(trab)}.${s < depois.s ? ` Depois das ${hhmm(s)}, confira quem cobre.` : ""}`,
          aplicar: () => gravarPrevisao(depois.p, diaSel, { entrada: hhmm(e), saida: hhmm(s), intervalo_inicio: int ? hhmm(int[0]) : null, intervalo_fim: int ? hhmm(int[1]) : null }),
        });
        return;
      }
      // c) Chamar alguém de fora da escala do dia.
      if (!papelAlvo) return;
      const escalados = new Set(atual.turnos.map((t) => t.p.id));
      const candidatos = pessoas
        .filter((p) => !escalados.has(p.id) && !jornadaAtiva(p) && !jaSugeridos.has(p.id))
        .map((p) => ({ p, noites: noitesDe(p), exp: experiencia(p, papeis), mesmo: papeis.includes(p.papel) }))
        .filter((c) => c.mesmo || c.exp > 0)
        .sort((a, b) => (a.noites >= NOITES_RISCO) - (b.noites >= NOITES_RISCO) || a.noites - b.noites || b.exp - a.exp);
      const c = candidatos[0];
      if (!c) return;
      jaSugeridos.add(c.p.id);
      const e = f.ini;
      const fimRegra = (() => { let x = minNoite(f.regra.fim); const i = minNoite(f.regra.inicio); return x <= i ? x + 1440 : x; })();
      const s = Math.min(fimRegra, e + MAX_DIA + 60, Math.max(f.fim, e + 4 * 60));
      const int = intervaloSugerido(e, s);
      const trab = s - e - (int ? 60 : 0);
      sugestoes.push({
        chave: `cha-${c.p.id}-${f.ini}`,
        risco: semCarteira(c.p) && c.noites >= NOITES_ATENCAO,
        texto: `${primeiroNome(c.p.nome)} (${PAPEL_LABEL[c.p.papel] || c.p.papel}${c.mesmo ? "" : `, fez ${PAPEL_LABEL[papelAlvo]?.toLowerCase()} ${c.exp}x`}, ${VINCULO[c.p.tipo_contrato] || ""}, ${c.noites} noite(s) nesta semana) das ${hhmm(e)} às ${hhmm(s)}${int ? `, intervalo das ${hhmm(int[0])} às ${hhmm(int[1])}` : ""} — ${horas(trab)} como ${PAPEL_LABEL[papelAlvo]?.toLowerCase()}.`,
        aplicar: () => gravarPrevisao(c.p, diaSel, { entrada: hhmm(e), saida: hhmm(s), intervalo_inicio: int ? hhmm(int[0]) : null, intervalo_fim: int ? hhmm(int[1]) : null, papel_no_dia: c.p.papel === papelAlvo ? null : papelAlvo }),
      });
    });
  }

  // ----- envio e aprovação -----
  const diasAbertos = dias.filter((d) => !casaFechada(d, cal));
  const enviadas = dias.filter((d) => statusDe(d) === "enviada");
  const devolvidas = dias.filter((d) => statusDe(d) === "devolvida");
  const paraEnviar = diasAbertos.filter((d) => ["rascunho", "devolvida"].includes(statusDe(d)));
  const totalAlertas = dias.reduce((t, d) => { const a = analise(d); return t + a.descobertas.length + a.alertas.filter((x) => x.nivel === "alto").length; }, 0);

  const enviar = async () => {
    if (!paraEnviar.length) return;
    const comentario = window.prompt(`Enviar a previsão de ${br(lerData(paraEnviar[0]))} a ${br(lerData(paraEnviar[paraEnviar.length - 1]))} para aprovação?${totalAlertas ? `\n\nAinda há ${totalAlertas} alerta(s). Se quiser, explique:` : "\n\nComentário (opcional):"}`, "");
    if (comentario === null) return;
    setOcupado(true);
    const agora = new Date().toISOString();
    const { error } = await supabase.from("previsoes_escala_dias").upsert(paraEnviar.map((dia) => ({
      dia, status: "enviada", fechada: false, enviado_por: eu.nome || "gerente", enviado_em: agora,
      comentario_gerente: comentario.trim() || null, atualizado_em: agora,
    })), { onConflict: "dia" });
    setOcupado(false);
    if (error) { setErro(/status|enviado/.test(error.message) ? "Falta rodar a migração 215 no Supabase." : error.message); return; }
    carregar();
  };
  const decidir = async (aprovar) => {
    let comentario = null;
    if (!aprovar) {
      comentario = window.prompt("O que precisa mudar? (vai para a gerente)", "");
      if (comentario === null) return;
    }
    setOcupado(true);
    const agora = new Date().toISOString();
    const { error } = await supabase.from("previsoes_escala_dias").upsert(enviadas.map((dia) => ({
      dia, status: aprovar ? "aprovada" : "devolvida", fechada: aprovar,
      aprovado_por: eu.nome || "administrador", aprovado_em: agora, comentario_aprovacao: comentario, atualizado_em: agora,
    })), { onConflict: "dia" });
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    carregar();
  };
  const reabrir = async (dia) => {
    const { error } = await supabase.from("previsoes_escala_dias").upsert({ dia, status: "rascunho", fechada: false, atualizado_em: new Date().toISOString() }, { onConflict: "dia" });
    if (error) { setErro(error.message); return; }
    carregar();
  };

  const st = statusDe(diaSel);
  const editavel = podeEditar(diaSel);
  const pendentesAprovacao = enviadas.length > 0 ? status[enviadas[0]] : null;

  return (
    <div>
      {erro && <div style={avisoErro}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div>{erro}</div></div>}

      {/* Aprovação — só para o administrador */}
      {eu.admin && pendentesAprovacao && (
        <div style={{ ...card, border: "2px solid #22231F", marginBottom: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>
            Previsão de {br(lerData(enviadas[0]))} a {br(lerData(enviadas[enviadas.length - 1]))} — enviada por {pendentesAprovacao.enviado_por || "—"}
            {pendentesAprovacao.enviado_em ? ` em ${new Date(pendentesAprovacao.enviado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}
          </div>
          <div style={{ fontSize: 12.5, marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {totalAlertas > 0 ? <span style={{ ...pill, ...COR.alto }}>{totalAlertas} alerta(s) em aberto</span> : <span style={{ ...pill, ...COR.ok }}>sem alertas</span>}
            {semDoc.length > 0 && <span style={{ ...pill, ...COR.alto }}>{semDoc.length} sem documentação: {semDoc.map((x) => primeiroNome(x.p.nome)).join(", ")}</span>}
          </div>
          {pendentesAprovacao.comentario_gerente && <div style={{ ...pequeno, marginTop: 6 }}>Comentário: “{pendentesAprovacao.comentario_gerente}”</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button disabled={ocupado} onClick={() => decidir(true)} style={btnPrimario}><Check size={14} /> Aprovar</button>
            <button disabled={ocupado} onClick={() => decidir(false)} style={btn}><X size={14} /> Devolver com comentário</button>
          </div>
        </div>
      )}

      {/* Situação da semana */}
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        <div>
          <b>{br(lerData(dias[0]))} a {br(lerData(dias[dias.length - 1]))}</b>{" "}
          {enviadas.length > 0 && <span style={{ ...pill, ...COR.az }}>aguardando aprovação</span>}
          {enviadas.length === 0 && devolvidas.length > 0 && <span style={{ ...pill, ...COR.alto }}>devolvida</span>}
          {enviadas.length === 0 && devolvidas.length === 0 && paraEnviar.length > 0 && <span style={{ ...pill, ...COR.medio }}>rascunho</span>}
          {paraEnviar.length === 0 && enviadas.length === 0 && <span style={{ ...pill, ...COR.ok }}>aprovada</span>}
          <div style={pequeno}>{totalAlertas} alerta(s){semDoc.length ? ` · ${semDoc.length} sem documentação` : ""}</div>
          {devolvidas.length > 0 && status[devolvidas[0]]?.comentario_aprovacao && (
            <div style={{ fontSize: 12, color: COR.alto.color, marginTop: 4 }}>Devolvida: “{status[devolvidas[0]].comentario_aprovacao}”</div>
          )}
        </div>
        {paraEnviar.length > 0 && (
          <button disabled={ocupado} onClick={enviar} style={btnPrimario}><Send size={14} /> Enviar para aprovação</button>
        )}
      </div>

      {/* Dias */}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", marginBottom: 12, paddingBottom: 2 }}>
        {resumoDias.map((r) => {
          const d = lerData(r.dia);
          const on = r.dia === diaSel;
          return (
            <button key={r.dia} onClick={() => setDiaSel(r.dia)} style={{
              border: `1px solid ${on ? "#22231F" : "#E8E2D2"}`, background: on ? "#22231F" : "#FFFFFF", color: on ? "#F3EFE3" : "#22231F",
              borderRadius: 10, padding: "6px 10px", fontSize: 12, minWidth: 62, cursor: "pointer", font: "inherit", textAlign: "center",
            }}>
              <div>{DIAS_SEM[d.getDay()]} {p2(d.getDate())}</div>
              <div style={{ fontSize: 10, marginTop: 2, color: on ? "#F3EFE3" : r.fechada ? "#8A8778" : r.vazio ? "#8A8778" : r.problemas ? "#A32D2D" : "#1F6B42" }}>
                {r.fechada ? "fechada" : r.vazio ? "vazio" : r.problemas ? `● ${r.problemas}` : "✓"}
              </div>
            </button>
          );
        })}
      </div>

      {casaFechada(diaSel, cal) ? (
        <div style={card}><span style={pequeno}>Casa fechada em {DIAS_LONGO[lerData(diaSel).getDay()]} {br(lerData(diaSel))}. Para abrir, use Jornada › Calendário da casa.</span></div>
      ) : (
        <>
          {esp && <div style={{ ...card, borderColor: "#A32D2D", color: "#A32D2D", fontSize: 12.5, marginBottom: 10 }}><b>{esp.nome}</b> — {esp.tipo === "dia_categoria" ? "dia da categoria: quem trabalhar recebe em dobro" : "feriado: quem trabalhar recebe as horas com +100%"}.</div>}
          {!editavel && <div style={{ ...card, fontSize: 12.5, marginBottom: 10 }}>{st === "enviada" ? "Enviada para aprovação — aguarde, ou peça ao administrador para devolver." : "Aprovada."}{eu.admin && <> <button onClick={() => reabrir(diaSel)} style={linkBtn}><RotateCcw size={12} /> Reabrir</button></>}</div>}

          {/* Faixas de cobertura */}
          <div style={titulo}>{DIAS_LONGO[lerData(diaSel).getDay()]} {br(lerData(diaSel))} · áreas da casa</div>
          <div style={card}>
            <div style={{ display: "grid", gridTemplateColumns: "104px 1fr", fontSize: 9.5, color: "#8A8778", marginBottom: 4 }}>
              <div />
              <div style={{ display: "flex", justifyContent: "space-between" }}>{["16h", "18h", "20h", "22h", "00h", "02h"].map((h) => <span key={h}>{h}</span>)}</div>
            </div>
            {atual.rs.map(({ regra, faixas }) => (
              <div key={regra.id} style={{ display: "grid", gridTemplateColumns: "104px 1fr", gap: 6, alignItems: "center", fontSize: 12, marginBottom: 5 }}>
                <div>{regra.area}{regra.minimo > 1 ? ` · ${regra.minimo}+` : ""}</div>
                <div style={{ position: "relative", height: 18, background: "#F0EBDD", borderRadius: 5, overflow: "hidden" }}>
                  {faixas.map((f, i) => (
                    <i key={i} title={`${hhmm(f.ini)}–${hhmm(f.fim)} · ${f.n} pessoa(s)`} style={{
                      position: "absolute", top: 0, bottom: 0,
                      left: `${Math.max(0, (f.ini - EIXO_INI) / (EIXO_FIM - EIXO_INI) * 100)}%`,
                      width: `${Math.max(0, (Math.min(f.fim, EIXO_FIM) - Math.max(f.ini, EIXO_INI)) / (EIXO_FIM - EIXO_INI) * 100)}%`,
                      background: f.nivel === "ok" ? "#2F8F5B99" : f.nivel === "vazio" ? "#E5484D99" : "#FAC775",
                    }} />
                  ))}
                </div>
              </div>
            ))}
            {atual.rs.length === 0 && <div style={pequeno}>Nenhuma área configurada para este dia{dados.regras.length ? "" : " — rode a migração 215"}.</div>}
            <div style={{ ...pequeno, marginTop: 6 }}>Verde = coberto · vermelho = ninguém · amarelo = abaixo do mínimo. Quem está em intervalo não conta.</div>
          </div>

          {/* Ajuda */}
          <div style={titulo}>Ajuda da tela</div>
          <div style={card}>
            {semDoc.length > 0 && (
              <div style={{ ...caixaAlerta, borderColor: "#A32D2D", background: "#E5484D14" }}>
                <b>Sem documentação:</b> {semDoc.map((x) => `${primeiroNome(x.p.nome)} (falta ${x.falta.join(", ")})`).join("; ")} — {semDoc.length === 1 ? "está" : "estão"} na escala destes dias.
                Peça os documentos; anexando a foto em Pessoas, a IA já preenche o cadastro.
              </div>
            )}
            {atual.descobertas.map((f, i) => (
              <div key={`d${i}`} style={caixaAlerta}><b>{f.nivel === "vazio" ? "Descoberto" : "Abaixo do mínimo"}:</b> {f.regra.area.toLowerCase()} das {hhmm(f.ini)} às {hhmm(f.fim)}{f.nivel === "baixo" ? ` (${f.n} de ${f.regra.minimo})` : ""}.</div>
            ))}
            {sugestoes.map((s) => (
              <div key={s.chave} style={{ ...caixaSugestao, ...(s.risco ? { borderColor: "#B07A12", background: "#FAC77522" } : {}) }}>
                <b>Sugestão:</b> {s.texto}{s.risco ? " Atenção: já vem muitas noites — risco de vínculo." : ""}{" "}
                <button disabled={ocupado} onClick={s.aplicar} style={{ ...btn, padding: "3px 9px", fontSize: 11.5 }}>Usar</button>
              </div>
            ))}
            {atual.alertas.map((a, i) => (
              <div key={`a${i}`} style={{ ...caixaAlerta, ...(a.nivel === "medio" ? { borderColor: "#B07A12", background: "#FAC77522" } : {}) }}>{a.texto}</div>
            ))}
            {!semDoc.length && !atual.descobertas.length && !atual.alertas.length && <div style={{ fontSize: 12.5, color: COR.ok.color }}>Dia coberto e dentro das regras.</div>}
          </div>

          {/* Quem trabalha */}
          <div style={titulo}>Quem trabalha</div>
          <div style={card}>
            <div style={{ position: "relative", marginBottom: 6 }}>
              <Search size={14} color="#8A8778" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar nome (inclui quem não vem há tempo)…"
                style={{ ...inp, width: "100%", boxSizing: "border-box", paddingLeft: 30 }} />
            </div>
            {pessoas.filter((p) => !busca || semAcento(p.nome).includes(semAcento(busca))).map((p) => (
              <div key={p.id}>
                <LinhaPessoa p={p} dia={diaSel} turno={atual.turnos.find((t) => t.p.id === p.id)}
                  ajustes={ajustes} cal={cal} prev={prev} presencas={presencas} editavel={editavel && !ocupado}
                  semDoc={pendenciasDe(p).length > 0} onCompletar={() => setCompletarId(completarId === p.id ? null : p.id)}
                  gravarPrevisao={gravarPrevisao} tirarPrevisao={tirarPrevisao} gravarJornada={gravarJornada} mudarHorario={mudarHorario} />
                {completarId === p.id && <CompletarCadastro p={p} aoMudar={carregar} setErro={setErro} fechar={() => setCompletarId(null)} />}
              </div>
            ))}

            {/* Outras pessoas: quem está fora da equipe ativa */}
            {inativos.length > 0 && (() => {
              const lista = inativos.filter((p) => !busca || semAcento(p.nome).includes(semAcento(busca)));
              const aberto = mostrarOutros || !!busca;
              return (
                <div style={{ marginTop: 10, borderTop: "2px solid #E8E2D2" }}>
                  <button onClick={() => setMostrarOutros((x) => !x)} style={{ ...linkBtn, width: "100%", justifyContent: "space-between", padding: "8px 0", color: "#8A8778" }}>
                    <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4 }}>Outras pessoas · {inativos.length} fora da lista</span>
                    <span style={{ fontSize: 11 }}>{aberto ? "▴" : "tocar para abrir ▾"}</span>
                  </button>
                  {aberto && lista.map((p) => {
                    const ultima = presencas.filter((x) => x.pessoa_id === p.id).map((x) => x.dia).sort().pop();
                    return (
                      <div key={p.id} style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: 6, padding: "8px 0", borderTop: "1px solid #F0EBDD", fontSize: 12.5 }}>
                        <input type="checkbox" checked={false} disabled={!editavel || ocupado} onChange={() => voltarParaEquipe(p)} style={{ marginTop: 3 }} />
                        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                          <b>{p.nome}</b>
                          <span style={{ ...pill, background: "#E8E2D2", color: "#5F5E5A", fontSize: 9.5 }}>inativo</span>
                          {pendenciasDe(p).length > 0 && <span style={{ ...pill, ...COR.alto, fontSize: 9.5 }}>sem documento</span>}
                          <span style={pequeno}>{PAPEL_LABEL[p.papel] || p.papel} · {VINCULO[p.tipo_contrato] || p.tipo_contrato} · {ultima ? `última noite ${br(lerData(ultima))}` : "sem noite nos últimos 2 meses"}</span>
                        </div>
                      </div>
                    );
                  })}
                  {aberto && lista.length === 0 && <div style={{ ...pequeno, padding: "6px 0" }}>Ninguém com esse nome fora da lista.</div>}
                </div>
              );
            })()}

            {editavel && (
              <div style={{ marginTop: 12 }}>
                {!novaAberta
                  ? <button onClick={() => setNovaAberta(true)} style={btn}><UserPlus size={14} /> Incluir pessoa nova</button>
                  : <NovaPessoa dia={diaSel} buscaInicial={busca} gravarPrevisao={gravarPrevisao} aoMudar={carregar} setErro={setErro} fechar={() => setNovaAberta(false)} />}
              </div>
            )}
            <div style={{ ...pequeno, marginTop: 8 }}>Registrado com horário na Jornada: folga e horário vêm de lá (e mudar aqui grava lá). Os demais: marque, ponha o horário e a função do dia. Horas sem o intervalo.</div>
          </div>
        </>
      )}

      {eu.admin && (
        <div style={{ marginTop: 16 }}>
          <button onClick={() => setMostrarConfig((x) => !x)} style={{ ...linkBtn, display: "inline-flex", gap: 5, alignItems: "center" }}><Settings size={13} /> {mostrarConfig ? "Esconder" : "Cobertura mínima e quem responde pela casa"}</button>
          {mostrarConfig && <ConfigCobertura regras={regras} pessoas={pessoas} aoMudar={carregar} setErro={setErro} />}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Uma pessoa no dia
// ---------------------------------------------------------------------------
function LinhaPessoa({ p, dia, turno, ajustes, cal, prev, presencas, editavel, semDoc, onCompletar, gravarPrevisao, tirarPrevisao, gravarJornada, mudarHorario }) {
  const daJornada = jornadaAtiva(p);
  const plano = daJornada ? planoDoDia(p, dia, ajustes, cal) : null;
  const linha = prev[`${p.id}|${dia}`];
  const marcado = !!turno;
  const [h, setH] = useState(null);
  useEffect(() => {
    if (!turno || turno.semHorario) { setH(linha ? { entrada: hhmm(minutos(linha.entrada)), intervalo_inicio: "", intervalo_fim: "", saida: hhmm(minutos(linha.saida)) } : null); return; }
    setH({ entrada: hhmm(turno.e), intervalo_inicio: turno.i1 != null ? hhmm(turno.i1) : "", intervalo_fim: turno.i2 != null ? hhmm(turno.i2) : "", saida: hhmm(turno.s) });
  }, [turno, linha]);

  const marcar = async () => {
    if (daJornada) { await gravarJornada(p, dia, { folga: !plano.folga ? true : false }); return; }
    if (marcado) { await tirarPrevisao(p, dia); return; }
    // Horário inicial: o da última noite que a pessoa trabalhou, ou o padrão.
    const ultima = presencas.filter((x) => x.pessoa_id === p.id && x.hora_entrada && x.hora_saida).sort((a, b) => (a.dia < b.dia ? 1 : -1))[0];
    await gravarPrevisao(p, dia, {
      entrada: ultima ? String(ultima.hora_entrada).slice(0, 5) : HORARIO_PADRAO.entrada,
      saida: ultima ? String(ultima.hora_saida).slice(0, 5) : HORARIO_PADRAO.saida,
    });
  };
  const salvarHorario = () => { if (h && turno) mudarHorario(turno, dia, h); else if (h) gravarPrevisao(p, dia, h); };
  const mudarPapel = (papel) => gravarPrevisao(p, dia, { papel_no_dia: papel || null });

  const corHoras = turno && !turno.semHorario
    ? (turno.trabalhado > MAX_DIA || (turno.trabalhado > 6 * 60 && turno.intervalo < (p.acordo_intervalo_reduzido ? INTERVALO_ACORDO : INTERVALO_LONGA)) ? "#A32D2D" : "#1F6B42")
    : "#8A8778";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: 6, padding: "8px 0", borderTop: "1px solid #F0EBDD", fontSize: 12.5 }}>
      <input type="checkbox" checked={marcado} disabled={!editavel} onChange={marcar} style={{ marginTop: 3 }} />
      <div>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <b>{p.nome}</b>
          {semDoc && <span style={{ ...pill, ...COR.alto, fontSize: 9.5 }}>sem documento</span>}
          {semDoc && onCompletar && <button onClick={onCompletar} style={{ ...btn, padding: "2px 8px", fontSize: 11 }}>Completar cadastro</button>}
          {daJornada && plano?.folga && !plano.fechado && <span style={{ ...pill, background: "#E8E2D2", color: "#5F5E5A", fontSize: 9.5 }}>folga na Jornada</span>}
          <span style={pequeno}>{PAPEL_LABEL[turno?.papel || p.papel] || p.papel} · {VINCULO[p.tipo_contrato] || p.tipo_contrato}{daJornada ? " · horário da Jornada" : ""}</span>
          {turno && !turno.semHorario && <span style={{ marginLeft: "auto", fontWeight: 700, color: corHoras }}>{horas(turno.trabalhado)}</span>}
        </div>
        {marcado && h && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end", marginTop: 6 }}>
            <Hora rot="Entrada" v={h.entrada} on={(v) => setH({ ...h, entrada: v })} dis={!editavel} />
            <Hora rot="Intervalo de" v={h.intervalo_inicio} on={(v) => setH({ ...h, intervalo_inicio: v })} dis={!editavel} />
            <Hora rot="até" v={h.intervalo_fim} on={(v) => setH({ ...h, intervalo_fim: v })} dis={!editavel} />
            <Hora rot="Saída" v={h.saida} on={(v) => setH({ ...h, saida: v })} dis={!editavel} />
            {!daJornada && (
              <div>
                <div style={pequeno}>Função hoje</div>
                <select disabled={!editavel} value={linha?.papel_no_dia || ""} onChange={(e) => mudarPapel(e.target.value)} style={{ ...inp, padding: "5px 6px" }}>
                  <option value="">{PAPEL_LABEL[p.papel] || p.papel} (cadastro)</option>
                  {PAPEIS.filter((x) => x !== p.papel).map((x) => <option key={x} value={x}>{PAPEL_LABEL[x]}</option>)}
                </select>
              </div>
            )}
            {editavel && <button onClick={salvarHorario} style={{ ...btn, padding: "5px 10px", fontSize: 12 }}>Salvar horário</button>}
          </div>
        )}
      </div>
    </div>
  );
}
// ---------------------------------------------------------------------------
// Completar cadastro (telefone, CPF, endereço, documento) — ali mesmo
// ---------------------------------------------------------------------------
function CompletarCadastro({ p, aoMudar, setErro, fechar }) {
  const [f, setF] = useState({ telefone: p.telefone || "", cpf: p.cpf || "", endereco: p.endereco || "" });
  const [salvo, setSalvo] = useState(false);
  const salvar = async () => {
    const { error } = await supabase.from("pessoas").update({
      telefone: f.telefone.trim() || null, cpf: f.cpf.trim() || null, endereco: f.endereco.trim() || null,
    }).eq("id", p.id);
    if (error) { setErro(/endereco/.test(error.message) ? "Falta rodar a migração 199 no Supabase." : error.message); return; }
    setSalvo(true);
    aoMudar();
  };
  return (
    <div style={{ margin: "0 0 10px 30px", padding: 10, background: "#FBF9F3", border: "1px solid #E8E2D2", borderRadius: 10, display: "grid", gap: 8 }}>
      <div style={{ fontSize: 12.5 }}><b>Completar o cadastro de {primeiroNome(p.nome)}</b> <span style={pequeno}>· falta {pendenciasDe(p).join(", ")}</span></div>
      <CamposContato f={f} setF={setF} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={salvar} style={btn}><Check size={13} /> Salvar dados</button>
        <button onClick={fechar} style={linkBtn}>Fechar</button>
        {salvo && <span style={{ ...pequeno, color: COR.ok.color }}>salvo</span>}
      </div>
      <DocumentosPessoa pessoa={p} aoAtualizar={aoMudar} />
    </div>
  );
}
function CamposContato({ f, setF }) {
  const cpfRuim = f.cpf && f.cpf.replace(/\D/g, "").length === 11 && !cpfValido(f.cpf);
  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input value={f.telefone} onChange={(e) => setF({ ...f, telefone: e.target.value })} placeholder="Telefone" style={{ ...inp, flex: 1, minWidth: 130 }} />
        <input value={f.cpf} onChange={(e) => setF({ ...f, cpf: e.target.value })} placeholder="CPF" style={{ ...inp, flex: 1, minWidth: 130 }} />
      </div>
      {cpfRuim && <div style={{ fontSize: 11, color: COR.alto.color }}>Esse CPF não fecha nos dígitos — confira.</div>}
      <input value={f.endereco} onChange={(e) => setF({ ...f, endereco: e.target.value })} placeholder="Endereço (rua, número, bairro, cidade)" style={inp} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Incluir pessoa nova (diarista ou freela) e já escalar no dia
// ---------------------------------------------------------------------------
function NovaPessoa({ dia, buscaInicial, gravarPrevisao, aoMudar, setErro, fechar }) {
  const [f, setF] = useState({ nome: buscaInicial || "", papel: "garcom", tipo_contrato: "freela", telefone: "", cpf: "", endereco: "" });
  const [criada, setCriada] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    if (f.nome.trim().split(/\s+/).length < 2) { setErro("Escreva o nome completo (nome e sobrenome)."); return; }
    setSalvando(true);
    const { data, error } = await supabase.from("pessoas").insert({
      nome: f.nome.trim(), papel: f.papel, tipo_contrato: f.tipo_contrato, ativo: true,
      telefone: f.telefone.trim() || null, cpf: f.cpf.trim() || null, endereco: f.endereco.trim() || null,
    }).select().single();
    if (error) {
      setSalvando(false);
      setErro(/espeteiro|papel_check/.test(error.message) ? "A função espeteiro ainda não existe no banco — rode a migração 215."
        : /freela|tipo_contrato/.test(error.message) ? "O vínculo freela ainda não existe no banco — rode a migração 198."
        : error.message);
      return;
    }
    await gravarPrevisao(data, dia, { entrada: HORARIO_PADRAO.entrada, saida: HORARIO_PADRAO.saida });
    setSalvando(false);
    setCriada(data);
  };
  if (criada) {
    return (
      <div style={{ padding: 10, background: "#FBF9F3", border: "1px solid #E8E2D2", borderRadius: 10, display: "grid", gap: 8 }}>
        <div style={{ fontSize: 12.5 }}><b>{criada.nome}</b> incluído(a) e escalado(a) em {br(lerData(dia))}, das {HORARIO_PADRAO.entrada} às {HORARIO_PADRAO.saida} — ajuste o horário na lista.
          Agora anexe a foto do documento: a IA lê e preenche o que faltar.</div>
        <DocumentosPessoa pessoa={criada} aoAtualizar={aoMudar} />
        <button onClick={() => { setCriada(null); fechar(); }} style={{ ...btn, justifySelf: "start" }}>Pronto</button>
      </div>
    );
  }
  return (
    <div style={{ padding: 10, background: "#FBF9F3", border: "1px solid #E8E2D2", borderRadius: 10, display: "grid", gap: 8 }}>
      <b style={{ fontSize: 13 }}>Incluir pessoa nova</b>
      <input value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Nome completo" style={inp} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select value={f.papel} onChange={(e) => setF({ ...f, papel: e.target.value })} style={{ ...inp, flex: 1 }}>
          {PAPEIS.filter((x) => x !== "gerente").map((x) => <option key={x} value={x}>{PAPEL_LABEL[x]}</option>)}
        </select>
        <select value={f.tipo_contrato} onChange={(e) => setF({ ...f, tipo_contrato: e.target.value })} style={{ ...inp, flex: 1 }}>
          <option value="freela">Freela (eventual)</option>
          <option value="diarista">Diarista</option>
        </select>
      </div>
      <CamposContato f={f} setF={setF} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button disabled={salvando} onClick={salvar} style={btnPrimario}>{salvando ? <Loader2 size={13} /> : <Check size={13} />} Salvar e escalar neste dia</button>
        <button onClick={fechar} style={linkBtn}>Cancelar</button>
      </div>
      <div style={pequeno}>Depois de salvar, aparece o anexo do documento. Salário, PIX e fiado ficam só com o administrador, em Pessoas. Registrado também é cadastrado lá.</div>
    </div>
  );
}

function Hora({ rot, v, on, dis }) {
  return (
    <div>
      <div style={pequeno}>{rot}</div>
      <input type="time" disabled={dis} value={v || ""} onChange={(e) => on(e.target.value)} style={{ ...inp, width: 92 }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cobertura mínima (administrador)
// ---------------------------------------------------------------------------
function ConfigCobertura({ regras, pessoas, aoMudar, setErro }) {
  const [linhas, setLinhas] = useState(() => regras.map((r) => ({ ...r, inicio: hhmm(minutos(r.inicio)), fim: hhmm(minutos(r.fim)) })));
  const [salvo, setSalvo] = useState(false);
  const muda = (i, campo, valor) => setLinhas((l) => l.map((x, j) => (j === i ? { ...x, [campo]: valor } : x)));
  const alternarDia = (i, d) => setLinhas((l) => l.map((x, j) => (j === i ? { ...x, dias: (x.dias || []).includes(d) ? x.dias.filter((y) => y !== d) : [...(x.dias || []), d].sort() } : x)));
  const salvar = async () => {
    setSalvo(false);
    for (const [i, l] of linhas.entries()) {
      const papeis = l.quem === undefined ? l.papeis : (l.quem === "qualquer" ? null : [l.quem]);
      const linha = { area: l.area, papeis, dias: l.dias, inicio: l.inicio, fim: l.fim, minimo: Number(l.minimo) || 1, ordem: i + 1, ativo: l.ativo !== false };
      const { error } = l.id
        ? await supabase.from("cobertura_minima").update(linha).eq("id", l.id)
        : await supabase.from("cobertura_minima").insert(linha);
      if (error) { setErro(error.message); return; }
    }
    setSalvo(true);
    aoMudar();
  };
  const apagar = async (l, i) => {
    if (l.id) { const { error } = await supabase.from("cobertura_minima").delete().eq("id", l.id); if (error) { setErro(error.message); return; } }
    setLinhas((x) => x.filter((_, j) => j !== i));
    aoMudar();
  };
  const alternarResponde = async (p) => {
    const { error } = await supabase.from("pessoas").update({ responde_pela_casa: !p.responde_pela_casa }).eq("id", p.id);
    if (error) { setErro(error.message); return; }
    aoMudar();
  };
  const quemDe = (l) => (l.quem !== undefined ? l.quem : (!l.papeis || !l.papeis.length ? "qualquer" : l.papeis[0]));

  return (
    <div style={{ ...card, marginTop: 8, display: "grid", gap: 8 }}>
      <b style={{ fontSize: 13 }}>Cobertura mínima</b>
      {linhas.map((l, i) => (
        <div key={l.id || `n${i}`} style={{ borderTop: "1px solid #F0EBDD", paddingTop: 8, display: "grid", gap: 6 }}>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <input value={l.area} onChange={(e) => muda(i, "area", e.target.value)} style={{ ...inp, width: 140 }} />
            <select value={quemDe(l)} onChange={(e) => muda(i, "quem", e.target.value)} style={inp}>
              <option value="qualquer">qualquer um</option>
              <option value="responsavel">responsável (gerente ou marcado)</option>
              {PAPEIS.map((x) => <option key={x} value={x}>{PAPEL_LABEL[x]}</option>)}
            </select>
            <input type="time" value={l.inicio} onChange={(e) => muda(i, "inicio", e.target.value)} style={{ ...inp, width: 92 }} />
            <input type="time" value={l.fim} onChange={(e) => muda(i, "fim", e.target.value)} style={{ ...inp, width: 92 }} />
            <input type="number" min="1" value={l.minimo} onChange={(e) => muda(i, "minimo", e.target.value)} style={{ ...inp, width: 56 }} title="mínimo de pessoas" />
            <button onClick={() => apagar(l, i)} style={{ ...linkBtn, color: "#8A8778" }} aria-label="Apagar área">✕</button>
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {[2, 3, 4, 5, 6, 0, 1].map((d) => (
              <button key={d} onClick={() => alternarDia(i, d)} style={{ ...pill, border: "1px solid #E8E2D2", cursor: "pointer", ...((l.dias || []).includes(d) ? { background: "#22231F", color: "#F3EFE3" } : { background: "#FFFFFF", color: "#8A8778" }) }}>{DIAS_SEM[d]}</button>
            ))}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => setLinhas((l) => [...l, { area: "Nova área", quem: "qualquer", dias: [0, 2, 3, 4, 5, 6], inicio: "18:00", fim: "02:00", minimo: 1 }])} style={btn}>+ Área</button>
        <button onClick={salvar} style={btnPrimario}>Salvar cobertura</button>
        {salvo && <span style={{ ...pequeno, color: COR.ok.color }}>salvo</span>}
      </div>
      <div style={pequeno}>Segunda já é casa fechada (a não ser que o Calendário da casa abra). Fim menor que o início = madrugada.</div>

      <b style={{ fontSize: 13, marginTop: 6 }}>Quem responde pela casa (além da gerente)</b>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {pessoas.filter((p) => p.papel !== "gerente").map((p) => (
          <button key={p.id} onClick={() => alternarResponde(p)} style={{ ...pill, border: "1px solid #E8E2D2", cursor: "pointer", ...(p.responde_pela_casa ? { background: "#22231F", color: "#F3EFE3" } : { background: "#FFFFFF", color: "#5F5E5A" }) }}>
            {primeiroNome(p.nome)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estilo
// ---------------------------------------------------------------------------
const COR = {
  ok: { background: "#2F8F5B22", color: "#1F6B42" },
  medio: { background: "#FAC77555", color: "#854F0B" },
  alto: { background: "#E5484D22", color: "#A32D2D" },
  az: { background: "#37A0E522", color: "#185FA5" },
};
const card = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 12 };
const titulo = { fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778", margin: "18px 0 8px" };
const pequeno = { fontSize: 11, color: "#8A8778" };
const pill = { display: "inline-block", fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999 };
const caixaAlerta = { borderLeft: "3px solid #A32D2D", background: "#E5484D0D", borderRadius: 6, padding: "8px 10px", fontSize: 12.5, marginBottom: 6, lineHeight: 1.5 };
const caixaSugestao = { borderLeft: "3px solid #185FA5", background: "#37A0E50F", borderRadius: 6, padding: "8px 10px", fontSize: 12.5, marginBottom: 6, lineHeight: 1.5 };
const avisoErro = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 12 };
const inp = { padding: "6px 8px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 12.5, background: "#FFFFFF", color: "#22231F" };
const btn = { background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", gap: 5, alignItems: "center" };
const btnPrimario = { ...btn, background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" };
const linkBtn = { background: "none", border: "none", color: "#8A6A0F", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0, display: "inline-flex", gap: 4, alignItems: "center" };
