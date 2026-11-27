// ===== SeletorLinha.jsx =====
// A lista de linhas de produto (Hambúrguer Gourmet, Bebidas, Combos…) e o
// "+ Nova linha…", usados em Fichas técnicas e no Dashboard.
//
// Antes a lista era fixa no código, repetida nas duas telas, e não dava
// para escolher Espetinhos ou Acompanhamentos. Agora ela junta:
//   * as linhas de sempre;
//   * as linhas que já estão em algum prato (pratos.linha_produto);
//   * as criadas aqui pelo "+ Nova linha…".
// A linha do prato é texto livre no banco: criar uma linha é só gravar o
// nome nela, sem migração.

import React, { useState, useEffect } from "react";
import { supabase } from "../lib/supabaseClient";

export const LINHAS_PADRAO = [
  "Hambúrguer Gourmet", "Hambúrguer Tradicional", "Bebidas", "Bombons e Balas",
  "Milkshake e Sorvetes", "Cremes", "Petiscos", "Chapa", "Combos", "Batatas Fritas", "Açaí",
];
const NOVA = "__nova_linha__";

function semAcento(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

// as de sempre na ordem de sempre, e as outras em ordem alfabética
export function montarLinhas(extras) {
  const vistas = new Set(LINHAS_PADRAO.map(semAcento));
  const outras = [];
  (extras || []).forEach((l) => {
    const nome = String(l || "").trim();
    if (!nome || vistas.has(semAcento(nome))) return;
    vistas.add(semAcento(nome));
    outras.push(nome);
  });
  return [...LINHAS_PADRAO, ...outras.sort((a, b) => a.localeCompare(b, "pt-BR"))];
}

// Carrega as linhas que já estão nos pratos. `extras`: linhas que a tela
// já conhece (por exemplo, do estado dela) e ainda não foram gravadas.
let criadasAqui = [];
export function useLinhasProduto(extras = []) {
  const [doBanco, setDoBanco] = useState([]);
  const [, setVersao] = useState(0);
  useEffect(() => {
    supabase.from("pratos").select("linha_produto").not("linha_produto", "is", null)
      .then(({ data }) => setDoBanco((data || []).map((x) => x.linha_produto)));
  }, []);
  const lista = montarLinhas([...doBanco, ...criadasAqui, ...extras]);
  const lembrar = (nome) => { criadasAqui = [...criadasAqui, nome]; setVersao((v) => v + 1); };
  return [lista, lembrar];
}

// <select> com "+ Nova linha…". onEscolher(linha | null) grava no prato.
export function SeletorLinha({ valor, linhas, onEscolher, onCriada, vazio = "— linha de produto pendente —", style, disabled }) {
  const [criando, setCriando] = useState(false);
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState("");

  const criar = () => {
    const limpo = nome.trim().replace(/\s+/g, " ");
    if (limpo.length < 3) { setErro("Dê um nome à linha."); return; }
    // se já existe com outra grafia, usa a que existe
    const igual = linhas.find((l) => semAcento(l) === semAcento(limpo));
    const usar = igual || limpo;
    if (!igual && onCriada) onCriada(usar);
    onEscolher(usar);
    setCriando(false); setNome(""); setErro("");
  };

  if (criando) {
    return (
      <div onClick={(e) => e.stopPropagation()} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <input autoFocus value={nome} placeholder="Ex.: Acompanhamentos" onChange={(e) => { setNome(e.target.value); setErro(""); }}
          onKeyDown={(e) => { if (e.key === "Enter") criar(); if (e.key === "Escape") setCriando(false); }}
          style={{ flex: 1, minWidth: 140, padding: "5px 8px", borderRadius: 6, border: "1px solid #C9C2AE", fontSize: 12, fontFamily: "inherit" }} />
        <button onClick={criar} style={{ background: "#22231F", color: "#F3EFE3", border: "none", borderRadius: 6, padding: "5px 10px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>Criar e usar</button>
        <button onClick={() => { setCriando(false); setErro(""); }} style={{ background: "none", border: "none", color: "#8A8778", fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>cancelar</button>
        {erro && <span style={{ width: "100%", fontSize: 11, color: "#A32D2D" }}>{erro}</span>}
      </div>
    );
  }
  return (
    <select value={valor || ""} disabled={disabled} onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        const v = e.target.value;
        if (v === NOVA) { setCriando(true); return; }
        onEscolher(v || null);
      }} style={style}>
      <option value="">{vazio}</option>
      {linhas.map((l) => <option key={l} value={l}>{l}</option>)}
      <option value={NOVA}>+ Nova linha…</option>
    </select>
  );
}
