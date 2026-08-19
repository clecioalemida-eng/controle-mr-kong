-- Execute depois do 019_conferencia_caixa.sql.
-- Repasse ao entregador de delivery: valor fixo por entrega, diferente
-- antes e depois das 22h. A quantidade de entregas de cada janela é
-- calculada automaticamente a partir dos pedidos do dia; só o valor por
-- entrega é editável (e fica salvo, pra não ter que redigitar sempre).

create table if not exists public.repasses_delivery (
  id uuid primary key default gen_random_uuid(),
  dia date not null unique,
  valor_ate_22h numeric not null default 9.00,
  qtd_ate_22h integer not null default 0,
  valor_apos_22h numeric not null default 15.00,
  qtd_apos_22h integer not null default 0,
  criado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id)
);

alter table public.repasses_delivery enable row level security;

drop policy if exists "aprovados leem repasses" on public.repasses_delivery;
create policy "aprovados leem repasses" on public.repasses_delivery for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam repasses" on public.repasses_delivery;
create policy "aprovados gerenciam repasses" on public.repasses_delivery for all using (public.esta_aprovado()) with check (public.esta_aprovado());
