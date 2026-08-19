-- Execute depois do 018_documento_pessoa.sql.
-- Conferência de caixa por forma de pagamento: compara o valor que o
-- CardápioWeb registrou com o valor que a pessoa confere de verdade
-- (extrato da maquininha, do PIX, contagem do dinheiro), mostrando a
-- diferença de cada forma separadamente — não só um total genérico.

create table if not exists public.conferencias_caixa (
  id uuid primary key default gen_random_uuid(),
  dia date not null,
  forma_pagamento text not null,
  valor_sistema numeric not null default 0,
  valor_conferido numeric not null default 0,
  criado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id),
  unique (dia, forma_pagamento)
);

alter table public.conferencias_caixa enable row level security;

drop policy if exists "aprovados leem conferencias" on public.conferencias_caixa;
create policy "aprovados leem conferencias" on public.conferencias_caixa for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam conferencias" on public.conferencias_caixa;
create policy "aprovados gerenciam conferencias" on public.conferencias_caixa for all using (public.esta_aprovado()) with check (public.esta_aprovado());
