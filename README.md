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
