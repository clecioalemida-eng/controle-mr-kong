// ===== ComercialDiaItens.jsx =====
// Comercial → Dia: "O que saiu no dia", em números.
//
// Quantos combos, hambúrgueres artesanais (linha Gourmet), tradicionais e
// todas as linhas e produtos vendidos no dia, contra o mesmo dia da semana
// passada (a mesma comparação do cartão do topo).
//
// Fontes, as mesmas do resto do Comercial:
//   desempenho_produtos (migração 079) → quantidade e R$ por produto, com
//                                         a linha de cada um
//   venda_por_item (migração 193)      → separa os combos em montados
//                                         (lanche + "bebida + fritas") e
//                                         fechados (das plataformas)
// As duas leem pedidos_cache, que o robô grava depois que a noite fecha.
// Na noite em andamento o bloco avisa em vez de mostrar zero.

import React, { useState, useEffect } from "react";
import { Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { ultimoDiaFechado } from "./ComercialLinhaTempo";
import { Comparando } from "./ComercialMes";
import { desmontarItens } from "./ComercialItens";

const ESCURO = "#22231F", CINZA = "#8A8778", VERDE = "#2F8F5B", VERMELHO = "#C4432B";
const SEMANA = ["dom.", "seg.", "ter.", "qua.", "qui.", "sex.", "sáb."];

function somarDias(s, n) {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(y, m - 1, d + n);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}
function rotuloDia(s) {
  const [y, m, d] = s.split("-").map(Number);
  return `${SEMANA[new Date(y, m - 1, d).getDay()]} ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}
function brl(v) { return "R$ " + Math.round(Number(v) || 0).toLocaleString("pt-BR"); }
function un(v) { return Math.round(Number(v) || 0).toLocaleString("pt-BR"); }
function variacao(a, b) {
  if (!b) return a ? { texto: "novo", cor: "#2F6FA3" } : { texto: "", cor: CINZA };
  const p = Math.round(((a - b) / b) * 100);
  return { texto: p === 0 ? "igual" : `${p > 0 ? "+" : "−"}${Math.abs(p)}%`, cor: p > 0 ? VERDE : p < 0 ? VERMELHO : CINZA };
}

// Busca e soma, por linha, o que saiu em dois períodos (atual e anterior).
// Também usada pelo relatório do mês (ComercialPeriodo.jsx).
export async function carregarComparado(args) {
  const [rp, ri] = await Promise.all([supabase.rpc("desempenho_produtos", args), supabase.rpc("venda_por_item", args)]);
  if (rp.error) {
    throw new Error(/sem_acesso|permission|denied/i.test(rp.error.message || "") ? "Seu cargo não vê a venda por produto." : rp.error.message);
  }
  return { linhas: montarLinhas(rp.data || [], 2), combos: ri.error ? null : desmontarItens(ri.data || [], []).combos };
}

// Linhas de desempenho_produtos → por linha de produto, com os produtos
// dentro. `n` períodos: cada entrada de `respostas` é [resposta, posA, posB].
export function montarLinhas(dados, n = 2, posicoes = [0, 1]) {
  return juntarLinhas([[dados, posicoes[0], posicoes[1]]], n);
}
export function juntarLinhas(respostas, n) {
  const porProduto = new Map();
  respostas.forEach(([dados, a, b]) => (dados || []).forEach((p) => {
    const chave = p.produto;
    if (!porProduto.has(chave)) {
      porProduto.set(chave, { produto: p.produto, linha: String(p.linha || "").trim() || "Sem linha definida", q: Array(n).fill(0), v: Array(n).fill(0) });
    }
    const x = porProduto.get(chave);
    if (String(p.linha || "").trim()) x.linha = String(p.linha).trim();
    x.q[a] = Number(p.qtd_atual) || 0; x.v[a] = Number(p.valor_atual) || 0;
    if (b != null && b !== a) { x.q[b] = Number(p.qtd_ant) || 0; x.v[b] = Number(p.valor_ant) || 0; }
  }));
  const porLinha = new Map();
  [...porProduto.values()].filter((p) => p.q.some(Boolean)).forEach((p) => {
    if (!porLinha.has(p.linha)) porLinha.set(p.linha, { linha: p.linha, q: Array(n).fill(0), v: Array(n).fill(0), produtos: [] });
    const l = porLinha.get(p.linha);
    for (let k = 0; k < n; k++) { l.q[k] += p.q[k]; l.v[k] += p.v[k]; }
    l.produtos.push(p);
  });
  const linhas = [...porLinha.values()].sort((a, b) => b.v[0] - a.v[0] || b.q[0] - a.q[0]);
  linhas.forEach((l) => l.produtos.sort((a, b) => b.q[0] - a.q[0] || b.v[0] - a.v[0]));
  return linhas;
}

export default function ComercialDiaItens({ dia, pedidos }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const semana = somarDias(dia, -7);
  const emAndamento = dia > ultimoDiaFechado();

  useEffect(() => {
    if (emAndamento) { setDados(null); return; }
    let vivo = true;
    setDados(null); setErro("");
    const args = { p_inicio: dia, p_fim: dia, p_inicio_ant: semana, p_fim_ant: semana };
    carregarComparado(args)
      .then((d) => { if (vivo) setDados(d); })
      .catch((e) => { if (vivo) setErro(e.message || String(e)); });
    return () => { vivo = false; };
  }, [dia]); // eslint-disable-line

  if (emAndamento) {
    return <div style={{ ...card, fontSize: 12.5, color: "#5C5A4E" }}>O detalhe por produto desta noite chega depois que ela fechar: o robô grava os pedidos de madrugada.</div>;
  }
  if (erro) return <div style={{ ...card, fontSize: 12.5, color: "#8A6A0F" }}>{erro}</div>;
  if (!dados) return <div style={{ ...card, fontSize: 12.5, color: CINZA, display: "flex", gap: 6, alignItems: "center" }}><Loader2 size={13} /> Contando o que saiu no dia…</div>;
  if (!dados.linhas.length) return <div style={{ ...card, fontSize: 12.5, color: CINZA }}>Nenhum produto vendido registrado em {rotuloDia(dia)}.</div>;

  return (
    <QuadroComparado dados={dados} pedidos={pedidos} rotuloAnt={rotuloDia(semana)} colAnt={rotuloDia(semana).slice(5)}
      etiqueta={<Comparando agora={rotuloDia(dia)} antes={rotuloDia(semana)} fim="· mesmo dia da semana passada" />} />
  );
}

// Os quatro números e a lista de linhas com os produtos, atual contra
// anterior. Usado pelo Dia e pelo modo Mês do relatório do período.
export function QuadroComparado({ dados, pedidos, etiqueta, rotuloAnt, colAnt, semMoldura }) {
  const [aberta, setAberta] = useState(null);
  const acha = (re) => dados.linhas.find((l) => re.test(l.linha));
  const lCombos = acha(/combo/i), lArtesanal = acha(/gourmet|artesanal/i), lTradicional = acha(/tradicional/i);
  const c = dados.combos;

  return (
    <div style={semMoldura ? {} : card}>
      {etiqueta}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8, margin: "10px 0 12px" }}>
        {lCombos && (
          <Numero titulo="Combos" q={lCombos.q}
            extra={c && (c.montado[0] || c.fechado[0]) ? `${un(c.montado[0])} montados · ${un(c.fechado[0])} das plataformas` : ""} />
        )}
        {lArtesanal && <Numero titulo="Hambúrguer artesanal" q={lArtesanal.q} extra={lArtesanal.linha} />}
        {lTradicional && <Numero titulo="Hambúrguer tradicional" q={lTradicional.q} extra={lTradicional.linha} />}
        {pedidos != null && <Numero titulo="Pedidos" q={[pedidos, null]} />}
      </div>

      <div style={{ ...grade, fontSize: 11, color: CINZA, fontWeight: 700, padding: "0 0 6px" }}>
        <span>Linha</span><span style={dir}>Qtd</span><span style={dir}>R$</span><span style={dir}>vs {colAnt}</span>
      </div>
      {dados.linhas.map((l) => {
        const vl = variacao(l.q[0], l.q[1]);
        const aberto = aberta === l.linha;
        return (
          <div key={l.linha} style={{ borderTop: "1px solid #EFE9DA" }}>
            <div onClick={() => setAberta(aberto ? null : l.linha)} style={{ ...grade, padding: "8px 0", cursor: "pointer", fontSize: 13.5, color: ESCURO }}>
              <span style={{ display: "flex", gap: 4, alignItems: "center", minWidth: 0 }}>
                {aberto ? <ChevronDown size={13} color={CINZA} /> : <ChevronRight size={13} color={CINZA} />}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.linha}</span>
              </span>
              <span style={{ ...dir, fontWeight: 800 }}>{un(l.q[0])}</span>
              <span style={dir}>{brl(l.v[0])}</span>
              <span style={{ ...dir, color: vl.cor, fontWeight: 700, fontSize: 12 }}>{vl.texto}</span>
            </div>
            {aberto && l.produtos.map((p) => {
              const d = p.q[0] - p.q[1];
              return (
                <div key={p.produto} style={{ ...grade, padding: "4px 0 4px 18px", fontSize: 12.5, color: "#5C5A4E" }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.produto}>{p.produto}</span>
                  <span style={{ ...dir, color: ESCURO, fontWeight: 700 }}>{un(p.q[0])}</span>
                  <span style={dir}>{brl(p.v[0])}</span>
                  <span style={{ ...dir, fontSize: 12, color: d > 0 ? VERDE : d < 0 ? VERMELHO : CINZA }}>{d === 0 ? "=" : `${d > 0 ? "+" : "−"}${un(Math.abs(d))}`}</span>
                </div>
              );
            })}
          </div>
        );
      })}
      <div style={{ fontSize: 11.5, color: CINZA, marginTop: 8 }}>
        Toque numa linha para ver cada produto. Nos produtos, a última coluna é quantas unidades a mais ou a menos que em {rotuloAnt}.
      </div>
    </div>
  );
}

function Numero({ titulo, q, extra }) {
  const vr = q[1] == null ? null : variacao(q[0], q[1]);
  return (
    <div style={{ background: "#F7F3E9", borderRadius: 10, padding: "10px 12px", minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "#5C5A4E" }}>{titulo}</div>
      <div style={{ fontSize: 24, fontWeight: 800, color: ESCURO, fontVariantNumeric: "tabular-nums" }}>{un(q[0])}</div>
      {vr && vr.texto && <div style={{ fontSize: 12, fontWeight: 700, color: vr.cor }}>{vr.texto}{q[1] ? <span style={{ color: CINZA, fontWeight: 400 }}> · era {un(q[1])}</span> : null}</div>}
      {extra && <div style={{ fontSize: 11, color: CINZA, marginTop: 2, lineHeight: 1.35 }}>{extra}</div>}
    </div>
  );
}

const card = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const grade = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 48px 82px 54px", gap: 8, alignItems: "center" };
const dir = { textAlign: "right", fontVariantNumeric: "tabular-nums" };
