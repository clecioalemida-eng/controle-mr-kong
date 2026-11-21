import React, { useState } from "react";

// ---------------------------------------------------------------------------
// Comercial → Venda de cada item
//
// Soma, item a item, o que saiu sozinho e o que saiu dentro de combo.
// Os números vêm da função venda_por_item (migração 193), que só conta
// unidades por nome. Quem desmonta o combo é esta tela:
//
//   • Combo montado: o lanche vem como item próprio (já entra como
//     "sozinho"), mais um item "coca + fritas". Esse item vira 1 bebida e
//     1 batata P.
//   • Combo fechado: "Combo X Tudo | Lanche + Batata + Bebida". O lanche sai
//     do nome, a bebida da opção ("Coca Cola + fritas") e a batata é P.
//     Combo fechado sem opção conta lanche e batata, sem bebida.
//
// Lanche e jantinha de funcionário ficam de fora.
// Componentes só de desenho: os dados chegam prontos pelo Comercial.jsx.
// ---------------------------------------------------------------------------

const COR = { sozinho: "#5C5A4E", fechado: "#2F8F5B", montado: "#E0A030" };
const ROTULO = { sozinho: "Sozinho", fechado: "Combo fechado (plataformas)", montado: "Combo montado (bebida + fritas)" };

// minúsculo, sem acento, espaço único
function norm(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
function inteiro(n) { return Math.round(Number(n) || 0).toLocaleString("pt-BR"); }

// ---- nome da bebida, do jeito que aparece na tela
function bebidaDe(texto) {
  const n = norm(texto);
  // milkshake antes de tudo: "paçoca" contém "coca"
  if (/milk ?shake/.test(n)) return "Milkshake";
  if (/coca/.test(n)) return /zero/.test(n) ? "Coca Zero" : "Coca-Cola";
  if (/guarana/.test(n)) return /zero/.test(n) ? "Guaraná Zero" : "Guaraná";
  if (/fanta/.test(n)) return "Fanta";
  if (/sprit/.test(n)) return "Sprite";
  if (/agua/.test(n)) return /com gas/.test(n) ? "Água com gás" : "Água sem gás";
  if (/suco/.test(n)) {
    const sabores = { laranja: "laranja", limao: "limão", morango: "morango", maracuja: "maracujá", tamarindo: "tamarindo", acerola: "acerola", abacaxi: "abacaxi", uva: "uva", manga: "manga" };
    const k = Object.keys(sabores).find((s) => n.includes(s));
    return k ? `Suco de ${sabores[k]}` : "Suco";
  }
  return null;
}

function batataDe(texto) {
  const n = norm(texto);
  if (/^file|^frango|isca/.test(n)) return null; // prato que leva fritas, não é batata
  if (!/fritas|batata/.test(n)) return null;
  if (/extra|acompanhamento/.test(n)) return "Extra de batata";
  if (/bacon|cheddar|mussarela|catupiry/.test(n)) return "Fritas recheadas";
  if (/grande|\bg\b/.test(n)) return "Fritas grande";
  if (/media|\bm\b/.test(n)) return "Fritas média";
  if (/pequena|\bp\b/.test(n)) return "Batata P";
  return "Fritas (outras)";
}

// chave do hambúrguer: sem o que está entre parênteses, sem diferença de escrita
function chaveLanche(nome) {
  return norm(nome).replace(/\(.*?\)/g, "").replace(/\bdrill\b/g, "dril").replace(/\b(de|do|da)\b/g, " ").replace(/\s+/g, " ").trim();
}
function nomeLanche(nome) {
  return String(nome || "").replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
}
// nome bonito: evita o "X SALADA ESPECIAL" todo em maiúscula
function capitaliza(nome) {
  if (nome !== nome.toUpperCase()) return nome;
  return nome.toLowerCase().replace(/(^|\s)(\S)/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(De|Do|Da|Com)\b/g, (w) => w.toLowerCase());
}

const PARECE_LANCHE = /^(x[\s-]|kong |king kong|kongzilla|hamb|burg|smash|cheese)/;
const NAO_E_LANCHE = /acai|adiciona|extra|funcionari|jantinha|espetinho|milk/;

// ---------------------------------------------------------------------------
// Desmonta as linhas da venda_por_item. `produtos` (de desempenho_produtos)
// ajuda a reconhecer hambúrguer pela linha do prato, quando ela existe.
// ---------------------------------------------------------------------------
export function desmontarItens(linhas, produtos = []) {
  const linhaDe = new Map(produtos.map((p) => [norm(p.produto), p.linha || ""]));
  const grupos = { lanche: new Map(), batata: new Map(), bebida: new Map() };
  const combos = { montado: [0, 0], fechado: [0, 0], semBebida: [0, 0] };

  const soma = (grupo, chave, nome, origem, q) => {
    const m = grupos[grupo];
    if (!m.has(chave)) m.set(chave, { chave, nomes: new Map(), sozinho: [0, 0], fechado: [0, 0], montado: [0, 0] });
    const x = m.get(chave);
    x[origem][0] += q[0]; x[origem][1] += q[1];
    x.nomes.set(nome, (x.nomes.get(nome) || 0) + q[0] + q[1]);
  };

  (linhas || []).forEach((l) => {
    const nome = String(l.nome || "").trim();
    const n = norm(nome);
    const q = [Number(l.qtd_atual) || 0, Number(l.qtd_ant) || 0];
    if (!n || (!q[0] && !q[1]) || /funcionari/.test(n)) return;

    // combo fechado: "Combo <lanche> | lanche + batata + bebida"
    if (/^combo\b/.test(n)) {
      const lanche = nomeLanche(nome.replace(/^combo\s*/i, "").split("|")[0]);
      if (lanche) soma("lanche", chaveLanche(lanche), lanche, "fechado", q);
      soma("batata", "Batata P", "Batata P", "fechado", q);
      const beb = l.opcao ? bebidaDe(String(l.opcao).split("+")[0]) : null;
      if (beb) soma("bebida", beb, beb, "fechado", q);
      else { combos.semBebida[0] += q[0]; combos.semBebida[1] += q[1]; }
      combos.fechado[0] += q[0]; combos.fechado[1] += q[1];
      return;
    }

    // combo montado: "<bebida> + fritas"
    if (/\+\s*fritas/.test(n)) {
      const beb = bebidaDe(nome.split("+")[0]);
      if (beb) soma("bebida", beb, beb, "montado", q);
      soma("batata", "Batata P", "Batata P", "montado", q);
      combos.montado[0] += q[0]; combos.montado[1] += q[1];
      return;
    }

    // vendido sozinho
    const bat = batataDe(nome);
    if (bat) { soma("batata", bat, bat, "sozinho", q); return; }
    const beb = bebidaDe(nome);
    if (beb) { soma("bebida", beb, beb, "sozinho", q); return; }
    const linha = linhaDe.get(n);
    const lanche = (/hamb|burg|lanche/i.test(linha || "") || PARECE_LANCHE.test(n)) && !NAO_E_LANCHE.test(n);
    if (lanche) soma("lanche", chaveLanche(nome), nomeLanche(nome), "sozinho", q);
  });

  const fecha = (m) => [...m.values()].map((x) => {
    const nomes = [...x.nomes.entries()].sort((a, b) => {
      const maiusc = (s) => (s === s.toUpperCase() ? 1 : 0);
      return maiusc(a[0]) - maiusc(b[0]) || b[1] - a[1];
    });
    const atual = x.sozinho[0] + x.fechado[0] + x.montado[0];
    const ant = x.sozinho[1] + x.fechado[1] + x.montado[1];
    return { nome: capitaliza(nomes[0] ? nomes[0][0] : x.chave), sozinho: x.sozinho[0], fechado: x.fechado[0], montado: x.montado[0], atual, ant };
  }).filter((x) => x.atual > 0 || x.ant > 0).sort((a, b) => b.atual - a.atual || b.ant - a.ant);

  return { lanches: fecha(grupos.lanche), batatas: fecha(grupos.batata), bebidas: fecha(grupos.bebida), combos };
}

// ---------------------------------------------------------------------------
// Desenho
// ---------------------------------------------------------------------------
const card = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const rotulo = { fontSize: 11, fontWeight: 700, color: "#8A8778", textTransform: "uppercase", letterSpacing: 0.4 };
const frase = { fontSize: 14, color: "#22231F", lineHeight: 1.45, margin: "6px 0 10px" };
const sub = { fontSize: 11, color: "#8A8778", fontVariantNumeric: "tabular-nums" };

function Variacao({ atual, ant }) {
  if (!ant) return <span style={{ ...sub, color: "#2F6FA3", fontWeight: 700 }}>{atual ? "novo" : ""}</span>;
  const p = Math.round(((atual - ant) / ant) * 100);
  const cor = p >= 0 ? "#2F8F5B" : "#C4432B";
  return <span style={{ ...sub, color: cor, fontWeight: 700 }}>{p === 0 ? "igual" : `${p > 0 ? "+" : "−"}${Math.abs(p)}%`}</span>;
}

function Legenda({ origens }) {
  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11.5, color: "#5C5A4E" }}>
      {origens.map((o) => (
        <span key={o} style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
          <i style={{ width: 10, height: 10, borderRadius: 2, background: COR[o], display: "inline-block" }} />{ROTULO[o]}
        </span>
      ))}
    </div>
  );
}

function ListaItens({ lista, palavras, rotuloAn, quantos = 8 }) {
  const [todos, setTodos] = useState(false);
  const max = Math.max(...lista.map((x) => x.atual), 1);
  const mostra = todos ? lista : lista.slice(0, quantos);
  return (
    <>
      {mostra.map((x) => {
        const partes = ["sozinho", "fechado", "montado"].filter((o) => x[o] > 0);
        return (
          <div key={x.nome} style={{ padding: "8px 0", borderTop: "1px solid #EFE9DA" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: "#22231F", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={x.nome}>{x.nome}</div>
              <span style={{ fontSize: 15, fontWeight: 800, color: "#22231F", fontVariantNumeric: "tabular-nums" }}>{inteiro(x.atual)}</span>
              <span title={`${rotuloAn}: ${inteiro(x.ant)}`} style={{ minWidth: 38, textAlign: "right" }}><Variacao atual={x.atual} ant={x.ant} /></span>
            </div>
            <div style={{ display: "flex", height: 10, borderRadius: 3, overflow: "hidden", background: "#F3EEE2", margin: "5px 0 3px" }}>
              {partes.map((o) => <div key={o} style={{ width: `${(x[o] / max) * 100}%`, background: COR[o] }} />)}
            </div>
            <div style={sub}>
              {partes.map((o) => `${inteiro(x[o])} ${palavras[o]}`).join(" · ") || "nada neste período"}
            </div>
          </div>
        );
      })}
      {lista.length > quantos && (
        <button onClick={() => setTodos(!todos)}
          style={{ marginTop: 8, background: "none", border: "1px solid #E8E2D2", borderRadius: 8, padding: "6px 10px", fontSize: 12, color: "#5C5A4E", cursor: "pointer" }}>
          {todos ? "Mostrar menos" : `Ver todos (${lista.length})`}
        </button>
      )}
    </>
  );
}

function Numero({ titulo, valor, ant }) {
  return (
    <div style={{ background: "#F7F3E9", borderRadius: 8, padding: "10px 12px" }}>
      <div style={{ fontSize: 11.5, color: "#5C5A4E" }}>{titulo}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 22, fontWeight: 800, color: "#22231F", fontVariantNumeric: "tabular-nums" }}>{inteiro(valor)}</span>
        <Variacao atual={valor} ant={ant} />
      </div>
    </div>
  );
}

// ---- frases de leitura
function fraseLanches(l) {
  if (!l.length) return "Nenhum hambúrguer vendido neste período.";
  const top = l[0];
  let s = `O ${top.nome} é o que mais sai: ${inteiro(top.atual)} unidades.`;
  const combo = l.filter((x) => x.atual >= 10 && x.fechado > x.sozinho).sort((a, b) => b.fechado - a.fechado)[0];
  if (combo) s += ` O ${combo.nome} sai mais em combo fechado do que sozinho: ${inteiro(combo.fechado)} de ${inteiro(combo.atual)}.`;
  else {
    const sobe = l.filter((x) => x.ant > 0).sort((a, b) => (b.atual - b.ant) - (a.atual - a.ant))[0];
    if (sobe && sobe.atual > sobe.ant) s += ` Quem mais cresceu foi o ${sobe.nome}, com ${inteiro(sobe.atual - sobe.ant)} unidades a mais.`;
  }
  return s;
}
function fraseBatatas(b) {
  const p = b.find((x) => x.nome === "Batata P");
  const porcoes = b.filter((x) => x.nome !== "Batata P").reduce((s, x) => s + x.sozinho, 0);
  if (!p) return porcoes ? `Saíram ${inteiro(porcoes)} porções de batata pedidas sozinhas.` : "Nenhuma batata neste período.";
  const media = b.find((x) => x.nome === "Fritas média"), grande = b.find((x) => x.nome === "Fritas grande");
  let s = `Saíram ${inteiro(p.atual)} batatas P`;
  s += p.sozinho ? `, ${inteiro(p.fechado + p.montado)} delas em combo.` : ", todas em combo.";
  if (media || grande) s += ` Pedida sozinha, a porção sai ${porcoes < p.atual / 3 ? "pouco" : "bem"}: ${inteiro(media ? media.atual : 0)} médias e ${inteiro(grande ? grande.atual : 0)} grandes.`;
  return s;
}
function fraseBebidas(b) {
  if (!b.length) return "Nenhuma bebida neste período.";
  const top = b[0];
  let s = `A ${top.nome} é a bebida que mais sai: ${inteiro(top.atual)}.`;
  if (top.fechado + top.montado > top.sozinho) s += ` Só ${inteiro(top.sozinho)} ${top.sozinho === 1 ? "foi vendida sozinha" : "foram vendidas sozinhas"}; o resto saiu no combo.`;
  const sozinha = b.filter((x) => x.atual >= 10 && x.sozinho / x.atual >= 0.8 && x !== top)[0];
  if (sozinha) s += ` A ${sozinha.nome} sai quase sempre sozinha.`;
  return s;
}

export function VendaDosItens({ itens, rotuloAt, rotuloAn, faixa, erro }) {
  if (erro) {
    return (
      <div style={card}>
        <div style={rotulo}>Venda de cada item</div>
        <div style={{ fontSize: 12.5, color: "#8A6A0F", marginTop: 6 }}>{erro}</div>
      </div>
    );
  }
  if (!itens) return null;
  const { lanches, batatas, bebidas, combos } = itens;
  const totalCombos = [combos.montado[0] + combos.fechado[0], combos.montado[1] + combos.fechado[1]];
  const periodo = `${rotuloAt} · ${faixa} · variação contra ${rotuloAn}`;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={card}>
        <div style={rotulo}>Venda de cada item</div>
        <div style={{ ...sub, marginTop: 2, marginBottom: 8 }}>{periodo}</div>
        <Legenda origens={["sozinho", "fechado", "montado"]} />
      </div>

      <div style={card}>
        <div style={rotulo}>Combos</div>
        <div style={frase}>
          Saíram {inteiro(totalCombos[0])} combos: {inteiro(combos.montado[0])} montados (lanche + "bebida + fritas") e {inteiro(combos.fechado[0])} fechados, vindos das plataformas.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
          <Numero titulo="Combos no total" valor={totalCombos[0]} ant={totalCombos[1]} />
          <Numero titulo="Montados" valor={combos.montado[0]} ant={combos.montado[1]} />
          <Numero titulo="Fechados" valor={combos.fechado[0]} ant={combos.fechado[1]} />
        </div>
      </div>

      <div style={card}>
        <div style={rotulo}>Hambúrgueres · unidades</div>
        <div style={frase}>{fraseLanches(lanches)}</div>
        <ListaItens lista={lanches} rotuloAn={rotuloAn} palavras={{ sozinho: "sozinho", fechado: "em combo fechado", montado: "em combo" }} />
        <div style={{ ...sub, marginTop: 8 }}>O lanche do combo montado sai como item próprio e já está no cinza. Lanche de funcionário fica de fora.</div>
      </div>

      <div style={card}>
        <div style={rotulo}>Batata · unidades por tamanho</div>
        <div style={frase}>{fraseBatatas(batatas)}</div>
        <ListaItens lista={batatas} rotuloAn={rotuloAn} palavras={{ sozinho: "sozinha", fechado: "combo fechado", montado: "combo montado" }} />
      </div>

      <div style={card}>
        <div style={rotulo}>Bebidas · unidades</div>
        <div style={frase}>{fraseBebidas(bebidas)}</div>
        <ListaItens lista={bebidas} rotuloAn={rotuloAn} palavras={{ sozinho: "sozinha", fechado: "combo fechado", montado: "combo montado" }} />
        {combos.semBebida[0] > 0 && (
          <div style={{ ...sub, marginTop: 8 }}>
            {inteiro(combos.semBebida[0])} {combos.semBebida[0] === 1 ? "combo fechado veio" : "combos fechados vieram"} sem a bebida escolhida. O lanche e a batata deles estão contados acima, mas a bebida não.
          </div>
        )}
      </div>
    </div>
  );
}
