import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft, AlertTriangle, Truck, SlidersHorizontal, Search, RefreshCw, Loader2, Pencil, Check, Trash2 } from "lucide-react";
import { supabase, extrairErroFuncao } from "../lib/supabaseClient";

function fmt(v, unidade) {
  const n = (v ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return `${n} ${unidade}`;
}
function fmtData(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR");
}
// Sexta, sábado e domingo contam como "fim de semana" pro cálculo de
// consumo — costumam vender mais que os outros dias.
function ehFimDeSemana(data) {
  const dia = data.getDay();
  return dia === 0 || dia === 5 || dia === 6;
}

const TIPO_LABEL = {
  compra: "Compra",
  ajuste: "Ajuste manual",
  perda: "Perda",
  contagem: "Contagem",
};
const TIPO_ICONE = { compra: Truck, ajuste: SlidersHorizontal, perda: AlertTriangle, contagem: SlidersHorizontal };
const UNIDADES = ["un", "g", "kg", "ml", "l"];
const FORMAS_PAGAMENTO_COMPRA = [
  { valor: "pix", rotulo: "Pix" },
  { valor: "debito", rotulo: "Débito" },
  { valor: "credito", rotulo: "Cartão de crédito" },
  { valor: "boleto", rotulo: "Boleto" },
];
function round2(n) { return Math.round((n || 0) * 100) / 100; }

export default function Estoque() {
  const [tela, setTela] = useState("lista"); // lista | extrato | compra_manual
  const [insumos, setInsumos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [insumoAtual, setInsumoAtual] = useState(null);
  const [busca, setBusca] = useState("");
  const [diasEstoque, setDiasEstoque] = useState("4");
  const [consumoPorInsumo, setConsumoPorInsumo] = useState({}); // insumo_id -> { mediaUtil, mediaFds }
  const [buscandoConsumo, setBuscandoConsumo] = useState(false);
  const [criandoInsumo, setCriandoInsumo] = useState(false);
  const [novoInsumo, setNovoInsumo] = useState({ nome: "", unidade: "un" });

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    const [{ data, error }, { data: configData }] = await Promise.all([
      supabase.from("insumos").select("*").order("nome"),
      supabase.from("configuracoes").select("valor").eq("chave", "dias_estoque_compras").maybeSingle(),
    ]);
    if (error) { setErro(error.message); setCarregando(false); return; }
    setInsumos(data || []);
    if (configData) setDiasEstoque(configData.valor);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const salvarDiasEstoque = async (valor) => {
    setDiasEstoque(valor);
    await supabase.from("configuracoes").upsert({ chave: "dias_estoque_compras", valor: String(valor) }, { onConflict: "chave" });
  };

  const criarInsumo = async () => {
    const nome = novoInsumo.nome.trim();
    if (!nome) return;
    const { error } = await supabase.from("insumos").insert({ nome, unidade: novoInsumo.unidade });
    if (error) { setErro(error.message); return; }
    setNovoInsumo({ nome: "", unidade: "un" });
    setCriandoInsumo(false);
    carregar();
  };

  // Calcula quanto foi consumido de cada insumo nos últimos 14 dias,
  // cruzando os pedidos fechados no CardápioWeb com a Ficha Técnica de
  // cada prato vendido — separa a média por dia útil da média por dia de
  // fim de semana, porque o consumo não é igual todo dia.
  const buscarConsumo = async () => {
    setBuscandoConsumo(true);
    setErro("");
    const hoje = new Date();
    const inicio = new Date(hoje);
    inicio.setDate(inicio.getDate() - 14);
    const { data, error } = await supabase.functions.invoke("cardapioweb-proxy", {
      body: {
        data_inicio: `${inicio.toISOString().slice(0, 10)}T00:00:00-03:00`,
        data_fim: `${hoje.toISOString().slice(0, 10)}T23:59:59-03:00`,
      },
    });
    if (error) { setErro(await extrairErroFuncao(error)); setBuscandoConsumo(false); return; }
    if (data?.error) { setErro(data.error); setBuscandoConsumo(false); return; }

    const [{ data: pratosData }, { data: composicaoData }] = await Promise.all([
      supabase.from("pratos").select("id, cardapioweb_item_id"),
      supabase.from("prato_insumos").select("prato_id, insumo_id, quantidade"),
    ]);
    const mapaPratoPorItemId = new Map((pratosData || []).filter((p) => p.cardapioweb_item_id != null).map((p) => [p.cardapioweb_item_id, p.id]));
    const composicaoPorPrato = {};
    (composicaoData || []).forEach((c) => {
      if (!composicaoPorPrato[c.prato_id]) composicaoPorPrato[c.prato_id] = [];
      composicaoPorPrato[c.prato_id].push(c);
    });

    const consumoUtil = {};
    const consumoFds = {};
    const diasUteis = new Set();
    const diasFds = new Set();

    for (const pedido of data.pedidos || []) {
      if (pedido.status !== "closed") continue;
      const dataPedido = new Date(pedido.created_at);
      const fds = ehFimDeSemana(dataPedido);
      const diaChave = String(pedido.created_at).slice(0, 10);
      (fds ? diasFds : diasUteis).add(diaChave);

      for (const item of pedido.items || []) {
        const pratoId = mapaPratoPorItemId.get(item.item_id);
        if (!pratoId) continue;
        for (const c of composicaoPorPrato[pratoId] || []) {
          const alvo = fds ? consumoFds : consumoUtil;
          alvo[c.insumo_id] = (alvo[c.insumo_id] || 0) + (item.quantity || 0) * (c.quantidade || 0);
        }
      }
    }

    const nUteis = diasUteis.size || 1;
    const nFds = diasFds.size || 1;
    const mapaConsumo = {};
    new Set([...Object.keys(consumoUtil), ...Object.keys(consumoFds)]).forEach((id) => {
      mapaConsumo[id] = { mediaUtil: (consumoUtil[id] || 0) / nUteis, mediaFds: (consumoFds[id] || 0) / nFds };
    });
    setConsumoPorInsumo(mapaConsumo);
    setBuscandoConsumo(false);
  };

  // Quantos dos próximos N dias (a partir de amanhã) caem em dia útil vs
  // fim de semana — usado pra ponderar a sugestão de compra certinha,
  // não só multiplicar por uma média simples.
  const proximosDias = (qtd) => {
    let uteis = 0, fds = 0;
    for (let i = 1; i <= qtd; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      (ehFimDeSemana(d) ? (fds++, null) : uteis++);
    }
    return { uteis, fds };
  };

  const sugestaoCompra = (insumoId, estoqueAtual) => {
    const c = consumoPorInsumo[insumoId];
    if (!c) return null;
    const dias = parseFloat(diasEstoque) || 0;
    const { uteis, fds } = proximosDias(dias);
    const necessidade = uteis * c.mediaUtil + fds * c.mediaFds;
    return Math.max(0, round2(necessidade - (estoqueAtual || 0)));
  };
  const consumoMedioDia = (insumoId) => {
    const c = consumoPorInsumo[insumoId];
    if (!c) return null;
    return round2((c.mediaUtil * 5 + c.mediaFds * 2) / 7);
  };

  if (tela === "extrato" && insumoAtual) {
    return <ExtratoInsumo insumo={insumoAtual} onVoltar={() => { setTela("lista"); setInsumoAtual(null); carregar(); }} />;
  }

  if (tela === "compra_manual") {
    return <CompraManual insumos={insumos} onVoltar={() => { setTela("lista"); carregar(); }} />;
  }

  return (
    <div>
      <div style={{ ...cardStyle, marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "#8A8778" }}>Cobrir estoque para quantos dias?</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <input type="number" min="1" value={diasEstoque} onChange={(e) => salvarDiasEstoque(e.target.value)}
            style={{ width: 50, padding: "5px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13, textAlign: "center" }} />
          <span style={{ fontSize: 12, color: "#8A8778" }}>dias</span>
        </div>
      </div>

      <button onClick={buscarConsumo} disabled={buscandoConsumo} style={{ ...btnSecondary, width: "100%", display: "flex", justifyContent: "center", gap: 6, marginBottom: 14 }}>
        {buscandoConsumo ? <Loader2 size={14} /> : <RefreshCw size={14} />}
        {Object.keys(consumoPorInsumo).length > 0 ? "Atualizar sugestão de compra" : "Calcular sugestão de compra (últimos 14 dias)"}
      </button>

      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}
      {insumos.length > 0 && (
        <div style={{ position: "relative", marginBottom: 14 }}>
          <Search size={15} color="#8A8778" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar insumo…"
            style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px 9px 34px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF" }} />
        </div>
      )}

      {criandoInsumo ? (
        <div style={{ ...cardStyle, border: "1px dashed #37A0E5", marginBottom: 14, display: "flex", gap: 8, alignItems: "center" }}>
          <input value={novoInsumo.nome} onChange={(e) => setNovoInsumo((f) => ({ ...f, nome: e.target.value }))} autoFocus
            onKeyDown={(e) => e.key === "Enter" && criarInsumo()}
            placeholder="Nome do insumo" style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13 }} />
          <select value={novoInsumo.unidade} onChange={(e) => setNovoInsumo((f) => ({ ...f, unidade: e.target.value }))}
            style={{ padding: "6px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF" }}>
            {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <button onClick={criarInsumo} style={{ ...btnSecondary, fontSize: 12, padding: "6px 12px" }}>Criar</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <button onClick={() => setCriandoInsumo(true)}
            style={{ flex: 1, boxSizing: "border-box", border: "1px dashed #37A0E5", borderRadius: 10, padding: "10px", background: "none", color: "#185FA5", fontSize: 13, cursor: "pointer" }}>
            + Novo insumo
          </button>
          <button onClick={() => setTela("compra_manual")}
            style={{ flex: 1, boxSizing: "border-box", border: "1px dashed #37A0E5", borderRadius: 10, padding: "10px", background: "none", color: "#185FA5", fontSize: 13, cursor: "pointer" }}>
            + Compra manual
          </button>
        </div>
      )}

      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <div className="list-grid">
          {insumos.filter((i) => i.nome.toLowerCase().includes(busca.toLowerCase())).map((i) => {
            const abaixoMinimo = i.estoque_minimo != null && i.estoque_atual < i.estoque_minimo;
            const sugestao = sugestaoCompra(i.id, i.estoque_atual);
            const consumoDia = consumoMedioDia(i.id);
            const precisaComprar = sugestao != null && sugestao > 0;
            return (
              <button key={i.id} onClick={() => { setInsumoAtual(i); setTela("extrato"); }}
                style={{ ...itemRow, cursor: "pointer", textAlign: "left", flexDirection: "column", alignItems: "stretch", gap: 4, border: precisaComprar ? "1px solid #F0999599" : abaixoMinimo ? "1px solid #F0D8CE" : "1px solid #E8E2D2" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
                  <span style={{ fontSize: 13, color: "#22231F" }}>{i.nome}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {precisaComprar && <span style={{ ...pill, background: "#F0999522", color: "#A32D2D" }}>comprar</span>}
                    {!precisaComprar && abaixoMinimo && <span style={pill}>abaixo do mínimo</span>}
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#22231F" }}>{fmt(i.estoque_atual, i.unidade)}</span>
                  </span>
                </div>
                {consumoDia != null && (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: 11, color: "#8A8778" }}>
                      <span>Consumo/dia: ~{fmt(consumoDia, i.unidade)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", width: "100%", fontSize: 12 }}>
                      <span style={{ color: "#8A8778" }}>Sugestão de compra</span>
                      <span style={{ fontWeight: 700, color: precisaComprar ? "#A32D2D" : "#22231F" }}>{fmt(sugestao, i.unidade)}</span>
                    </div>
                  </>
                )}
              </button>
            );
          })}
          {insumos.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Nenhum insumo cadastrado ainda.</div>}
        </div>
      )}
    </div>
  );
}


function ExtratoInsumo({ insumo, onVoltar }) {
  const [movimentos, setMovimentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [minimoForm, setMinimoForm] = useState(insumo.estoque_minimo ?? "");
  const [unidadeForm, setUnidadeForm] = useState(insumo.unidade);
  const [nomeForm, setNomeForm] = useState(insumo.nome);
  const [editandoNome, setEditandoNome] = useState(false);
  const [ajusteForm, setAjusteForm] = useState({ aberto: false, tipo: "ajuste", quantidade: "", motivo: "" });
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase
      .from("movimentacoes_estoque")
      .select("*")
      .eq("insumo_id", insumo.id)
      .order("criado_em", { ascending: false })
      .limit(50);
    if (error) setErro(error.message);
    setMovimentos(data || []);
    setCarregando(false);
  }, [insumo.id]);

  useEffect(() => { carregar(); }, [carregar]);

  const salvarMinimo = async () => {
    const { error } = await supabase.from("insumos").update({ estoque_minimo: minimoForm === "" ? null : parseFloat(minimoForm) }).eq("id", insumo.id);
    if (error) setErro(error.message);
  };

  const salvarUnidade = async (novaUnidade) => {
    setUnidadeForm(novaUnidade);
    const { error } = await supabase.from("insumos").update({ unidade: novaUnidade }).eq("id", insumo.id);
    if (error) setErro(error.message);
  };

  const salvarNome = async () => {
    const nome = nomeForm.trim();
    if (!nome) { setNomeForm(insumo.nome); setEditandoNome(false); return; }
    const { error } = await supabase.from("insumos").update({ nome }).eq("id", insumo.id);
    if (error) { setErro(error.message); return; }
    setEditandoNome(false);
  };

  const excluirInsumo = async () => {
    if (!window.confirm(`Excluir "${insumo.nome}"? Isso apaga o histórico de movimentações dele também — não dá pra desfazer.`)) return;
    const { error } = await supabase.from("insumos").delete().eq("id", insumo.id);
    if (error) {
      if (error.message.includes("violates foreign key constraint")) {
        setErro(`Não dá pra excluir "${insumo.nome}" — ele está sendo usado numa Ficha Técnica ou como parte de outro insumo composto. Remove ele de lá primeiro.`);
      } else {
        setErro(error.message);
      }
      return;
    }
    onVoltar();
  };

  const registrarAjuste = async () => {
    const qtd = parseFloat(ajusteForm.quantidade);
    if (!qtd) return;
    setSalvando(true);
    setErro("");
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from("movimentacoes_estoque").insert({
      insumo_id: insumo.id,
      tipo: ajusteForm.tipo,
      quantidade: ajusteForm.tipo === "perda" ? -Math.abs(qtd) : qtd,
      motivo: ajusteForm.motivo || null,
      criado_por: userData?.user?.id,
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    setAjusteForm({ aberto: false, tipo: "ajuste", quantidade: "", motivo: "" });
    carregar();
  };

  return (
    <div>
      <button onClick={onVoltar} style={{ ...linkBtn, display: "flex", alignItems: "center", gap: 4, marginBottom: 14 }}>
        <ChevronLeft size={14} /> Voltar ao estoque
      </button>

      <div style={{ ...cardStyle, textAlign: "center", marginBottom: 12 }}>
        {editandoNome ? (
          <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
            <input value={nomeForm} onChange={(e) => setNomeForm(e.target.value)} autoFocus
              onKeyDown={(e) => e.key === "Enter" && salvarNome()}
              style={{ fontSize: 14, padding: "4px 8px", borderRadius: 6, border: "1px solid #E8E2D2", textAlign: "center" }} />
            <button onClick={salvarNome} style={ghostIconBtn} aria-label="Salvar nome"><Check size={16} /></button>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6, alignItems: "center", justifyContent: "center", marginBottom: 6 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "#22231F" }}>{insumo.nome}</div>
            <button onClick={() => { setNomeForm(insumo.nome); setEditandoNome(true); }} style={ghostIconBtn} aria-label="Editar nome do insumo"><Pencil size={14} /></button>
          </div>
        )}
        <div style={{ fontSize: 11, color: "#8A8778" }}>Saldo atual</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#22231F" }}>{fmt(insumo.estoque_atual, unidadeForm)}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#8A8778" }}>Unidade</span>
            <select value={unidadeForm} onChange={(e) => salvarUnidade(e.target.value)}
              style={{ padding: "3px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, background: "#FFFFFF" }}>
              {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "#8A8778" }}>Estoque mínimo</span>
            <input type="number" value={minimoForm} onChange={(e) => setMinimoForm(e.target.value)} onBlur={salvarMinimo}
              placeholder="—" style={{ width: 60, padding: "3px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, textAlign: "center" }} />
            <span style={{ fontSize: 12, color: "#8A8778" }}>{unidadeForm}</span>
          </div>
        </div>
        <div style={{ fontSize: 10, color: "#8A8778", marginTop: 8 }}>Mudar a unidade não converte números já usados em Ficha Técnica — confira as receitas que usam esse insumo depois de mudar.</div>
        <button onClick={excluirInsumo} style={{ ...ghostIconBtn, color: "#C4432B", margin: "10px auto 0", display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
          <Trash2 size={13} /> Excluir insumo
        </button>
      </div>

      {!ajusteForm.aberto ? (
        <button onClick={() => setAjusteForm((f) => ({ ...f, aberto: true }))} style={{ ...btnSecondary, width: "100%", marginBottom: 16 }}>
          + Registrar ajuste manual
        </button>
      ) : (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <select value={ajusteForm.tipo} onChange={(e) => setAjusteForm((f) => ({ ...f, tipo: e.target.value }))}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13 }}>
              <option value="ajuste">Correção</option>
              <option value="perda">Perda (vencido, quebra...)</option>
              <option value="contagem">Contagem</option>
            </select>
            <input type="number" value={ajusteForm.quantidade} onChange={(e) => setAjusteForm((f) => ({ ...f, quantidade: e.target.value }))}
              placeholder={ajusteForm.tipo === "perda" ? "Quantidade perdida" : "Quantidade (+ ou −)"}
              style={{ flex: 1, minWidth: 100, padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13 }} />
          </div>
          <input value={ajusteForm.motivo} onChange={(e) => setAjusteForm((f) => ({ ...f, motivo: e.target.value }))}
            placeholder="Observação (opcional)" style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13, marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={registrarAjuste} disabled={salvando} style={{ ...btnSecondary, flex: 1 }}>Salvar</button>
            <button onClick={() => setAjusteForm({ aberto: false, tipo: "ajuste", quantidade: "", motivo: "" })} style={linkBtn}>Cancelar</button>
          </div>
        </div>
      )}

      {erro && <div style={{ color: "#C4432B", fontSize: 13, marginBottom: 12 }}>{erro}</div>}

      <div style={sectionLabel}>Movimentações</div>
      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          {movimentos.map((m) => {
            const Icone = TIPO_ICONE[m.tipo] || SlidersHorizontal;
            const positivo = m.quantidade >= 0;
            return (
              <div key={m.id} style={{ ...itemRow, cursor: "default" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <Icone size={15} color={positivo ? "#0F6E56" : "#791F1F"} style={{ flexShrink: 0 }} />
                  <span style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "#22231F" }}>
                      {TIPO_LABEL[m.tipo]}{m.fornecedor ? ` · ${m.fornecedor}` : ""}{m.motivo ? ` · ${m.motivo}` : ""}
                    </div>
                    <div style={{ fontSize: 11, color: "#8A8778" }}>{fmtData(m.criado_em)}</div>
                  </span>
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: positivo ? "#0F6E56" : "#791F1F", whiteSpace: "nowrap" }}>
                  {positivo ? "+" : ""}{fmt(m.quantidade, unidadeForm)}
                </span>
              </div>
            );
          })}
          {movimentos.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Nenhuma movimentação registrada ainda.</div>}
        </div>
      )}
    </div>
  );
}

const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const ghostIconBtn = { border: "none", background: "none", color: "#8A8778", cursor: "pointer", padding: 2, display: "flex" };
const itemRow = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "#FFFFFF", borderRadius: 10, padding: "12px 14px" };
const btnSecondary = { background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const linkBtn = { background: "none", border: "none", color: "#8A6A0F", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, textAlign: "left" };
const sectionLabel = { fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778", marginBottom: 8 };
const pill = { fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#F0999522", color: "#A32D2D" };
const avisoStyle = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 14 };
const inputStyle = { width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF" };
const btnPrimary = { background: "#22231F", color: "#F3EFE3", border: "none", borderRadius: 10, padding: "12px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer" };

// ---------------------------------------------------------------------------
// Compra manual — dá entrada de uma compra sem precisar de nota fiscal
// (foto/leitura por IA). Faz a mesma coisa que confirmar uma nota faz:
// grava a movimentação, atualiza o custo do insumo, e — se for boleto —
// gera a conta a pagar.
// ---------------------------------------------------------------------------
function CompraManual({ onVoltar }) {
  const [insumos, setInsumos] = useState([]);
  const [fornecedores, setFornecedores] = useState([]);
  const [itemNome, setItemNome] = useState("");
  const [itemUnidade, setItemUnidade] = useState("un");
  const [quantidade, setQuantidade] = useState("");
  const [valorUnitario, setValorUnitario] = useState("");
  const [calcPacotes, setCalcPacotes] = useState({ qtd: "", tamanho: "", unidade: "g" });
  const [formaPagamento, setFormaPagamento] = useState("pix");
  const [prazoBoleto, setPrazoBoleto] = useState("28");
  const [fornecedorNome, setFornecedorNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    supabase.from("insumos").select("id, nome, unidade, composto").order("nome").then(({ data }) => setInsumos(data || []));
    supabase.from("fornecedores").select("id, nome").order("nome").then(({ data }) => setFornecedores(data || []));
  }, []);

  const insumoSelecionado = insumos.find((i) => i.nome.toLowerCase() === itemNome.trim().toLowerCase());
  useEffect(() => {
    if (insumoSelecionado) setItemUnidade(insumoSelecionado.unidade);
  }, [insumoSelecionado?.id]);

  const aplicarCalculadoraPacotes = () => {
    const qtd = parseFloat(calcPacotes.qtd) || 0;
    const tamanho = parseFloat(calcPacotes.tamanho) || 0;
    setQuantidade(String(round2(qtd * tamanho)));
    setItemUnidade(calcPacotes.unidade);
  };

  const valorTotal = round2((parseFloat(quantidade) || 0) * (parseFloat(valorUnitario) || 0));

  const salvar = async () => {
    const nome = itemNome.trim();
    const fornecedor = fornecedorNome.trim();
    const qtd = parseFloat(quantidade) || 0;
    const preco = parseFloat(valorUnitario) || 0;
    if (!nome) { setErro("Informe o item comprado."); return; }
    if (!fornecedor) { setErro("Informe o fornecedor."); return; }
    if (qtd <= 0) { setErro("Informe a quantidade comprada."); return; }
    setSalvando(true);
    setErro("");
    const { data: userData } = await supabase.auth.getUser();

    // resolve o insumo — usa o já cadastrado (mesmo nome) ou cria um novo
    let insumo = insumoSelecionado;
    if (!insumo) {
      const { data, error } = await supabase.from("insumos").insert({ nome, unidade: itemUnidade }).select().single();
      if (error) { setErro(error.message); setSalvando(false); return; }
      insumo = data;
    }

    // resolve o fornecedor — mesmo padrão de Notas Fiscais
    let fornecedorObj = fornecedores.find((f) => f.nome.toLowerCase() === fornecedor.toLowerCase());
    if (!fornecedorObj) {
      const { data, error } = await supabase.from("fornecedores").insert({ nome: fornecedor }).select().single();
      if (error) { setErro(error.message); setSalvando(false); return; }
      fornecedorObj = data;
    }

    const { error: errMov } = await supabase.from("movimentacoes_estoque").insert({
      insumo_id: insumo.id, tipo: "compra", quantidade: qtd, preco_unitario: preco,
      fornecedor, forma_pagamento: formaPagamento, criado_por: userData?.user?.id,
    });
    if (errMov) { setErro(errMov.message); setSalvando(false); return; }

    if (!insumo.composto) {
      await supabase.from("insumos").update({ custo_medio_atual: preco, atualizado_em: new Date().toISOString() }).eq("id", insumo.id);
    }

    // só boleto vira conta a pagar — pix/débito/crédito já foi pago na hora
    if (formaPagamento === "boleto") {
      const dias = parseInt(prazoBoleto) || 0;
      const vencimento = new Date();
      vencimento.setDate(vencimento.getDate() + dias);
      await supabase.from("contas_pagar").insert({
        fornecedor_id: fornecedorObj.id, fornecedor_nome: fornecedorObj.nome,
        descricao: `Compra manual — ${nome}`, valor_total: valorTotal,
        forma_pagamento: formaPagamento, categoria: "compra",
        data_vencimento: vencimento.toISOString().slice(0, 10), criado_por: userData?.user?.id,
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
      <div style={sectionLabel}>Compra manual (sem nota fiscal)</div>

      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}

      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 3 }}>Item</label>
        <input list="lista-insumos-compra" value={itemNome} onChange={(e) => setItemNome(e.target.value)}
          placeholder="Busca insumo já cadastrado, ou digite um nome novo" style={{ ...inputStyle, marginBottom: 8 }} />
        <datalist id="lista-insumos-compra">
          {insumos.map((i) => <option key={i.id} value={i.nome} />)}
        </datalist>
        {!insumoSelecionado && itemNome.trim() && (
          <div style={{ fontSize: 11, color: "#185FA5", marginBottom: 8 }}>Esse insumo ainda não existe — vai ser criado ao salvar.</div>
        )}

        <div style={{ border: "1px dashed #37A0E5", borderRadius: 8, padding: 10, marginBottom: 8 }}>
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

        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 3 }}>Quantidade</label>
            <input type="number" value={quantidade} onChange={(e) => setQuantidade(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", padding: "7px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13 }} />
          </div>
          <div style={{ width: 70 }}>
            <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 3 }}>Unidade</label>
            <select value={itemUnidade} onChange={(e) => setItemUnidade(e.target.value)} disabled={!!insumoSelecionado}
              style={{ width: "100%", padding: "7px 4px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13, background: insumoSelecionado ? "#F6F1E7" : "#FFFFFF" }}>
              {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 3 }}>Valor unitário</label>
            <input type="number" step="0.01" value={valorUnitario} onChange={(e) => setValorUnitario(e.target.value)}
              style={{ width: "100%", boxSizing: "border-box", padding: "7px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13 }} />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 3 }}>Valor total</label>
            <input type="number" step="0.01" value={valorTotal}
              onChange={(e) => {
                const novoTotal = parseFloat(e.target.value) || 0;
                const qtd = parseFloat(quantidade) || 0;
                setValorUnitario(String(qtd > 0 ? round2(novoTotal / qtd) : 0));
              }}
              style={{ width: "100%", boxSizing: "border-box", padding: "7px 8px", borderRadius: 6, border: "1px solid #37A0E5", fontSize: 13 }} />
          </div>
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 4 }}>Forma de pagamento</label>
        <select value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)} style={inputStyle}>
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
          {formaPagamento === "boleto" ? "Gera uma conta a pagar com esse prazo." : "Pix/débito/crédito já é pago na hora — não gera conta a pagar."}
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 3 }}>Fornecedor</label>
        <input list="lista-fornecedores-compra" value={fornecedorNome} onChange={(e) => setFornecedorNome(e.target.value)}
          placeholder="Busca fornecedor já cadastrado, ou digite um nome novo" style={inputStyle} />
        <datalist id="lista-fornecedores-compra">
          {fornecedores.map((f) => <option key={f.id} value={f.nome} />)}
        </datalist>
      </div>

      <button onClick={salvar} disabled={salvando} style={{ ...btnPrimary, width: "100%", display: "flex", justifyContent: "center", gap: 6 }}>
        {salvando ? <Loader2 size={16} /> : <Check size={16} />} Salvar compra
      </button>
    </div>
  );
}
