import React, { useState, useEffect, useCallback } from "react";
import {
  Bell, LogOut, Loader2, CheckCircle2, XCircle,
  Clock, ChevronLeft, LayoutGrid,
} from "lucide-react";
import { supabase } from "./lib/supabaseClient";
import ChecklistOperacional from "./modules/ChecklistOperacional";
import Financeiro from "./modules/Financeiro";
import Marketing from "./modules/Marketing";
import Comercial from "./modules/Comercial";
import Sac from "./modules/Sac";
import Rastreabilidade from "./modules/Rastreabilidade";

// Mapa: chave do módulo (banco) -> componente React que o renderiza.
// Para adicionar um novo card no futuro: crie o componente, cadastre uma
// linha na tabela `modulos` (ver supabase/002_auth_e_modulos.sql) com a
// mesma `chave`, e adicione a entrada aqui.
const COMPONENTES_MODULO = {
  checklist: ChecklistOperacional,
  financeiro: Financeiro,
  marketing: Marketing,
  comercial: Comercial,
  sac: Sac,
  rastreabilidade: Rastreabilidade,
};

export default function App() {
  const [carregandoAuth, setCarregandoAuth] = useState(true);
  const [sessao, setSessao] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [tela, setTela] = useState("login"); // login | aguardando | home | admin | <chave do módulo>
  const [modulos, setModulos] = useState([]);
  const [carregandoModulos, setCarregandoModulos] = useState(false);
  const [totalPendentes, setTotalPendentes] = useState(0);
  const [abaFinanceiroInicial, setAbaFinanceiroInicial] = useState(null); // usado pelo card de Dashboard, que abre Financeiro já na aba certa

  // ---- sessão -------------------------------------------------------------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSessao(data.session);
      setCarregandoAuth(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, novaSessao) => {
      setSessao(novaSessao);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const carregarPerfil = useCallback(async (usuarioId) => {
    const { data, error } = await supabase.from("perfis").select("*").eq("id", usuarioId).maybeSingle();
    if (error || !data) {
      setPerfil(null);
      setTela("login");
      return;
    }
    setPerfil(data);
    setTela(data.status === "aprovado" ? "home" : "aguardando");
  }, []);

  useEffect(() => {
    if (sessao?.user?.id) {
      carregarPerfil(sessao.user.id);
    } else if (!carregandoAuth) {
      setPerfil(null);
      setTela("login");
    }
    // Depende só do ID do usuário (não do objeto de sessão inteiro) —
    // assim, uma renovação automática de token (que troca o objeto de
    // sessão mas mantém o mesmo usuário) não recarrega o perfil nem
    // manda a pessoa de volta pra tela inicial no meio do uso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessao?.user?.id, carregandoAuth, carregarPerfil]);

  // ---- módulos (cards) disponíveis para o usuário --------------------------
  const carregarModulos = useCallback(async () => {
    if (!perfil) return;
    setCarregandoModulos(true);
    const { data: todosModulos } = await supabase.from("modulos").select("*").order("nome");

    if (perfil.is_admin) {
      setModulos(todosModulos || []);
    } else {
      const { data: acessos } = await supabase
        .from("acessos_modulo")
        .select("modulo_id")
        .eq("usuario_id", perfil.id);
      const idsPermitidos = new Set((acessos || []).map((a) => a.modulo_id));
      setModulos((todosModulos || []).filter((m) => idsPermitidos.has(m.id)));
    }
    setCarregandoModulos(false);
  }, [perfil]);

  const carregarPendentes = useCallback(async () => {
    if (!perfil?.is_admin) return;
    const { count } = await supabase
      .from("perfis")
      .select("id", { count: "exact", head: true })
      .eq("status", "pendente");
    setTotalPendentes(count || 0);
  }, [perfil]);

  useEffect(() => {
    if (perfil?.status === "aprovado") {
      carregarModulos();
      carregarPendentes();
    }
  }, [perfil, carregarModulos, carregarPendentes]);

  const sair = async () => {
    await supabase.auth.signOut();
    setTela("login");
  };

  // ---- roteamento por tela --------------------------------------------------
  if (carregandoAuth) {
    return <TelaCarregando />;
  }

  if (!sessao || tela === "login") {
    return <TelaLogin />;
  }

  if (tela === "aguardando" || (perfil && perfil.status !== "aprovado")) {
    return <TelaAguardando perfil={perfil} onSair={sair} />;
  }

  if (tela === "admin") {
    return (
      <PainelAdmin
        onVoltar={() => { setTela("home"); carregarPendentes(); }}
      />
    );
  }

  if (tela !== "home") {
    const Componente = COMPONENTES_MODULO[tela];
    if (Componente) {
      const propsExtra = tela === "financeiro" ? { abaInicial: abaFinanceiroInicial } : {};
      return <Componente nomeUsuario={perfil?.nome} onVoltar={() => { setTela("home"); setAbaFinanceiroInicial(null); }} {...propsExtra} />;
    }
  }

  return (
    <TelaInicio
      perfil={perfil}
      modulos={modulos}
      carregando={carregandoModulos}
      totalPendentes={totalPendentes}
      onAbrirModulo={(chave) => setTela(chave)}
      onAbrirDashboard={() => { setAbaFinanceiroInicial("dashboard"); setTela("financeiro"); }}
      onAbrirAdmin={() => setTela("admin")}
      onSair={sair}
    />
  );
}

// ---------------------------------------------------------------------------
// Tela de carregamento inicial
// ---------------------------------------------------------------------------
function TelaCarregando() {
  return (
    <div style={{ ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <Loader2 size={22} color="#8A8778" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login / criação de conta
// ---------------------------------------------------------------------------
function TelaLogin() {
  const [modo, setModo] = useState("entrar"); // entrar | criar
  const [nome, setNome] = useState("");
  const [cargo, setCargo] = useState("garcom");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");

  const entrar = async () => {
    setErro(""); setMensagem("");
    if (!email || !senha) { setErro("Preencha e-mail e senha."); return; }
    setCarregando(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    if (error) setErro(traduzErro(error.message));
    setCarregando(false);
  };

  const criarConta = async () => {
    setErro(""); setMensagem("");
    if (nome.trim().length < 2) { setErro("Digite seu nome."); return; }
    if (!email || senha.length < 6) { setErro("E-mail válido e senha com pelo menos 6 caracteres."); return; }
    setCarregando(true);
    const { error } = await supabase.auth.signUp({
      email, password: senha, options: { data: { nome: nome.trim(), cargo } },
    });
    setCarregando(false);
    if (error) { setErro(traduzErro(error.message)); return; }
    setMensagem("Conta criada! Assim que um administrador aprovar seu acesso, você já pode entrar.");
    setModo("entrar");
  };

  return (
    <div style={{ ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ maxWidth: 340, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <img src="/icons/logo.svg" alt="Mr. Kong Fast Food" style={{ width: "100%", maxWidth: 260, height: "auto", margin: "0 auto 12px", display: "block" }} />
          <div style={{ fontSize: 13, color: "#8A8778" }}>Acesso da equipe</div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <button onClick={() => { setModo("entrar"); setErro(""); setMensagem(""); }}
            style={{ ...tabBtn, ...(modo === "entrar" ? tabBtnAtivo : {}) }}>Entrar</button>
          <button onClick={() => { setModo("criar"); setErro(""); setMensagem(""); }}
            style={{ ...tabBtn, ...(modo === "criar" ? tabBtnAtivo : {}) }}>Criar conta</button>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {modo === "criar" && (
            <>
              <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome" style={inputStyle} />
              <select value={cargo} onChange={(e) => setCargo(e.target.value)} style={inputStyle}>
                {CARGOS_CADASTRO.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
              </select>
            </>
          )}
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" type="email" style={inputStyle} />
          <input value={senha} onChange={(e) => setSenha(e.target.value)} placeholder="Senha" type="password"
            onKeyDown={(e) => e.key === "Enter" && (modo === "entrar" ? entrar() : criarConta())}
            style={inputStyle} />
        </div>

        {erro && <div style={{ color: "#C4432B", fontSize: 13, marginTop: 10 }}>{erro}</div>}
        {mensagem && <div style={{ color: "#2F8F5B", fontSize: 13, marginTop: 10 }}>{mensagem}</div>}

        <button onClick={modo === "entrar" ? entrar : criarConta} disabled={carregando}
          style={{ ...btnPrimary, width: "100%", marginTop: 16, justifyContent: "center" }}>
          {carregando ? <Loader2 size={16} /> : null}
          {modo === "entrar" ? "Entrar" : "Criar conta"}
        </button>
      </div>
    </div>
  );
}

const CARGOS_CADASTRO = [
  { valor: "administrador", rotulo: "Administrador" },
  { valor: "gerente", rotulo: "Gerente" },
  { valor: "garcom", rotulo: "Garçom" },
  { valor: "chapa", rotulo: "Chapeiro" },
  { valor: "bar", rotulo: "Bar" },
  { valor: "cozinha", rotulo: "Cozinha" },
  { valor: "caixa", rotulo: "Caixa" },
];

function traduzErro(msg) {
  if (/invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
  if (/user already registered/i.test(msg)) return "Já existe uma conta com este e-mail.";
  if (/email not confirmed/i.test(msg)) return "Confirme seu e-mail antes de entrar (verifique sua caixa de entrada).";
  return msg;
}

// ---------------------------------------------------------------------------
// Aguardando aprovação
// ---------------------------------------------------------------------------
function TelaAguardando({ perfil, onSair }) {
  const rejeitado = perfil?.status === "rejeitado";
  return (
    <div style={{ ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ maxWidth: 320, width: "100%", textAlign: "center" }}>
        <Clock size={32} color="#C9A227" style={{ marginBottom: 12 }} />
        <div style={{ fontWeight: 800, fontSize: 18, color: "#22231F", marginBottom: 6 }}>
          {rejeitado ? "Acesso não liberado" : "Aguardando aprovação"}
        </div>
        <div style={{ fontSize: 13, color: "#8A8778", marginBottom: 20 }}>
          {rejeitado
            ? "Um administrador não liberou o acesso desta conta. Fale com a gerência."
            : "Um administrador precisa aprovar seu cadastro antes de você acessar o painel."}
        </div>
        <button onClick={onSair} style={{ ...btnSecondary, width: "100%" }}>Sair</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Início: grid de cards
// ---------------------------------------------------------------------------
function TelaInicio({ perfil, modulos, carregando, totalPendentes, onAbrirModulo, onAbrirDashboard, onAbrirAdmin, onSair }) {
  const temFinanceiro = modulos.some((m) => m.chave === "financeiro");
  return (
    <div style={pageStyle}>
      <div className="app-shell">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <img src="/icons/mascot.svg" alt="" style={{ width: 34, height: 34 }} />
            <div>
              <div style={{ fontWeight: 800, fontSize: 18, color: "#22231F" }}>Olá, {perfil?.nome}</div>
              <div style={{ fontSize: 12, color: "#8A8778" }}>{perfil?.is_admin ? "Administrador" : "Equipe"}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {perfil?.is_admin && (
              <button onClick={onAbrirAdmin} style={{ ...iconBtn, position: "relative" }}>
                <Bell size={18} />
                {totalPendentes > 0 && (
                  <span style={badgeSino}>{totalPendentes}</span>
                )}
              </button>
            )}
            <button onClick={onSair} style={iconBtn}><LogOut size={18} /></button>
          </div>
        </div>

        {carregando ? (
          <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
        ) : modulos.length === 0 ? (
          <div style={{ ...cardStyle, textAlign: "center", color: "#8A8778", fontSize: 13 }}>
            <LayoutGrid size={22} style={{ marginBottom: 8 }} />
            <div>Nenhum módulo liberado para o seu usuário ainda.</div>
          </div>
        ) : (
          <div className="cards-grid">
            {temFinanceiro && (
              <button onClick={onAbrirDashboard}
                style={{ ...cardStyle, textAlign: "left", cursor: "pointer", border: "2px solid #185FA5" }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#22231F", marginBottom: 4 }}>Dashboard</div>
                <div style={{ fontSize: 13, color: "#8A8778" }}>Faturamento previsto, custos por centro de custo, curva ABC, lucro previsto e mais.</div>
              </button>
            )}
            {modulos.map((m) => (
              <button key={m.id} onClick={() => onAbrirModulo(m.chave)}
                style={{ ...cardStyle, textAlign: "left", cursor: "pointer", border: "1px solid #E8E2D2" }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#22231F", marginBottom: 4 }}>{m.nome}</div>
                {m.descricao && <div style={{ fontSize: 13, color: "#8A8778" }}>{m.descricao}</div>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel Admin: aprovação de cadastros + acesso por módulo
// ---------------------------------------------------------------------------
function PainelAdmin({ onVoltar }) {
  const [subaba, setSubaba] = useState("pendentes"); // pendentes | pessoas
  const [carregando, setCarregando] = useState(true);
  const [pendentes, setPendentes] = useState([]);
  const [todosPerfis, setTodosPerfis] = useState([]);
  const [modulos, setModulos] = useState([]);
  const [acessosPorUsuario, setAcessosPorUsuario] = useState({}); // usuarioId -> Set(moduloId)
  const [erro, setErro] = useState("");
  const [meuId, setMeuId] = useState(null);

  const carregarTudo = useCallback(async () => {
    setCarregando(true);
    setErro("");
    const [{ data: userData }, { data: perfisData, error: erroPerfis }, { data: modulosData }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.from("perfis").select("*").order("criado_em", { ascending: false }),
      supabase.from("modulos").select("*").order("nome"),
    ]);
    setMeuId(userData?.user?.id || null);

    if (erroPerfis) {
      setErro("Erro ao carregar usuários: " + erroPerfis.message);
      setCarregando(false);
      return;
    }

    const todos = perfisData || [];
    setPendentes(todos.filter((p) => p.status === "pendente"));
    setTodosPerfis(todos.filter((p) => p.status !== "pendente"));
    setModulos(modulosData || []);

    const { data: acessos } = await supabase.from("acessos_modulo").select("usuario_id, modulo_id");
    const mapa = {};
    (acessos || []).forEach((a) => {
      if (!mapa[a.usuario_id]) mapa[a.usuario_id] = new Set();
      mapa[a.usuario_id].add(a.modulo_id);
    });
    setAcessosPorUsuario(mapa);
    setCarregando(false);
  }, []);

  useEffect(() => { carregarTudo(); }, [carregarTudo]);

  const aprovar = async (id) => {
    await supabase.from("perfis").update({ status: "aprovado" }).eq("id", id);
    carregarTudo();
  };
  const rejeitar = async (id) => {
    await supabase.from("perfis").update({ status: "rejeitado" }).eq("id", id);
    carregarTudo();
  };
  const alternarAdmin = async (id, souAdmin) => {
    if (id === meuId) { alert("Não dá pra remover seu próprio acesso de administrador por aqui."); return; }
    await supabase.from("perfis").update({ is_admin: !souAdmin }).eq("id", id);
    carregarTudo();
  };

  const alternarAcesso = async (usuarioId, moduloId, temAcesso) => {
    if (temAcesso) {
      await supabase.from("acessos_modulo").delete().eq("usuario_id", usuarioId).eq("modulo_id", moduloId);
    } else {
      await supabase.from("acessos_modulo").insert({ usuario_id: usuarioId, modulo_id: moduloId });
    }
    carregarTudo();
  };

  return (
    <div style={pageStyle}>
      <div className="app-shell">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
          <button onClick={onVoltar} style={iconBtn}><ChevronLeft size={18} /></button>
          <div style={{ fontWeight: 800, fontSize: 17, color: "#22231F" }}>Painel Admin</div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <button onClick={() => setSubaba("pendentes")} style={{ ...tabBtn, ...(subaba === "pendentes" ? tabBtnAtivo : {}) }}>
            Aprovações pendentes{pendentes.length > 0 ? ` (${pendentes.length})` : ""}
          </button>
          <button onClick={() => setSubaba("pessoas")} style={{ ...tabBtn, ...(subaba === "pessoas" ? tabBtnAtivo : {}) }}>
            Pessoas cadastradas
          </button>
        </div>

        {erro && <div style={{ color: "#C4432B", fontSize: 13, marginBottom: 14 }}>{erro}</div>}

        {carregando ? (
          <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
        ) : subaba === "pendentes" ? (
          <div>
            {pendentes.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Nenhum cadastro pendente.</div>}
            <div className="list-grid">
              {pendentes.map((p) => {
                const meusAcessos = acessosPorUsuario[p.id] || new Set();
                return (
                  <div key={p.id} style={cardStyle}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: "#22231F" }}>{p.nome}</div>
                    <div style={{ fontSize: 12, color: "#8A8778" }}>{p.email}</div>
                    {p.cargo && <div style={{ fontSize: 12, color: "#8A6A0F", marginBottom: 8 }}>Cargo informado: {CARGO_LABEL[p.cargo] || p.cargo}</div>}
                    <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 6, marginTop: p.cargo ? 0 : 8 }}>Marque os módulos liberados antes de aprovar (ou depois, se preferir):</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                      {modulos.map((m) => {
                        const tem = meusAcessos.has(m.id);
                        return (
                          <button key={m.id} onClick={() => alternarAcesso(p.id, m.id, tem)}
                            style={{ ...pillBtn, ...(tem ? pillOk : {}) }}>
                            {tem ? <CheckCircle2 size={13} /> : null} {m.nome}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button onClick={() => aprovar(p.id)} style={{ ...pillBtn, ...pillOk, flex: 1, justifyContent: "center" }}>
                        <CheckCircle2 size={14} /> Aprovar
                      </button>
                      <button onClick={() => rejeitar(p.id)} style={{ ...pillBtn, ...pillNok, flex: 1, justifyContent: "center" }}>
                        <XCircle size={14} /> Rejeitar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div>
            {todosPerfis.length === 0 && <div style={{ fontSize: 13, color: "#8A8778" }}>Nenhuma pessoa cadastrada ainda.</div>}
            <div className="list-grid">
              {todosPerfis.map((p) => {
                const meusAcessos = acessosPorUsuario[p.id] || new Set();
                return (
                  <div key={p.id} style={cardStyle}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: "#22231F" }}>{p.nome}</div>
                      {p.status === "rejeitado" && <span style={{ ...pillBtn, ...pillNok, cursor: "default" }}>Rejeitado</span>}
                    </div>
                    <div style={{ fontSize: 12, color: "#8A8778" }}>{p.email}</div>
                    {p.cargo && <div style={{ fontSize: 12, color: "#8A8778" }}>{CARGO_LABEL[p.cargo] || p.cargo}</div>}
                    <div style={{ marginTop: 10, marginBottom: 10 }}>
                      <button onClick={() => alternarAdmin(p.id, p.is_admin)}
                        style={{ ...pillBtn, ...(p.is_admin ? pillOk : {}) }}>
                        {p.is_admin ? <CheckCircle2 size={13} /> : null} {p.is_admin ? "Administrador" : "Tornar administrador"}
                      </button>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {modulos.map((m) => {
                        const tem = meusAcessos.has(m.id);
                        return (
                          <button key={m.id} onClick={() => alternarAcesso(p.id, m.id, tem)}
                            style={{ ...pillBtn, ...(tem ? pillOk : {}) }}>
                            {tem ? <CheckCircle2 size={13} /> : null} {m.nome}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const CARGO_LABEL = {
  administrador: "Administrador", gerente: "Gerente", garcom: "Garçom",
  chapa: "Chapeiro", bar: "Bar", cozinha: "Cozinha", caixa: "Caixa",
};

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
  background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F",
  borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
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
const tabBtn = {
  flex: 1, padding: "9px 10px", borderRadius: 8, border: "1px solid #E8E2D2",
  background: "#FFFFFF", color: "#8A8778", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const tabBtnAtivo = { background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" };
const badgeSino = {
  position: "absolute", top: -4, right: -4, background: "#C4432B", color: "#fff",
  fontSize: 10, fontWeight: 700, borderRadius: 999, minWidth: 16, height: 16,
  display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
};
