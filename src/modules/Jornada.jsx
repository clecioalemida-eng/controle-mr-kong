// ===== Jornada.jsx =====
// Gente e Gestão › Jornada — escala dos REGISTRADOS dentro da lei.
//
// Regra nova (Emenda Constitucional 141/2026):
//   - até 15/12/2026: 44 h por semana, 1 folga
//   - de 16/12/2026 a 15/12/2027: 42 h por semana, 2 folgas, até 8h24/dia
//   - de 16/12/2027 em diante: 40 h por semana, 2 folgas, até 8 h/dia
// A segunda é a casa fechada — já conta como uma das folgas.
//
// Hora noturna: das 22h às 5h, cada 52min30 trabalhados valem 1 hora.
// Por isso a tela mostra duas contas: as horas de relógio ("trabalhadas")
// e as horas pela lei ("pela lei"), que são as que contam para o limite.
//
// Três partes:
//   1. Horário padrão de cada registrado (vem do cadastro, migração 210)
//   2. Mês: quem folga em cada dia, horas da semana e os avisos da lei
//   3. Planejado × ponto: o que foi planejado contra o que a Escala do dia
//      registrou, com a hora extra que de fato aconteceu
//
// Diarista e freela ficam fora: o risco deles está em Encargos e riscos.
// Tudo é apoio — a convenção coletiva (GO000217/2026) e o contador podem
// mudar intervalo, domingo e banco de horas. Cada regra está numa
// constante só, aqui em cima, para mudar sem mexer no resto.
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, AlertTriangle, ChevronLeft, ChevronRight, Check, RotateCcw } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

// ---------------------------------------------------------------------------
// Regras — mude aqui
// ---------------------------------------------------------------------------
const REGIMES = [
  { ate: "2026-12-15", semanal: 44, diario: 8 * 60, folgas: 1, divisor: 220, nome: "44 h · 1 folga" },
  { ate: "2027-12-15", semanal: 42, diario: 8 * 60 + 24, folgas: 2, divisor: 210, nome: "42 h · 2 folgas (EC 141/2026)" },
  { ate: "9999-12-31", semanal: 40, diario: 8 * 60, folgas: 2, divisor: 200, nome: "40 h · 2 folgas (EC 141/2026)" },
];
const NOTURNO_INI = 22 * 60;          // 22:00
const NOTURNO_FIM = 29 * 60;          // 05:00 do dia seguinte
const HORA_NOTURNA = 52.5;            // minutos que valem 1 hora
const INTERVALO_MIN_LONGA = 60;       // mais de 6 h de trabalho: intervalo de 1 h a 2 h
const INTERVALO_MAX = 120;
const INTERVALO_MIN_CURTA = 15;       // de 4 h a 6 h: 15 min
const INTERJORNADA_MIN = 11 * 60;     // 11 h entre o fim de uma noite e o começo da outra
const ABERTURA = 16 * 60;             // a casa abre às 16h
const PICO_INI = 20 * 60, PICO_FIM = 23 * 60;
const SEGUNDA = 1;                    // casa fechada

// Regime pelo DOMINGO da semana: a semana de 14 a 20/12/2026 já é de 42 h.
function regimeDe(isoDia) { return REGIMES.find((r) => isoDia <= r.ate); }

// ---------------------------------------------------------------------------
// Datas e horas
// ---------------------------------------------------------------------------
const p2 = (n) => String(n).padStart(2, "0");
function iso(d) { return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; }
function lerData(s) { const [a, m, d] = String(s).slice(0, 10).split("-").map(Number); return new Date(a, m - 1, d); }
function somaDias(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function segundaDa(d) { const dow = d.getDay(); return somaDias(d, dow === 0 ? -6 : 1 - dow); }
function hojeData() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function br(d) { return `${p2(d.getDate())}/${p2(d.getMonth() + 1)}`; }
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function minutos(hhmm) {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split(":").map(Number);
  if (Number.isNaN(h)) return null;
  return h * 60 + (m || 0);
}
function hhmm(min) { return min == null ? "" : `${p2(Math.floor(min / 60) % 24)}:${p2(Math.round(min % 60))}`; }
function horas(min) {
  if (min == null) return "—";
  const t = Math.round(min);
  return `${Math.floor(t / 60)}h${p2(t % 60)}`;
}
function sobreposicao(a1, a2, b1, b2) { return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1)); }
function brl(v) { return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function porNome(a, b) { return (a.nome || "").localeCompare(b.nome || "", "pt-BR", { sensitivity: "base" }); }

// Uma noite: entrada, intervalo e saída → minutos trabalhados, noturnos e
// pela lei. Tudo em minutos contados do 0h do dia em que a noite começou;
// o que vem antes da entrada é madrugada do dia seguinte (+24 h).
export function contaNoite({ entrada, intervaloInicio, intervaloFim, saida }) {
  const e = minutos(entrada);
  let s = minutos(saida);
  if (e == null || s == null) return null;
  if (s <= e) s += 1440;
  let i1 = minutos(intervaloInicio);
  let i2 = minutos(intervaloFim);
  if (i1 != null && i1 < e) i1 += 1440;
  if (i2 != null && i2 < e) i2 += 1440;
  if (i1 != null && i2 != null && i2 < i1) i2 += 1440;
  const temIntervalo = i1 != null && i2 != null && i2 > i1;
  const intervalo = temIntervalo ? sobreposicao(e, s, i1, i2) : 0;
  const trabalhado = s - e - intervalo;
  const noturno = sobreposicao(e, s, NOTURNO_INI, NOTURNO_FIM) - (temIntervalo ? sobreposicao(i1, i2, NOTURNO_INI, NOTURNO_FIM) : 0);
  const legal = trabalhado - noturno + noturno * 60 / HORA_NOTURNA;
  return { e, s, i1: temIntervalo ? i1 : null, i2: temIntervalo ? i2 : null, intervalo, trabalhado, noturno, legal };
}

// Pelo ponto da Escala do dia só se sabe QUANTO foi o intervalo, não
// QUANDO. Conta como se ele fosse antes das 22h — o que dá o maior número
// de horas noturnas, a conta mais cautelosa.
export function contaPonto({ hora_entrada, hora_saida, intervalo_minutos, horas_trabalhadas }) {
  const e = minutos(hora_entrada);
  let s = minutos(hora_saida);
  if (e == null || s == null) {
    const h = Number(horas_trabalhadas) || 0;
    return h ? { trabalhado: h * 60, noturno: null, legal: h * 60, semHorario: true } : null;
  }
  if (s <= e) s += 1440;
  const intervalo = Number(intervalo_minutos) || 0;
  const trabalhado = s - e - intervalo;
  const noturno = Math.min(trabalhado, sobreposicao(e, s, NOTURNO_INI, NOTURNO_FIM));
  return { trabalhado, noturno, legal: trabalhado - noturno + noturno * 60 / HORA_NOTURNA };
}

// O plano de uma pessoa num dia: folga, horário do dia ou o padrão.
function planoDoDia(pessoa, dia, ajustes) {
  const d = lerData(dia);
  if (d.getDay() === SEGUNDA) return { folga: true, fechado: true };
  const a = ajustes[`${pessoa.id}|${dia}`];
  if (a?.folga) return { folga: true, ajuste: a };
  const h = {
    entrada: a?.entrada || pessoa.jornada_entrada,
    intervaloInicio: a?.intervalo_inicio || pessoa.jornada_intervalo_inicio,
    intervaloFim: a?.intervalo_fim || pessoa.jornada_intervalo_fim,
    saida: a?.saida || pessoa.jornada_saida,
  };
  const conta = contaNoite(h);
  return { folga: false, ajuste: a || null, horario: h, conta, semHorario: !conta };
}

// Avisos de uma semana (segunda a domingo) para uma pessoa.
export function avisosDaSemana(pessoa, dias, ajustes) {
  const regime = regimeDe(dias[6]);
  const planos = dias.map((dia) => ({ dia, ...planoDoDia(pessoa, dia, ajustes) }));
  const avisos = [];
  const total = planos.reduce((t, p) => t + (p.conta?.legal || 0), 0);
  const folgas = planos.filter((p) => p.folga).length;
  if (planos.some((p) => !p.folga && p.semHorario)) avisos.push({ nivel: "medio", texto: "sem horário padrão — preencha em Horário de cada um" });
  if (total > regime.semanal * 60 + 0.5) avisos.push({ nivel: "alto", texto: `${horas(total)} na semana — passa das ${regime.semanal} h (${horas(total - regime.semanal * 60)} de extra)` });
  if (folgas < regime.folgas) avisos.push({ nivel: "alto", texto: `${folgas} folga(s) na semana — a regra pede ${regime.folgas}` });
  planos.forEach((p, i) => {
    if (p.folga || !p.conta) return;
    const c = p.conta;
    const nomeDia = `${DIAS[lerData(p.dia).getDay()]} ${br(lerData(p.dia))}`;
    if (c.legal > regime.diario + 0.5) avisos.push({ nivel: "alto", texto: `${nomeDia}: ${horas(c.legal)} pela lei — passa de ${horas(regime.diario)} no dia` });
    if (c.trabalhado > 6 * 60 && c.intervalo < INTERVALO_MIN_LONGA) avisos.push({ nivel: "alto", texto: `${nomeDia}: intervalo de ${c.intervalo} min — mais de 6 h de trabalho pede 1 h` });
    else if (c.trabalhado > 4 * 60 && c.trabalhado <= 6 * 60 && c.intervalo < INTERVALO_MIN_CURTA) avisos.push({ nivel: "medio", texto: `${nomeDia}: sem os 15 min de intervalo` });
    if (c.intervalo > INTERVALO_MAX) avisos.push({ nivel: "medio", texto: `${nomeDia}: intervalo de ${horas(c.intervalo)} — passa de 2 h` });
    const prox = planos[i + 1];
    if (prox && !prox.folga && prox.conta) {
      const descanso = prox.conta.e + 1440 - c.s;
      if (descanso < INTERJORNADA_MIN) avisos.push({ nivel: "alto", texto: `${nomeDia}: só ${horas(descanso)} de descanso até a noite seguinte (mínimo 11 h)` });
    }
  });
  return { regime, total, folgas, avisos, planos };
}

// Avisos de domingo no mês: mulher (domingo_quinzenal) não pode trabalhar
// dois domingos seguidos; os demais precisam de pelo menos 1 por mês.
export function avisosDeDomingo(pessoa, domingosDoMes, ajustes) {
  const folgou = domingosDoMes.map((dia) => !!ajustes[`${pessoa.id}|${dia}`]?.folga);
  const qtd = folgou.filter(Boolean).length;
  const avisos = [];
  if (pessoa.domingo_quinzenal) {
    for (let i = 1; i < folgou.length; i++) {
      if (!folgou[i] && !folgou[i - 1]) {
        avisos.push({ nivel: "alto", texto: `trabalha os domingos ${br(lerData(domingosDoMes[i - 1]))} e ${br(lerData(domingosDoMes[i]))} — domingo de folga a cada 15 dias` });
        break;
      }
    }
  } else if (qtd === 0) {
    avisos.push({ nivel: "alto", texto: "nenhum domingo de folga no mês" });
  }
  return { qtd, avisos };
}

// Avisos da casa num dia: quem abre, chapa, gerente, intervalos no pico.
function avisosDaCasa(dia, pessoas, ajustes) {
  const d = lerData(dia);
  if (d.getDay() === SEGUNDA) return [];
  const trabalhando = pessoas
    .map((p) => ({ p, plano: planoDoDia(p, dia, ajustes) }))
    .filter((x) => !x.plano.folga && x.plano.conta);
  const avisos = [];
  if (!trabalhando.some((x) => x.plano.conta.e <= ABERTURA)) avisos.push("nenhum registrado chega às 16h — quem abre?");
  if (pessoas.some((p) => p.papel === "chapa") && !trabalhando.some((x) => x.p.papel === "chapa")) avisos.push("chapa sem registrado — confirme o substituto");
  if (pessoas.some((p) => p.papel === "gerente") && !trabalhando.some((x) => x.p.papel === "gerente")) avisos.push("sem gerente — quem responde pela casa?");
  // Dois ou mais em intervalo ao mesmo tempo no pico.
  for (let t = PICO_INI; t < PICO_FIM; t += 15) {
    const juntos = trabalhando.filter((x) => x.plano.conta.i1 != null && x.plano.conta.i1 <= t && x.plano.conta.i2 > t);
    if (juntos.length >= 2) { avisos.push(`${juntos.map((x) => x.p.nome.split(" ")[0]).join(" e ")} em intervalo juntos às ${hhmm(t)}, no pico`); break; }
  }
  return avisos;
}

function iniciais(nome) {
  const partes = String(nome || "").trim().split(/\s+/);
  return partes.length > 1 ? (partes[0][0] + partes[1][0]).toUpperCase() : (partes[0] || "?").slice(0, 2).toUpperCase();
}

// ---------------------------------------------------------------------------
// Tela
// ---------------------------------------------------------------------------
export default function Jornada({ verValores }) {
  const hoje = useMemo(() => hojeData(), []);
  const [parte, setParte] = useState("mes");
  const [pessoas, setPessoas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [mes, setMes] = useState(() => new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  const [ajustes, setAjustes] = useState({});

  // Semanas (segunda a domingo) que tocam o mês, mais as 4 de antes — o
  // botão "repetir" copia de lá, e o aviso de domingo olha a vizinhança.
  const semanas = useMemo(() => {
    const ini = segundaDa(mes);
    const fimMes = new Date(mes.getFullYear(), mes.getMonth() + 1, 0);
    const lista = [];
    for (let s = ini; s <= fimMes; s = somaDias(s, 7)) lista.push([0, 1, 2, 3, 4, 5, 6].map((i) => iso(somaDias(s, i))));
    return lista;
  }, [mes]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    const de = iso(somaDias(lerData(semanas[0][0]), -28));
    const ate = semanas[semanas.length - 1][6];
    const [resP, resA] = await Promise.all([
      supabase.from("pessoas").select("*").eq("ativo", true).eq("tipo_contrato", "registrado"),
      supabase.from("escala_jornada").select("*").gte("dia", de).lte("dia", ate),
    ]);
    if (resP.error) setErro(resP.error.message);
    else if (resA.error) setErro(resA.error.message.includes("escala_jornada")
      ? "A tabela da jornada ainda não existe — rode a migração 210 no Supabase."
      : resA.error.message);
    setPessoas((resP.data || []).slice().sort(porNome));
    setAjustes(Object.fromEntries((resA.data || []).map((a) => [`${a.pessoa_id}|${a.dia}`, a])));
    setCarregando(false);
  }, [semanas]);

  useEffect(() => { carregar(); }, [carregar]);

  if (carregando) return <div style={{ fontSize: 13, color: "#8A8778", display: "flex", gap: 8, alignItems: "center" }}><Loader2 size={15} /> Carregando…</div>;

  const regimeHoje = regimeDe(iso(hoje));
  const proximo = REGIMES[REGIMES.indexOf(regimeHoje) + 1];

  return (
    <div>
      {erro && <div style={avisoErro}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div>{erro}</div></div>}
      <div style={avisoRegra}>
        Hoje vale <b>{regimeHoje.nome}</b>.{" "}
        {proximo && (() => { const d = somaDias(lerData(regimeHoje.ate), 1); return <>A partir de <b>{br(d)}/{d.getFullYear()}</b>: {proximo.nome}. </>; })()}
        Horas depois das 22h contam 52min30 como 1 hora. Apoio para planejar — a convenção coletiva e o contador têm a palavra final.
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {[["mes", "Mês"], ["padrao", "Horário de cada um"], ["ponto", "Planejado × ponto"]].map(([k, l]) => (
          <button key={k} onClick={() => setParte(k)} style={{ ...pillBtn, ...(parte === k ? pillBtnAtivo : {}) }}>{l}</button>
        ))}
      </div>
      {pessoas.length === 0 && <div style={cardStyle}><span style={pequeno}>Nenhum registrado ativo. Cadastre em Pessoas com vínculo “Registrado”.</span></div>}
      {pessoas.length > 0 && parte === "padrao" && <ParteHorario pessoas={pessoas} recarregar={carregar} setErro={setErro} hoje={hoje} />}
      {pessoas.length > 0 && parte === "mes" && (
        <ParteMes pessoas={pessoas} mes={mes} setMes={setMes} semanas={semanas} ajustes={ajustes}
          setAjustes={setAjustes} setErro={setErro} hoje={hoje} />
      )}
      {pessoas.length > 0 && parte === "ponto" && <PartePonto pessoas={pessoas} hoje={hoje} verValores={verValores} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Horário de cada um
// ---------------------------------------------------------------------------
function ParteHorario({ pessoas, recarregar, setErro, hoje }) {
  const [form, setForm] = useState(() => Object.fromEntries(pessoas.map((p) => [p.id, {
    entrada: hhmm(minutos(p.jornada_entrada)), intervaloInicio: hhmm(minutos(p.jornada_intervalo_inicio)),
    intervaloFim: hhmm(minutos(p.jornada_intervalo_fim)), saida: hhmm(minutos(p.jornada_saida)),
    domingoQuinzenal: !!p.domingo_quinzenal,
  }])));
  const [salvo, setSalvo] = useState("");
  const regime = regimeDe(iso(hoje)).semanal >= 44 ? REGIMES[1] : regimeDe(iso(hoje));

  const salvar = async (p) => {
    const f = form[p.id];
    setSalvo("");
    const { error } = await supabase.from("pessoas").update({
      jornada_entrada: f.entrada || null, jornada_intervalo_inicio: f.intervaloInicio || null,
      jornada_intervalo_fim: f.intervaloFim || null, jornada_saida: f.saida || null,
      domingo_quinzenal: f.domingoQuinzenal,
    }).eq("id", p.id);
    if (error) { setErro(error.message); return; }
    setSalvo(p.id);
    recarregar();
  };
  const muda = (id, campo, valor) => setForm((f) => ({ ...f, [id]: { ...f[id], [campo]: valor } }));

  return (
    <div>
      {pessoas.map((p) => {
        const f = form[p.id] || {};
        const c = contaNoite(f);
        const semana = c ? c.legal * 5 : null;
        const passa = semana != null && semana > regime.semanal * 60;
        return (
          <div key={p.id} style={{ ...cardStyle, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{p.nome} <span style={pequeno}>· {PAPEL_LABEL[p.papel] || p.papel}</span></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <Campo rotulo="Entrada" valor={f.entrada} onChange={(v) => muda(p.id, "entrada", v)} />
              <Campo rotulo="Intervalo de" valor={f.intervaloInicio} onChange={(v) => muda(p.id, "intervaloInicio", v)} />
              <Campo rotulo="até" valor={f.intervaloFim} onChange={(v) => muda(p.id, "intervaloFim", v)} />
              <Campo rotulo="Saída" valor={f.saida} onChange={(v) => muda(p.id, "saida", v)} />
            </div>
            <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginTop: 8 }}>
              <input type="checkbox" checked={!!f.domingoQuinzenal} onChange={(e) => muda(p.id, "domingoQuinzenal", e.target.checked)} />
              Domingo de folga a cada 15 dias <span style={pequeno}>(CLT art. 386 — mulheres)</span>
            </label>
            {c && (
              <div style={{ fontSize: 12.5, marginTop: 8 }}>
                <b>{horas(c.trabalhado)}</b> trabalhadas · <b>{horas(c.legal)}</b> pela lei
                {c.noturno > 0 && <span style={pequeno}> ({horas(c.noturno)} depois das 22h valem {horas(c.noturno * 60 / HORA_NOTURNA)})</span>}
                {" · "}5 noites = <b style={{ color: passa ? COR.alto.color : COR.baixo.color }}>{horas(semana)}</b>{" "}
                <span style={{ ...pill, ...(passa ? COR.alto : COR.baixo) }}>{passa ? `passa das ${regime.semanal} h` : `dentro das ${regime.semanal} h`}</span>
              </div>
            )}
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
              <button onClick={() => salvar(p)} style={btnSecondary}>Salvar horário</button>
              {salvo === p.id && <span style={{ ...pequeno, color: COR.baixo.color }}><Check size={12} /> salvo</span>}
            </div>
          </div>
        );
      })}
      <div style={nota}>Este é o horário de sempre. No Mês você troca só o dia que foge dele. A conta da semana considera 5 noites, como pede a regra de 42 h.</div>
    </div>
  );
}

function Campo({ rotulo, valor, onChange }) {
  return (
    <div style={{ flex: 1, minWidth: 92 }}>
      <div style={pequeno}>{rotulo}</div>
      <input type="time" value={valor || ""} onChange={(e) => onChange(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Mês
// ---------------------------------------------------------------------------
function ParteMes({ pessoas, mes, setMes, semanas, ajustes, setAjustes, setErro, hoje }) {
  const [diaAberto, setDiaAberto] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const domingosDoMes = semanas.map((s) => s[6]).filter((d) => lerData(d).getMonth() === mes.getMonth());

  const salvarAjuste = async (pessoa, dia, dados) => {
    setOcupado(true);
    const chave = `${pessoa.id}|${dia}`;
    // Voltou ao padrão (trabalha, sem horário próprio): apaga a linha.
    const vazio = !dados.folga && !dados.entrada && !dados.saida && !dados.intervalo_inicio && !dados.intervalo_fim;
    if (vazio) {
      const { error } = await supabase.from("escala_jornada").delete().eq("pessoa_id", pessoa.id).eq("dia", dia);
      setOcupado(false);
      if (error) { setErro(error.message); return; }
      setAjustes((a) => { const n = { ...a }; delete n[chave]; return n; });
      return;
    }
    const linha = { pessoa_id: pessoa.id, dia, folga: !!dados.folga,
      entrada: dados.entrada || null, intervalo_inicio: dados.intervalo_inicio || null,
      intervalo_fim: dados.intervalo_fim || null, saida: dados.saida || null, atualizado_em: new Date().toISOString() };
    const { data, error } = await supabase.from("escala_jornada").upsert(linha, { onConflict: "pessoa_id,dia" }).select().single();
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setAjustes((a) => ({ ...a, [chave]: data }));
  };

  // Copia as folgas de 4 semanas antes para os dias do mês que ainda não
  // têm nada marcado. Não apaga nem troca o que já está lá.
  const repetirCiclo = async () => {
    const novas = [];
    semanas.flat().filter((d) => lerData(d).getMonth() === mes.getMonth() && lerData(d).getDay() !== SEGUNDA).forEach((dia) => {
      const antes = iso(somaDias(lerData(dia), -28));
      pessoas.forEach((p) => {
        if (ajustes[`${p.id}|${antes}`]?.folga && !ajustes[`${p.id}|${dia}`]) novas.push({ pessoa_id: p.id, dia, folga: true });
      });
    });
    if (!novas.length) { setErro("Nada para repetir: nenhuma folga 4 semanas antes, ou os dias já estão marcados."); return; }
    if (!window.confirm(`Marcar ${novas.length} folga(s) copiando as de 4 semanas antes? O que já está marcado não muda.`)) return;
    setOcupado(true);
    const { data, error } = await supabase.from("escala_jornada").upsert(novas, { onConflict: "pessoa_id,dia" }).select();
    setOcupado(false);
    if (error) { setErro(error.message); return; }
    setAjustes((a) => ({ ...a, ...Object.fromEntries((data || []).map((x) => [`${x.pessoa_id}|${x.dia}`, x])) }));
  };

  const resumoSemanas = semanas.map((dias) => ({
    dias,
    porPessoa: pessoas.map((p) => ({ p, ...avisosDaSemana(p, dias, ajustes) })),
    casa: dias.map((d) => ({ dia: d, avisos: avisosDaCasa(d, pessoas, ajustes) })),
  }));
  const domingos = pessoas.map((p) => ({ p, ...avisosDeDomingo(p, domingosDoMes, ajustes) }));

  return (
    <div>
      <div style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button onClick={() => { setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1)); setDiaAberto(null); }} style={setaBtn}><ChevronLeft size={16} /></button>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{MESES[mes.getMonth()]} de {mes.getFullYear()}</div>
        <button onClick={() => { setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1)); setDiaAberto(null); }} style={setaBtn}><ChevronRight size={16} /></button>
      </div>

      <div style={{ ...tabela, overflowX: "auto" }}>
        <div style={{ minWidth: 560 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4, padding: "8px 8px 4px", background: "#F6F1E7" }}>
            {["Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((d) => <div key={d} style={{ ...cab, textAlign: "center" }}>{d}</div>)}
          </div>
          {resumoSemanas.map(({ dias, casa }) => (
            <div key={dias[0]} style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 4, padding: "6px 8px", borderTop: "1px solid #F0EBDD" }}>
              {dias.slice(1).map((dia, i) => {
                const d = lerData(dia);
                const foraDoMes = d.getMonth() !== mes.getMonth();
                const folgam = pessoas.filter((p) => ajustes[`${p.id}|${dia}`]?.folga);
                const mudaHorario = pessoas.filter((p) => { const a = ajustes[`${p.id}|${dia}`]; return a && !a.folga; });
                const temAviso = casa[i + 1].avisos.length > 0;
                const aberto = diaAberto === dia;
                return (
                  <button key={dia} onClick={() => setDiaAberto(aberto ? null : dia)} style={{
                    border: aberto ? "2px solid #22231F" : "1px solid #E8E2D2", borderRadius: 8, background: foraDoMes ? "#FBF9F3" : "#FFFFFF",
                    minHeight: 58, padding: 4, textAlign: "left", cursor: "pointer", opacity: foraDoMes ? 0.55 : 1, font: "inherit",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8A8778" }}>
                      <span>{br(d)}</span>{temAviso && <span style={{ color: COR.medio.color }}>●</span>}
                    </div>
                    <div style={{ display: "flex", gap: 2, flexWrap: "wrap", marginTop: 3 }}>
                      {folgam.map((p) => <span key={p.id} title={`${p.nome} folga`} style={{ ...chip, background: "#E8E2D2", color: "#5F5E5A" }}>{iniciais(p.nome)}</span>)}
                      {mudaHorario.map((p) => <span key={p.id} title={`${p.nome} em horário diferente`} style={{ ...chip, background: "#37A0E522", color: "#185FA5" }}>{iniciais(p.nome)}</span>)}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div style={{ ...nota, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span><span style={{ ...chip, background: "#E8E2D2", color: "#5F5E5A" }}>AB</span> folga</span>
        <span><span style={{ ...chip, background: "#37A0E522", color: "#185FA5" }}>AB</span> horário diferente</span>
        <span><span style={{ color: COR.medio.color }}>●</span> aviso da casa</span>
        <span>Segunda: casa fechada, folga de todos.</span>
        <button onClick={repetirCiclo} disabled={ocupado} style={{ ...linkBtn, fontSize: 11.5, display: "inline-flex", gap: 4, alignItems: "center" }}><RotateCcw size={12} /> Repetir as folgas de 4 semanas antes</button>
      </div>

      {diaAberto && <PainelDia dia={diaAberto} pessoas={pessoas} ajustes={ajustes} salvar={salvarAjuste} ocupado={ocupado}
        avisosCasa={avisosDaCasa(diaAberto, pessoas, ajustes)} fechar={() => setDiaAberto(null)} />}

      <div style={titulo}>Horas pela lei por semana</div>
      <div style={{ ...tabela, overflowX: "auto" }}>
        <div style={{ minWidth: 120 + 90 * semanas.length }}>
          <div style={{ display: "grid", gridTemplateColumns: `120px repeat(${semanas.length}, 1fr)`, gap: 4, padding: "8px 10px", background: "#F6F1E7" }}>
            <div style={cab}>Pessoa</div>
            {semanas.map((s) => <div key={s[0]} style={{ ...cab, textAlign: "center" }}>{br(lerData(s[1]))}–{br(lerData(s[6]))}</div>)}
          </div>
          {pessoas.map((p) => (
            <div key={p.id} style={{ display: "grid", gridTemplateColumns: `120px repeat(${semanas.length}, 1fr)`, gap: 4, padding: "8px 10px", borderTop: "1px solid #F0EBDD", fontSize: 12.5, alignItems: "center" }}>
              <div><b>{p.nome.split(" ")[0]}</b><div style={pequeno}>{PAPEL_LABEL[p.papel] || p.papel}</div></div>
              {resumoSemanas.map(({ dias, porPessoa }) => {
                const r = porPessoa.find((x) => x.p.id === p.id);
                const ruim = r.avisos.some((a) => a.nivel === "alto");
                return (
                  <div key={dias[0]} style={{ textAlign: "center" }}>
                    <div style={{ fontWeight: 700, color: ruim ? COR.alto.color : "#22231F" }}>{horas(r.total)}</div>
                    <div style={pequeno}>{r.folgas} folga(s) · {r.regime.semanal} h</div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div style={titulo}>Avisos do mês</div>
      <div style={{ ...cardStyle, display: "grid", gap: 7, fontSize: 12.5 }}>
        {(() => {
          const linhas = [];
          resumoSemanas.forEach(({ dias, porPessoa, casa }) => {
            porPessoa.forEach((r) => r.avisos.forEach((a, i) => linhas.push(
              <div key={`${dias[0]}-${r.p.id}-${i}`}><span style={{ ...pill, ...COR[a.nivel] }}>{r.p.nome.split(" ")[0]}</span> <span style={pequeno}>{br(lerData(dias[1]))}–{br(lerData(dias[6]))}</span> {a.texto}</div>
            )));
            casa.forEach((c) => c.avisos.forEach((t, i) => linhas.push(
              <div key={`${c.dia}-casa-${i}`}><span style={{ ...pill, ...COR.medio }}>{DIAS[lerData(c.dia).getDay()]} {br(lerData(c.dia))}</span> {t}</div>
            )));
          });
          domingos.forEach((d) => d.avisos.forEach((a, i) => linhas.push(
            <div key={`dom-${d.p.id}-${i}`}><span style={{ ...pill, ...COR[a.nivel] }}>{d.p.nome.split(" ")[0]}</span> {a.texto}</div>
          )));
          return linhas.length ? linhas : <span style={{ color: COR.baixo.color }}>Nenhum aviso — o mês está dentro das regras que a tela confere.</span>;
        })()}
      </div>

      <div style={titulo}>Domingos de folga em {MESES[mes.getMonth()]}</div>
      <div style={{ ...cardStyle, display: "flex", gap: 6, flexWrap: "wrap", fontSize: 12.5 }}>
        {domingos.map((d) => (
          <span key={d.p.id} style={{ ...pill, ...(d.avisos.length ? COR.alto : COR.baixo) }}>
            {d.p.nome.split(" ")[0]} · {d.qtd}{d.p.domingo_quinzenal ? " (a cada 15 dias)" : ""}
          </span>
        ))}
      </div>
      <div style={nota}>
        Regra do painel: pelo menos 1 domingo de folga por mês; quem está marcado “a cada 15 dias” não pode trabalhar dois domingos seguidos.
        A semana que passa de um regime para outro segue o regime do domingo.
      </div>
    </div>
  );
}

function PainelDia({ dia, pessoas, ajustes, salvar, ocupado, avisosCasa, fechar }) {
  const d = lerData(dia);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({});
  if (d.getDay() === SEGUNDA) return null;

  const abrirHorario = (p, plano) => {
    setEditando(p.id);
    setForm({
      entrada: hhmm(minutos(plano.horario?.entrada)), intervalo_inicio: hhmm(minutos(plano.horario?.intervaloInicio)),
      intervalo_fim: hhmm(minutos(plano.horario?.intervaloFim)), saida: hhmm(minutos(plano.horario?.saida)),
    });
  };

  return (
    <div style={{ ...cardStyle, marginBottom: 12, border: "2px solid #22231F" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <b>{DIAS[d.getDay()]} {br(d)}</b>
        <button onClick={fechar} style={linkBtn}>Fechar</button>
      </div>
      {avisosCasa.map((t) => <div key={t} style={{ fontSize: 12, color: COR.medio.color, marginBottom: 4 }}>● {t}</div>)}
      {pessoas.map((p) => {
        const plano = planoDoDia(p, dia, ajustes);
        const proprio = plano.ajuste && !plano.ajuste.folga;
        return (
          <div key={p.id} style={{ borderTop: "1px solid #F0EBDD", padding: "8px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <b style={{ fontSize: 13 }}>{p.nome}</b>
                <div style={pequeno}>
                  {plano.folga ? "folga"
                    : plano.conta ? `${hhmm(plano.conta.e)}–${hhmm(plano.conta.s)} · ${horas(plano.conta.legal)} pela lei${proprio ? " · horário do dia" : ""}`
                    : "sem horário padrão"}
                </div>
              </div>
              <button disabled={ocupado} onClick={() => salvar(p, dia, plano.folga ? {} : { folga: true })}
                style={{ ...btnSecondary, ...(plano.folga ? { background: "#22231F", color: "#F3EFE3" } : {}) }}>
                {plano.folga ? "Folga ✓" : "Dar folga"}
              </button>
              {!plano.folga && <button onClick={() => abrirHorario(p, plano)} style={{ ...linkBtn, fontSize: 12 }}>Outro horário</button>}
              {proprio && <button disabled={ocupado} onClick={() => salvar(p, dia, {})} style={{ ...linkBtn, fontSize: 12 }}>Voltar ao padrão</button>}
            </div>
            {editando === p.id && (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <Campo rotulo="Entrada" valor={form.entrada} onChange={(v) => setForm((f) => ({ ...f, entrada: v }))} />
                  <Campo rotulo="Intervalo de" valor={form.intervalo_inicio} onChange={(v) => setForm((f) => ({ ...f, intervalo_inicio: v }))} />
                  <Campo rotulo="até" valor={form.intervalo_fim} onChange={(v) => setForm((f) => ({ ...f, intervalo_fim: v }))} />
                  <Campo rotulo="Saída" valor={form.saida} onChange={(v) => setForm((f) => ({ ...f, saida: v }))} />
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button disabled={ocupado} onClick={async () => { await salvar(p, dia, { folga: false, ...form }); setEditando(null); }} style={btnSecondary}>Salvar só neste dia</button>
                  <button onClick={() => setEditando(null)} style={linkBtn}>Cancelar</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Planejado × ponto
// ---------------------------------------------------------------------------
function PartePonto({ pessoas, hoje, verValores }) {
  // Começa na última semana já terminada.
  const [segunda, setSegunda] = useState(() => somaDias(segundaDa(hoje), -7));
  const [dados, setDados] = useState(null);
  const dias = useMemo(() => [0, 1, 2, 3, 4, 5, 6].map((i) => iso(somaDias(segunda, i))), [segunda]);

  useEffect(() => {
    let vivo = true;
    setDados(null);
    Promise.all([
      supabase.from("presencas_diarias").select("pessoa_id, dia, hora_entrada, hora_saida, intervalo_minutos, horas_trabalhadas")
        .gte("dia", dias[0]).lte("dia", dias[6]).in("pessoa_id", pessoas.map((p) => p.id)),
      supabase.from("escala_jornada").select("*").gte("dia", dias[0]).lte("dia", dias[6]),
    ]).then(([rp, ra]) => {
      if (!vivo) return;
      setDados({
        presencas: rp.data || [], erro: rp.error?.message || ra.error?.message || "",
        ajustes: Object.fromEntries((ra.data || []).map((a) => [`${a.pessoa_id}|${a.dia}`, a])),
      });
    });
    return () => { vivo = false; };
  }, [dias, pessoas]);

  const regime = regimeDe(dias[6]);
  const linhas = dados ? pessoas.map((p) => {
    const plan = avisosDaSemana(p, dias, dados.ajustes);
    const pres = dados.presencas.filter((x) => x.pessoa_id === p.id);
    const contas = pres.map(contaPonto).filter(Boolean);
    const real = contas.reduce((t, c) => t + c.legal, 0);
    const extra = Math.max(0, real - regime.semanal * 60);
    const valorHora = (Number(p.salario_base) || 0) / regime.divisor;
    return { p, planejado: plan.total, real, noites: pres.length, extra, semHorario: contas.some((c) => c.semHorario),
      valorExtra: extra / 60 * valorHora * 1.5 };
  }) : [];

  return (
    <div>
      <div style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button onClick={() => setSegunda(somaDias(segunda, -7))} style={setaBtn}><ChevronLeft size={16} /></button>
        <div style={{ fontWeight: 700, fontSize: 14 }}>{br(lerData(dias[1]))} a {br(lerData(dias[6]))} · {regime.semanal} h</div>
        <button onClick={() => setSegunda(somaDias(segunda, 7))} disabled={somaDias(segunda, 7) > hoje} style={setaBtn}><ChevronRight size={16} /></button>
      </div>
      {!dados ? <div style={pequeno}>Carregando…</div> : (
        <>
          {dados.erro && <div style={avisoErro}>{dados.erro}</div>}
          <div style={tabela}>
            <div style={{ display: "grid", gridTemplateColumns: "1.3fr .9fr .9fr .9fr", gap: 6, padding: "8px 10px", background: "#F6F1E7" }}>
              {["Pessoa", "Planejado", "Ponto", "Extra"].map((t, i) => <div key={t} style={{ ...cab, textAlign: i ? "right" : "left" }}>{t}</div>)}
            </div>
            {linhas.map((l) => (
              <div key={l.p.id} style={{ display: "grid", gridTemplateColumns: "1.3fr .9fr .9fr .9fr", gap: 6, padding: 10, borderTop: "1px solid #F0EBDD", fontSize: 13, alignItems: "center" }}>
                <div><b>{l.p.nome}</b><div style={pequeno}>{l.noites} noite(s) no ponto{l.semHorario ? " · alguma sem entrada/saída" : ""}</div></div>
                <div style={{ textAlign: "right" }}>{horas(l.planejado)}</div>
                <div style={{ textAlign: "right" }}>{l.noites ? horas(l.real) : "—"}</div>
                <div style={{ textAlign: "right", fontWeight: 700, color: l.extra > 0 ? COR.alto.color : "#8A8778" }}>
                  {l.extra > 0 ? horas(l.extra) : "—"}
                  {verValores && l.extra > 0 && l.valorExtra > 0 && <div style={{ ...pequeno, color: COR.alto.color }}>≈ {brl(l.valorExtra)}</div>}
                </div>
              </div>
            ))}
          </div>
          <div style={nota}>
            Ponto = entrada, saída e intervalo lançados na Escala do dia, com a hora noturna. Como o ponto não diz a hora do intervalo,
            a conta supõe que ele foi antes das 22h (a mais cautelosa). Extra = o que passou das {regime.semanal} h na semana
            {verValores ? `, a 50% sobre o salário ÷ ${regime.divisor}` : ""}. O contador fecha o valor oficial.
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estilo
// ---------------------------------------------------------------------------
const PAPEL_LABEL = { garcom: "Garçom", interno: "Equipe interna", caixa: "Caixa", bar: "Bar", chapa: "Chapa", cozinha: "Cozinha", limpeza: "Limpeza", gerente: "Gerente" };
const COR = {
  baixo: { background: "#2F8F5B22", color: "#1F6B42" },
  medio: { background: "#FAC77555", color: "#854F0B" },
  alto: { background: "#E5484D22", color: "#A32D2D" },
};
const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const tabela = { border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF", marginBottom: 10 };
const cab = { fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#8A8778" };
const titulo = { fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778", margin: "20px 0 8px" };
const avisoRegra = { background: "#FFF8E6", border: "1px solid #F2DDA6", borderRadius: 12, padding: "12px 14px", fontSize: 12.5, lineHeight: 1.55, marginBottom: 14, color: "#22231F" };
const avisoErro = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 14 };
const nota = { fontSize: 11.5, color: "#8A8778", lineHeight: 1.55, marginBottom: 8 };
const pequeno = { fontSize: 11, color: "#8A8778" };
const pill = { display: "inline-block", fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 999 };
const chip = { display: "inline-block", fontSize: 9.5, fontWeight: 700, padding: "1px 4px", borderRadius: 4 };
const pillBtn = { padding: "6px 12px", borderRadius: 999, border: "1px solid #E8E2D2", background: "#FFFFFF", color: "#8A8778", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const pillBtnAtivo = { background: "#2F8F5B", color: "#FFFFFF", borderColor: "#2F8F5B" };
const setaBtn = { width: 32, height: 32, borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" };
const inputStyle = { padding: "8px 10px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF", color: "#22231F" };
const btnSecondary = { background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const linkBtn = { background: "none", border: "none", color: "#8A6A0F", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, textAlign: "left" };
