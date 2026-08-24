import React, { useState, useEffect, useCallback } from "react";
import {
  Loader2, AlertTriangle, RefreshCw, Plus, Trash2, Check,
  Calculator, Package, Tag, Settings,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { podeEditar } from "../lib/permissoes";

// ---------------------------------------------------------------------
// DRE — Demonstrativo de Resultado
//
// Quase tudo é calculado no banco, pela função dre_mensal(). Esta tela
// só desenha o resultado e deixa preencher o que o banco não tem como
// saber sozinho: lançamento manual, imobilizado e a classificação das
// contas a pagar.
//
// Três decisões que estão embutidas na função SQL e valem repetir aqui,
// porque explicam números que assustam à primeira vista:
//
//   1. Compra de insumo NÃO é despesa. O custo entra pelo CONSUMO, via
//      ficha técnica (conta 3.1). Por isso uma nota de R$ 5.000 em carne
//      não aparece no DRE do mês em que chegou.
//   2. Imobilizado NÃO é despesa. Vira depreciação mensal (conta 10.1).
//   3. Taxa de serviço é repasse do garçom, não receita da casa —
//      sai como dedução (conta 2.5).
// ---------------------------------------------------------------------

const ABAS = [
  { chave: "dre",         label: "Demonstrativo", icone: Calculator },
  { chave: "classificar", label: "Classificar",   icone: Tag },
  { chave: "lancamentos", label: "Lançamentos",   icone: Plus },
  { chave: "imobilizado", label: "Imobilizado",   icone: Package },
  { chave: "config",      label: "Configuração",  icone: Settings },
];

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function limitesDoMes(mes) {
  const [a, m] = mes.split("-").map(Number);
  const ini = `${mes}-01`;
  const fim = new Date(a, m, 0);
  const fimStr = `${mes}-${String(fim.getDate()).padStart(2, "0")}`;
  return [ini, fimStr];
}
function brl(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function pct(v, base) {
  if (!base) return "—";
  return `${((Math.abs(Number(v) || 0) / Math.abs(base)) * 100).toFixed(1)}%`;
}

export default function DRE({ permissoes }) {
  const editar = podeEditar(permissoes, "financeiro.dre");
  const admin = !!permissoes?.admin;
  const [aba, setAba] = useState("dre");

  const abasVisiveis = ABAS.filter((a) => (a.chave === "config" ? admin : true));

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {abasVisiveis.map((a) => {
          const Icone = a.icone;
          return (
            <button key={a.chave} onClick={() => setAba(a.chave)}
              style={{ ...subTab, ...(aba === a.chave ? subTabAtiva : {}) }}>
              <Icone size={13} /> {a.label}
            </button>
          );
        })}
      </div>

      {aba === "dre" && <Demonstrativo />}
      {aba === "classificar" && <Classificar editar={editar} />}
      {aba === "lancamentos" && <Lancamentos editar={editar} />}
      {aba === "imobilizado" && <Imobilizado editar={editar} />}
      {aba === "config" && admin && <Configuracao />}
    </div>
  );
}

// =====================================================================
// 1. O demonstrativo
// =====================================================================
function Demonstrativo() {
  const [mes, setMes] = useState(mesAtual());
  const [linhas, setLinhas] = useState(null);
  const [cobertura, setCobertura] = useState(null);
  const [semClassificar, setSemClassificar] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  const calcular = useCallback(async () => {
    setCarregando(true);
    setErro("");
    const [ini, fim] = limitesDoMes(mes);

    const { data, error } = await supabase.rpc("dre_mensal", { p_mes: mes });
    if (error) {
      setErro(error.message || "Não deu para calcular o DRE.");
      setCarregando(false);
      return;
    }
    setLinhas(data || []);

    const { data: cob } = await supabase.rpc("dre_cmv_periodo", { p_inicio: ini, p_fim: fim });
    setCobertura(Array.isArray(cob) ? cob[0] : cob);

    const { count } = await supabase
      .from("contas_pagar")
      .select("id", { count: "exact", head: true })
      .is("plano_conta", null);
    setSemClassificar(count || 0);

    setCarregando(false);
  }, [mes]);

  useEffect(() => { calcular(); }, [calcular]);

  const receitaBruta = (linhas || []).find((l) => l.codigo === "1")?.valor || 0;
  const lucro = (linhas || []).find((l) => l.codigo === "LL")?.valor || 0;
  const semFicha = Number(cobertura?.receita_sem_ficha || 0);
  const comFicha = Number(cobertura?.receita_com_ficha || 0);
  const pctCobertura = comFicha + semFicha > 0
    ? (comFicha / (comFicha + semFicha)) * 100
    : null;

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 14 }}>
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} style={inputStyle} />
        <button onClick={calcular} style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6 }}>
          <RefreshCw size={14} /> Recalcular
        </button>
        {carregando && <Loader2 size={16} style={{ color: "#8A8778" }} />}
      </div>

      {erro && (
        <div style={{ ...avisoStyle, marginBottom: 14 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13 }}>{erro}</div>
        </div>
      )}

      {/* Avisos que mudam a leitura do número — ficam antes da tabela */}
      {pctCobertura !== null && pctCobertura < 95 && (
        <div style={{ ...avisoStyle, marginBottom: 10 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13 }}>
            <b>{pctCobertura.toFixed(0)}% da venda tem ficha técnica.</b>{" "}
            Os {brl(semFicha)} restantes entraram com custo zero, então o CMV
            está menor do que a realidade e o lucro, maior. Complete as
            fichas em Supply Chain para o número fechar.
          </div>
        </div>
      )}
      {semClassificar > 0 && (
        <div style={{ ...avisoStyle, marginBottom: 10 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13 }}>
            <b>{semClassificar} conta(s) a pagar sem classificação.</b>{" "}
            Enquanto não tiverem uma conta do plano, elas ficam fora do DRE.
            Resolva na aba <b>Classificar</b>.
          </div>
        </div>
      )}

      {linhas && (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
            <div style={statBox}>
              <div style={statNum}>{brl(receitaBruta)}</div>
              <div style={statLabel}>Receita bruta</div>
            </div>
            <div style={statBox}>
              <div style={{ ...statNum, color: lucro >= 0 ? "#27500A" : "#A32D2D" }}>{brl(lucro)}</div>
              <div style={statLabel}>Lucro líquido</div>
            </div>
            <div style={statBox}>
              <div style={{ ...statNum, color: lucro >= 0 ? "#27500A" : "#A32D2D" }}>
                {receitaBruta ? `${((lucro / receitaBruta) * 100).toFixed(1)}%` : "—"}
              </div>
              <div style={statLabel}>Margem líquida</div>
            </div>
          </div>

          <div style={{ ...cardStyle, padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 460 }}>
              <tbody>
                {linhas.map((l) => {
                  const ehSubtotal = l.secao === "subtotal";
                  const ehGrupo = l.nivel === 0 && !ehSubtotal;
                  const negativo = Number(l.valor) < 0;
                  const zerado = Number(l.valor) === 0;
                  return (
                    <tr key={`${l.codigo}-${l.ordem}`} style={{
                      borderTop: "1px solid #F0EBDD",
                      background: ehSubtotal ? "#F6F1E7" : "#FFFFFF",
                    }}>
                      <td style={{
                        padding: ehGrupo || ehSubtotal ? "11px 12px" : "8px 12px",
                        paddingLeft: l.nivel === 1 ? 30 : 12,
                        fontWeight: ehGrupo || ehSubtotal ? 800 : 500,
                        color: zerado && l.nivel === 1 ? "#B4AF9E" : "#22231F",
                      }}>
                        {l.nivel === 1 && (
                          <span style={{
                            fontFamily: "ui-monospace, monospace", fontSize: 11,
                            color: "#B4AF9E", marginRight: 8,
                          }}>{l.codigo}</span>
                        )}
                        {ehSubtotal ? `= ${l.nome}` : l.nome}
                      </td>
                      <td style={{
                        padding: "8px 12px", textAlign: "right", whiteSpace: "nowrap",
                        fontVariantNumeric: "tabular-nums",
                        fontWeight: ehGrupo || ehSubtotal ? 800 : 500,
                        color: zerado ? "#B4AF9E" : negativo ? "#A32D2D" : "#22231F",
                      }}>
                        {brl(l.valor)}
                      </td>
                      <td style={{
                        padding: "8px 12px", textAlign: "right", whiteSpace: "nowrap",
                        fontSize: 11, color: "#8A8778", fontVariantNumeric: "tabular-nums",
                        width: 62,
                      }}>
                        {ehGrupo || ehSubtotal ? pct(l.valor, receitaBruta) : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 11, color: "#8A8778", marginTop: 10, lineHeight: 1.6 }}>
            O percentual é sobre a receita bruta. Compra de insumo não aparece
            aqui — o custo entra pelo consumo, na linha 3.1. Compra de
            equipamento também não — vira depreciação, na 10.1.
          </div>
        </>
      )}
    </div>
  );
}

// =====================================================================
// 2. Classificar contas a pagar
// =====================================================================
function Classificar({ editar }) {
  const [contas, setContas] = useState([]);
  const [plano, setPlano] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [{ data: cs }, { data: pl }] = await Promise.all([
      supabase.from("contas_pagar")
        .select("id, descricao, fornecedor_nome, valor_total, data_vencimento, centro_custo, documento_compra_id")
        .is("plano_conta", null)
        .order("data_vencimento", { ascending: false, nullsFirst: false })
        .limit(200),
      supabase.from("plano_contas")
        .select("codigo, nome, entra_dre")
        .eq("ativo", true)
        .like("codigo", "%.%")
        .order("ordem"),
    ]);
    setContas(cs || []);
    setPlano(pl || []);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const classificar = async (conta, codigo) => {
    if (!codigo) return;
    setSalvando(conta.id);
    setErro("");
    const { error } = await supabase.from("contas_pagar")
      .update({ plano_conta: codigo }).eq("id", conta.id);
    setSalvando(null);
    if (error) { setErro(error.message); return; }
    setContas((atual) => atual.filter((c) => c.id !== conta.id));
  };

  if (carregando) return <div style={vazio}><Loader2 size={16} /> Carregando…</div>;

  return (
    <div>
      <div style={{ fontSize: 12, color: "#8A8778", marginBottom: 12, lineHeight: 1.6 }}>
        Conta sem classificação fica de fora do DRE. As duas primeiras opções
        da lista — <b>0.1 Compras de estoque</b> e <b>0.2 Aquisição de
        imobilizado</b> — saem do caixa mas não entram no resultado: a
        primeira vira custo quando o produto é consumido, a segunda vira
        depreciação.
      </div>
      {erro && <div style={{ ...avisoStyle, marginBottom: 10 }}><AlertTriangle size={16} /><div>{erro}</div></div>}
      {contas.length === 0 ? (
        <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 8, color: "#27500A", fontSize: 13 }}>
          <Check size={16} /> Nenhuma conta pendente de classificação.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {contas.map((c) => (
            <div key={c.id} style={{ ...itemRow, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#22231F" }}>
                  {c.descricao || c.fornecedor_nome || "Sem descrição"}
                </div>
                <div style={{ fontSize: 11, color: "#8A8778" }}>
                  {brl(c.valor_total)}
                  {c.data_vencimento ? ` · vence ${c.data_vencimento.split("-").reverse().join("/")}` : ""}
                  {c.centro_custo ? ` · ${c.centro_custo}` : ""}
                  {c.documento_compra_id ? " · veio de nota" : ""}
                </div>
              </div>
              <select
                defaultValue=""
                disabled={!editar || salvando === c.id}
                onChange={(e) => classificar(c, e.target.value)}
                style={{ ...inputStyle, minWidth: 210 }}
              >
                <option value="">Escolha a conta…</option>
                {plano.map((p) => (
                  <option key={p.codigo} value={p.codigo}>
                    {p.codigo} — {p.nome}{p.entra_dre ? "" : "  (fora do DRE)"}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// 3. Lançamentos manuais
// =====================================================================
function Lancamentos({ editar }) {
  const [mes, setMes] = useState(mesAtual());
  const [lista, setLista] = useState([]);
  const [plano, setPlano] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [novo, setNovo] = useState({ conta_codigo: "", valor: "", observacao: "" });

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [{ data: ls }, { data: pl }] = await Promise.all([
      supabase.from("dre_lancamentos")
        .select("id, mes, conta_codigo, valor, observacao")
        .eq("mes", mes).order("conta_codigo"),
      supabase.from("plano_contas")
        .select("codigo, nome").eq("ativo", true).eq("entra_dre", true)
        .like("codigo", "%.%").order("ordem"),
    ]);
    setLista(ls || []);
    setPlano(pl || []);
    setCarregando(false);
  }, [mes]);

  useEffect(() => { carregar(); }, [carregar]);

  const adicionar = async () => {
    setErro("");
    if (!novo.conta_codigo) { setErro("Escolha a conta."); return; }
    const valor = parseFloat(String(novo.valor).replace(",", "."));
    if (!valor || isNaN(valor)) { setErro("Informe um valor."); return; }
    const { data: sessao } = await supabase.auth.getUser();
    const { error } = await supabase.from("dre_lancamentos").insert({
      mes,
      conta_codigo: novo.conta_codigo,
      valor,
      observacao: novo.observacao || null,
      criado_por: sessao?.user?.id || null,
    });
    if (error) { setErro(error.message); return; }
    setNovo({ conta_codigo: "", valor: "", observacao: "" });
    carregar();
  };

  const remover = async (id) => {
    const { error } = await supabase.from("dre_lancamentos").delete().eq("id", id);
    if (error) { setErro(error.message); return; }
    carregar();
  };

  const nomeConta = (codigo) => {
    const p = plano.find((x) => x.codigo === codigo);
    return p ? `${p.codigo} — ${p.nome}` : codigo;
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} style={inputStyle} />
        <div style={{ fontSize: 12, color: "#8A8778" }}>
          {lista.length} lançamento(s) neste mês
        </div>
      </div>

      <div style={{ fontSize: 12, color: "#8A8778", marginBottom: 12, lineHeight: 1.6 }}>
        Aqui vai o que o painel não tem como saber: encargos, pró-labore,
        provisão de 13º, descontos, juros. <b>Lance sempre o valor
        positivo</b> — o DRE já entende que despesa e dedução diminuem o
        resultado. A única exceção é <b>10.3 Receitas financeiras</b>, que
        soma.
      </div>

      {editar && (
        <div style={{ ...cardStyle, marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={novo.conta_codigo} style={{ ...inputStyle, flex: 2, minWidth: 200 }}
            onChange={(e) => setNovo({ ...novo, conta_codigo: e.target.value })}>
            <option value="">Conta…</option>
            {plano.map((p) => <option key={p.codigo} value={p.codigo}>{p.codigo} — {p.nome}</option>)}
          </select>
          <input placeholder="Valor" value={novo.valor} inputMode="decimal"
            onChange={(e) => setNovo({ ...novo, valor: e.target.value })}
            style={{ ...inputStyle, width: 110 }} />
          <input placeholder="Observação" value={novo.observacao}
            onChange={(e) => setNovo({ ...novo, observacao: e.target.value })}
            style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
          <button onClick={adicionar} style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={14} /> Lançar
          </button>
        </div>
      )}

      {erro && <div style={{ ...avisoStyle, marginBottom: 10 }}><AlertTriangle size={16} /><div>{erro}</div></div>}

      {carregando ? (
        <div style={vazio}><Loader2 size={16} /> Carregando…</div>
      ) : lista.length === 0 ? (
        <div style={vazio}>Nenhum lançamento manual em {mes}.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lista.map((l) => (
            <div key={l.id} style={itemRow}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#22231F" }}>{nomeConta(l.conta_codigo)}</div>
                {l.observacao && <div style={{ fontSize: 11, color: "#8A8778" }}>{l.observacao}</div>}
              </div>
              <div style={{ fontWeight: 700, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{brl(l.valor)}</div>
              {editar && (
                <button onClick={() => remover(l.id)} style={iconBtnPeq} title="Remover">
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// 4. Imobilizado
// =====================================================================
function Imobilizado({ editar }) {
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [novo, setNovo] = useState({
    descricao: "", valor: "", data_aquisicao: new Date().toISOString().slice(0, 10), vida_util_meses: "60",
  });

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data } = await supabase.from("imobilizado")
      .select("id, descricao, valor, data_aquisicao, vida_util_meses, ativo")
      .order("data_aquisicao", { ascending: false });
    setLista(data || []);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const adicionar = async () => {
    setErro("");
    const valor = parseFloat(String(novo.valor).replace(",", "."));
    const vida = parseInt(novo.vida_util_meses, 10);
    if (!novo.descricao.trim()) { setErro("Descreva o bem."); return; }
    if (!valor || isNaN(valor)) { setErro("Informe o valor."); return; }
    if (!vida || vida < 1) { setErro("A vida útil precisa ser pelo menos 1 mês."); return; }
    const { data: sessao } = await supabase.auth.getUser();
    const { error } = await supabase.from("imobilizado").insert({
      descricao: novo.descricao.trim(),
      valor,
      data_aquisicao: novo.data_aquisicao,
      vida_util_meses: vida,
      criado_por: sessao?.user?.id || null,
    });
    if (error) { setErro(error.message); return; }
    setNovo({ descricao: "", valor: "", data_aquisicao: new Date().toISOString().slice(0, 10), vida_util_meses: "60" });
    carregar();
  };

  const alternarAtivo = async (bem) => {
    const { error } = await supabase.from("imobilizado").update({ ativo: !bem.ativo }).eq("id", bem.id);
    if (error) { setErro(error.message); return; }
    carregar();
  };

  const remover = async (id) => {
    const { error } = await supabase.from("imobilizado").delete().eq("id", id);
    if (error) { setErro(error.message); return; }
    carregar();
  };

  const depreciacaoMes = lista
    .filter((b) => b.ativo)
    .reduce((s, b) => s + (Number(b.valor) || 0) / (Number(b.vida_util_meses) || 1), 0);

  return (
    <div>
      <div style={{ fontSize: 12, color: "#8A8778", marginBottom: 12, lineHeight: 1.6 }}>
        Chapa, freezer, mesa, ombrelone, moto: dura mais de um ano, então
        não é despesa do mês em que foi comprado. Cadastre aqui e o DRE
        cobra só o desgaste, mês a mês, na conta 10.1. Uma chapa de
        R$ 4.000 em 5 anos custa R$ 66,67 por mês.
      </div>

      <div style={{ ...statBox, marginBottom: 14, textAlign: "left" }}>
        <div style={statNum}>{brl(depreciacaoMes)}</div>
        <div style={statLabel}>Depreciação mensal dos bens ativos</div>
      </div>

      {editar && (
        <div style={{ ...cardStyle, marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input placeholder="O que é (ex.: chapa nova)" value={novo.descricao}
            onChange={(e) => setNovo({ ...novo, descricao: e.target.value })}
            style={{ ...inputStyle, flex: 2, minWidth: 180 }} />
          <input placeholder="Valor" value={novo.valor} inputMode="decimal"
            onChange={(e) => setNovo({ ...novo, valor: e.target.value })}
            style={{ ...inputStyle, width: 110 }} />
          <input type="date" value={novo.data_aquisicao}
            onChange={(e) => setNovo({ ...novo, data_aquisicao: e.target.value })}
            style={inputStyle} />
          <select value={novo.vida_util_meses}
            onChange={(e) => setNovo({ ...novo, vida_util_meses: e.target.value })}
            style={inputStyle}>
            <option value="36">3 anos</option>
            <option value="60">5 anos</option>
            <option value="120">10 anos</option>
          </select>
          <button onClick={adicionar} style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 6 }}>
            <Plus size={14} /> Cadastrar
          </button>
        </div>
      )}

      {erro && <div style={{ ...avisoStyle, marginBottom: 10 }}><AlertTriangle size={16} /><div>{erro}</div></div>}

      {carregando ? (
        <div style={vazio}><Loader2 size={16} /> Carregando…</div>
      ) : lista.length === 0 ? (
        <div style={vazio}>Nenhum bem cadastrado ainda.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lista.map((b) => (
            <div key={b.id} style={{ ...itemRow, opacity: b.ativo ? 1 : 0.55 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#22231F" }}>{b.descricao}</div>
                <div style={{ fontSize: 11, color: "#8A8778" }}>
                  {brl(b.valor)} · {b.vida_util_meses} meses ·{" "}
                  {brl((Number(b.valor) || 0) / (Number(b.vida_util_meses) || 1))}/mês
                  {b.data_aquisicao ? ` · desde ${b.data_aquisicao.split("-").reverse().join("/")}` : ""}
                  {b.ativo ? "" : " · baixado"}
                </div>
              </div>
              {editar && (
                <>
                  <button onClick={() => alternarAtivo(b)} style={btnMini}>
                    {b.ativo ? "Dar baixa" : "Reativar"}
                  </button>
                  <button onClick={() => remover(b.id)} style={iconBtnPeq} title="Remover">
                    <Trash2 size={14} />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// 5. Configuração (só admin)
// =====================================================================
function Configuracao() {
  const [config, setConfig] = useState([]);
  const [taxas, setTaxas] = useState([]);
  const [canais, setCanais] = useState([]);
  const [contasReceita, setContasReceita] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [msg, setMsg] = useState("");
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [{ data: cf }, { data: tx }, { data: cn }, { data: pc }] = await Promise.all([
      supabase.from("dre_config").select("chave, valor, descricao").order("chave"),
      supabase.from("dre_taxas_recebimento").select("forma_pagamento, rotulo, percentual, conta_codigo").order("forma_pagamento"),
      supabase.from("dre_canais").select("canal, rotulo, conta_codigo").order("canal"),
      supabase.from("plano_contas").select("codigo, nome").in("grupo", [1]).like("codigo", "%.%").order("ordem"),
    ]);
    setConfig(cf || []);
    setTaxas(tx || []);
    setCanais(cn || []);
    setContasReceita(pc || []);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const salvarConfig = async (chave, valor) => {
    setErro(""); setMsg("");
    const v = parseFloat(String(valor).replace(",", "."));
    if (isNaN(v)) { setErro("Valor inválido."); return; }
    const { error } = await supabase.from("dre_config")
      .update({ valor: v, atualizado_em: new Date().toISOString() }).eq("chave", chave);
    if (error) { setErro(error.message); return; }
    setMsg("Salvo.");
    carregar();
  };

  const salvarTaxa = async (forma, campo, valor) => {
    setErro(""); setMsg("");
    const patch = campo === "percentual"
      ? { percentual: parseFloat(String(valor).replace(",", ".")) || 0 }
      : { conta_codigo: valor };
    const { error } = await supabase.from("dre_taxas_recebimento")
      .update(patch).eq("forma_pagamento", forma);
    if (error) { setErro(error.message); return; }
    setMsg("Salvo.");
    carregar();
  };

  const salvarCanal = async (canal, codigo) => {
    setErro(""); setMsg("");
    const { error } = await supabase.from("dre_canais").update({ conta_codigo: codigo }).eq("canal", canal);
    if (error) { setErro(error.message); return; }
    setMsg("Salvo.");
    carregar();
  };

  const descobrir = async () => {
    setErro(""); setMsg("");
    const [{ data: f, error: e1 }, { data: c, error: e2 }] = await Promise.all([
      supabase.rpc("dre_descobrir_formas"),
      supabase.rpc("dre_descobrir_canais"),
    ]);
    if (e1 || e2) { setErro((e1 || e2).message); return; }
    setMsg(`${f || 0} forma(s) de pagamento e ${c || 0} canal(is) novos encontrados.`);
    carregar();
  };

  if (carregando) return <div style={vazio}><Loader2 size={16} /> Carregando…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {erro && <div style={avisoStyle}><AlertTriangle size={16} /><div>{erro}</div></div>}
      {msg && (
        <div style={{ ...avisoStyle, background: "#EAF3DE", borderColor: "#C4DBA6", color: "#27500A" }}>
          <Check size={16} /><div>{msg}</div>
        </div>
      )}

      <div>
        <div style={sectionLabel}>Parâmetros</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {config.map((c) => (
            <div key={c.chave} style={{ ...itemRow, flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: "#22231F" }}>{c.chave}</div>
                <div style={{ fontSize: 11, color: "#8A8778" }}>{c.descricao}</div>
              </div>
              <input defaultValue={c.valor} inputMode="decimal" style={{ ...inputStyle, width: 90 }}
                onBlur={(e) => salvarConfig(c.chave, e.target.value)} />
            </div>
          ))}
        </div>
      </div>

      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ ...sectionLabel, marginBottom: 0 }}>Taxas por forma de recebimento</div>
          <button onClick={descobrir} style={{ ...btnMini, display: "flex", alignItems: "center", gap: 5 }}>
            <RefreshCw size={12} /> Procurar novas
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 8, lineHeight: 1.6 }}>
          O percentual que a maquininha ou o marketplace retém. Deixe em 0
          o que não tem taxa (dinheiro, pix direto). Use a conta 2.3 para
          iFood e 99Food, 2.2 para cartão.
        </div>
        {taxas.length === 0 ? (
          <div style={vazio}>Nenhuma forma cadastrada. Clique em "Procurar novas".</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {taxas.map((t) => (
              <div key={t.forma_pagamento} style={{ ...itemRow, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 150 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "#22231F" }}>{t.rotulo || t.forma_pagamento}</div>
                  <div style={{ fontSize: 11, color: "#8A8778", fontFamily: "ui-monospace, monospace" }}>{t.forma_pagamento}</div>
                </div>
                <select defaultValue={t.conta_codigo || "2.2"} style={{ ...inputStyle, width: 120 }}
                  onChange={(e) => salvarTaxa(t.forma_pagamento, "conta_codigo", e.target.value)}>
                  <option value="2.2">2.2 Cartão</option>
                  <option value="2.3">2.3 Marketplace</option>
                </select>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input defaultValue={t.percentual} inputMode="decimal" style={{ ...inputStyle, width: 70 }}
                    onBlur={(e) => salvarTaxa(t.forma_pagamento, "percentual", e.target.value)} />
                  <span style={{ fontSize: 12, color: "#8A8778" }}>%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div style={sectionLabel}>Canais de venda</div>
        <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 8, lineHeight: 1.6 }}>
          Para onde cada canal do CardápioWeb vai na receita. O que estiver
          em 1.9 ainda não foi mapeado.
        </div>
        {canais.length === 0 ? (
          <div style={vazio}>Nenhum canal cadastrado.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {canais.map((c) => (
              <div key={c.canal} style={itemRow}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "#22231F" }}>{c.rotulo || c.canal}</div>
                  <div style={{ fontSize: 11, color: "#8A8778", fontFamily: "ui-monospace, monospace" }}>{c.canal}</div>
                </div>
                <select defaultValue={c.conta_codigo} style={{ ...inputStyle, minWidth: 170 }}
                  onChange={(e) => salvarCanal(c.canal, e.target.value)}>
                  {contasReceita.map((p) => (
                    <option key={p.codigo} value={p.codigo}>{p.codigo} — {p.nome}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// =====================================================================
// Estilos — mesmos tokens do resto do painel
// =====================================================================
const subTab = {
  display: "flex", alignItems: "center", gap: 5,
  padding: "7px 12px", borderRadius: 999, border: "1px solid #E8E2D2",
  background: "#FFFFFF", color: "#8A8778", fontSize: 12, fontWeight: 600, cursor: "pointer",
};
const subTabAtiva = { background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" };
const cardStyle = {
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14,
};
const inputStyle = {
  padding: "9px 10px", borderRadius: 8, border: "1px solid #E8E2D2",
  fontSize: 13, background: "#FFFFFF", color: "#22231F",
};
const btnSecondary = {
  background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F",
  borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const btnPrimary = {
  background: "#22231F", border: "1px solid #22231F", color: "#F3EFE3",
  borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
};
const btnMini = {
  background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F",
  borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer",
};
const iconBtnPeq = {
  width: 30, height: 30, borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#A32D2D",
};
const avisoStyle = {
  display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A",
  color: "#7A6A1E", borderRadius: 10, padding: "14px", fontSize: 13, alignItems: "flex-start",
};
const statBox = {
  flex: 1, minWidth: 130, background: "#FFFFFF", border: "1px solid #E8E2D2",
  borderRadius: 12, padding: "12px 14px", textAlign: "center",
};
const statNum = { fontSize: 18, fontWeight: 800, color: "#22231F", fontVariantNumeric: "tabular-nums" };
const statLabel = { fontSize: 11, color: "#8A8778", marginTop: 2 };
const sectionLabel = {
  fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
  color: "#8A8778", marginBottom: 8,
};
const itemRow = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10, padding: "10px 12px",
};
const vazio = {
  display: "flex", alignItems: "center", gap: 8,
  fontSize: 13, color: "#8A8778", padding: "16px 0",
};
