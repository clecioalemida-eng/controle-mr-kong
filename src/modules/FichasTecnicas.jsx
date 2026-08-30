// ===== FichasTecnicas.jsx =====
import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Loader2, Plus, Trash2, Check, RefreshCw, AlertTriangle, ChevronLeft, Search,
  Package, List as ListIcon, EyeOff, RotateCcw, Copy,
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
// Chave de comparação com o cardápio: só letra e número, sem acento, sem
// espaço, sem pontuação. É o que faz "5star" achar "5 star" e
// "Água sem gás 500ml" achar "Agua sem gas 500 ml".
function chaveNome(t) { return semAcento(t).replace(/[^a-z0-9]/g, ""); }
// Quando o catálogo foi conferido pela última vez. Fica no navegador, não
// no banco: é só pra decidir se vale gastar uma consulta ao abrir a tela.
// Navegador diferente confere de novo — o que custa uma consulta, não um
// erro de número.
const CHAVE_CONFERIDO = "mrkong:precos_cardapio_conferidos_em";
const HORAS_ATE_RECONFERIR = 12;
function lidoEmSalvo() {
  try { return localStorage.getItem(CHAVE_CONFERIDO) || null; } catch { return null; }
}
function guardarLidoEm(iso) {
  try { localStorage.setItem(CHAVE_CONFERIDO, iso); } catch { /* modo privado */ }
}
function horasDesde(iso) {
  if (!iso) return Infinity;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Infinity;
  return (Date.now() - t) / 3600000;
}
function horaCurta(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const hoje = new Date();
  const mesmoDia = d.toDateString() === hoje.toDateString();
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return mesmoDia ? `hoje às ${hora}` : `${d.toLocaleDateString("pt-BR")} às ${hora}`;
}

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
  const [resumoImport, setResumoImport] = useState(null);
  // Pratos irmaos: dois cadastros pro mesmo produto de verdade. Nasceram
  // do Importar automatico ("Coca Cola Zero" + "Coca Cola Zero 350 Ml"),
  // e enquanto os dois viverem a venda e a ficha ficam rachadas em duas
  // — o CMV conta metade do custo e a margem aparece melhor do que e.
  const [irmaos, setIrmaos] = useState(null);
  const [juntando, setJuntando] = useState(null);
  const [verIrmaos, setVerIrmaos] = useState(false);
  const [erro, setErro] = useState("");
  const [pratoAtual, setPratoAtual] = useState(null);
  const [busca, setBusca] = useState("");
  const [margemGeral, setMargemGeral] = useState(65);
  const [margensLinha, setMargensLinha] = useState({});
  const [abrirMargens, setAbrirMargens] = useState(false);
  const [verEscondidos, setVerEscondidos] = useState(false);
  // "todos" | "sem_linha" | "sem_ficha" — pra sentar e preencher o que
  // falta de uma vez, em vez de caçar na lista de 105.
  const [filtro, setFiltro] = useState("todos");
  const [excluindo, setExcluindo] = useState(null); // prato que a lixeira abriu
  // Conferência de preços contra o catálogo do CardápioWeb.
  // `resultado` guarda o que a comparação achou; nada vai pro banco antes
  // de clicar em aplicar.
  const [conferindo, setConferindo] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [lidoEm, setLidoEm] = useState(lidoEmSalvo());
  const [resultado, setResultado] = useState(null);
  const [avisoPreco, setAvisoPreco] = useState("");
  const jaConferiuNestaTela = React.useRef(false);

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

  const carregarIrmaos = useCallback(async () => {
    const { data, error } = await supabase.rpc("pratos_irmaos", { p_dias: 90 });
    // Sem a migracao 106 a funcao nao existe. Nao e erro pra mostrar: o
    // painel simplesmente nao aparece.
    if (error) { setIrmaos([]); return; }
    setIrmaos(data || []);
  }, []);

  const juntar = async (par, vencedorId, perdedorId) => {
    setJuntando(par.a_id + par.b_id);
    setErro("");
    const { error } = await supabase.rpc("juntar_pratos", {
      p_vencedor: vencedorId,
      p_perdedor: perdedorId,
    });
    setJuntando(null);
    if (error) { setErro(error.message); return; }
    await carregarIrmaos();
    await carregarPratos();
  };

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
      // `ativo` só existe depois da migração 087; sem ela, tudo aparece
      const ativo = p.ativo !== false;
      return { ...p, temFicha, custoTotal, custoZerado, margem, margemPct, ativo };
    });
    setPratos([...combinados].sort(porNome));
    setCarregandoLista(false);
  }, []);

  useEffect(() => { carregarPratos(); carregarMargens(); carregarIrmaos(); },
            [carregarPratos, carregarMargens, carregarIrmaos]);

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

  // Compara o preço de cada prato com o catálogo do CardápioWeb.
  //
  // A ordem de casamento importa: primeiro o código do CardápioWeb que o
  // prato já guarda (nome muda, código não), depois o nome normalizado.
  // Se dois itens do cardápio caem no mesmo nome, não escolhe nenhum —
  // chutar aqui é trocar o preço do prato errado.
  const conferirPrecos = useCallback(async (listaPratos) => {
    setConferindo(true);
    setAvisoPreco("");
    const { data, error } = await supabase.functions.invoke("cardapioweb-proxy", {
      body: { acao: "catalogo_precos" },
    });
    if (error) { setConferindo(false); setAvisoPreco(await extrairErroFuncao(error)); return; }
    if (data?.error) { setConferindo(false); setAvisoPreco(data.error); return; }

    const itens = data.itens || [];
    const porId = new Map();
    const porChave = new Map();
    itens.forEach((it) => {
      porId.set(it.id, it);
      const k = chaveNome(it.nome);
      if (!k) return;
      if (!porChave.has(k)) porChave.set(k, []);
      porChave.get(k).push(it);
    });

    const mudam = [];
    const semPar = [];
    const codigosAGravar = [];
    let jaCertos = 0;
    (listaPratos || []).filter((p) => p.ativo).forEach((p) => {
      let item = p.cardapioweb_item_id != null ? porId.get(p.cardapioweb_item_id) : null;
      let viaNome = false;
      if (!item) {
        const candidatos = porChave.get(chaveNome(p.nome)) || [];
        if (candidatos.length === 1) { item = candidatos[0]; viaNome = true; }
        else if (candidatos.length > 1) {
          semPar.push({ prato: p, motivo: `${candidatos.length} itens do cardápio com esse mesmo nome` });
          return;
        }
      }
      if (!item) {
        semPar.push({ prato: p, motivo: "não achei no cardápio — nome diferente ou item desativado" });
        return;
      }
      if (viaNome) codigosAGravar.push({ pratoId: p.id, itemId: item.id });
      const novo = Number(item.preco_efetivo) || 0;
      const atual = Number(p.preco_venda) || 0;
      if (Math.abs(novo - atual) > 0.005) mudam.push({ prato: p, item, viaNome, de: atual, para: novo });
      else jaCertos += 1;
    });

    const agora = data.lido_em || new Date().toISOString();
    guardarLidoEm(agora);
    setLidoEm(agora);
    setResultado({ mudam, semPar, jaCertos, codigosAGravar, total: itens.length });
    setConferindo(false);
  }, []);

  // Confere sozinho ao abrir a tela quando a última conferida passou de
  // 12 horas — na prática, uma vez por dia. O catálogo não tem o limite
  // de 5 consultas por minuto que o histórico de pedidos tem.
  useEffect(() => {
    if (jaConferiuNestaTela.current) return;
    if (carregandoLista || pratos.length === 0) return;
    jaConferiuNestaTela.current = true;
    if (horasDesde(lidoEmSalvo()) >= HORAS_ATE_RECONFERIR) conferirPrecos(pratos);
  }, [carregandoLista, pratos, conferirPrecos]);

  const aplicarPrecos = async () => {
    if (!resultado) return;
    setAplicando(true);
    setAvisoPreco("");
    // Grava o código de quem casou pelo nome mesmo que o preço não tenha
    // mudado: da próxima vez esse prato já entra pelo caminho seguro.
    for (const c of resultado.codigosAGravar) {
      await supabase.from("pratos").update({ cardapioweb_item_id: c.itemId }).eq("id", c.pratoId);
    }
    for (const d of resultado.mudam) {
      const campos = { preco_venda: d.para };
      if (d.viaNome) campos.cardapioweb_item_id = d.item.id;
      const { error } = await supabase.from("pratos").update(campos).eq("id", d.prato.id);
      if (error) { setAplicando(false); setAvisoPreco(error.message); return; }
    }
    setAplicando(false);
    setResultado((r) => (r ? { ...r, mudam: [], jaCertos: r.jaCertos + (r.mudam?.length || 0), codigosAGravar: [] } : r));
    carregarPratos();
  };

  const importarPratos = async () => {
    setImportando(true);
    setErro("");
    setResumoImport(null);
    const { data, error } = await supabase.functions.invoke("cardapioweb-proxy", {
      body: { acao: "importar_pratos", data_inicio: `${diasAtras(90)}T00:00:00-03:00`, data_fim: `${hoje()}T23:59:59-03:00` },
    });
    setImportando(false);
    if (error) { setErro(await extrairErroFuncao(error)); return; }
    if (data?.error) { setErro(data.error); return; }
    // Dizer o que aconteceu.
    //
    // Antes o botão importava e recarregava a lista, e mais nada. Se
    // nenhum prato novo tivesse entrado, a tela ficava igualzinha — e a
    // conclusão natural de quem clica é "não funcionou". Não dava pra
    // distinguir "não achei nada novo" de "não rodei".
    // `criados` soma os dois caminhos de proposito: pra quem esta olhando
    // a tela, prato novo e prato novo — nao interessa se entrou pelo
    // codigo ou pelo nome. A quebra fica no detalhe, logo abaixo.
    setResumoImport({
      encontrados: data?.pratos_distintos_encontrados || 0,
      criados: (data?.pratos_criados || 0) + (data?.sem_codigo_criados || 0),
      criadosComCodigo: data?.pratos_criados || 0,
      atualizados: data?.pratos_atualizados || 0,
      nomesCriados: data?.nomes_criados || [],
      nomesAmbiguos: data?.nomes_ambiguos || [],
      pedidos: data?.pedidos_analisados || 0,
      // Itens que o CardapioWeb manda SEM codigo. Ate 30/08/2026 esses
      // nem eram contados — sumiam antes de chegar aqui, e por isso o
      // numero de pratos travava por mais que se importasse.
      semCodigoEncontrados: data?.itens_sem_codigo || 0,
      semCodigoCriados: data?.sem_codigo_criados || 0,
      semCodigoJaExistiam: data?.sem_codigo_ja_existiam || 0,
      nomesSemCodigo: data?.nomes_sem_codigo || [],
      // Orfaos: item sem codigo que nao casou com nada. O Importar NAO
      // cria mais esses sozinho — foi assim que os irmaos nasceram.
      semDono: data?.sem_dono || [],
      semDonoTotal: data?.sem_dono_total || 0,
    });
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

  const escondidos = pratos.filter((p) => !p.ativo).length;
  const semLinha = pratos.filter((p) => p.ativo && !String(p.linha_produto || "").trim()).length;
  const semFicha = pratos.filter((p) => p.ativo && !p.temFicha).length;
  const visiveis = pratos
    .filter((p) => (verEscondidos ? true : p.ativo))
    .filter((p) => {
      if (filtro === "sem_linha") return !String(p.linha_produto || "").trim();
      if (filtro === "sem_ficha") return !p.temFicha;
      return true;
    })
    .filter((p) => semAcento(p.nome).includes(semAcento(busca)));

  return (
    <div>
      <div style={{ ...cardStyle, display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, color: "#8A8778" }}>
          <b>{pratos.filter((p) => p.temFicha && p.ativo).length} de {pratos.filter((p) => p.ativo).length}</b> pratos com ficha cadastrada
          {/* Os dois números se movem por caminhos diferentes, e confundir
              isso faz a pessoa clicar em Importar esperando o primeiro
              subir. Ele nunca sobe por aí. */}
          <div style={{ fontSize: 10.5, marginTop: 3, lineHeight: 1.5 }}>
            <b>Importar pratos</b> mexe no segundo número (traz do CardápioWeb o que foi vendido
            e não estava no cadastro). O primeiro só sobe preenchendo ficha.
          </div>
          {escondidos > 0 && (
            <button onClick={() => setVerEscondidos((v) => !v)} style={{ ...linkBtn, fontSize: 12, marginLeft: 8 }}>
              {verEscondidos ? "esconder os fora do cardápio" : `ver ${escondidos} fora do cardápio`}
            </button>
          )}
        </div>
        <button onClick={importarPratos} disabled={importando} style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6 }}>
          {importando ? <Loader2 size={14} /> : <RefreshCw size={14} />}
          Importar pratos
        </button>
      </div>

      {/* O que a importação fez. Sem isto, clicar e não ver mudança é
          indistinguível de o botão estar quebrado — e foi assim que ele
          pareceu quebrado por dias. */}
      {resumoImport && (
        <div style={{ ...cardStyle, marginBottom: 10, padding: "11px 14px",
                      background: resumoImport.criados > 0 ? "#EDF7F2" : "#FBF3D9",
                      border: `1px solid ${resumoImport.criados > 0 ? "#B6DDCC" : "#E8D48A"}`,
                      color: resumoImport.criados > 0 ? "#14503F" : "#7A6A1E" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.6, flex: 1, minWidth: 220 }}>
              <b>
                {resumoImport.criados > 0
                  ? `${resumoImport.criados} prato(s) novo(s) no cadastro.`
                  : "Nenhum prato novo — o cadastro já tinha todos."}
              </b>{" "}
              Achei <b>{resumoImport.encontrados}</b> itens com código do CardápioWeb nos últimos
              90 dias ({resumoImport.pedidos} pedidos): {resumoImport.criadosComCodigo} criados,{" "}
              {resumoImport.atualizados} que já existiam e receberam o código.
              {resumoImport.semCodigoEncontrados > 0 && (
                <div style={{ marginTop: 6 }}>
                  E mais <b>{resumoImport.semCodigoEncontrados}</b> itens que o CardápioWeb manda{" "}
                  <b>sem código nenhum</b> — só com o nome:{" "}
                  {resumoImport.semCodigoJaExistiam} já têm dono no seu cadastro,{" "}
                  <b>{resumoImport.semDonoTotal}</b> ainda não.
                </div>
              )}
              {resumoImport.semDonoTotal > 0 && (
                <div style={{ marginTop: 6 }}>
                  Esses {resumoImport.semDonoTotal} <b>não viram prato sozinhos</b> — era isso que
                  criava prato irmão. Quem diz qual prato é você, no Dashboard, na lista “Sem linha
                  definida”: cada um tem um seletor “É qual prato meu?”.
                  {resumoImport.semDono.length > 0 && (
                    <div style={{ marginTop: 4, opacity: 0.85 }}>
                      {resumoImport.semDono.slice(0, 20).map((d) => d.nome).join(" · ")}
                    </div>
                  )}
                </div>
              )}
              {resumoImport.criados === 0 && resumoImport.semCodigoEncontrados === 0 && (
                <div style={{ marginTop: 6 }}>
                  Se ainda tem produto aparecendo como “fora do cadastro” no Dashboard, ele
                  provavelmente <b>não foi vendido nos últimos 90 dias</b> — ou o nome dele
                  bate com dois pratos diferentes aqui. Me diga qual é que eu vejo.
                </div>
              )}
            </div>
            <button onClick={() => setResumoImport(null)} style={{ ...linkBtn, fontSize: 11 }}>fechar</button>
          </div>

          {resumoImport.nomesCriados.length > 0 && (
            <div style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.6 }}>
              <b>Criados:</b> {resumoImport.nomesCriados.join(" · ")}
              <div style={{ marginTop: 4, opacity: 0.85 }}>
                Eles entram <b>sem ficha e sem linha</b> — apareceram agora nos filtros aqui de cima.
              </div>
            </div>
          )}

          {resumoImport.nomesAmbiguos.length > 0 && (
            <div style={{ fontSize: 11.5, marginTop: 8, lineHeight: 1.6 }}>
              <b>Atenção — nome repetido no cadastro:</b> {resumoImport.nomesAmbiguos.join(" · ")}.
              Existe mais de um prato com esse nome aqui, então não dava pra escolher sozinho qual
              recebe o código — entraram como pratos novos. Vale apagar a duplicata.
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------
          Pratos irmãos

          Dois cadastros pro mesmo produto de verdade. Nasceram do
          Importar automático, que criava prato com o nome que o
          CardápioWeb mandava — e "Coca Cola Zero 350 Ml" é um nome
          diferente de "Coca Cola Zero" pra qualquer regra de casamento,
          mesmo sendo o mesmo refrigerante na geladeira.

          Não é bagunça de tela. Enquanto os dois viverem, a venda vai
          num e a ficha fica no outro: o CMV conta metade do custo e a
          margem aparece melhor do que ela é.

          A lista aqui é SUSPEITA, não sentença — "Suco 300ml" e
          "Sucos 300ml" podem ser dois produtos de verdade. Por isso vem
          com venda e ficha dos dois lados: é olhando isso que se decide
          qual fica. Quem decide é você; o sistema só junta.
          --------------------------------------------------------------- */}
      {irmaos && irmaos.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 10, padding: "11px 14px",
                      background: "#FDF6EC", border: "1px solid #E8D48A" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.6, flex: 1, minWidth: 220, color: "#7A6A1E" }}>
              <b>{irmaos.length} par{irmaos.length === 1 ? "" : "es"} de prato com nome parecido.</b>{" "}
              Se for o mesmo produto, a venda está indo num e a ficha ficou no outro — e o custo
              some da conta.
            </div>
            <button onClick={() => setVerIrmaos((v) => !v)} style={{ ...linkBtn, fontSize: 12 }}>
              {verIrmaos ? "esconder" : "revisar"}
            </button>
          </div>

          {verIrmaos && irmaos.map((par) => (
            <div key={par.a_id + par.b_id}
                 style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #EFE2C0",
                          display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-start" }}>
              {[
                { id: par.a_id, nome: par.a_nome, cod: par.a_codigo, linha: par.a_linha, ins: par.a_insumos, vend: par.a_vendas, outro: par.b_id },
                { id: par.b_id, nome: par.b_nome, cod: par.b_codigo, linha: par.b_linha, ins: par.b_insumos, vend: par.b_vendas, outro: par.a_id },
              ].map((lado) => (
                <div key={lado.id} style={{ flex: 1, minWidth: 210, background: "#FFFFFF",
                                            border: "1px solid #E8E2D2", borderRadius: 10, padding: "9px 11px" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>{lado.nome}</div>
                  <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 2, lineHeight: 1.5 }}>
                    {lado.linha} · {lado.ins} {lado.ins === 1 ? "insumo" : "insumos"} na ficha
                    {lado.cod ? ` · código ${lado.cod}` : " · sem código"}
                    <br />
                    vendeu {brl(Number(lado.vend) || 0)} em 90 dias
                  </div>
                  <button onClick={() => juntar(par, lado.id, lado.outro)}
                          disabled={juntando === par.a_id + par.b_id}
                          style={{ marginTop: 7, background: "#22231F", color: "#F3EFE3", border: "none",
                                   borderRadius: 7, padding: "6px 10px", fontSize: 11, fontWeight: 700,
                                   cursor: "pointer", fontFamily: "inherit" }}>
                    {juntando === par.a_id + par.b_id ? "juntando…" : "Este fica"}
                  </button>
                </div>
              ))}
            </div>
          ))}

          {verIrmaos && (
            <div style={{ fontSize: 10.5, color: "#7A6A1E", marginTop: 9, lineHeight: 1.6 }}>
              <b>“Este fica”</b> leva pro escolhido a ficha, o código e o histórico do outro, e
              transforma o nome do outro em apelido — a venda antiga continua achando dono, nada é
              perdido. O prato que sai fica escondido, não apagado. Se os dois forem produtos
              diferentes de verdade, é só não mexer.
            </div>
          )}
        </div>
      )}

      {/* preços vindos do CardápioWeb */}
      <div style={{ ...cardStyle, marginBottom: 10, padding: "11px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>Preços do CardápioWeb</div>
            <div style={{ fontSize: 11, color: "#8A8778", marginTop: 2 }}>
              {conferindo ? "conferindo o catálogo…"
                : lidoEm ? `conferidos ${horaCurta(lidoEm)}${resultado ? ` · ${resultado.total} itens no cardápio` : ""}`
                : "ainda não conferidos nesta máquina"}
            </div>
          </div>
          <button onClick={() => conferirPrecos(pratos)} disabled={conferindo || aplicando}
            style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6 }}>
            {conferindo ? <Loader2 size={14} /> : <RefreshCw size={14} />} Atualizar preços
          </button>
        </div>
        {avisoPreco && (
          <div style={{ fontSize: 12, color: "#A32D2D", marginTop: 8 }}>{avisoPreco}</div>
        )}
        {resultado && !conferindo && (
          <div style={{ marginTop: 10, borderTop: "1px solid #F0EBDD", paddingTop: 10 }}>
            {resultado.mudam.length === 0 ? (
              <div style={{ fontSize: 12.5, color: "#0F6E56", display: "flex", alignItems: "center", gap: 6 }}>
                <Check size={14} /> Todos os preços batem com o cardápio
                {resultado.semPar.length > 0 && (
                  <span style={{ color: "#8A8778" }}>· {resultado.semPar.length} sem par</span>
                )}
              </div>
            ) : (
              <>
                <div style={{ border: "1px solid #E8E2D2", borderRadius: 10, overflow: "hidden", background: "#FFFFFF" }}>
                  {resultado.mudam.map((d, idx) => (
                    <div key={d.prato.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", flexWrap: "wrap" }}>
                      <div style={{ flex: 1, minWidth: 160 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600 }}>{d.prato.nome}</div>
                        <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 1 }}>
                          no CardápioWeb: <b>{d.item.nome}</b>
                          {d.item.promocao_ativa ? ` · promoção ativa (cheio ${brl(d.item.preco)})` : ""}
                        </div>
                      </div>
                      <div style={{ fontSize: 12.5, whiteSpace: "nowrap" }}>
                        <span style={{ color: "#8A8778", textDecoration: "line-through" }}>{brl(d.de)}</span>
                        {" → "}
                        <strong style={{ color: "#0F6E56" }}>{brl(d.para)}</strong>
                      </div>
                      <span style={{ ...pill, fontSize: 9.5, background: d.viaNome ? "#FAEEDC" : "#EAF1F7", color: d.viaNome ? "#8A6220" : "#3A6684" }}>
                        {d.viaNome ? "pelo nome" : "pelo código"}
                      </span>
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: "#8A8778" }}>
                    {resultado.mudam.length} {resultado.mudam.length === 1 ? "preço muda" : "preços mudam"}
                    {resultado.semPar.length > 0 ? ` · ${resultado.semPar.length} sem par no cardápio` : ""}
                    {resultado.jaCertos > 0 ? ` · ${resultado.jaCertos} já estavam certos` : ""}
                  </span>
                  <button onClick={aplicarPrecos} disabled={aplicando}
                    style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 6 }}>
                    {aplicando ? <Loader2 size={14} /> : <Check size={14} />}
                    Aplicar {resultado.mudam.length === 1 ? "o preço" : `os ${resultado.mudam.length} preços`}
                  </button>
                </div>
              </>
            )}
            {resultado.semPar.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontSize: 11, color: "#8A8778", cursor: "pointer" }}>
                  ver os {resultado.semPar.length} pratos sem par no cardápio
                </summary>
                <div style={{ marginTop: 6 }}>
                  {resultado.semPar.map((sp) => (
                    <div key={sp.prato.id} style={{ fontSize: 11, color: "#8A8778", padding: "3px 0" }}>
                      <b style={{ color: "#22231F" }}>{sp.prato.nome}</b> — {sp.motivo} · preço mantido em {brl(sp.prato.preco_venda)}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
        <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 8, lineHeight: 1.5 }}>
          O preço de venda mora no CardápioWeb — aqui ele só chega. O painel nunca escreve preço lá.
          Item em promoção entra pelo preço da promoção, que é o que o cliente paga.
        </div>
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
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
            <Search size={15} color="#8A8778" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar prato…"
              style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px 9px 34px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF" }} />
          </div>
          {/* Contador que zera some: chip escrito "(0)" só ocupa espaço. */}
          {[
            { chave: "todos", rotulo: "Todos", quantos: null },
            { chave: "sem_linha", rotulo: "Sem linha", quantos: semLinha },
            { chave: "sem_ficha", rotulo: "Sem ficha", quantos: semFicha },
          ].filter((c) => c.quantos === null || c.quantos > 0).map((c) => (
            <button key={c.chave} onClick={() => setFiltro(c.chave)}
              style={{
                border: "1px solid #E8E2D2", borderRadius: 999, padding: "8px 13px", fontSize: 11.5,
                fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
                background: filtro === c.chave ? "#22231F" : "#FFFFFF",
                color: filtro === c.chave ? "#F3EFE3" : "#8A8778",
                borderColor: filtro === c.chave ? "#22231F" : "#E8E2D2",
              }}>
              {c.rotulo}{c.quantos != null ? ` (${c.quantos})` : ""}
            </button>
          ))}
        </div>
      )}

      {filtro !== "todos" && visiveis.length === 0 && (
        <div style={{ ...cardStyle, textAlign: "center", color: "#0F6E56", fontSize: 13, marginBottom: 14 }}>
          Nenhum prato nesse filtro — está tudo preenchido.
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
                  <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    {!p.ativo ? (
                      <span style={{ ...pill, background: "#F1EEE4", color: "#7A745E" }}>escondido</span>
                    ) : p.custoZerado ? (
                      <span style={{ ...pill, background: "#F0999522", color: "#A32D2D" }}>Custo pendente</span>
                    ) : p.temFicha ? (
                      <span style={{ ...pill, background: abaixo ? "#F0999522" : "#2F8F5B22", color: abaixo ? "#A32D2D" : "#0F6E56" }}>
                        {p.margemPct.toFixed(1)}%
                      </span>
                    ) : (
                      <span style={{ ...pill, background: "#F0999522", color: "#A32D2D" }}>Sem ficha</span>
                    )}
                  </span>
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

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 4 }}>
                  {!p.ativo && (
                    <button onClick={async () => {
                      await supabase.from("pratos").update({ ativo: true }).eq("id", p.id);
                      carregarPratos();
                    }} style={{ ...ghostIconBtn, color: "#0F6E56" }} title="Voltar pro cardápio">
                      <RotateCcw size={14} />
                    </button>
                  )}
                  <button onClick={() => setExcluindo(excluindo?.id === p.id ? null : p)}
                    style={{ ...ghostIconBtn, color: "#C4432B" }} title="Excluir ou esconder">
                    <Trash2 size={14} />
                  </button>
                </div>

                {excluindo?.id === p.id && (
                  <ExcluirPrato
                    prato={p}
                    onFechar={() => setExcluindo(null)}
                    onPronto={() => { setExcluindo(null); carregarPratos(); }}
                    onErro={setErro}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Excluir ou esconder um prato
//
// Apagar prato que JÁ VENDEU não apaga as vendas — elas vêm do CardápioWeb e
// continuam no faturamento. O que se perde é o fio que liga a venda ao
// cadastro: aquelas vendas viram "Item não identificado" no Dashboard e na
// Curva ABC, e o CMV perde a ficha. O lucro do mês passa a aparecer MAIOR do
// que foi.
//
// Por isso a lixeira pergunta antes se vendeu, e só oferece "excluir de vez"
// como opção secundária pra quem já vendeu.
// ---------------------------------------------------------------------------
function ExcluirPrato({ prato, onFechar, onPronto, onErro }) {
  const [vendas, setVendas] = useState(null); // { vendas, valor }
  const [ingredientes, setIngredientes] = useState(null);
  const [trabalhando, setTrabalhando] = useState(false);
  const [erroLocal, setErroLocal] = useState("");

  useEffect(() => {
    (async () => {
      const [rV, rI] = await Promise.all([
        supabase.rpc("vendas_do_prato", { p_prato: prato.id, p_dias: 90 }),
        supabase.from("prato_insumos").select("insumo_id").eq("prato_id", prato.id),
      ]);
      if (rV.error) {
        setVendas(/does not exist|schema cache/i.test(rV.error.message) ? "faltaSql" : { vendas: 0, valor: 0 });
      } else {
        setVendas(rV.data?.[0] || { vendas: 0, valor: 0 });
      }
      setIngredientes((rI.data || []).length);
    })();
  }, [prato.id]);

  const esconder = async () => {
    setTrabalhando(true);
    const { error } = await supabase.from("pratos").update({ ativo: false }).eq("id", prato.id);
    setTrabalhando(false);
    if (error) {
      setErroLocal(/ativo|column/i.test(error.message)
        ? "Falta rodar a migração 087 no banco — é ela que cria o 'escondido'."
        : error.message);
      return;
    }
    onPronto();
  };

  const excluir = async () => {
    setTrabalhando(true);
    const { error } = await supabase.rpc("excluir_prato", { p_prato: prato.id });
    setTrabalhando(false);
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) {
        onErro("A exclusão de pratos ainda não foi instalada no banco — falta rodar a migração 087.");
        onFechar();
        return;
      }
      setErroLocal(error.message);
      return;
    }
    onPronto();
  };

  if (vendas === null) {
    return <div style={{ width: "100%", fontSize: 12, color: "#8A8778", padding: "8px 2px" }}>Vendo se esse prato já vendeu…</div>;
  }

  const faltaSql = vendas === "faltaSql";
  const jaVendeu = !faltaSql && Number(vendas.vendas) > 0;

  return (
    <div style={{ width: "100%", background: "#FFFFFF", border: "1px solid #C98F87", borderRadius: 11, padding: 13, marginTop: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 9 }}>Excluir "{prato.nome}"?</div>

      <div style={{ background: "#FCFAF3", border: "1px solid #F0EBDD", borderRadius: 9, padding: "10px 12px", marginBottom: 11, fontSize: 12.5, lineHeight: 1.6 }}>
        <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase", color: "#8A8778", marginBottom: 6 }}>
          O que esse prato tem hoje
        </div>
        {ingredientes > 0
          ? <>Ficha técnica com <strong>{ingredientes} ingrediente{ingredientes > 1 ? "s" : ""}</strong>.<br /></>
          : <>Sem ficha técnica.<br /></>}
        {faltaSql
          ? <span style={{ color: "#7A6A1E" }}>Não consegui checar as vendas — falta rodar a migração 087.</span>
          : jaVendeu
            ? <><strong>{Number(vendas.vendas).toLocaleString("pt-BR")} venda{Number(vendas.vendas) > 1 ? "s" : ""}</strong> nos últimos 90 dias, somando <strong>{brl(vendas.valor)}</strong>.</>
            : <><strong>Nenhuma venda</strong> nos últimos 90 dias.</>}
      </div>

      {jaVendeu && (
        <div style={{ background: "#FCEBEB", border: "1px solid #E5B9B3", color: "#7A2020", borderRadius: 9, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.55, marginBottom: 11 }}>
          <strong style={{ color: "#5E1616" }}>Excluir apaga o nome, não as vendas.</strong> Aquelas vendas continuam
          no faturamento, mas passam a aparecer como <strong>"Item não identificado"</strong> no Dashboard e na
          Curva ABC. E o CMV do DRE perde a ficha desse prato — os ingredientes que ele consumiu deixam de ser contados,
          e o lucro do mês aparece maior do que foi.
        </div>
      )}

      {erroLocal && <div style={{ fontSize: 12, color: "#A32D2D", marginBottom: 9 }}>{erroLocal}</div>}

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {jaVendeu && (
          <button onClick={esconder} disabled={trabalhando}
            style={{ ...btnSecondary, background: "#22231F", color: "#F3EFE3", borderColor: "#22231F", display: "flex", alignItems: "center", gap: 6 }}>
            <EyeOff size={14} /> Esconder da lista
          </button>
        )}
        <button onClick={excluir} disabled={trabalhando}
          style={{ ...btnSecondary, background: "#7A2020", color: "#FFFFFF", borderColor: "#7A2020" }}>
          {trabalhando ? "…" : jaVendeu ? "Excluir mesmo assim" : "Excluir de vez"}
        </button>
        <button onClick={onFechar} style={btnSecondary}>Cancelar</button>
      </div>

      <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 8, lineHeight: 1.5 }}>
        {jaVendeu
          ? <><strong>Esconder</strong> tira da lista mas mantém o vínculo com as vendas e a ficha para o CMV — é o que serve pra produto que saiu do cardápio. Importar pratos não traz um escondido de volta.</>
          : <>Como nunca vendeu, nada em relatório nenhum aponta pra ele. Se o produto ainda existe no CardápioWeb, ele volta na próxima importação.</>}
      </div>
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
// Copiar a ficha de um prato para outro — e de um para vários.
//
// Dentro de uma linha, o grosso da receita se repete: muda o tamanho do
// hambúrguer, o bacon a mais, o cheddar dobrado. Digitar isso 14 vezes é
// o que faz ninguém preencher ficha técnica.
//
// Duas regras que valem repetir aqui, porque são as que evitam estrago:
//   1. Prato de REVENDA não serve de origem. Revenda tem um insumo só —
//      ele mesmo — e copiar isso põe o produto errado dentro da receita
//      alheia, calado.
//   2. Prato que JÁ TEM ficha nunca vem marcado. Apagar ficha boa em
//      massa é o erro caro desta tela.
function CopiarFicha({ prato, onFechar, onCopiado }) {
  const [modo, setModo] = useState("de"); // "de" = trazer de outro · "para" = aplicar em vários
  const [candidatos, setCandidatos] = useState(null);
  const [busca, setBusca] = useState("");
  const [origem, setOrigem] = useState(null);   // prato escolhido no modo "de"
  const [itensOrigem, setItensOrigem] = useState([]);
  const [marcados, setMarcados] = useState({}); // modo "para"
  const [temFichaAqui, setTemFichaAqui] = useState(0);
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState("");

  // Carrega todos os pratos com a contagem de ingredientes e o custo —
  // é o que diz se a ficha de origem presta. Copiar de uma ficha ruim
  // só espalha o problema.
  const carregar = useCallback(async () => {
    const [{ data: ps }, { data: itens }, { data: meus }] = await Promise.all([
      supabase.from("pratos").select("id, nome, preco_venda, linha_produto, revenda, ativo"),
      supabase.from("prato_insumos").select("prato_id, quantidade, insumo:insumos(custo_medio_atual)"),
      supabase.from("prato_insumos").select("prato_id").eq("prato_id", prato.id),
    ]);
    const porPrato = {};
    (itens || []).forEach((it) => {
      const c = (it.quantidade || 0) * (it.insumo?.custo_medio_atual || 0);
      porPrato[it.prato_id] = porPrato[it.prato_id] || { n: 0, custo: 0 };
      porPrato[it.prato_id].n += 1;
      porPrato[it.prato_id].custo += c;
    });
    setTemFichaAqui((meus || []).length);
    setCandidatos((ps || [])
      .filter((p) => p.id !== prato.id)
      .map((p) => ({ ...p, n: porPrato[p.id]?.n || 0, custo: porPrato[p.id]?.custo || 0 })));
  }, [prato.id]);

  useEffect(() => { carregar(); }, [carregar]);

  const escolherOrigem = async (p) => {
    setErro("");
    const { data } = await supabase.from("prato_insumos")
      .select("insumo_id, quantidade, insumo:insumos(nome, unidade, custo_medio_atual)")
      .eq("prato_id", p.id);
    setOrigem(p);
    setItensOrigem((data || []).map((it) => ({
      insumo_id: it.insumo_id,
      nome: it.insumo?.nome || "(insumo apagado)",
      unidade: it.insumo?.unidade || "un",
      quantidade: Number(it.quantidade) || 0,
      custo: (Number(it.quantidade) || 0) * (it.insumo?.custo_medio_atual || 0),
    })));
  };

  const custoOrigem = itensOrigem.reduce((t, i) => t + i.custo, 0);

  // Grava a ficha de `itens` num prato. `juntar` mantém o que já existe;
  // insumo repetido não duplica — fica a quantidade da origem, que foi a
  // que a pessoa escolheu trazer.
  const gravarEm = async (pratoId, itens, juntar) => {
    if (!juntar) {
      await supabase.from("prato_insumos").delete().eq("prato_id", pratoId);
    } else {
      const ids = itens.map((i) => i.insumo_id);
      if (ids.length > 0) {
        await supabase.from("prato_insumos").delete().eq("prato_id", pratoId).in("insumo_id", ids);
      }
    }
    if (itens.length === 0) return null;
    const { error } = await supabase.from("prato_insumos").insert(
      itens.map((i) => ({ prato_id: pratoId, insumo_id: i.insumo_id, quantidade: i.quantidade }))
    );
    return error;
  };

  const copiarPraCa = async (juntar) => {
    setAplicando(true);
    setErro("");
    const erroG = await gravarEm(prato.id, itensOrigem, juntar);
    setAplicando(false);
    if (erroG) { setErro(erroG.message); return; }
    onCopiado();
  };

  const aplicarEmVarios = async () => {
    const alvos = candidatos.filter((c) => marcados[c.id]);
    if (alvos.length === 0) { setErro("Marque pelo menos um prato."); return; }
    const comFicha = alvos.filter((c) => c.n > 0);
    if (comFicha.length > 0 && !window.confirm(
      `${comFicha.length} dos pratos marcados já têm ficha:\n\n` +
      comFicha.map((c) => `• ${c.nome} (${c.n} ingredientes)`).join("\n") +
      "\n\nA ficha atual deles será SUBSTITUÍDA. Confirma?"
    )) return;
    setAplicando(true);
    setErro("");
    const meus = itensOrigem.length > 0 ? itensOrigem : await (async () => {
      const { data } = await supabase.from("prato_insumos")
        .select("insumo_id, quantidade").eq("prato_id", prato.id);
      return (data || []).map((i) => ({ insumo_id: i.insumo_id, quantidade: Number(i.quantidade) || 0 }));
    })();
    let quantos = 0;
    for (const alvo of alvos) {
      const erroG = await gravarEm(alvo.id, meus, false);
      if (erroG) { setAplicando(false); setErro(`${alvo.nome}: ${erroG.message}`); return; }
      quantos += 1;
    }
    setAplicando(false);
    setFeito(`Ficha aplicada em ${quantos} prato${quantos === 1 ? "" : "s"}. Agora ajuste o que muda em cada um.`);
    carregar();
  };

  if (candidatos === null) {
    return <div style={{ ...cardStyle, fontSize: 13, color: "#8A8778", marginBottom: 12 }}>Carregando os pratos…</div>;
  }

  const daMesmaLinha = (p) => p.linha_produto && prato.linha_produto && p.linha_produto === prato.linha_produto;
  const listaDe = candidatos
    .filter((p) => p.n > 0 && !p.revenda)
    .filter((p) => semAcento(p.nome).includes(semAcento(busca)))
    .sort((a, b) => (daMesmaLinha(b) ? 1 : 0) - (daMesmaLinha(a) ? 1 : 0) || porNome(a, b))
    .slice(0, 12);
  const listaPara = candidatos
    .filter((p) => p.ativo !== false && !p.revenda)
    .filter((p) => (prato.linha_produto ? p.linha_produto === prato.linha_produto : true))
    .sort(porNome);
  const marcadosN = listaPara.filter((p) => marcados[p.id]).length;

  return (
    <div style={{ ...cardStyle, marginBottom: 12, borderColor: "#C9BEE8", background: "#FBFAFE" }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {[
          { chave: "de", rotulo: "Trazer de outro prato" },
          { chave: "para", rotulo: "Usar esta ficha em vários" },
        ].map((op) => (
          <button key={op.chave} onClick={() => { setModo(op.chave); setErro(""); setFeito(""); }}
            style={{
              border: "1px solid #E8E2D2", borderRadius: 999, padding: "7px 13px", fontSize: 11.5,
              fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              background: modo === op.chave ? "#22231F" : "#FFFFFF",
              color: modo === op.chave ? "#F3EFE3" : "#8A8778",
              borderColor: modo === op.chave ? "#22231F" : "#E8E2D2",
            }}>
            {op.rotulo}
          </button>
        ))}
        <button onClick={onFechar} style={{ ...linkBtn, fontSize: 11.5, marginLeft: "auto" }}>fechar</button>
      </div>

      {erro && <div style={{ ...avisoStyle, marginBottom: 10 }}><AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 12.5 }}>{erro}</div></div>}
      {feito && (
        <div style={{ background: "#EAF3DE", border: "1px solid #C4DBA6", borderRadius: 9, padding: "9px 11px",
                      fontSize: 12, color: "#27500A", marginBottom: 10, lineHeight: 1.55 }}>
          {feito}
        </div>
      )}

      {modo === "de" && !origem && (
        <>
          <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 7 }}>Copiar a ficha de qual prato?</div>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar prato…"
            style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 9,
                     border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF", fontFamily: "inherit" }} />
          <div style={{ border: "1px solid #E8E2D2", borderRadius: 10, background: "#FFFFFF", marginTop: 7, overflow: "hidden" }}>
            {listaDe.map((p, idx) => (
              <button key={p.id} onClick={() => escolherOrigem(p)}
                style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none",
                         padding: "9px 12px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", cursor: "pointer", fontFamily: "inherit" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "#22231F" }}>{p.nome}</div>
                <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 1 }}>
                  {p.n} ingrediente{p.n === 1 ? "" : "s"} · custo {brl(p.custo)}
                  {daMesmaLinha(p) ? ` · mesma linha (${p.linha_produto})` : ""}
                </div>
              </button>
            ))}
            {listaDe.length === 0 && (
              <div style={{ padding: 12, fontSize: 12.5, color: "#8A8778" }}>
                Nenhum prato com ficha encontrado. Prato de revenda não entra: a ficha dele é ele mesmo.
              </div>
            )}
          </div>
        </>
      )}

      {modo === "de" && origem && (
        <>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>
            Do <b>{origem.nome}</b> viriam {itensOrigem.length} ingrediente{itensOrigem.length === 1 ? "" : "s"}:
          </div>
          <div style={{ border: "1px solid #E8E2D2", borderRadius: 10, background: "#FFFFFF", marginTop: 7, overflow: "hidden" }}>
            <div style={{ padding: "8px 12px", background: "#F6F1E7", borderBottom: "1px solid #E8E2D2", fontSize: 11.5, fontWeight: 800 }}>
              custo total {brl(custoOrigem)}
            </div>
            {itensOrigem.map((i, idx) => {
              const dig = paraDigitada(i.quantidade, i.unidade);
              return (
                <div key={i.insumo_id} style={{ display: "flex", justifyContent: "space-between", gap: 10,
                                                padding: "8px 12px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", fontSize: 12.5 }}>
                  <span>{i.nome}</span>
                  <span style={{ color: "#8A8778", whiteSpace: "nowrap" }}>
                    {String(dig.valor).replace(".", ",")} {dig.unidade} · {brl(i.custo)}
                  </span>
                </div>
              );
            })}
          </div>
          {temFichaAqui > 0 && (
            <div style={{ border: "1px solid #E8D48A", background: "#FBF3D9", borderRadius: 9, padding: "9px 11px",
                          marginTop: 9, fontSize: 11.5, color: "#7A6A1E", lineHeight: 1.6 }}>
              <b style={{ color: "#5E5216" }}>Este prato já tem {temFichaAqui} ingrediente{temFichaAqui === 1 ? "" : "s"}.</b>{" "}
              Substituir apaga os atuais. Somar mantém os dois — e insumo repetido não duplica, fica com a
              quantidade do prato de origem.
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
            <button onClick={() => copiarPraCa(false)} disabled={aplicando} style={{ ...btnPrimary, padding: "9px 14px", fontSize: 12.5 }}>
              {aplicando ? "..." : temFichaAqui > 0 ? "Substituir tudo" : `Copiar ${itensOrigem.length}`}
            </button>
            {temFichaAqui > 0 && (
              <button onClick={() => copiarPraCa(true)} disabled={aplicando} style={{ ...btnSecondary, fontSize: 12.5 }}>
                Somar aos que já existem
              </button>
            )}
            <button onClick={() => { setOrigem(null); setItensOrigem([]); }} style={{ ...linkBtn, fontSize: 11.5 }}>
              escolher outro
            </button>
          </div>
        </>
      )}

      {modo === "para" && (
        <>
          <div style={{ fontSize: 12.5, fontWeight: 700 }}>
            Usar a ficha do <b>{prato.nome}</b> como base em:
          </div>
          <div style={{ fontSize: 11, color: "#8A8778", margin: "3px 0 9px", lineHeight: 1.55 }}>
            {prato.linha_produto ? `${prato.linha_produto} · ` : "Todos os pratos · "}
            {listaPara.length} pratos · os que já têm ficha vêm desmarcados
          </div>
          {temFichaAqui === 0 && (
            <div style={{ ...avisoStyle, marginBottom: 10 }}>
              <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12.5 }}>Este prato ainda não tem ficha — não há o que aplicar nos outros.</div>
            </div>
          )}
          <div style={{ border: "1px solid #E8E2D2", borderRadius: 10, background: "#FFFFFF", overflow: "hidden" }}>
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 12px", background: "#F6F1E7",
                          borderBottom: "1px solid #E8E2D2", fontSize: 11.5 }}>
              <b>Marcados: {marcadosN}</b>
              <span>
                <button onClick={() => setMarcados(Object.fromEntries(listaPara.filter((p) => p.n === 0).map((p) => [p.id, true])))}
                  style={{ ...linkBtn, fontSize: 11 }}>marcar os sem ficha</button>
                <span style={{ color: "#D8D2C2" }}> · </span>
                <button onClick={() => setMarcados({})} style={{ ...linkBtn, fontSize: 11 }}>limpar</button>
              </span>
            </div>
            <div style={{ maxHeight: 320, overflowY: "auto" }}>
              {listaPara.map((p, idx) => (
                <label key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center",
                                           padding: "8px 12px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none",
                                           fontSize: 12.5, cursor: "pointer", color: p.n > 0 ? "#8A8778" : "#22231F" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <input type="checkbox" checked={!!marcados[p.id]}
                      onChange={(e) => setMarcados((m) => ({ ...m, [p.id]: e.target.checked }))} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.nome}</span>
                  </span>
                  <span style={{ color: "#8A8778", whiteSpace: "nowrap", fontSize: 11 }}>
                    {brl(p.preco_venda)}
                    {p.n > 0
                      ? <> · <b style={{ color: "#8A6A0F" }}>já tem {p.n} ingrediente{p.n === 1 ? "" : "s"}</b></>
                      : " · sem ficha"}
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
            <button onClick={aplicarEmVarios} disabled={aplicando || marcadosN === 0 || temFichaAqui === 0}
              style={{ ...btnPrimary, padding: "9px 14px", fontSize: 12.5,
                       opacity: (marcadosN === 0 || temFichaAqui === 0) ? 0.5 : 1 }}>
              {aplicando ? "aplicando…" : `Aplicar em ${marcadosN} prato${marcadosN === 1 ? "" : "s"}`}
            </button>
            <span style={{ fontSize: 10.5, color: "#8A8778" }}>
              O preço de cada prato aparece ao lado: a base serve, o ajuste é seu.
            </span>
          </div>
        </>
      )}
    </div>
  );
}

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
  const [copiarAberto, setCopiarAberto] = useState(false);

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

      {/* copiar ficha — some no modo revenda, onde não faz sentido */}
      {!revenda && (
        copiarAberto ? (
          <CopiarFicha
            prato={prato}
            onFechar={() => setCopiarAberto(false)}
            onCopiado={() => { setCopiarAberto(false); carregar(); }}
          />
        ) : (
          <button onClick={() => setCopiarAberto(true)}
            style={{ ...btnSecondary, width: "100%", marginBottom: 12, display: "flex",
                     alignItems: "center", justifyContent: "center", gap: 7 }}>
            <Copy size={15} /> Copiar ficha de outro prato · usar esta em vários
          </button>
        )
      )}

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
