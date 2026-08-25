// ===== FichasTecnicas.jsx =====
import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Loader2, Plus, Trash2, Check, RefreshCw, AlertTriangle, ChevronLeft, Search,
  Package, List as ListIcon,
} from "lucide-react";
import { supabase, extrairErroFuncao } from "../lib/supabaseClient";

const UNIDADES = ["un", "g", "kg", "ml", "l"];
const LINHAS_PRODUTO = [
  "Hambúrguer Gourmet", "Hambúrguer Tradicional", "Bebidas", "Bombons e Balas",
  "Milkshake e Sorvetes", "Cremes", "Petiscos", "Chapa", "Combos", "Batatas Fritas", "Açaí",
];

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
// Ordem alfabética de verdade. O `order("nome")` do Postgres depende da
// collation do banco e às vezes joga nome acentuado ou em maiúscula pro
// fim da lista. localeCompare com "pt-BR" e sensitivity "base" trata
// "Água" junto de "Agua" e "ALFACE" junto de "Alface".
function porNome(a, b) {
  return String(a?.nome || "").localeCompare(String(b?.nome || ""), "pt-BR", { sensitivity: "base" });
}

// Grama e quilo medem a mesma coisa, mas NÃO são a mesma unidade — 1 kg
// são 1000 g. Por isso cada insumo tem UMA unidade de controle (como se
// compra e como o estoque conta) e a receita é digitada na subunidade,
// que é como se cozinha. Sem essa separação o estoque somaria 600 com
// 0,6 e daria 600,6 de alguma coisa.
const SUB_UNIDADE = { kg: "g", l: "ml" };
const BASES = [
  { valor: "kg", label: "Por peso", dica: "kg" },
  { valor: "l",  label: "Por volume", dica: "l" },
  { valor: "un", label: "Por unidade", dica: "" },
];

function limpo(n) { return Math.round((Number(n) || 0) * 1e6) / 1e6; }
function paraNumero(v) { return parseFloat(String(v ?? "").replace(",", ".")) || 0; }
function daDigitada(valor, unidadeDigitada, unidadeInsumo) {
  const v = paraNumero(valor);
  return unidadeDigitada === SUB_UNIDADE[unidadeInsumo] ? limpo(v / 1000) : limpo(v);
}
function paraDigitada(quantidade, unidadeInsumo) {
  const sub = SUB_UNIDADE[unidadeInsumo];
  if (!sub) return { valor: limpo(quantidade), unidade: unidadeInsumo };
  return { valor: limpo(quantidade * 1000), unidade: sub };
}
function semAcento(t) {
  return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}
function iguais(a, b) { return semAcento(a).trim() === semAcento(b).trim(); }

// ---------------------------------------------------------------------------
// Busca de insumo — o mesmo campo das notas fiscais. Substitui a lista
// rolante com centenas de nomes, que fazia parecer mais fácil criar um
// insumo novo do que achar o que já existe.
// ---------------------------------------------------------------------------
function BuscaInsumo({ insumos, onEscolher, onCriar, placeholder = "Digite o ingrediente…", valorInicial = "" }) {
  const [busca, setBusca] = useState(valorInicial);
  const [aberto, setAberto] = useState(false);
  const [sel, setSel] = useState(-1);
  const [caixa, setCaixa] = useState(null);
  const fecharRef = React.useRef(null);
  const campoRef = React.useRef(null);

  // A lista é desenhada por portal, em position:fixed. O quadro dos
  // ingredientes tem overflow:hidden pros cantos arredondados, e um
  // dropdown absoluto ali dentro sai cortado na borda de baixo — foi o
  // que aconteceu na primeira versão.
  const posicionar = useCallback(() => {
    const el = campoRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const folgaAbaixo = window.innerHeight - r.bottom;
    const paraCima = folgaAbaixo < 200 && r.top > folgaAbaixo;
    setCaixa({
      left: r.left,
      width: r.width,
      top: paraCima ? null : r.bottom + 4,
      bottom: paraCima ? window.innerHeight - r.top + 4 : null,
      maxAltura: Math.max(140, (paraCima ? r.top : folgaAbaixo) - 14),
    });
  }, []);

  useEffect(() => {
    if (!aberto) return undefined;
    posicionar();
    const refazer = () => posicionar();
    window.addEventListener("scroll", refazer, true);
    window.addEventListener("resize", refazer);
    return () => {
      window.removeEventListener("scroll", refazer, true);
      window.removeEventListener("resize", refazer);
    };
  }, [aberto, posicionar, busca]);

  const achados = React.useMemo(() => {
    const termos = semAcento(busca).split(/\s+/).filter(Boolean);
    if (termos.length === 0) return insumos.slice(0, 50);
    const casam = insumos.filter((i) => {
      const plano = semAcento(i.nome);
      return termos.every((t) => plano.includes(t));
    });
    const primeiro = termos[0];
    const peso = (nome) => {
      const p = semAcento(nome);
      if (p.startsWith(primeiro)) return 0;
      if (p.split(/[^a-z0-9]+/).some((w) => w.startsWith(primeiro))) return 1;
      return 2;
    };
    return [...casam].sort((a, b) => peso(a.nome) - peso(b.nome)).slice(0, 50);
  }, [insumos, busca]);

  useEffect(() => () => clearTimeout(fecharRef.current), []);

  const escolher = (i) => { setBusca(""); setAberto(false); setSel(-1); onEscolher(i); };
  const podeCriar = busca.trim().length > 0 && achados.length === 0;

  return (
    <div style={{ position: "relative", flex: 1, minWidth: 170 }}>
      <input
        ref={campoRef}
        value={busca}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => { setBusca(e.target.value); setSel(-1); setAberto(true); }}
        onFocus={() => setAberto(true)}
        onBlur={() => { fecharRef.current = setTimeout(() => setAberto(false), 130); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setAberto(true); setSel((v) => Math.min(v + 1, achados.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setSel((v) => Math.max(v - 1, 0)); }
          else if (e.key === "Enter") {
            e.preventDefault();
            if (podeCriar) { onCriar(busca.trim()); setBusca(""); setAberto(false); return; }
            const alvo = achados[sel >= 0 ? sel : 0];
            if (alvo) escolher(alvo);
          } else if (e.key === "Escape") { setAberto(false); }
        }}
        style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 7, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF", color: "#22231F", fontFamily: "inherit" }}
      />
      {aberto && caixa && createPortal(
        <div onMouseDown={(e) => e.preventDefault()}
          style={{
            position: "fixed", left: caixa.left, width: caixa.width,
            ...(caixa.top != null ? { top: caixa.top } : { bottom: caixa.bottom }),
            maxHeight: caixa.maxAltura, overflowY: "auto", zIndex: 60,
            background: "#FFFFFF", border: "1px solid #DDD5BF", borderRadius: 8,
            boxShadow: "0 8px 24px rgba(34,35,31,.16)",
          }}>
          {achados.map((i, idx) => (
            <div key={i.id} onClick={() => escolher(i)} onMouseEnter={() => setSel(idx)}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 10px", fontSize: 12.5, cursor: "pointer", background: idx === sel ? "#F6F1E7" : "#FFFFFF" }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.nome}</span>
              <span style={{ fontSize: 10.5, flexShrink: 0, color: i.custo_medio_atual > 0 ? "#8A8778" : "#A32D2D", fontWeight: i.custo_medio_atual > 0 ? 400 : 700 }}>
                {i.custo_medio_atual > 0 ? `${brl(i.custo_medio_atual)} /${i.unidade}` : "sem preço"}
              </span>
            </div>
          ))}
          {achados.length === 0 && <div style={{ padding: "8px 10px", fontSize: 12.5, color: "#8A8778" }}>Nenhum insumo com esse nome.</div>}
          {podeCriar && (
            <div onClick={() => { onCriar(busca.trim()); setBusca(""); setAberto(false); }}
              style={{ padding: "8px 10px", fontSize: 12.5, cursor: "pointer", color: "#0F6E56", fontWeight: 700, borderTop: "1px solid #F0EBDD" }}>
              + Cadastrar “{busca.trim()}”
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cadastro de insumo na hora — sem sair da ficha
//
// A pessoa NÃO escolhe entre g e kg: diz se compra por peso, volume ou
// unidade, e depois informa a nota como ela veio ("paguei R$ 28,00 por
// 650 g"). A divisão pra achar o preço do quilo é onde entra número
// errado quando é feita de cabeça.
// ---------------------------------------------------------------------------
function CadastrarInsumo({ nomeInicial, onCriado, onCancelar }) {
  const [nome, setNome] = useState(nomeInicial);
  const [base, setBase] = useState("kg");
  const [pago, setPago] = useState("");
  const [quanto, setQuanto] = useState("");
  const [unidadeNota, setUnidadeNota] = useState("g");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    setUnidadeNota(base === "un" ? "un" : SUB_UNIDADE[base]);
  }, [base]);

  const emBase = daDigitada(quanto, unidadeNota, base);
  const porBase = emBase > 0 ? limpo(paraNumero(pago) / emBase) : 0;

  const salvar = async () => {
    if (!nome.trim()) { setErro("Dê um nome ao insumo."); return; }
    setSalvando(true);
    setErro("");
    const { data, error } = await supabase.from("insumos")
      .insert({ nome: nome.trim(), unidade: base, custo_medio_atual: porBase })
      .select().single();
    setSalvando(false);
    if (error) {
      setErro(/duplicate key|23505/i.test(error.message)
        ? "Já existe um insumo com esse nome — procure por ele na busca."
        : error.message);
      return;
    }
    onCriado(data);
  };

  const opcoesUnidade = base === "un" ? ["un"] : [SUB_UNIDADE[base], base];

  return (
    <div style={{ padding: 12, background: "#FCFAF3", borderTop: "1px dashed #DDD5BF" }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 9 }}>Cadastrar insumo</div>

      <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do insumo"
        style={{ width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 7, border: "1px solid #E8E2D2", fontSize: 13, marginBottom: 9, fontFamily: "inherit" }} />

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 9 }}>
        <span style={{ fontSize: 12.5, color: "#8A8778" }}>Como você compra?</span>
        {BASES.map((b) => (
          <button key={b.valor} onClick={() => setBase(b.valor)}
            style={{ border: "1px solid #E8E2D2", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              background: base === b.valor ? "#22231F" : "#FFFFFF", color: base === b.valor ? "#F3EFE3" : "#55534A", borderColor: base === b.valor ? "#22231F" : "#E8E2D2" }}>
            {b.label}{b.dica ? ` (${b.dica})` : ""}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 9, fontSize: 12.5 }}>
        <span style={{ color: "#8A8778" }}>Paguei</span>
        <span>R$</span>
        <input value={pago} onChange={(e) => setPago(e.target.value)} placeholder="28,00" style={campoNum} />
        <span style={{ color: "#8A8778" }}>por</span>
        <input value={quanto} onChange={(e) => setQuanto(e.target.value)} placeholder="650" style={campoNum} />
        <select value={unidadeNota} onChange={(e) => setUnidadeNota(e.target.value)}
          style={{ padding: "6px 7px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12.5, background: "#FFFFFF", fontFamily: "inherit" }}>
          {opcoesUnidade.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>

      <div style={{ display: "inline-block", fontSize: 12.5, fontWeight: 800, color: porBase > 0 ? "#0F6E56" : "#8A8778", background: porBase > 0 ? "#DCF0E6" : "#F0EBDD", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
        {porBase > 0 ? `fica ${brl(porBase)} /${base}` : "informe quanto pagou e quanto veio"}
      </div>

      {erro && <div style={{ fontSize: 12, color: "#A32D2D", marginBottom: 8 }}>{erro}</div>}

      <div style={{ display: "flex", gap: 7 }}>
        <button onClick={salvar} disabled={salvando} style={{ ...btnSecondary, background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" }}>
          {salvando ? "Salvando…" : "Cadastrar e adicionar"}
        </button>
        <button onClick={onCancelar} style={btnSecondary}>Cancelar</button>
      </div>
      <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 8, lineHeight: 1.5 }}>
        O insumo passa a existir em Insumos como qualquer outro — entra no estoque, aparece na contagem e nas próximas notas.
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// Lista de pratos
// ---------------------------------------------------------------------------
export default function FichasTecnicas() {
  const [tela, setTela] = useState("lista"); // lista | editor
  const [pratos, setPratos] = useState([]);
  const [carregandoLista, setCarregandoLista] = useState(true);
  const [importando, setImportando] = useState(false);
  const [erro, setErro] = useState("");
  const [pratoAtual, setPratoAtual] = useState(null);
  const [busca, setBusca] = useState("");
  const [margemGeral, setMargemGeral] = useState(65);
  const [margensLinha, setMargensLinha] = useState({});
  const [abrirMargens, setAbrirMargens] = useState(false);

  // Margem pretendida em três níveis: prato manda na linha, linha manda
  // na geral. O card sempre diz de onde veio, pra ninguém ficar
  // procurando por que um prato calculou diferente do vizinho.
  const margemDoPrato = useCallback((p) => {
    if (p.margem_pretendida != null) return { valor: Number(p.margem_pretendida), origem: "deste prato" };
    const daLinha = p.linha_produto != null ? margensLinha[p.linha_produto] : undefined;
    if (daLinha != null) return { valor: Number(daLinha), origem: `da linha ${p.linha_produto}` };
    return { valor: Number(margemGeral), origem: "geral" };
  }, [margensLinha, margemGeral]);

  const carregarMargens = useCallback(async () => {
    const [rGeral, rLinhas] = await Promise.all([
      supabase.from("dre_config").select("valor").eq("chave", "margem_pretendida").maybeSingle(),
      supabase.from("linhas_margem").select("linha, margem"),
    ]);
    if (rGeral.data?.valor != null) setMargemGeral(Number(rGeral.data.valor));
    if (rLinhas.data) setMargensLinha(Object.fromEntries(rLinhas.data.map((l) => [l.linha, Number(l.margem)])));
  }, []);

  const carregarPratos = useCallback(async () => {
    setCarregandoLista(true);
    setErro("");
    const [{ data: pratosData, error: e1 }, { data: itensData, error: e2 }] = await Promise.all([
      supabase.from("pratos").select("*").order("nome"),
      supabase.from("prato_insumos").select("prato_id, quantidade, insumo:insumos(custo_medio_atual)"),
    ]);
    if (e1 || e2) { setErro((e1 || e2).message); setCarregandoLista(false); return; }
    const custoPorPrato = {};
    (itensData || []).forEach((li) => {
      const custo = (li.quantidade || 0) * (li.insumo?.custo_medio_atual || 0);
      custoPorPrato[li.prato_id] = (custoPorPrato[li.prato_id] || 0) + custo;
      custoPorPrato[li.prato_id + ":n"] = (custoPorPrato[li.prato_id + ":n"] || 0) + 1;
    });
    const combinados = (pratosData || []).map((p) => {
      const temFicha = (custoPorPrato[p.id + ":n"] || 0) > 0;
      const custoTotal = custoPorPrato[p.id] || 0;
      const custoZerado = temFicha && custoTotal === 0;
      const margem = p.preco_venda - custoTotal;
      const margemPct = p.preco_venda > 0 ? (margem / p.preco_venda) * 100 : 0;
      return { ...p, temFicha, custoTotal, custoZerado, margem, margemPct };
    });
    setPratos([...combinados].sort(porNome));
    setCarregandoLista(false);
  }, []);

  useEffect(() => { carregarPratos(); carregarMargens(); }, [carregarPratos, carregarMargens]);

  const salvarMargemGeral = async (v) => {
    const n = paraNumero(v);
    setMargemGeral(n);
    await supabase.from("dre_config").update({ valor: n, atualizado_em: new Date().toISOString() }).eq("chave", "margem_pretendida");
  };
  const salvarMargemLinha = async (linha, texto) => {
    const vazio = String(texto ?? "").trim() === "";
    setMargensLinha((prev) => {
      const novo = { ...prev };
      if (vazio) delete novo[linha]; else novo[linha] = paraNumero(texto);
      return novo;
    });
    if (vazio) await supabase.from("linhas_margem").delete().eq("linha", linha);
    else await supabase.from("linhas_margem").upsert({ linha, margem: paraNumero(texto) });
  };

  const importarPratos = async () => {
    setImportando(true);
    setErro("");
    const { data, error } = await supabase.functions.invoke("cardapioweb-proxy", {
      body: { acao: "importar_pratos", data_inicio: `${diasAtras(90)}T00:00:00-03:00`, data_fim: `${hoje()}T23:59:59-03:00` },
    });
    setImportando(false);
    if (error) { setErro(await extrairErroFuncao(error)); return; }
    if (data?.error) { setErro(data.error); return; }
    carregarPratos();
  };

  if (tela === "editor" && pratoAtual) {
    return (
      <EditorFicha
        prato={pratoAtual}
        margem={margemDoPrato(pratoAtual)}
        onVoltar={() => { setTela("lista"); setPratoAtual(null); carregarPratos(); }}
      />
    );
  }

  const visiveis = pratos.filter((p) => semAcento(p.nome).includes(semAcento(busca)));

  return (
    <div>
      <div style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "#8A8778" }}>
          {pratos.filter((p) => p.temFicha).length} de {pratos.length} pratos com ficha cadastrada
        </div>
        <button onClick={importarPratos} disabled={importando} style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6 }}>
          {importando ? <Loader2 size={14} /> : <RefreshCw size={14} />}
          Importar pratos
        </button>
      </div>

      {/* margem pretendida */}
      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <label style={{ fontSize: 13, fontWeight: 700 }}>Margem pretendida</label>
          <input value={margemGeral} onChange={(e) => setMargemGeral(e.target.value)} onBlur={(e) => salvarMargemGeral(e.target.value)}
            style={{ width: 74, padding: "7px 9px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 15, fontWeight: 800, textAlign: "right", fontFamily: "inherit" }} />
          <span style={{ fontSize: 15, fontWeight: 800 }}>%</span>
          <button onClick={() => setAbrirMargens((v) => !v)} style={{ ...linkBtn, fontSize: 12 }}>
            {abrirMargens ? "esconder por linha ‹" : "mudar por linha de produto ›"}
          </button>
        </div>
        <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 6, lineHeight: 1.5 }}>
          Preço sugerido = custo ÷ (1 − margem). Vale pro cardápio inteiro; cada linha e cada prato pode ter a sua, e a do prato manda em todas.
        </div>
        {abrirMargens && (
          <div style={{ marginTop: 12, borderTop: "1px solid #F0EBDD", paddingTop: 10 }}>
            {LINHAS_PRODUTO.map((l) => (
              <div key={l} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0", fontSize: 12.5 }}>
                <span style={{ flex: 1 }}>{l}</span>
                <input defaultValue={margensLinha[l] ?? ""} placeholder={String(margemGeral)}
                  onBlur={(e) => salvarMargemLinha(l, e.target.value)}
                  style={{ width: 64, padding: "5px 7px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12.5, textAlign: "right", fontFamily: "inherit" }} />
                <span>%</span>
              </div>
            ))}
            <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 6 }}>
              Campo em branco herda os {margemGeral}% de cima. Apagar o número devolve pra herança.
            </div>
          </div>
        )}
      </div>

      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}

      {pratos.length > 0 && (
        <div style={{ position: "relative", marginBottom: 14 }}>
          <Search size={15} color="#8A8778" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar prato…"
            style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px 9px 34px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF" }} />
        </div>
      )}

      {carregandoLista ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : pratos.length === 0 ? (
        <div style={{ ...cardStyle, textAlign: "center", color: "#8A8778", fontSize: 13 }}>
          Nenhum prato encontrado ainda. Clique em "Importar pratos" para buscar os itens vendidos nos últimos 90 dias.
        </div>
      ) : (
        <div className="list-grid">
          {visiveis.map((p) => {
            const m = margemDoPrato(p);
            const sugerido = p.custoTotal > 0 && m.valor < 100 ? p.custoTotal / (1 - m.valor / 100) : 0;
            const abaixo = sugerido > 0 && p.preco_venda < sugerido - 0.005;
            return (
              <div key={p.id} style={{ ...itemRow, flexDirection: "column", alignItems: "stretch", gap: 6, border: (p.temFicha && !p.custoZerado) ? "1px solid #E8E2D2" : "1px solid #F0D8CE" }}>
                <button onClick={() => { setPratoAtual(p); setTela("editor"); }}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", width: "100%" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: "#22231F" }}>
                      {p.nome}
                      {p.revenda && <span style={{ ...pill, fontSize: 10, marginLeft: 6, background: "#EAF1F7", color: "#3A6684" }}>revenda</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "#8A8778" }}>
                      {brl(p.preco_venda)}
                      {sugerido > 0 && <> · sugerido <strong style={{ color: abaixo ? "#A32D2D" : "#22231F" }}>{brl(sugerido)}</strong></>}
                    </div>
                  </div>
                  {p.custoZerado ? (
                    <span style={{ ...pill, background: "#F0999522", color: "#A32D2D" }}>Custo pendente</span>
                  ) : p.temFicha ? (
                    <span style={{ ...pill, background: abaixo ? "#F0999522" : "#2F8F5B22", color: abaixo ? "#A32D2D" : "#0F6E56" }}>
                      {p.margemPct.toFixed(1)}%
                    </span>
                  ) : (
                    <span style={{ ...pill, background: "#F0999522", color: "#A32D2D" }}>Sem ficha</span>
                  )}
                </button>
                <select value={p.linha_produto || ""} onClick={(e) => e.stopPropagation()}
                  onChange={async (e) => {
                    const linha = e.target.value || null;
                    await supabase.from("pratos").update({ linha_produto: linha }).eq("id", p.id);
                    setPratos((prev) => prev.map((x) => x.id === p.id ? { ...x, linha_produto: linha } : x));
                  }}
                  style={{ fontSize: 11, padding: "3px 6px", borderRadius: 6, border: "1px solid #E8E2D2", background: p.linha_produto ? "#FFFFFF" : "#FBF3D9", color: p.linha_produto ? "#22231F" : "#7A6A1E" }}>
                  <option value="">— linha de produto pendente —</option>
                  {LINHAS_PRODUTO.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor de uma ficha técnica
//
// Duas telas conforme o tipo do produto:
//   COMPOSIÇÃO — receita, as quatro colunas da planilha do Clécio:
//                ingrediente, preço, quantidade, total
//   REVENDA    — comprado pronto e vendido pronto (Heineken). Um campo só.
//
// Por baixo não muda nada: revenda grava UM insumo com quantidade 1, então
// CMV, baixa de estoque e DRE continuam funcionando iguais.
//
// O que saiu de propósito: "insumo composto" e "custo unitário da última
// compra" editáveis. Isso é cadastro de insumo, mora na aba Insumos. O custo
// vem da nota fiscal e vale pra TODAS as fichas que usam aquele insumo —
// corrigir dentro de uma ficha deixaria as outras erradas.
// ---------------------------------------------------------------------------
function EditorFicha({ prato, margem, onVoltar }) {
  const [linhas, setLinhas] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [revenda, setRevenda] = useState(!!prato.revenda);
  const [criando, setCriando] = useState(null);   // texto digitado que virou "cadastrar"
  const [novaQtd, setNovaQtd] = useState("");
  const [novoInsumo, setNovoInsumo] = useState(null);
  const [margemPrato, setMargemPrato] = useState(prato.margem_pretendida ?? "");

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [{ data: itens }, { data: todos }] = await Promise.all([
      supabase.from("prato_insumos")
        .select("insumo_id, quantidade, insumo:insumos(id, nome, unidade, custo_medio_atual)")
        .eq("prato_id", prato.id),
      supabase.from("insumos").select("id, nome, unidade, custo_medio_atual").order("nome"),
    ]);
    setLinhas((itens || []).map((it) => {
      const un = it.insumo?.unidade || "un";
      const dig = paraDigitada(it.quantidade || 0, un);
      return {
        insumo_id: it.insumo_id,
        nome: it.insumo?.nome || "(insumo apagado)",
        unidade: un,
        custo: it.insumo?.custo_medio_atual || 0,
        valor: String(dig.valor).replace(".", ","),
        unidadeDigitada: dig.unidade,
      };
    }));
    setInsumos([...(todos || [])].sort(porNome));
    setCarregando(false);
  }, [prato.id]);

  useEffect(() => { carregar(); }, [carregar]);

  const quantidadeBase = (l) => daDigitada(l.valor, l.unidadeDigitada, l.unidade);
  const custoDaLinha = (l) => quantidadeBase(l) * (l.custo || 0);
  const custoTotal = linhas.reduce((s, l) => s + custoDaLinha(l), 0);
  const margemValor = prato.preco_venda - custoTotal;
  const margemPct = prato.preco_venda > 0 ? (margemValor / prato.preco_venda) * 100 : 0;

  const margemUsada = margemPrato !== "" ? { valor: paraNumero(margemPrato), origem: "deste prato" } : margem;
  const sugerido = custoTotal > 0 && margemUsada.valor < 100 ? custoTotal / (1 - margemUsada.valor / 100) : 0;

  // O erro da Fritas: prato marcado como composição cujo único ingrediente
  // é ele mesmo. Ou faltam os ingredientes de verdade, ou é revenda.
  const apontaProSiMesmo = !revenda && linhas.length === 1 && iguais(linhas[0].nome, prato.nome);

  const adicionar = (insumo, qtdTexto) => {
    if (linhas.some((l) => l.insumo_id === insumo.id)) {
      setErro(`"${insumo.nome}" já está nessa ficha — mude a quantidade na linha dele.`);
      return;
    }
    setErro("");
    const sub = SUB_UNIDADE[insumo.unidade] || insumo.unidade;
    setLinhas((prev) => [...prev, {
      insumo_id: insumo.id,
      nome: insumo.nome,
      unidade: insumo.unidade,
      custo: insumo.custo_medio_atual || 0,
      valor: String(qtdTexto ?? "").trim() || (insumo.unidade === "un" ? "1" : "100"),
      unidadeDigitada: sub,
    }]);
    setNovoInsumo(null);
    setNovaQtd("");
  };

  const definirRevenda = (insumo) => {
    setLinhas([{
      insumo_id: insumo.id, nome: insumo.nome, unidade: insumo.unidade,
      custo: insumo.custo_medio_atual || 0, valor: "1", unidadeDigitada: insumo.unidade,
    }]);
    setErro("");
  };

  const trocarUnidade = (idx) => {
    setLinhas((prev) => prev.map((l, i) => {
      if (i !== idx) return l;
      const sub = SUB_UNIDADE[l.unidade];
      if (!sub) return l;
      const v = paraNumero(l.valor);
      const naSub = l.unidadeDigitada === sub;
      return {
        ...l,
        unidadeDigitada: naSub ? l.unidade : sub,
        valor: String(naSub ? limpo(v / 1000) : limpo(v * 1000)).replace(".", ","),
      };
    }));
  };

  const salvar = async () => {
    setSalvando(true);
    setErro("");
    const paraGravar = revenda ? linhas.slice(0, 1) : linhas;
    const { error: e1 } = await supabase.from("pratos").update({
      revenda,
      margem_pretendida: margemPrato === "" ? null : paraNumero(margemPrato),
    }).eq("id", prato.id);
    if (e1) { setErro(e1.message); setSalvando(false); return; }

    await supabase.from("prato_insumos").delete().eq("prato_id", prato.id);
    if (paraGravar.length > 0) {
      const { error } = await supabase.from("prato_insumos").insert(
        paraGravar.map((l) => ({
          prato_id: prato.id,
          insumo_id: l.insumo_id,
          quantidade: revenda ? 1 : quantidadeBase(l),
        }))
      );
      if (error) { setErro(error.message); setSalvando(false); return; }
    }
    setSalvando(false);
    onVoltar();
  };

  const semPreco = insumos.length > 0 && linhas.some((l) => !l.custo);

  return (
    <div>
      <button onClick={onVoltar} style={{ ...linkBtn, display: "flex", alignItems: "center", gap: 4, marginBottom: 14 }}>
        <ChevronLeft size={14} /> Voltar à lista de pratos
      </button>

      <div style={{ ...cardStyle, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: "#22231F" }}>{prato.nome}</div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#8A8778" }}>Preço de venda</div>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#22231F" }}>{brl(prato.preco_venda)}</div>
        </div>
      </div>

      {/* tipo do produto */}
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {[
          { v: false, titulo: "Composição", dica: "Tem receita — vários ingredientes" },
          { v: true,  titulo: "Revenda",    dica: "Compro pronto e vendo — sem receita" },
        ].map((op) => (
          <button key={String(op.v)} onClick={() => setRevenda(op.v)}
            style={{
              display: "flex", alignItems: "center", gap: 8, border: "1px solid #E8E2D2", borderRadius: 10,
              padding: "10px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "left", fontFamily: "inherit",
              background: revenda === op.v ? "#22231F" : "#FFFFFF",
              color: revenda === op.v ? "#F3EFE3" : "#55534A",
              borderColor: revenda === op.v ? "#22231F" : "#E8E2D2",
            }}>
            {op.v ? <Package size={16} /> : <ListIcon size={16} />}
            <span>{op.titulo}<small style={{ display: "block", fontWeight: 500, fontSize: 10.5, opacity: 0.75, marginTop: 1 }}>{op.dica}</small></span>
          </button>
        ))}
      </div>

      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}

      {apontaProSiMesmo && (
        <div style={{ display: "flex", gap: 10, background: "#FCEBEB", border: "1px solid #E5B9B3", color: "#7A2020", borderRadius: 10, padding: "12px 13px", fontSize: 12.5, lineHeight: 1.5, marginBottom: 12 }}>
          <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            Esse prato está marcado como <strong>Composição</strong>, mas o único ingrediente é
            <strong> "{linhas[0].nome}"</strong> — ele mesmo. Ou faltam os ingredientes de verdade,
            ou esse produto é <strong>Revenda</strong>.
            <div style={{ display: "flex", gap: 7, marginTop: 9, flexWrap: "wrap" }}>
              <button onClick={() => setRevenda(true)} style={{ ...btnSecondary, background: "#7A2020", color: "#FFFFFF", borderColor: "#7A2020", fontSize: 12 }}>
                É revenda — mudar pra Revenda
              </button>
            </div>
          </div>
        </div>
      )}

      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : revenda ? (
        <RevendaFicha linha={linhas[0]} insumos={insumos} onEscolher={definirRevenda}
          onCriar={(texto) => setCriando(texto)} onLimpar={() => setLinhas([])} />
      ) : (
        <>
          <div style={sectionLabel}>O que entra nesse prato</div>
          <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, background: "#FFFFFF", overflow: "hidden", marginBottom: 10 }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ ...thF, textAlign: "left" }}>Ingrediente</th>
                    <th style={thF}>Preço</th>
                    <th style={thF}>Quantidade</th>
                    <th style={thF}>Total</th>
                    <th style={thF}></th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l, idx) => (
                    <tr key={l.insumo_id}>
                      <td style={{ ...tdF, textAlign: "left", whiteSpace: "normal", minWidth: 140 }}>{l.nome}</td>
                      <td style={tdF}>
                        {l.custo > 0
                          ? <span style={{ color: "#55534A" }}>{brl(l.custo)} <small style={{ color: "#8A8778", fontSize: 10 }}>/{l.unidade}</small></span>
                          : <span style={{ color: "#A32D2D", fontWeight: 700 }}>sem preço</span>}
                      </td>
                      <td style={tdF}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <input value={l.valor}
                            onChange={(e) => setLinhas((prev) => prev.map((x, i) => i === idx ? { ...x, valor: e.target.value } : x))}
                            style={campoNum} />
                          <button onClick={() => trocarUnidade(idx)} disabled={!SUB_UNIDADE[l.unidade]}
                            title={SUB_UNIDADE[l.unidade] ? "Alternar entre grama e quilo" : "Esse insumo é contado por unidade"}
                            style={{ border: "1px solid #E8E2D2", background: "#F6F1E7", color: "#55534A", borderRadius: 6, padding: "5px 8px", fontSize: 11.5, fontWeight: 700, cursor: SUB_UNIDADE[l.unidade] ? "pointer" : "default", minWidth: 32, fontFamily: "inherit" }}>
                            {l.unidadeDigitada}
                          </button>
                        </span>
                      </td>
                      <td style={{ ...tdF, fontWeight: 700 }}>
                        {l.custo > 0 ? brl(custoDaLinha(l)) : <span style={{ color: "#A32D2D" }}>—</span>}
                      </td>
                      <td style={tdF}>
                        <button onClick={() => setLinhas((prev) => prev.filter((_, i) => i !== idx))}
                          style={{ ...ghostIconBtn, color: "#C4432B" }} aria-label="Tirar da ficha"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                  {linhas.length === 0 && (
                    <tr><td colSpan={5} style={{ ...tdF, textAlign: "center", color: "#8A8778" }}>Nenhum ingrediente ainda.</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} style={{ ...tfF, textAlign: "left", fontSize: 10, letterSpacing: 0.3, textTransform: "uppercase", color: "#8A8778" }}>Custo dos ingredientes</td>
                    <td style={tfF}>{brl(custoTotal)}</td>
                    <td style={tfF}></td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {criando === null ? (
              <div style={{ display: "flex", gap: 7, padding: "11px 12px", background: "#FCFAF3", borderTop: "1px dashed #DDD5BF", alignItems: "center", flexWrap: "wrap" }}>
                <BuscaInsumo insumos={insumos}
                  onEscolher={(i) => setNovoInsumo(i)}
                  onCriar={(texto) => setCriando(texto)} />
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <input value={novaQtd} onChange={(e) => setNovaQtd(e.target.value)} placeholder="qtd" style={campoNum} />
                  <span style={{ border: "1px solid #E8E2D2", background: "#F6F1E7", color: "#55534A", borderRadius: 6, padding: "5px 8px", fontSize: 11.5, fontWeight: 700, minWidth: 32, textAlign: "center" }}>
                    {novoInsumo ? (SUB_UNIDADE[novoInsumo.unidade] || novoInsumo.unidade) : "—"}
                  </span>
                </span>
                <button onClick={() => novoInsumo && adicionar(novoInsumo, novaQtd)} disabled={!novoInsumo}
                  style={{ ...btnSecondary, background: novoInsumo ? "#22231F" : "#F6F1E7", color: novoInsumo ? "#F3EFE3" : "#B3AC96", borderColor: novoInsumo ? "#22231F" : "#E8E2D2", display: "flex", alignItems: "center", gap: 5 }}>
                  <Plus size={14} /> Adicionar
                </button>
                {novoInsumo && (
                  <div style={{ width: "100%", fontSize: 11, color: "#8A8778" }}>
                    Escolhido: <strong>{novoInsumo.nome}</strong> · {novoInsumo.custo_medio_atual > 0 ? `${brl(novoInsumo.custo_medio_atual)} /${novoInsumo.unidade}` : "sem preço"}
                  </div>
                )}
              </div>
            ) : (
              <CadastrarInsumo nomeInicial={criando}
                onCancelar={() => setCriando(null)}
                onCriado={(novo) => {
                  setInsumos((prev) => [...prev, novo].sort(porNome));
                  adicionar(novo, novo.unidade === "un" ? "1" : "100");
                  setCriando(null);
                }} />
            )}
          </div>

          {semPreco && (
            <div style={{ fontSize: 11, color: "#A32D2D", marginBottom: 12, lineHeight: 1.5 }}>
              Tem ingrediente sem preço nessa ficha. Ele não entra no custo — o valor real do prato é maior
              que o mostrado. O preço vem da nota fiscal ou do cadastro em Insumos.
            </div>
          )}
        </>
      )}

      {!carregando && (
        <>
          <div style={{ ...cardStyle, marginBottom: 12 }}>
            <div style={tlF}><span style={{ color: "#8A8778" }}>Custo dos ingredientes</span><span>{brl(custoTotal)}</span></div>
            <div style={{ ...tlF, fontWeight: 800, fontSize: 15 }}>
              <span>Margem de contribuição</span>
              <span>
                {brl(margemValor)}
                <span style={{ ...pill, fontSize: 11, marginLeft: 8, background: sugerido > 0 && prato.preco_venda < sugerido ? "#FCEBEB" : "#DCF0E6", color: sugerido > 0 && prato.preco_venda < sugerido ? "#8E2F2F" : "#0F6E56" }}>
                  {margemPct.toFixed(1)}%
                </span>
              </span>
            </div>

            <div style={{ background: "#F6F1E7", borderRadius: 10, padding: "11px 12px", marginTop: 8 }}>
              <div style={tlF}>
                <span style={{ color: "#8A8778" }}>
                  Preço sugerido <span style={{ fontSize: 10.5 }}>(margem de {margemUsada.valor}%, {margemUsada.origem})</span>
                </span>
                <span style={{ fontWeight: 800 }}>{sugerido > 0 ? brl(sugerido) : "—"}</span>
              </div>
              <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 4, lineHeight: 1.5 }}>
                {sugerido > 0
                  ? (prato.preco_venda >= sugerido
                      ? `Você vende ${brl(prato.preco_venda - sugerido)} acima do sugerido.`
                      : `Você vende ${brl(sugerido - prato.preco_venda)} abaixo do sugerido.`)
                  : "Sem custo cadastrado, não dá pra sugerir preço."}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9, paddingTop: 9, borderTop: "1px solid #E8E2D2" }}>
                <span style={{ flex: 1, fontSize: 12 }}>Margem só deste prato</span>
                <input value={margemPrato} onChange={(e) => setMargemPrato(e.target.value)} placeholder={String(margem.valor)}
                  style={{ width: 64, padding: "5px 7px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12.5, textAlign: "right", fontFamily: "inherit" }} />
                <span>%</span>
              </div>
              <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 4 }}>
                Em branco herda a linha. Preenchido, vale só aqui — é o último nível, manda em tudo.
              </div>
            </div>
          </div>

          <button onClick={salvar} disabled={salvando} style={{ ...btnPrimary, width: "100%" }}>
            {salvando ? <Loader2 size={16} /> : <Check size={16} />} Salvar ficha técnica
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revenda — compro pronto, vendo pronto
// ---------------------------------------------------------------------------
function RevendaFicha({ linha, insumos, onEscolher, onCriar, onLimpar }) {
  return (
    <div style={{ ...cardStyle, marginBottom: 12 }}>
      <div style={{ ...sectionLabel, marginBottom: 8 }}>Qual insumo é esse produto</div>
      {linha ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 180, fontSize: 13.5, fontWeight: 600 }}>{linha.nome}</div>
          <div style={{ fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", color: linha.custo > 0 ? "#22231F" : "#A32D2D" }}>
            {linha.custo > 0 ? <>{brl(linha.custo)} <small style={{ fontSize: 10, color: "#8A8778" }}>/{linha.unidade}</small></> : "sem preço"}
          </div>
          <button onClick={onLimpar} style={{ ...ghostIconBtn, color: "#C4432B" }} aria-label="Trocar insumo"><Trash2 size={14} /></button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 7, alignItems: "center", flexWrap: "wrap" }}>
          <BuscaInsumo insumos={insumos} onEscolher={onEscolher} onCriar={onCriar} placeholder="Digite o insumo…" />
        </div>
      )}
      <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 8, lineHeight: 1.5 }}>
        Uma unidade vendida consome uma unidade do estoque — é isso que dá baixa quando o pedido sai.
        Aqui é certo o insumo ter o mesmo nome do produto: você compra e vende a mesma coisa.
      </div>
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
const campoNum = { width: 74, padding: "5px 7px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13, textAlign: "right", fontFamily: "inherit", fontVariantNumeric: "tabular-nums" };
const thF = { background: "#F6F1E7", fontSize: 10, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase", color: "#8A8778", padding: "8px 11px", textAlign: "right", borderBottom: "1px solid #E8E2D2", whiteSpace: "nowrap" };
const tdF = { padding: "9px 11px", textAlign: "right", borderBottom: "1px solid #F0EBDD", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: "#22231F" };
const tfF = { padding: "9px 11px", textAlign: "right", background: "#F6F1E7", fontWeight: 800, borderTop: "1px solid #E8E2D2", fontVariantNumeric: "tabular-nums" };
const tlF = { display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 13.5, padding: "4px 0" };
