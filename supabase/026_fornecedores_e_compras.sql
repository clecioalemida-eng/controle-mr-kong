-- Execute depois do 025_previa_gerente.sql.
-- Cadastro de fornecedores (com histórico de compras vinculado) e
-- configuração de dias de estoque pra sugestão de compras.

create table if not exists public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique,
  telefone text,
  criado_em timestamptz not null default now()
);

alter table public.fornecedores enable row level security;
drop policy if exists "aprovados leem fornecedores" on public.fornecedores;
create policy "aprovados leem fornecedores" on public.fornecedores for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam fornecedores" on public.fornecedores;
create policy "aprovados gerenciam fornecedores" on public.fornecedores for all using (public.esta_aprovado()) with check (public.esta_aprovado());

alter table public.documentos_compra add column if not exists fornecedor_id uuid references public.fornecedores(id);

-- Configuração simples de chave/valor — hoje só guarda "quantos dias de
-- estoque cobrir" na página Compras, mas serve pra outras configs
-- futuras sem precisar de mais uma migração cada vez.
create table if not exists public.configuracoes (
  chave text primary key,
  valor text
);
insert into public.configuracoes (chave, valor) values ('dias_estoque_compras', '4') on conflict (chave) do nothing;

alter table public.configuracoes enable row level security;
drop policy if exists "aprovados leem configuracoes" on public.configuracoes;
create policy "aprovados leem configuracoes" on public.configuracoes for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam configuracoes" on public.configuracoes;
create policy "aprovados gerenciam configuracoes" on public.configuracoes for all using (public.esta_aprovado()) with check (public.esta_aprovado());
