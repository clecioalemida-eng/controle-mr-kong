-- 220_extra_aprovada_na_previsao.sql — Mr Kong
-- Guarda a hora extra que a Previsão de escala gerou e que foi APROVADA,
-- por pessoa e semana, com o motivo. É o que a Jornada › Planejado × ponto
-- compara com o ponto depois da semana: extra combinada × extra que
-- aconteceu.
--
-- Os minutos já contam a hora noturna (52min30 = 1 h), como na Jornada.
--
-- Só acrescenta. Pode rodar duas vezes. Rodar ANTES de subir o código.
-- Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

create table if not exists public.previsoes_extras (
  id uuid primary key default gen_random_uuid(),
  semana date not null,                       -- segunda-feira da semana
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  minutos_extra60 int not null default 0,     -- dia comum, +60%
  minutos_extra100 int not null default 0,    -- domingo, +100%
  minutos_feriado int not null default 0,     -- feriado (+100%) e dia da categoria (dobro)
  motivo text,
  aprovado_por text,
  aprovado_em timestamptz not null default now(),
  unique (semana, pessoa_id)
);

alter table public.previsoes_extras enable row level security;
drop policy if exists "aprovados gerenciam previsoes_extras" on public.previsoes_extras;
create policy "aprovados gerenciam previsoes_extras" on public.previsoes_extras
  for all using (public.esta_aprovado()) with check (public.esta_aprovado());

alter table public.previsoes_escala_dias add column if not exists motivo_extra text;

select 'previsoes_extras' as item, (to_regclass('public.previsoes_extras') is not null)::text as ok;
