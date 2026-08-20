# Painel Mr. Kong

App com login por e-mail/senha (Supabase Auth), aprovação de cadastro por
administrador, e um painel inicial com "cards" — cada card é um módulo
(hoje só o Checklist Operacional) com acesso liberado individualmente pelo
admin. Banco de dados: Supabase. Deploy: Vercel.

## 1. Banco de dados (Supabase)

1. Crie um projeto em https://supabase.com (gratuito), se ainda não tiver.
2. **SQL Editor > New query**: cole e rode `supabase/schema.sql` (cria a
   tabela do checklist) — pule este passo se já rodou antes.
3. **SQL Editor > New query** de novo: cole e rode
   `supabase/002_auth_e_modulos.sql`. Isso cria:
   - tabela `perfis` (nome, e-mail, se é admin, status pendente/aprovado/rejeitado)
   - criação automática de perfil (pendente) a cada novo cadastro
   - tabela `modulos` (os cards) e `acessos_modulo` (quem pode ver qual card)
   - trava o checklist para só usuários aprovados lerem/gravarem
4. **SQL Editor > New query** mais uma vez: cole e rode
   `supabase/003_novos_modulos.sql`. Isso cadastra os cards de Financeiro,
   Marketing, Comercial, SAC e Rastreabilidade.
5. **SQL Editor > New query** de novo: cole e rode
   `supabase/004_fichas_tecnicas.sql`. Cria as tabelas `insumos`, `pratos`
   e `prato_insumos`.
6. **SQL Editor > New query**: cole e rode `supabase/005_pratos_nome_unico.sql`.
7. **SQL Editor > New query**: cole e rode
   `supabase/006_seed_fichas_tecnicas_hamburgueres.sql` — popula os 23
   insumos e as 14 fichas técnicas dos hambúrgueres, extraídas da planilha
   de custos que vocês enviaram (ver seção própria abaixo).
8. **SQL Editor > New query**: cole e rode
   `supabase/007_mover_fichas_tecnicas_para_financeiro.sql` — remove o card
   separado de Fichas Técnicas (ela passa a viver dentro do Financeiro).
9. **SQL Editor > New query**: cole e rode `supabase/008_insumos_compostos.sql`
   — cria o suporte a insumo composto (schema + cálculo automático).
10. **SQL Editor > New query**: cole e rode `supabase/009_molho_gourmet_e_mussarela.sql`
   — separa mussarela fatiada/em barra e cadastra o molho gourmet nos 8
   hambúrgueres da linha gourmet.
11. **SQL Editor > New query**: cole e rode `supabase/010_estoque.sql` —
   cria o estoque com histórico de movimentações.
12. **SQL Editor > New query**: cole e rode `supabase/011_notas_fiscais.sql`
   — cria as tabelas de recepção de notas e o bucket `notas-fiscais` no
   Storage.
13. Publique a Edge Function `processar-documento-compra` (ver seção
   "Estoque e recepção de notas fiscais" abaixo — precisa de uma chave da
   Anthropic API).
14. Em **Authentication > Providers > Email**, decida se quer manter a
   confirmação de e-mail obrigatória. Para uso interno simples, muita gente
   desliga "Confirm email" — assim a pessoa consegue entrar assim que o
   admin aprovar, sem precisar clicar em link de e-mail. Se deixar ligado,
   o usuário precisa confirmar o e-mail E ser aprovado pelo admin.
15. Em **Project Settings > Data API** / **API Keys**, copie a **Project URL**
   e a chave **publishable** (ou "anon public" nas chaves legadas).

## 2. Criar o primeiro administrador

Como ninguém ainda é admin no começo, o primeiro precisa ser promovido
manualmente direto no banco:

1. Suba o app (siga os passos 3 e 4 abaixo) e acesse o site publicado.
2. Na tela de login, clique em **Criar conta** e cadastre-se normalmente
   com seu nome, e-mail e senha (fica como "pendente" — ainda sem acesso).
3. No Supabase, vá em **Table Editor > perfis**, encontre a linha com o seu
   e-mail e edite manualmente duas colunas:
   - `is_admin` → `true`
   - `status` → `aprovado`

   Ou, mais rápido, no **SQL Editor**:
   ```sql
   update public.perfis
   set is_admin = true, status = 'aprovado'
   where email = 'seu-email@exemplo.com';
   ```
4. Volte ao app e faça login. Agora você é admin: vai aparecer o sino 🔔 no
   canto superior direito da tela inicial. Todo novo cadastro depois desse
   aparece ali para você aprovar/rejeitar e liberar o acesso aos módulos.

## 3. Rodar localmente (opcional)

```bash
npm install
cp .env.example .env
# edite o .env com a URL e a chave do Supabase
npm run dev
```

## 4. Subir para o GitHub

```bash
git add .
git commit -m "Login, aprovação de usuários e módulos em cards"
git push
```

## 5. Deploy na Vercel

Se o projeto já está conectado à Vercel, basta o `git push` acima que ele
republica sozinho. As variáveis de ambiente (`VITE_SUPABASE_URL` e
`VITE_SUPABASE_ANON_KEY`) continuam as mesmas de antes — não precisa mexer.

## Como funciona o acesso

- Qualquer pessoa pode criar conta, mas fica **pendente** até um admin
  aprovar (tela "Aguardando aprovação").
- Depois de aprovada, a pessoa só vê os **cards (módulos)** que o admin
  liberou para ela especificamente — o admin faz isso no Painel Admin (🔔),
  marcando/desmarcando o nome do módulo ao lado de cada usuário.
- Administradores veem todos os módulos automaticamente, sem precisar de
  liberação.

## Ícone do app e tela de login

A logo foi vetorizada automaticamente (recorte + traçado por cores) a partir
da imagem enviada e colocada em `public/icons/`:

- `logo.svg` — logo completa, usada na tela de login.
- `mascot.svg` / `mascot-transparent-512.png` — só a cabeça do macaco, usada
  como favicon e como ícone dentro do app.
- `favicon.ico`, `favicon-16x16.png`, `favicon-32x32.png` — ícone da aba do
  navegador (PC).
- `apple-touch-icon*.png` — ícone ao "Adicionar à Tela de Início" no iOS.
- `icon-192.png`, `icon-512.png`, `maskable-icon-*.png` — ícone ao instalar
  como app no Android (PWA), registrados em `public/manifest.webmanifest`.

Como a imagem original não tinha uma versão vetorial, o resultado é um
traçado automático (por cores) — funciona bem em qualquer tamanho de ícone,
mas se um dia vocês tiverem o arquivo vetorial "oficial" da marca (feito em
Illustrator/Figma pelo designer), vale trocar `logo.svg`/`mascot.svg` por
ele para ficar 100% fiel.

Depois do deploy, no celular dá para usar "Adicionar à Tela de Início"
(iOS, no Safari) ou o próprio prompt de instalação do Chrome (Android) para
o app abrir com o ícone do Mr. Kong, em tela cheia, como um app nativo.

## Layout responsivo

O app usa uma largura de conteúdo que cresce com a tela (celular → tablet →
desktop) e os cards da tela inicial se reorganizam automaticamente em 1, 2
ou 3 colunas conforme o espaço disponível (`src/index.css`). Não precisa de
nenhuma configuração — funciona igual em celular, tablet e computador.

## Insumos compostos (receitas dentro do insumo)

Alguns insumos não são comprados prontos — são preparados a partir de
outros insumos (ex.: um molho da casa). Pra esses casos existe o **insumo
composto**: em vez de digitar um custo fixo, você cadastra a receita dele
(quais insumos entram, em que quantidade) e o **rendimento** (quanto essa
receita produz, na mesma unidade do insumo — ex.: "rende 1000 ml"). O custo
por unidade é **calculado automaticamente** (soma do custo dos ingredientes
÷ rendimento) e recalculado sozinho sempre que:
- a composição muda (adiciona/remove/edita quantidade de um ingrediente), ou
- o custo de um dos ingredientes muda em outro lugar do app (efeito cascata).

Ativa isso marcando "Insumo composto" no lápis de edição de qualquer
insumo, dentro do editor de ficha técnica. Só suporta 1 nível (um composto
feito de insumos simples — não dá pra fazer um composto usar outro
composto como ingrediente, pra evitar complexidade desnecessária).

Nessa entrega já veio cadastrado: **Molho gourmet** (o "kongnese" citado na
descrição de 8 hambúrgueres da linha gourmet), como insumo composto ainda
sem receita definida — e ligado a 30ml em cada um desses 8 pratos. Também
separei **Mussarela fatiada** (a que já estava nas fichas técnicas) de
**Mussarela em barra** (insumo novo, custo ainda em aberto) — são produtos
diferentes.

## Estoque e recepção de notas fiscais

Duas abas novas dentro do Financeiro:

**Estoque** — saldo atual de cada insumo, calculado a partir de um
"extrato" de movimentações (compra, ajuste, perda, contagem) — mesmo
padrão de gatilho já usado no custo do insumo composto: o saldo nunca é
digitado direto, é sempre a soma das movimentações, recalculado sozinho.
Tocar num insumo abre o extrato completo e permite registrar ajustes
manuais (perda, contagem) e configurar um estoque mínimo (fica com aviso
visual quando o saldo cai abaixo dele).

**Notas** — envio de foto/PDF de nota fiscal ou recibo pelo celular. Uma
Edge Function (`processar-documento-compra`) manda o arquivo pra Anthropic
API (Claude, com visão) pedindo os itens comprados em formato estruturado
(nome, quantidade, unidade, preço unitário), casa cada item com um insumo
já cadastrado — por nome exato, por um sinônimo já aprendido, ou por
aproximação simples — e sinaliza em vermelho qualquer item **30% ou mais
acima** da última compra confirmada daquele insumo. Nada é lançado no
estoque nesse momento — só depois que alguém revisar na tela de
conferência (editar com o lápis, excluir o que não deve entrar, vincular
itens não reconhecidos a um insumo) e apertar "Confirmar". A confirmação
gera a movimentação de estoque, atualiza o custo do insumo pro preço
dessa compra, e — se o nome lido for diferente do nome do insumo — grava
um sinônimo, pra reconhecer esse mesmo texto automaticamente da próxima
vez (o "aprendizado contínuo" do plano original).

### Configuração extra necessária

1. Pegue uma chave de API em **console.anthropic.com** (Anthropic
   Console → API Keys).
2. Nos **Secrets** do Supabase (mesmo lugar do `CARDAPIOWEB_API_TOKEN`),
   adicione: `ANTHROPIC_API_KEY` = a chave que você gerou.
3. Publique a nova função (`processar-documento-compra`) do mesmo jeito
   que publicou a `cardapioweb-proxy`: Edge Functions → Deploy a new
   function → Via Editor → cole o conteúdo de
   `supabase/functions/processar-documento-compra/index.ts` → nome exatamente
   `processar-documento-compra` → Deploy.
4. Rode `010_estoque.sql` e `011_notas_fiscais.sql` no SQL Editor (essa
   última também cria o bucket privado `notas-fiscais` no Storage).

### Simplificação assumida (documentando pra não esquecer)

O plano original falava em "custo médio dos últimos 30 dias". O que está
implementado agora é mais simples: **o custo do insumo vira o preço da
última compra confirmada**, não uma média das compras do mês. Dá pra
evoluir isso depois porque o histórico de preços já fica registrado no
extrato do estoque (`movimentacoes_estoque.preco_unitario`) — só falta
trocar a fórmula.

## Equipe e premiação diária

8ª aba do Financeiro. Três telas:

- **Pessoas** — cadastro de funcionários: nome, papel (Garçom, Caixa,
  Bar, Chapa, Cozinha ou Limpeza), CPF, telefone, e-mail, data de
  aniversário, e se é Registrado (comissão acumula pro fechamento do mês)
  ou Diarista (soma uma base diária pessoal fixa em cima da comissão do
  dia).
- **Premiação do dia** — escolhe a data, busca (ou digita manualmente) a
  taxa de serviço do dia, marca quem trabalhou e o peso de cada um (1 =
  dia inteiro, 0.5 = meio período — igual ao jeito que já era calculado na
  planilha de vocês, que tinha um "6,5" de gente numa das contas). A taxa
  é dividida 50% para os garçons selecionados (pelo peso de cada um) e 50%
  para o resto da equipe selecionada (caixa, bar, chapa, cozinha,
  limpeza), do mesmo jeito. Também dá pra configurar uma **base por
  categoria** naquele dia (ex.: R$70 pra todo Garçom, R$100 pra toda
  Cozinha) — um valor extra somado à comissão de cada pessoa daquele
  cargo, multiplicado pelo peso do dia dela, igual ao "valor diária" que
  já existia na planilha de referência de vocês.
- **Fechamento mensal** — soma o acumulado de cada pessoa **registrada**
  no mês (diaristas não entram aqui, porque já recebem por dia). Toca numa
  pessoa pra ver o extrato dia a dia.

A busca automática da taxa de serviço usa a janela **17h do dia escolhido
até 03h do dia seguinte**. Uma ressalva importante: **não consegui
confirmar na documentação pública do CardápioWeb o nome exato do campo de
taxa de serviço** nos pedidos — a função tenta alguns nomes prováveis
(`service_charge`, `taxa_servico`, `service_fee`, `tip`, `gorjeta`), mas
se nenhum bater ela avisa e o campo fica pra digitar manualmente.

### Migração e Edge Function

- `014_equipe_premiacao.sql` — tabelas `pessoas`, `presencas_diarias`,
  `premiacoes_diarias`.
- `015_mais_cargos.sql` — cargos Caixa, Bar, Chapa, Cozinha.
- `016_dados_pessoais_equipe.sql` — CPF, telefone, e-mail, aniversário.
- `017_base_por_categoria.sql` — coluna pro valor extra por categoria.
- `cardapioweb-proxy` ganhou uma ação nova (`taxa_servico_dia`) — precisa
  republicar a função depois de rodar a migração 014.

## Entrega: unidade de compra, busca, troca de insumo, e dados da equipe

Quatro melhorias nessa leva:

**1. Alerta de unidade divergente nas notas fiscais.** Se um item da nota
vier numa unidade diferente da que o insumo já usa (ex.: nota em "un" mas
o insumo é controlado em "kg"), a linha fica destacada em amarelo com um
aviso, e **bloqueia a confirmação** até você corrigir pelo lápis — evita
que uma compra entre errada no estoque por causa de unidade trocada.

**2. Busca em listas grandes.** Campo de busca (com lupa) nas telas que
têm lista: Fichas Técnicas, Notas, Estoque e Pessoas. Vendas/Pedidos/
Pagamentos/Fechamento não ganharam busca porque são resumos agregados, não
listas de itens.

**3. Trocar o insumo de uma linha da ficha técnica.** Antes só dava pra
editar os dados do insumo (nome, unidade, custo); agora tem um ícone de
troca (setas) que deixa substituir por outro insumo já cadastrado, mantendo
a mesma quantidade. Também deixei mais claro que o "custo unitário" do
insumo reflete o valor da última compra confirmada.

**4. Cadastro de pessoas mais completo.** Ícone de olho pra ver todos os
dados da pessoa (CPF, telefone, e-mail, aniversário, documento) sem abrir
o formulário de edição — o que estiver **faltando aparece em vermelho**.
Também dá pra anexar um documento (RG, contrato…) no cadastro; um ícone de
clipe ao lado do nome abre/baixa esse arquivo.

### Migração nova

`018_documento_pessoa.sql` — coluna `documento_path` em `pessoas`, e o
bucket privado `documentos-pessoas` no Storage.

## Dia da compra, e marcar/reverter pago

**1. Dia da compra** — cada conta agora mostra "Comprado DD/MM · Vencimento DD/MM" (antes só tinha vencimento). Migração já preenche retroativamente pras contas que vieram de nota fiscal, usando a data do documento.

**2. Marcar como pago / reverter** — contas pendentes ganharam um botão
**"Marcar como pago"** (paga o valor total de uma vez, na data de hoje,
sem precisar passar pelo formulário) ao lado do "Pagar parcial…" (o
antigo "Registrar pagamento", pra quando o valor não é o total). Contas
já pagas ganharam a etiqueta **"Pago ↺"** clicável, pra reverter de
volta pra pendente caso tenha marcado errado (zera o valor pago, mas não
apaga o histórico de pagamentos já feitos).

### Migração

`032_dia_compra_e_status.sql` — adiciona `data_compra`, preenche
retroativamente pras contas com nota fiscal vinculada.

Não mexe em Edge Function.

## Centro de custo, sincronização, e Pessoas no Plano de Contas

**1. Centro de custo em cada conta.** Lista completa (baseada em pesquisa
sobre gestão de hamburgueria + os cinco que você já tinha pedido):
Pessoas, Insumos, Utensílios, Consertos e manutenção, Imobilizado,
Ocupação, Utilidades, Impostos e taxas, Marketing e vendas,
Administrativo. Editável junto com forma de pagamento e vencimento, tudo
no mesmo lápis. Contas antigas ficam **sem centro de custo** até você
classificar — tem um aviso no topo contando quantas ainda faltam.

**2. Sincronização** — editar a forma de pagamento numa conta do Plano de
Contas agora atualiza a movimentação de estoque correspondente também
(em Compras), e vice-versa (via o mesmo `documento_compra_id` pra nota
fiscal, ou o novo `movimentacao_estoque_id` pra compra manual).

**3. Pessoas no Plano de Contas** — em Equipe > Fechamento mensal, cada
pessoa (registrado ou gerente) ganhou um link "+ Lançar no Plano de
Contas", que cria uma conta (centro de custo "Pessoas") com o valor
fechado do mês. Uma vez lançado, mostra "✓ Já lançado" pra não duplicar.

### Migração

`031_centro_custo_e_sync_estoque.sql` — adiciona `centro_custo` e
`movimentacao_estoque_id` em `contas_pagar`.

Não mexe em Edge Function.

## Compra manual, forma de pagamento unificada, contas recorrentes e previsão

**1. Compra manual** (Compras > "+ Compra manual") — dá entrada de estoque
sem precisar de nota fiscal/foto. Tem o mesmo item buscável (ou cria
novo), a mesma calculadora de pacotes (ex.: 5 pacotes de 2,5kg = 12.500g),
valor unitário/total calculando um a partir do outro, forma de pagamento,
e fornecedor buscável (ou cria novo).

**2. Forma de pagamento unificada** — tanto a confirmação de nota fiscal
quanto a compra manual agora usam a mesma forma de pagamento (Pix /
Débito / Cartão de crédito / Boleto). Só **boleto** gera conta a pagar
(com o prazo em dias que você informar) — os outros já foram pagos na
hora, então não viram dívida.

**3. Contas fixas recorrentes** — em Contas a Pagar, botões rápidos pra
lançar Água, Luz, Internet, Alvará, Aluguel, Telefone (ou "Outra"), sem
precisar passar pela compra de insumo.

**4. Previsão de custos mensais** — card no topo de Contas a Pagar
mostrando a média de cada conta recorrente já lançada antes (ex.: "Luz
~R$450, 3 lanç."). Cresce sozinho conforme você for lançando mais meses.

### Migração

`029_compra_manual_e_recorrentes.sql` — adiciona `forma_pagamento` em
`movimentacoes_estoque` e `contas_pagar`, e `categoria` em `contas_pagar`
(usada pra reconhecer as recorrentes na previsão).

Não mexe em Edge Function.

## Previsão de escala, item manual em notas, contas a pagar, e fiado

Cinco coisas grandes nessa entrega:

**1. Previsão de Escala** (nova sub-aba em Equipe) — planejamento pra
dias futuros, sem taxa de serviço nem cálculo nenhum. Marca quem está
previsto pra trabalhar, e quando o dia chegar, a Escala do dia já abre
com essas pessoas pré-marcadas (só falta confirmar horas e taxa).

**2. Adicionar item manual em Notas** — link "+ Adicionar item
manualmente" na Conferência de nota, pra itens que a IA não leu.

**3. Condição de pagamento + Contas a Pagar** — ao confirmar uma nota,
escolhe a condição (à vista / 7 / 14 / 21 / 28 dias / outro prazo), e o
sistema já gera uma conta a pagar com vencimento calculado. Nova aba
**Contas a Pagar** em Financeiro, ordenada por vencimento, com etiqueta de
vencida/próxima, e opção de registrar pagamento (inclusive parcial, com
histórico de cada pagamento feito).

**4. Relatório de Fiado** — nova aba em Financeiro, busca pedidos pagos
como fiado num período. Mostra o **nome do cliente** quando o CardápioWeb
manda esse dado; se não mandar, cai pro número do pedido (com aviso na
tela avisando que não veio o nome).

### Migração

`028_previsao_contas_pagar.sql` — tabelas `previsoes_escala`,
`contas_pagar`, `pagamentos_conta`.

Não precisa mexer em Edge Function — tudo reaproveita o `resumo_financeiro`
que já existia.

## Renomear insumo, e Checklist Operacional editável (só admin)

Três correções/adições nessa entrega:

**1. Renomear insumo em Compras** — no topo da tela de um insumo, o nome
agora tem um lápis do lado, editável.

**2. Renomear insumo direto ao vincular em Notas** — no formulário de
edição de item, quando já tem um insumo selecionado em "Vinculado a",
aparece um lápis do lado que deixa renomear esse insumo ali mesmo (sem
precisar ir em Compras) — corrige em todo lugar que usa esse insumo, e o
aprendizado de sinônimo (explicado abaixo) passa a funcionar certo com o
nome corrigido.

**3. Checklist Operacional editável (só admin).** Os itens de cada
checklist (Caixa, Bar, Chapa, Gerência × Abertura, Fechamento) eram fixos
no código — agora vivem no banco (`checklist_itens`), e quem é
administrador vê um botão **"Editar checklist"** na tela inicial do
módulo, com edição, exclusão e adição de itens por departamento e turno.
Quem não é admin continua só marcando os itens, sem opção de editar.

### Lembrete sobre o aprendizado de sinônimo (já existia)

Quando uma nota é **confirmada**, o sistema já grava automaticamente o
texto lido (ex.: "Nutella 650g") como sinônimo do insumo vinculado — e
usa isso pra reconhecer sozinho da próxima vez. Isso só funciona bem
quando o insumo tem o nome *correto*; se um insumo foi criado com nome
errado (ex.: "Nutella 650g" em vez de só "Nutella"), o item 2 acima
resolve isso de vez.

### Migração

`027_checklist_editavel.sql` — tabela `checklist_itens`, semeada com os
itens que já existiam fixos no código (só popula se a tabela estiver
vazia, seguro rodar mais de uma vez).

## Fornecedores, e Compras (antes Estoque) com sugestão de compra

Três frentes nessa entrega grande:

**1. Fornecedores cadastrados.** Na tela de Conferência de uma nota, o
fornecedor agora é editável (lápis do lado do nome) com autocompletar dos
fornecedores já cadastrados — digitando um nome novo, cadastra ele
automaticamente. Ao vincular um fornecedor, aparece um histórico de
compras com ele logo abaixo (data + valor de cada nota anterior, e o
total do período).

**2. Aba "Estoque" virou "Compras".** Mesmo conteúdo de antes (saldo,
extrato, ajuste manual, estoque mínimo), só que agora com um campo no
topo pra escolher **quantos dias de estoque cobrir** (padrão 4, fica
salvo) e um botão **"Calcular sugestão de compra"**.

**3. Sugestão de compra por insumo.** Ao clicar em calcular, o sistema
busca os pedidos fechados no CardápioWeb dos últimos 14 dias, cruza cada
prato vendido com a Ficha Técnica dele (quantos gramas de cada insumo
entra em cada prato) e descobre quanto foi consumido de cada insumo de
verdade — separando a média de **dia útil** da média de **fim de semana**
(sexta/sábado/domingo), já que o consumo não é igual todo dia. A sugestão
= (dias úteis restantes × média útil + dias de fim de semana restantes ×
média de fim de semana) − o que já tem em estoque. Insumos que precisam
de compra ganham uma etiqueta vermelha "comprar" na lista.

**Limitação importante**: essa conta só funciona bem pros insumos que já
estão vinculados na Ficha Técnica de algum prato vendido pelo CardápioWeb
— insumos usados só em pratos sem ficha ainda, ou vendidos fora do
CardápioWeb, não entram nesse cálculo (não aparece sugestão pra eles,
mas o resto da tela — saldo, ajuste — continua funcionando normal).

### Migração

`026_fornecedores_e_compras.sql` — tabela `fornecedores`,
`documentos_compra.fornecedor_id`, tabela `configuracoes` (guarda o
"dias de estoque" e serve pra outras configs futuras).

## Cache compartilhado da taxa de serviço

Escala do dia (Equipe) e Conferência de Caixa (Financeiro) calculavam a
taxa de serviço do dia de forma independente, cada uma com sua própria
consulta ao CardápioWeb — mesmo sendo o mesmo número. Agora as duas
gravam e leem de um cache comum (`taxas_do_dia`): quem buscar primeiro
(em qualquer uma das duas telas) salva o valor pra outra reaproveitar,
sem gastar outra consulta do limite de 5/minuto do CardápioWeb à toa. O
botão "Buscar" continua existindo pra forçar uma atualização quando
precisar.

### Migração

`024_cache_taxas_do_dia.sql` — tabela `taxas_do_dia`.

## Cargo no cadastro, e Painel Admin reorganizado

**No cadastro**, além de nome/e-mail/senha, agora tem um campo **Cargo**
(Administrador, Gerente, Garçom, Chapeiro, Bar, Cozinha, Caixa) — é só
informativo pro admin saber quem está pedindo acesso, **não dá acesso de
administrador sozinho** (isso continua sendo uma decisão manual do admin,
por segurança — ninguém vira admin só escolhendo essa opção no cadastro).

**Painel Admin** agora tem duas abas:
- **Aprovações pendentes** — igual antes, com os módulos pra liberar já
  junto do cadastro pendente, mais o cargo que a pessoa informou.
- **Pessoas cadastradas** — todo mundo que já passou pelo cadastro
  (aprovado ou rejeitado), com um botão **"Tornar administrador"** — não
  precisa mais de SQL direto no banco pra promover alguém.

### Deixando a Cristiane administradora

Agora que existe o botão, é só usar ele: Painel Admin > Pessoas
cadastradas > ache a Cristiane > clique em "Tornar administrador".

Se ela ainda não tiver se cadastrado no app, ela precisa criar a conta
primeiro (Criar conta, com e-mail/senha) — só depois disso o nome dela
aparece na lista pra você promover.

### Migração

`023_cargo_no_cadastro.sql` — coluna `cargo` em `perfis`, gatilho de
criação de perfil atualizado pra capturar esse campo.

## Controle de acesso a valores (só administrador)

Três mudanças de segurança e organização:

**1. Aprovação de cadastro já mostra as permissões.** No Painel Admin, o
card de "Aguardando aprovação" agora já tem os toggles de módulo junto
com Aprovar/Rejeitar — não precisa mais aprovar primeiro pra só depois
achar as permissões numa lista separada.

**2. Salário e Matriz de cargos: só administrador.** Reforçado em duas
camadas:
- **No banco** (o que realmente importa pra segurança): um gatilho
  impede qualquer não-admin de mudar `salario_base` de uma pessoa (o
  valor volta pro que já estava, mesmo que a chamada tente mudar); a
  Matriz de cargos só aceita escrita de admin via política de RLS —
  leitura continua liberada pra todo aprovado, porque o cálculo da
  comissão precisa dela pra qualquer pessoa ver o resultado.
- **Na tela**: quem não é admin não vê as abas "Matriz de cargos" e
  "Fechamento mensal" (somem da lista de abas), não vê o campo de
  salário no cadastro de pessoa, e na Escala do dia só vê os campos de
  presença (quem trabalhou, peso, horas) — a taxa de serviço, a base
  por categoria e o resultado calculado ficam escondidos.

**3. "Premiação do dia" virou "Escala do dia".** Mesmo conteúdo, nome
mais preciso — reflete que qualquer pessoa aprovada pode preencher quem
trabalhou e as horas, mesmo sem ver os valores calculados.

Quem não é admin ainda consegue salvar a escala (presença) normalmente,
mesmo sem taxa de serviço definida — os valores calculados só entram
quando um admin completar a taxa depois.

### Migração

`022_acesso_a_valores.sql` — gatilho de proteção do salário, políticas de
RLS da matriz de cargos.

## Resumo da Escala do dia na Conferência de Caixa

A Conferência de Caixa agora mostra, pra cada dia, um resumo de quem
trabalhou (nome, cargo, horas, valor do dia) — preenchido na aba Equipe,
só espelhado aqui pra fechar o dia inteiro (caixa + equipe) numa tela só.
Não duplica dado nenhum, é a mesma informação de `presencas_diarias` e
`premiacoes_diarias`.

## Equipe: matriz de cargos, dois métodos pro diarista, salário individual e gerência

Reestruturação grande do módulo Equipe. 4 sub-abas agora (Pessoas, **Matriz
de cargos** [nova], Premiação do dia, Fechamento mensal):

- **Matriz de cargos** — diária base e valor/hora configurados **por
  cargo** (Garçom, Caixa, Bar, Chapa, Cozinha, Limpeza), aplicados
  automaticamente a todo diarista daquele cargo. Não se digita mais por
  pessoa.
- **Diarista** — todo dia, o sistema calcula os dois métodos (comissão +
  diária da matriz vs. horas trabalhadas × valor/hora da matriz) e usa o
  **maior**. Horas trabalhadas é um campo novo, separado do peso (peso
  segue só pra dividir a comissão).
- **Registrado** — ganha salário base **individual** (cada um o seu,
  digitado no cadastro da pessoa) + a comissão diária acumulada, somados
  no Fechamento mensal.
- **Gerente** — cargo novo, não entra na divisão diária de comissão de
  jeito nenhum. Ganha salário base + 2% do faturamento bruto do mês,
  calculado só no Fechamento mensal.

### Faturamento bruto do mês (pra gerência)

Botão "Buscar" no Fechamento mensal consulta o CardápioWeb pro mês
inteiro — mas usando só a **listagem básica** do histórico (que já traz
o total de cada pedido), não o detalhe completo de cada um. Isso evita
o limite de 200 pedidos detalhados por consulta, que um mês de movimento
forte estouraria facilmente, e é bem mais rápido. Fica salvo em cache
(`faturamento_mensal`), só busca de novo quando você clicar.

### Migrações

- `021_equipe_matriz_e_salarios.sql` — cargo "gerente", salário
  individual, tabela `matriz_cargos`, horas trabalhadas, cache de
  faturamento mensal.
- `cardapioweb-proxy` ganhou a ação `faturamento_periodo` — precisa
  republicar a função.

## Repasse para entregador de delivery

Dentro da mesma Conferência de Caixa: separa as entregas do dia em duas
janelas — até 22h (R$9,00 por entrega, editável) e após 22h (R$15,00 por
entrega, editável). A quantidade de entregas de cada janela é calculada
sozinha a partir do horário de cada pedido de Delivery; só o valor por
entrega é digitável. Fica salvo junto com o resto da conferência do dia.

### Migração

`020_repasse_entregador.sql` — tabela `repasses_delivery`.

## Conferência de caixa por forma de pagamento

9ª aba do Financeiro. Escolhe o dia, clica em "Buscar dados do sistema"
(usa a mesma janela 17h–03h de sempre) e o app traz o que o CardápioWeb
registrou pra cada forma de pagamento daquele dia. Ao lado, você digita o
que conferiu de verdade (extrato da maquininha de cartão, extrato do PIX,
contagem do dinheiro) — a diferença aparece **forma por forma**, não só
um total genérico. Isso responde a pergunta "a diferença foi no débito,
no dinheiro, ou em outro lugar?" em vez de só saber que ela existe.

Fica salva por dia (`conferencias_caixa`) — pode voltar depois pra
conferir ou ajustar.

### Migração

`019_conferencia_caixa.sql` — tabela `conferencias_caixa`.

## Relatório de conciliação de caixa (em andamento)

Você pediu um relatório completo (abertura/fechamento com responsável,
sangria/suprimento, vendas por categoria — iFood/delivery/retirada/mesa —
e por atendente). Em 19/08/2026, o botão de debug em Pedidos revelou o
retorno completo de um pedido real, o que **confirmou vários campos**:

- `service_fee` — valor exato da taxa de serviço (não é mais chute).
  Já corrigido tanto na busca automática da Equipe quanto na Conferência
  de Caixa.
- `order_type` / `sales_channel` — categoria do pedido (mesa confirmada
  como `closed_table`; delivery/retirada/iFood ainda não vistos num
  exemplo real, mas já têm mapeamento pronto pra quando aparecerem — e
  qualquer valor novo aparece com o texto bruto, nunca escondido).
- `user.name` — atendente responsável pelo pedido.
- `delivery_fee`, `additional_fee` — taxas de entrega e adicionais.

Isso já está implementado em **Financeiro > Conferência de Caixa**, que
agora mostra, pra qualquer dia: forma de pagamento (sistema × conferido ×
diferença), vendas por categoria, vendas por atendente, e o total das
taxas do dia.

**O que ainda falta confirmar**: abertura/fechamento de caixa com
responsável, sangria e suprimento. Esse pedido de exemplo não trouxe nada
sobre isso — parece ser um dado de outro tipo (evento de caixa, não de
pedido individual), então continua esperando a resposta do e-mail enviado
pra integracao@cardapioweb.com.

## Consultas ao CardápioWeb — sempre manuais

As abas Vendas, Pedidos, Pagamentos e Fechamento **não buscam dados
sozinhas** ao abrir ou trocar de data — é preciso escolher o período e
clicar em "Atualizar" de propósito. Isso é intencional: o histórico de
pedidos do CardápioWeb só aceita 5 consultas por minuto, e buscar
automaticamente a cada clique de aba ou troca de data esgotava esse
limite rápido demais.

## Produtos do resto do cardápio (Petiscos, Bombons, Extras, Bebidas, Na Chapa, Fritas, Sorvetes, Açaí, Milkshake)

`013_produtos_extras_cardapio.sql` cadastra 91 produtos que ainda não estavam
no sistema. Cada um ganha um **insumo-espelho** (mesmo nome, quantidade 1),
com custo R$0 até alguém preencher — que é exatamente o que fica **em
vermelho** no app (tag "sem custo" dentro da ficha, e "Custo pendente" em
vez da margem na lista) até ser corrigido.

Isso é só o ponto de partida: pra pratos preparados de verdade (petiscos,
Na Chapa, Fritas com adicionais, Açaí, etc.), o ideal é substituir esse
insumo único por uma composição de vários ingredientes reais, do mesmo
jeito que já fizemos com os hambúrgueres — a estrutura já está pronta pra
isso, só falta a receita de cada um.

Um detalhe de nomenclatura: nos itens da categoria **Extras** que têm o
mesmo nome de um insumo já cadastrado em kg (Bacon, Alface, Ovo, Presunto,
Salsicha, Tomate — usados dentro das fichas dos hambúrgueres), o produto e
o insumo novo saíram com o sufixo **"(extra)"** — assim não colam sem
querer no insumo em kg já existente (o que faria a conta bater errado por
ordem de grandeza, tipo R$43/kg contra uma porção de R$6,99). Se precisar
bater com o nome exato usado no CardápioWeb, é só renomear pelo lápis.

## Fichas técnicas, custo e margem

Vive dentro do card **Financeiro**, como uma 5ª aba ("Fichas técnicas") —
não é mais um card separado (movido em `007_mover_fichas_tecnicas_para_financeiro.sql`).
A razão da mudança: fichas técnicas são uma questão financeira (custo e
margem de cada prato), diferente de **Rastreabilidade**, que fica reservada
para lote/validade/origem dos insumos — outro eixo de informação sobre o
mesmo insumo, mas com dono e frequência de uso bem diferentes.

Para cada prato, você monta a composição (insumos + quantidade) e o app
calcula custo e margem de contribuição em tempo real.

**Como o app "conhece" os pratos, já que não dá pra consultar o Catálogo**
(ver limitação abaixo): o botão **Importar pratos**, na tela inicial do
módulo, varre os pedidos dos últimos 90 dias e extrai os itens vendidos
(nome, id do CardápioWeb, preço) — usa a mesma ação de busca de pedidos que
o Financeiro já usa, só que agrupando por item em vez de somar por pedido.
Pode rodar de novo a qualquer momento; ele atualiza os pratos existentes
(por `cardapioweb_item_id`) em vez de duplicar.

**Insumos são cadastrados dentro do próprio app** (não vêm de lugar
nenhum) — nome, unidade (un/g/kg/ml/l) e custo médio atual. O custo de um
insumo é uma informação compartilhada: editá-lo no lápis de uma ficha
técnica atualiza o custo em todas as fichas que usam aquele insumo, porque
ele é uma propriedade do insumo, não da receita.

⚠️ Limitação conhecida da API do CardápioWeb: o endpoint de Catálogo
(`GET /catalog`) exige `X-API-KEY` **e** `X-PARTNER-KEY` — e só temos o
`X-API-KEY` (token do estabelecimento). O `X-PARTNER-KEY` é um token de
integradora, que exige um cadastro separado (contato com
`integracao@cardapioweb.com`). Por isso o app descobre os pratos a partir
dos pedidos em vez do Catálogo direto — funciona bem para pratos que já
foram vendidos, mas um prato novo, ainda sem nenhuma venda registrada, só
aparece depois da primeira venda (ou pode ser cadastrado manualmente
direto na tabela `pratos` do Supabase, se precisar adiantar).

## Dados importados da planilha de custos (18/08/2026)

`supabase/006_seed_fichas_tecnicas_hamburgueres.sql` popula 23 insumos e as
fichas técnicas dos 14 hambúrgueres do cardápio, extraídos e conferidos
item a item contra a planilha `Cardápio Mr Kong com custo e preços`. Fora
do escopo (sem dado de composição confiável na planilha, ficam para depois):
Na Chapa, Fritas, Cozinha, Sorvetes, Açaí, Milkshake, Bebidas, Extras,
Bombons e Balas.

Pontos que ficaram marcados para revisão (o custo já está lançado, mas vale
conferir e ajustar pelo lápis de edição do app quando puder):
- **Molho tártaro** a R$1,00/kg parece baixo demais — provavelmente um
  valor provisório na planilha original.
- **Rúcula**: a planilha usa 333g por hambúrguer (só no Kong Dril), o que
  parece muito para um topping — pode ser um erro de digitação (talvez
  fosse 33g).
- **Kongzilla**: importado exatamente como está na ficha de custo da
  planilha — blend triplo (180g×3) e bacon em dobro, mas **sem** cheddar,
  provolone ou cebola caramelizada, mesmo a descrição do cardápio citando
  esses itens. Se a receita real inclui isso, a margem calculada hoje está
  otimista; ajuste a ficha técnica do Kongzilla no app assim que confirmar
  a composição real.

Os custos lançados são só de insumo — não incluem mão de obra de preparo
nem embalagem além da listada (papel acoplado, saco kraft).

## Integração com o CardápioWeb (módulo Financeiro)

O CardápioWeb não tem um módulo financeiro na API aberta — só **Loja**,
**Catálogo** e **Pedidos**. Por isso, vendas, formas de pagamento e
fechamento de caixa são calculados dentro do nosso app a partir dos
pedidos, não vêm prontos de um endpoint só. O fluxo, dentro da Edge
Function `supabase/functions/cardapioweb-proxy`:

1. Busca o histórico de pedidos do período (`GET /orders/history`) — esse
   endpoint só traz status e datas, sem valores.
2. Para cada pedido, busca o detalhe (`GET /orders/{id}`) — é ali que vêm
   o `total` e a lista de `payments` (forma de pagamento de cada um).
3. Soma tudo: faturamento total, por forma de pagamento, por dia.

O token do CardápioWeb (o mesmo que você pegou em
`portal.cardapioweb.com/configuracoes/integracao/api`) fica guardado como
**secret** do projeto Supabase — nunca em código, nunca no navegador do
usuário.

**Limites a ter em mente** (regras do próprio CardápioWeb):
- O endpoint de histórico aceita no máximo 6 meses por consulta, e não
  retrocede mais de 1 ano.
- Rate limit: 5 requisições/minuto para o histórico, 300 a cada 3 minutos
  para o detalhe de cada pedido — por isso a função tem um limite de
  segurança de 200 pedidos processados por consulta. Para períodos com
  muito movimento, prefira consultar por dia ou por semana em vez de por
  mês inteiro.

### Como configurar

1. Instale a Supabase CLI (`npm install -g supabase`) e faça login
   (`supabase login`).
2. Vincule o projeto: `supabase link --project-ref SEU_PROJECT_REF` (o ref
   aparece na URL do projeto no Supabase, ou em Settings > General).
3. Guarde o token do CardápioWeb como secret — **nunca** em arquivo `.env`
   do frontend:
   ```bash
   supabase secrets set CARDAPIOWEB_API_TOKEN=coloque_o_token_aqui
   ```
   (Ou pelo dashboard: Project Settings > Edge Functions > Secrets.)
4. Publique a função:
   ```bash
   supabase functions deploy cardapioweb-proxy
   ```

Por segurança, depois que a integração estiver testada e funcionando, gere
um novo token na tela de integração do CardápioWeb e atualize o secret —
uma boa prática sempre que uma chave de API circulou fora do painel oficial
do fornecedor.

## Adicionar um novo card/módulo no futuro

1. Crie o componente React em `src/modules/NovoModulo.jsx`.
2. Em `src/App.jsx`, importe-o e adicione uma linha em `COMPONENTES_MODULO`,
   ex.: `estoque: NovoModulo`.
3. No Supabase, insira uma linha na tabela `modulos` com a mesma `chave`
   (ex.: `estoque`) e um `nome`/`descricao` para exibir no card.
4. Pronto — o card aparece na tela inicial e o admin já consegue liberar o
   acesso por usuário no Painel Admin, sem precisar mexer em mais nada.

## Estrutura

```
├── index.html
├── package.json
├── vite.config.js
├── supabase/
│   ├── schema.sql                 ← tabela do checklist (rodar primeiro)
│   └── 002_auth_e_modulos.sql     ← login, perfis, módulos, acessos
├── public/
│   ├── favicon.ico
│   ├── manifest.webmanifest
│   └── icons/                     ← logo, mascote e ícones em todos os tamanhos
└── src/
    ├── main.jsx
    ├── index.css                  ← layout responsivo
    ├── App.jsx                    ← login, aprovação, cards, painel admin
    ├── lib/
    │   └── supabaseClient.js
    └── modules/
        ├── ChecklistOperacional.jsx
        ├── EmConstrucao.jsx       ← tela-base "em construção" reaproveitada
        ├── Financeiro.jsx
        ├── Marketing.jsx
        ├── Comercial.jsx
        ├── Sac.jsx
        └── Rastreabilidade.jsx
```

## Novos cards: Financeiro, Marketing, Comercial, SAC, Rastreabilidade

Os 5 já aparecem na tela inicial (e o admin já pode liberar acesso a cada
um por usuário no Painel Admin), mas por enquanto mostram só uma tela "Em
construção" — o conteúdo de verdade de cada um ainda precisa ser
desenvolvido. Quando for a hora de construir um deles de verdade, é só
substituir o conteúdo do arquivo correspondente em `src/modules/` (ex.:
`Financeiro.jsx`) por uma tela real, seguindo o mesmo padrão do
`ChecklistOperacional.jsx`.

Não esqueça de rodar `supabase/003_novos_modulos.sql` no SQL Editor do
Supabase para cadastrar os 5 módulos no banco (sem isso os cards não
aparecem, mesmo já estando no código).
