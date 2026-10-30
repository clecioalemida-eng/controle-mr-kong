# Painel Mr Kong — contexto para continuar o trabalho

Documento de passagem. Escrito em 29/10/2026, depois de uma sequência de
entregas feitas em conversa. Serve para quem for mexer no código sem ter
acompanhado o caminho até aqui.

---

## 1. O que é

Painel interno do **Mr Kong Fast Food** (Rio Verde / GO). Dono: Clecio.
Cobre operação (KDS, produção, estoque, equipe, financeiro), CRM com agente
de WhatsApp, e marketing (Meta Ads, patrocínio, sorteio).

- **Front:** React + Vite, deploy automático na **Vercel** a cada push.
- **Back:** **Supabase** — Postgres + RLS + Auth + Edge Functions + Storage.
- **Repositório:** `github.com/clecioalemida-eng/controle-mr-kong` (público).
- **Projeto Supabase (ref):** `wujyqamgzvhsjlojscmt`
- **Conta de anúncios Meta:** `act_2393651521050846` · API Marketing **v25.0**
- **Instagram:** `@mrkongrioverde`

### Como o dono trabalha (importante)

Ele **não usa git nem terminal**. Sobe arquivo pelo **editor web do GitHub**,
colando o conteúdo inteiro. Consequências práticas:

- Entregar **um arquivo por mensagem** quando os destinos forem diferentes.
  Já aconteceu de ele colar SQL dentro de um `.jsx` e quebrar o build.
- Sempre dizer **para onde vai cada arquivo**, entre os três destinos:
  **SQL Editor**, **Edge Function**, **GitHub**.
- Arquivo que ele precisa preencher deve **falhar de propósito** se não for
  editado. Já aconteceu de números de exemplo irem para produção.
- **Mockup antes de codar**, sempre.

---

## 2. Design do painel

Estilos inline, sem framework de CSS. Ícones: `lucide-react`. Mobile-first.

```
papel    #F6F1E7 / #F7F1E6      tinta   #22231F
régua    #E8E2D2 (bordas)       apoio   #8A8778 (texto secundário)
vermelho #C4432B                verde   #2F8F5B        ouro #C9A227
```

Os objetos de estilo (`cardStyle`, `sectionLabel`, `dica`, `btnPrimary`,
`btnSecondary`, `btnGhost`, `inputStyle`, `chip`, `avisoInfo`, `avisoErro`)
estão **repetidos no fim de cada módulo**, não centralizados. Ao criar um
módulo novo, copie o bloco do fim de `Patrocinar.jsx` ou `MetaAds.jsx`.

### Tom dos textos

O painel fala com quem está no balcão, não com programador. Mensagem de erro
diz o que fazer. Nunca deixar texto cru de biblioteca (Storage, Meta, Postgres)
chegar na tela em inglês — traduzir e explicar.

---

## 3. Mapa dos arquivos tocados recentemente

```
src/modules/
  MetaAds.jsx          abas do módulo Meta; registra Patrocinar e Sorteio
  Patrocinar.jsx       ~1.900 linhas; impulsionar post ou arquivo subido
  Sorteio.jsx          NOVO; sorteio pelos comentários
  CrmCampanhas.jsx     campanhas por segmento + botão "Baixar lista"
  CrmAtendimento.jsx   caixa de conversas (wa_conversas / wa_mensagens)
  Crm.jsx              lista de clientes, filtros e segmentos
  Desempenho.jsx       KDS, tempos por estação, ranking de pratos

supabase/functions/
  meta-ads-proxy/            o grande: anúncios, mídia, sorteio
  meta-encerrar-anuncio/     pausa anúncio (nunca apaga)
  meta-saldo-conta/          saúde financeira da conta
  meta-diagnostico-whatsapp/ só leitura; nunca foi confirmado que rodou
```

### Migrações aplicadas nesta rodada

| nº  | o que faz |
|-----|-----------|
| 047–056 | limpeza diária do KDS, ranking de pratos e linhas, início da medição, tempo por item, tempo do pedido, realtime, `criado_em`, resgate de item sem estação, log de encerramentos |
| 057 | pontos no mapa + interesses + WhatsApp na config de patrocínio |
| 058 | `anuncio_midias` + balde de Storage para anúncio sem post |
| 059 | upload de vídeo em pedaços, retomável |
| 060 | `patrocinios.midia_id` deixa de ser obrigatório + regra "ou post, ou arquivo" |
| 061 | solta também `midia_link` e `midias` |
| 062 | tabela `sorteios` + view `v_sorteios` |
| 063 | troca dos números de WhatsApp (ver abaixo) |
| 064 | `wa_linhas` + `linha_id` em `wa_conversas` e `wa_mensagens` |

---

## 4. O que foi construído e está no ar

### 4.1 Patrocinar — anúncio sem passar pelo feed

Permite subir vídeo ou foto e anunciar **sem postar no Instagram**.

- Upload vai para o Storage (balde `anuncios`) e de lá para a Meta.
- Vídeo sobe **em pedaços e é retomável**: a Edge Function tem orçamento de
  55 s (`ORCAMENTO_MS`); se estourar, devolve `estado: "enviando"` com o
  offset guardado e a tela chama de novo. A tela repete até 10 vezes.
- **Limite real de arquivo: 50 MB.** Não é escolha nossa — é o teto global do
  **plano Free do Supabase**, que ignora o `file_size_limit` do balde. A
  mensagem na tela já explica isso em português.
- Mapa com **vários pontos**, raio individual por ponto (`custom_locations` da
  Meta sempre foi array). Mapa abre em tela cheia; no tamanho normal a roda do
  mouse rola a página, não dá zoom.

**Armadilha conhecida:** `targeting_automation: { advantage_audience: 0 }` é
recusado pela Meta desde out/2026. O proxy tenta, e se o erro mencionar
`advantage_audience` ou `targeting_automation`, refaz sem o campo e devolve
`publico_ampliado: true`.

### 4.2 Sorteio pelos comentários

Aba **Meta → Sorteio**.

Por que comentário: a Meta entrega **contagem** de curtidas, reposts e
seguidores — nunca os nomes. Comentário é o único lugar onde vem o `@`.
Isso não tem contorno; não aceitar pedido de "sortear quem curtiu".

Escopos: `post` (um post), `periodo` (todos os posts entre duas datas),
`colado` (lista de `@` colada à mão — para post de colaboração que pertence a
**outra conta**, cujos comentários a Meta não libera).

Regras: `pessoa` (uma chance por pessoa), `comentario` (uma por comentário,
com teto opcional), `marcou` (só quem escreveu um `@` no texto). Mais mínimo
de comentários por pessoa, janela de datas, e descarte de respostas e dos
comentários da própria casa.

**O que torna o sorteio defensável:** a semente é sorteada por `crypto` mas o
resto é determinístico. Semente + lista, ambas gravadas, permitem a qualquer
pessoa refazer e chegar no mesmo nome. Os descartados são gravados **com o
motivo** e mostrados riscados na tela.

Ações no proxy: `sorteio_previa` (monta e conta, não sorteia) e `sortear`
(monta **de novo**, sorteia, grava). A prévia não é reaproveitada de
propósito: entre uma e outra o post segue recebendo comentário.

Limite: para de ler em **3.000 comentários** por post e avisa `truncado: true`
na tela, em vez de devolver meia lista.

Lógica testada com 16 verificações, incluindo: mesma semente → mesmo
resultado; peso respeitado (999 contra 1 ganhou 300/300); e 6.000 sorteios
entre 50 nomes iguais com distribuição entre 94 e 150 (esperado 120).

### 4.3 Baixar lista por segmento

Botão em cada cartão de **CRM → Campanhas**. Pontos que não podem se perder
numa futura refatoração:

- **Telefone é a primeira coluna.** Importadores de lista leem a coluna 1
  como número e ignoram o resto.
- CSV com `;`, BOM `﻿` e vírgula decimal — é o que o Excel em português
  abre com duplo clique.
- **Pagina de 1.000 em 1.000.** O segmento "cadastro" tem 1.571; sem paginar,
  o arquivo sai cortado sem avisar.
- Baixa o segmento **inteiro**, não só quem aceitou mensagem. A proteção de
  opt-in vive na hora de montar campanha, não aqui.
- As regras de segmento são as mesmas de `Crm.jsx`: `eq("segmento", chave)`,
  mais dois casos especiais — `aniversario_mes` usa a coluna gerada
  `aniversario_mes`, e `sem_aniversario` usa `aniversario is null`.

---

## 5. Problemas resolvidos que valem lembrar

**Pedido fantasma no aplicativo.** Item que entra por `origem = 'webhook'`
nasce com `setor` NULL, e **nenhuma tela de produção mostra item sem estação**
(cada uma filtra pelo próprio setor). Resultado: pedido que ninguém fez.
Causa: 14 produtos nunca mapeados. Existem variantes de grafia
(`"Milkshake 500ml"` e `"Milkshake 500 ml"`) que recriam o problema.
Função de resgate pronta: `select kds_resgatar_sem_estacao();`
**O webhook ainda não foi corrigido — o problema volta a cada produto novo.**

**Tempo do pedido é o máximo, não a soma nem a média.** Com chapa 8 s,
cozinha 5 s e bar 6 s começando juntos, o cliente esperou 8. Somar dá 19;
dividir por 3 dá 6,3 — menos que uma estação sozinha. A diferença entre a
duração total e a estação mais lenta virou `perdido_na_largada`, que é o
número acionável.

**Erro Meta 100/2446886.** O proxy procurava um número de WhatsApp nos
conjuntos da agência para copiar; como nenhum tinha, mandava só `page_id` e a
Meta recusava. Corrigido com `promoted_object.whatsapp_phone_number` explícito.

**Erro Meta 100/1487246.** "This WhatsApp phone number is not linked to your
account". Acontece quando o número não é um **WhatsApp Business vinculado à
Página**. Não adianta cadastrar número certo se a vinculação não existe.

---

## 6. Dados que valem conhecer

**Números de WhatsApp da casa:**

> **Corrigido em 30/10/2026.** A versão anterior desta lista dizia que o
> `5564992010442` era o número do agente e dos anúncios. Não é. Detalhes em
> `docs/marketing-resumo-2026-10-30.md`.

- `5564992468524` — **(64) 99246-8524, o número do agente** (API oficial da
  Meta desde 22/09/2026). Conectado, qualidade Alta no Business Manager.
  Só-API: não dá para vincular à Página pelo Facebook (o código chega por
  WhatsApp, e ele não tem app).
- `5564992010442` — (64) 99201-0442. Está no portfólio da Meta **e** num app
  de WhatsApp em algum celular (o Facebook aceita vincular à Página). Em
  30/10 ninguém sabia onde está o aparelho. Ainda é o único cadastrado em
  `patrocinio_config.whatsapp_numeros`, e anunciar para ele dá 1487246
  enquanto não estiver vinculado à Página.
- `5564992667645` — celular do balcão, pessoa atende. **Não** está na Meta e
  **não deve** ser oferecido como destino de anúncio: dá 1487246.
- `5564992273857` — (64) 99227-3857. Apareceu preenchido sozinho ao vincular
  WhatsApp na Página pelo Facebook. De quem é ainda não se sabe.

**Página do Facebook sem WhatsApp:** em 30/10 a Página Mr Kong Rio Verde
tinha só o Instagram conectado. É a causa dos erros 2446886 e 1487246 nos
anúncios de "Mensagens no WhatsApp". "Visitas ao cardápio" funciona.

**Opt-in de campanha:** 8 de 2.066 clientes aceitaram receber. Esse é o
gargalo real do CRM, não a ferramenta de disparo.

**Segmentos de cliente** (`clientes.segmento`): `novo`, `recorrente`, `vip`,
`em_risco`, `perdido`, `cadastro`. Tamanhos: VIP 6, Recorrentes 14, Novos 55,
Em risco 106, Perdidos 287, Só cadastro 1.571.

---

## 7. Onde paramos

### 7.1 Em andamento: segunda linha de WhatsApp por QR code

O dono quer que o número do balcão (`5564992667645`) **continue tocando no
celular** e também apareça no painel. Isso é impossível pela API oficial — a
Cloud API exige que o número saia do app. O caminho é a tecnologia do WhatsApp
Web: **Evolution API** (Baileys) rodando num servidor sempre ligado.

**Feito:**
- Mockup da tela "Linhas" aprovado.
- Migração **064** aplicada: tabela `wa_linhas` com as duas linhas
  (`oficial` e `qr`), `linha_id` em `wa_conversas` e `wa_mensagens`,
  backfill de tudo que existia para a linha oficial, e troca do índice único
  de `telefone` para `(telefone, linha_id)` — sem isso o mesmo cliente não
  conseguiria falar com as duas linhas.
- Conta Google criada, projeto `mrkong-whatsapp` criado, 2FA ativada.

**Parado em:** a forma de pagamento do Google Cloud. Pix foi recusado;
precisa de cartão de crédito.

**Falta construir:**
1. VM **e2-micro** em `us-central1`, disco **"padrão"** de 30 GB (o padrão do
   console é "balanceado", que é pago).
2. Evolution API em Docker, com TLS. O Postgres pode ser o do próprio
   Supabase, para poupar a memória da máquina (ela tem só 1 GB).
3. Edge Function `wa-linha-qr` — cria a instância, devolve o QR, informa estado.
4. Edge Function `wa-webhook-evolution` — recebe mensagem e grava em
   `wa_conversas` / `wa_mensagens` **com o `linha_id` certo**.
5. Tela `CrmLinhas.jsx` + aba no CRM.
6. Na hora de responder, **escolher a linha pela conversa**. Responder pela
   linha errada manda o cliente do balcão receber mensagem do número dos
   anúncios.

**Custo real: cerca de R$ 20/mês** (o IPv4 público é cobrado mesmo na máquina
gratuita). Foi dito R$ 0 antes por engano, e corrigido.

**Risco que precisa continuar visível na tela:** conexão por QR não é
autorizada pela Meta. Uso normal de atendimento é de baixo risco; **disparo em
massa derruba o número**. Campanha tem que continuar saindo pela linha oficial.

### 7.2 Esperando o dono

1. **Teste de R$ 10 / 1 dia em "Visitas ao cardápio"** com o vídeo de 30 MB
   já subido. É a única pergunta ainda sem resposta: a Meta aceita criativo de
   arquivo subido de ponta a ponta? Todo o upload construído depende disso.
2. **Mapear os 14 produtos sem estação** e rodar `kds_resgatar_sem_estacao()`.
3. **Pixel + token da Conversions API no CardápioWeb** (Configurações →
   Integrações → Facebook Pixel). Sem ele o objetivo "Vendas" fica inútil —
   a agência já gastou R$ 725 em três anúncios que não medem nada.
4. **Meta → Ajustes:** "Testar conexão" → "Sincronizar anúncios" →
   "Buscar ontem". A curva de vendas por hora está vazia.

### 7.3 Pendências antigas

- Liberar `ads_management` no app da Meta.
- Corrigir o webhook para nunca entregar item sem estação.
- `Equipe.jsx`: salário de funcionário inativo entra na conta.
- Os R$ 385,99 do Wilker.
- Rodar `meta-diagnostico-whatsapp` (entregue, nunca confirmado).

---

## 8. Como validar antes de entregar

O que foi usado nesta rodada, e vale manter:

- **Postgres local** (`pg_ctlcluster 16 main start`) com schema de mentira
  imitando o real, para rodar a migração de verdade. Pegou dois erros que
  teriam ido para produção: `create or replace function` recusando mudança de
  parâmetro `OUT`, e `drop index` falhando quando a unicidade é uma
  *constraint* e não um índice solto.
- **`vite build` de verdade** num clone do repositório, não só checagem de
  sintaxe.
- **Testes de unidade** na lógica pura (sorteio, geração de CSV), rodados com
  esbuild + node.

Padrão das migrações: comentário no topo explicando **por que** existe,
`if not exists` em tudo, e um `select` final de conferência que imprime os
números esperados. Rodar duas vezes não pode causar dano.
