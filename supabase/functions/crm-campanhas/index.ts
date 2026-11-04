// Edge Function: crm-campanhas
//
// Campanhas de WhatsApp do Mr. Kong. Duas portas:
//
//   POST com cabeçalho x-cron-segredo  → o robô do banco (a cada minuto):
//        confere na Meta os modelos que estão esperando aprovação e manda
//        as próximas mensagens da fila (migração 123 decide quantas e quais).
//
//   POST do painel (com o login da pessoa):
//        "escrever"       o agente escreve o texto da campanha para o segmento
//        "enviar_modelo"  manda o texto para a Meta aprovar (é obrigatório:
//                         promoção só sai com modelo aprovado)
//        "status_modelo"  pergunta à Meta se o modelo já foi aprovado
//        "teste"          manda a mensagem aprovada para um número só (o seu)
//
// Configuração no Supabase: "Verify JWT" DESLIGADO (o robô do banco não tem
// login). A segurança vem do segredo do robô e, no painel, do login
// conferido aqui dentro.
//
// Segredos (os mesmos do whatsapp-agente): WHATSAPP_TOKEN,
// WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_WABA_ID, ANTHROPIC_API_KEY.

import { createClient } from "npm:@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v23.0";
const MODELO_IA = "claude-haiku-4-5-20251001";
const IDIOMA = "pt_BR";
const TEXTO_SAIR = "Não quero mais promoções"; // botão de resposta rápida (máx. 25 letras)

const env = (k: string) => Deno.env.get(k) ?? "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (dados: unknown, status = 200) =>
  new Response(JSON.stringify(dados), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const segredo = req.headers.get("x-cron-segredo");
    if (segredo) return await robo(segredo);
    return await painel(req);
  } catch (e) {
    console.error("crm-campanhas", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

// ===========================================================================
// Texto da campanha → modelo da Meta
//
// No painel o texto usa {nome} e {favorito}. A Meta quer {{1}}, {{2}}...
// na ordem em que aparecem.
// ===========================================================================
const VARIAVEIS = ["nome", "favorito"] as const;

function paraModelo(texto: string) {
  const ordem: string[] = [];
  const corpo = texto.replace(/\{(nome|favorito)\}/g, (_, v) => {
    if (!ordem.includes(v)) ordem.push(v);
    return `{{${ordem.indexOf(v) + 1}}}`;
  });
  return { corpo, ordem };
}

function valorVariavel(v: string, cli: { nome?: string | null; favorito?: string | null }) {
  if (v === "nome") {
    const primeiro = String(cli.nome ?? "").trim().split(/\s+/)[0] ?? "";
    return primeiro ? primeiro[0].toUpperCase() + primeiro.slice(1).toLowerCase() : "tudo bem";
  }
  if (v === "favorito") return String(cli.favorito ?? "").trim() || "seu lanche preferido";
  return "";
}

function problemasDoTexto(texto: string): string | null {
  const t = texto.trim();
  if (t.length < 20) return "O texto está curto demais.";
  if (t.length > 900) return "O texto passou de 900 letras. Encurte.";
  if (/^\{(nome|favorito)\}/.test(t) || /\{(nome|favorito)\}[.!?]*$/.test(t)) {
    return "A Meta não aceita texto que começa ou termina com {nome} ou {favorito}. Coloque alguma palavra antes/depois.";
  }
  const soltas = t.match(/\{[^}]*\}/g)?.filter((x) => !VARIAVEIS.some((v) => x === `{${v}}`));
  if (soltas?.length) return `Só existem {nome} e {favorito}. Tire: ${soltas.join(", ")}`;
  return null;
}

// ===========================================================================
// Meta
// ===========================================================================
// Campanha sai SEMPRE pela linha oficial, os segredos do Supabase. A linha do
// balcão (wa_conexao, migração 184) é para atendimento: promoção por ela
// misturaria o número do dia a dia com disparo, e nem os modelos valem lá.
function contaOficial() {
  return { token: env("WHATSAPP_TOKEN"), phone: env("WHATSAPP_PHONE_NUMBER_ID"), waba: env("WHATSAPP_WABA_ID") };
}

async function meta(caminho: string, init: RequestInit = {}) {
  const conta = contaOficial();
  caminho = caminho.replace("{WABA}", conta.waba).replace("{PHONE}", conta.phone);
  const r = await fetch(`${GRAPH}${caminho}`, {
    ...init,
    headers: { Authorization: `Bearer ${conta.token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = corpo?.error;
    const erro = new Error(e ? `${e.code}: ${e.error_user_msg || e.error_user_title || e.message}` : `Meta respondeu ${r.status}`);
    (erro as Error & { codigo?: number }).codigo = e?.code;
    throw erro;
  }
  return corpo;
}

function statusDaMeta(s: string | undefined) {
  const x = String(s ?? "").toUpperCase();
  if (x === "APPROVED") return "aprovado";
  if (x === "REJECTED" || x === "DISABLED" || x === "PAUSED") return "rejeitado";
  return "pendente";
}

// deno-lint-ignore no-explicit-any
async function atualizarModelo(c: any) {
  if (!c.modelo_nome) return c;
  const r = await meta(`/{WABA}/message_templates?name=${encodeURIComponent(c.modelo_nome)}&fields=name,status,rejected_reason`);
  // deno-lint-ignore no-explicit-any
  const m = (r?.data ?? []).find((x: any) => x.name === c.modelo_nome);
  if (!m) return c;
  const novo = statusDaMeta(m.status);
  const motivo = novo === "rejeitado" ? (m.rejected_reason && m.rejected_reason !== "NONE" ? m.rejected_reason : m.status) : null;
  if (novo !== c.modelo_status || motivo !== c.modelo_motivo) {
    await admin.from("crm_campanhas").update({ modelo_status: novo, modelo_motivo: motivo }).eq("id", c.id);
  }
  return { ...c, modelo_status: novo, modelo_motivo: motivo };
}

// Celular brasileiro: tenta como está e, se a Meta recusar o destinatário,
// tenta sem o 9 (mesma regra do whatsapp-agente).
function formatosDoNumero(para: string): string[] {
  const d = String(para || "").replace(/\D/g, "");
  if (/^55\d{2}9\d{8}$/.test(d)) return [d, d.slice(0, 4) + d.slice(5)];
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) return [d, d.slice(0, 4) + "9" + d.slice(4)];
  return [d];
}

async function enviarModelo(
  para: string, modeloNome: string, texto: string, cli: { nome?: string | null; favorito?: string | null },
): Promise<{ id?: string; wa_id?: string }> {
  const { ordem } = paraModelo(texto);
  // deno-lint-ignore no-explicit-any
  const componentes: any[] = ordem.length
    ? [{ type: "body", parameters: ordem.map((v) => ({ type: "text", text: valorVariavel(v, cli) })) }]
    : [];
  let ultimo: unknown = null;
  for (const numero of formatosDoNumero(para)) {
    try {
      const r = await meta(`/{PHONE}/messages`, {
        method: "POST",
        body: JSON.stringify({
          messaging_product: "whatsapp", to: numero, type: "template",
          template: { name: modeloNome, language: { code: IDIOMA }, components: componentes },
        }),
      });
      return {
        id: r?.messages?.[0]?.id as string | undefined,
        wa_id: r?.contacts?.[0]?.wa_id as string | undefined,
      };
    } catch (e) {
      ultimo = e;
      const codigo = (e as Error & { codigo?: number })?.codigo;
      if (codigo !== 131030 && codigo !== 131026 && codigo !== 100) break;
    }
  }
  throw ultimo;
}

function textoFinal(texto: string, cli: { nome?: string | null; favorito?: string | null }) {
  return texto.replace(/\{(nome|favorito)\}/g, (_, v) => valorVariavel(v, cli));
}

// Guarda a mensagem da campanha na conversa do cliente: assim a atendente vê
// o que foi mandado e o agente sabe do que o cliente está falando se ele
// responder a promoção.
async function gravarNaConversa(telefone: string, nome: string | null, texto: string, waMsgId?: string) {
  // A conversa é a da linha oficial, mesmo que o cliente também fale no balcão.
  const { data: linha } = await admin.from("wa_linhas").select("id").eq("tipo", "oficial").maybeSingle();
  if (!linha) return;
  const naLinha = () => admin.from("wa_conversas").select("id").eq("telefone", telefone).eq("linha_id", linha.id).maybeSingle();
  let { data: conversa } = await naLinha();
  if (!conversa) {
    const { data: cli } = await admin.from("clientes").select("id").eq("telefone", telefone).maybeSingle();
    const { data: nova } = await admin.from("wa_conversas")
      .insert({ telefone, wa_id: telefone, nome, cliente_id: cli?.id ?? null, linha_id: linha.id })
      .select("id").maybeSingle();
    conversa = nova ?? (await naLinha()).data;
  }
  if (!conversa) return;
  await admin.from("wa_mensagens").insert({
    conversa_id: conversa.id, linha_id: linha.id, wa_msg_id: waMsgId ?? null, direcao: "saida", autor: "sistema",
    tipo: "campanha", texto, status: "sent",
  });
  await admin.from("wa_conversas").update({ ultima_msg_em: new Date().toISOString(), ultima_previa: texto.slice(0, 140) })
    .eq("id", conversa.id);
}

// ===========================================================================
// O robô (chamado pelo banco a cada minuto)
// ===========================================================================
async function robo(segredo: string) {
  const { data: s } = await admin.from("crm_segredos").select("cron").eq("id", 1).single();
  if (!s?.cron || s.cron !== segredo) return json({ error: "segredo inválido" }, 401);

  // 1) modelos esperando a Meta
  const { data: pendentes } = await admin.from("crm_campanhas").select("*").eq("modelo_status", "pendente").limit(10);
  for (const c of pendentes ?? []) {
    try { await atualizarModelo(c); } catch (e) { console.error("status do modelo", c.id, e); }
  }

  // 2) fila de envio
  const { data: fila, error } = await admin.rpc("crm_campanha_fila");
  if (error) { console.error("fila", error); return json({ error: error.message }, 500); }

  let enviados = 0;
  for (const item of fila ?? []) {
    // o cliente pode ter mandado SAIR depois do agendamento
    if (!item.aceita) {
      await admin.from("crm_campanha_envios").update({ status: "pulado", erro: "cliente não aceita mais mensagens" })
        .eq("id", item.envio_id);
      continue;
    }
    try {
      const waMsgId = (await enviarModelo(item.telefone, item.modelo_nome, item.texto, item)).id;
      await admin.from("crm_campanha_envios").update({
        status: "enviado", wa_msg_id: waMsgId ?? null, enviado_em: new Date().toISOString(), erro: null,
      }).eq("id", item.envio_id);
      await gravarNaConversa(item.telefone, item.nome, textoFinal(item.texto, item), waMsgId);
      enviados++;
    } catch (e) {
      await admin.from("crm_campanha_envios").update({
        status: "falhou", erro: String((e as Error)?.message || e).slice(0, 300), enviado_em: new Date().toISOString(),
      }).eq("id", item.envio_id);
    }
    // espalha dentro do minuto: não sai tudo no mesmo segundo
    await new Promise((r) => setTimeout(r, 8000 + Math.random() * 7000));
  }

  await admin.rpc("crm_campanha_fechar");
  return json({ ok: true, enviados, modelos_conferidos: pendentes?.length ?? 0 });
}

// ===========================================================================
// Ações do painel
// ===========================================================================
async function painel(req: Request) {
  const usuario = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } }, auth: { persistSession: false },
  });
  const { data: u } = await usuario.auth.getUser();
  if (!u?.user) return json({ error: "Faça login no painel." }, 401);
  const { data: pode } = await usuario.rpc("crm_pode_editar");
  if (pode !== true) return json({ error: "Seu cargo não pode mexer nas campanhas." }, 403);

  const corpo = await req.json().catch(() => ({}));

  if (corpo.acao === "escrever") return json(await escrever(corpo));

  const { data: c } = corpo.campanha_id
    ? await admin.from("crm_campanhas").select("*").eq("id", corpo.campanha_id).maybeSingle()
    : { data: null };

  if (corpo.acao === "enviar_modelo") {
    if (!c) return json({ error: "Campanha não encontrada." }, 404);
    if (c.status !== "rascunho") return json({ error: "Só dá para mandar para aprovação enquanto é rascunho." }, 409);
    const problema = problemasDoTexto(c.texto);
    if (problema) return json({ error: problema }, 400);

    const { data: cfg } = await admin.from("agente_config").select("link_cardapio").eq("id", 1).maybeSingle();
    const link = String(cfg?.link_cardapio ?? "").trim();
    const { corpo: texto, ordem } = paraModelo(c.texto);
    const exemplo = { nome: "Ana", favorito: "Orangotango" } as Record<string, string>;
    // Nome único a cada envio: se a Meta recusar, a pessoa corrige o texto e
    // manda de novo com outro nome (a Meta não deixa reaproveitar o nome).
    const nome = `kong_${String(c.id).replace(/-/g, "").slice(0, 8)}_${Date.now().toString(36)}`;

    // deno-lint-ignore no-explicit-any
    const componentes: any[] = [{
      type: "BODY", text: texto,
      ...(ordem.length ? { example: { body_text: [ordem.map((v) => exemplo[v])] } } : {}),
    }];
    // deno-lint-ignore no-explicit-any
    const botoes: any[] = [];
    if (c.botao_cardapio && /^https?:\/\//.test(link)) botoes.push({ type: "URL", text: "Ver cardápio", url: link });
    botoes.push({ type: "QUICK_REPLY", text: TEXTO_SAIR });
    componentes.push({ type: "BUTTONS", buttons: botoes });

    try {
      const r = await meta(`/{WABA}/message_templates`, {
        method: "POST",
        body: JSON.stringify({ name: nome, category: "MARKETING", language: IDIOMA, components: componentes }),
      });
      const status = statusDaMeta(r?.status);
      await admin.from("crm_campanhas").update({ modelo_nome: nome, modelo_status: status, modelo_motivo: null }).eq("id", c.id);
      return json({ ok: true, modelo_status: status });
    } catch (e) {
      return json({ error: `A Meta recusou o modelo: ${String((e as Error)?.message || e)}` }, 502);
    }
  }

  if (corpo.acao === "status_modelo") {
    if (!c) return json({ error: "Campanha não encontrada." }, 404);
    if (!c.modelo_nome) return json({ error: "Essa campanha ainda não foi mandada para aprovação." }, 400);
    try {
      const atual = await atualizarModelo(c);
      return json({ ok: true, modelo_status: atual.modelo_status, modelo_motivo: atual.modelo_motivo });
    } catch (e) {
      return json({ error: String((e as Error)?.message || e) }, 502);
    }
  }

  if (corpo.acao === "teste") {
    if (!c) return json({ error: "Campanha não encontrada." }, 404);
    if (c.modelo_status !== "aprovado") return json({ error: "O teste só funciona depois que a Meta aprovar a mensagem." }, 409);
    // aceita 64 99999-0000, 064 99999-0000, +55 64 ... e por aí vai
    const so = String(corpo.telefone ?? "").replace(/\D/g, "").replace(/^0+/, "");
    const semPais = so.startsWith("55") ? so.slice(2) : so;
    if (semPais.length !== 10 && semPais.length !== 11) {
      return json({ error: "Número estranho. Escreva com DDD e sem o zero, ex.: 64 99999-0000." }, 400);
    }
    const numero = `55${semPais}`;
    try {
      const env = await enviarModelo(numero, c.modelo_nome, c.texto, { nome: corpo.nome ?? "Teste", favorito: "Orangotango" });
      // Guarda o teste: o aviso de "entregue" ou "falhou" chega depois, pelo
      // webhook, e a tela mostra o resultado de verdade (migração 130).
      await admin.from("crm_campanhas").update({
        teste_msg_id: env.id ?? null,
        teste_para: numero,
        teste_wa_id: env.wa_id ?? null,
        teste_status: "enviado",
        teste_erro: null,
        teste_em: new Date().toISOString(),
      }).eq("id", c.id);
      return json({ ok: true, wa_id: env.wa_id ?? null, msg_id: env.id ?? null });
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      await admin.from("crm_campanhas").update({
        teste_msg_id: null, teste_para: numero, teste_wa_id: null,
        teste_status: "falhou", teste_erro: msg, teste_em: new Date().toISOString(),
      }).eq("id", c.id);
      return json({ error: `A Meta recusou: ${msg}` }, 502);
    }
  }

  return json({ error: "Ação desconhecida." }, 400);
}

// ===========================================================================
// O agente escreve a campanha
// ===========================================================================
const SOBRE_SEGMENTO: Record<string, string> = {
  novo: "clientes que fizeram só 1 pedido. Objetivo: trazer para o 2º pedido.",
  recorrente: "clientes que pedem com frequência. Objetivo: manter o hábito, lembrar do favorito.",
  vip: "os clientes que mais gastam. Objetivo: fazer se sentir especial, avisar antes das promoções.",
  em_risco: "clientes que não pedem há 3 a 8 semanas. Objetivo: trazer de volta antes de sumirem.",
  perdido: "clientes que não pedem há mais de 2 meses. Objetivo: reconquistar, com leveza.",
  cadastro: "pessoas cadastradas no cardápio digital que ainda não pediram recentemente.",
  aniversario_mes: "clientes que fazem aniversário este mês. Objetivo: parabenizar.",
};

// deno-lint-ignore no-explicit-any
async function escrever(corpo: any) {
  const segs: string[] = Array.isArray(corpo.segmentos) ? corpo.segmentos : [];
  const [{ data: cfg }, { data: saber }] = await Promise.all([
    admin.from("agente_config").select("tom").eq("id", 1).maybeSingle(),
    admin.from("agente_conhecimento").select("tema, conteudo").eq("ativo", true).order("ordem"),
  ]);
  const conhecimento = (saber ?? [])
    .filter((k: { conteudo: string }) => !/\[PREENCHER/i.test(k.conteudo))
    .map((k: { tema: string; conteudo: string }) => `### ${k.tema}\n${k.conteudo}`).join("\n\n");

  const system = `Você escreve mensagens de promoção de WhatsApp para o Mr. Kong, hamburgueria em Rio Verde (GO).
Jeito de falar: ${cfg?.tom ?? "descontraído, jovem, universo da selva sem exagero"}

Regras da mensagem:
- Português do Brasil, no máximo 3 frases curtas (até 350 letras).
- Use {nome} para o primeiro nome do cliente e, se fizer sentido, {favorito} para o lanche que ele mais pede. Nenhuma outra variável.
- NUNCA comece nem termine a mensagem com {nome} ou {favorito} (a Meta recusa). Ex.: "Oi, {nome}! ..." está certo.
- No máximo 1 emoji. Negrito do WhatsApp com *um asterisco*, se precisar.
- Só cite promoção, preço ou brinde que esteja em "O que o Mr. Kong oferece". Nunca invente desconto.
- Não peça para responder nem diga "clique no botão": a mensagem já vai com os botões "Ver cardápio" e "Não quero mais promoções".
- Responda SÓ com o texto da mensagem, sem aspas e sem explicação.

## O que o Mr. Kong oferece
${conhecimento || "(nada cadastrado)"}`;

  const pedido = `Público: ${segs.map((s) => SOBRE_SEGMENTO[s] ?? s).join(" / ") || "todos os clientes que aceitaram receber"}.
${corpo.ideia ? `Ideia de quem está montando: ${corpo.ideia}` : ""}
${corpo.texto_atual ? `Texto atual (melhore sem mudar a oferta): ${corpo.texto_atual}` : ""}`;

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env("ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODELO_IA, max_tokens: 400, system, messages: [{ role: "user", content: pedido }] }),
  });
  const d = await r.json();
  if (!r.ok) return { error: d?.error?.message ?? `IA respondeu ${r.status}` };
  // deno-lint-ignore no-explicit-any
  const texto = (d.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim()
    .replace(/^["“]|["”]$/g, "").replace(/\*\*(.+?)\*\*/g, "*$1*");
  return { texto, problema: problemasDoTexto(texto) };
}
