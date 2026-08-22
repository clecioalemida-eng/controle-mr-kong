import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2, AlertTriangle, Search, Plus, Trash2, Check,
  Upload, X,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { podeEditar } from "../lib/permissoes";

// ---------------------------------------------------------------------
// Insumos — cadastro central
//
// Antes, insumo só nascia de dois jeitos: entrando uma nota fiscal, ou
// pela janelinha "+ Criar novo insumo" dentro de uma ficha técnica. Para
// fechar as fichas de um cardápio inteiro isso não escala — é uma janela
// por insumo, e o cadastro fica pela metade.
//
// Esta tela resolve o volume: lista tudo que existe, mostra na cara quem
// está com custo zero (que é o que estraga o CMV e a margem), deixa
// editar na própria linha, e importa uma lista inteira colada de planilha.
//
// Custo zero não é detalhe: um insumo a R$ 0,00 faz a ficha do prato sair
// mais barata do que é, a margem aparecer maior do que é, e o CMV do DRE
// sair menor do que é. Por isso ele fica destacado em vermelho.
// ---------------------------------------------------------------------

const UNIDADES = ["un", "g", "kg", "ml", "l"];

// Aceita o que a pessoa escreve na planilha e devolve a unidade que o
// banco aceita. O check constraint da tabela só admite as cinco de cima.
const APELIDOS_UNIDADE = {
  un: "un", und: "un", uni: "un", unid: "un", unidade: "un", unidades: "un",
  pc: "un", pç: "un", peca: "un", peça: "un", cx: "un", pct: "un",
  g: "g", gr: "g", grama: "g", gramas: "g",
  kg: "kg", quilo: "kg", quilos: "kg", kilo: "kg", kilos: "kg",
  ml: "ml", mililitro: "ml", mililitros: "ml",
  l: "l", lt: "l", litro: "l", litros: "l",
};

function semAcento(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function chaveNome(s) {
  return semAcento(s).trim().toLowerCase().replace(/\s+/g, " ");
}
function normalizaUnidade(s) {
  const k = semAcento(s).trim().toLowerCase();
  return APELIDOS_UNIDADE[k] || null;
}
// "32,90" e "32.90" viram 32.9. "1.234,56" vira 1234.56.
function numeroBR(s) {
  if (s === null || s === undefined) return null;
  let t = String(s).replace(/[R$\s]/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}
// Ordem alfabética de verdade. O `order("nome")` do Postgres depende da
// collation do banco e às vezes joga nome acentuado ou em maiúscula pro
// fim da lista. localeCompare com "pt-BR" e sensitivity "base" trata
// "Água" junto de "Agua" e "ALFACE" junto de "Alface".
function porNome(a, b) {
  return String(a?.nome || "").localeCompare(String(b?.nome || ""), "pt-BR", { sensitivity: "base" });
}
function brl(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function Insumos({ permissoes }) {
  const editar = podeEditar(permissoes, "supply.insumos");

  const [insumos, setInsumos] = useState([]);
  const [usos, setUsos] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("todos");
  const [importando, setImportando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [{ data: ins, error: e1 }, { data: pi }] = await Promise.all([
      supabase.from("insumos")
        .select("id, nome, unidade, custo_medio_atual, estoque_atual, estoque_minimo, composto")
        .order("nome"),
      supabase.from("prato_insumos").select("insumo_id"),
    ]);
    if (e1) setErro(e1.message);
    setInsumos([...(ins || [])].sort(porNome));
    const contagem = {};
    (pi || []).forEach((r) => { contagem[r.insumo_id] = (contagem[r.insumo_id] || 0) + 1; });
    setUsos(contagem);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const semCusto = insumos.filter((i) => !Number(i.custo_medio_atual)).length;
  const semFicha = insumos.filter((i) => !usos[i.id]).length;

  const lista = useMemo(() => {
    const q = chaveNome(busca);
    return insumos.filter((i) => {
      if (q && !chaveNome(i.nome).includes(q)) return false;
      if (filtro === "semcusto" && Number(i.custo_medio_atual)) return false;
      if (filtro === "semficha" && usos[i.id]) return false;
      return true;
    }).sort(porNome);
  }, [insumos, busca, filtro, usos]);

  const salvarCampo = async (insumo, campo, valorBruto) => {
    setErro("");
    let valor = valorBruto;
    if (campo === "custo_medio_atual" || campo === "estoque_minimo") {
      valor = numeroBR(valorBruto);
      if (campo === "estoque_minimo" && (valor === null || valorBruto === "")) valor = null;
      if (campo === "custo_medio_atual" && valor === null) return;
    }
    if (campo === "nome") {
      valor = String(valorBruto).trim();
      if (!valor) return;
    }
    if (String(insumo[campo] ?? "") === String(valor ?? "")) return;
    const patch = { [campo]: valor, atualizado_em: new Date().toISOString() };
    const { error } = await supabase.from("insumos").update(patch).eq("id", insumo.id);
    if (error) { setErro(error.message); return; }
    setInsumos((atual) => atual.map((i) => (i.id === insumo.id ? { ...i, [campo]: valor } : i)));
  };

  const remover = async (insumo) => {
    setErro("");
    if (usos[insumo.id]) {
      setErro(`"${insumo.nome}" está em ${usos[insumo.id]} ficha(s) técnica(s). Tire das fichas antes de excluir.`);
      return;
    }
    const { error } = await supabase.from("insumos").delete().eq("id", insumo.id);
    if (error) { setErro(error.message); return; }
    setInsumos((atual) => atual.filter((i) => i.id !== insumo.id));
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={statBox}>
          <div style={statNum}>{insumos.length}</div>
          <div style={statLabel}>Insumos cadastrados</div>
        </div>
        <div style={statBox}>
          <div style={{ ...statNum, color: semCusto ? "#A32D2D" : "#27500A" }}>{semCusto}</div>
          <div style={statLabel}>Sem custo</div>
        </div>
        <div style={statBox}>
          <div style={{ ...statNum, color: semFicha ? "#854F0B" : "#27500A" }}>{semFicha}</div>
          <div style={statLabel}>Fora de qualquer ficha</div>
        </div>
      </div>

      {semCusto > 0 && (
        <div style={{ ...avisoStyle, marginBottom: 14 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13 }}>
            <b>{semCusto} insumo(s) com custo zero.</b> Enquanto estiverem
            assim, a ficha do prato sai mais barata do que é, a margem de
            contribuição aparece maior, e o CMV do DRE sai menor. Filtre por
            "Sem custo" e preencha.
          </div>
        </div>
      )}

      {editar && (
        <ImportarLista
          insumos={insumos}
          aberto={importando}
          setAberto={setImportando}
          aoTerminar={carregar}
        />
      )}

      {editar && !importando && <NovoInsumo aoCriar={carregar} setErro={setErro} />}

      {erro && (
        <div style={{ ...avisoStyle, marginBottom: 12 }}>
          <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 13 }}>{erro}</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div style={{ position: "relative", flex: 1, minWidth: 180 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "#8A8778" }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar insumo…"
            style={{ ...inputStyle, width: "100%", paddingLeft: 30, boxSizing: "border-box" }} />
        </div>
        {[
          { chave: "todos", label: "Todos" },
          { chave: "semcusto", label: "Sem custo" },
          { chave: "semficha", label: "Fora de ficha" },
        ].map((f) => (
          <button key={f.chave} onClick={() => setFiltro(f.chave)}
            style={{ ...chip, ...(filtro === f.chave ? chipAtivo : {}) }}>
            {f.label}
          </button>
        ))}
      </div>

      {carregando ? (
        <div style={vazio}><Loader2 size={16} /> Carregando…</div>
      ) : lista.length === 0 ? (
        <div style={vazio}>Nenhum insumo encontrado com esse filtro.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {lista.map((i) => {
            const zerado = !Number(i.custo_medio_atual);
            return (
              <div key={i.id} style={{
                ...itemRow,
                flexWrap: "wrap",
                borderColor: zerado ? "#F0B9B9" : "#E8E2D2",
                background: zerado ? "#FFF8F8" : "#FFFFFF",
              }}>
                <input defaultValue={i.nome} disabled={!editar}
                  onBlur={(e) => salvarCampo(i, "nome", e.target.value)}
                  style={{ ...inputLinha, flex: 1, minWidth: 150, fontWeight: 600 }} />

                <select defaultValue={i.unidade} disabled={!editar}
                  onChange={(e) => salvarCampo(i, "unidade", e.target.value)}
                  style={{ ...inputLinha, width: 66 }}>
                  {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>

                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ fontSize: 11, color: "#8A8778" }}>R$</span>
                  <input defaultValue={Number(i.custo_medio_atual) || ""} disabled={!editar}
                    inputMode="decimal" placeholder="0,00"
                    onBlur={(e) => salvarCampo(i, "custo_medio_atual", e.target.value)}
                    style={{
                      ...inputLinha, width: 84, textAlign: "right",
                      fontVariantNumeric: "tabular-nums",
                      color: zerado ? "#A32D2D" : "#22231F",
                    }} />
                  <span style={{ fontSize: 11, color: "#8A8778" }}>/{i.unidade}</span>
                </div>

                <div style={{ fontSize: 11, color: "#8A8778", minWidth: 78, textAlign: "right" }}>
                  {usos[i.id] ? `${usos[i.id]} ficha${usos[i.id] > 1 ? "s" : ""}` : "sem ficha"}
                </div>

                {editar && (
                  <button onClick={() => remover(i)} style={iconBtnPeq} title="Excluir insumo">
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 11, color: "#8A8778", marginTop: 12, lineHeight: 1.6 }}>
        O custo aqui é o <b>custo médio por unidade</b> — quanto custa uma unidade do
        insumo, na unidade escolhida. Se a caixa de 30 hambúrgueres sai por R$ 135, o custo do insumo
        "Hambúrguer" é R$ 4,50 e a unidade é <b>un</b>. Quando você confirma uma
        nota fiscal, esse número é atualizado sozinho pelo preço da compra.
      </div>
    </div>
  );
}

// =====================================================================
// Criar um insumo avulso
// =====================================================================
function NovoInsumo({ aoCriar, setErro }) {
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState({ nome: "", unidade: "un", custo: "" });
  const [salvando, setSalvando] = useState(false);

  const criar = async () => {
    const nome = form.nome.trim();
    if (!nome) { setErro("Dê um nome ao insumo."); return; }
    setSalvando(true);
    const { error } = await supabase.from("insumos").insert({
      nome,
      unidade: form.unidade,
      custo_medio_atual: numeroBR(form.custo) || 0,
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    setForm({ nome: "", unidade: "un", custo: "" });
    setAberto(false);
    aoCriar();
  };

  if (!aberto) {
    return (
      <button onClick={() => setAberto(true)}
        style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
        <Plus size={14} /> Novo insumo
      </button>
    );
  }

  return (
    <div style={{ ...cardStyle, marginBottom: 14, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <input autoFocus value={form.nome} placeholder="Nome (ex.: Mozzarela)"
        onChange={(e) => setForm({ ...form, nome: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && criar()}
        style={{ ...inputStyle, flex: 1, minWidth: 160 }} />
      <select value={form.unidade} onChange={(e) => setForm({ ...form, unidade: e.target.value })}
        style={{ ...inputStyle, width: 80 }}>
        {UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
      </select>
      <input value={form.custo} placeholder="Custo unit." inputMode="decimal"
        onChange={(e) => setForm({ ...form, custo: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && criar()}
        style={{ ...inputStyle, width: 100 }} />
      <button onClick={criar} disabled={salvando} style={btnPrimary}>
        {salvando ? "Criando…" : "Criar"}
      </button>
      <button onClick={() => setAberto(false)} style={linkBtn}>Cancelar</button>
    </div>
  );
}

// =====================================================================
// Importar uma lista inteira
// =====================================================================
function ImportarLista({ insumos, aberto, setAberto, aoTerminar }) {
  const [texto, setTexto] = useState("");
  const [previa, setPrevia] = useState(null);
  const [aplicando, setAplicando] = useState(false);
  const [resultado, setResultado] = useState("");
  const [erro, setErro] = useState("");

  const conferir = () => {
    setErro(""); setResultado("");
    const existentes = new Map(insumos.map((i) => [chaveNome(i.nome), i]));
    const vistos = new Set();
    const linhas = [];
    const avisos = [];

    texto.split(/\r?\n/).forEach((linhaBruta, idx) => {
      const linha = linhaBruta.trim();
      if (!linha) return;

      // Separador: tab primeiro (colagem de planilha), depois ponto e
      // vírgula. A vírgula fica por último porque em português ela também
      // é separador decimal — "32,90" viraria duas colunas.
      let partes;
      if (linha.includes("\t")) partes = linha.split("\t");
      else if (linha.includes(";")) partes = linha.split(";");
      else partes = linha.split(",");
      partes = partes.map((p) => p.trim());

      const nome = partes[0];
      if (!nome) return;

      const chave = chaveNome(nome);
      if (vistos.has(chave)) {
        avisos.push(`Linha ${idx + 1}: "${nome}" aparece mais de uma vez na lista. Usei a primeira.`);
        return;
      }
      vistos.add(chave);

      // A unidade pode vir na 2ª ou na 3ª coluna, dependendo de como a
      // planilha estiver montada. Procura em ambas.
      let unidade = null;
      let custoTexto = null;
      for (let c = 1; c < partes.length; c++) {
        const u = normalizaUnidade(partes[c]);
        if (u && !unidade) { unidade = u; continue; }
        if (custoTexto === null && numeroBR(partes[c]) !== null) custoTexto = partes[c];
      }
      if (partes.length > 1 && !unidade) {
        avisos.push(`Linha ${idx + 1}: não reconheci a unidade de "${nome}". Deixei como "un".`);
      }

      const custo = numeroBR(custoTexto);
      const existente = existentes.get(chave);
      linhas.push({
        nome,
        unidade: unidade || existente?.unidade || "un",
        custo: custo !== null ? custo : (existente ? Number(existente.custo_medio_atual) : 0),
        temCusto: custo !== null,
        acao: existente ? "atualizar" : "criar",
        id: existente?.id || null,
      });
    });

    setPrevia({ linhas, avisos });
  };

  const aplicar = async () => {
    if (!previa?.linhas?.length) return;
    setAplicando(true); setErro(""); setResultado("");

    const criar = previa.linhas.filter((l) => l.acao === "criar");
    const atualizar = previa.linhas.filter((l) => l.acao === "atualizar" && l.temCusto);

    let criados = 0;
    if (criar.length) {
      const { error } = await supabase.from("insumos").insert(
        criar.map((l) => ({
          nome: l.nome,
          unidade: l.unidade,
          custo_medio_atual: l.custo || 0,
        }))
      );
      if (error) { setErro(error.message); setAplicando(false); return; }
      criados = criar.length;
    }

    let atualizados = 0;
    for (const l of atualizar) {
      const { error } = await supabase.from("insumos")
        .update({
          unidade: l.unidade,
          custo_medio_atual: l.custo,
          atualizado_em: new Date().toISOString(),
        })
        .eq("id", l.id);
      if (error) { setErro(error.message); setAplicando(false); return; }
      atualizados += 1;
    }

    setAplicando(false);
    setResultado(`${criados} criado(s) e ${atualizados} atualizado(s).`);
    setPrevia(null);
    setTexto("");
    aoTerminar();
  };

  if (!aberto) {
    return (
      <button onClick={() => setAberto(true)}
        style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6, marginBottom: 14 }}>
        <Upload size={14} /> Importar lista
      </button>
    );
  }

  return (
    <div style={{ ...cardStyle, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: "#22231F" }}>Importar lista de insumos</div>
        <button onClick={() => { setAberto(false); setPrevia(null); }} style={iconBtnPeq} title="Fechar">
          <X size={14} />
        </button>
      </div>

      <div style={{ fontSize: 12, color: "#8A8778", lineHeight: 1.6, marginBottom: 10 }}>
        Uma linha por insumo, com <b>nome, unidade e custo</b>. Pode colar
        direto de uma planilha (as colunas já vêm separadas) ou digitar
        separando por ponto e vírgula. Nome que já existe é <b>atualizado</b>,
        não duplicado. Vírgula decimal funciona: <code>32,90</code>.
      </div>

      <textarea
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setPrevia(null); }}
        rows={8}
        placeholder={"Mozzarela; kg; 32,90\nHambúrguer 90g; un; 4,50\nPão brioche; un; 1,20\nCopo 300ml; un; 0,27"}
        style={{
          width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 8,
          border: "1px solid #E8E2D2", fontSize: 13, fontFamily: "ui-monospace, monospace",
          background: "#FFFFFF", color: "#22231F", resize: "vertical",
        }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button onClick={conferir} disabled={!texto.trim()} style={btnSecondary}>Conferir</button>
        {previa && previa.linhas.length > 0 && (
          <button onClick={aplicar} disabled={aplicando} style={btnPrimary}>
            {aplicando ? "Gravando…" : `Aplicar ${previa.linhas.length} linha(s)`}
          </button>
        )}
      </div>

      {erro && (
        <div style={{ ...avisoStyle, marginTop: 10 }}>
          <AlertTriangle size={16} /><div style={{ fontSize: 13 }}>{erro}</div>
        </div>
      )}
      {resultado && (
        <div style={{ ...avisoStyle, marginTop: 10, background: "#EAF3DE", borderColor: "#C4DBA6", color: "#27500A" }}>
          <Check size={16} /><div style={{ fontSize: 13 }}>{resultado}</div>
        </div>
      )}

      {previa && (
        <div style={{ marginTop: 12 }}>
          {previa.avisos.length > 0 && (
            <div style={{ ...avisoStyle, marginBottom: 10, flexDirection: "column", gap: 4 }}>
              {previa.avisos.map((a, k) => <div key={k} style={{ fontSize: 12 }}>{a}</div>)}
            </div>
          )}
          {previa.linhas.length === 0 ? (
            <div style={vazio}>Não consegui ler nenhuma linha. Confira o formato.</div>
          ) : (
            <div style={{ border: "1px solid #E8E2D2", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ display: "flex", background: "#F6F1E7", padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#8A8778", textTransform: "uppercase", letterSpacing: 0.4 }}>
                <div style={{ flex: 1 }}>Insumo</div>
                <div style={{ width: 50 }}>Un.</div>
                <div style={{ width: 90, textAlign: "right" }}>Custo</div>
                <div style={{ width: 80, textAlign: "right" }}>Ação</div>
              </div>
              <div style={{ maxHeight: 300, overflowY: "auto" }}>
                {previa.linhas.map((l, k) => (
                  <div key={k} style={{ display: "flex", padding: "7px 12px", fontSize: 12.5, borderTop: "1px solid #F0EBDD", alignItems: "center" }}>
                    <div style={{ flex: 1, color: "#22231F" }}>{l.nome}</div>
                    <div style={{ width: 50, color: "#8A8778" }}>{l.unidade}</div>
                    <div style={{ width: 90, textAlign: "right", fontVariantNumeric: "tabular-nums", color: l.custo ? "#22231F" : "#A32D2D" }}>
                      {brl(l.custo)}
                    </div>
                    <div style={{ width: 80, textAlign: "right" }}>
                      <span style={{ ...pill, background: l.acao === "criar" ? "#EAF3DE" : "#F6F1E7", color: l.acao === "criar" ? "#27500A" : "#8A8778" }}>
                        {l.acao}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// Estilos — mesmos tokens do resto do painel
// =====================================================================
const cardStyle = {
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14,
};
const inputStyle = {
  padding: "9px 10px", borderRadius: 8, border: "1px solid #E8E2D2",
  fontSize: 13, background: "#FFFFFF", color: "#22231F",
};
const inputLinha = {
  padding: "6px 8px", borderRadius: 6, border: "1px solid transparent",
  fontSize: 13, background: "transparent", color: "#22231F",
};
const btnSecondary = {
  background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F",
  borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const btnPrimary = {
  background: "#22231F", border: "1px solid #22231F", color: "#F3EFE3",
  borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer",
};
const linkBtn = {
  background: "transparent", border: "none", color: "#8A8778",
  fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "6px 4px",
};
const iconBtnPeq = {
  width: 28, height: 28, borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#A32D2D",
  flexShrink: 0,
};
const avisoStyle = {
  display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A",
  color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, alignItems: "flex-start",
};
const statBox = {
  flex: 1, minWidth: 120, background: "#FFFFFF", border: "1px solid #E8E2D2",
  borderRadius: 12, padding: "12px 14px", textAlign: "center",
};
const statNum = { fontSize: 18, fontWeight: 800, color: "#22231F", fontVariantNumeric: "tabular-nums" };
const statLabel = { fontSize: 11, color: "#8A8778", marginTop: 2 };
const itemRow = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10, padding: "6px 10px",
};
const chip = {
  padding: "7px 12px", borderRadius: 999, border: "1px solid #E8E2D2",
  background: "#FFFFFF", color: "#8A8778", fontSize: 12, fontWeight: 600, cursor: "pointer",
};
const chipAtivo = { background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" };
const pill = {
  fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
  textTransform: "uppercase", letterSpacing: 0.3,
};
const vazio = {
  display: "flex", alignItems: "center", gap: 8,
  fontSize: 13, color: "#8A8778", padding: "16px 0",
};
