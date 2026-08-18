import React, { useState, useEffect, useCallback } from "react";
import { ChevronLeft, AlertTriangle, Truck, SlidersHorizontal } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

function fmt(v, unidade) {
  const n = (v ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  return `${n} ${unidade}`;
}
function fmtData(d) {
  if (!d) return "";
  return new Date(d).toLocaleDateString("pt-BR");
}

const TIPO_LABEL = {
  compra: "Compra",
  ajuste: "Ajuste manual",
  perda: "Perda",
  contagem: "Contagem",
};
const TIPO_ICONE = { compra: Truck, ajuste: SlidersHorizontal, perda: AlertTriangle, contagem: SlidersHorizontal };

export default function Estoque() {
  const [tela, setTela] = useState("lista"); // lista | extrato
  const [insumos, setInsumos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [insumoAtual, setInsumoAtual] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    const { data, error } = await supabase.from("insumos").select("*").order("nome");
    if (error) { setErro(error.message); setCarregando(false); return; }
    setInsumos(data || []);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  if (tela === "extrato" && insumoAtual) {
    return <ExtratoInsumo insumo={insumoAtual} onVoltar={() => { setTela("lista"); setInsumoAtual(null); carregar(); }} />;
  }

  return (
    <div>
      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}
      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <div className="list-grid">
          {insumos.map((i) => {
            const abaixoMinimo = i.estoque_minimo != null && i.estoque_atual < i.estoque_minimo;
            return (
              <button key={i.id} onClick={() => { setInsumoAtual(i); setTela("extrato"); }}
                style={{ ...itemRow, cursor: "pointer", textAlign: "left", border: abaixoMinimo ? "1px solid #F0D8CE" : "1px solid #E8E2D2" }}>
                <span style={{ fontSize: 13, color: "#22231F" }}>{i.nome}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {abaixoMinimo && <span style={pill}>abaixo do mínimo</span>}
                  <span style={{ fontSize: 14, fontWeight: 700, color: "#22231F" }}>{fmt(i.estoque_atual, i.unidade)}</span>
                </span>
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
        <div style={{ fontSize: 16, fontWeight: 700, color: "#22231F", marginBottom: 6 }}>{insumo.nome}</div>
        <div style={{ fontSize: 11, color: "#8A8778" }}>Saldo atual</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#22231F" }}>{fmt(insumo.estoque_atual, insumo.unidade)}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 8 }}>
          <span style={{ fontSize: 12, color: "#8A8778" }}>Estoque mínimo</span>
          <input type="number" value={minimoForm} onChange={(e) => setMinimoForm(e.target.value)} onBlur={salvarMinimo}
            placeholder="—" style={{ width: 60, padding: "3px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, textAlign: "center" }} />
          <span style={{ fontSize: 12, color: "#8A8778" }}>{insumo.unidade}</span>
        </div>
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
                  {positivo ? "+" : ""}{fmt(m.quantidade, insumo.unidade)}
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
const itemRow = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "#FFFFFF", borderRadius: 10, padding: "12px 14px" };
const btnSecondary = { background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const linkBtn = { background: "none", border: "none", color: "#8A6A0F", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, textAlign: "left" };
const sectionLabel = { fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778", marginBottom: 8 };
const pill = { fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#F0999522", color: "#A32D2D" };
const avisoStyle = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 14 };
