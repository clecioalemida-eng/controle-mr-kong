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
import { Loader2, AlertTriangle } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

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
function corDe(p) { return p == null ? NEUTRO : p >= 0 ? AZUL : VERMELHO; }
function palavraDe(p) {
  if (p == null) return "sem base";
  if (Math.abs(p) < 0.5) return "estável";
  return p > 0 ? "subindo" : "caindo";
}
function pctDe(p) {
  if (p == null) return "—";
  const r = Math.round(p);
  return r === 0 ? "0%" : `${r > 0 ? "+" : "−"}${Math.abs(r)}%`;
}

function Grafico({ valores, rotulos, cor, grande, nome, foco, onFoco }) {
  // Com muitas semanas, as datas do gráfico grande ficam inclinadas: assim
  // cabe a data de todo ponto. As linhas pequenas marcam todo ponto, mas
  // escrevem só algumas datas, para os textos não se sobreporem.
  const inclinadas = grande && rotulos.length > 10;
  const W = grande ? 640 : 320;
  const H = grande ? (inclinadas ? 200 : 176) : 70;
  const pl = grande ? 52 : 4, pr = grande ? 12 : 10, pt = grande ? 10 : 8;
  const pb = grande ? (inclinadas ? 46 : 22) : 22;
  const max = Math.max(...valores, 1);
  // O total parte do zero, para o tamanho da subida ser honesto. As linhas
  // pequenas usam a própria escala: senão quem vende pouco vira um traço reto.
  const min = grande ? 0 : Math.min(...valores);
  const faixa = max - min || 1;
  const X = (i) => pl + (valores.length > 1 ? i / (valores.length - 1) : 0.5) * (W - pl - pr);
  const Y = (v) => pt + (1 - (v - min) / faixa) * (H - pt - pb);
  const caminho = valores.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const passo = grande ? 1 : Math.max(1, Math.ceil(rotulos.length / 8));
  const baseY = H - pb;
  const mover = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pl) / (W - pl - pr)) * (valores.length - 1));
    onFoco(Math.max(0, Math.min(valores.length - 1, i)));
  };
  const comPontos = grande && valores.length <= 6;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={nome}
      style={{ display: "block", touchAction: "pan-y" }}
      onPointerMove={mover} onPointerDown={mover} onPointerLeave={() => onFoco(null)}>
      {grande && [0, 0.5, 1].map((f) => (
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
            <text x={X(i)} y={baseY + 15} textAnchor={i === 0 && valores.length > 1 ? "start" : "middle"} fontSize="11" fill={grande ? "#55534A" : NEUTRO}>{t}</text>
          ) : null}
        </g>
      ))}
      <path d={caminho} fill="none" stroke={cor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {valores.map((v, i) => <circle key={i} cx={X(i)} cy={Y(v)} r={comPontos ? 4 : grande ? 3 : 2.5} fill={cor} stroke="#FFFFFF" strokeWidth="1" />)}
      {foco != null && (
        <>
          <line x1={X(foco)} x2={X(foco)} y1={pt} y2={H - pb} stroke="#C9BFA6" />
          <circle cx={X(foco)} cy={Y(valores[foco])} r="4" fill={cor} stroke="#FFFFFF" strokeWidth="2" />
        </>
      )}
    </svg>
  );
}

function LinhaItem({ item, rotulos, legendas, primeira }) {
  const [foco, setFoco] = useState(null);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 32%) minmax(0, 1fr) 72px", gap: 10, alignItems: "center",
                  padding: "6px 0", borderTop: primeira ? "none" : "1px solid #EFE9DA" }}>
      <div style={{ minWidth: 0 }}>
        <div title={item.nome} style={{ fontSize: 12.5, color: "#22231F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.nome}</div>
        <div style={{ fontSize: 11, color: "#8A8778", fontVariantNumeric: "tabular-nums" }}>
          {foco != null ? `${legendas[foco]}: ${brl(item.valores[foco])}` : brl(item.total)}
        </div>
      </div>
      <Grafico valores={item.valores} rotulos={rotulos} cor={corDe(item.tendencia)} nome={item.nome} foco={foco} onFoco={setFoco} />
      <div style={{ textAlign: "right" }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#22231F", fontVariantNumeric: "tabular-nums" }}>{pctDe(item.tendencia)}</div>
        <div style={{ fontSize: 11, color: "#8A8778" }}>{palavraDe(item.tendencia)}</div>
      </div>
    </div>
  );
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
      nome, valores, total: valores.reduce((s, v) => s + v, 0), tendencia: tendencia(valores),
    })).filter((x) => x.total > 0);
    if (visao === "produtos") lista = lista.sort((a, b) => b.total - a.total).slice(0, QUANTOS_PRODUTOS);
    // Quem sobe vem primeiro; quem não tem base para comparar fica no fim.
    lista = lista.sort((a, b) => (b.tendencia ?? -Infinity) - (a.tendencia ?? -Infinity) || b.total - a.total);
    return { total: prontos.map((_, i) => lista.reduce((s, x) => s + x.valores[i], 0)), itens: lista };
  }, [prontos, visao]);

  const rotulos = (pontos || []).map((p) => p.rotulo);
  // Ao apontar, a semana aparece inteira; o eixo marca só a segunda-feira.
  const legendas = (pontos || []).map((p) => (montado.unidade === "semana" ? `${diaMes(p.ini)} a ${diaMes(p.fim)}` : p.rotulo));
  const tendenciaTotal = tendencia(total);
  const somaTotal = total.reduce((s, v) => s + v, 0);
  const unidade = montado?.unidade;
  const mesFuturo = periodo === "atual" && pontos && pontos.length === 0;

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
            <div style={{ fontSize: 14, fontWeight: 700, color: "#22231F" }}>
              {visao === "linhas" ? "Total de todas as linhas" : `Total dos ${QUANTOS_PRODUTOS} principais`}
              {tendenciaTotal != null && `: ${palavraDe(tendenciaTotal)} ${pctDe(tendenciaTotal).replace(/^[+−]/, "")}`}
            </div>
            <div style={{ fontSize: 12, color: "#8A8778", margin: "2px 0 8px" }}>
              {diaMes(pontos[0].ini)} a {diaMes(pontos[pontos.length - 1].fim)}, por {unidade} · {brl(somaTotal)}
            </div>
            <Grafico valores={total} rotulos={rotulos} cor={corDe(tendenciaTotal)} grande nome="Total do período"
              foco={focoTotal} onFoco={setFocoTotal} />
            <div style={{ fontSize: 12, color: "#55534A", minHeight: 18, marginTop: 2 }}>
              {focoTotal != null && `${unidade === "semana" ? "Semana de " : ""}${legendas[focoTotal]}: ${brl(total[focoTotal])}`}
            </div>
          </div>

          <div style={{ ...cartao, padding: "6px 14px" }}>
            {itens.map((item, i) => <LinhaItem key={item.nome} item={item} rotulos={rotulos} legendas={legendas} primeira={i === 0} />)}
          </div>

          <div style={{ fontSize: 11, color: "#8A8778", lineHeight: 1.55 }}>
            A porcentagem compara a primeira metade do período com a segunda.
            {unidade === "semana" && " Só entram semanas inteiras, de segunda a domingo, e a data marcada é a segunda-feira."}
            {" "}O dia em andamento nunca entra. Cada linha pequena usa a própria escala, então compare pelo valor em R$.
            {montado.foraDoHistorico.length > 0 && ` ${montado.foraDoHistorico.join(", ").replace(/^./, (c) => c.toUpperCase())} tem só parte do mês e ficou de fora: veja por semana.`}
          </div>
        </>
      )}
    </div>
  );
}
