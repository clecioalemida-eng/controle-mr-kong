import React, { useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { supabase, extrairErroFuncao } from "../lib/supabaseClient";

function brl(v) { return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function hoje() { return new Date().toISOString().slice(0, 10); }
function diasAtras(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

// Curva ABC: ranqueia produtos (ou linhas de produto) pelo faturamento
// que geram num período, calcula o percentual acumulado, e classifica —
// A = geram até 80% do faturamento, B = até 95%, C = os últimos 5%.
// Ajuda a enxergar rápido quais itens realmente sustentam o caixa.
export default function CurvaABC() {
  const [dias, setDias] = useState("30");
  const [agrupamento, setAgrupamento] = useState("produto"); // produto | linha
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState("");
  const [linhas, setLinhas] = useState(null);

  const buscar = async () => {
    setBuscando(true);
    setErro("");
    const inicio = diasAtras(parseInt(dias) || 30);
    const { data, error } = await supabase.functions.invoke("cardapioweb-proxy", {
      body: { data_inicio: `${inicio}T00:00:00-03:00`, data_fim: `${hoje()}T23:59:59-03:00` },
    });
    if (error) { setErro(await extrairErroFuncao(error)); setBuscando(false); return; }
    if (data?.error) { setErro(data.error); setBuscando(false); return; }

    const { data: pratosData } = await supabase.from("pratos").select("id, nome, cardapioweb_item_id, linha_produto");
    const mapaPrato = new Map((pratosData || []).filter((p) => p.cardapioweb_item_id != null).map((p) => [p.cardapioweb_item_id, p]));

    const somaPor = {};
    for (const pedido of data.pedidos || []) {
      if (pedido.status !== "closed") continue;
      for (const item of pedido.items || []) {
        const prato = mapaPrato.get(item.item_id);
        const chave = agrupamento === "linha" ? (prato?.linha_produto || "Sem linha definida") : (prato?.nome || item.name || "Item não identificado");
        somaPor[chave] = (somaPor[chave] || 0) + (item.total || (item.quantity || 0) * (item.price || 0));
      }
    }

    const totalGeral = Object.values(somaPor).reduce((s, v) => s + v, 0);
    const ordenado = Object.entries(somaPor).sort((a, b) => b[1] - a[1]);
    let acumulado = 0;
    const classificado = ordenado.map(([nome, valor]) => {
      acumulado += valor;
      const pctAcumulado = totalGeral > 0 ? (acumulado / totalGeral) * 100 : 0;
      const classe = pctAcumulado <= 80 ? "A" : pctAcumulado <= 95 ? "B" : "C";
      return { nome, valor, pctAcumulado, classe, pct: totalGeral > 0 ? (valor / totalGeral) * 100 : 0 };
    });
    setLinhas(classificado);
    setBuscando(false);
  };

  const CORES = { A: { bg: "#DCFCE7", cor: "#166534" }, B: { bg: "#FEF9C3", cor: "#854D0E" }, C: { bg: "#FEE2E2", cor: "#991B1B" } };
  const contagem = linhas ? { A: linhas.filter((l) => l.classe === "A").length, B: linhas.filter((l) => l.classe === "B").length, C: linhas.filter((l) => l.classe === "C").length } : null;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <select value={agrupamento} onChange={(e) => setAgrupamento(e.target.value)} style={inputStyle}>
          <option value="produto">Por produto</option>
          <option value="linha">Por linha de produto</option>
        </select>
        <select value={dias} onChange={(e) => setDias(e.target.value)} style={inputStyle}>
          <option value="15">Últimos 15 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="60">Últimos 60 dias</option>
          <option value="90">Últimos 90 dias</option>
        </select>
      </div>
      <button onClick={buscar} disabled={buscando} style={{ ...btnSecondary, width: "100%", display: "flex", justifyContent: "center", gap: 6, marginBottom: 14 }}>
        {buscando ? <Loader2 size={14} /> : <RefreshCw size={14} />} Calcular curva ABC
      </button>

      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}

      {linhas && (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {["A", "B", "C"].map((c) => (
              <div key={c} style={{ flex: 1, background: CORES[c].bg, borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: CORES[c].cor }}>{contagem[c]}</div>
                <div style={{ fontSize: 10, color: CORES[c].cor }}>classe {c}</div>
              </div>
            ))}
          </div>
          <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF" }}>
            {linhas.map((l, idx) => (
              <div key={l.nome} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, color: "#22231F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.nome}</div>
                  <div style={{ fontSize: 11, color: "#8A8778" }}>{brl(l.valor)} · {l.pct.toFixed(1)}% do total</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, padding: "2px 9px", borderRadius: 999, background: CORES[l.classe].bg, color: CORES[l.classe].cor, flexShrink: 0 }}>{l.classe}</span>
              </div>
            ))}
            {linhas.length === 0 && <div style={{ padding: 14, fontSize: 13, color: "#8A8778" }}>Nenhuma venda encontrada nesse período.</div>}
          </div>
        </>
      )}
    </div>
  );
}

const inputStyle = { flex: 1, padding: "9px 10px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF", color: "#22231F" };
const btnSecondary = { background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const avisoStyle = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 14 };
