import React, { useState, useEffect, useCallback } from "react";
import {
  Loader2, AlertTriangle, RefreshCw, Settings, BarChart3, Megaphone,
  Image, Clock, Info, CheckCircle2, Plug, TrendingDown,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";

// ---------------------------------------------------------------------------
// Anúncios da Meta — somente leitura
//
// O painel LÊ a conta de anúncios e coloca os números de venda do lado.
// Ele nunca cria, edita ou pausa campanha: isso exigiria a permissão
// ads_management, e um botão que gasta dinheiro de verdade dentro de um
// painel interno é acidente esperando acontecer.
//
// Três coisas que esta tela não faz de propósito:
//
//   1. Não calcula o veredito. Quem divide gasto por resultado e compara
//      com a margem é a função meta_veredito() no banco. As três janelas
//      (7 dias, 30 dias, mês) usam a mesma conta — se a fórmula morasse
//      aqui, um dia ela divergiria da do banco e ninguém saberia qual
//      acreditar.
//
//   2. Não soma alcance entre dias. Alcance é gente distinta; a mesma
//      pessoa alcançada em três dias vira três na soma e uma na verdade.
//      O número vem da tabela meta_janela, onde a própria Meta já
//      deduplicou o período.
//
//   3. Não desenha gasto e pedidos no mesmo gráfico. São grandezas
//      diferentes; empilhar num eixo só é o jeito clássico de fazer
//      qualquer par de linhas parecer relacionado.
//
// Enquanto não houver Pixel no CardápioWeb, tudo que depende de atribuir
// PEDIDO ao anúncio aparece marcado como estimativa — a Meta conta
// clique, não venda.
// ---------------------------------------------------------------------------

const JANELAS = [
  { v: "7d", n: "7 dias" },
  { v: "30d", n: "30 dias" },
  { v: "mes", n: "Este mês" },
];

// Referências de mercado para delivery local. Não são leis — são o ponto
// a partir do qual vale a pena perguntar o que está acontecendo.
const PISO_CTR = 1.0;      // %
const TETO_FREQUENCIA = 3; // vezes por período
const ALVO_APRENDIZADO = 50; // resultados por semana, por conjunto

export default function MetaAds({ perfil }) {
  const ehAdmin = !!perfil?.is_admin;
  const [vista, setVista] = useState("resumo");

  // A migração 039 só libera leitura pra administrador — quem não é
  // receberia uma tela de zeros sem explicação. Melhor dizer o motivo.
  if (!ehAdmin) {
    return (
      <div style={avisoStyle}>
        <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          Os anúncios ficam com o administrador. Aqui aparecem gasto, margem e
          resultado financeiro, e o acesso é restrito a quem responde por eles.
        </span>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        <Aba atual={vista} v="resumo" set={setVista} icone={<BarChart3 size={13} />} label="Resumo" />
        <Aba atual={vista} v="campanhas" set={setVista} icone={<Megaphone size={13} />} label="Campanhas" />
        <Aba atual={vista} v="criativos" set={setVista} icone={<Image size={13} />} label="Criativos" />
        <Aba atual={vista} v="horarios" set={setVista} icone={<Clock size={13} />} label="Horários" />
        <Aba atual={vista} v="ajustes" set={setVista} icone={<Settings size={13} />} label="Ajustes" />
      </div>

      {vista === "resumo" && <Resumo />}
      {vista === "campanhas" && <Campanhas />}
      {vista === "criativos" && <Criativos />}
      {vista === "horarios" && <Horarios />}
      {vista === "ajustes" && <Ajustes />}
    </div>
  );
}

function Aba({ atual, v, set, icone, label }) {
  const ativo = atual === v;
  return (
    <button onClick={() => set(v)} style={{ ...subAba, ...(ativo ? subAbaAtiva : {}) }}>
      {icone} {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// RESUMO
// ---------------------------------------------------------------------------
function Resumo() {
  const [janela, setJanela] = useState("30d");
  const [d, setD] = useState(null);
  const [coleta, setColeta] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      setCarregando(true);
      const [v, c] = await Promise.all([
        supabase.rpc("meta_veredito", { p_janela: janela }),
        supabase.from("meta_coletas").select("*").order("iniciada_em", { ascending: false }).limit(1),
      ]);
      if (!vivo) return;
      if (v.error) setErro(v.error.message);
      setD(v.data?.[0] || null);
      setColeta(c.data?.[0] || null);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [janela]);

  if (carregando) return <Carregando />;
  if (erro) return <Aviso texto={erro} />;
  if (!d) return <SemDados />;

  const semResultado = !d.resultados || Number(d.resultados) === 0;
  const naoEmpata =
    d.pedidos_para_empatar != null && Number(d.pedidos_para_empatar) > Number(d.resultados || 0);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {JANELAS.map((j) => (
          <button key={j.v} onClick={() => setJanela(j.v)}
            style={{ ...subAba, ...(janela === j.v ? subAbaAtiva : {}) }}>
            {j.n}
          </button>
        ))}
      </div>

      {/* investido */}
      <div style={{ background: "#22231F", borderRadius: 12, padding: "13px 14px", color: "#F3EFE3" }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", opacity: 0.68 }}>
          Investido · {d.dias} dia{d.dias > 1 ? "s" : ""}
        </div>
        <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.05, margin: "3px 0 2px", fontVariantNumeric: "tabular-nums" }}>
          {dinheiro(d.gasto_midia)}
        </div>
        <div style={{ fontSize: 11, opacity: 0.72 }}>
          {Number(d.taxa_gestao) > 0
            ? `+ ${dinheiro(d.taxa_gestao)} de gestão rateada · custo total ${dinheiro(d.custo_total)}`
            : "sem taxa de gestão informada em Ajustes"}
        </div>
      </div>

      {/* números da mídia */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 7 }}>
        <Kpi k="Alcance" v={numero(d.alcance)} s="pessoas" />
        <Kpi k="Frequência" v={d.frequencia ? `${numero(d.frequencia, 1)}×` : "—"}
             s={Number(d.frequencia) > TETO_FREQUENCIA ? `acima de ${TETO_FREQUENCIA}` : "saudável"}
             ruim={Number(d.frequencia) > TETO_FREQUENCIA} />
        <Kpi k="CPM" v={dinheiro(d.cpm)} s="por mil" />
        <Kpi k="Cliques" v={numero(d.cliques_link)} s="no link" />
        <Kpi k="CTR" v={d.ctr_link_pct != null ? `${numero(d.ctr_link_pct, 2)}%` : "—"}
             s={Number(d.ctr_link_pct) < PISO_CTR ? `abaixo de ${PISO_CTR}%` : "acima do piso"}
             ruim={d.ctr_link_pct != null && Number(d.ctr_link_pct) < PISO_CTR} />
        <Kpi k="CPC" v={dinheiro(d.cpc_link)} s="por clique" />
      </div>

      {/* resultado declarado */}
      <div style={cardStyle}>
        <div style={sectionLabel}>Resultado declarado pela Meta</div>
        <Linha nome={nomeDaAcao(d.acao_resultado)} valor={numero(d.resultados, 1)} />
        <Linha nome="Custo por resultado" valor={dinheiro(d.custo_resultado)} />
        <Linha nome="Pedidos no CardápioWeb"
               valor={d.pixel_no_cardapioweb ? "—" : "sem Pixel"}
               fraco={!d.pixel_no_cardapioweb} />
        {semResultado && (
          <div style={{ ...avisoStyle, marginTop: 9 }}>
            <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Zero resultados costuma significar que a campanha tem outro
              objetivo, não que ela não funcionou. Em <strong>Ajustes</strong>,
              escolha o tipo de ação que conta como resultado.
            </span>
          </div>
        )}
      </div>

      {/* o veredito */}
      <div style={{ ...cardStyle, borderLeft: `3px solid ${naoEmpata ? "#C4432B" : "#2F8F5B"}` }}>
        <div style={{ ...sectionLabel, marginBottom: 6 }}>
          O que isso significa{" "}
          {d.e_estimativa && <span style={seloEstimado}>estimado</span>}
        </div>

        {d.ticket_medio == null ? (
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "#6C6959" }}>
            Falta o ticket médio. Ele sai sozinho das vendas assim que a curva
            de pedidos tiver alguns dias, ou você informa à mão em{" "}
            <strong>Ajustes</strong>.
          </div>
        ) : (
          <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
            Ticket médio de <strong>{dinheiro(d.ticket_medio)}</strong>{" "}
            <span style={{ color: "#8A8778" }}>({d.origem_ticket})</span> com
            margem de contribuição de <strong>{numero(d.margem_contribuicao_pct, 1)}%</strong>{" "}
            deixam <strong>{dinheiro(d.margem_por_pedido)}</strong> por pedido.
            <br /><br />
            Para o custo de <strong>{dinheiro(d.custo_total)}</strong> voltar em
            margem, este período precisa gerar{" "}
            <strong>{numero(d.pedidos_para_empatar)} pedidos</strong> vindos do
            anúncio.{" "}
            {naoEmpata ? (
              <strong style={{ color: "#C4432B" }}>
                A Meta registrou {numero(d.resultados, 1)}. Não empata.
              </strong>
            ) : (
              <strong style={{ color: "#2F8F5B" }}>
                A Meta registrou {numero(d.resultados, 1)}.
              </strong>
            )}
          </div>
        )}

        {d.e_estimativa && (
          <div style={{ ...avisoStyle, marginTop: 10 }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              Sem o Pixel no CardápioWeb, a Meta conta <strong>clique</strong>,
              não venda — e "conversa iniciada" não é pedido. A comparação
              acima trata cada resultado como se fosse um pedido, o que é
              otimista. O número real é pior, nunca melhor.
            </span>
          </div>
        )}
      </div>

      <Rodape coleta={coleta} atualizado={d.atualizado_em} conta={d.nome_conta} />
    </div>
  );
}

function Linha({ nome, valor, fraco }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "6px 0", fontSize: 12.5, borderTop: "1px solid #F1ECE0" }}>
      <span style={{ color: "#6C6959" }}>{nome}</span>
      <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", color: fraco ? "#8A8778" : "#22231F" }}>{valor}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CAMPANHAS
// ---------------------------------------------------------------------------
function Campanhas() {
  const [linhas, setLinhas] = useState([]);
  const [aprend, setAprend] = useState([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    (async () => {
      const [c, a] = await Promise.all([
        supabase.from("v_meta_campanhas_30d").select("*").order("gasto", { ascending: false }),
        supabase.from("v_meta_aprendizado").select("*"),
      ]);
      setLinhas(c.data || []);
      setAprend(a.data || []);
      setCarregando(false);
    })();
  }, []);

  if (carregando) return <Carregando />;
  if (!linhas.length) return <SemDados />;

  const custos = linhas
    .filter((x) => x.custo_resultado != null)
    .map((x) => Number(x.custo_resultado));
  const presas = aprend.filter((a) => !a.saiu_do_aprendizado);
  const totalResultados = aprend.reduce((s, a) => s + Number(a.resultados_7d || 0), 0);
  const espalhado = presas.length > 1 && totalResultados >= ALVO_APRENDIZADO;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={cardStyle}>
        <div style={sectionLabel}>Últimos 30 dias · {linhas.length} campanha{linhas.length > 1 ? "s" : ""}</div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <Th>Campanha</Th><Th r>Gasto</Th><Th r>Result.</Th><Th r>Custo</Th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              // Numeric do Postgres pode chegar como texto dependendo do
              // driver. Comparar sem converter faria "10.81" perder de
              // "9.5" e o painel apontaria a campanha errada como melhor.
              const c = l.custo_resultado != null ? Number(l.custo_resultado) : null;
              const melhor = c != null && custos.length > 1 && c === Math.min(...custos);
              const pior = c != null && custos.length > 1 && c === Math.max(...custos);
              const cor = melhor ? "#2F8F5B" : pior ? "#C4432B" : "#22231F";
              return (
                <tr key={l.campanha_id}>
                  <Td forte>{l.nome}</Td>
                  <Td r>{numero(l.gasto)}</Td>
                  <Td r>{numero(l.resultados, 1)}</Td>
                  <Td r cor={cor} forte={melhor || pior}>
                    {l.custo_resultado != null ? numero(l.custo_resultado) : "—"}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div style={{ fontSize: 10, color: "#8A8778", marginTop: 7 }}>
          Custo em reais por resultado. CTR e CPM saem de razão de somas, não de
          média das taxas diárias.
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionLabel}>Fase de aprendizado · últimos 7 dias</div>
        <div style={{ display: "grid", gap: 6 }}>
          {aprend.map((a) => (
            <div key={a.campanha_id} style={itemRow}>
              <span style={{ fontSize: 12 }}>{a.nome}</span>
              <span style={{ ...tagBase, ...(a.saiu_do_aprendizado ? tagOk : tagBad) }}>
                {a.saiu_do_aprendizado ? "saiu" : "preso"} · {numero(a.resultados_7d, 1)}/{ALVO_APRENDIZADO}
              </span>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 10, color: "#8A8778", marginTop: 8, lineHeight: 1.5 }}>
          A Meta pede cerca de {ALVO_APRENDIZADO} resultados por semana em cada
          <strong> conjunto de anúncios</strong> pra sair do aprendizado. Medimos
          por campanha, que é o nível que a API entrega sem custo extra — numa
          campanha com vários conjuntos, o número real por conjunto é ainda menor.
        </div>
      </div>

      {presas.map((a) => (
        <Alerta key={a.campanha_id} titulo={`${a.nome} não saiu do aprendizado`}>
          {numero(a.resultados_7d, 1)} resultados na semana, contra os{" "}
          {ALVO_APRENDIZADO} que a Meta pede. Gastou {dinheiro(a.gasto_7d)} no
          período entregando no escuro.
        </Alerta>
      ))}

      {espalhado && (
        <Alerta cor="#C9A227" titulo="Orçamento espalhado entre campanhas">
          Somados, os resultados da semana dariam{" "}
          {numero(totalResultados, 1)} — o suficiente pra uma campanha aprender.
          Separados, nenhuma chega lá sozinha.
        </Alerta>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CRIATIVOS
// ---------------------------------------------------------------------------
function Criativos() {
  const [ads, setAds] = useState([]);
  const [pos, setPos] = useState([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    (async () => {
      const [a, p] = await Promise.all([
        supabase.from("v_meta_criativos_30d").select("*").order("ctr_link_pct", { ascending: false, nullsFirst: false }),
        supabase.from("v_meta_posicionamento_30d").select("*").order("gasto", { ascending: false }),
      ]);
      setAds(a.data || []);
      setPos(p.data || []);
      setCarregando(false);
    })();
  }, []);

  if (carregando) return <Carregando />;
  if (!ads.length) return <SemDados />;

  const maiorCtr = Math.max(...ads.map((a) => Number(a.ctr_link_pct || 0)), PISO_CTR);
  const gastoTotal = ads.reduce((s, a) => s + Number(a.gasto || 0), 0);
  const resTotal = ads.reduce((s, a) => s + Number(a.resultados || 0), 0);
  const custoMedio = resTotal > 0 ? gastoTotal / resTotal : null;

  // O criativo caro não desperdiça só o próprio dinheiro: ele consome
  // entregas que a Meta daria ao criativo bom dentro do mesmo conjunto.
  // Por isso o alerta mostra o efeito dele no custo médio, não o custo dele.
  const vilao = ads
    .filter((a) => a.custo_resultado != null && custoMedio != null && Number(a.custo_resultado) > custoMedio * 1.5)
    .sort((a, b) => Number(b.gasto) - Number(a.gasto))[0];

  let custoSemVilao = null;
  if (vilao) {
    const g = gastoTotal - Number(vilao.gasto || 0);
    const r = resTotal - Number(vilao.resultados || 0);
    custoSemVilao = r > 0 ? g / r : null;
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={cardStyle}>
        <div style={sectionLabel}>CTR no link · últimos 30 dias</div>
        <div style={{ display: "grid", gap: 9 }}>
          {ads.map((a) => {
            const ctr = Number(a.ctr_link_pct || 0);
            const fraco = ctr < PISO_CTR;
            return (
              <div key={a.anuncio_id} style={{ fontSize: 11.5 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600 }}>{a.nome}</span>
                  <span style={{ color: "#8A8778", fontVariantNumeric: "tabular-nums" }}>
                    {a.ctr_link_pct != null ? `${numero(ctr, 2)}%` : "—"}
                  </span>
                </div>
                <div style={{ height: 9, borderRadius: 999, background: "#E8E2D2", overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 999,
                    width: `${Math.min(100, (ctr / maiorCtr) * 100)}%`,
                    background: fraco ? "#C4432B" : "#22231F",
                  }} />
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 10, color: "#8A8778", marginTop: 8 }}>
          Referência de delivery: {PISO_CTR.toFixed(1)}% é o piso aceitável.
          Abaixo disso costuma ser criativo fraco, não público errado.
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionLabel}>Custo por resultado</div>
        {ads.map((a) => (
          <Linha key={a.anuncio_id} nome={a.nome}
                 valor={a.custo_resultado != null ? dinheiro(a.custo_resultado) : "—"} />
        ))}
      </div>

      {pos.length > 0 && (
        <div style={cardStyle}>
          <div style={sectionLabel}>Onde o dinheiro apareceu</div>
          <div style={{ display: "flex", height: 22, borderRadius: 6, overflow: "hidden", gap: 2, background: "#E8E2D2" }}>
            {pos.slice(0, 4).map((p, i) => (
              <div key={`${p.plataforma}-${p.posicao}`} title={`${p.plataforma} ${p.posicao}`}
                style={{
                  width: `${p.fatia_do_gasto_pct || 0}%`,
                  background: CORES_POS[i % CORES_POS.length],
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, fontWeight: 700,
                  color: i === 2 ? "#22231F" : "#F7F3EA", whiteSpace: "nowrap", overflow: "hidden",
                }}>
                {Number(p.fatia_do_gasto_pct) >= 12 ? `${numero(p.fatia_do_gasto_pct, 0)}%` : ""}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 7, fontSize: 10.5, color: "#8A8778" }}>
            {pos.slice(0, 4).map((p, i) => (
              <span key={`l-${p.plataforma}-${p.posicao}`}>
                <i style={{ width: 9, height: 9, borderRadius: 2, display: "inline-block", marginRight: 4, background: CORES_POS[i % CORES_POS.length] }} />
                {p.plataforma} {p.posicao} · {numero(p.fatia_do_gasto_pct, 0)}%
              </span>
            ))}
          </div>
          <div style={{ fontSize: 10, color: "#8A8778", marginTop: 8, lineHeight: 1.5 }}>
            Dinheiro em <strong>audience_network</strong> costuma vir do
            Advantage+ posicionamentos ligado. Para delivery local, ali converte
            pior que Instagram.
          </div>
        </div>
      )}

      {vilao && custoSemVilao != null && (
        <Alerta titulo={`"${vilao.nome}" consumiu ${numero(vilao.fatia_do_gasto_pct, 0)}% do período`}>
          {dinheiro(vilao.gasto)} a {dinheiro(vilao.custo_resultado)} por
          resultado. Sozinho, ele puxou o custo médio de{" "}
          {dinheiro(custoSemVilao)} para {dinheiro(custoMedio)}.
        </Alerta>
      )}
    </div>
  );
}

const CORES_POS = ["#C4432B", "#22231F", "#C9A227", "#8A8778"];

// ---------------------------------------------------------------------------
// HORÁRIOS
// ---------------------------------------------------------------------------
function Horarios() {
  const [horas, setHoras] = useState([]);
  const [cfg, setCfg] = useState(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    (async () => {
      const [h, c] = await Promise.all([
        supabase.from("v_meta_hora_30d").select("*").order("hora"),
        supabase.from("meta_config").select("fuso_conta").eq("id", true).maybeSingle(),
      ]);
      setHoras(h.data || []);
      setCfg(c.data || null);
      setCarregando(false);
    })();
  }, []);

  if (carregando) return <Carregando />;
  if (!horas.length) return <SemDados />;

  const temVendas = horas.some((h) => Number(h.pedidos) > 0);
  const temGasto = horas.some((h) => Number(h.gasto) > 0);

  const gastoTotal = horas.reduce((s, h) => s + Number(h.gasto || 0), 0);
  const pedTotal = horas.reduce((s, h) => s + Number(h.pedidos || 0), 0);

  const madrugada = horas.filter((h) => h.hora <= 9);
  const gastoMadrugada = madrugada.reduce((s, h) => s + Number(h.gasto || 0), 0);
  const pedMadrugada = madrugada.reduce((s, h) => s + Number(h.pedidos || 0), 0);

  const faixa = melhorFaixa(horas);

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {cfg?.fuso_conta && cfg.fuso_conta !== "America/Sao_Paulo" && (
        <Alerta titulo="A conta de anúncios não está em horário de Brasília">
          A quebra por hora vem no fuso da conta ({cfg.fuso_conta}). Comparar com
          a curva de pedidos daqui vai errar por algumas horas até isso ser
          ajustado no Gerenciador.
        </Alerta>
      )}

      <div style={cardStyle}>
        {temVendas ? (
          <Grafico titulo="Pedidos por hora · CardápioWeb"
                   valores={horas.map((h) => Number(h.pedidos))} cor="#22231F" />
        ) : (
          <div style={{ ...avisoStyle }}>
            <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>
              A curva de pedidos ainda não tem dados. Ela é montada um dia por
              vez, de madrugada, porque o CardápioWeb limita a 5 consultas de
              histórico por minuto. Em <strong>Ajustes</strong> dá pra buscar
              alguns dias à mão.
            </span>
          </div>
        )}

        {temGasto && (
          <div style={{ marginTop: 14 }}>
            <Grafico titulo="Gasto do anúncio por hora · Meta"
                     valores={horas.map((h) => Number(h.gasto))} cor="#C4432B" />
          </div>
        )}

        <div style={{ fontSize: 10, color: "#8A8778", marginTop: 9, lineHeight: 1.5 }}>
          Duas escalas diferentes, dois gráficos, mesmo eixo de horas. Pedido e
          reais não cabem num eixo só — empilhar as duas coisas faria qualquer
          par de curvas parecer relacionado.
        </div>
      </div>

      {temGasto && temVendas && (
        <>
          <div style={cardStyle}>
            <div style={sectionLabel}>O que sobra fora do horário</div>
            <Linha nome="Gasto entre 00h e 09h" valor={dinheiro(gastoMadrugada)} />
            <Linha nome="Pedidos nesse intervalo" valor={numero(pedMadrugada)} />
            <Linha nome="Fatia do orçamento"
                   valor={gastoTotal > 0 ? `${numero((gastoMadrugada / gastoTotal) * 100, 0)}%` : "—"} />
            {faixa && (
              <div style={{
                marginTop: 9, borderLeft: "2px solid #2F8F5B", background: "#2F8F5B12",
                padding: "8px 10px", borderRadius: "0 7px 7px 0", fontSize: 11.5, lineHeight: 1.5,
              }}>
                <strong>Faixa sugerida: {faixa.inicio}h às {faixa.fim}h.</strong>{" "}
                Concentra {numero((faixa.pedidos / pedTotal) * 100, 0)}% dos
                pedidos. Começar meia hora antes do pico é hipótese, não lei —
                em delivery a decisão vem antes do pedido, e isso é testável:
                roda um mês e o painel compara com o anterior.
              </div>
            )}
          </div>

          <Alerta cor="#C9A227" titulo="Programar horário exige orçamento vitalício">
            A Meta só libera o calendário de veiculação em conjunto com orçamento
            vitalício. Com orçamento diário o caminho é regra automatizada, que é
            mais frágil. Vale perguntar isso a quem opera as campanhas.
          </Alerta>
        </>
      )}
    </div>
  );
}

// Janela contínua de 4 horas com o maior volume de pedidos, esticada uma
// hora pra trás — a decisão de onde jantar vem antes do pedido.
function melhorFaixa(horas) {
  const p = horas.map((h) => Number(h.pedidos || 0));
  if (!p.some((x) => x > 0)) return null;
  let melhor = { i: 0, soma: -1 };
  for (let i = 0; i + 4 <= 24; i++) {
    const soma = p.slice(i, i + 4).reduce((a, b) => a + b, 0);
    if (soma > melhor.soma) melhor = { i, soma };
  }
  const inicio = Math.max(0, melhor.i - 1);
  const fim = Math.min(23, melhor.i + 4);
  const pedidos = p.slice(inicio, fim + 1).reduce((a, b) => a + b, 0);
  return { inicio: pad(inicio), fim: pad(fim), pedidos };
}
function pad(n) { return String(n).padStart(2, "0"); }

function Grafico({ titulo, valores, cor }) {
  const maior = Math.max(...valores, 1);
  return (
    <div>
      <div style={{ ...sectionLabel, marginBottom: 5 }}>{titulo}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 1.5, alignItems: "end", height: 58 }}>
        {valores.map((v, i) => (
          <div key={i} title={`${pad(i)}h · ${numero(v, 2)}`}
            style={{
              height: `${Math.max(2, (v / maior) * 100)}%`,
              background: v > 0 ? cor : "#E8E2D2",
              borderRadius: "3px 3px 0 0",
            }} />
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 1.5, marginTop: 4, fontSize: 7.5, color: "#8A8778", textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
        {valores.map((_, i) => <span key={i}>{i % 3 === 0 ? i : ""}</span>)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AJUSTES
// ---------------------------------------------------------------------------
function Ajustes() {
  const [cfg, setCfg] = useState(null);
  const [tipos, setTipos] = useState([]);
  const [vendas, setVendas] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [rodando, setRodando] = useState("");
  const [msg, setMsg] = useState(null);

  const carregar = useCallback(async () => {
    const [c, t, v] = await Promise.all([
      supabase.from("meta_config").select("*").eq("id", true).maybeSingle(),
      supabase.from("v_meta_tipos_de_acao").select("*"),
      supabase.from("v_meta_vendas_30d").select("*").maybeSingle(),
    ]);
    setCfg(c.data || null);
    setTipos(t.data || []);
    setVendas(v.data || null);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // A Edge Function devolve o motivo do erro no corpo da resposta. Sem
  // ler o corpo, tudo vira "non-2xx status code" e a pessoa fica sem
  // saber se é token, permissão ou conta errada.
  const chamar = async (acao, corpo = {}) => {
    setRodando(acao);
    setMsg(null);
    try {
      const { data, error } = await supabase.functions.invoke("meta-ads-proxy", {
        body: { acao, ...corpo },
      });
      if (error) {
        let detalhe = error.message;
        try { const j = await error.context?.json?.(); if (j?.error) detalhe = j.error; } catch { /* corpo não era json */ }
        setMsg({ tipo: "erro", texto: detalhe });
      } else if (data?.error) {
        setMsg({ tipo: "erro", texto: data.error });
      } else {
        setMsg({ tipo: "ok", texto: resumoDaResposta(acao, data) });
        await carregar();
      }
    } catch (e) {
      setMsg({ tipo: "erro", texto: String(e) });
    }
    setRodando("");
  };

  const salvar = async (campos) => {
    setSalvando(true);
    const { error } = await supabase.from("meta_config")
      .update({ ...campos, atualizado_em: new Date().toISOString() }).eq("id", true);
    setSalvando(false);
    if (error) setMsg({ tipo: "erro", texto: error.message });
    else { setMsg({ tipo: "ok", texto: "Salvo." }); carregar(); }
  };

  if (carregando) return <Carregando />;
  if (!cfg) return <Aviso texto="Configuração não encontrada. Rode a migração 039 no SQL Editor." />;

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {msg && (
        <div style={msg.tipo === "ok" ? avisoOk : avisoErro}>
          {msg.tipo === "ok" ? <CheckCircle2 size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                             : <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />}
          <span>{msg.texto}</span>
        </div>
      )}

      <div style={cardStyle}>
        <div style={sectionLabel}>Conexão</div>
        <Linha nome="Conta" valor={cfg.nome_conta || "não conectada"} fraco={!cfg.nome_conta} />
        <Linha nome="Moeda" valor={cfg.moeda_conta || "—"} />
        <Linha nome="Fuso" valor={cfg.fuso_conta || "—"} />
        <div style={{ display: "flex", gap: 7, marginTop: 10, flexWrap: "wrap" }}>
          <button style={btnSecondary} disabled={!!rodando} onClick={() => chamar("testar_conexao")}>
            {rodando === "testar_conexao" ? <Loader2 size={13} /> : <Plug size={13} />} Testar conexão
          </button>
          <button style={btnPrimary} disabled={!!rodando} onClick={() => chamar("sincronizar")}>
            {rodando === "sincronizar" ? <Loader2 size={13} /> : <RefreshCw size={13} />} Sincronizar anúncios
          </button>
        </div>
        <div style={{ fontSize: 10, color: "#8A8778", marginTop: 8, lineHeight: 1.5 }}>
          O token vive nos secrets do Supabase (<code>META_ACCESS_TOKEN</code> e{" "}
          <code>META_AD_ACCOUNT_ID</code>), nunca no código nem no navegador. A
          permissão pedida é <code>ads_read</code>: o painel lê, não mexe.
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionLabel}>Curva de pedidos</div>
        <Linha nome="Dias com dado" valor={numero(vendas?.dias_com_dado || 0)} />
        <Linha nome="Pedidos (30 dias)" valor={numero(vendas?.pedidos || 0)} />
        <Linha nome="Ticket médio calculado"
               valor={vendas?.ticket_medio ? dinheiro(vendas.ticket_medio) : "—"}
               fraco={!vendas?.ticket_medio} />
        <div style={{ display: "flex", gap: 7, marginTop: 10, flexWrap: "wrap" }}>
          <button style={btnSecondary} disabled={!!rodando}
                  onClick={() => chamar("sincronizar_vendas_hora")}>
            {rodando === "sincronizar_vendas_hora" ? <Loader2 size={13} /> : <RefreshCw size={13} />} Buscar ontem
          </button>
        </div>
        <div style={{ fontSize: 10, color: "#8A8778", marginTop: 8, lineHeight: 1.5 }}>
          Um dia por vez, de propósito: o CardápioWeb limita a 5 consultas de
          histórico por minuto e um mês inteiro de uma vez estoura. O robô da
          madrugada busca o dia anterior e a série se constrói sozinha.
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionLabel}>O que conta como resultado</div>
        <select
          value={cfg.acao_resultado}
          onChange={(e) => salvar({ acao_resultado: e.target.value })}
          disabled={salvando}
          style={{ ...inputStyle, width: "100%" }}
        >
          <option value={cfg.acao_resultado}>{nomeDaAcao(cfg.acao_resultado)} (atual)</option>
          {tipos.filter((t) => t.action_type !== cfg.acao_resultado).map((t) => (
            <option key={t.action_type} value={t.action_type}>
              {nomeDaAcao(t.action_type)} · {numero(t.total, 0)} em 30 dias
            </option>
          ))}
        </select>
        <div style={{ fontSize: 10, color: "#8A8778", marginTop: 8, lineHeight: 1.5 }}>
          A lista sai dos tipos que apareceram de verdade nos seus dados, não de
          um catálogo chutado. Campanha de mensagens conta{" "}
          <strong>conversa iniciada</strong>; campanha de vendas com Pixel conta{" "}
          <strong>compra</strong>.
        </div>
      </div>

      <div style={cardStyle}>
        <div style={sectionLabel}>A conta do dinheiro</div>
        <CampoNumero rotulo="Taxa de gestão da agência (R$/mês)"
          valor={cfg.taxa_gestao_mensal}
          ao={(v) => salvar({ taxa_gestao_mensal: v })} salvando={salvando}
          dica="Entra na conta porque é custo de aquisição igual à mídia. Deixar de fora maquia o resultado a favor de quem cobra a taxa. É rateada pelos dias da janela." />
        <CampoNumero rotulo="Margem de contribuição (%)"
          valor={cfg.margem_contribuicao_pct}
          ao={(v) => salvar({ margem_contribuicao_pct: v })} salvando={salvando}
          dica="O que sobra do pedido depois de insumo, embalagem, taxa de cartão e comissão. Sai do DRE. Não é lucro líquido." />
        <CampoNumero rotulo="Ticket médio à mão (R$, opcional)"
          valor={cfg.ticket_medio_manual}
          ao={(v) => salvar({ ticket_medio_manual: v === "" ? null : v })} salvando={salvando}
          dica="Deixe vazio pra usar as vendas reais dos últimos 30 dias." />
      </div>

      <div style={cardStyle}>
        <div style={sectionLabel}>Pixel no CardápioWeb</div>
        <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, cursor: "pointer" }}>
          <input type="checkbox" checked={!!cfg.pixel_no_cardapioweb}
                 onChange={(e) => salvar({ pixel_no_cardapioweb: e.target.checked })}
                 disabled={salvando} />
          <span>O Pixel da Meta está instalado no CardápioWeb</span>
        </label>
        <div style={{ fontSize: 10, color: "#8A8778", marginTop: 8, lineHeight: 1.5 }}>
          Enquanto estiver desmarcado, tudo que depende de atribuir pedido ao
          anúncio aparece marcado como <strong>estimado</strong>. Marcar sem ter
          instalado não melhora o resultado — só apaga o aviso e transforma
          estimativa em número com cara de medido.
        </div>
      </div>
    </div>
  );
}

function CampoNumero({ rotulo, valor, ao, salvando, dica }) {
  const [v, setV] = useState(valor ?? "");
  useEffect(() => { setV(valor ?? ""); }, [valor]);
  const mudou = String(v) !== String(valor ?? "");
  return (
    <div style={{ padding: "9px 0", borderTop: "1px solid #F1ECE0" }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 5 }}>{rotulo}</div>
      <div style={{ display: "flex", gap: 7 }}>
        <input type="number" step="0.01" value={v} onChange={(e) => setV(e.target.value)}
               style={{ ...inputStyle, flex: 1 }} disabled={salvando} />
        <button style={{ ...btnSecondary, opacity: mudou ? 1 : 0.4 }}
                disabled={!mudou || salvando}
                onClick={() => ao(v === "" ? "" : Number(v))}>
          Salvar
        </button>
      </div>
      {dica && <div style={{ fontSize: 10, color: "#8A8778", marginTop: 6, lineHeight: 1.5 }}>{dica}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Peças pequenas
// ---------------------------------------------------------------------------
function Kpi({ k, v, s, ruim }) {
  return (
    <div style={{ background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10, padding: "9px 10px" }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778" }}>{k}</div>
      <div style={{ fontSize: 16, fontWeight: 800, marginTop: 2, lineHeight: 1.15, fontVariantNumeric: "tabular-nums", color: ruim ? "#C4432B" : "#22231F" }}>{v}</div>
      <div style={{ fontSize: 10, color: "#8A8778", fontVariantNumeric: "tabular-nums" }}>{s}</div>
    </div>
  );
}

function Alerta({ titulo, children, cor = "#C4432B" }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "18px 1fr", gap: 9,
      background: "#FFFFFF", border: "1px solid #E8E2D2", borderLeft: `3px solid ${cor}`,
      borderRadius: 8, padding: "10px 11px", fontSize: 11.5, lineHeight: 1.5,
    }}>
      <TrendingDown size={14} style={{ color: cor, marginTop: 2 }} />
      <div>
        <strong style={{ display: "block", marginBottom: 2 }}>{titulo}</strong>
        <span style={{ color: "#6C6959" }}>{children}</span>
      </div>
    </div>
  );
}

function Rodape({ coleta, atualizado, conta }) {
  return (
    <div style={{ fontSize: 10, color: "#8A8778", lineHeight: 1.6, paddingTop: 4 }}>
      {conta && <>Conta <strong>{conta}</strong> · </>}
      {atualizado ? `números de ${dataHoraBR(atualizado)}` : "ainda não sincronizado"}
      {coleta?.status === "erro" && (
        <><br /><span style={{ color: "#C4432B" }}>A última sincronia falhou: {coleta.erro}</span></>
      )}
    </div>
  );
}

function Th({ children, r }) {
  return (
    <th style={{
      textAlign: r ? "right" : "left", fontSize: 9.5, fontWeight: 700, letterSpacing: 0.3,
      textTransform: "uppercase", color: "#8A8778", padding: "0 0 6px", paddingRight: r ? 0 : 8,
    }}>{children}</th>
  );
}
function Td({ children, r, forte, cor }) {
  return (
    <td style={{
      padding: "7px 0", borderTop: "1px solid #E8E2D2", textAlign: r ? "right" : "left",
      fontVariantNumeric: "tabular-nums", fontWeight: forte ? 700 : 400,
      color: cor || "#22231F", paddingRight: r ? 0 : 8,
    }}>{children}</td>
  );
}

function Carregando() {
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: 28, color: "#8A8778" }}>
      <Loader2 size={20} />
    </div>
  );
}

function SemDados() {
  return (
    <div style={avisoStyle}>
      <Info size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>
        Nenhum dado ainda. Vá em <strong>Ajustes</strong>, teste a conexão e
        rode a primeira sincronia. Se a conexão falhar, o erro vai dizer se é
        token, permissão ou conta errada.
      </span>
    </div>
  );
}

function Aviso({ texto }) {
  return (
    <div style={avisoErro}>
      <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{texto}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------
function numero(v, casas = 0) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}
function dinheiro(v) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function dataHoraBR(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// Os action_types da Meta são nomes de sistema. Traduzimos os que
// aparecem em conta de restaurante; o resto passa cru, porque inventar
// tradução pra um tipo que a gente não conhece é pior que mostrar o nome
// original.
const NOMES_ACAO = {
  "onsite_conversion.messaging_conversation_started": "Conversas iniciadas",
  "onsite_conversion.messaging_conversation_started_7d": "Conversas iniciadas (7d)",
  "onsite_conversion.messaging_first_reply": "Primeiras respostas",
  "link_click": "Cliques no link",
  "landing_page_view": "Visualizações da página",
  "post_engagement": "Engajamento no post",
  "page_engagement": "Engajamento na página",
  "purchase": "Compras",
  "offsite_conversion.fb_pixel_purchase": "Compras (Pixel)",
  "offsite_conversion.fb_pixel_initiate_checkout": "Checkouts iniciados (Pixel)",
  "offsite_conversion.fb_pixel_add_to_cart": "Adições ao carrinho (Pixel)",
  "lead": "Cadastros",
  "video_view": "Visualizações de vídeo",
};
function nomeDaAcao(t) { return NOMES_ACAO[t] || t || "—"; }

function resumoDaResposta(acao, data) {
  if (acao === "testar_conexao") {
    const c = data?.conta || {};
    const base = `Conectado em ${c.nome || "conta sem nome"} (${c.moeda || "?"}, ${c.fuso || "?"}).`;
    if (data?.aviso_fuso) return `${base} ${data.aviso_fuso}`;
    if (c.ativa === false) return `${base} Atenção: a conta não está com status ativo na Meta.`;
    return base;
  }
  if (acao === "sincronizar") {
    return `Sincronizado: ${data?.dias} dias, ${data?.linhas} linhas gravadas.`;
  }
  if (acao === "sincronizar_vendas_hora") {
    return `Curva do dia ${data?.dia}: ${data?.pedidos} pedidos.`;
  }
  return "Pronto.";
}

// ---------------------------------------------------------------------------
// estilos
// ---------------------------------------------------------------------------
const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 13 };
const itemRow = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10, padding: "9px 11px",
};
const btnPrimary = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  background: "#22231F", color: "#F3EFE3", border: "none",
  borderRadius: 8, padding: "9px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer",
};
const btnSecondary = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F",
  borderRadius: 8, padding: "8px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
};
const inputStyle = {
  padding: "8px 10px", borderRadius: 8, border: "1px solid #E8E2D2",
  fontSize: 13, background: "#FFFFFF", color: "#22231F", boxSizing: "border-box",
};
const avisoStyle = {
  display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A",
  color: "#7A6A1E", borderRadius: 10, padding: "12px 13px", fontSize: 12.5, lineHeight: 1.5,
};
const avisoOk = {
  display: "flex", gap: 8, background: "#2F8F5B14", border: "1px solid #2F8F5B",
  color: "#256F47", borderRadius: 10, padding: "12px 13px", fontSize: 12.5, lineHeight: 1.5,
};
const avisoErro = {
  display: "flex", gap: 8, background: "#C4432B12", border: "1px solid #C4432B",
  color: "#A5351F", borderRadius: 10, padding: "12px 13px", fontSize: 12.5, lineHeight: 1.5,
};
const sectionLabel = {
  fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
  color: "#8A8778", marginBottom: 7,
};
const subAba = {
  display: "inline-flex", alignItems: "center", gap: 5,
  padding: "7px 12px", borderRadius: 999, border: "1px solid #E8E2D2",
  background: "#FFFFFF", color: "#8A8778", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
};
const subAbaAtiva = { background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" };
const tagBase = {
  fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 999,
  border: "1px solid #E8E2D2", background: "#F6F1E7",
};
const tagOk = { color: "#2F8F5B", borderColor: "#2F8F5B", background: "#2F8F5B14" };
const tagBad = { color: "#C4432B", borderColor: "#C4432B", background: "#C4432B14" };
const seloEstimado = {
  fontSize: 9, fontWeight: 800, letterSpacing: 0.3, textTransform: "uppercase",
  background: "#C9A22722", color: "#8A6E12", border: "1px solid #C9A22770",
  borderRadius: 999, padding: "1px 6px", marginLeft: 4,
};
