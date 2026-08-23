import React, { useState, useEffect, useCallback } from "react";
import {
  Bell, LogOut, Loader2, Clock, LayoutGrid, ShieldCheck,
} from "lucide-react";
import { supabase } from "./lib/supabaseClient";
import { carregarPermissoes, podeVer } from "./lib/permissoes";
import ChecklistOperacional from "./modules/ChecklistOperacional";
import Financeiro from "./modules/Financeiro";
import Marketing from "./modules/Marketing";
import Comercial from "./modules/Comercial";
import Sac from "./modules/Sac";
import SupplyChain from "./modules/SupplyChain";
import Permissoes from "./modules/Permissoes";
import DashboardModulo from "./modules/DashboardModulo";
import GenteGestao from "./modules/GenteGestao";
// Mapa: chave do módulo (banco) -> componente React que o renderiza.
// Para adicionar um novo card no futuro: crie o componente, cadastre uma
// linha na tabela `modulos` (ver supabase/002_auth_e_modulos.sql) com a
// mesma `chave`, adicione a entrada aqui E a chave em src/lib/permissoes.js
// (é o catálogo de lá que faz o módulo aparecer na matriz de permissões).
const COMPONENTES_MODULO = {
  checklist: ChecklistOperacional,
  dashboard: DashboardModulo,
  gente: GenteGestao,
  financeiro: Financeiro,
  marketing: Marketing,
  comercial: Comercial,
  sac: Sac,
  supply: SupplyChain,
};
export default function App() {
  const [carregandoAuth, setCarregandoAuth] = useState(true);
  const [sessao, setSessao] = useState(null);
  const [perfil, setPerfil] = useState(null);
  const [permissoes, setPermissoes] = useState(null); // { admin, mapa }
  const [tela, setTela] = useState("login"); // login | aguardando | home | permissoes | <chave do módulo>
  const [abaPermissoes, setAbaPermissoes] = useState("cargos");
  const [modulos, setModulos] = useState([]);
  const [carregandoModulos, setCarregandoModulos] = useState(false);
  const [totalPendentes, setTotalPendentes] = useState(0);
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
      setPermissoes(null);
      setTela("login");
    }
    // Depende só do ID do usuário (não do objeto de sessão inteiro) —
    // assim, uma renovação automática de token (que troca o objeto de
    // sessão mas mantém o mesmo usuário) não recarrega o perfil nem
    // manda a pessoa de volta pra tela inicial no meio do uso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessao?.user?.id, carregandoAuth, carregarPerfil]);
  // ---- módulos (cards) disponíveis para o usuário --------------------------
  //
  // A permissão vem do CARGO da pessoa (tabela cargo_permissoes), não mais
  // da acessos_modulo por usuário. Administrador vê tudo, sempre — a função
  // nivel_acesso() no banco faz a mesma exceção, então as duas pontas
  // concordam.
  const carregarModulos = useCallback(async () => {
    if (!perfil) return;
    setCarregandoModulos(true);
    const perms = await carregarPermissoes(perfil);
    setPermissoes(perms);
    const { data: todosModulos } = await supabase.from("modulos").select("*").order("nome");
    setModulos((todosModulos || []).filter((m) => podeVer(perms, m.chave)));
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
    setPermissoes(null);
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
  if (tela === "permissoes") {
    // Só administrador entra aqui. A checagem existe mesmo com o card
    // escondido, porque esconder botão não é controle de acesso.
    if (!perfil?.is_admin) return <TelaSemPermissao onVoltar={() => setTela("home")} />;
    return (
      <Permissoes
        abaInicial={abaPermissoes}
        onVoltar={() => { setTela("home"); carregarPendentes(); carregarModulos(); }}
        onMudou={() => carregarModulos()}
      />
    );
  }
  if (tela !== "home") {
    const Componente = COMPONENTES_MODULO[tela];
    if (Componente) {
      // Segunda barreira: se a pessoa chegou numa tela que não pode ver
      // (link antigo, estado preso), volta pra home em vez de renderizar.
      if (!podeVer(permissoes, tela)) return <TelaSemPermissao onVoltar={() => setTela("home")} />;
      return (
        <Componente
          nomeUsuario={perfil?.nome}
          perfil={perfil}
          permissoes={permissoes}
          onVoltar={() => setTela("home")}
        />
      );
    }
  }
  return (
    <TelaInicio
      perfil={perfil}
      permissoes={permissoes}
      modulos={modulos}
      carregando={carregandoModulos}
      totalPendentes={totalPendentes}
      onAbrirModulo={(chave) => setTela(chave)}
      onAbrirPermissoes={(aba) => { setAbaPermissoes(aba || "cargos"); setTela("permissoes"); }}
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
// Bloqueio por permissão
// ---------------------------------------------------------------------------
function TelaSemPermissao({ onVoltar }) {
  return (
    <div style={{ ...pageStyle, display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
      <div style={{ maxWidth: 320, width: "100%", textAlign: "center" }}>
        <ShieldCheck size={30} color="#8A8778" style={{ marginBottom: 12 }} />
        <div style={{ fontWeight: 800, fontSize: 17, color: "#231A18", marginBottom: 6 }}>Sem acesso a essa tela</div>
        <div style={{ fontSize: 13, color: "#8A8778", marginBottom: 20 }}>
          Seu cargo não libera essa parte do painel. Se você precisa dela, fale com um administrador.
        </div>
        <button onClick={onVoltar} style={{ ...btnSecondary, width: "100%" }}>Voltar ao início</button>
      </div>
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
    setMensagem("Conta criada! Um administrador precisa liberar seu acesso e definir seu cargo.");
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
              <div style={{ fontSize: 11, color: "#8A8778", marginTop: -4 }}>
                Sua função serve de referência — quem define o cargo e o acesso é o administrador, na aprovação.
              </div>
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
        <div style={{ fontWeight: 800, fontSize: 18, color: "#231A18", marginBottom: 6 }}>
          {rejeitado ? "Acesso não liberado" : "Cadastro enviado"}
        </div>
        <div style={{ fontSize: 13, color: "#8A8778", marginBottom: 20, lineHeight: 1.55 }}>
          {rejeitado
            ? "Um administrador não liberou o acesso desta conta. Fale com a gerência."
            : "Um administrador precisa liberar seu acesso e definir seu cargo. Assim que isso acontecer, é só entrar de novo."}
        </div>
        <button onClick={onSair} style={{ ...btnSecondary, width: "100%" }}>Sair</button>
      </div>
    </div>
  );
}
// ---------------------------------------------------------------------------
// Início: grid de cards
// ---------------------------------------------------------------------------
function TelaInicio({ perfil, permissoes, modulos, carregando, totalPendentes, onAbrirModulo, onAbrirPermissoes, onSair }) {
  // Dashboard e Gente e Gestão agora são módulos de verdade, com linha na
  // tabela `modulos` — entram pela lista como qualquer outro card.
  const nadaParaMostrar = modulos.length === 0 && !perfil?.is_admin;
  return (
    <div style={pageStyle}>
      <div className="app-shell">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              width: 40, height: 40, borderRadius: 11, background: KONG.vermelho,
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              boxShadow: "0 2px 6px rgba(199,43,46,.30)",
            }}>
              <img src="/icons/mascot.svg" alt="" style={{ width: 26, height: 26 }} />
            </span>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18, color: "#231A18" }}>Olá, {perfil?.nome}</div>
              <div style={{ fontSize: 12, color: KONG.vermelho, fontWeight: 700 }}>
                Mr Kong · {perfil?.is_admin ? "Administrador" : "Equipe"}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {perfil?.is_admin && (
              <button onClick={() => onAbrirPermissoes("usuarios")} style={{ ...iconBtn, position: "relative" }}
                aria-label="Cadastros aguardando liberação">
                <Bell size={18} />
                {totalPendentes > 0 && (
                  <span style={badgeSino}>{totalPendentes}</span>
                )}
              </button>
            )}
            <button onClick={onSair} style={iconBtn} aria-label="Sair"><LogOut size={18} /></button>
          </div>
        </div>
        {carregando ? (
          <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
        ) : nadaParaMostrar ? (
          <div style={{ ...cardStyle, textAlign: "center", color: "#8A8778", fontSize: 13 }}>
            <LayoutGrid size={22} style={{ marginBottom: 8 }} />
            <div>Nenhum módulo liberado para o seu cargo ainda.</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>Fale com um administrador.</div>
          </div>
        ) : (
          <div className="cards-grid">
            {modulos.map((m) => (
              <button key={m.id} onClick={() => onAbrirModulo(m.chave)}
                style={{
                  ...cardStyle, textAlign: "left", cursor: "pointer", position: "relative", overflow: "hidden",
                  border: m.chave === "dashboard" ? "2px solid #185FA5" : "1px solid #E9DFCE",
                }}>
                <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, background: KONG.vermelho }} />
                <div style={{ fontWeight: 700, fontSize: 16, color: "#231A18", marginBottom: 4, paddingLeft: 8 }}>{m.nome}</div>
                {m.descricao && <div style={{ fontSize: 13, color: "#8A8778", paddingLeft: 8 }}>{m.descricao}</div>}
              </button>
            ))}
            {perfil?.is_admin && (
              <button onClick={() => onAbrirPermissoes("cargos")}
                style={{ ...cardStyle, textAlign: "left", cursor: "pointer", border: "1px solid #C9BE9A", background: "#FAF6EA" }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: "#231A18", marginBottom: 4, display: "flex", alignItems: "center", gap: 6 }}>
                  <ShieldCheck size={16} color="#8A6A0F" /> Permissões
                </div>
                <div style={{ fontSize: 13, color: "#8A8778" }}>
                  Cargos, o que cada um pode ver ou editar, e liberação de novos usuários.
                </div>
                <div style={{ fontSize: 11, color: "#8A6A0F", fontWeight: 700, marginTop: 6 }}>
                  só administradores{totalPendentes > 0 ? ` · ${totalPendentes} aguardando` : ""}
                </div>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
// ---------------------------------------------------------------------------
// Estilos
//
// As cores vêm do logo (public/icons/logo-full.png): vermelho #C72B2E e
// amarelo #F2D742. O vermelho fica em SUPERFÍCIE — faixa do topo, aba ativa,
// cabeçalho de relatório. Ele não vira cor de botão de ação porque no painel
// vermelho já quer dizer perigo (excluir, prejuízo, fiado em aberto), e as
// duas coisas na mesma cor fazem alguém apagar o que queria salvar.
// ---------------------------------------------------------------------------
export const KONG = {
  vermelho: "#C72B2E",
  vermelhoEscuro: "#A32224",
  amarelo: "#F2D742",
  bege: "#F3C770",
  tinta: "#231A18",
  creme: "#FBF6EC",
  linha: "#E9DFCE",
  perigo: "#8E2420",
};

const pageStyle = {
  fontFamily: "'Inter', system-ui, sans-serif",
  background: "#FBF6EC",
  padding: 20,
  minHeight: "100vh",
  boxSizing: "border-box",
};
const cardStyle = {
  background: "#FFFFFF",
  border: "1px solid #E9DFCE",
  borderRadius: 12,
  padding: 14,
};
const btnPrimary = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
  background: "#231A18", color: "#F3EFE3", border: "none",
  borderRadius: 10, padding: "12px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer",
};
const btnSecondary = {
  background: "#FBF6EC", border: "1px solid #E9DFCE", color: "#231A18",
  borderRadius: 8, padding: "10px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const iconBtn = {
  width: 34, height: 34, borderRadius: 8, border: "1px solid #E9DFCE", background: "#FFFFFF",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#231A18",
};
const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "10px 12px", borderRadius: 10,
  border: "1px solid #E9DFCE", fontSize: 14, background: "#FFFFFF", color: "#231A18",
};
const tabBtn = {
  flex: 1, padding: "9px 10px", borderRadius: 8, border: "1px solid #E9DFCE",
  background: "#FFFFFF", color: "#8A8778", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const tabBtnAtivo = { background: KONG.vermelho, color: "#FFFFFF", borderColor: KONG.vermelho };
const badgeSino = {
  position: "absolute", top: -4, right: -4, background: "#C4432B", color: "#fff",
  fontSize: 10, fontWeight: 700, borderRadius: 999, minWidth: 16, height: 16,
  display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
};
