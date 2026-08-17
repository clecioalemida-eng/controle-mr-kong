# Controle Mr. Kong — Checklist Operacional

App de checklist de abertura/fechamento por departamento (Caixa, Bar, Chapa,
Gerência), com dashboard de pendências e não conformidades. Banco de dados:
Supabase. Deploy: Vercel.

## 1. Criar o banco no Supabase

1. Crie um projeto em https://supabase.com (gratuito).
2. Vá em **SQL Editor > New query**, cole o conteúdo de `supabase/schema.sql`
   e clique em **Run**. Isso cria a tabela `registros_checklist` e as
   políticas de acesso.
3. Vá em **Project Settings > API** e copie:
   - **Project URL**
   - **anon public key**

## 2. Rodar localmente (opcional, para testar antes do deploy)

```bash
npm install
cp .env.example .env
# edite o .env e cole a URL e a anon key do Supabase
npm run dev
```

## 3. Subir para o GitHub

```bash
git init
git add .
git commit -m "App checklist operacional com Supabase"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

(Se o repositório já existe no GitHub com o `checklist_operacional_4.jsx`
solto, é mais simples apagar esse arquivo antigo e subir esta pasta inteira
no lugar dele.)

## 4. Deploy na Vercel

1. Acesse https://vercel.com, faça login com o GitHub.
2. **Add New... > Project**, selecione este repositório.
3. O Vercel detecta o Vite automaticamente (Build Command `npm run build`,
   Output Directory `dist`) — não precisa mudar nada.
4. Em **Environment Variables**, adicione as duas mesmas chaves do `.env`:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Clique em **Deploy**.

Pronto — a cada `git push` na branch `main`, a Vercel republica
automaticamente.

## Estrutura

```
├── index.html
├── package.json
├── vite.config.js
├── supabase/
│   └── schema.sql        ← rode isso no SQL Editor do Supabase
└── src/
    ├── main.jsx
    ├── App.jsx            ← aplicação inteira (telas, checklist, dashboard)
    └── lib/
        └── supabaseClient.js
```

## Observação de segurança

As políticas em `schema.sql` liberam leitura/escrita para qualquer pessoa
com a anon key (que fica visível no código do site, é pública por natureza).
Isso é aceitável para uso interno da equipe sem tela de login. Se depois for
importante restringir quem pode preencher os checklists, dá para adicionar
Supabase Auth (login por e-mail/senha ou magic link) e trocar as políticas
para checar `auth.uid()`.
