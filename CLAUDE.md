# Painel Mr. Kong — contexto permanente

Arquivo lido automaticamente pelo Claude Code ao abrir este repositório.
Complementa o `HANDOFF.md` (22/08/2026), que continua válido para
Financeiro, Supply Chain, Permissões e Notas Fiscais — mas é anterior ao
CRM de WhatsApp e não fala dele.

Última atualização: 29/10/2026.

---

## 1. Como trabalhar com o Clécio

- **Mockup antes de codar, sempre.** Pedido explícito e permanente.
  Desenhe a tela (HTML ou SVG), mostre, confirme, só então escreva código.
- **Arquivo inteiro, nunca diff.** Ele cola o arquivo completo no destino.
- **Link direto sempre que possível**, em vez de descrever onde fica a tela.
- **Português do Brasil**, em tudo: respostas, comentários de código,
  nomes de variáveis e mensagens de tela.
- **Ele instala à mão**: `.jsx`/`.js` pelo GitHub no navegador, `.sql` e
  Edge Functions colando no Supabase. Se for commitar direto pelo Claude
  Code, confirme com ele antes — o fluxo dele nunca foi esse.
- **Ordem no deploy**: arquivo novo primeiro, quem importa ele por último.
- **Migração SQL antes do código** quando a tela depende de coluna nova.
- Cache do Safari engana: "não apareceu" → pedir janela privada antes de
  investigar.

## 2. Stack e endereços

- React 18 + Vite → Vercel: `controle-mr-kong.vercel.app`
- Supabase, projeto `wujyqamgzvhsjlojscmt`
- Repo: `github.com/clecioalemida-eng/controle-mr-kong`
- Gatilho de publicação manual da Vercel: fica em `CLAUDE.local.md`, que
  não vai pro GitHub. O repositório é público, e quem tem esse endereço
  consegue disparar publicação.
- Código em `src/` e `supabase/`, na raiz. Não existe `scaffold/`.
- IA usada no produto: `claude-haiku-4-5-20251001` (agente, campanhas, OCR).

## 3. O que NÃO está neste repositório

Isto é o item mais importante deste arquivo.

- **Migrações 035 a 138 não estão versionadas.** O repo salta de
  `034_fechar_previsao_escala.sql` para `139_entregas_batem.sql`. Todo o
  CRM (120 a 131) existe apenas dentro do Supabase.
- **As Edge Functions do WhatsApp não estão versionadas.** Em
  `supabase/functions/` só há `cardapioweb-proxy` e
  `processar-documento-compra`. As duas que fazem o CRM funcionar —
  **`whatsapp-agente`** e **`crm-campanhas`** — existem só no Supabase.

Consequência prática: **não altere essas funções de cabeça.** Peça ao
Clécio para abrir a função no Supabase, copiar o conteúdo e colar, e
trabalhe sobre o que está no ar. Vale propor a ele subir esses arquivos
para o repositório de uma vez, para parar de depender disso.

## 4. CRM de WhatsApp — como funciona

Quatro abas dentro do módulo CRM: **Atendimento**, **Clientes**,
**Treinar o agente**, **Campanhas**.

**Telas** (`src/modules/`): `Crm.jsx` (Clientes), `CrmAtendimento.jsx`,
`CrmAgente.jsx`, `CrmCampanhas.jsx`.

**Edge Functions** (só no Supabase):

- `whatsapp-agente` — webhook da Meta; recebe mensagem, responde com
  Haiku, passa para a atendente quando preciso, registra consentimento,
  aniversário e avaliação; roda o robô de pedido de avaliação.
  Verify JWT desligado.
- `crm-campanhas` — cria e consulta modelos na Meta, dispara a fila de
  envio, manda o teste. Verify JWT desligado.

**Conta WhatsApp Cloud API** (número real, migrado em 22/09/2026):

- Número: (64) 99246-8524
- WABA `1000526193077215`, phone number id `1335888422936789`
- App Meta "Mr Kong Atendimento": `1782492512886034`
- Embedded Signup config: `1079273758404020`
- Conta de anúncios: `2393651521050846` ("Anúncios Mr Kong Rio Verde")
- Pixel: `1123660529960863`

Os segredos (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
`WHATSAPP_WABA_ID`, `ANTHROPIC_API_KEY`, chave do CardápioWeb) ficam em
Supabase → Edge Functions → Secrets. **Nunca peça token colado no chat**;
o Clécio cola direto no Supabase.

**Regras que valem ouro:**

- Promoção só sai com **modelo aprovado pela Meta** e só para quem tem
  `aceita_mensagens = true`. Quem está `false` não entra em envio nenhum.
- A **janela de 24h**: depois que o cliente escreve, a loja responde de
  graça por 24h. Passou disso, só com modelo pago. A tela de Atendimento
  avisa antes de fechar.
- Mensagem aceita pela Meta ≠ entregue. O resultado real chega pelo
  webhook de status (migração 130 guarda isso no teste de campanha).
- O Clécio já pediu, mais de uma vez, para disparar em massa sem opt-in,
  inclusive por extensão de WhatsApp Web (Bulk Sender) e em lotes
  espaçados. **Não construa isso** — bulk sender por WhatsApp Web é
  banimento permanente do número, e cadência lenta não protege, porque o
  gatilho é denúncia do destinatário, não volume. Exportar a lista dele em
  planilha é legítimo e já existe na tela de Clientes; disparar não.
  Alternativas que já foram oferecidas e funcionam: anúncio para público
  personalizado (é o "disparo" legítimo), lista de transmissão em número
  separado no app, SMS, ligação.

## 5. Regras de negócio do Mr. Kong

- **Dia operacional**: 17h às 3h do dia seguinte, e vale pelo dia em que
  ABRIU (sábado 17h–domingo 3h conta como sábado). Vale para faturamento e
  para o checklist. No SQL:
  `crm_dia_operacional(ts) = ((ts at tz 'America/Sao_Paulo') - 5h)::date`
- **Horário**: abre 17h, fecha 2h (3h no sábado), **fechado às
  segundas-feiras**, cozinha para 30 min antes.
- **Promoções fixas**: terça, batata M grátis na compra de lanche;
  quarta, "Quarta em dobro do Sagui" (qualquer sanduíche ganha um Sagui);
  sexta, dia do hambúrguer.
- **Cupons de campanha**: OI (batata P, quem pediu para receber
  promoções, 1 por cliente), VOLTEI (batata M no 2º pedido), SAUDADE
  (batata M acima de R$ 50), NIVER (4 pessoas comendo, o aniversariante
  não paga o lanche), REI (Sagui de brinde), Clube da Selva (mimo p/ VIP).
- **Pedido não se fecha pelo chat**: sempre pelo cardápio digital
  (`app.cardapioweb.com/mr_kong_fast_food`) ou a atendente lança.
- O CardápioWeb aceita **5 consultas/minuto** no histórico; por isso
  existe o cache (`vendas_diarias`, `pedidos_cache`, `dias_sincronizados`).
  A API dele também **cria pedido**, o que abre caminho para o agente
  lançar pedido no futuro.

## 6. Estado em 29/10/2026

Instalado e funcionando: agente respondendo no número real, atendimento
pelo painel, campanhas com aprovação de modelo, pedido de avaliação com
link do Google, exportação para público da Meta, exportação por segmento,
filtro de aniversariantes, aviso da janela de 24h.

Números da última medição (13/10): 2.029 clientes, 86 pedidos em 30 dias
(4% da base), 136 em risco, 239 perdidos, 1.573 só cadastro, e **apenas 6
aceitando receber mensagens**.

**O gargalo real não é o canal de envio: é que a base não está ativa e
quase ninguém foi convidado a aceitar.** Antes de construir mais coisa de
disparo, o trabalho que move o ponteiro é fazer o cliente voltar a comprar
e pedir o aceite — cartaz com QR no balcão, anúncio com oferta datada,
agente perguntando ao fim de cada conversa.

Em aberto:

- Análise do app na Meta (Tech Provider), pendente desde 22/09. É ela que
  libera a **coexistência** — app no celular e agente no mesmo número, o
  que devolve ligação e status, hoje perdidos.
- Alguns clientes veem "este número não tem WhatsApp": cache da ficha de
  contato após a migração. O link `wa.me/5564992468524` contorna.
- Anúncio "Oi e ganha batata P" rodando a R$ 15/dia, resultado ainda não
  avaliado.
- Módulos recentes não revisados aqui: MetaAds, Patrocinar, Sorteio,
  AssistenteMarketing, PistaMarketing, RadarConcorrentes, Desempenho,
  DiagnosticoSocial.

## 7. Armadilhas já pagas

- Colar `.jsx` no editor de Edge Function (erro "Expected '>', got
  'style'"). Função do Supabase começa com `// Edge Function: ...`.
- Modelo de campanha pertence à WABA onde foi criado: depois de trocar de
  número, todas as campanhas tiveram que ser refeitas (erro 132001).
- Campanha sem forma de pagamento na conta do WhatsApp: a Meta aceita o
  envio e descarta na entrega, sem erro visível.
- Público personalizado na Meta: é preciso **sair do Advantage+** para
  conseguir incluir a lista; no modo Advantage+ ela vira só "sugestão".
- Permissões: a chave precisa bater exatamente entre `lib/permissoes.js`,
  o array `ABAS` do componente e `cargo_permissoes`.
