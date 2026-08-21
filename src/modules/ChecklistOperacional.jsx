import React, { useState, useEffect, useCallback } from "react";
import {
  CheckCircle2, XCircle, Clock, AlertTriangle, ChevronLeft,
  LayoutDashboard, Flame, Wine, CircleDollarSign, Utensils, ClipboardList,
  ShieldCheck, Loader2, Pencil, Trash2, Plus, Check,
} from "lucide-react";
import { supabase, TABELA_CHECKLIST } from "../lib/supabaseClient";
// ---------------------------------------------------------------------------
// Aparência dos departamentos
//
// ATENÇÃO: este objeto NÃO é mais a lista de departamentos — é só o visual
// (nome bonito, ícone e cor). Quem manda na lista é o banco: todo
// departamento com item cadastrado em `checklist_itens` ganha um card.
//
// Antes a lista era fixa aqui, e por isso um cargo novo podia existir no
// banco e nunca aparecer na tela. Cargo que não estiver neste objeto
// continua funcionando — só herda um nome derivado da chave e um ícone
// genérico.
// ---------------------------------------------------------------------------
const APARENCIA = {
  caixa:    { label: "Caixa",    icon: CircleDollarSign, cor: "#C9A227" },
  bar:      { label: "Bar",      icon: Wine,             cor: "#2F8F5B" },
  chapa:    { label: "Chapa",    icon: Flame,            cor: "#C4432B" },
  gerencia: { label: "Gerência", icon: ShieldCheck,      cor: "#4A5D8A" },
  garcom:   { label: "Garçom",   icon: Utensils,         cor: "#8A6A0F" },
};
const APARENCIA_PADRAO = { icon: ClipboardList, cor: "#8A8778" };
function aparenciaDe(chave) {
  if (APARENCIA[chave]) return APARENCIA[chave];
  // Cargo criado pela tela e sem entrada aqui: "entregador" -> "Entregador"
  const label = String(chave || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  return { ...APARENCIA_PADRAO, label };
}
// Nome digitado -> chave do banco. O banco exige minúsculo, sem acento e
// sem espaço (constraint checklist_itens_departamento_check).
function chaveDoNome(nome) {
  const base = String(nome || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!base) return "";
  return /^[a-z]/.test(base) ? base : `c_${base}`;
}
const TURNOS = ["abertura", "fechamento"];
// ---------------------------------------------------------------------------
// Helpers de dia operacional (17h -> 17h do dia seguinte)
// ---------------------------------------------------------------------------
function pad(n) { return String(n).padStart(2, "0"); }
function toDateStr(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function diaOperacional(date = new Date()) {
  const d = new Date(date);
  if (d.getHours() < 17) d.setDate(d.getDate() - 1);
  return toDateStr(d);
}
function formatDiaLabel(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
}
function podePreencher(etapa) {
  const h = new Date().getHours();
  if (etapa === "abertura") return h >= 17 || h < 2;
  if (etapa === "fechamento") return h >= 2 && h < 17;
  return true;
}
function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(null);
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data?.user) { setIsAdmin(false); return; }
      const { data: perfil } = await supabase.from("perfis").select("is_admin").eq("id", data.user.id).maybeSingle();
      setIsAdmin(perfil?.is_admin || false);
    });
  }, []);
  return isAdmin;
}
// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export default function ChecklistOperacional({ nomeUsuario, onVoltar }) {
  const [tela, setTela] = useState("home");
  const [deptAtual, setDeptAtual] = useState(null);
  const [etapaAtual, setEtapaAtual] = useState(null);
  const [itens, setItens] = useState({});
  const [salvando, setSalvando] = useState(false);
  const [carregandoItem, setCarregandoItem] = useState(false);
  const [jaEnviado, setJaEnviado] = useState(false);
  const [modoTeste, setModoTeste] = useState(false);
  const [erro, setErro] = useState("");
  const [itensDb, setItensDb] = useState({}); // departamento -> turno -> [texto, ...] (ordenado)
  const [carregandoDepts, setCarregandoDepts] = useState(true);
  const isAdmin = useIsAdmin();
  const opDate = diaOperacional();
  // A lista de departamentos vem daqui: quem tem item cadastrado, aparece.
  const carregarItensDb = useCallback(async () => {
    setCarregandoDepts(true);
    const { data } = await supabase.from("checklist_itens").select("*").eq("ativo", true).order("ordem");
    const mapa = {};
    (data || []).forEach((it) => {
      if (!mapa[it.departamento]) mapa[it.departamento] = { abertura: [], fechamento: [] };
      if (!mapa[it.departamento][it.turno]) mapa[it.departamento][it.turno] = [];
      mapa[it.departamento][it.turno].push(it.texto);
    });
    setItensDb(mapa);
    setCarregandoDepts(false);
  }, []);
  useEffect(() => { carregarItensDb(); }, [carregarItensDb]);
  // Ordem dos cards: os conhecidos primeiro, na ordem do APARENCIA; os
  // criados depois entram em seguida, em ordem alfabética.
  const deptKeys = React.useMemo(() => {
    const doBanco = Object.keys(itensDb);
    const conhecidos = Object.keys(APARENCIA).filter((k) => doBanco.includes(k));
    const novos = doBanco.filter((k) => !APARENCIA[k]).sort();
    return [...conhecidos, ...novos];
  }, [itensDb]);
  const abrirChecklist = async (deptKey, etapa) => {
    setErro("");
    setDeptAtual(deptKey);
    setEtapaAtual(etapa);
    setJaEnviado(false);
    setItens({});
    setCarregandoItem(true);
    setTela("checklist");
    const { data, error } = await supabase
      .from(TABELA_CHECKLIST)
      .select("itens, responsavel")
      .eq("dia_operacional", opDate)
      .eq("departamento", deptKey)
      .eq("etapa", etapa)
      .maybeSingle();
    if (error) {
      setErro("Não foi possível carregar o checklist: " + error.message);
    } else if (data) {
      setItens(data.itens || {});
      setJaEnviado(true);
    }
    setCarregandoItem(false);
  };
  const marcarItem = (itemLabel, status) => {
    setItens((prev) => ({ ...prev, [itemLabel]: status }));
  };
  const listaItensAtual = deptAtual && etapaAtual ? (itensDb[deptAtual]?.[etapaAtual] || []) : [];
  const totalItens = listaItensAtual.length;
  const totalPreenchidos = listaItensAtual.filter((i) => itens[i]).length;
  const completo = totalItens > 0 && totalPreenchidos === totalItens;
  const salvarChecklist = async () => {
    if (!completo) {
      setErro(`Preencha todos os itens (${totalPreenchidos}/${totalItens}) antes de salvar.`);
      return;
    }
    setSalvando(true);
    setErro("");
    const { error } = await supabase.from(TABELA_CHECKLIST).upsert(
      {
        dia_operacional: opDate,
        departamento: deptAtual,
        etapa: etapaAtual,
        responsavel: nomeUsuario,
        itens,
        completado_em: new Date().toISOString(),
      },
      { onConflict: "dia_operacional,departamento,etapa" }
    );
    if (error) {
      setErro("Não foi possível salvar: " + error.message);
    } else {
      setJaEnviado(true);
    }
    setSalvando(false);
  };
  if (tela === "home") {
    return (
      <Shell titulo="Checklist Operacional" subtitulo={`Olá, ${nomeUsuario} · Dia operacional ${formatDiaLabel(opDate)}`}
        onBack={onVoltar} onDashboard={() => setTela("dashboard")}>
        {carregandoDepts ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#8A8778", fontSize: 13 }}>
            <Loader2 size={16} /> Carregando…
          </div>
        ) : (
          <div className="cards-grid">
            {deptKeys.map((k) => {
              const dept = aparenciaDe(k);
              const Icon = dept.icon;
              return (
                <div key={k} style={cardStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <div style={{ width: 34, height: 34, borderRadius: 8, background: dept.cor + "22", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <Icon size={18} color={dept.cor} />
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: "#22231F" }}>{dept.label}</div>
                  </div>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button style={{ ...btnSecondary, opacity: podePreencher("abertura") || modoTeste ? 1 : 0.5 }}
                      onClick={() => abrirChecklist(k, "abertura")}>
                      Abertura
                    </button>
                    <button style={{ ...btnSecondary, opacity: podePreencher("fechamento") || modoTeste ? 1 : 0.5 }}
                      onClick={() => abrirChecklist(k, "fechamento")}>
                      Fechamento
                    </button>
                  </div>
                </div>
              );
            })}
            {deptKeys.length === 0 && (
              <div style={{ ...cardStyle, fontSize: 13, color: "#8A8778" }}>
                Nenhum cargo com checklist cadastrado ainda.{isAdmin ? " Use \"Editar checklist\" para criar o primeiro." : ""}
              </div>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#8A8778", marginTop: 4 }}>
              <input type="checkbox" checked={modoTeste} onChange={(e) => setModoTeste(e.target.checked)} />
              Modo teste (ignorar horário de abertura/fechamento)
            </label>
            {isAdmin && (
              <button onClick={() => setTela("editar")} style={{ ...btnSecondary, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 4 }}>
                <Pencil size={14} /> Editar checklist
              </button>
            )}
          </div>
        )}
      </Shell>
    );
  }
  if (tela === "checklist") {
    const dept = aparenciaDe(deptAtual);
    const bloqueado = !modoTeste && !podePreencher(etapaAtual);
    return (
      <Shell titulo={`${dept.label} · ${etapaAtual === "abertura" ? "Abertura" : "Fechamento"}`}
        subtitulo={formatDiaLabel(opDate)} onBack={() => setTela("home")}>
        {carregandoItem ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#8A8778", fontSize: 13 }}>
            <Loader2 size={16} /> Carregando…
          </div>
        ) : bloqueado ? (
          <div style={avisoBloqueio}>
            <Clock size={16} />
            {etapaAtual === "abertura"
              ? "O preenchimento de abertura só é liberado a partir das 17h."
              : "O preenchimento de fechamento só é liberado a partir das 02h."}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ fontSize: 13, color: "#8A8778" }}>{totalPreenchidos}/{totalItens} itens</div>
              {jaEnviado && <div style={{ display: "flex", alignItems: "center", gap: 4, color: "#2F8F5B", fontSize: 13, fontWeight: 600 }}><CheckCircle2 size={15} /> Enviado</div>}
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {listaItensAtual.map((item) => (
                <div key={item} style={itemRow}>
                  <div style={{ fontSize: 14, color: "#22231F", flex: 1 }}>{item}</div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => marcarItem(item, "conforme")}
                      style={{ ...pillBtn, ...(itens[item] === "conforme" ? pillOk : {}) }}>
                      <CheckCircle2 size={14} /> Conforme
                    </button>
                    <button onClick={() => marcarItem(item, "nao_conforme")}
                      style={{ ...pillBtn, ...(itens[item] === "nao_conforme" ? pillNok : {}) }}>
                      <XCircle size={14} /> Não conforme
                    </button>
                  </div>
                </div>
              ))}
              {listaItensAtual.length === 0 && (
                <div style={{ fontSize: 13, color: "#8A8778" }}>Esse turno ainda não tem item cadastrado.</div>
              )}
            </div>
            {erro && <div style={{ color: "#C4432B", fontSize: 13, marginTop: 10 }}>{erro}</div>}
            <button onClick={salvarChecklist} disabled={salvando} style={{ ...btnPrimary, marginTop: 16, width: "100%" }}>
              {salvando ? <Loader2 size={16} /> : <CheckCircle2 size={16} />}
              {jaEnviado ? "Atualizar checklist" : "Salvar checklist"}
            </button>
          </>
        )}
      </Shell>
    );
  }
  if (tela === "dashboard") {
    return <Dashboard onBack={() => setTela("home")} opDateHoje={opDate} itensDb={itensDb} deptKeys={deptKeys} />;
  }
  if (tela === "editar") {
    return <EditarChecklist onBack={() => { setTela("home"); carregarItensDb(); }} />;
  }
  return null;
}
// ---------------------------------------------------------------------------
// Edição do checklist (só admin) — cargos, itens, e criação de cargo novo
// ---------------------------------------------------------------------------
function EditarChecklist({ onBack }) {
  const [itens, setItens] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [editandoId, setEditandoId] = useState(null);
  const [textoEdicao, setTextoEdicao] = useState("");
  const [novoTexto, setNovoTexto] = useState({}); // `${dept}:${turno}` -> texto sendo digitado
  // Cargo recém-criado ainda não tem item, então não vem do banco —
  // fica aqui até o primeiro item ser salvo.
  const [deptsExtras, setDeptsExtras] = useState([]);
  const [criandoCargo, setCriandoCargo] = useState(false);
  const [nomeCargo, setNomeCargo] = useState("");
  const carregar = useCallback(async () => {
    setCarregando(true);
    const { data, error } = await supabase.from("checklist_itens").select("*").eq("ativo", true).order("ordem");
    if (error) setErro(error.message);
    setItens(data || []);
    setCarregando(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);
  const deptKeys = React.useMemo(() => {
    const doBanco = [...new Set(itens.map((i) => i.departamento))];
    const todos = [...new Set([...doBanco, ...deptsExtras])];
    const conhecidos = Object.keys(APARENCIA).filter((k) => todos.includes(k));
    const novos = todos.filter((k) => !APARENCIA[k]).sort();
    return [...conhecidos, ...novos];
  }, [itens, deptsExtras]);
  const criarCargo = () => {
    const chave = chaveDoNome(nomeCargo);
    if (!chave) { setErro("Digite um nome válido para o cargo."); return; }
    if (deptKeys.includes(chave)) { setErro(`O cargo "${aparenciaDe(chave).label}" já existe.`); return; }
    setDeptsExtras((prev) => [...prev, chave]);
    setNomeCargo("");
    setCriandoCargo(false);
    setErro("");
  };
  const salvarEdicao = async (id) => {
    const texto = textoEdicao.trim();
    if (!texto) return;
    const { error } = await supabase.from("checklist_itens").update({ texto }).eq("id", id);
    if (error) { setErro(error.message); return; }
    setEditandoId(null);
    carregar();
  };
  const excluir = async (item) => {
    if (!window.confirm(`Remover "${item.texto}" do checklist de ${aparenciaDe(item.departamento).label}?`)) return;
    const { error } = await supabase.from("checklist_itens").update({ ativo: false }).eq("id", item.id);
    if (error) { setErro(error.message); return; }
    carregar();
  };
  const adicionar = async (departamento, turno) => {
    const chave = `${departamento}:${turno}`;
    const texto = (novoTexto[chave] || "").trim();
    if (!texto) return;
    const maiorOrdem = Math.max(0, ...itens.filter((i) => i.departamento === departamento && i.turno === turno).map((i) => i.ordem));
    const { error } = await supabase.from("checklist_itens").insert({ departamento, turno, texto, ordem: maiorOrdem + 1 });
    if (error) { setErro(error.message); return; }
    setNovoTexto((prev) => ({ ...prev, [chave]: "" }));
    carregar();
  };
  return (
    <div style={pageStyle}>
      <div className="app-shell">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <button onClick={onBack} style={iconBtn}><ChevronLeft size={18} /></button>
          <div style={{ fontWeight: 800, fontSize: 17, color: "#22231F" }}>Editar checklist</div>
        </div>
        {erro && <div style={{ color: "#C4432B", fontSize: 13, marginBottom: 14 }}>{erro}</div>}
        <div style={{ marginBottom: 20 }}>
          {criandoCargo ? (
            <div style={{ display: "flex", gap: 6 }}>
              <input value={nomeCargo} onChange={(e) => setNomeCargo(e.target.value)} autoFocus
                onKeyDown={(e) => e.key === "Enter" && criarCargo()}
                placeholder="Nome do cargo (ex.: Entregador)"
                style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13 }} />
              <button onClick={criarCargo} style={{ ...btnSecondary, flex: "none", padding: "8px 14px" }}>Criar</button>
              <button onClick={() => { setCriandoCargo(false); setNomeCargo(""); }} style={{ ...ghostIconBtn, color: "#8A6A0F", fontSize: 13, fontWeight: 600 }}>Cancelar</button>
            </div>
          ) : (
            <button onClick={() => setCriandoCargo(true)} style={{ ...btnSecondary, flex: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
              <Plus size={14} /> Novo cargo
            </button>
          )}
          {criandoCargo && (
            <div style={{ fontSize: 11, color: "#8A8778", marginTop: 6 }}>
              O cargo aparece na tela inicial assim que tiver o primeiro item cadastrado.
            </div>
          )}
        </div>
        {carregando ? (
          <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
        ) : (
          deptKeys.map((deptKey) => (
            <div key={deptKey} style={{ marginBottom: 24 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: "#22231F", marginBottom: 10 }}>{aparenciaDe(deptKey).label}</div>
              {TURNOS.map((turno) => {
                const chave = `${deptKey}:${turno}`;
                const itensDoGrupo = itens.filter((i) => i.departamento === deptKey && i.turno === turno);
                return (
                  <div key={turno} style={{ marginBottom: 14 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#8A8778", textTransform: "uppercase", marginBottom: 6 }}>
                      {turno === "abertura" ? "Abertura" : "Fechamento"}
                    </div>
                    <div style={{ border: "1px solid #E8E2D2", borderRadius: 10, overflow: "hidden", background: "#FFFFFF", marginBottom: 6 }}>
                      {itensDoGrupo.map((item, idx) => (
                        <div key={item.id} style={{ padding: "8px 12px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", display: "flex", alignItems: "center", gap: 8 }}>
                          {editandoId === item.id ? (
                            <>
                              <input value={textoEdicao} onChange={(e) => setTextoEdicao(e.target.value)} autoFocus
                                onKeyDown={(e) => e.key === "Enter" && salvarEdicao(item.id)}
                                style={{ flex: 1, padding: "5px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13 }} />
                              <button onClick={() => salvarEdicao(item.id)} style={{ ...ghostIconBtn, color: "#2F8F5B" }} aria-label="Salvar"><Check size={16} /></button>
                            </>
                          ) : (
                            <>
                              <span style={{ flex: 1, fontSize: 13, color: "#22231F" }}>{item.texto}</span>
                              <button onClick={() => { setEditandoId(item.id); setTextoEdicao(item.texto); }} style={ghostIconBtn} aria-label="Editar item"><Pencil size={14} /></button>
                              <button onClick={() => excluir(item)} style={{ ...ghostIconBtn, color: "#C4432B" }} aria-label="Excluir item"><Trash2 size={14} /></button>
                            </>
                          )}
                        </div>
                      ))}
                      {itensDoGrupo.length === 0 && <div style={{ padding: 12, fontSize: 12, color: "#8A8778" }}>Nenhum item ainda.</div>}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <input value={novoTexto[chave] || ""} onChange={(e) => setNovoTexto((prev) => ({ ...prev, [chave]: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && adicionar(deptKey, turno)}
                        placeholder="Novo item…" style={{ flex: 1, padding: "6px 8px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 13 }} />
                      <button onClick={() => adicionar(deptKey, turno)} style={{ ...btnSecondary, flex: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 12, padding: "6px 10px" }}>
                        <Plus size={13} /> Adicionar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
// ---------------------------------------------------------------------------
// Shell / layout comum
// ---------------------------------------------------------------------------
function Shell({ titulo, subtitulo, children, onBack, onDashboard }) {
  return (
    <div style={pageStyle}>
      <div className="app-shell">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {onBack && (
              <button onClick={onBack} style={iconBtn}><ChevronLeft size={18} /></button>
            )}
            <div>
              <div style={{ fontWeight: 800, fontSize: 17, color: "#22231F" }}>{titulo}</div>
              {subtitulo && <div style={{ fontSize: 12, color: "#8A8778" }}>{subtitulo}</div>}
            </div>
          </div>
          {onDashboard && (
            <button onClick={onDashboard} style={iconBtn}><LayoutDashboard size={18} /></button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
// ---------------------------------------------------------------------------
// Dashboard
//
// Os totais vêm do banco (itensDb), não de uma lista fixa. Antes o
// "preenchido/total" comparava com a lista escrita no código — e, como os
// itens passaram a viver no banco, esse total ficava errado sempre que
// alguém acrescentava ou removia um item pelo Editar checklist.
// ---------------------------------------------------------------------------
function Dashboard({ onBack, opDateHoje, itensDb, deptKeys }) {
  const [diaSelecionado, setDiaSelecionado] = useState(opDateHoje);
  const [mesSelecionado, setMesSelecionado] = useState(opDateHoje.slice(0, 7));
  const [carregando, setCarregando] = useState(true);
  const [statusDia, setStatusDia] = useState({});
  const [alertas, setAlertas] = useState([]);
  const [resumoMes, setResumoMes] = useState(null);
  const [erroCarregamento, setErroCarregamento] = useState("");
  const carregarDia = useCallback(async (dia) => {
    setCarregando(true);
    setErroCarregamento("");
    const status = {};
    deptKeys.forEach((deptKey) => {
      TURNOS.forEach((etapa) => {
        status[`${deptKey}:${etapa}`] = { preenchido: 0, total: (itensDb[deptKey]?.[etapa] || []).length, ok: false };
      });
    });
    const { data, error } = await supabase
      .from(TABELA_CHECKLIST)
      .select("*")
      .eq("dia_operacional", dia);
    if (error) {
      setErroCarregamento("Erro ao carregar dados do dia: " + error.message);
      setCarregando(false);
      return;
    }
    const novosAlertas = [];
    (data || []).forEach((row) => {
      const total = (itensDb[row.departamento]?.[row.etapa] || []).length;
      const entries = Object.entries(row.itens || {});
      status[`${row.departamento}:${row.etapa}`] = {
        preenchido: entries.length,
        total,
        ok: entries.length === total && total > 0,
      };
      entries.forEach(([item, st]) => {
        if (st === "nao_conforme") {
          novosAlertas.push({ dept: aparenciaDe(row.departamento).label, etapa: row.etapa, item, responsavel: row.responsavel });
        }
      });
    });
    setStatusDia(status);
    setAlertas(novosAlertas);
    setCarregando(false);
  }, [itensDb, deptKeys]);
  const carregarMes = useCallback(async (mes) => {
    const [ano, mesNum] = mes.split("-").map(Number);
    const inicio = `${ano}-${pad(mesNum)}-01`;
    const diasNoMes = new Date(ano, mesNum, 0).getDate();
    const fim = `${ano}-${pad(mesNum)}-${pad(diasNoMes)}`;
    const { data, error } = await supabase
      .from(TABELA_CHECKLIST)
      .select("*")
      .gte("dia_operacional", inicio)
      .lte("dia_operacional", fim);
    if (error) {
      setErroCarregamento("Erro ao carregar dados do mês: " + error.message);
      return;
    }
    let totalItensMes = 0;
    let totalNaoConforme = 0;
    let checklistsPreenchidos = 0;
    const porPessoa = {};
    (data || []).forEach((row) => {
      const entries = Object.entries(row.itens || {});
      if (entries.length === 0) return;
      checklistsPreenchidos += 1;
      const pessoa = row.responsavel || "Não identificado";
      if (!porPessoa[pessoa]) porPessoa[pessoa] = { total: 0, naoConforme: 0, checklists: 0 };
      porPessoa[pessoa].checklists += 1;
      entries.forEach(([, st]) => {
        totalItensMes += 1;
        porPessoa[pessoa].total += 1;
        if (st === "nao_conforme") {
          totalNaoConforme += 1;
          porPessoa[pessoa].naoConforme += 1;
        }
      });
    });
    const pessoasArr = Object.entries(porPessoa).map(([nome, v]) => ({
      nome,
      checklists: v.checklists,
      percNaoConforme: v.total > 0 ? (v.naoConforme / v.total) * 100 : 0,
    })).sort((a, b) => b.percNaoConforme - a.percNaoConforme);
    setResumoMes({
      checklistsPreenchidos,
      percGeral: totalItensMes > 0 ? (totalNaoConforme / totalItensMes) * 100 : 0,
      totalNaoConforme,
      pessoas: pessoasArr,
    });
  }, []);
  useEffect(() => { carregarDia(diaSelecionado); }, [diaSelecionado, carregarDia]);
  useEffect(() => { carregarMes(mesSelecionado); }, [mesSelecionado, carregarMes]);
  return (
    <Shell titulo="Dashboard" subtitulo={formatDiaLabel(diaSelecionado)} onBack={onBack}>
      {erroCarregamento && (
        <div style={{ ...avisoBloqueio, marginBottom: 14 }}>
          <AlertTriangle size={16} /> {erroCarregamento}
        </div>
      )}
      <div style={{ marginBottom: 18 }}>
        <div style={sectionLabel}>Pendências do dia</div>
        <input type="date" value={diaSelecionado} onChange={(e) => setDiaSelecionado(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }} />
        {carregando ? (
          <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {deptKeys.map((k) => (
              <div key={k} style={cardStyle}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: "#22231F" }}>{aparenciaDe(k).label}</div>
                {TURNOS.map((etapa) => {
                  const s = statusDia[`${k}:${etapa}`] || { preenchido: 0, total: 0, ok: false };
                  return (
                    <div key={etapa} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", fontSize: 13 }}>
                      <span style={{ color: "#5C5A4E", textTransform: "capitalize" }}>{etapa}</span>
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: "#8A8778" }}>{s.preenchido}/{s.total}</span>
                        {s.ok ? <CheckCircle2 size={16} color="#2F8F5B" /> : <Clock size={16} color="#C9A227" />}
                      </span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ marginBottom: 18 }}>
        <div style={sectionLabel}>Alertas de não conformidade</div>
        {alertas.length === 0 && !carregando && (
          <div style={{ fontSize: 13, color: "#8A8778" }}>Nenhum item não conforme neste dia.</div>
        )}
        <div style={{ display: "grid", gap: 6 }}>
          {alertas.map((a, i) => (
            <div key={i} style={alertRow}>
              <AlertTriangle size={15} color="#C4432B" style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: "#22231F" }}>{a.item}</div>
                <div style={{ fontSize: 11, color: "#8A8778" }}>{a.dept} · {a.etapa} {a.responsavel ? `· ${a.responsavel}` : ""}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <div style={sectionLabel}>Média mensal de não conformidade</div>
        <input type="month" value={mesSelecionado} onChange={(e) => setMesSelecionado(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }} />
        {resumoMes ? (
          <>
            <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <div style={statBox}>
                <div style={statNum}>{resumoMes.checklistsPreenchidos}</div>
                <div style={statLabel}>checklists preenchidos</div>
              </div>
              <div style={statBox}>
                <div style={{ ...statNum, color: "#C4432B" }}>{resumoMes.percGeral.toFixed(1)}%</div>
                <div style={statLabel}>não conformidade geral</div>
              </div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#22231F", marginBottom: 6 }}>Por pessoa</div>
            <div style={{ display: "grid", gap: 6 }}>
              {resumoMes.pessoas.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Sem dados neste mês.</div>}
              {resumoMes.pessoas.map((p) => (
                <div key={p.nome} style={itemRow}>
                  <div style={{ fontSize: 13, color: "#22231F" }}>{p.nome}</div>
                  <div style={{ fontSize: 12, color: "#8A8778", display: "flex", gap: 10 }}>
                    <span>{p.checklists} checklists</span>
                    <span style={{ fontWeight: 700, color: p.percNaoConforme > 15 ? "#C4432B" : "#2F8F5B" }}>{p.percNaoConforme.toFixed(1)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
        )}
      </div>
    </Shell>
  );
}
// ---------------------------------------------------------------------------
// Estilos
// ---------------------------------------------------------------------------
const pageStyle = {
  fontFamily: "'Inter', system-ui, sans-serif",
  background: "#F6F1E7",
  padding: 20,
  minHeight: "100vh",
  boxSizing: "border-box",
};
const cardStyle = {
  background: "#FFFFFF",
  border: "1px solid #E8E2D2",
  borderRadius: 12,
  padding: 14,
};
const itemRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  background: "#FFFFFF",
  border: "1px solid #E8E2D2",
  borderRadius: 10,
  padding: "10px 12px",
};
const pillBtn = {
  display: "flex", alignItems: "center", gap: 4,
  fontSize: 12, fontWeight: 600, padding: "6px 10px",
  borderRadius: 999, border: "1px solid #E8E2D2", background: "#F6F1E7",
  color: "#8A8778", cursor: "pointer",
};
const pillOk = { background: "#2F8F5B22", borderColor: "#2F8F5B", color: "#2F8F5B" };
const pillNok = { background: "#C4432B22", borderColor: "#C4432B", color: "#C4432B" };
const btnPrimary = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
  background: "#22231F", color: "#F3EFE3", border: "none",
  borderRadius: 10, padding: "12px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer",
};
const btnSecondary = {
  flex: 1, background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F",
  borderRadius: 8, padding: "9px 10px", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const iconBtn = {
  width: 34, height: 34, borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#22231F",
};
const ghostIconBtn = { border: "none", background: "none", color: "#8A8778", cursor: "pointer", padding: 2, display: "flex" };
const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10,
  border: "1px solid #E8E2D2", fontSize: 14, background: "#FFFFFF", color: "#22231F",
};
const sectionLabel = {
  fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
  color: "#8A8778", marginBottom: 8,
};
const alertRow = {
  display: "flex", gap: 8, background: "#FFFFFF", border: "1px solid #F0D8CE",
  borderRadius: 10, padding: "10px 12px",
};
const avisoBloqueio = {
  display: "flex", alignItems: "center", gap: 8, background: "#FBF3D9",
  border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13,
};
const statBox = {
  flex: 1, background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12,
  padding: "12px 14px", textAlign: "center",
};
const statNum = { fontSize: 22, fontWeight: 800, color: "#22231F" };
const statLabel = { fontSize: 11, color: "#8A8778", marginTop: 2 };
