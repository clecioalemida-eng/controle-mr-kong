-- Execute depois do 007_mover_fichas_tecnicas_para_financeiro.sql.
-- Adiciona suporte a "insumo composto": um insumo que não é comprado
-- pronto, e sim preparado a partir de outros insumos (ex.: um molho da
-- casa). Nesse caso o custo não é digitado — é CALCULADO a partir da
-- composição + do rendimento (quanto a receita produz).
--
-- Limitação intencional: só 1 nível de composição (um composto é feito só
-- de insumos simples, não de outro composto) — evita recursão e cobre o
-- caso real de hoje (molhos, mixes). Isso é reforçado na tela (o seletor de
-- sub-insumo só mostra insumos simples), não no banco.

alter table public.insumos add column if not exists composto boolean not null default false;
alter table public.insumos add column if not exists rendimento numeric; -- só usado quando composto=true: quanto a receita rende, na mesma unidade do insumo

create table if not exists public.insumo_composicao (
  id uuid primary key default gen_random_uuid(),
  insumo_pai_id uuid not null references public.insumos(id) on delete cascade,
  insumo_filho_id uuid not null references public.insumos(id) on delete restrict,
  quantidade numeric not null default 0,
  criado_em timestamptz not null default now(),
  unique (insumo_pai_id, insumo_filho_id),
  check (insumo_pai_id <> insumo_filho_id)
);

alter table public.insumo_composicao enable row level security;

drop policy if exists "aprovados leem composicao" on public.insumo_composicao;
create policy "aprovados leem composicao" on public.insumo_composicao
  for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam composicao" on public.insumo_composicao;
create policy "aprovados gerenciam composicao" on public.insumo_composicao
  for all using (public.esta_aprovado()) with check (public.esta_aprovado());

-- Recalcula o custo_medio_atual de UM insumo composto, a partir da soma
-- (quantidade × custo de cada filho) dividida pelo rendimento.
create or replace function public.recalcular_custo_insumo_composto(p_insumo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_custo_total numeric;
  v_rendimento numeric;
begin
  select i.rendimento into v_rendimento from public.insumos i where i.id = p_insumo_id;

  select coalesce(sum(ic.quantidade * fi.custo_medio_atual), 0)
    into v_custo_total
    from public.insumo_composicao ic
    join public.insumos fi on fi.id = ic.insumo_filho_id
   where ic.insumo_pai_id = p_insumo_id;

  update public.insumos
     set custo_medio_atual = case when coalesce(v_rendimento, 0) > 0 then round(v_custo_total / v_rendimento, 4) else 0 end,
         atualizado_em = now()
   where id = p_insumo_id;
end;
$$;

-- Dispara sempre que a composição de um insumo muda (linha adicionada,
-- removida ou com quantidade editada).
create or replace function public.trg_composicao_mudou()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalcular_custo_insumo_composto(coalesce(new.insumo_pai_id, old.insumo_pai_id));
  return null;
end;
$$;

drop trigger if exists recalcular_apos_composicao on public.insumo_composicao;
create trigger recalcular_apos_composicao
  after insert or update or delete on public.insumo_composicao
  for each row execute function public.trg_composicao_mudou();

-- Dispara quando o custo de um insumo SIMPLES muda, recalculando qualquer
-- insumo composto que dependa dele (ex.: subiu o preço da maionese ->
-- recalcula o molho gourmet que usa maionese).
create or replace function public.trg_custo_insumo_mudou()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.composto = false and new.custo_medio_atual is distinct from old.custo_medio_atual then
    perform public.recalcular_custo_insumo_composto(ic.insumo_pai_id)
      from public.insumo_composicao ic
     where ic.insumo_filho_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists recalcular_apos_custo_insumo on public.insumos;
create trigger recalcular_apos_custo_insumo
  after update on public.insumos
  for each row execute function public.trg_custo_insumo_mudou();
