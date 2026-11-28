// ===== DocumentosPessoa.jsx =====
// Gente e Gestão › Pessoas › Documentos de uma pessoa.
//
// Vários anexos por pessoa (RG, CNH, CPF, comprovante de endereço,
// carteira de trabalho, contrato), cada um com o tipo (migração 211).
//
// Ao subir documento, a IA lê (Edge Function ler-documento-pessoa) e a
// tela mostra, lado a lado, o que está no cadastro e o que veio do
// documento. Nada é gravado sem o clique em "Atualizar cadastro" — o
// documento lido por IA pode trazer número trocado.
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, Upload, Trash2, Paperclip, Sparkles, AlertTriangle, Check } from "lucide-react";
import { supabase, extrairErroFuncao } from "../lib/supabaseClient";

const TIPOS = [
  ["rg", "RG"], ["cnh", "CNH"], ["cpf", "CPF"], ["endereco", "Comprovante de endereço"],
  ["ctps", "Carteira de trabalho"], ["contrato", "Contrato"], ["outro", "Outro"],
];
const MAX_POR_LEITURA = 4;

// CPF com os dois dígitos verificadores conferidos. Leitura de foto erra
// número com frequência; o dígito pega a maior parte desses erros.
export function cpfValido(txt) {
  const d = String(txt || "").replace(/\D/g, "");
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
function formataCpf(txt) {
  const d = String(txt || "").replace(/\D/g, "");
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : txt;
}
function dataValida(txt) { return /^\d{4}-\d{2}-\d{2}$/.test(String(txt || "")); }
function brData(txt) { return dataValida(txt) ? txt.split("-").reverse().join("/") : txt; }

export default function DocumentosPessoa({ pessoa, aoAtualizar }) {
  const [docs, setDocs] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const [proposta, setProposta] = useState(null);
  const [marcados, setMarcados] = useState({});
  const [feito, setFeito] = useState("");
  const fileRef = useRef(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.from("pessoas_documentos").select("*").eq("pessoa_id", pessoa.id).order("criado_em");
    if (error) setErro(error.message.includes("pessoas_documentos") ? "A tabela de documentos ainda não existe — rode a migração 211 no Supabase." : error.message);
    setDocs(data || []);
    setCarregando(false);
    return data || [];
  }, [pessoa.id]);
  useEffect(() => { carregar(); }, [carregar]);

  const abrir = async (caminho) => {
    const { data, error } = await supabase.storage.from("documentos-pessoas").createSignedUrl(caminho, 300);
    if (error || !data?.signedUrl) { setErro("Não consegui abrir o documento: " + (error?.message || "")); return; }
    window.open(data.signedUrl, "_blank");
  };

  const ler = async (lista) => {
    const escolhidos = lista.slice(-MAX_POR_LEITURA);
    if (!escolhidos.length) return;
    setErro(""); setFeito(""); setProposta(null);
    setOcupado("Lendo o documento… (leva uns 20 segundos)");
    const { data, error } = await supabase.functions.invoke("ler-documento-pessoa", { body: { caminhos: escolhidos.map((d) => d.caminho) } });
    if (error || !data?.ok) {
      setOcupado("");
      const msg = error ? await extrairErroFuncao(error) : (data?.error || "Leitura falhou.");
      setErro(/not found|404|Failed to send/i.test(msg) ? "A função ler-documento-pessoa ainda não foi criada no Supabase." : msg);
      return;
    }
    const lido = data.lido || {};
    // O tipo de cada documento vem da leitura — grava direto, é só etiqueta.
    for (const d of lido.documentos || []) {
      const doc = escolhidos[(d.numero || 0) - 1];
      if (doc && d.tipo && doc.tipo !== d.tipo) await supabase.from("pessoas_documentos").update({ tipo: d.tipo }).eq("id", doc.id);
    }
    const nomeDoc = (n) => escolhidos[(n || 0) - 1]?.nome_arquivo || null;
    const campos = [
      { chave: "nome", rotulo: "Nome completo", atual: pessoa.nome, lido: lido.nome_completo, fonte: nomeDoc(lido.fonte_nome) },
      { chave: "cpf", rotulo: "CPF", atual: pessoa.cpf, lido: lido.cpf ? formataCpf(lido.cpf) : "", fonte: nomeDoc(lido.fonte_cpf),
        alerta: lido.cpf && !cpfValido(lido.cpf) ? "os dígitos não fecham — confira, pode ser erro de leitura" : "" },
      { chave: "rg", rotulo: "RG", atual: pessoa.rg, lido: lido.rg, fonte: nomeDoc(lido.fonte_rg) },
      { chave: "data_nascimento", rotulo: "Nascimento", atual: pessoa.data_nascimento, lido: lido.data_nascimento, fonte: nomeDoc(lido.fonte_nascimento),
        alerta: lido.data_nascimento && !dataValida(lido.data_nascimento) ? "data em formato estranho" : "" },
      { chave: "endereco", rotulo: "Endereço", atual: pessoa.endereco, lido: lido.endereco, fonte: nomeDoc(lido.fonte_endereco) },
    ].filter((c) => String(c.lido || "").trim());
    // Marcado por padrão só o que está VAZIO no cadastro e veio sem
    // alerta. O que já está preenchido você marca se quiser trocar —
    // inclusive o nome, que mexe em tudo que procura a pessoa por ele.
    setMarcados(Object.fromEntries(campos.map((c) => [c.chave, !c.alerta && !String(c.atual || "").trim()])));
    setProposta({ campos, observacoes: lido.observacoes || "" });
    setOcupado("");
    carregar();
  };

  const subir = async (arquivos) => {
    if (!arquivos?.length) return;
    setErro(""); setFeito("");
    setOcupado(`Enviando ${arquivos.length} arquivo(s)…`);
    const novos = [];
    for (const arq of arquivos) {
      const caminho = `${pessoa.nome.trim().replace(/[^a-zA-Z0-9]/g, "_")}-${Date.now()}-${arq.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
      const { error: errUp } = await supabase.storage.from("documentos-pessoas").upload(caminho, arq);
      if (errUp) { setErro(errUp.message); setOcupado(""); return; }
      const { data, error } = await supabase.from("pessoas_documentos")
        .insert({ pessoa_id: pessoa.id, caminho, nome_arquivo: arq.name, tipo: "outro" }).select().single();
      if (error) { setErro(error.message); setOcupado(""); return; }
      novos.push(data);
    }
    // Mantém o campo antigo preenchido: é por ele que a pendência
    // "documento" some em Encargos e riscos.
    if (!pessoa.documento_path) await supabase.from("pessoas").update({ documento_path: novos[0].caminho }).eq("id", pessoa.id);
    setOcupado("");
    await carregar();
    // Subiu, já lê. A confirmação continua sendo sua.
    ler(novos);
  };

  const apagar = async (doc) => {
    if (!window.confirm(`Apagar ${doc.nome_arquivo || "este documento"}? O arquivo some de vez.`)) return;
    setOcupado("Apagando…");
    await supabase.storage.from("documentos-pessoas").remove([doc.caminho]);
    const { error } = await supabase.from("pessoas_documentos").delete().eq("id", doc.id);
    if (error) { setErro(error.message); setOcupado(""); return; }
    if (pessoa.documento_path === doc.caminho) {
      const outro = docs.find((d) => d.id !== doc.id);
      await supabase.from("pessoas").update({ documento_path: outro?.caminho || null }).eq("id", pessoa.id);
      aoAtualizar?.();
    }
    setOcupado("");
    carregar();
  };

  const mudarTipo = async (doc, tipo) => {
    setDocs((l) => l.map((d) => (d.id === doc.id ? { ...d, tipo } : d)));
    const { error } = await supabase.from("pessoas_documentos").update({ tipo }).eq("id", doc.id);
    if (error) setErro(error.message);
  };

  const aplicar = async () => {
    const payload = {};
    proposta.campos.forEach((c) => {
      if (!marcados[c.chave]) return;
      payload[c.chave] = c.chave === "data_nascimento" ? (dataValida(c.lido) ? c.lido : null) : String(c.lido).trim();
    });
    if (!Object.keys(payload).length) { setErro("Nenhum campo marcado."); return; }
    setOcupado("Atualizando o cadastro…");
    const { error } = await supabase.from("pessoas").update(payload).eq("id", pessoa.id);
    setOcupado("");
    if (error) { setErro(error.message); return; }
    setProposta(null);
    setFeito(`Cadastro atualizado: ${proposta.campos.filter((c) => marcados[c.chave]).map((c) => c.rotulo.toLowerCase()).join(", ")}.`);
    aoAtualizar?.();
  };

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #E8E2D2", display: "grid", gap: 8 }}>
      {erro && <div style={aviso}><AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} /><div>{erro}</div></div>}
      {feito && <div style={{ ...aviso, background: "#EAF3DE", borderColor: "#97C459", color: "#27500A" }}><Check size={15} /> {feito}</div>}

      {carregando ? <div style={pequeno}>Carregando documentos…</div> : (
        <div style={{ display: "grid", gap: 6 }}>
          {docs.map((d) => (
            <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <button onClick={() => abrir(d.caminho)} style={{ ...chipBtn, flex: 1, minWidth: 140 }} title="Abrir">
                <Paperclip size={13} /> <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.nome_arquivo || d.caminho}</span>
              </button>
              <select value={d.tipo} onChange={(e) => mudarTipo(d, e.target.value)} style={{ ...input, padding: "5px 6px", fontSize: 12 }}>
                {TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button onClick={() => apagar(d)} disabled={!!ocupado} style={ghost} aria-label="Apagar documento"><Trash2 size={14} /></button>
            </div>
          ))}
          {docs.length === 0 && <div style={pequeno}>Nenhum documento anexado.</div>}
        </div>
      )}

      <input ref={fileRef} type="file" multiple accept="image/*,application/pdf" style={{ display: "none" }}
        onChange={(e) => { const l = Array.from(e.target.files || []); e.target.value = ""; subir(l); }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => fileRef.current?.click()} disabled={!!ocupado} style={{ ...btn, display: "flex", gap: 6, alignItems: "center" }}>
          <Upload size={14} /> Anexar documento
        </button>
        {docs.length > 0 && (
          <button onClick={() => ler(docs)} disabled={!!ocupado} style={{ ...btn, display: "flex", gap: 6, alignItems: "center" }}>
            <Sparkles size={14} /> Ler {docs.length > MAX_POR_LEITURA ? `os ${MAX_POR_LEITURA} últimos` : docs.length > 1 ? "todos" : "o documento"} e atualizar cadastro
          </button>
        )}
      </div>
      {ocupado && <div style={{ ...pequeno, display: "flex", gap: 6, alignItems: "center" }}><Loader2 size={13} /> {ocupado}</div>}

      {proposta && (
        <div style={{ border: "1px solid #E8E2D2", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ padding: "8px 10px", background: "#F6F1E7", fontSize: 12, fontWeight: 700 }}>
            O que veio do documento — marque o que quer usar
          </div>
          {proposta.campos.length === 0 && <div style={{ padding: 10, fontSize: 12.5, color: "#8A8778" }}>Não achei nome, CPF, RG, nascimento nem endereço legíveis.</div>}
          {proposta.campos.map((c) => (
            <label key={c.chave} style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: 6, padding: "8px 10px", borderTop: "1px solid #F0EBDD", fontSize: 12.5, cursor: "pointer" }}>
              <input type="checkbox" checked={!!marcados[c.chave]} onChange={(e) => setMarcados((m) => ({ ...m, [c.chave]: e.target.checked }))} />
              <div>
                <div style={pequeno}>{c.rotulo}</div>
                <div><b>{c.chave === "data_nascimento" ? brData(c.lido) : c.lido}</b>{c.fonte && <span style={pequeno}> · {c.fonte}</span>}</div>
                <div style={pequeno}>no cadastro: {String(c.atual || "").trim()
                  ? (c.chave === "data_nascimento" ? brData(c.atual) : c.atual)
                  : <span style={{ color: "#C4432B", fontStyle: "italic" }}>não preenchido</span>}</div>
                {c.alerta && <div style={{ fontSize: 11, color: "#A32D2D", marginTop: 2 }}>⚠ {c.alerta}</div>}
                {c.chave === "nome" && String(c.atual || "").trim() && <div style={pequeno}>trocar o nome muda como a pessoa aparece em todo o painel</div>}
              </div>
            </label>
          ))}
          {proposta.observacoes && <div style={{ padding: "8px 10px", borderTop: "1px solid #F0EBDD", fontSize: 11.5, color: "#854F0B" }}>Observação da leitura: {proposta.observacoes}</div>}
          {proposta.campos.length > 0 && (
            <div style={{ padding: 10, borderTop: "1px solid #F0EBDD", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={aplicar} disabled={!!ocupado} style={{ ...btn, background: "#22231F", color: "#F3EFE3" }}>Atualizar cadastro com os marcados</button>
              <button onClick={() => setProposta(null)} style={link}>Descartar</button>
              <span style={pequeno}>telefone não vem em documento — digite à mão</span>
            </div>
          )}
        </div>
      )}
      <div style={pequeno}>Os arquivos ficam no armazenamento privado do painel. A leitura envia a imagem à IA (a mesma que lê as notas) e não guarda nada lá.</div>
    </div>
  );
}

const pequeno = { fontSize: 11, color: "#8A8778" };
const aviso = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "10px 12px", fontSize: 12.5 };
const input = { borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF", color: "#22231F" };
const btn = { background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, cursor: "pointer" };
const chipBtn = { display: "flex", alignItems: "center", gap: 6, border: "1px solid #E8E2D2", background: "#FFFFFF", borderRadius: 8, padding: "6px 9px", fontSize: 12, cursor: "pointer", color: "#22231F", textAlign: "left", minWidth: 0 };
const ghost = { border: "none", background: "none", color: "#8A8778", cursor: "pointer", padding: 2, display: "flex" };
const link = { background: "none", border: "none", color: "#8A6A0F", fontSize: 12.5, fontWeight: 600, cursor: "pointer", padding: 0 };
