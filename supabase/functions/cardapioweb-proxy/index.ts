// Edge Function: cardapioweb-proxy
//
// Roda no servidor do Supabase (nunca no navegador) — é a única peça do
// sistema que conhece o token do CardápioWeb. O token fica guardado como
// "secret" do projeto Supabase (CARDAPIOWEB_API_TOKEN), nunca em código.
//
// Aceita duas ações no corpo da requisição (campo "acao"):
//
// - "resumo_financeiro" (padrão, mantém compatibilidade com o Financeiro):
//   busca o histórico de pedidos do período + o detalhe de cada um, e
//   calcula faturamento, formas de pagamento e fechamento por dia.
//
// - "importar_pratos": também usa o histórico + detalhe de pedidos, mas
//   em vez de somar valores, extrai os itens vendidos (nome, id, preço) e
//   grava/atualiza a tabela `pratos`. Isso existe porque o endpoint de
//   Catálogo do CardápioWeb (GET /catalog) exige X-API-KEY + X-PARTNER-KEY
//   — e só temos o X-API-KEY (token do estabelecimento). Os pedidos, por
//   outro lado, só precisam do X-API-KEY — então "descobrimos" o cardápio
//   a partir do que já foi vendido, em vez de consultar o Catálogo direto.
//
// Referência oficial: https://docs.cardapioweb.com/api-reference/pedidos

import { createClient } from "npm:@supabase/supabase-js@2";

const BASE_URL = Deno.env.get("CARDAPIOWEB_BASE_URL") ?? "https://integracao.cardapioweb.com";

// Limite de segurança: no máximo esse número de pedidos tem o detalhe
// buscado numa única chamada, pra não estourar o tempo da função em
// períodos muito grandes. Prefira consultar por dia/semana (resumo) ou
// por um período de algumas semanas (importação de pratos).
const LIMITE_PEDIDOS_DETALHADOS = 200;

Deno.serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Não autenticado." }, 401, corsHeaders);
    }

    const { data: perfil, error: perfilErr } = await supabase
      .from("perfis")
      .select("status")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (perfilErr || !perfil || perfil.status !== "aprovado") {
      return json({ error: "Usuário sem acesso liberado." }, 403, corsHeaders);
    }

    const token = Deno.env.get("CARDAPIOWEB_API_TOKEN");
    if (!token) {
      return json({ error: "CARDAPIOWEB_API_TOKEN não configurado nos secrets do projeto." }, 500, corsHeaders);
    }
    const headersCW = { "X-API-KEY": token, Accept: "application/json" };

    const body = await req.json();
    const acao = body.acao ?? "resumo_financeiro";

    // Ação separada: taxa de serviço do dia, sempre na janela 17h–03h
    // (do dia escolhido às 17h até 03h do dia seguinte), independente do
    // período livre usado nas outras abas do Financeiro.
    if (acao === "taxa_servico_dia") {
      const { dia } = body; // "YYYY-MM-DD"
      if (!dia) return json({ error: "Informe dia (YYYY-MM-DD)." }, 400, corsHeaders);
      const inicio = `${dia}T17:00:00-03:00`;
      const diaSeguinte = new Date(`${dia}T12:00:00-03:00`);
      diaSeguinte.setDate(diaSeguinte.getDate() + 1);
      const fim = `${diaSeguinte.toISOString().slice(0, 10)}T03:00:00-03:00`;

      const { pedidosDetalhados } = await buscarPedidos(headersCW, inicio, fim);
      // Campo confirmado em 19/08/2026 a partir do retorno real da API:
      // cada pedido já traz "service_fee" com o valor em R$ da taxa de
      // serviço daquele pedido (não precisa mais adivinhar nome de campo).
      let taxaTotal = 0;
      for (const p of pedidosDetalhados as any[]) {
        if (typeof p.service_fee === "number") taxaTotal += p.service_fee;
      }
      return json({
        dia, periodo: { inicio, fim },
        taxa_servico: round2(taxaTotal),
        encontrado_automaticamente: pedidosDetalhados.length > 0,
        pedidos_no_periodo: pedidosDetalhados.length,
      }, 200, corsHeaders);
    }

    const { data_inicio, data_fim } = body;
    if (!data_inicio || !data_fim) {
      return json({ error: "Informe data_inicio e data_fim (ISO 8601)." }, 400, corsHeaders);
    }

    // Faturamento bruto de um período (pensado pro mês inteiro, usado no
    // cálculo da gerente) — usa só a listagem básica do histórico, que já
    // traz o total de cada pedido, sem precisar buscar o detalhe de cada
    // um (evita o limite de 200 pedidos detalhados e é bem mais rápido).
    if (acao === "faturamento_periodo") {
      const resumoBasico = await buscarHistoricoBasico(headersCW, data_inicio, data_fim);
      const fechados = resumoBasico.filter((o: any) => o.status === "closed");
      const faturamento = fechados.reduce((soma: number, o: any) => soma + (o.total || 0), 0);
      return json({
        periodo: { data_inicio, data_fim },
        pedidos_no_periodo: resumoBasico.length,
        pedidos_fechados: fechados.length,
        faturamento_bruto: round2(faturamento),
      }, 200, corsHeaders);
    }

    const { resumoBasico, pedidosDetalhados } = await buscarPedidos(headersCW, data_inicio, data_fim);

    if (acao === "importar_pratos") {
      const pratosMap = new Map<number, { nome: string; preco: number }>();
      for (const pedido of pedidosDetalhados) {
        for (const item of pedido.items || []) {
          if (!item.item_id) continue;
          const precoUnit =
            item.unit_price && item.unit_price > 0
              ? item.unit_price
              : item.quantity > 0
              ? item.total_price / item.quantity
              : item.total_price || 0;
          pratosMap.set(item.item_id, { nome: item.name, preco: round2(precoUnit) });
        }
      }

      const linhas = Array.from(pratosMap.entries()).map(([cardapioweb_item_id, v]) => ({
        cardapioweb_item_id,
        nome: v.nome,
        preco_venda: v.preco,
        atualizado_em: new Date().toISOString(),
      }));

      let importados = 0;
      if (linhas.length > 0) {
        const { error: upsertErr, data } = await supabase
          .from("pratos")
          .upsert(linhas, { onConflict: "nome" })
          .select("id");
        if (upsertErr) {
          return json({ error: "Erro ao gravar pratos.", detalhe: upsertErr.message }, 500, corsHeaders);
        }
        importados = data?.length ?? 0;
      }

      return json(
        {
          periodo: { data_inicio, data_fim },
          pedidos_analisados: pedidosDetalhados.length,
          pratos_distintos_encontrados: linhas.length,
          pratos_importados: importados,
        },
        200,
        corsHeaders
      );
    }

    if (acao === "resumo_financeiro") {
      const fechados = pedidosDetalhados.filter((o: any) => o.status === "closed");
      const cancelados = pedidosDetalhados.filter((o: any) => o.status === "canceled");

      const faturamentoTotal = fechados.reduce((soma: number, o: any) => soma + (o.total || 0), 0);

      const porFormaPagamento: Record<string, number> = {};
      for (const o of fechados) {
        for (const pgto of o.payments || []) {
          porFormaPagamento[pgto.payment_method] = (porFormaPagamento[pgto.payment_method] || 0) + (pgto.total || 0);
        }
      }

      const porDia: Record<string, { total: number; pedidos: number }> = {};
      for (const o of fechados) {
        const dia = String(o.created_at).slice(0, 10);
        if (!porDia[dia]) porDia[dia] = { total: 0, pedidos: 0 };
        porDia[dia].total += o.total || 0;
        porDia[dia].pedidos += 1;
      }

      return json(
        {
          periodo: { data_inicio, data_fim },
          truncado: resumoBasico.length > LIMITE_PEDIDOS_DETALHADOS,
          total_pedidos_no_periodo: resumoBasico.length,
          pedidos_processados: pedidosDetalhados.length,
          pedidos_fechados: fechados.length,
          pedidos_cancelados: cancelados.length,
          faturamento_total: round2(faturamentoTotal),
          por_forma_pagamento: mapRound2(porFormaPagamento),
          por_dia: Object.fromEntries(
            Object.entries(porDia).map(([dia, v]) => [dia, { total: round2(v.total), pedidos: v.pedidos }])
          ),
          pedidos: pedidosDetalhados,
        },
        200,
        corsHeaders
      );
    }

    return json({ error: `Ação desconhecida: ${acao}` }, 400, corsHeaders);
  } catch (e) {
    return json({ error: String(e) }, 500, corsHeaders);
  }
});

// Busca só a listagem básica do histórico (paginada) — sem buscar o
// detalhe de cada pedido. Usada quando só precisamos do total por pedido
// (já vem na própria listagem), como no cálculo de faturamento de um mês
// inteiro, onde buscar detalhe de centenas de pedidos estouraria o limite
// e demoraria demais.
async function buscarHistoricoBasico(headersCW: Record<string, string>, data_inicio: string, data_fim: string) {
  let pagina = 1;
  let totalPaginas = 1;
  const resumoBasico: any[] = [];
  do {
    const url = new URL(BASE_URL + "/api/partner/v1/orders/history");
    url.searchParams.set("start_date", data_inicio);
    url.searchParams.set("end_date", data_fim);
    url.searchParams.append("status[]", "closed");
    url.searchParams.append("status[]", "canceled");
    url.searchParams.set("page", String(pagina));
    url.searchParams.set("per_page", "100");

    const res = await fetch(url.toString(), { headers: headersCW });
    const textoResposta = await res.text();
    let dados: any;
    try {
      dados = JSON.parse(textoResposta);
    } catch {
      if (res.status === 429 || /retry later/i.test(textoResposta)) {
        throw new Error(
          "O CardápioWeb limitou a quantidade de consultas por minuto nesse período (máximo de 5 consultas de histórico por minuto) — aguarde cerca de 1 minuto e tente de novo."
        );
      }
      throw new Error(`Resposta inesperada do CardápioWeb: ${textoResposta.slice(0, 200)}`);
    }
    if (!res.ok) throw new Error(`Erro ao buscar histórico de pedidos: ${JSON.stringify(dados)}`);
    resumoBasico.push(...(dados.orders || []));
    totalPaginas = dados.pagination?.total_pages ?? 1;
    pagina++;
  } while (pagina <= totalPaginas);
  return resumoBasico;
}

// Busca o histórico de pedidos do período (fechados e cancelados, paginado)
// e depois o detalhe de cada um (onde vêm itens, total e pagamentos).
async function buscarPedidos(headersCW: Record<string, string>, data_inicio: string, data_fim: string) {
  const resumoBasico = await buscarHistoricoBasico(headersCW, data_inicio, data_fim);

  const aProcessar = resumoBasico.slice(0, LIMITE_PEDIDOS_DETALHADOS);
  const pedidosDetalhados: any[] = [];
  // Busca os detalhes em lotes paralelos (não um por um em sequência) —
  // muito mais rápido pra períodos com bastante pedido, e ainda respeita
  // o limite de 300 requisições/3min do CardápioWeb (10 por vez é bem
  // folgado dentro disso).
  const TAMANHO_LOTE = 10;
  for (let i = 0; i < aProcessar.length; i += TAMANHO_LOTE) {
    const lote = aProcessar.slice(i, i + TAMANHO_LOTE);
    const resultados = await Promise.all(
      lote.map((p: any) =>
        fetch(`${BASE_URL}/api/partner/v1/orders/${p.id}`, { headers: headersCW })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
      )
    );
    for (const r of resultados) if (r) pedidosDetalhados.push(r);
  }

  return { resumoBasico, pedidosDetalhados };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function mapRound2(obj: Record<string, number>) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, round2(v)]));
}
function json(body: unknown, status: number, extraHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
