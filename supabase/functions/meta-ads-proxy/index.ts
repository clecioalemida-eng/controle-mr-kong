// Edge Function: meta-ads-proxy
//
// Lê a conta de anúncios da Meta pela Marketing API v25 e guarda o que
// leu nas tabelas meta_* (migração 039). É a única peça que conhece o
// META_ACCESS_TOKEN — o navegador nunca fala com a Meta.
//
// LEITURA para todo administrador. ESCRITA só numa ação: `patrocinar`,
// que impulsiona um post que já existe no Instagram. Ela só roda para
// quem está em patrocinio_aprovador, com a caixa de confirmação marcada,
// e grava antes em `patrocinios`, onde o banco barra o que passar do
// teto do mês (migração MK5). Tudo nasce PAUSADO na Meta e só é ligado
// no fim, se todos os passos derem certo; a verba é total com data de
// fim, então a própria Meta para sozinha.
//
// Ações (campo "acao" no corpo):
//   - testar_conexao          verifica token e conta, grava nome/fuso/moeda
//   - sincronizar             puxa os insights e regrava as tabelas
//   - sincronizar_vendas_hora monta a curva de pedidos por hora (CardápioWeb)
//   - patrocinio_dados        posts do Instagram + visualizações + quanto
//                             cada um já gastou + teto do mês + configuração
//   - patrocinar              aprova e publica um patrocínio (só aprovador)
//   - analisar_anuncio        retenção e cliques de um anúncio de vídeo, e os
//                             outros anúncios de vídeo para comparar. Só leitura.
//   - buscar_interesses       (057) procura interesses na Meta pelo nome
//   - subir_midia             (058/059) manda para a Meta um video ou foto
//                             que esta no Storage, sem passar pelo feed.
//                             Video vai em pedacos e e RETOMAVEL: se o
//                             tempo da funcao acabar, devolve `enviando`
//                             com o progresso e a proxima chamada continua.
//   - sorteio_previa          (062) monta a lista de participantes a partir
//                             dos comentarios, sem sortear nada
//   - sortear                 (062) sorteia e GRAVA o resultado em `sorteios`
//   - estado_midia            (058) pergunta se a Meta ja terminou de
//                             processar o video. Criar anuncio antes de
//                             ficar pronto falha sem explicacao.
//
// ---------------------------------------------------------------------
// O QUE MUDOU NA 057, E O QUE NÃO MUDOU
//
// Tudo que entra novo é OPCIONAL e só vai para a Meta quando o pedido
// traz. Um patrocínio aprovado pela tela antiga monta exatamente o mesmo
// payload de antes — essa é a propriedade que torna a mudança segura:
//
//   pontos[]          vários pontos no mapa, cada um com o seu raio.
//                     `custom_locations` já era um array; antes ia com
//                     um item só. Sem `pontos`, cai no ponto da config.
//   interesses[]      vira flexible_spec. Sem eles, público amplo, igual
//                     a hoje.
//   whatsapp_numero   vai em promoted_object.whatsapp_phone_number. É o
//                     conserto do erro 100/2446886: hoje o painel manda
//                     só a Página e deixa a Meta achar o número — e ela
//                     não acha, porque a Página não tem WhatsApp ligado.
//   idade_min/max,
//   quem_conta        passam a poder vir por patrocínio, com a config
//                     como padrão.
//
// E um conserto preventivo: `targeting_automation.advantage_audience: 0`
// (o pedido de "não amplie meu público") está sendo recusado pela Meta
// em contas novas desde outubro/2026. Se a recusa vier por causa dele, o
// conjunto é criado de novo SEM o campo e o patrocínio é marcado com
// `publico_ampliado`, para a tela avisar. Falhar calado seria pior; e
// ampliar calado, pior ainda.
//
// Secrets necessários no projeto:
//   META_ACCESS_TOKEN     token do usuário do sistema leituraanuncios
//   META_AD_ACCOUNT_ID    no formato act_123456789
//   CARDAPIOWEB_API_TOKEN (já existe; usado só na curva de pedidos)

import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://graph.facebook.com/v25.0";
const CW_BASE = Deno.env.get("CARDAPIOWEB_BASE_URL") ?? "https://integracao.cardapioweb.com";
const FUSO = "America/Sao_Paulo";

// Teto de páginas por chamada. A conta de um restaurante não chega perto
// disso; o limite existe pra um bug de cursor não virar loop infinito.
const MAX_PAGINAS = 25;

// Limites dos pontos no mapa. 80 km é o teto da Meta para raio; 20 pontos
// é o teto dela para custom_locations num conjunto só.
const MAX_PONTOS = 20;
const RAIO_MIN = 1;
const RAIO_MAX = 80;

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const chamadaDoCron = authHeader === `Bearer ${serviceKey}`;

    // Escritas usam service_role: as tabelas meta_* não têm política de
    // insert pra usuário nenhum. Quem grava é esta função.
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    // Quem está chamando. Fica nulo na chamada do cron — e o cron nunca
    // patrocina nada.
    let usuarioId: string | null = null;

    // Chamada vinda da tela precisa ser de um administrador — aqui tem
    // gasto e margem. Chamada do cron entra pela chave de serviço.
    if (!chamadaDoCron) {
      const comoUsuario = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: userData, error: userErr } = await comoUsuario.auth.getUser();
      if (userErr || !userData?.user) return json({ error: "Não autenticado." }, 401, cors);
      usuarioId = userData.user.id;

      const { data: perfil } = await comoUsuario
        .from("perfis").select("status, is_admin").eq("id", userData.user.id).maybeSingle();

      if (!perfil || perfil.status !== "aprovado") {
        return json({ error: "Usuário sem acesso liberado." }, 403, cors);
      }
      if (!perfil.is_admin) {
        return json({ error: "Só administrador vê os anúncios — aqui tem gasto e margem." }, 403, cors);
      }
    }

    const body = await req.json().catch(() => ({}));
    const acao = body.acao ?? "sincronizar";

    if (acao === "sincronizar_vendas_hora") {
      return await sincronizarVendasHora(admin, body, cors);
    }

    const token = Deno.env.get("META_ACCESS_TOKEN");
    const contaId = Deno.env.get("META_AD_ACCOUNT_ID");
    if (!token) return json({ error: "META_ACCESS_TOKEN não configurado nos secrets do projeto." }, 500, cors);
    if (!contaId) return json({ error: "META_AD_ACCOUNT_ID não configurado nos secrets do projeto." }, 500, cors);
    if (!/^act_\d+$/.test(contaId)) {
      return json({ error: `META_AD_ACCOUNT_ID deve estar no formato act_123456789 (veio "${contaId}").` }, 500, cors);
    }

    if (acao === "testar_conexao") return await testarConexao(admin, token, contaId, cors);
    if (acao === "sincronizar")    return await sincronizar(admin, token, contaId, body, cors);
    if (acao === "patrocinio_dados") return await patrocinioDados(admin, token, contaId, usuarioId, cors);
    if (acao === "patrocinar")     return await patrocinar(admin, token, contaId, usuarioId, body, cors);
    if (acao === "buscar_interesses") return await buscarInteresses(token, body, cors);
    if (acao === "analisar_anuncio") return await analisarAnuncio(token, contaId, body, cors);
    if (acao === "subir_midia")    return await subirMidia(admin, token, contaId, usuarioId, body, cors);
    if (acao === "estado_midia")   return await estadoMidia(admin, token, body, cors);
    if (acao === "sorteio_previa") return await sorteioPrevia(admin, token, contaId, body, cors);
    if (acao === "sortear")        return await sortear(admin, token, contaId, usuarioId, body, cors);

    return json({ error: `Ação desconhecida: ${acao}` }, 400, cors);
  } catch (e) {
    return json({ error: String(e) }, 500, cors);
  }
});

// ---------------------------------------------------------------------
// Conexão
// ---------------------------------------------------------------------
async function testarConexao(admin: any, token: string, contaId: string, cors: any) {
  const url = new URL(`${API}/${contaId}`);
  url.searchParams.set("fields", "name,currency,timezone_name,account_status,amount_spent");
  const conta = await metaGet(url, token);

  // account_status 1 = ativa. Os outros valores significam conta
  // desabilitada, em revisão ou fechada — vale dizer isso na cara, senão
  // o painel fica mostrando zero e ninguém entende por quê.
  const ativa = conta.account_status === 1;

  await admin.from("meta_config").update({
    nome_conta: conta.name ?? null,
    moeda_conta: conta.currency ?? null,
    fuso_conta: conta.timezone_name ?? null,
    atualizado_em: new Date().toISOString(),
  }).eq("id", true);

  // A quebra por hora da Meta vem no fuso da CONTA. Se a conta não
  // estiver em horário de Brasília, o gráfico de horas não bate com a
  // curva de pedidos, e comparar os dois vira erro silencioso.
  const avisoFuso = conta.timezone_name === FUSO
    ? null
    : `A conta de anúncios está no fuso ${conta.timezone_name}, não em ${FUSO}. A quebra por hora vem nesse fuso e não vai bater com a curva de pedidos do CardápioWeb.`;

  return json({
    ok: true,
    conta: {
      id: contaId,
      nome: conta.name,
      moeda: conta.currency,
      fuso: conta.timezone_name,
      ativa,
      status_bruto: conta.account_status,
    },
    aviso_fuso: avisoFuso,
  }, 200, cors);
}

// ---------------------------------------------------------------------
// Sincronização
// ---------------------------------------------------------------------
async function sincronizar(admin: any, token: string, contaId: string, body: any, cors: any) {
  const { data: cfg } = await admin.from("meta_config").select("*").eq("id", true).maybeSingle();
  const acaoResultado = cfg?.acao_resultado ?? "onsite_conversion.messaging_conversation_started";
  const dias = Math.min(Math.max(body.dias ?? cfg?.dias_sincronizados ?? 35, 7), 400);

  const hoje = hojeNoFuso();
  const inicio = somaDias(hoje, -(dias - 1));

  const { data: coleta } = await admin
    .from("meta_coletas").insert({ dias }).select("id").single();
  const coletaId = coleta?.id;

  let linhas = 0;
  try {
    const base = "spend,impressions,clicks,inline_link_clicks,actions";

    // 1. Conta, dia a dia -------------------------------------------------
    const conta = await insights(token, contaId, {
      level: "account",
      fields: `${base},reach,frequency`,
      time_increment: "1",
      since: inicio, until: hoje,
    });
    linhas += await gravar(admin, "meta_dia_conta", conta.map((r: any) => ({
      dia: r.date_start,
      gasto: num(r.spend),
      impressoes: int(r.impressions),
      alcance: int(r.reach),
      frequencia: num(r.frequency) || null,
      cliques_link: int(r.inline_link_clicks),
      cliques_totais: int(r.clicks),
      acoes: r.actions ?? [],
      resultados: resultadoDe(r.actions, acaoResultado),
    })), "dia");

    // 2. Campanhas, dia a dia ---------------------------------------------
    const camp = await insights(token, contaId, {
      level: "campaign",
      fields: `${base},reach,frequency,campaign_id,campaign_name,objective`,
      time_increment: "1",
      since: inicio, until: hoje,
    });

    const catalogo = new Map<string, any>();
    for (const r of camp) {
      if (!r.campaign_id) continue;
      catalogo.set(r.campaign_id, {
        campanha_id: r.campaign_id,
        nome: r.campaign_name ?? r.campaign_id,
        objetivo: r.objective ?? null,
        vista_em: new Date().toISOString(),
      });
    }
    if (catalogo.size) {
      linhas += await gravar(admin, "meta_campanhas", [...catalogo.values()], "campanha_id");
    }

    linhas += await gravar(admin, "meta_dia_campanha", camp.map((r: any) => ({
      dia: r.date_start,
      campanha_id: r.campaign_id,
      gasto: num(r.spend),
      impressoes: int(r.impressions),
      alcance: int(r.reach),
      frequencia: num(r.frequency) || null,
      cliques_link: int(r.inline_link_clicks),
      acoes: r.actions ?? [],
      resultados: resultadoDe(r.actions, acaoResultado),
    })), "dia,campanha_id");

    // 3. Anúncios (criativos), dia a dia ----------------------------------
    const ads = await insights(token, contaId, {
      level: "ad",
      fields: `${base},ad_id,ad_name,campaign_id`,
      time_increment: "1",
      since: inicio, until: hoje,
    });
    linhas += await gravar(admin, "meta_anuncio_dia", ads.map((r: any) => ({
      dia: r.date_start,
      anuncio_id: r.ad_id,
      campanha_id: r.campaign_id ?? null,
      nome: r.ad_name ?? r.ad_id,
      gasto: num(r.spend),
      impressoes: int(r.impressions),
      cliques_link: int(r.inline_link_clicks),
      acoes: r.actions ?? [],
      resultados: resultadoDe(r.actions, acaoResultado),
    })), "dia,anuncio_id");

    // 4. Hora a hora ------------------------------------------------------
    //
    // Sem `reach` aqui: a Meta não entrega alcance junto de quebra por
    // hora, e pedir mesmo assim faz a chamada inteira falhar.
    const horas = await insights(token, contaId, {
      level: "account",
      fields: base,
      time_increment: "1",
      breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone",
      since: inicio, until: hoje,
    });
    linhas += await gravar(admin, "meta_hora", horas.map((r: any) => ({
      dia: r.date_start,
      hora: horaDaFaixa(r.hourly_stats_aggregated_by_advertiser_time_zone),
      gasto: num(r.spend),
      impressoes: int(r.impressions),
      cliques_link: int(r.inline_link_clicks),
      acoes: r.actions ?? [],
      resultados: resultadoDe(r.actions, acaoResultado),
    })).filter((r: any) => r.hora !== null), "dia,hora");

    // 5. Posicionamento ---------------------------------------------------
    const pos = await insights(token, contaId, {
      level: "account",
      fields: base,
      time_increment: "1",
      breakdowns: "publisher_platform,platform_position",
      since: inicio, until: hoje,
    });
    linhas += await gravar(admin, "meta_posicionamento_dia", pos.map((r: any) => ({
      dia: r.date_start,
      plataforma: r.publisher_platform ?? "desconhecida",
      posicao: r.platform_position ?? "desconhecida",
      gasto: num(r.spend),
      impressoes: int(r.impressions),
      cliques_link: int(r.inline_link_clicks),
      acoes: r.actions ?? [],
      resultados: resultadoDe(r.actions, acaoResultado),
    })), "dia,plataforma,posicao");

    // 6. Janelas fechadas, com alcance deduplicado ------------------------
    //
    // Alcance é gente distinta. A mesma pessoa alcançada em três dias
    // conta uma vez na semana e três na soma dos dias — por isso a
    // janela é pedida à Meta como um período só, e não somada aqui.
    const janelas: Array<[string, string, string]> = [
      ["7d",  somaDias(hoje, -6), hoje],
      ["30d", somaDias(hoje, -29), hoje],
      ["mes", primeiroDiaDoMes(hoje), hoje],
    ];
    for (const [nome, ini, fim] of janelas) {
      const [r] = await insights(token, contaId, {
        level: "account",
        fields: `${base},reach,frequency`,
        since: ini, until: fim,
      });
      await admin.from("meta_janela").upsert({
        janela: nome,
        inicio: ini,
        fim,
        gasto: num(r?.spend),
        impressoes: int(r?.impressions),
        alcance: int(r?.reach),
        frequencia: num(r?.frequency) || null,
        cliques_link: int(r?.inline_link_clicks),
        acoes: r?.actions ?? [],
        resultados: resultadoDe(r?.actions, acaoResultado),
        atualizado_em: new Date().toISOString(),
      }, { onConflict: "janela" });
      linhas += 1;
    }

    if (coletaId) {
      await admin.from("meta_coletas")
        .update({ status: "ok", terminada_em: new Date().toISOString(), linhas })
        .eq("id", coletaId);
    }

    return json({ ok: true, dias, linhas, periodo: { inicio, fim: hoje } }, 200, cors);
  } catch (e) {
    if (coletaId) {
      await admin.from("meta_coletas")
        .update({ status: "erro", terminada_em: new Date().toISOString(), erro: String(e) })
        .eq("id", coletaId);
    }
    return json({ error: String(e) }, 500, cors);
  }
}

// ---------------------------------------------------------------------
// Patrocínio
//
// O painel prepara, você aprova no painel, o painel chama a Meta.
// Nada aqui roda sozinho: não há cron que patrocine.
// ---------------------------------------------------------------------

// Conversa no WhatsApp: a Meta conta a mesma conversa em mais de um
// tipo de ação. Somar os dois contaria em dobro — usa um só, o primeiro
// que existir.
const TIPOS_CONVERSA = [
  "onsite_conversion.messaging_conversation_started_7d",
  "onsite_conversion.messaging_first_reply",
];

const SITUACAO: Record<string, string> = {
  ACTIVE: "no ar",
  PAUSED: "pausado",
  ADSET_PAUSED: "pausado",
  CAMPAIGN_PAUSED: "pausado",
  IN_PROCESS: "em análise",
  PENDING_REVIEW: "em análise",
  DISAPPROVED: "reprovado",
  WITH_ISSUES: "com problema",
  ARCHIVED: "arquivado",
  DELETED: "apagado",
};

async function ehAprovador(admin: any, usuarioId: string | null) {
  if (!usuarioId) return false;
  const { data } = await admin.from("patrocinio_aprovador")
    .select("perfil_id").eq("perfil_id", usuarioId).maybeSingle();
  return !!data;
}

async function carregarConfig(admin: any, contaId: string) {
  const { data, error } = await admin.from("patrocinio_config")
    .select("*").eq("conta_id", contaId.replace(/^act_/, "")).maybeSingle();
  if (error) throw new Error(`Erro ao ler patrocinio_config: ${error.message}. Rodou o MK5?`);
  if (!data) {
    // Diz qual conta a função está usando e quais existem no banco:
    // quase sempre é um número diferente entre o secret e a tabela.
    const { data: todas } = await admin.from("patrocinio_config").select("conta_id");
    const existentes = (todas ?? []).map((r: any) => r.conta_id).join(", ") || "nenhuma";
    throw new Error(`Configuração de patrocínio não encontrada para a conta ${contaId} (a do secret META_AD_ACCOUNT_ID). No banco existem: ${existentes}.`);
  }
  return data;
}

// O Instagram é o que está ligado à Página. Pergunta à própria Meta,
// pela conta de anúncios, e guarda — assim ninguém digita id errado.
async function garantirInstagram(admin: any, token: string, contaId: string, cfg: any) {
  if (cfg.instagram_id) return cfg;
  if (!cfg.pagina_id) throw new Error("A configuração não tem Página.");

  // Três caminhos para achar o Instagram da Página. A Meta libera um ou
  // outro conforme as permissões do token; o que falhar vira diagnóstico.
  const tentativas: string[] = [];
  let ig: any = null;
  let nomePagina: string | null = null;

  try {
    const url = new URL(`${API}/${contaId}/promote_pages`);
    url.searchParams.set("fields", "id,name,instagram_business_account{id,username}");
    url.searchParams.set("limit", "100");
    const paginas = await metaGetPaginado(url, token);
    const p = paginas.find((x: any) => x.id === cfg.pagina_id);
    if (!p) tentativas.push("promote_pages: a conta não enxerga a Página");
    else {
      nomePagina = p.name ?? null;
      if (p.instagram_business_account?.id) ig = p.instagram_business_account;
      else tentativas.push("promote_pages: Página sem instagram_business_account");
    }
  } catch (e) { tentativas.push(`promote_pages: ${e instanceof Error ? e.message : e}`); }

  if (!ig) {
    try {
      const url = new URL(`${API}/${cfg.pagina_id}`);
      url.searchParams.set("fields", "name,instagram_business_account{id,username},connected_instagram_account{id,username}");
      const p = await metaGet(url, token);
      nomePagina = p.name ?? nomePagina;
      ig = p.instagram_business_account ?? p.connected_instagram_account ?? null;
      if (!ig) tentativas.push("página: sem Instagram nos campos da Página");
    } catch (e) { tentativas.push(`página: ${e instanceof Error ? e.message : e}`); }
  }

  if (!ig) {
    try {
      const url = new URL(`${API}/${contaId}/connected_instagram_accounts`);
      url.searchParams.set("fields", "id,username");
      const lista = await metaGetPaginado(url, token);
      ig = lista.find((x: any) => !cfg.instagram_usuario || x.username === cfg.instagram_usuario) ?? lista[0] ?? null;
      if (!ig) tentativas.push("conta de anúncios: nenhum Instagram conectado");
    } catch (e) { tentativas.push(`conta de anúncios: ${e instanceof Error ? e.message : e}`); }
  }

  if (!ig?.id) {
    throw new Error(`Não achei o Instagram da Página. O que a Meta respondeu — ${tentativas.join(" | ")}`);
  }

  const novo = {
    instagram_id: ig.id,
    instagram_usuario: ig.username ?? cfg.instagram_usuario,
    pagina_nome: nomePagina ?? cfg.pagina_nome,
  };
  const { error } = await admin.from("patrocinio_config").update(novo).eq("conta_id", cfg.conta_id);
  if (error) throw new Error(`Erro ao guardar o Instagram: ${error.message}`);
  return { ...cfg, ...novo };
}

async function postsDoInstagram(token: string, igId: string, quantos: number) {
  const url = new URL(`${API}/${igId}/media`);
  url.searchParams.set("fields", "id,media_type,caption,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count");
  url.searchParams.set("limit", String(quantos));
  const dados = await metaGet(url, token);
  return (dados.data ?? []).map((m: any) => ({
    id: m.id,
    tipo: m.media_type,
    texto: String(m.caption ?? "").slice(0, 300),
    // Vídeo não tem media_url que sirva de capa; a Meta manda thumbnail.
    foto: m.thumbnail_url ?? m.media_url ?? null,
    // O arquivo original, para o botão "Baixar". Em carrossel é o primeiro item.
    arquivo: m.media_url ?? null,
    link: m.permalink ?? null,
    data: m.timestamp ?? null,
    // A Meta omite curtidas quando o dono escondeu a contagem; aí fica nulo, não zero.
    curtidas: m.like_count ?? null,
    comentarios: m.comments_count ?? null,
  }));
}

// Visualizações de cada post. Fica fora de postsDoInstagram de propósito:
// aprovar um patrocínio e sortear também listam posts e não precisam disto.
// A Meta só entrega este número post a post e exige a permissão
// instagram_manage_insights. Sem ela, os cartões seguem sem o número e a
// tela avisa, em vez de perder a lista de posts.
const VIEWS_JUNTAS = 6;

async function visualizacoesDosPosts(token: string, ids: string[]) {
  const valores = new Map<string, number>();
  let primeiroErro: string | null = null;
  let falhas = 0;
  let proximo = 0;
  const buscar = async () => {
    while (proximo < ids.length) {
      const id = ids[proximo++];
      try {
        const url = new URL(`${API}/${id}/insights`);
        url.searchParams.set("metric", "views");
        const d = await metaGet(url, token);
        const m = (d.data ?? []).find((x: any) => x.name === "views");
        const v = m?.total_value?.value ?? m?.values?.[0]?.value;
        if (v != null) valores.set(id, int(v));
      } catch (e) {
        falhas += 1;
        primeiroErro ??= String(e instanceof Error ? e.message : e);
      }
    }
  };
  await Promise.all(Array.from({ length: VIEWS_JUNTAS }, buscar));
  // Um post sem o número é normal (post antigo, por exemplo). Todos sem ele
  // é permissão ou token, e isso precisa aparecer.
  return { valores, erro: ids.length > 0 && falhas === ids.length ? primeiroErro : null };
}

// Tudo o que a conta já anunciou: agrupado pelo post do Instagram (para o
// selo de cada post) e a lista do que está no ar agora — inclusive o que a
// agência lançou pelo Gerenciador, que não tem post nenhum por trás.
const NO_AR = new Set(["ACTIVE", "IN_PROCESS", "PENDING_REVIEW", "WITH_ISSUES"]);

async function historicoDaConta(token: string, contaId: string) {
  const ins = new URL(`${API}/${contaId}/insights`);
  ins.searchParams.set("level", "ad");
  ins.searchParams.set("date_preset", "maximum");
  ins.searchParams.set("fields", "ad_id,spend,reach,impressions,inline_link_clicks,actions");
  ins.searchParams.set("limit", "500");
  const linhas = await metaGetPaginado(ins, token);
  const porAnuncio = new Map<string, any>();
  for (const r of linhas) {
    let conversas = 0;
    for (const tipo of TIPOS_CONVERSA) {
      const a = (r.actions ?? []).find((x: any) => x.action_type === tipo);
      if (a) { conversas = Number(a.value) || 0; break; }
    }
    porAnuncio.set(r.ad_id, {
      gasto: num(r.spend),
      conversas,
      alcance: int(r.reach),
      impressoes: int(r.impressions),
      cliques: int(r.inline_link_clicks),
    });
  }

  // Últimos 7 dias, por anúncio: mostra se ele está gastando AGORA, e não
  // só o que acumulou desde que nasceu.
  const semana = new Map<string, number>();
  try {
    const s7 = new URL(`${API}/${contaId}/insights`);
    s7.searchParams.set("level", "ad");
    s7.searchParams.set("date_preset", "last_7d");
    s7.searchParams.set("fields", "ad_id,spend");
    s7.searchParams.set("limit", "500");
    for (const r of await metaGetPaginado(s7, token)) semana.set(r.ad_id, num(r.spend));
  } catch { /* segue sem a coluna da semana */ }

  const ads = new URL(`${API}/${contaId}/ads`);
  ads.searchParams.set("fields",
    "id,name,effective_status,created_time," +
    "adset{name,start_time,end_time,daily_budget,lifetime_budget,optimization_goal}," +
    "creative{effective_instagram_media_id,thumbnail_url,body,title}");
  ads.searchParams.set("limit", "200");
  const lista = await metaGetPaginado(ads, token);

  const vazio = { gasto: 0, conversas: 0, alcance: 0, impressoes: 0, cliques: 0 };
  const porPost: Record<string, any> = {};
  const noAr: any[] = [];

  for (const a of lista) {
    const n = porAnuncio.get(a.id) ?? vazio;

    // A Meta deixa o anúncio como ACTIVE mesmo depois que o conjunto passou
    // da data de fim — ele só para de entregar. Isso não é "no ar".
    const fim = a.adset?.end_time ? new Date(a.adset.end_time).getTime() : null;
    const terminou = fim != null && fim < Date.now();

    if (NO_AR.has(a.effective_status) && !terminou) {
      // Orçamento vem em centavos, como texto.
      const diario = a.adset?.daily_budget ? Number(a.adset.daily_budget) / 100 : null;
      const total = a.adset?.lifetime_budget ? Number(a.adset.lifetime_budget) / 100 : null;
      // Anúncio de catálogo vem com o texto em modelo ("{{product.name}}");
      // aí o nome do anúncio diz mais.
      let texto = String(a.creative?.body || a.creative?.title || "");
      if (texto.includes("{{")) texto = "";
      noAr.push({
        anuncio_id: a.id,
        nome: a.name ?? a.id,
        texto: texto.slice(0, 160),
        otimiza: a.adset?.optimization_goal ?? null,
        gasto_7d: Math.round((semana.get(a.id) ?? 0) * 100) / 100,
        foto: a.creative?.thumbnail_url ?? null,
        midia_id: a.creative?.effective_instagram_media_id ?? null,
        situacao: SITUACAO[a.effective_status] ?? String(a.effective_status).toLowerCase(),
        inicio: a.adset?.start_time ?? a.created_time ?? null,
        termina: a.adset?.end_time ?? null,
        orcamento_diario: diario,
        orcamento_total: total,
        gasto: Math.round(n.gasto * 100) / 100,
        conversas: n.conversas,
        alcance: n.alcance,
        impressoes: n.impressoes,
        cliques: n.cliques,
      });
    }

    const midia = a.creative?.effective_instagram_media_id;
    if (!midia) continue;
    const h = porPost[midia] ??= { gasto: 0, conversas: 0, anuncios: 0, no_ar: false, situacao: null, termina: null, ultimo: null };
    h.gasto += n.gasto;
    h.conversas += n.conversas;
    h.anuncios += 1;
    if (a.effective_status === "ACTIVE") {
      h.no_ar = true;
      h.termina = a.adset?.end_time ?? h.termina;
    }
    if (!h.ultimo || a.created_time > h.ultimo) {
      h.ultimo = a.created_time;
      h.situacao = SITUACAO[a.effective_status] ?? String(a.effective_status ?? "").toLowerCase();
    }
  }
  for (const h of Object.values(porPost)) {
    h.gasto = Math.round(h.gasto * 100) / 100;
    if (h.no_ar) h.situacao = "no ar";
  }
  // Quem gasta mais aparece primeiro.
  noAr.sort((x, y) => y.gasto - x.gasto);
  return { porPost, noAr };
}

// Gasto real da conta inteira no mês — painel e agência juntos.
async function gastoDaContaNoMes(token: string, contaId: string) {
  const url = new URL(`${API}/${contaId}/insights`);
  url.searchParams.set("level", "account");
  url.searchParams.set("date_preset", "this_month");
  url.searchParams.set("fields", "spend");
  const [r] = await metaGetPaginado(url, token);
  return num(r?.spend);
}

// (057) Saúde da conta: se ela está ativa e se tem verba. Um anúncio
// aprovado ficou 24 h com R$ 0,00 porque a conta estava sem saldo, e o
// painel mostrou os zeros sem dizer por quê.
//
// `balance` NÃO quer dizer a mesma coisa em toda conta: em conta pré-paga
// é o dinheiro disponível; em conta no cartão é o que já foi gasto e ainda
// não foi cobrado. O mesmo zero significa coisas opostas — por isso o tipo
// vai junto e só a pré-paga vira alarme.
async function saudeDaConta(token: string, contaId: string) {
  const url = new URL(`${API}/${contaId}`);
  url.searchParams.set("fields", "account_status,disable_reason,balance,currency,funding_source_details");
  const d = await metaGet(url, token);
  const centavos = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? n / 100 : null;
  };
  const prePaga = Number(d?.funding_source_details?.type) === 1;
  const saldo = centavos(d.balance);
  return {
    ativa: Number(d.account_status) === 1 || Number(d.account_status) === 9,
    status: Number(d.account_status),
    motivo: Number(d.disable_reason) || 0,
    pre_paga: prePaga,
    saldo,
    sem_verba: prePaga && saldo != null && saldo <= 0,
  };
}

// Quanto um anúncio de vídeo prendeu. A Meta entrega cada etapa como uma lista
// de ações: 3 segundos vem em `actions`, com o tipo video_view, e o resto em
// campos próprios. A tela faz a conta do veredito.
function valorDeVideo(lista: any) {
  return Array.isArray(lista) ? lista.reduce((s: number, x: any) => s + (Number(x?.value) || 0), 0) : 0;
}
function metricasDoAnuncio(r: any) {
  return {
    anuncio_id: r.ad_id,
    impressoes: int(r.impressions),
    alcance: int(r.reach),
    frequencia: num(r.frequency),
    gasto: num(r.spend),
    cliques: int(r.inline_link_clicks),
    v3s: valorDeVideo((r.actions ?? []).filter((a: any) => a?.action_type === "video_view")),
    p25: valorDeVideo(r.video_p25_watched_actions),
    p50: valorDeVideo(r.video_p50_watched_actions),
    p75: valorDeVideo(r.video_p75_watched_actions),
    p100: valorDeVideo(r.video_p100_watched_actions),
  };
}

async function analisarAnuncio(token: string, contaId: string, body: any, cors: any) {
  const id = String(body.anuncio_id ?? "");
  if (!/^\d{5,30}$/.test(id)) return json({ error: "Anúncio inválido." }, 400, cors);
  const url = new URL(`${API}/${contaId}/insights`);
  url.searchParams.set("level", "ad");
  url.searchParams.set("date_preset", "maximum");
  url.searchParams.set("fields",
    "ad_id,impressions,reach,frequency,spend,inline_link_clicks,actions," +
    "video_p25_watched_actions,video_p50_watched_actions,video_p75_watched_actions,video_p100_watched_actions");
  url.searchParams.set("limit", "500");
  try {
    const todos = (await metaGetPaginado(url, token)).map(metricasDoAnuncio);
    return json({
      ok: true,
      anuncio: todos.find((a: any) => a.anuncio_id === id) ?? null,
      // Só compara com vídeo que rodou de verdade: anúncio com poucas
      // exibições tem porcentagem de sorte.
      outros: todos.filter((a: any) => a.anuncio_id !== id && a.v3s > 0 && a.impressoes >= 1000),
    }, 200, cors);
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 502, cors);
  }
}

// (057) Procura interesses na Meta pelo nome. Só leitura.
async function buscarInteresses(token: string, body: any, cors: any) {
  const termo = String(body.q ?? "").trim();
  if (termo.length < 2) return json({ ok: true, itens: [] }, 200, cors);
  const url = new URL(`${API}/search`);
  url.searchParams.set("type", "adinterest");
  url.searchParams.set("q", termo);
  url.searchParams.set("limit", "25");
  try {
    const d = await metaGet(url, token);
    const itens = (d.data ?? []).map((x: any) => ({
      id: String(x.id),
      nome: x.name,
      // Quantas pessoas têm esse interesse: separa "Hambúrguer" de um
      // interesse homônimo com 300 pessoas, que não entrega nada.
      tamanho: int(x.audience_size_upper_bound ?? x.audience_size),
      caminho: Array.isArray(x.path) ? x.path.join(" › ") : null,
    })).filter((x: any) => x.id && x.nome);
    return json({ ok: true, itens }, 200, cors);
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 502, cors);
  }
}

async function patrocinioDados(admin: any, token: string, contaId: string, usuarioId: string | null, cors: any) {
  let cfg = await carregarConfig(admin, contaId);
  const avisos: string[] = [];
  const podeAprovar = await ehAprovador(admin, usuarioId);

  let posts: any[] = [];
  try {
    cfg = await garantirInstagram(admin, token, contaId, cfg);
  } catch (e) {
    avisos.push(String(e instanceof Error ? e.message : e));
  }
  if (cfg.instagram_id) {
    try {
      posts = await postsDoInstagram(token, cfg.instagram_id, 24);
    } catch (e) {
      avisos.push(`Achei o Instagram, mas não consegui listar os posts: ${e instanceof Error ? e.message : e}`);
    }
    if (posts.length) {
      const views = await visualizacoesDosPosts(token, posts.map((p) => p.id));
      posts = posts.map((p) => ({ ...p, visualizacoes: views.valores.get(p.id) ?? null }));
      if (views.erro) avisos.push(`Não consegui ler as visualizações dos posts: ${views.erro}`);
    }
  }

  let historico: Record<string, any> = {};
  let noAr: any[] = [];
  try {
    const h = await historicoDaConta(token, contaId);
    historico = h.porPost;
    noAr = h.noAr;
  } catch (e) {
    avisos.push(`Não deu para ler o histórico de gasto: ${e instanceof Error ? e.message : e}`);
  }
  let gastoConta: number | null = null;
  try {
    gastoConta = await gastoDaContaNoMes(token, contaId);
  } catch { /* o medidor segue sem essa linha */ }

  // (057) Conta sem verba é a causa mais silenciosa de "gastou R$ 0,00".
  let saude: any = null;
  try {
    saude = await saudeDaConta(token, contaId);
    if (saude.sem_verba) {
      avisos.push("A conta de anúncios está sem verba na Meta. Os anúncios existem mas não entregam até você adicionar saldo.");
    } else if (!saude.ativa) {
      avisos.push(`A conta de anúncios não está ativa na Meta (status ${saude.status}). Nenhum anúncio entrega enquanto isso não for resolvido.`);
    }
  } catch { /* segue sem o medidor de saúde */ }

  const { data: mes } = await admin.from("v_patrocinio_mes")
    .select("teto_mensal, aprovado_no_mes").eq("conta_id", cfg.conta_id).maybeSingle();
  const { data: ultimos } = await admin.from("patrocinios")
    .select("id, midia_id, midia_texto, midia_link, midias, objetivo, valor, dias, inicio, estado, erro, anuncio_id, aprovado_em, publicado_em")
    .eq("conta_id", cfg.conta_id).order("aprovado_em", { ascending: false }).limit(8);

  // (057) Conjuntos de pontos salvos, para não remarcar sete bairros toda vez.
  let pontosSalvos: any[] = [];
  try {
    const { data } = await admin.from("patrocinio_pontos")
      .select("id, nome, pontos").eq("conta_id", cfg.conta_id).order("nome");
    pontosSalvos = data ?? [];
  } catch { /* a 057 ainda não rodou; a tela some o seletor */ }

  // Pedidos por hora nos últimos 30 dias — a base da sugestão de horário.
  let curva: number[] | null = null;
  try {
    const desde = somaDias(hojeNoFuso(), -30);
    const { data: vh } = await admin.from("meta_vendas_hora").select("hora, pedidos").gte("dia", desde);
    if (vh?.length) {
      curva = Array(24).fill(0);
      for (const r of vh) curva[r.hora] += Number(r.pedidos) || 0;
      if (!curva.some((x) => x > 0)) curva = null;
    }
  } catch { /* sem curva, sem sugestão */ }

  // Anúncio feito pelo painel: junta o que foi aprovado aqui (valor, prazo, quem).
  const { data: meus } = await admin.from("patrocinios")
    .select("anuncio_id, anuncio_ids, valor, dias, objetivo, aprovado_em, publicado_em")
    .eq("conta_id", cfg.conta_id).not("anuncio_id", "is", null);
  const porId = new Map<string, any>();
  for (const m of meus ?? []) {
    const ids = Array.isArray(m.anuncio_ids) && m.anuncio_ids.length ? m.anuncio_ids : [m.anuncio_id];
    for (const id of ids) porId.set(id, { ...m, varios: ids.length > 1 });
  }
  noAr = noAr.map((x) => ({ ...x, painel: porId.get(x.anuncio_id) ?? null }));

  if (cfg.centro_lat == null) {
    avisos.push("Falta marcar o ponto do restaurante na configuração: sem ele não dá para patrocinar.");
  }

  return json({
    ok: true,
    config: cfg,
    pode_aprovar: podeAprovar,
    mes: {
      teto: num(mes?.teto_mensal ?? cfg.teto_mensal),
      aprovado: num(mes?.aprovado_no_mes),
      gasto_conta: gastoConta,
    },
    saude_conta: saude,
    no_ar: noAr,
    pontos_salvos: pontosSalvos,
    curva_pedidos: curva,
    posts: posts.map((p) => ({ ...p, historico: historico[p.id] ?? null })),
    ultimos: ultimos ?? [],
    avisos,
  }, 200, cors);
}

const OBJETIVOS = new Set(["whatsapp", "cardapio"]);
const POSICOES = new Set(["auto", "stories_reels", "feed"]);
const PUBLICOS = new Set(["raio", "raio_engajou", "raio_sem_engajou"]);

// Público de quem interagiu com o @ no último ano. Criado uma vez e guardado.
async function garantirPublicoEngajamento(admin: any, token: string, contaId: string, cfg: any) {
  if (cfg.publico_engajamento_id) return cfg.publico_engajamento_id;
  const r = await metaPost(`${API}/${contaId}/customaudiences`, token, {
    name: `Painel · interagiu com @${cfg.instagram_usuario ?? "instagram"} (365 dias)`,
    prefill: true,
    rule: {
      inclusions: {
        operator: "or",
        rules: [{
          event_sources: [{ id: cfg.instagram_id, type: "ig_business" }],
          retention_seconds: 31536000,
          filter: { operator: "and", filters: [{ field: "event", operator: "eq", value: "ig_business_profile_all" }] },
        }],
      },
    },
  });
  const { error } = await admin.from("patrocinio_config")
    .update({ publico_engajamento_id: r.id }).eq("conta_id", cfg.conta_id);
  if (error) throw new Error(`Criei o público na Meta, mas não consegui guardar: ${error.message}`);
  return r.id;
}

// Horas soltas (ex.: 11,12,18,19,20) viram blocos contínuos para a Meta,
// todos os dias da semana, no fuso de quem vê.
function horasEmBlocos(horas: number[]) {
  const h = [...new Set(horas)].filter((x) => Number.isInteger(x) && x >= 0 && x <= 23).sort((a, b) => a - b);
  const blocos: Array<[number, number]> = [];
  for (const x of h) {
    const ult = blocos[blocos.length - 1];
    if (ult && ult[1] === x) ult[1] = x + 1; else blocos.push([x, x + 1]);
  }
  return blocos.map(([ini, fim]) => ({
    start_minute: ini * 60,
    end_minute: fim * 60,
    days: [0, 1, 2, 3, 4, 5, 6],
    timezone_type: "USER",
  }));
}

// Como a conta já leva gente ao WhatsApp hoje? Olha os conjuntos que a
// agência criou com destino WhatsApp e devolve o que eles usam (Página e
// número). Serve para repetir o mesmo caminho e para explicar o erro.
async function whatsappDaConta(token: string, contaId: string) {
  const url = new URL(`${API}/${contaId}/adsets`);
  url.searchParams.set("fields", "name,destination_type,promoted_object,created_time");
  url.searchParams.set("limit", "200");
  const lista = await metaGetPaginado(url, token);
  const achados: Array<{ pagina: string | null; numero: string | null; conjunto: string; quando: string }> = [];
  for (const a of lista) {
    if (!String(a.destination_type ?? "").includes("WHATSAPP")) continue;
    achados.push({
      pagina: a.promoted_object?.page_id ?? null,
      numero: a.promoted_object?.whatsapp_phone_number ?? null,
      conjunto: a.name ?? "",
      quando: a.created_time ?? "",
    });
  }
  achados.sort((x, y) => (y.quando > x.quando ? 1 : -1));
  return achados;
}

// (057) Valida a lista de pontos vinda da tela. Devolve null quando não
// veio nada — aí o patrocínio usa o ponto único da configuração, como
// sempre fez.
function lerPontos(bruto: any) {
  if (!Array.isArray(bruto) || bruto.length === 0) return null;
  if (bruto.length > MAX_PONTOS) {
    throw new Error(`No máximo ${MAX_PONTOS} pontos no mapa (vieram ${bruto.length}).`);
  }
  const pontos = bruto.map((p: any, i: number) => {
    const lat = Number(p?.lat);
    const lng = Number(p?.lng);
    const raio = Number(p?.raio);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error(`Ponto ${i + 1} com latitude inválida.`);
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) throw new Error(`Ponto ${i + 1} com longitude inválida.`);
    if (!Number.isFinite(raio) || raio < RAIO_MIN || raio > RAIO_MAX) {
      throw new Error(`Ponto ${i + 1}: o raio vai de ${RAIO_MIN} a ${RAIO_MAX} km (veio ${p?.raio}).`);
    }
    return {
      lat, lng,
      raio: Math.round(raio),
      nome: typeof p?.nome === "string" ? p.nome.slice(0, 60) : null,
    };
  });
  return pontos;
}

// (057) Interesses escolhidos na tela. A Meta quer {id, name}; o nome é
// só para o relatório dela, mas sem ele a interface do Gerenciador mostra
// o anúncio com interesses "sem nome".
function lerInteresses(bruto: any) {
  if (!Array.isArray(bruto) || bruto.length === 0) return null;
  if (bruto.length > 25) throw new Error("No máximo 25 interesses.");
  const itens = bruto.map((x: any) => ({
    id: String(x?.id ?? "").trim(),
    nome: String(x?.nome ?? x?.name ?? "").slice(0, 80),
  })).filter((x: any) => /^\d{5,}$/.test(x.id));
  return itens.length ? itens : null;
}

// (057) Número de WhatsApp: só dígitos, com DDI. É o campo que conserta o
// erro 100/2446886 — hoje o painel manda só a Página e a Meta não acha
// número nenhum nela.
function lerWhatsapp(bruto: any) {
  const n = String(bruto ?? "").replace(/\D/g, "");
  if (!n) return null;
  if (n.length < 12 || n.length > 15) {
    throw new Error(`Número de WhatsApp inválido: use DDI + DDD + número, só dígitos (veio "${bruto}").`);
  }
  return n;
}

async function patrocinar(admin: any, token: string, contaId: string, usuarioId: string | null, body: any, cors: any) {
  // 1. Quem pede, e se pediu com todas as letras.
  if (!(await ehAprovador(admin, usuarioId))) {
    return json({ error: "Só quem está na lista de aprovadores patrocina." }, 403, cors);
  }
  if (body.confirmo !== true) {
    return json({ error: "Marque a confirmação do valor antes de aprovar." }, 400, cors);
  }

  // 2. O pedido. Tudo tem valor padrão igual ao patrocínio simples.
  const midiaIds: string[] = (Array.isArray(body.midia_ids) ? body.midia_ids : [body.midia_id])
    .map((x: any) => String(x ?? "")).filter(Boolean);
  const valor = Math.round(Number(body.valor) * 100) / 100;
  const dias = Number(body.dias);
  const objetivo = String(body.objetivo ?? "whatsapp");
  const posicionamento = String(body.posicionamento ?? "auto");
  const publico = String(body.publico ?? "raio");
  const horas: number[] | null = Array.isArray(body.horas) && body.horas.length > 0 && body.horas.length < 24
    ? body.horas.map(Number) : null;

  // (058) Anúncio que não passa pelo feed: em vez de posts do Instagram,
  // vem o id de um arquivo que já foi subido e processado pela Meta.
  const midiaSubidaId = String(body.midia_subida_id ?? "").trim() || null;
  const legenda = typeof body.legenda === "string" ? body.legenda.slice(0, 2000) : null;

  if (!midiaSubidaId) {
    if (midiaIds.length < 1 || midiaIds.length > 3 || new Set(midiaIds).size !== midiaIds.length
        || midiaIds.some((m) => !/^\d{5,30}$/.test(m))) {
      return json({ error: "Escolha de 1 a 3 posts diferentes." }, 400, cors);
    }
  } else if (!/^[0-9a-f-]{36}$/i.test(midiaSubidaId)) {
    return json({ error: "Mídia subida inválida." }, 400, cors);
  }
  const quantosCriativos = midiaSubidaId ? 1 : midiaIds.length;
  if (!Number.isFinite(valor) || valor < 10 * quantosCriativos) {
    return json({ error: `O valor mínimo é R$ 10 por criativo (R$ ${10 * quantosCriativos} para ${quantosCriativos}).` }, 400, cors);
  }
  if (!Number.isInteger(dias) || dias < 1 || dias > 30) return json({ error: "Os dias vão de 1 a 30." }, 400, cors);
  if (!OBJETIVOS.has(objetivo)) return json({ error: "Objetivo inválido." }, 400, cors);
  if (!POSICOES.has(posicionamento)) return json({ error: "Posicionamento inválido." }, 400, cors);
  if (!PUBLICOS.has(publico)) return json({ error: "Público inválido." }, 400, cors);
  if (horas && horas.some((h) => !Number.isInteger(h) || h < 0 || h > 23)) {
    return json({ error: "Horários inválidos." }, 400, cors);
  }

  // (057) O que é novo. Tudo opcional: sem nada disso, o payload montado
  // adiante é idêntico ao de antes desta migração.
  let pontos: any[] | null = null;
  let interesses: any[] | null = null;
  let whatsappNumero: string | null = null;
  try {
    pontos = lerPontos(body.pontos);
    interesses = lerInteresses(body.interesses);
    whatsappNumero = lerWhatsapp(body.whatsapp_numero);
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 400, cors);
  }

  // Início: agora, ou um dia escolhido (às 00h de Brasília), até 30 dias à frente.
  const agora = new Date();
  let inicio = new Date(agora.getTime() + 5 * 60 * 1000);
  if (body.inicio) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.inicio))) return json({ error: "Data de início inválida." }, 400, cors);
    const escolhido = new Date(`${body.inicio}T00:00:00-03:00`);
    if (escolhido.getTime() > agora.getTime() + 30 * 86400000) {
      return json({ error: "O início pode ser no máximo daqui a 30 dias." }, 400, cors);
    }
    if (escolhido > inicio) inicio = escolhido;
  }
  const fim = new Date(inicio.getTime() + dias * 86400000);

  // 3. A configuração tem tudo que a Meta vai pedir?
  let cfg = await carregarConfig(admin, contaId);
  if (!pontos && (cfg.centro_lat == null || cfg.centro_lng == null)) {
    return json({ error: "Marque o ponto do restaurante na configuração, ou escolha pontos no mapa." }, 400, cors);
  }
  if (objetivo === "cardapio" && !cfg.cardapio_url) {
    return json({ error: "Para levar ao cardápio, cadastre o link do cardápio na configuração." }, 400, cors);
  }

  // (057) Idade e "quem conta" por patrocínio, com a configuração de padrão.
  const idadeMin = Number.isInteger(body.idade_min) ? Number(body.idade_min) : cfg.idade_min;
  const idadeMax = Number.isInteger(body.idade_max) ? Number(body.idade_max) : cfg.idade_max;
  if (idadeMin < 13 || idadeMax > 65 || idadeMin > idadeMax) {
    return json({ error: "A idade vai de 13 a 65 anos, e a mínima não pode passar da máxima." }, 400, cors);
  }
  const quemConta = body.quem_conta === "mora" || body.quem_conta === "mora_ou_esteve"
    ? body.quem_conta : cfg.quem_conta;

  cfg = await garantirInstagram(admin, token, contaId, cfg);

  // 4. De onde sai o criativo.
  let subida: any = null;
  let posts: any[] = [];
  if (midiaSubidaId) {
    const { data } = await admin.from("anuncio_midias").select("*").eq("id", midiaSubidaId).maybeSingle();
    if (!data) return json({ error: "Mídia subida não encontrada." }, 404, cors);
    if (data.estado !== "pronto") {
      // Criar anúncio com vídeo ainda em processamento falha com um erro
      // da Meta que não explica nada. Melhor barrar aqui, com o motivo.
      return json({ error: data.estado === "processando"
        ? "O vídeo ainda está sendo processado pela Meta. Espere ficar pronto e aprove de novo."
        : `A mídia não está pronta (${data.estado}).${data.erro ? " " + data.erro : ""}` }, 400, cors);
    }
    if (data.tipo === "video" && !data.meta_video_id) {
      return json({ error: "A mídia está marcada como pronta mas sem o vídeo na Meta." }, 400, cors);
    }
    if (data.tipo === "imagem" && !data.meta_image_hash) {
      return json({ error: "A mídia está marcada como pronta mas sem a imagem na Meta." }, 400, cors);
    }
    subida = data;
  } else {
    // Os posts são mesmo do Instagram do Mr Kong?
    const lista = await postsDoInstagram(token, cfg.instagram_id, 50);
    posts = midiaIds.map((id) => lista.find((p: any) => p.id === id));
    if (posts.some((p) => !p)) {
      return json({ error: "Algum post escolhido não está entre os últimos 50 do Instagram do Mr Kong." }, 400, cors);
    }
  }

  // 5. Grava ANTES de falar com a Meta. O banco confere aprovador e teto do
  //    mês; se passar do teto, para aqui e nada chega na Meta.
  const { data: linha, error: errIns } = await admin.from("patrocinios").insert({
    conta_id: cfg.conta_id,
    midia_id: subida ? null : midiaIds[0],
    midia_link: subida ? null : posts[0].link,
    midia_texto: subida ? (subida.nome ?? "arquivo subido") : posts[0].texto.slice(0, 200),
    midias: subida ? null : midiaIds,
    midia_subida_id: midiaSubidaId,
    legenda,
    valor,
    dias,
    objetivo,
    posicionamento,
    publico,
    inicio: inicio.toISOString(),
    horas,
    // Sem pontos no mapa, continua gravando o ponto único da configuração.
    centro_lat: pontos ? pontos[0].lat : cfg.centro_lat,
    centro_lng: pontos ? pontos[0].lng : cfg.centro_lng,
    raio_km: pontos ? pontos[0].raio : cfg.raio_km,
    // (057) A foto do que foi aprovado hoje. Se os pontos salvos mudarem
    // semana que vem, este patrocínio continua contando a verdade do dia dele.
    pontos,
    interesses,
    whatsapp_numero: whatsappNumero,
    quem_conta: quemConta,
    idade_min: idadeMin,
    idade_max: idadeMax,
    aprovado_por: usuarioId,
  }).select("id").single();
  if (errIns) return json({ error: errIns.message }, 409, cors);

  const marca = (campos: Record<string, unknown>) =>
    admin.from("patrocinios").update(campos).eq("id", linha.id);

  const etapas: Array<{ etapa: string; id: string }> = [];
  const quando = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(agora);
  const rotulo = objetivo === "cardapio" ? "cardápio" : "WhatsApp";
  let campanhaCriada: string | null = null;
  // (057) Vira true quando a Meta recusa o pedido de "não ampliar" e o
  // conjunto precisa ser criado sem ele. A tela avisa.
  let publicoAmpliado = false;

  try {
    // Os lugares. `custom_locations` sempre foi um array — antes ia com um
    // item só, montado a partir da configuração. Agora vai com os pontos
    // escolhidos no mapa, cada um com o seu raio.
    const lugares = pontos
      ? pontos.map((p) => ({
          latitude: p.lat, longitude: p.lng,
          radius: p.raio, distance_unit: "kilometer",
        }))
      : [{
          latitude: Number(cfg.centro_lat), longitude: Number(cfg.centro_lng),
          radius: cfg.raio_km, distance_unit: "kilometer",
        }];

    const targeting: Record<string, unknown> = {
      geo_locations: {
        custom_locations: lugares,
        location_types: quemConta === "mora" ? ["home"] : ["home", "recent"],
      },
      age_min: idadeMin,
      age_max: idadeMax,
      // Público do jeito que foi aprovado: sem a Meta "ampliar" por conta própria.
      targeting_automation: { advantage_audience: 0 },
    };
    // (057) Interesses. flexible_spec com um bloco só = "qualquer um
    // destes interesses", que é o que a pessoa espera ao marcar cinco.
    if (interesses) {
      targeting.flexible_spec = [{
        interests: interesses.map((i) => ({ id: i.id, name: i.nome })),
      }];
    }
    if (publico !== "raio") {
      const aud = await garantirPublicoEngajamento(admin, token, contaId, cfg);
      etapas.push({ etapa: "público", id: aud });
      if (publico === "raio_engajou") targeting.custom_audiences = [{ id: aud }];
      else targeting.excluded_custom_audiences = [{ id: aud }];
    }
    if (posicionamento === "stories_reels") {
      targeting.publisher_platforms = ["facebook", "instagram"];
      targeting.facebook_positions = ["story", "facebook_reels"];
      targeting.instagram_positions = ["story", "reels"];
    } else if (posicionamento === "feed") {
      targeting.publisher_platforms = ["facebook", "instagram"];
      targeting.facebook_positions = ["feed"];
      targeting.instagram_positions = ["stream"];
    }

    // Campanha
    const camp = await metaPost(`${API}/${contaId}/campaigns`, token, {
      name: `Painel · ${quando} · ${rotulo} · ${midiaIds.length} post${midiaIds.length > 1 ? "s" : ""}`,
      objective: objetivo === "cardapio" ? "OUTCOME_TRAFFIC" : "OUTCOME_ENGAGEMENT",
      status: "PAUSED",
      special_ad_categories: [],
      is_adset_budget_sharing_enabled: false,
    });
    campanhaCriada = camp.id;
    await marca({ campanha_id: camp.id });
    etapas.push({ etapa: "campanha", id: camp.id });

    // Conjunto: verba TOTAL e data de fim — a Meta para sozinha no fim.
    // Horário por faixa só funciona com verba total, que é o que usamos.
    const lugarDito = pontos ? `${pontos.length} ponto${pontos.length > 1 ? "s" : ""}` : `${cfg.raio_km} km`;
    const conjunto: Record<string, unknown> = {
      name: `Conjunto · ${lugarDito} · ${idadeMin}-${idadeMax}${horas ? " · com horário" : ""}`,
      campaign_id: camp.id,
      lifetime_budget: Math.round(valor * 100),
      start_time: dataMeta(inicio),
      end_time: dataMeta(fim),
      billing_event: "IMPRESSIONS",
      // Sem isto a Meta recusa (código 100/2490487): quando a verba fica no
      // conjunto e não na campanha, a estratégia de lance tem que vir dita.
      // "Menor custo, sem teto de lance" é a mesma que o Gerenciador usa por padrão.
      bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      targeting,
      status: "PAUSED",
    };
    if (objetivo === "cardapio") {
      conjunto.optimization_goal = "LINK_CLICKS";
      conjunto.destination_type = "WEBSITE";
    } else {
      conjunto.optimization_goal = "CONVERSATIONS";
      conjunto.destination_type = "WHATSAPP";
      conjunto.promoted_object = { page_id: cfg.pagina_id };
      // (057) Número escolhido na tela vence qualquer adivinhação. É o
      // conserto do 100/2446886: sem número, a Meta tenta achar um na
      // Página e recusa quando não acha.
      if (whatsappNumero) {
        conjunto.promoted_object = { page_id: cfg.pagina_id, whatsapp_phone_number: whatsappNumero };
        etapas.push({ etapa: "whatsapp escolhido", id: whatsappNumero });
      } else {
        // Se a agência já leva gente ao WhatsApp por esta Página indicando o
        // número no próprio anúncio, repete o mesmo número.
        try {
          const zap = (await whatsappDaConta(token, contaId))
            .find((z) => z.pagina === cfg.pagina_id && z.numero);
          if (zap?.numero) {
            conjunto.promoted_object = { page_id: cfg.pagina_id, whatsapp_phone_number: zap.numero };
            etapas.push({ etapa: "whatsapp da agência", id: zap.numero });
          }
        } catch { /* segue só com a Página */ }
      }
    }
    if (horas) {
      conjunto.pacing_type = ["day_parting"];
      conjunto.adset_schedule = horasEmBlocos(horas);
    }

    // (057) A Meta vem recusando `targeting_automation.advantage_audience: 0`
    // em contas novas desde outubro/2026 — a Dinâmico já teve que tirar o
    // campo. Se a recusa for por causa dele, cria de novo sem o campo e
    // marca o patrocínio, para a tela dizer que o público foi ampliado.
    // Falhar calado seria pior; ampliar calado, pior ainda.
    let conj: any;
    try {
      conj = await metaPost(`${API}/${contaId}/adsets`, token, conjunto);
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      const culpaDoFlag = /advantage[_ ]?audience/i.test(msg) || /targeting_automation/i.test(msg);
      if (!culpaDoFlag) throw e;
      const semFlag = { ...conjunto };
      const alvo = { ...(semFlag.targeting as Record<string, unknown>) };
      delete alvo.targeting_automation;
      semFlag.targeting = alvo;
      conj = await metaPost(`${API}/${contaId}/adsets`, token, semFlag);
      publicoAmpliado = true;
      etapas.push({ etapa: "público ampliado pela Meta", id: "advantage_audience" });
    }
    await marca({ conjunto_id: conj.id });
    etapas.push({ etapa: "conjunto", id: conj.id });

    // Um criativo e um anúncio por post, todos no mesmo conjunto: dividem a
    // verba e a Meta empurra mais o que funciona melhor. Com arquivo subido
    // é um criativo só — não existe "testar três arquivos" aqui.
    const criativoIds: string[] = [];
    const anuncioIds: string[] = [];
    const fontes: string[] = subida ? [subida.id] : midiaIds;
    for (const m of fontes) {
      const cta = objetivo === "cardapio"
        ? { type: "ORDER_NOW", value: { link: cfg.cardapio_url } }
        // A Meta exige um link no botão mesmo levando ao WhatsApp (erro 2061015).
        : { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP", link: "https://api.whatsapp.com/send" } };

      // (058) Arquivo subido monta o criativo por object_story_spec: o
      // conteúdo não existe como post, então não há media_id para apontar.
      // O destino do clique precisa vir no próprio criativo.
      const destino = objetivo === "cardapio"
        ? cfg.cardapio_url
        : "https://api.whatsapp.com/send";
      const corpoCriativo: Record<string, unknown> = subida
        ? {
            name: `Criativo · arquivo ${String(subida.nome ?? "").slice(0, 40)}`,
            object_story_spec: {
              page_id: cfg.pagina_id,
              ...(subida.tipo === "video"
                ? {
                    video_data: {
                      video_id: subida.meta_video_id,
                      // Vídeo no Instagram sem capa é recusado; a capa vem
                      // da própria Meta, gerada no processamento.
                      ...(subida.meta_thumb_url ? { image_url: subida.meta_thumb_url } : {}),
                      message: legenda ?? "",
                      call_to_action: { type: cta.type, value: { link: destino, ...(cta.value as any) } },
                    },
                  }
                : {
                    link_data: {
                      image_hash: subida.meta_image_hash,
                      link: destino,
                      message: legenda ?? "",
                      call_to_action: cta,
                    },
                  }),
            },
            instagram_user_id: cfg.instagram_id,
          }
        : {
            name: `Criativo · post ${m}`,
            object_id: cfg.pagina_id,
            instagram_user_id: cfg.instagram_id,
            source_instagram_media_id: m,
            call_to_action: cta,
          };
      const criativo = await metaPost(`${API}/${contaId}/adcreatives`, token, corpoCriativo);
      criativoIds.push(criativo.id);
      etapas.push({ etapa: "criativo", id: criativo.id });

      const ad = await metaPost(`${API}/${contaId}/ads`, token, {
        name: `Anúncio · ${quando} · ${subida ? "arquivo" : `post ${m.slice(-6)}`}`,
        adset_id: conj.id,
        creative: { creative_id: criativo.id },
        status: "PAUSED",
      });
      anuncioIds.push(ad.id);
      etapas.push({ etapa: "anúncio", id: ad.id });
      await marca({ criativo_id: criativoIds[0], anuncio_id: anuncioIds[0], criativo_ids: criativoIds, anuncio_ids: anuncioIds });
    }

    // Só agora liga. Se qualquer passo acima tivesse falhado, nada rodaria.
    await metaPost(`${API}/${camp.id}`, token, { status: "ACTIVE" });
    await metaPost(`${API}/${conj.id}`, token, { status: "ACTIVE" });
    for (const id of anuncioIds) await metaPost(`${API}/${id}`, token, { status: "ACTIVE" });

    await marca({ estado: "publicado", publicado_em: new Date().toISOString(), erro: null });
    return json({
      ok: true, id: linha.id, etapas,
      comeca: inicio.toISOString(), termina: fim.toISOString(),
      publico_ampliado: publicoAmpliado,
    }, 200, cors);
  } catch (e) {
    // O que já tinha sido criado estava PAUSADO, gastando zero. Para não
    // deixar lixo no Gerenciador, a campanha pela metade é apagada (apagar a
    // campanha leva junto conjunto e anúncios). Se nem isso der, fica pausada.
    let erro = String(e instanceof Error ? e.message : e).slice(0, 800);
    // Erro de WhatsApp: diz o que os anúncios da agência usam, para saber o
    // que vincular (ou por que o nosso é diferente do deles).
    if (/whatsapp/i.test(erro) || /2446886/.test(erro)) {
      if (!whatsappNumero) {
        erro += " · O painel mandou só a Página e deixou a Meta achar o número. Escolha um número de WhatsApp na tela antes de aprovar: é o campo que resolve este erro.";
      }
      try {
        const zap = await whatsappDaConta(token, contaId);
        if (!zap.length) {
          erro += " · Diagnóstico: nenhum conjunto desta conta leva ao WhatsApp; os anúncios antigos devem ter sido feitos por outra conta de anúncios.";
        } else {
          const paginas = [...new Set(zap.map((z) => z.pagina ?? "sem página"))];
          const nomes: string[] = [];
          for (const pid of paginas) {
            try {
              const pg = pid === "sem página" ? null : await metaGet(new URL(`${API}/${pid}?fields=name`), token);
              nomes.push(`${pg?.name ?? pid} (${pid}${pid === cfg.pagina_id ? ", a mesma do painel" : ", OUTRA Página"})`);
            } catch { nomes.push(pid); }
          }
          const numeros = [...new Set(zap.map((z) => z.numero).filter(Boolean))];
          erro += ` · Diagnóstico: ${zap.length} conjunto(s) da agência levam ao WhatsApp usando a Página ${nomes.join(" / ")}` +
            (numeros.length ? `, número ${numeros.join(" / ")}.` : ", sem número indicado no anúncio (o número vem da Página).");
        }
      } catch { /* sem diagnóstico */ }
    }
    if (campanhaCriada) {
      try { await metaPost(`${API}/${campanhaCriada}`, token, { status: "DELETED" }); etapas.push({ etapa: "campanha apagada", id: campanhaCriada }); }
      catch { /* fica pausada, gastando zero */ }
    }
    await marca({ estado: "falhou", erro });
    return json({ ok: false, id: linha.id, etapas, error: erro }, 200, cors);
  }
}


// ---------------------------------------------------------------------
// MÍDIA SUBIDA — anúncio que não passa pelo feed  (058)
//
// O arquivo já está no balde `anuncios` do Storage, posto lá pelo
// navegador. Aqui ele é buscado com a chave de serviço e mandado para a
// Meta. O navegador nunca toca no token, e a função nunca recebe 30 MB
// pelo corpo da requisição.
//
// VÍDEO É ASSÍNCRONO. A Meta aceita o upload e devolve um id na hora,
// mas o vídeo fica "processing" por um tempo. Criar anúncio antes de
// ficar `ready` falha com um erro que não explica nada. Por isso o
// upload e a espera são DUAS ações: `subir_midia` manda e volta, e a
// tela pergunta `estado_midia` até liberar.
// ---------------------------------------------------------------------

async function metaUpload(url: string, token: string, campo: string, arquivo: Blob, nome: string) {
  const fd = new FormData();
  fd.append(campo, arquivo, nome);
  // Sem Content-Type à mão: o fetch monta o boundary do multipart sozinho,
  // e escrever o header na mão quebra o upload.
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const texto = await res.text();
  let dados: any;
  try { dados = JSON.parse(texto); }
  catch { throw new Error(`Resposta inesperada da Meta no upload: ${texto.slice(0, 300)}`); }
  if (!res.ok || dados.error) {
    const e = dados.error ?? {};
    const titulo = e.error_user_title ? `${e.error_user_title}: ` : "";
    const msg = e.error_user_msg || e.message || texto.slice(0, 200);
    throw new Error(`${titulo}${msg} (código ${e.code ?? res.status}${e.error_subcode ? "/" + e.error_subcode : ""})`);
  }
  return dados;
}

// ---------------------------------------------------------------------
// ENVIO EM PEDAÇOS  (059)
//
// A versão anterior baixava o vídeo inteiro para a memória e mandava de
// uma vez. Edge Function tem pouca memória, e por isso o limite era de
// 100 MB. Agora a função lê UM pedaço por vez, pelo cabeçalho Range de
// uma URL assinada do Storage, e manda pela API em fases da Meta:
//
//   start    -> a Meta devolve a sessão e diz qual faixa quer
//   transfer -> manda a faixa; a Meta devolve a próxima faixa
//   finish   -> fecha e o vídeo entra em processamento
//
// A memória usada passa a ser o tamanho de um pedaço, não do vídeo.
//
// E o tempo da função é limitado: um arquivo grande não cabe numa
// chamada só. Em vez de falhar, a função para quando o orçamento de
// tempo acaba, guarda a sessão e o offset, e devolve `enviando` com o
// progresso. A tela chama de novo e o envio continua de onde parou.
// ---------------------------------------------------------------------

// Quanto tempo uma chamada gasta enviando antes de devolver o progresso.
// Abaixo do limite da Edge Function, com folga para o finish.
const ORCAMENTO_MS = 55_000;

async function metaFase(url: string, token: string, campos: Record<string, string>, pedaco?: Blob) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.append(k, v);
  if (pedaco) fd.append("video_file_chunk", pedaco, "chunk");
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  const texto = await res.text();
  let dados: any;
  try { dados = JSON.parse(texto); }
  catch { throw new Error(`Resposta inesperada da Meta: ${texto.slice(0, 300)}`); }
  if (!res.ok || dados.error) {
    const e = dados.error ?? {};
    const titulo = e.error_user_title ? `${e.error_user_title}: ` : "";
    const msg = e.error_user_msg || e.message || texto.slice(0, 200);
    throw new Error(`${titulo}${msg} (código ${e.code ?? res.status}${e.error_subcode ? "/" + e.error_subcode : ""})`);
  }
  return dados;
}

// Lê uma faixa de bytes do arquivo no Storage sem carregar o resto.
async function lerFaixa(urlAssinada: string, inicio: number, fimExclusivo: number) {
  const res = await fetch(urlAssinada, {
    headers: { Range: `bytes=${inicio}-${fimExclusivo - 1}` },
  });
  if (!res.ok && res.status !== 206) {
    throw new Error(`Não consegui ler o pedaço do arquivo (HTTP ${res.status}).`);
  }
  return await res.blob();
}

async function subirVideoEmPedacos(admin: any, token: string, contaId: string, m: any, marca: any) {
  // URL assinada curta: só esta função usa, e só durante este envio.
  const { data: assinada, error: errUrl } = await admin.storage
    .from("anuncios").createSignedUrl(m.caminho, 900);
  if (errUrl || !assinada?.signedUrl) {
    throw new Error(`Não consegui abrir o arquivo no Storage: ${errUrl?.message ?? "sem detalhe"}`);
  }
  const url = `${API}/${contaId}/advideos`;

  let sessao: string | null = m.upload_sessao ?? null;
  let videoId: string | null = m.meta_video_id ?? null;
  let inicio = Number(m.proximo_offset ?? 0);
  let fim = 0;

  if (!sessao) {
    const tamanho = Number(m.bytes);
    if (!Number.isFinite(tamanho) || tamanho <= 0) {
      throw new Error("Não sei o tamanho do arquivo; suba de novo.");
    }
    const r = await metaFase(url, token, { upload_phase: "start", file_size: String(tamanho) });
    sessao = String(r.upload_session_id);
    videoId = String(r.video_id);
    inicio = Number(r.start_offset ?? 0);
    fim = Number(r.end_offset ?? 0);
    await marca({ upload_sessao: sessao, meta_video_id: videoId, proximo_offset: inicio });
  } else {
    // Retomando: a Meta já disse onde parou; o fim do pedaço ela devolve
    // a cada transfer, então o primeiro depois de retomar usa um palpite
    // que ela corrige na resposta.
    fim = inicio;
  }

  const ate = Date.now() + ORCAMENTO_MS;
  const tamanho = Number(m.bytes);

  while (inicio < tamanho) {
    if (Date.now() > ate) {
      // Acabou o tempo desta chamada. Nada se perde: a sessão e o offset
      // estão guardados, e a próxima continua daqui.
      await marca({ estado: "enviando", proximo_offset: inicio });
      return { parcial: true, enviado: inicio, total: tamanho };
    }
    // Se não sei o fim (caso de retomada), peço um pedaço conservador e
    // deixo a Meta corrigir pela resposta.
    const limite = fim > inicio ? fim : Math.min(inicio + 4 * 1024 * 1024, tamanho);
    const pedaco = await lerFaixa(assinada.signedUrl, inicio, limite);
    const r = await metaFase(url, token, {
      upload_phase: "transfer",
      upload_session_id: sessao,
      start_offset: String(inicio),
    }, pedaco);
    const novoInicio = Number(r.start_offset ?? limite);
    fim = Number(r.end_offset ?? novoInicio);
    // Trava contra loop infinito: se a Meta não avançar, é melhor falhar
    // com mensagem do que ficar mandando o mesmo pedaço para sempre.
    if (novoInicio <= inicio) {
      throw new Error("A Meta parou de avançar no envio. Tente de novo; se repetir, o arquivo pode estar corrompido.");
    }
    inicio = novoInicio;
    await marca({ proximo_offset: inicio });
  }

  await metaFase(url, token, { upload_phase: "finish", upload_session_id: sessao });
  await marca({ estado: "processando", proximo_offset: tamanho });
  return { parcial: false, video_id: videoId };
}

async function subirMidia(admin: any, token: string, contaId: string, usuarioId: string | null, body: any, cors: any) {
  const midiaId = String(body.midia_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(midiaId)) return json({ error: "midia_id inválido." }, 400, cors);

  const { data: m } = await admin.from("anuncio_midias").select("*").eq("id", midiaId).maybeSingle();
  if (!m) return json({ error: "Mídia não encontrada." }, 404, cors);
  if (m.estado === "pronto") return json({ ok: true, ja_estava: true, midia: m }, 200, cors);

  const marca = (campos: Record<string, unknown>) =>
    admin.from("anuncio_midias").update({ ...campos, atualizado_em: new Date().toISOString() }).eq("id", midiaId);

  // `enviando` aqui não recomeça nada: se já existe sessão, o envio em
  // pedaços retoma do offset guardado.
  await marca({ estado: "enviando", erro: null });

  try {
    if (m.tipo === "imagem") {
      // Foto de anúncio não chega perto do limite de memória; só o vídeo
      // precisa ir em pedaços.
      const { data: arquivo, error: errBaixa } = await admin.storage.from("anuncios").download(m.caminho);
      if (errBaixa || !arquivo) throw new Error(`Não consegui ler o arquivo do Storage: ${errBaixa?.message ?? "sem detalhe"}`);
      const d = await metaUpload(`${API}/${contaId}/adimages`, token, "file", arquivo, m.nome || "anuncio.jpg");
      // A Meta devolve as imagens com o nome do arquivo como chave.
      const primeira: any = Object.values(d.images ?? {})[0];
      if (!primeira?.hash) throw new Error("A Meta aceitou a imagem mas não devolveu o hash.");
      await marca({ estado: "pronto", meta_image_hash: primeira.hash, meta_thumb_url: primeira.url ?? null });
      return json({ ok: true, estado: "pronto", hash: primeira.hash }, 200, cors);
    }

    const r = await subirVideoEmPedacos(admin, token, contaId, m, marca);
    if (r.parcial) {
      return json({
        ok: true, estado: "enviando",
        enviado: r.enviado, total: r.total,
        pct: Math.round((r.enviado / r.total) * 100),
      }, 200, cors);
    }
    return json({ ok: true, estado: "processando", video_id: r.video_id }, 200, cors);
  } catch (e) {
    const erro = String(e instanceof Error ? e.message : e).slice(0, 600);
    await marca({ estado: "falhou", erro });
    return json({ ok: false, estado: "falhou", error: erro }, 200, cors);
  }
}

// A tela chama isto de poucos em poucos segundos enquanto o vídeo processa.
async function estadoMidia(admin: any, token: string, body: any, cors: any) {
  const midiaId = String(body.midia_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(midiaId)) return json({ error: "midia_id inválido." }, 400, cors);

  const { data: m } = await admin.from("anuncio_midias").select("*").eq("id", midiaId).maybeSingle();
  if (!m) return json({ error: "Mídia não encontrada." }, 404, cors);
  if (m.estado !== "processando" || !m.meta_video_id) {
    return json({ ok: true, estado: m.estado, midia: m }, 200, cors);
  }

  const marca = (campos: Record<string, unknown>) =>
    admin.from("anuncio_midias").update({ ...campos, atualizado_em: new Date().toISOString() }).eq("id", midiaId);

  try {
    const url = new URL(`${API}/${m.meta_video_id}`);
    url.searchParams.set("fields", "status");
    const d = await metaGet(url, token);
    const situacao = d?.status?.video_status ?? "processing";

    if (situacao === "error") {
      const erro = d?.status?.processing_progress != null
        ? "A Meta não conseguiu processar este vídeo. Tente um MP4 com H.264 e áudio AAC."
        : "A Meta recusou o vídeo no processamento.";
      await marca({ estado: "falhou", erro });
      return json({ ok: false, estado: "falhou", error: erro }, 200, cors);
    }
    if (situacao !== "ready") {
      return json({ ok: true, estado: "processando" }, 200, cors);
    }

    // Vídeo no Instagram precisa de capa. A Meta gera algumas e marca uma
    // como preferida; sem capa, o criativo é recusado.
    let capa: string | null = null;
    try {
      const t = await metaGet(new URL(`${API}/${m.meta_video_id}/thumbnails`), token);
      const lista = t?.data ?? [];
      capa = (lista.find((x: any) => x.is_preferred) ?? lista[0])?.uri ?? null;
    } catch { /* segue sem capa; o erro aparece na hora de criar o anúncio */ }

    await marca({ estado: "pronto", meta_thumb_url: capa });
    return json({ ok: true, estado: "pronto", capa }, 200, cors);
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 502, cors);
  }
}

// A Meta aceita a data com fuso explícito.
// =====================================================================
// (062) Sorteio pelos comentarios
//
// Por que comentario e nao curtida: a Meta entrega `like_count`, um numero,
// e nunca a lista de quem curtiu. Com repost e igual. Comentario e o unico
// lugar onde o @ de quem participou vem junto.
//
// Duas acoes de proposito:
//   sorteio_previa  monta a lista e devolve as contas, sem sortear.
//   sortear         monta a lista DE NOVO, sorteia e grava.
//
// A previa nao e guardada e o sorteio nao confia nela: entre uma e outra o
// post continua recebendo comentario, e o que vale e a lista do momento em
// que voce apertou o botao. E essa lista fica gravada inteira.
// =====================================================================

// Quantos comentarios no maximo por post. Acima disto a Meta pagina muito e
// a funcao estoura o tempo; melhor dizer que a lista pode estar incompleta
// do que devolver meia lista fingindo que esta inteira.
const MAX_COMENTARIOS = 3000;

type Comentario = {
  id: string;
  arroba: string;
  texto: string;
  quando: string;
  resposta: boolean;
  post: string;
};

// Le os comentarios de um post. O caminho `/comments` traz so os de primeiro
// nivel; as respostas vem penduradas em cada um. Por isso "tirar respostas"
// nao e um filtro depois: e simplesmente nao pedir o galho das respostas.
async function comentariosDoPost(token: string, midiaId: string, comRespostas: boolean) {
  const url = new URL(`${API}/${midiaId}/comments`);
  url.searchParams.set(
    "fields",
    comRespostas
      ? "id,username,text,timestamp,replies{id,username,text,timestamp}"
      : "id,username,text,timestamp"
  );
  url.searchParams.set("limit", "50");

  const fora: Comentario[] = [];
  let proxima: string | null = url.toString();
  let voltas = 0;

  while (proxima && fora.length < MAX_COMENTARIOS && voltas < 80) {
    const d: any = await metaGet(new URL(proxima), token);
    for (const c of d.data ?? []) {
      fora.push({
        id: String(c.id),
        arroba: String(c.username ?? "").toLowerCase(),
        texto: String(c.text ?? ""),
        quando: String(c.timestamp ?? ""),
        resposta: false,
        post: midiaId,
      });
      for (const r of c.replies?.data ?? []) {
        fora.push({
          id: String(r.id),
          arroba: String(r.username ?? "").toLowerCase(),
          texto: String(r.text ?? ""),
          quando: String(r.timestamp ?? ""),
          resposta: true,
          post: midiaId,
        });
      }
    }
    proxima = d.paging?.next ?? null;
    voltas++;
  }
  return { lista: fora, truncado: fora.length >= MAX_COMENTARIOS };
}

function lerData(v: unknown) {
  if (v == null || v === "") return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

// Monta a lista final a partir dos comentarios crus. Tudo o que sai, sai
// com motivo — a tela mostra os descartados riscados, e e isso que permite
// voce responder a quem reclamar.
function montarParticipantes(crus: Comentario[], regra: any) {
  const casa = String(regra.instagram_usuario ?? "").toLowerCase().replace(/^@/, "");
  const de = lerData(regra.de);
  const ate = lerData(regra.ate);
  const minimo = Math.max(1, Math.min(50, Number(regra.min_comentarios) || 1));
  const teto = regra.teto_chances ? Math.max(1, Number(regra.teto_chances)) : null;

  const descartados: Array<{ arroba: string; motivo: string }> = [];
  const porPessoa = new Map<string, { comentarios: number; marcou: boolean; primeiro: Comentario }>();

  for (const c of crus) {
    if (!c.arroba) { descartados.push({ arroba: "(sem nome)", motivo: "a Meta nao devolveu o @" }); continue; }
    if (regra.tirar_respostas && c.resposta) { descartados.push({ arroba: "@" + c.arroba, motivo: "resposta a outro comentario" }); continue; }
    if (regra.tirar_casa && casa && c.arroba === casa) { descartados.push({ arroba: "@" + c.arroba, motivo: "da casa" }); continue; }

    const quando = lerData(c.quando);
    if (de && quando && quando < de) { descartados.push({ arroba: "@" + c.arroba, motivo: "comentou antes da janela" }); continue; }
    if (ate && quando && quando > ate) { descartados.push({ arroba: "@" + c.arroba, motivo: "comentou depois da janela" }); continue; }

    // Marcar amigo = escrever um @ que nao seja o proprio nome nem o da casa.
    const marcas = (c.texto.match(/@[A-Za-z0-9._]{2,30}/g) ?? [])
      .map((x) => x.slice(1).toLowerCase())
      .filter((x) => x !== c.arroba && x !== casa);

    if (regra.regra === "marcou" && marcas.length === 0) {
      descartados.push({ arroba: "@" + c.arroba, motivo: "nao marcou ninguem" });
      continue;
    }

    const atual = porPessoa.get(c.arroba);
    if (atual) {
      atual.comentarios++;
      if (marcas.length) atual.marcou = true;
      // Segundo comentario da mesma pessoa so e "descarte" quando a regra e
      // uma chance por pessoa; nas outras ele conta.
      if (regra.regra === "pessoa") descartados.push({ arroba: "@" + c.arroba, motivo: "ja estava na lista" });
    } else {
      porPessoa.set(c.arroba, { comentarios: 1, marcou: marcas.length > 0, primeiro: c });
    }
  }

  const participantes: Array<{ arroba: string; comentarios: number; chances: number; texto: string; quando: string }> = [];
  for (const [arroba, p] of porPessoa) {
    if (p.comentarios < minimo) {
      descartados.push({ arroba: "@" + arroba, motivo: `menos de ${minimo} comentarios no periodo` });
      continue;
    }
    let chances = 1;
    if (regra.regra === "comentario") chances = teto ? Math.min(p.comentarios, teto) : p.comentarios;
    participantes.push({
      arroba: "@" + arroba,
      comentarios: p.comentarios,
      chances,
      texto: p.primeiro.texto.slice(0, 280),
      quando: p.primeiro.quando,
    });
  }

  participantes.sort((a, b) => a.arroba.localeCompare(b.arroba));
  return { participantes, descartados };
}

// Sorteio reproduzivel. A semente e sorteada de verdade (crypto), mas a
// partir dela o resultado e sempre o mesmo — e e por isso que guardar a
// semente junto com a lista transforma "confia em mim" em "confere ai".
function geradorDe(semente: string) {
  let h = 2166136261;
  for (let i = 0; i < semente.length; i++) {
    h ^= semente.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return function () {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tira `quantos` nomes diferentes, respeitando o peso de cada um.
function tirarNomes(participantes: any[], semente: string, quantos: number) {
  const rnd = geradorDe(semente);
  const urna = participantes.map((p) => ({ ...p }));
  const tirados: any[] = [];

  for (let n = 0; n < quantos && urna.length; n++) {
    const total = urna.reduce((s, p) => s + p.chances, 0);
    let ponto = rnd() * total;
    let i = 0;
    for (; i < urna.length; i++) {
      ponto -= urna[i].chances;
      if (ponto <= 0) break;
    }
    if (i >= urna.length) i = urna.length - 1;
    tirados.push(urna[i]);
    urna.splice(i, 1);
  }
  return tirados;
}

// Junta os comentarios de onde a tela mandou buscar.
async function juntarComentarios(admin: any, token: string, contaId: string, body: any) {
  const escopo = String(body.escopo ?? "post");
  const comRespostas = body.tirar_respostas === false;

  if (escopo === "colado") {
    const brutos: string[] = Array.isArray(body.arrobas) ? body.arrobas : [];
    const crus: Comentario[] = brutos
      .map((x) => String(x).trim().toLowerCase().replace(/^@/, ""))
      .filter((x) => /^[a-z0-9._]{2,30}$/.test(x))
      .map((x, i) => ({ id: `colado-${i}`, arroba: x, texto: "", quando: "", resposta: false, post: "colado" }));
    if (!crus.length) throw new Error("A lista colada nao tem nenhum @ valido.");
    return { crus, posts: [] as string[], truncado: false, cfg: await carregarConfig(admin, contaId) };
  }

  let cfg = await carregarConfig(admin, contaId);
  cfg = await garantirInstagram(admin, token, contaId, cfg);

  let posts: string[] = [];
  if (escopo === "post") {
    const um = String(body.midia_id ?? "").trim();
    if (!/^\d+$/.test(um)) throw new Error("Escolha um post antes de sortear.");
    posts = [um];
  } else {
    const de = lerData(body.de);
    const ate = lerData(body.ate);
    const todos = await postsDoInstagram(token, cfg.instagram_id, 50);
    posts = todos
      .filter((p: any) => {
        const d = lerData(p.data);
        if (!d) return false;
        if (de && d < de) return false;
        // Post publicado depois do fim da janela nao pode ter comentario
        // dentro dela, entao nem vale a chamada.
        if (ate && d > ate) return false;
        return true;
      })
      .map((p: any) => p.id);
    if (!posts.length) throw new Error("Nenhum post do Instagram nesse periodo.");
  }

  const crus: Comentario[] = [];
  let truncado = false;
  for (const id of posts) {
    const r = await comentariosDoPost(token, id, comRespostas);
    crus.push(...r.lista);
    if (r.truncado) truncado = true;
  }
  return { crus, posts, truncado, cfg };
}

function regraDoCorpo(body: any, cfg: any) {
  const regra = String(body.regra ?? "pessoa");
  if (!["pessoa", "comentario", "marcou"].includes(regra)) throw new Error(`Regra desconhecida: ${regra}`);
  return {
    regra,
    de: body.de ?? null,
    ate: body.ate ?? null,
    min_comentarios: Number(body.min_comentarios) || 1,
    teto_chances: body.teto_chances ?? null,
    tirar_casa: body.tirar_casa !== false,
    tirar_respostas: body.tirar_respostas !== false,
    instagram_usuario: cfg?.instagram_usuario ?? null,
  };
}

async function sorteioPrevia(admin: any, token: string, contaId: string, body: any, cors: any) {
  try {
    const { crus, posts, truncado, cfg } = await juntarComentarios(admin, token, contaId, body);
    const regra = regraDoCorpo(body, cfg);
    const { participantes, descartados } = montarParticipantes(crus, regra);
    return json({
      ok: true,
      posts: posts.length,
      total_comentarios: crus.length,
      total_pessoas: participantes.length,
      truncado,
      participantes,
      descartados,
    }, 200, cors);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400, cors);
  }
}

async function sortear(admin: any, token: string, contaId: string, usuarioId: string | null, body: any, cors: any) {
  try {
    const { crus, posts, truncado, cfg } = await juntarComentarios(admin, token, contaId, body);
    const regra = regraDoCorpo(body, cfg);
    const { participantes, descartados } = montarParticipantes(crus, regra);

    if (!participantes.length) {
      return json({ error: "Ninguem sobrou depois dos filtros. Afrouxe a janela ou o minimo de comentarios." }, 400, cors);
    }

    // Semente sorteada de verdade; o resto do sorteio e deterministico.
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const semente = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");

    const quantos = Math.min(participantes.length, 1 + Math.max(0, Math.min(5, Number(body.suplentes) || 0)));
    const tirados = tirarNomes(participantes, semente, quantos);
    const ganhador = tirados[0];

    const { data: linha, error } = await admin.from("sorteios").insert({
      conta_id: cfg.conta_id,
      criado_por: usuarioId,
      escopo: String(body.escopo ?? "post"),
      midia_ids: posts,
      de: regra.de,
      ate: regra.ate,
      regra: regra.regra,
      min_comentarios: regra.min_comentarios,
      teto_chances: regra.teto_chances,
      tirar_casa: regra.tirar_casa,
      tirar_respostas: regra.tirar_respostas,
      participantes,
      descartados,
      total_comentarios: crus.length,
      total_pessoas: participantes.length,
      ganhador: ganhador.arroba,
      ganhador_comentario: ganhador.texto || null,
      suplentes: tirados.slice(1).map((t) => t.arroba),
      semente,
    }).select("id, criado_em").single();

    if (error) return json({ error: `Sorteei, mas nao consegui guardar: ${error.message}` }, 500, cors);

    return json({
      ok: true,
      id: linha.id,
      criado_em: linha.criado_em,
      ganhador: ganhador.arroba,
      ganhador_comentario: ganhador.texto || null,
      ganhador_quando: ganhador.quando || null,
      suplentes: tirados.slice(1).map((t) => t.arroba),
      total_comentarios: crus.length,
      total_pessoas: participantes.length,
      posts: posts.length,
      truncado,
      semente,
      participantes,
      descartados,
    }, 200, cors);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400, cors);
  }
}

function dataMeta(d: Date) {
  return d.toISOString().replace(/\.\d{3}Z$/, "+0000");
}

// ---------------------------------------------------------------------
// Curva de pedidos por hora (CardápioWeb)
//
// Um dia por chamada, de propósito: o CardápioWeb limita a 5 consultas
// de histórico por minuto, e um mês inteiro de uma vez estoura. O cron
// da madrugada busca o dia anterior e a série se constrói sozinha.
// ---------------------------------------------------------------------
async function sincronizarVendasHora(admin: any, body: any, cors: any) {
  const cwToken = Deno.env.get("CARDAPIOWEB_API_TOKEN");
  if (!cwToken) return json({ error: "CARDAPIOWEB_API_TOKEN não configurado nos secrets do projeto." }, 500, cors);

  // Sem parâmetro, busca ONTEM: o dia de hoje ainda está acontecendo e
  // gravar ele agora congelaria uma curva pela metade.
  const dia = body.dia ?? somaDias(hojeNoFuso(), -1);
  const headers = { "X-API-KEY": cwToken, Accept: "application/json" };

  const pedidos: any[] = [];
  let pagina = 1, totalPaginas = 1;
  do {
    const url = new URL(CW_BASE + "/api/partner/v1/orders/history");
    url.searchParams.set("start_date", dia);
    url.searchParams.set("end_date", dia);
    url.searchParams.append("status[]", "closed");
    url.searchParams.set("page", String(pagina));
    url.searchParams.set("per_page", "100");

    const res = await fetch(url.toString(), { headers });
    const texto = await res.text();
    let dados: any;
    try {
      dados = JSON.parse(texto);
    } catch {
      if (res.status === 429 || /retry later/i.test(texto)) {
        return json({
          error: "O CardápioWeb limitou as consultas por minuto (máximo de 5 consultas de histórico). Espere um minuto e tente de novo.",
        }, 429, cors);
      }
      return json({ error: `Resposta inesperada do CardápioWeb: ${texto.slice(0, 200)}` }, 502, cors);
    }
    if (!res.ok) return json({ error: `Erro no CardápioWeb: ${JSON.stringify(dados).slice(0, 300)}` }, 502, cors);

    pedidos.push(...(dados.orders || []));
    totalPaginas = dados.pagination?.total_pages ?? 1;
    pagina++;
  } while (pagina <= totalPaginas && pagina <= MAX_PAGINAS);

  // Balde por hora. Só pedidos fechados entram: cancelado não é venda.
  const balde = new Map<number, { pedidos: number; valor: number }>();
  for (let h = 0; h < 24; h++) balde.set(h, { pedidos: 0, valor: 0 });

  for (const p of pedidos) {
    const h = horaBrasilia(p.created_at);
    if (h === null) continue;
    const b = balde.get(h)!;
    b.pedidos += 1;
    b.valor += Number(p.total ?? 0) || 0;
  }

  const linhas = [...balde.entries()].map(([hora, b]) => ({
    dia, hora, pedidos: b.pedidos, valor: Math.round(b.valor * 100) / 100,
  }));

  const { error } = await admin.from("meta_vendas_hora").upsert(linhas, { onConflict: "dia,hora" });
  if (error) return json({ error: `Erro ao gravar a curva: ${error.message}` }, 500, cors);

  return json({
    ok: true, dia,
    pedidos: pedidos.length,
    valor: linhas.reduce((s, l) => s + l.valor, 0),
  }, 200, cors);
}

// ---------------------------------------------------------------------
// Meta API
// ---------------------------------------------------------------------
async function insights(token: string, contaId: string, p: Record<string, string>) {
  const url = new URL(`${API}/${contaId}/insights`);
  url.searchParams.set("fields", p.fields);
  url.searchParams.set("level", p.level);
  url.searchParams.set("time_range", JSON.stringify({ since: p.since, until: p.until }));
  if (p.time_increment) url.searchParams.set("time_increment", p.time_increment);
  if (p.breakdowns) url.searchParams.set("breakdowns", p.breakdowns);
  url.searchParams.set("limit", "500");
  return await metaGetPaginado(url, token);
}

async function metaGet(url: URL, token: string) {
  // Token no cabeçalho, não na query: assim ele não aparece em log de
  // acesso nem em URL guardada em lugar nenhum.
  const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  const texto = await res.text();
  let dados: any;
  try { dados = JSON.parse(texto); }
  catch { throw new Error(`Resposta inesperada da Meta: ${texto.slice(0, 300)}`); }

  if (!res.ok || dados.error) {
    const e = dados.error ?? {};
    // A mensagem crua da Meta é útil, mas os códigos mais comuns merecem
    // tradução — senão a tela mostra "(#100)" e ninguém sabe o que fazer.
    if (e.code === 190) throw new Error("Token da Meta inválido ou expirado. Gere um novo token de usuário do sistema e atualize o secret META_ACCESS_TOKEN.");
    if (e.code === 200 || e.code === 10) throw new Error(`Falta permissão para isso (Meta ${e.code}: ${e.message ?? "sem detalhe"}).`);
    if (e.code === 17 || e.code === 613) throw new Error("A Meta limitou a quantidade de consultas por enquanto. Espere alguns minutos e sincronize de novo.");
    if (e.code === 803) throw new Error(`Conta de anúncios não encontrada. Confira o META_AD_ACCOUNT_ID (formato act_123456789).`);
    throw new Error(`Meta (${e.code ?? res.status}): ${e.message ?? texto.slice(0, 200)}`);
  }
  return dados;
}

async function metaGetPaginado(url: URL, token: string) {
  const tudo: any[] = [];
  let proxima: string | null = url.toString();
  let pagina = 0;
  while (proxima && pagina < MAX_PAGINAS) {
    const dados = await metaGet(new URL(proxima), token);
    tudo.push(...(dados.data ?? []));
    proxima = dados.paging?.next ?? null;
    pagina++;
  }
  return tudo;
}

async function metaPost(url: string, token: string, corpo: Record<string, unknown>) {
  // Token no cabeçalho, nunca na URL nem no corpo.
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const texto = await res.text();
  let dados: any;
  try { dados = JSON.parse(texto); }
  catch { throw new Error(`Resposta inesperada da Meta: ${texto.slice(0, 300)}`); }
  if (!res.ok || dados.error) {
    const e = dados.error ?? {};
    // A Meta costuma mandar uma explicação para gente em error_user_msg;
    // ela vale mais que a mensagem técnica.
    const titulo = e.error_user_title ? `${e.error_user_title}: ` : "";
    const msg = e.error_user_msg || e.message || texto.slice(0, 200);
    const cod = `código ${e.code ?? res.status}${e.error_subcode ? "/" + e.error_subcode : ""}`;
    throw new Error(`${titulo}${msg} (${cod})`);
  }
  return dados;
}

// Soma o valor do action_type escolhido. Se ele não aparecer, é zero —
// e zero aqui costuma significar que a campanha tem outro objetivo, não
// que ela não funcionou. A tela avisa isso.
function resultadoDe(acoes: any[] | undefined, tipo: string) {
  if (!Array.isArray(acoes)) return 0;
  let total = 0;
  for (const a of acoes) if (a?.action_type === tipo) total += Number(a.value ?? 0) || 0;
  return Math.round(total * 100) / 100;
}

// A Meta manda a hora como "13:00:00 - 13:59:59".
function horaDaFaixa(faixa: string | undefined) {
  if (!faixa) return null;
  const m = /^(\d{2})/.exec(faixa);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------
// Gravação
// ---------------------------------------------------------------------
async function gravar(admin: any, tabela: string, linhas: any[], chave: string) {
  if (!linhas.length) return 0;
  const LOTE = 500;
  for (let i = 0; i < linhas.length; i += LOTE) {
    const { error } = await admin.from(tabela)
      .upsert(linhas.slice(i, i + LOTE), { onConflict: chave });
    if (error) throw new Error(`Erro ao gravar em ${tabela}: ${error.message}`);
  }
  return linhas.length;
}

// ---------------------------------------------------------------------
// Datas — sempre em horário de Brasília, nunca no UTC do servidor.
// ---------------------------------------------------------------------
function hojeNoFuso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

function somaDias(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function primeiroDiaDoMes(iso: string) {
  return iso.slice(0, 8) + "01";
}

function horaBrasilia(valor: string | undefined) {
  if (!valor) return null;
  const d = new Date(valor);
  if (isNaN(d.getTime())) return null;
  const h = new Intl.DateTimeFormat("en-GB", {
    timeZone: FUSO, hour: "2-digit", hour12: false,
  }).format(d);
  const n = Number(h);
  return Number.isFinite(n) ? (n === 24 ? 0 : n) : null;
}

function num(v: any) { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function int(v: any) { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; }

function json(body: unknown, status: number, extra: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", ...extra },
  });
}
