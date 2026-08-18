import React, { useState, useEffect, useCallback } from "react";
import {
  Loader2, Plus, Trash2, Pencil, Check, RefreshCw, AlertTriangle, ChevronLeft,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";

const UNIDADES = ["un", "g", "kg", "ml", "l"];

function brl(v) {
  return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function hoje() { return new Date().toISOString().slice(0, 10); }
function diasAtras(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Componente embutível — sem cabeçalho/moldura própria, pensado para viver
// dentro de uma aba do módulo Financeiro (que já fornece o app-shell e o
// título da tela). Mantém sua própria navegação interna (lista <-> editor).
export default function FichasTecnicas() {
  const [tela, setTela] = useState("lista"); // lista | editor
  const [pratos, setPratos] = useState([]);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [importando, setImportando] = useState(false);
  const [erro, setErro] = useState("");
  const [pratoAtual, setPratoAtual] = useState(null);

  const carregarPratos = useCallback(async () => {
    setCarregandoLista(true);
    setErro("");
    const [{ data: pratosData, error: e1 }, { data: itensData, error: e2 }] = await Promise.all([
      supabase.from("pratos").select("*").order("nome"),
      supabase.from("prato_insumos").select("prato_id, quantidade, insumo:insumos(custo_medio_atual)"),
    ]);
    if (e1 || e2) {
      setErro((e1 || e2).message);
      setCarregandoLista(false);
      return;
    }
    const custoPorPrato = {};
    (itensData || []).forEach((li) => {
      const custo = (li.quantidade || 0) * (li.insumo?.custo_medio_atual || 0);
      custoPorPrato[li.prato_id] = (custoPorPrato[li.prato_id] || 0) + custo;
      custoPorPrato[li.prato_id + ":n"] = (custoPorPrato[li.prato_id + ":n"] || 0) + 1;
    });
    const combinados = (pratosData || []).map((p) => {
      const temFicha = (custoPorPrato[p.id + ":n"] || 0) > 0;
      const custoTotal = custoPorPrato[p.id] || 0;
      const custoZerado = temFicha && custoTotal === 0; // tem insumo(s) na ficha, mas nenhum com preço ainda
      const margem = p.preco_venda - custoTotal;
      const margemPct = p.preco_venda > 0 ? (margem / p.preco_venda) * 100 : 0;
      return { ...p, temFicha, custoTotal, custoZerado, margem, margemPct };
    });
    setPratos(combinados);
    setCarregandoLista(false);
  }, []);

  useEffect(() => { carregarPratos(); }, [carregarPratos]);

  const importarPratos = async () => {
    setImportando(true);
    setErro("");
    const { data, error } = await supabase.functions.invoke("cardapioweb-proxy", {
      body: { acao: "importar_pratos", data_inicio: `${diasAtras(90)}T00:00:00-03:00`, data_fim: `${hoje()}T23:59:59-03:00` },
    });
    setImportando(false);
    if (error) { setErro(error.message); return; }
    if (data?.error) { setErro(data.error); return; }
    carregarPratos();
  };

  if (tela === "editor" && pratoAtual) {
    return (
      <EditorFicha
        prato={pratoAtual}
        onVoltar={() => { setTela("lista"); setPratoAtual(null); carregarPratos(); }}
      />
    );
  }

  return (
    <div>
      <div style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: "#8A8778" }}>
          {pratos.filter((p) => p.temFicha).length} de {pratos.length} pratos com ficha cadastrada
        </div>
        <button onClick={importarPratos} disabled={importando} style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6 }}>
          {importando ? <Loader2 size={14} /> : <RefreshCw size={14} />}
          Importar pratos
        </button>
      </div>

      {erro && (
        <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>
      )}

      {carregandoLista ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : pratos.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", color: "#8A8778", fontSize: 13 }}>
          Nenhum prato encontrado ainda. Clique em "Importar pratos" para buscar os itens vendidos nos últimos 90 dias.
        </div>
      ) : (
        <div className="list-grid">
          {pratos.map((p) => (
            <button key={p.id} onClick={() => { setPratoAtual(p); setTela("editor"); }}
              style={{ ...itemRow, cursor: "pointer", textAlign: "left", border: (p.temFicha && !p.custoZerado) ? "1px solid #E8E2D2" : "1px solid #F0D8CE" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#22231F" }}>{p.nome}</div>
                <div style={{ fontSize: 12, color: "#8A8778" }}>{brl(p.preco_venda)}</div>
              </div>
              {p.custoZerado ? (
                <span style={{ ...pill, background: "#F0999522", color: "#A32D2D" }}>Custo pendente</span>
              ) : p.temFicha ? (
                <span style={{ ...pill, background: p.margemPct >= 50 ? "#2F8F5B22" : p.margemPct >= 30 ? "#FAC77555" : "#F0999522", color: p.margemPct >= 50 ? "#0F6E56" : p.margemPct >= 30 ? "#854F0B" : "#A32D2D" }}>
                  Margem {p.margemPct.toFixed(1)}%
                </span>
              ) : (
                <span style={{ ...pill, background: "#F0999522", color: "#A32D2D" }}>Sem ficha</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor de uma ficha técnica (um prato)
// ---------------------------------------------------------------------------
function EditorFicha({ prato, onVoltar }) {
  const [carregando, setCarregando] = useState(true);
  const [linhas, setLinhas] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [selecaoNova, setSelecaoNova] = useState("");
  const [editandoInsumoId, setEditandoInsumoId] = useState(null);
  const [formEdicao, setFormEdicao] = useState({ nome: "", unidade: "un", custo: 0, composto: false, rendimento: "" });
  const [composicaoEdicao, setComposicaoEdicao] = useState([]); // sub-insumos de um insumo composto
  const [subInsumoSel, setSubInsumoSel] = useState("");
  const [novoInsumoAberto, setNovoInsumoAberto] = useState(false);
  const [novoInsumoForm, setNovoInsumoForm] = useState({ nome: "", unidade: "un", custo: 0 });
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");

  const carregarTudo = useCallback(async () => {
    setCarregando(true);
    const [{ data: itens }, { data: todosInsumos }] = await Promise.all([
      supabase.from("prato_insumos").select("insumo_id, quantidade, insumo:insumos(id, nome, unidade, custo_medio_atual, composto)").eq("prato_id", prato.id),
      supabase.from("insumos").select("*").order("nome"),
    ]);
    setLinhas((itens || []).map((it) => ({
      insumo_id: it.insumo_id,
      nome: it.insumo?.nome,
      unidade: it.insumo?.unidade,
      custo_medio_atual: it.insumo?.custo_medio_atual || 0,
      composto: it.insumo?.composto || false,
      quantidade: it.quantidade,
    })));
    setInsumos(todosInsumos || []);
    setCarregando(false);
  }, [prato.id]);

  useEffect(() => { carregarTudo(); }, [carregarTudo]);

  const insumosDisponiveis = insumos.filter((i) => !linhas.some((l) => l.insumo_id === i.id));
  const insumosSimples = insumos.filter((i) => !i.composto); // composto só pode ser feito de insumos simples

  const adicionarInsumo = () => {
    if (!selecaoNova) return;
    const insumo = insumos.find((i) => i.id === selecaoNova);
    if (!insumo) return;
    setLinhas((prev) => [...prev, { insumo_id: insumo.id, nome: insumo.nome, unidade: insumo.unidade, custo_medio_atual: insumo.custo_medio_atual, composto: insumo.composto, quantidade: 1 }]);
    setSelecaoNova("");
  };

  const alterarQuantidade = (idx, valor) => {
    setLinhas((prev) => prev.map((l, i) => i === idx ? { ...l, quantidade: parseFloat(valor) || 0 } : l));
  };

  const removerLinha = (idx) => setLinhas((prev) => prev.filter((_, i) => i !== idx));

  const abrirEdicaoInsumo = async (linha) => {
    setEditandoInsumoId(linha.insumo_id);
    setErro("");
    const insumo = insumos.find((i) => i.id === linha.insumo_id);
    setFormEdicao({
      nome: linha.nome,
      unidade: linha.unidade,
      custo: linha.custo_medio_atual,
      composto: insumo?.composto || false,
      rendimento: insumo?.rendimento ?? "",
    });
    if (insumo?.composto) {
      const { data } = await supabase
        .from("insumo_composicao")
        .select("insumo_filho_id, quantidade, filho:insumos(id, nome, unidade, custo_medio_atual)")
        .eq("insumo_pai_id", linha.insumo_id);
      setComposicaoEdicao((data || []).map((c) => ({
        insumo_id: c.insumo_filho_id, nome: c.filho?.nome, unidade: c.filho?.unidade,
        custo_medio_atual: c.filho?.custo_medio_atual || 0, quantidade: c.quantidade,
      })));
    } else {
      setComposicaoEdicao([]);
    }
  };

  const adicionarSubInsumo = () => {
    if (!subInsumoSel) return;
    const insumo = insumosSimples.find((i) => i.id === subInsumoSel);
    if (!insumo || composicaoEdicao.some((c) => c.insumo_id === insumo.id)) return;
    setComposicaoEdicao((prev) => [...prev, { insumo_id: insumo.id, nome: insumo.nome, unidade: insumo.unidade, custo_medio_atual: insumo.custo_medio_atual, quantidade: 0 }]);
    setSubInsumoSel("");
  };
  const alterarQtdSubInsumo = (idx, valor) => {
    setComposicaoEdicao((prev) => prev.map((c, i) => i === idx ? { ...c, quantidade: parseFloat(valor) || 0 } : c));
  };
  const removerSubInsumo = (idx) => setComposicaoEdicao((prev) => prev.filter((_, i) => i !== idx));

  const custoCompostoPreview = composicaoEdicao.reduce((s, c) => s + c.quantidade * c.custo_medio_atual, 0);
  const rendimentoNum = parseFloat(formEdicao.rendimento) || 0;
  const custoPorUnidadePreview = rendimentoNum > 0 ? custoCompostoPreview / rendimentoNum : 0;

  const salvarEdicaoInsumo = async () => {
    setErro("");
    const patch = {
      nome: formEdicao.nome,
      unidade: formEdicao.unidade,
      composto: formEdicao.composto,
      rendimento: formEdicao.composto ? (parseFloat(formEdicao.rendimento) || null) : null,
      atualizado_em: new Date().toISOString(),
    };
    if (!formEdicao.composto) {
      patch.custo_medio_atual = parseFloat(formEdicao.custo) || 0;
    }
    const { error: errUpd } = await supabase.from("insumos").update(patch).eq("id", editandoInsumoId);
    if (errUpd) { setErro(errUpd.message); return; }

    if (formEdicao.composto) {
      await supabase.from("insumo_composicao").delete().eq("insumo_pai_id", editandoInsumoId);
      if (composicaoEdicao.length > 0) {
        const { error: errComp } = await supabase.from("insumo_composicao").insert(
          composicaoEdicao.map((c) => ({ insumo_pai_id: editandoInsumoId, insumo_filho_id: c.insumo_id, quantidade: c.quantidade }))
        );
        if (errComp) { setErro(errComp.message); return; }
      }
    }

    // Recarrega o insumo pra pegar o custo_medio_atual já recalculado (se composto, quem calcula é o gatilho no banco)
    const { data: insumoAtualizado } = await supabase.from("insumos").select("*").eq("id", editandoInsumoId).single();
    const custoFinal = insumoAtualizado?.custo_medio_atual ?? (parseFloat(formEdicao.custo) || 0);

    setLinhas((prev) => prev.map((l) => l.insumo_id === editandoInsumoId
      ? { ...l, nome: formEdicao.nome, unidade: formEdicao.unidade, custo_medio_atual: custoFinal, composto: formEdicao.composto }
      : l));
    setInsumos((prev) => prev.map((i) => i.id === editandoInsumoId ? { ...i, ...insumoAtualizado } : i));
    setEditandoInsumoId(null);
  };

  const criarInsumo = async () => {
    if (!novoInsumoForm.nome.trim()) return;
    const { data, error } = await supabase.from("insumos").insert({
      nome: novoInsumoForm.nome.trim(),
      unidade: novoInsumoForm.unidade,
      custo_medio_atual: parseFloat(novoInsumoForm.custo) || 0,
    }).select().single();
    if (error) { setErro(error.message); return; }
    setInsumos((prev) => [...prev, data].sort((a, b) => a.nome.localeCompare(b.nome)));
    setLinhas((prev) => [...prev, { insumo_id: data.id, nome: data.nome, unidade: data.unidade, custo_medio_atual: data.custo_medio_atual, composto: false, quantidade: 1 }]);
    setNovoInsumoForm({ nome: "", unidade: "un", custo: 0 });
    setNovoInsumoAberto(false);
  };

  const custoTotal = linhas.reduce((s, l) => s + l.quantidade * l.custo_medio_atual, 0);
  const margem = prato.preco_venda - custoTotal;
  const margemPct = prato.preco_venda > 0 ? (margem / prato.preco_venda) * 100 : 0;

  const salvarFicha = async () => {
    setSalvando(true);
    setErro("");
    setMensagem("");
    await supabase.from("prato_insumos").delete().eq("prato_id", prato.id);
    if (linhas.length > 0) {
      const { error } = await supabase.from("prato_insumos").insert(
        linhas.map((l) => ({ prato_id: prato.id, insumo_id: l.insumo_id, quantidade: l.quantidade }))
      );
      if (error) { setErro(error.message); setSalvando(false); return; }
    }
    setSalvando(false);
    setMensagem("Ficha técnica salva.");
  };

  return (
    <div>
      <button onClick={onVoltar} style={{ ...linkBtn, display: "flex", alignItems: "center", gap: 4, marginBottom: 14 }}>
        <ChevronLeft size={14} /> Voltar à lista de pratos
      </button>

      <div style={{ ...cardStyle, marginBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: "#22231F" }}>{prato.nome}</div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#8A8778" }}>Preço de venda</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#22231F" }}>{brl(prato.preco_venda)}</div>
        </div>
      </div>

      <div style={sectionLabel}>Insumos</div>

      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
          {linhas.map((l, idx) => {
            const semCusto = l.custo_medio_atual === 0;
            return (
            <div key={l.insumo_id} style={{ ...cardStyle, border: semCusto ? "1px solid #E24B4A" : "1px solid #E8E2D2" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, fontSize: 13, color: "#22231F" }}>
                  {l.nome}
                  {l.composto && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#8A6A0F", background: "#FBF3D9", padding: "1px 6px", borderRadius: 999 }}>composto</span>}
                  {semCusto && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#791F1F", background: "#FCEBEB", padding: "1px 6px", borderRadius: 999 }}>sem custo</span>}
                </div>
                <input type="number" value={l.quantidade} onChange={(e) => alterarQuantidade(idx, e.target.value)}
                  style={{ width: 60, padding: "4px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13 }} />
                <span style={{ fontSize: 12, color: "#8A8778", width: 20 }}>{l.unidade}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: semCusto ? "#C4432B" : "#22231F", width: 74, textAlign: "right" }}>
                  {brl(l.quantidade * l.custo_medio_atual)}
                </span>
                <button onClick={() => abrirEdicaoInsumo(l)} style={ghostIconBtn} aria-label="Editar insumo"><Pencil size={15} /></button>
                <button onClick={() => removerLinha(idx)} style={{ ...ghostIconBtn, color: "#C4432B" }} aria-label="Remover insumo"><Trash2 size={15} /></button>
              </div>
              {editandoInsumoId === l.insumo_id && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #E8E2D2" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                    <input value={formEdicao.nome} onChange={(e) => setFormEdicao((f) => ({ ...f, nome: e.target.value }))}
                      placeholder="Nome do insumo" style={{ flex: 1, minWidth: 120, padding: "4px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13 }} />
                    <select value={formEdicao.unidade} onChange={(e) => setFormEdicao((f) => ({ ...f, unidade: e.target.value }))}
                      style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13 }}>
                      {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </div>

                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8A8778", marginBottom: 10 }}>
                    <input type="checkbox" checked={formEdicao.composto} onChange={(e) => setFormEdicao((f) => ({ ...f, composto: e.target.checked }))} />
                    Insumo composto (custo calculado a partir de outros insumos)
                  </label>

                  {!formEdicao.composto ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 12, color: "#8A8778" }}>Custo unitário</span>
                      <input type="number" step="0.01" value={formEdicao.custo} onChange={(e) => setFormEdicao((f) => ({ ...f, custo: e.target.value }))}
                        style={{ width: 80, padding: "4px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13 }} />
                      <button onClick={salvarEdicaoInsumo} style={{ ...ghostIconBtn, color: "#2F8F5B" }} aria-label="Confirmar edição"><Check size={16} /></button>
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                        <span style={{ fontSize: 12, color: "#8A8778" }}>Rendimento (em {formEdicao.unidade}) — quanto essa receita produz</span>
                        <input type="number" step="0.01" value={formEdicao.rendimento} onChange={(e) => setFormEdicao((f) => ({ ...f, rendimento: e.target.value }))}
                          style={{ width: 80, padding: "4px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13 }} />
                      </div>

                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: "#8A8778", marginBottom: 6 }}>Composição</div>
                      <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
                        {composicaoEdicao.map((c, cidx) => (
                          <div key={c.insumo_id} style={{ display: "flex", alignItems: "center", gap: 8, background: "#F6F1E7", borderRadius: 6, padding: "6px 8px" }}>
                            <span style={{ flex: 1, fontSize: 12, color: "#22231F" }}>{c.nome}</span>
                            <input type="number" value={c.quantidade} onChange={(e) => alterarQtdSubInsumo(cidx, e.target.value)}
                              style={{ width: 56, padding: "3px 5px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                            <span style={{ fontSize: 11, color: "#8A8778", width: 18 }}>{c.unidade}</span>
                            <button onClick={() => removerSubInsumo(cidx)} style={{ ...ghostIconBtn, color: "#C4432B" }} aria-label="Remover sub-insumo"><Trash2 size={13} /></button>
                          </div>
                        ))}
                        {composicaoEdicao.length === 0 && <div style={{ fontSize: 12, color: "#8A8778" }}>Nenhum insumo na composição ainda.</div>}
                      </div>

                      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
                        <select value={subInsumoSel} onChange={(e) => setSubInsumoSel(e.target.value)}
                          style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, background: "#FFFFFF" }}>
                          <option value="">Adicionar insumo simples…</option>
                          {insumosSimples.filter((i) => !composicaoEdicao.some((c) => c.insumo_id === i.id)).map((i) => (
                            <option key={i.id} value={i.id}>{i.nome}</option>
                          ))}
                        </select>
                        <button onClick={adicionarSubInsumo} style={{ ...btnSecondary, padding: "5px 10px", fontSize: 12 }}>+</button>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#FBF3D9", border: "1px solid #E8D48A", borderRadius: 8, padding: "8px 10px" }}>
                        <span style={{ fontSize: 12, color: "#7A6A1E" }}>Custo calculado por {formEdicao.unidade}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: "#7A6A1E" }}>{brl(custoPorUnidadePreview)}</span>
                      </div>
                      <button onClick={salvarEdicaoInsumo} style={{ ...btnSecondary, width: "100%", marginTop: 10, display: "flex", justifyContent: "center", gap: 6 }}>
                        <Check size={14} /> Confirmar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );})}
          {linhas.length === 0 && (
            <div style={{ fontSize: 13, color: "#8A8778" }}>Nenhum insumo adicionado ainda.</div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <select value={selecaoNova} onChange={(e) => setSelecaoNova(e.target.value)}
          style={{ flex: 1, padding: "9px 10px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF" }}>
          <option value="">Escolher insumo cadastrado…</option>
          {insumosDisponiveis.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
        </select>
        <button onClick={adicionarInsumo} disabled={!selecaoNova} style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 4 }}>
          <Plus size={14} /> Adicionar
        </button>
      </div>

      {!novoInsumoAberto ? (
        <button onClick={() => setNovoInsumoAberto(true)} style={{ ...linkBtn, marginBottom: 18 }}>+ Criar novo insumo</button>
      ) : (
        <div style={{ ...cardStyle, marginBottom: 18, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input value={novoInsumoForm.nome} onChange={(e) => setNovoInsumoForm((f) => ({ ...f, nome: e.target.value }))}
            placeholder="Nome (ex.: Mozzarela)" style={{ flex: 1, minWidth: 140, padding: "8px 10px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13 }} />
          <select value={novoInsumoForm.unidade} onChange={(e) => setNovoInsumoForm((f) => ({ ...f, unidade: e.target.value }))}
            style={{ padding: "8px 6px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13 }}>
            {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <input type="number" step="0.01" value={novoInsumoForm.custo} onChange={(e) => setNovoInsumoForm((f) => ({ ...f, custo: e.target.value }))}
            placeholder="Custo unit." style={{ width: 90, padding: "8px 10px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13 }} />
          <button onClick={criarInsumo} style={btnSecondary}>Criar</button>
          <button onClick={() => setNovoInsumoAberto(false)} style={linkBtn}>Cancelar</button>
        </div>
      )}

      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#8A8778", marginBottom: 6 }}>
          <span>Custo total</span><span style={{ color: "#22231F", fontWeight: 700 }}>{brl(custoTotal)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#8A8778" }}>
          <span>Margem de contribuição</span>
          <span>
            <span style={{ color: "#22231F", fontWeight: 700 }}>{brl(margem)}</span>
            <span style={{ ...pill, marginLeft: 6, background: margemPct >= 50 ? "#2F8F5B22" : margemPct >= 30 ? "#FAC77555" : "#F0999522", color: margemPct >= 50 ? "#0F6E56" : margemPct >= 30 ? "#854F0B" : "#A32D2D" }}>
              {margemPct.toFixed(1)}%
            </span>
          </span>
        </div>
      </div>

      {erro && <div style={{ color: "#C4432B", fontSize: 13, marginTop: 12 }}>{erro}</div>}
      {mensagem && <div style={{ color: "#2F8F5B", fontSize: 13, marginTop: 12 }}>{mensagem}</div>}

      <button onClick={salvarFicha} disabled={salvando} style={{ ...btnPrimary, width: "100%", marginTop: 16 }}>
        {salvando ? <Loader2 size={16} /> : <Check size={16} />}
        Salvar ficha técnica
      </button>
    </div>
  );
}

const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const itemRow = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "#FFFFFF", borderRadius: 10, padding: "12px 14px" };
const ghostIconBtn = { border: "none", background: "none", color: "#8A8778", cursor: "pointer", padding: 2, display: "flex" };
const btnPrimary = { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#22231F", color: "#F3EFE3", border: "none", borderRadius: 10, padding: "12px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer" };
const btnSecondary = { background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const linkBtn = { background: "none", border: "none", color: "#8A6A0F", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, textAlign: "left" };
const sectionLabel = { fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778", marginBottom: 8 };
const pill = { fontSize: 12, fontWeight: 700, padding: "3px 9px", borderRadius: 999 };
const avisoStyle = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 14 };
