import React from "react";
import { ChevronLeft } from "lucide-react";
import Equipe from "./Equipe";

// Gente e Gestão — o antigo "Equipe", que vivia como aba dentro do
// Financeiro, agora com card próprio na home.
//
// Sair de dentro do Financeiro é o ponto: antes, para mexer com pessoas,
// escala ou fechamento da equipe, a permissão obrigava a dar acesso ao
// módulo que também contém contas a pagar, curva ABC e faturamento.
// Separado, dá para liberar gestão de pessoas sem abrir o caixa.
//
// Este arquivo é a moldura de página que o Financeiro fornecia antes
// (cabeçalho e botão de voltar) — e o carteiro das permissões: o Equipe
// precisa delas pra decidir quais sub-abas cada cargo enxerga.
export default function GenteGestao({ onVoltar, permissoes }) {
  return (
    <div style={pageStyle}>
      <div className="app-shell">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <button onClick={onVoltar} style={iconBtn}><ChevronLeft size={18} /></button>
          <div style={{ fontWeight: 800, fontSize: 17, color: "#22231F" }}>Gente e Gestão</div>
        </div>
        <Equipe permissoes={permissoes} />
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
const iconBtn = {
  width: 34, height: 34, borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#22231F",
};
