// ===== ComercialPeriodo.jsx =====
// Comercial → Mês: "O que saiu no período".
//
// Mês: o mesmo quadro do Dia (combos, artesanal, tradicional e todas as
//      linhas e produtos), do dia 1 até a última noite fechada, contra os
//      mesmos dias do mês anterior.
// Trimestre, Semestre, Ano: linha do tempo mês a mês, uma coluna por mês,
//      por linha de produto (e por produto, tocando na linha). Dá para ver
//      em quantidade, em R$ ou por dia. "Por dia" divide cada mês pelas
//      noites em que a casa vendeu, e assim o mês em andamento já compara
//      de igual para igual com os fechados.
//
// Fontes: desempenho_produtos (079) e venda_por_item (193), as mesmas do
// Dia; vendas_diarias só para contar as noites abertas de cada mês.

import React, { useState, useEffect, useRef } from "react";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { ultimoDiaFechado, medias } from "./ComercialLinhaTempo";
import { Comparando, faixaDatas } from "./ComercialMes";
import { carregarComparado, juntarLinhas, QuadroComparado } from "./ComercialDiaItens";

const ESCURO = "#22231F", CINZA = "#8A8778", VERDE = "#2F8F5B", VERMELHO = "#C4432B";
const NOMES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const PERIODOS = [{ n: 1, label: "Mês" }, { n: 3, label: "Trimestre" }, { n: 6, label: "Semestre" }, { n: 12, label: "Ano" }];
const MODOS = [{ m: "q", label: "Qtd" }, { m: "v", label: "R$" }, { m: "dia", label: "Por dia" }];

const dois = (n) => String(n).padStart(2, "0");
function ymd(y, m0, d) { return `${y}-${dois(m0 + 1)}-${dois(d)}`; }
function diasDoMes(y, m0) { return new Date(y, m0 + 1, 0).getDate(); }
function curto(y, m0, comAno) { return NOMES[m0].slice(0, 3) + (comAno ? `/${String(y).slice(2)}` : ""); }
function un(v, casas = 0) { return (Number(v) || 0).toLocaleString("pt-BR", { maximumFractionDigits: casas, minimumFractionDigits: casas }); }
function mil(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) < 1000) return "R$ " + Math.round(n).toLocaleString("pt-BR");
  return "R$ " + (n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil";
}

// A última noite fechada até o dia do relatório. Se o mês ainda não tem
// noite fechada (dia 1), o relatório olha o mês anterior inteiro.
function fimFechado(dia) {
  const f = ultimoDiaFechado();
  return dia < f ? dia : f;
}

// Janelas mensais, da mais antiga para a mais nova; a última termina na
// última noite fechada e pode estar pela metade.
function janelasMensais(fim, n) {
  const [y, m, d] = fim.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const k = n - 1 - i;
    const b = new Date(y, m - 1 - k, 1);
    const yy = b.getFullYear(), mm = b.getMonth(), dm = diasDoMes(yy, mm);
    const ate = k === 0 ? d : dm;
    return { y: yy, m0: mm, ini: ymd(yy, mm, 1), fim: ymd(yy, mm, ate), parcial: ate < dm, ate };
  });
}

export default function ComercialPeriodo({ dia }) {
  const [n, setN] = useState(1);
  const fim = fimFechado(dia);
  return (
    <div style={card}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 15, fontWeight: 800, color: ESCURO, marginRight: 6 }}>O que saiu no período</span>
        {PERIODOS.map((p) => <button key={p.n} onClick={() => setN(p.n)} style={chip(n === p.n)}>{p.label}</button>)}
      </div>
      {n === 1 ? <ModoMes fim={fim} /> : <LinhaDoTempo key={n} fim={fim} n={n} />}
    </div>
  );
}

// ---------------------------------------------------------------- Mês
function ModoMes({ fim }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [y, m, d] = fim.split("-").map(Number);
  const ini = ymd(y, m - 1, 1);
  const pa = new Date(y, m - 2, 1);
  const antIni = ymd(pa.getFullYear(), pa.getMonth(), 1);
  const antFim = ymd(pa.getFullYear(), pa.getMonth(), Math.min(d, diasDoMes(pa.getFullYear(), pa.getMonth())));

  useEffect(() => {
    let vivo = true;
    setDados(null); setErro("");
    carregarComparado({ p_inicio: ini, p_fim: fim, p_inicio_ant: antIni, p_fim_ant: antFim })
      .then((r) => { if (vivo) setDados(r); })
      .catch((e) => { if (vivo) setErro(e.message || String(e)); });
    return () => { vivo = false; };
  }, [fim]); // eslint-disable-line

  if (erro) return <div style={{ fontSize: 12.5, color: "#8A6A0F" }}>{erro}</div>;
  if (!dados) return <Carregando texto="Somando o mês…" />;
  if (!dados.linhas.length) return <div style={{ fontSize: 12.5, color: CINZA }}>Nenhum produto vendido registrado de {faixaDatas(ini, fim)}.</div>;
  const nomeAnt = NOMES[pa.getMonth()];
  return (
    <div>
      <QuadroComparado semMoldura dados={dados} rotuloAnt={faixaDatas(antIni, antFim)} colAnt={nomeAnt.slice(0, 3)}
        etiqueta={<Comparando agora={faixaDatas(ini, fim, true)} antes={faixaDatas(antIni, antFim, true)} fim="· só noites já fechadas" />} />
    </div>
  );
}

// ----------------------------------------------------- Linha do tempo
function LinhaDoTempo({ fim, n }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [modo, setModo] = useState("q");
  const [aberta, setAberta] = useState(null);
  const J = janelasMensais(fim, n);
  const comAno = J[0].y !== J[n - 1].y;

  useEffect(() => {
    let vivo = true;
    (async () => {
      setDados(null); setErro("");
      const pares = [];
      for (let i = 0; i < n; i += 2) pares.push([i, Math.min(i + 1, n - 1)]);
      const [rDias, ...resp] = await Promise.all([
        supabase.from("vendas_diarias").select("dia, faturamento_bruto").gte("dia", J[0].ini).lte("dia", J[n - 1].fim),
        ...pares.map(([a, b]) => supabase.rpc("desempenho_produtos",
          { p_inicio: J[a].ini, p_fim: J[a].fim, p_inicio_ant: J[b].ini, p_fim_ant: J[b].fim })),
      ]);
      if (!vivo) return;
      const falha = resp.find((r) => r.error);
      if (falha) { setErro(/sem_acesso|permission|denied/i.test(falha.error.message || "") ? "Seu cargo não vê a venda por produto." : falha.error.message); return; }
      const linhas = juntarLinhas(resp.map((r, k) => [r.data, pares[k][0], pares[k][1]]), n);
      // noites com venda em cada mês (para o "por dia")
      const noites = J.map((j) => (rDias.data || []).filter((x) => String(x.dia).slice(0, 10) >= j.ini && String(x.dia).slice(0, 10) <= j.fim && Number(x.faturamento_bruto) > 0).length);
      // mês sem nada no cache de pedidos: aparece vazio, não como zero
      const vazio = J.map((_, k) => !linhas.some((l) => l.q[k] > 0));
      setDados({ linhas, noites, vazio });
    })().catch((e) => { if (vivo) setErro(e.message || String(e)); });
    return () => { vivo = false; };
  }, [fim, n]); // eslint-disable-line

  if (erro) return <div style={{ fontSize: 12.5, color: "#8A6A0F" }}>{erro}</div>;
  if (!dados) return <Carregando texto={`Somando ${n} meses…`} />;

  const valor = (x, k) => {
    if (dados.vazio[k]) return null;
    if (modo === "v") return x.v[k];
    if (modo === "dia") return dados.noites[k] ? x.q[k] / dados.noites[k] : null;
    return x.q[k];
  };
  const fmt = (v) => (v == null ? "—" : modo === "v" ? mil(v) : modo === "dia" ? un(v, 1) : un(v));
  const ultimo = J[n - 1];
  const vazios = dados.vazio.filter(Boolean).length;

  const acha = (re) => dados.linhas.find((l) => re.test(l.linha));
  const destaques = [["Combos", acha(/combo/i)], ["Hambúrguer artesanal", acha(/gourmet|artesanal/i)], ["Hambúrguer tradicional", acha(/tradicional/i)]].filter(([, l]) => l);
  const larguraMes = modo === "v" ? 64 : 50;
  const grade = { display: "grid", gridTemplateColumns: `minmax(140px, 1fr) repeat(${n}, ${larguraMes}px) 66px`, gap: 4, alignItems: "center" };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <Comparando calendario inicio="Linha do tempo de" agora={comAno ? `${curto(J[0].y, J[0].m0, true)} a ${curto(ultimo.y, ultimo.m0, true)}` : `${NOMES[J[0].m0]} a ${NOMES[ultimo.m0]}`}
          fim={ultimo.parcial ? `· ${NOMES[ultimo.m0]} até dia ${ultimo.ate}` : ""} />
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {MODOS.map((x) => <button key={x.m} onClick={() => setModo(x.m)} style={chip(modo === x.m, true)}>{x.label}</button>)}
        </div>
      </div>

      {destaques.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8, marginBottom: 12 }}>
          {destaques.map(([titulo, l]) => {
            const vals = J.map((_, k) => valor(l, k));
            // média e tendência só com meses completos (ou por dia, que já é justo)
            const justos = vals.filter((v, k) => v != null && (modo === "dia" || !J[k].parcial));
            const porDia = J.map((_, k) => (dados.vazio[k] || !dados.noites[k] ? null : l.q[k] / dados.noites[k])).filter((v) => v != null);
            const med = medias(porDia);
            const tend = med && med.antes > 0 ? (med.depois - med.antes) / med.antes : 0;
            const melhorK = J.map((_, k) => (dados.vazio[k] || !dados.noites[k] ? -1 : l.q[k] / dados.noites[k])).reduce((bi, v, k, arr) => (v > arr[bi] ? k : bi), 0);
            return (
              <div key={titulo} style={{ background: "#F7F3E9", borderRadius: 10, padding: "10px 12px", minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "#5C5A4E" }}>{titulo} {modo === "dia" ? "por noite" : "por mês"}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: ESCURO, fontVariantNumeric: "tabular-nums" }}>
                  {justos.length ? fmt(justos.reduce((s, v) => s + v, 0) / justos.length) : "—"}
                </div>
                <Mini valores={vals} parcial={ultimo.parcial && modo !== "dia"} cor={tend > 0.05 ? VERDE : tend < -0.05 ? VERMELHO : CINZA} largura={130} altura={26} />
                <div style={{ fontSize: 12, fontWeight: 700, color: tend > 0.05 ? VERDE : tend < -0.05 ? VERMELHO : CINZA }}>
                  {tend > 0.05 ? "subindo" : tend < -0.05 ? "caindo" : "estável"}
                  <span style={{ color: CINZA, fontWeight: 400 }}> · melhor mês: {NOMES[J[melhorK].m0].slice(0, 3)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ overflowX: "auto", margin: "0 -4px", padding: "0 4px" }}>
        <div style={{ minWidth: 140 + n * (larguraMes + 4) + 70 }}>
          <div style={{ ...grade, fontSize: 11, color: CINZA, fontWeight: 700, padding: "0 0 6px" }}>
            <span>Linha</span>
            {J.map((j, k) => <span key={k} style={dir}>{curto(j.y, j.m0, comAno)}{j.parcial ? "*" : ""}</span>)}
            <span style={dir}>tendência</span>
          </div>
          {dados.linhas.map((l) => {
            const aberto = aberta === l.linha;
            const vals = J.map((_, k) => valor(l, k));
            return (
              <div key={l.linha} style={{ borderTop: "1px solid #EFE9DA" }}>
                <div onClick={() => setAberta(aberto ? null : l.linha)} style={{ ...grade, padding: "7px 0", cursor: "pointer", fontSize: 13 }}>
                  <span style={{ display: "flex", gap: 4, alignItems: "center", minWidth: 0 }}>
                    {aberto ? <ChevronDown size={13} color={CINZA} /> : <ChevronRight size={13} color={CINZA} />}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: ESCURO }}>{l.linha}</span>
                  </span>
                  {vals.map((v, k) => <span key={k} style={{ ...dir, color: v == null ? CINZA : ESCURO, fontWeight: k === n - 1 ? 800 : 400 }}>{fmt(v)}</span>)}
                  <span style={dir}><Mini valores={vals} parcial={ultimo.parcial && modo !== "dia"} largura={60} altura={16} /></span>
                </div>
                {aberto && l.produtos.map((p) => (
                  <div key={p.produto} style={{ ...grade, padding: "3px 0 3px 18px", fontSize: 12, color: "#5C5A4E" }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.produto}>{p.produto}</span>
                    {J.map((_, k) => <span key={k} style={dir}>{fmt(valor(p, k))}</span>)}
                    <span style={dir}><Mini valores={J.map((_, k) => valor(p, k))} parcial={ultimo.parcial && modo !== "dia"} largura={60} altura={14} /></span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: CINZA, marginTop: 8, lineHeight: 1.5 }}>
        {ultimo.parcial && `* ${NOMES[ultimo.m0][0].toUpperCase() + NOMES[ultimo.m0].slice(1)} ainda está em andamento: em quantidade e R$ ele aparece menor; em "por dia" já compara de igual para igual. `}
        {vazios > 0 && `${vazios} ${vazios === 1 ? "mês aparece" : "meses aparecem"} com "—": ainda não há pedidos desse período no cache. `}
        Toque numa linha para ver os produtos mês a mês.
      </div>
    </div>
  );
}

// Mini gráfico de linha. O último ponto oco quando o mês está pela metade.
function Mini({ valores, parcial, cor, largura, altura }) {
  const pts = valores.map((v, k) => ({ v, k })).filter((p) => p.v != null);
  if (pts.length < 2) return null;
  const max = Math.max(...pts.map((p) => p.v)), min = Math.min(...pts.map((p) => p.v));
  const x = (k) => 3 + (k / Math.max(valores.length - 1, 1)) * (largura - 6);
  const y = (v) => 3 + (1 - (v - min) / (max - min || 1)) * (altura - 6);
  const corFinal = cor || (pts[pts.length - 1].v >= pts[0].v ? VERDE : VERMELHO);
  const ult = pts[pts.length - 1];
  return (
    <svg width={largura} height={altura} style={{ display: "inline-block", verticalAlign: "middle" }}>
      <polyline fill="none" stroke={corFinal} strokeWidth="1.7" points={pts.map((p) => `${x(p.k).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ")} />
      <circle cx={x(ult.k)} cy={y(ult.v)} r="2.4" fill={parcial ? "#FFFFFF" : corFinal} stroke={corFinal} strokeWidth="1.2" />
    </svg>
  );
}

function Carregando({ texto }) {
  return <div style={{ fontSize: 12.5, color: CINZA, display: "flex", gap: 6, alignItems: "center" }}><Loader2 size={13} /> {texto}</div>;
}

const card = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const dir = { textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
function chip(ativo, pequeno) {
  return {
    padding: pequeno ? "4px 9px" : "6px 12px", borderRadius: 999, fontSize: pequeno ? 11.5 : 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
    border: ativo ? "1px solid #22231F" : "1px solid #E8E2D2",
    background: ativo ? "#22231F" : "#FFFFFF", color: ativo ? "#F3EFE3" : "#55534A",
  };
}
