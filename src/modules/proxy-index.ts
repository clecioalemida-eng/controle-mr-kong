// Edge Function: cardapioweb-proxy
//
// Roda no servidor do Supabase (nunca no navegador) — é a única peça do
// sistema que conhece o token do CardápioWeb. O token fica guardado como
// "secret" do projeto Supabase (CARDAPIOWEB_API_TOKEN), nunca em código.
//
// >>> CACHE (adicionado em 21/08/2026) <<<
// O endpoint de histórico do CardápioWeb aceita só 5 consultas por minuto,
// e era ele que derrubava Pagamentos, Vendas, Pedidos e Curva ABC em
// períodos grandes. Agora, antes de sair pra internet, esta função olha
// a tabela `pedidos_cache`: todo dia já sincronizado é servido do banco,
// e só os dias que faltam (na prática, o dia de hoje) vão pro CardápioWeb.
// Quem POPULA o cache é a função `sincronizar-vendas-diarias` — esta aqui
// só lê. Assim nunca corremos o risco de gravar um dia pela metade.
//
// O formato da resposta NÃO mudou: todas as telas continuam funcionando
// exatamente como antes, sem alteração no frontend.
//
// Ações aceitas no corpo da requisição (campo "acao"):
//
// - "resumo_financeiro" (padrão): histórico do período + detalhe de cada
//   pedido, com faturamento, formas de pagamento e fechamento por dia.
// - "importar_pratos": extrai os itens vendidos e grava/atualiza `pratos`.
// - "taxa_servico_dia": taxa de serviço na janela 17h–03h de um dia —
//   devolve o faturamento bruto do mesmo período junto.
// - "faturamento_periodo": faturamento bruto (pedidos fechados) entre
//   duas datas. Usada pelo percentual da gerência na escala do dia.
// - "diagnostico_marketing": só mede a API, não grava nada.
// - "catalogo_precos": lê o CATÁLOGO (não os pedidos) e devolve nome e
//   preço de cada item. É a fonte da verdade do preço de venda — os
//   pedidos só sabem o preço do que já foi vendido, e com desconto
//   aplicado. Não grava nada: quem decide o que atualizar é a tela.
//
// Referência oficial: https://docs.cardapioweb.com/api-reference/pedidos

import { createClient } from "npm:@supabase/supabase-js@2";

const BASE_URL = Deno.env.get("CARDAPIOWEB_BASE_URL") ?? "https://integracao.cardapioweb.com";

// Limite de segurança: no máximo esse número de pedidos tem o detalhe
// buscado AO VIVO numa única chamada. Não se aplica ao que vem do cache,
// que é leitura de banco e sai de graça.
const LIMITE_PEDIDOS_DETALHADOS = 200;
// Teto de pedidos devolvidos na resposta. Os AGREGADOS (faturamento, formas
// de pagamento, por dia) são sempre calculados sobre o período inteiro — só
// a lista bruta de pedidos é cortada, pra resposta não virar dezenas de MB.
const LIMITE_PEDIDOS_RETORNADOS = 4000;
// 12s entre consultas de histórico = exatamente as 5/min permitidas.
const PAUSA_ENTRE_CONSULTAS = 12000;
// Se faltar mais que isso no cache, nem tenta: manda rodar a sincronização.
const MAX_BLOCOS_AO_VIVO = 3;
// ...e no máximo esse tanto de dias fora do cache. Acima disso a busca ao
// vivo derruba o limite de 5 consultas/min e não vale a pena tentar.
const MAX_DIAS_AO_VIVO = 31;

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

    // Cliente service_role só pra LER o cache sem depender do RLS do usuário.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } }
    );

    const token = Deno.env.get("CARDAPIOWEB_API_TOKEN");
    if (!token) {
      return json({ error: "CARDAPIOWEB_API_TOKEN não configurado nos secrets do projeto." }, 500, corsHeaders);
    }
    // Os endpoints de /catalog/* exigem DUAS chaves: a da loja (X-API-KEY)
    // e a da integradora (X-PARTNER-KEY). Com uma só, o CardapioWeb
    // responde 4011 "Integrador nao autorizado" — que foi exatamente o
    // que apareceu na tela de fichas tecnicas em 26/08/2026.
    //
    // Pedidos e Loja continuam funcionando so com a X-API-KEY, entao o
    // header extra so entra quando o segredo existe. Sem ele, nada do
    // que ja funcionava para de funcionar.
    const partnerKey = Deno.env.get("CARDAPIOWEB_PARTNER_KEY") || "";
    const headersCW: Record<string, string> = {
      "X-API-KEY": token,
      Accept: "application/json",
      ...(partnerKey ? { "X-PARTNER-KEY": partnerKey } : {}),
    };

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

      const { pedidosDetalhados } = await buscarPedidos(headersCW, admin, inicio, fim);
      // Campo confirmado em 19/08/2026 a partir do retorno real da API:
      // cada pedido já traz "service_fee" com o valor em R$ da taxa de
      // serviço daquele pedido (não precisa mais adivinhar nome de campo).
      // O faturamento sai da MESMA leitura, de graca: os pedidos ja estao
      // na mao. Devolver os dois juntos evita a segunda chamada que a tela
      // fazia — e que ate 28/08/2026 batia numa acao inexistente.
      let taxaTotal = 0;
      let faturamentoBruto = 0;
      for (const p of pedidosDetalhados as any[]) {
        if (typeof p.service_fee === "number") taxaTotal += p.service_fee;
        if (p.status === "closed" && typeof p.total === "number") faturamentoBruto += p.total;
      }
      return json({
        dia, periodo: { inicio, fim },
        taxa_servico: round2(taxaTotal),
        faturamento_bruto: round2(faturamentoBruto),
        encontrado_automaticamente: pedidosDetalhados.length > 0,
        pedidos_no_periodo: pedidosDetalhados.length,
      }, 200, corsHeaders);
    }

    // ---------------------------------------------------------------------
    // AÇÃO: faturamento de um período
    //
    // ESTA AÇÃO NÃO EXISTIA — e a tela da escala do dia chamava ela desde
    // sempre, pra calcular o percentual da gerência. O CardapioWeb
    // respondia "Ação desconhecida", a tela engolia o erro em silêncio, e
    // o faturamento ficava em zero. Resultado: a gerente fechava em
    // R$ 0,00 todo dia, e parecia problema de cadastro dela.
    //
    // Achado em 28/08/2026, olhando por que o aviso "faturamento ainda não
    // foi buscado" não sumia nem depois de clicar em Buscar.
    // ---------------------------------------------------------------------
    if (acao === "faturamento_periodo") {
      const inicio = body.data_inicio;
      const fim = body.data_fim;
      if (!inicio || !fim) {
        return json({ error: "Informe data_inicio e data_fim (ISO 8601)." }, 400, corsHeaders);
      }
      const { pedidosDetalhados } = await buscarPedidos(headersCW, admin, inicio, fim);
      // Só pedido FECHADO é faturamento. Cancelado aparece no histórico e
      // somaria uma venda que não aconteceu.
      const fechados = (pedidosDetalhados as any[]).filter((p) => p.status === "closed");
      let bruto = 0;
      for (const p of fechados) {
        if (typeof p.total === "number") bruto += p.total;
      }
      return json({
        periodo: { inicio, fim },
        faturamento_bruto: round2(bruto),
        pedidos_fechados: fechados.length,
        pedidos_no_periodo: pedidosDetalhados.length,
        encontrado_automaticamente: fechados.length > 0,
      }, 200, corsHeaders);
    }

    // ---------------------------------------------------------------------
    // AÇÃO: preços do catálogo
    //
    // GET /api/partner/v1/catalog/items — paginado, no máximo 100 por
    // página. Diferente do histórico de pedidos, este endpoint não tem
    // limite de 5 consultas por minuto, então dá pra chamar quando a tela
    // de fichas técnicas abre.
    //
    // Devolve o preço CHEIO e o PROMOCIONAL separados, mais a bandeira de
    // promoção ativa: quem escolhe qual usar é a tela, mas o "preco_efetivo"
    // já vem pronto porque essa decisão é sempre a mesma — vale o que o
    // cliente paga hoje.
    //
    // Referência: https://docs.cardapioweb.com/api-reference/catalogo/itens/listar-itens
    // ---------------------------------------------------------------------
    if (acao === "catalogo_precos") {
      const itens: any[] = [];
      let pagina = 1;
      let totalPaginas = 1;
      do {
        const url = new URL(BASE_URL + "/api/partner/v1/catalog/items");
        url.searchParams.set("page", String(pagina));
        url.searchParams.set("per_page", "100");
        const res = await fetch(url.toString(), { headers: headersCW });
        const texto = await res.text();
        let dados: any;
        try {
          dados = JSON.parse(texto);
        } catch {
          return json({
            error: "Resposta inesperada do CardápioWeb ao ler o catálogo.",
            detalhe: texto.slice(0, 300),
          }, 502, corsHeaders);
        }
        if (!res.ok) {
          // 4011 aqui quase sempre e falta da chave da integradora, e o
          // texto cru do CardapioWeb nao ajuda quem esta olhando a tela.
          const semParceiro = !partnerKey || String(dados?.code) === "4011";
          return json({
            error: semParceiro
              ? "O CardápioWeb recusou a leitura do catálogo: falta a chave da integradora (X-PARTNER-KEY). Peça a chave ao suporte deles e cadastre como segredo CARDAPIOWEB_PARTNER_KEY no Supabase."
              : "Erro ao ler o catálogo do CardápioWeb.",
            detalhe: JSON.stringify(dados).slice(0, 300),
          }, res.status, corsHeaders);
        }
        for (const it of dados.items || []) {
          const cheio = Number(it.price) || 0;
          const promo = it.promotional_price == null ? null : Number(it.promotional_price);
          const promoAtiva = it.promotional_price_active === true && promo != null && promo > 0;
          itens.push({
            id: it.id,
            nome: it.name ?? "",
            preco: cheio,
            preco_promocional: promo,
            promocao_ativa: promoAtiva,
            preco_efetivo: promoAtiva ? promo : cheio,
            status: it.status ?? null,
            unidade: it.unit_type ?? null,
            categoria: it.category?.name ?? null,
          });
        }
        totalPaginas = dados.meta?.total_pages ?? 1;
        pagina++;
        // Trava de segurança: catálogo de restaurante não passa disso, e
        // se a paginação vier torta a função não fica rodando pra sempre.
      } while (pagina <= totalPaginas && pagina <= 50);

      return json({
        itens,
        total: itens.length,
        lido_em: new Date().toISOString(),
      }, 200, corsHeaders);
    }

    const { data_inicio, data_fim } = body;
    if (!data_inicio || !data_fim) {
      return json({ error: "Informe data_inicio e data_fim (ISO 8601)." }, 400, corsHeaders);
    }

    const { resumoBasico, pedidosDetalhados, cache } = await buscarPedidos(headersCW, admin, data_inicio, data_fim);

    // -----------------------------------------------------------------------
    // AÇÃO: diagnóstico do módulo Marketing (Fase 0). Só mede, não grava.
    // -----------------------------------------------------------------------
    if (acao === "diagnostico_marketing") {
      // --- 1) O X-API-KEY abre o endpoint de clientes? --------------------
      const clientes: Record<string, unknown> = { testado: true };
      try {
        const resC = await fetch(
          `${BASE_URL}/api/partner/v1/merchant/customers?per_page=5`,
          { headers: headersCW }
        );
        clientes.http = resC.status;
        clientes.acessivel = resC.ok;

        if (resC.ok) {
          const dadosC = await resC.json();
          const lista = Array.isArray(dadosC)
            ? dadosC
            : (dadosC.customers ?? dadosC.data ?? []);
          clientes.total_na_base = dadosC?.pagination?.total_customers ?? null;
          clientes.amostra = lista.length;
          // Só nomes de campo — nenhum valor pessoal.
          clientes.campos_disponiveis = lista.length > 0 ? Object.keys(lista[0]).sort() : [];
          clientes.preenchimento = {
            com_aniversario: lista.filter((c: any) => c?.birth_date).length,
            com_email: lista.filter((c: any) => c?.email).length,
            com_telefone: lista.filter((c: any) => c?.phone_number).length,
            com_pontos: lista.filter((c: any) => Number(c?.loyalty_points) > 0).length,
            com_cashback: lista.filter((c: any) => Number(c?.cashback_balance) > 0).length,
            aceita_notificacao: lista.filter((c: any) => c?.notifications_enabled === true).length,
          };
        } else {
          clientes.motivo = (await resC.text().catch(() => "")).slice(0, 200);
        }
      } catch (e) {
        clientes.acessivel = false;
        clientes.erro = String(e);
      }

      // --- 2) O que os pedidos realmente trazem ---------------------------
      const porCanal: Record<string, number> = {};
      const porTipo: Record<string, number> = {};
      const porOrigem: Record<string, number> = {};
      const cuponsDistintos = new Set<string>();
      const clientesDistintos = new Set<number>();
      const pedidosPorCliente: Record<string, string[]> = {};

      let comCliente = 0;
      let comTelefone = 0;
      let comEndereco = 0;
      let comGeo = 0;
      let comCupom = 0;

      for (const pd of pedidosDetalhados as any[]) {
        const canal = pd.sales_channel ?? "(vazio)";
        const tipo = pd.order_type ?? "(vazio)";
        const origem = pd.customer_origin ?? "(vazio)";
        porCanal[canal] = (porCanal[canal] || 0) + 1;
        porTipo[tipo] = (porTipo[tipo] || 0) + 1;
        porOrigem[origem] = (porOrigem[origem] || 0) + 1;

        const cli = pd.customer;
        if (cli && (cli.id || cli.name)) {
          comCliente++;
          if (cli.phone) comTelefone++;
          if (cli.id) {
            clientesDistintos.add(cli.id);
            const chave = String(cli.id);
            if (!pedidosPorCliente[chave]) pedidosPorCliente[chave] = [];
            pedidosPorCliente[chave].push(String(pd.created_at));
          }
        }

        const end = pd.delivery_address ?? pd.address;
        if (end && (end.street || end.neighborhood)) {
          comEndereco++;
          if (end.latitude != null && end.longitude != null) comGeo++;
        }

        const descontos = pd.discounts || [];
        if (descontos.some((d: any) => d?.coupon_code || d?.coupon_name)) {
          comCupom++;
          for (const d of descontos) {
            if (d?.coupon_code) cuponsDistintos.add(String(d.coupon_code));
          }
        }
      }

      // --- 3) De quanto em quanto tempo o mesmo cliente volta -------------
      // É este número que vai calibrar os cortes de quente / morno / frio,
      // em vez de chutarmos 30 e 90 dias.
      const intervalos: number[] = [];
      let clientesRecorrentes = 0;
      for (const chave of Object.keys(pedidosPorCliente)) {
        const datas = pedidosPorCliente[chave]
          .map((d) => new Date(d).getTime())
          .filter((t) => !isNaN(t))
          .sort((a, b) => a - b);
        if (datas.length >= 2) {
          clientesRecorrentes++;
          for (let i = 1; i < datas.length; i++) {
            intervalos.push((datas[i] - datas[i - 1]) / 86400000);
          }
        }
      }
      intervalos.sort((a, b) => a - b);

      const camposDoCliente = (() => {
        const comC = (pedidosDetalhados as any[]).find((pd) => pd.customer);
        return comC ? Object.keys(comC.customer).sort() : [];
      })();

      return json(
        {
          periodo: { data_inicio, data_fim },
          cache,
          clientes_endpoint: clientes,
          pedidos: {
            total_no_periodo: resumoBasico.length,
            analisados: pedidosDetalhados.length,
            truncado: resumoBasico.length > pedidosDetalhados.length,
            com_cliente_identificado: comCliente,
            percentual_identificado: pedidosDetalhados.length
              ? round2((comCliente / pedidosDetalhados.length) * 100)
              : 0,
            com_telefone: comTelefone,
            clientes_distintos: clientesDistintos.size,
            clientes_recorrentes: clientesRecorrentes,
            com_endereco: comEndereco,
            com_coordenadas: comGeo,
            com_cupom: comCupom,
            cupons_distintos: cuponsDistintos.size,
            por_canal: porCanal,
            por_tipo: porTipo,
            por_origem: porOrigem,
          },
          recorrencia: {
            amostras: intervalos.length,
            intervalo_mediano_dias: mediana(intervalos),
            intervalo_medio_dias: media(intervalos),
            percentil_25_dias: percentil(intervalos, 0.25),
            percentil_75_dias: percentil(intervalos, 0.75),
            observacao:
              "Estimativa preliminar, limitada ao período e ao teto de pedidos analisados. Serve para calibrar os cortes de temperatura, não como número final.",
          },
          campos_encontrados: {
            no_pedido: pedidosDetalhados.length > 0
              ? Object.keys(pedidosDetalhados[0]).sort()
              : [],
            no_cliente_do_pedido: camposDoCliente,
          },
          privacidade:
            "Esta resposta contém apenas contagens e nomes de campos. Nenhum nome, telefone, e-mail ou endereço de cliente é retornado.",
        },
        200,
        corsHeaders
      );
    }

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

      // Grava sem depender de restricao unica na tabela.
      //
      // Antes isto era um upsert com onConflict "nome", e `pratos.nome`
      // nao tem indice unico — entao o Postgres respondia "there is no
      // unique or exclusion constraint matching the ON CONFLICT
      // specification" e a importacao falhava SEMPRE. Ninguem tinha
      // percebido porque o erro so aparece quando se clica em importar.
      //
      // Agora e na mao: procura pelo codigo do CardapioWeb, depois pelo
      // nome, e decide entre atualizar e inserir. Mais chamadas, porem
      // funciona com o banco como ele esta hoje.
      let importados = 0;
      if (linhas.length > 0) {
        // Traz TODOS os pratos, nao so os de nome identico.
        //
        // A primeira versao disto buscava com `nome IN (nomes do
        // CardapioWeb)` — busca exata — e so depois comparava ignorando
        // acento e espaco. A normalizacao nunca era usada: prato de nome
        // diferente nem vinha na consulta. Casaram so os identicos byte a
        // byte, 13 de 105, e "5star" nunca teria chance contra "5 star".
        //
        // Cardapio de restaurante tem centenas de itens, nao milhares:
        // trazer a tabela inteira e barato e resolve.
        const { data: todosPratos } = await supabase
          .from("pratos").select("id, nome, cardapioweb_item_id");

        const mapaId = new Map<any, any>();
        const chaveNome = (t: string) =>
          String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
        const mapaNome = new Map<string, any>();
        const nomesRepetidos = new Set<string>();
        for (const pr of (todosPratos || []) as any[]) {
          if (pr.cardapioweb_item_id != null) mapaId.set(pr.cardapioweb_item_id, pr);
          const k = chaveNome(pr.nome);
          if (!k) continue;
          // Dois pratos com o mesmo nome normalizado: nao da pra escolher
          // sozinho qual recebe o codigo, entao nenhum recebe.
          if (mapaNome.has(k)) nomesRepetidos.add(k);
          mapaNome.set(k, pr);
        }

        const novos: any[] = [];
        for (const l of linhas) {
          const k = chaveNome(l.nome);
          const achado = mapaId.get(l.cardapioweb_item_id)
            || (nomesRepetidos.has(k) ? null : mapaNome.get(k));
          if (achado) {
            // Prato que ja existe: atualiza preco e carimba o codigo, que
            // e o que faz a proxima importacao cair no caminho seguro.
            const { error } = await supabase.from("pratos").update({
              preco_venda: l.preco_venda,
              cardapioweb_item_id: l.cardapioweb_item_id,
              atualizado_em: l.atualizado_em,
            }).eq("id", achado.id);
            if (error) {
              return json({ error: "Erro ao atualizar prato.", detalhe: error.message }, 500, corsHeaders);
            }
            importados += 1;
          } else {
            novos.push(l);
          }
        }
        if (novos.length > 0) {
          const { error: insErr, data: inseridos } = await supabase
            .from("pratos").insert(novos).select("id");
          if (insErr) {
            return json({ error: "Erro ao gravar pratos novos.", detalhe: insErr.message }, 500, corsHeaders);
          }
          importados += inseridos?.length ?? 0;
        }
      }

      return json(
        {
          periodo: { data_inicio, data_fim },
          cache,
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

      // O dia do restaurante vai das 17h às 03h: o pedido de 01h30 de
      // segunda é da noite de DOMINGO. Cortar por data de calendário
      // roubava a madrugada de um dia e dava pro outro — e o sintoma era
      // uma segunda de R$ 897 logo depois de um domingo de R$ 6.744.
      //
      // O corte é às 04h e não às 03h: pedido que fecha 03h10 ainda é
      // daquela noite. Às quatro da manhã ninguém mais está vendendo.
      const porDia: Record<string, { total: number; pedidos: number }> = {};
      for (const o of fechados) {
        const dia = diaOperacional(o.created_at);
        if (!dia) continue;
        if (!porDia[dia]) porDia[dia] = { total: 0, pedidos: 0 };
        porDia[dia].total += o.total || 0;
        porDia[dia].pedidos += 1;
      }

      const pedidosRetornados = pedidosDetalhados.slice(0, LIMITE_PEDIDOS_RETORNADOS);

      return json(
        {
          periodo: { data_inicio, data_fim },
          cache,
          truncado: pedidosRetornados.length < pedidosDetalhados.length,
          total_pedidos_no_periodo: resumoBasico.length,
          pedidos_processados: pedidosDetalhados.length,
          pedidos_fechados: fechados.length,
          pedidos_cancelados: cancelados.length,
          faturamento_total: round2(faturamentoTotal),
          por_forma_pagamento: mapRound2(porFormaPagamento),
          por_dia: Object.fromEntries(
            Object.entries(porDia).map(([dia, v]) => [dia, { total: round2(v.total), pedidos: v.pedidos }])
          ),
          pedidos: pedidosRetornados,
        },
        200,
        corsHeaders
      );
    }

    return json({ error: `Ação desconhecida: ${acao}` }, 400, corsHeaders);
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500, corsHeaders);
  }
});

// ---------------------------------------------------------------------
// Busca os pedidos do período — do cache quando possível, do CardápioWeb
// só para os dias que ainda não foram sincronizados.
// ---------------------------------------------------------------------
async function buscarPedidos(
  headersCW: Record<string, string>,
  admin: any,
  data_inicio: string,
  data_fim: string
) {
  const dias = diasDoIntervalo(data_inicio, data_fim);
  const tInicio = new Date(data_inicio).getTime();
  const tFim = new Date(data_fim).getTime();

  // quais desses dias já estão completos no cache
  const cacheados = new Set<string>();
  if (dias.length > 0) {
    const { data } = await admin.from("dias_sincronizados").select("dia").in("dia", dias);
    for (const r of data || []) cacheados.add(r.dia);
  }
  const faltando = dias.filter((d) => !cacheados.has(d));

  // ---- 1) o que vem do banco -----------------------------------------
  const doCache: any[] = [];
  const diasNoCache = dias.filter((d) => cacheados.has(d));
  if (diasNoCache.length > 0) {
    let de = 0;
    const PAGINA = 1000;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await admin
        .from("pedidos_cache")
        .select("payload, criado_em")
        .in("dia", diasNoCache)
        .order("criado_em", { ascending: true })
        .range(de, de + PAGINA - 1);
      if (error) throw new Error(`Erro ao ler pedidos_cache: ${error.message}`);
      const linhas = data || [];
      for (const l of linhas) {
        // o cache guarda o dia inteiro; recorta pelo horário pedido
        // (importante para janelas como a da taxa de serviço, 17h–03h)
        if (l.criado_em) {
          const t = new Date(l.criado_em).getTime();
          if (!isNaN(t) && (t < tInicio || t > tFim)) continue;
        }
        doCache.push(l.payload);
      }
      if (linhas.length < PAGINA) break;
      de += PAGINA;
    }
  }

  // ---- 2) o que ainda precisa ir ao CardápioWeb -----------------------
  const blocos = agruparConsecutivos(faltando);
  if (blocos.length > MAX_BLOCOS_AO_VIVO || faltando.length > MAX_DIAS_AO_VIVO) {
    throw new Error(
      `Faltam ${faltando.length} dias no cache de pedidos (${blocos.length} bloco(s)). ` +
      `Buscar tudo ao vivo estouraria o limite de 5 consultas por minuto do CardápioWeb. ` +
      `Abra o Dashboard, rode "Popular histórico inicial" e tente de novo.`
    );
  }

  const aoVivo: any[] = [];
  const basicosAoVivo: any[] = [];
  for (let i = 0; i < blocos.length; i++) {
    if (i > 0) await esperar(PAUSA_ENTRE_CONSULTAS);
    const bloco = blocos[i];
    // respeita o horário pedido nas bordas do período
    const inicioBloco = bloco[0] === dias[0] ? data_inicio : `${bloco[0]}T00:00:00-03:00`;
    const fimBloco = bloco[bloco.length - 1] === dias[dias.length - 1] ? data_fim : `${bloco[bloco.length - 1]}T23:59:59-03:00`;

    const { basicos, detalhados } = await buscarNoCardapioWeb(headersCW, inicioBloco, fimBloco);
    basicosAoVivo.push(...basicos);
    aoVivo.push(...detalhados);
  }

  const pedidosDetalhados = [...doCache, ...aoVivo];
  // resumoBasico existe só para contagem/aviso de truncamento
  const resumoBasico = [...doCache, ...basicosAoVivo];

  return {
    resumoBasico,
    pedidosDetalhados,
    cache: {
      dias_no_periodo: dias.length,
      dias_do_cache: diasNoCache.length,
      dias_ao_vivo: faltando.length,
      pedidos_do_cache: doCache.length,
      pedidos_ao_vivo: aoVivo.length,
    },
  };
}

// Busca histórico paginado + detalhe de cada pedido, direto na API.
async function buscarNoCardapioWeb(
  headersCW: Record<string, string>,
  data_inicio: string,
  data_fim: string
) {
  let pagina = 1;
  let totalPaginas = 1;
  const basicos: any[] = [];
  do {
    if (pagina > 1) await esperar(PAUSA_ENTRE_CONSULTAS);

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
      // O CardápioWeb às vezes responde com texto puro (não JSON) quando
      // limita a quantidade de consultas — o histórico de pedidos aceita
      // só 5 consultas por minuto.
      if (res.status === 429 || /retry later/i.test(textoResposta)) {
        throw new Error(
          "O CardápioWeb limitou a quantidade de consultas por minuto nesse período (máximo de 5 consultas de histórico por minuto) — aguarde cerca de 1 minuto e tente de novo."
        );
      }
      throw new Error(`Resposta inesperada do CardápioWeb: ${textoResposta.slice(0, 200)}`);
    }
    if (!res.ok) throw new Error(`Erro ao buscar histórico de pedidos: ${JSON.stringify(dados)}`);
    basicos.push(...(dados.orders || []));
    totalPaginas = dados.pagination?.total_pages ?? 1;
    pagina++;
  } while (pagina <= totalPaginas);

  const aProcessar = basicos.slice(0, LIMITE_PEDIDOS_DETALHADOS);
  const detalhados: any[] = [];
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
    for (const r of resultados) if (r) detalhados.push(r);
  }

  return { basicos, detalhados };
}

// ---------------------------------------------------------------------
function diaLocal(iso: string | Date) {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (isNaN(d.getTime())) return "";
  // data no fuso de Brasília (-03:00), sem depender do TZ do runtime
  return new Date(d.getTime() - 3 * 3600 * 1000).toISOString().slice(0, 10);
}
function diasDoIntervalo(data_inicio: string, data_fim: string) {
  const de = diaLocal(data_inicio);
  const ate = diaLocal(data_fim);
  const dias: string[] = [];
  if (!de || !ate) return dias;
  const atual = new Date(`${de}T12:00:00Z`);
  const fim = new Date(`${ate}T12:00:00Z`);
  if (atual > fim) return dias;
  while (atual <= fim) {
    dias.push(atual.toISOString().slice(0, 10));
    atual.setUTCDate(atual.getUTCDate() + 1);
  }
  return dias;
}
function agruparConsecutivos(dias: string[]) {
  const blocos: string[][] = [];
  let atual: string[] = [];
  for (const dia of dias) {
    if (atual.length === 0) { atual = [dia]; continue; }
    const anterior = new Date(`${atual[atual.length - 1]}T12:00:00Z`);
    anterior.setUTCDate(anterior.getUTCDate() + 1);
    if (anterior.toISOString().slice(0, 10) === dia) atual.push(dia);
    else { blocos.push(atual); atual = [dia]; }
  }
  if (atual.length > 0) blocos.push(atual);
  return blocos;
}
function esperar(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
// A que NOITE o pedido pertence. Tem que dar o MESMO resultado da função
// dia_operacional() do banco (migração 101) — duas contas diferentes pro
// mesmo dia é como ter dois calendários.
function diaOperacional(criadoEm: unknown): string | null {
  if (!criadoEm) return null;
  const t = new Date(String(criadoEm)).getTime();
  if (isNaN(t)) return null;
  // -03:00 (horário de Brasília) e mais 4h pra trás: antes das 04h o
  // pedido conta para o dia anterior.
  return new Date(t - 3 * 3600 * 1000 - 4 * 3600 * 1000).toISOString().slice(0, 10);
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function mapRound2(obj: Record<string, number>) {
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, round2(v)]));
}
function mediana(v: number[]) {
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return round2(v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2);
}
function media(v: number[]) {
  if (v.length === 0) return null;
  return round2(v.reduce((s, n) => s + n, 0) / v.length);
}
function percentil(v: number[], p: number) {
  if (v.length === 0) return null;
  const i = Math.min(v.length - 1, Math.max(0, Math.floor(p * (v.length - 1))));
  return round2(v[i]);
}
function json(body: unknown, status: number, extraHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
