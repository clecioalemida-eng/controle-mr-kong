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

// Busca os lançamentos de fiado do período.
//
// A fonte é o `pedidos_cache`, que o cron das 4h enche com o payload cru
// de todo pedido. Ler dali é uma consulta ao banco: instantânea e sem
// limite. Antes isso ia direto no CardápioWeb, no mesmo endpoint de
// histórico limitado a 5 consultas por minuto — uma janela de 60 dias
// demorava e ainda disputava o limite com o Dashboard e a Curva ABC.
//
// O furo do cache é o dia de hoje, que só entra de madrugada. Por isso
// `dias_sem_cache` diz quais dias faltam, e só esses são completados —
// com UMA consulta ao proxy, numa janela de um ou dois dias.
//
// Devolve { lancamentos, erro, doCache, completados }.
export async function buscarFiadoNoPeriodo(dataInicio, dataFim) {
  // ---- 1. o que já está em cache ---------------------------------------
  const { data: cache, error: erroCache } = await supabase.rpc("fiado_periodo", {
    p_inicio: dataInicio,
    p_fim: dataFim,
  });
  if (erroCache) {
    return { lancamentos: [], erro: erroCache.message, doCache: 0, completados: [] };
  }

  const lancamentos = (cache || []).map((r) => ({
    pedidoId: String(r.pedido_id),
    displayId: r.display_id ?? r.pedido_id,
    data: r.criado_em || `${r.dia}T12:00:00`,
    valor: Number(r.valor) || 0,
    nomeCliente: r.nome_cliente || null,
  }));
  const doCache = lancamentos.length;
  const vistos = new Set(lancamentos.map((l) => l.pedidoId));

  // ---- 2. dias que o cron ainda não pegou ------------------------------
  const { data: faltando } = await supabase.rpc("dias_sem_cache", {
    p_inicio: dataInicio,
    p_fim: dataFim,
  });
  const dias = (faltando || []).map((d) => (typeof d === "string" ? d : d.dia)).filter(Boolean);

  // ---- 3. completa só esses, numa consulta só --------------------------
  let completados = [];
  if (dias.length > 0) {
    const menor = dias[0];
    const maior = dias[dias.length - 1];
    const { data, error } = await supabase.functions.invoke("cardapioweb-proxy", {
      body: {
        data_inicio: `${menor}T00:00:00-03:00`,
        data_fim: `${maior}T23:59:59-03:00`,
      },
    });
    // Falhar aqui não invalida o resto: o que veio do cache continua
    // valendo, e a tela avisa que os dias recentes ficaram de fora.
    if (!error && !data?.error) {
      for (const pedido of data?.pedidos || []) {
        if (pedido.status !== "closed") continue;
        if (vistos.has(String(pedido.id))) continue;
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
      completados = dias;
    }
  }

  lancamentos.sort((a, b) => new Date(b.data) - new Date(a.data));
  return { lancamentos, erro: "", doCache, completados, diasFaltando: dias };
}

// Casa cada lançamento com uma pessoa da equipe.
//
// Duas fontes de ligação: o nome do próprio cadastro, e os apelidos da
// tabela `fiado_apelidos` — porque o caixa escreve de jeitos diferentes
// ("Yan" numa noite, "Yan Ramos" na outra) e uma pessoa precisa poder ter
// vários. O que sobra volta em `semDono`, já agrupado por nome, que é a
// fila de "falta vincular".
export function agruparPorPessoa(lancamentos, pessoas, apelidos = []) {
  const porNome = new Map();
  (pessoas || []).forEach((p) => {
    const c = normalizaNome(p.nome);
    if (c && !porNome.has(c)) porNome.set(c, p.id);
  });
  // Apelido explícito vence o nome do cadastro: foi alguém que decidiu.
  (apelidos || []).forEach((a) => {
    const c = normalizaNome(a.apelido);
    if (c) porNome.set(c, a.pessoa_id);
  });

  const porPessoa = {};
  const semDonoPorNome = new Map();
  (lancamentos || []).forEach((l) => {
    const pessoaId = l.nomeCliente ? porNome.get(normalizaNome(l.nomeCliente)) : null;
    if (!pessoaId) {
      const chave = l.nomeCliente || "(sem nome no pedido)";
      if (!semDonoPorNome.has(chave)) semDonoPorNome.set(chave, { nome: chave, lancamentos: [], total: 0 });
      const g = semDonoPorNome.get(chave);
      g.lancamentos.push(l);
      g.total += Number(l.valor) || 0;
      return;
    }
    if (!porPessoa[pessoaId]) porPessoa[pessoaId] = [];
    porPessoa[pessoaId].push(l);
  });

  const semDonoAgrupado = [...semDonoPorNome.values()].sort((a, b) => b.total - a.total);
  const semDono = semDonoAgrupado.flatMap((g) => g.lancamentos);
  return { porPessoa, semDono, semDonoAgrupado };
}

// Palpite de quem é o dono de um nome do caixa. NUNCA aplica sozinho —
// devolve candidatos pra pessoa confirmar. Casar "Ana" automaticamente
// poderia cobrar da Ana Paula o que era da Janayna, e o erro só apareceria
// no dia em que alguém reclamasse do acerto.
export function sugerirPessoa(nomeCliente, pessoas) {
  const alvo = normalizaNome(nomeCliente);
  if (!alvo) return { candidatos: [] };
  const partesAlvo = alvo.split(" ").filter(Boolean);
  const candidatos = [];

  for (const p of pessoas || []) {
    const nome = normalizaNome(p.nome);
    if (!nome) continue;
    const partes = nome.split(" ").filter(Boolean);
    let motivo = "";
    let forca = 0;

    if (nome === alvo) { motivo = "nome idêntico"; forca = 100; }
    else if (nome.startsWith(alvo + " ")) { motivo = "é o começo do nome dela"; forca = 80; }
    else if (alvo.startsWith(nome + " ")) { motivo = "contém o nome do cadastro"; forca = 75; }
    else if (partesAlvo.every((t) => partes.includes(t))) { motivo = "todos os nomes batem"; forca = 70; }
    else if (partesAlvo.length === 1 && partes.includes(partesAlvo[0])) { motivo = "é um dos nomes dela"; forca = 50; }

    if (motivo) candidatos.push({ pessoa: p, motivo, forca });
  }

  candidatos.sort((a, b) => b.forca - a.forca);
  return { candidatos };
}

export async function carregarApelidos() {
  const { data } = await supabase.from("fiado_apelidos").select("apelido, pessoa_id");
  return data || [];
}

export async function vincularApelido(apelido, pessoaId) {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("fiado_apelidos").upsert(
    { apelido: String(apelido).trim(), pessoa_id: pessoaId, criado_por: userData?.user?.id || null },
    { onConflict: "apelido" }
  );
  return { error };
}

export async function desvincularApelido(apelido) {
  const { error } = await supabase.from("fiado_apelidos").delete().eq("apelido", String(apelido).trim());
  return { error };
}

export async function ignorarNome(nomeCliente, motivo) {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase.from("fiado_ignorados").upsert(
    { nome_cliente: String(nomeCliente).trim(), motivo: motivo || null, criado_por: userData?.user?.id || null },
    { onConflict: "nome_cliente" }
  );
  return { error };
}

export async function carregarIgnorados() {
  const { data } = await supabase.from("fiado_ignorados").select("nome_cliente");
  return new Set((data || []).map((r) => normalizaNome(r.nome_cliente)));
}

export async function desfazerIgnorar(nomeCliente) {
  const { error } = await supabase.from("fiado_ignorados").delete().eq("nome_cliente", String(nomeCliente).trim());
  return { error };
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
