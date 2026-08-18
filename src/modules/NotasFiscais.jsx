import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  ChevronLeft, Camera, Loader2, AlertTriangle, Pencil, Trash2, Check, FileText, Eye,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";

const UNIDADES = ["un", "g", "kg", "ml", "l"];

function brl(v) { return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function fmtData(d) { if (!d) return ""; return new Date(d).toLocaleDateString("pt-BR"); }

async function abrirPreview(caminho) {
  const { data, error } = await supabase.storage.from("notas-fiscais").createSignedUrl(caminho, 300);
  if (error || !data?.signedUrl) { alert("Não consegui abrir o arquivo: " + (error?.message || "")); return; }
  window.open(data.signedUrl, "_blank");
}

const STATUS_LABEL = {
  processando: "Lendo com IA",
  aguardando_confirmacao: "Aguardando conferência",
  confirmado: "Confirmada",
  erro: "Erro na leitura",
};
const STATUS_ESTILO = {
  processando: { background: "#FAC77555", color: "#854F0B" },
  aguardando_confirmacao: { background: "#F0999522", color: "#A32D2D" },
  confirmado: { background: "#2F8F5B22", color: "#0F6E56" },
  erro: { background: "#F0999522", color: "#A32D2D" },
};

export default function NotasFiscais() {
  const [tela, setTela] = useState("lista"); // lista | conferencia
  const [documentos, setDocumentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [documentoAtual, setDocumentoAtual] = useState(null);
  const inputRef = useRef(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.from("documentos_compra").select("*").order("criado_em", { ascending: false }).limit(30);
    if (error) setErro(error.message);
    setDocumentos(data || []);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const enviarArquivo = async (file) => {
    if (!file) return;
    setEnviando(true);
    setErro("");
    try {
      const { data: userData } = await supabase.auth.getUser();
      const caminho = `${userData?.user?.id || "anon"}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
      const { error: erroUpload } = await supabase.storage.from("notas-fiscais").upload(caminho, file);
      if (erroUpload) throw erroUpload;

      const { data: doc, error: erroInsert } = await supabase.from("documentos_compra")
        .insert({ arquivo_path: caminho, status: "processando", criado_por: userData?.user?.id })
        .select().single();
      if (erroInsert) throw erroInsert;

      carregar(); // já mostra "Lendo com IA" na lista

      const { data: resultado, error: erroFuncao } = await supabase.functions.invoke("processar-documento-compra", {
        body: { documento_id: doc.id },
      });
      if (erroFuncao) throw erroFuncao;
      if (resultado?.error) throw new Error(resultado.error);

      carregar();
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  if (tela === "conferencia" && documentoAtual) {
    return (
      <Conferencia
        documento={documentoAtual}
        onVoltar={() => { setTela("lista"); setDocumentoAtual(null); carregar(); }}
      />
    );
  }

  return (
    <div>
      <input ref={inputRef} type="file" accept="image/*,application/pdf" capture="environment" style={{ display: "none" }}
        onChange={(e) => enviarArquivo(e.target.files?.[0])} />
      <button onClick={() => inputRef.current?.click()} disabled={enviando}
        style={{ ...btnPrimary, width: "100%", marginBottom: 16 }}>
        {enviando ? <Loader2 size={16} /> : <Camera size={17} />}
        {enviando ? "Enviando…" : "Enviar nota fiscal ou recibo"}
      </button>

      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}

      <div style={sectionLabel}>Documentos recebidos</div>
      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <div className="list-grid">
          {documentos.map((d) => (
            <div key={d.id} style={itemRow}>
              <button
                onClick={() => { if (d.status === "aguardando_confirmacao") { setDocumentoAtual(d); setTela("conferencia"); } }}
                style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1, background: "none", border: "none", padding: 0, cursor: d.status === "aguardando_confirmacao" ? "pointer" : "default", textAlign: "left" }}>
                <div style={iconBox}><FileText size={16} color="#8A8778" /></div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#22231F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.fornecedor || "Fornecedor não identificado"}
                  </div>
                  <div style={{ fontSize: 11, color: "#8A8778" }}>
                    {fmtData(d.data_documento || d.criado_em)}{d.valor_total ? ` · ${brl(d.valor_total)}` : ""}
                  </div>
                </div>
              </button>
              <button onClick={() => abrirPreview(d.arquivo_path)} style={ghostIconBtn} aria-label="Ver documento original">
                <Eye size={16} />
              </button>
              <span style={{ ...pill, ...STATUS_ESTILO[d.status], whiteSpace: "nowrap", flexShrink: 0 }}>{STATUS_LABEL[d.status]}</span>
            </div>
          ))}
          {documentos.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Nenhum documento enviado ainda.</div>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tela de conferência: revisar/editar os itens lidos antes de confirmar
// ---------------------------------------------------------------------------
function Conferencia({ documento, onVoltar }) {
  const [itens, setItens] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [editandoId, setEditandoId] = useState(null);
  const [formEdicao, setFormEdicao] = useState({ nome_lido: "", quantidade: 0, unidade: "un", preco_unitario: 0, insumo_id: "" });
  const [criarInsumoAberto, setCriarInsumoAberto] = useState(null); // id do item pedindo criação de insumo
  const [novoInsumoNome, setNovoInsumoNome] = useState("");
  const [novoInsumoUnidade, setNovoInsumoUnidade] = useState("un");

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [{ data: itensData }, { data: insumosData }] = await Promise.all([
      supabase.from("itens_documento_compra").select("*").eq("documento_id", documento.id).order("criado_em"),
      supabase.from("insumos").select("id, nome, unidade").order("nome"),
    ]);
    setItens(itensData || []);
    setInsumos(insumosData || []);
    setCarregando(false);
  }, [documento.id]);

  useEffect(() => { carregar(); }, [carregar]);

  const removerItem = async (id) => {
    await supabase.from("itens_documento_compra").delete().eq("id", id);
    setItens((prev) => prev.filter((it) => it.id !== id));
  };

  const abrirEdicao = (item) => {
    setEditandoId(item.id);
    setFormEdicao({ nome_lido: item.nome_lido, quantidade: item.quantidade, unidade: item.unidade, preco_unitario: item.preco_unitario, insumo_id: item.insumo_id || "" });
  };

  const salvarEdicao = async () => {
    const { error } = await supabase.from("itens_documento_compra").update({
      nome_lido: formEdicao.nome_lido,
      quantidade: parseFloat(formEdicao.quantidade) || 0,
      unidade: formEdicao.unidade,
      preco_unitario: parseFloat(formEdicao.preco_unitario) || 0,
      insumo_id: formEdicao.insumo_id || null,
    }).eq("id", editandoId).select().single();
    if (error) { setErro(error.message); return; }
    carregar();
    setEditandoId(null);
  };

  const vincularInsumo = async (itemId, insumoId) => {
    await supabase.from("itens_documento_compra").update({ insumo_id: insumoId }).eq("id", itemId);
    carregar();
  };

  const criarEVincularInsumo = async (item) => {
    if (!novoInsumoNome.trim()) return;
    const { data: insumo, error } = await supabase.from("insumos")
      .insert({ nome: novoInsumoNome.trim(), unidade: novoInsumoUnidade, custo_medio_atual: item.preco_unitario })
      .select().single();
    if (error) { setErro(error.message); return; }
    await supabase.from("itens_documento_compra").update({ insumo_id: insumo.id }).eq("id", item.id);
    setInsumos((prev) => [...prev, insumo]);
    setCriarInsumoAberto(null);
    setNovoInsumoNome("");
    carregar();
  };

  const todosVinculados = itens.length > 0 && itens.every((it) => it.insumo_id);

  const confirmar = async () => {
    if (!todosVinculados) { setErro("Vincule todos os itens a um insumo antes de confirmar."); return; }
    setSalvando(true);
    setErro("");
    const { data: userData } = await supabase.auth.getUser();

    for (const item of itens) {
      // grava a movimentação de entrada no estoque
      const { error: errMov } = await supabase.from("movimentacoes_estoque").insert({
        insumo_id: item.insumo_id,
        tipo: "compra",
        quantidade: item.quantidade,
        preco_unitario: item.preco_unitario,
        documento_compra_id: documento.id,
        criado_por: userData?.user?.id,
      });
      if (errMov) { setErro(errMov.message); setSalvando(false); return; }

      // atualiza o custo do insumo pro preço dessa última compra confirmada
      // (só se o insumo não for composto — o custo dele é calculado, não digitado)
      const { data: insumoAtual } = await supabase.from("insumos").select("composto").eq("id", item.insumo_id).single();
      if (!insumoAtual?.composto) {
        await supabase.from("insumos").update({ custo_medio_atual: item.preco_unitario, atualizado_em: new Date().toISOString() }).eq("id", item.insumo_id);
      }

      // aprende o sinônimo, se o nome lido for diferente do nome do insumo
      const insumoVinculado = insumos.find((i) => i.id === item.insumo_id);
      if (insumoVinculado && insumoVinculado.nome.trim().toLowerCase() !== item.nome_lido.trim().toLowerCase()) {
        await supabase.from("insumo_sinonimos").insert({ nome_variante: item.nome_lido, insumo_id: item.insumo_id }).select();
      }
    }

    await supabase.from("documentos_compra").update({ status: "confirmado", confirmado_em: new Date().toISOString() }).eq("id", documento.id);
    setSalvando(false);
    onVoltar();
  };

  return (
    <div>
      <button onClick={onVoltar} style={{ ...linkBtn, display: "flex", alignItems: "center", gap: 4, marginBottom: 14 }}>
        <ChevronLeft size={14} /> Voltar
      </button>

      <div style={{ ...cardStyle, marginBottom: 14, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={iconBox}><FileText size={18} color="#8A8778" /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#22231F" }}>{documento.fornecedor || "Fornecedor não identificado"}</div>
          <div style={{ fontSize: 12, color: "#8A8778" }}>{fmtData(documento.data_documento || documento.criado_em)} · {itens.length} itens lidos pela IA</div>
        </div>
        <button onClick={() => abrirPreview(documento.arquivo_path)} style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <Eye size={14} /> Ver original
        </button>
      </div>

      <div style={sectionLabel}>Itens encontrados</div>
      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", marginBottom: 16, background: "#FFFFFF" }}>
          <div style={{ ...linhaTabela, background: "#F6F1E7", borderBottom: "1px solid #E8E2D2", fontSize: 10, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: "#8A8778" }}>
            <span>Produto</span><span style={{ textAlign: "right" }}>Qtd.</span><span>Unid.</span><span style={{ textAlign: "right" }}>Vl. unit.</span><span style={{ textAlign: "right" }}>Vl. total</span><span></span>
          </div>
          {itens.map((item, idx) => {
            const semInsumo = !item.insumo_id;
            return (
              <div key={item.id} style={{
                background: item.alerta_preco ? "#FCEBEB" : "#FFFFFF",
                borderTop: idx > 0 ? "1px solid #F0EBDD" : "none",
              }}>
                <div style={linhaTabela}>
                  <span style={{ fontSize: 12, color: item.alerta_preco ? "#501313" : "#22231F", fontWeight: item.alerta_preco ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.nome_lido}
                  </span>
                  <span style={{ fontSize: 12, color: "#22231F", textAlign: "right" }}>{item.quantidade}</span>
                  <span style={{ fontSize: 12, color: "#8A8778" }}>{item.unidade}</span>
                  <span style={{ fontSize: 12, color: "#22231F", textAlign: "right" }}>{brl(item.preco_unitario)}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#22231F", textAlign: "right" }}>{brl(item.quantidade * item.preco_unitario)}</span>
                  <span style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                    <button onClick={() => abrirEdicao(item)} style={ghostIconBtn} aria-label="Editar item"><Pencil size={14} /></button>
                    <button onClick={() => removerItem(item.id)} style={{ ...ghostIconBtn, color: "#C4432B" }} aria-label="Remover item"><Trash2 size={14} /></button>
                  </span>
                </div>

                {semInsumo && (
                  <div style={{ fontSize: 11, color: "#8A6A0F", padding: "0 10px 8px" }}>→ insumo não reconhecido — escolher ou criar abaixo</div>
                )}
                {!semInsumo && (
                  <div style={{ fontSize: 11, color: item.alerta_preco ? "#791F1F" : "#8A8778", padding: "0 10px 8px" }}>
                    → vinculado a: {insumos.find((i) => i.id === item.insumo_id)?.nome}
                  </div>
                )}

                {item.alerta_preco && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderTop: "1px solid #F09595", fontSize: 12, color: "#791F1F" }}>
                    <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                    {(((item.preco_unitario / item.preco_anterior) - 1) * 100).toFixed(0)}% acima da última compra ({brl(item.preco_anterior)})
                  </div>
                )}

                {semInsumo && criarInsumoAberto !== item.id && (
                  <div style={{ display: "flex", gap: 6, padding: "8px 10px", borderTop: "1px dashed #E8D48A" }}>
                    <select defaultValue="" onChange={(e) => e.target.value && vincularInsumo(item.id, e.target.value)}
                      style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }}>
                      <option value="">Escolher insumo cadastrado…</option>
                      {insumos.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
                    </select>
                    <button onClick={() => { setCriarInsumoAberto(item.id); setNovoInsumoNome(item.nome_lido); setNovoInsumoUnidade(item.unidade); }}
                      style={{ ...btnSecondary, fontSize: 12, padding: "5px 10px" }}>Criar novo</button>
                  </div>
                )}
                {criarInsumoAberto === item.id && (
                  <div style={{ display: "flex", gap: 6, padding: "8px 10px", borderTop: "1px dashed #E8D48A", flexWrap: "wrap" }}>
                    <input value={novoInsumoNome} onChange={(e) => setNovoInsumoNome(e.target.value)}
                      style={{ flex: 1, minWidth: 100, padding: "5px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                    <select value={novoInsumoUnidade} onChange={(e) => setNovoInsumoUnidade(e.target.value)}
                      style={{ padding: "5px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }}>
                      {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <button onClick={() => criarEVincularInsumo(item)} style={{ ...btnSecondary, fontSize: 12, padding: "5px 10px" }}>Salvar</button>
                  </div>
                )}

                {editandoId === item.id && (
                  <div style={{ padding: "8px 10px", borderTop: "1px solid #E8E2D2" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                      <input value={formEdicao.nome_lido} onChange={(e) => setFormEdicao((f) => ({ ...f, nome_lido: e.target.value }))}
                        style={{ flex: 1, minWidth: 100, padding: "4px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                      <input type="number" value={formEdicao.quantidade} onChange={(e) => setFormEdicao((f) => ({ ...f, quantidade: e.target.value }))}
                        style={{ width: 60, padding: "4px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                      <select value={formEdicao.unidade} onChange={(e) => setFormEdicao((f) => ({ ...f, unidade: e.target.value }))}
                        style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }}>
                        {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                      <input type="number" step="0.01" value={formEdicao.preco_unitario} onChange={(e) => setFormEdicao((f) => ({ ...f, preco_unitario: e.target.value }))}
                        style={{ width: 70, padding: "4px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, color: "#8A8778" }}>Vinculado a:</span>
                      <select value={formEdicao.insumo_id} onChange={(e) => setFormEdicao((f) => ({ ...f, insumo_id: e.target.value }))}
                        style={{ flex: 1, padding: "4px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, background: "#FFFFFF" }}>
                        <option value="">— nenhum insumo —</option>
                        {insumos.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
                      </select>
                      <button onClick={salvarEdicao} style={{ ...ghostIconBtn, color: "#2F8F5B" }} aria-label="Confirmar edição"><Check size={16} /></button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {itens.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Nenhum item lido nesse documento.</div>}
        </div>
      )}

      {erro && <div style={{ color: "#C4432B", fontSize: 13, marginBottom: 12 }}>{erro}</div>}

      <button onClick={confirmar} disabled={salvando || !todosVinculados} style={{ ...btnPrimary, width: "100%" }}>
        {salvando ? <Loader2 size={16} /> : <Check size={16} />}
        Confirmar e lançar no estoque
      </button>
      {!todosVinculados && !carregando && itens.length > 0 && (
        <div style={{ fontSize: 12, color: "#8A8778", marginTop: 8, textAlign: "center" }}>Vincule todos os itens a um insumo pra poder confirmar.</div>
      )}
    </div>
  );
}

const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const linhaTabela = { display: "grid", gridTemplateColumns: "2fr 0.6fr 0.5fr 0.8fr 0.8fr 0.6fr", gap: 6, padding: "8px 10px", alignItems: "center" };
const itemRow = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10, padding: "12px 14px" };
const iconBox = { width: 36, height: 44, borderRadius: 6, background: "#F6F1E7", border: "1px solid #E8E2D2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const ghostIconBtn = { border: "none", background: "none", color: "#8A8778", cursor: "pointer", padding: 2, display: "flex" };
const btnPrimary = { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#22231F", color: "#F3EFE3", border: "none", borderRadius: 10, padding: "12px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer" };
const btnSecondary = { background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const linkBtn = { background: "none", border: "none", color: "#8A6A0F", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, textAlign: "left" };
const sectionLabel = { fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778", marginBottom: 8 };
const pill = { fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999 };
const avisoStyle = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 14 };
