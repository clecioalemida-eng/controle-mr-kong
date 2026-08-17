import React from "react";
import { ChevronLeft, Hammer } from "lucide-react";

// Base reutilizável para módulos ainda não desenvolvidos. Cada card novo
// (Financeiro, Marketing, Comercial, SAC, Rastreabilidade...) usa este
// componente até ganhar sua própria tela — trocar depois é só criar o
// arquivo do módulo de verdade e apontar a chave para ele em App.jsx.
export default function EmConstrucao({ titulo, descricao, nomeUsuario, onVoltar }) {
  return (
    <div style={pageStyle}>
      <div className="app-shell">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <button onClick={onVoltar} style={iconBtn}><ChevronLeft size={18} /></button>
          <div style={{ fontWeight: 800, fontSize: 17, color: "#22231F" }}>{titulo}</div>
        </div>

        <div style={{ textAlign: "center", padding: "40px 16px" }}>
          <div style={{ width: 56, height: 56, borderRadius: 14, background: "#22231F14", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Hammer size={26} color="#8A8778" />
          </div>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#22231F", marginBottom: 6 }}>Em construção</div>
          <div style={{ fontSize: 13, color: "#8A8778", maxWidth: 320, margin: "0 auto" }}>
            {descricao || `O módulo de ${titulo} ainda está sendo desenvolvido.`}
            {nomeUsuario ? ` Assim que estiver pronto, ${nomeUsuario}, ele aparece aqui.` : ""}
          </div>
        </div>
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
