import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ChevronLeft, Download, Loader2, AlertTriangle } from "lucide-react";
import { podeVer } from "../lib/permissoes";
import { supabase } from "../lib/supabaseClient";
import NotasFiscais from "./NotasFiscais";
import Estoque from "./Estoque";
import FichasTecnicas from "./FichasTecnicas";
import Insumos from "./Insumos";
import CurvaABC from "./CurvaABC";
// ---------------------------------------------------------------------------
// Supply Chain — a cadeia de suprimento inteira num lugar só.
//
// As quatro telas vinham do Financeiro. Estão aqui porque são uma coisa
// só na prática: a nota fiscal dá entrada no estoque, o estoque alimenta o
// custo da ficha técnica, e a curva ABC mostra o que gira. Espalhadas em
// abas do Financeiro, obrigavam a liberar caixa e plano de contas pra
// quem só mexe com compras.
//
// Nenhum dos quatro componentes foi reescrito — esta tela é só a moldura
// e a fileira de abas, igual ao que o Financeiro fazia antes.
// ---------------------------------------------------------------------------
const ABAS = [
  { chave: "notas", label: "Notas" },
  { chave: "compras", label: "Compras" },
  { chave: "insumos", label: "Insumos" },
  { chave: "fichas", label: "Fichas técnicas" },
  { chave: "curvaabc", label: "Curva ABC" },
  // Usa a permissão de Insumos de propósito: quem já consulta insumo
  // consulta a contagem. Se um dia precisar de permissão própria, é
  // criar a chave `supply.contagens` no catálogo e trocar aqui.
  { chave: "contagens", label: "Estoque contado", permissao: "insumos" },
];
export default function SupplyChain({ onVoltar, permissoes, abaInicial }) {
  const abasVisiveis = ABAS.filter((a) => podeVer(permissoes, `supply.${a.permissao || a.chave}`));
  const abaPadrao = abasVisiveis.some((a) => a.chave === abaInicial)
    ? abaInicial
    : (abasVisiveis[0]?.chave || null);
  const [aba, setAba] = useState(abaPadrao);
  return (
    <div style={pageStyle}>
      <div className="app-shell">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <button onClick={onVoltar} style={iconBtn}><ChevronLeft size={18} /></button>
          <div style={{ fontWeight: 800, fontSize: 17, color: "#22231F" }}>Supply Chain</div>
        </div>
        {abasVisiveis.length === 0 ? (
          <div style={{ ...cardStyle, textAlign: "center", color: "#8A8778", fontSize: 13 }}>
            Seu cargo não libera nenhuma aba do Supply Chain. Fale com um administrador.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
              {abasVisiveis.map((a) => (
                <button key={a.chave} onClick={() => setAba(a.chave)}
                  style={{ ...tabBtn, ...(aba === a.chave ? tabBtnAtivo : {}) }}>
                  {a.label}
                </button>
              ))}
            </div>
            {aba === "notas" && <NotasFiscais />}
            {aba === "compras" && <Estoque />}
            {aba === "insumos" && <Insumos permissoes={permissoes} />}
            {aba === "fichas" && <FichasTecnicas />}
            {aba === "curvaabc" && <CurvaABC />}
            {aba === "contagens" && <EstoqueContado />}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estoque contado — a planilha insumo x dia
//
// Mora aqui dentro, e não num arquivo próprio, pra que instalar essa tela
// seja um arquivo só. Os dados vêm prontos da função planilha_estoque():
// trazer contagens_itens cru estouraria o limite de linhas do Supabase numa
// consulta de 30 dias.
//
// Duas leituras da mesma grade:
//   Contado   — quanto tinha, pelo que a equipe contou
//   Diferença — contado menos o que o sistema achava que tinha
// ---------------------------------------------------------------------------
const PERIODOS = [
  { valor: 7,  label: "Últimos 7 dias" },
  { valor: 15, label: "Últimos 15 dias" },
  { valor: 30, label: "Últimos 30 dias" },
];

function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function diasAtras(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function diaCurto(iso) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}
const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
function diaSemana(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return SEMANA[new Date(a, m - 1, d).getDay()];
}
function num(v, casas = 2) {
  if (v === null || v === undefined) return "";
  return Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas });
}
function brlCurto(v) {
  return `R$ ${Math.round(Number(v) || 0).toLocaleString("pt-BR")}`;
}
function semAcentoBusca(t) {
  return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function EstoqueContado() {
  const [periodo, setPeriodo] = useState(15);
  const [setor, setSetor] = useState("");     // "" = todos
  const [modo, setModo] = useState("contado"); // contado | diferenca
  const [busca, setBusca] = useState("");
  const [setores, setSetores] = useState([]);
  const [linhas, setLinhas] = useState(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);
  const rolagemRef = useRef(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("setores_estoque").select("chave, label")
        .eq("ativo", true).order("ordem");
      setSetores(data || []);
    })();
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    const { data, error } = await supabase.rpc("planilha_estoque", {
      p_inicio: ymdLocal(diasAtras(periodo)),
      p_fim: ymdLocal(new Date()),
      p_setor: setor || null,
    });
    setCarregando(false);
    if (error) {
      setErro(/does not exist|schema cache/i.test(error.message)
        ? "A planilha ainda não foi instalada no banco — falta rodar a migração 081."
        : error.message);
      setLinhas([]);
      return;
    }
    setLinhas(data || []);
  }, [periodo, setor]);

  useEffect(() => { carregar(); }, [carregar]);

  // As colunas são os dias em que ALGUÉM contou alguma coisa — dia sem
  // contagem não vira coluna vazia.
  const colunas = useMemo(() => {
    const dias = new Set();
    (linhas || []).forEach((l) => Object.keys(l.dias || {}).forEach((d) => dias.add(d)));
    return [...dias].sort();
  }, [linhas]);

  const visiveis = useMemo(() => {
    const termos = semAcentoBusca(busca).split(/\s+/).filter(Boolean);
    if (termos.length === 0) return linhas || [];
    return (linhas || []).filter((l) => {
      const plano = semAcentoBusca(l.insumo);
      return termos.every((t) => plano.includes(t));
    });
  }, [linhas, busca]);

  // Rodapé: valor parado no estoque naquele dia, ou o dinheiro da
  // diferença. Usa o custo congelado na hora da contagem, não o de hoje.
  const rodape = useMemo(() => {
    const total = {};
    colunas.forEach((d) => { total[d] = 0; });
    visiveis.forEach((l) => {
      colunas.forEach((d) => {
        const cel = (l.dias || {})[d];
        if (!cel || cel.q === null || cel.q === undefined) return;
        const custo = Number(cel.c) || 0;
        total[d] += modo === "contado"
          ? Number(cel.q) * custo
          : (Number(cel.q) - (Number(cel.s) || 0)) * custo;
      });
    });
    return total;
  }, [visiveis, colunas, modo]);

  // Abre já rolada no fim: os dias mais recentes é que interessam.
  useEffect(() => {
    const el = rolagemRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [colunas.length, modo]);

  const baixar = () => {
    const sep = ";";
    const virgula = (v) => (v === null || v === undefined ? "" : String(v).replace(".", ","));
    const cabecalho = ["Insumo", "Unidade", ...colunas.map(diaCurto)];
    const corpo = visiveis.map((l) => {
      const celulas = colunas.map((d) => {
        const cel = (l.dias || {})[d];
        if (!cel || cel.q === null || cel.q === undefined) return "";
        return virgula(modo === "contado" ? cel.q : Number(cel.q) - (Number(cel.s) || 0));
      });
      return [l.insumo, l.unidade || "", ...celulas];
    });
    const total = [modo === "contado" ? "Valor contado" : "Diferença em R$", "",
      ...colunas.map((d) => virgula(Math.round(rodape[d] * 100) / 100))];
    const texto = [cabecalho, ...corpo, total]
      .map((linha) => linha.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(sep))
      .join("\r\n");
    // O \uFEFF na frente é o que faz o Excel abrir os acentos certos.
    const blob = new Blob(["\uFEFF" + texto], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `estoque-contado-${ymdLocal(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar insumo…"
          style={{ ...campo, flex: 1, minWidth: 130 }} />
        <select value={setor} onChange={(e) => setSetor(e.target.value)} style={campo}>
          <option value="">Todos os setores</option>
          {setores.map((s) => <option key={s.chave} value={s.chave}>{s.label}</option>)}
        </select>
        <select value={periodo} onChange={(e) => setPeriodo(Number(e.target.value))} style={campo}>
          {PERIODOS.map((p) => <option key={p.valor} value={p.valor}>{p.label}</option>)}
        </select>
        <div style={{ display: "flex", border: "1px solid #E8E2D2", borderRadius: 8, overflow: "hidden" }}>
          {[["contado", "Contado"], ["diferenca", "Diferença"]].map(([v, rot]) => (
            <button key={v} onClick={() => setModo(v)}
              style={{
                border: "none", padding: "7px 12px", fontSize: 12, fontWeight: 600,
                fontFamily: "inherit", cursor: "pointer",
                background: modo === v ? "#22231F" : "#FFFFFF",
                color: modo === v ? "#F3EFE3" : "#8A8778",
              }}>{rot}</button>
          ))}
        </div>
        <button onClick={baixar} disabled={!colunas.length} style={{ ...campo, display: "flex", alignItems: "center", gap: 5, cursor: "pointer", background: "#F6F1E7", fontWeight: 600 }}>
          <Download size={13} /> Baixar
        </button>
      </div>

      {erro && (
        <div style={{ display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 12 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div>{erro}</div>
        </div>
      )}

      {carregando && <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, color: "#8A8778" }}><Loader2 size={14} /> Carregando…</div>}

      {!carregando && !erro && colunas.length === 0 && (
        <div style={{ ...cardStyle, fontSize: 13, color: "#8A8778", textAlign: "center" }}>
          Nenhuma contagem nesse período{setor ? " nesse setor" : ""}. As contagens são feitas no Checklist, em "Controle de estoque".
        </div>
      )}

      {!carregando && colunas.length > 0 && (
        <>
          <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, background: "#FFFFFF", overflow: "hidden", marginBottom: 6 }}>
            <div ref={rolagemRef} style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ ...thBase, ...colunaPresa, zIndex: 3, textAlign: "left" }}>Insumo</th>
                    {colunas.map((d) => (
                      <th key={d} style={thBase}>
                        {diaCurto(d)}
                        <span style={{ display: "block", fontWeight: 600, letterSpacing: 0, textTransform: "none", color: "#B3AC96" }}>{diaSemana(d)}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((l, idx) => {
                    const fundo = idx % 2 === 1 ? "#FCFAF3" : "#FFFFFF";
                    return (
                      <tr key={l.insumo_id}>
                        <td style={{ ...tdBase, ...colunaPresa, background: fundo, textAlign: "left" }}>
                          {l.insumo} <span style={{ fontSize: 10, color: "#8A8778" }}>{l.unidade}</span>
                        </td>
                        {colunas.map((d) => {
                          const cel = (l.dias || {})[d];
                          const naoContado = !cel || cel.q === null || cel.q === undefined;
                          if (naoContado) {
                            return <td key={d} style={{ ...tdBase, background: fundo, color: "#C6C0AA" }}>—</td>;
                          }
                          const q = Number(cel.q);
                          if (modo === "contado") {
                            return (
                              <td key={d} style={{ ...tdBase, background: fundo, color: q === 0 ? "#A32D2D" : "#22231F", fontWeight: q === 0 ? 700 : 400 }}>
                                {num(q)}
                              </td>
                            );
                          }
                          const dif = q - (Number(cel.s) || 0);
                          const zerado = Math.abs(dif) < 0.0001;
                          return (
                            <td key={d} style={{ ...tdBase, background: fundo, fontWeight: zerado ? 400 : 700, color: zerado ? "#8A8778" : dif < 0 ? "#A32D2D" : "#0F6E56" }}>
                              {zerado ? "0" : `${dif > 0 ? "+" : "−"}${num(Math.abs(dif))}`}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                  {visiveis.length === 0 && (
                    <tr><td colSpan={colunas.length + 1} style={{ ...tdBase, textAlign: "center", color: "#8A8778" }}>Nenhum insumo com esse nome.</td></tr>
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td style={{ ...tfBase, ...colunaPresa, background: "#F6F1E7", textAlign: "left", fontSize: 10, letterSpacing: 0.3, textTransform: "uppercase", color: "#8A8778" }}>
                      {modo === "contado" ? "Valor contado" : "Diferença em R$"}
                    </td>
                    {colunas.map((d) => (
                      <td key={d} style={{ ...tfBase, color: modo === "diferenca" && rodape[d] < -0.5 ? "#A32D2D" : modo === "diferenca" && rodape[d] > 0.5 ? "#0F6E56" : "#22231F" }}>
                        {modo === "diferenca" && rodape[d] > 0.5 ? "+" : ""}{brlCurto(rodape[d])}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div style={{ fontSize: 10.5, color: "#8A8778", lineHeight: 1.5, padding: "0 2px" }}>
            <strong>—</strong> ninguém contou aquele item naquele dia · <strong style={{ color: "#A32D2D" }}>0</strong> alguém
            contou e disse que acabou · a última linha é {modo === "contado" ? "o dinheiro parado no estoque naquele dia" : "quanto a diferença representa em dinheiro"},
            pelo custo congelado na hora da contagem.
            {!setor && " Com todos os setores, o mesmo insumo contado na cozinha e no bar aparece somado."}
          </div>
        </>
      )}
    </div>
  );
}

const campo = {
  padding: "7px 9px", borderRadius: 8, border: "1px solid #E8E2D2",
  fontSize: 12.5, fontFamily: "inherit", background: "#FFFFFF", color: "#22231F",
};
const thBase = {
  padding: "7px 10px", whiteSpace: "nowrap", background: "#F6F1E7",
  fontSize: 10, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase",
  color: "#8A8778", borderBottom: "1px solid #E8E2D2", textAlign: "right",
};
const tdBase = {
  padding: "7px 10px", whiteSpace: "nowrap", textAlign: "right",
  borderBottom: "1px solid #F0EBDD", fontVariantNumeric: "tabular-nums", color: "#22231F",
};
const tfBase = {
  padding: "7px 10px", whiteSpace: "nowrap", textAlign: "right", background: "#F6F1E7",
  fontWeight: 800, borderTop: "1px solid #E8E2D2", fontVariantNumeric: "tabular-nums",
};
// A coluna do nome fica presa: com 30 dias de colunas, sem isso você rola
// pro lado e perde de vista qual insumo está lendo.
const colunaPresa = {
  position: "sticky", left: 0, zIndex: 2, background: "#FFFFFF",
  borderRight: "1px solid #E8E2D2", minWidth: 168, maxWidth: 210,
  overflow: "hidden", textOverflow: "ellipsis",
};

const pageStyle = {
  fontFamily: "'Inter', system-ui, sans-serif",
  background: "#F6F1E7",
  padding: 20,
  minHeight: "100vh",
  boxSizing: "border-box",
};
const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const iconBtn = {
  width: 34, height: 34, borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#22231F",
};
const tabBtn = {
  padding: "8px 14px", borderRadius: 999, border: "1px solid #E8E2D2",
  background: "#FFFFFF", color: "#8A8778", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const tabBtnAtivo = { background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" };
