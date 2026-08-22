import React, { useState } from "react";
import { ChevronLeft } from "lucide-react";
import { podeVer } from "../lib/permissoes";
import NotasFiscais from "./NotasFiscais";
import Estoque from "./Estoque";
import FichasTecnicas from "./FichasTecnicas";
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
  { chave: "fichas", label: "Fichas técnicas" },
  { chave: "curvaabc", label: "Curva ABC" },
];
export default function SupplyChain({ onVoltar, permissoes, abaInicial }) {
  const abasVisiveis = ABAS.filter((a) => podeVer(permissoes, `supply.${a.chave}`));
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
            {aba === "fichas" && <FichasTecnicas />}
            {aba === "curvaabc" && <CurvaABC />}
          </>
        )}
      </div>
    </div>
  );
}
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
