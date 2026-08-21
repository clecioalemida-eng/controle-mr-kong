import React, { useState, useEffect, useCallback } from "react";
import {
  ChevronLeft, ChevronRight, Loader2, AlertTriangle, Check, Trash2,
  Pencil, Lock, Clock, ShieldCheck,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { CATALOGO } from "../lib/permissoes";

const NIVEIS = [
  { valor: "nenhum", rotulo: "—" },
  { valor: "ver", rotulo: "Ver" },
  { valor: "editar", rotulo: "Editar" },
];

// ---------------------------------------------------------------------------
// Permissões: cargos, matriz de acesso e liberação de usuários.
//
// Substitui o antigo Painel Admin. Ali o acesso era liberado pessoa a pessoa;
// aqui ele mora no cargo, e todo mundo do cargo herda. Trocar o cargo de
// alguém é a única coisa que muda o acesso dessa pessoa.
// ---------------------------------------------------------------------------
export default function Permissoes({ abaInicial = "cargos", onVoltar, onMudou }) {
  const [aba, setAba] = useState(abaInicial);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [meuId, setMeuId] = useState(null);
  const [cargos, setCargos] = useState([]);
  const [perfis, setPerfis] = useState([]);
  const [permsPorCargo, setPermsPorCargo] = useState({}); // cargoId -> { chave: nivel }
  const [cargoAberto, setCargoAberto] = useState(null);
  const [novoCargo, setNovoCargo] = useState("");
  const [criandoCargo, setCriandoCargo] = useState(false);
  const [renomeando, setRenomeando] = useState(null);
  const [nomeEdit, setNomeEdit] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro("");
    const [{ data: userData }, { data: cargosData, error: erroCargos }, { data: perfisData }, { data: permsData }] =
      await Promise.all([
        supabase.auth.getUser(),
        supabase.from("cargos").select("*").order("nome"),
        supabase.from("perfis").select("*").order("criado_em", { ascending: false }),
        supabase.from("cargo_permissoes").select("cargo_id, chave, nivel"),
      ]);
    setMeuId(userData?.user?.id || null);
    if (erroCargos) { setErro("Erro ao carregar cargos: " + erroCargos.message); setCarregando(false); return; }
    setCargos(cargosData || []);
    setPerfis(perfisData || []);
    const mapa = {};
    (permsData || []).forEach((p) => {
      if (!mapa[p.cargo_id]) mapa[p.cargo_id] = {};
      mapa[p.cargo_id][p.chave] = p.nivel;
    });
    setPermsPorCargo(mapa);
    setCarregando(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const pessoasDoCargo = (cargoId) => perfis.filter((p) => p.cargo_id === cargoId).length;

  // ---- cargos -------------------------------------------------------------
  const criarCargo = async () => {
    const nome = novoCargo.trim();
    if (!nome) return;
    const { error } = await supabase.from("cargos").insert({ nome });
    if (error) { setErro(error.message); return; }
    setNovoCargo(""); setCriandoCargo(false);
    carregar();
  };
  const renomearCargo = async (c) => {
    const nome = nomeEdit.trim();
    if (!nome) { setRenomeando(null); return; }
    const { error } = await supabase.from("cargos").update({ nome }).eq("id", c.id);
    if (error) { setErro(error.message); return; }
    setRenomeando(null);
    carregar();
  };
  const excluirCargo = async (c) => {
    const qtd = pessoasDoCargo(c.id);
    if (qtd > 0) {
      alert(`"${c.nome}" tem ${qtd} pessoa(s) vinculada(s). Mova essas pessoas para outro cargo antes de excluir — senão elas ficam sem acesso nenhum.`);
      return;
    }
    if (!window.confirm(`Excluir o cargo "${c.nome}"? As permissões dele são apagadas junto.`)) return;
    const { error } = await supabase.from("cargos").delete().eq("id", c.id);
    if (error) { setErro(error.message); return; }
    carregar();
  };

  // ---- matriz -------------------------------------------------------------
  const definirNivel = (cargoId, chave, nivel) => {
    setPermsPorCargo((prev) => ({ ...prev, [cargoId]: { ...(prev[cargoId] || {}), [chave]: nivel } }));
  };
  const definirNivelEmCascata = (cargoId, modulo, nivel) => {
    const atualizado = { ...(permsPorCargo[cargoId] || {}) };
    atualizado[modulo.chave] = nivel;
    (modulo.filhos || []).forEach((f) => { atualizado[f.chave] = nivel; });
    setPermsPorCargo((prev) => ({ ...prev, [cargoId]: atualizado }));
  };
  const salvarMatriz = async (cargo) => {
    const mapa = permsPorCargo[cargo.id] || {};
    const linhas = [];
    CATALOGO.forEach((m) => {
      linhas.push({ cargo_id: cargo.id, chave: m.chave, nivel: mapa[m.chave] || "nenhum" });
      (m.filhos || []).forEach((f) => linhas.push({ cargo_id: cargo.id, chave: f.chave, nivel: mapa[f.chave] || "nenhum" }));
    });
    const { error } = await supabase.from("cargo_permissoes").upsert(linhas, { onConflict: "cargo_id,chave" });
    if (error) { setErro(error.message); return; }
    if (onMudou) onMudou();
    setCargoAberto(null);
    carregar();
  };

  // ---- usuários -----------------------------------------------------------
  const aprovar = async (p, cargoId) => {
    if (!cargoId) { alert("Escolha um cargo antes de aprovar — sem cargo a pessoa entra sem acesso a nada."); return; }
    const { error } = await supabase.from("perfis").update({ status: "aprovado", cargo_id: cargoId }).eq("id", p.id);
    if (error) { setErro(error.message); return; }
    carregar();
  };
  const definirCargoDe = async (p, cargoId) => {
    const { error } = await supabase.from("perfis").update({ cargo_id: cargoId || null }).eq("id", p.id);
    if (error) { setErro(error.message); return; }
    carregar();
  };
  const mudarStatus = async (p, status) => {
    if (p.id === meuId) { alert("Não dá pra mudar o seu próprio status por aqui."); return; }
    const { error } = await supabase.from("perfis").update({ status }).eq("id", p.id);
    if (error) { setErro(error.message); return; }
    carregar();
  };
  const alternarAdmin = async (p) => {
    if (p.id === meuId) { alert("Não dá pra tirar o seu próprio acesso de administrador — se desse, ninguém sobraria pra devolver."); return; }
    const { error } = await supabase.from("perfis").update({ is_admin: !p.is_admin }).eq("id", p.id);
    if (error) { setErro(error.message); return; }
    carregar();
  };

  const pendentes = perfis.filter((p) => p.status === "pendente");
  const ativos = perfis.filter((p) => p.status !== "pendente");
  const semCargo = ativos.filter((p) => !p.cargo_id && !p.is_admin).length;

  // ---- matriz de um cargo (tela cheia) ------------------------------------
  if (cargoAberto) {
    const cargo = cargos.find((c) => c.id === cargoAberto);
    if (!cargo) { setCargoAberto(null); return null; }
    const mapa = permsPorCargo[cargo.id] || {};
    return (
      <div style={pageStyle}>
        <div className="app-shell">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <button onClick={() => { setCargoAberto(null); carregar(); }} style={iconBtn}><ChevronLeft size={18} /></button>
            <div style={{ fontWeight: 800, fontSize: 17 }}>{cargo.nome}</div>
            <span style={{ ...pill, ...pillOk }}>{pessoasDoCargo(cargo.id)} pessoa(s)</span>
          </div>
          <div style={{ fontSize: 12, color: "#8A8778", marginBottom: 16 }}>
            Mexer na linha do módulo aplica o mesmo nível em todas as sub-abas dele.
          </div>
          {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}

          {cargo.protegido && (
            <div style={avisoStyle}>
              <Lock size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ fontSize: 13 }}>
                Esse cargo é protegido. Quem é administrador passa por cima da matriz de qualquer jeito — mexer aqui não muda o acesso dele.
              </div>
            </div>
          )}

          <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF" }}>
            {CATALOGO.map((m, idxM) => (
              <React.Fragment key={m.chave}>
                <div style={{ ...linhaMatriz, background: m.filhos ? "#F6F1E7" : "#FFFFFF", borderTop: idxM > 0 ? "1px solid #F0EBDD" : "none" }}>
                  <div style={{ fontSize: 13, fontWeight: m.filhos ? 700 : 500, color: "#22231F" }}>{m.nome}</div>
                  <Segmento
                    valor={mapa[m.chave] || "nenhum"}
                    rotulos={m.filhos ? ["—", "Ver tudo", "Editar tudo"] : null}
                    onEscolher={(n) => (m.filhos ? definirNivelEmCascata(cargo.id, m, n) : definirNivel(cargo.id, m.chave, n))}
                  />
                </div>
                {(m.filhos || []).map((f) => (
                  <div key={f.chave} style={{ ...linhaMatriz, paddingLeft: 30, borderTop: "1px solid #F0EBDD" }}>
                    <div style={{ fontSize: 12.5, color: "#22231F" }}>
                      {f.nome}
                      {f.sensivel && <span style={{ color: "#A32D2D", fontSize: 10.5 }}> · contém valores</span>}
                    </div>
                    <Segmento valor={mapa[f.chave] || "nenhum"} onEscolher={(n) => definirNivel(cargo.id, f.chave, n)} />
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
            <button onClick={() => salvarMatriz(cargo)} style={btnPrimary}>Salvar permissões</button>
            <span style={{ fontSize: 11.5, color: "#8A8778" }}>
              Vale na hora, para as {pessoasDoCargo(cargo.id)} pessoas com esse cargo.
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ---- tela principal -----------------------------------------------------
  return (
    <div style={pageStyle}>
      <div className="app-shell">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <button onClick={onVoltar} style={iconBtn}><ChevronLeft size={18} /></button>
          <div style={{ fontWeight: 800, fontSize: 17 }}>Permissões</div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <button onClick={() => setAba("cargos")} style={{ ...tabBtn, ...(aba === "cargos" ? tabBtnAtivo : {}) }}>Cargos</button>
          <button onClick={() => setAba("usuarios")} style={{ ...tabBtn, ...(aba === "usuarios" ? tabBtnAtivo : {}) }}>
            Usuários{pendentes.length > 0 ? ` (${pendentes.length})` : ""}
          </button>
        </div>

        {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}

        {carregando ? (
          <div style={{ fontSize: 13, color: "#8A8778" }}><Loader2 size={16} /> Carregando…</div>
        ) : aba === "cargos" ? (
          <>
            <div style={{ fontSize: 12, color: "#8A8778", marginBottom: 12, lineHeight: 1.5 }}>
              A permissão mora no cargo. Contratou alguém para a mesma função, é só vincular ao cargo — não precisa configurar de novo.
            </div>
            <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF" }}>
              {cargos.map((c, idx) => {
                const mapa = permsPorCargo[c.id] || {};
                const edita = Object.values(mapa).filter((n) => n === "editar").length;
                const ve = Object.values(mapa).filter((n) => n === "ver").length;
                const qtd = pessoasDoCargo(c.id);
                return (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none" }}>
                    {renomeando === c.id ? (
                      <>
                        <input value={nomeEdit} onChange={(e) => setNomeEdit(e.target.value)} autoFocus
                          onKeyDown={(e) => e.key === "Enter" && renomearCargo(c)}
                          style={{ ...inputStyle, flex: 1, padding: "6px 9px", fontSize: 13 }} />
                        <button onClick={() => renomearCargo(c)} style={{ ...ghostIconBtn, color: "#2F8F5B" }}><Check size={16} /></button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setCargoAberto(c.id)} style={{ background: "none", border: "none", padding: 0, textAlign: "left", flex: 1, minWidth: 0, cursor: "pointer" }}>
                          <div style={{ fontSize: 13.5, fontWeight: 600, color: "#22231F", display: "flex", alignItems: "center", gap: 6 }}>
                            {c.protegido && <Lock size={12} color="#8A6A0F" />}
                            {c.nome}
                          </div>
                          <div style={{ fontSize: 11, color: "#8A8778", marginTop: 2 }}>
                            {edita === 0 && ve === 0 ? "nenhum acesso configurado" : `edita ${edita} · vê ${ve}`}
                          </div>
                        </button>
                        <span style={{ ...pill, ...(qtd > 0 ? pillOk : pillWait) }}>{qtd} {qtd === 1 ? "pessoa" : "pessoas"}</span>
                        {!c.protegido && (
                          <>
                            <button onClick={() => { setRenomeando(c.id); setNomeEdit(c.nome); }} style={ghostIconBtn} aria-label="Renomear"><Pencil size={14} /></button>
                            <button onClick={() => excluirCargo(c)} style={{ ...ghostIconBtn, color: "#C4432B" }} aria-label="Excluir"><Trash2 size={14} /></button>
                          </>
                        )}
                        <button onClick={() => setCargoAberto(c.id)} style={ghostIconBtn} aria-label="Abrir permissões"><ChevronRight size={16} /></button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 12 }}>
              {criandoCargo ? (
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={novoCargo} onChange={(e) => setNovoCargo(e.target.value)} placeholder="Nome do cargo" autoFocus
                    onKeyDown={(e) => e.key === "Enter" && criarCargo()}
                    style={{ ...inputStyle, flex: 1, padding: "8px 10px", fontSize: 13 }} />
                  <button onClick={criarCargo} style={btnPrimary}>Criar</button>
                  <button onClick={() => { setCriandoCargo(false); setNovoCargo(""); }} style={btnSecondary}>Cancelar</button>
                </div>
              ) : (
                <button onClick={() => setCriandoCargo(true)} style={btnPrimary}>+ Novo cargo</button>
              )}
            </div>
          </>
        ) : (
          <>
            {pendentes.length > 0 && (
              <div style={avisoStyle}>
                <Clock size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 13 }}>
                  <b>{pendentes.length} {pendentes.length === 1 ? "pessoa aguardando" : "pessoas aguardando"} liberação.</b>{" "}
                  Elas já criaram a conta, mas não entram em nada até você aprovar e dar um cargo.
                </div>
              </div>
            )}
            {semCargo > 0 && (
              <div style={avisoStyle}>
                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 13 }}>{semCargo} pessoa(s) aprovada(s) sem cargo — elas entram e não veem módulo nenhum.</div>
              </div>
            )}

            <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF" }}>
              {[...pendentes, ...ativos].map((p, idx) => {
                const pendente = p.status === "pendente";
                return (
                  <div key={p.id} style={{
                    display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", flexWrap: "wrap",
                    borderTop: idx > 0 ? "1px solid #F0EBDD" : "none",
                    background: pendente ? "#FDFAF0" : "#FFFFFF",
                  }}>
                    <div style={{ flex: 1, minWidth: 150 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#22231F" }}>
                        {p.nome}{p.id === meuId ? " · você" : ""}
                      </div>
                      <div style={{ fontSize: 11, color: "#8A8778" }}>{p.email}</div>
                    </div>

                    {p.is_admin ? (
                      <span style={{ ...pill, ...pillOk, display: "flex", alignItems: "center", gap: 4 }}>
                        <ShieldCheck size={12} /> Administrador
                      </span>
                    ) : (
                      <select value={p.cargo_id || ""} onChange={(e) => (pendente ? aprovar(p, e.target.value) : definirCargoDe(p, e.target.value))}
                        style={{ ...inputStyle, width: "auto", padding: "6px 9px", fontSize: 12 }}>
                        <option value="">{pendente ? "Aprovar com o cargo…" : "— sem cargo —"}</option>
                        {cargos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                      </select>
                    )}

                    {pendente ? (
                      <button onClick={() => mudarStatus(p, "rejeitado")} style={{ ...linkBtn, color: "#A32D2D" }}>Recusar</button>
                    ) : (
                      <>
                        <span style={{ ...pill, ...(p.status === "aprovado" ? pillOk : pillNok) }}>
                          {p.status === "aprovado" ? "Ativo" : "Bloqueado"}
                        </span>
                        {p.id !== meuId && (
                          <>
                            <button onClick={() => alternarAdmin(p)} style={linkBtn}>
                              {p.is_admin ? "Tirar admin" : "Tornar admin"}
                            </button>
                            <button onClick={() => mudarStatus(p, p.status === "aprovado" ? "rejeitado" : "aprovado")}
                              style={{ ...linkBtn, color: p.status === "aprovado" ? "#A32D2D" : "#0F6E56" }}>
                              {p.status === "aprovado" ? "Bloquear" : "Reativar"}
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Controle de três estados: —, Ver, Editar
function Segmento({ valor, onEscolher, rotulos }) {
  return (
    <div style={{ display: "inline-flex", border: "1px solid #E8E2D2", borderRadius: 8, overflow: "hidden", background: "#FFFFFF", flexShrink: 0 }}>
      {NIVEIS.map((n, i) => {
        const ativo = valor === n.valor;
        const cor = n.valor === "editar" ? "#22231F" : n.valor === "ver" ? "#2F8F5B" : "#D9D3C2";
        return (
          <button key={n.valor} onClick={() => onEscolher(n.valor)}
            style={{
              fontSize: 11.5, padding: "5px 12px", border: "none",
              borderLeft: i > 0 ? "1px solid #E8E2D2" : "none",
              cursor: "pointer", fontWeight: ativo ? 700 : 500,
              background: ativo ? cor : "#FFFFFF",
              color: ativo ? (n.valor === "nenhum" ? "#5C5A4E" : "#F3EFE3") : "#6B6959",
            }}>
            {rotulos ? rotulos[i] : n.rotulo}
          </button>
        );
      })}
    </div>
  );
}

const pageStyle = { fontFamily: "'Inter', system-ui, sans-serif", background: "#F6F1E7", padding: 20, minHeight: "100vh", boxSizing: "border-box" };
const linhaMatriz = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 13px" };
const pill = { fontSize: 10, fontWeight: 800, padding: "3px 9px", borderRadius: 999, whiteSpace: "nowrap", flexShrink: 0 };
const pillOk = { background: "#2F8F5B22", color: "#0F6E56" };
const pillWait = { background: "#FAC77555", color: "#854F0B" };
const pillNok = { background: "#F0999522", color: "#A32D2D" };
const ghostIconBtn = { border: "none", background: "none", color: "#8A8778", cursor: "pointer", padding: 2, display: "flex" };
const btnPrimary = { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#22231F", color: "#F3EFE3", border: "none", borderRadius: 10, padding: "10px 16px", fontSize: 13.5, fontWeight: 700, cursor: "pointer" };
const btnSecondary = { background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const linkBtn = { background: "none", border: "none", color: "#8A6A0F", fontSize: 12, fontWeight: 600, cursor: "pointer", padding: 0 };
const inputStyle = { boxSizing: "border-box", padding: "10px 12px", borderRadius: 10, border: "1px solid #E8E2D2", fontSize: 14, background: "#FFFFFF", color: "#22231F" };
const iconBtn = { width: 34, height: 34, borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#22231F" };
const avisoStyle = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 14 };
