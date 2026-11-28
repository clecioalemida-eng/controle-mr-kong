-- 210_jornada_registrados.sql — Mr Kong
-- Jornada dos registrados para a regra nova (EC 141/2026): 42 h por
-- semana e 2 folgas a partir de 16/12/2026; 40 h a partir de 16/12/2027.
--
-- O que faz:
--   1. Horário padrão de cada pessoa (entrada, intervalo, saída) e a
--      marcação de quem tem domingo de folga a cada 15 dias (art. 386 da
--      CLT, para mulheres).
--   2. Tabela escala_jornada: o que foge do padrão em cada dia — folga
--      (além da segunda, que é a casa fechada) ou horário diferente.
--      Dia sem linha = trabalha no horário padrão.
--
-- Só acrescenta. Não mexe em dado nenhum. Pode rodar duas vezes.
-- Rodar ANTES de subir o código da aba Jornada.
--
-- Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

-- 1. Horário padrão ---------------------------------------------------------
alter table public.pessoas add column if not exists jornada_entrada time;
alter table public.pessoas add column if not exists jornada_intervalo_inicio time;
alter table public.pessoas add column if not exists jornada_intervalo_fim time;
alter table public.pessoas add column if not exists jornada_saida time;
alter table public.pessoas add column if not exists domingo_quinzenal boolean not null default false;

comment on column public.pessoas.jornada_entrada is 'Horário padrão de entrada (registrado). Saída menor que entrada = madrugada do dia seguinte.';
comment on column public.pessoas.domingo_quinzenal is 'Folga de domingo a cada 15 dias (CLT art. 386). Os demais: pelo menos 1 domingo por mês.';

-- 2. O que foge do padrão em cada dia -------------------------------------
create table if not exists public.escala_jornada (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  dia date not null,
  folga boolean not null default false,
  entrada time,
  intervalo_inicio time,
  intervalo_fim time,
  saida time,
  observacao text,
  atualizado_em timestamptz not null default now(),
  unique (pessoa_id, dia)
);

create index if not exists escala_jornada_dia_idx on public.escala_jornada (dia);

alter table public.escala_jornada enable row level security;

drop policy if exists "aprovados gerenciam escala_jornada" on public.escala_jornada;
create policy "aprovados gerenciam escala_jornada" on public.escala_jornada
  for all using (public.esta_aprovado()) with check (public.esta_aprovado());

-- Conferência -------------------------------------------------------------
select 'pessoas.jornada_*' as item,
       (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'pessoas'
           and column_name in ('jornada_entrada','jornada_intervalo_inicio','jornada_intervalo_fim','jornada_saida','domingo_quinzenal'))::text || ' de 5' as ok
union all
select 'escala_jornada', (to_regclass('public.escala_jornada') is not null)::text;
