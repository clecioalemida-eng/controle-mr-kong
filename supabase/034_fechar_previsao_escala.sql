-- Execute depois do 033_linha_produto.sql.
-- Guarda se um dia da Previsao de Escala foi "fechado" -- fica travado
-- (so mostra quem foi marcado, sem os checkboxes de todo mundo) ate
-- clicar em editar de novo.

create table if not exists public.previsoes_escala_dias (
  dia date primary key,
  fechada boolean not null default false,
  atualizado_em timestamptz not null default now()
);
alter table public.previsoes_escala_dias enable row level security;
drop policy if exists "aprovados leem previsoes_escala_dias" on public.previsoes_escala_dias;
create policy "aprovados leem previsoes_escala_dias" on public.previsoes_escala_dias for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam previsoes_escala_dias" on public.previsoes_escala_dias;
create policy "aprovados gerenciam previsoes_escala_dias" on public.previsoes_escala_dias for all using (public.esta_aprovado()) with check (public.esta_aprovado());
