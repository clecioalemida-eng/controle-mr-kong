import React from "react";
import { ChevronLeft } from "lucide-react";
import Dashboard from "./Dashboard";

// Casca do Dashboard como módulo próprio.
//
// O Dashboard.jsx foi escrito para viver dentro do Financeiro, então ele
// devolve só o conteúdo — sem cabeçalho, sem botão de voltar, sem o
// padding da página. Este arquivo é essa moldura, e nada mais. Assim o
// Dashboard passa a ter card próprio na home e permissão independente do
// Financeiro, sem precisar reescrever nada da lógica dele.
export default function DashboardModulo({ onVoltar }) {
  return (
    <div style={pageStyle}>
      <div className="app-shell">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <button onClick={onVoltar} style={iconBtn}><ChevronLeft size={18} /></button>
          <div style={{ fontWeight: 800, fontSize: 17, color: "#22231F" }}>Dashboard</div>
        </div>
        <Dashboard />
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
