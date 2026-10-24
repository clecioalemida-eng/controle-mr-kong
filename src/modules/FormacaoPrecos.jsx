// ===== FormacaoPrecos.jsx =====
// Formação de preços — Financeiro
//
// A fórmula é a mesma da sua planilha, e vale a pena escrever por extenso
// porque quase todo mundo erra esta conta:
//
//     preço = custo / (1 − margem)
//
// A margem é sobre o PREÇO DE VENDA, não sobre o custo. Um lanche que
// custa 10 com margem de 65% vende a 28,57 — e não a 16,50, que seria
// "custo + 65%". Quem usa a segunda conta acha que tem 65% de margem e
// tem 39%. A planilha já fazia certo (E39/(1-B39)); aqui é igual.
//
// A tela tem três abas, e elas são as três pontas da mesma conta:
//
//   Preços   — produto a produto: margem ↔ preço, e a ficha técnica
//              ali embaixo, porque sem custo certo não existe margem certa.
//   Tabela   — todos os preços de venda numa grade só, pra fechar o
//              cardápio inteiro de uma vez em vez de abrir 241 produtos.
//   Insumos  — o preço de compra de cada insumo. É daqui que sai o custo
//              de TODO prato: mexeu aqui, mexeu na margem de todos os
//              pratos que usam aquele insumo.
//
// O custo de um prato é Σ (quantidade × custo do insumo), a mesma conta
// do CMV no DRE e da tela de Fichas técnicas. A unidade segue a regra da
// casa: o insumo é comprado em kg/l/un e a receita é digitada em g/ml/un,
// então 150 g de um insumo de R$ 32,00/kg custam R$ 4,80.
//
// O lucro esperado usa o que foi REALMENTE vendido no período (migração
// 079, desempenho_produtos): para cada prato, quantidade vendida × (preço
// − custo). Mudar a margem na tela mostra na hora quanto o mês teria
// dado com aquele preço, sem precisar esperar o mês seguinte.
import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, AlertTriangle, Check, Search, RefreshCw, Plus, X, Save, ChevronDown } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

function brl(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function pct(v) {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return `${Number(v).toFixed(1).replace(".", ",")}%`;
}
function paraNumero(t) {
  if (t === null || t === undefined || t === "") return null;
  const n = parseFloat(String(t).replace(",", "."));
  return isNaN(n) ? null : n;
}
function num(t) { return paraNumero(t) ?? 0; }
function ymd(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function semAcento(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
function chaveNome(s) { return semAcento(s).trim().replace(/\s+/g, " "); }

// ---------------------------------------------------------------------------
// Unidades. O insumo é COMPRADO em kg/l/un e o custo guardado é por essa
// unidade. A receita é DIGITADA em g/ml/un, que é como se cozinha. Sem
// essa separação, 150 g de carne viram 150 kg de carne no custo — é a
// mesma regra que já existe em Fichas técnicas, copiada igual de
// propósito pra não haver duas verdades no sistema.
// ---------------------------------------------------------------------------
const SUB_UNIDADE = { kg: "g", l: "ml" };
function limpo(n) { return Math.round((Number(n) || 0) * 1e6) / 1e6; }
function unidadeDigitada(un) { return SUB_UNIDADE[un] || un || "un"; }
// O campo de quantidade aceita fração: "1/12" é uma lata de uma caixa de
// doze. Isso existe porque o erro mais comum deste cadastro é insumo com
// preço de EMBALAGEM e ficha gastando 1 — foi o que fez cada X-Tudo
// consumir uma caixa de ovos. Com a fração, o preço do insumo continua
// sendo o da caixa (que é o que a nota traz, e por isso "segue a nota"
// continua funcionando) e a ficha gasta a parte certa dela.
function numeroOuFracao(t) {
  const txt = String(t ?? "").trim().replace(",", ".");
  if (!txt) return 0;
  const f = txt.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
  if (f) {
    const baixo = parseFloat(f[2]);
    return baixo > 0 ? parseFloat(f[1]) / baixo : 0;
  }
  const n = parseFloat(txt);
  return isNaN(n) ? 0 : n;
}
function paraBase(valorDigitado, unidadeInsumo) {
  const v = numeroOuFracao(valorDigitado);
  return SUB_UNIDADE[unidadeInsumo] ? limpo(v / 1000) : limpo(v);
}
function paraTela(quantidadeBase, unidadeInsumo) {
  const q = Number(quantidadeBase) || 0;
  return SUB_UNIDADE[unidadeInsumo] ? limpo(q * 1000) : limpo(q);
}

// preço a partir da margem, e margem a partir do preço — as duas pontas
// da mesma fórmula
function precoPelaMargem(custo, margemPct) {
  const m = Number(margemPct) / 100;
  if (!(custo > 0) || !(m < 1)) return 0;
  return custo / (1 - m);
}
function margemPeloPreco(custo, preco) {
  if (!(preco > 0)) return null;
  return ((preco - custo) / preco) * 100;
}

// Array vazio ESTÁVEL. Com `fichas[p.id] || []` o JS cria uma lista nova a
// cada render, o useEffect do FichaEditor vê "mudou" todo render e chama
// setItens pra sempre — tela travada em prato sem ficha. É o tipo de laço
// que só aparece no produto que ainda não tem receita, justo o que mais
// vai ser aberto aqui.
const SEM_FICHA = [];

// ---------------------------------------------------------------------------
// Busca uma tabela inteira, em páginas.
//
// O PostgREST devolve no máximo o "Max rows" do projeto (1000 no Supabase,
// por padrão) e .limit() NÃO passa por cima disso — ele só consegue pedir
// menos. Com ~241 pratos e uma dezena de ingredientes em cada,
// prato_insumos passa de duas mil linhas: a consulta trazia o começo e
// calava o resto, sem erro nenhum. Os pratos que sobravam apareciam "custo
// sem ficha", entravam no lucro com custo zero e inflavam a margem.
//
// Esse é o pior tipo de erro que existe num painel: não dá mensagem, dá
// número. Por isso aqui se pagina até a página vir incompleta.
// ---------------------------------------------------------------------------
const PAGINA = 1000;
async function tabelaInteira(tabela, colunas, ordenarPor) {
  let de = 0;
  let tudo = [];
  for (;;) {
    let q = supabase.from(tabela).select(colunas).range(de, de + PAGINA - 1);
    if (ordenarPor) q = q.order(ordenarPor);
    const { data, error } = await q;
    if (error) return { data: null, error };
    tudo = tudo.concat(data || []);
    if (!data || data.length < PAGINA) break;
    de += PAGINA;
    if (de > 200000) break;          // trava de segurança
  }
  return { data: tudo, error: null };
}

const ABAS = [
  { chave: "precos",  label: "Preços" },
  { chave: "tabela",  label: "Tabela de preços" },
  { chave: "insumos", label: "Preço dos insumos" },
];

export default function FormacaoPrecos() {
  const [aba, setAba] = useState("precos");
  const [pratos, setPratos] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [fichas, setFichas] = useState({});   // prato_id -> [{ insumo_id, quantidade }]
  const [mix, setMix] = useState({});         // chaveNome -> { qtd, valor }
  const [compras, setCompras] = useState({}); // insumo_id -> última compra
  const [semFuncaoCompras, setSemFuncaoCompras] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [recado, setRecado] = useState("");

  const hoje = new Date();
  const inicioMes = ymd(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
  const fimHoje = ymd(hoje);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    const base = new Date();
    const mesAnt = new Date(base.getFullYear(), base.getMonth() - 1, 1);
    const [rPratos, rItens, rInsumos, rProd, rCompras] = await Promise.all([
      tabelaInteira("pratos", "id, nome, preco_venda, linha_produto, ativo, revenda", "nome"),
      tabelaInteira("prato_insumos", "prato_id, insumo_id, quantidade"),
      tabelaInteira("insumos", "id, nome, unidade, custo_medio_atual, composto, origem_custo, custo_manual", "nome"),
      supabase.rpc("desempenho_produtos", {
        p_inicio: inicioMes, p_fim: fimHoje,
        p_inicio_ant: ymd(mesAnt),
        p_fim_ant: ymd(new Date(base.getFullYear(), base.getMonth() - 1, base.getDate())),
      }),
      supabase.rpc("compras_dos_insumos"),
    ]);
    const falha = rPratos.error || rItens.error || rInsumos.error;
    if (falha) { setErro(falha.message); setCarregando(false); return; }

    // A ligação com as compras é opcional de propósito: se a migração 147
    // ainda não rodou, a tela continua funcionando sem a coluna em vez de
    // morrer inteira por causa de uma função que falta.
    const naoInstalada = rCompras.error
      && /does not exist|schema cache|Could not find/i.test(rCompras.error.message || "");
    setSemFuncaoCompras(!!naoInstalada);
    const mapaCompras = {};
    if (!rCompras.error) {
      (rCompras.data || []).forEach((c) => { mapaCompras[c.insumo_id] = c; });
    } else if (!naoInstalada) {
      setErro(rCompras.error.message);
    }
    setCompras(mapaCompras);

    const listaInsumos = rInsumos.data || [];
    setInsumos(listaInsumos);
    const porId = {};
    listaInsumos.forEach((i) => { porId[i.id] = i; });

    // ficha de cada prato + custo somado na mesma passada
    const porPrato = {};
    (rItens.data || []).forEach((li) => {
      if (!porPrato[li.prato_id]) porPrato[li.prato_id] = [];
      porPrato[li.prato_id].push({ insumo_id: li.insumo_id, quantidade: Number(li.quantidade) || 0 });
    });
    setFichas(porPrato);

    const custoDe = (pratoId) => (porPrato[pratoId] || []).reduce(
      (s, l) => s + l.quantidade * (Number(porId[l.insumo_id]?.custo_medio_atual) || 0), 0);

    const vendido = {};
    (rProd?.data || []).forEach((l) => {
      const k = chaveNome(l.produto);
      if (!vendido[k]) vendido[k] = { qtd: 0, valor: 0 };
      vendido[k].qtd += Number(l.qtd_atual) || 0;
      vendido[k].valor += Number(l.valor_atual) || 0;
    });
    setMix(vendido);

    setPratos((rPratos.data || [])
      .filter((p) => p.ativo !== false)
      .map((p) => ({
        ...p,
        custo: custoDe(p.id),
        temFicha: (porPrato[p.id] || []).length > 0,
        vendidos: vendido[chaveNome(p.nome)]?.qtd || 0,
        faturado: vendido[chaveNome(p.nome)]?.valor || 0,
      })));
    setCarregando(false);
  }, [inicioMes, fimHoje]);

  useEffect(() => { carregar(); }, [carregar]);

  // quais insumos aparecem em alguma ficha — serve pra encurtar a lista
  const insumosUsados = useMemo(() => {
    const s = new Set();
    Object.values(fichas).forEach((linhas) => linhas.forEach((l) => s.add(l.insumo_id)));
    return s;
  }, [fichas]);

  if (carregando) {
    return <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "#8A8778" }}>
      <Loader2 size={16} /> Carregando fichas, insumos e vendas do mês…
    </div>;
  }

  return (
    <div>
      {erro && <div style={aviso}><AlertTriangle size={16} /> {erro}</div>}
      {recado && <div style={{ ...aviso, background: "#F7FBF2", borderColor: "#C4DBA6", color: "#27500A" }}>
        <Check size={16} /> {recado}
      </div>}

      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {ABAS.map((a) => (
          <button key={a.chave} onClick={() => { setAba(a.chave); setRecado(""); }}
            style={a.chave === aba ? abaAtiva : abaInativa}>{a.label}</button>
        ))}
        <button onClick={carregar} style={{ ...btnSec, marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <RefreshCw size={14} /> Atualizar
        </button>
      </div>

      {aba === "precos" && (
        <AbaPrecos pratos={pratos} insumos={insumos} fichas={fichas} compras={compras}
          onErro={setErro} onRecado={setRecado} recarregar={carregar} />
      )}
      {aba === "tabela" && (
        <AbaTabela pratos={pratos} onErro={setErro} onRecado={setRecado} recarregar={carregar} />
      )}
      {aba === "insumos" && (
        <AbaInsumos insumos={insumos} usados={insumosUsados} pratos={pratos} fichas={fichas}
          compras={compras} semFuncao={semFuncaoCompras}
          onErro={setErro} onRecado={setRecado} recarregar={carregar} />
      )}
    </div>
  );
}

// ===========================================================================
// ABA 1 — Preços, produto a produto
// ===========================================================================
function AbaPrecos({ pratos, insumos, fichas, compras, onErro, onRecado, recarregar }) {
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(null);
  const [salvando, setSalvando] = useState(null);
  const [sim, setSim] = useState({});   // { [id]: { margem, preco } }

  const precoSimulado = (p) => {
    const s = sim[p.id];
    if (s && s.preco !== undefined && s.preco !== "") {
      const n = paraNumero(s.preco);
      if (n !== null) return n;
    }
    return Number(p.preco_venda) || 0;
  };

  const resumo = useMemo(() => {
    let fatAtual = 0, lucroAtual = 0, fatSim = 0, lucroSim = 0, semFicha = 0;
    pratos.forEach((p) => {
      const q = p.vendidos;
      if (!q) return;
      const atual = Number(p.preco_venda) || 0;
      const novo = precoSimulado(p);
      fatAtual += q * atual;
      fatSim += q * novo;
      if (p.temFicha && p.custo > 0) {
        lucroAtual += q * (atual - p.custo);
        lucroSim += q * (novo - p.custo);
      } else {
        semFicha += q * atual;
      }
    });
    return { fatAtual, lucroAtual, fatSim, lucroSim, semFicha };
  }, [pratos, sim]); // eslint-disable-line react-hooks/exhaustive-deps

  const aplicarPreco = async (p, novoPreco) => {
    setSalvando(p.id);
    onErro(""); onRecado("");
    const { error } = await supabase.from("pratos")
      .update({ preco_venda: novoPreco }).eq("id", p.id);
    setSalvando(null);
    if (error) { onErro(error.message); return; }
    setSim((prev) => ({ ...prev, [p.id]: { margem: "", preco: "" } }));
    onRecado(`${p.nome}: preço gravado em ${brl(novoPreco)}. O cardápio no CardápioWeb continua com o preço antigo até você mudar lá também.`);
    recarregar();
  };

  const visiveis = pratos
    .filter((p) => chaveNome(p.nome).includes(chaveNome(busca)))
    .sort((a, b) => b.faturado - a.faturado || a.nome.localeCompare(b.nome));

  const difLucro = resumo.lucroSim - resumo.lucroAtual;

  return (
    <div>
      <div style={{ ...card, marginBottom: 12 }}>
        <div style={rotulo}>Mês até hoje · {resumo.fatAtual > 0 ? "com o que foi vendido" : "sem venda no período"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10, marginTop: 6 }}>
          <div>
            <div style={rotuloMini}>Faturamento</div>
            <div style={numero}>{brl(resumo.fatAtual)}</div>
          </div>
          <div>
            <div style={rotuloMini}>Lucro nos preços de hoje</div>
            <div style={{ ...numero, color: "#27500A" }}>{brl(resumo.lucroAtual)}</div>
            <div style={rotuloMini}>
              {resumo.fatAtual > 0 ? pct((resumo.lucroAtual / resumo.fatAtual) * 100) + " do faturamento" : ""}
            </div>
          </div>
          <div>
            <div style={rotuloMini}>Lucro com os preços simulados</div>
            <div style={{ ...numero, color: difLucro >= 0 ? "#27500A" : "#8E2420" }}>{brl(resumo.lucroSim)}</div>
            <div style={{ ...rotuloMini, color: difLucro >= 0 ? "#27500A" : "#8E2420", fontWeight: 700 }}>
              {difLucro >= 0 ? "+" : "−"}{brl(Math.abs(difLucro))} no mês
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: "#8A8778", marginTop: 10, lineHeight: 1.6 }}>
          O lucro aqui é <b>faturamento menos o custo dos ingredientes</b> — não desconta pessoal,
          aluguel, cartão nem imposto. É margem de contribuição, a mesma conta do DRE.
          {resumo.semFicha > 0 && (
            <> <b>{brl(resumo.semFicha)}</b> do que foi vendido não tem ficha técnica e entra com
            custo zero, então o lucro real é menor que esse.</>
          )}
        </div>
      </div>

      <div style={{ position: "relative", marginBottom: 12 }}>
        <Search size={15} color="#8A8778" style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }} />
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar prato…"
          style={{ ...input, paddingLeft: 33, width: "100%" }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {visiveis.map((p) => {
          const s = sim[p.id] || {};
          const margemAtual = margemPeloPreco(p.custo, Number(p.preco_venda) || 0);
          const novoPreco = precoSimulado(p);
          const margemNova = margemPeloPreco(p.custo, novoPreco);
          const mudou = Math.abs(novoPreco - (Number(p.preco_venda) || 0)) > 0.005;
          const estaAberto = aberto === p.id;
          return (
            <div key={p.id} style={{ ...card, padding: 0, overflow: "hidden" }}>
              <button onClick={() => setAberto(estaAberto ? null : p.id)}
                style={{ display: "flex", width: "100%", gap: 10, alignItems: "center", justifyContent: "space-between",
                         background: "none", border: "none", padding: "11px 13px", cursor: "pointer", textAlign: "left" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#22231F" }}>{p.nome}</div>
                  <div style={{ fontSize: 11.5, color: "#8A8778" }}>
                    {p.temFicha ? <>custo {brl(p.custo)}</>
                                : <span style={{ color: "#8E2420" }}>sem ficha — toque para montar</span>}
                    {" · "}preço {brl(p.preco_venda)}
                    {p.vendidos > 0 && <> · {p.vendidos} vendidos no mês</>}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 15, fontWeight: 800,
                                  color: margemAtual == null || !p.temFicha ? "#8A8778" : margemAtual < 50 ? "#8E2420" : "#27500A" }}>
                      {p.temFicha ? pct(margemAtual) : "—"}
                    </div>
                    <div style={rotuloMini}>margem</div>
                  </div>
                  <ChevronDown size={16} color="#8A8778"
                    style={{ transform: estaAberto ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
                </div>
              </button>

              {estaAberto && (
                <div style={{ padding: "0 13px 13px", borderTop: "1px solid #F0EBDD" }}>
                  {p.temFicha && p.custo > 0 && (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
                        <div>
                          <label style={rotuloMini}>Quero esta margem</label>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input value={s.margem ?? ""} inputMode="decimal" placeholder={margemAtual ? margemAtual.toFixed(0) : "65"}
                              onChange={(e) => {
                                const m = paraNumero(e.target.value);
                                const preco = m === null ? "" : precoPelaMargem(p.custo, m).toFixed(2).replace(".", ",");
                                setSim((prev) => ({ ...prev, [p.id]: { margem: e.target.value, preco } }));
                              }}
                              style={{ ...input, width: 80, textAlign: "right" }} />
                            <span style={{ fontSize: 13, color: "#8A8778" }}>%</span>
                          </div>
                        </div>
                        <div>
                          <label style={rotuloMini}>Ou este preço</label>
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <span style={{ fontSize: 13, color: "#8A8778" }}>R$</span>
                            <input value={s.preco ?? ""} inputMode="decimal" placeholder={(Number(p.preco_venda) || 0).toFixed(2).replace(".", ",")}
                              onChange={(e) => {
                                const v = paraNumero(e.target.value);
                                const m = v === null ? "" : (margemPeloPreco(p.custo, v) ?? 0).toFixed(1).replace(".", ",");
                                setSim((prev) => ({ ...prev, [p.id]: { margem: m, preco: e.target.value } }));
                              }}
                              style={{ ...input, width: 100, textAlign: "right" }} />
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8,
                                    marginTop: 12, padding: "10px 12px", borderRadius: 10,
                                    background: mudou ? "#FBF7EC" : "#F6F1E7", flexWrap: "wrap" }}>
                        <div style={{ fontSize: 12.5, color: "#55534A" }}>
                          Preço {mudou ? "simulado" : "atual"}: <b style={{ color: "#22231F" }}>{brl(novoPreco)}</b>
                          {" · "}margem <b>{pct(margemNova)}</b>
                          <div style={{ fontSize: 11, color: "#8A8778", marginTop: 2 }}>
                            sobra {brl(novoPreco - p.custo)} por unidade
                            {p.vendidos > 0 && <> · {brl((novoPreco - p.custo) * p.vendidos)} no mês, nas {p.vendidos} vendidas</>}
                          </div>
                        </div>
                        {mudou && (
                          <button onClick={() => aplicarPreco(p, Number(novoPreco.toFixed(2)))}
                            disabled={salvando === p.id}
                            style={{ ...btnPri, alignSelf: "center" }}>
                            {salvando === p.id ? "Gravando…" : "Aplicar preço"}
                          </button>
                        )}
                      </div>

                      {/* A planilha também trabalha com o combo e o iFood em
                          cima do mesmo custo — fica à vista pra não ter que
                          refazer a conta num papel do lado. */}
                      <div style={{ fontSize: 11.5, color: "#8A8778", marginTop: 10, lineHeight: 1.7 }}>
                        Combo (+R$ 19,99): <b style={{ color: "#22231F" }}>{brl(novoPreco + 19.99)}</b>
                        {" · "}iFood (+20%): <b style={{ color: "#22231F" }}>{brl(novoPreco * 1.2)}</b>
                        {" · "}iFood com combo: <b style={{ color: "#22231F" }}>{brl(novoPreco * 1.2 + 19.99)}</b>
                      </div>
                    </>
                  )}

                  <FichaEditor prato={p} linhas={fichas[p.id] || SEM_FICHA} insumos={insumos}
                    compras={compras}
                    onErro={onErro} onRecado={onRecado} recarregar={recarregar} />
                </div>
              )}
            </div>
          );
        })}
        {visiveis.length === 0 && (
          <div style={{ ...card, fontSize: 13, color: "#8A8778" }}>Nenhum prato com esse nome.</div>
        )}
      </div>
    </div>
  );
}

// ===========================================================================
// Ficha técnica, editável aqui mesmo
//
// Grava do jeito que o resto do sistema já grava: apaga a ficha inteira e
// insere de novo. Não é elegante, mas é o que Fichas técnicas faz, e duas
// formas diferentes de gravar a mesma tabela é como aparece divergência.
//
// A quantidade é digitada em g/ml/un e guardada em kg/l/un — a conversão
// acontece no paraBase/paraTela, nunca no meio da tela.
// ===========================================================================
function FichaEditor({ prato, linhas, insumos, compras, onErro, onRecado, recarregar }) {
  const porId = useMemo(() => {
    const m = {};
    insumos.forEach((i) => { m[i.id] = i; });
    return m;
  }, [insumos]);

  const daBase = useCallback(() => linhas.map((l) => ({
    insumo_id: l.insumo_id,
    valor: String(paraTela(l.quantidade, porId[l.insumo_id]?.unidade)).replace(".", ","),
  })), [linhas, porId]);

  const [itens, setItens] = useState(daBase);
  const [buscaInsumo, setBuscaInsumo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [aviso1, setAviso1] = useState("");
  const [dividindo, setDividindo] = useState(null);   // insumo_id com a caixa aberta
  const [naCaixa, setNaCaixa] = useState("");

  useEffect(() => { setItens(daBase()); setAviso1(""); }, [daBase]);

  const custoDaLinha = (it) => {
    const ins = porId[it.insumo_id];
    if (!ins) return 0;
    return paraBase(it.valor, ins.unidade) * (Number(ins.custo_medio_atual) || 0);
  };
  const custoTotal = itens.reduce((s, it) => s + custoDaLinha(it), 0);
  const mudou = JSON.stringify(itens) !== JSON.stringify(daBase());

  const candidatos = buscaInsumo.trim().length < 2 ? [] : insumos
    .filter((i) => semAcento(i.nome).includes(semAcento(buscaInsumo)))
    .filter((i) => !itens.some((it) => it.insumo_id === i.id))
    .slice(0, 8);

  const salvar = async () => {
    setSalvando(true);
    onErro(""); onRecado(""); setAviso1("");
    const validos = itens.filter((it) => porId[it.insumo_id] && paraBase(it.valor, porId[it.insumo_id].unidade) > 0);
    if (validos.length !== itens.length) {
      setAviso1("Tem linha com quantidade zerada — ela não vai ser gravada.");
    }
    const { error: eDel } = await supabase.from("prato_insumos").delete().eq("prato_id", prato.id);
    if (eDel) { setSalvando(false); onErro(eDel.message); return; }
    if (validos.length > 0) {
      const { error } = await supabase.from("prato_insumos").insert(
        validos.map((it) => ({
          prato_id: prato.id,
          insumo_id: it.insumo_id,
          quantidade: paraBase(it.valor, porId[it.insumo_id].unidade),
        }))
      );
      if (error) { setSalvando(false); onErro(error.message); return; }
    }
    setSalvando(false);
    onRecado(`Ficha técnica de ${prato.nome} gravada: custo ${brl(custoTotal)}.`);
    recarregar();
  };

  return (
    <div style={{ marginTop: 14, borderTop: "1px solid #F0EBDD", paddingTop: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={rotulo}>Ficha técnica</div>
        <div style={{ fontSize: 12, color: "#8A8778" }}>
          custo <b style={{ color: "#22231F" }}>{brl(custoTotal)}</b>
        </div>
      </div>

      {itens.length === 0 && (
        <div style={{ fontSize: 12, color: "#8A8778", marginTop: 8 }}>
          Este prato não tem ingredientes cadastrados — por isso ele aparece sem margem.
          Busque os insumos abaixo e monte a ficha.
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {itens.map((it, idx) => {
          const ins = porId[it.insumo_id];
          return (
            <React.Fragment key={it.insumo_id}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "#22231F" }}>
                {ins?.nome || "(insumo apagado)"}
                <div style={rotuloMini}>
                  {ins ? `${brl(ins.custo_medio_atual)} / ${ins.unidade}` : "sem cadastro"}
                  {String(it.valor).includes("/") && paraBase(it.valor, ins?.unidade) > 0 && (
                    <span> · {String(paraTela(paraBase(it.valor, ins?.unidade), ins?.unidade)).replace(".", ",")} {unidadeDigitada(ins?.unidade)}</span>
                  )}
                  {(() => {
                    // Só avisa quando a nota discorda do que está cadastrado.
                    // Insumo composto tem custo calculado, não comprado.
                    const c = compras?.[it.insumo_id];
                    if (!ins || !c || ins.composto) return null;
                    if (Math.abs(Number(c.ultimo_preco) - (Number(ins.custo_medio_atual) || 0)) <= 0.005) return null;
                    return <span style={{ color: "#8E2420" }}> · última nota {brl(c.ultimo_preco)}</span>;
                  })()}
                </div>
              </div>
              <input value={it.valor} inputMode="text" placeholder="150 ou 1/12"
                onChange={(e) => setItens((prev) => prev.map((x, i) => (i === idx ? { ...x, valor: e.target.value } : x)))}
                style={{ ...input, width: 86, textAlign: "right" }} />
              <span style={{ fontSize: 12, color: "#8A8778", width: 26 }}>
                {unidadeDigitada(ins?.unidade)}
              </span>
              <button onClick={() => { setDividindo(dividindo === it.insumo_id ? null : it.insumo_id); setNaCaixa(""); }}
                title="O preço deste insumo é de uma embalagem? Divida."
                style={{ ...btnSec, padding: "4px 7px", fontSize: 12, lineHeight: 1 }}>÷</button>
              <span style={{ fontSize: 12, color: "#55534A", width: 72, textAlign: "right",
                             fontVariantNumeric: "tabular-nums" }}>{brl(custoDaLinha(it))}</span>
              <button onClick={() => setItens((prev) => prev.filter((_, i) => i !== idx))}
                title="Tirar da ficha"
                style={{ background: "none", border: "none", cursor: "pointer", color: "#8E2420", padding: 2, lineHeight: 0 }}>
                <X size={15} />
              </button>
            </div>
            {dividindo === it.insumo_id && (
              <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap",
                            background: "#F6F1E7", border: "1px solid #E8E2D2", borderRadius: 9,
                            padding: "8px 10px", fontSize: 12, color: "#55534A" }}>
                O preço de {brl(ins?.custo_medio_atual)} é de uma embalagem com
                <input value={naCaixa} inputMode="decimal" placeholder="12" autoFocus
                  onChange={(e) => setNaCaixa(e.target.value)}
                  style={{ ...input, width: 64, textAlign: "right", padding: "5px 7px" }} />
                {unidadeDigitada(ins?.unidade)}?
                <button
                  disabled={!(num(naCaixa) > 0)}
                  onClick={() => {
                    setItens((prev) => prev.map((x, i) => (i === idx ? { ...x, valor: `1/${num(naCaixa)}` } : x)));
                    setDividindo(null); setNaCaixa("");
                  }}
                  style={{ ...btnPri, padding: "5px 10px", fontSize: 12 }}>
                  Usar 1 de {num(naCaixa) > 0 ? num(naCaixa) : "…"}
                </button>
                {num(naCaixa) > 0 && (
                  <span style={{ color: "#8A8778" }}>
                    sai a {brl((Number(ins?.custo_medio_atual) || 0) / num(naCaixa))} cada
                  </span>
                )}
              </div>
            )}
          </React.Fragment>
          );
        })}
      </div>

      <div style={{ marginTop: 10, position: "relative" }}>
        <input value={buscaInsumo} onChange={(e) => setBuscaInsumo(e.target.value)}
          placeholder="Adicionar ingrediente — digite 2 letras…"
          style={{ ...input, width: "100%" }} />
        {candidatos.length > 0 && (
          <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            {candidatos.map((i) => (
              <button key={i.id}
                onClick={() => {
                  setItens((prev) => [...prev, { insumo_id: i.id, valor: "" }]);
                  setBuscaInsumo("");
                }}
                style={{ display: "flex", alignItems: "center", gap: 6, background: "#F6F1E7",
                         border: "1px solid #E8E2D2", borderRadius: 8, padding: "7px 10px",
                         cursor: "pointer", fontSize: 12.5, color: "#22231F", textAlign: "left",
                         fontFamily: "inherit" }}>
                <Plus size={13} /> {i.nome}
                <span style={{ marginLeft: "auto", color: "#8A8778", fontSize: 11.5 }}>
                  {brl(i.custo_medio_atual)} / {i.unidade}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {aviso1 && <div style={{ ...aviso, marginTop: 10, marginBottom: 0 }}><AlertTriangle size={15} /> {aviso1}</div>}

      {mudou && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={salvar} disabled={salvando} style={{ ...btnPri, display: "flex", alignItems: "center", gap: 6 }}>
            <Save size={14} /> {salvando ? "Gravando…" : "Salvar ficha"}
          </button>
          <button onClick={() => setItens(daBase())} style={btnSec}>Desfazer</button>
          <span style={{ fontSize: 11.5, color: "#8A8778" }}>
            custo passa a {brl(custoTotal)} · margem no preço de hoje {pct(margemPeloPreco(custoTotal, Number(prato.preco_venda) || 0))}
          </span>
        </div>
      )}

      <div style={{ fontSize: 11, color: "#8A8778", marginTop: 10, lineHeight: 1.6 }}>
        A quantidade é a da receita: {unidadeDigitada("kg")} para peso, {unidadeDigitada("l")} para volume,
        un para unidade. Quando o insumo está cadastrado pelo preço da <b>embalagem</b> — a caixa de
        refrigerante, a cartela de ovos — use o <b>÷</b> ou escreva a fração direto: <b>1/12</b> é uma
        lata de uma caixa de doze. Insumo novo se cadastra em Supply Chain → Insumos; aqui só se monta a receita.
      </div>
    </div>
  );
}

// ===========================================================================
// ABA 2 — Tabela de preços: o cardápio inteiro numa grade só
//
// Serve pra fechar preço de tudo de uma vez. Digita no preço OU na margem
// (uma recalcula a outra) e grava só o que mudou, num update por prato —
// o painel não tem upsert de preço em lote, e inventar um aqui seria
// arriscar sobrescrever campo que esta tela nem lê.
// ===========================================================================
function AbaTabela({ pratos, onErro, onRecado, recarregar }) {
  const [edit, setEdit] = useState({});   // id -> texto do preço
  const [busca, setBusca] = useState("");
  const [linha, setLinha] = useState("todas");
  const [salvando, setSalvando] = useState(false);
  const [progresso, setProgresso] = useState("");

  const linhasDisponiveis = useMemo(() => {
    const s = new Set();
    pratos.forEach((p) => s.add(p.linha_produto || "Sem linha"));
    return ["todas", ...Array.from(s).sort()];
  }, [pratos]);

  const visiveis = pratos
    .filter((p) => chaveNome(p.nome).includes(chaveNome(busca)))
    .filter((p) => linha === "todas" || (p.linha_produto || "Sem linha") === linha)
    .sort((a, b) => a.nome.localeCompare(b.nome));

  const precoDe = (p) => {
    const t = edit[p.id];
    if (t === undefined || t === "") return Number(p.preco_venda) || 0;
    return paraNumero(t) ?? (Number(p.preco_venda) || 0);
  };
  const mudouP = (p) => Math.abs(precoDe(p) - (Number(p.preco_venda) || 0)) > 0.005;
  const alterados = pratos.filter(mudouP);

  const salvarTudo = async () => {
    setSalvando(true); onErro(""); onRecado("");
    let feitos = 0;
    for (const p of alterados) {
      setProgresso(`${feitos + 1} de ${alterados.length}…`);
      const { error } = await supabase.from("pratos")
        .update({ preco_venda: Number(precoDe(p).toFixed(2)) }).eq("id", p.id);
      if (error) { setSalvando(false); setProgresso(""); onErro(`${p.nome}: ${error.message}`); return; }
      feitos += 1;
    }
    setSalvando(false); setProgresso(""); setEdit({});
    onRecado(`${feitos} ${feitos === 1 ? "preço gravado" : "preços gravados"}. O cardápio no CardápioWeb continua com os preços antigos até você mudar lá também.`);
    recarregar();
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 170 }}>
          <Search size={15} color="#8A8778" style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar prato…"
            style={{ ...input, paddingLeft: 33, width: "100%" }} />
        </div>
        <select value={linha} onChange={(e) => setLinha(e.target.value)} style={{ ...input, minWidth: 150 }}>
          {linhasDisponiveis.map((l) => <option key={l} value={l}>{l === "todas" ? "Todas as linhas" : l}</option>)}
        </select>
      </div>

      {alterados.length > 0 && (
        <div style={{ ...card, marginBottom: 10, display: "flex", justifyContent: "space-between",
                      alignItems: "center", gap: 10, flexWrap: "wrap", background: "#FBF7EC" }}>
          <div style={{ fontSize: 12.5, color: "#55534A" }}>
            <b style={{ color: "#22231F" }}>{alterados.length}</b> {alterados.length === 1 ? "preço alterado" : "preços alterados"} e ainda não gravado{alterados.length === 1 ? "" : "s"}.
            {progresso && <> Gravando {progresso}</>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setEdit({})} style={btnSec}>Desfazer tudo</button>
            <button onClick={salvarTudo} disabled={salvando} style={{ ...btnPri, display: "flex", alignItems: "center", gap: 6 }}>
              <Save size={14} /> {salvando ? "Gravando…" : "Salvar todos"}
            </button>
          </div>
        </div>
      )}

      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={th}>Prato</th>
                <th style={{ ...th, textAlign: "right" }}>Custo</th>
                <th style={{ ...th, textAlign: "right" }}>Preço</th>
                <th style={{ ...th, textAlign: "right" }}>Margem</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((p) => {
                const preco = precoDe(p);
                const m = p.temFicha && p.custo > 0 ? margemPeloPreco(p.custo, preco) : null;
                const alterado = mudouP(p);
                return (
                  <tr key={p.id} style={{ borderTop: "1px solid #F0EBDD", background: alterado ? "#FBF7EC" : "transparent" }}>
                    <td style={{ ...td, color: "#22231F" }}>
                      {p.nome}
                      <div style={rotuloMini}>{p.linha_produto || "sem linha"}{p.vendidos > 0 ? ` · ${p.vendidos} no mês` : ""}</div>
                    </td>
                    <td style={{ ...td, textAlign: "right", color: p.temFicha ? "#55534A" : "#B4AE9C" }}>
                      {p.temFicha ? brl(p.custo) : "sem ficha"}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      <input value={edit[p.id] ?? ""} inputMode="decimal"
                        placeholder={(Number(p.preco_venda) || 0).toFixed(2).replace(".", ",")}
                        onChange={(e) => setEdit((prev) => ({ ...prev, [p.id]: e.target.value }))}
                        style={{ ...input, width: 88, textAlign: "right", padding: "6px 8px" }} />
                    </td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700,
                                 color: m == null ? "#B4AE9C" : m < 50 ? "#8E2420" : "#27500A" }}>
                      {m == null ? "—" : pct(m)}
                      {p.temFicha && p.custo > 0 && (
                        <div style={{ ...rotuloMini, fontWeight: 400 }}>
                          65% = {brl(precoPelaMargem(p.custo, 65))}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visiveis.length === 0 && (
          <div style={{ padding: 14, fontSize: 13, color: "#8A8778" }}>Nenhum prato com esse filtro.</div>
        )}
      </div>

      <div style={{ fontSize: 11, color: "#8A8778", marginTop: 10, lineHeight: 1.6 }}>
        A coluna da direita mostra a margem que o preço digitado dá, e embaixo quanto o prato
        custaria a 65% — a margem que a sua planilha usa como referência. Prato sem ficha técnica
        não tem margem: o custo dele é desconhecido, não é zero.
      </div>
    </div>
  );
}

// ===========================================================================
// ABA 3 — Preço dos insumos, com origem declarada
//
// Antes, o custo do insumo era um campo só e quem escrevesse por último
// ganhava: a nota passava por cima do que você digitou, e você digitava
// por cima da nota. Os 26 divergentes nasceram daí — ninguém estava
// errado, o campo é que não sabia a quem obedecer.
//
// Agora cada insumo diz de onde vem o custo dele, e a regra mora no banco
// (migração 152), não aqui: venha a compra da tela de notas ou de um
// lançamento manual de estoque, ela respeita a origem do mesmo jeito.
//
//   Segue a nota   — a compra confirmada atualiza sozinha. É o padrão.
//   Média 90 dias  — acompanha a média do trimestre, e assim a compra
//                    cara de emergência não vira preço de trabalho.
//   Manual         — você digita e a nota não encosta. É o lugar do ovo
//                    cadastrado pelo preço da caixa, da embalagem
//                    rateada, de tudo que a nota descreve numa unidade e
//                    a ficha usa em outra.
//   Receita        — insumo composto: custo calculado, não comprado.
// ===========================================================================
const ORIGENS = [
  { chave: "ultima_compra", label: "Segue a nota" },
  { chave: "media_90d",     label: "Média 90 dias" },
  { chave: "manual",        label: "Manual" },
];
// As três unidades que o sistema conhece. Mudar a unidade de um insumo é
// mais perigoso do que mudar o preço: a quantidade das fichas NÃO é
// convertida — 0,15 era 150 g e, virando "un", passa a ser 0,15 unidade.
// O número fica igual e o significado muda. Por isso a tela conta quantas
// fichas dependem daquilo antes de deixar salvar.
const UNIDADES = ["kg", "l", "un"];

const ROTULO_ORIGEM = {
  ultima_compra: "Segue a nota",
  media_90d: "Média 90 dias",
  manual: "Manual",
  receita: "Receita",
};
const SITUACOES = [
  { chave: "todos",      label: "Todos" },
  { chave: "divergente", label: "Preço diferente da nota" },
  { chave: "manual",     label: "Travados em manual" },
  { chave: "nunca",      label: "Nunca comprados" },
  { chave: "sempreco",   label: "Sem preço" },
];

function diasDesde(quando) {
  if (!quando) return null;
  const d = new Date(quando);
  if (isNaN(d)) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
function dataCurta(quando) {
  const d = new Date(quando);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
// O preço da nota pode ter 4 casas (um item rateado por embalagem dá
// 0,8333). Mostrar "0,83" no campo e gravar 0,83 perderia dinheiro de
// propósito; mostrar "41,5" em vez de "41,50" só fica feio. Então: duas
// casas quando duas bastam, quatro quando não bastam.
function textoPreco(v) {
  const n = Number(v) || 0;
  const cabeEmDuas = Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
  return (cabeEmDuas ? n.toFixed(2) : n.toFixed(4)).replace(".", ",");
}

function AbaInsumos({ insumos, usados, pratos, fichas, compras, semFuncao, onErro, onRecado, recarregar }) {
  // edit[id] = { origem?, valor?, unidade?, forcar? }
  const [edit, setEdit] = useState({});
  const [busca, setBusca] = useState("");
  const [situacao, setSituacao] = useState("todos");
  const [soUsados, setSoUsados] = useState(true);
  const [confirmando, setConfirmando] = useState(null);   // id do insumo em confirmação
  const [salvando, setSalvando] = useState(null);

  const porIdInsumo = useMemo(() => {
    const m = {};
    insumos.forEach((x) => { m[x.id] = x; });
    return m;
  }, [insumos]);

  const quantosPratos = useMemo(() => {
    const c = {};
    Object.values(fichas).forEach((linhas) => linhas.forEach((l) => { c[l.insumo_id] = (c[l.insumo_id] || 0) + 1; }));
    return c;
  }, [fichas]);

  const origemDe  = (i) => edit[i.id]?.origem ?? i.origem_custo ?? "ultima_compra";
  const unidadeDe = (i) => edit[i.id]?.unidade ?? i.unidade ?? "un";
  const ehComposto = (i) => !!i.composto || (i.origem_custo === "receita");
  const valorManualDe = (i) => {
    const t = edit[i.id]?.valor;
    if (t === undefined || t === "") return Number(i.custo_medio_atual) || 0;
    return paraNumero(t) ?? (Number(i.custo_medio_atual) || 0);
  };

  const compraDe = (i) => (ehComposto(i) ? null : compras?.[i.id]) || null;
  const divergencia = (i) => {
    const c = compraDe(i);
    if (!c) return null;
    const atual = Number(i.custo_medio_atual) || 0;
    const nota = Number(c.ultimo_preco) || 0;
    if (!(nota > 0) || Math.abs(nota - atual) <= 0.005) return null;
    return { nota, atual, pct: atual > 0 ? ((nota - atual) / atual) * 100 : null };
  };
  const reaplicavel = (i) => !!divergencia(i) && ["ultima_compra", "media_90d"].includes(origemDe(i));

  // ---------------------------------------------------------------------
  // Quanto o custo VAI ficar, segundo o que está escolhido na linha.
  // É a mesma regra da função custo_pela_origem no banco (migração 152) —
  // aqui ela só é repetida pra conseguir mostrar o resultado ANTES de
  // gravar. Se as duas discordarem um dia, a do banco é a que vale.
  // ---------------------------------------------------------------------
  const custoPrevisto = (i) => {
    const atual = Number(i.custo_medio_atual) || 0;
    const origem = origemDe(i);
    if (ehComposto(i)) return atual;
    if (origem === "manual") return valorManualDe(i);
    const c = compras?.[i.id];
    if (!c) return atual;
    if (origem === "ultima_compra") return Number(c.ultimo_preco) || atual;
    if (origem === "media_90d")     return Number(c.preco_medio_90d) || atual;
    return atual;
  };

  const mudouI = (i) => {
    if (edit[i.id]?.forcar) return true;
    if (unidadeDe(i) !== (i.unidade ?? "un")) return true;
    if (origemDe(i) !== (i.origem_custo ?? "ultima_compra")) return true;
    if (origemDe(i) === "manual"
        && Math.abs(valorManualDe(i) - (Number(i.custo_medio_atual) || 0)) > 0.000001) return true;
    return false;
  };

  // ---------------------------------------------------------------------
  // O impacto: quais pratos usam este insumo e o que acontece com cada um.
  // ---------------------------------------------------------------------
  const custoDoPrato = (p, trocaId, trocaValor) =>
    (fichas[p.id] || SEM_FICHA).reduce((soma, l) => {
      const preco = l.insumo_id === trocaId
        ? trocaValor
        : (Number(porIdInsumo[l.insumo_id]?.custo_medio_atual) || 0);
      return soma + (Number(l.quantidade) || 0) * preco;
    }, 0);

  const impacto = (i) => {
    const antes = Number(i.custo_medio_atual) || 0;
    const depois = custoPrevisto(i);
    const afetados = pratos
      .filter((p) => (fichas[p.id] || SEM_FICHA).some((l) => l.insumo_id === i.id))
      .map((p) => {
        const cAntes = custoDoPrato(p, i.id, antes);
        const cDepois = custoDoPrato(p, i.id, depois);
        const preco = Number(p.preco_venda) || 0;
        return {
          id: p.id, nome: p.nome, preco, vendidos: p.vendidos || 0,
          cAntes, cDepois,
          mAntes: preco > 0 ? ((preco - cAntes) / preco) * 100 : null,
          mDepois: preco > 0 ? ((preco - cDepois) / preco) * 100 : null,
          noMes: (cDepois - cAntes) * (p.vendidos || 0),
        };
      })
      .sort((a, b) => Math.abs(b.cDepois - b.cAntes) - Math.abs(a.cDepois - a.cAntes) || a.nome.localeCompare(b.nome));
    const noMes = afetados.reduce((s, x) => s + x.noMes, 0);
    return { antes, depois, afetados, noMes };
  };

  const alterados = insumos.filter(mudouI);
  const trocaramUnidade = insumos.filter((i) => unidadeDe(i) !== (i.unidade ?? "un"));
  const divergentes = insumos.filter((i) => divergencia(i));
  const pendentes = insumos.filter(reaplicavel);

  const passaSituacao = (i) => {
    if (situacao === "divergente") return !!divergencia(i);
    if (situacao === "manual") return origemDe(i) === "manual";
    if (situacao === "nunca") return !compraDe(i) && !ehComposto(i);
    if (situacao === "sempreco") return !(Number(i.custo_medio_atual) > 0);
    return true;
  };

  const visiveis = insumos
    .filter((i) => semAcento(i.nome).includes(semAcento(busca)))
    .filter((i) => !soUsados || usados.has(i.id))
    .filter(passaSituacao)
    .sort((a, b) => (quantosPratos[b.id] || 0) - (quantosPratos[a.id] || 0) || a.nome.localeCompare(b.nome));

  const mudarOrigem = (i, origem) => setEdit((prev) => ({
    ...prev,
    [i.id]: { ...(prev[i.id] || {}), origem, forcar: false,
              valor: origem === "manual"
                ? (prev[i.id]?.valor ?? textoPreco(i.custo_medio_atual))
                : prev[i.id]?.valor },
  }));
  const travarNaNota = (i) => {
    const c = compraDe(i);
    if (!c) return;
    setEdit((prev) => ({ ...prev, [i.id]: { ...(prev[i.id] || {}), origem: "manual", valor: textoPreco(c.ultimo_preco), forcar: false } }));
    setConfirmando(i.id);
  };
  const reaplicar = (i) => {
    setEdit((prev) => ({ ...prev, [i.id]: { ...(prev[i.id] || {}), forcar: true } }));
    setConfirmando(i.id);
  };
  const desfazerLinha = (id) => {
    setEdit((prev) => { const c = { ...prev }; delete c[id]; return c; });
    setConfirmando(null);
  };

  // Grava UM insumo. De propósito não existe "salvar todos" aqui: mudar o
  // preço de um insumo mexe na margem de dezenas de pratos, e um botão que
  // faz isso vinte vezes de uma vez é um botão que ninguém confere.
  const salvarUm = async (i) => {
    setSalvando(i.id); onErro(""); onRecado("");
    if (unidadeDe(i) !== (i.unidade ?? "un")) {
      const { error: eUn } = await supabase.from("insumos")
        .update({ unidade: unidadeDe(i), atualizado_em: new Date().toISOString() })
        .eq("id", i.id);
      if (eUn) { setSalvando(null); onErro(`${i.nome}: ${eUn.message}`); return; }
    }
    const origem = origemDe(i);
    const { error } = await supabase.rpc("definir_custo_insumo", {
      p_insumo: i.id, p_origem: origem,
      p_valor: origem === "manual" ? valorManualDe(i) : null,
    });
    setSalvando(null);
    if (error) {
      onErro(/sem_acesso/.test(error.message || "")
        ? "Seu acesso não permite mudar o custo dos insumos."
        : `${i.nome}: ${error.message}`);
      return;
    }
    const n = quantosPratos[i.id] || 0;
    desfazerLinha(i.id);
    onRecado(`${i.nome}: gravado. ${n > 0 ? `${n} ${n === 1 ? "prato teve" : "pratos tiveram"} o custo recalculado.` : ""}`);
    recarregar();
  };

  return (
    <div>
      <div style={{ ...card, marginBottom: 10, fontSize: 11.5, color: "#8A8778", lineHeight: 1.6 }}>
        O preço aqui é <b>por kg / l / un</b>, do jeito que você compra: um saco de 5 kg
        por R$ 160 é R$ 32,00 no kg. É deste número que sai o custo de todo prato que usa o
        insumo — e, por consequência, a margem de todos eles.
        {semFuncao ? (
          <> <b style={{ color: "#8E2420" }}>A coluna das compras está desligada</b> porque a migração 147
          ainda não foi rodada no banco.</>
        ) : (
          <> <b>Para corrigir, digite na coluna Custo e clique em Salvar na própria linha.</b> A tela
          mostra antes de gravar o que acontece com cada prato que usa o insumo. A origem vira
          <b> Manual</b> sozinha, que é o jeito de dizer "este valor é meu, não mexam"; em
          <i> Segue a nota</i>, a compra confirmada atualiza o custo sozinha.</>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 170 }}>
          <Search size={15} color="#8A8778" style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar insumo…"
            style={{ ...input, paddingLeft: 33, width: "100%" }} />
        </div>
        <select value={situacao} onChange={(e) => setSituacao(e.target.value)} style={{ ...input, minWidth: 190 }}>
          {SITUACOES.map((o) => (
            <option key={o.chave} value={o.chave}>
              {o.label}{o.chave === "divergente" && divergentes.length > 0 ? ` (${divergentes.length})` : ""}
            </option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "#55534A", cursor: "pointer" }}>
          <input type="checkbox" checked={soUsados} onChange={(e) => setSoUsados(e.target.checked)} />
          Só os que estão em alguma ficha
        </label>
      </div>

      {pendentes.length > 0 && (
        <div style={{ ...aviso }}>
          <AlertTriangle size={15} />
          <span>
            <b>{pendentes.length}</b> {pendentes.length === 1 ? "insumo está" : "insumos estão"} em
            "segue a nota" com o valor antigo. Use o <b>trazer</b> na linha de cada um — e confira
            antes: se a nota descreve a caixa e a ficha gasta a unidade, o preço da nota também está
            errado, e aí é caso de digitar o valor certo à mão.
          </span>
        </div>
      )}

      {trocaramUnidade.length > 0 && (
        <div style={{ ...aviso, background: "#FBEFEC", borderColor: "#E8B5A8", color: "#8E2420",
                      alignItems: "flex-start", flexDirection: "column", gap: 4 }}>
          <div style={{ fontWeight: 700 }}>
            <AlertTriangle size={15} /> {trocaramUnidade.length === 1 ? "Um insumo mudou de unidade" : `${trocaramUnidade.length} insumos mudaram de unidade`}.
          </div>
          <div style={{ fontSize: 11.5, lineHeight: 1.6 }}>
            A quantidade das fichas <b>não é convertida</b>: o número fica igual e o significado muda.
            Um insumo em kg com 0,15 na ficha quer dizer 150 g; virando "un", aquele mesmo 0,15 passa
            a ser 0,15 unidade.{" "}
            {trocaramUnidade.map((i) => `${i.nome} (${quantosPratos[i.id] || 0} ${(quantosPratos[i.id] || 0) === 1 ? "prato" : "pratos"})`).join(" · ")}
            {" "}— confira a ficha desses depois de salvar.
          </div>
        </div>
      )}

      {alterados.length > 1 && (
        <div style={{ fontSize: 11.5, color: "#8A8778", marginBottom: 8 }}>
          {alterados.length} linhas com alteração pendente. Cada uma é salva na própria linha.
        </div>
      )}

      <div style={{ ...card, padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={th}>Insumo</th>
                <th style={{ ...th, textAlign: "center" }}>Un.</th>
                <th style={th}>Origem</th>
                <th style={{ ...th, textAlign: "right" }}>Custo</th>
                <th style={{ ...th, textAlign: "right" }}>Última compra</th>
                <th style={{ ...th, textAlign: "right" }}>Usado em</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((i) => {
                const alterado = mudouI(i);
                const n = quantosPratos[i.id] || 0;
                const semPreco = !(Number(i.custo_medio_atual) > 0);
                const c = compraDe(i);
                const dv = divergencia(i);
                const dias = c ? diasDesde(c.ultima_data) : null;
                const composto = ehComposto(i);
                const origem = origemDe(i);
                const emConfirmacao = confirmando === i.id;
                return (
                  <React.Fragment key={i.id}>
                  <tr style={{ borderTop: "1px solid #F0EBDD",
                        background: alterado ? "#FBF7EC" : dv ? "#FDFBF4" : "transparent" }}>
                    <td style={{ ...td, color: "#22231F" }}>
                      {i.nome}
                      {semPreco && !composto && <div style={{ ...rotuloMini, color: "#8E2420" }}>sem preço — zera o custo de quem usa</div>}
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <select value={unidadeDe(i)}
                        onChange={(e) => setEdit((prev) => ({
                          ...prev, [i.id]: { ...(prev[i.id] || {}), unidade: e.target.value },
                        }))}
                        style={{ ...input, padding: "5px 4px", fontSize: 12, width: 62,
                                 color: unidadeDe(i) !== (i.unidade ?? "un") ? "#8E2420" : "#55534A",
                                 fontWeight: unidadeDe(i) !== (i.unidade ?? "un") ? 700 : 400 }}>
                        {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                      {unidadeDe(i) !== (i.unidade ?? "un") && (
                        <div style={{ ...rotuloMini, color: "#8E2420" }}>era {i.unidade}</div>
                      )}
                    </td>
                    <td style={td}>
                      {composto ? (
                        <span style={{ color: "#8A8778" }}>Receita</span>
                      ) : (
                        <select value={origem} onChange={(e) => mudarOrigem(i, e.target.value)}
                          style={{ ...input, padding: "5px 6px", fontSize: 12, minWidth: 132 }}>
                          {ORIGENS.map((o) => <option key={o.chave} value={o.chave}>{o.label}</option>)}
                        </select>
                      )}
                      {edit[i.id]?.forcar && (
                        <div style={{ ...rotuloMini, color: "#7A6A1E" }}>vai trazer da nota</div>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>
                      {composto ? (
                        <>
                          <div style={{ color: "#22231F" }}>{brl(i.custo_medio_atual)}</div>
                          <div style={rotuloMini}>calculado</div>
                        </>
                      ) : (
                        <>
                          <input value={edit[i.id]?.valor ?? ""} inputMode="decimal"
                            placeholder={textoPreco(i.custo_medio_atual)}
                            onChange={(e) => setEdit((prev) => ({
                              ...prev,
                              [i.id]: { ...(prev[i.id] || {}), origem: "manual", valor: e.target.value, forcar: false },
                            }))}
                            style={{ ...input, width: 92, textAlign: "right", padding: "6px 8px" }} />
                          <div style={rotuloMini}>{ROTULO_ORIGEM[origem]?.toLowerCase()}</div>
                        </>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      {!c ? (
                        <span style={{ color: "#B4AE9C" }}>{composto ? "—" : "nunca comprado"}</span>
                      ) : (
                        <>
                          <div style={{ color: dv ? "#8E2420" : "#27500A", fontWeight: dv ? 700 : 400 }}>
                            {brl(c.ultimo_preco)}
                            {dv && dv.pct != null && (
                              <span style={{ fontSize: 11 }}> ({dv.pct > 0 ? "+" : ""}{dv.pct.toFixed(0)}%)</span>
                            )}
                          </div>
                          <div style={rotuloMini}>
                            {dataCurta(c.ultima_data)}
                            {dias != null && dias > 60 && <> · há {dias} dias</>}
                            {c.ultimo_fornecedor ? ` · ${c.ultimo_fornecedor}` : ""}
                          </div>
                          {c.compras_90d > 1 && (
                            <div style={rotuloMini}>
                              {c.compras_90d} compras em 90d · {brl(c.preco_min_90d)} a {brl(c.preco_max_90d)}
                            </div>
                          )}
                          {dv && !emConfirmacao && (
                            <div style={{ display: "flex", gap: 5, justifyContent: "flex-end", marginTop: 3, flexWrap: "wrap" }}>
                              {reaplicavel(i) && (
                                <button onClick={() => reaplicar(i)}
                                  style={{ ...btnSec, padding: "3px 8px", fontSize: 11 }}>trazer</button>
                              )}
                              <button onClick={() => travarNaNota(i)}
                                style={{ ...btnSec, padding: "3px 8px", fontSize: 11 }}>
                                {origem === "manual" ? "usar este valor" : "travar neste preço"}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </td>
                    <td style={{ ...td, textAlign: "right", color: n === 0 ? "#B4AE9C" : "#55534A" }}>
                      {n === 0 ? "—" : `${n} ${n === 1 ? "prato" : "pratos"}`}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {alterado && !emConfirmacao && (
                        <div style={{ display: "flex", gap: 5 }}>
                          <button onClick={() => setConfirmando(i.id)} style={{ ...btnPri, padding: "6px 11px", fontSize: 12 }}>
                            Salvar
                          </button>
                          <button onClick={() => desfazerLinha(i.id)} style={{ ...btnSec, padding: "6px 9px", fontSize: 12 }}>
                            ✕
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>

                  {emConfirmacao && (
                    <tr style={{ background: "#FBF7EC" }}>
                      <td colSpan={7} style={{ padding: "12px 13px", borderTop: "1px solid #E8D48A" }}>
                        <Confirmacao insumo={i} dados={impacto(i)}
                          unidadeNova={unidadeDe(i)} origemNova={origemDe(i)}
                          salvando={salvando === i.id}
                          onCancelar={() => setConfirmando(null)}
                          onConfirmar={() => salvarUm(i)} />
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {visiveis.length === 0 && (
          <div style={{ padding: 14, fontSize: 13, color: "#8A8778" }}>Nenhum insumo nesse filtro.</div>
        )}
      </div>

      <div style={{ fontSize: 11, color: "#8A8778", marginTop: 10, lineHeight: 1.6 }}>
        <b>Travar neste preço</b> põe o insumo em Manual já com o valor da nota dentro: serve pro preço
        que está certo hoje e que você não quer que mude sozinho amanhã. <b>Trazer</b> só reaplica o que
        a origem já manda, pros que ficaram com valor velho. E <b>nunca comprado</b> quer dizer que
        nenhuma nota confirmada passou por ali — o preço é palpite, e a margem de quem usa herda o palpite.
      </div>
    </div>
  );
}

// ===========================================================================
// A confirmação: o que vai acontecer com cada prato, antes de gravar
//
// Mudar o preço de um insumo não é editar uma linha — é mexer na margem de
// todo prato que o usa. Então a tela mostra a conta feita, prato a prato,
// e só grava depois que você viu.
// ===========================================================================
const MOSTRA_ATE = 8;

function Confirmacao({ insumo, dados, unidadeNova, origemNova, salvando, onCancelar, onConfirmar }) {
  const { antes, depois, afetados, noMes } = dados;
  const mudouPreco = Math.abs(depois - antes) > 0.000001;
  const mudouUnidade = unidadeNova !== (insumo.unidade ?? "un");
  const pct = antes > 0 ? ((depois - antes) / antes) * 100 : null;
  const [tudo, setTudo] = useState(false);
  const lista = tudo ? afetados : afetados.slice(0, MOSTRA_ATE);

  return (
    <div>
      <div style={{ fontSize: 13, color: "#22231F", marginBottom: 8 }}>
        <b>{insumo.nome}</b>
        {mudouPreco && (
          <> · de <b>{brl(antes)}</b> para <b style={{ color: depois > antes ? "#8E2420" : "#27500A" }}>{brl(depois)}</b>
          {pct != null && <span style={{ color: "#8A8778" }}> ({pct > 0 ? "+" : ""}{pct.toFixed(0)}%)</span>}</>
        )}
        {mudouUnidade && <> · unidade de <b>{insumo.unidade}</b> para <b style={{ color: "#8E2420" }}>{unidadeNova}</b></>}
        <> · origem <b>{ROTULO_ORIGEM[origemNova]}</b></>
      </div>

      {afetados.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "#8A8778", marginBottom: 10 }}>
          Nenhuma ficha usa este insumo — nada muda de margem.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
                        color: "#8A8778", marginBottom: 4 }}>
            {afetados.length} {afetados.length === 1 ? "prato muda" : "pratos mudam"}
          </div>
          <div style={{ overflowX: "auto", background: "#FFFFFF", border: "1px solid #E8E2D2",
                        borderRadius: 9, marginBottom: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...th, background: "#FFFFFF" }}>Prato</th>
                  <th style={{ ...th, background: "#FFFFFF", textAlign: "right" }}>Custo</th>
                  <th style={{ ...th, background: "#FFFFFF", textAlign: "right" }}>Margem</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((x) => (
                  <tr key={x.id} style={{ borderTop: "1px solid #F0EBDD" }}>
                    <td style={{ ...td, color: "#22231F" }}>
                      {x.nome}
                      <div style={rotuloMini}>
                        preço {brl(x.preco)}{x.vendidos > 0 ? ` · ${x.vendidos} no mês` : ""}
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      <span style={{ color: "#8A8778" }}>{brl(x.cAntes)}</span>
                      <span style={{ color: "#8A8778" }}> → </span>
                      <b style={{ color: x.cDepois > x.cAntes ? "#8E2420" : "#27500A" }}>{brl(x.cDepois)}</b>
                    </td>
                    <td style={{ ...td, textAlign: "right", whiteSpace: "nowrap" }}>
                      <span style={{ color: "#8A8778" }}>{pct2(x.mAntes)}</span>
                      <span style={{ color: "#8A8778" }}> → </span>
                      <b style={{ color: (x.mDepois ?? 0) < 50 ? "#8E2420" : "#27500A" }}>{pct2(x.mDepois)}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {afetados.length > MOSTRA_ATE && (
            <button onClick={() => setTudo(!tudo)} style={{ ...btnSec, fontSize: 11.5, padding: "5px 10px", marginBottom: 8 }}>
              {tudo ? "mostrar só os maiores" : `ver os outros ${afetados.length - MOSTRA_ATE}`}
            </button>
          )}
          {Math.abs(noMes) > 0.005 && (
            <div style={{ fontSize: 12.5, color: "#55534A", marginBottom: 10 }}>
              Pelo que foi vendido no mês, isso é{" "}
              <b style={{ color: noMes > 0 ? "#8E2420" : "#27500A" }}>
                {noMes > 0 ? "+" : "−"}{brl(Math.abs(noMes))}
              </b>{" "}
              de custo que a sua margem não estava contando.
            </div>
          )}
        </>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={onConfirmar} disabled={salvando}
          style={{ ...btnPri, display: "flex", alignItems: "center", gap: 6 }}>
          <Check size={14} /> {salvando ? "Gravando…" : "Confirmar e gravar"}
        </button>
        <button onClick={onCancelar} style={btnSec}>Cancelar</button>
      </div>
    </div>
  );
}

function pct2(v) {
  if (v === null || v === undefined || !isFinite(v)) return "—";
  return `${Number(v).toFixed(0)}%`;
}

const card = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const rotulo = { fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778" };
const rotuloMini = { fontSize: 10.5, color: "#8A8778" };
const numero = { fontSize: 20, fontWeight: 800, color: "#22231F", fontVariantNumeric: "tabular-nums" };
const input = { boxSizing: "border-box", padding: "8px 10px", borderRadius: 8, border: "1px solid #E8E2D2",
                fontSize: 13, background: "#FFFFFF", color: "#22231F", fontFamily: "inherit" };
const btnPri = { background: "#22231F", color: "#F3EFE3", border: "none", borderRadius: 9,
                 padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" };
const btnSec = { background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8,
                 padding: "8px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };
const abaAtiva = { ...btnSec, background: "#22231F", color: "#F3EFE3", border: "1px solid #22231F" };
const abaInativa = btnSec;
const aviso = { display: "flex", alignItems: "center", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A",
                color: "#7A6A1E", borderRadius: 10, padding: "11px 13px", fontSize: 12.5, marginBottom: 12 };
const th = { textAlign: "left", padding: "9px 12px", fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4,
             textTransform: "uppercase", color: "#8A8778", background: "#FAF7EF", whiteSpace: "nowrap" };
const td = { padding: "8px 12px", verticalAlign: "middle" };
