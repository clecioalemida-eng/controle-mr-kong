// ===== DREDespesas.jsx =====
// Financeiro → DRE → Despesas: para onde vai o dinheiro.
//
// Usa o MESMO cálculo do Demonstrativo (função dre_mensal), um mês por
// chamada. Assim os números batem com o DRE e não há conta nova no banco.
//
// O que conta como despesa: toda conta do plano (nível 1) fora da receita
// (1.x) e fora da taxa de serviço (2.5), que é repasse ao garçom e não gasto
// da casa. CMV, impostos, taxas, pessoal, ocupação etc. entram.
//
// Período: 1, 3 ou 6 meses terminando no mês escolhido, sempre comparado
// com o período anterior do mesmo tamanho. O histórico mostra os últimos
// 6 meses (12 quando o período é de 6), com o período escolhido em destaque.
// Tocar numa conta abre os fornecedores dela (dre_origem_despesa, a mesma
// lista do Demonstrativo).

import React, { useState, useEffect, useRef } from "react";
import { Loader2, AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { Comparando } from "./ComercialMes";

const NOMES_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const PERIODOS = [{ n: 1, label: "Mês" }, { n: 3, label: "3 meses" }, { n: 6, label: "6 meses" }];
const CORES_GRUPO = ["#5C5A4E", "#2F8F5B", "#B07D12", "#6E66C9", "#2A78D6", "#B9B4A2"];
const VERDE = "#2F8F5B", VERMELHO = "#C4432B", CINZA = "#8A8778", ESCURO = "#22231F";

// Linhas que não têm lançamento para abrir (são calculadas), como no Demonstrativo.
function tipoDaConta(codigo) {
  const c = String(codigo || "");
  if (c === "2.1" || c === "3.2") return "fórmula sobre a receita (aba Configuração)";
  if (c === "3.1") return "consumo pelas fichas técnicas (Supply Chain)";
  if (c === "3.3") return "perdas lançadas no estoque";
  if (c === "2.2" || c === "2.3") return "taxas das formas de pagamento dos pedidos";
  if (c === "10.1") return "depreciação do imobilizado";
  return null; // despesa com lançamentos
}

function mesStr(y, m0) { return `${y}-${String(m0 + 1).padStart(2, "0")}`; }
function mesAnterior(mes, k = 1) {
  const [y, m] = mes.split("-").map(Number);
  const d = new Date(y, m - 1 - k, 1);
  return mesStr(d.getFullYear(), d.getMonth());
}
function mesDeHoje() { const d = new Date(); return mesStr(d.getFullYear(), d.getMonth()); }
function curto(mes, comAno) {
  const [y, m] = mes.split("-").map(Number);
  return NOMES_MES[m - 1].slice(0, 3) + (comAno ? `/${String(y).slice(2)}` : "");
}
function longo(mes) { const [y, m] = mes.split("-").map(Number); return `${NOMES_MES[m - 1]} de ${y}`; }
// ["2026-08","2026-09","2026-10"] → "ago a out" (com ano se atravessa a virada)
function nomePeriodo(lista) {
  if (lista.length === 1) return longo(lista[0]);
  const ini = lista[0], fim = lista[lista.length - 1];
  const comAno = ini.slice(0, 4) !== fim.slice(0, 4);
  return `${curto(ini, comAno)} a ${curto(fim, comAno)}`;
}
function brl(v) { return "R$ " + Math.round(Number(v) || 0).toLocaleString("pt-BR"); }
function mil(v) {
  const n = Number(v) || 0;
  if (Math.abs(n) < 1000) return brl(n);
  return "R$ " + (n / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil";
}
function pctTxt(p) { const r = Math.round(p); return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)}%`; }

// Uma resposta do dre_mensal → receita e despesas por conta, com o grupo.
function lerMes(mes, linhas) {
  let grupo = "";
  let receita = 0;
  const contas = [];
  (linhas || []).forEach((l) => {
    const codigo = String(l.codigo || "");
    const ehSubtotal = l.secao === "subtotal";
    if (codigo === "1") receita = Number(l.valor) || 0;
    if (Number(l.nivel) === 0 && !ehSubtotal) { grupo = l.nome; return; }
    if (Number(l.nivel) !== 1 || ehSubtotal) return;
    if (codigo.startsWith("1.") || codigo === "2.5") return;
    const valor = -(Number(l.valor) || 0); // no DRE a despesa vem negativa
    contas.push({ codigo, nome: l.nome, grupo, valor });
  });
  return { mes, receita, contas, total: contas.reduce((s, c) => s + c.valor, 0) };
}

export default function DREDespesas({ irPara }) {
  const [mesFim, setMesFim] = useState(() => mesAnterior(mesDeHoje()));
  const [n, setN] = useState(3);
  const [dados, setDados] = useState({});           // mes → lerMes()
  const [progresso, setProgresso] = useState(null);
  const [erro, setErro] = useState("");
  const [semClassificar, setSemClassificar] = useState(0);
  const [aberta, setAberta] = useState(null);
  const cache = useRef({});

  const quantos = Math.max(6, 2 * n);
  const mesesHist = Array.from({ length: quantos }, (_, i) => mesAnterior(mesFim, quantos - 1 - i));
  const periodo = mesesHist.slice(-n);
  const anterior = mesesHist.slice(-2 * n, -n);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setErro("");
      const faltam = mesesHist.filter((m) => !cache.current[m]);
      let feitos = 0;
      if (faltam.length) setProgresso({ feitos: 0, total: faltam.length });
      // de 3 em 3, para não pedir 12 cálculos de uma vez
      for (let i = 0; i < faltam.length; i += 3) {
        const lote = faltam.slice(i, i + 3);
        const resp = await Promise.all(lote.map((m) => supabase.rpc("dre_mensal", { p_mes: m })));
        if (!vivo) return;
        const falha = resp.find((r) => r.error);
        if (falha) { setErro(falha.error.message || "Não deu para calcular o DRE."); setProgresso(null); return; }
        lote.forEach((m, k) => { cache.current[m] = lerMes(m, resp[k].data); });
        feitos += lote.length;
        setProgresso({ feitos, total: faltam.length });
      }
      if (!vivo) return;
      setDados({ ...cache.current });
      setProgresso(null);
    })();
    return () => { vivo = false; };
  }, [mesFim, n]); // eslint-disable-line

  useEffect(() => {
    supabase.from("contas_pagar").select("id", { count: "exact", head: true }).is("plano_conta", null)
      .then(({ count }) => setSemClassificar(count || 0));
  }, []);

  const pronto = mesesHist.every((m) => dados[m]);
  const controles = (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
      <span style={{ fontSize: 12.5, color: "#5C5A4E" }}>Período</span>
      {PERIODOS.map((p) => (
        <button key={p.n} onClick={() => { setN(p.n); setAberta(null); }} style={chip(n === p.n)}>{p.label}</button>
      ))}
      <span style={{ fontSize: 12.5, color: "#5C5A4E", marginLeft: 6 }}>até</span>
      <input type="month" value={mesFim} max={mesDeHoje()} onChange={(e) => { if (e.target.value) { setMesFim(e.target.value); setAberta(null); } }} style={inputStyle} />
      {progresso && (
        <span style={{ fontSize: 12, color: CINZA, display: "inline-flex", alignItems: "center", gap: 5 }}>
          <Loader2 size={13} /> Somando {progresso.feitos} de {progresso.total} meses…
        </span>
      )}
    </div>
  );

  if (erro) {
    return (
      <div>
        {controles}
        <div style={aviso}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div>{erro}</div></div>
      </div>
    );
  }
  if (!pronto) return <div>{controles}</div>;

  // ---- somas do período e do anterior
  const soma = (lista, f) => lista.reduce((s, m) => s + f(dados[m]), 0);
  const despAt = soma(periodo, (d) => d.total), despAn = soma(anterior, (d) => d.total);
  const recAt = soma(periodo, (d) => d.receita), recAn = soma(anterior, (d) => d.receita);
  const porMesAt = despAt / n, porMesAn = despAn / n;
  const pctRecAt = recAt ? (despAt / recAt) * 100 : null, pctRecAn = recAn ? (despAn / recAn) * 100 : null;
  const aberto = periodo.includes(mesDeHoje());

  // ---- por conta
  const porConta = new Map();
  const juntar = (lista, pos) => lista.forEach((m) => dados[m].contas.forEach((c) => {
    if (!porConta.has(c.codigo)) porConta.set(c.codigo, { codigo: c.codigo, nome: c.nome, grupo: c.grupo, v: [0, 0] });
    porConta.get(c.codigo).v[pos] += c.valor;
  }));
  juntar(periodo, 0); juntar(anterior, 1);
  const contas = [...porConta.values()].filter((c) => c.v[0] > 0 || c.v[1] > 0).sort((a, b) => b.v[0] - a.v[0]);
  const top = contas.slice(0, 10);
  const maxTop = Math.max(...top.map((c) => c.v[0]), 1);
  const maior = contas[0];

  // ---- grupos do histórico: os 5 maiores do período, o resto em "Outras"
  const somaGrupo = new Map();
  contas.forEach((c) => somaGrupo.set(c.grupo || "Sem grupo", (somaGrupo.get(c.grupo || "Sem grupo") || 0) + c.v[0]));
  const ordemGrupos = [...somaGrupo.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
  const grupos = ordemGrupos.length > 6 ? [...ordemGrupos.slice(0, 5), "Outras"] : ordemGrupos;
  const grupoDe = (g) => (grupos.includes(g || "Sem grupo") ? (g || "Sem grupo") : "Outras");
  const historico = mesesHist.map((m) => {
    const d = dados[m];
    const partes = grupos.map((g) => d.contas.filter((c) => grupoDe(c.grupo) === g).reduce((s, c) => s + c.valor, 0));
    return { mes: m, partes, total: d.total, pctRec: d.receita ? (d.total / d.receita) * 100 : null, noPeriodo: periodo.includes(m) };
  });

  const dif = despAt - despAn;
  const nomeAt = nomePeriodo(periodo), nomeAn = nomePeriodo(anterior);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {controles}

      {semClassificar > 0 && (
        <div style={aviso}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <b>{semClassificar} conta(s) a pagar sem classificação</b> ficam fora desta conta, como no Demonstrativo.
            {irPara && (
              <div style={{ marginTop: 8 }}>
                <button onClick={() => irPara("classificar")} style={btnEscuro}>
                  Classificar {semClassificar === 1 ? "a conta" : `as ${semClassificar} contas`} agora
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ---------------- manchete ---------------- */}
      <div style={card}>
        <Comparando agora={nomeAt} antes={nomeAn} fim={n > 1 ? `· ${n} meses cada` : ""} />
        <div style={{ fontFamily: "Georgia, 'Times New Roman', serif", fontSize: 21, lineHeight: 1.4, color: ESCURO, margin: "10px 0 12px" }}>
          {n === 1 ? `Em ${NOMES_MES[Number(periodo[0].slice(5)) - 1]}` : `Em ${n} meses`} a casa gastou <b>{mil(despAt)}</b>
          {pctRecAt != null ? `, ${Math.round(pctRecAt)}% do que vendeu.` : "."}
          {despAn > 0 && Math.abs(dif) >= 1 && (
            <> São <b style={{ color: dif > 0 ? VERMELHO : VERDE }}>{mil(Math.abs(dif))} {dif > 0 ? "a mais" : "a menos"}</b> que {n === 1 ? `em ${NOMES_MES[Number(anterior[0].slice(5)) - 1]}` : `nos ${n} meses anteriores`}.</>
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
          <Numero titulo={n === 1 ? "Despesa no mês" : "Despesa por mês"} valor={mil(porMesAt)}
            sub={despAn > 0 ? `${porMesAt > porMesAn ? "▲" : "▼"} ${pctTxt(((porMesAt - porMesAn) / porMesAn) * 100)} · era ${mil(porMesAn)}` : ""}
            cor={porMesAt > porMesAn ? VERMELHO : VERDE} />
          <Numero titulo="Da receita" valor={pctRecAt != null ? `${Math.round(pctRecAt)}%` : "—"}
            sub={pctRecAn != null ? `${pctRecAt > pctRecAn ? "▲" : "▼"} era ${Math.round(pctRecAn)}%` : ""}
            cor={pctRecAt > pctRecAn ? VERMELHO : VERDE} />
          {maior && (
            <Numero titulo="Maior despesa" valor={maior.nome} pequeno
              sub={`${despAt ? Math.round((maior.v[0] / despAt) * 100) : 0}% das despesas · ${mil(maior.v[0] / n)} por mês`} cor={CINZA} />
          )}
        </div>
        {aberto && (
          <div style={{ fontSize: 11.5, color: "#8A6A0F", marginTop: 10 }}>
            {longo(mesDeHoje())[0].toUpperCase() + longo(mesDeHoje()).slice(1)} ainda está aberto: contas que vencem até o fim do mês podem não ter entrado.
          </div>
        )}
      </div>

      {/* ---------------- maiores contas ---------------- */}
      <div style={card}>
        <div style={titulo}>Para onde vai o dinheiro</div>
        <div style={explica}>
          As {top.length} maiores contas{n > 1 ? ", em média por mês" : ""}. A variação é contra {nomeAn}. Toque numa conta para ver de onde vem.
        </div>
        <div style={{ marginTop: 8 }}>
          {top.map((c) => (
            <LinhaConta key={`${c.codigo}-${mesFim}-${n}`} c={c} n={n} max={maxTop} recAt={recAt} periodo={periodo}
              aberta={aberta === c.codigo} onAbrir={() => setAberta(aberta === c.codigo ? null : c.codigo)} />
          ))}
          {contas.length > top.length && (
            <div style={{ fontSize: 11.5, color: CINZA, marginTop: 8 }}>
              Outras {contas.length - top.length} contas somam {mil((despAt - top.reduce((s, c) => s + c.v[0], 0)) / n)}{n > 1 ? " por mês" : ""}.
            </div>
          )}
        </div>
      </div>

      {/* ---------------- histórico ---------------- */}
      <div style={card}>
        <div style={titulo}>Despesas por grupo, mês a mês</div>
        <div style={explica}>
          Os últimos {mesesHist.length} meses. O período escolhido fica em destaque; o número em cima é quanto da receita foi para despesa.
        </div>
        <Historico historico={historico} grupos={grupos} />
      </div>
    </div>
  );
}

function Numero({ titulo, valor, sub, cor, pequeno }) {
  return (
    <div style={{ background: "#F7F3E9", borderRadius: 10, padding: "10px 12px", minWidth: 0 }}>
      <div style={{ fontSize: 12, color: "#5C5A4E" }}>{titulo}</div>
      <div style={{ fontSize: pequeno ? 15 : 21, fontWeight: 800, color: ESCURO, fontVariantNumeric: "tabular-nums", marginTop: 2,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={valor}>{valor}</div>
      {sub && <div style={{ fontSize: 11.5, color: cor, marginTop: 2, fontVariantNumeric: "tabular-nums" }}>{sub}</div>}
    </div>
  );
}

// Uma conta da lista. Aberta, mostra os fornecedores do período.
function LinhaConta({ c, n, max, recAt, periodo, aberta, onAbrir }) {
  const [origem, setOrigem] = useState(null);
  const [erro, setErro] = useState("");
  const calculada = tipoDaConta(c.codigo);
  const at = c.v[0] / n, an = c.v[1] / n;
  const p = an > 0 ? ((at - an) / an) * 100 : null;

  useEffect(() => {
    if (!aberta || calculada || origem) return;
    let vivo = true;
    Promise.all(periodo.map((m) => supabase.rpc("dre_origem_despesa", { p_mes: m, p_conta: c.codigo }))).then((resp) => {
      if (!vivo) return;
      const falha = resp.find((r) => r.error);
      if (falha) { setErro(falha.error.message); return; }
      const porForn = new Map();
      resp.forEach((r) => (r.data || []).forEach((it) => {
        const nome = it.fornecedor && it.fornecedor !== "—" ? it.fornecedor : (it.descricao || "Sem fornecedor");
        const x = porForn.get(nome) || { nome, valor: 0, vezes: 0 };
        x.valor += Math.abs(Number(it.valor) || 0); x.vezes += 1;
        porForn.set(nome, x);
      }));
      setOrigem([...porForn.values()].sort((a, b) => b.valor - a.valor));
    });
    return () => { vivo = false; };
  }, [aberta]); // eslint-disable-line

  return (
    <div style={{ borderTop: "1px solid #EFE9DA", padding: "8px 0" }}>
      <div onClick={onAbrir} style={{ cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          {aberta ? <ChevronDown size={13} color={CINZA} /> : <ChevronRight size={13} color={CINZA} />}
          <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: ESCURO, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.nome}</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: ESCURO, fontVariantNumeric: "tabular-nums" }}>{mil(at)}</span>
          <span style={{ minWidth: 46, textAlign: "right", fontSize: 12, fontWeight: 700, color: p == null ? "#2F6FA3" : p > 0 ? VERMELHO : VERDE }}>
            {p == null ? "nova" : pctTxt(p)}
          </span>
        </div>
        <div style={{ height: 9, borderRadius: 3, background: "#F3EEE2", margin: "5px 0 3px 21px", overflow: "hidden" }}>
          <div style={{ width: `${(c.v[0] / max) * 100}%`, height: "100%", background: "#5C5A4E" }} />
        </div>
        <div style={{ fontSize: 11, color: CINZA, marginLeft: 21, fontVariantNumeric: "tabular-nums" }}>
          {recAt ? `${((c.v[0] / recAt) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% da receita` : ""}
          {an > 0 ? ` · era ${mil(an)}` : ""}{c.grupo ? ` · ${c.grupo}` : ""}
        </div>
      </div>
      {aberta && (
        <div style={{ margin: "8px 0 4px 21px", background: "#FBF8F1", border: "1px solid #EFE9DA", borderRadius: 9, padding: "8px 10px", fontSize: 12 }}>
          {calculada ? (
            <span style={{ color: "#5C5A4E" }}>Esta conta não tem lançamentos: vem de {calculada}. O detalhe está no Demonstrativo.</span>
          ) : erro ? (
            <span style={{ color: VERMELHO }}>{erro}</span>
          ) : !origem ? (
            <span style={{ color: CINZA, display: "inline-flex", gap: 5, alignItems: "center" }}><Loader2 size={12} /> Buscando os lançamentos…</span>
          ) : origem.length === 0 ? (
            <span style={{ color: CINZA }}>Nenhum lançamento nesta conta no período.</span>
          ) : (
            <>
              <div style={{ fontSize: 11, color: CINZA, marginBottom: 4 }}>De quem veio, no período inteiro:</div>
              {origem.slice(0, 8).map((f) => (
                <div key={f.nome} style={{ display: "flex", gap: 8, padding: "3px 0" }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.nome}</span>
                  <span style={{ color: CINZA }}>{f.vezes}×</span>
                  <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", minWidth: 80, textAlign: "right" }}>{brl(f.valor)}</span>
                </div>
              ))}
              {origem.length > 8 && <div style={{ fontSize: 11, color: CINZA, marginTop: 2 }}>e mais {origem.length - 8}.</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Barras empilhadas por grupo, mês a mês. A largura acompanha a tela.
function Historico({ historico, grupos }) {
  const caixa = useRef(null);
  const [largura, setLargura] = useState(640);
  useEffect(() => {
    const el = caixa.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setLargura(Math.round(e.contentRect.width) || 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const W = Math.max(280, largura), H = 210, L = 44, R = 6, T = 22, B = 22;
  const maxV = Math.max(...historico.map((h) => h.total), 1) * 1.05;
  const passo = maxV > 200000 ? 50000 : maxV > 80000 ? 25000 : maxV > 40000 ? 10000 : 5000;
  const marcas = [];
  for (let v = 0; v <= maxV; v += passo) marcas.push(v);
  const slot = (W - L - R) / historico.length;
  const larg = Math.min(54, slot * 0.62);
  const y = (v) => T + (1 - v / maxV) * (H - T - B);
  const comAno = historico[0].mes.slice(0, 4) !== historico[historico.length - 1].mes.slice(0, 4);
  const ini = historico.findIndex((h) => h.noPeriodo);

  return (
    <div ref={caixa} style={{ marginTop: 10 }}>
      <svg width={W} height={H} style={{ display: "block" }}>
        {marcas.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#EFE9DA" />
            <text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill={CINZA}>{v === 0 ? "0" : `${Math.round(v / 1000)} mil`}</text>
          </g>
        ))}
        {ini >= 0 && (
          <rect x={L + ini * slot + 2} y={4} width={(historico.length - ini) * slot - 4} height={H - 4} rx="7"
            fill="none" stroke="#C9C2AE" strokeDasharray="4 4" />
        )}
        {historico.map((h, i) => {
          const x = L + i * slot + (slot - larg) / 2;
          let topo = H - B;
          return (
            <g key={h.mes} opacity={h.noPeriodo ? 1 : 0.42}>
              {h.partes.map((v, j) => {
                if (v <= 0) return null;
                const alt = (v / maxV) * (H - T - B);
                topo -= alt;
                return <rect key={j} x={x} y={topo} width={larg} height={alt} fill={CORES_GRUPO[j % CORES_GRUPO.length]}><title>{`${grupos[j]}: ${brl(v)}`}</title></rect>;
              })}
              {h.pctRec != null && h.total > 0 && (
                <text x={x + larg / 2} y={y(h.total) - 5} textAnchor="middle" fontSize="11" fill="#5C5A4E" fontWeight="700">{Math.round(h.pctRec)}%</text>
              )}
              <text x={x + larg / 2} y={H - 6} textAnchor="middle" fontSize="11" fill={h.noPeriodo ? ESCURO : CINZA}>{curto(h.mes, comAno && slot > 40)}</text>
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 11.5, color: "#5C5A4E", marginTop: 6 }}>
        {grupos.map((g, j) => (
          <span key={g} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
            <i style={{ width: 10, height: 10, borderRadius: 2, background: CORES_GRUPO[j % CORES_GRUPO.length], display: "inline-block" }} />{g}
          </span>
        ))}
      </div>
    </div>
  );
}

const card = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const titulo = { fontSize: 15, fontWeight: 800, color: ESCURO };
const explica = { fontSize: 12, color: CINZA, marginTop: 2, lineHeight: 1.45 };
const inputStyle = { padding: "7px 9px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF", color: ESCURO, fontFamily: "inherit" };
const aviso = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: 14, fontSize: 13, alignItems: "flex-start" };
const btnEscuro = { background: ESCURO, color: "#F3EFE3", border: "none", borderRadius: 8, padding: "8px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
function chip(ativo) {
  return {
    padding: "6px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
    border: ativo ? "1px solid #22231F" : "1px solid #E8E2D2",
    background: ativo ? "#22231F" : "#FFFFFF", color: ativo ? "#F3EFE3" : "#55534A",
  };
}
