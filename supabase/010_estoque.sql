-- Execute depois do 009_molho_gourmet_e_mussarela.sql.
-- Estoque com histórico: cada entrada/saída vira uma linha no "extrato"
-- (movimentacoes_estoque), e o saldo de cada insumo é recalculado sozinho
-- por gatilho — mesmo padrão já usado no custo do insumo composto.

alter table public.insumos add column if not exists estoque_atual numeric not null default 0;
alter table public.insumos add column if not exists estoque_minimo numeric; -- opcional; null = sem alerta de mínimo

create table if not exists public.movimentacoes_estoque (
  id uuid primary key default gen_random_uuid(),
  insumo_id uuid not null references public.insumos(id) on delete cascade,
  tipo text not null check (tipo in ('compra', 'ajuste', 'perda', 'contagem')),
  quantidade numeric not null, -- positivo = entrada, negativo = saída
  preco_unitario numeric, -- só preenchido em compras; alimenta o custo médio do insumo
  motivo text, -- observação livre (ex.: "contagem mensal", "vencido")
  documento_compra_id uuid, -- referência à nota fiscal de origem, se houver (FK criada em 011)
  criado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id)
);

alter table public.movimentacoes_estoque enable row level security;

drop policy if exists "aprovados leem movimentacoes" on public.movimentacoes_estoque;
create policy "aprovados leem movimentacoes" on public.movimentacoes_estoque
  for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam movimentacoes" on public.movimentacoes_estoque;
create policy "aprovados gerenciam movimentacoes" on public.movimentacoes_estoque
  for all using (public.esta_aprovado()) with check (public.esta_aprovado());

create or replace function public.recalcular_estoque_insumo(p_insumo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.insumos
     set estoque_atual = coalesce((select sum(quantidade) from public.movimentacoes_estoque where insumo_id = p_insumo_id), 0)
   where id = p_insumo_id;
end;
$$;

create or replace function public.trg_movimentacao_estoque_mudou()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalcular_estoque_insumo(coalesce(new.insumo_id, old.insumo_id));
  return null;
end;
$$;

drop trigger if exists recalcular_apos_movimentacao on public.movimentacoes_estoque;
create trigger recalcular_apos_movimentacao
  after insert or update or delete on public.movimentacoes_estoque
  for each row execute function public.trg_movimentacao_estoque_mudou();
