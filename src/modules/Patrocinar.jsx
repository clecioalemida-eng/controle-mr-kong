-- ---------------------------------------------------------------------------
-- 056_log_encerramentos.sql
-- Execute no SQL Editor. Nao depende das migrations do KDS.
--
-- O painel passa a poder PAUSAR anuncio na Meta. Ate hoje ele so lia
-- (ads_read, por decisao). Toda vez que um poder novo entra, entra junto o
-- registro de quem usou — senao, daqui a um mes, ninguem sabe quem desligou
-- o anuncio que estava vendendo.
--
-- Esta tabela e so o livro-caixa do botao. Quem pausa de verdade e a Edge
-- Function meta-encerrar-anuncio, que grava aqui depois de cada tentativa,
-- inclusive as que a Meta recusou.
-- ---------------------------------------------------------------------------

create table if not exists public.meta_encerramentos (
  id           uuid primary key default gen_random_uuid(),
  anuncio_id   text not null,
  nome         text,
  gasto_ate    numeric,          -- quanto ja tinha gastado quando foi pausado
  motivo       text,             -- o que a tela mostrava ao lado do botao
  quem         uuid references auth.users(id),
  ok           boolean not null,
  erro         text,             -- a recusa da Meta, quando houve
  criado_em    timestamptz not null default now()
);

create index if not exists meta_encerramentos_criado_idx
  on public.meta_encerramentos (criado_em desc);

alter table public.meta_encerramentos enable row level security;

-- Quem ve dinheiro e admin: a mesma regra das outras tabelas meta_*.
drop policy if exists meta_encerramentos_leitura on public.meta_encerramentos;
create policy meta_encerramentos_leitura on public.meta_encerramentos
  for select using (public.is_admin());

-- Ninguem escreve daqui: so a Edge Function, que usa a service role e passa
-- por cima da RLS. Sem politica de insert, o navegador nao consegue forjar
-- um registro de encerramento que nao aconteceu.

comment on table public.meta_encerramentos is
  'Livro-caixa do botao "Encerrar patrocinio": toda tentativa de pausar anuncio na Meta, inclusive as recusadas. Escrito apenas pela Edge Function meta-encerrar-anuncio.';
