import React, { useState, useCallback } from "react";
import { ChevronLeft, Loader2, AlertTriangle, RefreshCw, DollarSign } from "lucide-react";
import { supabase, extrairErroFuncao } from "../lib/supabaseClient";
import { podeVer } from "../lib/permissoes";
import FichasTecnicas from "./FichasTecnicas";
import NotasFiscais from "./NotasFiscais";
import Estoque from "./Estoque";
import ConferenciaCaixa from "./ConferenciaCaixa";
import ContasPagar from "./ContasPagar";
import RelatorioFiado from "./RelatorioFiado";
import CurvaABC from "./CurvaABC";
// Dashboard e Equipe saíram daqui:
//   - Dashboard virou módulo próprio (src/modules/DashboardModulo.jsx)
//   - Equipe virou "Gente e Gestão" (src/modules/GenteGestao.jsx)
// Os dois tinham card na home e aba aqui dentro ao mesmo tempo; manter os
// dois lugares significava duas permissões para a mesma tela.
const ABAS = [
  { chave: "vendas", label: "Vendas" },
  { chave: "pedidos", label: "Pedidos" },
  { chave: "pagamentos", label: "Pagamentos" },
  { chave: "fechamento", label: "Fechamento" },
  { chave: "fichas", label: "Fichas técnicas" },
  { chave: "notas", label: "Notas" },
  { chave: "estoque", label: "Compras" },
  { chave: "conferencia", label: "Conferência de caixa" },
  { chave: "contaspagar", label: "Plano de Contas" },
  { chave: "fiado", label: "Fiado" },
  { chave: "curvaabc", label: "Curva ABC" },
];
const NOMES_PAGAMENTO = {
  money: "Dinheiro",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  pix: "Pix",
  pix_auto: "Pix automático",
  meal_voucher: "Vale-refeição",
  food_voucher: "Vale-alimentação",
  bank_transfer: "Transferência",
  bank_slip: "Boleto",
  picpay: "PicPay",
  debt_book: "Fiado",
  online_credit_card: "Cartão online",
  ifood: "iFood (online)",
  ifood_voucher: "Desconto iFood",
  food99: "99Food (online)",
  food99_voucher: "Desconto 99Food",
};
function hoje() { return new Date().toISOString().slice(0, 10); }
function diasAtras(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
function formatBRL(v) {
  return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
export default function Financeiro({ onVoltar, abaInicial, permissoes }) {
  // Só as abas que o cargo da pessoa pode ver. Administrador vê todas,
  // porque podeVer() devolve true para ele em qualquer chave.
  const abasVisiveis = ABAS.filter((a) => podeVer(permissoes, `financeiro.${a.chave}`));
  const abaPadrao = abasVisiveis.some((a) => a.chave === abaInicial)
    ? abaInicial
    : (abasVisiveis[0]?.chave || null);
  const [aba, setAba] = useState(abaPadrao);
  const [dataInicio, setDataInicio] = useState(diasAtras(7));
  const [dataFim, setDataFim] = useState(hoje());
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [resumo, setResumo] = useState(null);
  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const { data, error } = await supabase.functions.invoke("cardapioweb-proxy", {
      body: {
        data_inicio: `${dataInicio}T00:00:00-03:00`,
        data_fim: `${dataFim}T23:59:59-03:00`,
      },
    });
    setCarregando(false);
    if (error) { setErro(await extrairErroFuncao(error)); return; }
    if (data?.error) { setErro(data.error); return; }
    setResumo(data);
  }, [dataInicio, dataFim]);
  // Sem busca automática ao abrir ou trocar de aba/data — só busca quando
  // a pessoa clica em "Atualizar" mesmo, de propósito. Isso evita bater
  // sem querer no limite de 5 consultas por minuto do CardápioWeb.
  return (
    <div style={pageStyle}>
      <div className="app-shell">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <button onClick={onVoltar} style={iconBtn}><ChevronLeft size={18} /></button>
          <div style={{ fontWeight: 800, fontSize: 17, color: "#22231F" }}>Financeiro</div>
        </div>
        {abasVisiveis.length === 0 ? (
          <div style={{ ...cardStyle, textAlign: "center", color: "#8A8778", fontSize: 13 }}>
            Seu cargo não libera nenhuma aba do Financeiro. Fale com um administrador.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
              {abasVisiveis.map((a) => (
                <button key={a.chave} onClick={() => setAba(a.chave)}
                  style={{ ...tabBtn, ...(aba === a.chave ? tabBtnAtivo : {}) }}>
                  {a.label}
                </button>
              ))}
            </div>
            {aba === "fichas" ? (
              <FichasTecnicas />
            ) : aba === "notas" ? (
              <NotasFiscais />
            ) : aba === "estoque" ? (
              <Estoque />
            ) : aba === "conferencia" ? (
              <ConferenciaCaixa />
            ) : aba === "contaspagar" ? (
              <ContasPagar />
            ) : aba === "fiado" ? (
              <RelatorioFiado />
            ) : aba === "curvaabc" ? (
              <CurvaABC />
            ) : (
              <>
                <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                  <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} style={inputStyle} />
                  <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={inputStyle} />
                  <button onClick={carregar} style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6 }}>
                    <RefreshCw size={14} /> Atualizar
                  </button>
                </div>
                {carregando && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#8A8778", fontSize: 13 }}>
                    <Loader2 size={16} /> Consultando o CardápioWeb…
                  </div>
                )}
                {!carregando && erro && (
                  <div style={avisoStyle}>
                    <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, marginBottom: 4 }}>Não deu para trazer esses dados</div>
                      <div style={{ fontSize: 13 }}>{erro}</div>
                    </div>
                  </div>
                )}
                {!carregando && !erro && !resumo && (
                  <div style={{ fontSize: 13, color: "#8A8778" }}>Escolha o período e clique em "Atualizar" para consultar o CardápioWeb.</div>
                )}
                {!carregando && !erro && resumo && (
                  <>
                    {resumo.truncado && (
                      <div style={{ ...avisoStyle, marginBottom: 14 }}>
                        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                        <div style={{ fontSize: 13 }}>
                          Esse período tem mais pedidos do que o limite processado de uma vez. Reduza o intervalo de datas para ver todos.
                        </div>
                      </div>
                    )}
                    {aba === "vendas" && <AbaVendas resumo={resumo} />}
                    {aba === "pedidos" && <AbaPedidos resumo={resumo} />}
                    {aba === "pagamentos" && <AbaPagamentos resumo={resumo} />}
                    {aba === "fechamento" && <AbaFechamento resumo={resumo} />}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
function AbaVendas({ resumo }) {
  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={statBox}>
          <div style={statNum}>{formatBRL(resumo.faturamento_total)}</div>
          <div style={statLabel}>faturamento no período</div>
        </div>
        <div style={statBox}>
          <div style={statNum}>{resumo.pedidos_fechados}</div>
          <div style={statLabel}>pedidos fechados</div>
        </div>
        <div style={statBox}>
          <div style={{ ...statNum, color: "#C4432B" }}>{resumo.pedidos_cancelados}</div>
          <div style={statLabel}>pedidos cancelados</div>
        </div>
      </div>
      <div style={sectionLabel}>Faturamento por dia</div>
      <div className="list-grid">
        {Object.entries(resumo.por_dia).sort().map(([dia, v]) => (
          <div key={dia} style={itemRow}>
            <span style={{ fontSize: 13, color: "#22231F" }}>{new Date(dia + "T12:00:00").toLocaleDateString("pt-BR")}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#22231F" }}>{formatBRL(v.total)} <span style={{ color: "#8A8778", fontWeight: 400 }}>({v.pedidos})</span></span>
          </div>
        ))}
        {Object.keys(resumo.por_dia).length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Nenhuma venda fechada nesse período.</div>}
      </div>
    </div>
  );
}
function AbaPedidos({ resumo }) {
  const [expandidoId, setExpandidoId] = useState(null);
  return (
    <div className="list-grid">
      {resumo.pedidos.map((p) => (
        <div key={p.id} style={itemRow}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#22231F" }}>Pedido #{p.display_id ?? p.id}</div>
              <div style={{ fontSize: 11, color: "#8A8778" }}>
                {new Date(p.created_at).toLocaleString("pt-BR")} · {p.status === "closed" ? "Fechado" : "Cancelado"}
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#22231F" }}>{formatBRL(p.total)}</span>
              <button onClick={() => setExpandidoId(expandidoId === p.id ? null : p.id)}
                style={{ border: "1px solid #E8E2D2", background: "#F6F1E7", borderRadius: 6, padding: "3px 8px", fontSize: 11, color: "#8A8778", cursor: "pointer", fontFamily: "monospace" }}
                title="Ver todos os campos que a API devolve pra esse pedido (temporário, pra investigar campos de caixa/atendente)">
                {"{ }"}
              </button>
            </div>
          </div>
          {expandidoId === p.id && (
            <pre style={{ marginTop: 8, padding: 10, background: "#22231F", color: "#D8D3C4", borderRadius: 8, fontSize: 11, overflowX: "auto", maxHeight: 400, overflowY: "auto" }}>
              {JSON.stringify(p, null, 2)}
            </pre>
          )}
        </div>
      ))}
      {resumo.pedidos.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Nenhum pedido nesse período.</div>}
    </div>
  );
}
function AbaPagamentos({ resumo }) {
  const entradas = Object.entries(resumo.por_forma_pagamento).sort((a, b) => b[1] - a[1]);
  return (
    <div className="list-grid">
      {entradas.map(([metodo, valor]) => (
        <div key={metodo} style={itemRow}>
          <span style={{ fontSize: 13, color: "#22231F", display: "flex", alignItems: "center", gap: 6 }}>
            <DollarSign size={14} color="#8A8778" /> {NOMES_PAGAMENTO[metodo] || metodo}
          </span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#22231F" }}>{formatBRL(valor)}</span>
        </div>
      ))}
      {entradas.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Nenhum pagamento nesse período.</div>}
    </div>
  );
}
function AbaFechamento({ resumo }) {
  return (
    <div className="list-grid">
      {Object.entries(resumo.por_dia).sort().reverse().map(([dia, v]) => (
        <div key={dia} style={cardStyle}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#22231F", marginBottom: 4 }}>
            {new Date(dia + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" })}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#8A8778" }}>
            <span>{v.pedidos} pedidos fechados</span>
            <span style={{ fontWeight: 700, color: "#22231F" }}>{formatBRL(v.total)}</span>
          </div>
        </div>
      ))}
      {Object.keys(resumo.por_dia).length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Nenhum fechamento nesse período.</div>}
    </div>
  );
}
const pageStyle = {
  fontFamily: "'Inter', system-ui, sans-serif",
  background: "#F6F1E7",
  padding: 20,
  minHeight: "100vh",
  boxSizing: "border-box",
};
const iconBtn = {
  width: 34, height: 34, borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#22231F",
};
const tabBtn = {
  padding: "8px 14px", borderRadius: 999, border: "1px solid #E8E2D2",
  background: "#FFFFFF", color: "#8A8778", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const tabBtnAtivo = { background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" };
const btnSecondary = {
  background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F",
  borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const inputStyle = {
  padding: "9px 10px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF", color: "#22231F",
};
const avisoStyle = {
  display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A",
  color: "#7A6A1E", borderRadius: 10, padding: "14px", fontSize: 13,
};
const statBox = {
  flex: 1, minWidth: 130, background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12,
  padding: "12px 14px", textAlign: "center",
};
const statNum = { fontSize: 18, fontWeight: 800, color: "#22231F" };
const statLabel = { fontSize: 11, color: "#8A8778", marginTop: 2 };
const sectionLabel = {
  fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
  color: "#8A8778", marginBottom: 8,
};
const itemRow = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10, padding: "10px 12px",
};
const cardStyle = {
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14,
};
