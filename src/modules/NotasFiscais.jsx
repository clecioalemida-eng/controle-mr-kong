// ===== NotasFiscais.jsx =====
import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import {
  ChevronLeft, Upload, Loader2, AlertTriangle, Pencil, Trash2, Check, FileText, Eye, Search, X, ExternalLink, RotateCcw, Plus,
} from "lucide-react";
import { supabase, extrairErroFuncao } from "../lib/supabaseClient";
const UNIDADES = ["un", "g", "kg", "ml", "l"];
// Padrão, usado só se a migração 080 ainda não rodou ou se a consulta
// falhar. A lista de verdade fica em `listas_opcoes` e é editada em
// DRE → Listas.
const FORMAS_PADRAO = [
  { valor: "pix", rotulo: "Pix" },
  { valor: "debito", rotulo: "Débito" },
  { valor: "credito", rotulo: "Cartão de crédito" },
  { valor: "boleto", rotulo: "Boleto" },
];

async function buscarFormasPagamento() {
  const { data, error } = await supabase
    .from("listas_opcoes")
    .select("valor, rotulo, ordem")
    .eq("lista", "forma_pagamento")
    .eq("ativo", true)
    .order("ordem");
  if (error || !data || data.length === 0) return FORMAS_PADRAO;
  return data;
}
function brl(v) { return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function round2(n) { return Math.round((n || 0) * 100) / 100; }
function fmtData(d) { if (!d) return ""; return new Date(d).toLocaleDateString("pt-BR"); }
// Data com hora: a entrada de nota acontece várias vezes no mesmo dia, e
// saber a ordem ajuda quando dois lançamentos parecem o mesmo.
function fmtDataHora(d) {
  if (!d) return "";
  const x = new Date(d);
  return `${x.toLocaleDateString("pt-BR")} ${x.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}
function round4(n) { return Math.round((n || 0) * 10000) / 10000; }
function norm(s) { return String(s || "").trim().toLowerCase().replace(/\s+/g, " "); }
// Tira acento e caixa alta pra comparar: "Açaí" e "ACAI" viram "acai".
// A faixa \u0300-\u036f é escrita em código escapado de propósito — o
// caractere acentuado cru se perde quando o arquivo passa por editor.
function semAcento(t) {
  return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const LIMITE_BUSCA = 50;

// Campo de busca de insumo.
//
// Substitui o <select> com centenas de nomes: digitando, ele filtra por
// pedaço do nome (não só pelo começo), ignorando acento, e aceita as
// palavras fora de ordem — "po leite" acha "Leite em pó".
//
// A lista é desenhada por portal, em position:fixed. O container da
// tabela de itens tem overflow:hidden pros cantos arredondados, e um
// dropdown absoluto ali dentro ficaria cortado nos últimos itens da nota.
function BuscaInsumo({ insumos, valor, onEscolher, onCriar, alerta = false }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [sel, setSel] = useState(-1);
  const [caixa, setCaixa] = useState(null);
  const inputRef = useRef(null);
  const fecharRef = useRef(null);

  const escolhido = insumos.find((i) => i.id === valor) || null;

  const achados = useMemo(() => {
    const termos = semAcento(busca).split(/\s+/).filter(Boolean);
    if (termos.length === 0) return insumos;
    const casam = insumos.filter((i) => {
      const plano = semAcento(i.nome);
      return termos.every((t) => plano.includes(t));
    });
    // Quem COMEÇA com o que foi digitado vem primeiro. Sem isso, quem
    // digita "leite" recebe "Adicional leite em pó" antes de "Leite em
    // pó", só porque a lista está em ordem alfabética. O sort do
    // JavaScript é estável, então dentro de cada grupo a ordem
    // alfabética continua valendo.
    const primeiro = termos[0];
    const peso = (nome) => {
      const plano = semAcento(nome);
      if (plano.startsWith(primeiro)) return 0;
      if (plano.split(/[^a-z0-9]+/).some((palavra) => palavra.startsWith(primeiro))) return 1;
      return 2;
    };
    return [...casam].sort((a, b) => peso(a.nome) - peso(b.nome));
  }, [insumos, busca]);

  const mostrados = achados.slice(0, LIMITE_BUSCA);
  const podeCriar = busca.trim().length > 0 && achados.length === 0;
  const podeLimpar = !!valor && busca.trim().length === 0;

  const posicionar = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const folgaAbaixo = window.innerHeight - r.bottom;
    const paraCima = folgaAbaixo < 180 && r.top > folgaAbaixo;
    setCaixa({
      left: r.left,
      width: r.width,
      top: paraCima ? null : r.bottom + 4,
      bottom: paraCima ? window.innerHeight - r.top + 4 : null,
      maxAltura: Math.max(120, (paraCima ? r.top : folgaAbaixo) - 14),
    });
  }, []);

  useEffect(() => {
    if (!aberto) return undefined;
    posicionar();
    const refazer = () => posicionar();
    window.addEventListener("scroll", refazer, true);
    window.addEventListener("resize", refazer);
    return () => {
      window.removeEventListener("scroll", refazer, true);
      window.removeEventListener("resize", refazer);
    };
  }, [aberto, posicionar]);

  useEffect(() => () => clearTimeout(fecharRef.current), []);

  const fechar = () => { setAberto(false); setBusca(""); setSel(-1); };

  const escolher = (insumo) => {
    onEscolher(insumo ? insumo.id : null);
    fechar();
    inputRef.current?.blur();
  };

  const aoTeclar = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAberto(true);
      setSel((v) => Math.min(v + 1, mostrados.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((v) => Math.max(v - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (podeCriar) { onCriar(busca.trim()); fechar(); return; }
      const alvo = mostrados[sel >= 0 ? sel : 0];
      if (alvo) escolher(alvo);
    } else if (e.key === "Escape") {
      e.preventDefault();
      fechar();
      inputRef.current?.blur();
    }
  };

  const borda = alerta ? "#E8D48A" : "#E8E2D2";

  return (
    <div style={{ flex: 1, minWidth: 150, position: "relative" }}>
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        value={aberto ? busca : (escolhido?.nome || "")}
        placeholder={escolhido ? escolhido.nome : "Digite pra procurar…"}
        onFocus={() => { setBusca(""); setSel(-1); setAberto(true); }}
        onChange={(e) => { setBusca(e.target.value); setSel(-1); setAberto(true); }}
        onKeyDown={aoTeclar}
        onBlur={() => { fecharRef.current = setTimeout(fechar, 120); }}
        style={{
          width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6,
          fontSize: 12, fontFamily: "inherit", background: "#FFFFFF", color: "#22231F",
          border: `1px solid ${borda}`,
        }}
      />
      {aberto && caixa && createPortal(
        <div
          onMouseDown={(e) => e.preventDefault()}
          style={{
            position: "fixed", left: caixa.left, width: caixa.width,
            ...(caixa.top != null ? { top: caixa.top } : { bottom: caixa.bottom }),
            maxHeight: caixa.maxAltura, overflowY: "auto", zIndex: 60,
            background: "#FFFFFF", border: "1px solid #DDD5BF", borderRadius: 8,
            boxShadow: "0 8px 24px rgba(34,35,31,.15)",
          }}
        >
          {podeLimpar && (
            <div onClick={() => escolher(null)} style={{ ...optStyle, color: "#8A8778" }}>— tirar o vínculo —</div>
          )}
          {achados.length === 0 && (
            <div style={{ ...optStyle, color: "#8A8778", cursor: "default" }}>Nenhum insumo com esse nome.</div>
          )}
          {podeCriar && (
            <div
              onClick={() => { onCriar(busca.trim()); fechar(); }}
              style={{ ...optStyle, color: "#0F6E56", fontWeight: 700, borderTop: "1px solid #F0EBDD" }}
            >
              + Criar “{busca.trim()}”
            </div>
          )}
          {mostrados.map((i, idx) => (
            <div
              key={i.id}
              onClick={() => escolher(i)}
              onMouseEnter={() => setSel(idx)}
              style={{
                ...optStyle,
                display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline",
                background: idx === sel ? "#F6F1E7" : "#FFFFFF",
                fontWeight: i.id === valor ? 700 : 400,
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.nome}</span>
              <span style={{ fontSize: 10, color: "#8A8778", flexShrink: 0 }}>{i.unidade}</span>
            </div>
          ))}
          {achados.length > mostrados.length && (
            <div style={{ padding: "6px 10px", fontSize: 10, color: "#8A8778", borderTop: "1px solid #F0EBDD", background: "#FCFAF3" }}>
              mostrando {mostrados.length} de {achados.length} — continue digitando pra afinar
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
// Lê o padrão de embalagem que quase toda nota de descartável traz no
// próprio nome do produto: "20X50U", "(20X100U)", "700U GALVANOTEK".
// Serve só pra SUGERIR — quem decide é quem está conferindo.
function detectarEmbalagem(nome) {
  const s = String(nome || "").toUpperCase();
  let m = s.match(/(\d{1,4})\s*[X\u00D7]\s*(\d{1,5})\s*(UN|U|PC|P)?\b/);
  if (m) return { pacotes: Number(m[1]), porPacote: Number(m[2]) };
  m = s.match(/\b(\d{2,5})\s*(UN|U)\b/);
  if (m) return { pacotes: 1, porPacote: Number(m[1]) };
  return null;
}
// Abre o arquivo da nota numa aba nova.
//
// A aba é aberta ANTES do await, ainda dentro do clique. O Safari (e o
// Chrome) bloqueiam window.open que acontece depois de uma espera: pra
// eles, quem abriu foi o código, não a pessoa. Como o link assinado do
// Supabase leva um instante pra sair, abrimos a aba vazia na hora e só
// depois mandamos ela pro endereço.
async function abrirPreview(caminho) {
  const aba = window.open("", "_blank");
  const { data, error } = await supabase.storage.from("notas-fiscais").createSignedUrl(caminho, 3600);
  if (error || !data?.signedUrl) {
    if (aba) aba.close();
    alert("Não consegui abrir o arquivo: " + (error?.message || ""));
    return;
  }
  if (aba) { aba.location.href = data.signedUrl; return; }
  // bloqueador de pop-up derrubou a aba — vai na mesma janela
  window.location.href = data.signedUrl;
}
const STATUS_LABEL = {
  processando: "Lendo com IA",
  aguardando_confirmacao: "Aguardando conferência",
  confirmado: "Confirmada",
  erro: "Erro na leitura",
};
const STATUS_ESTILO = {
  processando: { background: "#FAC77555", color: "#854F0B" },
  aguardando_confirmacao: { background: "#F0999522", color: "#A32D2D" },
  confirmado: { background: "#2F8F5B22", color: "#0F6E56" },
  erro: { background: "#F0999522", color: "#A32D2D" },
};
// Quem é administrador. A tela usa isso só pra decidir o que mostrar —
// quem barra de verdade é a função reverter_conferencia_nota() no banco,
// que recusa qualquer chamada de não-admin. Esconder botão não é controle
// de acesso.
function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data?.user) return;
      const { data: perfil } = await supabase.from("perfis").select("is_admin").eq("id", data.user.id).maybeSingle();
      setIsAdmin(perfil?.is_admin || false);
    });
  }, []);
  return isAdmin;
}
export default function NotasFiscais() {
  const [tela, setTela] = useState("lista"); // lista | conferencia
  const [documentos, setDocumentos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [documentoAtual, setDocumentoAtual] = useState(null);
  const [busca, setBusca] = useState("");
  const [revertendo, setRevertendo] = useState(null); // id da nota sendo revertida
  const [notaConfirmada, setNotaConfirmada] = useState(null); // nota já com entrada, aberta pra ver/editar
  const isAdmin = useIsAdmin();
  const inputRef = useRef(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.from("documentos_compra").select("*").order("criado_em", { ascending: false }).limit(30);
    if (error) setErro(error.message);
    setDocumentos(data || []);
    setCarregando(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  // Reverte uma nota já confirmada. Tudo acontece dentro de uma função do
  // banco, numa transação só — ou desfaz estoque, conta a pagar e status
  // juntos, ou não desfaz nada. Desfazer pela metade seria pior que não
  // desfazer.
  const reverterConferencia = async (d) => {
    const nome = d.fornecedor || "fornecedor não identificado";
    if (!window.confirm(
      `Reverter a conferência da nota de "${nome}"?\n\n` +
      "Isso apaga a entrada no estoque e a conta gerada no Plano de Contas, " +
      "e devolve a nota para conferência com os itens preservados.\n\n" +
      "O custo médio dos insumos NÃO volta ao valor anterior."
    )) return;
    setRevertendo(d.id);
    setErro("");
    const { data, error } = await supabase.rpc("reverter_conferencia_nota", { p_documento: d.id });
    setRevertendo(null);
    if (error) { setErro(error.message); return; }
    if (data) window.alert(data);
    carregar();
  };
  const excluirDocumento = async (d) => {
    if (!window.confirm(`Excluir a nota de "${d.fornecedor || "fornecedor não identificado"}"? Isso apaga o documento e os itens lidos — não dá pra desfazer.`)) return;
    const { error } = await supabase.from("documentos_compra").delete().eq("id", d.id);
    if (error) { setErro(error.message); return; }
    await supabase.storage.from("notas-fiscais").remove([d.arquivo_path]);
    carregar();
  };
  const enviarArquivo = async (file) => {
    if (!file) return;
    setEnviando(true);
    setErro("");
    try {
      const { data: userData } = await supabase.auth.getUser();
      const caminho = `${userData?.user?.id || "anon"}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
      const { error: erroUpload } = await supabase.storage.from("notas-fiscais").upload(caminho, file);
      if (erroUpload) throw erroUpload;
      const { data: doc, error: erroInsert } = await supabase.from("documentos_compra")
        .insert({ arquivo_path: caminho, status: "processando", criado_por: userData?.user?.id })
        .select().single();
      if (erroInsert) throw erroInsert;
      carregar(); // já mostra "Lendo com IA" na lista
      const { data: resultado, error: erroFuncao } = await supabase.functions.invoke("processar-documento-compra", {
        body: { documento_id: doc.id },
      });
      if (erroFuncao) throw new Error(await extrairErroFuncao(erroFuncao));
      if (resultado?.error) throw new Error(resultado.error);
      carregar();
    } catch (e) {
      setErro(e.message || String(e));
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };
  if (tela === "regras") {
    return <RegrasProduto onVoltar={() => setTela("lista")} />;
  }
  if (tela === "manual") {
    return (
      <CompraManual
        onVoltar={() => { setTela("lista"); carregar(); }}
        onCriada={(doc) => { setDocumentoAtual(doc); setTela("conferencia"); }}
      />
    );
  }
  if (tela === "conferencia" && documentoAtual) {
    return (
      <Conferencia
        documento={documentoAtual}
        onVoltar={() => { setTela("lista"); setDocumentoAtual(null); carregar(); }}
      />
    );
  }
  return (
    <div>
      {/*
        SEM `capture` de propósito. O atributo capture="environment" mandava
        o celular abrir a câmera traseira direto, sem perguntar nada — no
        iPhone e no iPad isso tornava impossível escolher um arquivo já
        salvo. Sem ele, o iOS abre o menu nativo com "Biblioteca de Fotos",
        "Tirar Foto" e "Escolher Arquivo", e o Android faz o equivalente.
        Ou seja: dá pra fotografar a nota na hora OU subir um PDF/imagem
        que já está no aparelho ou no iCloud/Drive.
      */}
      <input ref={inputRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }}
        onChange={(e) => enviarArquivo(e.target.files?.[0])} />
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={() => inputRef.current?.click()} disabled={enviando}
          style={{ ...btnPrimary, flex: 1, minWidth: 230 }}>
          {enviando ? <Loader2 size={16} /> : <Upload size={17} />}
          {enviando ? "Enviando…" : "Enviar nota fiscal ou recibo"}
        </button>
        <button onClick={() => setTela("manual")}
          style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 7, padding: "12px 18px", fontSize: 14, fontWeight: 700 }}>
          <Plus size={16} /> Compra manual
        </button>
      </div>
      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}
      {notaConfirmada && (
        <NotaJaConferida
          documento={notaConfirmada}
          isAdmin={isAdmin}
          onFechar={() => setNotaConfirmada(null)}
          aoDesfazer={async () => {
            const d = notaConfirmada;
            const { data, error } = await supabase.rpc("reverter_conferencia_nota", { p_documento: d.id });
            if (error) { setNotaConfirmada(null); setErro(error.message); return; }
            if (data) window.alert(data);
            setNotaConfirmada(null);
            setDocumentoAtual({ ...d, status: "aguardando_confirmacao" });
            setTela("conferencia");
          }}
        />
      )}
      {documentos.length > 0 && (
        <div style={{ position: "relative", marginBottom: 14 }}>
          <Search size={15} color="#8A8778" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por fornecedor…"
            style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px 9px 34px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF" }} />
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ ...sectionLabel, marginBottom: 0 }}>Documentos recebidos</div>
        <button onClick={() => setTela("regras")} style={{ ...linkBtn, fontSize: 12 }}>Regras de produto</button>
      </div>
      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <div className="list-grid">
          {documentos.filter((d) => (d.fornecedor || "Fornecedor não identificado").toLowerCase().includes(busca.toLowerCase())).map((d) => (
            <div key={d.id} style={itemRow}>
              {d.arquivo_path ? (
                <button onClick={() => abrirPreview(d.arquivo_path)} style={iconBtnWrap}
                  aria-label="Abrir documento em outra aba" title="Abrir em outra aba">
                  <div style={iconBox}><FileText size={16} color="#8A8778" /></div>
                </button>
              ) : (
                // Compra manual não tem arquivo pra abrir — o selo diz que
                // esses números foram digitados, não lidos pela IA.
                <div style={{ ...iconBox, flexDirection: "column", gap: 1 }} title="Compra digitada à mão, sem nota">
                  <Plus size={13} color="#3A6684" />
                  <span style={{ fontSize: 7, fontWeight: 800, color: "#3A6684", letterSpacing: 0.2 }}>MANUAL</span>
                </div>
              )}
              <button
                onClick={() => {
                  if (d.status === "aguardando_confirmacao") { setDocumentoAtual(d); setTela("conferencia"); }
                  // Nota que já teve entrada abre no mesmo lugar, só que
                  // travada: primeiro se vê o que foi lançado, e o botão
                  // vermelho desfaz a entrada e devolve ela pra edição.
                  else if (d.status === "confirmado") setNotaConfirmada(d);
                }}
                style={{ display: "flex", alignItems: "center", minWidth: 0, flex: 1, background: "none", border: "none", padding: 0, cursor: (d.status === "aguardando_confirmacao" || d.status === "confirmado") ? "pointer" : "default", textAlign: "left" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#22231F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {d.fornecedor || "Fornecedor não identificado"}
                  </div>
                  {/* Duas datas, e elas são MESMO diferentes.
                      A da nota é a que a IA leu do papel — e vem errada com
                      alguma frequência: nota de 2026 lida como 2020, 2024.
                      A da entrada é quando o valor entrou no estoque e no
                      caixa, que é a que explica o DRE do mês.
                      Mostrar só uma delas fazia parecer erro de sistema o
                      que era erro de leitura. */}
                  <div style={{ fontSize: 11, color: "#8A8778" }}>
                    <b style={{ color: "#22231F", fontWeight: 700 }}>{brl(d.valor_total)}</b>
                    {d.data_documento ? ` · nota de ${fmtData(d.data_documento)}` : ""}
                  </div>
                  <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 1 }}>
                    {d.confirmado_em
                      ? `entrada em ${fmtDataHora(d.confirmado_em)}`
                      : `enviada em ${fmtDataHora(d.criado_em)}`}
                  </div>
                </div>
              </button>
              {d.arquivo_path && (
                <button onClick={() => abrirPreview(d.arquivo_path)} style={ghostIconBtn}
                  aria-label="Abrir a nota em outra aba" title="Abrir a nota em outra aba">
                  <Eye size={16} />
                </button>
              )}
              {d.status !== "confirmado" && (
                <button onClick={() => excluirDocumento(d)} style={{ ...ghostIconBtn, color: "#C4432B" }} aria-label="Excluir documento">
                  <Trash2 size={16} />
                </button>
              )}
              {d.status === "confirmado" && isAdmin && (
                <button onClick={() => reverterConferencia(d)} disabled={revertendo === d.id}
                  style={{ ...ghostIconBtn, color: "#8A6A0F" }}
                  aria-label="Reverter conferência" title="Reverter conferência (só administrador)">
                  {revertendo === d.id ? <Loader2 size={16} /> : <RotateCcw size={16} />}
                </button>
              )}
              <span style={{ ...pill, ...STATUS_ESTILO[d.status], whiteSpace: "nowrap", flexShrink: 0 }}>{STATUS_LABEL[d.status]}</span>
            </div>
          ))}
          {documentos.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Nenhum documento enviado ainda.</div>}
        </div>
      )}

    </div>
  );
}
// ---------------------------------------------------------------------------
// Nota que JÁ teve entrada — ver e, se precisar, voltar a editar
//
// Fica no mesmo lugar da conferência de propósito: é ali que a pessoa
// procura quando percebe que digitou um preço errado ontem.
//
// Por que travada, e não editável direto: os números dessa nota já
// viraram entrada de estoque, custo médio de insumo e conta no Plano de
// Contas. Deixar editar por cima faria a tela discordar do estoque sem
// ninguém perceber. Então o caminho é explícito — desfaz a entrada,
// e aí sim edita.
//
// Só administrador desfaz. Quem não é vê a nota e o aviso.
// ---------------------------------------------------------------------------
function NotaJaConferida({ documento, isAdmin, onFechar, aoDesfazer }) {
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [desfazendo, setDesfazendo] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data } = await supabase
        .from("itens_documento_compra")
        .select("*")
        .eq("documento_id", documento.id)
        .order("criado_em");
      if (vivo) { setItens(data || []); setCarregando(false); }
    })();
    return () => { vivo = false; };
  }, [documento.id]);

  const somaItens = itens.reduce(
    (s2, i) => s2 + (Number(i.quantidade) || 0) * (Number(i.preco_unitario) || 0), 0
  );

  const desfazer = async () => {
    if (!window.confirm(
      `Desfazer a entrada da nota de "${documento.fornecedor || "fornecedor não identificado"}" para editar?\n\n` +
      "Isso apaga a entrada no estoque e a conta gerada no Plano de Contas, " +
      "e devolve a nota para conferência com os itens preservados.\n\n" +
      "O custo médio dos insumos NÃO volta ao valor anterior."
    )) return;
    setDesfazendo(true);
    await aoDesfazer();
    setDesfazendo(false);
  };

  return (
    <div onClick={onFechar} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        <div style={modalBarra}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#22231F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {documento.fornecedor || "Fornecedor não identificado"} · nota já conferida
          </span>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            {documento.arquivo_path && (
              <button onClick={() => abrirPreview(documento.arquivo_path)} style={ghostIconBtn}
                aria-label="Abrir a nota em outra aba" title="Abrir a nota em outra aba">
                <ExternalLink size={16} />
              </button>
            )}
            <button onClick={onFechar} style={ghostIconBtn} aria-label="Fechar" title="Fechar">
              <X size={18} />
            </button>
          </div>
        </div>
        <div style={modalCorpo}>
          <div style={{ fontSize: 11.5, color: "#8A8778", marginBottom: 10 }}>
            {fmtData(documento.data_documento || documento.criado_em)}
            {documento.valor_total ? ` · total lançado ${brl(documento.valor_total)}` : ""}
            {documento.origem === "manual" ? " · compra digitada à mão" : ""}
          </div>
          {carregando ? (
            <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando os itens…</div>
          ) : (
            <div style={{ border: "1px solid #E8E2D2", borderRadius: 10, overflow: "hidden", background: "#FFFFFF" }}>
              {itens.map((i, idx) => (
                <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 11px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, color: "#22231F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {i.nome_lido}
                    </div>
                    <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 1 }}>
                      {i.quantidade} {i.unidade} × {brl(i.preco_unitario)}
                    </div>
                  </div>
                  <div style={{ fontSize: 12.5, fontWeight: 700, whiteSpace: "nowrap" }}>
                    {brl((Number(i.quantidade) || 0) * (Number(i.preco_unitario) || 0))}
                  </div>
                </div>
              ))}
              {itens.length === 0 && (
                <div style={{ padding: 12, fontSize: 12.5, color: "#8A8778" }}>Esta nota não tem itens gravados.</div>
              )}
              {itens.length > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 11px", borderTop: "1px solid #E8E2D2", background: "#FBFAF6", fontSize: 12.5 }}>
                  <span style={{ color: "#8A8778" }}>Soma dos itens</span>
                  <b>{brl(somaItens)}</b>
                </div>
              )}
            </div>
          )}
          <div style={{ fontSize: 11, color: "#8A8778", marginTop: 10, lineHeight: 1.55 }}>
            Esses números já entraram no estoque e no Plano de Contas — por isso a tela está travada.
            Pra corrigir qualquer coisa, é preciso desfazer a entrada primeiro.
          </div>
          {isAdmin ? (
            <button onClick={desfazer} disabled={desfazendo}
              style={{ width: "100%", marginTop: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
                background: "#C4432B", color: "#FFFFFF", border: "none", borderRadius: 10, padding: "12px 16px",
                fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              {desfazendo ? <Loader2 size={16} /> : <RotateCcw size={16} />}
              Desfazer a entrada e editar
            </button>
          ) : (
            <div style={{ ...avisoStyle, marginTop: 12 }}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 12.5 }}>Só administrador desfaz a entrada de uma nota.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
// ---------------------------------------------------------------------------
// Tela de conferência: revisar/editar os itens lidos antes de confirmar
// ---------------------------------------------------------------------------
function Conferencia({ documento, onVoltar }) {
  // A nota original abre em ABA NOVA, não mais num painel embutido. O
  // painel empurrava a lista de itens pra baixo e, numa nota de 18
  // itens, sobrava pouca tela pra cada linha. Na aba separada dá pra
  // botar as duas janelas lado a lado.
  const [abrindoOriginal, setAbrindoOriginal] = useState(false);

  const abrirOriginal = async () => {
    setAbrindoOriginal(true);
    await abrirPreview(documento.arquivo_path);
    setAbrindoOriginal(false);
  };

  const [itens, setItens] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [formaPagamento, setFormaPagamento] = useState("pix");
  const [formasPagamento, setFormasPagamento] = useState(FORMAS_PADRAO);
  // A data em que o boleto vence, não o prazo em dias.
  //
  // Prazo parece a mesma coisa e não é: ele era contado a partir de HOJE,
  // o dia em que você confere a nota — não a partir da nota. Conferir uma
  // nota de quinta na segunda seguinte jogava o vencimento quatro dias
  // pra frente sem ninguém pedir. E o boleto tem uma data impressa nele;
  // digitar essa data é mais curto que calcular quantos dias faltam.
  const [vencimentoBoleto, setVencimentoBoleto] = useState("");
  const [prazoAprendido, setPrazoAprendido] = useState(null); // { dias, de }
  const [erro, setErro] = useState("");
  const [editandoId, setEditandoId] = useState(null);
  const [formEdicao, setFormEdicao] = useState({ nome_lido: "", quantidade: 0, unidade: "un", preco_unitario: 0, insumo_id: "" });
  const [calcPacotes, setCalcPacotes] = useState({ qtd: "", tamanho: "", unidade: "g" });
  const [renomeandoInsumo, setRenomeandoInsumo] = useState(false);
  const [nomeInsumoInput, setNomeInsumoInput] = useState("");
  const [criarInsumoAberto, setCriarInsumoAberto] = useState(null); // id do item pedindo criação de insumo
  const [recemAdicionados, setRecemAdicionados] = useState(() => new Set());
  const [novoInsumoNome, setNovoInsumoNome] = useState("");
  const [novoInsumoUnidade, setNovoInsumoUnidade] = useState("un");
  const [fornecedores, setFornecedores] = useState([]);
  const [fornecedorAtual, setFornecedorAtual] = useState({ nome: documento.fornecedor || "", id: documento.fornecedor_id || null });
  const [editandoFornecedor, setEditandoFornecedor] = useState(false);
  const [nomeFornecedorInput, setNomeFornecedorInput] = useState("");
  const [historicoFornecedor, setHistoricoFornecedor] = useState([]);
  // --- regras de embalagem -------------------------------------------
  const [regras, setRegras] = useState([]);
  const [maiorNota, setMaiorNota] = useState(0);
  const [conferidos, setConferidos] = useState(() => new Set()); // itens que o usuário jurou que estão certos
  const [embalagemItem, setEmbalagemItem] = useState(null);      // id do item com o bloco de embalagem aberto
  const [formEmb, setFormEmb] = useState({ pacotes: "1", porPacote: "1", unidade: "un", precoPor: "pacote" });
  const [aplicadas, setAplicadas] = useState({});                // itemId -> { texto, anterior }
  const regrasJaAplicadas = useRef(false);
  const carregar = useCallback(async () => {
    setCarregando(true);
    const [{ data: itensData }, { data: insumosData }, { data: fornecedoresData }, { data: regrasData }, { data: maiorData }] = await Promise.all([
      supabase.from("itens_documento_compra").select("*").eq("documento_id", documento.id).order("criado_em"),
      supabase.from("insumos").select("id, nome, unidade").order("nome"),
      supabase.from("fornecedores").select("*").order("nome"),
      supabase.from("produto_regras").select("*"),
      supabase.from("documentos_compra").select("valor_total").not("valor_total", "is", null).order("valor_total", { ascending: false }).limit(1),
    ]);
    setInsumos(insumosData || []);
    setFornecedores(fornecedoresData || []);
    setRegras(regrasData || []);
    setMaiorNota(maiorData?.[0]?.valor_total || 0);
    // As regras são aplicadas UMA vez por abertura da tela. Sem essa
    // trava, cada carregar() reaplicaria os fatores em cima de valores
    // que já foram corrigidos, e a quantidade despencaria a cada volta.
    let listaFinal = itensData || [];
    if (!regrasJaAplicadas.current) {
      regrasJaAplicadas.current = true;
      listaFinal = await aplicarRegras(listaFinal, regrasData || []);
    }
    setItens(listaFinal);
    setCarregando(false);
    if (documento.fornecedor_id) carregarHistoricoFornecedor(documento.fornecedor_id);
    sugerirVencimento();
  }, [documento.id]);

  // Pré-enche o vencimento olhando o último boleto DESTE fornecedor:
  // quantos dias houve entre a nota e o vencimento da última vez. Sem
  // tabela nova, sem cadastro — a resposta já está no histórico.
  //
  // Se não achar nada, usa a data da nota + 28 dias, que é o costume da
  // casa. Nos dois casos é palpite, e a tela diz que é.
  const sugerirVencimento = async () => {
    const dataDaNota = documento.data_documento || new Date().toISOString().slice(0, 10);
    const somarDias = (iso, dias) => {
      const [a, m, d] = String(iso).split("-").map(Number);
      const x = new Date(a, m - 1, d);
      x.setDate(x.getDate() + dias);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
    };
    let dias = 28;
    let de = "";
    if (documento.fornecedor_id) {
      const { data } = await supabase.from("contas_pagar")
        .select("data_compra, data_vencimento, fornecedor_nome")
        .eq("fornecedor_id", documento.fornecedor_id)
        .eq("forma_pagamento", "boleto")
        .not("data_compra", "is", null)
        .not("data_vencimento", "is", null)
        .order("data_compra", { ascending: false })
        .limit(1);
      const ultima = data?.[0];
      if (ultima) {
        const inicio = new Date(`${ultima.data_compra}T12:00:00`);
        const fim = new Date(`${ultima.data_vencimento}T12:00:00`);
        const d = Math.round((fim - inicio) / 86400000);
        // Prazo negativo ou absurdo é lançamento torto de antes; não
        // vale herdar erro do passado como se fosse regra.
        if (d > 0 && d <= 180) { dias = d; de = ultima.fornecedor_nome || ""; }
      }
    }
    setPrazoAprendido({ dias, de });
    setVencimentoBoleto(somarDias(dataDaNota, dias));
  };
  useEffect(() => { carregar(); }, [carregar]);
  const carregarHistoricoFornecedor = async (fornecedorId) => {
    const { data } = await supabase
      .from("documentos_compra")
      .select("id, data_documento, criado_em, valor_total")
      .eq("fornecedor_id", fornecedorId)
      .neq("id", documento.id)
      .order("criado_em", { ascending: false })
      .limit(10);
    setHistoricoFornecedor(data || []);
  };
  // Aplica as regras já aprendidas nos itens recém-lidos pela IA.
  const aplicarRegras = async (lista, listaRegras) => {
    const banners = {};
    const saida = [];
    for (const item of lista) {
      const regra = (listaRegras || []).find((r) => norm(r.nome_lido) === norm(item.nome_lido));
      if (!regra) { saida.push(item); continue; }
      const novaQtd = round2((item.quantidade || 0) * Number(regra.fator_quantidade || 1));
      const novoPreco = round4((item.preco_unitario || 0) * Number(regra.fator_preco || 1));
      if (novaQtd === item.quantidade && novoPreco === item.preco_unitario) { saida.push(item); continue; }
      const atualizado = {
        ...item,
        quantidade: novaQtd,
        preco_unitario: novoPreco,
        unidade: regra.unidade || item.unidade,
        insumo_id: item.insumo_id || regra.insumo_id || null,
      };
      await supabase.from("itens_documento_compra").update({
        quantidade: atualizado.quantidade,
        preco_unitario: atualizado.preco_unitario,
        unidade: atualizado.unidade,
        insumo_id: atualizado.insumo_id,
      }).eq("id", item.id);
      await supabase.from("produto_regras")
        .update({ vezes_usada: (regra.vezes_usada || 0) + 1, atualizada_em: new Date().toISOString() })
        .eq("id", regra.id);
      banners[item.id] = {
        texto: `${regra.pacotes} ${Number(regra.pacotes) > 1 ? "pacotes" : "pacote"} \u00d7 ${regra.unidades_por_pacote} ${regra.unidade} \u00b7 pre\u00e7o por ${regra.preco_por}`,
        anterior: { quantidade: item.quantidade, preco_unitario: item.preco_unitario, unidade: item.unidade },
      };
      saida.push(atualizado);
    }
    if (Object.keys(banners).length) setAplicadas(banners);
    return saida;
  };

  const desfazerRegra = async (item) => {
    const info = aplicadas[item.id];
    if (!info) return;
    await supabase.from("itens_documento_compra").update(info.anterior).eq("id", item.id);
    setItens((prev) => prev.map((it) => (it.id === item.id ? { ...it, ...info.anterior } : it)));
    setAplicadas((prev) => { const copia = { ...prev }; delete copia[item.id]; return copia; });
  };

  const abrirEmbalagem = (item) => {
    const det = detectarEmbalagem(item.nome_lido);
    const ins = insumos.find((i) => i.id === item.insumo_id);
    setFormEmb({
      pacotes: String(det?.pacotes ?? 1),
      porPacote: String(det?.porPacote ?? 1),
      unidade: ins?.unidade || item.unidade || "un",
      precoPor: "pacote",
    });
    setEmbalagemItem(item.id);
  };

  const aplicarEmbalagem = async (item, salvarRegra) => {
    const pacotes = parseFloat(formEmb.pacotes) || 1;
    const porPacote = parseFloat(formEmb.porPacote) || 1;
    const totalUnidades = round2(pacotes * porPacote);
    const novoPreco = formEmb.precoPor === "pacote"
      ? round4((item.preco_unitario || 0) / porPacote)
      : round4(item.preco_unitario || 0);

    const { error } = await supabase.from("itens_documento_compra").update({
      quantidade: totalUnidades, preco_unitario: novoPreco, unidade: formEmb.unidade,
    }).eq("id", item.id);
    if (error) { setErro(error.message); return; }

    if (salvarRegra) {
      // Guarda a RAZÃO entre o que a IA leu e o que estava certo — é isso
      // que continua valendo quando o volume da próxima compra for outro.
      const fatorQuantidade = item.quantidade > 0 ? totalUnidades / item.quantidade : 1;
      const fatorPreco = item.preco_unitario > 0 ? novoPreco / item.preco_unitario : 1;
      const { error: errRegra } = await supabase.from("produto_regras").upsert({
        nome_lido: String(item.nome_lido || "").trim(),
        insumo_id: item.insumo_id || null,
        pacotes, unidades_por_pacote: porPacote, unidade: formEmb.unidade,
        preco_por: formEmb.precoPor,
        fator_quantidade: fatorQuantidade,
        fator_preco: fatorPreco,
        atualizada_em: new Date().toISOString(),
      }, { onConflict: "nome_lido" });
      if (errRegra) { setErro(errRegra.message); return; }
    }
    setEmbalagemItem(null);
    setConferidos((prev) => { const c = new Set(prev); c.delete(item.id); return c; });
    carregar();
  };

  const salvarFornecedor = async () => {
    const nome = nomeFornecedorInput.trim();
    if (!nome) { setEditandoFornecedor(false); return; }
    let fornecedor = fornecedores.find((f) => f.nome.toLowerCase() === nome.toLowerCase());
    if (!fornecedor) {
      const { data, error } = await supabase.from("fornecedores").insert({ nome }).select().single();
      if (error) { setErro(error.message); return; }
      fornecedor = data;
      setFornecedores((prev) => [...prev, fornecedor].sort((a, b) => a.nome.localeCompare(b.nome)));
    }
    const { error: errDoc } = await supabase.from("documentos_compra").update({ fornecedor: nome, fornecedor_id: fornecedor.id }).eq("id", documento.id);
    if (errDoc) { setErro(errDoc.message); return; }
    setFornecedorAtual({ nome, id: fornecedor.id });
    setEditandoFornecedor(false);
    carregarHistoricoFornecedor(fornecedor.id);
  };
  const removerItem = async (id) => {
    await supabase.from("itens_documento_compra").delete().eq("id", id);
    setItens((prev) => prev.filter((it) => it.id !== id));
  };
  // Item digitado à mão nasce NO TOPO.
  //
  // Antes ele entrava no fim da lista: numa nota de 18 itens, você
  // clicava em "adicionar" e não acontecia nada visível — o campo tinha
  // aparecido lá embaixo, fora da tela.
  //
  // Ele fica preso no topo até a nota ser recarregada, mesmo depois de
  // vinculado, senão ele saltaria de lugar no meio da digitação.
  const adicionarItemManual = async () => {
    const { data, error } = await supabase.from("itens_documento_compra")
      .insert({ documento_id: documento.id, nome_lido: "Novo item", quantidade: 1, unidade: "un", preco_unitario: 0 })
      .select().single();
    if (error) { setErro(error.message); return; }
    setItens((prev) => [data, ...prev]);
    setRecemAdicionados((prev) => new Set(prev).add(data.id));
    abrirEdicao(data);
  };
  const abrirEdicao = (item) => {
    setEditandoId(item.id);
    setFormEdicao({ nome_lido: item.nome_lido, quantidade: item.quantidade, unidade: item.unidade, preco_unitario: item.preco_unitario, insumo_id: item.insumo_id || "" });
    setCalcPacotes({ qtd: "", tamanho: "", unidade: item.unidade || "g" });
  };
  const aplicarCalculadoraPacotes = () => {
    const qtd = parseFloat(calcPacotes.qtd) || 0;
    const tamanho = parseFloat(calcPacotes.tamanho) || 0;
    setFormEdicao((f) => ({ ...f, quantidade: round2(qtd * tamanho), unidade: calcPacotes.unidade }));
  };
  const renomearInsumoVinculado = async () => {
    const nome = nomeInsumoInput.trim();
    if (!nome || !formEdicao.insumo_id) { setRenomeandoInsumo(false); return; }
    const { error } = await supabase.from("insumos").update({ nome }).eq("id", formEdicao.insumo_id);
    if (error) { setErro(error.message); return; }
    setInsumos((prev) => prev.map((i) => i.id === formEdicao.insumo_id ? { ...i, nome } : i).sort((a, b) => a.nome.localeCompare(b.nome)));
    setRenomeandoInsumo(false);
  };
  const salvarEdicao = async () => {
    const { error } = await supabase.from("itens_documento_compra").update({
      nome_lido: formEdicao.nome_lido,
      quantidade: parseFloat(formEdicao.quantidade) || 0,
      unidade: formEdicao.unidade,
      preco_unitario: parseFloat(formEdicao.preco_unitario) || 0,
      insumo_id: formEdicao.insumo_id || null,
    }).eq("id", editandoId).select().single();
    if (error) { setErro(error.message); return; }
    carregar();
    setEditandoId(null);
  };
  useEffect(() => {
    buscarFormasPagamento().then((formas) => {
      setFormasPagamento(formas);
      // Se o Pix (ou o que estivesse selecionado) tiver sido apagado da
      // lista, o select ficaria mostrando um valor que não existe mais.
      setFormaPagamento((atual) => (formas.some((f) => f.valor === atual) ? atual : (formas[0]?.valor || "")));
    });
  }, []);

  const vincularInsumo = async (itemId, insumoId) => {
    await supabase.from("itens_documento_compra").update({ insumo_id: insumoId }).eq("id", itemId);
    carregar();
  };
  const criarEVincularInsumo = async (item) => {
    const nome = novoInsumoNome.trim();
    if (!nome) return;
    setErro("");
    let { data: insumo, error } = await supabase.from("insumos")
      .insert({ nome, unidade: novoInsumoUnidade, custo_medio_atual: item.preco_unitario })
      .select().single();

    // 23505 = já existe insumo com esse nome. Isso não é erro do usuário:
    // ele quis dizer "este item é este insumo". Antes a tela devolvia
    // "duplicate key value violates unique constraint" e travava a nota
    // inteira — agora ela acha o que já existe e vincula nele.
    if (error && (error.code === "23505" || /duplicate key/i.test(error.message || ""))) {
      const { data: achado } = await supabase.from("insumos")
        .select("id, nome, unidade").ilike("nome", nome).limit(1).maybeSingle();
      if (achado) {
        insumo = achado;
        error = null;
        setErro(`"${achado.nome}" já existia — o item foi vinculado nele em vez de criar outro.`);
      }
    }
    if (error) { setErro(error.message); return; }
    await supabase.from("itens_documento_compra").update({ insumo_id: insumo.id }).eq("id", item.id);
    setInsumos((prev) => [...prev, insumo].sort((a, b) => a.nome.localeCompare(b.nome)));
    // Se esse item estava com o formulário de edição aberto, sincroniza o
    // vínculo ali também — senão, clicar em "Confirmar edição" logo
    // depois desfaria a criação que acabou de acontecer.
    if (editandoId === item.id) setFormEdicao((f) => ({ ...f, insumo_id: insumo.id }));
    setCriarInsumoAberto(null);
    setNovoInsumoNome("");
    carregar();
  };
  const todosVinculados = itens.length > 0 && itens.every((it) => it.insumo_id);
  const algumaUnidadeDivergente = itens.some((it) => {
    const ins = insumos.find((i) => i.id === it.insumo_id);
    return ins && ins.unidade !== it.unidade;
  });
  // Trava de sanidade. Não depende de regra nenhuma: compara o item com o
  // total da própria nota e com a maior nota já registrada. É o que teria
  // pego os R$ 270.000,00 em copos descartáveis.
  const motivoImplausivel = (item) => {
    const total = (item.quantidade || 0) * (item.preco_unitario || 0);
    if (total <= 0) return null;
    if (documento.valor_total > 0 && total > documento.valor_total * 1.5) {
      return `esse item sozinho vale ${brl(total)}, mais que o total da própria nota (${brl(documento.valor_total)})`;
    }
    if (maiorNota > 0 && total > maiorNota * 10) {
      return `${brl(total)} num item só — mais de dez vezes a maior nota já registrada (${brl(maiorNota)})`;
    }
    if (!documento.valor_total && !maiorNota && total > 20000) {
      return `${brl(total)} num item só parece alto demais`;
    }
    return null;
  };
  const implausiveis = itens.filter((it) => motivoImplausivel(it) && !conferidos.has(it.id));
  const podeConfirmar = todosVinculados && !algumaUnidadeDivergente && implausiveis.length === 0;
  const confirmar = async () => {
    if (!todosVinculados) { setErro("Vincule todos os itens a um insumo antes de confirmar."); return; }
    if (algumaUnidadeDivergente) { setErro("Tem item com unidade diferente da do insumo — corrija pelo lápis antes de confirmar."); return; }
    if (implausiveis.length > 0) { setErro("Tem item com valor implausível — ajuste a embalagem ou marque \"conferi, está certo\" antes de confirmar."); return; }
    setSalvando(true);
    setErro("");
    const { data: userData } = await supabase.auth.getUser();
    for (const item of itens) {
      // grava a movimentação de entrada no estoque
      const { error: errMov } = await supabase.from("movimentacoes_estoque").insert({
        insumo_id: item.insumo_id,
        tipo: "compra",
        quantidade: item.quantidade,
        preco_unitario: item.preco_unitario,
        fornecedor: documento.fornecedor || null,
        forma_pagamento: formaPagamento,
        documento_compra_id: documento.id,
        criado_por: userData?.user?.id,
      });
      if (errMov) { setErro(errMov.message); setSalvando(false); return; }
      // atualiza o custo do insumo pro preço dessa última compra confirmada
      // (só se o insumo não for composto — o custo dele é calculado, não digitado)
      const { data: insumoAtual } = await supabase.from("insumos").select("composto").eq("id", item.insumo_id).single();
      if (!insumoAtual?.composto) {
        await supabase.from("insumos").update({ custo_medio_atual: item.preco_unitario, atualizado_em: new Date().toISOString() }).eq("id", item.insumo_id);
      }
      // aprende o sinônimo, se o nome lido for diferente do nome do insumo
      const insumoVinculado = insumos.find((i) => i.id === item.insumo_id);
      if (insumoVinculado && insumoVinculado.nome.trim().toLowerCase() !== item.nome_lido.trim().toLowerCase()) {
        await supabase.from("insumo_sinonimos").insert({ nome_variante: item.nome_lido, insumo_id: item.insumo_id }).select();
      }
    }
    // O valor do cabeçalho passa a ser a soma dos itens conferidos.
    // Antes, o número que a IA leu da nota ficava para sempre no
    // documento, mesmo depois de você corrigir os itens — e a lista
    // mostrava um valor que não correspondia a nada (a nota da SIBELY
    // aparecia como R$ 539.600 sendo que valeu R$ 549,40).
    const valorConferido = round2(itens.reduce((s, it) => s + it.quantidade * it.preco_unitario, 0));
    await supabase.from("documentos_compra").update({
      status: "confirmado",
      confirmado_em: new Date().toISOString(),
      valor_total: valorConferido,
    }).eq("id", documento.id);
    // Toda nota confirmada vira um registro em Contas a Pagar — pago ou a
    // pagar, mas sempre lá, pra ter o valor de toda compra num lugar só.
    // Boleto entra como pendente (com vencimento); pix/débito/crédito
    // entra já como pago (foi pago na hora da compra).
    {
      const ehBoleto = formaPagamento === "boleto";
      // Boleto: a data que você digitou. Pago na hora: a data da nota
      // (ou hoje, se a nota não trouxer data) — porque o dinheiro saiu
      // quando a compra aconteceu, não quando a nota foi conferida.
      const dataDaNota = documento.data_documento || new Date().toISOString().slice(0, 10);
      const vencimento = ehBoleto ? (vencimentoBoleto || dataDaNota) : dataDaNota;
      const valorTotal = round2(itens.reduce((s, it) => s + it.quantidade * it.preco_unitario, 0));
      await supabase.from("contas_pagar").insert({
        documento_compra_id: documento.id,
        fornecedor_id: fornecedorAtual.id,
        fornecedor_nome: fornecedorAtual.nome,
        descricao: `Nota fiscal — ${fornecedorAtual.nome || "fornecedor não identificado"}`,
        valor_total: valorTotal,
        valor_pago: ehBoleto ? 0 : valorTotal,
        status: ehBoleto ? "pendente" : "pago",
        forma_pagamento: formaPagamento,
        categoria: "compra",
        centro_custo: "insumos",
        data_compra: documento.data_documento || new Date().toISOString().slice(0, 10),
        data_vencimento: vencimento,
        criado_por: userData?.user?.id,
      });
    }
    setSalvando(false);
    onVoltar();
  };
  return (
    <div>
      <button onClick={onVoltar} style={{ ...linkBtn, display: "flex", alignItems: "center", gap: 4, marginBottom: 14 }}>
        <ChevronLeft size={14} /> Voltar
      </button>
      <div style={{ ...cardStyle, marginBottom: 14, display: "flex", alignItems: "center", gap: 12 }}>
        <div style={iconBox}><FileText size={18} color="#8A8778" /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editandoFornecedor ? (
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
              <input list="lista-fornecedores" value={nomeFornecedorInput} onChange={(e) => setNomeFornecedorInput(e.target.value)}
                placeholder="Nome do fornecedor" autoFocus
                style={{ flex: 1, minWidth: 0, padding: "5px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13 }} />
              <datalist id="lista-fornecedores">
                {fornecedores.map((f) => <option key={f.id} value={f.nome} />)}
              </datalist>
              <button onClick={salvarFornecedor} style={{ ...ghostIconBtn, color: "#2F8F5B", flexShrink: 0 }} aria-label="Salvar fornecedor"><Check size={16} /></button>
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#22231F" }}>{fornecedorAtual.nome || "Fornecedor não identificado"}</div>
              <button onClick={() => { setNomeFornecedorInput(fornecedorAtual.nome); setEditandoFornecedor(true); }} style={ghostIconBtn} aria-label="Editar fornecedor"><Pencil size={13} /></button>
            </div>
          )}
          <div style={{ fontSize: 12, color: "#8A8778" }}>{fmtData(documento.data_documento || documento.criado_em)} · {itens.length} itens lidos pela IA</div>
        </div>
        {documento.arquivo_path ? (
          <button onClick={abrirOriginal} disabled={abrindoOriginal}
            title="Abre a nota escaneada numa aba nova"
            style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {abrindoOriginal ? <Loader2 size={14} /> : <Eye size={14} />}
            Ver original
            <ExternalLink size={12} style={{ opacity: 0.55 }} />
          </button>
        ) : (
          <span style={{ fontSize: 11, fontWeight: 700, color: "#3A6684", background: "#EAF1F7", borderRadius: 999, padding: "5px 11px", flexShrink: 0 }}>
            compra manual
          </span>
        )}
      </div>

      {fornecedorAtual.id && historicoFornecedor.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 8 }}>Histórico com {fornecedorAtual.nome}</div>
          {historicoFornecedor.map((h) => (
            <div key={h.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "4px 0", borderTop: "1px solid #F0EBDD" }}>
              <span style={{ color: "#8A8778" }}>{fmtData(h.data_documento || h.criado_em)}</span>
              <span style={{ color: "#22231F" }}>{brl(h.valor_total)}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, paddingTop: 6, marginTop: 4, borderTop: "1px solid #E8E2D2" }}>
            <span>Total no período</span>
            <span>{brl(historicoFornecedor.reduce((s, h) => s + (h.valor_total || 0), 0))}</span>
          </div>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={sectionLabel}>Itens encontrados</div>
        <button onClick={adicionarItemManual} style={{ ...linkBtn, fontSize: 12 }}>+ Adicionar item manualmente</button>
      </div>
      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", marginBottom: 16, background: "#FFFFFF" }}>
          <div style={{ ...linhaTabela, background: "#F6F1E7", borderBottom: "1px solid #E8E2D2", fontSize: 10, fontWeight: 700, letterSpacing: 0.3, textTransform: "uppercase", color: "#8A8778" }}>
            <span>Produto</span><span style={{ textAlign: "right" }}>Qtd.</span><span>Unid.</span><span style={{ textAlign: "right" }}>Vl. unit.</span><span style={{ textAlign: "right" }}>Vl. total</span><span></span>
          </div>
          {/* Ordem da lista: primeiro o que você acabou de adicionar,
              depois o que já está vinculado, e por último o que ainda
              precisa de decisão. O trabalho que falta fica junto, num
              bloco só, em vez de espalhado entre os que já estão prontos.

              A ordenação é estável: dentro de cada grupo, a sequência
              original da nota é mantida. */}
          {[...itens].sort((a, b) => {
            const peso = (i) => recemAdicionados.has(i.id) ? 0 : (i.insumo_id ? 1 : 2);
            return peso(a) - peso(b);
          }).map((item, idx) => {
            const semInsumo = !item.insumo_id;
            const insumoVinculadoRow = insumos.find((i) => i.id === item.insumo_id);
            const unidadeDivergente = !semInsumo && insumoVinculadoRow && insumoVinculadoRow.unidade !== item.unidade;
            const motivo = motivoImplausivel(item);
            const alertaAtivo = motivo && !conferidos.has(item.id);
            const det = detectarEmbalagem(item.nome_lido);
            const temRegra = regras.some((r) => norm(r.nome_lido) === norm(item.nome_lido));
            return (
              <div key={item.id} style={{
                background: alertaAtivo ? "#FCEBEB" : item.alerta_preco ? "#FCEBEB" : unidadeDivergente ? "#FBF3D9" : "#FFFFFF",
                borderTop: idx > 0 ? "1px solid #F0EBDD" : "none",
              }}>
                <div style={linhaTabela}>
                  <span style={{ fontSize: 12, color: item.alerta_preco ? "#501313" : "#22231F", fontWeight: item.alerta_preco ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {item.nome_lido}
                  </span>
                  <span style={{ fontSize: 12, color: "#22231F", textAlign: "right" }}>{item.quantidade}</span>
                  <span style={{ fontSize: 12, color: unidadeDivergente ? "#854F0B" : "#8A8778", fontWeight: unidadeDivergente ? 700 : 400 }}>{item.unidade}</span>
                  <span style={{ fontSize: 12, color: "#22231F", textAlign: "right" }}>{brl(item.preco_unitario)}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#22231F", textAlign: "right" }}>{brl(item.quantidade * item.preco_unitario)}</span>
                  <span style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                    <button onClick={() => abrirEdicao(item)} style={ghostIconBtn} aria-label="Editar item"><Pencil size={14} /></button>
                    <button onClick={() => removerItem(item.id)} style={{ ...ghostIconBtn, color: "#C4432B" }} aria-label="Remover item"><Trash2 size={14} /></button>
                  </span>
                </div>
                {semInsumo && (
                  <div style={{ fontSize: 11, color: "#8A6A0F", padding: "0 10px 8px" }}>→ insumo não reconhecido — escolher ou criar abaixo</div>
                )}
                {!semInsumo && (
                  <div style={{ fontSize: 11, color: item.alerta_preco ? "#791F1F" : "#8A8778", padding: "0 10px 8px" }}>
                    → vinculado a: {insumoVinculadoRow?.nome}
                  </div>
                )}
                {unidadeDivergente && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderTop: "1px solid #E8D48A", fontSize: 12, color: "#7A6A1E" }}>
                    <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                    Essa nota veio em <strong>{item.unidade}</strong>, mas o insumo "{insumoVinculadoRow?.nome}" é controlado em <strong>{insumoVinculadoRow?.unidade}</strong> — ajuste a quantidade e a unidade pelo lápis antes de confirmar, ou o estoque fica errado.
                  </div>
                )}
                {item.alerta_preco && (
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderTop: "1px solid #F09595", fontSize: 12, color: "#791F1F" }}>
                    <AlertTriangle size={14} style={{ flexShrink: 0 }} />
                    {(((item.preco_unitario / item.preco_anterior) - 1) * 100).toFixed(0)}% acima da última compra ({brl(item.preco_anterior)})
                  </div>
                )}

                {/* Regra de embalagem já aprendida foi aplicada nesse item */}
                {aplicadas[item.id] && (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "8px 10px", borderTop: "1px solid #A9D3C0", background: "#2F8F5B12", fontSize: 11.5, color: "#0F6E56" }}>
                    <Check size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                    <div>
                      <b>Regra aplicada:</b> {aplicadas[item.id].texto}.{" "}
                      <span style={{ color: "#8A8778" }}>
                        A IA tinha lido {aplicadas[item.id].anterior.quantidade} {aplicadas[item.id].anterior.unidade} a {brl(aplicadas[item.id].anterior.preco_unitario)}.
                      </span>{" "}
                      <button onClick={() => desfazerRegra(item)} style={{ ...linkBtn, fontSize: 11.5, color: "#185FA5" }}>desfazer</button>
                    </div>
                  </div>
                )}

                {/* Trava de sanidade — bloqueia o confirmar */}
                {alertaAtivo && (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "9px 10px", borderTop: "1px solid #F09595", fontSize: 12, color: "#791F1F" }}>
                    <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <b>Esse valor não parece certo</b> — {motivo}.
                      {det && (
                        <> O nome traz <b>{det.pacotes}×{det.porPacote}</b>, então provavelmente são {round2(det.pacotes * det.porPacote)} unidades e o preço lido é o do pacote.</>
                      )}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 7 }}>
                        <button onClick={() => abrirEmbalagem(item)} style={{ ...btnSecondary, fontSize: 12, padding: "5px 10px" }}>Definir embalagem</button>
                        <button onClick={() => setConferidos((prev) => new Set(prev).add(item.id))} style={{ ...linkBtn, fontSize: 12, color: "#791F1F" }}>
                          Conferi, está certo
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Atalho discreto quando não há alerta nem regra, mas o nome
                    tem cara de embalagem múltipla (20X50U e afins) */}
                {!alertaAtivo && !temRegra && !aplicadas[item.id] && det && embalagemItem !== item.id && (
                  <div style={{ padding: "0 10px 8px" }}>
                    <button onClick={() => abrirEmbalagem(item)} style={{ ...linkBtn, fontSize: 11.5 }}>
                      Definir como esse produto vem embalado ({det.pacotes}×{det.porPacote})
                    </button>
                  </div>
                )}

                {/* Bloco que ensina a embalagem */}
                {embalagemItem === item.id && (
                  <div style={{ border: "1px dashed #37A0E5", borderRadius: 10, padding: 12, margin: "0 10px 12px", background: "#F7FBFE" }}>
                    <div style={{ fontSize: 11.5, color: "#185FA5", fontWeight: 700, marginBottom: 2 }}>Como esse produto vem embalado?</div>
                    <div style={{ fontSize: 11, color: "#5C5A4E", marginBottom: 10, lineHeight: 1.45 }}>
                      {det
                        ? <>Detectei <b>{det.pacotes}×{det.porPacote}</b> no nome e já preenchi abaixo. Confirme ou corrija.</>
                        : <>Não achei um padrão no nome — preencha na mão.</>}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                      <div style={{ flex: 1, minWidth: 80 }}>
                        <label style={{ fontSize: 10, color: "#8A8778", display: "block", marginBottom: 3 }}>Vem em</label>
                        <input type="number" value={formEmb.pacotes} onChange={(e) => setFormEmb((f) => ({ ...f, pacotes: e.target.value }))}
                          style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 80 }}>
                        <label style={{ fontSize: 10, color: "#8A8778", display: "block", marginBottom: 3 }}>pacotes, cada um com</label>
                        <input type="number" value={formEmb.porPacote} onChange={(e) => setFormEmb((f) => ({ ...f, porPacote: e.target.value }))}
                          style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid #37A0E5", fontSize: 12 }} />
                      </div>
                      <div style={{ width: 70 }}>
                        <label style={{ fontSize: 10, color: "#8A8778", display: "block", marginBottom: 3 }}>unidade</label>
                        <select value={formEmb.unidade} onChange={(e) => setFormEmb((f) => ({ ...f, unidade: e.target.value }))}
                          style={{ width: "100%", boxSizing: "border-box", padding: "6px 4px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, background: "#FFFFFF" }}>
                          {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, background: "#F6F1E7", border: "1px solid #E8E2D2", borderRadius: 6, padding: "6px 10px", marginTop: 9, display: "inline-block" }}>
                      1 compra dessas = <b style={{ color: "#0F6E56" }}>{round2((parseFloat(formEmb.pacotes) || 0) * (parseFloat(formEmb.porPacote) || 0))} {formEmb.unidade}</b>
                      {formEmb.precoPor === "pacote" && (parseFloat(formEmb.porPacote) || 0) > 0 && (
                        <> · custo real <b style={{ color: "#0F6E56" }}>{brl((item.preco_unitario || 0) / (parseFloat(formEmb.porPacote) || 1))} / {formEmb.unidade}</b></>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 14, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ color: "#8A8778", fontSize: 11 }}>O {brl(item.preco_unitario)} da nota é o preço de:</span>
                      <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12 }}>
                        <input type="radio" checked={formEmb.precoPor === "pacote"} onChange={() => setFormEmb((f) => ({ ...f, precoPor: "pacote" }))} /> 1 pacote
                      </label>
                      <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 12 }}>
                        <input type="radio" checked={formEmb.precoPor === "unidade"} onChange={() => setFormEmb((f) => ({ ...f, precoPor: "unidade" }))} /> 1 unidade
                      </label>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                      <button onClick={() => aplicarEmbalagem(item, true)} style={{ ...btnPrimary, fontSize: 12.5, padding: "9px 15px" }}>
                        Aplicar e lembrar desse produto
                      </button>
                      <button onClick={() => aplicarEmbalagem(item, false)} style={{ ...btnSecondary, fontSize: 12, padding: "7px 12px" }}>
                        Só nessa nota
                      </button>
                      <button onClick={() => setEmbalagemItem(null)} style={{ ...linkBtn, fontSize: 12 }}>Cancelar</button>
                    </div>
                  </div>
                )}
                {/* O seletor fica SEMPRE aberto, não só quando falta vincular.
                    O casamento automático erra — "OVOMALTINE 750 GRAMAS" já
                    caiu em "Ovos" —, e antes só dava pra corrigir entrando na
                    edição do item. Errar é rápido; consertar tinha que ser
                    igual de rápido. */}
                {/* Escondido enquanto o lápis está aberto: o formulário de
                    edição já tem o campo "Vinculado a", e os dois juntos
                    davam duas caixas pra mesma coisa na mesma tela. */}
                {criarInsumoAberto !== item.id && editandoId !== item.id && (
                  <div style={{
                    display: "flex", gap: 6, padding: "8px 10px", alignItems: "center",
                    borderTop: `1px dashed ${semInsumo ? "#E8D48A" : "#E8E2D2"}`,
                    flexWrap: "wrap",
                  }}>
                    <span style={{ fontSize: 11, color: "#8A8778", whiteSpace: "nowrap" }}>
                      Vinculado a
                    </span>
                    <BuscaInsumo
                      insumos={insumos}
                      valor={item.insumo_id || ""}
                      alerta={semInsumo}
                      onEscolher={(id) => vincularInsumo(item.id, id)}
                      onCriar={(texto) => { setCriarInsumoAberto(item.id); setNovoInsumoNome(texto); setNovoInsumoUnidade(item.unidade); }}
                    />
                    {/* Só faz sentido quando ainda não tem insumo. Item já
                        vinculado com um "Criar novo" do lado é convite a
                        criar insumo duplicado. */}
                    {semInsumo && (
                      <button onClick={() => { setCriarInsumoAberto(item.id); setNovoInsumoNome(item.nome_lido); setNovoInsumoUnidade(item.unidade); }}
                        style={{ ...btnSecondary, fontSize: 12, padding: "5px 10px" }}>Criar novo</button>
                    )}
                  </div>
                )}
                {criarInsumoAberto === item.id && (
                  <div style={{ display: "flex", gap: 6, padding: "8px 10px", borderTop: "1px dashed #E8D48A", flexWrap: "wrap" }}>
                    <input value={novoInsumoNome} onChange={(e) => setNovoInsumoNome(e.target.value)}
                      style={{ flex: 1, minWidth: 100, padding: "5px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                    <select value={novoInsumoUnidade} onChange={(e) => setNovoInsumoUnidade(e.target.value)}
                      style={{ padding: "5px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }}>
                      {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                    <button onClick={() => criarEVincularInsumo(item)} style={{ ...btnSecondary, fontSize: 12, padding: "5px 10px" }}>Salvar</button>
                  </div>
                )}
                {editandoId === item.id && (
                  <div style={{ padding: "10px", borderTop: "1px solid #E8E2D2", display: "grid", gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 3 }}>Descrição</label>
                      <input value={formEdicao.nome_lido} onChange={(e) => setFormEdicao((f) => ({ ...f, nome_lido: e.target.value }))}
                        style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                    </div>
                    <div style={{ border: "1px dashed #37A0E5", borderRadius: 8, padding: 10 }}>
                      <div style={{ fontSize: 11, color: "#185FA5", marginBottom: 8 }}>Veio em pacotes/potes? Calcule a quantidade total aqui</div>
                      <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: 10, color: "#8A8778", display: "block", marginBottom: 2 }}>Quantos pacotes</label>
                          <input type="number" value={calcPacotes.qtd} onChange={(e) => setCalcPacotes((c) => ({ ...c, qtd: e.target.value }))}
                            style={{ width: "100%", boxSizing: "border-box", padding: "5px 7px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: 10, color: "#8A8778", display: "block", marginBottom: 2 }}>Tamanho de cada um</label>
                          <div style={{ display: "flex", gap: 4 }}>
                            <input type="number" value={calcPacotes.tamanho} onChange={(e) => setCalcPacotes((c) => ({ ...c, tamanho: e.target.value }))}
                              style={{ flex: 1, minWidth: 0, padding: "5px 7px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                            <select value={calcPacotes.unidade} onChange={(e) => setCalcPacotes((c) => ({ ...c, unidade: e.target.value }))}
                              style={{ width: 55, padding: "5px 4px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, background: "#FFFFFF" }}>
                              {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11, color: "#8A8778" }}>
                          = {round2((parseFloat(calcPacotes.qtd) || 0) * (parseFloat(calcPacotes.tamanho) || 0))} {calcPacotes.unidade}
                        </span>
                        <button onClick={aplicarCalculadoraPacotes} style={{ ...btnSecondary, fontSize: 11, padding: "4px 10px" }}>Usar esse valor</button>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 3 }}>Quantidade</label>
                        <input type="number" value={formEdicao.quantidade} onChange={(e) => setFormEdicao((f) => ({ ...f, quantidade: e.target.value }))}
                          style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 3 }}>Unidade</label>
                        <select value={formEdicao.unidade} onChange={(e) => setFormEdicao((f) => ({ ...f, unidade: e.target.value }))}
                          style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, background: "#FFFFFF" }}>
                          {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 3 }}>Valor unitário</label>
                        <input type="number" step="0.01" value={formEdicao.preco_unitario}
                          onChange={(e) => setFormEdicao((f) => ({ ...f, preco_unitario: e.target.value }))}
                          style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                      </div>
                      <div style={{ flex: 1 }}>
                        <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 3 }}>Valor total</label>
                        <input type="number" step="0.01"
                          value={round2((parseFloat(formEdicao.quantidade) || 0) * (parseFloat(formEdicao.preco_unitario) || 0))}
                          onChange={(e) => {
                            const novoTotal = parseFloat(e.target.value) || 0;
                            const qtd = parseFloat(formEdicao.quantidade) || 0;
                            setFormEdicao((f) => ({ ...f, preco_unitario: qtd > 0 ? novoTotal / qtd : 0 }));
                          }}
                          style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid #37A0E5", fontSize: 12 }} />
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: "#8A8778" }}>Preenche um dos dois — o outro calcula sozinho (baseado na quantidade).</div>
                    <div>
                      <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 3 }}>Vinculado a</label>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <BuscaInsumo
                          insumos={insumos}
                          valor={formEdicao.insumo_id}
                          alerta={!formEdicao.insumo_id}
                          onEscolher={(id) => setFormEdicao((f) => ({ ...f, insumo_id: id || "" }))}
                          onCriar={(texto) => {
                            setCriarInsumoAberto(item.id);
                            setNovoInsumoNome(texto);
                            setNovoInsumoUnidade(formEdicao.unidade);
                          }}
                        />
                        {formEdicao.insumo_id && !renomeandoInsumo && (
                          <button onClick={() => { setNomeInsumoInput(insumos.find((i) => i.id === formEdicao.insumo_id)?.nome || ""); setRenomeandoInsumo(true); }}
                            style={ghostIconBtn} aria-label="Renomear insumo vinculado" title="Renomear esse insumo (corrige em todo lugar que usa ele)">
                            <Pencil size={14} />
                          </button>
                        )}
                        <button onClick={salvarEdicao} style={{ ...ghostIconBtn, color: "#2F8F5B" }} aria-label="Confirmar edição"><Check size={16} /></button>
                      </div>
                      {renomeandoInsumo && (
                        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                          <input value={nomeInsumoInput} onChange={(e) => setNomeInsumoInput(e.target.value)} autoFocus
                            onKeyDown={(e) => e.key === "Enter" && renomearInsumoVinculado()}
                            placeholder="Novo nome do insumo" style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1px solid #37A0E5", fontSize: 12 }} />
                          <button onClick={renomearInsumoVinculado} style={{ ...btnSecondary, fontSize: 12, padding: "5px 10px" }}>Salvar nome</button>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {itens.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Nenhum item lido nesse documento.</div>}
        </div>
      )}
      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 4 }}>Forma de pagamento</label>
        <select value={formaPagamento} onChange={(e) => setFormaPagamento(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", padding: "7px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF" }}>
          {formasPagamento.map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
        </select>
        {formaPagamento === "boleto" && (
          <div style={{ marginTop: 6 }}>
            <label style={{ fontSize: 10, color: "#8A6A0F", display: "block", marginBottom: 3 }}>
              Vencimento do boleto
            </label>
            <input type="date" value={vencimentoBoleto} onChange={(e) => setVencimentoBoleto(e.target.value)}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #37A0E5", fontSize: 13,
                       fontFamily: "inherit", background: "#FFFFFF", color: "#22231F" }} />
            {/* O painel não adivinha a data: ele olha o último boleto
                desse mesmo fornecedor e sugere o mesmo intervalo. Se o
                Serena sempre vence em 28 dias, no mês que vem já vem
                preenchido — e continua sendo uma sugestão, não um fato. */}
            {prazoAprendido && (
              <div style={{ fontSize: 10, color: "#4C3E77", marginTop: 4 }}>
                sugerido: {prazoAprendido.dias} dias depois da nota, como no último boleto
                {prazoAprendido.de ? ` de ${prazoAprendido.de}` : ""} — mude se o boleto disser outra data
              </div>
            )}
          </div>
        )}
        <div style={{ fontSize: 10, color: "#8A8778", marginTop: 6 }}>
          {formaPagamento === "boleto"
            ? "Gera uma conta a pagar com esse vencimento, no valor total da nota."
            : "Pix/débito/crédito entra em Contas a Pagar já marcado como pago, na data da nota."}
        </div>
      </div>
      {erro && <div style={{ color: "#C4432B", fontSize: 13, marginBottom: 12 }}>{erro}</div>}
      <button onClick={confirmar} disabled={salvando || !podeConfirmar} style={{ ...btnPrimary, width: "100%" }}>
        {salvando ? <Loader2 size={16} /> : <Check size={16} />}
        Confirmar e lançar no estoque
      </button>
      {!todosVinculados && !carregando && itens.length > 0 && (
        <div style={{ fontSize: 12, color: "#8A8778", marginTop: 8, textAlign: "center" }}>Vincule todos os itens a um insumo pra poder confirmar.</div>
      )}
      {todosVinculados && algumaUnidadeDivergente && !carregando && (
        <div style={{ fontSize: 12, color: "#854F0B", marginTop: 8, textAlign: "center" }}>Corrija a unidade divergente (destacada em amarelo) pra poder confirmar.</div>
      )}
      {implausiveis.length > 0 && !carregando && (
        <div style={{ fontSize: 12, color: "#791F1F", marginTop: 8, textAlign: "center" }}>
          {implausiveis.length === 1 ? "Tem 1 item com valor implausível" : `Tem ${implausiveis.length} itens com valor implausível`} (em vermelho) — ajuste a embalagem ou marque que conferiu.
        </div>
      )}
    </div>
  );
}
// ---------------------------------------------------------------------------
// Regras de produto: manutenção do que o sistema aprendeu sobre embalagem.
// Existe pra você poder consertar uma regra que aprendeu errado sem ter que
// esperar a próxima nota daquele produto chegar.
// ---------------------------------------------------------------------------
function RegrasProduto({ onVoltar }) {
  const [regras, setRegras] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState({ pacotes: "1", porPacote: "1", unidade: "un", precoPor: "pacote" });

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [{ data: regrasData, error }, { data: insumosData }] = await Promise.all([
      supabase.from("produto_regras").select("*").order("atualizada_em", { ascending: false }),
      supabase.from("insumos").select("id, nome, unidade").order("nome"),
    ]);
    if (error) setErro(error.message);
    setRegras(regrasData || []);
    setInsumos(insumosData || []);
    setCarregando(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const abrirEdicao = (r) => {
    setEditando(r.id);
    setForm({
      pacotes: String(r.pacotes ?? 1),
      porPacote: String(r.unidades_por_pacote ?? 1),
      unidade: r.unidade || "un",
      precoPor: r.preco_por || "pacote",
    });
  };

  const salvar = async (r) => {
    const pacotes = parseFloat(form.pacotes) || 1;
    const porPacote = parseFloat(form.porPacote) || 1;
    // Recalcula os fatores mantendo a proporção original entre o que a IA
    // leu e o que ficou certo — se a embalagem muda, o fator muda junto.
    const fatorQuantidade = Number(r.unidades_por_pacote) > 0 && Number(r.pacotes) > 0
      ? Number(r.fator_quantidade) * ((pacotes * porPacote) / (Number(r.pacotes) * Number(r.unidades_por_pacote)))
      : Number(r.fator_quantidade);
    const fatorPreco = form.precoPor === "pacote" ? 1 / porPacote : 1;
    const { error } = await supabase.from("produto_regras").update({
      pacotes, unidades_por_pacote: porPacote, unidade: form.unidade, preco_por: form.precoPor,
      fator_quantidade: fatorQuantidade, fator_preco: fatorPreco,
      atualizada_em: new Date().toISOString(),
    }).eq("id", r.id);
    if (error) { setErro(error.message); return; }
    setEditando(null);
    carregar();
  };

  const excluir = async (r) => {
    if (!window.confirm(`Esquecer a regra de "${r.nome_lido}"? As notas já confirmadas não mudam — só para de aplicar daqui pra frente.`)) return;
    const { error } = await supabase.from("produto_regras").delete().eq("id", r.id);
    if (error) { setErro(error.message); return; }
    carregar();
  };

  return (
    <div>
      <button onClick={onVoltar} style={{ ...linkBtn, display: "flex", alignItems: "center", gap: 4, marginBottom: 14 }}>
        <ChevronLeft size={14} /> Voltar
      </button>
      <div style={sectionLabel}>Regras aprendidas</div>
      <div style={{ fontSize: 12, color: "#8A8778", marginBottom: 12, lineHeight: 1.5 }}>
        Cada regra guarda como um produto vem embalado. Quando esse mesmo produto aparecer numa nota nova, a quantidade e o preço já chegam convertidos.
      </div>
      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}
      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : regras.length === 0 ? (
        <div style={{ ...cardStyle, fontSize: 13, color: "#8A8778" }}>
          Nenhuma regra ainda. Elas nascem na conferência de uma nota, quando você define como um produto vem embalado e marca pra lembrar.
        </div>
      ) : (
        <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF" }}>
          {regras.map((r, idx) => {
            const ins = insumos.find((i) => i.id === r.insumo_id);
            return (
              <div key={r.id} style={{ borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "#22231F", overflow: "hidden", textOverflow: "ellipsis" }}>{r.nome_lido}</div>
                    <div style={{ fontSize: 11, color: "#8A8778", marginTop: 2 }}>
                      → {ins ? ins.nome : "sem insumo vinculado"} · {r.pacotes} × {r.unidades_por_pacote} {r.unidade} · preço por {r.preco_por}
                    </div>
                  </div>
                  <span style={{ ...pill, background: r.vezes_usada > 0 ? "#2F8F5B22" : "#FAC77555", color: r.vezes_usada > 0 ? "#0F6E56" : "#854F0B", whiteSpace: "nowrap", flexShrink: 0 }}>
                    {r.vezes_usada > 0 ? `${r.vezes_usada} ${r.vezes_usada === 1 ? "nota" : "notas"}` : "nunca usada"}
                  </span>
                  <button onClick={() => abrirEdicao(r)} style={ghostIconBtn} aria-label="Editar regra"><Pencil size={14} /></button>
                  <button onClick={() => excluir(r)} style={{ ...ghostIconBtn, color: "#C4432B" }} aria-label="Esquecer regra"><Trash2 size={14} /></button>
                </div>
                {editando === r.id && (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10, paddingTop: 10, borderTop: "1px dashed #E8E2D2" }}>
                    <div style={{ flex: 1, minWidth: 78 }}>
                      <label style={{ fontSize: 10, color: "#8A8778", display: "block", marginBottom: 3 }}>Pacotes</label>
                      <input type="number" value={form.pacotes} onChange={(e) => setForm((f) => ({ ...f, pacotes: e.target.value }))}
                        style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 78 }}>
                      <label style={{ fontSize: 10, color: "#8A8778", display: "block", marginBottom: 3 }}>Cada um com</label>
                      <input type="number" value={form.porPacote} onChange={(e) => setForm((f) => ({ ...f, porPacote: e.target.value }))}
                        style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid #37A0E5", fontSize: 12 }} />
                    </div>
                    <div style={{ width: 68 }}>
                      <label style={{ fontSize: 10, color: "#8A8778", display: "block", marginBottom: 3 }}>Unidade</label>
                      <select value={form.unidade} onChange={(e) => setForm((f) => ({ ...f, unidade: e.target.value }))}
                        style={{ width: "100%", boxSizing: "border-box", padding: "6px 4px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, background: "#FFFFFF" }}>
                        {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div style={{ minWidth: 130 }}>
                      <label style={{ fontSize: 10, color: "#8A8778", display: "block", marginBottom: 3 }}>Preço da nota é por</label>
                      <select value={form.precoPor} onChange={(e) => setForm((f) => ({ ...f, precoPor: e.target.value }))}
                        style={{ width: "100%", boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, background: "#FFFFFF" }}>
                        <option value="pacote">pacote</option>
                        <option value="unidade">unidade</option>
                      </select>
                    </div>
                    <button onClick={() => salvar(r)} style={{ ...btnSecondary, fontSize: 12, padding: "7px 12px" }}>Salvar</button>
                    <button onClick={() => setEditando(null)} style={{ ...linkBtn, fontSize: 12 }}>Cancelar</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Compra manual — o que não tem nota pra fotografar
//
// Feira, açougue, compra de última hora. Dinheiro que sai e antes não entrava
// em lugar nenhum, porque o único caminho era fotografar uma nota inexistente.
//
// Grava exatamente a mesma estrutura da nota — um documento_compra com seus
// itens, em 'aguardando_confirmacao' — e joga a pessoa na MESMA tela de
// conferência. Daí em diante estoque, custo médio e Contas a pagar seguem o
// caminho que já funciona.
//
// A pessoa digita QUANTO COMPROU e QUANTO PAGOU naquele item; o preço por
// quilo o sistema calcula. Na feira ninguém sabe o preço do quilo de cabeça —
// sabe o que pesou e o que pagou. Pedir o unitário obrigaria a dividir na
// hora, e é aí que entra número errado.
// ---------------------------------------------------------------------------
function CompraManual({ onVoltar, onCriada }) {
  const [fornecedor, setFornecedor] = useState("");
  const [dataCompra, setDataCompra] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [linhas, setLinhas] = useState([]);
  const [insumos, setInsumos] = useState([]);
  const [fornecedores, setFornecedores] = useState([]);
  const [escolhido, setEscolhido] = useState(null);
  const [qtd, setQtd] = useState("");
  const [valor, setValor] = useState("");
  const [criando, setCriando] = useState(null); // nome digitado que virou cadastro
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    (async () => {
      const [rIns, rForn] = await Promise.all([
        supabase.from("insumos").select("id, nome, unidade, custo_medio_atual").order("nome"),
        supabase.from("fornecedores").select("id, nome").order("nome"),
      ]);
      setInsumos(rIns.data || []);
      setFornecedores(rForn.data || []);
    })();
  }, []);

  const total = linhas.reduce((s, l) => s + (Number(l.valor) || 0), 0);

  const adicionar = () => {
    if (!escolhido) return;
    const q = parseFloat(String(qtd).replace(",", ".")) || 0;
    const v = parseFloat(String(valor).replace(",", ".")) || 0;
    if (q <= 0) { setErro("Informe a quantidade comprada."); return; }
    setErro("");
    setLinhas((prev) => [...prev, {
      insumo_id: escolhido.id, nome: escolhido.nome, unidade: escolhido.unidade,
      quantidade: q, valor: v,
    }]);
    setEscolhido(null); setQtd(""); setValor("");
  };

  const salvar = async () => {
    if (linhas.length === 0) { setErro("Adicione pelo menos um item."); return; }
    setSalvando(true);
    setErro("");
    const { data: userData } = await supabase.auth.getUser();

    // Fornecedor: usa o que já existe (sem diferenciar acento/caixa) ou cria.
    let fornecedorId = null;
    const nome = fornecedor.trim();
    if (nome) {
      const achado = fornecedores.find((f) => norm(f.nome) === norm(nome));
      if (achado) fornecedorId = achado.id;
      else {
        const { data: novo } = await supabase.from("fornecedores").insert({ nome }).select().single();
        fornecedorId = novo?.id || null;
      }
    }

    const { data: doc, error } = await supabase.from("documentos_compra").insert({
      status: "aguardando_confirmacao",
      origem: "manual",
      fornecedor: nome || null,
      fornecedor_id: fornecedorId,
      data_documento: dataCompra,
      valor_total: round2(total),
      criado_por: userData?.user?.id,
    }).select().single();

    if (error) {
      setSalvando(false);
      setErro(/arquivo_path|null value|origem/i.test(error.message)
        ? "Falta rodar a migração 084 no banco — é ela que permite compra sem arquivo."
        : error.message);
      return;
    }

    const { error: errItens } = await supabase.from("itens_documento_compra").insert(
      linhas.map((l) => ({
        documento_id: doc.id,
        nome_lido: l.nome,
        quantidade: l.quantidade,
        unidade: l.unidade,
        preco_unitario: l.quantidade > 0 ? round4(l.valor / l.quantidade) : 0,
        insumo_id: l.insumo_id,
      }))
    );
    setSalvando(false);
    if (errItens) {
      // O documento já existe; deixar a pessoa achando que nada aconteceu
      // seria pior — ela lançaria tudo de novo em cima.
      setErro("A compra foi criada, mas os itens não gravaram: " + errItens.message);
      return;
    }
    onCriada(doc);
  };

  return (
    <div>
      <button onClick={onVoltar} style={{ ...linkBtn, display: "flex", alignItems: "center", gap: 4, marginBottom: 14 }}>
        <ChevronLeft size={14} /> Voltar
      </button>

      <div style={{ ...cardStyle, marginBottom: 12 }}>
        <div style={{ ...sectionLabel, marginBottom: 10 }}>Compra manual</div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
          <div>
            <label style={rotuloCM}>Onde comprou</label>
            <input list="fornecedores-manual" value={fornecedor} onChange={(e) => setFornecedor(e.target.value)}
              placeholder="Feira do Produtor" style={campoCM} />
            <datalist id="fornecedores-manual">
              {fornecedores.map((f) => <option key={f.id} value={f.nome} />)}
            </datalist>
          </div>
          <div>
            <label style={rotuloCM}>Data</label>
            <input type="date" value={dataCompra} onChange={(e) => setDataCompra(e.target.value)} style={campoCM} />
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 6, lineHeight: 1.5 }}>
          Fornecedor novo é criado na hora. Se já existir, ele aparece enquanto você digita.
        </div>
      </div>

      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}

      <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, background: "#FFFFFF", overflow: "hidden", marginBottom: 12 }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ ...thCM, textAlign: "left" }}>Insumo</th>
                <th style={thCM}>Quantidade</th>
                <th style={thCM}>Valor pago</th>
                <th style={thCM}>Sai a</th>
                <th style={thCM}></th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, idx) => {
                const unit = l.quantidade > 0 ? l.valor / l.quantidade : 0;
                return (
                  <tr key={`${l.insumo_id}-${idx}`}>
                    <td style={{ ...tdCM, textAlign: "left", whiteSpace: "normal", minWidth: 130 }}>{l.nome}</td>
                    <td style={tdCM}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <input value={l.quantidade}
                          onChange={(e) => setLinhas((p) => p.map((x, i) => i === idx ? { ...x, quantidade: parseFloat(String(e.target.value).replace(",", ".")) || 0 } : x))}
                          style={campoNumCM} />
                        <span style={unCM}>{l.unidade}</span>
                      </span>
                    </td>
                    <td style={tdCM}>
                      <input value={l.valor}
                        onChange={(e) => setLinhas((p) => p.map((x, i) => i === idx ? { ...x, valor: parseFloat(String(e.target.value).replace(",", ".")) || 0 } : x))}
                        style={campoNumCM} />
                    </td>
                    <td style={{ ...tdCM, color: "#8A8778", fontSize: 11.5 }}>{brl(unit)} /{l.unidade}</td>
                    <td style={tdCM}>
                      <button onClick={() => setLinhas((p) => p.filter((_, i) => i !== idx))}
                        style={{ ...ghostIconBtn, color: "#C4432B" }} aria-label="Tirar item"><Trash2 size={14} /></button>
                    </td>
                  </tr>
                );
              })}
              {linhas.length === 0 && (
                <tr><td colSpan={5} style={{ ...tdCM, textAlign: "center", color: "#8A8778" }}>Nenhum item ainda.</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2} style={{ ...tfCM, textAlign: "left", fontSize: 10, letterSpacing: 0.3, textTransform: "uppercase", color: "#8A8778" }}>Total da compra</td>
                <td style={tfCM}>{brl(total)}</td>
                <td colSpan={2} style={tfCM}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {criando === null ? (
          <div style={{ display: "flex", gap: 7, padding: "11px 12px", background: "#FCFAF3", borderTop: "1px dashed #DDD5BF", alignItems: "center", flexWrap: "wrap" }}>
            <BuscaInsumo insumos={insumos} onEscolher={(i) => setEscolhido(i)} onCriar={(texto) => setCriando(texto)} />
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <input value={qtd} onChange={(e) => setQtd(e.target.value)} placeholder="qtd" style={campoNumCM} />
              <span style={unCM}>{escolhido ? escolhido.unidade : "—"}</span>
            </span>
            <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder="R$" style={{ ...campoNumCM, width: 84 }} />
            <button onClick={adicionar} disabled={!escolhido}
              style={{ ...btnSecondary, background: escolhido ? "#22231F" : "#F6F1E7", color: escolhido ? "#F3EFE3" : "#B3AC96", borderColor: escolhido ? "#22231F" : "#E8E2D2", display: "flex", alignItems: "center", gap: 5 }}>
              <Plus size={14} /> Adicionar
            </button>
            {escolhido && (
              <div style={{ width: "100%", fontSize: 11, color: "#8A8778" }}>
                Escolhido: <strong>{escolhido.nome}</strong> · comprado em <strong>{escolhido.unidade}</strong>
              </div>
            )}
          </div>
        ) : (
          <CadastroRapidoInsumo
            nomeInicial={criando}
            onCancelar={() => setCriando(null)}
            onCriado={(novo) => {
              setInsumos((prev) => [...prev, novo].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
              setEscolhido(novo);
              setCriando(null);
            }}
          />
        )}
      </div>

      <button onClick={salvar} disabled={salvando || linhas.length === 0}
        style={{ ...btnPrimary, width: "100%" }}>
        {salvando ? <Loader2 size={16} /> : <Check size={16} />}
        {salvando ? "Criando…" : "Continuar para a conferência"}
      </button>
      <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 6, textAlign: "center", lineHeight: 1.5 }}>
        A compra vai pra lista como <strong>manual</strong>, aguardando conferência — o mesmo lugar das notas.
        É lá que você escolhe a forma de pagamento e confirma.
      </div>
    </div>
  );
}

// Cadastro rápido dentro da compra manual: aqui o preço vem da PRÓPRIA
// compra, então não se pergunta custo — só nome e como se compra.
function CadastroRapidoInsumo({ nomeInicial, onCriado, onCancelar }) {
  const [nome, setNome] = useState(nomeInicial);
  const [unidade, setUnidade] = useState("kg");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const salvar = async () => {
    if (!nome.trim()) { setErro("Dê um nome ao insumo."); return; }
    setSalvando(true);
    setErro("");
    const { data, error } = await supabase.from("insumos")
      .insert({ nome: nome.trim(), unidade, custo_medio_atual: 0 })
      .select().single();
    setSalvando(false);
    if (error) {
      setErro(/duplicate key|23505/i.test(error.message)
        ? "Já existe um insumo com esse nome — procure por ele na busca."
        : error.message);
      return;
    }
    onCriado(data);
  };

  return (
    <div style={{ padding: 12, background: "#FCFAF3", borderTop: "1px dashed #DDD5BF" }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 9 }}>Cadastrar insumo</div>
      <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do insumo"
        style={{ ...campoCM, marginBottom: 9 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 9 }}>
        <span style={{ fontSize: 12.5, color: "#8A8778" }}>Como você compra?</span>
        {[["kg", "Por peso (kg)"], ["l", "Por volume (l)"], ["un", "Por unidade"]].map(([v, rot]) => (
          <button key={v} onClick={() => setUnidade(v)}
            style={{ border: "1px solid #E8E2D2", borderRadius: 8, padding: "7px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
              background: unidade === v ? "#22231F" : "#FFFFFF", color: unidade === v ? "#F3EFE3" : "#55534A", borderColor: unidade === v ? "#22231F" : "#E8E2D2" }}>
            {rot}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 10.5, color: "#8A8778", marginBottom: 10, lineHeight: 1.5 }}>
        Não precisa informar preço: é esta compra que vai definir o custo dele.
      </div>
      {erro && <div style={{ fontSize: 12, color: "#A32D2D", marginBottom: 8 }}>{erro}</div>}
      <div style={{ display: "flex", gap: 7 }}>
        <button onClick={salvar} disabled={salvando}
          style={{ ...btnSecondary, background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" }}>
          {salvando ? "Salvando…" : "Cadastrar e escolher"}
        </button>
        <button onClick={onCancelar} style={btnSecondary}>Cancelar</button>
      </div>
    </div>
  );
}

const campoCM = { width: "100%", boxSizing: "border-box", padding: "8px 10px", borderRadius: 7, border: "1px solid #E8E2D2", fontSize: 13.5, fontFamily: "inherit", background: "#FFFFFF", color: "#22231F" };
const rotuloCM = { display: "block", fontSize: 10, color: "#8A8778", textTransform: "uppercase", letterSpacing: 0.3, marginBottom: 3 };
const campoNumCM = { width: 68, padding: "5px 7px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13, textAlign: "right", fontFamily: "inherit", fontVariantNumeric: "tabular-nums" };
const unCM = { border: "1px solid #E8E2D2", background: "#F6F1E7", color: "#55534A", borderRadius: 6, padding: "5px 8px", fontSize: 11.5, fontWeight: 700, minWidth: 32, textAlign: "center", display: "inline-block" };
const thCM = { background: "#F6F1E7", fontSize: 10, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase", color: "#8A8778", padding: "8px 11px", textAlign: "right", borderBottom: "1px solid #E8E2D2", whiteSpace: "nowrap" };
const tdCM = { padding: "9px 11px", textAlign: "right", borderBottom: "1px solid #F0EBDD", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: "#22231F" };
const tfCM = { padding: "9px 11px", textAlign: "right", background: "#F6F1E7", fontWeight: 800, borderTop: "1px solid #E8E2D2", fontVariantNumeric: "tabular-nums" };
const optStyle = { padding: "7px 10px", fontSize: 12.5, color: "#22231F", cursor: "pointer" };
const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const linhaTabela = { display: "grid", gridTemplateColumns: "2fr 0.6fr 0.5fr 0.8fr 0.8fr 0.6fr", gap: 6, padding: "8px 10px", alignItems: "center" };
const itemRow = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10, padding: "12px 14px" };
const iconBox = { width: 36, height: 44, borderRadius: 6, background: "#F6F1E7", border: "1px solid #E8E2D2", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };
const ghostIconBtn = { border: "none", background: "none", color: "#8A8778", cursor: "pointer", padding: 2, display: "flex" };
const iconBtnWrap = { border: "none", background: "none", padding: 0, cursor: "pointer", flexShrink: 0, display: "flex" };
const overlayStyle = { position: "fixed", inset: 0, background: "rgba(34,35,31,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 };
const modalStyle = { background: "#F3EFE3", border: "1px solid #E8E2D2", borderRadius: 14, width: "min(680px, 94vw)", maxHeight: "90vh", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: "0 12px 34px rgba(0,0,0,0.28)" };
const modalBarra = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "10px 12px", borderBottom: "1px solid #E8E2D2", background: "#F6F1E7" };
const modalCorpo = { padding: 10, overflow: "auto", background: "#FFFFFF" };
const btnPrimary = { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#22231F", color: "#F3EFE3", border: "none", borderRadius: 10, padding: "12px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer" };
const btnSecondary = { background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const linkBtn = { background: "none", border: "none", color: "#8A6A0F", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, textAlign: "left" };
const sectionLabel = { fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778", marginBottom: 8 };
const pill = { fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999 };
const avisoStyle = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 14 };
