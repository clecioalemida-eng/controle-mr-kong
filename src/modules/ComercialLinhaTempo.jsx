// ===== ComercialLinhaTempo.jsx =====
// Comercial → Mês: a linha do tempo de vendas, por linha de produto e pelos
// 20 principais produtos.
//
// Regra que motivou esta tela: DIA ABERTO NÃO ENTRA NA CONTA. No dia 1 o
// painel comparava os R$ 336 da noite em andamento com o dia 1 de outubro
// inteiro e mostrava −89%, e as linhas apareciam com −100% porque o detalhe
// por item só chega ao cache depois. Não houve queda nenhuma.
//
// Cada ponto do gráfico é uma chamada a desempenho_linhas ou
// desempenho_produtos (migração 079, lê pedidos_cache), as mesmas do resto
// do Comercial. Por isso o valor aqui bate com o Dashboard, sem conta nova.
//
// Semana é sempre semana INTEIRA, de segunda a domingo: uma semana pela
// metade faria a linha cair sem ter caído. Pelo mesmo motivo, mês que o
// histórico não cobre inteiro (maio de 2026) só aparece na visão por semana.
import React, { useState, useEffect, useMemo, useRef } from "react";
import { Loader2, AlertTriangle, CheckCircle2, PieChart } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { Comparando, faixaDatas } from "./ComercialMes";

const PERIODOS = [
  { chave: "atual", label: "Mês atual", meses: 0 },
  { chave: "passado", label: "Mês passado", meses: 1 },
  { chave: "tres", label: "Últimos 3 meses", meses: 3 },
  { chave: "seis", label: "Últimos 6 meses", meses: 6 },
];
const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGOS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const QUANTOS_PRODUTOS = 20;
const CHAMADAS_JUNTAS = 6;
const AZUL = "#2F6FA3";
const VERMELHO = "#C4432B";
const NEUTRO = "#8A8778";

function pad(n) { return String(n).padStart(2, "0"); }
function ymd(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function paraData(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
function somarDias(s, n) { const d = paraData(s); d.setDate(d.getDate() + n); return ymd(d); }
function diaMes(s) { const d = paraData(s); return `${d.getDate()}/${d.getMonth() + 1}`; }
function brl(v) { return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }); }

// Último dia operacional já encerrado. O dia vai das 5h às 5h, então às 2h
// de domingo ainda é sábado, e sábado continua aberto.
export function ultimoDiaFechado(agora = new Date()) {
  return somarDias(ymd(new Date(agora.getTime() - 5 * 3600 * 1000)), -1);
}

// Os pontos do gráfico para um período. O "mês atual" é o que contém o dia
// seguinte ao último fechado: em 1º de novembro, o mês passado já é outubro.
export function montarPontos(periodo, granularidade, fechado, primeiroDia) {
  const base = paraData(somarDias(fechado, 1));
  const inicioDe = (k) => new Date(base.getFullYear(), base.getMonth() - k, 1);
  const config = PERIODOS.find((p) => p.chave === periodo);
  const iniJanela = ymd(inicioDe(config.meses));
  const fimJanela = periodo === "atual"
    ? ymd(new Date(base.getFullYear(), base.getMonth() + 1, 0))
    : ymd(new Date(base.getFullYear(), base.getMonth(), 0));

  if (granularidade === "mes") {
    const pontos = [];
    const foraDoHistorico = [];
    for (let k = config.meses; k >= 1; k--) {
      const ini = inicioDe(k);
      if (primeiroDia && ymd(ini) < primeiroDia) {
        // Só avisa do mês que tem parte dos dados; antes disso não há nada.
        if (ymd(new Date(ini.getFullYear(), ini.getMonth() + 1, 0)) >= primeiroDia) foraDoHistorico.push(MESES_LONGOS[ini.getMonth()]);
        continue;
      }
      pontos.push({ ini: ymd(ini), fim: ymd(new Date(ini.getFullYear(), ini.getMonth() + 1, 0)), rotulo: MESES_CURTOS[ini.getMonth()] });
    }
    return { pontos, foraDoHistorico, unidade: "mês" };
  }

  // Segunda-feira da semana pertence ao período; o domingo pode cair no mês
  // seguinte, mas precisa já ter fechado.
  const pontos = [];
  let seg = iniJanela;
  while (paraData(seg).getDay() !== 1) seg = somarDias(seg, 1);
  for (; seg <= fimJanela; seg = somarDias(seg, 7)) {
    const dom = somarDias(seg, 6);
    if (dom > fechado) break;
    if (primeiroDia && seg < primeiroDia) continue;
    pontos.push({ ini: seg, fim: dom, rotulo: diaMes(seg) });
  }
  if (pontos.length > 0 || periodo !== "atual") return { pontos, foraDoHistorico: [], unidade: "semana" };

  // Começo do mês, antes de fechar a primeira semana: os dias já fechados.
  const dias = [];
  for (let d = iniJanela; d <= fechado; d = somarDias(d, 1)) dias.push({ ini: d, fim: d, rotulo: diaMes(d) });
  return { pontos: dias, foraDoHistorico: [], unidade: "dia" };
}

// Compara a primeira metade do período com a segunda, em média por ponto.
export function tendencia(valores) {
  const n = valores.length;
  if (n < 2) return null;
  const m = Math.floor(n / 2);
  const media = (l) => l.reduce((s, x) => s + x, 0) / l.length;
  const antes = media(valores.slice(0, m));
  const depois = media(valores.slice(-m));
  if (!(antes > 0)) return null;
  return ((depois - antes) / antes) * 100;
}
// Média da primeira metade e da segunda metade (mesma conta da tendência).
// Com número ímpar de pontos, o do meio fica de fora das duas.
export function medias(valores) {
  const n = valores.length;
  if (n < 2) return null;
  const m = Math.floor(n / 2);
  const media = (l) => l.reduce((s, x) => s + x, 0) / l.length;
  return { antes: media(valores.slice(0, m)), depois: media(valores.slice(-m)), m, n };
}
function pctDe(p) {
  if (p == null) return "—";
  const r = Math.round(p);
  return r === 0 ? "0%" : `${r > 0 ? "+" : "−"}${Math.abs(r)}%`;
}
function mil(v) {
  const n = Math.abs(Number(v) || 0);
  if (n < 1000) return `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
  return `R$ ${(n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
}
function listaNomes(l) {
  return l.length <= 1 ? (l[0] || "") : `${l.slice(0, -1).join(", ")} e ${l[l.length - 1]}`;
}
const VERDE = "#2F8F5B";
const VERMELHO_BARRA = "#C4432B";
const PLURAL = { semana: "semanas", "mês": "meses", dia: "dias" };

// Gráfico com régua começando no zero e as duas médias tracejadas:
// cinza = média da primeira metade, verde = média da segunda metade.
function Grafico({ valores, rotulos, cor, nome, foco, onFoco, med, compacto }) {
  // O desenho acompanha a largura real, para a letra não encolher no celular.
  const caixa = useRef(null);
  const [largura, setLargura] = useState(640);
  useEffect(() => {
    const el = caixa.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setLargura(Math.round(e.contentRect.width) || 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = Math.max(280, largura);
  // Data inclinada em todo ponto só cabe na tela larga; no celular, algumas datas retas.
  const inclinadas = !compacto && rotulos.length > 10 && W >= 560;
  const H = compacto ? 130 : (inclinadas ? 210 : 186);
  const pl = 52, pr = 12, pt = 10;
  const pb = inclinadas ? 46 : 22;
  const max = Math.max(...valores, med ? med.antes : 0, med ? med.depois : 0, 1);
  const X = (i) => pl + (valores.length > 1 ? i / (valores.length - 1) : 0.5) * (W - pl - pr);
  const Y = (v) => pt + (1 - v / max) * (H - pt - pb);
  const caminho = valores.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const passo = inclinadas ? 1 : Math.max(1, Math.ceil(rotulos.length / (W < 560 ? 4 : compacto ? 6 : 8)));
  const baseY = H - pb;
  const mover = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pl) / (W - pl - pr)) * (valores.length - 1));
    onFoco(Math.max(0, Math.min(valores.length - 1, i)));
  };
  const comPontos = valores.length <= 6;
  return (
    <div ref={caixa}>
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={nome}
      style={{ display: "block", touchAction: "pan-y" }}
      onPointerMove={mover} onPointerDown={mover} onPointerLeave={() => onFoco(null)}>
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={pl} x2={W - pr} y1={Y(max * f)} y2={Y(max * f)} stroke="#EFE9DA" />
          <text x={pl - 6} y={Y(max * f) + 4} textAnchor="end" fontSize="11" fill={NEUTRO}>
            {max * f >= 1000 ? `${Math.round((max * f) / 1000)} mil` : Math.round(max * f)}
          </text>
        </g>
      ))}
      {rotulos.map((t, i) => (
        <g key={i}>
          <line x1={X(i)} x2={X(i)} y1={baseY} y2={baseY + 4} stroke="#C9BFA6" />
          {inclinadas ? (
            <text transform={`translate(${X(i) + 3},${baseY + 10}) rotate(-55)`} textAnchor="end" fontSize="11" fill="#55534A">{t}</text>
          ) : i % passo === 0 ? (
            <text x={X(i)} y={baseY + 15} textAnchor={i === 0 && valores.length > 1 ? "start" : "middle"} fontSize="11" fill="#55534A">{t}</text>
          ) : null}
        </g>
      ))}
      <path d={`${caminho} L${X(valores.length - 1).toFixed(1)} ${baseY} L${X(0).toFixed(1)} ${baseY} Z`} fill={cor} opacity="0.07" />
      {med && (
        <>
          <line x1={X(0)} x2={X(med.m - 1)} y1={Y(med.antes)} y2={Y(med.antes)} stroke={NEUTRO} strokeWidth="2" strokeDasharray="6 4" />
          <line x1={X(med.n - med.m)} x2={X(med.n - 1)} y1={Y(med.depois)} y2={Y(med.depois)} stroke={VERDE} strokeWidth="2" strokeDasharray="6 4" />
        </>
      )}
      <path d={caminho} fill="none" stroke={cor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {valores.map((v, i) => <circle key={i} cx={X(i)} cy={Y(v)} r={comPontos ? 4 : 2.5} fill={cor} stroke="#FFFFFF" strokeWidth="1" />)}
      {foco != null && (
        <>
          <line x1={X(foco)} x2={X(foco)} y1={pt} y2={H - pb} stroke="#C9BFA6" />
          <circle cx={X(foco)} cy={Y(valores[foco])} r="4" fill={cor} stroke="#FFFFFF" strokeWidth="2" />
        </>
      )}
    </svg>
    </div>
  );
}

function Legenda({ cor, tracejado, children }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 16, height: 0, borderTop: `2px ${tracejado ? "dashed" : "solid"} ${cor}` }} />{children}
    </span>
  );
}

// Uma linha da lista "Quem fez a diferença". Toque abre o gráfico dela.
const GRADE_LISTA = "minmax(0, 1.25fr) minmax(0, 0.95fr) minmax(0, 1.4fr) 54px";
function ItemDiferenca({ item, maxDelta, rotulos, legendas, unidade, aberto, onAbrir, estreito, faixas }) {
  const [foco, setFoco] = useState(null);
  const sobe = item.delta >= 0;
  const pequeno = item.peso < 0.01;
  const corTexto = sobe ? VERDE : VERMELHO_BARRA;
  const largura = `${Math.max(1, (Math.abs(item.delta) / (maxDelta || 1)) * 50)}%`;
  const nome = (
    <div title={item.nome} style={{ fontSize: 12.5, color: "#22231F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: estreito ? "normal" : "nowrap" }}>
      <span style={{ color: NEUTRO, marginRight: 4 }}>{aberto ? "▾" : "▸"}</span>{item.nome}
    </div>
  );
  const peso = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: NEUTRO }}>
      <span style={{ width: Math.max(2, Math.round(item.peso * 60)), height: 5, borderRadius: 2, background: "#C9BFA6" }} />
      {pequeno ? "menos de 1%" : `${Math.round(item.peso * 100)}% da venda`}
    </span>
  );
  const barra = (
    <div style={{ position: "relative", height: 16 }}>
      <div style={{ position: "absolute", left: "50%", top: -3, bottom: -3, width: 1, background: "#D9D2BE" }} />
      <div style={{ position: "absolute", top: 2, bottom: 2, [sobe ? "left" : "right"]: "50%", width: largura,
        background: sobe ? VERDE : VERMELHO_BARRA, borderRadius: sobe ? "0 3px 3px 0" : "3px 0 0 3px" }} />
      {/* O valor fica do lado vazio: a barra que ganha cresce para a direita, o texto vai à esquerda. */}
      <div style={{ position: "absolute", [sobe ? "right" : "left"]: "calc(50% + 5px)", top: 0, fontSize: 11, fontWeight: 700, color: corTexto,
        fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {sobe ? "+" : "−"}{mil(item.delta)}
      </div>
    </div>
  );
  const variacao = (
    <div style={{ textAlign: "right", fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: pequeno ? NEUTRO : corTexto }}>
      {item.antes > 0 ? pctDe(item.pct) : "nova"}
    </div>
  );
  return (
    <div style={{ borderTop: "1px solid #EFE9DA" }}>
      {estreito ? (
        // Celular: nome inteiro em cima; valores e barra embaixo.
        <div onClick={onAbrir} style={{ padding: "9px 0", cursor: "pointer", opacity: pequeno ? 0.5 : 1 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
            <div style={{ minWidth: 0 }}>{nome}</div>{variacao}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 10, alignItems: "center", marginTop: 4 }}>
            <div style={{ lineHeight: 1.35 }}>
              {peso}
              <div style={{ fontSize: 11.5, color: NEUTRO, fontVariantNumeric: "tabular-nums" }}>
                {mil(item.antes)} → <b style={{ color: "#22231F" }}>{mil(item.depois)}</b>
              </div>
            </div>
            {barra}
          </div>
        </div>
      ) : (
        <div onClick={onAbrir} style={{ display: "grid", gridTemplateColumns: GRADE_LISTA, gap: 8, alignItems: "center",
          padding: "9px 0", cursor: "pointer", opacity: pequeno ? 0.5 : 1 }}>
          <div style={{ minWidth: 0 }}>{nome}{peso}</div>
          <div style={{ textAlign: "right", fontSize: 11.5, color: NEUTRO, fontVariantNumeric: "tabular-nums", lineHeight: 1.35 }}>
            {mil(item.antes)} →<br /><b style={{ color: "#22231F" }}>{mil(item.depois)}</b>
          </div>
          {barra}
          {variacao}
        </div>
      )}
      {aberto && (
        <div style={{ padding: "0 0 10px" }}>
          <Grafico valores={item.valores} rotulos={rotulos} cor={AZUL} nome={item.nome} foco={foco} onFoco={setFoco} med={item.med} compacto />
          <div style={{ fontSize: 11.5, color: "#55534A", minHeight: 16 }}>
            {foco != null
              ? `${unidade === "semana" ? "Semana de " : ""}${legendas[foco]}: ${brl(item.valores[foco])}`
              : `Média por ${unidade}: ${mil(item.antes)} de ${faixas ? faixas.antes : "antes"} (cinza) e ${mil(item.depois)} de ${faixas ? faixas.agora : "agora"} (verde). Total no período: ${brl(item.total)}.`}
          </div>
        </div>
      )}
    </div>
  );
}

// Frases da leitura, montadas com os números da lista.
function montarFrases(lista, unidade, nomeItens) {
  const frases = [];
  const positivos = lista.filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta);
  const negativos = lista.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta);
  const somaPos = positivos.reduce((s, x) => s + x.delta, 0);
  if (positivos.length && positivos[0].delta >= 50) {
    const escolhidos = [];
    let acc = 0;
    for (const x of positivos) { if (escolhidos.length >= 3 || acc >= somaPos * 0.7) break; escolhidos.push(x); acc += x.delta; }
    frases.push({ tipo: "bom", texto: escolhidos.length === 1
      ? `${escolhidos[0].nome} é quem mais somou: +${mil(acc)} por ${unidade}.`
      : `${listaNomes(escolhidos.map((x) => x.nome))} explicam a maior parte do que cresceu: juntos, +${mil(acc)} por ${unidade}.` });
  }
  if (negativos.length && negativos[0].delta <= -50) {
    const x = negativos[0];
    const peso = Math.round(x.peso * 100);
    frases.push({ tipo: "atencao", texto: `${x.nome} é a maior perda em reais: −${mil(x.delta)} por ${unidade}. Pesa ${peso}% da venda${peso >= 10 ? ", então merece atenção primeiro." : "."}` });
  }
  const porPeso = [...lista].sort((a, b) => b.peso - a.peso);
  const fortes = [];
  let pesoAcc = 0;
  for (const x of porPeso) { if (pesoAcc >= 0.6 || fortes.length >= 4) break; fortes.push(x); pesoAcc += x.peso; }
  if (fortes.length >= 1 && lista.length > fortes.length) {
    frases.push({ tipo: "peso", texto: `${fortes.length === 1 ? `Só ${fortes[0].nome}` : `${fortes.length} ${nomeItens}`} ${fortes.length === 1 ? "faz" : "fazem"} ${Math.round(pesoAcc * 100)}% da venda${fortes.length > 1 ? `: ${listaNomes(fortes.map((x) => x.nome))}` : ""}.` });
  }
  return frases;
}

export default function ComercialLinhaTempo() {
  const [periodo, setPeriodo] = useState("seis");
  const [visao, setVisao] = useState("linhas");
  const [granularidade, setGranularidade] = useState("semana");
  const [primeiroDia, setPrimeiroDia] = useState(undefined); // undefined = ainda buscando
  const [dados, setDados] = useState(null); // { chave, respostas: [[{nome, valor}]] }
  const [progresso, setProgresso] = useState("");
  const [erro, setErro] = useState("");
  const [focoTotal, setFocoTotal] = useState(null);
  // Trocar de botão e voltar não refaz as chamadas.
  const memoria = useRef(new Map());

  const fechado = ultimoDiaFechado();

  useEffect(() => {
    let vivo = true;
    supabase.from("vendas_diarias").select("dia").order("dia").limit(1).maybeSingle()
      .then(({ data }) => { if (vivo) setPrimeiroDia(data?.dia ? String(data.dia).slice(0, 10) : null); });
    return () => { vivo = false; };
  }, []);

  const semMeses = periodo === "atual" || periodo === "passado";
  const gran = semMeses ? "semana" : granularidade;
  const montado = useMemo(
    () => (primeiroDia === undefined ? null : montarPontos(periodo, gran, fechado, primeiroDia)),
    [periodo, gran, fechado, primeiroDia],
  );
  const pontos = montado?.pontos;
  const chave = pontos ? `${visao}|${pontos.map((p) => p.ini).join(",")}` : "";

  useEffect(() => {
    if (!pontos || pontos.length === 0) return undefined;
    let vivo = true;
    setErro(""); setFocoTotal(null);
    const funcao = visao === "linhas" ? "desempenho_linhas" : "desempenho_produtos";
    const campo = visao === "linhas" ? "linha" : "produto";
    (async () => {
      const respostas = new Array(pontos.length);
      let prontos = 0;
      let proximo = 0;
      setProgresso(`0 de ${pontos.length}`);
      const buscar = async () => {
        while (vivo && proximo < pontos.length) {
          const i = proximo++;
          const p = pontos[i];
          const k = `${funcao}|${p.ini}|${p.fim}`;
          if (!memoria.current.has(k)) {
            // Só interessa o valor do período; a comparação pedida pela
            // função fica num único dia para não pesar.
            const { data, error } = await supabase.rpc(funcao, { p_inicio: p.ini, p_fim: p.fim, p_inicio_ant: p.ini, p_fim_ant: p.ini });
            if (error) throw error;
            memoria.current.set(k, (data || []).map((l) => ({
              nome: String(l[campo] || "").trim() || "Sem linha definida",
              valor: Number(l.valor_atual) || 0,
            })));
          }
          respostas[i] = memoria.current.get(k);
          prontos += 1;
          if (vivo) setProgresso(`${prontos} de ${pontos.length}`);
        }
      };
      try {
        await Promise.all(Array.from({ length: CHAMADAS_JUNTAS }, buscar));
        if (vivo) setDados({ chave, respostas });
      } catch (e) {
        if (!vivo) return;
        setErro(/sem_acesso|permission|denied/i.test(e.message || "")
          ? "Seu cargo não vê o desempenho por produto."
          : /does not exist|schema cache|Could not find/i.test(e.message || "")
            ? "Falta a migração 079 (desempenho por produto) no banco."
            : e.message);
      }
    })();
    return () => { vivo = false; };
  }, [chave]); // eslint-disable-line

  const prontos = dados && dados.chave === chave ? dados.respostas : null;

  const { total, itens } = useMemo(() => {
    if (!prontos) return { total: [], itens: [] };
    const porNome = new Map();
    prontos.forEach((lista, i) => lista.forEach(({ nome, valor }) => {
      if (!porNome.has(nome)) porNome.set(nome, new Array(prontos.length).fill(0));
      porNome.get(nome)[i] += valor;
    }));
    let lista = [...porNome.entries()].map(([nome, valores]) => ({
      nome, valores, total: valores.reduce((s, v) => s + v, 0),
    })).filter((x) => x.total > 0);
    if (visao === "produtos") lista = lista.sort((a, b) => b.total - a.total).slice(0, QUANTOS_PRODUTOS);
    const soma = lista.reduce((s, x) => s + x.total, 0) || 1;
    // Cada item: média por ponto antes e agora, diferença em R$ e peso na venda.
    // A lista vai na ordem de quanto cada um somou ou tirou, não pela porcentagem.
    lista = lista.map((x) => {
      const med = medias(x.valores);
      const antes = med ? med.antes : 0;
      const depois = med ? med.depois : x.total;
      return { ...x, med, antes, depois, delta: depois - antes, pct: antes > 0 ? ((depois - antes) / antes) * 100 : null, peso: x.total / soma };
    }).sort((a, b) => b.delta - a.delta || b.total - a.total);
    return { total: prontos.map((_, i) => lista.reduce((s, x) => s + x.valores[i], 0)), itens: lista };
  }, [prontos, visao]);

  const [aberto, setAberto] = useState(null);
  useEffect(() => { setAberto(null); }, [chave]);
  // Na tela estreita (celular), a lista troca de colunas para duas linhas por item.
  const caixaLista = useRef(null);
  const [estreito, setEstreito] = useState(false);
  useEffect(() => {
    const el = caixaLista.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setEstreito(e.contentRect.width < 480));
    ro.observe(el);
    return () => ro.disconnect();
  });

  const rotulos = (pontos || []).map((p) => p.rotulo);
  // Ao apontar, a semana aparece inteira; o eixo marca só a segunda-feira.
  const legendas = (pontos || []).map((p) => (montado.unidade === "semana" ? `${diaMes(p.ini)} a ${diaMes(p.fim)}` : p.rotulo));
  const medTotal = medias(total);
  // As duas faixas de datas que a média compara: os primeiros m pontos contra
  // os últimos m (com número ímpar de pontos, o do meio fica de fora).
  const curta = (d) => faixaDatas(d, d, true);
  const faixas = medTotal && pontos && pontos.length >= medTotal.n ? {
    antes: `${curta(pontos[0].ini)} a ${curta(pontos[medTotal.m - 1].fim)}`,
    agora: `${curta(pontos[pontos.length - medTotal.m].ini)} a ${curta(pontos[pontos.length - 1].fim)}`,
  } : null;
  const etiquetaMedias = faixas ? (
    <Comparando inicio="Comparando a média de" agora={faixas.agora} ligacao="com a de" antes={faixas.antes}
      fim={`· ${medTotal.m} ${medTotal.m === 1 ? montado?.unidade : PLURAL[montado?.unidade]} cada`} />
  ) : null;
  const somaTotal = total.reduce((s, v) => s + v, 0);
  const unidade = montado?.unidade;
  const mesFuturo = periodo === "atual" && pontos && pontos.length === 0;
  const nomeItens = visao === "linhas" ? "linhas" : "produtos";
  const maxDelta = Math.max(...itens.map((x) => Math.abs(x.delta)), 1);
  const frases = prontos ? montarFrases(itens, unidade, nomeItens) : [];
  // A porcentagem que mais engana: item pequeno com variação enorme.
  const enganosa = itens.filter((x) => x.peso < 0.01 && x.pct != null && Math.abs(x.pct) >= 100)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))[0];

  const quando = { atual: "Neste mês", passado: "No mês passado", tres: "Nos últimos 3 meses", seis: "Nos últimos 6 meses" }[periodo];
  const artigo = unidade === "mês" ? "o mês" : unidade === "dia" ? "o dia" : "a semana";
  const deltaTotal = medTotal ? medTotal.depois - medTotal.antes : 0;
  const pctTotal = medTotal && medTotal.antes > 0 ? (deltaTotal / medTotal.antes) * 100 : null;

  const chip = (ativo) => ({
    padding: "6px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
    border: ativo ? "1px solid #22231F" : "1px solid #E8E2D2",
    background: ativo ? "#22231F" : "#FFFFFF", color: ativo ? "#F3EFE3" : "#55534A",
  });
  const grupo = { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 };
  const cartao = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div>
        <div style={grupo}>
          {PERIODOS.map((p) => <button key={p.chave} onClick={() => setPeriodo(p.chave)} style={chip(periodo === p.chave)}>{p.label}</button>)}
        </div>
        <div style={grupo}>
          <button onClick={() => setVisao("linhas")} style={chip(visao === "linhas")}>Por linha</button>
          <button onClick={() => setVisao("produtos")} style={chip(visao === "produtos")}>20 principais produtos</button>
        </div>
        {!semMeses && (
          <div style={{ ...grupo, marginBottom: 0 }}>
            <button onClick={() => setGranularidade("mes")} style={chip(gran === "mes")}>Por mês</button>
            <button onClick={() => setGranularidade("semana")} style={chip(gran === "semana")}>Por semana</button>
          </div>
        )}
      </div>

      {erro ? (
        <div style={{ ...cartao, display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#8E2F1D" }}>
          <AlertTriangle size={16} /> {erro}
        </div>
      ) : !montado ? (
        <div style={{ ...cartao, fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : pontos.length === 0 ? (
        <div style={{ ...cartao, fontSize: 13, color: "#55534A", lineHeight: 1.55 }}>
          {mesFuturo
            ? "Este mês ainda não tem dia fechado. A linha do tempo começa quando o primeiro dia encerrar."
            : "Não há histórico completo neste período."}
        </div>
      ) : !prontos ? (
        <div style={{ ...cartao, display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#8A8778" }}>
          <Loader2 size={15} /> Somando {progresso}…
        </div>
      ) : itens.length === 0 ? (
        <div style={{ ...cartao, fontSize: 13, color: "#55534A" }}>
          Ainda não há venda detalhada por item neste período.
        </div>
      ) : (
        <>
          <div style={cartao}>
            {medTotal ? (
              <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 19, lineHeight: 1.4, color: "#22231F" }}>
                {quando}, {artigo} passou de vender <b>{mil(medTotal.antes)}</b> para{" "}
                <b style={{ color: deltaTotal >= 0 ? VERDE : VERMELHO_BARRA }}>{mil(medTotal.depois)}</b>.
                {Math.abs(deltaTotal) >= 1 && (
                  <> São <b style={{ color: deltaTotal >= 0 ? VERDE : VERMELHO_BARRA }}>{mil(deltaTotal)} {deltaTotal >= 0 ? "a mais" : "a menos"} por {unidade}</b>{pctTotal != null ? ` (${pctDe(pctTotal)})` : ""}.</>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 14, fontWeight: 700, color: "#22231F" }}>
                {visao === "linhas" ? "Total de todas as linhas" : `Total dos ${QUANTOS_PRODUTOS} principais`}: {brl(somaTotal)}
              </div>
            )}
            <div style={{ fontSize: 12, color: "#8A8778", margin: "6px 0 8px", lineHeight: 1.5 }}>
              {diaMes(pontos[0].ini)} a {diaMes(pontos[pontos.length - 1].fim)}, por {unidade} · {brl(somaTotal)} no período
              {visao === "produtos" ? ` (só os ${QUANTOS_PRODUTOS} principais)` : ""}.
            </div>
            {etiquetaMedias && <div style={{ marginBottom: 8 }}>{etiquetaMedias}</div>}
            <Grafico valores={total} rotulos={rotulos} cor={AZUL} nome="Total do período" foco={focoTotal} onFoco={setFocoTotal} med={medTotal} />
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11.5, color: NEUTRO, marginTop: 4 }}>
              <Legenda cor={AZUL}>venda da {unidade}</Legenda>
              {medTotal && <Legenda cor={NEUTRO} tracejado>média de {faixas ? faixas.antes : "antes"}</Legenda>}
              {medTotal && <Legenda cor={VERDE} tracejado>média de {faixas ? faixas.agora : "agora"}</Legenda>}
            </div>
            <div style={{ fontSize: 12, color: "#55534A", minHeight: 18, marginTop: 4 }}>
              {focoTotal != null && `${unidade === "semana" ? "Semana de " : ""}${legendas[focoTotal]}: ${brl(total[focoTotal])}`}
            </div>
          </div>

          {medTotal && (
            <div ref={caixaLista} style={cartao}>
              {etiquetaMedias && <div style={{ marginBottom: 8 }}>{etiquetaMedias}</div>}
              <div style={{ fontSize: 15, fontWeight: 800, color: "#22231F" }}>Quem fez a diferença</div>
              <div style={{ fontSize: 12, color: "#8A8778", marginTop: 2, lineHeight: 1.45 }}>
                Em reais por {unidade}, {visao === "linhas" ? "todas as linhas" : "todos os produtos"} na mesma régua. A ordem é de quanto cada um somou ou tirou, não da porcentagem. Toque para ver o gráfico.
              </div>
              {!estreito && <div style={{ display: "grid", gridTemplateColumns: GRADE_LISTA, gap: 8, fontSize: 10.5, color: NEUTRO, fontWeight: 700,
                textTransform: "uppercase", letterSpacing: 0.3, padding: "12px 0 6px" }}>
                <span>{visao === "linhas" ? "linha" : "produto"} · peso</span>
                <span style={{ textAlign: "right" }}>média por {unidade}{faixas && <span style={{ display: "block", textTransform: "none", fontWeight: 600 }}>{faixas.antes} → {faixas.agora}</span>}</span>
                <span style={{ textAlign: "center" }}>diferença</span>
                <span style={{ textAlign: "right" }}>variação</span>
              </div>}
              {itens.map((item) => (
                <ItemDiferenca key={item.nome} item={item} maxDelta={maxDelta} rotulos={rotulos} legendas={legendas} unidade={unidade} faixas={faixas}
                  estreito={estreito} aberto={aberto === item.nome} onAbrir={() => setAberto(aberto === item.nome ? null : item.nome)} />
              ))}
              {itens.some((x) => x.peso < 0.01) && (
                <div style={{ fontSize: 11.5, color: "#55534A", marginTop: 10, lineHeight: 1.5 }}>
                  Quem tem menos de 1% da venda aparece apagado: com pouco volume, a porcentagem engana.
                  {enganosa && ` ${enganosa.nome} "${pctDe(enganosa.pct)}" são só ${mil(enganosa.delta)} ${enganosa.delta >= 0 ? "a mais" : "a menos"} por ${unidade}.`}
                </div>
              )}
            </div>
          )}

          {frases.length > 0 && (
            <div style={cartao}>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#22231F" }}>Em uma frase</div>
              <div style={{ display: "grid", gap: 9, marginTop: 10 }}>
                {frases.map((f, i) => {
                  const Icone = f.tipo === "bom" ? CheckCircle2 : f.tipo === "atencao" ? AlertTriangle : PieChart;
                  const cor = f.tipo === "bom" ? VERDE : f.tipo === "atencao" ? "#B07D12" : "#55534A";
                  return (
                    <div key={i} style={{ display: "flex", gap: 9, fontSize: 13, lineHeight: 1.5, color: "#22231F" }}>
                      <Icone size={17} color={cor} style={{ flexShrink: 0, marginTop: 2 }} /><span>{f.texto}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ fontSize: 11, color: "#8A8778", lineHeight: 1.55 }}>
            {unidade === "semana" && "Só entram semanas inteiras, de segunda a domingo, e a data marcada é a segunda-feira. "}
            O dia em andamento nunca entra.
            {montado.foraDoHistorico.length > 0 && ` ${montado.foraDoHistorico.join(", ").replace(/^./, (c) => c.toUpperCase())} tem só parte do mês e ficou de fora: veja por semana.`}
          </div>
        </>
      )}
    </div>
  );
}
