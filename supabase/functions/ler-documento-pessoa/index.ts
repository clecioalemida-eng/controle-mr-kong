// Edge Function: ler-documento-pessoa
//
// Lê os documentos anexados de uma pessoa da equipe (RG, CNH, CPF,
// comprovante de endereço, carteira de trabalho) e devolve os dados que
// achou: nome completo, CPF, RG, nascimento e endereço — e o tipo de
// cada documento.
//
// NÃO grava nada no cadastro. Quem grava é a tela, depois que a pessoa
// confere campo a campo e clica em "Atualizar cadastro". Documento lido
// por IA pode vir com número trocado; a decisão fica com quem olha.
//
// Entrada: { caminhos: ["arquivo1.jpg", "arquivo2.pdf"] } — caminhos no
// bucket privado "documentos-pessoas". Até 4 por vez.
//
// Segurança: só usuário aprovado. O download usa a sessão de quem chamou,
// então valem as mesmas regras do bucket (migração 018). Verify JWT ligado.
//
// Segredo usado: ANTHROPIC_API_KEY (o mesmo da leitura de notas).

import { createClient } from "npm:@supabase/supabase-js@2";

// Fila de modelos: o primeiro que responder ganha. Um nome de modelo que
// sai do ar não pode parar a leitura.
const MODELOS = [
  Deno.env.get("ANTHROPIC_MODEL"),
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
].filter(Boolean) as string[];

const MAX_DOCUMENTOS = 4;
const MAX_BYTES = 8 * 1024 * 1024;   // 8 MB por arquivo
const TIMEOUT_IA_MS = 90000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

function paraBase64(bytes: Uint8Array) {
  const BLOCO = 0x8000;
  const partes: string[] = [];
  for (let i = 0; i < bytes.length; i += BLOCO) {
    partes.push(String.fromCharCode(...bytes.subarray(i, i + BLOCO)));
  }
  return btoa(partes.join(""));
}

// O tipo pelos primeiros bytes — o nome do arquivo mente com frequência
// (foto de iPhone chamada .jpg que é HEIC, PDF sem extensão).
function tipoPelosBytes(b: Uint8Array): string | null {
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  return null;
}

const INSTRUCOES = `Você está lendo documentos pessoais de um funcionário de uma lanchonete, para preencher o cadastro dele.
Os documentos vêm na ordem em que foram enviados (documento 1, documento 2...).

Para cada documento, diga o tipo: rg, cnh, cpf, endereco (conta de luz, água, telefone, comprovante de residência), ctps (carteira de trabalho), contrato ou outro.

Depois junte os dados da PESSOA:
- nome_completo: como está no RG/CNH. Vazio se não houver documento de identidade.
- cpf: só os 11 dígitos, sem pontos. Vazio se não estiver legível.
- rg: número do RG com o órgão emissor e a UF, como impresso (ex.: "4.567.890 SSP-GO").
- data_nascimento: YYYY-MM-DD.
- endereco: rua, número, complemento, bairro, cidade-UF e CEP, numa linha. Use o comprovante de endereço; se o comprovante estiver em nome de outra pessoa, use mesmo assim e diga isso em "observacoes".
- Em "fonte_*", o número do documento de onde tirou cada dado.

REGRAS:
- Não invente. Número borrado, cortado ou com reflexo: deixe vazio e explique em "observacoes".
- Não confunda o CPF com o número do RG, com o número de registro da CNH ou com o código de cliente da conta de luz.
- Datas de emissão e validade não são data de nascimento.`;

async function lerComIA(chave: string, docs: { base64: string; tipo: string }[]) {
  const ferramenta = {
    name: "registrar_dados_pessoais",
    description: "Registra os dados pessoais lidos dos documentos.",
    input_schema: {
      type: "object",
      properties: {
        documentos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              numero: { type: "integer", description: "1 para o primeiro documento enviado, 2 para o segundo..." },
              tipo: { type: "string", enum: ["rg", "cnh", "cpf", "endereco", "ctps", "contrato", "outro"] },
            },
            required: ["numero", "tipo"],
          },
        },
        nome_completo: { type: "string" },
        cpf: { type: "string" },
        rg: { type: "string" },
        data_nascimento: { type: "string" },
        endereco: { type: "string" },
        fonte_nome: { type: "integer" },
        fonte_cpf: { type: "integer" },
        fonte_rg: { type: "integer" },
        fonte_nascimento: { type: "integer" },
        fonte_endereco: { type: "integer" },
        observacoes: { type: "string" },
      },
      required: ["documentos"],
    },
  };

  const conteudo: unknown[] = [];
  docs.forEach((d, i) => {
    conteudo.push({ type: "text", text: `Documento ${i + 1}:` });
    conteudo.push({
      type: d.tipo === "application/pdf" ? "document" : "image",
      source: { type: "base64", media_type: d.tipo, data: d.base64 },
    });
  });
  conteudo.push({ type: "text", text: INSTRUCOES });

  let ultimoErro = "";
  for (const modelo of MODELOS) {
    let r: Response;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: AbortSignal.timeout(TIMEOUT_IA_MS),
        headers: { "x-api-key": chave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: modelo, max_tokens: 1500, temperature: 0,
          tools: [ferramenta], tool_choice: { type: "tool", name: "registrar_dados_pessoais" },
          messages: [{ role: "user", content: conteudo }],
        }),
      });
    } catch (e) {
      ultimoErro = `Falha de rede com a IA (${modelo}): ${String(e).slice(0, 200)}`;
      continue;
    }
    if (r.ok) {
      const dados = await r.json();
      const bloco = (dados.content || []).find((b: any) => b.type === "tool_use");
      if (bloco) return { ok: true as const, lido: bloco.input, modelo };
      ultimoErro = `${modelo}: respondeu sem preencher a ficha.`;
      continue;
    }
    const detalhe = (await r.text()).slice(0, 400);
    ultimoErro = `${modelo}: ${detalhe}`;
    // Modelo inexistente: tenta o próximo. Outro erro: o próximo também
    // pode resolver (sobrecarga), então segue a fila do mesmo jeito.
  }
  return { ok: false as const, erro: ultimoErro || "Não consegui falar com a IA." };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Não autenticado." }, 401);
    const { data: perfil } = await supabase.from("perfis").select("status").eq("id", userData.user.id).maybeSingle();
    if (!perfil || perfil.status !== "aprovado") return json({ error: "Usuário sem acesso liberado." }, 403);

    const chave = Deno.env.get("ANTHROPIC_API_KEY");
    if (!chave) return json({ error: "ANTHROPIC_API_KEY não configurado nos secrets do projeto." }, 500);

    const { caminhos } = await req.json();
    if (!Array.isArray(caminhos) || caminhos.length === 0) return json({ error: "Informe os documentos (caminhos)." }, 400);
    if (caminhos.length > MAX_DOCUMENTOS) return json({ error: `Leia no máximo ${MAX_DOCUMENTOS} documentos por vez.` }, 400);

    const docs: { base64: string; tipo: string }[] = [];
    for (const caminho of caminhos) {
      const { data: arquivo, error } = await supabase.storage.from("documentos-pessoas").download(String(caminho));
      if (error || !arquivo) return json({ error: `Não consegui baixar ${caminho}: ${error?.message || "arquivo vazio"}` }, 400);
      const bytes = new Uint8Array(await arquivo.arrayBuffer());
      if (bytes.length > MAX_BYTES) return json({ error: `${caminho} passa de 8 MB — tire uma foto menor.` }, 400);
      const tipo = tipoPelosBytes(bytes);
      if (!tipo) return json({ error: `${caminho}: formato que a leitura não aceita (use JPG, PNG ou PDF; foto HEIC do iPhone precisa ser convertida).` }, 400);
      docs.push({ base64: paraBase64(bytes), tipo });
    }

    const leitura = await lerComIA(chave, docs);
    if (!leitura.ok) return json({ error: leitura.erro }, 502);
    return json({ ok: true, modelo: leitura.modelo, lido: leitura.lido });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
