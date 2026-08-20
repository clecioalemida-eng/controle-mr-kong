import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  ChevronLeft, Camera, Loader2, AlertTriangle, Pencil, Trash2, Check, FileText, Eye, Search,
} from "lucide-react";
import { supabase, extrairErroFuncao } from "../lib/supabaseClient";

const UNIDADES = ["un", "g", "kg", "ml", "l"];
const FORMAS_PAGAMENTO_COMPRA = [
  { valor: "pix", rotulo: "Pix" },
  { valor: "debito", rotulo: "Débito" },
  { valor: "credito", rotulo: "Cartão de crédito" },
  { valor: "boleto", rotulo: "Boleto" },
];

function brl(v) { return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function round2(n) { return Math.round((n || 0) * 100) / 100; }
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
  const [busca, setBusca] = useState("");
  const inputRef = useRef(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.from("documentos_compra").select("*").order("criado_em", { ascending: false }).limit(30);
    if (error) setErro(error.message);
    setDocumentos(data || []);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const excluirDocumento = async (d) => {
    if (!window.confirm(`Excluir a nota de "${d.fornecedor || "fornecedor não identificado"}"? Isso apaga o documento e os itens lidos — não dá pra desfazer.`)) return;
    const { error } = await supabase.from("documentos_compra").delete().eq("id", d.id);
    if (error) { setErro(error.message); return; }
    await supabase.storage.from("notas-fiscais").remove([d.arquivo_path]);
    carregar();
  };

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
      if (erroFuncao) throw new Error(await extrairErroFuncao(erroFuncao));
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

      {documentos.length > 0 && (
        <div style={{ position: "relative", marginBottom: 14 }}>
          <Search size={15} color="#8A8778" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por fornecedor…"
            style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px 9px 34px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF" }} />
        </div>
      )}

      <div style={sectionLabel}>Documentos recebidos</div>
      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <div className="list-grid">
          {documentos.filter((d) => (d.fornecedor || "Fornecedor não identificado").toLowerCase().includes(busca.toLowerCase())).map((d) => (
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
              {d.status !== "confirmado" && (
                <button onClick={() => excluirDocumento(d)} style={{ ...ghostIconBtn, color: "#C4432B" }} aria-label="Excluir documento">
                  <Trash2 size={16} />
                </button>
              )}
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
  const [formaPagamento, setFormaPagamento] = useState("pix");
  const [prazoBoleto, setPrazoBoleto] = useState("28");
  const [erro, setErro] = useState("");
  const [editandoId, setEditandoId] = useState(null);
  const [formEdicao, setFormEdicao] = useState({ nome_lido: "", quantidade: 0, unidade: "un", preco_unitario: 0, insumo_id: "" });
  const [calcPacotes, setCalcPacotes] = useState({ qtd: "", tamanho: "", unidade: "g" });
  const [renomeandoInsumo, setRenomeandoInsumo] = useState(false);
  const [nomeInsumoInput, setNomeInsumoInput] = useState("");
  const [criarInsumoAberto, setCriarInsumoAberto] = useState(null); // id do item pedindo criação de insumo
  const [novoInsumoNome, setNovoInsumoNome] = useState("");
  const [novoInsumoUnidade, setNovoInsumoUnidade] = useState("un");
  const [fornecedores, setFornecedores] = useState([]);
  const [fornecedorAtual, setFornecedorAtual] = useState({ nome: documento.fornecedor || "", id: documento.fornecedor_id || null });
  const [editandoFornecedor, setEditandoFornecedor] = useState(false);
  const [nomeFornecedorInput, setNomeFornecedorInput] = useState("");
  const [historicoFornecedor, setHistoricoFornecedor] = useState([]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [{ data: itensData }, { data: insumosData }, { data: fornecedoresData }] = await Promise.all([
      supabase.from("itens_documento_compra").select("*").eq("documento_id", documento.id).order("criado_em"),
      supabase.from("insumos").select("id, nome, unidade").order("nome"),
      supabase.from("fornecedores").select("*").order("nome"),
    ]);
    setItens(itensData || []);
    setInsumos(insumosData || []);
    setFornecedores(fornecedoresData || []);
    setCarregando(false);
    if (documento.fornecedor_id) carregarHistoricoFornecedor(documento.fornecedor_id);
  }, [documento.id]);

  useEffect(() => { carregar(); }, [carregar]);

  const carregarHistoricoFornecedor = async (fornecedorId) => {
    const { data } = await supabase
      .from("documentos_compra")
      .select("id, data_documento, criado_em, valor_total")
      .eq("fornecedor_id", fornecedorId)
      .neq("id", documento.id)
      .order("criado_em", { ascending: false })
      .limit(10);
    setHistoricoFornecedor(data || []);
  };

  const salvarFornecedor = async () => {
    const nome = nomeFornecedorInput.trim();
    if (!nome) { setEditandoFornecedor(false); return; }
    let fornecedor = fornecedores.find((f) => f.nome.toLowerCase() === nome.toLowerCase());
    if (!fornecedor) {
      const { data, error } = await supabase.from("fornecedores").insert({ nome }).select().single();
      if (error) { setErro(error.message); return; }
      fornecedor = data;
      setFornecedores((prev) => [...prev, fornecedor].sort((a, b) => a.nome.localeCompare(b.nome)));
    }
    const { error: errDoc } = await supabase.from("documentos_compra").update({ fornecedor: nome, fornecedor_id: fornecedor.id }).eq("id", documento.id);
    if (errDoc) { setErro(errDoc.message); return; }
    setFornecedorAtual({ nome, id: fornecedor.id });
    setEditandoFornecedor(false);
    carregarHistoricoFornecedor(fornecedor.id);
  };

  const removerItem = async (id) => {
    await supabase.from("itens_documento_compra").delete().eq("id", id);
    setItens((prev) => prev.filter((it) => it.id !== id));
  };

  const adicionarItemManual = async () => {
    const { data, error } = await supabase.from("itens_documento_compra")
      .insert({ documento_id: documento.id, nome_lido: "Novo item", quantidade: 1, unidade: "un", preco_unitario: 0 })
      .select().single();
    if (error) { setErro(error.message); return; }
    setItens((prev) => [...prev, data]);
    abrirEdicao(data);
  };

  const abrirEdicao = (item) => {
    setEditandoId(item.id);
    setFormEdicao({ nome_lido: item.nome_lido, quantidade: item.quantidade, unidade: item.unidade, preco_unitario: item.preco_unitario, insumo_id: item.insumo_id || "" });
    setCalcPacotes({ qtd: "", tamanho: "", unidade: item.unidade || "g" });
  };

  const aplicarCalculadoraPacotes = () => {
    const qtd = parseFloat(calcPacotes.qtd) || 0;
    const tamanho = parseFloat(calcPacotes.tamanho) || 0;
    setFormEdicao((f) => ({ ...f, quantidade: round2(qtd * tamanho), unidade: calcPacotes.unidade }));
  };

  const renomearInsumoVinculado = async () => {
    const nome = nomeInsumoInput.trim();
    if (!nome || !formEdicao.insumo_id) { setRenomeandoInsumo(false); return; }
    const { error } = await supabase.from("insumos").update({ nome }).eq("id", formEdicao.insumo_id);
    if (error) { setErro(error.message); return; }
    setInsumos((prev) => prev.map((i) => i.id === formEdicao.insumo_id ? { ...i, nome } : i).sort((a, b) => a.nome.localeCompare(b.nome)));
    setRenomeandoInsumo(false);
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
    setInsumos((prev) => [...prev, insumo].sort((a, b) => a.nome.localeCompare(b.nome)));
    // Se esse item estava com o formulário de edição aberto, sincroniza o
    // vínculo ali também — senão, clicar em "Confirmar edição" logo
    // depois desfaria a criação que acabou de acontecer.
    if (editandoId === item.id) setFormEdicao((f) => ({ ...f, insumo_id: insumo.id }));
    setCriarInsumoAberto(null);
    setNovoInsumoNome("");
    carregar();
  };

  const todosVinculados = itens.length > 0 && itens.every((it) => it.insumo_id);
  const algumaUnidadeDivergente = itens.some((it) => {
    const ins = insumos.find((i) => i.id === it.insumo_id);
    return ins && ins.unidade !== it.unidade;
  });
  const podeConfirmar = todosVinculados && !algumaUnidadeDivergente;

  const confirmar = async () => {
    if (!todosVinculados) { setErro("Vincule todos os itens a um insumo antes de confirmar."); return; }
    if (algumaUnidadeDivergente) { setErro("Tem item com unidade diferente da do insumo — corrija pelo lápis antes de confirmar."); return; }
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
        fornecedor: documento.fornecedor || null,
        forma_pagamento: formaPagamento,
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

    // Toda nota confirmada vira um registro em Contas a Pagar — pago ou a
    // pagar, mas sempre lá, pra ter o valor de toda compra num lugar só.
    // Boleto entra como pendente (com vencimento); pix/débito/crédito
    // entra já como pago (foi pago na hora da compra).
    {
      const ehBoleto = formaPagamento === "boleto";
      const dias = ehBoleto ? (parseInt(prazoBoleto) || 0) : 0;
      const vencimento = new Date();
      vencimento.setDate(vencimento.getDate() + dias);
      const valorTotal = round2(itens.reduce((s, it) => s + it.quantidade * it.preco_unitario, 0));
      await supabase.from("contas_pagar").insert({
        documento_compra_id: documento.id,
        fornecedor_id: fornecedorAtual.id,
        fornecedor_nome: fornecedorAtual.nome,
        descricao: `Nota fiscal — ${fornecedorAtual.nome || "fornecedor não identificado"}`,
        valor_total: valorTotal,
        valor_pago: ehBoleto ? 0 : valorTotal,
        status: ehBoleto ? "pendente" : "pago",
        forma_pagamento: formaPagamento,
        categoria: "compra",
        centro_custo: "insumos",
        data_vencimento: vencimento.toISOString().slice(0, 10),
        criado_por: userData?.user?.id,
      });
    }

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
          {editandoFornecedor ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
              <input list="lista-fornecedores" value={nomeFornecedorInput} onChange={(e) => setNomeFornecedorInput(e.target.value)}
                placeholder="Nome do fornecedor" autoFocus
                style={{ flex: 1, minWidth: 0, padding: "5px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13 }} />
              <datalist id="lista-fornecedores">
                {fornecedores.map((f) => <option key={f.id} value={f.nome} />)}
              </datalist>
              <button onClick={salvarFornecedor} style={{ ...ghostIconBtn, color: "#2F8F5B", flexShrink: 0 }} aria-label="Salvar fornecedor"><Check size={16} /></button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#22231F" }}>{fornecedorAtual.nome || "Fornecedor não identificado"}</div>
              <button onClick={() => { setNomeFornecedorInput(fornecedorAtual.nome); setEditandoFornecedor(true); }} style={ghostIconBtn} aria-label="Editar fornecedor"><Pencil size={13} /></button>
            </div>
          )}
          <div style={{ fontSize: 12, color: "#8A8778" }}>{fmtData(documento.data_documento || documento.criado_em)} · {itens.length} itens lidos pela IA</div>
        </div>
        <button onClick={() => abrirPreview(documento.arquivo_path)} style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <Eye size={14} /> Ver original
        </button>
      </div>

      {fornecedorAtual.id && historicoFornecedor.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 8 }}>Histórico com {fornecedorAtual.nome}</div>
          {historicoFornecedor.map((h) => (
            <div key={h.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderTop: "1px solid #F0EBDD" }}>
              <span style={{ color: "#8A8778" }}>{fmtData(h.data_documento || h.criado_em)}</span>
              <span style={{ color: "#22231F" }}>{brl(h.valor_total)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, paddingTop: 6, marginTop: 4, borderTop: "1px solid #E8E2D2" }}>
            <span>Total no período</span>
            <span>{brl(historicoFornecedor.reduce((s, h) => s + (h.valor_total || 0), 0))}</span>
          </div>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={sectionLabel}>Itens encontrados</div>
        <button onClick={adicionarItemManual} style={{ ...linkBtn, fontSize: 12 }}>+ Adicionar item manualmente</button>
      </div>
      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", marginBottom: 16, background: "#FFFFFF" }}>
          <div style={{ ...linhaTabela, background: "#F6F1E7", borderBottom: "1px solid #E8E2D2", fontSize: 10, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: "#8A8778" }}>
            <span>Produto</span><span style={{ textAlign: "right" }}>Qtd.</span><span>Unid.</span><span style={{ textAlign: "right" }}>Vl. unit.</span><span style={{ textAlign: "right" }}>Vl. total</span><span></span>
          </div>
          {itens.map((item, idx) => {
            const semInsumo = !item.insumo_id;
            const insumoVinculadoRow = insumos.find((i) => i.id === item.insumo_id);
            const unidadeDivergente = !semInsumo && insumoVinculadoRow && insumoVinculadoRow.unidade !== item.unidade;
            return (
              <div key={item.id} style={{
                background: item.alerta_preco ? "#FCEBEB" : unidadeDivergente ? "#FBF3D9" : "#FFFFFF",
                borderTop: idx > 0 ? "1px solid #F0EBDD" : "none",
              }}>
                <div style={linhaTabela}>
                  <span style={{ fontSize: 12, color: item.alerta_preco ? "#501313" : "#22231F", fontWeight: item.alerta_preco ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.nome_lido}
                  </span>
                  <span style={{ fontSize: 12, color: "#22231F", textAlign: "right" }}>{item.quantidade}</span>
                  <span style={{ fontSize: 12, color: unidadeDivergente ? "#854F0B" : "#8A8778", fontWeight: unidadeDivergente ? 700 : 400 }}>{item.unidade}</span>
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
                    → vinculado a: {insumoVinculadoRow?.nome}
                  </div>
                )}

                {unidadeDivergente && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderTop: "1px solid #E8D48A", fontSize: 12, color: "#7A6A1E" }}>
                    <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                    Essa nota veio em <strong>{item.unidade}</strong>, mas o insumo "{insumoVinculadoRow?.nome}" é controlado em <strong>{insumoVinculadoRow?.unidade}</strong> — ajuste a quantidade e a unidade pelo lápis antes de confirmar, ou o estoque fica errado.
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
                  <div style={{ padding: "10px", borderTop: "1px solid #E8E2D2", display: "grid", gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 3 }}>Descrição</label>
                      <input value={formEdicao.nome_lido} onChange={(e) => setFormEdicao((f) => ({ ...f, nome_lido: e.target.value }))}
                        style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                    </div>
                    <div style={{ border: "1px dashed #37A0E5", borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 11, color: "#185FA5", marginBottom: 8 }}>Veio em pacotes/potes? Calcule a quantidade total aqui</div>
                      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: 10, color: "#8A8778", display: "block", marginBottom: 2 }}>Quantos pacotes</label>
                          <input type="number" value={calcPacotes.qtd} onChange={(e) => setCalcPacotes((c) => ({ ...c, qtd: e.target.value }))}
                            style={{ width: "100%", boxSizing: "border-box", padding: "5px 7px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: 10, color: "#8A8778", display: "block", marginBottom: 2 }}>Tamanho de cada um</label>
                          <div style={{ display: "flex", gap: 4 }}>
                            <input type="number" value={calcPacotes.tamanho} onChange={(e) => setCalcPacotes((c) => ({ ...c, tamanho: e.target.value }))}
                              style={{ flex: 1, minWidth: 0, padding: "5px 7px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                            <select value={calcPacotes.unidade} onChange={(e) => setCalcPacotes((c) => ({ ...c, unidade: e.target.value }))}
                              style={{ width: 55, padding: "5px 4px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, background: "#FFFFFF" }}>
                              {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11, color: "#8A8778" }}>
                          = {round2((parseFloat(calcPacotes.qtd) || 0) * (parseFloat(calcPacotes.tamanho) || 0))} {calcPacotes.unidade}
                        </span>
                        <button onClick={aplicarCalculadoraPacotes} style={{ ...btnSecondary, fontSize: 11, padding: "4px 10px" }}>Usar esse valor</button>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 3 }}>Quantidade</label>
                        <input type="number" value={formEdicao.quantidade} onChange={(e) => setFormEdicao((f) => ({ ...f, quantidade: e.target.value }))}
                          style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 3 }}>Unidade</label>
                        <select value={formEdicao.unidade} onChange={(e) => setFormEdicao((f) => ({ ...f, unidade: e.target.value }))}
                          style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, background: "#FFFFFF" }}>
                          {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 3 }}>Valor unitário</label>
                        <input type="number" step="0.01" value={formEdicao.preco_unitario}
                          onChange={(e) => setFormEdicao((f) => ({ ...f, preco_unitario: e.target.value }))}
                          style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 3 }}>Valor total</label>
                        <input type="number" step="0.01"
                          value={round2((parseFloat(formEdicao.quantidade) || 0) * (parseFloat(formEdicao.preco_unitario) || 0))}
                          onChange={(e) => {
                            const novoTotal = parseFloat(e.target.value) || 0;
                            const qtd = parseFloat(formEdicao.quantidade) || 0;
                            setFormEdicao((f) => ({ ...f, preco_unitario: qtd > 0 ? novoTotal / qtd : 0 }));
                          }}
                          style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid #37A0E5", fontSize: 12 }} />
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: "#8A8778" }}>Preenche um dos dois — o outro calcula sozinho (baseado na quantidade).</div>
                    <div>
                      <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 3 }}>Vinculado a</label>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <select value={formEdicao.insumo_id}
                          onChange={(e) => {
                            if (e.target.value === "__criar__") {
                              setCriarInsumoAberto(item.id);
                              setNovoInsumoNome(formEdicao.nome_lido);
                              setNovoInsumoUnidade(formEdicao.unidade);
                              return;
                            }
                            setFormEdicao((f) => ({ ...f, insumo_id: e.target.value }));
                          }}
                          style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, background: "#FFFFFF" }}>
                          <option value="">— nenhum insumo —</option>
                          {insumos.map((i) => <option key={i.id} value={i.id}>{i.nome}</option>)}
                          <option value="__criar__">+ Criar novo insumo…</option>
                        </select>
                        {formEdicao.insumo_id && !renomeandoInsumo && (
                          <button onClick={() => { setNomeInsumoInput(insumos.find((i) => i.id === formEdicao.insumo_id)?.nome || ""); setRenomeandoInsumo(true); }}
                            style={ghostIconBtn} aria-label="Renomear insumo vinculado" title="Renomear esse insumo (corrige em todo lugar que usa ele)">
                            <Pencil size={14} />
                          </button>
                        )}
                        <button onClick={salvarEdicao} style={{ ...ghostIconBtn, color: "#2F8F5B" }} aria-label="Confirmar edição"><Check size={16} /></button>
                      </div>
                      {renomeandoInsumo && (
                        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                          <input value={nomeInsumoInput} onChange={(e) => setNomeInsumoInput(e.target.value)} autoFocus
                            onKeyDown={(e) => e.key === "Enter" && renomearInsumoVinculado()}
                            placeholder="Novo nome do insumo" style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1px solid #37A0E5", fontSize: 12 }} />
                          <button onClick={renomearInsumoVinculado} style={{ ...btnSecondary, fontSize: 12, padding: "5px 10px" }}>Salvar nome</button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {itens.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Nenhum item lido nesse documento.</div>}
        </div>
      )}

      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 4 }}>Forma de pagamento</label>
        <select value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", padding: "7px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF" }}>
          {FORMAS_PAGAMENTO_COMPRA.map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
        </select>
        {formaPagamento === "boleto" && (
          <div style={{ marginTop: 6 }}>
            <label style={{ fontSize: 10, color: "#8A6A0F", display: "block", marginBottom: 3 }}>Prazo do boleto (dias)</label>
            <input type="number" value={prazoBoleto} onChange={(e) => setPrazoBoleto(e.target.value)}
              style={{ width: 80, padding: "6px 8px", borderRadius: 6, border: "1px solid #37A0E5", fontSize: 13 }} />
          </div>
        )}
        <div style={{ fontSize: 10, color: "#8A8778", marginTop: 6 }}>
          {formaPagamento === "boleto" ? "Gera uma conta a pagar com esse prazo, no valor total da nota." : "Pix/débito/crédito entra em Contas a Pagar já marcado como pago."}
        </div>
      </div>

      {erro && <div style={{ color: "#C4432B", fontSize: 13, marginBottom: 12 }}>{erro}</div>}

      <button onClick={confirmar} disabled={salvando || !podeConfirmar} style={{ ...btnPrimary, width: "100%" }}>
        {salvando ? <Loader2 size={16} /> : <Check size={16} />}
        Confirmar e lançar no estoque
      </button>
      {!todosVinculados && !carregando && itens.length > 0 && (
        <div style={{ fontSize: 12, color: "#8A8778", marginTop: 8, textAlign: "center" }}>Vincule todos os itens a um insumo pra poder confirmar.</div>
      )}
      {todosVinculados && algumaUnidadeDivergente && !carregando && (
        <div style={{ fontSize: 12, color: "#854F0B", marginTop: 8, textAlign: "center" }}>Corrija a unidade divergente (destacada em amarelo) pra poder confirmar.</div>
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
