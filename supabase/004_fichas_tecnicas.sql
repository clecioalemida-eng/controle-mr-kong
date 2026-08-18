-- Execute depois do 003_novos_modulos.sql (SQL Editor > New query > Run).
-- Cria as tabelas de insumos, pratos e a composição (ficha técnica) de cada
-- prato, além de cadastrar o card "Fichas técnicas".

create table if not exists public.insumos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  unidade text not null default 'un' check (unidade in ('un', 'g', 'kg', 'ml', 'l')),
  custo_medio_atual numeric not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create unique index if not exists insumos_nome_unq on public.insumos (lower(nome));

-- Pratos: hoje descobertos a partir dos itens vendidos nos pedidos do
-- CardápioWeb (não existe endpoint de Catálogo acessível com o token atual
-- — ver README). cardapioweb_item_id liga de volta ao item real.
create table if not exists public.pratos (
  id uuid primary key default gen_random_uuid(),
  cardapioweb_item_id bigint unique,
  nome text not null,
  preco_venda numeric not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Composição de cada prato (a "ficha técnica" em si).
create table if not exists public.prato_insumos (
  id uuid primary key default gen_random_uuid(),
  prato_id uuid not null references public.pratos(id) on delete cascade,
  insumo_id uuid not null references public.insumos(id) on delete restrict,
  quantidade numeric not null default 0,
  criado_em timestamptz not null default now(),
  unique (prato_id, insumo_id)
);

alter table public.insumos enable row level security;
alter table public.pratos enable row level security;
alter table public.prato_insumos enable row level security;

-- Reaproveita a função esta_aprovado() criada em 002_auth_e_modulos.sql
drop policy if exists "aprovados leem insumos" on public.insumos;
create policy "aprovados leem insumos" on public.insumos for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam insumos" on public.insumos;
create policy "aprovados gerenciam insumos" on public.insumos for all using (public.esta_aprovado()) with check (public.esta_aprovado());

drop policy if exists "aprovados leem pratos" on public.pratos;
create policy "aprovados leem pratos" on public.pratos for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam pratos" on public.pratos;
create policy "aprovados gerenciam pratos" on public.pratos for all using (public.esta_aprovado()) with check (public.esta_aprovado());

drop policy if exists "aprovados leem prato_insumos" on public.prato_insumos;
create policy "aprovados leem prato_insumos" on public.prato_insumos for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam prato_insumos" on public.prato_insumos;
create policy "aprovados gerenciam prato_insumos" on public.prato_insumos for all using (public.esta_aprovado()) with check (public.esta_aprovado());

insert into public.modulos (chave, nome, descricao)
values ('fichas_tecnicas', 'Fichas técnicas', 'Composição, custo e margem de cada prato do cardápio')
on conflict (chave) do nothing;
