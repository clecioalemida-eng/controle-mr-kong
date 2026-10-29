// Edge Function: processar-documento-compra  — reescrita
//
// O QUE ESTAVA ERRADO E POR QUE
//
// 1. TEMPO. Tudo acontecia dentro da requisicao: baixar o arquivo,
//    converter, chamar a IA, gravar. Numa nota grande isso passava de 75
//    segundos e a funcao era morta pelo relogio. Morta sem resposta, o
//    supabase-js quebrava tentando ler um cabecalho que nunca veio, e a
//    tela mostrava "Cannot read properties of undefined (toLowerCase)"
//    pra quem so queria subir uma nota.
//    AGORA: responde 202 na hora e continua trabalhando por tras. Nao
//    existe mais leitura que morre sem deixar recado.
//
// 2. O CLIENTE VIRAVA FORNECEDOR. Nada dizia a IA que o MR. KONG e o
//    comprador. Ela via o CNPJ mais destacado do papel e devolvia
//    "MR. KONG FAST FOOD" como fornecedor.
//    AGORA: o nome e o CNPJ da casa entram no prompt como PROIBIDOS.
//
// 3. TITULO DE SECAO VIRAVA PRODUTO. "Condicoes de Pagamento" virou o
//    produto "Condogos Pagamento". "Vendedor"/"Observacoes" viraram
//    "Vendagem Sobr.". A IA nao estava lendo a tabela de itens; estava
//    varrendo o papel inteiro.
//    AGORA: o prompt manda achar a TABELA de itens primeiro, e lista o
//    que fica de fora: cabecalho, rodape, condicoes de pagamento,
//    vendedor, observacoes, totais, impostos, dados de entrega.
//
// 4. NUMERO LIDO ERRADO PASSAVA. O prompt PEDIA pra IA conferir se
//    quantidade x preco fecha com o total da linha — mas ninguem
//    conferia depois. Foi assim que "20,000" (vinte, com tres casas)
//    virou vinte mil.
//    AGORA: a conta e refeita no servidor. Se nao fechar, o preco
//    unitario e recalculado a partir do total, que e o numero mais
//    confiavel de uma nota. Pedir pra IA conferir e' torcer; refazer a
//    conta e' verificar.
//
// 5. A IA CONVERTIA UNIDADE NO CHUTE. O schema so aceitava un/g/kg/ml/l,
//    entao ela era obrigada a inventar que 1 caixa = 12 unidades.
//    AGORA: ela devolve a unidade COMO ESTA IMPRESSA (CX, PA, FD, DZ) e
//    quem traduz e o banco, pela regra deterministica da migration 112.
//    Chute de modelo trocado por tabela de conversao.
//
// 6. MODELO CRAVADO NO CODIGO. Um nome de modelo que sai do ar derruba
//    a leitura inteira.
//    AGORA: vem do secret ANTHROPIC_MODEL, com uma fila de reserva. Se
//    o primeiro nao existir, tenta o proximo sozinho.
//
// 7. O QUE NAO E INSUMO (migracao 171, 29/10/2026). Desinfetante,
//    compressor, desconto e Pix eram casados com insumo por aproximacao
//    de nome, ou ficavam sem vinculo e travavam a nota.
//    AGORA: o nome que alguem ja marcou na conferencia como "nao e
//    insumo" (tabela nomes_nao_insumo) chega resolvido, com o centro de
//    custo escolhido, e nenhum casamento passa por cima disso.
//
// Nada aqui entra no estoque nem no custo: continua gravando como
// "aguardando_confirmacao", e so a conferencia na tela efetiva.

import { createClient } from "npm:@supabase/supabase-js@2";

// ---------------------------------------------------------------------
// Quem e a casa. O documento NUNCA pode dizer que a casa e o fornecedor.
// Vem de secret pra nao ficar cravado, mas com o valor certo por padrao.
// ---------------------------------------------------------------------
const EMPRESA_NOME = Deno.env.get("EMPRESA_NOME") ?? "MR. KONG FAST FOOD LTDA";
const EMPRESA_CNPJ = Deno.env.get("EMPRESA_CNPJ") ?? "21.710.537/0001-15";

// Fila de modelos. O primeiro que responder ganha. Existe porque eu nao
// posso garantir que um nome de modelo continue valido pra sempre — e
// leitura de nota nao pode parar por causa disso.
const MODELOS = [
  Deno.env.get("ANTHROPIC_MODEL"),
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
].filter(Boolean) as string[];

const LIMITE_ALERTA_PRECO = 0.30;   // 30% acima da ultima compra -> alerta
const TOLERANCIA_LINHA    = 0.02;   // 2% de diferenca ainda e arredondamento
const TIMEOUT_IA_MS       = 120000; // a IA tem 2 min; o usuario ja foi embora

function normalizar(s: string) {
  return String(s || "").toLowerCase().normalize("NFD")
    .replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}
function round2(n: number) { return Math.round((Number(n) || 0) * 100) / 100; }
function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function json(body: unknown, status: number, extra: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json", ...extra },
  });
}

// Base64 em blocos. O jeito antigo montava a string caractere a
// caractere: numa foto de 4 MB sao 4 milhoes de concatenacoes, e cada
// uma copia a string inteira. Sozinho isso ja comia dezenas de segundos
// do orcamento que faltou no fim.
function paraBase64(bytes: Uint8Array) {
  const BLOCO = 0x8000;
  const partes: string[] = [];
  for (let i = 0; i < bytes.length; i += BLOCO) {
    partes.push(String.fromCharCode(...bytes.subarray(i, i + BLOCO)));
  }
  return btoa(partes.join(""));
}

// Junta linhas que sao o mesmo produto ao mesmo preco (tres pacotes de
// queijo pesados separados viram uma linha so).
function consolidarIguais(itens: ItemLido[]) {
  const grupos = new Map<string, ItemLido>();
  for (const item of itens) {
    const chave = `${normalizar(item.nome)}|${normalizar(item.unidade)}|${item.preco_unitario}`;
    const existente = grupos.get(chave);
    if (existente) {
      existente.quantidade = round2(existente.quantidade + item.quantidade);
      existente.valor_total = round2((existente.valor_total || 0) + (item.valor_total || 0));
    } else {
      grupos.set(chave, { ...item });
    }
  }
  return Array.from(grupos.values());
}

type ItemLido = {
  nome: string;
  quantidade: number;
  unidade: string;
  preco_unitario: number;
  valor_total?: number;
  recalculado?: boolean;
};

// ---------------------------------------------------------------------
// A CONFERENCIA DE CONTA
//
// Numa nota, o valor TOTAL da linha e o numero mais confiavel: e o que
// o fornecedor cobrou e o que soma no rodape. Quantidade e preco
// unitario sao onde a virgula se perde ("20,000" lido como vinte mil).
//
// Entao: se quantidade x unitario nao fecha com o total, o total manda,
// e o unitario e refeito. Isso sozinho resolve a familia inteira de erro
// de casa decimal — sem depender da IA ter conferido.
// ---------------------------------------------------------------------
function reconciliar(item: ItemLido): ItemLido {
  const qtd = num(item.quantidade);
  const pu = num(item.preco_unitario);
  const total = num(item.valor_total);

  // Falta o total: nao da pra conferir, fica como veio.
  if (total <= 0) {
    if (qtd > 0 && pu > 0) return { ...item, valor_total: round2(qtd * pu) };
    return item;
  }
  // Falta a quantidade, mas da pra deduzir.
  if (qtd <= 0 && pu > 0) {
    return { ...item, quantidade: round2(total / pu), recalculado: true };
  }
  // Falta o preco unitario, mas da pra deduzir.
  if (pu <= 0 && qtd > 0) {
    return { ...item, preco_unitario: round2(total / qtd), recalculado: true };
  }
  if (qtd <= 0 || pu <= 0) return item;

  const esperado = qtd * pu;
  const folga = Math.max(0.05, Math.abs(total) * TOLERANCIA_LINHA);
  if (Math.abs(esperado - total) <= folga) return item;

  // Nao fechou. O total manda.
  return { ...item, preco_unitario: round2(total / qtd), recalculado: true };
}

// ---------------------------------------------------------------------
// O PROMPT
// ---------------------------------------------------------------------
function instrucoes(referencia: string) {
  return `Você está lendo a foto ou o PDF de um documento de compra de um restaurante (nota fiscal, cupom, recibo ou orçamento).

PRIMEIRO, ACHE A TABELA DE ITENS.
Todo documento de compra tem uma região onde os produtos estão listados em linhas, normalmente com colunas de código, descrição, quantidade, unidade, preço unitário e total. Só essa região interessa. Leia linha por linha, da esquerda para a direita, e não misture valores de linhas vizinhas.

NUNCA devolva como produto um texto que esteja fora dessa tabela. Em particular, NÃO são produtos:
- o cabeçalho e o logotipo (nome e endereço da empresa que emitiu)
- "Condições de Pagamento", "Forma de Pagamento", "Vencimento", "Parcelas"
- "Vendedor", "Observações", "Obs.", "Transportadora", "Dados de Entrega"
- linhas de total, subtotal, desconto, frete, impostos (ICMS, IPI, ST)
- rodapé, número do documento, chave de acesso, mensagens jurídicas
Se você não tem certeza de que um texto é uma linha da tabela de itens, deixe de fora. Uma nota com 3 itens certos vale mais que uma com 5 itens dos quais 2 são invenção.

O FORNECEDOR NUNCA É O COMPRADOR.
Este documento foi emitido PARA a empresa "${EMPRESA_NOME}", CNPJ ${EMPRESA_CNPJ}. Ela é a CLIENTE. Se esse nome ou esse CNPJ aparecer no documento — inclusive em destaque, no topo, ou como "Cliente", "Destinatário", "Sacado" — ele NÃO é o fornecedor. O fornecedor é a OUTRA empresa, a que emitiu/vendeu. Se houver dois CNPJs, o fornecedor é o que não é ${EMPRESA_CNPJ}. Se você não conseguir identificar com segurança quem emitiu, devolva fornecedor vazio em vez de chutar.

NÚMEROS.
Para cada linha devolva quantidade, preço unitário E o valor total da linha, exatamente como impressos. Se algum dos três não estiver impresso, devolva 0 nele — não calcule para preencher, o servidor faz essa conta.
Atenção com separadores: no Brasil a vírgula é decimal e o ponto é milhar. "20,000" com três casas depois da vírgula é VINTE, não vinte mil. "1.250,00" é mil duzentos e cinquenta.

UNIDADE.
Devolva a unidade EXATAMENTE como está escrita no documento (UN, CX, PA, FD, PCT, DZ, KG, LT, G, ML, PÇ, SC...). NÃO converta, NÃO interprete, NÃO transforme caixa em unidades. Copie a sigla. A conversão é feita depois, fora daqui.

DATA.
Use a data de emissão do documento, em YYYY-MM-DD. Se houver várias datas (emissão, vencimento, saída), use a de EMISSÃO. Se não houver data legível, devolva vazio — não invente e não use a data de hoje.

SE A IMAGEM ESTIVER RUIM.
Trecho borrado, cortado, com reflexo ou ilegível: não preencha a lacuna com um palpite. Devolva só o que dá para ler com confiança.${referencia}`;
}

// ---------------------------------------------------------------------
// A chamada, com fila de modelos e relogio proprio
// ---------------------------------------------------------------------
async function lerComIA(opts: {
  chave: string; base64: string; mediaType: string; ehPdf: boolean; referencia: string;
}) {
  const ferramenta = {
    name: "registrar_documento",
    description: "Registra os dados extraídos de um documento de compra.",
    input_schema: {
      type: "object",
      properties: {
        fornecedor: { type: "string", description: `Quem EMITIU/VENDEU. Nunca "${EMPRESA_NOME}". Vazio se incerto.` },
        data_documento: { type: "string", description: "Data de emissão, YYYY-MM-DD. Vazio se ilegível." },
        tipo_documento: { type: "string", enum: ["nota_fiscal", "recibo"] },
        valor_total_documento: { type: "number", description: "Total geral impresso no documento, 0 se não houver." },
        itens: {
          type: "array",
          items: {
            type: "object",
            properties: {
              nome: { type: "string", description: "Descrição do produto como está na linha da tabela." },
              quantidade: { type: "number", description: "Como impresso. 0 se não houver." },
              unidade: { type: "string", description: "A sigla como impressa (UN, CX, PA, KG...). Não converta." },
              preco_unitario: { type: "number", description: "Como impresso. 0 se não houver." },
              valor_total: { type: "number", description: "Total da linha como impresso. 0 se não houver." },
            },
            required: ["nome", "quantidade", "unidade", "preco_unitario", "valor_total"],
          },
        },
      },
      required: ["itens"],
    },
  };

  const corpo = (modelo: string, tipo: string) => JSON.stringify({
    model: modelo,
    max_tokens: 4000,
    temperature: 0,
    tools: [ferramenta],
    tool_choice: { type: "tool", name: "registrar_documento" },
    messages: [{
      role: "user",
      content: [
        { type: opts.ehPdf ? "document" : "image",
          source: { type: "base64", media_type: tipo, data: opts.base64 } },
        { type: "text", text: instrucoes(opts.referencia) },
      ],
    }],
  });

  let ultimoErro = "";
  for (const modelo of MODELOS) {
    // Tipos a tentar: o detectado pelos bytes, e depois os dois que
    // cobrem quase toda foto de celular. Sem repetir o mesmo tipo.
    const tipos = opts.ehPdf
      ? [opts.mediaType]
      : [...new Set([opts.mediaType, "image/png", "image/jpeg"])];

    for (const tipo of tipos) {
      let r: Response;
      try {
        r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: AbortSignal.timeout(TIMEOUT_IA_MS),
          headers: {
            "x-api-key": opts.chave,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: corpo(modelo, tipo),
        });
      } catch (e) {
        ultimoErro = `Falha de rede com a IA (${modelo}): ${String(e).slice(0, 200)}`;
        break; // proximo modelo
      }

      if (r.ok) {
        const dados = await r.json();
        const bloco = (dados.content || []).find((b: any) => b.type === "tool_use");
        if (bloco) return { ok: true as const, extraido: bloco.input, modelo };
        // Respondeu sem preencher a ficha. Trocar o tipo da imagem nao
        // muda isso; trocar de modelo pode.
        ultimoErro = `${modelo}: respondeu sem preencher a ficha do documento.`;
        break;
      }

      const detalhe = (await r.text()).slice(0, 400);
      ultimoErro = `${modelo}: ${detalhe}`;

      // Modelo inexistente ou nao liberado nesta conta: proximo da fila.
      if (r.status === 404 ||
          (/model/i.test(detalhe) && /not.?found|invalid|does not exist/i.test(detalhe))) {
        break;
      }
      // Tipo de imagem recusado: a resposta diz qual e o certo. Vale
      // tentar o proximo tipo COM O MESMO modelo.
      if (/image\/(png|jpeg|webp|gif)/.test(detalhe)) continue;

      // Qualquer outro erro: insistir neste modelo nao ajuda.
      break;
    }
  }
  return { ok: false as const, erro: ultimoErro || "Não consegui falar com a IA." };
}

// ---------------------------------------------------------------------
// O TRABALHO PESADO — roda DEPOIS da resposta ter sido enviada
// ---------------------------------------------------------------------
async function processar(supabase: any, documento: any, chave: string) {
  const documento_id = documento.id;
  const marcarErro = async (msg: string) => {
    await supabase.from("documentos_compra")
      .update({ status: "erro", erro_mensagem: msg.slice(0, 500) })
      .eq("id", documento_id);
  };

  try {
    // 1) Arquivo
    const { data: arquivo, error: dlErr } = await supabase.storage
      .from("notas-fiscais").download(documento.arquivo_path);
    if (dlErr || !arquivo) return marcarErro("Não achei o arquivo no Storage.");

    const bytes = new Uint8Array(await arquivo.arrayBuffer());
    const base64 = paraBase64(bytes);

    // Tipo pelos primeiros bytes, nao pelo nome: nome de arquivo mente.
    const ehPdf  = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
    const ehPng  = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
    const ehWebp = bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    const mediaType = ehPdf ? "application/pdf" : ehPng ? "image/png" : ehWebp ? "image/webp" : "image/jpeg";

    // 2) O que ja foi confirmado antes, como referencia de nome e faixa
    //    de preco. Nao corrige leitura ruim sozinho, mas evita repetir o
    //    mesmo erro num produto que ja passou por aqui.
    let referencia = "";
    const { data: docsOk } = await supabase.from("documentos_compra")
      .select("id").eq("status", "confirmado")
      .order("confirmado_em", { ascending: false }).limit(50);
    const ids = (docsOk || []).map((d: any) => d.id);
    if (ids.length > 0) {
      const { data: hist } = await supabase.from("itens_documento_compra")
        .select("nome_lido, unidade, preco_unitario, insumo:insumos(nome)")
        .in("documento_id", ids).limit(300);
      const vistos = new Set<string>();
      const linhas: string[] = [];
      for (const h of hist || []) {
        const k = normalizar(h.nome_lido);
        if (vistos.has(k)) continue;
        vistos.add(k);
        const ins = (h as any).insumo?.nome;
        linhas.push(`"${h.nome_lido}" -> ${h.unidade}, ~R$${h.preco_unitario}${ins ? `, insumo: ${ins}` : ""}`);
        if (linhas.length >= 40) break;
      }
      if (linhas.length > 0) {
        referencia = `\n\nPRODUTOS JÁ CONFIRMADOS ANTES NESTE SISTEMA (referência de escrita e faixa de preço — confira sempre contra o que está impresso NESTA nota, não copie automaticamente):\n${linhas.join("\n")}`;
      }
    }

    // 3) A leitura
    const leitura = await lerComIA({ chave, base64, mediaType, ehPdf, referencia });
    if (!leitura.ok) return marcarErro(`Erro ao consultar a IA. ${leitura.erro}`);

    const extraido = leitura.extraido as {
      fornecedor?: string; data_documento?: string;
      tipo_documento?: "nota_fiscal" | "recibo";
      valor_total_documento?: number; itens?: ItemLido[];
    };

    // 4) Rede de seguranca do fornecedor: se a IA devolveu a propria casa
    //    apesar do prompt, e melhor ficar vazio do que errado. Vazio o
    //    usuario preenche; errado ele nao percebe.
    let fornecedor = (extraido.fornecedor || "").trim();
    const casa = normalizar(EMPRESA_NOME);
    const casaCurto = casa.split(" ").slice(0, 2).join(" ");
    if (fornecedor && (normalizar(fornecedor).includes(casaCurto) ||
                       fornecedor.replace(/\D/g, "").includes(EMPRESA_CNPJ.replace(/\D/g, "")))) {
      fornecedor = "";
    }

    // 5) Conta refeita linha a linha, depois consolidacao
    const reconciliados = (extraido.itens || [])
      .filter((i) => (i?.nome || "").trim().length > 1)
      .map(reconciliar);
    const itens = consolidarIguais(reconciliados);

    // 6) Casamento com insumo: nao-insumo -> exato -> sinonimo ->
    //    conteudo (com piso de tamanho, senao "oleo" casa com "oleo de
    //    motor" e o custo vai pro lugar errado)
    const { data: insumos } = await supabase.from("insumos").select("id, nome, custo_medio_atual");
    const { data: sinonimos } = await supabase.from("insumo_sinonimos").select("nome_variante, insumo_id");
    // Nomes marcados na conferencia como "nao e insumo". Se a 171 ainda
    // nao rodou, a consulta falha, volta vazio e nada muda.
    const { data: naoInsumos } = await supabase.from("nomes_nao_insumo").select("nome_variante, despesa_centro");
    const porNome = new Map((insumos || []).map((i: any) => [normalizar(i.nome), i]));
    const porSinonimo = new Map((sinonimos || []).map((s: any) => [normalizar(s.nome_variante), s.insumo_id]));
    const porNaoInsumo = new Map((naoInsumos || []).map((n: any) => [normalizar(n.nome_variante), n.despesa_centro]));

    let somaLinhas = 0;
    const linhas = itens.map((item) => {
      const total = num(item.valor_total) || round2(num(item.quantidade) * num(item.preco_unitario));
      somaLinhas += total;
      const k = normalizar(item.nome);

      // "Nao e insumo" vem antes de qualquer casamento: foi uma pessoa
      // que decidiu, e a aproximacao por nome logo abaixo nao pode passar
      // por cima disso e vincular o item num insumo qualquer.
      if (porNaoInsumo.has(k)) {
        return {
          documento_id,
          nome_lido: item.nome.trim(),
          quantidade: num(item.quantidade),
          unidade: (item.unidade || "un").trim(),
          preco_unitario: num(item.preco_unitario),
          insumo_id: null,
          despesa_centro: porNaoInsumo.get(k),
          alerta_preco: false,
          preco_anterior: null,
        };
      }

      let insumo: any = porNome.get(k);
      if (!insumo && porSinonimo.has(k)) {
        insumo = (insumos || []).find((i: any) => i.id === porSinonimo.get(k));
      }
      if (!insumo) {
        // O mais longo que couber dentro do outro, com pelo menos 5
        // letras. Casamento curto demais e' coincidencia, nao acerto.
        let melhor: any = null;
        for (const i of insumos || []) {
          const n = normalizar(i.nome);
          if (n.length < 5) continue;
          if (k.includes(n) || n.includes(k)) {
            if (!melhor || n.length > normalizar(melhor.nome).length) melhor = i;
          }
        }
        insumo = melhor;
      }

      let alerta = false;
      let precoAnterior: number | null = null;
      if (insumo && num(insumo.custo_medio_atual) > 0) {
        precoAnterior = insumo.custo_medio_atual;
        if (num(item.preco_unitario) > insumo.custo_medio_atual * (1 + LIMITE_ALERTA_PRECO)) alerta = true;
      }

      return {
        documento_id,
        nome_lido: item.nome.trim(),
        quantidade: num(item.quantidade),
        // Unidade crua de proposito: o gatilho da 112 traduz no banco.
        unidade: (item.unidade || "un").trim(),
        preco_unitario: num(item.preco_unitario),
        insumo_id: insumo?.id ?? null,
        alerta_preco: alerta,
        preco_anterior: precoAnterior,
      };
    });

    if (linhas.length === 0) {
      return marcarErro(
        "Não achei nenhuma linha de produto neste documento. " +
        "Tente uma foto mais fechada, só da tabela de itens, ou lance por Compra manual."
      );
    }

    const { error: errItens } = await supabase.from("itens_documento_compra").insert(linhas);
    if (errItens) return marcarErro(`Erro ao gravar os itens: ${errItens.message}`);

    // 7) Diagnostico: a soma das linhas bate com o total impresso?
    //    Nao bloqueia nada — fica gravado pra quando eu precisar entender
    //    uma leitura torta sem ter o papel na mao.
    const totalImpresso = num(extraido.valor_total_documento);
    const recalculadas = itens.filter((i) => i.recalculado).length;
    const notas: string[] = [`modelo: ${leitura.modelo}`, `linhas: ${linhas.length}`];
    if (recalculadas > 0) notas.push(`${recalculadas} preço(s) refeito(s) pelo total da linha`);
    if (totalImpresso > 0 && Math.abs(totalImpresso - somaLinhas) > Math.max(0.5, totalImpresso * TOLERANCIA_LINHA)) {
      notas.push(`ATENÇÃO: soma das linhas R$${round2(somaLinhas)} ≠ total impresso R$${round2(totalImpresso)}`);
    }

    await supabase.from("documentos_compra").update({
      status: "aguardando_confirmacao",
      fornecedor: fornecedor || null,
      data_documento: extraido.data_documento || null,
      tipo_documento: extraido.tipo_documento || null,
      valor_total: round2(somaLinhas),
      erro_mensagem: notas.join(" · ").slice(0, 500),
    }).eq("id", documento_id);
  } catch (e) {
    await marcarErro(`Falha inesperada na leitura: ${String(e)}`);
  }
}

// ---------------------------------------------------------------------
// A PORTA — rapida de proposito
// ---------------------------------------------------------------------
Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Não autenticado." }, 401, cors);

    const { data: perfil } = await supabase.from("perfis")
      .select("status").eq("id", userData.user.id).maybeSingle();
    if (!perfil || perfil.status !== "aprovado") {
      return json({ error: "Usuário sem acesso liberado." }, 403, cors);
    }

    const chave = Deno.env.get("ANTHROPIC_API_KEY");
    if (!chave) return json({ error: "ANTHROPIC_API_KEY não configurado nos secrets do projeto." }, 500, cors);

    const { documento_id } = await req.json();
    if (!documento_id) return json({ error: "Informe documento_id." }, 400, cors);

    const { data: documento, error: docErr } = await supabase
      .from("documentos_compra").select("*").eq("id", documento_id).single();
    if (docErr || !documento) return json({ error: "Documento não encontrado." }, 404, cors);

    // Daqui pra frente ninguem mais espera. A tela ja sabe consultar o
    // status do documento — e status gravado no banco sobrevive a tela
    // fechada, ao celular bloqueado e ao 4G que caiu.
    const tarefa = processar(supabase, documento, chave);
    // @ts-ignore — EdgeRuntime existe no runtime da Supabase
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(tarefa);
    } else {
      await tarefa; // ambiente sem background: volta ao comportamento antigo
    }

    return json({ ok: true, status: "processando", documento_id }, 202, cors);
  } catch (e) {
    return json({ error: String(e) }, 500, cors);
  }
});
