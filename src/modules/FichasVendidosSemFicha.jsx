// ===== FichasVendidosSemFicha.jsx =====
//
// Supply Chain → Fichas técnicas → filtro "Vendidos sem ficha".
//
// O que foi vendido nos últimos 30 dias e entrou no DRE com custo zero,
// porque o item não achou prato com ficha. Vem do que mais vendeu para o
// que menos vendeu: os primeiros da lista são os que mais mexem no CMV.
//
// Para cada item, uma de três saídas:
//   - Ligar a um prato que já tem ficha (grava um apelido pela
//     ensinar_apelido_de_prato, a mesma do "É qual prato meu?" do
//     Dashboard — a lição vale para o DRE, o Dashboard e o Comercial);
//   - Criar ficha (cria o prato e abre o editor);
//   - Não tem custo (taxa, item de teste): sai da lista e para de contar.
//
// O DRE recalcula pelo que está ligado hoje, então ligar um item corrige
// os meses passados também.
//
// Depende da migração 203. Sem ela, o filtro nem aparece.
//
// Também exporta ApelidosDoPrato: o "Também vendido como" do editor da
// ficha, com o × para desfazer um apelido.

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, AlertTriangle, X } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

function brl(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function semAcento(t) {
  return String(t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
// Mesma chave da tela de fichas: só letra e número.
function chaveNome(t) { return semAcento(t).replace(/[^a-z0-9]/g, ""); }
// Palavras que dizem alguma coisa. "combo", "lanche", "batata" e "bebida"
// aparecem em todo combo e fariam qualquer combo parecer com qualquer outro.
const PALAVRAS_VAZIAS = new Set(["combo", "lanche", "batata", "bebida", "com", "de", "da", "do", "e", "ml"]);
function palavras(t) {
  return new Set(
    semAcento(t).replace(/([0-9]+)\s*ml/g, "$1").split(/[^a-z0-9]+/)
      .filter((p) => p.length >= 2 && !PALAVRAS_VAZIAS.has(p))
  );
}

// Nota de 0 a 1 para "o item vendido parece este prato".
function parecido(itemNome, pratoNome) {
  const a = chaveNome(itemNome), b = chaveNome(pratoNome);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const pa = palavras(itemNome), pb = palavras(pratoNome);
  if (pa.size === 0 || pb.size === 0) return 0;
  let comuns = 0;
  pa.forEach((p) => { if (pb.has(p)) comuns += 1; });
  const nota = comuns / Math.max(pa.size, pb.size);
  // "Kong Açaí 500ml" ⊂ "Kong Açaí 500ml (com 3 acompanhamentos)"
  const contido = comuns === pa.size || comuns === pb.size;
  return Math.min(0.95, nota + (contido ? 0.25 : 0));
}

function nomeCanal(c) {
  const t = String(c || "").toLowerCase();
  if (t.includes("keeta")) return { rotulo: "Keeta", bg: "#FDEBD3", cor: "#854F0B" };
  if (t.includes("ifood")) return { rotulo: "iFood", bg: "#FBE1DC", cor: "#A3301F" };
  return { rotulo: "Salão / cardápio", bg: "#E9E5F6", cor: "#4C3E77" };
}
function canaisDoItem(canais) {
  const vistos = new Map();
  String(canais || "").split(",").map((s) => s.trim()).filter(Boolean).forEach((c) => {
    const n = nomeCanal(c);
    vistos.set(n.rotulo, n);
  });
  return [...vistos.values()];
}

export default function VendidosSemFicha({ itens, cobertura, pratos, carregando, onRecarregar, onAbrirPrato }) {
  const [trabalhando, setTrabalhando] = useState(null); // chave do item em andamento
  const [erro, setErro] = useState("");
  const [escolha, setEscolha] = useState({});           // chave do item → prato escolhido no seletor
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const [marcados, setMarcados] = useState(null);
  const [verMarcados, setVerMarcados] = useState(false);

  const chaveDoItem = (it) => `${it.item_id ?? ""}|${it.chave ?? ""}|${it.prato_id ?? ""}`;

  const comFicha = useMemo(
    () => (pratos || []).filter((p) => p.ativo && p.temFicha),
    [pratos]
  );
  const todosAtivos = useMemo(() => (pratos || []).filter((p) => p.ativo), [pratos]);

  const sugestoesDe = useCallback((it) => {
    return comFicha
      .map((p) => ({ prato: p, nota: parecido(it.nome, p.nome) }))
      .filter((s) => s.nota >= 0.5)
      .sort((a, b) => b.nota - a.nota)
      .slice(0, 4);
  }, [comFicha]);

  const carregarMarcados = useCallback(async () => {
    const { data, error } = await supabase.rpc("itens_marcados_sem_custo");
    if (!error) setMarcados(data || []);
  }, []);
  useEffect(() => { carregarMarcados(); }, [carregarMarcados]);

  const rodar = async (it, fn) => {
    setTrabalhando(chaveDoItem(it));
    setErro("");
    try {
      await fn();
      await onRecarregar();
    } catch (e) {
      setErro(e?.message || String(e));
    }
    setTrabalhando(null);
  };

  const ligar = (it, pratoId) => rodar(it, async () => {
    if (!pratoId) throw new Error("Escolha o prato.");
    const { error } = await supabase.rpc("ensinar_apelido_de_prato", {
      p_nome_lido: it.nome || "",
      p_prato: pratoId,
      p_item_id: it.item_id ?? null,
    });
    if (error) throw error;
  });

  const criarFicha = (it) => rodar(it, async () => {
    const preco = it.unidades > 0 ? Number(it.venda) / Number(it.unidades) : 0;
    const { data: id, error } = await supabase.rpc("criar_prato_do_vendido", {
      p_nome: it.nome || "",
      p_item_id: it.item_id ?? null,
      p_preco: Math.round(preco * 100) / 100,
    });
    if (error) throw error;
    const { data: prato, error: e2 } = await supabase.from("pratos").select("*").eq("id", id).single();
    if (e2) throw e2;
    onAbrirPrato(prato);
  });

  const semCusto = (it) => rodar(it, async () => {
    if (!window.confirm(
      `"${it.nome}" não tem custo nenhum (taxa, item de teste)?\n\n` +
      "Ele sai desta lista e deixa de contar como venda sem ficha. Dá para desfazer no fim da lista."
    )) return;
    const { error } = await supabase.rpc("marcar_item_sem_custo", {
      p_nome: it.nome || "",
      p_item_id: it.item_id ?? null,
    });
    if (error) throw error;
    await carregarMarcados();
  });

  const voltarAContar = async (m) => {
    setErro("");
    const { error } = await supabase.rpc("desmarcar_item_sem_custo", { p_id: m.id });
    if (error) { setErro(error.message); return; }
    await carregarMarcados();
    await onRecarregar();
  };

  if (carregando && !itens) {
    return <div style={{ fontSize: 13, color: CINZA, display: "flex", gap: 6, alignItems: "center" }}><Loader2 size={14} /> Carregando o que foi vendido…</div>;
  }

  const lista = itens || [];
  const totalSem = Number(cobertura?.receita_sem_ficha || 0);
  const totalCom = Number(cobertura?.receita_com_ficha || 0);
  const pct = totalCom + totalSem > 0 ? (totalCom / (totalCom + totalSem)) * 100 : null;
  const visiveis = mostrarTodos ? lista : lista.slice(0, 15);
  const resto = lista.slice(visiveis.length);
  const somaResto = resto.reduce((s, it) => s + Number(it.venda || 0), 0);
  // Quanto a cobertura sobe se os 5 primeiros forem resolvidos
  const top5 = lista.slice(0, 5).reduce((s, it) => s + Number(it.venda || 0), 0);
  const pctTop5 = totalCom + totalSem > 0 ? ((totalCom + top5) / (totalCom + totalSem)) * 100 : null;

  return (
    <div>
      {/* Resumo */}
      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, color: CINZA }}>Venda dos últimos 30 dias que entrou no DRE com custo zero</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>
              {brl(totalSem)}
              {pct != null && <span style={{ fontSize: 13, fontWeight: 400, color: CINZA }}> · {(100 - pct).toFixed(0)}% da venda</span>}
            </div>
          </div>
          {pct != null && (
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, color: CINZA }}>Cobertura das fichas</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: pct >= 95 ? VERDE : "#9A6A12" }}>{pct.toFixed(0)}%</div>
            </div>
          )}
        </div>
        {pct != null && (
          <div style={{ height: 10, borderRadius: 99, background: "#F0EBDD", overflow: "hidden", display: "flex", marginTop: 10 }}>
            <div style={{ width: `${pct}%`, background: VERDE }} />
            <div style={{ width: `${100 - pct}%`, background: "#E3B341" }} />
          </div>
        )}
        <div style={{ fontSize: 11, color: CINZA, marginTop: 6, lineHeight: 1.5 }}>
          Enquanto um item vendido não está ligado a uma ficha, o custo dele não entra no CMV e o lucro do DRE
          aparece maior do que é.
          {lista.length > 5 && pctTop5 != null && <> Resolver os 5 primeiros já leva a cobertura a ~{pctTop5.toFixed(0)}%.</>}
        </div>
      </div>

      {erro && (
        <div style={aviso}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div>{erro}</div></div>
      )}

      {lista.length === 0 ? (
        <div style={{ ...card, textAlign: "center", color: "#0F6E56", fontSize: 13 }}>
          Tudo o que foi vendido nos últimos 30 dias tem ficha. O CMV do DRE está completo.
        </div>
      ) : (
        <>
          <div style={rotuloSecao}>Do que mais vendeu para o que menos vendeu</div>
          {visiveis.map((it) => {
            const k = chaveDoItem(it);
            const ocupado = trabalhando === k;
            const canais = canaisDoItem(it.canais);
            const sugestoes = it.prato_id ? [] : sugestoesDe(it);
            const forte = sugestoes.length > 0 && sugestoes[0].nota >= 0.8 &&
                          (sugestoes.length === 1 || sugestoes[0].nota - sugestoes[1].nota >= 0.15);
            const escolhido = escolha[k] || "";
            return (
              <div key={k} style={{ ...card, padding: "12px 14px", marginBottom: 8, opacity: ocupado ? 0.6 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontWeight: 700 }}>{it.nome || "(sem nome)"}</span>
                    {canais.map((c) => (
                      <span key={c.rotulo} style={{ ...etiqueta, background: c.bg, color: c.cor }}>{c.rotulo}</span>
                    ))}
                    <div style={{ fontSize: 11, color: CINZA, marginTop: 2 }}>
                      {it.item_id ? `código ${it.item_id}` : "chega sem código — liga pelo nome"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700 }}>{brl(it.venda)}</div>
                    <div style={{ fontSize: 12, color: CINZA }}>{Number(it.unidades || 0).toLocaleString("pt-BR")} un.</div>
                  </div>
                </div>

                {it.prato_id ? (
                  // Já acha o prato, mas o prato está sem ficha.
                  <div style={{ ...caixa, background: "#FBF3D9", borderColor: "#E8D48A" }}>
                    <span>Já está ligado a <b>{it.prato_nome}</b>, que ainda não tem ficha.</span>
                    <span style={{ display: "flex", gap: 6 }}>
                      <button disabled={ocupado} style={btnEscuro} onClick={async () => {
                        const { data: prato } = await supabase.from("pratos").select("*").eq("id", it.prato_id).single();
                        if (prato) onAbrirPrato(prato);
                      }}>Preencher a ficha</button>
                    </span>
                  </div>
                ) : forte ? (
                  <div style={caixa}>
                    <span>
                      Parece ser <b>{sugestoes[0].prato.nome}</b>
                      <span style={{ color: CINZA }}> · ficha com custo de {brl(sugestoes[0].prato.custoTotal)}</span>
                    </span>
                    <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <button disabled={ocupado} style={btnEscuro} onClick={() => ligar(it, sugestoes[0].prato.id)}>
                        {ocupado ? "Ligando…" : "Ligar"}
                      </button>
                      <button disabled={ocupado} style={btnLink}
                        onClick={() => setEscolha((e) => ({ ...e, [k]: e[k] === undefined ? "" : undefined }))}>
                        outro prato
                      </button>
                    </span>
                  </div>
                ) : null}

                {/* Seletor: aparece quando não há sugestão forte, ou quando a
                    pessoa pediu "outro prato". */}
                {!it.prato_id && (!forte || escolha[k] !== undefined) && (
                  <div style={{ ...caixa, background: "#FFFFFF", borderColor: "#E8E2D2" }}>
                    <span style={{ color: CINZA }}>
                      {sugestoes.length > 1 && !forte ? "Mais de um prato parecido. Qual ficha ele usa?"
                        : sugestoes.length === 0 && !forte ? "Nenhum prato parecido. Ligue a um prato ou crie a ficha."
                        : "Ligar a outro prato:"}
                    </span>
                    <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                      <select value={escolhido} onChange={(e) => setEscolha((x) => ({ ...x, [k]: e.target.value }))}
                        style={seletor}>
                        <option value="">— escolha o prato —</option>
                        {sugestoes.length > 0 && (
                          <optgroup label="Parecidos">
                            {sugestoes.map((s) => <option key={s.prato.id} value={s.prato.id}>{s.prato.nome}</option>)}
                          </optgroup>
                        )}
                        <optgroup label="Todos os pratos">
                          {todosAtivos.map((p) => (
                            <option key={p.id} value={p.id}>{p.nome}{p.temFicha ? "" : " (sem ficha)"}</option>
                          ))}
                        </optgroup>
                      </select>
                      <button disabled={ocupado || !escolhido} style={{ ...btnEscuro, opacity: escolhido ? 1 : 0.5 }}
                        onClick={() => ligar(it, escolhido)}>
                        {ocupado ? "Ligando…" : "Ligar"}
                      </button>
                    </span>
                  </div>
                )}

                {!it.prato_id && (
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 8, flexWrap: "wrap" }}>
                    <button disabled={ocupado} style={btnClaro} onClick={() => criarFicha(it)}>Criar ficha</button>
                    <button disabled={ocupado} style={btnLink} onClick={() => semCusto(it)}>não tem custo</button>
                  </div>
                )}
              </div>
            );
          })}

          {resto.length > 0 && (
            <button onClick={() => setMostrarTodos(true)}
              style={{ ...btnLink, display: "block", margin: "10px auto 4px", fontSize: 12 }}>
              + {resto.length} itens · {brl(somaResto)}
            </button>
          )}
        </>
      )}

      {marcados && marcados.length > 0 && (
        <div style={{ marginTop: 16, fontSize: 12, color: CINZA }}>
          <button style={{ ...btnLink, fontSize: 12 }} onClick={() => setVerMarcados((v) => !v)}>
            {verMarcados ? "esconder" : "ver"} {marcados.length} item(ns) marcado(s) como sem custo
          </button>
          {verMarcados && (
            <div style={{ ...card, marginTop: 8, padding: "8px 12px" }}>
              {marcados.map((m) => (
                <div key={m.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "6px 0", borderTop: "1px solid #F0EBDD" }}>
                  <span style={{ color: "#22231F" }}>{m.nome_lido}{m.item_id ? <span style={{ color: CINZA }}> · código {m.item_id}</span> : null}</span>
                  <button style={{ ...btnLink, fontSize: 12 }} onClick={() => voltarAContar(m)}>voltar a contar</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Também vendido como" — no editor da ficha.
//
// Mostra os apelidos (nome ou código) que levam venda para este prato, com o
// × para desfazer. Sem a migração 203, não aparece.
// ---------------------------------------------------------------------------
export function ApelidosDoPrato({ pratoId }) {
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState("");
  const [tirando, setTirando] = useState(null);

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("apelidos_do_prato", { p_prato: pratoId });
    if (error) { setLista([]); return; }
    setLista(data || []);
  }, [pratoId]);
  useEffect(() => { carregar(); }, [carregar]);

  const esquecer = async (a) => {
    if (!window.confirm(
      `Desligar "${a.nome_lido}" deste prato?\n\n` +
      "A venda que chega com esse nome ou código volta a ficar sem ficha (ou cai no prato de nome igual, se houver)."
    )) return;
    setTirando(a.id);
    setErro("");
    const { error } = await supabase.rpc("esquecer_apelido_de_prato", { p_id: a.id });
    setTirando(null);
    if (error) { setErro(error.message); return; }
    carregar();
  };

  if (!lista || lista.length === 0) return null;
  return (
    <div style={{ ...card, marginBottom: 12, padding: "10px 14px" }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: CINZA, marginBottom: 6 }}>
        Também vendido como
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {lista.map((a) => (
          <span key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#FBFAFE",
                                     border: "1px solid #C9BEE8", borderRadius: 99, padding: "3px 6px 3px 10px", fontSize: 12 }}>
            {a.nome_lido}{a.item_id ? <span style={{ color: CINZA }}> · {a.item_id}</span> : null}
            <button onClick={() => esquecer(a)} disabled={tirando === a.id} title="Desligar"
              style={{ border: "none", background: "none", cursor: "pointer", color: CINZA, padding: 2, display: "flex" }}>
              {tirando === a.id ? <Loader2 size={12} /> : <X size={12} />}
            </button>
          </span>
        ))}
      </div>
      {erro && <div style={{ fontSize: 12, color: "#A32D2D", marginTop: 6 }}>{erro}</div>}
    </div>
  );
}

const CINZA = "#8A8778";
const VERDE = "#2F8F5B";
const card = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const aviso = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E",
                borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 14 };
const rotuloSecao = { fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: CINZA, margin: "4px 0 8px" };
const etiqueta = { display: "inline-block", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99,
                   marginLeft: 6, verticalAlign: "middle" };
const caixa = { marginTop: 10, background: "#FBFAFE", border: "1px solid #C9BEE8", borderRadius: 10, padding: "9px 11px",
                fontSize: 12.5, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" };
const btnEscuro = { border: "none", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 700, fontFamily: "inherit",
                    background: "#22231F", color: "#F3EFE3", cursor: "pointer" };
const btnClaro = { border: "1px solid #E8E2D2", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 700,
                   fontFamily: "inherit", background: "#FFFFFF", color: "#22231F", cursor: "pointer" };
const btnLink = { border: "none", background: "none", color: CINZA, textDecoration: "underline", padding: "7px 4px",
                  fontSize: 12, fontFamily: "inherit", cursor: "pointer" };
const seletor = { fontFamily: "inherit", fontSize: 12, padding: "7px 8px", border: "1px solid #E8E2D2", borderRadius: 8,
                  background: "#FFFFFF", maxWidth: 260 };
