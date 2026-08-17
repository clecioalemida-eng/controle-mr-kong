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
4. Em **Authentication > Providers > Email**, decida se quer manter a
   confirmação de e-mail obrigatória. Para uso interno simples, muita gente
   desliga "Confirm email" — assim a pessoa consegue entrar assim que o
   admin aprovar, sem precisar clicar em link de e-mail. Se deixar ligado,
   o usuário precisa confirmar o e-mail E ser aprovado pelo admin.
5. Em **Project Settings > Data API** / **API Keys**, copie a **Project URL**
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
└── src/
    ├── main.jsx
    ├── App.jsx                    ← login, aprovação, cards, painel admin
    ├── lib/
    │   └── supabaseClient.js
    └── modules/
        └── ChecklistOperacional.jsx
```
