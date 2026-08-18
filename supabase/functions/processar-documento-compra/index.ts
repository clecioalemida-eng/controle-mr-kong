// Edge Function: processar-documento-compra
//
// Roda no servidor (nunca no navegador) — é a única peça que conhece a
// chave da Anthropic API (secret ANTHROPIC_API_KEY). Recebe o caminho de
// um arquivo já enviado ao bucket "notas-fiscais", manda pro Claude ler
// (com visão), casa cada item lido com um insumo já cadastrado (por nome
// exato, por sinônimo aprendido, ou por aproximação simples), calcula o
// alerta de variação de preço, e grava tudo como "aguardando confirmação"
// — nada entra no estoque/custo ainda, isso só acontece quando o usuário
// confirma na tela (ver src/modules/NotasFiscais.jsx).

import { createClient } from "npm:@supabase/supabase-js@2";

const LIMITE_ALERTA_PRECO = 0.30; // 30% acima da última compra -> alerta vermelho

function normalizar(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

// Junta itens que a IA leu como linhas separadas mas são o mesmo produto —
// mesmo nome (normalizado), mesma unidade e mesmo preço unitário. Isso
// cobre o caso comum de um produto pesado em pacotes separados (ex.: três
// pacotes de queijo com pesos diferentes, mesmo R$/kg): em vez de manter
// três linhas quase iguais, soma as quantidades numa linha só.
function consolidarIguais(itens: { nome: string; quantidade: number; unidade: string; preco_unitario: number }[]) {
  const grupos = new Map<string, { nome: string; quantidade: number; unidade: string; preco_unitario: number }>();
  for (const item of itens) {
    const chave = `${normalizar(item.nome)}|${item.unidade}|${item.preco_unitario}`;
    const existente = grupos.get(chave);
    if (existente) {
      existente.quantidade = round2(existente.quantidade + item.quantidade);
    } else {
      grupos.set(chave, { ...item });
    }
  }
  return Array.from(grupos.values());
}

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
    if (userErr || !userData?.user) return json({ error: "Não autenticado." }, 401, corsHeaders);

    const { data: perfil } = await supabase.from("perfis").select("status").eq("id", userData.user.id).maybeSingle();
    if (!perfil || perfil.status !== "aprovado") return json({ error: "Usuário sem acesso liberado." }, 403, corsHeaders);

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) return json({ error: "ANTHROPIC_API_KEY não configurado nos secrets do projeto." }, 500, corsHeaders);

    const { documento_id } = await req.json();
    if (!documento_id) return json({ error: "Informe documento_id." }, 400, corsHeaders);

    const { data: documento, error: docErr } = await supabase
      .from("documentos_compra").select("*").eq("id", documento_id).single();
    if (docErr || !documento) return json({ error: "Documento não encontrado." }, 404, corsHeaders);

    // 1) Baixa o arquivo do Storage e converte pra base64
    const { data: arquivo, error: dlErr } = await supabase.storage.from("notas-fiscais").download(documento.arquivo_path);
    if (dlErr || !arquivo) {
      await supabase.from("documentos_compra").update({ status: "erro", erro_mensagem: "Não achei o arquivo no Storage." }).eq("id", documento_id);
      return json({ error: "Não achei o arquivo no Storage." }, 404, corsHeaders);
    }
    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    let binario = "";
    for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
    const base64 = btoa(binario);

    const ehPdf = documento.arquivo_path.toLowerCase().endsWith(".pdf");
    const mediaType = ehPdf ? "application/pdf" : (documento.arquivo_path.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg");

    // 2) Aprendizado: busca itens já confirmados antes, pra usar como
    // referência de nome/unidade/preço esperado nesta leitura. Isso não
    // corrige erro de leitura de imagem sozinho, mas evita repetir o mesmo
    // erro de unidade/nome quando um produto já visto aparece de novo.
    const { data: docsConfirmados } = await supabase
      .from("documentos_compra").select("id")
      .eq("status", "confirmado")
      .order("confirmado_em", { ascending: false })
      .limit(50);
    const idsConfirmados = (docsConfirmados || []).map((d: any) => d.id);
    let referenciaTexto = "";
    if (idsConfirmados.length > 0) {
      const { data: historico } = await supabase
        .from("itens_documento_compra")
        .select("nome_lido, unidade, preco_unitario, insumo:insumos(nome)")
        .in("documento_id", idsConfirmados)
        .limit(300);
      const vistos = new Set<string>();
      const linhasRef: string[] = [];
      for (const h of historico || []) {
        const chave = normalizar(h.nome_lido);
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        const nomeInsumo = (h as any).insumo?.nome;
        linhasRef.push(`"${h.nome_lido}" -> unidade ${h.unidade}, ~R$${h.preco_unitario}${nomeInsumo ? `, insumo: ${nomeInsumo}` : ""}`);
        if (linhasRef.length >= 40) break;
      }
      if (linhasRef.length > 0) {
        referenciaTexto = `\n\nItens já confirmados manualmente em compras anteriores neste sistema (use como referência de nome, unidade e faixa de preço esperada para produtos parecidos — mas sempre confira contra o que está impresso NESTA nota específica, não copie automaticamente):\n${linhasRef.join("\n")}`;
      }
    }

    // 3) Manda pro Claude ler, com saída estruturada via tool use
    const respostaClaude = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2000,
        tools: [{
          name: "registrar_documento",
          description: "Registra os dados extraídos de uma nota fiscal ou recibo de compra.",
          input_schema: {
            type: "object",
            properties: {
              fornecedor: { type: "string", description: "Nome do fornecedor/emitente do documento." },
              data_documento: { type: "string", description: "Data do documento, formato YYYY-MM-DD." },
              tipo_documento: { type: "string", enum: ["nota_fiscal", "recibo"] },
              itens: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    nome: { type: "string", description: "Nome do produto exatamente como está no documento." },
                    quantidade: { type: "number" },
                    unidade: { type: "string", enum: ["un", "g", "kg", "ml", "l"], description: "Se o documento usar outra unidade (ex.: caixa, dúzia), converta para uma dessas." },
                    preco_unitario: { type: "number", description: "Preço por unidade. Se só houver o total da linha, calcule total/quantidade." },
                  },
                  required: ["nome", "quantidade", "unidade", "preco_unitario"],
                },
              },
            },
            required: ["itens"],
          },
        }],
        tool_choice: { type: "tool", name: "registrar_documento" },
        messages: [{
          role: "user",
          content: [
            { type: ehPdf ? "document" : "image", source: { type: "base64", media_type: mediaType, data: base64 } },
            { type: "text", text: "Leia esta nota fiscal ou recibo de compra de um restaurante e extraia fornecedor, data e cada item comprado (nome, quantidade, unidade, preço unitário). Regras importantes: (1) liste apenas itens que aparecem literalmente impressos no documento — nunca invente, deduza ou repita um item que não está lá; (2) se algum trecho da imagem estiver ilegível, borrado ou com reflexo de luz que impeça leitura confiante, NÃO invente um item para preencher essa lacuna — é preferível deixar de fora um item real do que incluir um que não existe; (3) leia cada linha inteira antes de passar pra próxima, sem misturar valores entre linhas diferentes; (4) depois de ler quantidade e preço unitário de cada item, confira se quantidade × preço_unitário bate (aproximadamente) com o valor total daquela linha impresso no documento — se não bater, releia os números com mais atenção antes de responder; (5) se o mesmo produto aparecer em várias linhas com o mesmo preço por unidade (ex.: vários pacotes pesados separadamente), some as quantidades e devolva como um único item." + referenciaTexto },
          ],
        }],
      }),
    });

    if (!respostaClaude.ok) {
      const detalhe = await respostaClaude.text();
      await supabase.from("documentos_compra").update({ status: "erro", erro_mensagem: `Erro ao consultar a IA: ${detalhe.slice(0, 300)}` }).eq("id", documento_id);
      return json({ error: "Erro ao consultar a IA.", detalhe }, 502, corsHeaders);
    }

    const dadosClaude = await respostaClaude.json();
    const blocoFerramenta = (dadosClaude.content || []).find((b: any) => b.type === "tool_use");
    if (!blocoFerramenta) {
      await supabase.from("documentos_compra").update({ status: "erro", erro_mensagem: "A IA não conseguiu ler o documento." }).eq("id", documento_id);
      return json({ error: "A IA não conseguiu ler o documento." }, 502, corsHeaders);
    }
    const extraido = blocoFerramenta.input as {
      fornecedor?: string; data_documento?: string; tipo_documento?: "nota_fiscal" | "recibo";
      itens: { nome: string; quantidade: number; unidade: string; preco_unitario: number }[];
    };
    const itensConsolidados = consolidarIguais(extraido.itens || []);

    // 4) Casa cada item com um insumo (nome exato -> sinônimo aprendido -> aproximação simples)
    const { data: todosInsumos } = await supabase.from("insumos").select("id, nome, custo_medio_atual");
    const { data: todosSinonimos } = await supabase.from("insumo_sinonimos").select("nome_variante, insumo_id");

    const mapaSinonimos = new Map((todosSinonimos || []).map((s: any) => [normalizar(s.nome_variante), s.insumo_id]));
    const mapaExato = new Map((todosInsumos || []).map((i: any) => [normalizar(i.nome), i]));

    let valorTotal = 0;
    const linhasParaGravar = itensConsolidados.map((item) => {
      valorTotal += (item.quantidade || 0) * (item.preco_unitario || 0);
      const chave = normalizar(item.nome);
      let insumo: any = mapaExato.get(chave);
      if (!insumo && mapaSinonimos.has(chave)) {
        insumo = (todosInsumos || []).find((i: any) => i.id === mapaSinonimos.get(chave));
      }
      if (!insumo) {
        // aproximação simples: um nome contém o outro
        insumo = (todosInsumos || []).find((i: any) => {
          const n = normalizar(i.nome);
          return chave.includes(n) || n.includes(chave);
        });
      }

      let alerta = false;
      let precoAnterior: number | null = null;
      if (insumo && insumo.custo_medio_atual > 0) {
        precoAnterior = insumo.custo_medio_atual;
        if (item.preco_unitario > insumo.custo_medio_atual * (1 + LIMITE_ALERTA_PRECO)) alerta = true;
      }

      return {
        documento_id,
        nome_lido: item.nome,
        quantidade: item.quantidade,
        unidade: item.unidade,
        preco_unitario: item.preco_unitario,
        insumo_id: insumo?.id ?? null,
        alerta_preco: alerta,
        preco_anterior: precoAnterior,
      };
    });

    if (linhasParaGravar.length > 0) {
      const { error: errItens } = await supabase.from("itens_documento_compra").insert(linhasParaGravar);
      if (errItens) {
        await supabase.from("documentos_compra").update({ status: "erro", erro_mensagem: errItens.message }).eq("id", documento_id);
        return json({ error: errItens.message }, 500, corsHeaders);
      }
    }

    await supabase.from("documentos_compra").update({
      status: "aguardando_confirmacao",
      fornecedor: extraido.fornecedor || null,
      data_documento: extraido.data_documento || null,
      tipo_documento: extraido.tipo_documento || null,
      valor_total: round2(valorTotal),
    }).eq("id", documento_id);

    return json({ ok: true, itens_lidos: linhasParaGravar.length }, 200, corsHeaders);
  } catch (e) {
    return json({ error: String(e) }, 500, corsHeaders);
  }
});

function round2(n: number) { return Math.round(n * 100) / 100; }
function json(body: unknown, status: number, extraHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...extraHeaders } });
}
