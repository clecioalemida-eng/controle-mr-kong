import React, { useState } from "react";
import {
  ChevronLeft, Loader2, AlertTriangle, Play, CheckCircle2, XCircle,
  Users, ShieldCheck, CalendarClock, Tag, MapPin,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import RadarConcorrentes from "./RadarConcorrentes";
import DiagnosticoSocial from "./DiagnosticoSocial";
import PistaMarketing from "./PistaMarketing";
import MetaAds from "./MetaAds";
import AssistenteMarketing from "./AssistenteMarketing";

// ---------------------------------------------------------------------------
// Módulo Marketing — Fase 0: Diagnóstico
//
// Esta tela NÃO grava nada e NÃO é a tela final do Marketing. Ela existe
// para responder, com dado real, três perguntas que decidem o desenho do
// CRM antes de escrevermos qualquer tabela:
//
//   1) O nosso X-API-KEY sozinho abre o endpoint de clientes do
//      CardápioWeb? (se sim, temos aniversário, e-mail, pontos e cashback)
//   2) Que fração dos pedidos vem com cliente identificado? (se a maioria
//      vier sem nome, o CRM cobre pouca gente e o plano muda)
//   3) De quantos em quantos dias o mesmo cliente volta? (é o que calibra
//      os cortes de "quente / morno / frio" — em vez de chutar 30 e 90)
//
// A Edge Function devolve apenas contagens e nomes de campo. Nenhum nome,
// telefone, e-mail ou endereço de cliente trafega até aqui.
// ---------------------------------------------------------------------------

function hoje() { return new Date().toISOString().slice(0, 10); }
function diasAtras(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

const NOMES_CANAL = {
  catalog: "Cardápio digital",
  portal: "Portal",
  ifood: "iFood",
  food99: "99Food",
  pdv: "PDV / balcão",
  whatsapp: "WhatsApp",
  app: "Aplicativo",
};

const NOMES_TIPO = {
  delivery: "Entrega",
  takeout: "Retirada",
  dine_in: "Consumo no local",
  table: "Mesa",
  indoor: "Salão",
};

// A aba Meta é marcada soAdmin porque as tabelas meta_* só liberam
// leitura pra administrador (migração 039) — mostrar o botão pra quem
// não pode entrar só produziria uma tela de erro. O operador de
// marketing continua com Radar, Diagnóstico e Pista.
const ABAS = [
  { chave: "radar", label: "Radar" },
  { chave: "leitura", label: "Diagnóstico" },
  { chave: "pista", label: "Pista" },
  { chave: "meta", label: "Meta", soAdmin: true },
  { chave: "assistente", label: "Assistente" },
  { chave: "diagnostico", label: "CardápioWeb" },
];

export default function Marketing({ onVoltar, perfil }) {
  const [aba, setAba] = useState("radar");
  const [dataInicio, setDataInicio] = useState(diasAtras(30));
  const [dataFim, setDataFim] = useState(hoje());
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState(null);
  const [res, setRes] = useState(null);

  const rodar = async () => {
    setCarregando(true);
    setErro(null);
    setRes(null);
    const { data, error } = await supabase.functions.invoke("cardapioweb-proxy", {
      body: {
        acao: "diagnostico_marketing",
        data_inicio: `${dataInicio}T00:00:00-03:00`,
        data_fim: `${dataFim}T23:59:59-03:00`,
      },
    });
    setCarregando(false);

    if (error) {
      // O supabase-js devolve uma mensagem genérica ("non-2xx status code")
      // quando a função responde com erro. A explicação de verdade vem no
      // corpo da resposta, que fica pendurado em error.context — sem isto,
      // a tela esconde justamente o que a gente precisa ler.
      let msg = error.message || "Erro ao consultar o CardápioWeb.";
      try {
        if (error.context && typeof error.context.json === "function") {
          const corpo = await error.context.json();
          if (corpo?.error) {
            msg = corpo.error + (corpo.detalhe ? ` — ${corpo.detalhe}` : "");
          }
        }
      } catch (_) {
        // se não der para ler o corpo, fica a mensagem genérica mesmo
      }
      setErro(msg);
      return;
    }

    if (data?.error) { setErro(data.error); return; }
    setRes(data);
  };

  return (
    <div style={pageStyle}>
      <div className="app-shell">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <button onClick={onVoltar} style={iconBtn}><ChevronLeft size={18} /></button>
          <div style={{ fontWeight: 800, fontSize: 17, color: "#22231F" }}>Marketing</div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {ABAS.filter((a) => !a.soAdmin || perfil?.is_admin).map((a) => (
            <button key={a.chave} onClick={() => setAba(a.chave)}
              style={{ ...tabBtn, ...(aba === a.chave ? tabBtnAtivo : {}) }}>
              {a.label}
            </button>
          ))}
        </div>

        {aba === "radar" ? <RadarConcorrentes /> :
         aba === "leitura" ? <DiagnosticoSocial /> :
         aba === "pista" ? <PistaMarketing perfil={perfil} /> :
         aba === "meta" ? <MetaAds perfil={perfil} /> :
         aba === "assistente" ? <AssistenteMarketing perfil={perfil} /> : (
        <>
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: "#22231F", marginBottom: 6 }}>
            Fase 0 · Diagnóstico
          </div>
          <div style={{ fontSize: 13, color: "#8A8778", lineHeight: 1.5 }}>
            Antes de construir o CRM, esta tela mede o que a API do CardápioWeb
            realmente entrega. Nada é gravado, e nenhum dado pessoal de cliente
            sai do servidor — só contagens.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} style={inputStyle} />
          <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={inputStyle} />
          <button onClick={rodar} disabled={carregando} style={btnPrimary}>
            {carregando ? <Loader2 size={15} /> : <Play size={15} />}
            {carregando ? "Rodando…" : "Rodar diagnóstico"}
          </button>
        </div>

        {carregando && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#8A8778", fontSize: 13, marginBottom: 14 }}>
            <Loader2 size={16} /> Consultando o CardápioWeb… pode levar até um minuto.
          </div>
        )}

        {!carregando && erro && (
          <div style={avisoStyle}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Não deu para rodar o diagnóstico</div>
              <div style={{ fontSize: 13 }}>{erro}</div>
              <div style={{ fontSize: 12, marginTop: 8, opacity: 0.85 }}>
                O CardápioWeb aceita só 5 consultas de histórico por minuto.
                Se a mensagem falar em limite, espere um minuto ou reduza o
                período para 15 dias.
              </div>
            </div>
          </div>
        )}

        {!carregando && res && <Resultado res={res} />}
        </>
        )}
      </div>
    </div>
  );
}

function Resultado({ res }) {
  const c = res.clientes_endpoint || {};
  const p = res.pedidos || {};
  const r = res.recorrencia || {};

  return (
    <div style={{ display: "grid", gap: 16 }}>

      {/* -------------------------------------------------- 1. Clientes */}
      <div>
        <div style={sectionLabel}>1 · Endpoint de clientes</div>
        <div style={{ ...cardStyle, borderColor: c.acessivel ? "#2F8F5B" : "#C4432B" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            {c.acessivel
              ? <CheckCircle2 size={18} color="#2F8F5B" />
              : <XCircle size={18} color="#C4432B" />}
            <div style={{ fontWeight: 700, fontSize: 14, color: "#22231F" }}>
              {c.acessivel ? "Acessível com o nosso token" : "Bloqueado para o nosso token"}
            </div>
            <span style={{ marginLeft: "auto", fontSize: 11, color: "#8A8778" }}>HTTP {c.http ?? "—"}</span>
          </div>

          {c.acessivel ? (
            <>
              <div style={{ fontSize: 13, color: "#8A8778", marginBottom: 10 }}>
                {c.total_na_base != null
                  ? <>Base com <b style={{ color: "#22231F" }}>{c.total_na_base}</b> clientes cadastrados.</>
                  : "Base acessível."}{" "}
                Isso libera aniversário, e-mail, pontos e cashback direto da fonte.
              </div>
              {c.preenchimento && (
                <div className="list-grid">
                  <MiniLinha rotulo="Com aniversário" valor={`${c.preenchimento.com_aniversario} de ${c.amostra}`} />
                  <MiniLinha rotulo="Com e-mail" valor={`${c.preenchimento.com_email} de ${c.amostra}`} />
                  <MiniLinha rotulo="Aceita notificação" valor={`${c.preenchimento.aceita_notificacao} de ${c.amostra}`} />
                  <MiniLinha rotulo="Com cashback" valor={`${c.preenchimento.com_cashback} de ${c.amostra}`} />
                </div>
              )}
              {c.campos_disponiveis?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 5 }}>Campos disponíveis</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {c.campos_disponiveis.map((n) => <span key={n} style={chip}>{n}</span>)}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 13, color: "#8A8778" }}>
              O CRM ainda funciona, montado a partir dos pedidos (nome e telefone).
              Ficam de fora: aniversário, e-mail, pontos e cashback.
            </div>
          )}
        </div>
      </div>

      {/* -------------------------------------------------- 2. Cobertura */}
      <div>
        <div style={sectionLabel}>2 · Cobertura do CRM</div>

        <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
          <Stat
            numero={`${p.percentual_identificado ?? 0}%`}
            rotulo="pedidos com cliente identificado"
            cor={corCobertura(p.percentual_identificado)}
          />
          <Stat numero={p.clientes_distintos ?? 0} rotulo="clientes distintos" />
          <Stat numero={p.clientes_recorrentes ?? 0} rotulo="voltaram mais de uma vez" />
        </div>

        <div className="list-grid">
          <Linha icone={<Users size={14} />} rotulo="Pedidos analisados"
            valor={`${p.analisados} de ${p.total_no_periodo}`} />
          <Linha icone={<ShieldCheck size={14} />} rotulo="Com telefone" valor={p.com_telefone} />
          <Linha icone={<MapPin size={14} />} rotulo="Com endereço de entrega" valor={p.com_endereco} />
          <Linha icone={<MapPin size={14} />} rotulo="Com coordenadas (mapa)" valor={p.com_coordenadas} />
          <Linha icone={<Tag size={14} />} rotulo="Pedidos com cupom" valor={p.com_cupom} />
          <Linha icone={<Tag size={14} />} rotulo="Cupons distintos usados" valor={p.cupons_distintos} />
        </div>

        {p.truncado && (
          <div style={{ ...avisoStyle, marginTop: 12 }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 13 }}>
              O período tem mais pedidos do que o teto analisado de uma vez.
              Os percentuais valem para a amostra, não para o período inteiro.
            </div>
          </div>
        )}
      </div>

      {/* -------------------------------------------------- 3. Recorrência */}
      <div>
        <div style={sectionLabel}>3 · De quanto em quanto tempo o cliente volta</div>
        <div style={cardStyle}>
          {r.amostras > 0 ? (
            <>
              <div style={{ display: "flex", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
                <Stat numero={`${r.intervalo_mediano_dias} d`} rotulo="intervalo mediano" />
                <Stat numero={`${r.percentil_25_dias} d`} rotulo="os mais frequentes (25%)" />
                <Stat numero={`${r.percentil_75_dias} d`} rotulo="os mais espaçados (75%)" />
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "#8A8778", lineHeight: 1.5 }}>
                <CalendarClock size={14} style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  Baseado em {r.amostras} retornos observados. {r.observacao}
                </div>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: "#8A8778" }}>
              Nenhum cliente voltou mais de uma vez dentro da amostra.
              Aumente o período para conseguir medir a recorrência.
            </div>
          )}
        </div>
      </div>

      {/* -------------------------------------------------- 4. Origem */}
      <div>
        <div style={sectionLabel}>4 · De onde vêm os pedidos</div>
        <div className="list-grid">
          {Object.entries(p.por_canal || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <Linha key={k} rotulo={NOMES_CANAL[k] || k} valor={v} />
          ))}
        </div>
        <div style={{ height: 8 }} />
        <div className="list-grid">
          {Object.entries(p.por_tipo || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
            <Linha key={k} rotulo={NOMES_TIPO[k] || k} valor={v} />
          ))}
        </div>
      </div>

      {/* -------------------------------------------------- 5. Campos */}
      {res.campos_encontrados?.no_cliente_do_pedido?.length > 0 && (
        <div>
          <div style={sectionLabel}>5 · Campos do cliente dentro do pedido</div>
          <div style={cardStyle}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {res.campos_encontrados.no_cliente_do_pedido.map((n) => (
                <span key={n} style={chip}>{n}</span>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: "#8A8778", textAlign: "center", padding: "4px 0 20px" }}>
        {res.privacidade}
      </div>
    </div>
  );
}

function corCobertura(pct) {
  if (pct == null) return "#22231F";
  if (pct >= 70) return "#2F8F5B";
  if (pct >= 40) return "#C9A227";
  return "#C4432B";
}

function Stat({ numero, rotulo, cor }) {
  return (
    <div style={statBox}>
      <div style={{ ...statNum, color: cor || "#22231F" }}>{numero}</div>
      <div style={statLabel}>{rotulo}</div>
    </div>
  );
}

function Linha({ icone, rotulo, valor }) {
  return (
    <div style={itemRow}>
      <span style={{ fontSize: 13, color: "#22231F", display: "flex", alignItems: "center", gap: 6 }}>
        {icone ? <span style={{ color: "#8A8778", display: "flex" }}>{icone}</span> : null}
        {rotulo}
      </span>
      <span style={{ fontSize: 13, fontWeight: 700, color: "#22231F" }}>{valor}</span>
    </div>
  );
}

function MiniLinha({ rotulo, valor }) {
  return (
    <div style={{ ...itemRow, padding: "7px 10px", background: "#F6F1E7" }}>
      <span style={{ fontSize: 12, color: "#8A8778" }}>{rotulo}</span>
      <span style={{ fontSize: 12, fontWeight: 700, color: "#22231F" }}>{valor}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Estilos (mesma paleta do resto do painel)
// ---------------------------------------------------------------------------
const pageStyle = {
  fontFamily: "'Inter', system-ui, sans-serif",
  background: "#F6F1E7",
  padding: 20,
  minHeight: "100vh",
  boxSizing: "border-box",
};
const iconBtn = {
  width: 34, height: 34, borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#22231F",
};
const cardStyle = {
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14,
};
const btnPrimary = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
  background: "#22231F", color: "#F3EFE3", border: "none",
  borderRadius: 8, padding: "9px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer",
};
const tabBtn = {
  padding: "8px 14px", borderRadius: 999, border: "1px solid #E8E2D2",
  background: "#FFFFFF", color: "#8A8778", fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const tabBtnAtivo = { background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" };
const inputStyle = {
  padding: "9px 10px", borderRadius: 8, border: "1px solid #E8E2D2",
  fontSize: 13, background: "#FFFFFF", color: "#22231F",
};
const avisoStyle = {
  display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A",
  color: "#7A6A1E", borderRadius: 10, padding: "14px", fontSize: 13,
};
const statBox = {
  flex: 1, minWidth: 118, background: "#FFFFFF", border: "1px solid #E8E2D2",
  borderRadius: 12, padding: "12px 14px", textAlign: "center",
};
const statNum = { fontSize: 18, fontWeight: 800, color: "#22231F" };
const statLabel = { fontSize: 11, color: "#8A8778", marginTop: 2, lineHeight: 1.3 };
const sectionLabel = {
  fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
  color: "#8A8778", marginBottom: 8,
};
const itemRow = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10, padding: "10px 12px",
};
const chip = {
  fontSize: 11, fontWeight: 600, padding: "4px 8px", borderRadius: 999,
  border: "1px solid #E8E2D2", background: "#F6F1E7", color: "#8A8778",
};
