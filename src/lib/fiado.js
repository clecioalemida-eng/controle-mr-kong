// src/lib/fiado.js
//
// Fiado da equipe: o que cada pessoa consumiu e ainda não foi descontado
// no acerto.
//
// A origem é o CardápioWeb: pedido fechado com forma de pagamento
// "debt_book". O que liga o pedido à pessoa é o NOME do cliente digitado
// no caixa, comparado sem acento e sem diferenciar maiúscula. Quando o
// nome do caixa é diferente do nome do cadastro (apelido, nome curto), o
// campo `pessoas.nome_fiado` faz a ponte.
//
// A regra que segura tudo: cada pedido só pode ser descontado UMA vez.
// Quem garante isso é a tabela `fiado_baixas`, cuja chave primária é o
// próprio id do pedido. Por isso a busca pode varrer um período longo
// todo dia sem risco de abater o mesmo consumo de novo.
import { supabase } from "./supabaseClient";

export function normalizaNome(s) {
  return String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

export function diasAtrasISO(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// Busca no CardápioWeb todos os pedidos pagos como fiado no período.
// Devolve { lancamentos, erro } — nunca lança.
export async function buscarFiadoNoPeriodo(dataInicio, dataFim) {
  const { data, error } = await supabase.functions.invoke("cardapioweb-proxy", {
    body: {
      data_inicio: `${dataInicio}T00:00:00-03:00`,
      data_fim: `${dataFim}T23:59:59-03:00`,
    },
  });
  if (error) return { lancamentos: [], erro: error.message || "Não deu para consultar o CardápioWeb." };
  if (data?.error) return { lancamentos: [], erro: data.error };

  const lancamentos = [];
  for (const pedido of data?.pedidos || []) {
    if (pedido.status !== "closed") continue;
    for (const pgto of pedido.payments || []) {
      if (pgto.payment_method !== "debt_book") continue;
      lancamentos.push({
        pedidoId: String(pedido.id),
        displayId: pedido.display_id ?? pedido.id,
        data: pedido.created_at,
        valor: Number(pgto.total) || 0,
        nomeCliente: pedido.customer?.name || null,
      });
    }
  }
  lancamentos.sort((a, b) => new Date(b.data) - new Date(a.data));
  return { lancamentos, erro: "" };
}

// Casa cada lançamento com uma pessoa da equipe, pelo nome. Devolve
// também o que sobrou sem dono — normalmente cliente de verdade, não
// alguém da equipe.
export function agruparPorPessoa(lancamentos, pessoas) {
  const porNome = new Map();
  (pessoas || []).forEach((p) => {
    const chaves = [p.nome, p.nome_fiado].filter(Boolean).map(normalizaNome);
    chaves.forEach((c) => { if (c && !porNome.has(c)) porNome.set(c, p.id); });
  });

  const porPessoa = {};
  const semDono = [];
  (lancamentos || []).forEach((l) => {
    const pessoaId = l.nomeCliente ? porNome.get(normalizaNome(l.nomeCliente)) : null;
    if (!pessoaId) { semDono.push(l); return; }
    if (!porPessoa[pessoaId]) porPessoa[pessoaId] = [];
    porPessoa[pessoaId].push(l);
  });
  return { porPessoa, semDono };
}

// Quais desses pedidos já foram descontados. O `in` do PostgREST tem
// limite de tamanho de URL, então vai em blocos.
export async function carregarBaixas(pedidoIds) {
  const ids = [...new Set(pedidoIds || [])];
  const baixados = new Map();
  for (let i = 0; i < ids.length; i += 150) {
    const bloco = ids.slice(i, i + 150);
    if (bloco.length === 0) continue;
    const { data } = await supabase
      .from("fiado_baixas")
      .select("pedido_id, pessoa_id, valor, referencia, origem, baixado_em")
      .in("pedido_id", bloco);
    (data || []).forEach((b) => baixados.set(b.pedido_id, b));
  }
  return baixados;
}

// Desconta os lançamentos informados. `onConflict: pedido_id` com
// ignoreDuplicates deixa a operação repetível: se um pedido já tinha
// sido descontado, ele é ignorado em vez de dar erro.
export async function darBaixa(pessoaId, lancamentos, origem, referencia) {
  if (!lancamentos || lancamentos.length === 0) return { error: null, quantidade: 0 };
  const { data: userData } = await supabase.auth.getUser();
  const linhas = lancamentos.map((l) => ({
    pedido_id: l.pedidoId,
    pessoa_id: pessoaId,
    valor: l.valor,
    data_pedido: l.data ? String(l.data).slice(0, 10) : null,
    nome_cliente: l.nomeCliente || null,
    origem,
    referencia,
    baixado_por: userData?.user?.id || null,
  }));
  const { error } = await supabase
    .from("fiado_baixas")
    .upsert(linhas, { onConflict: "pedido_id", ignoreDuplicates: true });
  return { error, quantidade: linhas.length };
}

// Desfaz o desconto — o consumo volta a aparecer como em aberto.
export async function estornarBaixa(pedidoIds) {
  const ids = [...new Set(pedidoIds || [])];
  if (ids.length === 0) return { error: null };
  const { error } = await supabase.from("fiado_baixas").delete().in("pedido_id", ids);
  return { error };
}

export function somar(lancamentos) {
  return (lancamentos || []).reduce((s, l) => s + (Number(l.valor) || 0), 0);
}
