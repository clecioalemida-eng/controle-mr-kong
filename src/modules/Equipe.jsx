import React, { useState, useEffect, useCallback } from "react";
import { Loader2, Plus, Trash2, Pencil, Check, RefreshCw, AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "../lib/supabaseClient";

function brl(v) { return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function hoje() { return new Date().toISOString().slice(0, 10); }
const PAPEL_LABEL = { garcom: "Garçom", interno: "Equipe interna", caixa: "Caixa", bar: "Bar", chapa: "Chapa", cozinha: "Cozinha" };
const PAPEIS = ["garcom", "caixa", "bar", "chapa", "cozinha"];
// Regra de divisão da premiação: só garçom fica no bolo dos garçons — todo
// o resto (caixa, bar, chapa, cozinha, e o "interno" genérico antigo) cai
// junto no bolo da equipe interna.
function categoriaComissao(papel) { return papel === "garcom" ? "garcom" : "interno"; }

const SUBABAS = [
  { chave: "pessoas", label: "Pessoas" },
  { chave: "premiacao", label: "Premiação do dia" },
  { chave: "mensal", label: "Fechamento mensal" },
];

export default function Equipe() {
  const [subaba, setSubaba] = useState("pessoas");
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
        {SUBABAS.map((a) => (
          <button key={a.chave} onClick={() => setSubaba(a.chave)}
            style={{ ...tabBtn, ...(subaba === a.chave ? tabBtnAtivo : {}) }}>
            {a.label}
          </button>
        ))}
      </div>
      {subaba === "pessoas" && <Pessoas />}
      {subaba === "premiacao" && <PremiacaoDoDia />}
      {subaba === "mensal" && <FechamentoMensal />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pessoas
// ---------------------------------------------------------------------------
function Pessoas() {
  const [pessoas, setPessoas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [editandoId, setEditandoId] = useState(null);
  const [novoAberto, setNovoAberto] = useState(false);
  const [form, setForm] = useState({ nome: "", papel: "garcom", tipo_contrato: "registrado", valor_diaria: "" });

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.from("pessoas").select("*").order("nome");
    if (error) setErro(error.message);
    setPessoas(data || []);
    setCarregando(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const abrirNovo = () => { setForm({ nome: "", papel: "garcom", tipo_contrato: "registrado", valor_diaria: "" }); setNovoAberto(true); setEditandoId(null); };
  const abrirEdicao = (p) => { setForm({ nome: p.nome, papel: p.papel, tipo_contrato: p.tipo_contrato, valor_diaria: p.valor_diaria ?? "" }); setEditandoId(p.id); setNovoAberto(false); };

  const salvar = async () => {
    if (!form.nome.trim()) return;
    const payload = {
      nome: form.nome.trim(),
      papel: form.papel,
      tipo_contrato: form.tipo_contrato,
      valor_diaria: form.tipo_contrato === "diarista" ? (parseFloat(form.valor_diaria) || 0) : null,
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

  return (
    <div>
      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}

      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
          {pessoas.map((p) => (
            <div key={p.id} style={{ ...cardStyle, opacity: p.ativo ? 1 : 0.5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#22231F" }}>{p.nome}</div>
                  <div style={{ fontSize: 12, color: "#8A8778" }}>
                    {PAPEL_LABEL[p.papel]}
                    {p.tipo_contrato === "diarista" && ` · base diária ${brl(p.valor_diaria)}`}
                  </div>
                </div>
                <span style={{ ...pill, background: p.tipo_contrato === "registrado" ? "#37A0E522" : "#FAC77555", color: p.tipo_contrato === "registrado" ? "#185FA5" : "#854F0B" }}>
                  {p.tipo_contrato === "registrado" ? "Registrado" : "Diarista"}
                </span>
                <button onClick={() => abrirEdicao(p)} style={ghostIconBtn} aria-label="Editar pessoa"><Pencil size={15} /></button>
                <button onClick={() => alternarAtivo(p)} style={{ ...linkBtn, fontSize: 11 }}>{p.ativo ? "Desativar" : "Ativar"}</button>
              </div>

              {editandoId === p.id && (
                <FormPessoa form={form} setForm={setForm} onSalvar={salvar} onCancelar={() => setEditandoId(null)} />
              )}
            </div>
          ))}
          {pessoas.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Nenhuma pessoa cadastrada ainda.</div>}
        </div>
      )}

      {!novoAberto ? (
        <button onClick={abrirNovo} style={{ ...btnSecondary, width: "100%", display: "flex", justifyContent: "center", gap: 6 }}>
          <Plus size={15} /> Nova pessoa
        </button>
      ) : (
        <div style={cardStyle}>
          <FormPessoa form={form} setForm={setForm} onSalvar={salvar} onCancelar={() => setNovoAberto(false)} />
        </div>
      )}
    </div>
  );
}

function FormPessoa({ form, setForm, onSalvar, onCancelar }) {
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #E8E2D2", display: "grid", gap: 8 }}>
      <input value={form.nome} onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
        placeholder="Nome" style={inputStyle} />
      <div style={{ display: "flex", gap: 8 }}>
        <select value={form.papel} onChange={(e) => setForm((f) => ({ ...f, papel: e.target.value }))} style={{ ...inputStyle, flex: 1 }}>
          {PAPEIS.map((p) => <option key={p} value={p}>{PAPEL_LABEL[p]}</option>)}
        </select>
        <select value={form.tipo_contrato} onChange={(e) => setForm((f) => ({ ...f, tipo_contrato: e.target.value }))} style={{ ...inputStyle, flex: 1 }}>
          <option value="registrado">Registrado</option>
          <option value="diarista">Diarista</option>
        </select>
      </div>
      {form.tipo_contrato === "diarista" && (
        <input type="number" step="0.01" value={form.valor_diaria} onChange={(e) => setForm((f) => ({ ...f, valor_diaria: e.target.value }))}
          placeholder="Valor da base diária (R$)" style={inputStyle} />
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onSalvar} style={{ ...btnSecondary, flex: 1 }}>Salvar</button>
        <button onClick={onCancelar} style={linkBtn}>Cancelar</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Premiação do dia
// ---------------------------------------------------------------------------
function PremiacaoDoDia() {
  const [dia, setDia] = useState(hoje());
  const [pessoas, setPessoas] = useState([]);
  const [participacao, setParticipacao] = useState({}); // pessoa_id -> { incluido, peso }
  const [taxaServico, setTaxaServico] = useState("");
  const [buscandoTaxa, setBuscandoTaxa] = useState(false);
  const [taxaAutomatica, setTaxaAutomatica] = useState(null); // null | true | false
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setMensagem("");
    const [{ data: pessoasData }, { data: presencasData }, { data: premiacoesData }] = await Promise.all([
      supabase.from("pessoas").select("*").eq("ativo", true).order("nome"),
      supabase.from("presencas_diarias").select("*").eq("dia", dia),
      supabase.from("premiacoes_diarias").select("*").eq("dia", dia),
    ]);
    setPessoas(pessoasData || []);
    const mapaPart = {};
    (pessoasData || []).forEach((p) => { mapaPart[p.id] = { incluido: false, peso: 1 }; });
    (presencasData || []).forEach((pr) => { mapaPart[pr.pessoa_id] = { incluido: true, peso: pr.peso }; });
    setParticipacao(mapaPart);
    if (premiacoesData && premiacoesData.length > 0) {
      setTaxaServico(String(premiacoesData[0].taxa_servico_dia));
      setMensagem("Esse dia já tem premiação calculada e salva — recalcular vai substituir os valores.");
    } else {
      setTaxaServico("");
    }
    setCarregando(false);
  }, [dia]);
  useEffect(() => { carregar(); }, [carregar]);

  const buscarTaxaAutomatica = async () => {
    setBuscandoTaxa(true);
    setErro("");
    const { data, error } = await supabase.functions.invoke("cardapioweb-proxy", { body: { acao: "taxa_servico_dia", dia } });
    setBuscandoTaxa(false);
    if (error) { setErro(error.message); return; }
    if (data?.error) { setErro(data.error); return; }
    setTaxaServico(String(data.taxa_servico));
    setTaxaAutomatica(data.encontrado_automaticamente);
    if (!data.encontrado_automaticamente) {
      setErro("Não encontrei um campo de taxa de serviço nos pedidos desse dia — confira/digite o valor manualmente.");
    }
  };

  const alternarIncluido = (pessoaId) => {
    setParticipacao((prev) => ({ ...prev, [pessoaId]: { ...prev[pessoaId], incluido: !prev[pessoaId]?.incluido } }));
  };
  const alterarPeso = (pessoaId, peso) => {
    setParticipacao((prev) => ({ ...prev, [pessoaId]: { ...prev[pessoaId], peso: parseFloat(peso) || 0 } }));
  };

  const selecionados = pessoas.filter((p) => participacao[p.id]?.incluido);
  const garcons = selecionados.filter((p) => categoriaComissao(p.papel) === "garcom");
  const internos = selecionados.filter((p) => categoriaComissao(p.papel) === "interno");
  const pesoGarcons = garcons.reduce((s, p) => s + (participacao[p.id]?.peso || 0), 0);
  const pesoInternos = internos.reduce((s, p) => s + (participacao[p.id]?.peso || 0), 0);
  const taxaNum = parseFloat(taxaServico) || 0;
  const poolGarcons = taxaNum * 0.5;
  const poolInternos = taxaNum * 0.5;
  const valorPorPesoGarcom = pesoGarcons > 0 ? poolGarcons / pesoGarcons : 0;
  const valorPorPesoInterno = pesoInternos > 0 ? poolInternos / pesoInternos : 0;

  const linhas = selecionados.map((p) => {
    const peso = participacao[p.id]?.peso || 0;
    const valorPorPeso = categoriaComissao(p.papel) === "garcom" ? valorPorPesoGarcom : valorPorPesoInterno;
    const comissao = peso * valorPorPeso;
    const valorDiaria = p.tipo_contrato === "diarista" ? (p.valor_diaria || 0) : 0;
    return { pessoa: p, peso, comissao, valorDiaria, total: comissao + valorDiaria };
  });

  const salvarPremiacao = async () => {
    if (taxaNum <= 0) { setErro("Informe a taxa de serviço do dia."); return; }
    if (selecionados.length === 0) { setErro("Marque quem trabalhou hoje."); return; }
    setSalvando(true);
    setErro("");

    for (const p of selecionados) {
      const peso = participacao[p.id]?.peso || 0;
      await supabase.from("presencas_diarias").upsert({ pessoa_id: p.id, dia, peso }, { onConflict: "pessoa_id,dia" });
    }
    for (const l of linhas) {
      const { error } = await supabase.from("premiacoes_diarias").upsert({
        pessoa_id: l.pessoa.id,
        dia,
        taxa_servico_dia: taxaNum,
        comissao: round2(l.comissao),
        valor_diaria: l.valorDiaria,
        total_dia: round2(l.total),
      }, { onConflict: "pessoa_id,dia" });
      if (error) { setErro(error.message); setSalvando(false); return; }
    }
    setSalvando(false);
    setMensagem("Premiação do dia salva.");
  };

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

          <div style={sectionLabel}>Quem trabalhou hoje</div>
          <div style={{ display: "grid", gap: 6, marginBottom: 16 }}>
            {pessoas.map((p) => {
              const part = participacao[p.id] || { incluido: false, peso: 1 };
              return (
                <div key={p.id} style={{ ...cardStyle, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                  <input type="checkbox" checked={part.incluido} onChange={() => alternarIncluido(p.id)} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "#22231F" }}>{p.nome}</div>
                    <div style={{ fontSize: 11, color: "#8A8778" }}>{PAPEL_LABEL[p.papel]}{p.tipo_contrato === "diarista" ? " · diarista" : ""}</div>
                  </div>
                  {part.incluido && (
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 11, color: "#8A8778" }}>peso</span>
                      <input type="number" step="0.5" min="0" max="1" value={part.peso} onChange={(e) => alterarPeso(p.id, e.target.value)}
                        style={{ width: 50, padding: "4px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                    </div>
                  )}
                </div>
              );
            })}
            {pessoas.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Cadastre pessoas na aba "Pessoas" primeiro.</div>}
          </div>

          {selecionados.length > 0 && taxaNum > 0 && (
            <>
              <div style={sectionLabel}>Resultado</div>
              <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", marginBottom: 16, background: "#FFFFFF" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr", gap: 6, padding: "8px 10px", background: "#F6F1E7", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#8A8778" }}>
                  <span>Pessoa</span><span style={{ textAlign: "right" }}>Comissão</span><span style={{ textAlign: "right" }}>Total do dia</span>
                </div>
                {linhas.map((l, idx) => (
                  <div key={l.pessoa.id} style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1fr", gap: 6, padding: "9px 10px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", fontSize: 12 }}>
                    <span>{l.pessoa.nome}{l.valorDiaria > 0 && <span style={{ fontSize: 10, color: "#854F0B" }}> + diária</span>}</span>
                    <span style={{ textAlign: "right" }}>{brl(l.comissao)}</span>
                    <span style={{ textAlign: "right", fontWeight: 700 }}>{brl(l.total)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <button onClick={salvarPremiacao} disabled={salvando} style={{ ...btnPrimary, width: "100%" }}>
            {salvando ? <Loader2 size={16} /> : <Check size={16} />} Calcular e salvar
          </button>
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
  const [pessoaAberta, setPessoaAberta] = useState(null);
  const [extrato, setExtrato] = useState([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [ano, mes] = mesRef.split("-").map(Number);
    const inicio = `${mesRef}-01`;
    const fimDate = new Date(ano, mes, 0); // último dia do mês
    const fim = fimDate.toISOString().slice(0, 10);

    const { data: premiacoes } = await supabase
      .from("premiacoes_diarias")
      .select("pessoa_id, dia, total_dia, pessoa:pessoas(nome, papel, tipo_contrato)")
      .gte("dia", inicio).lte("dia", fim);

    const porPessoa = {};
    (premiacoes || []).forEach((pr) => {
      if (pr.pessoa?.tipo_contrato !== "registrado") return; // diarista já recebeu por dia
      if (!porPessoa[pr.pessoa_id]) porPessoa[pr.pessoa_id] = { nome: pr.pessoa.nome, papel: pr.pessoa.papel, dias: 0, total: 0 };
      porPessoa[pr.pessoa_id].dias += 1;
      porPessoa[pr.pessoa_id].total += pr.total_dia;
    });
    setLinhas(Object.values(porPessoa).sort((a, b) => a.nome.localeCompare(b.nome)));
    setCarregando(false);
  }, [mesRef]);
  useEffect(() => { carregar(); }, [carregar]);

  const abrirExtrato = async (nome) => {
    const [ano, mes] = mesRef.split("-").map(Number);
    const inicio = `${mesRef}-01`;
    const fim = new Date(ano, mes, 0).toISOString().slice(0, 10);
    const { data } = await supabase
      .from("premiacoes_diarias")
      .select("dia, comissao, total_dia, pessoa:pessoas!inner(nome)")
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
  const total = linhas.reduce((s, l) => s + l.total, 0);

  if (pessoaAberta) {
    return (
      <div>
        <button onClick={() => setPessoaAberta(null)} style={{ ...linkBtn, display: "flex", alignItems: "center", gap: 4, marginBottom: 14 }}>
          <ChevronLeft size={14} /> Voltar
        </button>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#22231F", marginBottom: 12 }}>{pessoaAberta} — {nomeMes}</div>
        <div style={{ display: "grid", gap: 6 }}>
          {extrato.map((e, idx) => (
            <div key={idx} style={itemRow}>
              <span style={{ fontSize: 12, color: "#22231F" }}>{new Date(e.dia + "T12:00:00").toLocaleDateString("pt-BR")}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#22231F" }}>{brl(e.total_dia)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <button onClick={() => mudarMes(-1)} style={ghostIconBtn}><ChevronLeft size={18} /></button>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#22231F", textTransform: "capitalize" }}>{nomeMes}</span>
        <button onClick={() => mudarMes(1)} style={ghostIconBtn}><ChevronRight size={18} /></button>
      </div>
      <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 10 }}>Só pessoas registradas — diaristas já recebem por dia.</div>

      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.9fr 0.7fr 1fr", gap: 6, padding: "8px 10px", background: "#F6F1E7", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#8A8778" }}>
            <span>Pessoa</span><span>Papel</span><span style={{ textAlign: "right" }}>Dias</span><span style={{ textAlign: "right" }}>Acumulado</span>
          </div>
          {linhas.map((l, idx) => (
            <button key={l.nome} onClick={() => abrirExtrato(l.nome)}
              style={{ display: "grid", gridTemplateColumns: "1.4fr 0.9fr 0.7fr 1fr", gap: 6, padding: "10px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", fontSize: 13, width: "100%", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
              <span style={{ color: "#22231F" }}>{l.nome}</span>
              <span style={{ color: "#8A8778", fontSize: 12 }}>{PAPEL_LABEL[l.papel]}</span>
              <span style={{ textAlign: "right", color: "#8A8778" }}>{l.dias}</span>
              <span style={{ textAlign: "right", fontWeight: 700, color: "#22231F" }}>{brl(l.total)}</span>
            </button>
          ))}
          {linhas.length === 0 && <div style={{ padding: 14, fontSize: 13, color: "#8A8778" }}>Nenhuma premiação registrada nesse mês ainda.</div>}
          {linhas.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.9fr 0.7fr 1fr", gap: 6, padding: "10px", borderTop: "1px solid #E8E2D2", fontSize: 13, color: "#8A8778" }}>
              <span></span><span></span><span style={{ textAlign: "right" }}>Total</span><span style={{ textAlign: "right", fontWeight: 700, color: "#22231F" }}>{brl(total)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function round2(n) { return Math.round(n * 100) / 100; }

const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const itemRow = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10, padding: "10px 12px" };
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
