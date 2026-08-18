-- Execute depois do 013_produtos_extras_cardapio.sql.
-- Cadastro de pessoas (equipe) e cálculo da premiação diária (taxa de
-- serviço dividida 50/50 entre garçons e equipe interna, cada metade
-- dividida pelo peso de quem trabalhou naquele dia — peso 1 = dia
-- inteiro, 0.5 = meio período, igual ao jeito que já era calculado na
-- planilha). Diarista soma uma diária fixa em cima da comissão do dia;
-- registrado só acumula a comissão, fechada no fim do mês.

create table if not exists public.pessoas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  papel text not null check (papel in ('garcom', 'interno')),
  tipo_contrato text not null check (tipo_contrato in ('registrado', 'diarista')),
  valor_diaria numeric, -- só usado quando tipo_contrato = 'diarista'
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists public.presencas_diarias (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  dia date not null,
  peso numeric not null default 1, -- fração do dia trabalhada (1 = inteiro, 0.5 = meio período)
  criado_em timestamptz not null default now(),
  unique (pessoa_id, dia)
);

create table if not exists public.premiacoes_diarias (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  dia date not null,
  taxa_servico_dia numeric not null,
  comissao numeric not null,
  valor_diaria numeric not null default 0,
  total_dia numeric not null,
  criado_em timestamptz not null default now(),
  unique (pessoa_id, dia)
);

alter table public.pessoas enable row level security;
alter table public.presencas_diarias enable row level security;
alter table public.premiacoes_diarias enable row level security;

drop policy if exists "aprovados leem pessoas" on public.pessoas;
create policy "aprovados leem pessoas" on public.pessoas for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam pessoas" on public.pessoas;
create policy "aprovados gerenciam pessoas" on public.pessoas for all using (public.esta_aprovado()) with check (public.esta_aprovado());

drop policy if exists "aprovados leem presencas" on public.presencas_diarias;
create policy "aprovados leem presencas" on public.presencas_diarias for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam presencas" on public.presencas_diarias;
create policy "aprovados gerenciam presencas" on public.presencas_diarias for all using (public.esta_aprovado()) with check (public.esta_aprovado());

drop policy if exists "aprovados leem premiacoes" on public.premiacoes_diarias;
create policy "aprovados leem premiacoes" on public.premiacoes_diarias for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam premiacoes" on public.premiacoes_diarias;
create policy "aprovados gerenciam premiacoes" on public.premiacoes_diarias for all using (public.esta_aprovado()) with check (public.esta_aprovado());
