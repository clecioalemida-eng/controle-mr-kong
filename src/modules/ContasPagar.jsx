import React, { useState, useEffect, useCallback } from "react";
import { AlertTriangle, Check, Loader2, ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

function brl(v) { return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function fmtData(d) { if (!d) return "—"; return new Date(d + "T12:00:00").toLocaleDateString("pt-BR"); }
function diasAte(dataVencimento) {
  if (!dataVencimento) return null;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const venc = new Date(dataVencimento + "T00:00:00");
  return Math.round((venc - hoje) / (1000 * 60 * 60 * 24));
}
function round2(n) { return Math.round((n || 0) * 100) / 100; }

const CONDICAO_LABEL = { a_vista: "À vista", "7_dias": "7 dias", "14_dias": "14 dias", "21_dias": "21 dias", "28_dias": "28 dias", outro: "Outro prazo", pix: "Pix", debito: "Débito", credito: "Cartão de crédito", boleto: "Boleto" };
const CATEGORIAS_RECORRENTES = [
  { valor: "agua", rotulo: "Água" },
  { valor: "luz", rotulo: "Luz" },
  { valor: "internet", rotulo: "Internet" },
  { valor: "alvara", rotulo: "Alvará" },
  { valor: "aluguel", rotulo: "Aluguel" },
  { valor: "telefone", rotulo: "Telefone" },
  { valor: "outro", rotulo: "Outra" },
];
const CATEGORIA_LABEL = Object.fromEntries(CATEGORIAS_RECORRENTES.map((c) => [c.valor, c.rotulo]));
const FORMAS_PAGAMENTO = [
  { valor: "", rotulo: "Não informado" },
  { valor: "pix", rotulo: "Pix" },
  { valor: "debito", rotulo: "Débito" },
  { valor: "credito", rotulo: "Cartão de crédito" },
  { valor: "boleto", rotulo: "Boleto" },
];

// Contas a pagar, geradas ao confirmar uma nota fiscal (ver
// src/modules/NotasFiscais.jsx) — organizadas por prazo de vencimento,
// com registro de pagamento parcial.
export default function ContasPagar() {
  const [contas, setContas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [mostrarPagas, setMostrarPagas] = useState(true);
  const [pagandoId, setPagandoId] = useState(null);
  const [valorPagamento, setValorPagamento] = useState("");
  const [dataPagamento, setDataPagamento] = useState(() => new Date().toISOString().slice(0, 10));
  const [salvando, setSalvando] = useState(false);
  const [expandidoId, setExpandidoId] = useState(null);
  const [historicoPagamentos, setHistoricoPagamentos] = useState({}); // conta_id -> [pagamentos]
  const [criandoCategoria, setCriandoCategoria] = useState(null); // categoria sendo criada, ou null
  const [novaConta, setNovaConta] = useState({ descricao: "", valor: "", vencimento: new Date().toISOString().slice(0, 10) });
  const [previsao, setPrevisao] = useState([]); // [{ categoria, media, meses }]
  const [editandoFormaId, setEditandoFormaId] = useState(null);
  const [formaEdicao, setFormaEdicao] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    const { data, error } = await supabase.from("contas_pagar").select("*").order("data_vencimento", { ascending: true, nullsFirst: false });
    if (error) setErro(error.message);
    setContas(data || []);
    setCarregando(false);

    // Previsão de custos mensais: média dos últimos meses de cada
    // categoria recorrente que já tem pelo menos uma conta lançada.
    const recorrentes = (data || []).filter((c) => c.categoria && c.categoria !== "compra" && c.categoria !== "outro");
    const porCategoria = {};
    recorrentes.forEach((c) => {
      if (!porCategoria[c.categoria]) porCategoria[c.categoria] = [];
      porCategoria[c.categoria].push(c.valor_total);
    });
    setPrevisao(Object.entries(porCategoria).map(([categoria, valores]) => ({
      categoria,
      media: round2(valores.reduce((s, v) => s + v, 0) / valores.length),
      meses: valores.length,
    })));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const abrirCriarRecorrente = (categoria) => {
    setCriandoCategoria(categoria);
    setNovaConta({ descricao: CATEGORIA_LABEL[categoria] || "", valor: "", vencimento: new Date().toISOString().slice(0, 10) });
  };

  const salvarContaRecorrente = async () => {
    const valor = parseFloat(novaConta.valor);
    if (!valor || valor <= 0) { setErro("Informe um valor válido."); return; }
    setSalvando(true);
    setErro("");
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("contas_pagar").insert({
      descricao: novaConta.descricao || CATEGORIA_LABEL[criandoCategoria],
      valor_total: round2(valor),
      categoria: criandoCategoria,
      data_vencimento: novaConta.vencimento,
      criado_por: userData?.user?.id,
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    setCriandoCategoria(null);
    carregar();
  };

  const salvarFormaPagamento = async (contaId) => {
    const { error } = await supabase.from("contas_pagar").update({ forma_pagamento: formaEdicao || null }).eq("id", contaId);
    if (error) { setErro(error.message); return; }
    setContas((prev) => prev.map((c) => c.id === contaId ? { ...c, forma_pagamento: formaEdicao || null } : c));
    setEditandoFormaId(null);
  };

  const abrirHistorico = async (contaId) => {
    if (expandidoId === contaId) { setExpandidoId(null); return; }
    const { data } = await supabase.from("pagamentos_conta").select("*").eq("conta_pagar_id", contaId).order("data_pagamento", { ascending: false });
    setHistoricoPagamentos((prev) => ({ ...prev, [contaId]: data || [] }));
    setExpandidoId(contaId);
  };

  const registrarPagamento = async (conta) => {
    const valor = parseFloat(valorPagamento);
    if (!valor || valor <= 0) { setErro("Informe um valor de pagamento válido."); return; }
    setSalvando(true);
    setErro("");
    const { data: userData } = await supabase.auth.getUser();
    const { error: errPag } = await supabase.from("pagamentos_conta").insert({
      conta_pagar_id: conta.id, valor, data_pagamento: dataPagamento, criado_por: userData?.user?.id,
    });
    if (errPag) { setErro(errPag.message); setSalvando(false); return; }

    const novoValorPago = round2((conta.valor_pago || 0) + valor);
    const novoStatus = novoValorPago >= conta.valor_total ? "pago" : "parcial";
    const { error: errConta } = await supabase.from("contas_pagar").update({ valor_pago: novoValorPago, status: novoStatus }).eq("id", conta.id);
    if (errConta) { setErro(errConta.message); setSalvando(false); return; }

    setSalvando(false);
    setPagandoId(null);
    setValorPagamento("");
    carregar();
  };

  const contasVisiveis = contas.filter((c) => mostrarPagas || c.status !== "pago");

  return (
    <div>
      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}

      {previsao.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 14 }}>
          <div style={sectionLabel}>Previsão de custos mensais</div>
          <div style={{ fontSize: 10, color: "#8A8778", marginBottom: 8 }}>Média das contas recorrentes já lançadas — dá uma ideia do que costuma vir por aí.</div>
          {previsao.map((p) => (
            <div key={p.categoria} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0" }}>
              <span style={{ color: "#22231F" }}>{CATEGORIA_LABEL[p.categoria] || p.categoria}</span>
              <span style={{ color: "#8A8778" }}>~{brl(p.media)}<span style={{ fontSize: 10 }}> ({p.meses} lanç.)</span></span>
            </div>
          ))}
        </div>
      )}

      <div style={sectionLabel}>Contas fixas — lançar rápido</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
        {CATEGORIAS_RECORRENTES.map((c) => (
          <button key={c.valor} onClick={() => abrirCriarRecorrente(c.valor)}
            style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid #37A0E5", background: "none", color: "#185FA5", fontSize: 12, cursor: "pointer" }}>
            + {c.rotulo}
          </button>
        ))}
      </div>

      {criandoCategoria && (
        <div style={{ ...cardStyle, border: "1px dashed #37A0E5", marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "#185FA5", marginBottom: 8 }}>Nova conta — {CATEGORIA_LABEL[criandoCategoria]}</div>
          <input value={novaConta.descricao} onChange={(e) => setNovaConta((f) => ({ ...f, descricao: e.target.value }))}
            placeholder="Descrição" style={{ width: "100%", boxSizing: "border-box", marginBottom: 6, padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13 }} />
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input type="number" step="0.01" value={novaConta.valor} onChange={(e) => setNovaConta((f) => ({ ...f, valor: e.target.value }))}
              placeholder="Valor (pode ser uma estimativa)" style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13 }} />
            <input type="date" value={novaConta.vencimento} onChange={(e) => setNovaConta((f) => ({ ...f, vencimento: e.target.value }))}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13 }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={salvarContaRecorrente} disabled={salvando} style={{ ...btnSecondary, flex: 1 }}>Salvar</button>
            <button onClick={() => setCriandoCategoria(null)} style={linkBtn}>Cancelar</button>
          </div>
        </div>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#8A8778", marginBottom: 14 }}>
        <input type="checkbox" checked={mostrarPagas} onChange={(e) => setMostrarPagas(e.target.checked)} />
        Mostrar contas já pagas
      </label>

      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {contasVisiveis.map((conta) => {
            const dias = diasAte(conta.data_vencimento);
            const vencida = dias != null && dias < 0 && conta.status !== "pago";
            const proxima = dias != null && dias >= 0 && dias <= 5 && conta.status !== "pago";
            const restante = round2(conta.valor_total - (conta.valor_pago || 0));
            return (
              <div key={conta.id} style={{
                ...cardStyle,
                border: vencida ? "1px solid #F0999599" : proxima ? "1px solid #FAC775" : "1px solid #E8E2D2",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#22231F" }}>{conta.fornecedor_nome || "Fornecedor não identificado"}</div>
                  {conta.status === "pago" ? (
                    <span style={{ ...pill, background: "#EAF3DE", color: "#27500A" }}>Pago</span>
                  ) : vencida ? (
                    <span style={{ ...pill, background: "#F0999522", color: "#A32D2D" }}>Vencida há {Math.abs(dias)}d</span>
                  ) : proxima ? (
                    <span style={{ ...pill, background: "#FAC77555", color: "#854F0B" }}>{dias === 0 ? "Vence hoje" : `Vence em ${dias}d`}</span>
                  ) : (
                    <span style={{ ...pill, background: "#F6F1E7", color: "#8A8778" }}>{CONDICAO_LABEL[conta.forma_pagamento] || CONDICAO_LABEL[conta.condicao_pagamento] || "—"}</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 4 }}>Vencimento {fmtData(conta.data_vencimento)} · Total {brl(conta.valor_total)}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "#8A8778" }}>Forma de pagamento:</span>
                  {editandoFormaId === conta.id ? (
                    <>
                      <select value={formaEdicao} onChange={(e) => setFormaEdicao(e.target.value)}
                        style={{ fontSize: 12, padding: "2px 4px", borderRadius: 4, border: "1px solid #E8E2D2", background: "#FFFFFF" }}>
                        {FORMAS_PAGAMENTO.map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
                      </select>
                      <button onClick={() => salvarFormaPagamento(conta.id)} style={{ ...ghostIconBtn, color: "#2F8F5B" }} aria-label="Salvar forma de pagamento"><Check size={13} /></button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 11, color: "#22231F" }}>{CONDICAO_LABEL[conta.forma_pagamento] || "Não informado"}</span>
                      <button onClick={() => { setFormaEdicao(conta.forma_pagamento || ""); setEditandoFormaId(conta.id); }} style={ghostIconBtn} aria-label="Editar forma de pagamento"><Pencil size={12} /></button>
                    </>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: conta.status === "pago" ? 0 : 8 }}>
                  <span style={{ color: "#8A8778" }}>Pago: {brl(conta.valor_pago)}</span>
                  {conta.status !== "pago" && <span style={{ fontWeight: 700, color: "#A32D2D" }}>Falta: {brl(restante)}</span>}
                </div>

                {conta.status !== "pago" && (
                  pagandoId === conta.id ? (
                    <div style={{ display: "grid", gap: 6, marginTop: 8, paddingTop: 8, borderTop: "1px solid #F0EBDD" }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <input type="number" step="0.01" value={valorPagamento} onChange={(e) => setValorPagamento(e.target.value)}
                          placeholder={`Valor (até ${brl(restante)})`} autoFocus
                          style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                        <input type="date" value={dataPagamento} onChange={(e) => setDataPagamento(e.target.value)}
                          style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button onClick={() => registrarPagamento(conta)} disabled={salvando} style={{ ...btnSecondary, flex: 1, display: "flex", justifyContent: "center", gap: 6 }}>
                          {salvando ? <Loader2 size={14} /> : <Check size={14} />} Confirmar pagamento
                        </button>
                        <button onClick={() => { setPagandoId(null); setValorPagamento(""); }} style={linkBtn}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => { setPagandoId(conta.id); setValorPagamento(String(restante)); }}
                      style={{ ...btnSecondary, width: "100%", marginTop: 4 }}>
                      + Registrar pagamento
                    </button>
                  )
                )}

                <button onClick={() => abrirHistorico(conta.id)} style={{ ...linkBtn, fontSize: 11, marginTop: 8, display: "flex", alignItems: "center", gap: 4 }}>
                  {expandidoId === conta.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Histórico de pagamentos
                </button>
                {expandidoId === conta.id && (
                  <div style={{ marginTop: 6 }}>
                    {(historicoPagamentos[conta.id] || []).map((p) => (
                      <div key={p.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#8A8778", padding: "3px 0" }}>
                        <span>{fmtData(p.data_pagamento)}</span><span>{brl(p.valor)}</span>
                      </div>
                    ))}
                    {(historicoPagamentos[conta.id] || []).length === 0 && <div style={{ fontSize: 11, color: "#8A8778" }}>Nenhum pagamento registrado ainda.</div>}
                  </div>
                )}
              </div>
            );
          })}
          {contasVisiveis.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Nenhuma conta a pagar por aqui.</div>}
        </div>
      )}
    </div>
  );
}

const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const sectionLabel = { fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778", marginBottom: 8 };
const ghostIconBtn = { border: "none", background: "none", color: "#8A8778", cursor: "pointer", padding: 2, display: "flex" };
const btnSecondary = { background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const linkBtn = { background: "none", border: "none", color: "#8A6A0F", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, textAlign: "left" };
const pill = { fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap" };
const avisoStyle = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 14 };
