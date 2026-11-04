// Edge Function: whatsapp-agente
//
// O atendente virtual do Mr. Kong no WhatsApp. Uma função só, com três portas:
//
//   GET  (da Meta)    → confirma a ligação do webhook (hub.challenge)
//   POST (da Meta)    → chega mensagem do cliente. Vem assinada pela Meta
//                       (cabeçalho x-hub-signature-256); a função confere a
//                       assinatura antes de qualquer coisa.
//   POST (do painel)  → ações da tela, com o login da pessoa:
//                       "enviar"      a atendente responde um cliente
//                       "testar"      conversa de teste, não sai nada no WhatsApp
//                       "diagnostico" confere a ligação com a Meta
//                       "registrar"   registra o número na Meta (PIN)
//   POST (do banco)   → cabeçalho x-cron-segredo, a cada 5 min: pergunta a
//                       nota do pedido para quem está com a janela de 24h
//                       aberta e teve pedido fechado no CardápioWeb.
//
// Configuração no Supabase: "Verify JWT" DESLIGADO (a Meta não manda login).
// A segurança vem da assinatura da Meta e, no painel, do login conferido aqui.
//
// Segredos: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_WABA_ID,
// WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN, ANTHROPIC_API_KEY.
//
// Custo: responder quem mandou mensagem (janela de 24h) é grátis na Meta.
// Esta função nunca manda mensagem para quem não escreveu antes.

import { createClient } from "npm:@supabase/supabase-js@2";

const GRAPH = "https://graph.facebook.com/v23.0";
const MODELO_PADRAO = "claude-haiku-4-5-20251001";
const ESPERA_AGRUPAR_MS = 1500; // cliente que manda 3 mensagens seguidas recebe 1 resposta
const JANELA_24H_MS = 24 * 60 * 60 * 1000;

const env = (k: string) => Deno.env.get(k) ?? "";
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false },
});

// Duas linhas (migração 184):
//   oficial  (64) 9246-8524, só na API. Credenciais nos segredos do Supabase.
//   balcão   (64) 99266-7645, em coexistência: app no celular, ligações no
//            celular. Credenciais em wa_conexao, gravadas ao conectar.
// Cada mensagem é tratada na linha em que entrou, e a resposta sai por ela.
type ContaWa = { token: string; phone: string; waba: string; linhaId: string; tipo: string };
let contasCache: { v: ContaWa[]; em: number } | null = null;
async function contas(): Promise<ContaWa[]> {
  if (contasCache && Date.now() - contasCache.em < 60_000) return contasCache.v;
  const [{ data: linhas }, { data: cx }] = await Promise.all([
    admin.from("wa_linhas").select("id, tipo"),
    admin.from("wa_conexao").select("ativo, token, phone_number_id, waba_id").eq("id", 1).maybeSingle(),
  ]);
  const v: ContaWa[] = [];
  const oficial = (linhas ?? []).find((l) => l.tipo === "oficial");
  if (oficial) {
    v.push({ token: env("WHATSAPP_TOKEN"), phone: env("WHATSAPP_PHONE_NUMBER_ID"), waba: env("WHATSAPP_WABA_ID"), linhaId: oficial.id, tipo: "oficial" });
  }
  const balcao = (linhas ?? []).find((l) => l.tipo === "coexistencia");
  if (balcao && cx?.ativo && cx.token && cx.phone_number_id) {
    v.push({ token: cx.token, phone: cx.phone_number_id, waba: cx.waba_id ?? "", linhaId: balcao.id, tipo: "coexistencia" });
  }
  contasCache = { v, em: Date.now() };
  return v;
}
async function contaOficial(): Promise<ContaWa> {
  const c = (await contas()).find((x) => x.tipo === "oficial");
  if (!c) throw new Error("Linha oficial não encontrada. Rodou a migração 184?");
  return c;
}
// Conversa de linha desconectada não tem por onde responder: dá erro, e não
// sai pelo outro número, onde o cliente nem saberia quem é.
async function contaDaLinha(linhaId: string): Promise<ContaWa> {
  const c = (await contas()).find((x) => x.linhaId === linhaId);
  if (!c) throw new Error("O número desta conversa não está conectado.");
  return c;
}
async function agenteLigadoNaLinha(linhaId: string) {
  const { data } = await admin.from("wa_linhas").select("agente_ligado").eq("id", linhaId).maybeSingle();
  return data?.agente_ligado !== false;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (dados: unknown, status = 200) =>
  new Response(JSON.stringify(dados), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (req.method === "GET") return verificarWebhook(new URL(req.url));
    const bruto = await req.text();
    const assinatura = req.headers.get("x-hub-signature-256");
    if (assinatura) return await receberDaMeta(bruto, assinatura);
    const segredoRobo = req.headers.get("x-cron-segredo");
    if (segredoRobo) return await roboAvaliacoes(segredoRobo);
    return await acaoDoPainel(req, bruto);
  } catch (e) {
    console.error("erro geral", e);
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});

// ===========================================================================
// 1) Ligação com a Meta
// ===========================================================================
function verificarWebhook(url: URL) {
  const modo = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const desafio = url.searchParams.get("hub.challenge") ?? "";
  if (modo === "subscribe" && token && token === env("WHATSAPP_VERIFY_TOKEN")) {
    return new Response(desafio, { status: 200 });
  }
  return new Response("verificação recusada", { status: 403 });
}

async function assinaturaValida(bruto: string, assinatura: string) {
  const segredo = env("WHATSAPP_APP_SECRET");
  if (!segredo || !assinatura.startsWith("sha256=")) return false;
  const chave = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", chave, new TextEncoder().encode(bruto)));
  const esperado = Array.from(mac).map((b) => b.toString(16).padStart(2, "0")).join("");
  const recebido = assinatura.slice(7);
  if (esperado.length !== recebido.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  return dif === 0;
}

async function receberDaMeta(bruto: string, assinatura: string) {
  if (!(await assinaturaValida(bruto, assinatura))) {
    console.error("assinatura inválida — conferir WHATSAPP_APP_SECRET");
    return new Response("assinatura inválida", { status: 401 });
  }
  const payload = JSON.parse(bruto);
  // A Meta quer resposta rápida (senão manda de novo). O trabalho continua
  // depois do "ok", em segundo plano.
  const tarefa = processarPayload(payload).catch((e) => console.error("processarPayload", e));
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(tarefa);
  else await tarefa;
  return new Response("ok", { status: 200 });
}

// deno-lint-ignore no-explicit-any
async function processarPayload(payload: any) {
  const lista = await contas();
  for (const entrada of payload?.entry ?? []) {
    for (const mudanca of entrada?.changes ?? []) {
      const v = mudanca?.value ?? {};
      // O histórico do celular não é pedido nem importado: traria conversas
      // pessoais e de fornecedores para o painel.
      if (mudanca?.field === "history") continue;
      // O app pode estar ligado a mais números: só trabalha os das linhas.
      const conta = lista.find((c) => c.phone === v.metadata?.phone_number_id);
      if (!conta) continue;
      if (mudanca?.field === "smb_message_echoes") { await receberEcoDoApp(v, conta); continue; }
      if (mudanca?.field === "smb_app_state_sync") { await receberContatos(v, conta); continue; }
      if (mudanca?.field !== "messages") continue;
      for (const st of v.statuses ?? []) await atualizarStatus(st);
      for (const msg of v.messages ?? []) await processarMensagem(msg, v.contacts ?? [], conta);
    }
  }
}

// ---------------------------------------------------------------------------
// Coexistência: o que acontece no app WhatsApp Business do celular do Kong
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
// Uma conversa por telefone em cada linha. Duas mensagens chegando juntas: a
// outra execução criou primeiro, o índice único barra esta, e ela relê.
async function conversaDoTelefone(waId: string, linhaId: string, nome?: string | null): Promise<any> {
  const telefone = normalizaTelefone(waId);
  let { data: conversa } = await admin.from("wa_conversas").select("*")
    .eq("telefone", telefone).eq("linha_id", linhaId).maybeSingle();
  if (!conversa) {
    const { data: cli } = await admin.from("clientes").select("id").eq("telefone", telefone).maybeSingle();
    const { data: nova, error } = await admin.from("wa_conversas")
      .insert({ telefone, wa_id: waId, nome: nome ?? null, cliente_id: cli?.id ?? null, linha_id: linhaId })
      .select("*").single();
    if (error) {
      ({ data: conversa } = await admin.from("wa_conversas").select("*")
        .eq("telefone", telefone).eq("linha_id", linhaId).single());
    } else conversa = nova;
  }
  return conversa;
}

// alguém respondeu pelo app do celular: grava no painel e o agente fica
// quieto nessa conversa (a pessoa assumiu)
// deno-lint-ignore no-explicit-any
async function receberEcoDoApp(v: any, conta: ContaWa) {
  for (const m of v.message_echoes ?? []) {
    if (!m?.to) continue;
    const conversa = await conversaDoTelefone(String(m.to), conta.linhaId);
    const { tipo, texto } = lerConteudo(m);
    const quando = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();
    const { data: gravada } = await admin.from("wa_mensagens").insert({
      conversa_id: conversa.id, linha_id: conta.linhaId, wa_msg_id: m.id ?? null, direcao: "saida", autor: "atendente",
      tipo, texto, status: "sent", origem: "app", criado_em: quando,
    }).select("id").maybeSingle();
    if (!gravada) continue; // já estava gravada
    await admin.from("wa_conversas").update({
      status: "atendente", assumida_em: conversa.status === "atendente" ? conversa.assumida_em : quando,
      ultima_msg_em: quando, ultima_previa: texto.slice(0, 140), nao_lidas: 0,
    }).eq("id", conversa.id);
  }
}

// contatos da agenda do app: só usa o nome para as conversas
// deno-lint-ignore no-explicit-any
async function receberContatos(v: any, conta: ContaWa) {
  let n = 0;
  for (const s of v.state_sync ?? []) {
    const c = s?.contact;
    if (!c?.phone_number || s.action === "remove") continue;
    n++;
    const nome = c.full_name || c.first_name;
    if (!nome) continue;
    await admin.from("wa_conversas").update({ nome }).eq("telefone", normalizaTelefone(String(c.phone_number)))
      .eq("linha_id", conta.linhaId).is("cliente_id", null);
  }
  if (n) {
    const { data: atual } = await admin.from("wa_conexao").select("contatos").eq("id", 1).maybeSingle();
    await admin.from("wa_conexao").update({ contatos: (atual?.contatos ?? 0) + n, atualizado_em: new Date().toISOString() }).eq("id", 1);
  }
}

// deno-lint-ignore no-explicit-any
async function atualizarStatus(st: any) {
  if (!st?.id) return;
  const erro = st.errors?.[0] ? `${st.errors[0].code}: ${st.errors[0].title}` : null;
  await admin.from("wa_mensagens").update({ status: st.status, ...(erro ? { erro } : {}) }).eq("wa_msg_id", st.id);

  // mensagem de campanha (migração 123): entregue / lida / falhou
  const mapa: Record<string, string> = { delivered: "entregue", read: "lido", failed: "falhou" };
  const novo = mapa[st.status];
  if (novo) {
    let q = admin.from("crm_campanha_envios").update({ status: novo, ...(erro ? { erro } : {}) }).eq("wa_msg_id", st.id);
    if (novo === "entregue") q = q.neq("status", "lido"); // "lida" pode chegar antes de "entregue"
    await q;

    // teste de campanha (migração 130): o painel mostra entregue / falhou
    let t = admin.from("crm_campanhas")
      .update({ teste_status: novo, teste_erro: erro })
      .eq("teste_msg_id", st.id);
    if (novo === "entregue") t = t.neq("teste_status", "lido");
    await t;
  }
}

// ===========================================================================
// 2) Mensagem do cliente
// ===========================================================================

// O WhatsApp manda celular brasileiro às vezes sem o 9 (556492468524).
// Para achar o cliente, o telefone precisa ficar igual ao da tabela clientes.
function normalizaTelefone(waId: string) {
  const d = String(waId || "").replace(/\D/g, "");
  if (d.startsWith("55") && d.length === 12 && /[6-9]/.test(d[4])) return d.slice(0, 4) + "9" + d.slice(4);
  return d;
}

// deno-lint-ignore no-explicit-any
function lerConteudo(msg: any): { tipo: string; texto: string } {
  switch (msg?.type) {
    case "text": return { tipo: "texto", texto: msg.text?.body ?? "" };
    case "button": return { tipo: "botao", texto: msg.button?.text ?? "" };
    case "interactive":
      return { tipo: "botao", texto: msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? "" };
    case "audio": return { tipo: "audio", texto: "[áudio]" };
    case "image": return { tipo: "imagem", texto: msg.image?.caption ? `[imagem] ${msg.image.caption}` : "[imagem]" };
    case "sticker": return { tipo: "figurinha", texto: "[figurinha]" };
    case "location": return { tipo: "localizacao", texto: "[localização]" };
    case "reaction": return { tipo: "reacao", texto: `[reação ${msg.reaction?.emoji ?? ""}]` };
    default: return { tipo: msg?.type ?? "outro", texto: `[${msg?.type ?? "mensagem"}]` };
  }
}

const PALAVRAS_SAIR = /^(sair|parar|pare|cancelar|stop|descadastrar|n[ãa]o quero mais promo[çc][õo]es)[.! ]*$/i;

// deno-lint-ignore no-explicit-any
async function processarMensagem(msg: any, contatos: any[], conta: ContaWa) {
  if (msg?.type === "reaction") return; // reação não pede resposta
  const waId = String(msg.from);
  const telefone = normalizaTelefone(waId);
  const nomePerfil = contatos.find((c) => c.wa_id === waId)?.profile?.name ?? null;
  const { tipo, texto } = lerConteudo(msg);
  const agora = new Date().toISOString();

  const conversa = await conversaDoTelefone(waId, conta.linhaId, nomePerfil);

  // grava a mensagem (se a Meta mandar de novo, o wa_msg_id repetido barra)
  const { data: gravada, error: erroMsg } = await admin.from("wa_mensagens")
    .insert({ conversa_id: conversa.id, linha_id: conta.linhaId, wa_msg_id: msg.id, direcao: "entrada", autor: "cliente", tipo, texto })
    .select("id").maybeSingle();
  if (erroMsg || !gravada) return;

  await admin.from("wa_conversas").update({
    wa_id: waId,
    nome: nomePerfil ?? conversa.nome,
    ultima_msg_em: agora,
    ultima_msg_cliente_em: agora,
    ultima_previa: texto.slice(0, 140),
    nao_lidas: (conversa.nao_lidas ?? 0) + 1,
  }).eq("id", conversa.id);

  marcarComoLida(msg.id, conta).catch(() => {});

  // respondeu a uma campanha dos últimos 3 dias? Campanha só sai pela oficial.
  if (conta.tipo === "oficial") {
    await admin.from("crm_campanha_envios").update({ respondeu_em: agora })
      .eq("telefone", telefone).is("respondeu_em", null).not("enviado_em", "is", null)
      .gte("enviado_em", new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString());
  }

  // Linha com o agente desligado: a mensagem fica para uma pessoa, inclusive
  // o "SAIR", que numa conversa de balcão pode ser só uma palavra solta.
  const agenteNaLinha = await agenteLigadoNaLinha(conta.linhaId);

  // "SAIR" é atendido na hora, sem IA
  if (agenteNaLinha && PALAVRAS_SAIR.test(texto.trim())) {
    await registrarConsentimento(conversa, "nao", nomePerfil);
    await enviarEGravar(conversa, waId,
      "Pronto, você não vai mais receber promoções por aqui. Se quiser pedir, é só chamar a qualquer hora!",
      "agente");
    return;
  }

  if (conversa.status === "atendente") return; // a atendente está cuidando

  const { data: cfg } = await admin.from("agente_config").select("*").eq("id", 1).single();
  if (!cfg?.ligado || !agenteNaLinha) {
    await passarParaAtendente(conversa, "outro", "Agente desligado no painel", texto);
    return;
  }

  // espera o cliente terminar de digitar; se chegou outra mensagem depois
  // desta, a resposta fica por conta da execução da última
  await new Promise((r) => setTimeout(r, ESPERA_AGRUPAR_MS));
  const { data: ultima } = await admin.from("wa_mensagens")
    .select("id").eq("conversa_id", conversa.id).eq("direcao", "entrada")
    .order("id", { ascending: false }).limit(1).single();
  if (ultima?.id !== gravada.id) return;

  // relê: a atendente pode ter assumido nesses segundos
  const { data: atual } = await admin.from("wa_conversas").select("*").eq("id", conversa.id).single();
  if (atual.status === "atendente") return;

  await responderComAgente(atual, cfg);
}

async function marcarComoLida(waMsgId: string, conta: ContaWa) {
  await fetch(`${GRAPH}/${conta.phone}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${conta.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: waMsgId }),
  });
}

// ===========================================================================
// 3) O agente
// ===========================================================================
const FERRAMENTAS = [
  {
    name: "passar_para_atendente",
    description:
      "Passa a conversa para a atendente humana do Mr. Kong. Use nas situações listadas nas regras. " +
      "Depois de usar, escreva uma mensagem curta dizendo ao cliente que a atendente já vai falar com ele.",
    input_schema: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          enum: ["reclamacao", "pedido_problema", "pediu_humano", "nao_sabe", "pedido_grande", "irritado", "status_pedido", "outro"],
        },
        resumo: { type: "string", description: "Uma frase para a atendente entender o caso sem ler tudo." },
      },
      required: ["motivo", "resumo"],
    },
  },
  {
    name: "registrar_consentimento",
    description:
      "Registra a resposta do cliente sobre receber promoções pelo WhatsApp. " +
      "Use 'perguntei' logo depois de fazer a pergunta; 'sim' ou 'nao' quando ele responder.",
    input_schema: {
      type: "object",
      properties: { resposta: { type: "string", enum: ["perguntei", "sim", "nao"] } },
      required: ["resposta"],
    },
  },
  {
    name: "registrar_aniversario",
    description:
      "Grava a data de aniversário que o cliente informou (ex.: 'faço dia 15/03', '15 de março'). " +
      "Use só quando o cliente disser a data. Depois agradeça e diga que no mês dele tem presente.",
    input_schema: {
      type: "object",
      properties: {
        dia: { type: "integer", minimum: 1, maximum: 31 },
        mes: { type: "integer", minimum: 1, maximum: 12 },
        ano: { type: "integer", description: "Só se o cliente disser o ano." },
      },
      required: ["dia", "mes"],
    },
  },
  {
    name: "registrar_avaliacao",
    description: "Registra a nota de 1 a 5 que o cliente deu para um pedido, com o comentário se houver.",
    input_schema: {
      type: "object",
      properties: {
        nota: { type: "integer", minimum: 1, maximum: 5 },
        comentario: { type: "string" },
      },
      required: ["nota"],
    },
  },
];

const DIAS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

function agoraEmRioVerde() {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const p = Object.fromEntries(partes.map((x) => [x.type, x.value]));
  const hora = Number(p.hour) % 24;
  const local = new Date(Date.UTC(+p.year, +p.month - 1, +p.day, hora, +p.minute));
  // dia operacional: até as 5h ainda conta como o dia anterior
  const operacional = new Date(local.getTime() - 5 * 3600 * 1000);
  return {
    texto: `${String(hora).padStart(2, "0")}:${p.minute} de ${p.day}/${p.month}/${p.year}`,
    diaSemanaHoje: DIAS[local.getUTCDay()],
    diaOperacional: DIAS[operacional.getUTCDay()],
    aberto: dentroDoTurno(hora, operacional.getUTCDay()) && !DIAS_FECHADO.includes(operacional.getUTCDay()),
    situacao: situacaoDaLoja(hora, local.getUTCDay(), operacional.getUTCDay()),
  };
}

// dias em que a loja não abre (0 = domingo, 1 = segunda...). A noite de
// domingo que vai até as 2h de segunda conta como domingo.
const DIAS_FECHADO = [1];

// A loja abre às 17h e fecha às 2h da manhã seguinte; no sábado vai até as 3h.
// A cozinha fecha meia hora antes.
const ABRE = 17;
const fechaDoDia = (diaOperacional: number) => (diaOperacional === 6 ? 3 : 2);
function dentroDoTurno(hora: number, diaOperacional: number) {
  return hora >= ABRE || hora < fechaDoDia(diaOperacional);
}

function situacaoDaLoja(hora: number, diaHoje: number, diaOperacional: number) {
  const noTurno = dentroDoTurno(hora, diaOperacional);
  if (noTurno && !DIAS_FECHADO.includes(diaOperacional)) {
    const fecha = fechaDoDia(diaOperacional);
    return `ABERTA agora (fecha às ${fecha}h; a cozinha para meia hora antes)`;
  }
  // procura o próximo dia que abre, a partir de hoje (se ainda não passou das 17h) ou de amanhã
  const comecaHoje = hora < ABRE ? 0 : 1;
  for (let i = comecaHoje; i <= 7; i++) {
    const d = (diaHoje + i) % 7;
    if (DIAS_FECHADO.includes(d)) continue;
    const quando = i === 0 ? "hoje" : i === 1 ? "amanhã" : `na ${DIAS[d]}`;
    const motivo = DIAS_FECHADO.includes(diaHoje) && hora >= 3
      ? `hoje é ${DIAS[diaHoje]} e a loja NÃO abre; `
      : "";
    return `FECHADA agora (${motivo}abre ${quando}, ${DIAS[d]}, às 17h)`;
  }
  return "FECHADA agora";
}

const brl = (v: number) => `R$ ${Number(v).toFixed(2).replace(".", ",")}`;

// deno-lint-ignore no-explicit-any
async function montarSistema(cfg: any, cliente: any, conversa: any) {
  const [{ data: saber }, { data: cardapio }] = await Promise.all([
    admin.from("agente_conhecimento").select("tema, conteudo").eq("ativo", true).order("ordem").order("tema"),
    admin.rpc("agente_cardapio"),
  ]);

  const regras = (cfg.regras_passagem ?? []).filter((r: { ligado: boolean }) => r.ligado)
    .map((r: { chave: string; texto: string }) => `  - ${r.texto} (motivo: ${r.chave})`).join("\n");
  const nunca = (cfg.nunca ?? []).map((n: string) => `  - ${n}`).join("\n");
  const conhecimento = (saber ?? [])
    .filter((k: { conteudo: string }) => !/\[PREENCHER/i.test(k.conteudo))
    .map((k: { tema: string; conteudo: string }) => `### ${k.tema}\n${k.conteudo}`).join("\n\n");
  const itens = (cardapio ?? [])
    .map((i: { nome: string; preco: number | null }) => `- ${i.nome}${i.preco != null ? `: ${brl(i.preco)}` : ""}`)
    .join("\n");
  const link = cfg.link_cardapio?.trim();

  const fixo = `Você é o atendente virtual do Mr. Kong, hamburgueria em Rio Verde (GO), respondendo no WhatsApp da loja.

## Jeito de falar
${cfg.tom}
Escreva em português do Brasil. Mensagens CURTAS: no máximo 3 linhas, como uma pessoa escreve no WhatsApp. Uma resposta por vez.
Se perguntarem o que tem no cardápio, NÃO liste tudo: cite no máximo 3 opções (as mais pedidas ou as que combinam com a pergunta) e mande o link do cardápio para ver o resto.
Não use títulos nem listas longas. Se for indicar lanches, cite no máximo 3, na mesma frase.
Para destacar uma palavra use *um asterisco só* (é o negrito do WhatsApp), nunca dois.

## Regras
- Fale só sobre o Mr. Kong. Se o assunto for outro, diga com simpatia que aqui é só o atendimento do Mr. Kong.
- Use apenas as informações abaixo. Nunca invente preço, prazo, bairro, forma de pagamento ou promoção. Se a informação não estiver aqui, use passar_para_atendente com motivo "nao_sabe".
- ${link ? `Pedidos são feitos pelo cardápio digital: ${link}. Mande o link quando o cliente quiser pedir. Você não anota pedido no chat.` : "O link do cardápio ainda não foi cadastrado. Quando o cliente quiser pedir, use passar_para_atendente com motivo \"nao_sabe\"."}
- Você nunca faz isto:
${nunca}
- Use passar_para_atendente nestes casos:
${regras}
- Sempre que disser um preço, diga na mesma mensagem como fechar o pedido: pelo cardápio digital (mande o link) ou, se ele preferir falar o pedido, a atendente lança para ele — nesse caso use passar_para_atendente com motivo "outro".
- Se o cliente disser a data do aniversário (por exemplo, respondendo a campanha de aniversário), use registrar_aniversario.
- Se o cliente der uma nota de 1 a 5 para um pedido (por exemplo, respondendo "que nota você dá pro pedido?"), use registrar_avaliacao.${cfg.link_google ? ` Depois, para QUALQUER nota, agradeça e mande o link de avaliação do Google, sem insistir: ${cfg.link_google}` : ""} Nota 1 ou 2: peça desculpas e passe para a atendente com motivo "reclamacao".
- Cartaz "Manda um OI": a loja tem um cartaz no balcão com QR code, e quem lê chega aqui dizendo que quer receber as promoções. Nesse caso NÃO espere o fim da conversa: agradeça, use registrar_consentimento com "sim" e diga na mesma mensagem o que ele ganha (está em "Cupons das campanhas"). Se ele já recebia as promoções, só agradeça — o brinde do cartaz é uma vez por pessoa.
- Se o cliente mandou áudio, imagem ou figurinha, você não consegue ver nem ouvir: peça com simpatia para ele escrever.
- Se perguntarem se você é uma pessoa, diga que é o atendente virtual do Mr. Kong e que a atendente pode entrar na conversa se ele quiser.

## O que você sabe
${conhecimento || "(nada cadastrado ainda)"}

## Cardápio (itens vendidos nos últimos 45 dias, com o preço mais recente)
${itens || "(cardápio indisponível: se perguntarem preço, passe para a atendente com motivo \"nao_sabe\")"}`;

  const t = agoraEmRioVerde();
  let sobreCliente = "Cliente sem pedidos registrados na base (pode ser a primeira vez).";
  if (cliente) {
    const dias = cliente.ultimo_dia
      ? Math.round((Date.now() - new Date(`${cliente.ultimo_dia}T12:00:00-03:00`).getTime()) / 86400000)
      : null;
    sobreCliente = [
      `Nome: ${cliente.nome ?? conversa?.nome ?? "não informado"}`,
      `Pedidos: ${cliente.pedidos}`,
      cliente.favorito ? `Lanche favorito: ${cliente.favorito}` : null,
      dias != null ? `Último pedido: há ${dias} dia(s)` : null,
    ].filter(Boolean).join("\n");
  } else if (conversa?.nome) {
    sobreCliente = `Nome no WhatsApp: ${conversa.nome}. ${sobreCliente}`;
  }

  const perguntar = cfg.perguntar_consentimento && !conversa?.perguntou_consentimento &&
    (cliente?.aceita_mensagens ?? null) === null;

  const variavel = `## Agora
${t.texto} em Rio Verde. Hoje é ${t.diaSemanaHoje}.${t.diaOperacional !== t.diaSemanaHoje ? ` Para as promoções, ainda vale o dia de ${t.diaOperacional} (a noite de ontem continua até as 3h).` : ""}
A loja está ${t.situacao}. Nunca diga que abre hoje se aqui estiver dizendo que não abre.

REGRAS DE DATA (obrigatórias):
- Hoje é ${t.diaSemanaHoje.toUpperCase()}. Nunca diga que hoje é outro dia da semana.
- Promoção de um dia da semana só vale naquele dia${t.diaOperacional !== t.diaSemanaHoje ? ` (agora vale a de ${t.diaOperacional})` : ` (hoje vale só a de ${t.diaOperacional}, se existir)`}. Se citar a promoção de outro dia, diga o dia certo (ex.: "na sexta tem...").
${t.aberto ? "" : "- A loja está FECHADA agora: na primeira resposta da conversa, avise isso e diga quando abre, antes de mandar o cardápio.\n"}
## Quem está falando
${sobreCliente}
${perguntar ? `
## Promoções por WhatsApp
Se o cliente já pediu para receber as promoções, registre na hora (veja a regra do cartaz "Manda um OI"). Senão, quando a conversa estiver terminando bem (nunca no meio de uma reclamação), pergunte UMA vez se o cliente quer receber as promoções da semana por aqui: no máximo uma mensagem por semana, e ele pode mandar SAIR quando quiser. Logo depois de perguntar, use registrar_consentimento com "perguntei". Quando ele responder, use de novo com "sim" ou "nao".` : ""}`;

  return [
    { type: "text", text: fixo, cache_control: { type: "ephemeral" } },
    { type: "text", text: variavel },
  ];
}

type Msg = { role: "user" | "assistant"; content: string };

// Histórico no formato que a IA espera: alternando cliente e loja.
// deno-lint-ignore no-explicit-any
function montarHistorico(mensagens: any[]): Msg[] {
  const saida: Msg[] = [];
  for (const m of mensagens) {
    if (m.direcao === "interna") continue;
    const role = m.direcao === "entrada" ? "user" : "assistant";
    const texto = m.autor === "atendente" ? `[Atendente humana]: ${m.texto ?? ""}` : (m.texto ?? "");
    if (!texto.trim()) continue;
    const ult = saida[saida.length - 1];
    if (ult && ult.role === role) ult.content += `\n${texto}`;
    else saida.push({ role, content: texto });
  }
  while (saida.length && saida[0].role === "assistant") saida.shift();
  return saida;
}

async function chamarClaude(modelo: string, system: unknown, messages: unknown[]) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env("ANTHROPIC_API_KEY"),
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: modelo, max_tokens: 300, system, messages, tools: FERRAMENTAS }),
  });
  if (!r.ok) throw new Error(`IA respondeu ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return await r.json();
}

type Acao = { ferramenta: string; entrada: Record<string, unknown> };

// Roda o agente. Em simulação (tela de teste), as ferramentas não gravam nada.
// deno-lint-ignore no-explicit-any
async function rodarAgente(cfg: any, historico: Msg[], cliente: any, conversa: any, simulacao: boolean) {
  const system = await montarSistema(cfg, cliente, conversa);
  // deno-lint-ignore no-explicit-any
  const mensagens: any[] = historico.map((m) => ({ role: m.role, content: m.content }));
  const textos: string[] = [];
  const acoes: Acao[] = [];
  const uso = { entrada: 0, saida: 0, cache_lido: 0, cache_gravado: 0 };

  for (let volta = 0; volta < 4; volta++) {
    const r = await chamarClaude(cfg.modelo || MODELO_PADRAO, system, mensagens);
    uso.entrada += r.usage?.input_tokens ?? 0;
    uso.saida += r.usage?.output_tokens ?? 0;
    uso.cache_lido += r.usage?.cache_read_input_tokens ?? 0;
    uso.cache_gravado += r.usage?.cache_creation_input_tokens ?? 0;

    // deno-lint-ignore no-explicit-any
    const blocos: any[] = r.content ?? [];
    for (const b of blocos) if (b.type === "text" && b.text?.trim()) textos.push(b.text.trim());
    const usos = blocos.filter((b) => b.type === "tool_use");
    if (r.stop_reason !== "tool_use" || usos.length === 0) break;

    mensagens.push({ role: "assistant", content: blocos });
    const resultados = [];
    for (const u of usos) {
      acoes.push({ ferramenta: u.name, entrada: u.input ?? {} });
      let resultado = "feito";
      if (!simulacao) resultado = await executarFerramenta(u.name, u.input ?? {}, conversa, historico);
      resultados.push({ type: "tool_result", tool_use_id: u.id, content: resultado });
    }
    mensagens.push({ role: "user", content: resultados });
  }
  return { texto: textos.join("\n\n"), acoes, uso };
}

// deno-lint-ignore no-explicit-any
async function executarFerramenta(nome: string, entrada: any, conversa: any, historico: Msg[]) {
  if (nome === "passar_para_atendente") {
    const ultimaDoCliente = [...historico].reverse().find((m) => m.role === "user")?.content ?? "";
    await passarParaAtendente(conversa, entrada.motivo ?? "outro", entrada.resumo ?? "", ultimaDoCliente);
    conversa.status = "atendente";
    return "Conversa passada para a atendente. Avise o cliente em uma frase curta.";
  }
  if (nome === "registrar_consentimento") {
    await registrarConsentimento(conversa, entrada.resposta, conversa.nome);
    return "Registrado.";
  }
  if (nome === "registrar_aniversario") {
    const dia = Number(entrada.dia), mes = Number(entrada.mes);
    const ano = Number(entrada.ano) >= 1920 && Number(entrada.ano) <= new Date().getFullYear() ? Number(entrada.ano) : 1900;
    const data = new Date(Date.UTC(ano === 1900 ? 2000 : ano, mes - 1, dia)); // 2000 é bissexto: aceita 29/02
    if (!(dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12) || data.getUTCMonth() !== mes - 1) {
      return "Data inválida. Peça para o cliente confirmar dia e mês.";
    }
    const clienteId = await garantirCliente(conversa);
    if (!clienteId) return "Não consegui achar o cadastro. Agradeça mesmo assim.";
    const iso = `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
    await admin.from("clientes").update({ aniversario: iso, atualizado_em: new Date().toISOString() }).eq("id", clienteId);
    await admin.from("crm_eventos").insert({
      cliente_id: clienteId, tipo: "aniversario", detalhe: { dia, mes, ano: ano === 1900 ? null : ano, origem: "whatsapp" }, autor: null,
    });
    return "Aniversário registrado.";
  }
  if (nome === "registrar_avaliacao") {
    const clienteId = await garantirCliente(conversa);
    await admin.from("crm_eventos").insert({
      cliente_id: clienteId, tipo: "avaliacao",
      detalhe: {
        nota: entrada.nota, comentario: entrada.comentario ?? null, origem: "whatsapp",
        pedido: conversa?.avaliacao_pedido ?? null,
      },
      autor: null,
    });
    return "Avaliação registrada.";
  }
  return "Ferramenta desconhecida.";
}

// deno-lint-ignore no-explicit-any
async function passarParaAtendente(conversa: any, motivo: string, resumo: string, perguntaDoCliente: string) {
  await admin.from("wa_conversas").update({
    status: "atendente",
    motivo,
    resumo_passagem: resumo,
    passada_em: new Date().toISOString(),
    pergunta_pendente: motivo === "nao_sabe" ? perguntaDoCliente.slice(0, 500) : null,
  }).eq("id", conversa.id);
  await admin.from("wa_mensagens").insert({
    conversa_id: conversa.id, linha_id: conversa.linha_id, direcao: "interna", autor: "sistema",
    texto: `Passada para a atendente · ${motivo}${resumo ? ` · ${resumo}` : ""}`,
  });
  if (motivo === "reclamacao" || motivo === "pedido_problema") {
    const clienteId = await garantirCliente(conversa);
    await admin.from("crm_eventos").insert({
      cliente_id: clienteId, tipo: "reclamacao", detalhe: { motivo, resumo, origem: "whatsapp" }, autor: null,
    });
  }
}

// Quem escreve e ainda não está na base (nunca pediu) entra como cliente
// só com telefone e nome, para o aceite e a avaliação terem onde ficar.
// deno-lint-ignore no-explicit-any
async function garantirCliente(conversa: any): Promise<string | null> {
  if (conversa.cliente_id) return conversa.cliente_id;
  const { data } = await admin.from("clientes")
    .upsert({ telefone: conversa.telefone, nome: conversa.nome }, { onConflict: "telefone" })
    .select("id").single();
  if (data?.id) {
    conversa.cliente_id = data.id;
    await admin.from("wa_conversas").update({ cliente_id: data.id }).eq("id", conversa.id);
  }
  return data?.id ?? null;
}

// deno-lint-ignore no-explicit-any
async function registrarConsentimento(conversa: any, resposta: string, nome: string | null) {
  if (resposta === "perguntei") {
    await admin.from("wa_conversas").update({ perguntou_consentimento: true }).eq("id", conversa.id);
    conversa.perguntou_consentimento = true;
    return;
  }
  if (nome && !conversa.nome) conversa.nome = nome;
  const clienteId = await garantirCliente(conversa);
  if (!clienteId) return;
  const aceita = resposta === "sim";
  await admin.from("clientes").update({
    aceita_mensagens: aceita, consentimento_em: new Date().toISOString(),
    consentimento_origem: "whatsapp", atualizado_em: new Date().toISOString(),
  }).eq("id", clienteId);
  await admin.from("crm_eventos").insert({
    cliente_id: clienteId, tipo: "consentimento", detalhe: { aceita, origem: "whatsapp" }, autor: null,
  });
  await admin.from("wa_conversas").update({ perguntou_consentimento: true }).eq("id", conversa.id);
}

// deno-lint-ignore no-explicit-any
async function responderComAgente(conversa: any, cfg: any) {
  const [{ data: msgs }, { data: cliente }] = await Promise.all([
    admin.from("wa_mensagens").select("direcao, autor, texto, criado_em")
      .eq("conversa_id", conversa.id).order("criado_em", { ascending: false }).limit(24),
    conversa.cliente_id
      ? admin.from("clientes").select("*").eq("id", conversa.cliente_id).maybeSingle()
      : admin.from("clientes").select("*").eq("telefone", conversa.telefone).maybeSingle(),
  ]);
  const historico = montarHistorico((msgs ?? []).reverse());
  if (!historico.length || historico[historico.length - 1].role !== "user") return;

  try {
    const r = await rodarAgente(cfg, historico, cliente, conversa, false);
    let texto = r.texto;
    if (!texto && conversa.status === "atendente") texto = "Já chamei nossa atendente, ela fala com você em instantes!";
    if (texto) await enviarEGravar(conversa, conversa.wa_id, texto, "agente", r.uso);
  } catch (e) {
    console.error("agente falhou", e);
    await passarParaAtendente(conversa, "outro", `Erro do agente: ${String((e as Error)?.message || e).slice(0, 200)}`, "");
    await enviarEGravar(conversa, conversa.wa_id, "Opa, deu um probleminha aqui. Já chamei nossa atendente!", "agente");
  }
}

// ===========================================================================
// 4) Envio
// ===========================================================================
// Celular brasileiro chega da Meta às vezes SEM o 9 (55 64 9246-8524).
// Na conta de teste da Meta, e em alguns casos na conta real, a resposta só
// passa se for para o número exatamente como foi cadastrado, COM o 9.
// Então: tenta como chegou; se a Meta recusar o destinatário, tenta o outro
// formato (com ou sem o 9).
function formatosDoNumero(para: string): string[] {
  const d = String(para || "").replace(/\D/g, "");
  if (/^55\d{2}9\d{8}$/.test(d)) return [d, d.slice(0, 4) + d.slice(5)];   // tem o 9 → tenta sem
  if (/^55\d{2}[6-9]\d{7}$/.test(d)) return [d, d.slice(0, 4) + "9" + d.slice(4)]; // celular sem o 9 → tenta com
  return [d];
}

// A IA escreve **negrito** (markdown); o WhatsApp usa *negrito*.
function paraWhatsApp(texto: string): string {
  return texto
    .replace(/\*\*(.+?)\*\*/gs, "*$1*")
    .replace(/__(.+?)__/gs, "_$1_")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[ \t]*[-•][ \t]+/gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function enviarUmaVez(para: string, texto: string, conta: ContaWa) {
  const r = await fetch(`${GRAPH}/${conta.phone}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${conta.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", recipient_type: "individual", to: para,
      type: "text", text: { body: texto.slice(0, 4000), preview_url: true },
    }),
  });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = corpo?.error;
    const erro = new Error(e ? `${e.code}: ${e.error_user_msg || e.message}` : `Meta respondeu ${r.status}`);
    (erro as Error & { codigo?: number }).codigo = e?.code;
    throw erro;
  }
  return corpo?.messages?.[0]?.id as string | undefined;
}

async function enviarTexto(para: string, texto: string, conta: ContaWa) {
  const formatos = formatosDoNumero(para);
  let ultimoErro: unknown = null;
  for (const numero of formatos) {
    try {
      return await enviarUmaVez(numero, texto, conta);
    } catch (e) {
      ultimoErro = e;
      // só vale tentar o outro formato se o problema foi o destinatário
      const codigo = (e as Error & { codigo?: number })?.codigo;
      if (codigo !== 131030 && codigo !== 131026 && codigo !== 100) break;
    }
  }
  throw ultimoErro;
}

async function enviarEGravar(
  // deno-lint-ignore no-explicit-any
  conversa: any, para: string, texto: string, autor: "agente" | "atendente", uso?: unknown, perfil?: string,
) {
  let waMsgId: string | undefined;
  let erro: string | null = null;
  if (autor === "agente") texto = paraWhatsApp(texto);
  try { waMsgId = await enviarTexto(para, texto, await contaDaLinha(conversa.linha_id)); }
  catch (e) { erro = String((e as Error)?.message || e); }
  await admin.from("wa_mensagens").insert({
    conversa_id: conversa.id, linha_id: conversa.linha_id, wa_msg_id: waMsgId ?? null, direcao: "saida", autor, texto,
    status: erro ? "failed" : "sent", erro, uso: uso ?? null, autor_perfil: perfil ?? null,
  });
  await admin.from("wa_conversas").update({
    ultima_msg_em: new Date().toISOString(), ultima_previa: texto.slice(0, 140),
  }).eq("id", conversa.id);
  if (erro) throw new Error(erro);
}

// ===========================================================================
// 5) Ações do painel
// ===========================================================================
async function acaoDoPainel(req: Request, bruto: string) {
  const authHeader = req.headers.get("Authorization") ?? "";
  const usuario = createClient(env("SUPABASE_URL"), env("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
  });
  const { data: u } = await usuario.auth.getUser();
  if (!u?.user) return json({ error: "Faça login no painel." }, 401);
  const { data: pode } = await usuario.rpc("crm_pode_editar");
  if (pode !== true) return json({ error: "Seu cargo não pode usar o atendimento do CRM." }, 403);

  const corpo = bruto ? JSON.parse(bruto) : {};

  if (corpo.acao === "enviar") {
    const texto = String(corpo.texto ?? "").trim();
    if (!texto) return json({ error: "Escreva a mensagem." }, 400);
    const { data: conversa } = await admin.from("wa_conversas").select("*").eq("id", corpo.conversa_id).single();
    if (!conversa) return json({ error: "Conversa não encontrada." }, 404);
    const ultima = conversa.ultima_msg_cliente_em ? new Date(conversa.ultima_msg_cliente_em).getTime() : 0;
    if (Date.now() - ultima > JANELA_24H_MS) {
      return json({
        error: "Já passaram 24h desde a última mensagem do cliente. Pelo WhatsApp oficial, " +
          "só dá para escrever de novo com mensagem paga (modelo aprovado). Espere o cliente chamar.",
      }, 409);
    }
    // quem escreve assume a conversa: o agente fica em silêncio
    if (conversa.status !== "atendente") {
      await admin.from("wa_conversas").update({
        status: "atendente", assumida_por: u.user.id, assumida_em: new Date().toISOString(),
      }).eq("id", conversa.id);
    }
    try {
      await enviarEGravar(conversa, conversa.wa_id, texto, "atendente", null, u.user.id);
    } catch (e) {
      return json({ error: `A Meta recusou: ${String((e as Error)?.message || e)}` }, 502);
    }
    // a primeira resposta a uma pergunta que o agente não sabia vira sugestão
    if (conversa.pergunta_pendente) {
      await admin.from("agente_sugestoes").insert({
        conversa_id: conversa.id, pergunta: conversa.pergunta_pendente, resposta: texto,
      });
      await admin.from("wa_conversas").update({ pergunta_pendente: null }).eq("id", conversa.id);
    }
    await admin.from("wa_conversas").update({ nao_lidas: 0 }).eq("id", conversa.id);
    return json({ ok: true });
  }

  if (corpo.acao === "testar") {
    const { data: cfg } = await admin.from("agente_config").select("*").eq("id", 1).single();
    const historico = montarHistorico(
      (corpo.mensagens ?? []).map((m: { de: string; texto: string }) => ({
        direcao: m.de === "cliente" ? "entrada" : "saida", autor: m.de === "cliente" ? "cliente" : "agente", texto: m.texto,
      })),
    );
    if (!historico.length || historico[historico.length - 1].role !== "user") {
      return json({ error: "Escreva uma mensagem como se fosse o cliente." }, 400);
    }
    try {
      const r = await rodarAgente(cfg, historico, null, { nome: "Cliente de teste", perguntou_consentimento: false }, true);
      return json({ resposta: r.texto ? paraWhatsApp(r.texto) : r.texto, acoes: r.acoes, uso: r.uso });
    } catch (e) {
      return json({ error: String((e as Error)?.message || e) }, 502);
    }
  }

  if (corpo.acao === "diagnostico") {
    const faltando = ["WHATSAPP_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_WABA_ID", "WHATSAPP_APP_SECRET",
      "WHATSAPP_VERIFY_TOKEN", "ANTHROPIC_API_KEY"].filter((k) => !env(k));
    if (faltando.length) return json({ ok: false, faltando });
    const conta = await contaOficial();
    const h = { Authorization: `Bearer ${conta.token}` };
    const numero = await fetch(
      `${GRAPH}/${conta.phone}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier,status,platform_type,code_verification_status,name_status`,
      { headers: h },
    ).then((r) => r.json()).catch((e) => ({ error: { message: String(e) } }));
    // inscreve o app na conta do WhatsApp (sem isso, a Meta não manda as mensagens)
    const inscricao = await fetch(`${GRAPH}/${conta.waba}/subscribed_apps`, { method: "POST", headers: h })
      .then((r) => r.json()).catch((e) => ({ error: { message: String(e) } }));
    return json({
      ok: !numero?.error && inscricao?.success === true,
      numero: numero?.error ? { erro: numero.error.message } : numero,
      inscricao: inscricao?.error ? { erro: inscricao.error.message } : inscricao,
      webhook: `${env("SUPABASE_URL")}/functions/v1/whatsapp-agente`,
      oficial: true,
    });
  }

  // --- Coexistência -------------------------------------------------------
  // dados que a tela precisa para abrir a janela da Meta
  if (corpo.acao === "conexao_info") {
    const app = await fetch(`${GRAPH}/app?access_token=${encodeURIComponent(env("WHATSAPP_TOKEN"))}`)
      .then((x) => x.json()).catch(() => ({}));
    const { data: cfg } = await admin.from("agente_config").select("meta_config_id").eq("id", 1).single();
    if (!app?.id) return json({ error: "Não consegui descobrir o ID do app na Meta (confira o WHATSAPP_TOKEN)." }, 502);
    return json({ app_id: app.id, config_id: cfg?.meta_config_id ?? null, versao: GRAPH.split("/").pop() });
  }

  // liga ou desliga o agente numa linha (a tela não escreve em wa_linhas)
  if (corpo.acao === "linha_agente") {
    const { error } = await admin.from("wa_linhas")
      .update({ agente_ligado: corpo.ligado === true }).eq("id", String(corpo.linha_id ?? ""));
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // a janela da Meta terminou: troca o código por token, inscreve o app e
  // pede os contatos. O histórico não é pedido, de propósito.
  if (corpo.acao === "coexistencia") {
    const { data: admin_ } = await usuario.rpc("is_admin");
    if (admin_ !== true) return json({ error: "Só o administrador pode conectar o número." }, 403);
    const code = String(corpo.code ?? "");
    const appId = String(corpo.app_id ?? "");
    let waba = String(corpo.waba_id ?? "");
    let phone = String(corpo.phone_number_id ?? "");
    if (!code || !appId || !waba) return json({ error: "A Meta não devolveu os dados da conexão. Tente de novo." }, 400);

    const tk = await fetch(`${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${encodeURIComponent(env("WHATSAPP_APP_SECRET"))}&code=${encodeURIComponent(code)}`)
      .then((x) => x.json()).catch((e) => ({ error: { message: String(e) } }));
    if (!tk?.access_token) return json({ error: `A Meta não liberou o acesso: ${tk?.error?.message ?? "sem token"}` }, 502);
    const token = tk.access_token as string;
    const h = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    // deno-lint-ignore no-explicit-any
    const nums: any = await fetch(`${GRAPH}/${waba}/phone_numbers?fields=id,display_phone_number,verified_name`, { headers: h })
      .then((x) => x.json()).catch(() => ({}));
    // deno-lint-ignore no-explicit-any
    const escolhido = (nums?.data ?? []).find((n: any) => !phone || n.id === phone) ?? nums?.data?.[0];
    if (!phone) phone = escolhido?.id ?? "";
    if (!phone) return json({ error: "Não achei o número nessa conta do WhatsApp." }, 502);

    // Só o número cadastrado como balcão entra aqui. Conectar outro, ou a
    // própria oficial, tiraria um número do lugar sem ninguém perceber.
    const { data: balcao } = await admin.from("wa_linhas").select("id, numero").eq("tipo", "coexistencia").maybeSingle();
    if (!balcao) return json({ error: "Linha do balcão não encontrada. Rodou a migração 184?" }, 400);
    const conectado = normalizaTelefone(String(escolhido?.display_phone_number ?? ""));
    if (phone === env("WHATSAPP_PHONE_NUMBER_ID") || conectado !== normalizaTelefone(balcao.numero)) {
      return json({ error: `Este número (${escolhido?.display_phone_number ?? "?"}) não é o do balcão. Nada foi alterado.` }, 400);
    }

    const insc = await fetch(`${GRAPH}/${waba}/subscribed_apps`, { method: "POST", headers: h })
      .then((x) => x.json()).catch((e) => ({ error: { message: String(e) } }));
    if (insc?.error) return json({ error: `Não consegui inscrever o app na conta: ${insc.error.message}` }, 502);

    await admin.from("wa_conexao").upsert({
      id: 1, ativo: true, waba_id: waba, phone_number_id: phone, token,
      numero: String(escolhido?.display_phone_number ?? "").replace(/\D/g, ""),
      nome: escolhido?.verified_name ?? null, conectado_em: new Date().toISOString(),
      contatos: 0, erro: null,
      atualizado_em: new Date().toISOString(),
    });
    await admin.from("wa_linhas").update({ estado: "conectada", estado_em: new Date().toISOString(), phone_number_id: phone }).eq("id", balcao.id);
    contasCache = null;

    const pedir = (tipo: string) => fetch(`${GRAPH}/${phone}/smb_app_data`, {
      method: "POST", headers: h, body: JSON.stringify({ messaging_product: "whatsapp", sync_type: tipo }),
    }).then((x) => x.json()).catch((e) => ({ error: { message: String(e) } }));
    const contatos = await pedir("smb_app_state_sync");
    const problemas = contatos?.error?.message ?? "";
    if (problemas) await admin.from("wa_conexao").update({ erro: problemas }).eq("id", 1);
    return json({ ok: true, numero: escolhido?.display_phone_number ?? null, aviso: problemas || null });
  }

  // desliga a linha do balcão. A oficial não muda em nada.
  if (corpo.acao === "desconectar") {
    const { data: admin_ } = await usuario.rpc("is_admin");
    if (admin_ !== true) return json({ error: "Só o administrador pode fazer isso." }, 403);
    await admin.from("wa_conexao").update({ ativo: false, atualizado_em: new Date().toISOString() }).eq("id", 1);
    await admin.from("wa_linhas").update({ estado: "desconectada", estado_em: new Date().toISOString(), phone_number_id: null }).eq("tipo", "coexistencia");
    contasCache = null;
    return json({ ok: true });
  }

  // registra o número na Meta (passo da migração do número oficial). O PIN é a
  // verificação em duas etapas do número: 6 números, escolhidos por quem registra.
  if (corpo.acao === "registrar") {
    const pin = String(corpo.pin ?? "").trim();
    if (!/^\d{6}$/.test(pin)) return json({ error: "A senha precisa ter exatamente 6 números." }, 400);
    const { data: admin_ } = await usuario.rpc("is_admin");
    if (admin_ !== true) return json({ error: "Só o administrador pode registrar o número." }, 403);
    const conta = await contaOficial();
    const h = { Authorization: `Bearer ${conta.token}`, "Content-Type": "application/json" };
    const r = await fetch(`${GRAPH}/${conta.phone}/register`, {
      method: "POST", headers: h, body: JSON.stringify({ messaging_product: "whatsapp", pin }),
    }).then((x) => x.json()).catch((e) => ({ error: { message: String(e) } }));
    if (r?.error) {
      const m = r.error.error_user_msg || r.error.message || "erro desconhecido";
      return json({ error: `A Meta recusou: ${m}` }, 502);
    }
    // garante que o app recebe as mensagens da conta nova
    await fetch(`${GRAPH}/${conta.waba}/subscribed_apps`, { method: "POST", headers: h }).catch(() => null);
    return json({ ok: true });
  }

  return json({ error: "Ação desconhecida." }, 400);
}

// ===========================================================================
// 6) Robô de avaliação (chamado pelo banco a cada 5 minutos)
// ===========================================================================
// Grátis: só pergunta para quem escreveu no WhatsApp nas últimas ~22h (janela
// de 24h da Meta) e teve pedido FECHADO no CardápioWeb depois do tempo de
// espera. Um pedido de avaliação por conversa a cada 20h, um por pedido.
const CW_BASE = Deno.env.get("CARDAPIOWEB_BASE_URL") ?? "https://integracao.cardapioweb.com";

// data no fuso de Rio Verde, no formato que o CardápioWeb aceita
function isoSaoPaulo(d: Date) {
  const local = new Date(d.getTime() - 3 * 3600 * 1000);
  return local.toISOString().slice(0, 19) + "-03:00";
}

function telefoneDoPedido(tel: unknown, ddi: unknown) {
  let d = String(tel ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (d.length < 10) return null;
  if (d.length === 10 || d.length === 11) d = (String(ddi ?? "").replace(/\D/g, "") || "55") + d;
  return normalizaTelefone(d);
}

async function roboAvaliacoes(segredo: string) {
  const { data: s } = await admin.from("crm_segredos").select("cron").eq("id", 1).single();
  if (!s?.cron || s.cron !== segredo) return json({ error: "segredo inválido" }, 403);

  const { data: cfg } = await admin.from("agente_config").select("*").eq("id", 1).single();
  if (!cfg?.ligado || !cfg?.avaliacao_ligada) return json({ ok: true, pulou: "desligado" });
  const esperaMs = Math.max(10, Number(cfg.avaliacao_espera_min) || 60) * 60 * 1000;

  const agora = Date.now();
  // Linha com o agente desligado também não pede avaliação.
  const { data: ligadas } = await admin.from("wa_linhas").select("id").eq("agente_ligado", true);
  const { data: conversas } = await admin.from("wa_conversas")
    .select("id, telefone, wa_id, nome, cliente_id, linha_id, status, avaliacao_pedida_em, ultima_msg_cliente_em")
    .eq("status", "agente")
    .in("linha_id", (ligadas ?? []).map((l) => l.id))
    .gt("ultima_msg_cliente_em", new Date(agora - 22 * 3600 * 1000).toISOString());
  const candidatas = (conversas ?? []).filter((c) =>
    !c.avaliacao_pedida_em || new Date(c.avaliacao_pedida_em).getTime() < agora - 20 * 3600 * 1000
  );
  if (!candidatas.length) return json({ ok: true, pulou: "ninguém com janela aberta" });

  const token = env("CARDAPIOWEB_API_TOKEN");
  if (!token) return json({ error: "falta CARDAPIOWEB_API_TOKEN" }, 500);
  const h = { "X-API-KEY": token, Accept: "application/json" };

  // pedidos fechados das últimas 6 horas
  const url = new URL(CW_BASE + "/api/partner/v1/orders/history");
  url.searchParams.set("start_date", isoSaoPaulo(new Date(agora - 6 * 3600 * 1000)));
  url.searchParams.set("end_date", isoSaoPaulo(new Date(agora)));
  url.searchParams.append("status[]", "closed");
  url.searchParams.set("per_page", "100");
  const r = await fetch(url.toString(), { headers: h });
  const texto = await r.text();
  // deno-lint-ignore no-explicit-any
  let dados: any;
  try { dados = JSON.parse(texto); } catch { return json({ ok: false, erro: "CardápioWeb: " + texto.slice(0, 120) }); }
  // deno-lint-ignore no-explicit-any
  const pedidos: any[] = dados?.orders ?? [];

  // grava os pedidos novos (com telefone); o detalhe só é buscado uma vez
  const ids = pedidos.map((p) => String(p.id));
  const { data: jaVistos } = ids.length
    ? await admin.from("crm_avaliacao_pedidos").select("pedido_id").in("pedido_id", ids)
    : { data: [] };
  const vistos = new Set((jaVistos ?? []).map((v) => v.pedido_id));
  for (const p of pedidos) {
    if (vistos.has(String(p.id))) continue;
    let tel = telefoneDoPedido(p.customer?.phone, p.customer?.ddi);
    let det = p;
    if (!tel) {
      det = await fetch(`${CW_BASE}/api/partner/v1/orders/${p.id}`, { headers: h })
        .then((x) => (x.ok ? x.json() : null)).catch(() => null);
      tel = telefoneDoPedido(det?.customer?.phone, det?.customer?.ddi);
    }
    await admin.from("crm_avaliacao_pedidos").upsert({
      pedido_id: String(p.id),
      display_id: p.display_id != null ? String(p.display_id) : null,
      telefone: tel,
      criado_em: p.created_at ?? det?.created_at ?? null,
    }, { onConflict: "pedido_id", ignoreDuplicates: true });
  }

  // cruza com as conversas abertas
  const telefones = candidatas.map((c) => c.telefone);
  const { data: prontos } = await admin.from("crm_avaliacao_pedidos")
    .select("pedido_id, display_id, telefone, criado_em")
    .eq("status", "visto")
    .in("telefone", telefones)
    .gt("criado_em", new Date(agora - 6 * 3600 * 1000).toISOString())
    .lt("criado_em", new Date(agora - esperaMs).toISOString())
    .order("criado_em", { ascending: false });

  let enviados = 0;
  const feitas = new Set<string>();
  for (const p of prontos ?? []) {
    const conversa = candidatas.find((c) => c.telefone === p.telefone);
    if (!conversa || feitas.has(conversa.id)) continue;
    feitas.add(conversa.id);
    let nome = "";
    if (conversa.cliente_id) {
      const { data: cli } = await admin.from("clientes").select("nome").eq("id", conversa.cliente_id).single();
      nome = cli?.nome ?? "";
    }
    nome = (nome || conversa.nome || "").trim().split(/\s+/)[0] ?? "";
    const nomeFmt = nome ? nome.charAt(0).toUpperCase() + nome.slice(1).toLowerCase() : "";
    const texto = `Oi${nomeFmt ? ", " + nomeFmt : ""}! Chegou tudo certo com seu pedido${p.display_id ? " #" + p.display_id : ""}? 🦍 De 1 a 5, que nota você dá?`;
    try {
      await enviarEGravar(conversa, conversa.wa_id, texto, "agente");
      enviados++;
    } catch (e) {
      console.error("avaliação não enviada", e);
      continue;
    }
    const quando = new Date().toISOString();
    await admin.from("crm_avaliacao_pedidos")
      .update({ status: "enviado", conversa_id: conversa.id, enviado_em: quando }).eq("pedido_id", p.pedido_id);
    await admin.from("wa_conversas")
      .update({ avaliacao_pedida_em: quando, avaliacao_pedido: p.display_id ?? p.pedido_id }).eq("id", conversa.id);
  }
  return json({ ok: true, pedidos: pedidos.length, enviados });
}
