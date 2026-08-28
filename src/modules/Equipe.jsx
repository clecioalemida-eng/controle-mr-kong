// ===== Equipe.jsx =====
import React, { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, Plus, Trash2, Pencil, Check, RefreshCw, AlertTriangle, ChevronLeft, ChevronRight, Eye, EyeOff, Search, Paperclip, Upload, Lock, Receipt, X, Download } from "lucide-react";
import { supabase, extrairErroFuncao } from "../lib/supabaseClient";
import { podeVer } from "../lib/permissoes";
import {
  buscarFiadoNoPeriodo, agruparPorPessoa, carregarBaixas, darBaixa,
  estornarBaixa, somar, diasAtrasISO, normalizaNome,
  carregarApelidos, vincularApelido, desvincularApelido,
  ignorarNome, carregarIgnorados, sugerirPessoa,
} from "../lib/fiado";
import FolhaPagamento from "./FolhaPagamento";
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
// A gerente é paga por percentual do faturamento BRUTO DO DIA (2%, na
// matriz de cargos) mais a diária base do cargo — nunca por rateio da
// taxa de serviço.
//
// O percentual é do DIA, não do mês: noite em que ela não foi escalada
// não gera nada pra ela. São duas gerentes e nunca as duas na mesma
// noite; se um dia aparecerem as duas, a tela avisa, porque quase
// sempre é escala marcada errada.
//
// Diarista recebe na noite. Registrada não recebe na noite — o
// percentual de cada noite trabalhada acumula e sai no fechamento do
// mês, somado ao salário base, igual aos outros registrados.
const PERCENTUAL_GERENTE_PADRAO = 2;
// Peso não é mais digitado à parte — é calculado a partir das horas
// trabalhadas, considerando um turno padrão de 8h (6h trabalhadas =
// peso 0,75, por exemplo). Simplifica pra só uma pergunta em vez de duas
// pra mesma coisa.
const HORAS_PADRAO_TURNO = 8;
const SO_ADMIN = "Só administradores dão baixa em fiado ou lançam pagamento.";
// Turno da casa: 17h às 02h, com 1 hora de intervalo. Abre preenchido
// para TODO MUNDO — registrado e diarista — porque esse é o turno da
// esmagadora maioria das noites. Quem fugiu do padrão, a pessoa corrige
// na linha dela.
//
// Antes só o registrado vinha preenchido e o diarista abria em branco.
// Na prática isso obrigava a digitar 17:00 e 02:00 dezenas de vezes por
// noite — e campo que se digita repetido é campo que um dia fica errado
// ou em branco.
const TURNO_PADRAO = { entrada: "17:00", saida: "02:00" };
const TURNO_REGISTRADO = TURNO_PADRAO;
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
// Cada sub-aba tem sua própria permissão.
//
// Antes era tudo ou nada: `soAdmin` deixava a matriz, o fechamento e a
// folha só pro administrador, e o resto pra qualquer um que abrisse o
// módulo. Não dava pra deixar a gerente montar a escala do dia sem
// mostrar salário — e é exatamente essa a divisão que um restaurante
// precisa fazer.
//
// `perm` tem que bater com as chaves de gente.* em lib/permissoes.js.
const SUBABAS = [
  { chave: "pessoas",   label: "Pessoas",             perm: "gente.pessoas" },
  { chave: "matriz",    label: "Matriz de cargos",    perm: "gente.matriz" },
  { chave: "previsao",  label: "Previsão de escala",  perm: "gente.previsao" },
  { chave: "premiacao", label: "Escala do dia",       perm: "gente.escala" },
  { chave: "mensal",    label: "Fechamento mensal",   perm: "gente.mensal" },
  { chave: "folha",     label: "Folha de pagamento",  perm: "gente.folha" },
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
export default function Equipe({ permissoes }) {
  const isAdmin = useIsAdmin();
  // Administrador continua passando por cima de tudo — é assim no banco
  // (nivel_acesso) e tem que ser assim aqui, senão as duas pontas
  // discordam e alguém fica trancado fora do próprio painel.
  const liberada = (a) => isAdmin || podeVer(permissoes, a.perm);
  const subabasVisiveis = SUBABAS.filter(liberada);

  // Ver valor de gente é decisão separada de gerir gente. A gerente pode
  // precisar cadastrar e escalar sem enxergar salário, CPF ou fiado.
  const verValores = isAdmin || podeVer(permissoes, "gente.salarios");

  const [subaba, setSubaba] = useState("pessoas");
  // Se a primeira aba não é permitida, cai na primeira que for — em vez
  // de mostrar uma tela vazia sem explicar por quê. A dependência é a
  // LISTA de chaves, não o array: o array é novo a cada render e faria
  // o efeito rodar sem parar.
  const chavesVisiveis = subabasVisiveis.map((a) => a.chave).join(",");
  useEffect(() => {
    const lista = chavesVisiveis ? chavesVisiveis.split(",") : [];
    if (lista.length === 0) return;
    if (!lista.includes(subaba)) setSubaba(lista[0]);
  }, [chavesVisiveis, subaba]);

  if (isAdmin === null) return <div style={{ padding: 16, fontSize: 13, color: "#8A8778" }}>Carregando…</div>;

  if (subabasVisiveis.length === 0) {
    return (
      <div style={{ ...cardStyle, fontSize: 13, color: "#8A8778", lineHeight: 1.6 }}>
        Seu cargo não tem acesso a nenhuma parte de Gente e Gestão.
        Peça a quem administra o painel pra liberar em <b>Permissões › Gente e Gestão</b>.
      </div>
    );
  }

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
      {subaba === "pessoas"   && liberada(SUBABAS[0]) && <Pessoas isAdmin={verValores} />}
      {subaba === "matriz"    && liberada(SUBABAS[1]) && <MatrizCargos />}
      {subaba === "previsao"  && liberada(SUBABAS[2]) && <PrevisaoDeEscala />}
      {subaba === "premiacao" && liberada(SUBABAS[3]) && <PremiacaoDoDia isAdmin={verValores} />}
      {subaba === "mensal"    && liberada(SUBABAS[4]) && <FechamentoMensal />}
      {subaba === "folha"     && liberada(SUBABAS[5]) && <FolhaPagamento />}
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
    setLinhas(PAPEIS_COM_GERENTE.map((p) => ({
      papel: p,
      diaria_base: String(mapa[p]?.diaria_base ?? 0),
      valor_hora: String(mapa[p]?.valor_hora ?? 0),
      percentual_faturamento: String(
        mapa[p]?.percentual_faturamento ?? (p === "gerente" ? PERCENTUAL_GERENTE_PADRAO : 0)
      ),
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
        percentual_faturamento: parseFloat(l.percentual_faturamento) || 0,
      }, { onConflict: "papel" });
      if (error) { setErro(error.message); setSalvando(false); return; }
    }
    setSalvando(false);
    setMensagem("Matriz salva.");
  };
  return (
    <div>
      <ComoDivideComissao />
      <div style={{ fontSize: 12, color: "#8A8778", marginBottom: 14 }}>
        Único lugar de editar esses valores por cargo. Diária base é somada à taxa de serviço rateada (método "por taxa de serviço" do diarista); valor da hora é usado no método "por hora". A Escala do dia só mostra esses valores, não edita mais aqui.
        <br />
        A <b>gerente</b> segue outra regra: não entra no rateio da taxa de serviço, e ganha a diária base mais o percentual do faturamento bruto da noite em que trabalhou. Valor hora não se aplica a ela — a gerente não entra na comparação "vale o maior".
      </div>
      {mensagem && <div style={{ ...avisoStyle, background: "#EAF3DE", borderColor: "#97C459", color: "#27500A" }}>{mensagem}</div>}
      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}
      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : (
        <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", marginBottom: 16, background: "#FFFFFF" }}>
          <div style={{ display: "grid", gridTemplateColumns: gradeMatriz, gap: 6, padding: "8px 10px", background: "#F6F1E7", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#8A8778" }}>
            <span>Cargo</span><span>Bolo da comissão</span><span style={{ textAlign: "right" }}>Diária base</span><span style={{ textAlign: "right" }}>% faturamento</span><span style={{ textAlign: "right" }}>Valor hora</span>
          </div>
          {linhas.map((l, idx) => (
            <div key={l.papel} style={{ display: "grid", gridTemplateColumns: gradeMatriz, gap: 6, padding: "9px 10px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", alignItems: "center", background: l.papel === "gerente" ? "#FBFAFE" : "transparent" }}>
              <span style={{ fontSize: 13, color: "#22231F", fontWeight: l.papel === "gerente" ? 700 : 400 }}>{PAPEL_LABEL[l.papel]}</span>
              <span style={l.papel === "gerente" ? seloGerencia : categoriaComissao(l.papel) === "garcom" ? seloGarcom : seloInterna}>
                {l.papel === "gerente"
                  ? `${l.percentual_faturamento || 0}% do faturamento do dia`
                  : categoriaComissao(l.papel) === "garcom" ? "garçons · 50%" : "equipe interna · 50%"}
              </span>
              <input type="number" step="0.01" value={l.diaria_base} onChange={(e) => alterar(l.papel, "diaria_base", e.target.value)}
                style={celulaMatriz} />
              {l.papel === "gerente" ? (
                <input type="number" step="0.01" value={l.percentual_faturamento} onChange={(e) => alterar(l.papel, "percentual_faturamento", e.target.value)}
                  style={celulaMatriz} />
              ) : (
                <span style={celulaVazia}>—</span>
              )}
              {l.papel === "gerente" ? (
                <span style={{ ...celulaVazia, fontSize: 11 }}>não se aplica</span>
              ) : (
                <input type="number" step="0.01" value={l.valor_hora} onChange={(e) => alterar(l.papel, "valor_hora", e.target.value)}
                  style={celulaMatriz} />
              )}
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
  // Nomes que realmente aparecem nos pedidos fiado. Viram sugestão no
  // campo "Nome no fiado", pra ninguém precisar adivinhar como o caixa
  // escreveu. Sai do cache — não custa consulta ao CardápioWeb.
  const [nomesFiado, setNomesFiado] = useState([]);
  const [busca, setBusca] = useState("");
  const [form, setForm] = useState({ nome: "", papel: "garcom", tipo_contrato: "registrado", salario_base: "", pix: "", nome_fiado: "", cpf: "", telefone: "", email: "", data_nascimento: "", documento_path: null, arquivoDocumento: null });
  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.from("pessoas").select("*").order("nome");
    if (error) setErro(error.message);
    setPessoas([...(data || [])].sort(porNome));
    if (isAdmin) {
      const { data: nomes } = await supabase.rpc("nomes_fiado_conhecidos", {
        p_inicio: diasAtrasISO(90),
        p_fim: hoje(),
      });
      setNomesFiado(nomes || []);
    }
    setCarregando(false);
    // `isAdmin` na dependência de propósito: ele começa null (carregando)
    // e só depois vira true. Sem isso o callback congelaria no null e as
    // sugestões de nome nunca chegariam a carregar.
  }, [isAdmin]);
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
    const { data: salvo, error } = editandoId
      ? await supabase.from("pessoas").update(payload).eq("id", editandoId).select("id").single()
      : await supabase.from("pessoas").insert(payload).select("id").single();
    if (error) { setErro(error.message); return; }

    // O campo "Nome no fiado" do formulário é atalho pra tabela de
    // apelidos, que é onde o vínculo mora de verdade — uma pessoa pode ter
    // vários nomes de caixa, e o formulário só edita um.
    const apelido = form.nome_fiado?.trim();
    if (apelido && salvo?.id) {
      const { error: errApelido } = await vincularApelido(apelido, salvo.id);
      if (errApelido) {
        setErro(
          errApelido.code === "23505"
            ? `O nome "${apelido}" já está vinculado a outra pessoa. Desvincule lá antes de usar aqui.`
            : errApelido.message
        );
        return;
      }
    }
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
              {isAdmin && fiadoId === p.id && <FiadoDaPessoa pessoa={p} pessoas={pessoas} isAdmin={isAdmin} />}
              {editandoId === p.id && (
                <FormPessoa form={form} setForm={setForm} onSalvar={salvar} onCancelar={() => setEditandoId(null)} isAdmin={isAdmin} nomesFiado={nomesFiado} pessoas={pessoas} />
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
          <FormPessoa form={form} setForm={setForm} onSalvar={salvar} onCancelar={() => setNovoAberto(false)} isAdmin={isAdmin} nomesFiado={nomesFiado} pessoas={pessoas} />
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

// `souAdmin` entra aqui como segunda tranca. A tela ja esconde tudo de
// quem nao e administrador, e o banco recusa por RLS de qualquer jeito —
// mas se um dia um botao escapar do gate da tela, o erro que aparece e
// uma mensagem clara em vez de um erro cru de permissao do Postgres.
function useFiadoEquipe(pessoas, souAdmin = false) {
  const [inicio, setInicio] = useState(() => diasAtrasISO(60));
  const [fim, setFim] = useState(() => hoje());
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState("");
  const [porPessoa, setPorPessoa] = useState(null); // null = ainda nao buscou
  const [semDono, setSemDono] = useState([]);
  const [baixados, setBaixados] = useState(() => new Map());
  const [naoAbater, setNaoAbater] = useState(() => new Set());
  const [fonte, setFonte] = useState(null); // { doCache, completados, diasFaltando }
  const [semDonoAgrupado, setSemDonoAgrupado] = useState([]);
  const [apelidos, setApelidos] = useState([]);
  // Os lançamentos crus ficam guardados. Vincular um nome não muda o que
  // foi consumido — muda só de quem é. Reagrupar em memória é instantâneo;
  // refazer a busca chamaria o CardápioWeb a cada clique e travaria no
  // limite de 5 consultas por minuto logo no terceiro nome.
  const [lancamentos, setLancamentos] = useState([]);
  const [ignorados, setIgnorados] = useState(() => new Set());

  const reagrupar = (lista, listaApelidos, listaIgnorados) => {
    const { porPessoa: mapa, semDono: sobra, semDonoAgrupado: fila } =
      agruparPorPessoa(lista, pessoas, listaApelidos);
    setPorPessoa(mapa);
    setSemDono(sobra);
    // Nome marcado como cliente de verdade sai da fila, mas o consumo
    // continua na lista geral — nada some do total.
    setSemDonoAgrupado(fila.filter((g) => !listaIgnorados.has(normalizaNome(g.nome))));
  };

  const buscar = async () => {
    setBuscando(true);
    setErro("");
    const { lancamentos: lista, erro: e, doCache, completados, diasFaltando } =
      await buscarFiadoNoPeriodo(inicio, fim);
    if (e) { setErro(e); setBuscando(false); return; }
    setFonte({ doCache, completados: completados || [], diasFaltando: diasFaltando || [] });
    const [listaApelidos, listaIgnorados] = await Promise.all([
      carregarApelidos(),
      carregarIgnorados(),
    ]);
    const baixas = await carregarBaixas(lista.map((l) => l.pedidoId));
    setLancamentos(lista);
    setApelidos(listaApelidos);
    setIgnorados(listaIgnorados);
    setBaixados(baixas);
    reagrupar(lista, listaApelidos, listaIgnorados);
    setBuscando(false);
  };

  const vincular = async (nome, pessoaId) => {
    if (!souAdmin) { setErro(SO_ADMIN); return; }
    setErro("");
    const { error } = await vincularApelido(nome, pessoaId);
    if (error) {
      setErro(
        error.code === "23505"
          ? `"${nome}" já está vinculado a outra pessoa.`
          : error.message
      );
      return;
    }
    const novos = [...apelidos.filter((a) => normalizaNome(a.apelido) !== normalizaNome(nome)),
                   { apelido: nome, pessoa_id: pessoaId }];
    setApelidos(novos);
    reagrupar(lancamentos, novos, ignorados);
  };

  // Desfaz um vínculo. NÃO mexe em dinheiro já acertado: o que foi
  // descontado continua descontado. Só faz o painel parar de reconhecer
  // aquele nome dali pra frente — que é o oposto de estornar.
  const desvincular = async (apelido) => {
    if (!souAdmin) { setErro(SO_ADMIN); return; }
    setErro("");
    const { error } = await desvincularApelido(apelido);
    if (error) { setErro(error.message); return; }
    const novos = apelidos.filter((a) => normalizaNome(a.apelido) !== normalizaNome(apelido));
    setApelidos(novos);
    reagrupar(lancamentos, novos, ignorados);
  };

  const ignorar = async (nome) => {
    if (!souAdmin) { setErro(SO_ADMIN); return; }
    setErro("");
    const { error } = await ignorarNome(nome, "cliente");
    if (error) { setErro(error.message); return; }
    const novos = new Set(ignorados);
    novos.add(normalizaNome(nome));
    setIgnorados(novos);
    reagrupar(lancamentos, apelidos, novos);
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

  // Baixa de UMA pessoa. E o que a tela do dia fechado usa: ali nao existe
  // "Calcular e salvar", o acerto e pessoa por pessoa, na hora de pagar.
  const baixarUm = async (pessoaId, origem, referencia) => {
    if (!souAdmin) { setErro(SO_ADMIN); return { error: { message: SO_ADMIN } }; }
    const abertos = emAbertoDe(pessoaId);
    if (abertos.length === 0) return { error: null };
    const { error } = await darBaixa(pessoaId, abertos, origem, referencia);
    if (error) { setErro(error.message); return { error }; }
    setBaixados((prev) => {
      const novo = new Map(prev);
      abertos.forEach((l) => novo.set(l.pedidoId, { pedido_id: l.pedidoId, pessoa_id: pessoaId, valor: l.valor }));
      return novo;
    });
    return { error: null };
  };

  // Desfaz a baixa dessa pessoa no periodo — o consumo volta pra "em aberto".
  const estornarDe = async (pessoaId) => {
    if (!souAdmin) { setErro(SO_ADMIN); return; }
    const jaBaixados = (porPessoa?.[pessoaId] || []).filter((l) => baixados.has(l.pedidoId));
    if (jaBaixados.length === 0) return;
    const { error } = await estornarBaixa(jaBaixados.map((l) => l.pedidoId));
    if (error) { setErro(error.message); return; }
    setBaixados((prev) => {
      const novo = new Map(prev);
      jaBaixados.forEach((l) => novo.delete(l.pedidoId));
      return novo;
    });
  };

  const baixadoDe = (pessoaId) =>
    (porPessoa?.[pessoaId] || []).filter((l) => baixados.has(l.pedidoId));

  // Grava as baixas de todo mundo que esta marcado pra abater.
  const baixarTodos = async (origem, referencia) => {
    if (!souAdmin) return { error: null };
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
    buscou: porPessoa !== null, porPessoa, semDono, baixados, fonte,
    semDonoAgrupado, apelidos, vincular, desvincular, ignorar, lancamentos,
    emAbertoDe, saldoDe, vaiAbater, alternarAbater, descontoDe, baixarTodos,
    baixarUm, estornarDe, baixadoDe,
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
          {aviso} Sai do cache do painel, entao e instantanea. So o dia de
          hoje, que o cron ainda nao sincronizou, e completado no
          CardapioWeb na hora.
        </div>
      )}
      {fiado.buscou && fiado.fonte && (
        <div style={{ fontSize: 11, color: "#8A8778", marginTop: 8 }}>
          {fiado.fonte.doCache} lancamento(s) vieram do cache do painel
          {fiado.fonte.completados.length > 0
            ? ` e ${fiado.fonte.completados.length} dia(s) ainda nao sincronizado(s) foram buscados no CardapioWeb agora.`
            : "."}
          {fiado.fonte.diasFaltando.length > 0 && fiado.fonte.completados.length === 0 && (
            <span style={{ color: "#854F0B" }}>
              {" "}Nao consegui completar os {fiado.fonte.diasFaltando.length} dia(s) mais
              recentes no CardapioWeb — o consumo de hoje pode estar de fora.
            </span>
          )}
        </div>
      )}

    </div>
  );
}

// A fila de "falta vincular": todo nome que aparece no fiado e ainda nao
// pertence a ninguem da equipe. Enquanto nada estiver vinculado, e aqui
// que voce enxerga o fiado inteiro — nada fica escondido.
//
// O palpite de dono e so palpite: quem confirma e voce. Casar "Ana"
// sozinho poderia cobrar da Ana Paula o que era da Janayna, e o erro so
// apareceria no dia em que alguem reclamasse do acerto.
// Nomes que o painel já sabe de quem são.
//
// Até 26/08/2026 essa lista não existia em lugar nenhum: a função de
// apagar um vínculo estava escrita e importada, mas nenhum botão chamava
// ela. Vinculou, ficou — e não dava nem pra ver o que estava vinculado.
//
// Desfazer aqui NÃO estorna nada. O que já foi descontado continua
// descontado; o painel só para de reconhecer aquele nome daqui pra
// frente. Estornar consumo é outra coisa, e fica em outro lugar de
// propósito.
function NomesVinculados({ fiado, pessoas }) {
  const [aberto, setAberto] = useState(false);
  const [apagando, setApagando] = useState(null);
  const lista = fiado.apelidos || [];
  if (!fiado.buscou || lista.length === 0) return null;

  const nomeDaPessoa = (id) => pessoas.find((p) => p.id === id)?.nome || "(pessoa removida)";
  const umaPalavra = (t) => normalizaNome(t).split(" ").filter(Boolean).length < 2;
  const soltos = lista.filter((a) => umaPalavra(a.apelido)).length;

  return (
    <div style={{ ...cardStyle, padding: 0, marginBottom: 12 }}>
      <button onClick={() => setAberto((v) => !v)}
        style={{ width: "100%", textAlign: "left", background: "none", border: "none",
                 padding: "11px 12px", cursor: "pointer" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#22231F" }}>
          Nomes já vinculados ({lista.length}) {aberto ? "‹" : "›"}
        </div>
        <div style={{ fontSize: 11, color: soltos > 0 ? "#8A6A0F" : "#8A8778", marginTop: 2 }}>
          {soltos > 0
            ? `${soltos} ${soltos === 1 ? "é" : "são"} de um nome só — ${soltos === 1 ? "esse pega" : "esses pegam"} consumo de homônimo`
            : "Cada linha é um nome que o caixa escreve e o painel já sabe de quem é."}
        </div>
      </button>
      {aberto && (
        <div>
          {[...lista].sort((a, b) => String(a.apelido).localeCompare(String(b.apelido), "pt-BR")).map((a, idx) => (
            <div key={a.apelido} style={{ display: "flex", alignItems: "center", gap: 10,
                                          padding: "9px 12px", borderTop: "1px solid #F0EBDD" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {a.apelido}
                  {umaPalavra(a.apelido) && (
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase",
                                   padding: "2px 7px", borderRadius: 999, background: "#FBF0D5", color: "#8A6A0F" }}>
                      só primeiro nome
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 1 }}>
                  → {nomeDaPessoa(a.pessoa_id)}
                </div>
              </div>
              <button onClick={async () => {
                if (!window.confirm(
                  `Desfazer o vínculo de "${a.apelido}"?\n\n` +
                  "O painel para de reconhecer esse nome daqui pra frente.\n\n" +
                  "Nada do que já foi descontado volta atrás."
                )) return;
                setApagando(a.apelido);
                await fiado.desvincular(a.apelido);
                setApagando(null);
              }} disabled={apagando === a.apelido} style={{ ...linkBtn, fontSize: 11 }}>
                {apagando === a.apelido ? "..." : "desfazer"}
              </button>
            </div>
          ))}
          <div style={{ padding: "9px 12px", borderTop: "1px solid #F0EBDD", fontSize: 10.5, color: "#8A8778", lineHeight: 1.55 }}>
            Desfazer não estorna nada — o que já foi descontado continua descontado. Só faz o painel
            parar de reconhecer aquele nome nos próximos consumos.
          </div>
        </div>
      )}
    </div>
  );
}

// O que ainda falta corrigir no CardápioWeb.
//
// A API deles não permite editar cliente: em Clientes só existe leitura
// (listar e buscar). Então o painel não corrige lá sozinho — ele guarda
// a dívida, mostra os dois nomes lado a lado, dá o botão de copiar e o
// caminho pra tela deles.
//
// Uma linha sai da lista de dois jeitos: sozinha, quando chega um pedido
// já com o nome novo escrito, ou na mão, no "já corrigi" — pro caso do
// cliente demorar a voltar.
const PORTAL_CARDAPIOWEB = "https://portal.cardapioweb.com";
const DIAS_ATE_COBRAR = 15;

function CorrigirNoCardapioWeb({ fiado, recarregar }) {
  const [pendentes, setPendentes] = useState([]);
  const [marcando, setMarcando] = useState(null);
  const [copiado, setCopiado] = useState(null);
  const [erro, setErro] = useState("");

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from("correcoes_cardapioweb")
      .select("id, nome_antigo, nome_novo, criado_em, pessoa:pessoas(nome)")
      .is("resolvido_em", null)
      .order("criado_em", { ascending: true });
    if (error) { setErro(error.message); return; }
    setPendentes(data || []);
  }, []);

  useEffect(() => { carregar(); }, [carregar, recarregar]);

  const resolver = useCallback(async (id, como) => {
    const { data: usuario } = await supabase.auth.getUser();
    await supabase.from("correcoes_cardapioweb").update({
      resolvido_em: new Date().toISOString(),
      resolvido_por: usuario?.user?.id || null,
      resolvido_como: como,
    }).eq("id", id);
  }, []);

  // Fecha sozinha o que já foi corrigido lá: se algum pedido do período
  // veio com o nome novo escrito, a dívida acabou.
  useEffect(() => {
    if (pendentes.length === 0) return;
    const nomesVistos = new Set(
      (fiado.lancamentos || [])
        .map((l) => normalizaNome(l.nomeCliente || ""))
        .filter(Boolean)
    );
    if (nomesVistos.size === 0) return;
    const resolvidas = pendentes.filter((c) => nomesVistos.has(normalizaNome(c.nome_novo)));
    if (resolvidas.length === 0) return;
    let vivo = true;
    (async () => {
      for (const c of resolvidas) await resolver(c.id, "pedido");
      if (vivo) carregar();
    })();
    return () => { vivo = false; };
  }, [pendentes, fiado.lancamentos, resolver, carregar]);

  const marcarFeito = async (c) => {
    setMarcando(c.id);
    await resolver(c.id, "manual");
    setMarcando(null);
    carregar();
  };

  const copiar = async (c) => {
    try {
      await navigator.clipboard.writeText(c.nome_novo);
      setCopiado(c.id);
      setTimeout(() => setCopiado(null), 2000);
    } catch {
      setErro("O navegador não deixou copiar. Selecione o nome e copie na mão.");
    }
  };

  if (pendentes.length === 0) return null;

  const diasDe = (iso) => Math.floor((Date.now() - Date.parse(iso)) / 86400000);

  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #9FB6CE", borderRadius: 12,
                  overflow: "hidden", marginBottom: 12 }}>
      <div style={{ padding: "11px 12px", background: "#F2F6FA", borderBottom: "1px solid #DCE6F0" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#22231F" }}>
          Corrigir no CardápioWeb ({pendentes.length})
        </div>
        <div style={{ fontSize: 11, color: "#8A8778", marginTop: 2, lineHeight: 1.55 }}>
          Você corrigiu esses nomes aqui. Lá eles continuam como estavam — e o próximo pedido vai
          chegar errado de novo.
        </div>
      </div>

      {erro && (
        <div style={{ ...avisoStyle, margin: 10 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5 }}>{erro}</div>
        </div>
      )}

      {pendentes.map((c, idx) => {
        const dias = diasDe(c.criado_em);
        return (
          <div key={c.id} style={{ padding: "11px 12px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", fontSize: 12.5 }}>
              <span style={rotuloMini}>lá está</span>
              <b style={{ color: "#8A6A0F" }}>{c.nome_antigo}</b>
              <span style={{ color: "#8A8778" }}>→</span>
              <span style={rotuloMini}>deveria ser</span>
              <b style={{ color: "#0F6E56" }}>{c.nome_novo}</b>
            </div>
            <div style={{ fontSize: 10.5, color: dias >= DIAS_ATE_COBRAR ? "#A32D2D" : "#8A8778", marginTop: 5 }}>
              corrigido aqui em {new Date(c.criado_em).toLocaleDateString("pt-BR")}
              {c.pessoa?.nome ? ` · vinculado a ${c.pessoa.nome}` : ""}
              {dias >= DIAS_ATE_COBRAR ? ` · esperando há ${dias} dias` : ""}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 9 }}>
              <button onClick={() => copiar(c)} style={botaoOpcao}>
                {copiado === c.id ? "copiado ✓" : `Copiar "${c.nome_novo}"`}
              </button>
              <a href={PORTAL_CARDAPIOWEB} target="_blank" rel="noreferrer"
                 style={{ ...botaoOpcaoAtiva, textDecoration: "none", display: "inline-block" }}>
                Abrir clientes no CardápioWeb ↗
              </a>
              <button onClick={() => marcarFeito(c)} disabled={marcando === c.id}
                style={{ ...linkBtn, fontSize: 11 }}>
                {marcando === c.id ? "..." : "já corrigi"}
              </button>
            </div>
          </div>
        );
      })}

      <div style={{ padding: "9px 12px", borderTop: "1px solid #F0EBDD", fontSize: 10.5,
                    color: "#8A8778", lineHeight: 1.55 }}>
        A linha some sozinha quando chegar um pedido com o nome novo escrito. O "já corrigi" é pro caso
        do cliente demorar a voltar.
      </div>
    </div>
  );
}

function PainelSemDono({ fiado, pessoas, aoMudarPessoas, aoMudarCorrecoes }) {
  const [aberto, setAberto] = useState({});
  const [escolha, setEscolha] = useState({});
  const [salvando, setSalvando] = useState(null);
  const [feitos, setFeitos] = useState([]);
  const [aviso, setAviso] = useState("");
  // Correção do nome antes de vincular. `modo` diz qual caminho está
  // aberto em cada linha: "fiado" (o nome que o caixa escreve) ou
  // "cadastro" (o nome da pessoa). null = nenhum aberto.
  const [modo, setModo] = useState({});
  const [textoFiado, setTextoFiado] = useState({});
  const [textoCadastro, setTextoCadastro] = useState({});
  const [salvandoNome, setSalvandoNome] = useState(null);
  const [nomesCorrigidos, setNomesCorrigidos] = useState({}); // pessoaId -> nome novo
  // Chaves "pessoaId|AAAA-MM-DD" de quem estava na escala. Serve pra
  // apontar consumo de dia em que a pessoa não trabalhou — que pode ser
  // consumo dela como cliente, ou consumo de um homônimo.
  const [naEscala, setNaEscala] = useState(null);
  const fila = fiado.semDonoAgrupado || [];

  const diasDaFila = React.useMemo(() => {
    const dias = new Set();
    fila.forEach((g) => g.lancamentos.forEach((l) => {
      if (l.data) dias.add(String(l.data).slice(0, 10));
    }));
    return [...dias].sort();
  }, [fila]);

  useEffect(() => {
    if (diasDaFila.length === 0) { setNaEscala(new Set()); return; }
    let vivo = true;
    (async () => {
      const { data } = await supabase
        .from("presencas_diarias").select("pessoa_id, dia").in("dia", diasDaFila);
      if (vivo) setNaEscala(new Set((data || []).map((r) => `${r.pessoa_id}|${r.dia}`)));
    })();
    return () => { vivo = false; };
  }, [diasDaFila.join(",")]);

  const nomeDe = (p) => nomesCorrigidos[p.id] || p.nome;
  // Nome de uma palavra só é o que pega consumo de homônimo: uma vez
  // vinculado, TODO "Janayna" escrito no caixa cai na mesma pessoa.
  const umaPalavraSo = (t) => normalizaNome(t).split(" ").filter(Boolean).length < 2;

  // Some quando a fila zera E não há nada recém-feito pra mostrar —
  // senão o painel evaporava no último clique sem dizer o que aconteceu.
  if (!fiado.buscou || (fila.length === 0 && feitos.length === 0)) return null;
  const totalPendente = fila.reduce((s, g) => s + g.total, 0);

  // Recebe o id efetivamente selecionado (o palpite conta como seleção),
  // não o que estava guardado em `escolha`.
  // `apelido` é o texto que fica guardado — por padrão o nome que veio do
  // caixa, ou o corrigido, quando a pessoa mexeu nele.
  // Registra que o nome ainda precisa ser corrigido no CardápioWeb.
  //
  // A API deles não deixa editar cliente — em Clientes só existe leitura.
  // Então a correção lá é na mão, e o painel guarda a dívida pra cobrar
  // depois. Sem isso, o próximo pedido chega com o nome errado de novo e
  // ninguém lembra por quê.
  const registrarCorrecao = async (nomeAntigo, nomeNovo, pessoaId) => {
    const de = String(nomeAntigo || "").trim();
    const para = String(nomeNovo || "").trim();
    if (!de || !para || normalizaNome(de) === normalizaNome(para)) return;
    const { data: usuario } = await supabase.auth.getUser();
    // Se já existe pendência pro mesmo nome, o índice único barra — e
    // isso é o certo: uma dívida por nome, não uma por clique.
    await supabase.from("correcoes_cardapioweb").insert({
      nome_antigo: de,
      nome_novo: para,
      pessoa_id: pessoaId || null,
      criado_por: usuario?.user?.id || null,
    });
    if (aoMudarCorrecoes) aoMudarCorrecoes();
  };

  const confirmar = async (nome, pessoaId, apelido) => {
    if (!pessoaId) { setAviso("Escolha a pessoa na lista antes de vincular."); return; }
    setAviso("");
    setSalvando(nome);
    const pessoa = pessoas.find((p) => p.id === pessoaId);
    const grupo = fila.find((g) => g.nome === nome);
    await fiado.vincular(String(apelido || nome).trim(), pessoaId);
    await registrarCorrecao(nome, apelido, pessoaId);
    setSalvando(null);
    // A linha some da fila na hora, então a confirmação precisa viver
    // fora dela — senão o clique parece não ter feito nada.
    // Se o texto salvo não bate com o do pedido, o vínculo vale pro
    // futuro mas este consumo continua sem dono. Dizer "foi pro acerto"
    // nesse caso seria mentira.
    const pegouEste = normalizaNome(String(apelido || nome)) === normalizaNome(nome);
    setFeitos((f) => [
      { nome: String(apelido || nome).trim(), pessoa: pessoa?.nome || "",
        valor: grupo?.total || 0, tipo: pegouEste ? "vinculado" : "vinculado_futuro" },
      ...f,
    ].slice(0, 6));
  };

  // Corrige o nome da PESSOA. É a mesma coluna que a aba Pessoas edita —
  // aqui é só um atalho, pra não ter que sair do acerto e perder o que já
  // estava marcado na tela. O histórico não muda de lugar: é a mesma
  // pessoa, com o nome escrito direito.
  const salvarNomeCadastro = async (chave, pessoaId, nomeNovo) => {
    const limpo = String(nomeNovo || "").trim();
    if (!limpo) { setAviso("O nome não pode ficar em branco."); return; }
    setAviso("");
    setSalvandoNome(chave);
    const { error } = await supabase.from("pessoas").update({ nome: limpo }).eq("id", pessoaId);
    setSalvandoNome(null);
    if (error) { setAviso(error.message); return; }
    setNomesCorrigidos((m) => ({ ...m, [pessoaId]: limpo }));
    setModo((m) => ({ ...m, [chave]: null }));
    // O CardápioWeb continua com o nome curto do pedido — a dívida nasce
    // aqui também, não só quando se corrige pelo lado do fiado.
    await registrarCorrecao(chave, limpo, pessoaId);
    if (aoMudarPessoas) aoMudarPessoas();
  };

  const marcarCliente = async (nome) => {
    setAviso("");
    setSalvando(nome);
    const grupo = fila.find((g) => g.nome === nome);
    await fiado.ignorar(nome);
    setSalvando(null);
    setFeitos((f) => [
      { nome, pessoa: "", valor: grupo?.total || 0, tipo: "cliente" },
      ...f,
    ].slice(0, 6));
  };

  return (
    <div style={{ ...cardStyle, padding: 12, marginBottom: 12, borderColor: "#E8A33D" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#22231F", flex: 1, minWidth: 150 }}>
          {fila.length} nome(s) no fiado ainda sem dono
        </span>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#A32D2D" }}>{brl(totalPendente)}</span>
      </div>
      {fila.length > 0 && (
        <div style={{ fontSize: 11.5, color: "#8A8778", lineHeight: 1.6, marginBottom: 10 }}>
          Esse consumo existe, mas o painel ainda não sabe de quem é — então
          não entra em acerto nenhum. Vincule cada nome à pessoa certa, ou
          marque como cliente. Depois de vinculado, o painel reconhece sozinho.
        </div>
      )}

      {aviso && (
        <div style={{ ...avisoStyle, marginBottom: 10 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5 }}>{aviso}</div>
        </div>
      )}

      {feitos.length > 0 && (
        <div style={{
          background: "#EAF3DE", border: "1px solid #C4DBA6", borderRadius: 10,
          padding: "9px 11px", marginBottom: 10,
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: 0.4, color: "#27500A", marginBottom: 5 }}>
            {feitos.length} resolvido(s) agora
          </div>
          {feitos.map((f, k) => (
            <div key={`${f.nome}-${k}`} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#27500A", padding: "2px 0", flexWrap: "wrap" }}>
              <Check size={13} style={{ flexShrink: 0 }} />
              <b>{f.nome}</b>
              {f.tipo === "vinculado" ? (
                <>
                  <span style={{ color: "#8A8778" }}>→</span>
                  <span>{f.pessoa}</span>
                  <span style={{ color: "#8A8778" }}>· {brl(f.valor)} foram para o acerto</span>
                </>
              ) : f.tipo === "vinculado_futuro" ? (
                <>
                  <span style={{ color: "#8A8778" }}>→</span>
                  <span>{f.pessoa}</span>
                  <span style={{ color: "#8A6A0F" }}>
                    · vale do próximo consumo em diante · {brl(f.valor)} continuam sem dono
                  </span>
                </>
              ) : (
                <span style={{ color: "#8A8778" }}>marcado como cliente · {brl(f.valor)} fora do acerto</span>
              )}
            </div>
          ))}
          {fila.length === 0 && (
            <div style={{ fontSize: 11.5, color: "#27500A", marginTop: 6, paddingTop: 6, borderTop: "1px solid #C4DBA6" }}>
              Fila zerada. Da próxima vez esses nomes já vão direto para a
              pessoa certa, sem passar por aqui.
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {fila.map((g) => {
          const { candidatos } = sugerirPessoa(g.nome, pessoas, fiado.apelidos);
          const sugerido = candidatos[0];
          const valorSelect = escolha[g.nome] ?? (sugerido ? sugerido.pessoa.id : "");
          const pessoaSel = pessoas.find((p) => p.id === valorSelect) || null;
          // O texto que vai ficar guardado. Começa igual ao que o caixa
          // escreveu; a pessoa pode corrigir antes de vincular.
          const apelido = textoFiado[g.nome] ?? g.nome;
          const nomeAmbiguo = umaPalavraSo(apelido);
          // O apelido só reconhece ESTE consumo se continuar batendo com
          // o texto do pedido. Corrigir pra um nome que o caixa não usa
          // resolve o futuro e deixa este aqui pendente — e isso precisa
          // aparecer antes do clique, não no acerto.
          const aindaBate = normalizaNome(apelido) === normalizaNome(g.nome);
          const foraDaEscala = (pessoaSel && naEscala)
            ? g.lancamentos.filter((l) => l.data && !naEscala.has(`${pessoaSel.id}|${String(l.data).slice(0, 10)}`))
            : [];
          const precisaCorrigir = !!pessoaSel && nomeAmbiguo;
          const modoAtual = modo[g.nome] || null;
          return (
            <div key={g.nome} style={{ border: "1px solid #E8E2D2", borderRadius: 10, padding: "9px 11px", background: "#FFFFFF" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 130 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#22231F" }}>{g.nome}</div>
                  <button onClick={() => setAberto((a) => ({ ...a, [g.nome]: !a[g.nome] }))} style={{ ...linkBtn, fontSize: 10.5, padding: 0 }}>
                    {g.lancamentos.length} pedido(s) · ver {aberto[g.nome] ? "menos" : "quais"}
                  </button>
                </div>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#A32D2D", fontVariantNumeric: "tabular-nums" }}>
                  {brl(g.total)}
                </span>
              </div>

              {aberto[g.nome] && (
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px dashed #E8E2D2" }}>
                  {g.lancamentos.map((l) => (
                    <div key={l.pedidoId} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "2px 0",
                      color: foraDaEscala.some((f) => f.pedidoId === l.pedidoId) ? "#8A6A0F" : "#8A8778",
                      fontWeight: foraDaEscala.some((f) => f.pedidoId === l.pedidoId) ? 600 : 400 }}>
                      <span>
                        #{l.displayId} · {new Date(l.data).toLocaleDateString("pt-BR")}
                        {foraDaEscala.some((f) => f.pedidoId === l.pedidoId) ? " · fora da escala dela" : ""}
                      </span>
                      <span>{brl(l.valor)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                <select
                  value={valorSelect}
                  onChange={(e) => setEscolha((x) => ({ ...x, [g.nome]: e.target.value }))}
                  style={{ ...inputStyle, flex: 1, minWidth: 160, padding: "7px 8px", fontSize: 12 }}
                >
                  <option value="">Vincular a…</option>
                  {pessoas.map((p) => (
                    <option key={p.id} value={p.id}>{p.nome}</option>
                  ))}
                </select>
                <button onClick={() => confirmar(g.nome, valorSelect, apelido)}
                  disabled={!valorSelect || salvando === g.nome || precisaCorrigir}
                  title={precisaCorrigir ? "Corrija o nome antes de vincular" : ""}
                  style={{ ...btnPrimary, padding: "7px 12px", fontSize: 12, borderRadius: 8,
                           background: precisaCorrigir ? "#B9B3A4" : btnPrimary.background,
                           cursor: precisaCorrigir ? "not-allowed" : "pointer" }}>
                  {salvando === g.nome ? "..." : "Vincular"}
                </button>
                <button onClick={() => marcarCliente(g.nome)} disabled={salvando === g.nome}
                  style={{ ...linkBtn, fontSize: 11 }}>
                  é cliente
                </button>
              </div>

              {sugerido && escolha[g.nome] === undefined && (
                <div style={{ fontSize: 10.5, color: "#0F6E56", marginTop: 5 }}>
                  Palpite: <b>{sugerido.pessoa.nome}</b> — {sugerido.motivo}
                  {candidatos.length > 1 ? ` (e mais ${candidatos.length - 1} possível(is), confira antes)` : ""}
                </div>
              )}
              {!sugerido && !escolha[g.nome] && (
                <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 5 }}>
                  Nao achei ninguem parecido — escolha na lista ou marque como cliente.
                </div>
              )}

              {pessoaSel && (nomeAmbiguo || foraDaEscala.length > 0) && (
                <div style={{ border: "1px solid #E8D48A", background: "#FBF3D9", borderRadius: 9,
                              padding: "9px 11px", marginTop: 8, fontSize: 11.5, color: "#7A6A1E", lineHeight: 1.6 }}>
                  {nomeAmbiguo && (
                    <div>
                      <b style={{ color: "#5E5216" }}>"{apelido}" é só um primeiro nome — corrija antes de vincular.</b>{" "}
                      Do jeito que está, todo consumo escrito assim no caixa passa a cair
                      em {nomeDe(pessoaSel)} pra sempre, sem passar por aqui. Se existir uma cliente
                      com o mesmo nome, o consumo dela vira desconto no pagamento da funcionária.
                    </div>
                  )}
                  {foraDaEscala.length > 0 && (
                    <div style={{ marginTop: nomeAmbiguo ? 6 : 0, paddingTop: nomeAmbiguo ? 6 : 0,
                                  borderTop: nomeAmbiguo ? "1px solid #E8D48A" : "none" }}>
                      <b style={{ color: "#5E5216" }}>
                        {foraDaEscala.length === 1
                          ? `No pedido de ${new Date(foraDaEscala[0].data).toLocaleDateString("pt-BR")} ela não estava na escala.`
                          : `Em ${foraDaEscala.length} pedidos ela não estava na escala.`}
                      </b>{" "}
                      Pode ser consumo dela como cliente, e aí está certo. Só não dá pra assumir isso sozinho.
                    </div>
                  )}
                </div>
              )}

              {pessoaSel && nomeAmbiguo && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed #E8E2D2" }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, marginBottom: 6 }}>Onde está o nome errado?</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                    <button onClick={() => {
                      setModo((m) => ({ ...m, [g.nome]: m[g.nome] === "cadastro" ? null : "cadastro" }));
                      setTextoCadastro((t) => ({ ...t, [g.nome]: t[g.nome] ?? nomeDe(pessoaSel) }));
                    }} style={modoAtual === "cadastro" ? botaoOpcaoAtiva : botaoOpcao}>
                      No cadastro dela
                    </button>
                    <button onClick={() => {
                      setModo((m) => ({ ...m, [g.nome]: m[g.nome] === "fiado" ? null : "fiado" }));
                      setTextoFiado((t) => ({ ...t, [g.nome]: t[g.nome] ?? g.nome }));
                    }} style={modoAtual === "fiado" ? botaoOpcaoAtiva : botaoOpcao}>
                      No fiado
                    </button>
                    <button onClick={() => confirmar(g.nome, valorSelect, apelido)} disabled={salvando === g.nome}
                      style={{ ...linkBtn, fontSize: 11 }}>
                      vincular assim mesmo
                    </button>
                  </div>

                  {modoAtual === "fiado" && (
                    <div style={{ marginTop: 9, background: "#FBFAF6", border: "1px solid #E8E2D2", borderRadius: 9, padding: "9px 11px" }}>
                      <div style={{ fontSize: 10.5, color: "#8A8778", lineHeight: 1.5 }}>
                        Nome que o caixa escreve — é ele que o painel vai reconhecer
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                        <input value={apelido}
                          onChange={(e) => setTextoFiado((t) => ({ ...t, [g.nome]: e.target.value }))}
                          style={{ ...inputStyle, flex: 1, minWidth: 170, padding: "7px 9px", fontSize: 12.5 }} />
                        <button onClick={() => confirmar(g.nome, valorSelect, apelido)}
                          disabled={salvando === g.nome || umaPalavraSo(apelido)}
                          style={{ ...btnPrimary, padding: "7px 12px", fontSize: 12, borderRadius: 8 }}>
                          Salvar e vincular
                        </button>
                      </div>
                      {aindaBate ? (
                        <div style={{ fontSize: 11, color: "#0F6E56", marginTop: 7, lineHeight: 1.5 }}>
                          ✓ Com esse nome, o consumo de {brl(g.total)} continua sendo reconhecido como dela.
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: "#8A6A0F", marginTop: 7, lineHeight: 1.55 }}>
                          ⚠ Esse nome não bate com o que está no pedido ("{g.nome}"). O vínculo fica salvo
                          pro futuro, mas <b>este consumo de {brl(g.total)} continua sem dono</b> — e fora
                          de qualquer acerto.
                        </div>
                      )}
                    </div>
                  )}

                  {modoAtual === "cadastro" && (
                    <div style={{ marginTop: 9, background: "#FBFAF6", border: "1px solid #E8E2D2", borderRadius: 9, padding: "9px 11px" }}>
                      <div style={{ fontSize: 10.5, color: "#8A8778", lineHeight: 1.5 }}>
                        Nome da pessoa no cadastro — use quando ele está abreviado, sem sobrenome ou com erro de digitação
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                        <input value={textoCadastro[g.nome] ?? nomeDe(pessoaSel)}
                          onChange={(e) => setTextoCadastro((t) => ({ ...t, [g.nome]: e.target.value }))}
                          style={{ ...inputStyle, flex: 1, minWidth: 170, padding: "7px 9px", fontSize: 12.5 }} />
                        <button onClick={() => salvarNomeCadastro(g.nome, pessoaSel.id, textoCadastro[g.nome] ?? nomeDe(pessoaSel))}
                          disabled={salvandoNome === g.nome}
                          style={{ ...btnPrimary, padding: "7px 12px", fontSize: 12, borderRadius: 8 }}>
                          {salvandoNome === g.nome ? "..." : "Salvar no cadastro"}
                        </button>
                      </div>
                      <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 7, lineHeight: 1.5 }}>
                        Muda o nome dela em Gente e Gestão &gt; Pessoas, daqui mesmo. O histórico não muda
                        de lugar — é a mesma pessoa, com o nome escrito direito.
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Pagamento das diarias da noite.
//
// So diarista entra: registrado recebe no fechamento do mes, mesmo tendo
// comissao calculada todo dia. Misturar os dois pagaria o registrado
// duas vezes.
//
// A gerente DIARISTA entra aqui desde 26/08/2026: ela recebe na noite,
// igual aos outros diaristas (diaria base + percentual do faturamento do
// dia). A gerente REGISTRADA continua fora — o percentual das noites
// dela acumula pro fechamento do mes.
//
// Um lancamento por noite, na conta 4.2 (Diarias), ja quitado — porque o
// diarista e pago na saida, nao vira conta a pagar. E dai que o DRE passa
// a enxergar o custo de pessoal que faltava.
function PagamentoDasDiarias({ dia, linhasSalvas, fiado, pagamento, aoMudar, setErro }) {
  const [gravando, setGravando] = useState(false);
  const [desfazendo, setDesfazendo] = useState(false);

  const diaristas = linhasSalvas.filter((l) => l.pessoa?.tipo_contrato === "diarista");
  const bruto = diaristas.reduce((s2, l) => s2 + (Number(l.total_dia) || 0), 0);
  const fiadoAberto = fiado.buscou
    ? diaristas.reduce((s2, l) => s2 + fiado.saldoDe(l.pessoa_id), 0)
    : 0;
  const liquido = Math.max(0, bruto - fiadoAberto);

  if (pagamento) {
    const desfazer = async () => {
      setDesfazendo(true);
      setErro("");
      // Ordem importa: tira o registro do dia primeiro, pra nunca sobrar
      // "pago" apontando pra uma conta que ja nao existe.
      await supabase.from("pagamentos_diaria").delete().eq("dia", dia);
      if (pagamento.conta_pagar_id) {
        await supabase.from("contas_pagar").delete().eq("id", pagamento.conta_pagar_id);
      }
      // O fiado descontado nesse pagamento volta a ficar em aberto.
      const { data: baixas } = await supabase
        .from("fiado_baixas").select("pedido_id")
        .eq("origem", "escala").eq("referencia", dia);
      if (baixas?.length) {
        await estornarBaixa(baixas.map((b) => b.pedido_id));
      }
      setDesfazendo(false);
      aoMudar();
    };
    return (
      <div style={{ ...cardStyle, marginBottom: 12, borderColor: "#C4DBA6", background: "#F7FBF2" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Check size={16} color="#27500A" />
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#27500A" }}>
              Diárias pagas — {brl(pagamento.valor_liquido)}
            </div>
            <div style={{ fontSize: 11, color: "#8A8778" }}>
              {pagamento.qtd_pessoas} diarista(s) · bruto {brl(pagamento.valor_bruto)}
              {Number(pagamento.valor_fiado) > 0 ? ` · fiado ${brl(pagamento.valor_fiado)} descontado` : ""}
              {" · em Contas a pagar (paga) e no DRE, conta 4.2 Diárias"}
            </div>
          </div>
          <button onClick={desfazer} disabled={desfazendo} style={{ ...linkBtn, fontSize: 11 }}>
            {desfazendo ? "desfazendo…" : "desfazer"}
          </button>
        </div>
      </div>
    );
  }

  if (diaristas.length === 0) return null;

  const pagar = async () => {
    setGravando(true);
    setErro("");
    const descricao = `Diárias ${dia.split("-").reverse().join("/")} — ${diaristas.length} pessoa(s)`;
    const obs = fiadoAberto > 0 ? `Fiado de ${brl(fiadoAberto)} descontado.` : null;

    const { data: contaId, error } = await supabase.rpc("lancar_despesa_paga", {
      p_descricao: descricao,
      p_valor: liquido,
      p_plano_conta: "4.2",
      p_data: dia,
      p_observacao: obs,
    });
    if (error) { setErro(error.message); setGravando(false); return; }

    // Baixa do fiado de quem foi descontado agora. Se falhar, a conta ja
    // existe — por isso o aviso e explicito em vez de silencioso.
    if (fiadoAberto > 0) {
      for (const l of diaristas) {
        if (fiado.saldoDe(l.pessoa_id) > 0) {
          const r = await fiado.baixarUm(l.pessoa_id, "escala", dia);
          if (r?.error) { setErro("Pagamento lançado, mas o fiado de " + l.pessoa.nome + " não baixou: " + r.error.message); }
        }
      }
    }

    const { data: userData } = await supabase.auth.getUser();
    const { error: errReg } = await supabase.from("pagamentos_diaria").insert({
      dia,
      conta_pagar_id: contaId,
      valor_bruto: bruto,
      valor_fiado: fiadoAberto,
      valor_liquido: liquido,
      qtd_pessoas: diaristas.length,
      pago_por: userData?.user?.id || null,
    });
    if (errReg) { setErro(errReg.message); setGravando(false); return; }

    setGravando(false);
    aoMudar();
  };

  return (
    <div style={{ ...cardStyle, marginBottom: 12 }}>
      <div style={sectionLabel}>Pagamento das diárias</div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#8A8778", padding: "3px 0" }}>
        <span>{diaristas.length} diarista(s) · bruto</span>
        <span style={{ color: "#22231F" }}>{brl(bruto)}</span>
      </div>
      {fiado.buscou && fiadoAberto > 0 && (
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#A32D2D", padding: "3px 0" }}>
          <span>(–) Fiado em aberto</span>
          <span style={{ fontWeight: 700 }}>{brl(fiadoAberto)}</span>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 800, color: "#22231F", padding: "6px 0 10px", borderTop: "1px solid #F0EBDD", marginTop: 4 }}>
        <span>A pagar hoje</span><span>{brl(liquido)}</span>
      </div>
      {!fiado.buscou && (
        <div style={{ fontSize: 11, color: "#854F0B", marginBottom: 8 }}>
          Você ainda não buscou o fiado. Se buscar antes, o desconto entra
          neste pagamento — depois de lançado, só desfazendo.
        </div>
      )}
      <button onClick={pagar} disabled={gravando || liquido <= 0}
        style={{ ...btnPrimary, width: "100%", display: "flex", justifyContent: "center", gap: 6 }}>
        {gravando ? <Loader2 size={15} /> : <Receipt size={15} />}
        {gravando ? "Enviando…" : "Enviar para Contas a pagar e DRE"}
      </button>
      <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 6, lineHeight: 1.6 }}>
        Custo de pessoal <b>não passa por nota fiscal</b> — entra direto como
        despesa já quitada na conta <b>4.2 Diárias</b>, com a data de hoje.
        Aparece na hora em Contas a pagar (como paga) e no DRE. Registrado não
        entra aqui — recebe no Fechamento mensal. Gerente entra se for diarista.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Folha para impressao / PDF
//
// Fica escondida na tela (.folha-pdf tem display:none no index.css) e so
// aparece na hora de imprimir. O navegador cuida do resto: no Mac, "Salvar
// como PDF"; no iPhone, Compartilhar > Imprimir. Sem biblioteca nova no
// build — cada dependencia a mais e mais uma chance do deploy quebrar.
// ---------------------------------------------------------------------------
function CabecalhoFolha({ titulo, subtitulo, emitidoPor }) {
  const agora = new Date();
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 14, borderBottom: "3px solid #C72B2E", paddingBottom: 12 }}>
      <img src="/icons/logo-full.png" alt="Mr Kong" style={{ width: 96, height: "auto", flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: "#231A18" }}>{titulo}</div>
        <div style={{ fontSize: 11.5, color: "#8B8071", marginTop: 2 }}>
          Mr Kong Fast Food · Rio Verde/GO{subtitulo ? ` · ${subtitulo}` : ""}
        </div>
      </div>
      <div style={{ fontSize: 10.5, color: "#8B8071", textAlign: "right", lineHeight: 1.5 }}>
        emitido em<br />
        {agora.toLocaleDateString("pt-BR")} {agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
        {emitidoPor ? <><br />por {emitidoPor}</> : null}
      </div>
    </div>
  );
}

function FolhaEscala({ dia, linhas, participacao, taxa, emitidoPor }) {
  const tdCab = {
    borderBottom: "1.5px solid #231A18", padding: "6px 4px", fontSize: 9.5, fontWeight: 800,
    textTransform: "uppercase", letterSpacing: 0.5, color: "#8B8071", textAlign: "left",
  };
  const td = { padding: "7px 4px", borderBottom: "1px solid #F3EBDD", fontSize: 11.5 };
  const n = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  const totalHoras = linhas.reduce((s2, l) => s2 + (participacao[l.pessoa_id]?.horas || 0), 0);
  const totalDia = linhas.reduce((s2, l) => s2 + (Number(l.total_dia) || 0), 0);

  return (
    <div className="folha-pdf">
      <CabecalhoFolha
        titulo="Escala do dia"
        subtitulo={dia.split("-").reverse().join("/")}
        emitidoPor={emitidoPor}
      />

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
        <thead>
          <tr>
            <td style={tdCab}>Pessoa</td>
            <td style={tdCab}>Cargo</td>
            <td style={tdCab}>Horário</td>
            <td style={{ ...tdCab, textAlign: "right" }}>Horas</td>
            <td style={{ ...tdCab, textAlign: "right" }}>Método</td>
            <td style={{ ...tdCab, textAlign: "right" }}>A pagar</td>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const part = participacao[l.pessoa_id] || {};
            return (
              <tr key={l.pessoa_id}>
                <td style={td}>{l.pessoa?.nome}</td>
                <td style={td}>{PAPEL_LABEL[l.pessoa?.papel]}{l.pessoa?.tipo_contrato === "diarista" ? " · diarista" : ""}</td>
                <td style={td}>{part.entrada && part.saida ? `${part.entrada}–${part.saida}` : "—"}</td>
                <td style={n}>{(part.horas || 0).toLocaleString("pt-BR")}</td>
                <td style={n}>
                  {l.metodo_usado === "gerente" ? "% do faturamento do dia"
                    : l.metodo_usado === "gerente_previa" ? "2% do mês (regra antiga)"
                    : l.metodo_usado === "hora" ? "por hora"
                    : l.metodo_usado === "comissao" ? "taxa + diária"
                    : "comissão"}
                </td>
                <td style={{ ...n, fontWeight: 700 }}>{brl(l.total_dia)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ padding: "8px 4px", borderTop: "2px solid #231A18", fontWeight: 800, fontSize: 11.5 }} colSpan={3}>
              {linhas.length} pessoa(s) · taxa de serviço do dia {brl(taxa)}
            </td>
            <td style={{ padding: "8px 4px", borderTop: "2px solid #231A18", fontWeight: 800, fontSize: 11.5, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {totalHoras.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}
            </td>
            <td style={{ padding: "8px 4px", borderTop: "2px solid #231A18" }} />
            <td style={{ padding: "8px 4px", borderTop: "2px solid #231A18", fontWeight: 800, fontSize: 12.5, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {brl(totalDia)}
            </td>
          </tr>
        </tfoot>
      </table>

      <div className="nao-quebrar" style={{ marginTop: 14, fontSize: 10.5, color: "#8B8071", lineHeight: 1.7 }}>
        A comissão do dia é metade da taxa de serviço para os garçons e metade
        para a equipe interna, dividida por cabeça dentro de cada grupo, só entre
        quem trabalhou. Diarista recebe o maior entre <b>diária base + comissão</b> e
        <b> horas × valor da hora</b>. Gerente não entra na divisão: recebe 2% do
        faturamento bruto, fechado no mês.
      </div>

      <div className="nao-quebrar" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 26, marginTop: 40 }}>
        <div style={{ borderTop: "1px solid #231A18", paddingTop: 5, fontSize: 10.5, color: "#8B8071", textAlign: "center" }}>
          Responsável pelo fechamento
        </div>
        <div style={{ borderTop: "1px solid #231A18", paddingTop: 5, fontSize: 10.5, color: "#8B8071", textAlign: "center" }}>
          Conferido por
        </div>
      </div>

      <div style={{ marginTop: 20, paddingTop: 8, borderTop: "1px solid #E9DFCE", fontSize: 9.5, color: "#8B8071", display: "flex", justifyContent: "space-between" }}>
        <span>Painel Mr. Kong</span>
        <span>Escala de {dia.split("-").reverse().join("/")}</span>
      </div>
    </div>
  );
}

// Botao que dispara a impressao. O `setTimeout` existe porque o Safari
// precisa de um respiro entre o React montar a folha e o print abrir.
function BotaoPdf({ children = "Baixar PDF" }) {
  const imprimir = () => { setTimeout(() => window.print(), 60); };
  return (
    <button onClick={imprimir} style={btnPdf}>
      <Download size={15} /> {children}
    </button>
  );
}

// Linha de fiado no acerto de um dia ja fechado. Aqui nao existe
// "Calcular e salvar" — o desconto e uma acao explicita, pessoa por
// pessoa, no momento de pagar. Por isso o botao "Dar baixa" em vez do
// chip que so marca intencao.
function FiadoNoAcerto({ fiado, pessoaId, dia, valorDoDia }) {
  const [gravando, setGravando] = useState(false);
  if (!fiado.buscou) return null;

  const saldo = fiado.saldoDe(pessoaId);
  const jaBaixados = fiado.baixadoDe(pessoaId);
  const totalBaixado = somar(jaBaixados);

  if (saldo <= 0 && totalBaixado <= 0) return null;

  const baixar = async () => {
    setGravando(true);
    await fiado.baixarUm(pessoaId, "escala", dia);
    setGravando(false);
  };
  const estornar = async () => {
    setGravando(true);
    await fiado.estornarDe(pessoaId);
    setGravando(false);
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
      {saldo > 0 ? (
        <>
          <span style={{ ...pillFiado, background: "#F0999522", border: "1px solid #F0999540", color: "#A32D2D" }}>
            fiado em aberto {brl(saldo)}
          </span>
          {valorDoDia != null && (
            <span style={{ fontSize: 11, color: "#8A8778" }}>
              a pagar <strong style={{ color: "#22231F" }}>{brl(valorDoDia - saldo)}</strong>
            </span>
          )}
          <button onClick={baixar} disabled={gravando}
            style={{ ...btnMiniEscuro }}>
            {gravando ? "..." : "Dar baixa"}
          </button>
        </>
      ) : (
        <>
          <span style={{ ...pillFiado, background: "#EAF3DE", border: "1px solid #C4DBA6", color: "#27500A" }}>
            fiado de {brl(totalBaixado)} descontado
          </span>
          <button onClick={estornar} disabled={gravando} style={{ ...linkBtn, fontSize: 11 }}>
            {gravando ? "..." : "estornar"}
          </button>
        </>
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
function FiadoDaPessoa({ pessoa, pessoas = [], isAdmin = false }) {
  const fiado = useFiadoEquipe(pessoas.length ? pessoas : [pessoa], isAdmin);
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
      <PainelSemDono fiado={fiado} pessoas={pessoas.length ? pessoas : [pessoa]} />
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

function FormPessoa({ form, setForm, onSalvar, onCancelar, isAdmin, nomesFiado = [], pessoas = [] }) {
  const fileRef = useRef(null);
  // Nome que já pertence a outra pessoa não deve ser oferecido de novo —
  // dois cadastros apontando pro mesmo nome fariam o mesmo consumo ser
  // cobrado duas vezes.
  const jaUsados = new Set(
    (pessoas || [])
      .filter((p) => p.nome_fiado && p.nome_fiado !== form.nome_fiado)
      .map((p) => normalizaNome(p.nome_fiado))
  );
  const sugestoes = (nomesFiado || []).filter((n) => !jaUsados.has(normalizaNome(n.nome_cliente)));
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
          placeholder="CPF, telefone, e-mail ou chave aleatória" style={inputStyle} autoComplete="off" name="chave-pix" />
      </div>
      <div>
        <label style={{ fontSize: 11, color: "#8A8778", display: "block", marginBottom: 4 }}>Nome no fiado do caixa</label>
        <input
          value={form.nome_fiado}
          onChange={(e) => setForm((f) => ({ ...f, nome_fiado: e.target.value }))}
          placeholder="Só se for diferente do nome acima"
          style={inputStyle}
          list="sugestoes-fiado"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          name="nome-no-fiado"
        />
        <datalist id="sugestoes-fiado">
          {sugestoes.map((n) => (
            <option key={n.nome_cliente} value={n.nome_cliente}>
              {n.pedidos} pedido(s) · {brl(n.total)}
            </option>
          ))}
        </datalist>
        <div style={{ fontSize: 11, color: "#8A8778", marginTop: 4, lineHeight: 1.6 }}>
          É por aqui que o painel liga o consumo fiado a esta pessoa. Preencha
          quando o caixa digita apelido ou nome curto — "Zeca" no lugar de
          "José Carlos", por exemplo.
        </div>
        {sugestoes.length > 0 ? (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 4 }}>
              Nomes que aparecem no fiado dos últimos 90 dias — clique pra usar:
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {sugestoes.slice(0, 12).map((n) => (
                <button
                  key={n.nome_cliente}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, nome_fiado: n.nome_cliente }))}
                  title={`${n.pedidos} pedido(s) · ${brl(n.total)}`}
                  style={{
                    border: "1px solid #E8E2D2", background: form.nome_fiado === n.nome_cliente ? "#22231F" : "#FFFFFF",
                    color: form.nome_fiado === n.nome_cliente ? "#F3EFE3" : "#22231F",
                    borderRadius: 999, padding: "4px 10px", fontSize: 11.5, cursor: "pointer",
                  }}
                >
                  {n.nome_cliente} <span style={{ opacity: 0.6 }}>{brl(n.total)}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ fontSize: 11, color: "#8A8778", marginTop: 6 }}>
            Nenhum nome no fiado dos últimos 90 dias ainda — ou o cache do
            painel não tem pedidos nesse período.
          </div>
        )}
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
  // Contador que faz o painel "Corrigir no CardápioWeb" recarregar quando
  // uma dívida nova nasce, sem precisar recarregar a tela inteira.
  const [correcoesVersao, setCorrecoesVersao] = useState(0);
  const [dia, setDia] = useState(hoje());
  const [pessoas, setPessoas] = useState([]);
  const [participacao, setParticipacao] = useState({}); // pessoa_id -> { incluido, horas, entrada, saida, intervalo }
  const [baseCategoria, setBaseCategoria] = useState({}); // papel -> valor (vem da Matriz de cargos, só leitura aqui)
  const [valorHora, setValorHora] = useState({}); // papel -> valor (vem da Matriz de cargos, só leitura aqui)
  const [taxaServico, setTaxaServico] = useState("");
  const [buscandoTaxa, setBuscandoTaxa] = useState(false);
  const [taxaAutomatica, setTaxaAutomatica] = useState(null); // null | true | false
  const [faturamentoBrutoDia, setFaturamentoBrutoDia] = useState(0); // base do percentual da gerente naquela noite
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
  const fiado = useFiadoEquipe(pessoas, isAdmin);
  const [pagamentoDoDia, setPagamentoDoDia] = useState(null);
  const [nomeDeQuemImprime, setNomeDeQuemImprime] = useState("");
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
      const { data: pagDia } = await supabase
        .from("pagamentos_diaria").select("*").eq("dia", dia).maybeSingle();
      setPagamentoDoDia(pagDia || null);
      const { data: usuario } = await supabase.auth.getUser();
      if (usuario?.user?.id) {
        const { data: meuPerfil } = await supabase
          .from("perfis").select("nome").eq("id", usuario.user.id).maybeSingle();
        setNomeDeQuemImprime(meuPerfil?.nome || "");
      }
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
        const entrada = TURNO_PADRAO.entrada;
        const saida = TURNO_PADRAO.saida;
        const horas = horasDoPonto(entrada, saida, INTERVALO_PADRAO_MIN);
        mapaPart[p.id] = {
          incluido: idsPrevistos.has(p.id),
          horas: horas === null ? 0 : horas,
          entrada,
          saida,
          intervalo: INTERVALO_PADRAO_MIN,
          papel: null,
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
          papel: pr.papel_no_dia || null,
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
    const temGerente = pessoas.some(
      (p) => participacao[p.id]?.incluido && (participacao[p.id]?.papel || p.papel) === "gerente"
    );
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

    // O faturamento agora vem JUNTO com a taxa: é a mesma leitura de
    // pedidos, e a função devolve os dois.
    //
    // Até 28/08/2026 aqui havia uma segunda chamada, à ação
    // `faturamento_periodo` — que não existia na Edge Function. O
    // CardápioWeb respondia "Ação desconhecida", este código engolia o
    // erro (`if (!fatErr && !fatData?.error)`) e o faturamento ficava em
    // zero. A gerente fechava em R$ 0,00 todo santo dia, e parecia
    // problema no cadastro dela.
    //
    // Duas lições viraram código: não pedir duas vezes o que dá pra
    // trazer numa, e nunca mais descartar erro sem contar pra ninguém.
    let faturamentoBruto = Number(data.faturamento_bruto);
    if (!Number.isFinite(faturamentoBruto)) {
      // Função antiga, ainda sem o faturamento na resposta: tenta a ação
      // separada e, se ela também falhar, AVISA em vez de zerar calado.
      const diaSeguinte = new Date(`${dia}T12:00:00-03:00`);
      diaSeguinte.setDate(diaSeguinte.getDate() + 1);
      const { data: fatData, error: fatErr } = await supabase.functions.invoke("cardapioweb-proxy", {
        body: {
          acao: "faturamento_periodo",
          data_inicio: `${dia}T17:00:00-03:00`,
          data_fim: `${diaSeguinte.toISOString().slice(0, 10)}T03:00:00-03:00`,
        },
      });
      if (fatErr || fatData?.error) {
        faturamentoBruto = cacheTaxa?.faturamento_bruto || 0;
        if (temGerente) {
          setErro(
            "A taxa de serviço veio, mas o faturamento do dia não: " +
            (fatData?.error || (await extrairErroFuncao(fatErr))) +
            " — sem ele o percentual da gerência fica em zero. Publique a versão nova da função cardapioweb-proxy."
          );
        }
      } else {
        faturamentoBruto = Number(fatData.faturamento_bruto) || 0;
      }
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
  // Trocar a função só daquele dia. Vazio volta pro cadastro.
  const alterarPapelDoDia = (pessoaId, papel) => {
    marcarSujo(pessoaId);
    setParticipacao((prev) => ({
      ...prev,
      [pessoaId]: { ...prev[pessoaId], papel: papel || null },
    }));
  };
  const alterarHoras = (pessoaId, horas) => {
    marcarSujo(pessoaId);
    setParticipacao((prev) => ({ ...prev, [pessoaId]: { ...prev[pessoaId], horas: parseFloat(horas) || 0 } }));
  };
  const pesoDe = (pessoaId) => (participacao[pessoaId]?.horas || 0) / HORAS_PADRAO_TURNO;
  // Função DO DIA. A Luciene é caixa no cadastro, mas se cobriu o salão
  // num sábado, naquele dia ela entra na metade dos garçons. O cadastro
  // dela não muda — senão o fechamento do mês passado se recalcularia
  // como se ela sempre tivesse sido garçom, e dia fechado mudaria de
  // valor sozinho.
  const papelDe = (p) => participacao[p.id]?.papel || p.papel;
  const selecionados = pessoas.filter((p) => participacao[p.id]?.incluido);
  const garcons = selecionados.filter((p) => categoriaComissao(papelDe(p)) === "garcom");
  const internos = selecionados.filter((p) => categoriaComissao(papelDe(p)) === "interno");
  // Nunca tem duas gerentes na mesma noite — mas se aparecerem, cada uma
  // levaria o percentual cheio e a casa pagaria o dobro. Quase sempre é
  // escala marcada errada, então a tela avisa antes de salvar.
  const gerentesDoDia = selecionados.filter((p) => papelDe(p) === "gerente");
  const taxaNum = parseFloat(taxaServico) || 0;
  const poolGarcons = taxaNum * 0.5;
  const poolInternos = taxaNum * 0.5;
  // A taxa de serviço racha ao meio e cada metade é dividida POR CABEÇA,
  // não por hora: quem estava na noite leva a mesma fatia do seu bolo.
  // Até 22/08/2026 o rateio era proporcional às horas — estava errado em
  // relação à regra da casa, e por isso quem esticava o turno levava mais
  // comissão que os colegas do mesmo bolo.
  const comissaoPorGarcom = garcons.length > 0 ? poolGarcons / garcons.length : 0;
  const comissaoPorInterno = internos.length > 0 ? poolInternos / internos.length : 0;
  // Diarista: dois métodos, vale o maior.
  //   comissão = diária base CHEIA do cargo + a fatia da taxa
  //   hora     = horas trabalhadas × valor/hora do cargo
  // A base é cheia mesmo em jornada curta: trabalhou aquela noite, leva a
  // base do cargo. (Antes ela era multiplicada pelo peso das horas, o que
  // inflava a base de quem passava das 8h.)
  // Registrado não entra nessa comparação — só recebe a comissão do dia
  // (o salário dele é mensal, somado no Fechamento mensal). Gerente não
  // entra na divisão de jeito nenhum — só mostra uma PRÉVIA do 2% do
  // faturamento bruto do dia (o oficial fecha por mês).
  const linhas = selecionados.map((p) => {
    const horas = participacao[p.id]?.horas || 0;
    const papelDia = papelDe(p);
    if (papelDia === "gerente") {
      // Percentual do faturamento bruto DA NOITE + diária base do cargo.
      // Registrada não leva a diária: o fixo dela é o salário mensal, e
      // o percentual de cada noite acumula pro fechamento do mês.
      const pct = Number(matriz.gerente?.percentual_faturamento ?? PERCENTUAL_GERENTE_PADRAO) || 0;
      const comissao = round2(faturamentoBrutoDia * pct / 100);
      const base = p.tipo_contrato === "diarista" ? (parseFloat(baseCategoria.gerente) || 0) : 0;
      const total = round2(comissao + base);
      return {
        pessoa: p, peso: 0, horas, comissao, baseCategoriaValor: base,
        metodoUsado: "gerente", valorMetodoComissao: total, valorMetodoHora: null,
        total, pctGerente: pct, faturamentoDia: faturamentoBrutoDia,
      };
    }
    const peso = pesoDe(p.id); // guardado na presença como informação; não rateia mais
    const comissao = categoriaComissao(papelDia) === "garcom" ? comissaoPorGarcom : comissaoPorInterno;
    const baseCategoriaValor = parseFloat(baseCategoria[papelDia]) || 0;
    const m = matriz[papelDia] || { valor_hora: 0 };
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
        papel_no_dia: part.papel || null,
      }, { onConflict: "pessoa_id,dia" }));
    } else {
      // Desmarcou: tira do dia, senão a presença antiga fica para trás.
      // A premiação vai junto — se ficasse, a pessoa continuaria
      // aparecendo no acerto do dia com valor calculado.
      ({ error } = await supabase.from("presencas_diarias").delete()
        .eq("pessoa_id", pessoa.id).eq("dia", dia));
      await supabase.from("premiacoes_diarias").delete()
        .eq("pessoa_id", pessoa.id).eq("dia", dia);
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
    // A gerente é paga por percentual do faturamento da noite. Salvar sem
    // esse número grava zero pra ela em silêncio — foi exatamente o que
    // aconteceu no dia 25/08, quando a função do dia era Gerente e o
    // faturamento nunca tinha sido buscado.
    if (isAdmin && gerentesDoDia.length > 0 && !(faturamentoBrutoDia > 0)) {
      setErro("A gerente está na escala mas o faturamento do dia ainda não foi buscado — clique em Buscar taxa de serviço antes de salvar, senão o percentual dela fecha em zero.");
      return;
    }
    setSalvando(true);
    setErro("");

    // PRIMEIRO tira do dia quem NÃO está marcado agora.
    //
    // Sem isto, desmarcar alguém não fazia nada: o salvar só regravava
    // quem estava marcado, e a presença antiga de quem saiu continuava
    // no banco — aparecendo no acerto, entrando na divisão da comissão e
    // reduzindo a fatia de quem realmente trabalhou.
    //
    // A limpeza vem antes da gravação de propósito. Se viesse depois e
    // desse erro no meio, sobraria gente a mais no dia; assim, o pior
    // caso é um dia vazio, que se resolve salvando de novo.
    {
      const idsDoDia = selecionados.map((p) => p.id);
      const filtro = `(${idsDoDia.join(",")})`;
      if (idsDoDia.length > 0) {
        await supabase.from("presencas_diarias").delete()
          .eq("dia", dia).not("pessoa_id", "in", filtro);
        await supabase.from("premiacoes_diarias").delete()
          .eq("dia", dia).not("pessoa_id", "in", filtro);
      } else {
        await supabase.from("presencas_diarias").delete().eq("dia", dia);
        await supabase.from("premiacoes_diarias").delete().eq("dia", dia);
      }
    }

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
        papel_no_dia: part.papel || null,
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
          papel_no_dia: participacao[l.pessoa.id]?.papel || null,
          metodo_usado: l.metodoUsado,
          valor_metodo_comissao: l.metodoUsado ? round2(l.valorMetodoComissao) : null,
          valor_metodo_hora: l.metodoUsado === "gerente" ? null : (l.metodoUsado ? round2(l.valorMetodoHora) : null),
          faturamento_dia: l.metodoUsado === "gerente" ? round2(l.faturamentoDia || 0) : null,
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
    const totalDoDia = linhasSalvas.reduce((s2, l) => s2 + (Number(l.total_dia) || 0), 0);
    // Só o que ainda está em aberto entra no "a pagar" — o que já foi
    // baixado saiu num acerto anterior e não desconta de novo.
    const fiadoEmAbertoDoDia = [...linhasSalvas.map((l) => l.pessoa_id), ...pessoasSemPremiacao.map((p) => p.id)]
      .reduce((s2, id) => s2 + (fiado.buscou ? fiado.saldoDe(id) : 0), 0);
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} style={inputStyle} />
        </div>
        <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 14, display: "flex", alignItems: "center", gap: 4 }}>
          <Lock size={13} /> Já preenchida — modo leitura{!isAdmin ? " (só administradores editam)" : ""}
        </div>
        {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}
        {isAdmin && (
          <>
            <div style={sectionLabel}>Fiado da equipe</div>
            <BarraFiado fiado={fiado} aviso="Traz o que a equipe consumiu como fiado e ainda nao foi descontado, pra abater no pagamento deste dia." />
            <PainelSemDono fiado={fiado} pessoas={pessoas} aoMudarPessoas={carregar}
                aoMudarCorrecoes={() => setCorrecoesVersao((v) => v + 1)} />
            <NomesVinculados fiado={fiado} pessoas={pessoas} />
            <CorrigirNoCardapioWeb fiado={fiado} recarregar={correcoesVersao} />
          </>
        )}
        <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", marginBottom: 16, background: "#FFFFFF" }}>
          {linhasSalvas.map((l, idx) => (
            <div key={l.pessoa_id} style={{ padding: "10px 14px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 13, color: "#22231F" }}>{l.pessoa.nome}</div>
                  <div style={{ fontSize: 11, color: "#8A8778" }}>
                    {PAPEL_LABEL[l.papel_no_dia || l.pessoa.papel]}
                    {l.papel_no_dia && l.papel_no_dia !== l.pessoa.papel ? ` (cadastro: ${PAPEL_LABEL[l.pessoa.papel]})` : ""}
                    {l.pessoa.tipo_contrato === "diarista" ? " · diarista" : ""} · {textoPonto(participacao[l.pessoa_id])}
                  </div>
                  {isAdmin && <LinhaPix pessoa={l.pessoa} />}
                </div>
                {isAdmin && <div style={{ fontSize: 14, fontWeight: 700, color: "#22231F" }}>{brl(l.total_dia)}</div>}
              </div>
              {isAdmin && l.metodo_usado === "gerente" && (
                <div style={{ fontSize: 10, color: "#0F6E56", marginTop: 4 }}>
                  ✓ Gerência: {brl(l.comissao)} do faturamento do dia ({brl(l.faturamento_dia)})
                  {Number(l.base_categoria) > 0 ? ` + diária base ${brl(l.base_categoria)}` : ""}
                </div>
              )}
              {isAdmin && l.metodo_usado === "gerente_previa" && (
                <div style={{ fontSize: 10, color: "#A32D2D", marginTop: 4 }}>
                  Dia calculado pela regra antiga da gerência (prévia informativa). Pra recalcular pela regra
                  nova, um administrador reabre o dia e salva de novo.
                </div>
              )}
              {isAdmin && l.metodo_usado && l.metodo_usado !== "gerente" && l.metodo_usado !== "gerente_previa" && (
                <div style={{ fontSize: 10, color: "#0F6E56", marginTop: 4 }}>
                  ✓ Taxa de serviço + diária base: {brl(l.valor_metodo_comissao)} · Hora: {brl(l.valor_metodo_hora)}
                </div>
              )}
              {isAdmin && (
                <FiadoNoAcerto fiado={fiado} pessoaId={l.pessoa_id} dia={dia} valorDoDia={l.total_dia} />
              )}
            </div>
          ))}
          {pessoasSemPremiacao.map((p, idx) => (
            <div key={p.id} style={{ padding: "10px 14px", borderTop: (linhasSalvas.length + idx) > 0 ? "1px solid #F0EBDD" : "none" }}>
              <div style={{ fontSize: 13, color: "#22231F" }}>{p.nome}</div>
              <div style={{ fontSize: 11, color: "#8A8778" }}>{PAPEL_LABEL[p.papel]}{p.tipo_contrato === "diarista" ? " · diarista" : ""} · {textoPonto(participacao[p.id])}</div>
              {isAdmin && <LinhaPix pessoa={p} />}
              {isAdmin && <FiadoNoAcerto fiado={fiado} pessoaId={p.id} dia={dia} valorDoDia={null} />}
            </div>
          ))}
          {linhasSalvas.length === 0 && pessoasSemPremiacao.length === 0 && (
            <div style={{ padding: 14, fontSize: 13, color: "#8A8778" }}>Ninguém marcado nesse dia.</div>
          )}
        </div>
        {isAdmin && (
          <div style={{ background: "#F6F1E7", borderRadius: 8, padding: "10px 12px", fontSize: 12, color: "#8A8778", marginBottom: 16, display: "flex", flexDirection: "column", gap: 5 }}>
            {taxaNumSalva > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>Taxa de serviço do dia</span>
                <span style={{ color: "#22231F", fontWeight: 700 }}>{brl(taxaNumSalva)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Total do dia</span>
              <span style={{ color: "#22231F", fontWeight: 700 }}>{brl(totalDoDia)}</span>
            </div>
            {fiado.buscou && fiadoEmAbertoDoDia > 0 && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", color: "#A32D2D" }}>
                  <span>(–) Fiado em aberto da equipe</span>
                  <span style={{ fontWeight: 700 }}>{brl(fiadoEmAbertoDoDia)}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 5, borderTop: "1px solid #E8E2D2" }}>
                  <span style={{ color: "#22231F", fontWeight: 700 }}>A pagar</span>
                  <span style={{ color: "#22231F", fontWeight: 800 }}>{brl(totalDoDia - fiadoEmAbertoDoDia)}</span>
                </div>
              </>
            )}
          </div>
        )}
        {isAdmin && (
          <PagamentoDasDiarias
            dia={dia}
            linhasSalvas={linhasSalvas}
            fiado={fiado}
            pagamento={pagamentoDoDia}
            aoMudar={carregar}
            setErro={setErro}
          />
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <BotaoPdf>Baixar escala em PDF</BotaoPdf>
          {isAdmin && (
            <button onClick={() => setModoLeitura(false)} style={{ ...btnSecondary, flex: 1, minWidth: 140, display: "flex", justifyContent: "center", gap: 6 }}>
              <Pencil size={15} /> Editar
            </button>
          )}
        </div>

        <FolhaEscala
          dia={dia}
          linhas={linhasSalvas}
          participacao={participacao}
          taxa={taxaNumSalva}
          emitidoPor={nomeDeQuemImprime}
        />
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
                      <div style={{ fontSize: 11, color: "#8A8778" }}>
                        {part.papel && part.papel !== p.papel ? (
                          <>
                            <span style={{ textDecoration: "line-through", opacity: 0.6 }}>{PAPEL_LABEL[p.papel]}</span>
                            {" → "}
                            <b style={{ color: "#C72B2E" }}>hoje como {PAPEL_LABEL[part.papel]}</b>
                          </>
                        ) : (
                          PAPEL_LABEL[p.papel]
                        )}
                        {p.tipo_contrato === "diarista" ? " · diarista" : ""}
                      </div>
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
                        <div style={{ flex: 1.3, minWidth: 118 }}>
                          <label style={{ fontSize: 10, color: "#8A8778", display: "block", marginBottom: 3 }}>Função hoje</label>
                          <select value={part.papel || ""} onChange={(e) => alterarPapelDoDia(p.id, e.target.value)}
                            style={{
                              width: "100%", boxSizing: "border-box", padding: "5px 7px", borderRadius: 6,
                              fontSize: 12, background: "#FFFFFF", fontFamily: "inherit",
                              border: `1px solid ${part.papel && part.papel !== p.papel ? "#C72B2E" : "#E8E2D2"}`,
                              color: part.papel && part.papel !== p.papel ? "#C72B2E" : "#22231F",
                              fontWeight: part.papel && part.papel !== p.papel ? 700 : 400,
                            }}>
                            <option value="">{PAPEL_LABEL[p.papel]} (do cadastro)</option>
                            {PAPEIS_COM_GERENTE.filter((x) => x !== p.papel).map((x) => (
                              <option key={x} value={x}>{PAPEL_LABEL[x]}</option>
                            ))}
                          </select>
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
          {isAdmin && gerentesDoDia.length > 1 && (
            <div style={{ ...avisoStyle, marginBottom: 12 }}>
              <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 13 }}>
                Tem <b>{gerentesDoDia.length} gerentes</b> nesta noite ({gerentesDoDia.map((g) => g.nome).join(", ")}).
                Cada uma vai levar o percentual cheio do faturamento. Se foi engano, corrija a escala antes de salvar.
              </div>
            </div>
          )}
          {isAdmin && selecionados.length > 0 && (
            <>
              <div style={sectionLabel}>Valores por cargo</div>
              <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 8 }}>
                Diária base e valor da hora — só leitura aqui. Pra mudar, vai em Gente e Gestão &gt; Matriz de cargos.
              </div>
              <div style={{ display: "grid", gap: 6, marginBottom: 16 }}>
                {[...new Set(selecionados.map((p) => papelDe(p)))].map((papel) => (
                  <div key={papel} style={{ ...cardStyle, padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ flex: 1, fontSize: 13, color: "#22231F" }}>{PAPEL_LABEL[papel]}</span>
                    <span style={{ fontSize: 11, color: "#8A8778" }}>Diária base <strong style={{ color: "#22231F" }}>{brl(parseFloat(baseCategoria[papel]) || 0)}</strong></span>
                    {papel === "gerente" ? (
                      <span style={{ fontSize: 11, color: "#8A8778" }}>
                        {Number(matriz.gerente?.percentual_faturamento ?? PERCENTUAL_GERENTE_PADRAO) || 0}% do faturamento{" "}
                        <strong style={{ color: "#22231F" }}>{brl(faturamentoBrutoDia)}</strong>
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: "#8A8778" }}>Hora <strong style={{ color: "#22231F" }}>{brl(parseFloat(valorHora[papel]) || 0)}</strong></span>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
          {isAdmin && selecionados.length > 0 && taxaNum > 0 && (
            <>
              <div style={sectionLabel}>Resultado</div>
              <BarraFiado fiado={fiado} aviso="Traz o que a equipe consumiu como fiado e ainda nao foi descontado, pra abater no acerto de hoje." />
              <PainelSemDono fiado={fiado} pessoas={pessoas} aoMudarPessoas={carregar}
                aoMudarCorrecoes={() => setCorrecoesVersao((v) => v + 1)} />
              <NomesVinculados fiado={fiado} pessoas={pessoas} />
              <CorrigirNoCardapioWeb fiado={fiado} recarregar={correcoesVersao} />
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
                        {l.metodoUsado === "hora" ? "por hora"
                          : l.metodoUsado === "comissao" ? "taxa de serviço"
                          : l.metodoUsado === "gerente" ? `${l.pctGerente}% do dia`
                          : "—"}
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
                    {l.metodoUsado === "gerente" && (
                      <div style={{ fontSize: 10, color: "#8A8778", marginTop: 4 }}>
                        {l.pctGerente}% de {brl(l.faturamentoDia)} (faturamento bruto do dia) = <b>{brl(l.comissao)}</b>
                        {l.baseCategoriaValor > 0
                          ? <> + diária base <b>{brl(l.baseCategoriaValor)}</b></>
                          : " · registrada: acumula pro fechamento do mês"}
                      </div>
                    )}
                    {l.metodoUsado === "gerente" && !(l.faturamentoDia > 0) && (
                      <div style={{ fontSize: 10, color: "#A32D2D", marginTop: 4 }}>
                        Faturamento do dia ainda não foi buscado — sem ele o percentual da gerente fica em zero.
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
// Folha do fechamento mensal
// ---------------------------------------------------------------------------
function FolhaFechamento({ mesRef, linhas, gerentes, vales, fiado, emitidoPor }) {
  const tdCab = {
    borderBottom: "1.5px solid #231A18", padding: "6px 4px", fontSize: 9.5, fontWeight: 800,
    textTransform: "uppercase", letterSpacing: 0.5, color: "#8B8071", textAlign: "left",
  };
  const td = { padding: "7px 4px", borderBottom: "1px solid #F3EBDD", fontSize: 11.5 };
  const n = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

  const liquidoDe = (l) => {
    const vale = Number(vales[l.pessoaId]?.valor || 0);
    const desc = fiado.buscou ? fiado.descontoDe(l.pessoaId) : 0;
    return { vale, desc, liquido: l.total - vale - desc };
  };
  const totalLiquido =
    linhas.reduce((s2, l) => s2 + liquidoDe(l).liquido, 0) +
    gerentes.reduce((s2, g) => s2 + g.total, 0);

  return (
    <div className="folha-pdf">
      <CabecalhoFolha titulo="Fechamento mensal" subtitulo={mesRef} emitidoPor={emitidoPor} />

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
        <thead>
          <tr>
            <td style={tdCab}>Pessoa</td>
            <td style={tdCab}>Cargo</td>
            <td style={{ ...tdCab, textAlign: "right" }}>Dias</td>
            <td style={{ ...tdCab, textAlign: "right" }}>Salário</td>
            <td style={{ ...tdCab, textAlign: "right" }}>Comissão</td>
            <td style={{ ...tdCab, textAlign: "right" }}>Vale</td>
            <td style={{ ...tdCab, textAlign: "right" }}>Fiado</td>
            <td style={{ ...tdCab, textAlign: "right" }}>Líquido</td>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const { vale, desc, liquido } = liquidoDe(l);
            return (
              <tr key={l.pessoaId || l.nome}>
                <td style={td}>{l.nome}</td>
                <td style={td}>{PAPEL_LABEL[l.papel]}</td>
                <td style={n}>{l.dias}</td>
                <td style={n}>{brl(l.salarioBase)}</td>
                <td style={n}>{brl(l.comissao)}</td>
                <td style={n}>{vale ? `− ${brl(vale)}` : "—"}</td>
                <td style={n}>{desc ? `− ${brl(desc)}` : "—"}</td>
                <td style={{ ...n, fontWeight: 700 }}>{brl(liquido)}</td>
              </tr>
            );
          })}
          {gerentes.map((g) => (
            <tr key={g.nome}>
              <td style={td}>{g.nome}</td>
              <td style={td}>Gerente</td>
              <td style={n}>{g.dias}</td>
              <td style={n}>{brl(g.salarioBase)}</td>
              <td style={n}>{brl(g.doisPorcento)}</td>
              <td style={n}>—</td>
              <td style={n}>—</td>
              <td style={{ ...n, fontWeight: 700 }}>{brl(g.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td style={{ padding: "8px 4px", borderTop: "2px solid #231A18", fontWeight: 800, fontSize: 11.5 }} colSpan={7}>
              Total a pagar em {mesRef}
            </td>
            <td style={{ padding: "8px 4px", borderTop: "2px solid #231A18", fontWeight: 800, fontSize: 12.5, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {brl(totalLiquido)}
            </td>
          </tr>
        </tfoot>
      </table>

      <div className="nao-quebrar" style={{ marginTop: 14, fontSize: 10.5, color: "#8B8071", lineHeight: 1.7 }}>
        Comissão é a soma das fatias diárias da taxa de serviço nos dias em que a
        pessoa trabalhou. <b>Vale</b> é o adiantamento pago no dia 20 — ele já saiu
        do caixa e por isso desce do líquido. <b>Fiado</b> é o consumo da própria
        pessoa, descontado no acerto. Gerente recebe salário mais o percentual do
        faturamento bruto das noites em que esteve na escala; gerente diarista não
        aparece aqui porque já recebeu em cada noite.
      </div>

      <div className="nao-quebrar" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 26, marginTop: 40 }}>
        <div style={{ borderTop: "1px solid #231A18", paddingTop: 5, fontSize: 10.5, color: "#8B8071", textAlign: "center" }}>
          Responsável pelo fechamento
        </div>
        <div style={{ borderTop: "1px solid #231A18", paddingTop: 5, fontSize: 10.5, color: "#8B8071", textAlign: "center" }}>
          Conferido por
        </div>
      </div>

      <div style={{ marginTop: 20, paddingTop: 8, borderTop: "1px solid #E9DFCE", fontSize: 9.5, color: "#8B8071", display: "flex", justifyContent: "space-between" }}>
        <span>Painel Mr. Kong</span><span>Fechamento {mesRef}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vales do mes — o adiantamento do dia 20
//
// O vale nao e uma despesa separada: e parte do salario do mes, pago
// antes. Por isso vai pra mesma conta 4.1, na competencia do mes, e o
// fechamento desconta o que ja foi adiantado. Se fosse lancado em conta
// propria, o Pessoal do DRE apareceria inflado.
// ---------------------------------------------------------------------------
function ValesDoMes({ mesRef, pessoas, vales, aoMudar, setErro }) {
  const [aberto, setAberto] = useState(false);
  const [valores, setValores] = useState({});
  const [lancando, setLancando] = useState(null);

  // Quem recebe por mes: registrado — gerente registrada inclusa. Diarista
  // e pago na noite e por isso nao tem vale: vale e adiantamento de
  // salario mensal, e quem nao tem salario mensal nao tem o que adiantar.
  const mensalistas = pessoas.filter(
    (p) => p.ativo !== false && p.tipo_contrato === "registrado"
  );
  const jaLancados = mensalistas.filter((p) => vales[p.id]);
  const totalVales = jaLancados.reduce((s, p) => s + Number(vales[p.id].valor || 0), 0);
  const [ano, mes] = mesRef.split("-");
  const dia20 = `${ano}-${mes}-20`;

  const lancar = async (pessoa) => {
    const bruto = String(valores[pessoa.id] ?? "").replace(",", ".");
    const valor = parseFloat(bruto);
    if (!valor || isNaN(valor) || valor <= 0) { setErro("Informe o valor do vale de " + pessoa.nome + "."); return; }
    setLancando(pessoa.id);
    setErro("");
    const { data: contaId, error } = await supabase.rpc("lancar_despesa_paga", {
      p_descricao: `Vale ${dia20.split("-").reverse().join("/")} — ${pessoa.nome}`,
      p_valor: valor,
      p_plano_conta: "4.1",
      p_data: dia20,
      p_observacao: `Adiantamento do salário de ${mesRef}.`,
    });
    if (error) { setErro(error.message); setLancando(null); return; }
    const { data: userData } = await supabase.auth.getUser();
    const { error: errVale } = await supabase.from("vales_mensais").insert({
      mes: mesRef, pessoa_id: pessoa.id, valor, data_pagamento: dia20,
      conta_pagar_id: contaId, criado_por: userData?.user?.id || null,
    });
    if (errVale) { setErro(errVale.message); setLancando(null); return; }
    setValores((v) => ({ ...v, [pessoa.id]: "" }));
    setLancando(null);
    aoMudar();
  };

  const desfazer = async (pessoa) => {
    setLancando(pessoa.id);
    setErro("");
    const registro = vales[pessoa.id];
    await supabase.from("vales_mensais").delete().eq("mes", mesRef).eq("pessoa_id", pessoa.id);
    if (registro?.conta_pagar_id) {
      await supabase.from("contas_pagar").delete().eq("id", registro.conta_pagar_id);
    }
    setLancando(null);
    aoMudar();
  };

  if (mensalistas.length === 0) return null;

  return (
    <div style={{ ...cardStyle, marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ ...sectionLabel, marginBottom: 0, flex: 1, minWidth: 120 }}>
          Vales do dia 20
        </div>
        {totalVales > 0 && (
          <span style={{ fontSize: 13, fontWeight: 800, color: "#185FA5" }}>{brl(totalVales)}</span>
        )}
        <button onClick={() => setAberto((a) => !a)} style={{ ...linkBtn, fontSize: 11 }}>
          {aberto ? "fechar" : jaLancados.length > 0 ? `${jaLancados.length} lançado(s) · abrir` : "lançar"}
        </button>
      </div>

      {aberto && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 11.5, color: "#8A8778", lineHeight: 1.6 }}>
            Adiantamento pago em <b>{dia20.split("-").reverse().join("/")}</b>. Vai
            para a conta <b>4.1 Salários</b> como despesa já quitada, e o
            fechamento do mês desconta automaticamente do que falta pagar.
          </div>
          {mensalistas.map((p) => {
            const vale = vales[p.id];
            return (
              <div key={p.id} style={{ ...itemRowVale }}>
                <div style={{ flex: 1, minWidth: 130 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#22231F" }}>{p.nome}</div>
                  <div style={{ fontSize: 11, color: "#8A8778" }}>
                    {PAPEL_LABEL[p.papel]}
                    {p.salario_base ? ` · salário ${brl(p.salario_base)}` : ""}
                  </div>
                </div>
                {vale ? (
                  <>
                    <span style={{ ...pillFiado, background: "#37A0E522", border: "1px solid #37A0E540", color: "#185FA5" }}>
                      vale {brl(vale.valor)} pago
                    </span>
                    <button onClick={() => desfazer(p)} disabled={lancando === p.id} style={{ ...linkBtn, fontSize: 11 }}>
                      {lancando === p.id ? "..." : "desfazer"}
                    </button>
                  </>
                ) : (
                  <>
                    <input
                      value={valores[p.id] ?? ""}
                      onChange={(e) => setValores((v) => ({ ...v, [p.id]: e.target.value }))}
                      placeholder="Valor"
                      inputMode="decimal"
                      style={{ ...inputStyle, width: 96, padding: "7px 9px", fontSize: 12 }}
                    />
                    <button onClick={() => lancar(p)} disabled={lancando === p.id}
                      style={{ ...btnMiniEscuro }}>
                      {lancando === p.id ? "..." : "Lançar vale"}
                    </button>
                  </>
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
// A regra da comissão, escrita onde ela é configurada
//
// Ela morava só no código. Quem abria a Matriz via dois numeros por cargo e
// nenhuma pista de como o dinheiro da noite se reparte — e era a duvida que
// mais voltava.
// ---------------------------------------------------------------------------
function ComoDivideComissao() {
  const [aberto, setAberto] = useState(false);
  return (
    <div style={{ ...cardStyle, marginBottom: 14, padding: 12 }}>
      <button onClick={() => setAberto((a) => !a)}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer", width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...sectionLabel, marginBottom: 0, flex: 1 }}>Como a comissão do dia é dividida</span>
        <span style={{ fontSize: 11, color: "#8A8778" }}>{aberto ? "fechar" : "ver a regra"}</span>
      </button>

      {aberto && (
        <div style={{ marginTop: 12 }}>
          {/* o racha ao meio */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 150, background: "#37A0E522", border: "1px solid #37A0E555", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: "#185FA5" }}>Garçons · 50%</div>
              <div style={{ fontSize: 12, color: "#8A8778", marginTop: 3 }}>dividido por cabeça entre os garçons da noite</div>
            </div>
            <div style={{ flex: 1, minWidth: 150, background: "#FAC77540", border: "1px solid #FAC77599", borderRadius: 10, padding: "10px 12px" }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", color: "#854F0B" }}>Equipe interna · 50%</div>
              <div style={{ fontSize: 12, color: "#8A8778", marginTop: 3 }}>caixa · bar · chapa · cozinha · limpeza</div>
            </div>
          </div>

          <div style={{ background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10, padding: "11px 13px", marginTop: 10, fontSize: 12.5, lineHeight: 2, fontVariantNumeric: "tabular-nums" }}>
            <span style={{ color: "#8A8778" }}>fatia de cada um &nbsp;=&nbsp;</span> metade da taxa <span style={{ color: "#8A8778" }}>÷</span> quantas pessoas naquele bolo<br />
            <span style={{ color: "#8A8778" }}>método comissão =&nbsp;</span> diária base do cargo <span style={{ color: "#8A8778" }}>+</span> fatia<br />
            <span style={{ color: "#8A8778" }}>método hora &nbsp;&nbsp;&nbsp;&nbsp;=&nbsp;</span> horas trabalhadas <span style={{ color: "#8A8778" }}>×</span> valor da hora
          </div>

          <div style={{ fontSize: 12, color: "#8A8778", marginTop: 10, lineHeight: 1.7 }}>
            <b style={{ color: "#22231F" }}>Por cabeça, não por hora.</b> Quem esticou o turno não leva
            comissão maior que o colega do mesmo bolo — o que muda com as horas
            é só o método hora.
            <div style={{ marginTop: 6 }}>
              <b style={{ color: "#22231F" }}>A diária base é cheia.</b> Trabalhou a noite, leva a base do
              cargo, mesmo em jornada curta.
            </div>
            <div style={{ marginTop: 6 }}>
              <b style={{ color: "#22231F" }}>Diarista recebe o maior dos dois métodos.</b> Registrado leva
              só a fatia da comissão — o salário dele fecha no mês. Gerente não
              entra na divisão: recebe 2% do faturamento bruto, também no mês.
            </div>
          </div>

          <div style={{ ...avisoStyle, marginTop: 10 }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12 }}>
              Dias fechados antes de 22/08/2026 foram calculados pela regra
              antiga, que rateava por hora e inflava a base. Para recalcular um
              deles, abra a Escala do dia, clique em <b>Editar</b> e depois em
              <b> Calcular e salvar</b>.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fechamento mensal
// ---------------------------------------------------------------------------
function FechamentoMensal() {
  // Contador que faz o painel "Corrigir no CardápioWeb" recarregar quando
  // uma dívida nova nasce, sem precisar recarregar a tela inteira.
  const [correcoesVersao, setCorrecoesVersao] = useState(0);
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
  const [nomeDeQuemImprime, setNomeDeQuemImprime] = useState("");
  // A aba Fechamento mensal so aparece pra administrador (SUBABAS.soAdmin),
  // entao quem chega aqui ja passou pelo gate.
  const [vales, setVales] = useState({}); // pessoa_id -> { valor, data_pagamento }
  const fiado = useFiadoEquipe(pessoas, true);
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
      supabase.from("premiacoes_diarias").select("pessoa_id, dia, total_dia, comissao, metodo_usado, faturamento_dia, papel_no_dia, pessoa:pessoas(nome, papel, tipo_contrato)").gte("dia", inicio).lte("dia", fim),
      supabase.from("pessoas").select("*").eq("ativo", true),
      supabase.from("faturamento_mensal").select("*").eq("mes_referencia", mesRef).maybeSingle(),
    ]);
    setFaturamentoMes(faturamentoData || null);
    const mapaSalario = Object.fromEntries((pessoasData || []).map((p) => [p.id, p]));
    const porPessoa = {};
    // Noites da gerente REGISTRADA: o percentual de cada dia trabalhado.
    // A diarista não entra — ela já recebeu na saída daquela noite.
    const porGerente = {};
    (premiacoes || []).forEach((pr) => {
      if (pr.pessoa?.tipo_contrato !== "registrado") return; // diarista já recebeu por dia
      if (pr.pessoa?.papel === "gerente") {
        if (!porGerente[pr.pessoa_id]) porGerente[pr.pessoa_id] = { dias: 0, comissao: 0, faturamento: 0 };
        porGerente[pr.pessoa_id].dias += 1;
        porGerente[pr.pessoa_id].comissao += Number(pr.total_dia) || 0;
        porGerente[pr.pessoa_id].faturamento += Number(pr.faturamento_dia) || 0;
        return;
      }
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
    // Gerente diarista NÃO aparece no mensal: recebeu noite a noite,
    // como qualquer outro diarista. Da registrada, o percentual sai da
    // soma das noites em que ela realmente trabalhou — não de 2% do mês
    // inteiro, que era o que valia até 26/08/2026 e pagava também as
    // noites em que ela não foi escalada. Com duas gerentes isso pagaria
    // o percentual duas vezes sobre o mesmo faturamento.
    const listaGerentes = (pessoasData || [])
      .filter((p) => p.papel === "gerente" && p.tipo_contrato !== "diarista")
      .map((p) => {
        const noites = porGerente[p.id] || { dias: 0, comissao: 0, faturamento: 0 };
        const salarioBase = p.salario_base || 0;
        return {
          pessoaId: p.id, nome: p.nome, salarioBase,
          dias: noites.dias,
          faturamentoBruto: noites.faturamento,
          doisPorcento: noites.comissao,
          total: salarioBase + noites.comissao,
        };
      });
    setGerentes(listaGerentes);
    const { data: usuarioAtual } = await supabase.auth.getUser();
    if (usuarioAtual?.user?.id) {
      const { data: meuPerfil } = await supabase
        .from("perfis").select("nome").eq("id", usuarioAtual.user.id).maybeSingle();
      setNomeDeQuemImprime(meuPerfil?.nome || "");
    }
    const { data: valesData } = await supabase
      .from("vales_mensais").select("pessoa_id, valor, data_pagamento").eq("mes", mesRef);
    setVales(Object.fromEntries((valesData || []).map((v) => [v.pessoa_id, v])));
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
    // O vale do dia 20 ja foi lancado na conta 4.1 quando foi pago. Se o
    // fechamento lancasse o salario cheio, o DRE contaria duas vezes.
    const valeJaPago = pessoaId ? Number(vales[pessoaId]?.valor || 0) : 0;
    const liquido = round2(valor - desconto - valeJaPago);
    const { data: userData } = await supabase.auth.getUser();
    const [ano, mes] = mesRef.split("-").map(Number);
    const fimMes = new Date(ano, mes, 0).toISOString().slice(0, 10);
    const descricao = `${nome} — Fechamento ${mesRef}`;
    const { error } = await supabase.from("contas_pagar").insert({
      descricao: [
        descricao,
        desconto > 0 ? `fiado ${brl(desconto)}` : null,
        valeJaPago > 0 ? `vale ${brl(valeJaPago)}` : null,
      ].filter(Boolean).length > 1
        ? `${descricao} (${[desconto > 0 ? `fiado ${brl(desconto)}` : null, valeJaPago > 0 ? `vale ${brl(valeJaPago)}` : null].filter(Boolean).join(" e ")} descontado)`
        : descricao,
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
          <PainelSemDono fiado={fiado} pessoas={pessoas} aoMudarPessoas={carregar}
                aoMudarCorrecoes={() => setCorrecoesVersao((v) => v + 1)} />
          <NomesVinculados fiado={fiado} pessoas={pessoas} />
          <CorrigirNoCardapioWeb fiado={fiado} recarregar={correcoesVersao} />
          <ValesDoMes
            mesRef={mesRef}
            pessoas={pessoas}
            vales={vales}
            aoMudar={carregar}
            setErro={setErro}
          />
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
                  {((fiado.buscou && fiado.saldoDe(l.pessoaId) > 0) || vales[l.pessoaId]) && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px 8px", flexWrap: "wrap" }}>
                      {fiado.buscou && fiado.saldoDe(l.pessoaId) > 0 && (
                        <ChipFiado fiado={fiado} pessoaId={l.pessoaId} />
                      )}
                      {vales[l.pessoaId] && (
                        <span style={{ ...pillFiado, background: "#37A0E522", border: "1px solid #37A0E540", color: "#185FA5" }}>
                          vale {brl(vales[l.pessoaId].valor)} pago
                        </span>
                      )}
                      <span style={{ fontSize: 11, color: "#8A8778" }}>
                        a pagar <strong style={{ color: "#22231F" }}>
                          {brl(l.total - (fiado.buscou ? fiado.descontoDe(l.pessoaId) : 0) - Number(vales[l.pessoaId]?.valor || 0))}
                        </strong>
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
                <div style={{ fontSize: 10, color: "#8A8778", marginTop: 3, maxWidth: 320, lineHeight: 1.5 }}>
                  Número de acompanhamento. O percentual da gerência não sai daqui: sai noite a noite,
                  só das noites em que ela esteve na escala.
                </div>
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
                      <span>
                        Percentual de {g.dias} noite{g.dias === 1 ? "" : "s"} na escala
                        {g.faturamentoBruto > 0 ? ` (faturamento ${brl(g.faturamentoBruto)})` : ""}
                      </span>
                      <span>{brl(g.doisPorcento)}</span>
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

          {(linhas.length > 0 || gerentes.length > 0) && (
            <>
              <BotaoPdf>Baixar fechamento em PDF</BotaoPdf>
              <FolhaFechamento
                mesRef={mesRef}
                linhas={linhas}
                gerentes={gerentes}
                vales={vales}
                fiado={fiado}
                emitidoPor={nomeDeQuemImprime}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
function round2(n) { return Math.round(n * 100) / 100; }
const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const seloBase = {
  fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 999,
  textTransform: "uppercase", letterSpacing: 0.3, textAlign: "center", whiteSpace: "nowrap",
};
const seloGarcom = { ...seloBase, background: "#37A0E522", color: "#185FA5", border: "1px solid #37A0E555" };
const seloInterna = { ...seloBase, background: "#FAC77540", color: "#854F0B", border: "1px solid #FAC77599" };
const seloFora = { ...seloBase, background: "#F6F1E7", color: "#8A8778", border: "1px solid #E8E2D2" };
const seloGerencia = { ...seloBase, background: "#EAE4F7", color: "#4C3E77", border: "1px solid #C9BEE8" };
// Cinco colunas na matriz: cargo, bolo, diária, percentual, valor hora.
const gradeMatriz = "1fr 1.3fr 0.85fr 0.85fr 0.85fr";
const celulaMatriz = {
  padding: "5px 6px", borderRadius: 6, border: "1px solid #E8E2D2",
  fontSize: 12, textAlign: "right", width: "100%", boxSizing: "border-box",
};
const celulaVazia = { fontSize: 12, textAlign: "right", color: "#B8B2A2", padding: "5px 6px" };
const rotuloMini = {
  fontSize: 9.5, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778",
};
const botaoOpcao = {
  background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8,
  padding: "6px 11px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
const botaoOpcaoAtiva = { ...botaoOpcao, background: "#22231F", color: "#FFFFFF", borderColor: "#22231F" };
const pillFiado = {
  fontSize: 11.5, fontWeight: 700, padding: "4px 10px", borderRadius: 999, whiteSpace: "nowrap",
};
const itemRowVale = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10,
  padding: "8px 11px", flexWrap: "wrap",
};
const btnPdf = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
  background: "#F2D742", border: "1px solid #D9BE2C", color: "#4A3B06",
  borderRadius: 10, padding: "11px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer",
};
const btnMiniEscuro = {
  background: "#22231F", color: "#F3EFE3", border: "1px solid #22231F", borderRadius: 8,
  padding: "5px 11px", fontSize: 11.5, fontWeight: 700, cursor: "pointer",
};
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
