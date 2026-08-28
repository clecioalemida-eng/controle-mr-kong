// ===== DRE.jsx =====
import React, { useState, useEffect, useCallback } from "react";
import {
  Loader2, AlertTriangle, RefreshCw, Plus, Trash2, Check,
  Calculator, Package, Tag, Settings, List, Lock, Pencil, Power, Eye, Printer,
  ChevronDown, ChevronRight,
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

// Abre a nota original em outra aba.
//
// A aba precisa nascer ANTES do await: o Safari só deixa window.open
// passar se ele acontecer no mesmo instante do clique. Depois que o
// link assinado chega, a gente só troca o endereço da aba que já existe.
async function abrirNota(caminho) {
  const aba = window.open("", "_blank");
  const { data, error } = await supabase.storage
    .from("notas-fiscais").createSignedUrl(caminho, 3600);
  if (error || !data?.signedUrl) {
    if (aba) aba.close();
    alert("Não consegui abrir a nota: " + (error?.message || ""));
    return;
  }
  if (aba) { aba.location.href = data.signedUrl; return; }
  window.location.href = data.signedUrl;
}

const ABAS = [
  { chave: "dre",         label: "Demonstrativo", icone: Calculator },
  { chave: "classificar", label: "Classificar",   icone: Tag },
  { chave: "lancamentos", label: "Lançamentos",   icone: Plus },
  { chave: "imobilizado", label: "Imobilizado",   icone: Package },
  { chave: "listas",      label: "Listas",        icone: List },
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
const NOMES_MES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
function mesPorExtenso(mes) {
  const [a, m] = String(mes || "").split("-").map(Number);
  if (!a || !m) return mes || "";
  return `${NOMES_MES[m - 1]} de ${a}`;
}
// Chave do fornecedor: sem acento, sem pontuação, sem caixa, e sem a
// forma jurídica no fim — "STONE PAGAMENTOS" e "Stone Pagamentos S/A"
// são o mesmo fornecedor, e a nota vem ora de um jeito ora de outro.
//
// Tem que ser IDÊNTICA à função chave_fornecedor() do banco (migração
// 094). Duas normalizações diferentes pro mesmo dado é como ter dois
// cadastros: a tela aprende numa chave e procura noutra.
const SUFIXOS_JURIDICOS = ["ltda", "sa", "s", "a", "me", "mei", "epp", "eireli", "cia", "ss", "ltd", "filial", "matriz"];
function chaveFornecedor(nome) {
  const texto = String(nome || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    // pontuação vira espaço, não some: "s/a" precisa virar "s a" pra que
    // as duas letras sejam vistas como sufixo, e não coladas no nome.
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!texto) return "";
  const partes = texto.split(" ");
  // tira do fim, uma de cada vez, enquanto for forma jurídica. Só no FIM
  // e só palavra inteira: cortar "me" de dentro de "creme" transformaria
  // a Sorveteria Creme noutro fornecedor.
  while (partes.length > 1 && SUFIXOS_JURIDICOS.includes(partes[partes.length - 1])) {
    partes.pop();
  }
  return partes.join("");
}
function agoraTexto() {
  const d = new Date();
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

export default function DRE({ permissoes }) {
  const editar = podeEditar(permissoes, "financeiro.dre");
  const admin = !!permissoes?.admin;
  const [aba, setAba] = useState("dre");

  const soAdmin = ["config", "listas"];
  const abasVisiveis = ABAS.filter((a) => (soAdmin.includes(a.chave) ? admin : true));

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

      {aba === "dre" && <Demonstrativo irPara={setAba} />}
      {aba === "classificar" && <Classificar editar={editar} />}
      {aba === "lancamentos" && <Lancamentos editar={editar} />}
      {aba === "imobilizado" && <Imobilizado editar={editar} />}
      {aba === "listas" && admin && <Listas />}
      {aba === "config" && admin && <Configuracao />}
    </div>
  );
}

// =====================================================================
// 1. O demonstrativo
// =====================================================================
// ---------------------------------------------------------------------
// A folha do DRE — o que sai no papel
//
// Fica escondida na tela (.folha-pdf tem display:none no index.css) e só
// aparece na impressão. O navegador faz o PDF: "Salvar como PDF" no Mac,
// "Compartilhar > Imprimir" no iPhone. Sem biblioteca nova no build.
//
// Duas coisas que o papel PRECISA levar junto:
//
//   1. Os avisos. Cobertura de ficha técnica e contas sem classificação
//      mudam a leitura do número. Um DRE impresso sem eles vira um
//      documento que mente por omissão — e papel circula, sai do
//      contexto e volta seis meses depois sem ninguém lembrar da
//      ressalva que estava na tela.
//   2. Quem emitiu, quando. Duas folhas do mesmo mês com números
//      diferentes vão acontecer (uma conta classificada no meio do
//      caminho já muda tudo). O que resolve a dúvida é saber qual saiu
//      depois.
// ---------------------------------------------------------------------
function FolhaDRE({ mes, linhas, receitaBruta, lucro, pctCobertura, semFicha, semClassificar, emitidoPor }) {
  const tdCab = {
    borderBottom: "1.5px solid #231A18", padding: "6px 4px", fontSize: 9.5, fontWeight: 800,
    textTransform: "uppercase", letterSpacing: 0.5, color: "#8B8071", textAlign: "left",
  };
  const td = { padding: "6px 4px", borderBottom: "1px solid #F3EBDD", fontSize: 11.5 };
  const n = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  const caixa = { flex: 1, padding: "9px 12px", borderRight: "1px solid #F3EBDD" };
  const caixaLabel = { fontSize: 9, textTransform: "uppercase", letterSpacing: 0.5, color: "#8B8071", fontWeight: 800 };
  const caixaValor = { fontSize: 15, fontWeight: 800, marginTop: 3, fontVariantNumeric: "tabular-nums" };

  return (
    <div className="folha-pdf">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16,
                    borderBottom: "1.5px solid #231A18", paddingBottom: 10 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: -0.2 }}>Mr. Kong Fast Food</div>
          <div style={{ fontSize: 11, color: "#8B8071", marginTop: 2 }}>
            Demonstrativo de Resultado · {mesPorExtenso(mes)}
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: 9.5, color: "#8B8071", lineHeight: 1.6 }}>
          emitido em {agoraTexto()}
          {emitidoPor ? <><br />por {emitidoPor}</> : null}
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
        <thead>
          <tr>
            <td style={{ ...tdCab, width: 34 }}>Cód</td>
            <td style={tdCab}>Conta</td>
            <td style={{ ...tdCab, textAlign: "right", width: 110 }}>Valor</td>
            <td style={{ ...tdCab, textAlign: "right", width: 62 }}>% receita</td>
          </tr>
        </thead>
        <tbody>
          {(linhas || []).map((l) => {
            const ehSubtotal = l.secao === "subtotal";
            const ehGrupo = l.nivel === 0 && !ehSubtotal;
            const forte = ehGrupo || ehSubtotal;
            const negativo = Number(l.valor) < 0;
            return (
              <tr key={`folha-${l.codigo}-${l.ordem}`}>
                <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontSize: 9.5, color: "#B4AF9E" }}>
                  {l.nivel === 1 ? l.codigo : ""}
                </td>
                <td style={{ ...td, fontWeight: forte ? 800 : 400, paddingLeft: l.nivel === 1 ? 16 : 4,
                             background: ehSubtotal ? "#FBF7EE" : "transparent" }}>
                  {ehSubtotal ? `= ${l.nome}` : l.nome}
                </td>
                <td style={{ ...n, fontWeight: forte ? 800 : 400, color: negativo ? "#8C2F22" : "#231A18",
                             background: ehSubtotal ? "#FBF7EE" : "transparent" }}>
                  {brl(l.valor)}
                </td>
                <td style={{ ...n, color: "#8B8071", background: ehSubtotal ? "#FBF7EE" : "transparent" }}>
                  {forte ? pct(l.valor, receitaBruta) : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="nao-quebrar" style={{ display: "flex", marginTop: 16, border: "1.5px solid #231A18", borderRadius: 3, overflow: "hidden" }}>
        <div style={caixa}>
          <div style={caixaLabel}>Receita bruta</div>
          <div style={caixaValor}>{brl(receitaBruta)}</div>
        </div>
        <div style={caixa}>
          <div style={caixaLabel}>Lucro líquido</div>
          <div style={caixaValor}>{brl(lucro)}</div>
        </div>
        <div style={{ ...caixa, borderRight: "none" }}>
          <div style={caixaLabel}>Margem líquida</div>
          <div style={caixaValor}>{receitaBruta ? `${((lucro / receitaBruta) * 100).toFixed(1)}%` : "—"}</div>
        </div>
      </div>

      <div className="nao-quebrar" style={{ marginTop: 14, fontSize: 9.5, color: "#8B8071", lineHeight: 1.75 }}>
        {pctCobertura !== null && pctCobertura < 95 && (
          <div style={{ borderLeft: "2.5px solid #C9A227", paddingLeft: 8, margin: "8px 0" }}>
            <b style={{ color: "#231A18" }}>{pctCobertura.toFixed(0)}% da venda tem ficha técnica.</b>{" "}
            Os {brl(semFicha)} restantes entraram com custo zero — o CMV acima está menor que a
            realidade e o lucro, maior.
          </div>
        )}
        {semClassificar > 0 && (
          <div style={{ borderLeft: "2.5px solid #C9A227", paddingLeft: 8, margin: "8px 0" }}>
            <b style={{ color: "#231A18" }}>
              {semClassificar} conta(s) a pagar sem classificação
            </b>{" "}
            não entraram neste demonstrativo.
          </div>
        )}
        O percentual é sobre a receita bruta. <b style={{ color: "#231A18" }}>Compra de insumo não
        aparece aqui</b> — o custo entra pelo consumo, na linha 3.1. Compra de equipamento também não —
        vira depreciação, na 10.1. Taxa de serviço é repasse do garçom, não receita da casa, e por isso
        sai como dedução.
      </div>

      <div className="nao-quebrar" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 26, marginTop: 38 }}>
        <div style={{ borderTop: "1px solid #231A18", paddingTop: 5, fontSize: 9.5, color: "#8B8071", textAlign: "center" }}>
          Responsável pelo fechamento
        </div>
        <div style={{ borderTop: "1px solid #231A18", paddingTop: 5, fontSize: 9.5, color: "#8B8071", textAlign: "center" }}>
          Conferido por
        </div>
      </div>

      <div style={{ marginTop: 18, paddingTop: 7, borderTop: "1px solid #E9DFCE", fontSize: 9,
                    color: "#8B8071", display: "flex", justifyContent: "space-between" }}>
        <span>Painel Mr. Kong</span><span>DRE {mesPorExtenso(mes)}</span>
      </div>
    </div>
  );
}

function Demonstrativo({ irPara }) {
  const [mes, setMes] = useState(mesAtual());
  const [linhas, setLinhas] = useState(null);
  const [cobertura, setCobertura] = useState(null);
  const [semClassificar, setSemClassificar] = useState(0);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [emitidoPor, setEmitidoPor] = useState("");

  // Nome de quem está com a tela aberta, pra assinar a folha. Busca uma
  // vez só — não muda no meio do mês.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data: usuario } = await supabase.auth.getUser();
      if (!usuario?.user?.id) return;
      const { data: perfil } = await supabase
        .from("perfis").select("nome").eq("id", usuario.user.id).maybeSingle();
      if (vivo) setEmitidoPor(perfil?.nome || "");
    })();
    return () => { vivo = false; };
  }, []);

  // O setTimeout dá um respiro pro React desenhar a folha antes do
  // navegador congelar a tela pra impressão. Sem ele, em telas grandes,
  // a caixa de impressão às vezes abre com a folha ainda em branco.
  const imprimir = () => { setTimeout(() => window.print(), 60); };

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
        {linhas && (
          <button onClick={imprimir} style={{ ...btnPrimary, display: "flex", alignItems: "center", gap: 6, padding: "9px 14px", fontSize: 13 }}>
            <Printer size={14} /> Imprimir / PDF
          </button>
        )}
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
            {/* O aviso vira o caminho. Dizer "resolva na aba Classificar" e
                deixar a pessoa procurar a aba é pedir duas vezes o mesmo
                trabalho — e é o tipo de coisa que faz a lista de pendência
                crescer até ninguém mais olhar. */}
            {irPara && (
              <div style={{ marginTop: 8 }}>
                <button onClick={() => irPara("classificar")}
                  style={{ background: "#22231F", color: "#F3EFE3", border: "none", borderRadius: 8,
                           padding: "8px 13px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  Classificar {semClassificar === 1 ? "a conta" : `as ${semClassificar} contas`} agora
                </button>
              </div>
            )}
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

          <FolhaDRE
            mes={mes}
            linhas={linhas}
            receitaBruta={receitaBruta}
            lucro={lucro}
            pctCobertura={pctCobertura}
            semFicha={semFicha}
            semClassificar={semClassificar}
            emitidoPor={emitidoPor}
          />
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
  // O que o painel aprendeu: { chave_do_fornecedor: regra }. Fica em
  // memoria pra sugerir enquanto voce classifica, e aparece por inteiro
  // na lista do rodape — memoria que ninguem ve, ninguem confere.
  const [regras, setRegras] = useState({});
  const [confirmando, setConfirmando] = useState(false);
  const [esquecendo, setEsquecendo] = useState(null);
  const [verAprendido, setVerAprendido] = useState(false);

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
    const lista = cs || [];

    // O documento_compra_id sozinho não diz se existe arquivo pra abrir:
    // compra digitada à mão também gera documento, só que sem nota. Por
    // isso a segunda consulta — o olho só aparece quando tem arquivo.
    const ids = [...new Set(lista.map((c) => c.documento_compra_id).filter(Boolean))];
    let arquivos = {};
    if (ids.length > 0) {
      const { data: docs } = await supabase
        .from("documentos_compra")
        .select("id, arquivo_path, origem")
        .in("id", ids);
      (docs || []).forEach((d) => { arquivos[d.id] = d; });
    }

    setContas(lista.map((c) => {
      const doc = c.documento_compra_id ? arquivos[c.documento_compra_id] : null;
      return { ...c, arquivo_path: doc?.arquivo_path || null, manual: !!doc && !doc.arquivo_path };
    }));
    setPlano(pl || []);
    {
      const { data: rs } = await supabase
        .from("classificacao_regras")
        .select("fornecedor_chave, fornecedor_exemplo, plano_conta, vezes_usada");
      setRegras(Object.fromEntries((rs || []).map((r) => [r.fornecedor_chave, r])));
    }
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const nomeFornecedor = (c) => c.fornecedor_nome || c.descricao || "";

  // Guarda a decisão pro futuro. A regra é sempre a ÚLTIMA escolha, não a
  // primeira: se você mudar a conta de um fornecedor, é porque a de antes
  // não servia mais.
  const aprender = async (conta, codigo) => {
    const nome = nomeFornecedor(conta);
    const chave = chaveFornecedor(nome);
    if (!chave) return;
    const { data: usuario } = await supabase.auth.getUser();
    const anterior = regras[chave];
    const vezes = anterior && anterior.plano_conta === codigo ? (anterior.vezes_usada || 0) + 1 : 1;
    const linha = {
      fornecedor_chave: chave,
      fornecedor_exemplo: nome,
      plano_conta: codigo,
      vezes_usada: vezes,
      atualizada_em: new Date().toISOString(),
      criado_por: usuario?.user?.id || null,
    };
    await supabase.from("classificacao_regras").upsert(linha, { onConflict: "fornecedor_chave" });
    setRegras((r) => ({ ...r, [chave]: linha }));
  };

  const classificar = async (conta, codigo) => {
    if (!codigo) return;
    setSalvando(conta.id);
    setErro("");
    const { error } = await supabase.from("contas_pagar")
      .update({ plano_conta: codigo }).eq("id", conta.id);
    if (error) { setSalvando(null); setErro(error.message); return; }
    await aprender(conta, codigo);
    setSalvando(null);
    setContas((atual) => atual.filter((c) => c.id !== conta.id));
  };

  const sugestaoDe = (c) => regras[chaveFornecedor(nomeFornecedor(c))] || null;
  const comSugestao = contas.filter((c) => sugestaoDe(c));

  // Confirma em lote o que o painel já sabia. Grava só depois do clique:
  // classificação move dinheiro pro DRE, e regra errada aplicada em
  // silêncio contamina o mês inteiro antes de alguém notar.
  const confirmarSugeridas = async () => {
    if (comSugestao.length === 0) return;
    if (!window.confirm(
      `Classificar ${comSugestao.length} conta(s) com o que o painel aprendeu?\n\n` +
      "Você pode mudar qualquer uma depois, na aba Contas a pagar."
    )) return;
    setConfirmando(true);
    setErro("");
    const feitas = [];
    for (const c of comSugestao) {
      const codigo = sugestaoDe(c).plano_conta;
      const { error } = await supabase.from("contas_pagar")
        .update({ plano_conta: codigo }).eq("id", c.id);
      if (error) { setConfirmando(false); setErro(error.message); return; }
      await aprender(c, codigo);
      feitas.push(c.id);
    }
    setConfirmando(false);
    setContas((atual) => atual.filter((c) => !feitas.includes(c.id)));
  };

  // Ordem: o que ele mais usa em cima — se tem uma regra errada
  // estragando muita conta, ela e a primeira que voce ve.
  const listaRegras = Object.values(regras).sort(
    (a, b) => (b.vezes_usada || 1) - (a.vezes_usada || 1) ||
      String(a.fornecedor_exemplo || "").localeCompare(String(b.fornecedor_exemplo || ""))
  );

  const esquecer = async (chave) => {
    setEsquecendo(chave);
    await supabase.from("classificacao_regras").delete().eq("fornecedor_chave", chave);
    setRegras((r) => { const n = { ...r }; delete n[chave]; return n; });
    setEsquecendo(null);
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

      {/* O painel já sabe a resposta de parte da fila. Ele PREENCHE e
          espera o aval — nunca grava sozinho. Classificação move dinheiro
          pro DRE; regra errada aplicada em silêncio contamina o mês
          inteiro antes de alguém notar. Confirmar em lote é um clique;
          descobrir o erro três meses depois é uma tarde. */}
      {editar && comSugestao.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap",
                      background: "#FBFAFE", border: "1px solid #C9BEE8", borderRadius: 12,
                      padding: "11px 13px", marginBottom: 10 }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase",
                         padding: "3px 9px", borderRadius: 999, background: "#EAE4F7", color: "#4C3E77" }}>
            aprendido
          </span>
          <div style={{ flex: 1, minWidth: 200, fontSize: 12.5, lineHeight: 1.55 }}>
            <b>{comSugestao.length} de {contas.length} contas já têm resposta.</b>{" "}
            Você classificou esses fornecedores antes — o painel preencheu e está esperando seu aval.
          </div>
          <button onClick={confirmarSugeridas} disabled={confirmando}
            style={{ background: "#22231F", color: "#F3EFE3", border: "none", borderRadius: 8,
                     padding: "9px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            {confirmando ? "confirmando…" : `Confirmar as ${comSugestao.length}`}
          </button>
        </div>
      )}

      {contas.length === 0 ? (
        <div style={{ ...cardStyle, display: "flex", alignItems: "center", gap: 8, color: "#27500A", fontSize: 13 }}>
          <Check size={16} /> Nenhuma conta pendente de classificação.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {contas.map((c) => (
            <div key={c.id} style={{ ...itemRow, flexWrap: "wrap" }}>
              {c.arquivo_path ? (
                <button
                  onClick={() => abrirNota(c.arquivo_path)}
                  style={olhoBtn}
                  title="Abrir a nota em outra aba"
                  aria-label="Abrir a nota em outra aba"
                >
                  <Eye size={17} color="#3A6684" />
                </button>
              ) : c.manual ? (
                <div style={{ ...olhoVazio, border: "1px dashed #E0DACA", gap: 1 }}
                  title="Compra digitada à mão, sem nota">
                  <Plus size={13} color="#3A6684" />
                  <span style={{ fontSize: 7, fontWeight: 800, color: "#3A6684", letterSpacing: 0.2 }}>MANUAL</span>
                </div>
              ) : (
                // Lançamento avulso (Stone, gás, diária): não veio de nota
                // nenhuma. O espaço fica reservado só pra lista não dançar.
                <div style={olhoVazio} />
              )}
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
                {sugestaoDe(c) ? (
                  <div style={{ fontSize: 11, color: "#4C3E77", marginTop: 2 }}>
                    aprendido de {sugestaoDe(c).vezes_usada || 1}{" "}
                    {(sugestaoDe(c).vezes_usada || 1) === 1 ? "nota anterior" : "notas anteriores"} deste fornecedor
                  </div>
                ) : (
                  <div style={{ fontSize: 11, color: "#8A6A0F", marginTop: 2 }}>
                    primeira vez deste fornecedor — você decide
                  </div>
                )}
              </div>
              <select
                defaultValue={sugestaoDe(c)?.plano_conta || ""}
                disabled={!editar || salvando === c.id}
                onChange={(e) => classificar(c, e.target.value)}
                style={{ ...inputStyle, minWidth: 210,
                         ...(sugestaoDe(c) ? { borderColor: "#C9BEE8", background: "#FBFAFE", fontWeight: 600 } : {}) }}
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

      {/* Memoria que ninguem ve e memoria que ninguem consegue corrigir.
          Se o painel aprendeu errado — o fornecedor mudou de ramo, alguem
          classificou com pressa — tem que dar pra abrir a lista, ver o
          que ele acha que sabe, e apagar a linha errada. Esquecer NAO
          desfaz classificacao nenhuma: as contas ja lancadas continuam
          onde estao, so para de sugerir dali pra frente. */}
      {listaRegras.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <button
            onClick={() => setVerAprendido((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: 7, background: "none", border: "none",
                     padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5,
                     fontWeight: 700, color: "#4C3E77" }}
          >
            {verAprendido ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            O que o painel já sabe ({listaRegras.length}{" "}
            {listaRegras.length === 1 ? "fornecedor" : "fornecedores"})
          </button>

          {verAprendido && (
            <div style={{ marginTop: 9, border: "1px solid #E6E1D3", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "9px 13px", background: "#FBFAFE", borderBottom: "1px solid #EAE4F7",
                            fontSize: 11.5, color: "#4C3E77", lineHeight: 1.55 }}>
                Cada linha é uma decisão sua que o painel guardou. <b>Esquecer</b> não
                mexe em nada que já foi lançado — só faz o painel parar de sugerir
                aquela conta pra esse fornecedor.
              </div>
              <div style={{ maxHeight: 340, overflowY: "auto" }}>
                {listaRegras.map((r, i) => {
                  const conta = plano.find((p) => p.codigo === r.plano_conta);
                  return (
                    <div key={r.fornecedor_chave}
                      style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                               padding: "10px 13px",
                               borderTop: i === 0 ? "none" : "1px solid #F1EDE1" }}>
                      <div style={{ flex: 1, minWidth: 190 }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: "#22231F" }}>
                          {r.fornecedor_exemplo || r.fornecedor_chave}
                        </div>
                        <div style={{ fontSize: 11, color: "#8A8778", marginTop: 1 }}>
                          {r.plano_conta}{conta ? ` — ${conta.nome}` : ""}
                        </div>
                      </div>
                      <span style={{ fontSize: 10.5, fontWeight: 700, color: "#4C3E77", background: "#EAE4F7",
                                     borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>
                        {r.vezes_usada || 1}{" "}
                        {(r.vezes_usada || 1) === 1 ? "vez" : "vezes"}
                      </span>
                      {editar && (
                        <button
                          onClick={() => esquecer(r.fornecedor_chave)}
                          disabled={esquecendo === r.fornecedor_chave}
                          style={{ background: "none", border: "1px solid #E0DACA", borderRadius: 8,
                                   padding: "5px 10px", fontSize: 11.5, cursor: "pointer",
                                   fontFamily: "inherit", color: "#8A6A0F", whiteSpace: "nowrap" }}
                        >
                          {esquecendo === r.fornecedor_chave ? "esquecendo…" : "esquecer"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
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

  // Quantos meses de depreciacao ainda faltam para este bem.
  // O DRE so cobra o desgaste DENTRO da vida util: uma chapa de 5 anos
  // comprada em 2018 nao gera mais despesa nenhuma. Se a tela somasse
  // todo mundo que esta "ativo", o numero daqui nunca bateria com o do
  // Demonstrativo — e a pessoa perderia a tarde procurando a diferenca.
  const mesesRestantes = (b) => {
    const vida = Number(b.vida_util_meses) || 0;
    if (!b.data_aquisicao || vida <= 0) return 0;
    const [ano, mes] = b.data_aquisicao.split("-").map(Number);
    const hoje = new Date();
    const decorridos =
      (hoje.getFullYear() - ano) * 12 + (hoje.getMonth() + 1 - mes);
    return Math.max(0, vida - Math.max(0, decorridos));
  };
  const depreciando = (b) => b.ativo && mesesRestantes(b) > 0;
  const depreciacaoMes = lista
    .filter(depreciando)
    .reduce((s, b) => s + (Number(b.valor) || 0) / (Number(b.vida_util_meses) || 1), 0);
  const jaQuitados = lista.filter((b) => b.ativo && mesesRestantes(b) === 0).length;

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
        <div style={statLabel}>
          Depreciação deste mês — é este valor que entra no DRE, conta 10.1
        </div>
        {jaQuitados > 0 && (
          <div style={{ fontSize: 11, color: "#8A8778", marginTop: 6 }}>
            {jaQuitados} bem(ns) já passaram da vida útil e não geram mais
            despesa. Continuam na lista porque ainda são seus — só pararam
            de custar.
          </div>
        )}
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
                {b.ativo && (
                  <div style={{ fontSize: 11, marginTop: 2, color: depreciando(b) ? "#185FA5" : "#8A8778" }}>
                    {depreciando(b)
                      ? `faltam ${mesesRestantes(b)} ${mesesRestantes(b) === 1 ? "mês" : "meses"} de depreciação`
                      : "já totalmente depreciado — não entra mais no DRE"}
                  </div>
                )}
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
// =====================================================================
// 6. Listas do sistema
//
// O plano de contas e as três listas que antes viviam fixas no código
// (formas de pagamento, categorias de conta recorrente e centros de
// custo). Só administrador chega aqui.
//
// A regra que vale nas quatro: nada em uso é apagado. Quem já tem
// lançamento só pode ser DESLIGADO — some dos menus, para de aceitar
// coisa nova, e os meses fechados continuam batendo. Quem nunca foi
// usado some de verdade.
// =====================================================================

const GRUPOS = [
  { n: 0,  label: "0 — Fora do DRE (sai do caixa, não é resultado)" },
  { n: 1,  label: "1 — Receita bruta" },
  { n: 2,  label: "2 — Deduções da receita" },
  { n: 3,  label: "3 — Custo da mercadoria vendida" },
  { n: 4,  label: "4 — Pessoal" },
  { n: 5,  label: "5 — Ocupação" },
  { n: 6,  label: "6 — Utilidades" },
  { n: 7,  label: "7 — Comercial e marketing" },
  { n: 8,  label: "8 — Administrativo" },
  { n: 9,  label: "9 — Manutenção e utensílios" },
  { n: 10, label: "10 — Não operacional" },
];
const TIPOS = [
  { v: "patrimonial",     label: "Patrimonial — só caixa" },
  { v: "receita",         label: "Receita" },
  { v: "deducao",         label: "Dedução" },
  { v: "cmv",             label: "CMV" },
  { v: "despesa",         label: "Despesa" },
  { v: "nao_operacional", label: "Não operacional" },
];
const SUBLISTAS = [
  { chave: "plano",                label: "Plano de contas" },
  { chave: "forma_pagamento",      label: "Formas de pagamento" },
  { chave: "categoria_recorrente", label: "Contas recorrentes" },
  { chave: "centro_custo",         label: "Centros de custo" },
];

// A chave gravada no banco sai do rótulo, sem acento e sem espaço.
// Ela nunca muda depois de criada: é ela que está escrita nas contas
// antigas. O rótulo, esse pode mudar à vontade.
function chaveDoRotulo(texto) {
  return String(texto || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function Listas() {
  const [qual, setQual] = useState("plano");
  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {SUBLISTAS.map((l) => (
          <button key={l.chave} onClick={() => setQual(l.chave)}
            style={{ ...subTab, ...(qual === l.chave ? subTabAtiva : {}) }}>
            {l.label}
          </button>
        ))}
      </div>
      {qual === "plano"
        ? <PlanoDeContas />
        : <ListaSimples key={qual} lista={qual} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// 6.1 Plano de contas
// ---------------------------------------------------------------------
const CONTA_VAZIA = { codigo: "", nome: "", grupo: 4, tipo: "despesa", descricao: "", entra_dre: true, ordem: 0 };

function PlanoDeContas() {
  const [contas, setContas] = useState(null);
  const [uso, setUso] = useState({});
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState(null); // { texto, codigo }
  const [editando, setEditando] = useState(null); // codigo
  const [form, setForm] = useState(CONTA_VAZIA);
  const [criando, setCriando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const [rContas, rPagar, rLanc] = await Promise.all([
      supabase.from("plano_contas").select("*").order("ordem"),
      supabase.from("contas_pagar").select("plano_conta"),
      supabase.from("dre_lancamentos").select("conta_codigo"),
    ]);
    if (rContas.error) { setErro(rContas.error.message); return; }
    const contagem = {};
    (rPagar.data || []).forEach((c) => { if (c.plano_conta) contagem[c.plano_conta] = (contagem[c.plano_conta] || 0) + 1; });
    (rLanc.data || []).forEach((l) => { if (l.conta_codigo) contagem[l.conta_codigo] = (contagem[l.conta_codigo] || 0) + 1; });
    setUso(contagem);
    setContas(rContas.data || []);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const abrirNova = () => {
    setForm(CONTA_VAZIA);
    setEditando(null);
    setCriando(true);
    setErro("");
  };
  const abrirEdicao = (c) => {
    setForm({ codigo: c.codigo, nome: c.nome, grupo: c.grupo, tipo: c.tipo, descricao: c.descricao || "", entra_dre: c.entra_dre, ordem: c.ordem });
    setCriando(false);
    setEditando(c.codigo);
    setErro("");
  };
  const fechar = () => { setCriando(false); setEditando(null); setErro(""); };

  const salvar = async () => {
    const codigo = form.codigo.trim();
    if (!codigo || !form.nome.trim()) { setErro("Código e nome são obrigatórios."); return; }
    setSalvando(true);
    const linha = {
      nome: form.nome.trim(),
      grupo: Number(form.grupo),
      tipo: form.tipo,
      descricao: form.descricao.trim() || null,
      entra_dre: form.entra_dre,
      ordem: Number(form.ordem) || Number(form.grupo) * 100,
    };
    const r = criando
      ? await supabase.from("plano_contas").insert({ codigo, origem: "manual", ...linha })
      : await supabase.from("plano_contas").update(linha).eq("codigo", codigo);
    setSalvando(false);
    if (r.error) {
      setErro(/duplicate key|23505/i.test(r.error.message)
        ? `Já existe uma conta com o código ${codigo}.`
        : r.error.message);
      return;
    }
    fechar();
    carregar();
  };

  const alternarAtivo = async (c) => {
    await supabase.from("plano_contas").update({ ativo: !c.ativo }).eq("codigo", c.codigo);
    setAviso(null);
    carregar();
  };

  const excluir = async (c) => {
    setErro("");
    setAviso(null);
    const { error } = await supabase.rpc("excluir_conta_plano", { p_codigo: c.codigo });
    if (error) {
      // O banco explica em português por que não deu. Se for por uso,
      // a saída é desligar — e o botão pra isso aparece junto.
      setAviso({ texto: error.message, codigo: c.travada ? null : c.codigo });
      return;
    }
    carregar();
  };

  if (contas === null) return <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>;

  const porGrupo = GRUPOS.map((g) => ({ ...g, itens: contas.filter((c) => c.grupo === g.n) })).filter((g) => g.itens.length > 0);
  const alvoAviso = aviso?.codigo ? contas.find((c) => c.codigo === aviso.codigo) : null;

  return (
    <div>
      {erro && !criando && !editando && (
        <div style={{ ...avisoStyle, marginBottom: 12 }}><AlertTriangle size={16} /><div>{erro}</div></div>
      )}
      {aviso && (
        <div style={{ ...avisoStyle, marginBottom: 12 }}>
          <AlertTriangle size={16} />
          <div style={{ flex: 1 }}>
            {aviso.texto}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {alvoAviso && alvoAviso.ativo && (
                <button onClick={() => alternarAtivo(alvoAviso)} style={btnMini}>Desligar essa conta</button>
              )}
              <button onClick={() => setAviso(null)} style={btnMini}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {!criando && !editando && (
        <button onClick={abrirNova} style={{ ...btnSecondary, width: "100%", display: "flex", justifyContent: "center", gap: 6, marginBottom: 14 }}>
          <Plus size={14} /> Nova conta
        </button>
      )}

      {(criando || editando) && (
        <FormularioConta form={form} setForm={setForm} criando={criando} salvando={salvando}
          erro={erro} onSalvar={salvar} onCancelar={fechar} />
      )}

      {porGrupo.map((g) => (
        <div key={g.n} style={{ marginBottom: 14 }}>
          <div style={sectionLabel}>{g.label}</div>
          <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF" }}>
            {g.itens.map((c, idx) => {
              const usos = uso[c.codigo] || 0;
              return (
                <div key={c.codigo} style={{
                  display: "flex", alignItems: "center", gap: 9, padding: "9px 12px",
                  borderTop: idx > 0 ? "1px solid #F0EBDD" : "none",
                  background: c.ativo ? "#FFFFFF" : "#FAF8F2",
                }}>
                  <span style={{ fontSize: 11, color: "#8A8778", width: 34, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{c.codigo}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontSize: 13, color: c.ativo ? "#22231F" : "#A8A290",
                      textDecoration: c.ativo ? "none" : "line-through",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{c.nome}</div>
                    {c.descricao && (
                      <div style={{ fontSize: 10, color: "#8A8778", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.descricao}</div>
                    )}
                  </div>
                  {!c.entra_dre && <span style={{ ...selo, background: "#F1EEE4", color: "#7A745E" }}>fora do DRE</span>}
                  {usos > 0 && <span style={{ ...selo, background: "#EAF1F7", color: "#3A6684" }}>{usos}</span>}
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button onClick={() => abrirEdicao(c)} style={iconMini} title="Editar"><Pencil size={13} /></button>
                    <button onClick={() => alternarAtivo(c)} style={iconMini} title={c.ativo ? "Desligar" : "Religar"}>
                      <Power size={13} color={c.ativo ? "#8A8778" : "#0F6E56"} />
                    </button>
                    {c.travada ? (
                      <span style={{ ...iconMini, cursor: "not-allowed", color: "#C0B99F" }} title="O DRE calcula sozinho nessa conta — dá pra renomear, não pra apagar">
                        <Lock size={13} />
                      </span>
                    ) : (
                      <button onClick={() => excluir(c)} style={{ ...iconMini, color: "#A32D2D" }} title="Excluir"><Trash2 size={13} /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div style={{ fontSize: 11, color: "#8A8778", lineHeight: 1.5, padding: "0 2px" }}>
        O cadeado marca as contas em que o próprio DRE escreve pelo código — Simples Nacional,
        taxas de cartão, insumos consumidos, depreciação e as outras automáticas. Renomear pode;
        apagar quebraria o cálculo do mês. O número azul é quantos lançamentos apontam pra conta.
      </div>
    </div>
  );
}

function FormularioConta({ form, setForm, criando, salvando, erro, onSalvar, onCancelar }) {
  const mudar = (campo) => (e) => setForm((f) => ({ ...f, [campo]: e.target.value }));
  return (
    <div style={{ ...cardStyle, marginBottom: 14, display: "grid", gap: 9 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 9 }}>
        <div>
          <label style={rotuloCampo}>Código</label>
          <input value={form.codigo} onChange={mudar("codigo")} disabled={!criando} placeholder="0.3"
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box", background: criando ? "#FFFFFF" : "#F6F1E7", color: criando ? "#22231F" : "#8A8778" }} />
        </div>
        <div>
          <label style={rotuloCampo}>Grupo</label>
          <select value={form.grupo} onChange={mudar("grupo")} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
            {GRUPOS.map((g) => <option key={g.n} value={g.n}>{g.label}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label style={rotuloCampo}>Nome</label>
        <input value={form.nome} onChange={mudar("nome")} placeholder="Pagamento de contas antigas"
          style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
      </div>
      <div>
        <label style={rotuloCampo}>Descrição (aparece embaixo do nome)</label>
        <input value={form.descricao} onChange={mudar("descricao")}
          style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 9 }}>
        <div>
          <label style={rotuloCampo}>Tipo</label>
          <select value={form.tipo} onChange={mudar("tipo")} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
            {TIPOS.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label style={rotuloCampo}>Ordem</label>
          <input type="number" value={form.ordem} onChange={mudar("ordem")}
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
        </div>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#22231F" }}>
        <input type="checkbox" checked={form.entra_dre}
          onChange={(e) => setForm((f) => ({ ...f, entra_dre: e.target.checked }))} />
        Entra no resultado do mês (DRE)
      </label>
      <div style={{ fontSize: 11, color: "#8A8778", lineHeight: 1.5, marginTop: -4 }}>
        Desmarcado, o dinheiro sai do caixa mas não desconta do lucro do mês. É assim que
        funcionam a compra de estoque, o imobilizado e o pagamento de conta antiga.
      </div>
      {erro && <div style={{ fontSize: 12, color: "#A32D2D" }}>{erro}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onSalvar} disabled={salvando} style={btnPrimary}>
          {salvando ? "Salvando…" : criando ? "Criar conta" : "Salvar"}
        </button>
        <button onClick={onCancelar} style={btnSecondary}>Cancelar</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// 6.2 As três listas simples
// ---------------------------------------------------------------------
const COLUNA_DE_USO = {
  forma_pagamento: "forma_pagamento",
  categoria_recorrente: "categoria",
  centro_custo: "centro_custo",
};
const TITULO_LISTA = {
  forma_pagamento: "forma de pagamento",
  categoria_recorrente: "categoria",
  centro_custo: "centro de custo",
};

function ListaSimples({ lista }) {
  const [opcoes, setOpcoes] = useState(null);
  const [centros, setCentros] = useState([]);
  const [uso, setUso] = useState({});
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState(null);
  const [editando, setEditando] = useState(null); // id
  const [form, setForm] = useState({ rotulo: "", centro_custo: "", ordem: 0 });
  const [criando, setCriando] = useState(false);

  const carregar = useCallback(async () => {
    const [rOpc, rPagar] = await Promise.all([
      supabase.from("listas_opcoes").select("*").order("ordem"),
      supabase.from("contas_pagar").select("forma_pagamento, categoria, centro_custo"),
    ]);
    if (rOpc.error) {
      setErro(/does not exist|schema cache/i.test(rOpc.error.message)
        ? "Essas listas ainda não foram instaladas no banco — falta rodar a migração 080."
        : rOpc.error.message);
      setOpcoes([]);
      return;
    }
    const todas = rOpc.data || [];
    setCentros(todas.filter((o) => o.lista === "centro_custo" && o.ativo));
    setOpcoes(todas.filter((o) => o.lista === lista));
    const coluna = COLUNA_DE_USO[lista];
    const contagem = {};
    (rPagar.data || []).forEach((c) => {
      const v = c[coluna];
      if (v) contagem[v] = (contagem[v] || 0) + 1;
    });
    setUso(contagem);
  }, [lista]);

  useEffect(() => { carregar(); }, [carregar]);

  const abrirNova = () => { setForm({ rotulo: "", centro_custo: "", ordem: (opcoes?.length || 0) + 1 }); setEditando(null); setCriando(true); setErro(""); };
  const abrirEdicao = (o) => { setForm({ rotulo: o.rotulo, centro_custo: o.centro_custo || "", ordem: o.ordem }); setCriando(false); setEditando(o.id); setErro(""); };
  const fechar = () => { setCriando(false); setEditando(null); setErro(""); };

  const salvar = async () => {
    const rotulo = form.rotulo.trim();
    if (!rotulo) { setErro("O nome é obrigatório."); return; }
    const linha = {
      rotulo,
      centro_custo: lista === "categoria_recorrente" ? (form.centro_custo || null) : null,
      ordem: Number(form.ordem) || 0,
    };
    let r;
    if (criando) {
      const valor = chaveDoRotulo(rotulo);
      if (!valor) { setErro("Esse nome não gera uma chave válida — use letras ou números."); return; }
      r = await supabase.from("listas_opcoes").insert({ lista, valor, ...linha });
    } else {
      r = await supabase.from("listas_opcoes").update(linha).eq("id", editando);
    }
    if (r.error) {
      setErro(/duplicate key|23505/i.test(r.error.message)
        ? "Já existe uma opção com esse nome nessa lista."
        : r.error.message);
      return;
    }
    fechar();
    carregar();
  };

  const alternarAtivo = async (o) => {
    await supabase.from("listas_opcoes").update({ ativo: !o.ativo }).eq("id", o.id);
    setAviso(null);
    carregar();
  };

  const excluir = async (o) => {
    setAviso(null);
    const { error } = await supabase.rpc("excluir_opcao_lista", { p_id: o.id });
    if (error) { setAviso({ texto: error.message, id: o.id }); return; }
    carregar();
  };

  if (opcoes === null) return <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>;

  const alvoAviso = aviso?.id ? opcoes.find((o) => o.id === aviso.id) : null;

  return (
    <div>
      {erro && !criando && !editando && (
        <div style={{ ...avisoStyle, marginBottom: 12 }}><AlertTriangle size={16} /><div>{erro}</div></div>
      )}
      {aviso && (
        <div style={{ ...avisoStyle, marginBottom: 12 }}>
          <AlertTriangle size={16} />
          <div style={{ flex: 1 }}>
            {aviso.texto}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              {alvoAviso && alvoAviso.ativo && (
                <button onClick={() => alternarAtivo(alvoAviso)} style={btnMini}>Desligar</button>
              )}
              <button onClick={() => setAviso(null)} style={btnMini}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {!criando && !editando && (
        <button onClick={abrirNova} style={{ ...btnSecondary, width: "100%", display: "flex", justifyContent: "center", gap: 6, marginBottom: 14 }}>
          <Plus size={14} /> Nova {TITULO_LISTA[lista]}
        </button>
      )}

      {(criando || editando) && (
        <div style={{ ...cardStyle, marginBottom: 14, display: "grid", gap: 9 }}>
          <div>
            <label style={rotuloCampo}>Nome</label>
            <input value={form.rotulo} onChange={(e) => setForm((f) => ({ ...f, rotulo: e.target.value }))}
              autoFocus style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
            {criando && form.rotulo.trim() && (
              <div style={{ fontSize: 10, color: "#8A8778", marginTop: 3 }}>
                Vai ficar gravado no banco como <strong>{chaveDoRotulo(form.rotulo)}</strong> — isso não muda depois.
              </div>
            )}
          </div>
          {lista === "categoria_recorrente" && (
            <div>
              <label style={rotuloCampo}>Centro de custo</label>
              <select value={form.centro_custo} onChange={(e) => setForm((f) => ({ ...f, centro_custo: e.target.value }))}
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}>
                <option value="">— nenhum —</option>
                {centros.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
              </select>
              <div style={{ fontSize: 10, color: "#8A8778", marginTop: 3 }}>
                A conta recebe esse centro sozinha. Sem ele, ela cai em "sem centro de custo" no Dashboard.
              </div>
            </div>
          )}
          <div>
            <label style={rotuloCampo}>Ordem</label>
            <input type="number" value={form.ordem} onChange={(e) => setForm((f) => ({ ...f, ordem: e.target.value }))}
              style={{ ...inputStyle, width: 110 }} />
          </div>
          {erro && <div style={{ fontSize: 12, color: "#A32D2D" }}>{erro}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={salvar} style={btnPrimary}>{criando ? "Criar" : "Salvar"}</button>
            <button onClick={fechar} style={btnSecondary}>Cancelar</button>
          </div>
        </div>
      )}

      <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF" }}>
        {opcoes.map((o, idx) => {
          const usos = uso[o.valor] || 0;
          const centro = centros.find((c) => c.valor === o.centro_custo);
          return (
            <div key={o.id} style={{
              display: "flex", alignItems: "center", gap: 9, padding: "9px 12px",
              borderTop: idx > 0 ? "1px solid #F0EBDD" : "none",
              background: o.ativo ? "#FFFFFF" : "#FAF8F2",
            }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontSize: 13, color: o.ativo ? "#22231F" : "#A8A290",
                  textDecoration: o.ativo ? "none" : "line-through",
                }}>{o.rotulo}</div>
                {lista === "categoria_recorrente" && (
                  <div style={{ fontSize: 10, color: centro ? "#8A8778" : "#A32D2D" }}>
                    {centro ? `centro de custo: ${centro.rotulo}` : "sem centro de custo"}
                  </div>
                )}
              </div>
              {usos > 0 && <span style={{ ...selo, background: "#EAF1F7", color: "#3A6684" }}>{usos} {usos === 1 ? "conta" : "contas"}</span>}
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                <button onClick={() => abrirEdicao(o)} style={iconMini} title="Editar"><Pencil size={13} /></button>
                <button onClick={() => alternarAtivo(o)} style={iconMini} title={o.ativo ? "Desligar" : "Religar"}>
                  <Power size={13} color={o.ativo ? "#8A8778" : "#0F6E56"} />
                </button>
                <button onClick={() => excluir(o)} style={{ ...iconMini, color: "#A32D2D" }} title="Excluir"><Trash2 size={13} /></button>
              </div>
            </div>
          );
        })}
        {opcoes.length === 0 && <div style={{ padding: 14, fontSize: 13, color: "#8A8778" }}>Nenhuma opção cadastrada.</div>}
      </div>

      <div style={{ fontSize: 11, color: "#8A8778", lineHeight: 1.5, padding: "8px 2px 0" }}>
        O que já está em uso não some: a lixeira oferece desligar. Desligado some dos menus e
        para de aceitar coisa nova, mas as contas antigas continuam com a classificação certa.
      </div>
    </div>
  );
}


const subTab = {
  display: "flex", alignItems: "center", gap: 5,
  padding: "7px 12px", borderRadius: 999, border: "1px solid #E8E2D2",
  background: "#FFFFFF", color: "#8A8778", fontSize: 12, fontWeight: 600, cursor: "pointer",
};
const subTabAtiva = { background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" };
const selo = { fontSize: 9, fontWeight: 700, padding: "1.5px 6px", borderRadius: 999, flexShrink: 0, letterSpacing: 0.2 };
const iconMini = { border: "none", background: "none", padding: 2, cursor: "pointer", color: "#8A8778", display: "flex", alignItems: "center" };
const rotuloCampo = { display: "block", fontSize: 10, color: "#8A8778", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 };
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
const olhoBtn = {
  width: 34, height: 34, flex: "0 0 auto", borderRadius: 8,
  border: "1px solid #E8E2D2", background: "#FBF8F1", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
};
const olhoVazio = {
  width: 34, height: 34, flex: "0 0 auto", borderRadius: 8,
  border: "1px solid #EFEADF", background: "transparent",
  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
};
const vazio = {
  display: "flex", alignItems: "center", gap: 8,
  fontSize: 13, color: "#8A8778", padding: "16px 0",
};
