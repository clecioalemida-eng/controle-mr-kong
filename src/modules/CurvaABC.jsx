// ===== CurvaABC.jsx =====
import React, { useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

function brl(v) {
  return Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function hoje() { return new Date().toISOString().slice(0, 10); }
function diasAtras(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

// Curva ABC: ranqueia produtos (ou linhas de produto) pelo faturamento
// que geram num período, calcula o percentual acumulado, e classifica —
// A = geram até 80% do faturamento, B = até 95%, C = os últimos 5%.
// Ajuda a enxergar rápido quais itens realmente sustentam o caixa.
//
// O cálculo mora no banco, na função curva_abc(), lendo os pedidos já
// sincronizados em pedidos_cache. Antes esta tela chamava o CardápioWeb
// na hora e somava item.total / item.price — campos que não existem na
// resposta deles (os certos são total_price e unit_price). Por isso
// tudo aparecia como R$ 0,00 e todo produto caía na classe A.
export default function CurvaABC() {
  const [dias, setDias] = useState("30");
  const [agrupamento, setAgrupamento] = useState("produto"); // produto | linha
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState("");
  const [linhas, setLinhas] = useState(null);

  const buscar = async () => {
    setBuscando(true);
    setErro("");
    setLinhas(null);
    const { data, error } = await supabase.rpc("curva_abc", {
      p_inicio: diasAtras(parseInt(dias) || 30),
      p_fim: hoje(),
      p_por_linha: agrupamento === "linha",
    });
    if (error) { setErro(error.message); setBuscando(false); return; }
    setLinhas((data || []).map((l) => ({
      nome: l.nome,
      qtd: Number(l.qtd) || 0,
      valor: Number(l.valor) || 0,
      pct: Number(l.pct) || 0,
      pctAcumulado: Number(l.pct_acumulado) || 0,
      classe: l.classe,
    })));
    setBuscando(false);
  };

  const CORES = { A: { bg: "#DCFCE7", cor: "#166534" }, B: { bg: "#FEF9C3", cor: "#854D0E" }, C: { bg: "#FEE2E2", cor: "#991B1B" } };
  const contagem = linhas ? { A: linhas.filter((l) => l.classe === "A").length, B: linhas.filter((l) => l.classe === "B").length, C: linhas.filter((l) => l.classe === "C").length } : null;
  const totalPeriodo = linhas ? linhas.reduce((s, l) => s + l.valor, 0) : 0;

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
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            {["A", "B", "C"].map((c) => (
              <div key={c} style={{ flex: 1, background: CORES[c].bg, borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: CORES[c].cor }}>{contagem[c]}</div>
                <div style={{ fontSize: 10, color: CORES[c].cor }}>classe {c}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 12, textAlign: "center" }}>
            {brl(totalPeriodo)} no período · {linhas.length} {agrupamento === "linha" ? "linhas" : "produtos"}
          </div>
          <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF" }}>
            {linhas.map((l, idx) => (
              <div key={l.nome} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, color: "#22231F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.nome}</div>
                  <div style={{ fontSize: 11, color: "#8A8778" }}>
                    {brl(l.valor)} · {l.pct.toFixed(1)}% do total
                    {l.qtd > 0 ? ` · ${l.qtd.toLocaleString("pt-BR")} vendidos` : ""}
                  </div>
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
