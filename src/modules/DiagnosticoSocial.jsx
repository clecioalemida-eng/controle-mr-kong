// Edge Function: apify-proxy
//
// Roda no servidor do Supabase — é a única peça do sistema que conhece o
// token da APIFY. O token fica no secret APIFY_API_TOKEN, nunca em código
// e nunca no navegador. Mesmo padrão do cardapioweb-proxy.
//
// Coleta perfis e posts do Instagram dos concorrentes (e do Mr. Kong) para
// montar um histórico próprio — o Instagram não guarda essa série pra
// ninguém, então cada semana coletada vale mais que a anterior.
//
// Ações (campo "acao" no corpo da requisição):
//
// - "iniciar_coleta": dispara o ator na APIFY e devolve na hora o id da
//   coleta. NÃO espera terminar: a coleta leva alguns minutos e a Edge
//   Function tem limite de tempo bem menor que isso.
//
// - "verificar_coleta": pergunta à APIFY se aquele run terminou. Se sim,
//   baixa o resultado, grava perfis e posts (deduplicados) e fecha a
//   coleta. A tela chama isso de tempos em tempos até terminar.
//
// - "finalizar_pendentes": mesma coisa, mas varre todas as coletas que
//   ficaram em aberto. É o que o agendador semanal usa, já que não existe
//   ninguém com a tela aberta pra ficar perguntando.
//
// Quem pode chamar: uma pessoa com perfil aprovado no painel, OU o
// agendador do Supabase — que chega com a service role key, conhecida só
// pelo servidor do projeto.
//
// Por que o ator "instagram-profile-scraper" e não o scraper genérico:
// ele devolve o perfil (seguidores, bio, foto) E os posts recentes numa
// única chamada, contando como 1 resultado por perfil. Para 5 concorrentes
// por semana, isso mantém o custo dentro do plano gratuito da APIFY.
//
// Sobre risco: os atores oficiais rodam DESLOGADOS, com IP da própria
// APIFY. Nenhuma conta de Instagram do Mr. Kong participa da coleta, e
// nenhum login ou cookie é fornecido — é o que separa "risco operacional"
// de "risco à conta comercial".

import { createClient } from "npm:@supabase/supabase-js@2";

const APIFY_BASE = "https://api.apify.com/v2";
const ATOR = "apify~instagram-profile-scraper";

// Quantos posts recentes guardar por perfil a cada coleta. O ator devolve
// os mais novos primeiro; uma hamburguearia publica ~4 por semana, então
// 12 cobre bem o intervalo entre coletas semanais.
const POSTS_POR_PERFIL = 12;

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

    // O agendador não é uma pessoa logada: ele se identifica pela service
    // role key, que só o próprio servidor do projeto conhece.
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    const ehAgendador =
      bearer.length > 0 && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    let usuarioId: string | null = null;

    if (!ehAgendador) {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData?.user) {
        return json({ error: "Não autenticado." }, 401, corsHeaders);
      }

      const { data: perfil } = await supabase
        .from("perfis")
        .select("status")
        .eq("id", userData.user.id)
        .maybeSingle();

      if (!perfil || perfil.status !== "aprovado") {
        return json({ error: "Usuário sem acesso liberado." }, 403, corsHeaders);
      }
      usuarioId = userData.user.id;
    }

    const token = Deno.env.get("APIFY_API_TOKEN");
    if (!token) {
      return json(
        { error: "APIFY_API_TOKEN não configurado nos secrets do projeto Supabase." },
        500, corsHeaders
      );
    }
    const headersApify = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    const body = await req.json().catch(() => ({}));
    const acao = body.acao ?? "iniciar_coleta";

    // -----------------------------------------------------------------------
    // AÇÃO: iniciar a coleta
    // -----------------------------------------------------------------------
    if (acao === "iniciar_coleta") {
      const { data: perfisAtivos, error: erroPerfis } = await supabase
        .from("perfis_sociais")
        .select("id, usuario")
        .eq("plataforma", "instagram")
        .eq("ativo", true);

      if (erroPerfis) {
        return json({ error: "Erro ao ler os perfis.", detalhe: erroPerfis.message }, 500, corsHeaders);
      }
      if (!perfisAtivos || perfisAtivos.length === 0) {
        return json(
          { error: "Nenhum perfil ativo cadastrado. Adicione ao menos um antes de coletar." },
          400, corsHeaders
        );
      }

      const usuarios = perfisAtivos.map((p: any) => String(p.usuario).replace(/^@/, "").trim());

      const resRun = await fetch(`${APIFY_BASE}/acts/${ATOR}/runs`, {
        method: "POST",
        headers: headersApify,
        body: JSON.stringify({
          usernames: usuarios,
          resultsLimit: POSTS_POR_PERFIL,
        }),
      });

      const dadosRun = await resRun.json().catch(() => ({}));
      if (!resRun.ok) {
        return json(
          {
            error: "A APIFY recusou o pedido de coleta.",
            detalhe: dadosRun?.error?.message ?? `HTTP ${resRun.status}`,
          },
          502, corsHeaders
        );
      }

      const runId = dadosRun?.data?.id;
      const datasetId = dadosRun?.data?.defaultDatasetId;

      const { data: coleta, error: erroColeta } = await supabase
        .from("coletas_sociais")
        .insert({
          status: "rodando",
          apify_run_id: runId,
          apify_dataset_id: datasetId,
          perfis_solicitados: usuarios.length,
          iniciada_por: usuarioId,
        })
        .select("id")
        .single();

      if (erroColeta) {
        return json({ error: "Coleta iniciada, mas não deu para registrar.", detalhe: erroColeta.message }, 500, corsHeaders);
      }

      return json(
        {
          coleta_id: coleta.id,
          apify_run_id: runId,
          perfis: usuarios.length,
          mensagem: "Coleta iniciada. Costuma levar de 1 a 3 minutos.",
        },
        200, corsHeaders
      );
    }

    // -----------------------------------------------------------------------
    // AÇÃO: verificar se terminou e, se sim, gravar
    // -----------------------------------------------------------------------
    if (acao === "verificar_coleta") {
      const coletaId = body.coleta_id;
      if (!coletaId) return json({ error: "Informe coleta_id." }, 400, corsHeaders);

      const { data: coleta, error: erroBusca } = await supabase
        .from("coletas_sociais")
        .select("*")
        .eq("id", coletaId)
        .maybeSingle();

      if (erroBusca || !coleta) {
        return json({ error: "Coleta não encontrada." }, 404, corsHeaders);
      }
      if (coleta.status !== "rodando") {
        return json({ status: coleta.status, coleta }, 200, corsHeaders);
      }

      const r = await finalizarColeta(supabase, headersApify, coleta);
      return json(r, 200, corsHeaders);
    }

    // -----------------------------------------------------------------------
    // AÇÃO: fechar tudo que ficou em aberto (usada pelo agendador semanal)
    // -----------------------------------------------------------------------
    if (acao === "finalizar_pendentes") {
      const { data: pendentes } = await supabase
        .from("coletas_sociais")
        .select("*")
        .eq("status", "rodando")
        .order("iniciada_em", { ascending: false })
        .limit(5);

      const resultados: any[] = [];
      for (const c of pendentes ?? []) {
        // Coleta parada há mais de uma hora não vai terminar mais. Marcar
        // como erro evita que ela fique sendo consultada pra sempre.
        const horas = (Date.now() - new Date(c.iniciada_em).getTime()) / 3600000;
        if (horas > 1) {
          await supabase.from("coletas_sociais").update({
            status: "erro",
            concluida_em: new Date().toISOString(),
            erro_mensagem: "A coleta passou de uma hora sem concluir e foi encerrada.",
          }).eq("id", c.id);
          resultados.push({ coleta_id: c.id, status: "erro", motivo: "tempo esgotado" });
          continue;
        }
        resultados.push({ coleta_id: c.id, ...(await finalizarColeta(supabase, headersApify, c)) });
      }

      return json({ pendentes: (pendentes ?? []).length, resultados }, 200, corsHeaders);
    }

    return json({ error: `Ação desconhecida: ${acao}` }, 400, corsHeaders);
  } catch (e) {
    return json({ error: String(e) }, 500, corsHeaders);
  }
});


// ---------------------------------------------------------------------------
// Fecha uma coleta: pergunta à APIFY se terminou e, se sim, grava tudo.
// Usada tanto pela tela (verificar_coleta) quanto pelo agendador
// (finalizar_pendentes) — a lógica é a mesma, só muda quem pergunta.
// ---------------------------------------------------------------------------
async function finalizarColeta(supabase: any, headersApify: Record<string, string>, coleta: any) {
  const resRun = await fetch(`${APIFY_BASE}/actor-runs/${coleta.apify_run_id}`, {
    headers: headersApify,
  });
  const dadosRun = await resRun.json().catch(() => ({}));
  const statusApify = dadosRun?.data?.status;

  if (statusApify === "RUNNING" || statusApify === "READY") {
    return { status: "rodando", apify: statusApify };
  }

  if (statusApify !== "SUCCEEDED") {
    await supabase.from("coletas_sociais").update({
      status: "erro",
      concluida_em: new Date().toISOString(),
      erro_mensagem: `A APIFY terminou com status ${statusApify ?? "desconhecido"}.`,
    }).eq("id", coleta.id);
    return { status: "erro", apify: statusApify };
  }

  // --- Terminou bem: baixa o resultado ---------------------------------
  const datasetId = dadosRun?.data?.defaultDatasetId ?? coleta.apify_dataset_id;
  const resItens = await fetch(
    `${APIFY_BASE}/datasets/${datasetId}/items?clean=true&format=json`,
    { headers: headersApify }
  );
  const itens = await resItens.json().catch(() => []);

  if (!Array.isArray(itens)) {
    await supabase.from("coletas_sociais").update({
      status: "erro",
      concluida_em: new Date().toISOString(),
      erro_mensagem: "A APIFY devolveu um resultado em formato inesperado.",
    }).eq("id", coleta.id);
    return { status: "erro", detalhe: "resultado inesperado" };
  }

  const { data: perfisCadastrados } = await supabase
    .from("perfis_sociais")
    .select("id, usuario");

  const porUsuario = new Map<string, string>();
  for (const p of perfisCadastrados ?? []) {
    porUsuario.set(String(p.usuario).replace(/^@/, "").toLowerCase(), p.id);
  }

  let perfisColetados = 0;
  let postsNovos = 0;
  let postsAtualizados = 0;

  for (const item of itens) {
    const usuario = String(item?.username ?? "").replace(/^@/, "").toLowerCase();
    const perfilId = porUsuario.get(usuario);
    if (!perfilId) continue;

    // Snapshot do perfil
    await supabase.from("perfil_snapshots").insert({
      perfil_id: perfilId,
      seguidores: numero(item?.followersCount),
      seguindo: numero(item?.followsCount),
      total_posts: numero(item?.postsCount),
      nome_exibicao: item?.fullName ?? null,
      bio: item?.biography ?? null,
      foto_url: item?.profilePicUrlHD ?? item?.profilePicUrl ?? null,
      verificado: item?.verified ?? null,
      // Guarda o cru só do perfil, sem os posts, pra não inflar a tabela.
      bruto: semPosts(item),
    });
    perfisColetados++;

    // Posts
    const posts = Array.isArray(item?.latestPosts) ? item.latestPosts : [];
    for (const post of posts) {
      const idExterno = String(post?.id ?? post?.shortCode ?? "").trim();
      if (!idExterno) continue;

      const linha = {
        perfil_id: perfilId,
        post_id_externo: idExterno,
        tipo: classificarTipo(post),
        legenda: post?.caption ?? null,
        url: post?.url ?? (post?.shortCode ? `https://www.instagram.com/p/${post.shortCode}/` : null),
        publicado_em: post?.timestamp ?? null,
        curtidas: numero(post?.likesCount),
        comentarios: numero(post?.commentsCount),
        visualizacoes: numero(post?.videoViewCount ?? post?.videoPlayCount),
        atualizado_em: new Date().toISOString(),
      };

      // A chave única (perfil_id, post_id_externo) faz o trabalho:
      // post já visto é atualizado, não duplicado. É isso que impede
      // de pagar e gravar o mesmo conteúdo toda semana.
      const { data: existente } = await supabase
        .from("posts_sociais")
        .select("id")
        .eq("perfil_id", perfilId)
        .eq("post_id_externo", idExterno)
        .maybeSingle();

      if (existente) {
        await supabase.from("posts_sociais").update(linha).eq("id", existente.id);
        postsAtualizados++;
      } else {
        await supabase.from("posts_sociais").insert(linha);
        postsNovos++;
      }
    }
  }

  const custo = dadosRun?.data?.usageTotalUsd ?? null;

  await supabase.from("coletas_sociais").update({
    status: "concluida",
    concluida_em: new Date().toISOString(),
    perfis_coletados: perfisColetados,
    posts_novos: postsNovos,
    posts_atualizados: postsAtualizados,
    custo_usd: custo,
  }).eq("id", coleta.id);

  return {
    status: "concluida",
    perfis_coletados: perfisColetados,
    posts_novos: postsNovos,
    posts_atualizados: postsAtualizados,
    custo_usd: custo,
    perfis_ignorados: itens.length - perfisColetados,
  };
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

// O ator marca Reels de formas diferentes conforme a versão. Testamos os
// sinais conhecidos, do mais específico pro mais genérico.
function classificarTipo(post: any): string {
  const tipo = String(post?.type ?? "").toLowerCase();
  const produto = String(post?.productType ?? "").toLowerCase();
  if (produto === "clips" || post?.isReel === true) return "reels";
  if (tipo === "sidecar" || tipo === "carousel") return "carrossel";
  if (tipo === "video") return "video";
  if (tipo === "image" || tipo === "photo") return "foto";
  return tipo || "outro";
}

function numero(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function semPosts(item: any) {
  const copia = { ...item };
  delete copia.latestPosts;
  delete copia.topPosts;
  return copia;
}

function json(body: unknown, status: number, extraHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
