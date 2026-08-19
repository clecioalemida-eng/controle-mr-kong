-- Execute depois do 023_cargo_no_cadastro.sql.
-- Cache compartilhado da taxa de serviço/entrega/adicional do dia — tanto
-- a Conferência de Caixa quanto a Escala do dia (Equipe) escrevem e leem
-- daqui, pra não consultar o CardápioWeb duas vezes pelo mesmo valor.

create table if not exists public.taxas_do_dia (
  dia date primary key,
  taxa_servico numeric not null default 0,
  taxa_entrega numeric not null default 0,
  taxa_adicional numeric not null default 0,
  atualizado_em timestamptz not null default now()
);

alter table public.taxas_do_dia enable row level security;

drop policy if exists "aprovados leem taxas_do_dia" on public.taxas_do_dia;
create policy "aprovados leem taxas_do_dia" on public.taxas_do_dia for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam taxas_do_dia" on public.taxas_do_dia;
create policy "aprovados gerenciam taxas_do_dia" on public.taxas_do_dia for all using (public.esta_aprovado()) with check (public.esta_aprovado());
