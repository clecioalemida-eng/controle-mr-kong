// ===== Financeiro.jsx =====
import React, { useState, useCallback } from "react";
import { ChevronLeft, Loader2, AlertTriangle, RefreshCw, DollarSign, ArrowDownRight, ArrowUpRight } from "lucide-react";
import { supabase, extrairErroFuncao } from "../lib/supabaseClient";
import { podeVer } from "../lib/permissoes";
import ConferenciaCaixa from "./ConferenciaCaixa";
import ContasPagar from "./ContasPagar";
import RelatorioFiado from "./RelatorioFiado";
import DRE from "./DRE";
// Saíram daqui, cada um pro módulo onde faz sentido:
//   - Dashboard  -> módulo próprio (DashboardModulo.jsx)
//   - Equipe     -> "Gente e Gestão" (GenteGestao.jsx)
//   - Notas, Compras, Fichas técnicas e Curva ABC -> "Supply Chain"
//     (SupplyChain.jsx). São uma cadeia só: a nota dá entrada no estoque,
//     o estoque alimenta o custo da ficha, a curva ABC mostra o que gira.
//     Aqui dentro, obrigavam a liberar caixa e plano de contas pra quem
//     só mexe com compras.
const ABAS = [
  { chave: "vendas", label: "Vendas" },
  { chave: "pedidos", label: "Pedidos" },
  { chave: "pagamentos", label: "Pagamentos" },
  { chave: "fechamento", label: "Fechamento" },
  { chave: "conferencia", label: "Conferência de caixa" },
  { chave: "contaspagar", label: "Contas a pagar" },
  { chave: "fluxo", label: "Entrou e saiu" },
  { chave: "dre", label: "DRE" },
  { chave: "fiado", label: "Fiado" },
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
            {aba === "conferencia" ? (
              <ConferenciaCaixa />
            ) : aba === "contaspagar" ? (
              <ContasPagar />
            ) : aba === "fluxo" ? (
              <EntrouSaiu />
            ) : aba === "dre" ? (
              <DRE permissoes={permissoes} />
            ) : aba === "fiado" ? (
              <RelatorioFiado />
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
// ---------------------------------------------------------------------------
// Entrou e saiu
//
// ENTRADA é a venda no dia em que aconteceu, pelo valor cheio. Não é o
// dinheiro caindo na conta: o cartão ainda leva dias e vem com taxa
// descontada. Foi escolha deliberada — mais simples e com os dados que já
// existem. Se um dia precisar do caixa de verdade, é outra conta.
//
// SAÍDA é a conta no dia em que foi PAGA, não no vencimento. Conta lançada e
// ainda não paga não aparece aqui — pra essa existe o Contas a pagar.
// ---------------------------------------------------------------------------
const PERIODOS_FLUXO = [
  { valor: "7", label: "Últimos 7 dias" },
  { valor: "30", label: "Últimos 30 dias" },
  { valor: "mes", label: "Este mês" },
  { valor: "anterior", label: "Mês passado" },
];

function ymdLocalFin(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function janelaFluxo(modo) {
  const hoje = new Date();
  if (modo === "mes") {
    return { ini: new Date(hoje.getFullYear(), hoje.getMonth(), 1), fim: hoje };
  }
  if (modo === "anterior") {
    return {
      ini: new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1),
      fim: new Date(hoje.getFullYear(), hoje.getMonth(), 0),
    };
  }
  const n = Number(modo) || 30;
  const ini = new Date(hoje);
  ini.setDate(ini.getDate() - n);
  return { ini, fim: hoje };
}
const SEMANA_FIN = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
function diaLongo(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  const data = new Date(a, m - 1, d);
  return `${SEMANA_FIN[data.getDay()]}, ${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

function EntrouSaiu() {
  const [periodo, setPeriodo] = useState("30");
  const [filtro, setFiltro] = useState("tudo"); // tudo | entrada | saida
  const [linhas, setLinhas] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    const j = janelaFluxo(periodo);
    const { data, error } = await supabase.rpc("fluxo_periodo", {
      p_inicio: ymdLocalFin(j.ini),
      p_fim: ymdLocalFin(j.fim),
    });
    setCarregando(false);
    if (error) {
      setErro(/does not exist|schema cache/i.test(error.message)
        ? "Essa tela ainda não foi instalada no banco — falta rodar a migração 088."
        : error.message);
      setLinhas([]);
      return;
    }
    setLinhas(data || []);
  }, [periodo]);

  React.useEffect(() => { carregar(); }, [carregar]);

  const visiveis = (linhas || []).filter((l) => filtro === "tudo" || l.tipo === filtro);
  const entrou = (linhas || []).filter((l) => l.tipo === "entrada").reduce((s, l) => s + Number(l.valor), 0);
  const saiu = (linhas || []).filter((l) => l.tipo === "saida").reduce((s, l) => s + Number(l.valor), 0);
  const qtdSaidas = (linhas || []).filter((l) => l.tipo === "saida").length;
  const diasComVenda = (linhas || []).filter((l) => l.tipo === "entrada").length;

  // Agrupa por dia mantendo a ordem que veio do banco (mais recente primeiro)
  const porDia = [];
  visiveis.forEach((l) => {
    const ultimo = porDia[porDia.length - 1];
    if (ultimo && ultimo.dia === l.dia) ultimo.itens.push(l);
    else porDia.push({ dia: l.dia, itens: [l] });
  });

  return (
    <div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 12 }}>
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value)} style={inputStyle}>
          {PERIODOS_FLUXO.map((p) => <option key={p.valor} value={p.valor}>{p.label}</option>)}
        </select>
        <select value={filtro} onChange={(e) => setFiltro(e.target.value)} style={inputStyle}>
          <option value="tudo">Tudo</option>
          <option value="entrada">Só entradas</option>
          <option value="saida">Só saídas</option>
        </select>
      </div>

      {erro && (
        <div style={{ display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 12 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div>{erro}</div>
        </div>
      )}

      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
            <div style={cardStyle}>
              <div style={{ fontSize: 10, color: "#8A8778", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 5 }}>Entrou</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#0F6E56", fontVariantNumeric: "tabular-nums" }}>{formatBRL(entrou)}</div>
              <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 3 }}>{diasComVenda} dia(s) de venda</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 10, color: "#8A8778", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 5 }}>Saiu</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#A32D2D", fontVariantNumeric: "tabular-nums" }}>{formatBRL(saiu)}</div>
              <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 3 }}>{qtdSaidas} conta(s) paga(s)</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 10, color: "#8A8778", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 5 }}>Sobrou</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: entrou - saiu >= 0 ? "#22231F" : "#A32D2D", fontVariantNumeric: "tabular-nums" }}>{formatBRL(entrou - saiu)}</div>
              <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 3 }}>entrou menos saiu</div>
            </div>
          </div>

          {porDia.length === 0 ? (
            <div style={{ ...cardStyle, textAlign: "center", color: "#8A8778", fontSize: 13 }}>
              Nada nesse período.
            </div>
          ) : (
            <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, background: "#FFFFFF", overflow: "hidden", marginBottom: 8 }}>
              {porDia.map((g, gi) => {
                const saldoDia = g.itens.reduce((s, l) => s + (l.tipo === "entrada" ? 1 : -1) * Number(l.valor), 0);
                return (
                  <React.Fragment key={g.dia}>
                    <div style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
                      padding: "9px 13px", background: "#F6F1E7", fontSize: 12,
                      borderBottom: "1px solid #E8E2D2",
                      borderTop: gi > 0 ? "1px solid #E8E2D2" : "none",
                    }}>
                      <span style={{ fontWeight: 800 }}>{diaLongo(g.dia)}</span>
                      {filtro === "tudo" && (
                        <span style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums", color: saldoDia >= 0 ? "#0F6E56" : "#A32D2D" }}>
                          {saldoDia >= 0 ? "+ " : "− "}{formatBRL(Math.abs(saldoDia))}
                        </span>
                      )}
                    </div>
                    {g.itens.map((l, li) => {
                      const entrada = l.tipo === "entrada";
                      const zerado = Number(l.valor) === 0;
                      return (
                        <div key={`${g.dia}-${li}`} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 13px", borderTop: li > 0 ? "1px solid #F0EBDD" : "none", fontSize: 12.5 }}>
                          <span style={{ width: 18, textAlign: "center", flexShrink: 0, color: entrada ? "#0F6E56" : "#A32D2D" }}>
                            {entrada ? <ArrowDownRight size={15} /> : <ArrowUpRight size={15} />}
                          </span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.descricao}</span>
                            {l.detalhe && <span style={{ fontSize: 10.5, color: "#8A8778" }}>{l.detalhe}</span>}
                          </span>
                          <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: zerado ? "#8A8778" : entrada ? "#0F6E56" : "#A32D2D" }}>
                            {formatBRL(l.valor)}
                          </span>
                        </div>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>
          )}

          <div style={{ fontSize: 10.5, color: "#8A8778", lineHeight: 1.55, padding: "0 2px" }}>
            <strong>Entrou</strong> é a venda no dia em que aconteceu, pelo valor cheio — o dinheiro do cartão
            ainda vai levar dias pra cair e vem com a taxa descontada.
            <strong> Saiu</strong> é a conta no dia em que foi paga, não no vencimento.
            Conta lançada e ainda não paga não aparece aqui: pra essa existe o <strong>Contas a pagar</strong>.
            Dia sem venda aparece com R$ 0,00, pra você distinguir "fechou" de "não baixou o histórico".
          </div>
        </>
      )}
    </div>
  );
}

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
