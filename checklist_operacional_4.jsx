import React, { useState, useEffect, useCallback, useMemo } from "react";
import { CheckCircle2, XCircle, Clock, AlertTriangle, ChevronLeft, LayoutDashboard, ClipboardList, Volume2, Flame, Wine, CircleDollarSign, ShieldCheck, Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Dados dos departamentos e itens de checklist
// ---------------------------------------------------------------------------
const DEPARTAMENTOS = {
  caixa: {
    label: "Caixa",
    icon: CircleDollarSign,
    cor: "#C9A227",
    abertura: [
      "Contar caixa inicial", "Conferir troco", "Ligar sistema de vendas (PDV)",
      "Testar impressora de cupom", "Verificar maquininha de cartão",
      "Conferir conexão com internet", "Organizar bancada do caixa",
      "Conferir bobinas de cupom fiscal", "Ligar ar-condicionado do salão",
      "Verificar iluminação do salão", "Conferir cardápios disponíveis",
      "Testar comunicação com a cozinha", "Verificar limpeza do caixa", "Ligar som",
    ],
    fechamento: [
      "Contar caixa final", "Conferir sangria do dia", "Emitir relatório de vendas",
      "Desligar sistema de vendas (PDV)", "Separar troco para o dia seguinte",
      "Conferir diferenças de caixa", "Organizar comprovantes e cupons",
      "Desligar impressora de cupom", "Trancar gaveta do caixa", "Desligar som",
      "Desligar ar-condicionado", "Verificar limpeza final do caixa",
    ],
  },
  bar: {
    label: "Bar",
    icon: Wine,
    cor: "#2F8F5B",
    abertura: [
      "Conferir estoque de bebidas", "Verificar validade dos insumos",
      "Organizar bancada do bar", "Testar máquina de gelo",
      "Conferir taças e copos limpos", "Verificar temperatura das geladeiras",
      "Preparar guarnições e frutas", "Conferir cardápio de drinks",
      "Testar liquidificador", "Organizar utensílios do bar", "Repor gelo",
      "Verificar limpeza do bar",
    ],
    fechamento: [
      "Conferir estoque final de bebidas", "Guardar bebidas abertas",
      "Limpar bancada do bar", "Lavar utensílios utilizados",
      "Desligar máquina de gelo", "Registrar perdas e quebras",
      "Conferir consumo interno", "Organizar geladeiras", "Retirar lixo do bar",
      "Trancar armários de bebidas", "Verificar limpeza geral do bar",
    ],
  },
  chapa: {
    label: "Chapa",
    icon: Flame,
    cor: "#C4432B",
    abertura: [
      "Ligar chapa", "Verificar temperatura da chapa", "Conferir estoque de carnes",
      "Conferir estoque de pães", "Organizar bancada da chapa",
      "Verificar validade dos insumos", "Testar exaustor",
      "Conferir utensílios de corte", "Verificar limpeza da chapa",
      "Conferir molhos e temperos", "Verificar uso de EPIs",
    ],
    fechamento: [
      "Desligar chapa", "Limpar superfície da chapa", "Guardar insumos restantes",
      "Conferir sobras do dia", "Registrar perdas", "Limpar bancada",
      "Lavar utensílios", "Desligar exaustor", "Retirar lixo",
      "Verificar limpeza geral",
    ],
  },
  gerencia: {
    label: "Gerência",
    icon: ShieldCheck,
    cor: "#4A5D8A",
    abertura: [
      "Conferir escala do dia", "Verificar caixa inicial de todos os setores",
      "Conferir estoque geral", "Verificar equipe presente",
      "Revisar pendências do dia anterior",
    ],
    fechamento: [
      "Conferir fechamento de todos os setores", "Revisar relatório de vendas do dia",
      "Conferir não conformidades registradas", "Planejar pendências para o dia seguinte",
      "Trancar estabelecimento",
    ],
  },
};

const DEPT_KEYS = Object.keys(DEPARTAMENTOS);

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
  if (etapa === "abertura") return h >= 17 || h < 2; // pós 17h (até virar madrugada)
  if (etapa === "fechamento") return h >= 2 && h < 17; // a partir das 02:00 até 17h
  return true;
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------
export default function App() {
  const [tela, setTela] = useState("entrada");
  const [nome, setNome] = useState("");
  const [nomeConfirmado, setNomeConfirmado] = useState("");
  const [deptAtual, setDeptAtual] = useState(null);
  const [etapaAtual, setEtapaAtual] = useState(null);
  const [itens, setItens] = useState({});
  const [salvando, setSalvando] = useState(false);
  const [jaEnviado, setJaEnviado] = useState(false);
  const [modoTeste, setModoTeste] = useState(false);
  const [erro, setErro] = useState("");

  const opDate = diaOperacional();

  const chaveChecklist = (dept, etapa, dia = opDate) => `chk:${dia}:${dept}:${etapa}`;

  const abrirChecklist = async (deptKey, etapa) => {
    setErro("");
    setDeptAtual(deptKey);
    setEtapaAtual(etapa);
    setJaEnviado(false);
    setItens({});
    try {
      const res = await window.storage.get(chaveChecklist(deptKey, etapa), true);
      if (res && res.value) {
        const parsed = JSON.parse(res.value);
        setItens(parsed.itens || {});
        setJaEnviado(true);
      }
    } catch (e) {
      // não existe ainda, tudo bem
    }
    setTela("checklist");
  };

  const marcarItem = (itemLabel, status) => {
    setItens((prev) => ({ ...prev, [itemLabel]: status }));
  };

  const listaItensAtual = deptAtual && etapaAtual ? DEPARTAMENTOS[deptAtual][etapaAtual] : [];
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
    try {
      const payload = {
        responsavel: nomeConfirmado,
        itens,
        completadoEm: new Date().toISOString(),
      };
      const result = await window.storage.set(chaveChecklist(deptAtual, etapaAtual), JSON.stringify(payload), true);
      if (!result) throw new Error("Falha ao salvar");
      setJaEnviado(true);
    } catch (e) {
      setErro("Não foi possível salvar. Tente novamente.");
    } finally {
      setSalvando(false);
    }
  };

  if (tela === "entrada") {
    return <TelaEntrada nome={nome} setNome={setNome} onEntrar={() => {
      if (nome.trim().length < 2) { setErro("Digite seu nome."); return; }
      setNomeConfirmado(nome.trim());
      setErro("");
      setTela("home");
    }} erro={erro} />;
  }

  if (tela === "home") {
    return (
      <Shell titulo="Checklist Operacional" subtitulo={`Olá, ${nomeConfirmado} · Dia operacional ${formatDiaLabel(opDate)}`}
        onDashboard={() => setTela("dashboard")}>
        <div style={{ display: "grid", gap: 14 }}>
          {DEPT_KEYS.map((k) => {
            const dept = DEPARTAMENTOS[k];
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
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#8A8778", marginTop: 4 }}>
            <input type="checkbox" checked={modoTeste} onChange={(e) => setModoTeste(e.target.checked)} />
            Modo teste (ignorar horário de abertura/fechamento)
          </label>
        </div>
      </Shell>
    );
  }

  if (tela === "checklist") {
    const dept = DEPARTAMENTOS[deptAtual];
    const bloqueado = !modoTeste && !podePreencher(etapaAtual);
    return (
      <Shell titulo={`${dept.label} · ${etapaAtual === "abertura" ? "Abertura" : "Fechamento"}`}
        subtitulo={formatDiaLabel(opDate)} onBack={() => setTela("home")}>
        {bloqueado && (
          <div style={avisoBloqueio}>
            <Clock size={16} />
            {etapaAtual === "abertura"
              ? "O preenchimento de abertura só é liberado a partir das 17h."
              : "O preenchimento de fechamento só é liberado a partir das 02h."}
          </div>
        )}
        {!bloqueado && (
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
            </div>
            {erro && <div style={{ color: "#C4432B", fontSize: 13, marginTop: 10 }}>{erro}</div>}
            <button onClick={salvarChecklist} disabled={salvando} style={{ ...btnPrimary, marginTop: 16, width: "100%" }}>
              {salvando ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
              {jaEnviado ? "Atualizar checklist" : "Salvar checklist"}
            </button>
          </>
        )}
      </Shell>
    );
  }

  if (tela === "dashboard") {
    return <Dashboard onBack={() => setTela("home")} opDateHoje={opDate} />;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Tela de entrada
// ---------------------------------------------------------------------------
function TelaEntrada({ nome, setNome, onEntrar, erro }) {
  return (
    <div style={{ ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 480 }}>
      <div style={{ maxWidth: 320, width: "100%", textAlign: "center" }}>
        <div style={{ width: 52, height: 52, borderRadius: 12, background: "#22231F", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
          <ClipboardList size={26} color="#F3EFE3" />
        </div>
        <div style={{ fontWeight: 800, fontSize: 20, color: "#22231F", marginBottom: 4 }}>Checklist Operacional</div>
        <div style={{ fontSize: 13, color: "#8A8778", marginBottom: 20 }}>Caixa · Bar · Chapa · Gerência</div>
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome"
          onKeyDown={(e) => e.key === "Enter" && onEntrar()}
          style={inputStyle} />
        {erro && <div style={{ color: "#C4432B", fontSize: 13, marginTop: 8 }}>{erro}</div>}
        <button onClick={onEntrar} style={{ ...btnPrimary, width: "100%", marginTop: 14, justifyContent: "center" }}>Entrar</button>
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
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
function Dashboard({ onBack, opDateHoje }) {
  const [diaSelecionado, setDiaSelecionado] = useState(opDateHoje);
  const [mesSelecionado, setMesSelecionado] = useState(opDateHoje.slice(0, 7));
  const [carregando, setCarregando] = useState(true);
  const [statusDia, setStatusDia] = useState({});
  const [alertas, setAlertas] = useState([]);
  const [resumoMes, setResumoMes] = useState(null);

  const carregarDia = useCallback(async (dia) => {
    setCarregando(true);
    const status = {};
    const novosAlertas = [];
    for (const deptKey of DEPT_KEYS) {
      const dept = DEPARTAMENTOS[deptKey];
      for (const etapa of ["abertura", "fechamento"]) {
        const total = dept[etapa].length;
        let preenchido = 0;
        let ok = false;
        try {
          const res = await window.storage.get(`chk:${dia}:${deptKey}:${etapa}`, true);
          if (res && res.value) {
            const parsed = JSON.parse(res.value);
            const entries = Object.entries(parsed.itens || {});
            preenchido = entries.length;
            ok = preenchido === total;
            entries.forEach(([item, st]) => {
              if (st === "nao_conforme") {
                novosAlertas.push({ dept: dept.label, etapa, item, responsavel: parsed.responsavel });
              }
            });
          }
        } catch (e) { /* não preenchido ainda */ }
        status[`${deptKey}:${etapa}`] = { preenchido, total, ok };
      }
    }
    setStatusDia(status);
    setAlertas(novosAlertas);
    setCarregando(false);
  }, []);

  const carregarMes = useCallback(async (mes) => {
    let totalItensMes = 0;
    let totalNaoConforme = 0;
    let checklistsPreenchidos = 0;
    const porPessoa = {};

    // dias operacionais do mês (assume até 31 dias, ignora inexistentes)
    const [ano, mesNum] = mes.split("-").map(Number);
    const diasNoMes = new Date(ano, mesNum, 0).getDate();

    for (let d = 1; d <= diasNoMes; d++) {
      const diaStr = `${ano}-${pad(mesNum)}-${pad(d)}`;
      for (const deptKey of DEPT_KEYS) {
        for (const etapa of ["abertura", "fechamento"]) {
          try {
            const res = await window.storage.get(`chk:${diaStr}:${deptKey}:${etapa}`, true);
            if (res && res.value) {
              const parsed = JSON.parse(res.value);
              const entries = Object.entries(parsed.itens || {});
              if (entries.length === 0) continue;
              checklistsPreenchidos += 1;
              const pessoa = parsed.responsavel || "Não identificado";
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
            }
          } catch (e) { /* sem dados nesse dia */ }
        }
      }
    }

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
      <div style={{ marginBottom: 18 }}>
        <div style={sectionLabel}>Pendências do dia</div>
        <input type="date" value={diaSelecionado} onChange={(e) => setDiaSelecionado(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }} />
        {carregando ? (
          <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {DEPT_KEYS.map((k) => {
              const dept = DEPARTAMENTOS[k];
              return (
                <div key={k} style={cardStyle}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8, color: "#22231F" }}>{dept.label}</div>
                  {["abertura", "fechamento"].map((etapa) => {
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
              );
            })}
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
              <div style={{ ...statBox }}>
                <div style={statNum}>{resumoMes.checklistsPreenchidos}</div>
                <div style={statLabel}>checklists preenchidos</div>
              </div>
              <div style={{ ...statBox }}>
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
  minHeight: "100%",
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
