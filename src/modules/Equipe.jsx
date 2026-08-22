import React, { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, Plus, Trash2, Pencil, Check, RefreshCw, AlertTriangle, ChevronLeft, ChevronRight, Eye, EyeOff, Search, Paperclip, Upload, Lock, Receipt, X } from "lucide-react";
import { supabase, extrairErroFuncao } from "../lib/supabaseClient";
import {
  buscarFiadoNoPeriodo, agruparPorPessoa, carregarBaixas, darBaixa,
  estornarBaixa, somar, diasAtrasISO,
} from "../lib/fiado";
// Ordem alfabética de verdade. O `order("nome")` do Postgres depende da
// collation do banco e às vezes joga nome acentuado ou em maiúscula pro
// fim da lista. localeCompare com "pt-BR" e sensitivity "base" trata
// "Água" junto de "Agua" e "ALFACE" junto de "Alface".
function porNome(a, b) {
  return String(a?.nome || "").localeCompare(String(b?.nome || ""), "pt-BR", { sensitivity: "base" });
}
function brl(v) { return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function hoje() { return new Date().toISOString().slice(0, 10); }
async function abrirDocumento(path) {
  if (!path) return;
  const { data, error } = await supabase.storage.from("documentos-pessoas").createSignedUrl(path, 300);
  if (error || !data?.signedUrl) { alert("Não consegui abrir o documento: " + (error?.message || "")); return; }
  window.open(data.signedUrl, "_blank");
}
const PAPEL_LABEL = { garcom: "Garçom", interno: "Equipe interna", caixa: "Caixa", bar: "Bar", chapa: "Chapa", cozinha: "Cozinha", limpeza: "Limpeza", gerente: "Gerente" };
const PAPEIS = ["garcom", "caixa", "bar", "chapa", "cozinha", "limpeza"];
const PAPEIS_COM_GERENTE = [...PAPEIS, "gerente"];
// Regra de divisão da premiação diária: só garçom fica no bolo dos
// garçons — todo o resto (caixa, bar, chapa, cozinha, limpeza, e o
// "interno" genérico antigo) cai junto no bolo da equipe interna.
// Gerente não entra em nenhum bolo — o cargo dela não participa da
// divisão diária de comissão de jeito nenhum (retorna null).
function categoriaComissao(papel) {
  if (papel === "gerente") return null;
  return papel === "garcom" ? "garcom" : "interno";
}
// Peso não é mais digitado à parte — é calculado a partir das horas
// trabalhadas, considerando um turno padrão de 8h (6h trabalhadas =
// peso 0,75, por exemplo). Simplifica pra só uma pergunta em vez de duas
// pra mesma coisa.
const HORAS_PADRAO_TURNO = 8;
// Turno da casa. Registrado tem horário fixo, então já abre preenchido —
// só mexe quem fugiu do padrão. Diarista varia, então só o intervalo vem
// pronto (é sempre 1 hora) e entrada/saída ficam em branco de propósito.
const TURNO_REGISTRADO = { entrada: "17:00", saida: "02:00" };
const INTERVALO_PADRAO_MIN = 60;
// ---------------------------------------------------------------------------
// Ponto: entrada, saída e intervalo -> horas trabalhadas
//
// A saída pode ser MENOR que a entrada, e isso não é erro: a casa
// trabalha das 17h às 03h, então virar o dia é o caso comum. Sem tratar
// isso, um turno de 17:30 às 01:30 daria dezesseis horas negativas e o
// peso do rateio ficaria negativo pra todo mundo naquele dia.
// ---------------------------------------------------------------------------
function minutosDoHorario(hhmm) {
  if (!hhmm) return null;
  const partes = String(hhmm).slice(0, 5).split(":");
  const h = Number(partes[0]), m = Number(partes[1]);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}
function horasDoPonto(entrada, saida, intervaloMinutos) {
  const ini = minutosDoHorario(entrada);
  const fim = minutosDoHorario(saida);
  if (ini === null || fim === null) return null;
  let total = fim - ini;
  if (total <= 0) total += 24 * 60; // virou o dia
  total -= parseInt(intervaloMinutos) || 0;
  if (total < 0) total = 0;
  return Math.round((total / 60) * 100) / 100;
}
// Texto do horário pra telas de leitura. Dia antigo (sem horário
// registrado) mostra só as horas, como sempre mostrou.
function textoPonto(part) {
  const h = part?.horas || 0;
  if (part?.entrada && part?.saida) {
    const intervalo = parseInt(part.intervalo) || 0;
    return `${part.entrada}–${part.saida}${intervalo > 0 ? ` · ${intervalo} min intervalo` : ""} · ${h}h`;
  }
  return `${h}h`;
}
const SUBABAS = [
  { chave: "pessoas", label: "Pessoas" },
  { chave: "matriz", label: "Matriz de cargos", soAdmin: true },
  { chave: "previsao", label: "Previsão de escala" },
  { chave: "premiacao", label: "Escala do dia" },
  { chave: "mensal", label: "Fechamento mensal", soAdmin: true },
];
// Só admin vê valores (salário, matriz de cargos, comissão calculada,
// fechamento mensal) — outras pessoas aprovadas só marcam quem trabalhou
// e quantas horas (isso é registrado no banco de qualquer forma, mas as
// telas de configuração de dinheiro ficam reforçadas no banco também —
// ver 022_acesso_a_valores.sql).
function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(null); // null = carregando
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data?.user) { setIsAdmin(false); return; }
      const { data: perfil } = await supabase.from("perfis").select("is_admin").eq("id", data.user.id).maybeSingle();
      setIsAdmin(perfil?.is_admin || false);
    });
  }, []);
  return isAdmin;
}
export default function Equipe() {
  const [subaba, setSubaba] = useState("pessoas");
  const isAdmin = useIsAdmin();
  const subabasVisiveis = SUBABAS.filter((a) => !a.soAdmin || isAdmin);
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {subabasVisiveis.map((a) => (
          <button key={a.chave} onClick={() => setSubaba(a.chave)}
            style={{ ...tabBtn, ...(subaba === a.chave ? tabBtnAtivo : {}) }}>
            {a.label}
          </button>
        ))}
      </div>
      {subaba === "pessoas" && <Pessoas isAdmin={isAdmin} />}
      {subaba === "matriz" && isAdmin && <MatrizCargos />}
      {subaba === "previsao" && <PrevisaoDeEscala />}
      {subaba === "premiacao" && <PremiacaoDoDia isAdmin={isAdmin} />}
      {subaba === "mensal" && isAdmin && <FechamentoMensal />}
    </div>
  );
}
// ---------------------------------------------------------------------------
// Previsão de Escala — planejamento de dias futuros, sem nenhum cálculo
// de valor (isso só acontece na Escala do dia, quando o dia chegar).
// Serve pra organizar quem está previsto pra trabalhar em cada dia.
// ---------------------------------------------------------------------------
function PrevisaoDeEscala() {
  const [dia, setDia] = useState(() => {
    const amanha = new Date();
    amanha.setDate(amanha.getDate() + 1);
    return amanha.toISOString().slice(0, 10);
  });
  const [pessoas, setPessoas] = useState([]);
  const [previstos, setPrevistos] = useState(new Set());
  const [fechada, setFechada] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const carregar = useCallback(async () => {
    setCarregando(true);
    setMensagem("");
    const [{ data: pessoasData, error }, { data: previsoesData }, { data: statusData }] = await Promise.all([
      supabase.from("pessoas").select("*").eq("ativo", true).order("nome"),
      supabase.from("previsoes_escala").select("pessoa_id").eq("dia", dia),
      supabase.from("previsoes_escala_dias").select("fechada").eq("dia", dia).maybeSingle(),
    ]);
    if (error) setErro(error.message);
    setPessoas([...(pessoasData || [])].sort(porNome));
    setPrevistos(new Set((previsoesData || []).map((p) => p.pessoa_id)));
    setFechada(statusData?.fechada || false);
    setCarregando(false);
  }, [dia]);
  useEffect(() => { carregar(); }, [carregar]);
  const alternar = async (pessoaId) => {
    const jaPrevisto = previstos.has(pessoaId);
    if (jaPrevisto) {
      await supabase.from("previsoes_escala").delete().eq("pessoa_id", pessoaId).eq("dia", dia);
    } else {
      await supabase.from("previsoes_escala").insert({ pessoa_id: pessoaId, dia });
    }
    setPrevistos((prev) => {
      const novo = new Set(prev);
      jaPrevisto ? novo.delete(pessoaId) : novo.add(pessoaId);
      return novo;
    });
    setMensagem("Previsão salva.");
  };
  const fecharPrevisao = async () => {
    await supabase.from("previsoes_escala_dias").upsert({ dia, fechada: true, atualizado_em: new Date().toISOString() }, { onConflict: "dia" });
    setFechada(true);
    setMensagem("");
  };
  const reabrirPrevisao = async () => {
    await supabase.from("previsoes_escala_dias").upsert({ dia, fechada: false, atualizado_em: new Date().toISOString() }, { onConflict: "dia" });
    setFechada(false);
  };
  const selecionados = pessoas.filter((p) => previstos.has(p.id));
  return (
    <div>
      <div style={{ fontSize: 12, color: "#8A8778", marginBottom: 14 }}>
        Só planejamento — sem taxa de serviço, sem cálculo de valor. Quando o dia chegar, marque de novo (ou confirme) na Escala do dia pra calcular os valores de verdade.
      </div>
      <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} style={{ ...inputStyle, marginBottom: 14 }} />
      {mensagem && <div style={{ ...avisoStyle, background: "#EAF3DE", borderColor: "#97C459", color: "#27500A" }}>{mensagem}</div>}
      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}
      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : fechada ? (
        <div>
          <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 8 }}>{selecionados.length} marcado{selecionados.length !== 1 ? "s" : ""} — previsão fechada</div>
          <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF", marginBottom: 12 }}>
            {selecionados.map((p, idx) => (
              <div key={p.id} style={{ padding: "10px 14px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none" }}>
                <div style={{ fontSize: 13, color: "#22231F" }}>{p.nome}</div>
                <div style={{ fontSize: 11, color: "#8A8778" }}>{PAPEL_LABEL[p.papel]}</div>
              </div>
            ))}
            {selecionados.length === 0 && <div style={{ padding: 14, fontSize: 13, color: "#8A8778" }}>Ninguém marcado nesse dia.</div>}
          </div>
          <button onClick={reabrirPrevisao} style={linkBtn}>✎ Editar de novo</button>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
            {pessoas.map((p) => (
              <div key={p.id} style={{ ...cardStyle, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                <input type="checkbox" checked={previstos.has(p.id)} onChange={() => alternar(p.id)} />
                <div>
                  <div style={{ fontSize: 13, color: "#22231F" }}>{p.nome}</div>
                  <div style={{ fontSize: 11, color: "#8A8778" }}>{PAPEL_LABEL[p.papel]}</div>
                </div>
              </div>
            ))}
            {pessoas.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Cadastre pessoas na aba "Pessoas" primeiro.</div>}
          </div>
          {pessoas.length > 0 && (
            <button onClick={fecharPrevisao} style={{ ...btnSecondary, width: "100%", display: "flex", justifyContent: "center", gap: 6 }}>
              <Check size={14} /> Fechar previsão desse dia
            </button>
          )}
        </>
      )}
    </div>
  );
}
// ---------------------------------------------------------------------------
// Matriz de cargos — diária base e valor hora, aplicados automaticamente
// a todo diarista daquele cargo (não se digita mais por pessoa).
// ---------------------------------------------------------------------------
function MatrizCargos() {
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.from("matriz_cargos").select("*");
    if (error) setErro(error.message);
    const mapa = Object.fromEntries((data || []).map((d) => [d.papel, d]));
    setLinhas(PAPEIS.map((p) => ({
      papel: p,
      diaria_base: String(mapa[p]?.diaria_base ?? 0),
      valor_hora: String(mapa[p]?.valor_hora ?? 0),
    })));
    setCarregando(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const alterar = (papel, campo, valor) => {
    setLinhas((prev) => prev.map((l) => l.papel === papel ? { ...l, [campo]: valor } : l));
  };
  const salvar = async () => {
    setSalvando(true);
    setErro("");
    for (const l of linhas) {
      const { error } = await supabase.from("matriz_cargos").upsert({
        papel: l.papel,
        diaria_base: parseFloat(l.diaria_base) || 0,
        valor_hora: parseFloat(l.valor_hora) || 0,
      }, { onConflict: "papel" });
      if (error) { setErro(error.message); setSalvando(false); return; }
    }
    setSalvando(false);
    setMensagem("Matriz salva.");
  };
  return (
    <div>
      <div style={{ fontSize: 12, color: "#8A8778", marginBottom: 14 }}>
        Único lugar de editar esses dois valores por cargo. Diária base é somada à taxa de serviço rateada (método "por taxa de serviço" do diarista); valor da hora é usado no método "por hora". A Escala do dia só mostra esses valores, não edita mais aqui.
      </div>
      {mensagem && <div style={{ ...avisoStyle, background: "#EAF3DE", borderColor: "#97C459", color: "#27500A" }}>{mensagem}</div>}
      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}
      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", marginBottom: 16, background: "#FFFFFF" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 6, padding: "8px 10px", background: "#F6F1E7", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#8A8778" }}>
            <span>Cargo</span><span style={{ textAlign: "right" }}>Diária base</span><span style={{ textAlign: "right" }}>Valor hora</span>
          </div>
          {linhas.map((l, idx) => (
            <div key={l.papel} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 6, padding: "9px 10px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "#22231F" }}>{PAPEL_LABEL[l.papel]}</span>
              <input type="number" step="0.01" value={l.diaria_base} onChange={(e) => alterar(l.papel, "diaria_base", e.target.value)}
                style={{ padding: "5px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, textAlign: "right" }} />
              <input type="number" step="0.01" value={l.valor_hora} onChange={(e) => alterar(l.papel, "valor_hora", e.target.value)}
                style={{ padding: "5px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, textAlign: "right" }} />
            </div>
          ))}
        </div>
      )}
      <button onClick={salvar} disabled={salvando} style={{ ...btnPrimary, width: "100%" }}>
        {salvando ? <Loader2 size={16} /> : <Check size={16} />} Salvar matriz
      </button>
    </div>
  );
}
// ---------------------------------------------------------------------------
// Pessoas
// ---------------------------------------------------------------------------
function Pessoas({ isAdmin }) {
  const [pessoas, setPessoas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [editandoId, setEditandoId] = useState(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [expandidoId, setExpandidoId] = useState(null);
  const [fiadoId, setFiadoId] = useState(null);
  const [busca, setBusca] = useState("");
  const [form, setForm] = useState({ nome: "", papel: "garcom", tipo_contrato: "registrado", salario_base: "", pix: "", nome_fiado: "", cpf: "", telefone: "", email: "", data_nascimento: "", documento_path: null, arquivoDocumento: null });
  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.from("pessoas").select("*").order("nome");
    if (error) setErro(error.message);
    setPessoas([...(data || [])].sort(porNome));
    setCarregando(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const abrirNovo = () => { setForm({ nome: "", papel: "garcom", tipo_contrato: "registrado", salario_base: "", pix: "", nome_fiado: "", cpf: "", telefone: "", email: "", data_nascimento: "", documento_path: null, arquivoDocumento: null }); setNovoAberto(true); setEditandoId(null); };
  const abrirEdicao = (p) => {
    setForm({
      nome: p.nome, papel: p.papel, tipo_contrato: p.tipo_contrato, salario_base: p.salario_base ?? "",
      pix: p.pix ?? "", nome_fiado: p.nome_fiado ?? "",
      cpf: p.cpf ?? "", telefone: p.telefone ?? "", email: p.email ?? "", data_nascimento: p.data_nascimento ?? "",
      documento_path: p.documento_path ?? null, arquivoDocumento: null,
    });
    setEditandoId(p.id); setNovoAberto(false);
  };
  const salvar = async () => {
    if (!form.nome.trim()) return;
    setErro("");
    let documentoPath = form.documento_path;
    if (form.arquivoDocumento) {
      const caminho = `${form.nome.trim().replace(/[^a-zA-Z0-9]/g, "_")}-${Date.now()}-${form.arquivoDocumento.name.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`;
      const { error: erroUpload } = await supabase.storage.from("documentos-pessoas").upload(caminho, form.arquivoDocumento);
      if (erroUpload) { setErro(erroUpload.message); return; }
      documentoPath = caminho;
    }
    // Cargo e tipo de contrato são coisas distintas — inclusive gerente
    // pode ser registrado ou diarista, não força mais um valor.
    // Diarista: base e valor/hora vêm da Matriz de cargos, não se digita
    // aqui. Registrado e Gerente: salário individual, cada um o seu.
    const payload = {
      nome: form.nome.trim(),
      papel: form.papel,
      tipo_contrato: form.tipo_contrato,
      pix: form.pix?.trim() || null,
      nome_fiado: form.nome_fiado?.trim() || null,
      salario_base: form.tipo_contrato === "diarista" ? null : (parseFloat(form.salario_base) || 0),
      cpf: form.cpf.trim() || null,
      telefone: form.telefone.trim() || null,
      email: form.email.trim() || null,
      data_nascimento: form.data_nascimento || null,
      documento_path: documentoPath,
    };
    const { error } = editandoId
      ? await supabase.from("pessoas").update(payload).eq("id", editandoId)
      : await supabase.from("pessoas").insert(payload);
    if (error) { setErro(error.message); return; }
    setNovoAberto(false); setEditandoId(null);
    carregar();
  };
  const alternarAtivo = async (p) => {
    await supabase.from("pessoas").update({ ativo: !p.ativo }).eq("id", p.id);
    carregar();
  };
  const CAMPO_FALTANDO = { color: "#C4432B", fontStyle: "italic" };
  const pessoasFiltradas = pessoas.filter((p) => p.nome.toLowerCase().includes(busca.toLowerCase()));
  return (
    <div>
      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}
      {pessoas.length > 0 && (
        <div style={{ position: "relative", marginBottom: 14 }}>
          <Search size={15} color="#8A8778" style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa…"
            style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px 9px 34px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF" }} />
        </div>
      )}
      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
          {pessoasFiltradas.map((p) => (
            <div key={p.id} style={{ ...cardStyle, opacity: p.ativo ? 1 : 0.5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#22231F", display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{p.nome}</span>
                    {p.documento_path && (
                      <button onClick={() => abrirDocumento(p.documento_path)} style={{ ...ghostIconBtn, flexShrink: 0 }} aria-label="Baixar documento anexado">
                        <Paperclip size={14} />
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "#8A8778" }}>
                    {PAPEL_LABEL[p.papel]}
                    {p.tipo_contrato === "diarista" && " · base/hora pela Matriz de cargos"}
                    {isAdmin && (p.tipo_contrato === "registrado" || p.papel === "gerente") && p.salario_base ? ` · salário ${brl(p.salario_base)}` : ""}
                  </div>
                </div>
                <span style={{ ...pill, background: p.tipo_contrato === "registrado" ? "#37A0E522" : "#FAC77555", color: p.tipo_contrato === "registrado" ? "#185FA5" : "#854F0B" }}>
                  {p.papel === "gerente" ? "Gerente" : p.tipo_contrato === "registrado" ? "Registrado" : "Diarista"}
                </span>
                <button onClick={() => setExpandidoId(expandidoId === p.id ? null : p.id)} style={ghostIconBtn} aria-label="Ver todos os dados">
                  {expandidoId === p.id ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
                {isAdmin && (
                  <button onClick={() => setFiadoId(fiadoId === p.id ? null : p.id)} style={ghostIconBtn} aria-label="Ver fiado desta pessoa" title="Fiado">
                    <Receipt size={15} />
                  </button>
                )}
                <button onClick={() => abrirEdicao(p)} style={ghostIconBtn} aria-label="Editar pessoa"><Pencil size={15} /></button>
                <button onClick={() => alternarAtivo(p)} style={{ ...linkBtn, fontSize: 11 }}>{p.ativo ? "Desativar" : "Ativar"}</button>
              </div>
              {expandidoId === p.id && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #E8E2D2", display: "grid", gap: 5, fontSize: 12 }}>
                  <div><span style={{ color: "#8A8778" }}>CPF: </span><span style={p.cpf ? { color: "#22231F" } : CAMPO_FALTANDO}>{p.cpf || "não preenchido"}</span></div>
                  <div><span style={{ color: "#8A8778" }}>Telefone: </span><span style={p.telefone ? { color: "#22231F" } : CAMPO_FALTANDO}>{p.telefone || "não preenchido"}</span></div>
                  <div><span style={{ color: "#8A8778" }}>E-mail: </span><span style={p.email ? { color: "#22231F" } : CAMPO_FALTANDO}>{p.email || "não preenchido"}</span></div>
                  <div><span style={{ color: "#8A8778" }}>PIX: </span><span style={p.pix ? { color: "#22231F" } : CAMPO_FALTANDO}>{p.pix || "não preenchido"}</span></div>
                  <div><span style={{ color: "#8A8778" }}>Nome no fiado: </span><span style={p.nome_fiado ? { color: "#22231F" } : { color: "#8A8778" }}>{p.nome_fiado || "mesmo do cadastro"}</span></div>
                  <div><span style={{ color: "#8A8778" }}>Aniversário: </span><span style={p.data_nascimento ? { color: "#22231F" } : CAMPO_FALTANDO}>{p.data_nascimento ? new Date(p.data_nascimento + "T12:00:00").toLocaleDateString("pt-BR") : "não preenchido"}</span></div>
                  <div><span style={{ color: "#8A8778" }}>Documento anexado: </span><span style={p.documento_path ? { color: "#22231F" } : CAMPO_FALTANDO}>{p.documento_path ? "sim" : "nenhum"}</span></div>
                </div>
              )}
              {isAdmin && fiadoId === p.id && <FiadoDaPessoa pessoa={p} />}
              {editandoId === p.id && (
                <FormPessoa form={form} setForm={setForm} onSalvar={salvar} onCancelar={() => setEditandoId(null)} isAdmin={isAdmin} />
              )}
            </div>
          ))}
          {pessoasFiltradas.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>{busca ? "Nenhuma pessoa encontrada." : "Nenhuma pessoa cadastrada ainda."}</div>}
        </div>
      )}
      {!novoAberto ? (
        <button onClick={abrirNovo} style={{ ...btnSecondary, width: "100%", display: "flex", justifyContent: "center", gap: 6 }}>
          <Plus size={15} /> Nova pessoa
        </button>
      ) : (
        <div style={cardStyle}>
          <FormPessoa form={form} setForm={setForm} onSalvar={salvar} onCancelar={() => setNovoAberto(false)} isAdmin={isAdmin} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fiado da equipe
//
// O consumo vem do CardapioWeb: pedido fechado pago como "fiado". O que
// liga o pedido a pessoa e o nome do cliente digitado no caixa — por isso
// existe o campo "Nome no fiado" no cadastro, pra quando o caixa escreve
// apelido.
//
// Um pedido so pode ser descontado UMA vez: quem garante e a tabela
// fiado_baixas, com o id do pedido como chave. E o que permite varrer 60
// dias todo dia sem medo de abater o mesmo consumo de novo.
// ---------------------------------------------------------------------------
// A chave PIX aparece onde o acerto acontece — é ali que ela é usada.
// O botão copia pro clipboard pra não ter erro de digitação numa chave
// aleatória de 32 caracteres.
function LinhaPix({ pessoa }) {
  const [copiado, setCopiado] = useState(false);
  if (!pessoa?.pix) {
    return (
      <div style={{ fontSize: 11, color: "#B4AF9E", marginTop: 2 }}>
        PIX não cadastrado
      </div>
    );
  }
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(pessoa.pix);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 1800);
    } catch {
      // Safari em contexto não seguro bloqueia o clipboard — nesse caso a
      // chave continua visível na tela pra copiar na mão.
      setCopiado(false);
    }
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, flexWrap: "wrap" }}>
      <span style={{ fontSize: 11, color: "#8A8778" }}>PIX</span>
      <span style={{ fontSize: 11, color: "#22231F", fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>
        {pessoa.pix}
      </span>
      <button onClick={copiar} style={{ ...linkBtn, fontSize: 10.5, padding: "2px 4px", color: copiado ? "#0F6E56" : "#8A8778" }}>
        {copiado ? "copiado" : "copiar"}
      </button>
    </div>
  );
}

function useFiadoEquipe(pessoas) {
  const [inicio, setInicio] = useState(() => diasAtrasISO(60));
  const [fim, setFim] = useState(() => hoje());
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState("");
  const [porPessoa, setPorPessoa] = useState(null); // null = ainda nao buscou
  const [semDono, setSemDono] = useState([]);
  const [baixados, setBaixados] = useState(() => new Map());
  const [naoAbater, setNaoAbater] = useState(() => new Set());

  const buscar = async () => {
    setBuscando(true);
    setErro("");
    const { lancamentos, erro: e } = await buscarFiadoNoPeriodo(inicio, fim);
    if (e) { setErro(e); setBuscando(false); return; }
    const { porPessoa: mapa, semDono: sobra } = agruparPorPessoa(lancamentos, pessoas);
    const baixas = await carregarBaixas(lancamentos.map((l) => l.pedidoId));
    setPorPessoa(mapa);
    setSemDono(sobra);
    setBaixados(baixas);
    setBuscando(false);
  };

  const emAbertoDe = (pessoaId) =>
    (porPessoa?.[pessoaId] || []).filter((l) => !baixados.has(l.pedidoId));
  const saldoDe = (pessoaId) => somar(emAbertoDe(pessoaId));
  const vaiAbater = (pessoaId) => !naoAbater.has(pessoaId);
  const alternarAbater = (pessoaId) => {
    setNaoAbater((prev) => {
      const novo = new Set(prev);
      if (novo.has(pessoaId)) novo.delete(pessoaId); else novo.add(pessoaId);
      return novo;
    });
  };
  const descontoDe = (pessoaId) => (vaiAbater(pessoaId) ? saldoDe(pessoaId) : 0);

  // Grava as baixas de todo mundo que esta marcado pra abater.
  const baixarTodos = async (origem, referencia) => {
    if (!porPessoa) return { error: null };
    for (const pessoaId of Object.keys(porPessoa)) {
      if (!vaiAbater(pessoaId)) continue;
      const abertos = emAbertoDe(pessoaId);
      if (abertos.length === 0) continue;
      const { error } = await darBaixa(pessoaId, abertos, origem, referencia);
      if (error) return { error };
      setBaixados((prev) => {
        const novo = new Map(prev);
        abertos.forEach((l) => novo.set(l.pedidoId, { pedido_id: l.pedidoId, pessoa_id: pessoaId, valor: l.valor }));
        return novo;
      });
    }
    return { error: null };
  };

  return {
    inicio, setInicio, fim, setFim, buscando, erro, buscar,
    buscou: porPessoa !== null, porPessoa, semDono, baixados,
    emAbertoDe, saldoDe, vaiAbater, alternarAbater, descontoDe, baixarTodos,
  };
}

// Barra de busca do fiado, usada na Escala do dia e no Fechamento mensal.
function BarraFiado({ fiado, aviso }) {
  return (
    <div style={{ ...cardStyle, padding: "10px 12px", marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Receipt size={15} color="#8A8778" />
        <span style={{ fontSize: 13, fontWeight: 700, color: "#22231F", flex: 1, minWidth: 90 }}>Fiado da equipe</span>
        <input type="date" value={fiado.inicio} onChange={(e) => fiado.setInicio(e.target.value)} style={{ ...inputStyle, padding: "6px 8px", fontSize: 12 }} />
        <input type="date" value={fiado.fim} onChange={(e) => fiado.setFim(e.target.value)} style={{ ...inputStyle, padding: "6px 8px", fontSize: 12 }} />
        <button onClick={fiado.buscar} disabled={fiado.buscando} style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", fontSize: 12 }}>
          {fiado.buscando ? <Loader2 size={13} /> : <RefreshCw size={13} />} Buscar
        </button>
      </div>
      {fiado.erro && <div style={{ fontSize: 12, color: "#A32D2D", marginTop: 8 }}>{fiado.erro}</div>}
      {!fiado.buscou && !fiado.erro && (
        <div style={{ fontSize: 11, color: "#8A8778", marginTop: 8, lineHeight: 1.6 }}>
          {aviso} A busca vai no CardapioWeb, que aceita 5 consultas por
          minuto — por isso ela so acontece quando voce clica.
        </div>
      )}
      {fiado.buscou && fiado.semDono.length > 0 && (
        <div style={{ fontSize: 11, color: "#8A8778", marginTop: 8 }}>
          {fiado.semDono.length} lancamento(s) de fiado no periodo nao bateram com
          ninguem da equipe — devem ser cliente mesmo. Se for alguem da casa,
          preencha o "Nome no fiado" no cadastro dela.
        </div>
      )}
    </div>
  );
}

// O controle de abater / nao abater de uma pessoa.
function ChipFiado({ fiado, pessoaId }) {
  const saldo = fiado.saldoDe(pessoaId);
  if (!fiado.buscou || saldo <= 0) return null;
  const abate = fiado.vaiAbater(pessoaId);
  return (
    <button
      onClick={() => fiado.alternarAbater(pessoaId)}
      title={abate ? "Descontando do acerto — clique para nao descontar" : "Nao esta descontando — clique para descontar"}
      style={{
        display: "flex", alignItems: "center", gap: 5, cursor: "pointer",
        border: `1px solid ${abate ? "#F0999540" : "#E8E2D2"}`,
        background: abate ? "#F0999522" : "#FFFFFF",
        color: abate ? "#A32D2D" : "#8A8778",
        borderRadius: 999, padding: "4px 10px", fontSize: 11.5, fontWeight: 700,
        textDecoration: abate ? "none" : "line-through",
      }}
    >
      {abate ? <Check size={12} /> : <X size={12} />}
      fiado {brl(saldo)}
    </button>
  );
}

// Extrato de uma pessoa so, aberto pelo icone no cartao dela.
function FiadoDaPessoa({ pessoa }) {
  const fiado = useFiadoEquipe([pessoa]);
  const [estornando, setEstornando] = useState(null);
  const abertos = fiado.emAbertoDe(pessoa.id);
  const todos = fiado.porPessoa?.[pessoa.id] || [];

  const estornar = async (l) => {
    setEstornando(l.pedidoId);
    await estornarBaixa([l.pedidoId]);
    setEstornando(null);
    fiado.buscar();
  };

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #E8E2D2" }}>
      <BarraFiado fiado={fiado} aviso={`Procura o que ${pessoa.nome.split(" ")[0]} consumiu como fiado no periodo.`} />
      {fiado.buscou && (
        todos.length === 0 ? (
          <div style={{ fontSize: 12, color: "#8A8778" }}>
            Nenhum fiado no periodo em nome de {pessoa.nome}
            {pessoa.nome_fiado ? ` (nem de "${pessoa.nome_fiado}")` : ""}.
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}>
              <span style={{ color: "#8A8778" }}>Em aberto</span>
              <strong style={{ color: abertos.length ? "#A32D2D" : "#0F6E56" }}>{brl(somar(abertos))}</strong>
            </div>
            <div style={{ border: "1px solid #E8E2D2", borderRadius: 10, overflow: "hidden", background: "#FFFFFF" }}>
              {todos.map((l, idx) => {
                const baixado = fiado.baixados.has(l.pedidoId);
                return (
                  <div key={l.pedidoId} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", fontSize: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: "#22231F" }}>Pedido #{l.displayId}</div>
                      <div style={{ fontSize: 10.5, color: "#8A8778" }}>
                        {new Date(l.data).toLocaleDateString("pt-BR")}
                        {l.nomeCliente ? ` · ${l.nomeCliente}` : ""}
                      </div>
                    </div>
                    <span style={{ fontWeight: 700, color: baixado ? "#8A8778" : "#22231F", textDecoration: baixado ? "line-through" : "none" }}>
                      {brl(l.valor)}
                    </span>
                    {baixado ? (
                      <button onClick={() => estornar(l)} disabled={estornando === l.pedidoId} style={{ ...linkBtn, fontSize: 10.5 }}>
                        {estornando === l.pedidoId ? "..." : "estornar"}
                      </button>
                    ) : (
                      <span style={{ ...pill, background: "#F0999522", color: "#A32D2D" }}>em aberto</span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )
      )}
    </div>
  );
}

function FormPessoa({ form, setForm, onSalvar, onCancelar, isAdmin }) {
  const fileRef = useRef(null);
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #E8E2D2", display: "grid", gap: 8 }}>
      <input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
        placeholder="Nome" style={inputStyle} />
      <div style={{ display: "flex", gap: 8 }}>
        <select value={form.papel} onChange={(e) => setForm((f) => ({ ...f, papel: e.target.value }))} style={{ ...inputStyle, flex: 1 }}>
          {PAPEIS_COM_GERENTE.map((p) => <option key={p} value={p}>{PAPEL_LABEL[p]}</option>)}
        </select>
        <select value={form.tipo_contrato} onChange={(e) => setForm((f) => ({ ...f, tipo_contrato: e.target.value }))} style={{ ...inputStyle, flex: 1 }}>
          <option value="registrado">Registrado</option>
          <option value="diarista">Diarista</option>
        </select>
      </div>
      {isAdmin && form.papel === "gerente" && (
        <>
          <input type="number" step="0.01" value={form.salario_base} onChange={(e) => setForm((f) => ({ ...f, salario_base: e.target.value }))}
            placeholder="Salário base (R$)" style={inputStyle} />
          <div style={{ fontSize: 11, color: "#8A8778" }}>Gerente não entra na divisão diária de comissão — ganha esse salário + 2% do faturamento bruto do mês, calculado no Fechamento mensal (vale independente de ser registrada ou diarista).</div>
        </>
      )}
      {form.papel !== "gerente" && form.tipo_contrato === "diarista" && (
        <div style={{ fontSize: 11, color: "#8A8778" }}>Base diária e valor da hora vêm da Matriz de cargos — não se digita aqui.</div>
      )}
      {isAdmin && form.papel !== "gerente" && form.tipo_contrato === "registrado" && (
        <input type="number" step="0.01" value={form.salario_base} onChange={(e) => setForm((f) => ({ ...f, salario_base: e.target.value }))}
          placeholder="Salário base individual (R$)" style={inputStyle} />
      )}
      {!isAdmin && (form.papel === "gerente" || form.tipo_contrato === "registrado") && (
        <div style={{ fontSize: 11, color: "#8A8778" }}>Só administradores veem e editam o salário.</div>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <input value={form.cpf} onChange={(e) => setForm((f) => ({ ...f, cpf: e.target.value }))}
          placeholder="CPF" style={{ ...inputStyle, flex: 1 }} />
        <input value={form.telefone} onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))}
          placeholder="Telefone" style={{ ...inputStyle, flex: 1 }} />
      </div>
      <input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        placeholder="E-mail" style={inputStyle} />
      <div>
        <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 4 }}>Chave PIX</label>
        <input value={form.pix} onChange={(e) => setForm((f) => ({ ...f, pix: e.target.value }))}
          placeholder="CPF, telefone, e-mail ou chave aleatória" style={inputStyle} />
      </div>
      <div>
        <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 4 }}>Nome no fiado do caixa</label>
        <input value={form.nome_fiado} onChange={(e) => setForm((f) => ({ ...f, nome_fiado: e.target.value }))}
          placeholder="Só se for diferente do nome acima" style={inputStyle} />
        <div style={{ fontSize: 11, color: "#8A8778", marginTop: 4 }}>
          É por aqui que o painel liga o consumo fiado a esta pessoa. Preencha
          quando o caixa digita apelido ou nome curto — "Zeca" no lugar de
          "José Carlos", por exemplo.
        </div>
      </div>
      <div>
        <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 4 }}>Data de aniversário</label>
        <input type="date" value={form.data_nascimento} onChange={(e) => setForm((f) => ({ ...f, data_nascimento: e.target.value }))}
          style={inputStyle} />
      </div>
      <div>
        <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 4 }}>Documento (RG, contrato…)</label>
        <input ref={fileRef} type="file" style={{ display: "none" }}
          onChange={(e) => setForm((f) => ({ ...f, arquivoDocumento: e.target.files?.[0] || null }))} />
        <button onClick={() => fileRef.current?.click()} style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6, width: "100%", justifyContent: "center" }}>
          <Upload size={14} />
          {form.arquivoDocumento ? form.arquivoDocumento.name : form.documento_path ? "Trocar documento anexado" : "Anexar documento"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onSalvar} style={{ ...btnSecondary, flex: 1 }}>Salvar</button>
        <button onClick={onCancelar} style={linkBtn}>Cancelar</button>
      </div>
    </div>
  );
}
// ---------------------------------------------------------------------------
// Premiação do dia (Escala do dia)
// ---------------------------------------------------------------------------
function PremiacaoDoDia({ isAdmin }) {
  const [dia, setDia] = useState(hoje());
  const [pessoas, setPessoas] = useState([]);
  const [participacao, setParticipacao] = useState({}); // pessoa_id -> { incluido, horas, entrada, saida, intervalo }
  const [baseCategoria, setBaseCategoria] = useState({}); // papel -> valor (vem da Matriz de cargos, só leitura aqui)
  const [valorHora, setValorHora] = useState({}); // papel -> valor (vem da Matriz de cargos, só leitura aqui)
  const [taxaServico, setTaxaServico] = useState("");
  const [buscandoTaxa, setBuscandoTaxa] = useState(false);
  const [taxaAutomatica, setTaxaAutomatica] = useState(null); // null | true | false
  const [faturamentoBrutoDia, setFaturamentoBrutoDia] = useState(0); // pra prévia do 2% da gerente
  const [matriz, setMatriz] = useState({}); // papel -> { valor_hora }
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [modoLeitura, setModoLeitura] = useState(false);
  const [premiacoesSalvas, setPremiacoesSalvas] = useState([]);
  // Quem tem alteração ainda não gravada. Sem isso a pessoa digita o
  // horário, rola a tela, e não tem como saber se aquilo foi salvo — a
  // queixa que originou o ícone por linha e a barra do rodapé.
  const [sujos, setSujos] = useState(() => new Set());
  const [salvandoPessoa, setSalvandoPessoa] = useState(null);
  const [jaTemPresenca, setJaTemPresenca] = useState(false);
  const fiado = useFiadoEquipe(pessoas);
  const carregar = useCallback(async () => {
    setCarregando(true);
    setMensagem("");
    try {
      const [{ data: pessoasData }, { data: presencasData }, { data: premiacoesData }, { data: matrizData }, { data: cacheTaxa }, { data: previsoesData }] = await Promise.all([
        supabase.from("pessoas").select("*").eq("ativo", true).order("nome"),
        supabase.from("presencas_diarias").select("*").eq("dia", dia),
        supabase.from("premiacoes_diarias").select("*").eq("dia", dia),
        supabase.from("matriz_cargos").select("*"),
        supabase.from("taxas_do_dia").select("*").eq("dia", dia).maybeSingle(),
        supabase.from("previsoes_escala").select("pessoa_id").eq("dia", dia),
      ]);
      setPessoas([...(pessoasData || [])].sort(porNome));
      setPremiacoesSalvas(premiacoesData || []);
      // Trava só quando a premiação já foi calculada — aí sim o dia está
      // fechado e mexer sem querer estraga valor pago. Antes isso travava
      // com qualquer presença gravada, o que passou a atrapalhar depois
      // que dá pra salvar o ponto de uma pessoa por vez: salvava um e o
      // dia inteiro fechava, obrigando um administrador a reabrir pra
      // continuar preenchendo os outros.
      setModoLeitura((premiacoesData || []).length > 0);
      setJaTemPresenca((presencasData || []).length > 0);
      setMatriz(Object.fromEntries((matrizData || []).map((m) => [m.papel, m])));
      const mapaPart = {};
      const idsPrevistos = new Set((previsoesData || []).map((p) => p.pessoa_id));
      (pessoasData || []).forEach((p) => {
        const registrado = p.tipo_contrato === "registrado";
        const entrada = registrado ? TURNO_REGISTRADO.entrada : "";
        const saida = registrado ? TURNO_REGISTRADO.saida : "";
        const horas = horasDoPonto(entrada, saida, INTERVALO_PADRAO_MIN);
        mapaPart[p.id] = {
          incluido: idsPrevistos.has(p.id),
          horas: horas === null ? 0 : horas,
          entrada,
          saida,
          intervalo: INTERVALO_PADRAO_MIN,
        };
      });
      (presencasData || []).forEach((pr) => {
        mapaPart[pr.pessoa_id] = {
          incluido: true,
          horas: pr.horas_trabalhadas || 0,
          // O banco devolve "HH:MM:SS"; o input type=time quer "HH:MM".
          entrada: pr.hora_entrada ? String(pr.hora_entrada).slice(0, 5) : "",
          saida: pr.hora_saida ? String(pr.hora_saida).slice(0, 5) : "",
          // Aqui o `?? ` importa: intervalo 0 gravado de propósito não
          // pode virar 60 por causa do padrão.
          intervalo: pr.intervalo_minutos ?? INTERVALO_PADRAO_MIN,
        };
      });
      setParticipacao(mapaPart);
      setSujos(new Set());
      // A diária base por cargo é persistente (vem da Matriz, coluna
      // diaria_base) — não se retype todo dia, só edita via lápis quando
      // precisar mudar (e aí passa a valer pros próximos dias também).
      const mapaBase = {};
      (matrizData || []).forEach((m) => { mapaBase[m.papel] = String(m.diaria_base ?? 0); });
      setBaseCategoria(mapaBase);
      const mapaHora = {};
      (matrizData || []).forEach((m) => { mapaHora[m.papel] = String(m.valor_hora ?? 0); });
      setValorHora(mapaHora);
      setFaturamentoBrutoDia(cacheTaxa?.faturamento_bruto || 0);
      if (premiacoesData && premiacoesData.length > 0) {
        setTaxaServico(String(premiacoesData[0].taxa_servico_dia));
        setMensagem("Esse dia já tem premiação calculada e salva — recalcular vai substituir os valores.");
      } else if (cacheTaxa) {
        // Já foi buscada antes (por essa tela ou pela Conferência de Caixa)
        // — reaproveita em vez de consultar o CardápioWeb de novo.
        setTaxaServico(String(cacheTaxa.taxa_servico));
        setTaxaAutomatica(true);
        setMensagem("Taxa de serviço reaproveitada da última busca (Escala do dia ou Conferência de Caixa) — clique em Buscar se quiser atualizar.");
      } else {
        setTaxaServico("");
      }
    } catch (e) {
      // Nunca deixa a tela travada em "Carregando…" silenciosamente —
      // mostra o erro de verdade, mesmo que seja algo inesperado.
      setErro(`Erro ao carregar a Escala do dia: ${e.message || e}`);
    }
    setCarregando(false);
  }, [dia]);
  useEffect(() => { carregar(); }, [carregar]);
  const buscarTaxaAutomatica = async () => {
    setBuscandoTaxa(true);
    setErro("");
    const temGerente = pessoas.some((p) => p.papel === "gerente" && participacao[p.id]?.incluido);
    const { data: cacheTaxa } = await supabase.from("taxas_do_dia").select("*").eq("dia", dia).maybeSingle();
    if (cacheTaxa && (!temGerente || cacheTaxa.faturamento_bruto > 0)) {
      setBuscandoTaxa(false);
      setTaxaServico(String(cacheTaxa.taxa_servico));
      setFaturamentoBrutoDia(cacheTaxa.faturamento_bruto || 0);
      setTaxaAutomatica(true);
      setMensagem("Taxa de serviço reaproveitada do cache — não precisou consultar o CardápioWeb de novo.");
      return;
    }
    const { data, error } = await supabase.functions.invoke("cardapioweb-proxy", { body: { acao: "taxa_servico_dia", dia } });
    if (error) { setBuscandoTaxa(false); setErro(await extrairErroFuncao(error)); return; }
    if (data?.error) { setBuscandoTaxa(false); setErro(data.error); return; }
    setTaxaServico(String(data.taxa_servico));
    setTaxaAutomatica(data.encontrado_automaticamente);
    // Só busca o faturamento bruto (pra prévia da gerente) se ela estiver
    // marcada como presente hoje — evita gastar consulta à toa.
    let faturamentoBruto = cacheTaxa?.faturamento_bruto || 0;
    if (temGerente) {
      const diaSeguinte = new Date(`${dia}T12:00:00-03:00`);
      diaSeguinte.setDate(diaSeguinte.getDate() + 1);
      const { data: fatData, error: fatErr } = await supabase.functions.invoke("cardapioweb-proxy", {
        body: {
          acao: "faturamento_periodo",
          data_inicio: `${dia}T17:00:00-03:00`,
          data_fim: `${diaSeguinte.toISOString().slice(0, 10)}T03:00:00-03:00`,
        },
      });
      if (!fatErr && !fatData?.error) faturamentoBruto = fatData.faturamento_bruto;
    }
    setFaturamentoBrutoDia(faturamentoBruto);
    setBuscandoTaxa(false);
    if (data.encontrado_automaticamente) {
      await supabase.from("taxas_do_dia").upsert({
        dia, taxa_servico: data.taxa_servico, faturamento_bruto: faturamentoBruto, atualizado_em: new Date().toISOString(),
      }, { onConflict: "dia" });
    } else {
      setErro("Não tem pedido fechado nesse dia (17h–03h) — confira a data ou digite o valor manualmente.");
    }
  };
  const marcarSujo = (pessoaId) => {
    setSujos((prev) => {
      const novo = new Set(prev);
      novo.add(pessoaId);
      return novo;
    });
    setMensagem("");
  };
  const alternarIncluido = (pessoaId) => {
    marcarSujo(pessoaId);
    setParticipacao((prev) => {
      const atual = prev[pessoaId] || {};
      const incluidoNovo = !atual.incluido;
      // Ao marcar como trabalhou, já sugere um turno padrão de horas —
      // evita começar em 0 e a pessoa esquecer de preencher. Se depois
      // ela informar entrada e saída, esse número é substituído pelo
      // cálculo.
      // Se já tem entrada e saída (caso do registrado, que abre
      // preenchido), a hora vem do cálculo — não do chute de 8h.
      const calculado = horasDoPonto(atual.entrada, atual.saida, atual.intervalo);
      const horas = calculado !== null
        ? calculado
        : (incluidoNovo && !atual.horas ? HORAS_PADRAO_TURNO : (atual.horas || 0));
      return { ...prev, [pessoaId]: { ...atual, incluido: incluidoNovo, horas } };
    });
  };
  // Entrada, saída ou intervalo mudou: recalcula as horas na hora. Só
  // sobrescreve o campo de horas quando entrada E saída existem — sem os
  // dois não dá pra calcular nada, e o valor digitado à mão continua
  // valendo.
  const alterarPonto = (pessoaId, campo, valor) => {
    marcarSujo(pessoaId);
    setParticipacao((prev) => {
      const atual = prev[pessoaId] || {};
      const novo = { ...atual, [campo]: valor };
      const calculado = horasDoPonto(novo.entrada, novo.saida, novo.intervalo);
      if (calculado !== null) novo.horas = calculado;
      return { ...prev, [pessoaId]: novo };
    });
  };
  const alterarHoras = (pessoaId, horas) => {
    marcarSujo(pessoaId);
    setParticipacao((prev) => ({ ...prev, [pessoaId]: { ...prev[pessoaId], horas: parseFloat(horas) || 0 } }));
  };
  const pesoDe = (pessoaId) => (participacao[pessoaId]?.horas || 0) / HORAS_PADRAO_TURNO;
  const selecionados = pessoas.filter((p) => participacao[p.id]?.incluido);
  const garcons = selecionados.filter((p) => categoriaComissao(p.papel) === "garcom");
  const internos = selecionados.filter((p) => categoriaComissao(p.papel) === "interno");
  const pesoGarcons = garcons.reduce((s, p) => s + pesoDe(p.id), 0);
  const pesoInternos = internos.reduce((s, p) => s + pesoDe(p.id), 0);
  const taxaNum = parseFloat(taxaServico) || 0;
  const poolGarcons = taxaNum * 0.5;
  const poolInternos = taxaNum * 0.5;
  const valorPorPesoGarcom = pesoGarcons > 0 ? poolGarcons / pesoGarcons : 0;
  const valorPorPesoInterno = pesoInternos > 0 ? poolInternos / pesoInternos : 0;
  // Diarista: dois métodos, vale o maior. Método comissão = rateio da
  // taxa (pelo peso, calculado a partir das horas ÷ 8) + diária base do
  // cargo (pela matriz). Método hora = horas trabalhadas × valor/hora do
  // cargo (pela matriz). Registrado não entra nessa comparação — só
  // recebe a comissão do dia (o salário dele é mensal, somado no
  // Fechamento mensal). Gerente não entra na divisão da taxa de serviço
  // de jeito nenhum — só mostra uma PRÉVIA do 2% do faturamento bruto do
  // dia (o valor oficial dela é fechado por mês, no Fechamento mensal).
  const linhas = selecionados.map((p) => {
    const horas = participacao[p.id]?.horas || 0;
    if (p.papel === "gerente") {
      const total = round2(faturamentoBrutoDia * 0.02);
      return { pessoa: p, peso: 0, horas, comissao: 0, baseCategoriaValor: 0, metodoUsado: "gerente_previa", valorMetodoComissao: total, valorMetodoHora: null, total };
    }
    const peso = pesoDe(p.id);
    const valorPorPeso = categoriaComissao(p.papel) === "garcom" ? valorPorPesoGarcom : valorPorPesoInterno;
    const comissao = peso * valorPorPeso;
    const baseCategoriaValor = peso * (parseFloat(baseCategoria[p.papel]) || 0);
    const m = matriz[p.papel] || { valor_hora: 0 };
    if (p.tipo_contrato === "diarista") {
      const valorMetodoComissao = comissao + baseCategoriaValor;
      const valorMetodoHora = horas * (m.valor_hora || 0);
      const metodoUsado = valorMetodoHora > valorMetodoComissao ? "hora" : "comissao";
      const total = Math.max(valorMetodoComissao, valorMetodoHora);
      return { pessoa: p, peso, horas, comissao, baseCategoriaValor, metodoUsado, valorMetodoComissao, valorMetodoHora, total };
    }
    // registrado: só a taxa de serviço proporcional do dia — sem diária
    // base (isso é só pra diarista, já que registrado recebe salário fixo
    // acumulado no mês seguinte, no Fechamento mensal).
    const total = comissao;
    return { pessoa: p, peso, horas, comissao, baseCategoriaValor: 0, metodoUsado: null, valorMetodoComissao: comissao, valorMetodoHora: null, total };
  });
  // Grava o ponto de UMA pessoa, na hora. Salva só a presença — os
  // valores (comissão, diária) continuam saindo no "Calcular e salvar",
  // porque o rateio da taxa de serviço depende de quem mais trabalhou no
  // dia: não dá pra fechar o dinheiro de uma pessoa isolada.
  const salvarPonto = async (pessoa) => {
    setSalvandoPessoa(pessoa.id);
    setErro("");
    const part = participacao[pessoa.id] || {};
    let error = null;
    if (part.incluido) {
      ({ error } = await supabase.from("presencas_diarias").upsert({
        pessoa_id: pessoa.id, dia, peso: pesoDe(pessoa.id), horas_trabalhadas: part.horas || 0,
        hora_entrada: part.entrada || null,
        hora_saida: part.saida || null,
        intervalo_minutos: parseInt(part.intervalo) || 0,
      }, { onConflict: "pessoa_id,dia" }));
    } else {
      // Desmarcou: tira do dia, senão a presença antiga fica para trás.
      ({ error } = await supabase.from("presencas_diarias").delete()
        .eq("pessoa_id", pessoa.id).eq("dia", dia));
    }
    setSalvandoPessoa(null);
    if (error) { setErro(error.message); return; }
    setSujos((prev) => {
      const novo = new Set(prev);
      novo.delete(pessoa.id);
      return novo;
    });
  };
  const salvarPremiacao = async () => {
    if (selecionados.length === 0) { setErro("Marque quem trabalhou hoje."); return; }
    if (isAdmin && taxaNum <= 0) { setErro("Informe a taxa de serviço do dia."); return; }
    setSalvando(true);
    setErro("");
    // A presença (quem trabalhou + horário + horas) sempre salva, mesmo
    // sem admin — é isso que qualquer pessoa aprovada pode registrar. Os
    // valores calculados (comissão etc.) só entram quando tem taxa de
    // serviço definida, o que só admin faz.
    for (const p of selecionados) {
      const part = participacao[p.id] || {};
      await supabase.from("presencas_diarias").upsert({
        pessoa_id: p.id, dia, peso: pesoDe(p.id), horas_trabalhadas: part.horas || 0,
        hora_entrada: part.entrada || null,
        hora_saida: part.saida || null,
        intervalo_minutos: parseInt(part.intervalo) || 0,
      }, { onConflict: "pessoa_id,dia" });
    }
    if (taxaNum > 0) {
      for (const l of linhas) {
        const { error } = await supabase.from("premiacoes_diarias").upsert({
          pessoa_id: l.pessoa.id,
          dia,
          taxa_servico_dia: taxaNum,
          comissao: round2(l.comissao),
          valor_diaria: 0, // mantido só por compatibilidade com dias já salvos antes da matriz existir
          base_categoria: round2(l.baseCategoriaValor),
          total_dia: round2(l.total),
          metodo_usado: l.metodoUsado,
          valor_metodo_comissao: l.metodoUsado ? round2(l.valorMetodoComissao) : null,
          valor_metodo_hora: l.metodoUsado ? round2(l.valorMetodoHora) : null,
        }, { onConflict: "pessoa_id,dia" });
        if (error) { setErro(error.message); setSalvando(false); return; }
      }
    }
    // Fiado: so agora, depois que os valores do dia fecharam. Cada
    // pedido descontado vira uma linha em fiado_baixas e nao aparece mais
    // como em aberto na proxima busca.
    if (fiado.buscou) {
      const { error: errFiado } = await fiado.baixarTodos("escala", dia);
      if (errFiado) { setErro("Valores salvos, mas o fiado nao foi baixado: " + errFiado.message); }
    }
    setSalvando(false);
    setSujos(new Set());
    setMensagem(taxaNum > 0 ? "Escala e valores do dia salvos." : "Escala do dia salva — falta um administrador definir a taxa de serviço pra calcular os valores.");
    await carregar(); // recarrega já travado em modo leitura
  };
  // Dia já preenchido: mostra um resumo travado (não a tela de marcação),
  // com os valores calculados de verdade que foram salvos (não recalcula
  // com a matriz atual, que pode ter mudado desde então). Só admin vê o
  // botão de reabrir pra editar.
  if (modoLeitura && !carregando) {
    const linhasSalvas = premiacoesSalvas
      .map((pr) => ({ ...pr, pessoa: pessoas.find((p) => p.id === pr.pessoa_id) }))
      .filter((l) => l.pessoa);
    const idsComPremiacao = new Set(premiacoesSalvas.map((pr) => pr.pessoa_id));
    const pessoasSemPremiacao = pessoas.filter((p) => participacao[p.id]?.incluido && !idsComPremiacao.has(p.id));
    const taxaNumSalva = parseFloat(taxaServico) || 0;
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 14, display: "flex", alignItems: "center", gap: 4 }}>
          <Lock size={13} /> Já preenchida — modo leitura{!isAdmin ? " (só administradores editam)" : ""}
        </div>
        {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}
        <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", marginBottom: 16, background: "#FFFFFF" }}>
          {linhasSalvas.map((l, idx) => (
            <div key={l.pessoa_id} style={{ padding: "10px 14px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, color: "#22231F" }}>{l.pessoa.nome}</div>
                  <div style={{ fontSize: 11, color: "#8A8778" }}>{PAPEL_LABEL[l.pessoa.papel]}{l.pessoa.tipo_contrato === "diarista" ? " · diarista" : ""} · {textoPonto(participacao[l.pessoa_id])}</div>
                  {isAdmin && <LinhaPix pessoa={l.pessoa} />}
                </div>
                {isAdmin && <div style={{ fontSize: 14, fontWeight: 700, color: "#22231F" }}>{brl(l.total_dia)}</div>}
              </div>
              {isAdmin && l.metodo_usado && (
                <div style={{ fontSize: 10, color: "#0F6E56", marginTop: 4 }}>
                  ✓ Taxa de serviço + diária base: {brl(l.valor_metodo_comissao)} · Hora: {brl(l.valor_metodo_hora)}
                </div>
              )}
            </div>
          ))}
          {pessoasSemPremiacao.map((p, idx) => (
            <div key={p.id} style={{ padding: "10px 14px", borderTop: (linhasSalvas.length + idx) > 0 ? "1px solid #F0EBDD" : "none" }}>
              <div style={{ fontSize: 13, color: "#22231F" }}>{p.nome}</div>
              <div style={{ fontSize: 11, color: "#8A8778" }}>{PAPEL_LABEL[p.papel]}{p.tipo_contrato === "diarista" ? " · diarista" : ""} · {textoPonto(participacao[p.id])}</div>
              {isAdmin && <LinhaPix pessoa={p} />}
            </div>
          ))}
          {linhasSalvas.length === 0 && pessoasSemPremiacao.length === 0 && (
            <div style={{ padding: 14, fontSize: 13, color: "#8A8778" }}>Ninguém marcado nesse dia.</div>
          )}
        </div>
        {isAdmin && taxaNumSalva > 0 && (
          <div style={{ background: "#F6F1E7", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#8A8778", marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
            <span>Taxa de serviço do dia</span><span style={{ color: "#22231F", fontWeight: 700 }}>{brl(taxaNumSalva)}</span>
          </div>
        )}
        {isAdmin && (
          <button onClick={() => setModoLeitura(false)} style={{ ...btnSecondary, width: "100%", display: "flex", justifyContent: "center", gap: 6 }}>
            <Pencil size={15} /> Editar
          </button>
        )}
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} style={inputStyle} />
      </div>
      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <>
          {mensagem && <div style={{ ...avisoStyle, background: "#EAF3DE", borderColor: "#97C459", color: "#27500A" }}>{mensagem}</div>}
          {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}
          {isAdmin ? (
            <div style={{ ...cardStyle, marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: "#8A8778", marginBottom: 6 }}>Taxa de serviço do dia (janela 17h–03h)</div>
              <div style={{ display: "flex", gap: 8 }}>
                <input type="number" step="0.01" value={taxaServico} onChange={(e) => { setTaxaServico(e.target.value); setTaxaAutomatica(null); }}
                  placeholder="R$ 0,00" style={{ ...inputStyle, flex: 1 }} />
                <button onClick={buscarTaxaAutomatica} disabled={buscandoTaxa} style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6 }}>
                  {buscandoTaxa ? <Loader2 size={14} /> : <RefreshCw size={14} />} Buscar
                </button>
              </div>
              {taxaAutomatica === true && <div style={{ fontSize: 11, color: "#0F6E56", marginTop: 6 }}>Encontrado automaticamente no CardápioWeb.</div>}
            </div>
          ) : (
            <div style={{ ...avisoStyle }}>Só administradores veem e definem a taxa de serviço e os valores calculados. Marque abaixo quem trabalhou e o horário — um administrador completa o resto.</div>
          )}
          <div style={sectionLabel}>Quem trabalhou hoje</div>
          {jaTemPresenca && sujos.size === 0 && (
            <div style={{ fontSize: 11, color: "#0F6E56", marginBottom: 8, display: "flex", alignItems: "center", gap: 5 }}>
              <Check size={13} /> Ponto deste dia já gravado — pode continuar editando; só fecha de vez no "Calcular e salvar".
            </div>
          )}
          <div style={{ display: "grid", gap: 6, marginBottom: 16 }}>
            {pessoas.map((p) => {
              const part = participacao[p.id] || { incluido: false, horas: 0, entrada: "", saida: "", intervalo: 0 };
              const sujo = sujos.has(p.id);
              const horasCalculadas = horasDoPonto(part.entrada, part.saida, part.intervalo);
              const viraODia = part.entrada && part.saida && minutosDoHorario(part.saida) <= minutosDoHorario(part.entrada);
              return (
                <div key={p.id} style={{
                  ...cardStyle, padding: "10px 12px",
                  borderColor: sujo ? "#E8A33D" : "#E8E2D2",
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <input type="checkbox" checked={part.incluido} onChange={() => alternarIncluido(p.id)} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "#22231F", display: "flex", alignItems: "center", gap: 6 }}>
                        {p.nome}
                        {sujo && <span title="Alteração ainda não salva" style={pontoSujo} />}
                      </div>
                      <div style={{ fontSize: 11, color: "#8A8778" }}>{PAPEL_LABEL[p.papel]}{p.tipo_contrato === "diarista" ? " · diarista" : ""}</div>
                    </div>
                    {sujo && (
                      <button onClick={() => salvarPonto(p)} disabled={salvandoPessoa === p.id}
                        title="Salvar o ponto desta pessoa agora"
                        style={btnSalvarLinha}>
                        {salvandoPessoa === p.id ? <Loader2 size={13} /> : <Check size={13} />} Salvar
                      </button>
                    )}
                    {part.incluido && (
                      horasCalculadas !== null ? (
                        // Horário preenchido: as horas viram resultado, não campo.
                        <div style={{ background: "#F6F1E7", border: "1px solid #E8E2D2", borderRadius: 6, padding: "5px 9px", fontSize: 12, whiteSpace: "nowrap", flexShrink: 0 }}>
                          = <strong style={{ color: "#0F6E56" }}>{horasCalculadas.toLocaleString("pt-BR")} h</strong>
                        </div>
                      ) : (
                        // Sem entrada e saída, continua digitado à mão — é
                        // assim que os dias antigos e os casos fora do
                        // padrão seguem funcionando.
                        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                          <span style={{ fontSize: 11, color: "#8A8778" }}>horas</span>
                          <input type="number" step="0.5" min="0" value={part.horas} onChange={(e) => alterarHoras(p.id, e.target.value)}
                            style={{ width: 50, padding: "4px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                        </div>
                      )
                    )}
                  </div>
                  {part.incluido && (
                    <>
                      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 10, paddingTop: 10, borderTop: "1px dashed #E8E2D2", flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: 74 }}>
                          <label style={{ fontSize: 10, color: "#8A8778", display: "block", marginBottom: 3 }}>Entrada</label>
                          <input type="time" value={part.entrada || ""} onChange={(e) => alterarPonto(p.id, "entrada", e.target.value)}
                            style={{ width: "100%", boxSizing: "border-box", padding: "5px 7px", borderRadius: 6, border: `1px solid ${part.entrada ? "#37A0E5" : "#E8E2D2"}`, fontSize: 12, background: "#FFFFFF" }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 74 }}>
                          <label style={{ fontSize: 10, color: "#8A8778", display: "block", marginBottom: 3 }}>Saída</label>
                          <input type="time" value={part.saida || ""} onChange={(e) => alterarPonto(p.id, "saida", e.target.value)}
                            style={{ width: "100%", boxSizing: "border-box", padding: "5px 7px", borderRadius: 6, border: `1px solid ${part.saida ? "#37A0E5" : "#E8E2D2"}`, fontSize: 12, background: "#FFFFFF" }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 74 }}>
                          <label style={{ fontSize: 10, color: "#8A8778", display: "block", marginBottom: 3 }}>Intervalo (min)</label>
                          <input type="number" min="0" step="5" value={part.intervalo || 0} onChange={(e) => alterarPonto(p.id, "intervalo", e.target.value)}
                            style={{ width: "100%", boxSizing: "border-box", padding: "5px 7px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                        </div>
                      </div>
                      {viraODia && (
                        <div style={{ fontSize: 11, color: "#185FA5", marginTop: 6 }}>
                          Saiu depois da meia-noite — contando como madrugada do dia seguinte.
                        </div>
                      )}
                      {horasCalculadas === null && (part.entrada || part.saida) && (
                        <div style={{ fontSize: 11, color: "#8A6A0F", marginTop: 6 }}>
                          Falta {part.entrada ? "a saída" : "a entrada"} pra calcular — enquanto isso vale a hora digitada.
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {pessoas.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Cadastre pessoas na aba "Pessoas" primeiro.</div>}
          </div>
          <div style={{ fontSize: 11, color: "#8A8778", marginTop: -10, marginBottom: 16 }}>
            A divisão da comissão usa as horas como peso (turno padrão de {HORAS_PADRAO_TURNO}h = peso 1). Preenchendo entrada e saída, as horas saem da conta sozinhas.
          </div>
          {isAdmin && selecionados.length > 0 && (
            <>
              <div style={sectionLabel}>Valores por cargo</div>
              <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 8 }}>
                Diária base e valor da hora — só leitura aqui. Pra mudar, vai em Gente e Gestão &gt; Matriz de cargos.
              </div>
              <div style={{ display: "grid", gap: 6, marginBottom: 16 }}>
                {[...new Set(selecionados.map((p) => p.papel))].map((papel) => (
                  <div key={papel} style={{ ...cardStyle, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ flex: 1, fontSize: 13, color: "#22231F" }}>{PAPEL_LABEL[papel]}</span>
                    <span style={{ fontSize: 11, color: "#8A8778" }}>Diária base <strong style={{ color: "#22231F" }}>{brl(parseFloat(baseCategoria[papel]) || 0)}</strong></span>
                    <span style={{ fontSize: 11, color: "#8A8778" }}>Hora <strong style={{ color: "#22231F" }}>{brl(parseFloat(valorHora[papel]) || 0)}</strong></span>
                  </div>
                ))}
              </div>
            </>
          )}
          {isAdmin && selecionados.length > 0 && taxaNum > 0 && (
            <>
              <div style={sectionLabel}>Resultado</div>
              <BarraFiado fiado={fiado} aviso="Traz o que a equipe consumiu como fiado e ainda nao foi descontado, pra abater no acerto de hoje." />
              <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", marginBottom: 16, background: "#FFFFFF" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr", gap: 6, padding: "8px 10px", background: "#F6F1E7", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#8A8778" }}>
                  <span>Pessoa</span><span style={{ textAlign: "right" }}>Método</span><span style={{ textAlign: "right" }}>Total do dia</span>
                </div>
                {linhas.map((l, idx) => (
                  <div key={l.pessoa.id} style={{ padding: "9px 10px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr", gap: 6, fontSize: 12 }}>
                      <span>
                        {l.pessoa.nome}
                        {l.baseCategoriaValor > 0 && <span style={{ fontSize: 10, color: "#185FA5" }}> + diária base</span>}
                      </span>
                      <span style={{ textAlign: "right", color: "#8A8778", fontSize: 11 }}>
                        {l.metodoUsado === "hora" ? "por hora" : l.metodoUsado === "comissao" ? "taxa de serviço" : l.metodoUsado === "gerente_previa" ? "prévia 2%" : "—"}
                      </span>
                      <span style={{ textAlign: "right", fontWeight: 700 }}>{brl(l.total)}</span>
                    </div>
                    {fiado.buscou && fiado.saldoDe(l.pessoa.id) > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                        <ChipFiado fiado={fiado} pessoaId={l.pessoa.id} />
                        <span style={{ fontSize: 11, color: "#8A8778" }}>
                          a pagar{" "}
                          <strong style={{ color: "#22231F" }}>
                            {brl(l.total - fiado.descontoDe(l.pessoa.id))}
                          </strong>
                        </span>
                      </div>
                    )}
                    {l.metodoUsado === "gerente_previa" && (
                      <div style={{ fontSize: 10, color: "#8A8778", marginTop: 4 }}>
                        2% de {brl(faturamentoBrutoDia)} (faturamento bruto do dia) — prévia informativa, o valor oficial fecha por mês
                      </div>
                    )}
                    {(l.metodoUsado === "hora" || l.metodoUsado === "comissao") && (
                      <div style={{ display: "flex", gap: 10, marginTop: 4, fontSize: 10, color: "#8A8778" }}>
                        <span style={{ fontWeight: l.metodoUsado === "comissao" ? 700 : 400, color: l.metodoUsado === "comissao" ? "#0F6E56" : "#8A8778" }}>
                          Taxa de serviço + diária base: {brl(l.valorMetodoComissao)}
                        </span>
                        <span style={{ fontWeight: l.metodoUsado === "hora" ? 700 : 400, color: l.metodoUsado === "hora" ? "#0F6E56" : "#8A8778" }}>
                          Hora ({l.horas}h): {brl(l.valorMetodoHora)}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          <button onClick={salvarPremiacao} disabled={salvando} style={{ ...btnPrimary, width: "100%" }}>
            {salvando ? <Loader2 size={16} /> : <Check size={16} />} Calcular e salvar
          </button>
          {/* Espaço para a barra fixa não cobrir o botão acima. */}
          {sujos.size > 0 && <div style={{ height: 78 }} />}
          {sujos.size > 0 && (
            <div style={barraFixa}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, maxWidth: 760, margin: "0 auto", flexWrap: "wrap" }}>
                <span style={pontoSujo} />
                <div style={{ flex: 1, minWidth: 130, fontSize: 12.5, color: "#22231F" }}>
                  <strong>{sujos.size}</strong> {sujos.size === 1 ? "pessoa" : "pessoas"} com alteração não salva
                </div>
                <button onClick={salvarPremiacao} disabled={salvando}
                  style={{ ...btnPrimary, padding: "10px 16px", fontSize: 13, borderRadius: 8 }}>
                  {salvando ? <Loader2 size={15} /> : <Check size={15} />} Salvar escala
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
// ---------------------------------------------------------------------------
// Fechamento mensal
// ---------------------------------------------------------------------------
function FechamentoMensal() {
  const [mesRef, setMesRef] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; });
  const [linhas, setLinhas] = useState([]);
  const [gerentes, setGerentes] = useState([]);
  const [faturamentoMes, setFaturamentoMes] = useState(null); // { faturamento_bruto, atualizado_em } | null
  const [buscandoFaturamento, setBuscandoFaturamento] = useState(false);
  const [erro, setErro] = useState("");
  const [pessoaAberta, setPessoaAberta] = useState(null);
  const [extrato, setExtrato] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [pessoas, setPessoas] = useState([]);
  const fiado = useFiadoEquipe(pessoas);
  const [lancados, setLancados] = useState(new Set()); // descrições já lançadas no Plano de Contas
  const [lancando, setLancando] = useState(null); // nome sendo lançado agora
  const limitesDoMes = useCallback(() => {
    const [ano, mes] = mesRef.split("-").map(Number);
    const inicio = `${mesRef}-01`;
    const fim = new Date(ano, mes, 0).toISOString().slice(0, 10);
    return { inicio, fim };
  }, [mesRef]);
  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    const { inicio, fim } = limitesDoMes();
    const [{ data: premiacoes }, { data: pessoasData }, { data: faturamentoData }] = await Promise.all([
      supabase.from("premiacoes_diarias").select("pessoa_id, dia, total_dia, pessoa:pessoas(nome, papel, tipo_contrato)").gte("dia", inicio).lte("dia", fim),
      supabase.from("pessoas").select("*").eq("ativo", true),
      supabase.from("faturamento_mensal").select("*").eq("mes_referencia", mesRef).maybeSingle(),
    ]);
    setFaturamentoMes(faturamentoData || null);
    const mapaSalario = Object.fromEntries((pessoasData || []).map((p) => [p.id, p]));
    const porPessoa = {};
    (premiacoes || []).forEach((pr) => {
      if (pr.pessoa?.tipo_contrato !== "registrado" || pr.pessoa?.papel === "gerente") return; // diarista já recebeu por dia; gerente é calculada à parte
      if (!porPessoa[pr.pessoa_id]) porPessoa[pr.pessoa_id] = { nome: pr.pessoa.nome, papel: pr.pessoa.papel, dias: 0, comissao: 0 };
      porPessoa[pr.pessoa_id].dias += 1;
      porPessoa[pr.pessoa_id].comissao += pr.total_dia;
    });
    setPessoas([...(pessoasData || [])].sort(porNome));
    const listaRegistrados = Object.entries(porPessoa).map(([pessoaId, v]) => {
      const salarioBase = mapaSalario[pessoaId]?.salario_base || 0;
      return { ...v, pessoaId, salarioBase, total: v.comissao + salarioBase };
    });
    setLinhas(listaRegistrados.sort((a, b) => a.nome.localeCompare(b.nome)));
    const listaGerentes = (pessoasData || []).filter((p) => p.papel === "gerente").map((p) => {
      const faturamentoBruto = faturamentoData?.faturamento_bruto || 0;
      const doisPorcento = faturamentoBruto * 0.02;
      const salarioBase = p.salario_base || 0;
      return { pessoaId: p.id, nome: p.nome, salarioBase, faturamentoBruto, doisPorcento, total: salarioBase + doisPorcento };
    });
    setGerentes(listaGerentes);
    const { data: contasPessoas } = await supabase.from("contas_pagar").select("descricao").eq("centro_custo", "pessoas");
    setLancados(new Set((contasPessoas || []).map((c) => c.descricao)));
    setCarregando(false);
  }, [mesRef, limitesDoMes]);
  useEffect(() => { carregar(); }, [carregar]);
  // O valor que vira conta a pagar é o LÍQUIDO: o acumulado do mês menos
  // o fiado que a pessoa consumiu, quando marcado pra abater. O bruto
  // continua guardado nas premiações diárias — o desconto é só no que sai
  // do caixa.
  const lancarPessoa = async (nome, valor, pessoaId) => {
    setLancando(nome);
    setErro("");
    const desconto = pessoaId && fiado.buscou ? fiado.descontoDe(pessoaId) : 0;
    const liquido = round2(valor - desconto);
    const { data: userData } = await supabase.auth.getUser();
    const [ano, mes] = mesRef.split("-").map(Number);
    const fimMes = new Date(ano, mes, 0).toISOString().slice(0, 10);
    const descricao = `${nome} — Fechamento ${mesRef}`;
    const { error } = await supabase.from("contas_pagar").insert({
      descricao: desconto > 0 ? `${descricao} (fiado ${brl(desconto)} descontado)` : descricao,
      valor_total: liquido, categoria: "pessoas", centro_custo: "pessoas",
      status: "pendente", data_vencimento: fimMes, criado_por: userData?.user?.id,
    });
    if (error) { setLancando(null); setErro(error.message); return; }
    if (desconto > 0) {
      const { error: errFiado } = await darBaixa(pessoaId, fiado.emAbertoDe(pessoaId), "fechamento", mesRef);
      if (errFiado) { setLancando(null); setErro("Conta lançada, mas o fiado não foi baixado: " + errFiado.message); return; }
      fiado.buscar();
    }
    setLancando(null);
    setLancados((prev) => new Set(prev).add(descricao));
  };
  const buscarFaturamento = async () => {
    setBuscandoFaturamento(true);
    setErro("");
    const { inicio, fim } = limitesDoMes();
    const { data, error } = await supabase.functions.invoke("cardapioweb-proxy", {
      body: { acao: "faturamento_periodo", data_inicio: `${inicio}T00:00:00-03:00`, data_fim: `${fim}T23:59:59-03:00` },
    });
    setBuscandoFaturamento(false);
    if (error) { setErro(await extrairErroFuncao(error)); return; }
    if (data?.error) { setErro(data.error); return; }
    const { error: errSalvar } = await supabase.from("faturamento_mensal").upsert({
      mes_referencia: mesRef,
      faturamento_bruto: data.faturamento_bruto,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "mes_referencia" });
    if (errSalvar) { setErro(errSalvar.message); return; }
    carregar();
  };
  const abrirExtrato = async (nome) => {
    const { inicio, fim } = limitesDoMes();
    const { data } = await supabase
      .from("premiacoes_diarias")
      .select("dia, comissao, base_categoria, taxa_servico_dia, metodo_usado, valor_metodo_comissao, valor_metodo_hora, total_dia, pessoa:pessoas!inner(nome)")
      .eq("pessoa.nome", nome)
      .gte("dia", inicio).lte("dia", fim)
      .order("dia");
    setExtrato(data || []);
    setPessoaAberta(nome);
  };
  const mudarMes = (delta) => {
    const [ano, mes] = mesRef.split("-").map(Number);
    const d = new Date(ano, mes - 1 + delta, 1);
    setMesRef(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const nomeMes = new Date(`${mesRef}-01T12:00:00`).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  const total = linhas.reduce((s, l) => s + l.total, 0) + gerentes.reduce((s, g) => s + g.total, 0);
  if (pessoaAberta) {
    return (
      <div>
        <button onClick={() => setPessoaAberta(null)} style={{ ...linkBtn, display: "flex", alignItems: "center", gap: 4, marginBottom: 14 }}>
          <ChevronLeft size={14} /> Voltar
        </button>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#22231F", marginBottom: 12 }}>{pessoaAberta} — {nomeMes}</div>
        <div style={{ display: "grid", gap: 6 }}>
          {extrato.map((e, idx) => (
            <div key={idx} style={{ ...cardStyle, padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "#22231F" }}>{new Date(e.dia + "T12:00:00").toLocaleDateString("pt-BR")}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#22231F" }}>{brl(e.total_dia)}</span>
              </div>
              <div style={{ fontSize: 10, color: "#8A8778", marginTop: 3 }}>
                {e.metodo_usado ? (
                  <>
                    <span style={{ fontWeight: e.metodo_usado === "comissao" ? 700 : 400, color: e.metodo_usado === "comissao" ? "#0F6E56" : "#8A8778" }}>
                      Taxa de serviço + diária base: {brl(e.valor_metodo_comissao)}
                    </span>
                    {" · "}
                    <span style={{ fontWeight: e.metodo_usado === "hora" ? 700 : 400, color: e.metodo_usado === "hora" ? "#0F6E56" : "#8A8778" }}>
                      Hora: {brl(e.valor_metodo_hora)}
                    </span>
                  </>
                ) : (
                  <>
                    Taxa de serviço (sua parte): {brl(e.comissao)}
                    {e.base_categoria > 0 && ` · diária base: ${brl(e.base_categoria)}`}
                    {` · taxa de serviço do dia (total): ${brl(e.taxa_servico_dia)}`}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <button onClick={() => mudarMes(-1)} style={ghostIconBtn}><ChevronLeft size={18} /></button>
        <input type="month" value={mesRef} onChange={(e) => setMesRef(e.target.value)}
          style={{ ...inputStyle, flex: 1, textAlign: "center", textTransform: "capitalize" }} />
        <button onClick={() => mudarMes(1)} style={ghostIconBtn}><ChevronRight size={18} /></button>
      </div>
      <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 10 }}>Só pessoas registradas — diaristas já recebem por dia.</div>
      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}
      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <>
          <BarraFiado fiado={fiado} aviso="Traz o que a equipe consumiu como fiado e ainda nao foi descontado, pra abater no acerto do mes." />
          <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF", marginBottom: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.9fr 0.7fr 1fr", gap: 6, padding: "8px 10px", background: "#F6F1E7", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#8A8778" }}>
              <span>Pessoa</span><span>Papel</span><span style={{ textAlign: "right" }}>Dias</span><span style={{ textAlign: "right" }}>Acumulado</span>
            </div>
            {linhas.map((l, idx) => {
              const descricaoLancamento = `${l.nome} — Fechamento ${mesRef}`;
              const jaLancado = lancados.has(descricaoLancamento);
              return (
                <div key={l.nome} style={{ borderTop: idx > 0 ? "1px solid #F0EBDD" : "none" }}>
                  <button onClick={() => abrirExtrato(l.nome)}
                    style={{ display: "block", width: "100%", padding: "10px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.9fr 0.7fr 1fr", gap: 6, fontSize: 13 }}>
                      <span style={{ color: "#22231F" }}>{l.nome}</span>
                      <span style={{ color: "#8A8778", fontSize: 12 }}>{PAPEL_LABEL[l.papel]}</span>
                      <span style={{ textAlign: "right", color: "#8A8778" }}>{l.dias}</span>
                      <span style={{ textAlign: "right", fontWeight: 700, color: "#22231F" }}>{brl(l.total)}</span>
                    </div>
                    <LinhaPix pessoa={pessoas.find((x) => x.id === l.pessoaId)} />
                    {l.salarioBase > 0 && (
                      <div style={{ fontSize: 10, color: "#8A8778", marginTop: 2 }}>salário {brl(l.salarioBase)} + comissão {brl(l.comissao)}</div>
                    )}
                  </button>
                  {fiado.buscou && fiado.saldoDe(l.pessoaId) > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px 8px", flexWrap: "wrap" }}>
                      <ChipFiado fiado={fiado} pessoaId={l.pessoaId} />
                      <span style={{ fontSize: 11, color: "#8A8778" }}>
                        a pagar <strong style={{ color: "#22231F" }}>{brl(l.total - fiado.descontoDe(l.pessoaId))}</strong>
                      </span>
                    </div>
                  )}
                  <div style={{ padding: "0 10px 10px" }}>
                    {jaLancado ? (
                      <span style={{ fontSize: 11, color: "#2F8F5B" }}>✓ Já lançado no Plano de Contas</span>
                    ) : (
                      <button onClick={(e) => { e.stopPropagation(); lancarPessoa(l.nome, l.total, l.pessoaId); }} disabled={lancando === l.nome}
                        style={{ ...linkBtn, fontSize: 11 }}>
                        {lancando === l.nome ? "Lançando…" : "+ Lançar no Plano de Contas"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {linhas.length === 0 && <div style={{ padding: 14, fontSize: 13, color: "#8A8778" }}>Nenhuma premiação registrada nesse mês ainda.</div>}
          </div>
          <div style={sectionLabel}>Gerência</div>
          <div style={{ ...cardStyle, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 12, color: "#8A8778" }}>Faturamento bruto do mês</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#22231F" }}>{faturamentoMes ? brl(faturamentoMes.faturamento_bruto) : "—"}</div>
              </div>
              <button onClick={buscarFaturamento} disabled={buscandoFaturamento} style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6 }}>
                {buscandoFaturamento ? <Loader2 size={14} /> : <RefreshCw size={14} />} Buscar
              </button>
            </div>
          </div>
          {gerentes.length > 0 && (
            <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF", marginBottom: 16 }}>
              {gerentes.map((g, idx) => {
                const descricaoLancamento = `${g.nome} — Fechamento ${mesRef}`;
                const jaLancado = lancados.has(descricaoLancamento);
                return (
                  <div key={g.nome} style={{ padding: "12px 14px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#22231F" }}>{g.nome}</div>
                    <div style={{ marginBottom: 4 }}><LinhaPix pessoa={pessoas.find((x) => x.id === g.pessoaId)} /></div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#8A8778" }}>
                      <span>Salário base</span><span>{brl(g.salarioBase)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#8A8778" }}>
                      <span>2% de {brl(g.faturamentoBruto)} (faturamento bruto)</span><span>{brl(g.doisPorcento)}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, fontWeight: 700, color: "#22231F", marginTop: 4, paddingTop: 4, borderTop: "1px solid #F0EBDD" }}>
                      <span>Total do mês</span><span>{brl(g.total)}</span>
                    </div>
                    {fiado.buscou && fiado.saldoDe(g.pessoaId) > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                        <ChipFiado fiado={fiado} pessoaId={g.pessoaId} />
                        <span style={{ fontSize: 11, color: "#8A8778" }}>
                          a pagar <strong style={{ color: "#22231F" }}>{brl(g.total - fiado.descontoDe(g.pessoaId))}</strong>
                        </span>
                      </div>
                    )}
                    <div style={{ marginTop: 6 }}>
                      {jaLancado ? (
                        <span style={{ fontSize: 11, color: "#2F8F5B" }}>✓ Já lançado no Plano de Contas</span>
                      ) : (
                        <button onClick={() => lancarPessoa(g.nome, g.total, g.pessoaId)} disabled={lancando === g.nome} style={{ ...linkBtn, fontSize: 11 }}>
                          {lancando === g.nome ? "Lançando…" : "+ Lançar no Plano de Contas"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {(linhas.length > 0 || gerentes.length > 0) && (
            <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 4px", fontSize: 13, color: "#8A8778" }}>
              <span>Total geral do mês</span><span style={{ fontWeight: 700, color: "#22231F" }}>{brl(total)}</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
function round2(n) { return Math.round(n * 100) / 100; }
const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const pontoSujo = {
  width: 8, height: 8, borderRadius: "50%", background: "#E8A33D",
  display: "inline-block", flexShrink: 0,
};
const btnSalvarLinha = {
  display: "flex", alignItems: "center", gap: 5, flexShrink: 0,
  background: "#22231F", color: "#F3EFE3", border: "none", borderRadius: 8,
  padding: "6px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer",
};
const barraFixa = {
  position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 40,
  background: "#FBF3D9", borderTop: "1px solid #E8D48A",
  padding: "12px 16px", boxShadow: "0 -4px 16px rgba(34,35,31,.10)",
};
const inputStyle = { padding: "9px 10px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF", color: "#22231F" };
const ghostIconBtn = { border: "none", background: "none", color: "#8A8778", cursor: "pointer", padding: 2, display: "flex" };
const btnPrimary = { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#22231F", color: "#F3EFE3", border: "none", borderRadius: 10, padding: "12px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer" };
const btnSecondary = { background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const linkBtn = { background: "none", border: "none", color: "#8A6A0F", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 0, textAlign: "left" };
const sectionLabel = { fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778", marginBottom: 8 };
const pill = { fontSize: 11, fontWeight: 700, padding: "3px 9px", borderRadius: 999 };
const avisoStyle = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 14 };
const tabBtn = { padding: "8px 14px", borderRadius: 999, border: "1px solid #E8E2D2", background: "#FFFFFF", color: "#8A8778", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const tabBtnAtivo = { background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" };
