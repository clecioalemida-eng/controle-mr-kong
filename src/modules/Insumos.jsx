// ===== Insumos.jsx =====
import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2, AlertTriangle, Search, Plus, Trash2, Check,
  Upload, X, Pencil,
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

// Setor é onde o insumo aparece na contagem de estoque. A lista NÃO é
// fixa aqui de propósito: ela vem de `setores_estoque`, que é alimentada
// pelos departamentos do próprio checklist. Setor novo criado em "Editar
// checklist" aparece aqui sozinho, sem mexer neste arquivo.
// Esta lista abaixo é só o que a tela mostra enquanto o banco não
// responde (ou se a migração 065 ainda não rodou).
const SETORES_PADRAO = [
  { chave: "caixa", label: "Caixa" },
  { chave: "bar", label: "Bar" },
  { chave: "chapa", label: "Chapa" },
  { chave: "gerencia", label: "Gerência" },
  { chave: "garcom", label: "Garçom" },
];

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
// fim da lista.
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
  const [modo, setModo] = useState("cadastro"); // cadastro | limpeza
  const [setores, setSetores] = useState({});   // insumo_id -> ["bar", ...]
  const [listaSetores, setListaSetores] = useState(SETORES_PADRAO);
  const [editandoSetor, setEditandoSetor] = useState(null);
  const [substituindo, setSubstituindo] = useState(null); // insumo que a lixeira quer excluir
  const [trocandoUnidade, setTrocandoUnidade] = useState(null); // { insumo, nova }
  const [calculandoPreco, setCalculandoPreco] = useState(null); // id do insumo
  // Insumo composto: o que ENTRA na cozinha e o que SAI dela sao coisas
  // diferentes. Compro laranja em quilo e vendo suco em litro; um saco de
  // 20 kg rende 8 litros. Sem isso, ou o custo do suco e digitado a mao
  // (e envelhece calado) ou a ficha do copo consome laranja em kg, e ai
  // nao da pra saber quanto custa o litro.
  const [editandoComposto, setEditandoComposto] = useState(null); // id do insumo

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [{ data: ins, error: e1 }, { data: pi }, { data: st }, { data: se }] = await Promise.all([
      supabase.from("insumos")
        .select("id, nome, unidade, custo_medio_atual, estoque_atual, estoque_minimo, composto, rendimento")
        .order("nome"),
      supabase.from("prato_insumos").select("insumo_id"),
      supabase.from("insumo_setores").select("insumo_id, setor"),
      supabase.from("setores_estoque").select("chave, label, ordem").eq("ativo", true).order("ordem"),
    ]);
    if (e1) setErro(e1.message);
    setInsumos([...(ins || [])].sort(porNome));
    const contagem = {};
    (pi || []).forEach((r) => { contagem[r.insumo_id] = (contagem[r.insumo_id] || 0) + 1; });
    setUsos(contagem);
    // Se a migração 064 ainda não rodou, `st` volta nulo e a tela segue
    // funcionando sem a coluna de setor — não trava o cadastro.
    const porInsumo = {};
    (st || []).forEach((r) => {
      (porInsumo[r.insumo_id] = porInsumo[r.insumo_id] || []).push(r.setor);
    });
    Object.values(porInsumo).forEach((v) => v.sort());
    setSetores(porInsumo);
    if (se && se.length) setListaSetores(se.map((r) => ({ chave: r.chave, label: r.label })));
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const rotuloSetor = useMemo(
    () => Object.fromEntries(listaSetores.map((s) => [s.chave, s.label])),
    [listaSetores],
  );

  const semCusto = insumos.filter((i) => !Number(i.custo_medio_atual)).length;
  const semFicha = insumos.filter((i) => !usos[i.id]).length;

  const lista = useMemo(() => {
    const q = chaveNome(busca);
    return insumos.filter((i) => {
      if (q && !chaveNome(i.nome).includes(q)) return false;
      if (filtro === "semcusto" && Number(i.custo_medio_atual)) return false;
      if (filtro === "semficha" && usos[i.id]) return false;
      if (filtro === "semsetor" && (setores[i.id] || []).length) return false;
      if (filtro.startsWith("setor:") && !(setores[i.id] || []).includes(filtro.slice(6))) return false;
      return true;
    }).sort(porNome);
  }, [insumos, busca, filtro, usos, setores]);

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

  // Manda a lista inteira e o banco deixa exatamente ela. Lista vazia
  // tira o insumo de todas as contagens.
  const salvarSetores = async (insumo, lista) => {
    setErro("");
    const { error } = await supabase.rpc("definir_setores_insumo", {
      p_insumo: insumo.id,
      p_setores: lista,
    });
    if (error) { setErro(error.message); return; }
    setSetores((atual) => ({ ...atual, [insumo.id]: [...lista].sort() }));
    setEditandoSetor(null);
  };

  // Antes isto era um beco sem saída: avisava "está em 1 ficha" e parava
  // por aí, deixando a pessoa abrir prato por prato pra descobrir qual.
  // Agora abre o painel de substituição, que mostra ONDE está e troca em
  // todas as fichas de uma vez.
  const remover = async (insumo) => {
    setErro("");
    if (usos[insumo.id]) { setSubstituindo(insumo); return; }
    const { error } = await supabase.from("insumos").delete().eq("id", insumo.id);
    if (error) { setErro(traduzirBloqueio(error.message, insumo.nome)); return; }
    setInsumos((atual) => atual.filter((i) => i.id !== insumo.id));
  };

  // O Postgres devolve "violates foreign key constraint ..." — ilegível.
  // Nota fiscal e movimentação são história e a substituição não mexe
  // nelas de propósito, então esse bloqueio é esperado e merece explicação.
  function traduzirBloqueio(mensagem, nome) {
    if (/foreign key|violates|23503/i.test(mensagem || "")) {
      return `"${nome}" já apareceu em nota fiscal, movimentação de estoque ou contagem. Esse histórico não é reescrito — o que você comprou naquele dia foi esse insumo mesmo. Ele sai das fichas, mas continua cadastrado.`;
    }
    return mensagem;
  }

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

      {editar && (
        <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
          <button onClick={() => setModo("cadastro")}
            style={{ ...chip, ...(modo === "cadastro" ? chipAtivo : {}) }}>Cadastro</button>
          <button onClick={() => setModo("limpeza")}
            style={{ ...chip, ...(modo === "limpeza" ? chipAtivo : {}) }}>Limpeza</button>
        </div>
      )}

      {modo === "limpeza" ? (
        <Limpeza aoMudar={carregar} />
      ) : (
      <>
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
          { chave: "semsetor", label: "Sem setor" },
        ].map((f) => (
          <button key={f.chave} onClick={() => setFiltro(f.chave)}
            style={{ ...chip, ...(filtro === f.chave ? chipAtivo : {}) }}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Filtrar por setor é o mesmo recorte que o checklist usa pra contar. */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <span style={{ fontSize: 11, color: "#8A8778", marginRight: 2 }}>Setor:</span>
        {listaSetores.map((s) => {
          const chave = `setor:${s.chave}`;
          const quantos = insumos.filter((i) => (setores[i.id] || []).includes(s.chave)).length;
          return (
            <button key={s.chave}
              onClick={() => setFiltro(filtro === chave ? "todos" : chave)}
              style={{ ...chip, ...(filtro === chave ? chipAtivo : {}) }}>
              {s.label} <span style={{ opacity: 0.6, fontSize: 10 }}>{quantos}</span>
            </button>
          );
        })}
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

                {/* Controlado, não defaultValue: se a pessoa desistir no
                    painel, o seletor precisa voltar sozinho pra unidade
                    de verdade. */}
                <select value={i.unidade} disabled={!editar}
                  onChange={(e) => {
                    const nova = e.target.value;
                    if (nova === i.unidade) return;
                    setTrocandoUnidade({ insumo: i, nova });
                  }}
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
                  {editar && (
                    <button onClick={() => setCalculandoPreco(calculandoPreco === i.id ? null : i.id)}
                      title="Calcular a partir do que você pagou"
                      style={{ border: "1px solid #E8E2D2", background: zerado ? "#FBF3D9" : "#FFFFFF", color: zerado ? "#7A6A1E" : "#8A8778", borderRadius: 6, padding: "3px 7px", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
                      calcular
                    </button>
                  )}
                </div>

                <div style={{ fontSize: 11, color: "#8A8778", minWidth: 78, textAlign: "right" }}>
                  {usos[i.id] ? `${usos[i.id]} ficha${usos[i.id] > 1 ? "s" : ""}` : "sem ficha"}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                  {(setores[i.id] || []).length === 0 ? (
                    <span style={tagSetorVazio}>sem setor</span>
                  ) : (
                    (setores[i.id] || []).map((s) => (
                      <span key={s} style={tagSetor}>{rotuloSetor[s] || s}</span>
                    ))
                  )}
                  {editar && (
                    <button
                      onClick={() => setEditandoSetor(editandoSetor === i.id ? null : i.id)}
                      style={{ ...iconBtnPeq, color: editandoSetor === i.id ? "#C72B2E" : undefined }}
                      title="Em que setor este insumo é contado">
                      <Pencil size={13} />
                    </button>
                  )}
                </div>

                {i.composto && (
                  <span style={{ fontSize: 9.5, fontWeight: 800, padding: "2px 7px", borderRadius: 999,
                                 background: "#EEF4FF", color: "#2C4C8F", border: "1px solid #C9D8F2",
                                 whiteSpace: "nowrap" }}>
                    calculado
                  </span>
                )}

                {editar && (
                  <button onClick={() => setEditandoComposto(editandoComposto === i.id ? null : i.id)}
                    title="Este insumo é feito a partir de outros"
                    style={{ border: "1px solid " + (i.composto ? "#C9D8F2" : "#E8E2D2"),
                             background: i.composto ? "#EEF4FF" : "#FFFFFF",
                             color: i.composto ? "#2C4C8F" : "#8A8778",
                             borderRadius: 6, padding: "3px 7px", fontSize: 10, fontWeight: 700,
                             cursor: "pointer", fontFamily: "inherit", flexShrink: 0 }}>
                    receita
                  </button>
                )}

                {editar && (
                  <button onClick={() => remover(i)} style={iconBtnPeq} title="Excluir insumo">
                    <Trash2 size={13} />
                  </button>
                )}

                {editandoComposto === i.id && (
                  <ReceitaDoComposto
                    insumo={i}
                    insumos={insumos}
                    onFechar={() => setEditandoComposto(null)}
                    onPronto={() => { setEditandoComposto(null); carregar(); }}
                    onErro={setErro}
                  />
                )}

                {calculandoPreco === i.id && (
                  <CalcularPreco
                    insumo={i}
                    onFechar={() => setCalculandoPreco(null)}
                    onSalvo={(novoCusto) => {
                      setInsumos((atual) => atual.map((x) => x.id === i.id ? { ...x, custo_medio_atual: novoCusto } : x));
                      setCalculandoPreco(null);
                    }}
                    onErro={setErro}
                  />
                )}

                {trocandoUnidade?.insumo?.id === i.id && (
                  <TrocarUnidade
                    insumo={i}
                    nova={trocandoUnidade.nova}
                    fichas={usos[i.id] || 0}
                    onFechar={() => setTrocandoUnidade(null)}
                    onPronto={() => { setTrocandoUnidade(null); carregar(); }}
                    onErro={setErro}
                  />
                )}

                {substituindo?.id === i.id && (
                  <SubstituirInsumo
                    insumo={i}
                    insumos={insumos}
                    onFechar={() => setSubstituindo(null)}
                    onPronto={(apagou) => {
                      setSubstituindo(null);
                      if (apagou) setInsumos((atual) => atual.filter((x) => x.id !== i.id));
                      carregar();
                    }}
                    onErro={(m) => setErro(traduzirBloqueio(m, i.nome))}
                  />
                )}

                {editandoSetor === i.id && (
                  <EditorSetores
                    opcoes={listaSetores}
                    atual={setores[i.id] || []}
                    aoSalvar={(lista) => salvarSetores(i, lista)}
                    aoCancelar={() => setEditandoSetor(null)}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      </>
      )}

      {modo === "cadastro" && (
      <div style={{ fontSize: 11, color: "#8A8778", marginTop: 12, lineHeight: 1.6 }}>
        O custo aqui é o <b>custo médio por unidade</b> — quanto custa uma unidade do
        insumo, na unidade escolhida. Se a caixa de 30 hambúrgueres sai por R$ 135, o custo do insumo
        "Hambúrguer" é R$ 4,50 e a unidade é <b>un</b>. Quando você confirma uma
        nota fiscal, esse número é atualizado sozinho pelo preço da compra.
      </div>
      )}
    </div>
  );
}

// =====================================================================
// Editor de setor — o lápis da linha
//
// O setor não é categoria de compra: é ONDE o item é contado no
// checklist de estoque. Por isso é lista, não escolha única — açúcar é
// contado na cozinha e no bar, e tem que aparecer nas duas contagens.
//
// Salva com a lista inteira: o banco apaga o que saiu e grava o que
// entrou numa tacada só, então não existe estado meio salvo.
// =====================================================================
function EditorSetores({ opcoes, atual, aoSalvar, aoCancelar }) {
  const [sel, setSel] = useState(() => new Set(atual));
  const [salvando, setSalvando] = useState(false);

  const alterna = (chave) => {
    setSel((s) => {
      const novo = new Set(s);
      if (novo.has(chave)) novo.delete(chave); else novo.add(chave);
      return novo;
    });
  };

  const salvar = async () => {
    setSalvando(true);
    await aoSalvar([...sel]);
    setSalvando(false);
  };

  return (
    <div style={caixaSetor}>
      <span style={{ fontSize: 11, color: "#8A8778", marginRight: 2 }}>
        Contar em:
      </span>
      {opcoes.map((s) => {
        const on = sel.has(s.chave);
        return (
          <button key={s.chave} onClick={() => alterna(s.chave)}
            style={{ ...btnSetor, ...(on ? btnSetorOn : {}) }}>
            {on && <Check size={12} />}
            {s.label}
          </button>
        );
      })}
      <div style={{ flex: 1 }} />
      <button onClick={salvar} disabled={salvando}
        style={{ ...btnSetor, background: "#22231F", borderColor: "#22231F", color: "#F3EFE3" }}>
        {salvando ? <Loader2 size={12} /> : <Check size={12} />}
        Salvar
      </button>
      <button onClick={aoCancelar} style={btnSetor}>
        <X size={12} /> Cancelar
      </button>
    </div>
  );
}

// =====================================================================
// Limpeza do cadastro
//
// O cadastro juntou duas coisas diferentes: insumo (o que se COMPRA) e
// item de venda. Todo "Adicional de X" ganhou um insumo espelho, e a
// ficha dele aponta pra si mesma — nunca vai gerar custo. Tem também
// duplicata de compra: "Açai" e "Açaí 10kg" são o mesmo açaí.
//
// Duas ações, e a ordem importa:
//   JUNTAR  move ficha, estoque e histórico do errado pro certo, e apaga
//           o errado. É o que resolve "Adicional de granola" -> "Granola".
//   EXCLUIR só serve pra quem não tem nada preso. Quem está em ficha ou
//           tem movimento de estoque é recusado, com o motivo — apagar
//           ali perderia o histórico em vez de corrigi-lo.
//
// Nem todo espelho é erro. Em REVENDA — cerveja, refrigerante, água — a
// ficha é 1 para 1 de propósito: você compra pronto e vende pronto. Esses
// ficam marcados como revenda e saem da fila, senão ela nunca zera e você
// perde a referência do que ainda falta arrumar.
//
// Nada aqui toca em `pratos`. Produto de venda não é mexido.
// =====================================================================
function Limpeza({ aoMudar }) {
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [msg, setMsg] = useState("");
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("espelho");
  const [marcados, setMarcados] = useState(() => new Set());
  const [destino, setDestino] = useState({});
  const [ocupado, setOcupado] = useState(null);
  const [resultado, setResultado] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.rpc("insumos_para_limpeza");
    if (error) setErro(error.message);
    setLinhas([...(data || [])].sort(porNome));
    setMarcados(new Set());
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // Revenda sai da conta de espelhos: ali o espelho é o certo.
  const espelhos = linhas.filter((l) => l.prato_mesmo_nome && !l.revenda).length;
  const revendas = linhas.filter((l) => l.revenda).length;
  const soltos = linhas.filter((l) => l.fichas === 0 && l.movimentos_estoque === 0 && l.compoe_outro === 0).length;

  const visiveis = useMemo(() => {
    const q = chaveNome(busca);
    return linhas.filter((l) => {
      if (q && !chaveNome(l.nome).includes(q)) return false;
      if (filtro === "espelho" && (!l.prato_mesmo_nome || l.revenda)) return false;
      if (filtro === "revenda" && !l.revenda) return false;
      if (filtro === "soltos" && !(l.fichas === 0 && l.movimentos_estoque === 0 && l.compoe_outro === 0)) return false;
      if (filtro === "semcusto" && Number(l.custo_medio_atual)) return false;
      return true;
    });
  }, [linhas, busca, filtro]);

  const alternar = (id) => {
    setMarcados((prev) => {
      const novo = new Set(prev);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });
  };
  const marcarTodosVisiveis = () => {
    const todos = visiveis.every((l) => marcados.has(l.id));
    setMarcados(todos ? new Set() : new Set(visiveis.map((l) => l.id)));
  };

  const juntar = async (linha) => {
    const alvo = destino[linha.id];
    if (!alvo) { setErro(`Escolha com qual insumo juntar "${linha.nome}".`); return; }
    setOcupado(linha.id); setErro(""); setMsg(""); setResultado(null);
    const { data, error } = await supabase.rpc("juntar_insumos", { p_origem: linha.id, p_destino: alvo });
    setOcupado(null);
    if (error) { setErro(error.message); return; }
    setMsg(data || "Insumos juntados.");
    setDestino((d) => ({ ...d, [linha.id]: "" }));
    await carregar();
    aoMudar?.();
  };

  const marcarRevenda = async (ids, valor) => {
    if (!ids.length) return;
    setOcupado("lote"); setErro(""); setMsg(""); setResultado(null);
    const { data, error } = await supabase.rpc("marcar_revenda", { p_ids: ids, p_revenda: valor });
    setOcupado(null);
    if (error) { setErro(error.message); return; }
    setMsg(valor
      ? `${data || ids.length} insumo(s) marcado(s) como revenda — saíram da fila.`
      : `${data || ids.length} insumo(s) voltaram para a fila.`);
    await carregar();
    aoMudar?.();
  };

  const excluirMarcados = async () => {
    if (marcados.size === 0) return;
    setOcupado("lote"); setErro(""); setMsg(""); setResultado(null);
    const { data, error } = await supabase.rpc("excluir_insumos", { p_ids: [...marcados] });
    setOcupado(null);
    if (error) { setErro(error.message); return; }
    setResultado(data || []);
    await carregar();
    aoMudar?.();
  };

  if (carregando) return <div style={vazio}><Loader2 size={16} /> Carregando…</div>;

  const apagados = (resultado || []).filter((r) => r.excluido);
  const recusados = (resultado || []).filter((r) => !r.excluido);

  return (
    <div>
      <div style={{ ...avisoStyle, marginBottom: 12 }}>
        <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
          <b>{espelhos} espelho(s) a resolver.</b> São insumos com um prato
          de mesmo nome: o item de venda virou insumo por engano, e a ficha
          aponta pra si mesma. O certo é <b>juntar</b> com o insumo de
          verdade — "Adicional de granola" com "Granola" — e não excluir,
          senão a ficha do prato fica vazia.
          <div style={{ marginTop: 6 }}>
            Cerveja, refrigerante e água também aparecem como espelho, mas
            ali está <b>certo</b>: você compra pronto e vende pronto, a ficha
            é 1 para 1. Marque esses como <b>revenda</b> e eles somem da fila.
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
        <div style={{ position: "relative", flex: 1, minWidth: 170 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "#8A8778" }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar…"
            style={{ ...inputStyle, width: "100%", paddingLeft: 30, boxSizing: "border-box" }} />
        </div>
        {[
          { chave: "espelho", label: `Espelho a resolver (${espelhos})` },
          { chave: "soltos", label: `Sem nada preso (${soltos})` },
          { chave: "revenda", label: `Revenda (${revendas})` },
          { chave: "semcusto", label: "Sem custo" },
          { chave: "todos", label: `Todos (${linhas.length})` },
        ].map((f) => (
          <button key={f.chave} onClick={() => setFiltro(f.chave)}
            style={{ ...chip, ...(filtro === f.chave ? chipAtivo : {}) }}>{f.label}</button>
        ))}
      </div>

      {erro && <div style={{ ...avisoStyle, marginBottom: 10 }}><AlertTriangle size={15} /><div style={{ fontSize: 12.5 }}>{erro}</div></div>}
      {msg && (
        <div style={{ ...avisoStyle, marginBottom: 10, background: "#EAF3DE", borderColor: "#C4DBA6", color: "#27500A" }}>
          <Check size={15} /><div style={{ fontSize: 12.5 }}>{msg}</div>
        </div>
      )}

      {resultado && (
        <div style={{ ...avisoStyle, marginBottom: 10, background: apagados.length ? "#EAF3DE" : "#FBF3D9", borderColor: apagados.length ? "#C4DBA6" : "#E8D48A", color: apagados.length ? "#27500A" : "#7A6A1E", flexDirection: "column", gap: 4 }}>
          {apagados.length > 0 && <div style={{ fontSize: 12.5 }}><b>{apagados.length} excluído(s):</b> {apagados.map((r) => r.nome).join(", ")}</div>}
          {recusados.map((r) => (
            <div key={r.id} style={{ fontSize: 12 }}><b>{r.nome}</b> — {r.motivo}</div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <button onClick={marcarTodosVisiveis} style={{ ...btnSecondary, padding: "7px 12px", fontSize: 12 }}>
          {visiveis.length > 0 && visiveis.every((l) => marcados.has(l.id)) ? "Desmarcar todos" : "Marcar todos da lista"}
        </button>
        <button onClick={() => marcarRevenda([...marcados], true)} disabled={marcados.size === 0 || ocupado === "lote"}
          style={{ ...btnSecondary, padding: "7px 12px", fontSize: 12 }}>
          Marcar {marcados.size || ""} como revenda
        </button>
        <div style={{ flex: 1 }} />
        <button onClick={excluirMarcados} disabled={marcados.size === 0 || ocupado === "lote"}
          style={{
            ...btnPrimary, padding: "8px 14px", fontSize: 12.5,
            background: marcados.size ? "#A32D2D" : "#C9C4B4", borderColor: marcados.size ? "#A32D2D" : "#C9C4B4",
          }}>
          {ocupado === "lote" ? "Excluindo…" : `Excluir ${marcados.size} marcado(s)`}
        </button>
      </div>

      {visiveis.length === 0 ? (
        <div style={vazio}>Nada nesse filtro.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {visiveis.map((l) => {
            const preso = l.fichas > 0 || l.movimentos_estoque > 0 || l.compoe_outro > 0;
            return (
              <div key={l.id} style={{
                ...itemRow, flexWrap: "wrap", alignItems: "flex-start",
                borderColor: marcados.has(l.id) ? "#A32D2D" : "#E8E2D2",
                background: marcados.has(l.id) ? "#FFF8F8" : "#FFFFFF",
              }}>
                <input type="checkbox" checked={marcados.has(l.id)} onChange={() => alternar(l.id)}
                  style={{ marginTop: 3 }} />
                <div style={{ flex: 1, minWidth: 150 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#22231F" }}>
                    {l.nome} <span style={{ fontWeight: 400, color: "#8A8778" }}>· {l.unidade}</span>
                  </div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4 }}>
                    {l.revenda && <span style={{ ...selo, background: "#37A0E522", color: "#185FA5" }}>revenda</span>}
                    {l.prato_mesmo_nome && !l.revenda && <span style={{ ...selo, background: "#FBF3D9", color: "#854F0B" }}>espelho de prato</span>}
                    {l.fichas > 0 && <span style={{ ...selo, background: "#37A0E522", color: "#185FA5" }}>{l.fichas} ficha(s)</span>}
                    {l.movimentos_estoque > 0 && <span style={{ ...selo, background: "#F6F1E7", color: "#8A8778" }}>{l.movimentos_estoque} mov. estoque</span>}
                    {l.itens_de_nota > 0 && <span style={{ ...selo, background: "#F6F1E7", color: "#8A8778" }}>{l.itens_de_nota} item(ns) de nota</span>}
                    {l.compoe_outro > 0 && <span style={{ ...selo, background: "#F6F1E7", color: "#8A8778" }}>compõe outro</span>}
                    {!Number(l.custo_medio_atual) && <span style={{ ...selo, background: "#F0999522", color: "#A32D2D" }}>sem custo</span>}
                    {!preso && <span style={{ ...selo, background: "#EAF3DE", color: "#27500A" }}>pode excluir</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <select value={destino[l.id] || ""} onChange={(e) => setDestino((d) => ({ ...d, [l.id]: e.target.value }))}
                    style={{ ...inputStyle, minWidth: 150, padding: "7px 8px", fontSize: 12 }}>
                    <option value="">Juntar com…</option>
                    {linhas.filter((o) => o.id !== l.id).map((o) => (
                      <option key={o.id} value={o.id}>{o.nome} ({o.unidade})</option>
                    ))}
                  </select>
                  <button onClick={() => juntar(l)} disabled={!destino[l.id] || ocupado === l.id}
                    style={{ ...btnPrimary, padding: "7px 12px", fontSize: 12, borderRadius: 8 }}>
                    {ocupado === l.id ? "..." : "Juntar"}
                  </button>
                  <button onClick={() => marcarRevenda([l.id], !l.revenda)} disabled={ocupado === "lote"}
                    title={l.revenda ? "Voltar para a fila de faxina" : "Comprado pronto e vendido pronto — sai da fila"}
                    style={{ ...linkBtn, fontSize: 11, whiteSpace: "nowrap" }}>
                    {l.revenda ? "não é revenda" : "é revenda"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 11, color: "#8A8778", marginTop: 12, lineHeight: 1.6 }}>
        <b>Juntar</b> leva ficha, estoque e histórico de notas do insumo errado
        para o certo, apaga o errado, e ainda guarda o nome antigo como
        sinônimo — a próxima nota que chegar com aquele nome já cai no lugar
        certo. <b>Excluir</b> só passa em quem não tem nada preso.
        <b> Revenda</b> não apaga nada: só tira da fila o que já está correto,
        e o custo continua sendo o preço de <b>uma</b> unidade — caixa de 24
        por R$ 120 dá R$ 5,00 na garrafa, não R$ 120.
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

// ---------------------------------------------------------------------
// Substituir um insumo em todas as fichas
//
// Três cuidados que a função do banco impõe e a tela precisa explicar:
//
//   1. UNIDADE DIFERENTE. Se o velho é kg e o novo é un, 0,1 kg não vira
//      0,1 un — seria inventar custo. Nesse caso a tela exige a
//      quantidade nova.
//   2. DESTINO JÁ NA MESMA FICHA. As duas linhas viram uma e as
//      quantidades somam. Sem isso o banco recusaria: a chave é
//      (prato_id, insumo_id), duas linhas iguais não cabem.
//   3. HISTÓRICO NÃO SE REESCREVE. Nota fiscal, movimentação e contagem
//      continuam apontando pro insumo velho. O que foi comprado naquele
//      dia foi aquilo mesmo.
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// Trocar a unidade de um insumo
//
// O seletor da linha não grava mais direto. Trocar "un" por "kg" muda o
// significado de todo número já escrito nas fichas: uma ficha que pedia
// 1 un de alface passaria a pedir 1 kg — vinte vezes mais alface em cada
// hambúrguer, sem nada na tela dizendo por quê.
//
// Entre unidades da mesma família (kg↔g, l↔ml) a conversão é certa e o
// painel só confirma. Envolvendo "un" não há equivalência fixa — uma
// unidade de alface e uma de ovo não pesam a mesma coisa —, então a
// pergunta é QUANTO PESA 1 UN. Uma resposta converte todas as fichas,
// cada uma na proporção dela.
// ---------------------------------------------------------------------
const FAMILIA = { g: "peso", kg: "peso", ml: "volume", l: "volume", un: "unidade" };
const EM_BASE = { g: 0.001, kg: 1, ml: 0.001, l: 1, un: 1 };

function fatorDireto(de, para) {
  // só vale dentro da mesma família: 1 kg = 1000 g, 1 l = 1000 ml
  if (FAMILIA[de] !== FAMILIA[para] || FAMILIA[de] === "unidade") return null;
  return EM_BASE[de] / EM_BASE[para];
}

function TrocarUnidade({ insumo, nova, fichas, onFechar, onPronto, onErro }) {
  const direto = fatorDireto(insumo.unidade, nova);
  const envolveUn = insumo.unidade === "un" || nova === "un";

  // quanto pesa/mede 1 unidade velha, na unidade nova
  const [equivale, setEquivale] = useState("");
  const [pago, setPago] = useState("");
  const [quanto, setQuanto] = useState("");
  const [trabalhando, setTrabalhando] = useState(false);
  const [erroLocal, setErroLocal] = useState("");

  const n = (v) => parseFloat(String(v ?? "").replace(",", ".")) || 0;
  const fator = direto != null ? direto : n(equivale);
  const custoAtual = Number(insumo.custo_medio_atual) || 0;
  const custoInformado = n(quanto) > 0 ? n(pago) / n(quanto) : 0;
  // sem informar, o custo é convertido na mesma proporção — senão
  // trocar kg por g deixaria o sal a R$ 3,00 o grama
  const custoFinal = custoInformado > 0 ? custoInformado : (fator > 0 ? custoAtual / fator : 0);

  const executar = async () => {
    if (fator <= 0) { setErroLocal("Informe quanto vale 1 " + insumo.unidade + " em " + nova + "."); return; }
    setTrabalhando(true);
    setErroLocal("");
    const { error } = await supabase.rpc("trocar_unidade_insumo", {
      p_insumo: insumo.id,
      p_nova_unidade: nova,
      p_fator: fator,
      p_novo_custo: custoInformado > 0 ? Math.round(custoInformado * 1e6) / 1e6 : null,
    });
    setTrabalhando(false);
    if (error) {
      if (/does not exist|schema cache/i.test(error.message)) {
        onErro("A troca de unidade ainda não foi instalada no banco — falta rodar a migração 085.");
        onFechar();
        return;
      }
      setErroLocal(error.message);
      return;
    }
    onPronto();
  };

  return (
    <div style={{ width: "100%", background: "#FFFFFF", border: "1px solid #C98F87", borderRadius: 11, padding: 14, marginTop: 8 }}>
      <div style={{ fontSize: 13.5, fontWeight: 800, marginBottom: 4 }}>
        Trocar de {insumo.unidade} para {nova}
      </div>
      <div style={{ fontSize: 12, color: "#8A8778", marginBottom: 12, lineHeight: 1.5 }}>
        {fichas > 0
          ? <>"{insumo.nome}" está em <strong>{fichas} ficha{fichas > 1 ? "s" : ""} técnica{fichas > 1 ? "s" : ""}</strong>, com a quantidade escrita em <strong>{insumo.unidade}</strong>. O saldo de estoque também.</>
          : <>"{insumo.nome}" não está em nenhuma ficha técnica. Só o saldo de estoque é convertido.</>}
      </div>

      {/* 1. o fator */}
      <div style={blocoTU}>
        <div style={rotuloTU}>1. {direto != null ? "Conversão" : `Quanto vale 1 ${insumo.unidade} de ${insumo.nome}?`}</div>
        {direto != null ? (
          <div style={{ fontSize: 13 }}>
            1 {insumo.unidade} = <strong>{direto.toLocaleString("pt-BR")} {nova}</strong> — conta exata, não preciso perguntar.
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 13 }}>
            <span>1 {insumo.unidade} =</span>
            <input value={equivale} onChange={(e) => setEquivale(e.target.value)} placeholder="0,05"
              style={campoTU} autoFocus />
            <span style={unTU}>{nova}</span>
          </div>
        )}
        {fichas > 0 && fator > 0 && (
          <div style={previaTU}>
            As {fichas} fichas são convertidas na proporção de cada uma: a que pedia <strong>1 {insumo.unidade}</strong> passa
            a pedir <strong>{(1 * fator).toLocaleString("pt-BR", { maximumFractionDigits: 6 })} {nova}</strong>.
            A receita continua a mesma — muda só como ela está escrita.
          </div>
        )}
        {envolveUn && direto == null && (
          <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 7, lineHeight: 1.5 }}>
            "un" é a única unidade sem equivalência fixa: uma unidade de alface e uma de ovo não pesam a mesma coisa.
            Por isso essa pergunta.
          </div>
        )}
      </div>

      {/* 2. o preço */}
      <div style={blocoTU}>
        <div style={rotuloTU}>2. E o preço?</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 13, marginBottom: 8 }}>
          <span>Paguei R$</span>
          <input value={pago} onChange={(e) => setPago(e.target.value)} placeholder="42,00" style={campoTU} />
          <span>por</span>
          <input value={quanto} onChange={(e) => setQuanto(e.target.value)} placeholder="5" style={campoTU} />
          <span style={unTU}>{nova}</span>
        </div>
        <div style={{ display: "inline-block", fontSize: 12.5, fontWeight: 800, color: custoFinal > 0 ? "#0F6E56" : "#8A8778", background: custoFinal > 0 ? "#DCF0E6" : "#F0EBDD", borderRadius: 8, padding: "8px 10px" }}>
          {custoFinal > 0 ? `fica ${brlIns(custoFinal)} /${nova}` : "sem preço"}
        </div>
        <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 7, lineHeight: 1.5 }}>
          {custoInformado > 0
            ? "Esse valor substitui o custo atual."
            : `Em branco, o custo atual (${brlIns(custoAtual)}/${insumo.unidade}) é convertido na mesma proporção — não fica o mesmo número com outro significado.`}
        </div>
        {fichas > 0 && fator > 0 && custoFinal > 0 && (
          <div style={previaTU}>
            Uma ficha que usava 1 {insumo.unidade} passa a custar <strong>{brlIns(fator * custoFinal)}</strong>.
            Hoje ela conta <strong>{brlIns(custoAtual)}</strong>.
          </div>
        )}
      </div>

      {erroLocal && <div style={{ fontSize: 12, color: "#A32D2D", marginBottom: 9 }}>{erroLocal}</div>}

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        <button onClick={executar} disabled={trabalhando || fator <= 0}
          style={{ ...btnSecondary, background: fator > 0 ? "#22231F" : "#F6F1E7", color: fator > 0 ? "#F3EFE3" : "#B3AC96", borderColor: fator > 0 ? "#22231F" : "#E8E2D2" }}>
          {trabalhando ? "Convertendo…" : `Trocar para ${nova}${fichas > 0 ? ` e converter ${fichas} ficha${fichas > 1 ? "s" : ""}` : ""}`}
        </button>
        <button onClick={onFechar} style={btnSecondary}>Cancelar</button>
      </div>
      <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 8, lineHeight: 1.5 }}>
        Notas fiscais, movimentações e contagens antigas não mudam — o que você comprou naquele dia
        foi comprado naquela unidade. Isso é histórico.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Calcular o preço a partir do que se pagou
//
// "Paguei R$ 28,00 por 650 g" em vez de "R$ 43,08 o quilo". A divisão de
// cabeça é onde entra número errado — e são 193 insumos a zero esperando
// preço.
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Receita do insumo composto — a laranja que vira suco
//
// O caso que gerou isto: compro laranja em QUILO e vendo suco em LITRO.
// Um saco de 20 kg rende 8 litros. Sem um lugar pra dizer isso, sobram
// duas saidas ruins: digitar o custo do litro na mao (e ele envelhece
// calado, porque a laranja muda de preco toda semana), ou pendurar a
// ficha do copo direto na laranja em kg — e ai ninguem consegue responder
// quanto custa o litro de suco.
//
// Aqui o litro passa a ser CALCULADO: soma dos ingredientes dividida pelo
// rendimento. Laranja subiu na nota? O litro sobe junto, e toda bebida
// que leva suco recalcula. Voce nunca digita o custo do suco.
//
// O rendimento fixo mente um pouco por definicao — laranja boa rende
// mais. Por isso o painel de baixo: ele pega as duas contagens de estoque
// e diz quanto a sua laranja rendeu DE VERDADE no periodo. O numero fixo
// vira uma aposta auditada, e nao um chute que ninguem mais confere.
// ---------------------------------------------------------------------------
function ReceitaDoComposto({ insumo, insumos, onFechar, onPronto, onErro }) {
  const [rendimento, setRendimento] = useState(String(insumo.rendimento || ""));
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [escolhido, setEscolhido] = useState("");
  const [erroLocal, setErroLocal] = useState("");
  const [real, setReal] = useState(null);
  const [periodo, setPeriodo] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.rpc("receita_do_composto", { p_insumo: insumo.id });
    if (error) {
      setErroLocal(/does not exist|schema cache/i.test(error.message || "")
        ? "Falta rodar a migração 107 no banco." : error.message);
      setLinhas([]);
    } else {
      setLinhas((data || []).map((l) => ({
        insumo_id: l.insumo_filho_id, nome: l.nome, unidade: l.unidade,
        custo: Number(l.custo_unitario) || 0, quantidade: String(l.quantidade ?? ""),
      })));
      setErroLocal("");
    }
    setCarregando(false);
  }, [insumo.id]);

  useEffect(() => { carregar(); }, [carregar]);

  // So insumo SIMPLES pode entrar na receita: composto dentro de composto
  // e onde esse tipo de conta vira laco infinito, e nenhuma cozinha
  // precisa disso pra fazer suco.
  const candidatos = useMemo(
    () => insumos.filter((x) => x.id !== insumo.id && !x.composto)
                 .filter((x) => !linhas.some((l) => l.insumo_id === x.id)),
    [insumos, insumo.id, linhas]
  );

  const custoReceita = linhas.reduce(
    (t, l) => t + (parseFloat(String(l.quantidade).replace(",", ".")) || 0) * l.custo, 0);
  const rend = parseFloat(String(rendimento).replace(",", ".")) || 0;
  const custoUnidade = rend > 0 ? custoReceita / rend : 0;

  const salvar = async () => {
    if (rend <= 0) { setErroLocal("O rendimento precisa ser maior que zero — é ele que divide o custo."); return; }
    setSalvando(true);
    setErroLocal("");
    const filhos = linhas
      .map((l) => ({ insumo_id: l.insumo_id, quantidade: parseFloat(String(l.quantidade).replace(",", ".")) || 0 }))
      .filter((f) => f.quantidade > 0);
    const { error } = await supabase.rpc("gravar_composto", {
      p_insumo: insumo.id, p_rendimento: rend, p_filhos: filhos,
    });
    setSalvando(false);
    if (error) { setErroLocal(error.message); return; }
    onPronto();
  };

  const desfazer = async () => {
    if (!window.confirm(
      `Deixar de calcular o custo de "${insumo.nome}"?\n\n` +
      "O custo volta a ser digitado à mão, e para de acompanhar o preço dos ingredientes."
    )) return;
    setSalvando(true);
    const { error } = await supabase.rpc("desfazer_composto", { p_insumo: insumo.id });
    setSalvando(false);
    if (error) { setErroLocal(error.message); return; }
    onPronto();
  };

  const conferirReal = async () => {
    const [ano, mes] = periodo.split("-").map(Number);
    const ini = `${periodo}-01`;
    const fim = new Date(ano, mes, 0).toISOString().slice(0, 10);
    const { data, error } = await supabase.rpc("rendimento_real", {
      p_composto: insumo.id, p_inicio: ini, p_fim: fim,
    });
    if (error) { setErroLocal(error.message); return; }
    setReal(data || []);
  };

  return (
    <div style={{ width: "100%", marginTop: 10, border: "1px dashed #37A0E5", borderRadius: 10,
                  background: "#FAFCFE", padding: "12px 13px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12, color: "#185FA5", fontWeight: 700 }}>
          Receita de {insumo.nome}
        </div>
        <button onClick={onFechar} style={{ background: "none", border: "none", color: "#8A8778",
                fontSize: 11.5, cursor: "pointer", fontFamily: "inherit" }}>fechar</button>
      </div>

      <div style={{ fontSize: 10.5, color: "#6B685C", marginTop: 5, lineHeight: 1.6 }}>
        Use quando o que <b>entra</b> na cozinha é diferente do que <b>sai</b> dela — laranja em kg
        virando suco em litro. O custo do {insumo.unidade} passa a ser calculado e acompanha o preço
        dos ingredientes sozinho.
      </div>

      {carregando ? (
        <div style={{ fontSize: 12, color: "#8A8778", padding: "10px 0" }}>abrindo…</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 9, alignItems: "flex-end", flexWrap: "wrap", margin: "12px 0" }}>
            <div>
              <label style={{ display: "block", fontSize: 10, color: "#8A8778", marginBottom: 3,
                              textTransform: "uppercase", letterSpacing: 0.2, fontWeight: 700 }}>
                Esta receita rende
              </label>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <input value={rendimento} onChange={(e) => setRendimento(e.target.value)}
                  inputMode="decimal" placeholder="0"
                  style={{ width: 80, padding: "6px 8px", borderRadius: 6, border: "1px solid #37A0E5",
                           fontSize: 13, textAlign: "right", fontFamily: "inherit",
                           fontVariantNumeric: "tabular-nums" }} />
                <span style={{ border: "1px solid #E8E2D2", background: "#F6F1E7", color: "#55534A",
                               borderRadius: 6, padding: "5px 9px", fontSize: 11.5, fontWeight: 700 }}>
                  {insumo.unidade}
                </span>
              </span>
            </div>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={thR}>Ingrediente</th>
                <th style={{ ...thR, textAlign: "right" }}>Custo</th>
                <th style={{ ...thR, textAlign: "right" }}>Quanto entra</th>
                <th style={{ ...thR, textAlign: "right" }}>Total</th>
                <th style={{ ...thR, width: 26 }}></th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, idx) => {
                const q = parseFloat(String(l.quantidade).replace(",", ".")) || 0;
                return (
                  <tr key={l.insumo_id}>
                    <td style={tdR}>
                      <div style={{ fontWeight: 600 }}>{l.nome}</div>
                      <div style={{ fontSize: 10.5, color: "#8A8778" }}>{l.unidade}</div>
                    </td>
                    <td style={{ ...tdR, textAlign: "right", whiteSpace: "nowrap" }}>{brl(l.custo)}</td>
                    <td style={{ ...tdR, textAlign: "right" }}>
                      <input value={l.quantidade} inputMode="decimal"
                        onChange={(e) => setLinhas((prev) => prev.map((x, i) =>
                          i === idx ? { ...x, quantidade: e.target.value } : x))}
                        style={{ width: 78, padding: "5px 7px", borderRadius: 6, border: "1px solid #E8E2D2",
                                 fontSize: 12.5, textAlign: "right", fontFamily: "inherit",
                                 fontVariantNumeric: "tabular-nums" }} />
                    </td>
                    <td style={{ ...tdR, textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>
                      {brl(q * l.custo)}
                    </td>
                    <td style={{ ...tdR, textAlign: "right" }}>
                      <button onClick={() => setLinhas((prev) => prev.filter((_, i) => i !== idx))}
                        style={{ background: "none", border: "none", color: "#A32D2D", cursor: "pointer",
                                 fontSize: 13, fontFamily: "inherit", padding: 0 }}>✕</button>
                    </td>
                  </tr>
                );
              })}
              {linhas.length === 0 && (
                <tr><td colSpan={5} style={{ ...tdR, color: "#8A8778", textAlign: "center" }}>
                  Nenhum ingrediente ainda.
                </td></tr>
              )}
            </tbody>
          </table>

          <div style={{ display: "flex", gap: 7, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
            <select value={escolhido} onChange={(e) => setEscolhido(e.target.value)}
              style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12,
                       fontFamily: "inherit", background: "#FFFFFF", minWidth: 190 }}>
              <option value="">Adicionar ingrediente…</option>
              {candidatos.map((c) => (
                <option key={c.id} value={c.id}>{c.nome} ({c.unidade})</option>
              ))}
            </select>
            <button
              onClick={() => {
                const c = insumos.find((x) => x.id === escolhido);
                if (!c) return;
                setLinhas((prev) => [...prev, {
                  insumo_id: c.id, nome: c.nome, unidade: c.unidade,
                  custo: Number(c.custo_medio_atual) || 0, quantidade: "",
                }]);
                setEscolhido("");
              }}
              disabled={!escolhido}
              style={{ border: "none", borderRadius: 7, padding: "7px 12px", fontSize: 11.5,
                       fontWeight: 700, fontFamily: "inherit",
                       background: escolhido ? "#22231F" : "#E8E2D2",
                       color: escolhido ? "#F3EFE3" : "#A9A395",
                       cursor: escolhido ? "pointer" : "default" }}>
              Adicionar
            </button>
          </div>

          <div style={{ background: "#F6F1E7", border: "1px solid #E3DCCA", borderRadius: 9,
                        padding: "11px 13px", marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "2px 0" }}>
              <span>Custo da receita inteira</span><span>{brl(custoReceita)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, padding: "2px 0" }}>
              <span>Rende</span><span>{rend || 0} {insumo.unidade}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 800,
                          borderTop: "1px solid #E3DCCA", marginTop: 6, paddingTop: 8 }}>
              <span>Custo do {insumo.unidade}</span><span>{brl(custoUnidade)}</span>
            </div>
            <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 7, lineHeight: 1.6 }}>
              Quando um ingrediente subir na nota, este número sobe sozinho — e toda ficha que leva
              {" "}{insumo.nome.toLowerCase()} recalcula junto. Você não digita esse valor em lugar nenhum.
            </div>
          </div>

          {erroLocal && (
            <div style={{ fontSize: 12, color: "#A32D2D", marginTop: 9 }}>{erroLocal}</div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={salvar} disabled={salvando}
              style={{ border: "none", borderRadius: 8, padding: "8px 13px", fontSize: 12, fontWeight: 700,
                       fontFamily: "inherit", background: "#22231F", color: "#F3EFE3", cursor: "pointer" }}>
              {salvando ? "Salvando…" : "Salvar a receita"}
            </button>
            {insumo.composto && (
              <button onClick={desfazer} disabled={salvando}
                style={{ background: "none", border: "none", color: "#8A6A0F", fontSize: 11.5,
                         fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                deixar de ser calculado
              </button>
            )}
          </div>

          {/* -------- o rendimento que aconteceu de verdade -------- */}
          {insumo.composto && (
            <div style={{ marginTop: 14, borderTop: "1px solid #DCE9F5", paddingTop: 11 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 11.5, fontWeight: 700, color: "#185FA5" }}>
                  Rendimento real
                </span>
                <input type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)}
                  style={{ padding: "5px 7px", borderRadius: 6, border: "1px solid #E8E2D2",
                           fontSize: 12, fontFamily: "inherit" }} />
                <button onClick={conferirReal}
                  style={{ border: "1px solid #E8E2D2", background: "#FFFFFF", borderRadius: 7,
                           padding: "6px 11px", fontSize: 11.5, fontWeight: 700, cursor: "pointer",
                           fontFamily: "inherit" }}>
                  Conferir
                </button>
              </div>

              {real && real.length === 0 && (
                <div style={{ fontSize: 11, color: "#8A8778", marginTop: 8 }}>
                  Sem ingredientes na receita ainda.
                </div>
              )}

              {real && real.map((r) => (
                <div key={r.filho} style={{ marginTop: 9, fontSize: 11.5, lineHeight: 1.7, color: "#22231F" }}>
                  {!r.contagens_ok ? (
                    /* Sem duas contagens nao existe "quanto foi consumido" —
                       existe "quanto foi comprado", que e outra coisa. Melhor
                       dizer isso que mostrar um numero que parece medido. */
                    <div style={{ color: "#8A8778" }}>
                      Precisa de <b>duas contagens de estoque fechadas</b> nesse mês para medir o
                      consumo de {r.filho}. Sem uma no começo e outra no fim, dá pra saber quanto
                      foi comprado, mas não quanto foi usado.
                    </div>
                  ) : (
                    <>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Consumido de {r.filho}</span>
                        <span style={{ fontWeight: 700 }}>{Number(r.consumido).toLocaleString("pt-BR")} {r.unidade_filho}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Cadastrado</span>
                        <span>{Number(r.rendimento_fixo)} {insumo.unidade} por receita</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span>Rendeu de verdade</span>
                        <span style={{ fontWeight: 800,
                                       color: r.rendimento_medio == null ? "#8A8778"
                                            : Number(r.rendimento_medio) >= Number(r.rendimento_fixo) ? "#0F6E56" : "#A32D2D" }}>
                          {r.rendimento_medio == null ? "sem venda no período"
                            : `${Number(r.rendimento_medio).toLocaleString("pt-BR")} ${insumo.unidade}`}
                        </span>
                      </div>
                      {r.rendimento_medio != null && (
                        <button
                          onClick={() => setRendimento(String(r.rendimento_medio))}
                          style={{ background: "none", border: "none", color: "#8A6A0F", fontSize: 11,
                                   fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                                   padding: 0, marginTop: 4 }}>
                          usar {Number(r.rendimento_medio).toLocaleString("pt-BR")} como rendimento
                        </button>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

const thR = { textAlign: "left", fontSize: 10, letterSpacing: 0.06, textTransform: "uppercase",
              color: "#8A8778", fontWeight: 700, padding: "0 0 6px" };
const tdR = { padding: "7px 0", borderTop: "1px solid #E7EEF6", verticalAlign: "middle" };

function CalcularPreco({ insumo, onFechar, onSalvo, onErro }) {
  const [pago, setPago] = useState("");
  const [quanto, setQuanto] = useState("");
  const [unidadeNota, setUnidadeNota] = useState(SUB_INS[insumo.unidade] || insumo.unidade);
  const [salvando, setSalvando] = useState(false);

  const n = (v) => parseFloat(String(v ?? "").replace(",", ".")) || 0;
  const emBase = unidadeNota === SUB_INS[insumo.unidade] ? n(quanto) / 1000 : n(quanto);
  const porBase = emBase > 0 ? n(pago) / emBase : 0;
  const opcoes = SUB_INS[insumo.unidade] ? [SUB_INS[insumo.unidade], insumo.unidade] : [insumo.unidade];

  const salvar = async () => {
    if (porBase <= 0) return;
    setSalvando(true);
    const valor = Math.round(porBase * 1e6) / 1e6;
    const { error } = await supabase.from("insumos")
      .update({ custo_medio_atual: valor, atualizado_em: new Date().toISOString() })
      .eq("id", insumo.id);
    setSalvando(false);
    if (error) { onErro(error.message); return; }
    onSalvo(valor);
  };

  return (
    <div style={{ width: "100%", background: "#FCFAF3", border: "1px dashed #DDD5BF", borderRadius: 10, padding: 12, marginTop: 8 }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, marginBottom: 8 }}>Preço de {insumo.nome}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 13, marginBottom: 9 }}>
        <span>Paguei R$</span>
        <input value={pago} onChange={(e) => setPago(e.target.value)} placeholder="28,00" style={campoTU} autoFocus />
        <span>por</span>
        <input value={quanto} onChange={(e) => setQuanto(e.target.value)} placeholder="650" style={campoTU} />
        <select value={unidadeNota} onChange={(e) => setUnidadeNota(e.target.value)}
          style={{ padding: "6px 7px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12.5, background: "#FFFFFF", fontFamily: "inherit" }}>
          {opcoes.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
      </div>
      <div style={{ display: "inline-block", fontSize: 12.5, fontWeight: 800, color: porBase > 0 ? "#0F6E56" : "#8A8778", background: porBase > 0 ? "#DCF0E6" : "#F0EBDD", borderRadius: 8, padding: "8px 10px", marginBottom: 10 }}>
        {porBase > 0 ? `fica ${brlIns(porBase)} /${insumo.unidade}` : "informe quanto pagou e quanto veio"}
      </div>
      <div style={{ display: "flex", gap: 7 }}>
        <button onClick={salvar} disabled={salvando || porBase <= 0}
          style={{ ...btnSecondary, background: porBase > 0 ? "#22231F" : "#F6F1E7", color: porBase > 0 ? "#F3EFE3" : "#B3AC96", borderColor: porBase > 0 ? "#22231F" : "#E8E2D2" }}>
          {salvando ? "Salvando…" : "Usar esse preço"}
        </button>
        <button onClick={onFechar} style={btnSecondary}>Cancelar</button>
      </div>
    </div>
  );
}

const SUB_INS = { kg: "g", l: "ml" };
function brlIns(v) {
  return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 4 });
}
const blocoTU = { background: "#FCFAF3", border: "1px solid #F0EBDD", borderRadius: 9, padding: "11px 12px", marginBottom: 11 };
const rotuloTU = { fontSize: 10, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase", color: "#8A8778", marginBottom: 7 };
const campoTU = { width: 84, padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13, textAlign: "right", fontFamily: "inherit", fontVariantNumeric: "tabular-nums" };
const unTU = { border: "1px solid #E8E2D2", background: "#F6F1E7", color: "#55534A", borderRadius: 6, padding: "6px 9px", fontSize: 11.5, fontWeight: 700 };
const previaTU = { marginTop: 9, fontSize: 12, padding: "9px 10px", borderRadius: 8, background: "#EAF1F7", border: "1px solid #BBD3E4", color: "#2F5772", lineHeight: 1.5 };

function semAcentoIns(t) {
  return String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function SubstituirInsumo({ insumo, insumos, onFechar, onPronto, onErro }) {
  const [fichas, setFichas] = useState(null);
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [destino, setDestino] = useState(null);
  const [qtdNova, setQtdNova] = useState("1");
  const [trabalhando, setTrabalhando] = useState(false);
  const [erroLocal, setErroLocal] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("fichas_do_insumo", { p_insumo: insumo.id });
      if (error) {
        setErroLocal(/does not exist|schema cache/i.test(error.message)
          ? "A substituição ainda não foi instalada no banco — falta rodar a migração 082."
          : error.message);
        setFichas([]);
        return;
      }
      setFichas(data || []);
    })();
  }, [insumo.id]);

  const candidatos = useMemo(() => {
    const termos = semAcentoIns(busca).split(/\s+/).filter(Boolean);
    return insumos
      .filter((i) => i.id !== insumo.id)
      .filter((i) => termos.every((t) => semAcentoIns(i.nome).includes(t)))
      .slice(0, 40);
  }, [insumos, busca, insumo.id]);

  const unidadeMuda = destino && destino.unidade !== insumo.unidade;

  const executar = async (tambemExcluir) => {
    if (!destino) return;
    setTrabalhando(true);
    setErroLocal("");
    const { error } = await supabase.rpc("substituir_insumo_nas_fichas", {
      p_de: insumo.id,
      p_para: destino.id,
      p_quantidade: unidadeMuda ? (parseFloat(String(qtdNova).replace(",", ".")) || 0) : null,
    });
    if (error) { setTrabalhando(false); setErroLocal(error.message); return; }

    if (!tambemExcluir) { setTrabalhando(false); onPronto(false); return; }

    const { error: e2 } = await supabase.from("insumos").delete().eq("id", insumo.id);
    setTrabalhando(false);
    if (e2) { onErro(e2.message); onPronto(false); return; }
    onPronto(true);
  };

  return (
    <div style={{ width: "100%", background: "#FFFFFF", border: "1px solid #C98F87", borderRadius: 11, padding: 13, marginTop: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 9 }}>Excluir "{insumo.nome}"</div>

      {fichas === null ? (
        <div style={{ fontSize: 12.5, color: "#8A8778" }}>Vendo onde ele está…</div>
      ) : (
        <div style={{ background: "#FCFAF3", border: "1px solid #F0EBDD", borderRadius: 8, padding: "9px 11px", marginBottom: 11 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase", color: "#8A8778", marginBottom: 5 }}>
            Está sendo usado em
          </div>
          {fichas.map((f) => (
            <div key={f.prato_id} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12.5, padding: "2px 0" }}>
              <span>{f.prato}</span>
              <span style={{ color: "#8A8778", fontVariantNumeric: "tabular-nums" }}>
                {Number(f.quantidade)} {f.unidade}
                {Number(f.custo) > 0 ? ` · R$ ${Number(f.custo).toFixed(2).replace(".", ",")}` : ""}
              </span>
            </div>
          ))}
          {fichas.length === 0 && <div style={{ fontSize: 12.5, color: "#8A8778" }}>Em nenhuma ficha técnica.</div>}
        </div>
      )}

      <div style={{ fontSize: 12.5, color: "#8A8778", marginBottom: 6 }}>Substituir por qual insumo?</div>
      <div style={{ position: "relative", marginBottom: 10 }}>
        <input value={busca} placeholder="Digite o insumo certo…" autoComplete="off"
          onChange={(e) => { setBusca(e.target.value); setDestino(null); setAberto(true); }}
          onFocus={() => setAberto(true)}
          onBlur={() => setTimeout(() => setAberto(false), 130)}
          style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13.5, fontFamily: "inherit" }} />
        {aberto && (
          <div onMouseDown={(e) => e.preventDefault()}
            style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 4px)", zIndex: 40, background: "#FFFFFF", border: "1px solid #DDD5BF", borderRadius: 8, boxShadow: "0 8px 22px rgba(34,35,31,.14)", maxHeight: 190, overflowY: "auto" }}>
            {candidatos.map((i) => (
              <div key={i.id} onClick={() => { setDestino(i); setBusca(i.nome); setAberto(false); }}
                style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 10px", fontSize: 12.5, cursor: "pointer" }}>
                <span>{i.nome}</span>
                <span style={{ fontSize: 10.5, color: "#8A8778" }}>
                  {Number(i.custo_medio_atual) > 0 ? `R$ ${Number(i.custo_medio_atual).toFixed(2).replace(".", ",")} /${i.unidade}` : `sem custo · ${i.unidade}`}
                </span>
              </div>
            ))}
            {candidatos.length === 0 && <div style={{ padding: "8px 10px", fontSize: 12.5, color: "#8A8778" }}>Nenhum insumo com esse nome.</div>}
          </div>
        )}
      </div>

      {unidadeMuda && (
        <div style={{ background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 8, padding: "10px 11px", fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>
          <strong>Unidades diferentes.</strong> "{insumo.nome}" é <strong>{insumo.unidade}</strong> e "{destino.nome}" é <strong>{destino.unidade}</strong> —
          a quantidade de uma não vira a da outra. Quanto entra em cada ficha?
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 6 }}>
            <input value={qtdNova} onChange={(e) => setQtdNova(e.target.value)}
              style={{ width: 74, padding: "5px 7px", borderRadius: 6, border: "1px solid #C9B98A", fontSize: 12.5, textAlign: "right", fontFamily: "inherit" }} />
            <strong>{destino.unidade}</strong>
          </span>
        </div>
      )}

      {destino && !unidadeMuda && (
        <div style={{ background: "#EAF1F7", border: "1px solid #BBD3E4", color: "#2F5772", borderRadius: 8, padding: "10px 11px", fontSize: 12, lineHeight: 1.5, marginBottom: 10 }}>
          As quantidades continuam as mesmas ({insumo.unidade} → {destino.unidade}). Se "{destino.nome}" já estiver
          em alguma dessas fichas, as duas linhas viram uma e as quantidades somam.
        </div>
      )}

      {erroLocal && <div style={{ fontSize: 12, color: "#A32D2D", marginBottom: 9 }}>{erroLocal}</div>}

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        <button onClick={() => executar(true)} disabled={!destino || trabalhando}
          style={{ ...btnSecondary, background: destino ? "#7A2020" : "#F6F1E7", color: destino ? "#FFFFFF" : "#B3AC96", borderColor: destino ? "#7A2020" : "#E8E2D2" }}>
          {trabalhando ? "Trabalhando…" : "Substituir e excluir"}
        </button>
        <button onClick={() => executar(false)} disabled={!destino || trabalhando}
          style={{ ...btnSecondary, background: destino ? "#22231F" : "#F6F1E7", color: destino ? "#F3EFE3" : "#B3AC96", borderColor: destino ? "#22231F" : "#E8E2D2" }}>
          Só substituir
        </button>
        <button onClick={onFechar} style={btnSecondary}>Cancelar</button>
      </div>
      <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 8, lineHeight: 1.5 }}>
        A troca vale só para as fichas técnicas. Notas fiscais, movimentações de estoque e contagens
        continuam apontando para "{insumo.nome}" — isso é histórico e não se reescreve.
      </div>
    </div>
  );
}

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
const tagSetor = {
  fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6,
  background: "#F1EEE2", color: "#6B6558", whiteSpace: "nowrap",
};
const tagSetorVazio = {
  fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 6,
  background: "#FFFFFF", color: "#B9B2A4", border: "1px dashed #DDD6C6", whiteSpace: "nowrap",
};
const caixaSetor = {
  flexBasis: "100%", marginTop: 8, paddingTop: 10, borderTop: "1px dashed #E8E2D2",
  display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center",
};
const btnSetor = {
  padding: "6px 11px", borderRadius: 8, border: "1px solid #E8E2D2",
  background: "#FFFFFF", color: "#6B6558", fontSize: 12, fontWeight: 600, cursor: "pointer",
  display: "flex", alignItems: "center", gap: 5,
};
const btnSetorOn = { background: "#C72B2E", borderColor: "#C72B2E", color: "#FFFFFF" };
const pill = {
  fontSize: 10.5, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
  textTransform: "uppercase", letterSpacing: 0.3,
};
const selo = {
  fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
  textTransform: "uppercase", letterSpacing: 0.3, whiteSpace: "nowrap",
};
const vazio = {
  display: "flex", alignItems: "center", gap: 8,
  fontSize: 13, color: "#8A8778", padding: "16px 0",
};
