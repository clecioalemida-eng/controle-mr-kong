// ===== AvisoParecidos.jsx =====
// O aviso "já existe um produto parecido", igual em toda tela que cria
// insumo: Insumos, Compras (compra manual), Notas e a fila de arrumação.
//
// useParecidos(nome) carrega uma vez a lista de insumos e de sinônimos e
// devolve os parecidos com o nome digitado. <AvisoParecidos> desenha a
// lista com o botão "Usar este". Quem decide o que "usar" quer dizer é a
// tela: na nota, vincula o item; na compra, escolhe o insumo.
//
// Também mora aqui o seletor de TIPO do insumo (migração 195).

import React, { useState, useEffect, useMemo } from "react";
import { AlertTriangle } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { parecidos } from "../lib/insumoParecido";

export const TIPOS_INSUMO = [
  { valor: "ingrediente", rotulo: "Ingrediente", ajuda: "vai na ficha de um prato" },
  { valor: "revenda", rotulo: "Revenda", ajuda: "vendido como veio: lata, água, porção pronta" },
  { valor: "embalagem", rotulo: "Embalagem", ajuda: "copo, caixa, sacola" },
  { valor: "uso", rotulo: "Uso e limpeza", ajuda: "detergente, gás, papel: não vai em ficha" },
];

let cache = null; // { insumos, sinonimos }, compartilhado entre as telas
export function esquecerInsumos() { cache = null; }
async function carregar() {
  if (cache) return cache;
  const [ri, rs] = await Promise.all([
    supabase.from("insumos").select("id, nome, unidade, custo_medio_atual").order("nome"),
    supabase.from("insumo_sinonimos").select("nome_variante, insumo_id"),
  ]);
  cache = { insumos: ri.data || [], sinonimos: rs.data || [] };
  return cache;
}

export function useParecidos(nome, { excluir = null, limite = 5 } = {}) {
  const [base, setBase] = useState(cache);
  useEffect(() => {
    let vivo = true;
    if (!base) carregar().then((b) => { if (vivo) setBase(b); });
    return () => { vivo = false; };
  }, []); // eslint-disable-line
  return useMemo(() => (base ? parecidos(nome, base.insumos, { sinonimos: base.sinonimos, excluir, limite }) : []),
    [base, nome, excluir, limite]);
}

function brl(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// lista: o que veio do useParecidos. onUsar(insumo). confirmado: a pessoa
// já disse "é outro produto" (o aviso fica, mas sem cobrar decisão).
export function AvisoParecidos({ lista, onUsar, rotuloUsar = "Usar este", confirmado = false, onConfirmar }) {
  if (!lista || lista.length === 0) return null;
  return (
    <div style={{ background: "#FBF3D9", border: "1px solid #E8D48A", borderRadius: 10, padding: "10px 12px", margin: "8px 0", width: "100%", boxSizing: "border-box" }}>
      <div style={{ display: "flex", gap: 7, fontSize: 12.5, color: "#7A6A1E", fontWeight: 700, marginBottom: 4 }}>
        <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        {confirmado ? "Você confirmou que é outro produto." : "Já existem produtos parecidos. Use um deles, ou confirme que é outro produto."}
      </div>
      {lista.map((i) => (
        <div key={i.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderTop: "1px solid #EFE3B5", fontSize: 12.5, color: "#22231F" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b style={{ fontWeight: 700 }}>{i.nome}</b>
            <span style={{ color: "#8A8778" }}> · {i.unidade}{Number(i.custo_medio_atual) > 0 ? ` · ${brl(i.custo_medio_atual)}` : ""}</span>
            {i.pelo && <div style={{ fontSize: 11, color: "#8A8778" }}>chega na nota como "{i.pelo}"</div>}
          </div>
          {onUsar && (
            <button onClick={() => onUsar(i)} style={{ background: "#22231F", color: "#F3EFE3", border: "none", borderRadius: 8,
              padding: "6px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" }}>
              {rotuloUsar}
            </button>
          )}
        </div>
      ))}
      {onConfirmar && !confirmado && (
        <div style={{ borderTop: "1px solid #EFE3B5", paddingTop: 7, marginTop: 2, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "#7A6A1E", flex: 1 }}>Nenhum desses?</span>
          <button onClick={onConfirmar} style={{ background: "#FFFFFF", color: "#22231F", border: "1px solid #E8D48A", borderRadius: 8,
            padding: "6px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            É outro produto: criar mesmo assim
          </button>
        </div>
      )}
    </div>
  );
}

export function EscolherTipo({ valor, onMudar, compacto = false }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {!compacto && <span style={{ fontSize: 12, color: "#8A8778" }}>Tipo</span>}
      {TIPOS_INSUMO.map((t) => (
        <button key={t.valor} type="button" title={t.ajuda} onClick={() => onMudar(t.valor)}
          style={{ border: "1px solid", borderColor: valor === t.valor ? "#22231F" : "#E8E2D2", borderRadius: 999,
            padding: "5px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
            background: valor === t.valor ? "#22231F" : "#FFFFFF", color: valor === t.valor ? "#F3EFE3" : "#55534A" }}>
          {t.rotulo}
        </button>
      ))}
    </div>
  );
}
