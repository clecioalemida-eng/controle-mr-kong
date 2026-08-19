import React, { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, AlertTriangle, Check } from "lucide-react";
import { supabase, extrairErroFuncao } from "../lib/supabaseClient";

function brl(v) { return (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function hoje() { return new Date().toISOString().slice(0, 10); }
function round2(n) { return Math.round((n || 0) * 100) / 100; }

// Mapeamento conhecido até agora (confirmado em 19/08/2026 a partir de um
// pedido de mesa real). Outros valores de order_type ainda não vistos
// aparecem com o valor bruto mesmo, sem tentar adivinhar — assim nada
// fica escondido atrás de um rótulo errado.
//
// Importante: "tipo de pedido" (Mesa/Delivery/Retirada) e "canal"
// (portal/iFood/app) são duas classificações INDEPENDENTES do mesmo
// pedido no CardápioWeb — um pedido pode ser "Retirada" pelo tipo E
// "iFood" pelo canal ao mesmo tempo. Misturar as duas numa tabela só
// desalinha os números da tela oficial (foi o que aconteceu antes: um
// pedido de retirada-via-iFood saiu do total de Retirada por engano).
// Por isso ficam em duas tabelas separadas agora.
const CATEGORIA_LABEL = { closed_table: "Mesas", table: "Mesas", open_table: "Mesas" };
function labelCategoria(orderType) {
  if (orderType && /delivery/i.test(orderType)) return "Delivery";
  if (orderType && /(takeout|pickup|retirada)/i.test(orderType)) return "Retirada";
  return CATEGORIA_LABEL[orderType] || orderType || "Não identificado";
}
function labelCanal(salesChannel) {
  if (salesChannel && /ifood/i.test(salesChannel)) return "iFood";
  if (salesChannel && /portal/i.test(salesChannel)) return "Portal (site/app próprio)";
  return salesChannel || "Não identificado";
}

const NOMES_PAGAMENTO = {
  money: "Dinheiro",
  credit_card: "Cartão de crédito",
  debit_card: "Cartão de débito",
  pix: "Pix",
  pix_auto: "Pix automático",
  meal_voucher: "Vale-refeição",
  food_voucher: "Vale-alimentação",
  bank_transfer: "Transferência",
  bank_slip: "Boleto",
  picpay: "PicPay",
  debt_book: "Fiado",
  online_credit_card: "Cartão online",
  ifood: "iFood (online)",
  ifood_voucher: "Desconto iFood",
  food99: "99Food (online)",
  food99_voucher: "Desconto 99Food",
};

// Aba embutível dentro do Financeiro — conferência de caixa por forma de
// pagamento, categoria (mesas/delivery/retirada/iFood) e atendente, dia a
// dia. Diferente do resumo_financeiro puro (que só olha o que o
// CardápioWeb registrou), aqui a pessoa digita o que realmente conferiu
// em cartão/pix/dinheiro, pra ver ONDE apareceu uma diferença — não só
// que ela existe. Categoria e atendente vêm de dentro de cada pedido
// (order_type, sales_channel, user.name — confirmados em 19/08/2026 a
// partir de um retorno real da API).
export default function ConferenciaCaixa() {
  const [dia, setDia] = useState(hoje());
  const [buscando, setBuscando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [linhas, setLinhas] = useState([]); // { forma_pagamento, valor_sistema, valor_conferido }
  const [porCategoria, setPorCategoria] = useState([]);
  const [porCanal, setPorCanal] = useState([]);
  const [porAtendente, setPorAtendente] = useState([]);
  const [taxasDoDia, setTaxasDoDia] = useState(null); // { servico, entrega, adicional }
  const [repasse, setRepasse] = useState({ valorAte22: "9.00", qtdAte22: 0, valorApos22: "15.00", qtdApos22: 0 });
  const [escalaDoDia, setEscalaDoDia] = useState([]);

  const carregarSalvo = useCallback(async () => {
    setCarregando(true);
    setMensagem("");
    const [{ data, error }, { data: repasseData }, { data: escalaData }] = await Promise.all([
      supabase.from("conferencias_caixa").select("*").eq("dia", dia).order("forma_pagamento"),
      supabase.from("repasses_delivery").select("*").eq("dia", dia).maybeSingle(),
      supabase.from("presencas_diarias").select("pessoa_id, peso, horas_trabalhadas, pessoa:pessoas(nome, papel)").eq("dia", dia),
    ]);
    if (repasseData) {
      setRepasse((prev) => ({ ...prev, valorAte22: String(repasseData.valor_ate_22h), valorApos22: String(repasseData.valor_apos_22h) }));
    }
    if (escalaData) {
      const { data: premiacoesData } = await supabase.from("premiacoes_diarias").select("pessoa_id, total_dia").eq("dia", dia);
      const mapaTotal = Object.fromEntries((premiacoesData || []).map((p) => [p.pessoa_id, p.total_dia]));
      setEscalaDoDia(escalaData.map((e) => ({ ...e, total: mapaTotal[e.pessoa_id] })));
    }
    if (error) setErro(error.message);
    if (data && data.length > 0) {
      setLinhas(data.map((d) => ({ forma_pagamento: d.forma_pagamento, valor_sistema: d.valor_sistema, valor_conferido: d.valor_conferido })));
      setMensagem("Esse dia já tem conferência salva. Buscar de novo atualiza o valor do sistema, sem mexer no que você já conferiu.");
    } else {
      setLinhas([]);
    }
    setCarregando(false);
  }, [dia]);
  useEffect(() => { carregarSalvo(); }, [carregarSalvo]);

  const buscarDoSistema = async () => {
    setBuscando(true);
    setErro("");
    const diaSeguinte = new Date(`${dia}T12:00:00-03:00`);
    diaSeguinte.setDate(diaSeguinte.getDate() + 1);
    const { data, error } = await supabase.functions.invoke("cardapioweb-proxy", {
      body: {
        data_inicio: `${dia}T17:00:00-03:00`,
        data_fim: `${diaSeguinte.toISOString().slice(0, 10)}T03:00:00-03:00`,
      },
    });
    setBuscando(false);
    if (error) { setErro(await extrairErroFuncao(error)); return; }
    if (data?.error) { setErro(data.error); return; }

    const porForma = data.por_forma_pagamento || {};
    setLinhas((prev) => {
      const mapaConferido = Object.fromEntries(prev.map((l) => [l.forma_pagamento, l.valor_conferido]));
      const formas = new Set([...Object.keys(porForma), ...prev.map((l) => l.forma_pagamento)]);
      return Array.from(formas).map((f) => ({
        forma_pagamento: f,
        valor_sistema: porForma[f] || 0,
        valor_conferido: mapaConferido[f] ?? porForma[f] ?? 0,
      })).sort((a, b) => (NOMES_PAGAMENTO[a.forma_pagamento] || a.forma_pagamento).localeCompare(NOMES_PAGAMENTO[b.forma_pagamento] || b.forma_pagamento));
    });

    // Categoria (tipo de pedido), canal e atendente já vêm dentro de cada
    // pedido (order_type, sales_channel, user.name) — calcula tudo aqui,
    // sem chamada extra.
    const pedidos = (data.pedidos || []).filter((p) => p.status === "closed");
    const mapaCategoria = {};
    const mapaCanal = {};
    const mapaAtendente = {};
    let somaServico = 0, somaEntrega = 0, somaAdicional = 0;
    const marca22h = new Date(`${dia}T22:00:00-03:00`);
    let qtdAte22 = 0, qtdApos22 = 0;
    for (const p of pedidos) {
      const cat = labelCategoria(p.order_type);
      if (!mapaCategoria[cat]) mapaCategoria[cat] = { categoria: cat, qtd: 0, total: 0 };
      mapaCategoria[cat].qtd += 1;
      mapaCategoria[cat].total += p.total || 0;

      const canal = labelCanal(p.sales_channel);
      if (!mapaCanal[canal]) mapaCanal[canal] = { categoria: canal, qtd: 0, total: 0 };
      mapaCanal[canal].qtd += 1;
      mapaCanal[canal].total += p.total || 0;

      const nomeAtendente = p.user?.name || "Não identificado";
      if (!mapaAtendente[nomeAtendente]) mapaAtendente[nomeAtendente] = { nome: nomeAtendente, qtd: 0, total: 0 };
      mapaAtendente[nomeAtendente].qtd += 1;
      mapaAtendente[nomeAtendente].total += p.total || 0;

      somaServico += p.service_fee || 0;
      somaEntrega += p.delivery_fee || 0;
      somaAdicional += p.additional_fee || 0;

      // Repasse ao entregador: só conta pedidos de Delivery, separados
      // pelo horário real do pedido (não a hora do relógio sozinha —
      // compara contra a data/hora de corte das 22h desse dia
      // específico, senão um pedido de madrugada contaria errado).
      if (cat === "Delivery") {
        if (new Date(p.created_at) >= marca22h) qtdApos22 += 1; else qtdAte22 += 1;
      }
    }
    setRepasse((prev) => ({ ...prev, qtdAte22, qtdApos22 }));
    setPorCategoria(Object.values(mapaCategoria).sort((a, b) => b.total - a.total));
    setPorCanal(Object.values(mapaCanal).sort((a, b) => b.total - a.total));
    setPorAtendente(Object.values(mapaAtendente).sort((a, b) => b.total - a.total));
    setTaxasDoDia({ servico: somaServico, entrega: somaEntrega, adicional: somaAdicional });

    // Salva num cache compartilhado com a Escala do dia (Equipe) — assim
    // quem for lá depois não precisa buscar essa mesma taxa de novo no
    // CardápioWeb.
    await supabase.from("taxas_do_dia").upsert({
      dia,
      taxa_servico: round2(somaServico),
      taxa_entrega: round2(somaEntrega),
      taxa_adicional: round2(somaAdicional),
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "dia" });
  };

  const alterarConferido = (forma, valor) => {
    setLinhas((prev) => prev.map((l) => l.forma_pagamento === forma ? { ...l, valor_conferido: parseFloat(valor) || 0 } : l));
  };

  const totalSistema = linhas.reduce((s, l) => s + l.valor_sistema, 0);
  const totalConferido = linhas.reduce((s, l) => s + l.valor_conferido, 0);
  const totalDiferenca = totalConferido - totalSistema;

  const salvar = async () => {
    if (linhas.length === 0) { setErro("Busque os dados do sistema primeiro."); return; }
    setSalvando(true);
    setErro("");
    const { data: userData } = await supabase.auth.getUser();
    for (const l of linhas) {
      const { error } = await supabase.from("conferencias_caixa").upsert({
        dia,
        forma_pagamento: l.forma_pagamento,
        valor_sistema: l.valor_sistema,
        valor_conferido: l.valor_conferido,
        criado_por: userData?.user?.id,
      }, { onConflict: "dia,forma_pagamento" });
      if (error) { setErro(error.message); setSalvando(false); return; }
    }
    const { error: errRepasse } = await supabase.from("repasses_delivery").upsert({
      dia,
      valor_ate_22h: parseFloat(repasse.valorAte22) || 0,
      qtd_ate_22h: repasse.qtdAte22,
      valor_apos_22h: parseFloat(repasse.valorApos22) || 0,
      qtd_apos_22h: repasse.qtdApos22,
      criado_por: userData?.user?.id,
    }, { onConflict: "dia" });
    if (errRepasse) { setErro(errRepasse.message); setSalvando(false); return; }
    setSalvando(false);
    setMensagem("Conferência salva.");
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} style={inputStyle} />
        <button onClick={buscarDoSistema} disabled={buscando} style={{ ...btnSecondary, display: "flex", alignItems: "center", gap: 6 }}>
          {buscando ? <Loader2 size={14} /> : <RefreshCw size={14} />} Buscar dados do sistema
        </button>
      </div>

      {mensagem && <div style={{ ...avisoStyle, background: "#EAF3DE", borderColor: "#97C459", color: "#27500A" }}>{mensagem}</div>}
      {erro && <div style={avisoStyle}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /><div style={{ fontSize: 13 }}>{erro}</div></div>}

      {carregando ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Carregando…</div>
      ) : linhas.length === 0 ? (
        <div style={{ fontSize: 13, color: "#8A8778" }}>Clique em "Buscar dados do sistema" para começar a conferência desse dia.</div>
      ) : (
        <>
          <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", marginBottom: 14, background: "#FFFFFF" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 6, padding: "8px 10px", background: "#F6F1E7", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#8A8778" }}>
              <span>Forma</span><span style={{ textAlign: "right" }}>Sistema</span><span style={{ textAlign: "right" }}>Conferido</span><span style={{ textAlign: "right" }}>Diferença</span>
            </div>
            {linhas.map((l, idx) => {
              const diferenca = l.valor_conferido - l.valor_sistema;
              return (
                <div key={l.forma_pagamento} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 6, padding: "9px 10px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", alignItems: "center", fontSize: 12 }}>
                  <span style={{ color: "#22231F" }}>{NOMES_PAGAMENTO[l.forma_pagamento] || l.forma_pagamento}</span>
                  <span style={{ textAlign: "right", color: "#8A8778" }}>{brl(l.valor_sistema)}</span>
                  <input type="number" step="0.01" value={l.valor_conferido} onChange={(e) => alterarConferido(l.forma_pagamento, e.target.value)}
                    style={{ width: "100%", boxSizing: "border-box", textAlign: "right", padding: "4px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12 }} />
                  <span style={{ textAlign: "right", fontWeight: 700, color: Math.abs(diferenca) < 0.01 ? "#8A8778" : diferenca > 0 ? "#0F6E56" : "#C4432B" }}>
                    {diferenca > 0 ? "+" : ""}{brl(diferenca)}
                  </span>
                </div>
              );
            })}
            <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 1fr 1fr", gap: 6, padding: "9px 10px", borderTop: "1px solid #E8E2D2", fontWeight: 700, fontSize: 12 }}>
              <span>Total</span>
              <span style={{ textAlign: "right" }}>{brl(totalSistema)}</span>
              <span style={{ textAlign: "right" }}>{brl(totalConferido)}</span>
              <span style={{ textAlign: "right", color: Math.abs(totalDiferenca) < 0.01 ? "#22231F" : totalDiferenca > 0 ? "#0F6E56" : "#C4432B" }}>
                {totalDiferenca > 0 ? "+" : ""}{brl(totalDiferenca)}
              </span>
            </div>
          </div>

          <button onClick={salvar} disabled={salvando} style={{ ...btnPrimary, width: "100%" }}>
            {salvando ? <Loader2 size={16} /> : <Check size={16} />} Salvar conferência
          </button>

          {taxasDoDia && (
            <div style={{ ...cardStyleBox, marginTop: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: "#8A8778" }}>Taxa de serviço do dia</span><span style={{ fontWeight: 700 }}>{brl(taxasDoDia.servico)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: "#8A8778" }}>Taxa de entrega do dia</span><span style={{ fontWeight: 700 }}>{brl(taxasDoDia.entrega)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                <span style={{ color: "#8A8778" }}>Taxas adicionais do dia</span><span style={{ fontWeight: 700 }}>{brl(taxasDoDia.adicional)}</span>
              </div>
            </div>
          )}

          {escalaDoDia.length > 0 && (
            <>
              <div style={{ ...sectionLabel, marginTop: 20 }}>Escala do dia</div>
              <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 8 }}>Preenchida na aba Equipe — aqui é só um resumo, pra ver o fechamento do dia completo num lugar só.</div>
              <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", marginBottom: 16, background: "#FFFFFF" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.8fr 1fr", gap: 6, padding: "8px 10px", background: "#F6F1E7", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#8A8778" }}>
                  <span>Pessoa</span><span>Cargo</span><span style={{ textAlign: "right" }}>Horas</span><span style={{ textAlign: "right" }}>Valor do dia</span>
                </div>
                {escalaDoDia.map((e, idx) => (
                  <div key={idx} style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr 0.8fr 1fr", gap: 6, padding: "9px 10px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", fontSize: 12 }}>
                    <span style={{ color: "#22231F" }}>{e.pessoa?.nome}</span>
                    <span style={{ color: "#8A8778" }}>{e.pessoa?.papel}</span>
                    <span style={{ textAlign: "right", color: "#8A8778" }}>{e.horas_trabalhadas || 0}h</span>
                    <span style={{ textAlign: "right", fontWeight: 700 }}>{e.total != null ? brl(e.total) : "—"}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {linhas.length > 0 && (
            <>
              <div style={{ ...sectionLabel, marginTop: 20 }}>Repasse para entregador (delivery)</div>
              <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 8 }}>Quantidade já vem calculada pelo horário do pedido, mas pode corrigir na mão se precisar.</div>

              <div style={{ ...cardStyleBox, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: "#22231F" }}>Entregas até 22h</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input type="number" min="0" step="1" value={repasse.qtdAte22} onChange={(e) => setRepasse((p) => ({ ...p, qtdAte22: parseInt(e.target.value) || 0 }))}
                      style={{ width: 50, padding: "3px 5px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, textAlign: "right" }} />
                    <span style={{ fontSize: 12, color: "#8A8778" }}>entrega{repasse.qtdAte22 === 1 ? "" : "s"}</span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "#8A8778" }}>Valor por entrega</span>
                  <input type="number" step="0.01" value={repasse.valorAte22} onChange={(e) => setRepasse((p) => ({ ...p, valorAte22: e.target.value }))}
                    style={{ width: 70, padding: "4px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, textAlign: "right" }} />
                  <span style={{ flex: 1, textAlign: "right", fontSize: 13, fontWeight: 700, color: "#22231F" }}>{brl(repasse.qtdAte22 * (parseFloat(repasse.valorAte22) || 0))}</span>
                </div>
              </div>

              <div style={{ ...cardStyleBox, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 13, color: "#22231F" }}>Entregas após 22h</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <input type="number" min="0" step="1" value={repasse.qtdApos22} onChange={(e) => setRepasse((p) => ({ ...p, qtdApos22: parseInt(e.target.value) || 0 }))}
                      style={{ width: 50, padding: "3px 5px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, textAlign: "right" }} />
                    <span style={{ fontSize: 12, color: "#8A8778" }}>entrega{repasse.qtdApos22 === 1 ? "" : "s"}</span>
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 11, color: "#8A8778" }}>Valor por entrega</span>
                  <input type="number" step="0.01" value={repasse.valorApos22} onChange={(e) => setRepasse((p) => ({ ...p, valorApos22: e.target.value }))}
                    style={{ width: 70, padding: "4px 6px", borderRadius: 6, border: "1px solid #E8E2D2", fontSize: 12, textAlign: "right" }} />
                  <span style={{ flex: 1, textAlign: "right", fontSize: 13, fontWeight: 700, color: "#22231F" }}>{brl(repasse.qtdApos22 * (parseFloat(repasse.valorApos22) || 0))}</span>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 4px 16px", fontSize: 13 }}>
                <span style={{ color: "#8A8778" }}>Total do repasse</span>
                <span style={{ fontWeight: 700, color: "#22231F" }}>
                  {brl(repasse.qtdAte22 * (parseFloat(repasse.valorAte22) || 0) + repasse.qtdApos22 * (parseFloat(repasse.valorApos22) || 0))}
                </span>
              </div>
            </>
          )}

          {porCategoria.length > 0 && (
            <>
              <div style={{ ...sectionLabel, marginTop: 20 }}>Vendas por categoria (tipo de pedido)</div>
              <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 8 }}>Mesma classificação que a tela "Análise das vendas" do painel do CardápioWeb.</div>
              <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", marginBottom: 16, background: "#FFFFFF" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.6fr 0.7fr 1fr", gap: 6, padding: "8px 10px", background: "#F6F1E7", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#8A8778" }}>
                  <span>Categoria</span><span style={{ textAlign: "right" }}>Qtd.</span><span style={{ textAlign: "right" }}>Total</span>
                </div>
                {porCategoria.map((c, idx) => (
                  <div key={c.categoria} style={{ display: "grid", gridTemplateColumns: "1.6fr 0.7fr 1fr", gap: 6, padding: "9px 10px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", fontSize: 12 }}>
                    <span style={{ color: "#22231F" }}>{c.categoria}</span>
                    <span style={{ textAlign: "right", color: "#8A8778" }}>{c.qtd}</span>
                    <span style={{ textAlign: "right", fontWeight: 700 }}>{brl(c.total)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {porCanal.length > 0 && (
            <>
              <div style={sectionLabel}>Vendas por canal</div>
              <div style={{ fontSize: 11, color: "#8A8778", marginBottom: 8 }}>Classificação independente da anterior — um pedido pode ser "Retirada" no tipo e "iFood" no canal ao mesmo tempo.</div>
              <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", marginBottom: 16, background: "#FFFFFF" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.6fr 0.7fr 1fr", gap: 6, padding: "8px 10px", background: "#F6F1E7", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#8A8778" }}>
                  <span>Canal</span><span style={{ textAlign: "right" }}>Qtd.</span><span style={{ textAlign: "right" }}>Total</span>
                </div>
                {porCanal.map((c, idx) => (
                  <div key={c.categoria} style={{ display: "grid", gridTemplateColumns: "1.6fr 0.7fr 1fr", gap: 6, padding: "9px 10px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", fontSize: 12 }}>
                    <span style={{ color: "#22231F" }}>{c.categoria}</span>
                    <span style={{ textAlign: "right", color: "#8A8778" }}>{c.qtd}</span>
                    <span style={{ textAlign: "right", fontWeight: 700 }}>{brl(c.total)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {porAtendente.length > 0 && (
            <>
              <div style={sectionLabel}>Vendas por atendente</div>
              <div style={{ border: "1px solid #E8E2D2", borderRadius: 12, overflow: "hidden", background: "#FFFFFF" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1.6fr 0.7fr 1fr", gap: 6, padding: "8px 10px", background: "#F6F1E7", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#8A8778" }}>
                  <span>Atendente</span><span style={{ textAlign: "right" }}>Transações</span><span style={{ textAlign: "right" }}>Total</span>
                </div>
                {porAtendente.map((a, idx) => (
                  <div key={a.nome} style={{ display: "grid", gridTemplateColumns: "1.6fr 0.7fr 1fr", gap: 6, padding: "9px 10px", borderTop: idx > 0 ? "1px solid #F0EBDD" : "none", fontSize: 12 }}>
                    <span style={{ color: "#22231F" }}>{a.nome}</span>
                    <span style={{ textAlign: "right", color: "#8A8778" }}>{a.qtd}</span>
                    <span style={{ textAlign: "right", fontWeight: 700 }}>{brl(a.total)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

const inputStyle = { padding: "9px 10px", borderRadius: 8, border: "1px solid #E8E2D2", fontSize: 13, background: "#FFFFFF", color: "#22231F" };
const cardStyleBox = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const sectionLabel = { fontSize: 12, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase", color: "#8A8778", marginBottom: 8 };
const btnPrimary = { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: "#22231F", color: "#F3EFE3", border: "none", borderRadius: 10, padding: "12px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer" };
const btnSecondary = { background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8, padding: "9px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const avisoStyle = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: "12px 14px", fontSize: 13, marginBottom: 14 };
