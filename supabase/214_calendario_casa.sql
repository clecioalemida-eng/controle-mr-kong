-- 214_calendario_casa.sql — Mr Kong
-- Calendário da casa para a Jornada: feriados, o dia da categoria e os
-- dias em que a casa foge do normal (abre numa segunda, fecha num dia
-- comum). Base: Convenção Coletiva dos bares, restaurantes e similares de
-- Rio Verde, registro GO000217/2026 (vigente de 01/02/2026 a 31/01/2028).
--
--   tipo = 'feriado'        → se trabalhar, toda hora com +100% (cl. 29ª)
--   tipo = 'dia_categoria'  → segunda de Carnaval: repouso; se trabalhar,
--                             em dobro (cl. 13ª)
--   tipo = 'abertura'       → a casa abre num dia em que normalmente fecha
--                             (segunda)
--   tipo = 'fechamento'     → a casa fecha num dia em que normalmente abre
--   casa_abre               → para feriado e dia da categoria: a casa abre?
--
-- Também cria pessoas.acordo_intervalo_reduzido: quem tem o acordo
-- individual de intervalo de 30 min (cl. 34ª, cópia ao sindicato em até
-- 10 dias). Sem ele, a tela cobra 1 h de intervalo.
--
-- Já vem preenchido com os feriados nacionais de 2026 e 2027, o
-- aniversário de Rio Verde (05/08), a segunda de Carnaval e as segundas
-- de novembro em que a casa abriu (09 e 16/11). Feriado municipal com
-- data incerta (São Sebastião, 20/01) não entra: inclua pela tela se valer.
--
-- Só acrescenta. Pode rodar duas vezes (não troca o que já existe).
-- Rodar ANTES de subir o código.
--
-- Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

create table if not exists public.calendario_casa (
  dia date primary key,
  nome text not null,
  tipo text not null check (tipo in ('feriado', 'dia_categoria', 'abertura', 'fechamento')),
  abrangencia text,                    -- nacional, municipal, convenção
  casa_abre boolean not null default true,
  atualizado_em timestamptz not null default now()
);

alter table public.calendario_casa enable row level security;
drop policy if exists "aprovados gerenciam calendario_casa" on public.calendario_casa;
create policy "aprovados gerenciam calendario_casa" on public.calendario_casa
  for all using (public.esta_aprovado()) with check (public.esta_aprovado());

alter table public.pessoas add column if not exists acordo_intervalo_reduzido boolean not null default false;
comment on column public.pessoas.acordo_intervalo_reduzido is
  'Tem acordo individual de intervalo de 30 min (CCT GO000217/2026, cl. 34ª). Sem ele, intervalo mínimo de 1 h.';

insert into public.calendario_casa (dia, nome, tipo, abrangencia, casa_abre) values
  -- 2026
  ('2026-01-01', 'Confraternização Universal', 'feriado', 'nacional', true),
  ('2026-02-16', 'Segunda de Carnaval — dia da categoria', 'dia_categoria', 'convenção', false),
  ('2026-04-03', 'Sexta-feira da Paixão', 'feriado', 'nacional', true),
  ('2026-04-21', 'Tiradentes', 'feriado', 'nacional', true),
  ('2026-05-01', 'Dia do Trabalho', 'feriado', 'nacional', true),
  ('2026-08-05', 'Aniversário de Rio Verde', 'feriado', 'municipal', true),
  ('2026-09-07', 'Independência', 'feriado', 'nacional', false),
  ('2026-10-12', 'Nossa Senhora Aparecida', 'feriado', 'nacional', false),
  ('2026-11-02', 'Finados', 'feriado', 'nacional', true),
  ('2026-11-09', 'Casa aberta na segunda', 'abertura', null, true),
  ('2026-11-15', 'Proclamação da República', 'feriado', 'nacional', true),
  ('2026-11-16', 'Casa aberta na segunda', 'abertura', null, true),
  ('2026-11-20', 'Consciência Negra', 'feriado', 'nacional', true),
  ('2026-12-25', 'Natal', 'feriado', 'nacional', true),
  -- 2027
  ('2027-01-01', 'Confraternização Universal', 'feriado', 'nacional', true),
  ('2027-02-08', 'Segunda de Carnaval — dia da categoria', 'dia_categoria', 'convenção', false),
  ('2027-03-26', 'Sexta-feira da Paixão', 'feriado', 'nacional', true),
  ('2027-04-21', 'Tiradentes', 'feriado', 'nacional', true),
  ('2027-05-01', 'Dia do Trabalho', 'feriado', 'nacional', true),
  ('2027-08-05', 'Aniversário de Rio Verde', 'feriado', 'municipal', true),
  ('2027-09-07', 'Independência', 'feriado', 'nacional', true),
  ('2027-10-12', 'Nossa Senhora Aparecida', 'feriado', 'nacional', true),
  ('2027-11-02', 'Finados', 'feriado', 'nacional', true),
  ('2027-11-15', 'Proclamação da República', 'feriado', 'nacional', false),
  ('2027-11-20', 'Consciência Negra', 'feriado', 'nacional', true),
  ('2027-12-25', 'Natal', 'feriado', 'nacional', true)
on conflict (dia) do nothing;

-- Feriado que cai numa segunda vem como casa fechada (casa_abre = false),
-- menos 02/11/2026, quando a casa abriu. Mude pela tela se for diferente.

-- Conferência -------------------------------------------------------------
select to_char(dia, 'DD/MM/YYYY') as dia, nome, tipo, casa_abre
  from public.calendario_casa
 where dia between '2026-11-01' and '2027-02-28'
 order by calendario_casa.dia;
