import React, { useState, useEffect, useCallback, useMemo } from "react";
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

// Prazos de pagamento: continuam fixos porque não são "modalidade" —
// são o desdobramento do boleto (7, 14, 21, 28 dias).
const PRAZO_LABEL = { a_vista: "À vista", "7_dias": "7 dias", "14_dias": "14 dias", "21_dias": "21 dias", "28_dias": "28 dias", outro: "Outro prazo" };

// As três listas abaixo agora moram na tabela `listas_opcoes` e são
// editadas em DRE → Listas. O que ficou aqui é só o PADRÃO: se a
// migração 080 ainda não rodou, ou se a consulta falhar, a tela abre
// com estes valores em vez de ficar com os menus vazios.
const FORMAS_PADRAO = [
  { valor: "pix", rotulo: "Pix" },
  { valor: "debito", rotulo: "Débito" },
  { valor: "credito", rotulo: "Cartão de crédito" },
  { valor: "boleto", rotulo: "Boleto" },
];
const CATEGORIAS_PADRAO = [
  { valor: "agua", rotulo: "Água", centro_custo: "utilidades" },
  { valor: "luz", rotulo: "Luz", centro_custo: "utilidades" },
  { valor: "internet", rotulo: "Internet", centro_custo: "utilidades" },
  { valor: "alvara", rotulo: "Alvará", centro_custo: "impostos" },
  { valor: "aluguel", rotulo: "Aluguel", centro_custo: "ocupacao" },
  { valor: "telefone", rotulo: "Telefone", centro_custo: "utilidades" },
  { valor: "outro", rotulo: "Outra", centro_custo: null },
];
const CENTROS_PADRAO = [
  { valor: "pessoas", rotulo: "Pessoas" },
  { valor: "insumos", rotulo: "Insumos" },
  { valor: "utensilios", rotulo: "Utensílios" },
  { valor: "manutencao", rotulo: "Consertos e manutenção" },
  { valor: "imobilizado", rotulo: "Imobilizado" },
  { valor: "ocupacao", rotulo: "Ocupação" },
  { valor: "utilidades", rotulo: "Utilidades" },
  { valor: "impostos", rotulo: "Impostos e taxas" },
  { valor: "marketing", rotulo: "Marketing e vendas" },
  { valor: "administrativo", rotulo: "Administrativo" },
];

// Busca as listas no banco. Devolve o padrão se a tabela ainda não
// existe — assim dá pra colar este arquivo antes de rodar o SQL sem a
// tela quebrar.
async function buscarListas() {
  const { data, error } = await supabase
    .from("listas_opcoes")
    .select("lista, valor, rotulo, centro_custo, ordem, ativo")
    .eq("ativo", true)
    .order("ordem");
  if (error || !data || data.length === 0) {
    return { forma_pagamento: FORMAS_PADRAO, categoria_recorrente: CATEGORIAS_PADRAO, centro_custo: CENTROS_PADRAO };
  }
  const por = (nome, padrao) => {
    const achadas = data.filter((o) => o.lista === nome);
    return achadas.length > 0 ? achadas : padrao;
  };
  return {
    forma_pagamento: por("forma_pagamento", FORMAS_PADRAO),
    categoria_recorrente: por("categoria_recorrente", CATEGORIAS_PADRAO),
    centro_custo: por("centro_custo", CENTROS_PADRAO),
  };
}

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
  const [detalhesEdicao, setDetalhesEdicao] = useState({ forma: "", vencimento: "", centroCusto: "" });
  const [listas, setListas] = useState({
    forma_pagamento: FORMAS_PADRAO,
    categoria_recorrente: CATEGORIAS_PADRAO,
    centro_custo: CENTROS_PADRAO,
  });

  useEffect(() => { buscarListas().then(setListas); }, []);

  const categorias  = listas.categoria_recorrente;
  const catLabel    = useMemo(() => Object.fromEntries(categorias.map((c) => [c.valor, c.rotulo])), [categorias]);
  const catCentro   = useMemo(() => Object.fromEntries(categorias.map((c) => [c.valor, c.centro_custo || null])), [categorias]);
  const centroLabel = useMemo(() => Object.fromEntries(listas.centro_custo.map((c) => [c.valor, c.rotulo])), [listas.centro_custo]);
  // O selo da conta mostra tanto a forma (Pix) quanto o prazo (28 dias)
  const formaLabel  = useMemo(
    () => ({ ...PRAZO_LABEL, ...Object.fromEntries(listas.forma_pagamento.map((f) => [f.valor, f.rotulo])) }),
    [listas.forma_pagamento]
  );

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
    setNovaConta({ descricao: catLabel[categoria] || "", valor: "", vencimento: new Date().toISOString().slice(0, 10) });
  };

  const salvarContaRecorrente = async () => {
    const valor = parseFloat(novaConta.valor);
    if (!valor || valor <= 0) { setErro("Informe um valor válido."); return; }
    setSalvando(true);
    setErro("");
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("contas_pagar").insert({
      descricao: novaConta.descricao || catLabel[criandoCategoria],
      valor_total: round2(valor),
      categoria: criandoCategoria,
      centro_custo: catCentro[criandoCategoria] || null,
      data_vencimento: novaConta.vencimento,
      criado_por: userData?.user?.id,
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    setCriandoCategoria(null);
    carregar();
  };

  const salvarDetalhes = async (conta) => {
    const patch = {
      forma_pagamento: detalhesEdicao.forma || null,
      data_vencimento: detalhesEdicao.vencimento || null,
      centro_custo: detalhesEdicao.centroCusto || null,
    };
    const { error } = await supabase.from("contas_pagar").update(patch).eq("id", conta.id);
    if (error) { setErro(error.message); return; }

    // Sincroniza a forma de pagamento com a movimentação de estoque que
    // gerou essa conta — tanto pra compra manual (movimentacao_estoque_id)
    // quanto pra nota fiscal (documento_compra_id compartilhado entre as
    // duas tabelas).
    if (conta.movimentacao_estoque_id) {
      await supabase.from("movimentacoes_estoque").update({ forma_pagamento: patch.forma_pagamento }).eq("id", conta.movimentacao_estoque_id);
    } else if (conta.documento_compra_id) {
      await supabase.from("movimentacoes_estoque").update({ forma_pagamento: patch.forma_pagamento }).eq("documento_compra_id", conta.documento_compra_id);
    }

    setContas((prev) => prev.map((c) => c.id === conta.id ? { ...c, ...patch } : c));
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

  const marcarComoPago = async (conta) => {
    const hoje = new Date().toISOString().slice(0, 10);
    setErro("");
    if ((conta.valor_pago || 0) < conta.valor_total) {
      // registra o restante como um pagamento, pra manter o histórico coerente
      const { data: userData } = await supabase.auth.getUser();
      const restante = round2(conta.valor_total - (conta.valor_pago || 0));
      await supabase.from("pagamentos_conta").insert({
        conta_pagar_id: conta.id, valor: restante, data_pagamento: hoje, criado_por: userData?.user?.id,
      });
    }
    const { error } = await supabase.from("contas_pagar").update({ valor_pago: conta.valor_total, status: "pago" }).eq("id", conta.id);
    if (error) { setErro(error.message); return; }
    carregar();
  };

  const marcarComoPendente = async (conta) => {
    if (!window.confirm("Marcar essa conta como pendente de novo? O valor pago fica zerado (não apaga o histórico de pagamentos já registrados).")) return;
    const { error } = await supabase.from("contas_pagar").update({ valor_pago: 0, status: "pendente" }).eq("id", conta.id);
    if (error) { setErro(error.message); return; }
    carregar();
  };

  const contasVisiveis = contas.filter((c) => mostrarPagas || c.status !== "pago");
  const semCentroCusto = contas.filter((c) => !c.centro_custo).length;

  return (
    <div>
      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}

      {semCentroCusto > 0 && (
        <div style={avisoStyle}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13 }}>{semCentroCusto} conta{semCentroCusto > 1 ? "s" : ""} ainda sem centro de custo definido — clica no lápis de cada uma pra classificar.</div>
        </div>
      )}

      {previsao.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 14 }}>
          <div style={sectionLabel}>Previsão de custos mensais</div>
          <div style={{ fontSize: 10, color: "#8A8778", marginBottom: 8 }}>Média das contas recorrentes já lançadas — dá uma ideia do que costuma vir por aí.</div>
          {previsao.map((p) => (
            <div key={p.categoria} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0" }}>
              <span style={{ color: "#22231F" }}>{catLabel[p.categoria] || p.categoria}</span>
              <span style={{ color: "#8A8778" }}>~{brl(p.media)}<span style={{ fontSize: 10 }}> ({p.meses} lanç.)</span></span>
            </div>
          ))}
        </div>
      )}

      <div style={sectionLabel}>Contas fixas — lançar rápido</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
        {categorias.map((c) => (
          <button key={c.valor} onClick={() => abrirCriarRecorrente(c.valor)}
            style={{ padding: "6px 12px", borderRadius: 999, border: "1px solid #37A0E5", background: "none", color: "#185FA5", fontSize: 12, cursor: "pointer" }}>
            + {c.rotulo}
          </button>
        ))}
      </div>

      {criandoCategoria && (
        <div style={{ ...cardStyle, border: "1px dashed #37A0E5", marginBottom: 16 }}>
          <div style={{ fontSize: 12, color: "#185FA5", marginBottom: 8 }}>Nova conta — {catLabel[criandoCategoria]}</div>
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
                    <button onClick={() => marcarComoPendente(conta)} style={{ ...pill, background: "#EAF3DE", color: "#27500A", border: "none", cursor: "pointer" }}>Pago ↺</button>
                  ) : vencida ? (
                    <span style={{ ...pill, background: "#F0999522", color: "#A32D2D" }}>Vencida há {Math.abs(dias)}d</span>
                  ) : proxima ? (
                    <span style={{ ...pill, background: "#FAC77555", color: "#854F0B" }}>{dias === 0 ? "Vence hoje" : `Vence em ${dias}d`}</span>
                  ) : (
                    <span style={{ ...pill, background: "#F6F1E7", color: "#8A8778" }}>{formaLabel[conta.forma_pagamento] || formaLabel[conta.condicao_pagamento] || "—"}</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 4 }}>
                  {conta.data_compra && <>Comprado {fmtData(conta.data_compra)} · </>}
                  Vencimento {fmtData(conta.data_vencimento)} · Total {brl(conta.valor_total)}
                </div>

                {editandoFormaId === conta.id ? (
                  <div style={{ border: "1px dashed #37A0E5", borderRadius: 8, padding: 8, marginBottom: 6, display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "#8A8778", width: 100, flexShrink: 0 }}>Forma:</span>
                      <select value={detalhesEdicao.forma} onChange={(e) => setDetalhesEdicao((f) => ({ ...f, forma: e.target.value }))}
                        style={{ fontSize: 12, padding: "3px 4px", borderRadius: 4, border: "1px solid #E8E2D2", background: "#FFFFFF", flex: 1 }}>
                        <option value="">Não informado</option>
                        {listas.forma_pagamento.map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
                      </select>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "#8A8778", width: 100, flexShrink: 0 }}>Vencimento:</span>
                      <input type="date" value={detalhesEdicao.vencimento} onChange={(e) => setDetalhesEdicao((f) => ({ ...f, vencimento: e.target.value }))}
                        style={{ fontSize: 12, padding: "3px 4px", borderRadius: 4, border: "1px solid #E8E2D2", flex: 1 }} />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 11, color: "#8A8778", width: 100, flexShrink: 0 }}>Centro de custo:</span>
                      <select value={detalhesEdicao.centroCusto} onChange={(e) => setDetalhesEdicao((f) => ({ ...f, centroCusto: e.target.value }))}
                        style={{ fontSize: 12, padding: "3px 4px", borderRadius: 4, border: "1px solid #E8E2D2", background: "#FFFFFF", flex: 1 }}>
                        <option value="">— pendente —</option>
                        {listas.centro_custo.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
                      </select>
                    </div>
                    <button onClick={() => salvarDetalhes(conta)} style={{ ...btnSecondary, display: "flex", justifyContent: "center", gap: 6, marginTop: 2 }}>
                      <Check size={13} /> Salvar
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 11, color: "#22231F" }}>{formaLabel[conta.forma_pagamento] || "Forma não informada"}</span>
                    <span style={{ fontSize: 11, color: "#8A8778" }}>·</span>
                    <span style={{ fontSize: 11, color: conta.centro_custo ? "#22231F" : "#A32D2D", fontWeight: conta.centro_custo ? 400 : 700 }}>
                      {conta.centro_custo ? centroLabel[conta.centro_custo] || conta.centro_custo : "Sem centro de custo"}
                    </span>
                    <button onClick={() => {
                      setDetalhesEdicao({ forma: conta.forma_pagamento || "", vencimento: conta.data_vencimento || "", centroCusto: conta.centro_custo || "" });
                      setEditandoFormaId(conta.id);
                    }} style={ghostIconBtn} aria-label="Editar forma de pagamento, vencimento e centro de custo"><Pencil size={12} /></button>
                  </div>
                )}
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
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      <button onClick={() => marcarComoPago(conta)}
                        style={{ ...btnSecondary, flex: 1, background: "#22231F", color: "#F3EFE3", display: "flex", justifyContent: "center", gap: 6 }}>
                        <Check size={14} /> Marcar como pago
                      </button>
                      <button onClick={() => { setPagandoId(conta.id); setValorPagamento(String(restante)); }} style={{ ...btnSecondary, flex: 1 }}>
                        Pagar parcial…
                      </button>
                    </div>
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
