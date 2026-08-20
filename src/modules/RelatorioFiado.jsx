import React, { useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { supabase, extrairErroFuncao } from "../lib/supabaseClient";

function brl(v) { return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function hoje() { return new Date().toISOString().slice(0, 10); }
function diasAtras(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }

// Lista pedidos pagos como fiado (payment_method "debt_book") num
// período, pra saber quem ainda deve. Usa o mesmo resumo_financeiro que
// as outras telas já usam — não precisa de ação nova na Edge Function.
export default function RelatorioFiado() {
  const [dataInicio, setDataInicio] = useState(diasAtras(30));
  const [dataFim, setDataFim] = useState(hoje());
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState("");
  const [lancamentos, setLancamentos] = useState(null);
  const [nomeDisponivel, setNomeDisponivel] = useState(true);

  const buscar = async () => {
    setBuscando(true);
    setErro("");
    const { data, error } = await supabase.functions.invoke("cardapioweb-proxy", {
      body: { data_inicio: `${dataInicio}T00:00:00-03:00`, data_fim: `${dataFim}T23:59:59-03:00` },
    });
    setBuscando(false);
    if (error) { setErro(await extrairErroFuncao(error)); return; }
    if (data?.error) { setErro(data.error); return; }

    const lista = [];
    let algumNome = false;
    for (const pedido of data.pedidos || []) {
      if (pedido.status !== "closed") continue;
      const pagamentoFiado = (pedido.payments || []).find((p) => p.payment_method === "debt_book");
      if (!pagamentoFiado) continue;
      const nomeCliente = pedido.customer?.name;
      if (nomeCliente) algumNome = true;
      lista.push({
        id: pedido.id,
        displayId: pedido.display_id ?? pedido.id,
        data: pedido.created_at,
        valor: pagamentoFiado.total,
        nomeCliente: nomeCliente || null,
      });
    }
    lista.sort((a, b) => new Date(b.data) - new Date(a.data));
    setLancamentos(lista);
    setNomeDisponivel(algumNome);
  };

  const total = (lancamentos || []).reduce((s, l) => s + l.valor, 0);

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} style={inputStyle} />
        <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={inputStyle} />
        <button onClick={buscar} disabled={buscando} style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6 }}>
          {buscando ? <Loader2 size={14} /> : <RefreshCw size={14} />} Buscar
        </button>
      </div>

      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}

      {lancamentos === null ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Escolha o período e clique em "Buscar" para consultar o CardápioWeb.</div>
      ) : (
        <>
          {!nomeDisponivel && lancamentos.length > 0 && (
            <div style={{ ...avisoStyle }}>O CardápioWeb não mandou o nome do cliente nesses pedidos — mostrando o número do pedido no lugar.</div>
          )}
          <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", marginBottom: 14, background: "#FFFFFF" }}>
            {lancamentos.map((l, idx) => (
              <div key={l.id} style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", fontSize: 13 }}>
                <div>
                  <div style={{ color: "#22231F" }}>{l.nomeCliente || `Pedido #${l.displayId}`}</div>
                  <div style={{ fontSize: 11, color: "#8A8778" }}>{new Date(l.data).toLocaleDateString("pt-BR")}</div>
                </div>
                <span style={{ fontWeight: 700, color: "#22231F" }}>{brl(l.valor)}</span>
              </div>
            ))}
            {lancamentos.length === 0 && <div style={{ padding: 14, fontSize: 13, color: "#8A8778" }}>Nenhum fiado nesse período.</div>}
          </div>
          {lancamentos.length > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 4px", fontSize: 13 }}>
              <span style={{ color: "#8A8778" }}>Total em fiado no período</span>
              <span style={{ fontWeight: 700, color: "#22231F" }}>{brl(total)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const inputStyle = { padding: "9px 10px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF", color: "#22231F" };
const btnSecondary = { background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const avisoStyle = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 14 };
