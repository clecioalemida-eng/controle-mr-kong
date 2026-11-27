-- 198_admissao_ferias_freela.sql — Mr Kong
-- Prepara o banco para a aba "Encargos e riscos" de Gente e Gestão.
-- Rodar DEPOIS de conferir o resultado da 197 e ANTES de subir o código.
--
-- O que faz:
--   1. pessoas.data_admissao — é dela que saem férias e 13º
--   2. vínculo "freela" (eventual) além de registrado e diarista
--   3. tabela ferias_concedidas — cada férias tirada, com o período
--      aquisitivo a que se refere; é o que zera o contador da tela
--
-- Não apaga nem altera dado nenhum que já existe. Pode rodar duas vezes.
--
-- Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

-- 1. Data de admissão ------------------------------------------------------
alter table public.pessoas add column if not exists data_admissao date;

comment on column public.pessoas.data_admissao is
  'Data de admissão na carteira. Só faz sentido para registrado. Base das férias e do 13º (estimativa do painel).';

-- 2. Vínculo freela --------------------------------------------------------
-- Antes de trocar a regra, confere se existe algum vínculo gravado que a
-- regra nova não conhece. Se existir, para tudo e mostra qual — em vez
-- de quebrar o cadastro.
do $vinculo$
declare
  estranhos text;
begin
  select string_agg(distinct tipo_contrato, ', ') into estranhos
    from public.pessoas
   where tipo_contrato not in ('registrado', 'diarista', 'freela');
  if estranhos is not null then
    raise exception 'Há pessoas com vínculo % — me mande essa mensagem antes de continuar.', estranhos;
  end if;
end $vinculo$;

alter table public.pessoas drop constraint if exists pessoas_tipo_contrato_check;
alter table public.pessoas add constraint pessoas_tipo_contrato_check
  check (tipo_contrato in ('registrado', 'diarista', 'freela'));

-- 3. Férias concedidas -----------------------------------------------------
create table if not exists public.ferias_concedidas (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  aquisitivo_inicio date not null,   -- início do período de 12 meses que deu direito
  inicio date not null,              -- primeiro dia de férias
  fim date not null,                 -- último dia de férias
  dias integer generated always as ((fim - inicio) + 1) stored,
  observacao text,
  criado_em timestamptz not null default now(),
  check (fim >= inicio)
);

create index if not exists ferias_concedidas_pessoa_idx
  on public.ferias_concedidas (pessoa_id, aquisitivo_inicio);

alter table public.ferias_concedidas enable row level security;

drop policy if exists "aprovados gerenciam ferias" on public.ferias_concedidas;
create policy "aprovados gerenciam ferias" on public.ferias_concedidas
  for all using (public.esta_aprovado()) with check (public.esta_aprovado());

-- Conferência -------------------------------------------------------------
select 'pessoas.data_admissao' as item,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'pessoas'
                  and column_name = 'data_admissao')::text as ok
union all
select 'ferias_concedidas', (to_regclass('public.ferias_concedidas') is not null)::text
union all
select 'vínculos hoje', string_agg(tipo_contrato || ': ' || n, ' · ')
  from (select tipo_contrato, count(*) n from public.pessoas group by 1) v;
