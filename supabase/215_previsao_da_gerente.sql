-- 215_previsao_da_gerente.sql — Mr Kong
-- Previsão de escala montada pela gerente, com ajuda da tela e aprovação
-- do administrador.
--
-- O que faz:
--   1. Função nova "espeteiro" (cadastro, Matriz de cargos, Escala do dia).
--      Acrescenta 'espeteiro' em toda regra do banco que lista as funções
--      (procura as regras que citam 'gerente' e soma o espeteiro nelas).
--   2. Previsão com horário e função do dia: previsoes_escala ganha
--      entrada, intervalo, saída e papel_no_dia.
--   3. Aprovação: previsoes_escala_dias ganha status (rascunho, enviada,
--      aprovada, devolvida), quem enviou, quem aprovou e os comentários.
--   4. cobertura_minima: o mínimo de cada área por dia da semana e horário.
--      Já vem com a sugestão do mockup (espeteiro de terça a sábado).
--   5. pessoas.responde_pela_casa: quem, além da gerente, conta como
--      "responsável" na cobertura.
--   6. Cargo Gerente: Previsão de escala = editar; Jornada = ver. Só sobe
--      nível que estava em "nenhum" — não rebaixa ninguém.
--
-- Só acrescenta. Pode rodar duas vezes. Rodar ANTES de subir o código.
-- Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

-- 1. Espeteiro ----------------------------------------------------------
-- Toda regra CHECK das tabelas da equipe que lista 'gerente' ganha
-- 'espeteiro' ao lado. Assim não importa se alguma migração antiga (fora
-- do repositório) mudou a lista: o que já existe continua valendo.
do $espeteiro$
declare
  r record;
  def text;
begin
  for r in
    select con.conrelid::regclass as tabela, con.conname as nome, pg_get_constraintdef(con.oid) as definicao
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace
     where ns.nspname = 'public'
       and con.contype = 'c'
       and cl.relname in ('pessoas', 'matriz_cargos', 'presencas_diarias', 'premiacoes_diarias', 'previsoes_escala')
       and pg_get_constraintdef(con.oid) like '%''gerente''%'
       and pg_get_constraintdef(con.oid) not like '%''espeteiro''%'
  loop
    def := replace(r.definicao, '''gerente''::text', '''gerente''::text, ''espeteiro''::text');
    if def = r.definicao then
      raise exception 'Não soube acrescentar espeteiro na regra % de % (%). Me mande esta mensagem.', r.nome, r.tabela, r.definicao;
    end if;
    execute format('alter table %s drop constraint %I', r.tabela, r.nome);
    execute format('alter table %s add constraint %I %s', r.tabela, r.nome, def);
    raise notice 'Espeteiro acrescentado em % (%).', r.tabela, r.nome;
  end loop;
end $espeteiro$;

insert into public.matriz_cargos (papel) values ('espeteiro')
on conflict (papel) do nothing;

-- 2. Horário e função na previsão ---------------------------------------
alter table public.previsoes_escala add column if not exists entrada time;
alter table public.previsoes_escala add column if not exists intervalo_inicio time;
alter table public.previsoes_escala add column if not exists intervalo_fim time;
alter table public.previsoes_escala add column if not exists saida time;
alter table public.previsoes_escala add column if not exists papel_no_dia text;

-- 3. Aprovação ----------------------------------------------------------
alter table public.previsoes_escala_dias add column if not exists status text not null default 'rascunho';
alter table public.previsoes_escala_dias drop constraint if exists previsoes_escala_dias_status_check;
alter table public.previsoes_escala_dias add constraint previsoes_escala_dias_status_check
  check (status in ('rascunho', 'enviada', 'aprovada', 'devolvida'));
alter table public.previsoes_escala_dias add column if not exists enviado_por text;
alter table public.previsoes_escala_dias add column if not exists enviado_em timestamptz;
alter table public.previsoes_escala_dias add column if not exists aprovado_por text;
alter table public.previsoes_escala_dias add column if not exists aprovado_em timestamptz;
alter table public.previsoes_escala_dias add column if not exists comentario_gerente text;
alter table public.previsoes_escala_dias add column if not exists comentario_aprovacao text;
-- Dia que já estava "fechado" do jeito antigo conta como aprovado.
update public.previsoes_escala_dias set status = 'aprovada' where fechada and status = 'rascunho';

-- 4. Cobertura mínima ---------------------------------------------------
create table if not exists public.cobertura_minima (
  id uuid primary key default gen_random_uuid(),
  area text not null,
  papeis text[],                 -- quem conta; vazio = qualquer um; 'responsavel' = gerente ou quem responde pela casa
  dias smallint[] not null default '{0,2,3,4,5,6}', -- 0 = domingo … 6 = sábado
  inicio time not null,
  fim time not null,             -- fim menor que início = madrugada
  minimo int not null default 1,
  ordem int not null default 0,
  ativo boolean not null default true
);
alter table public.cobertura_minima enable row level security;
drop policy if exists "aprovados gerenciam cobertura_minima" on public.cobertura_minima;
create policy "aprovados gerenciam cobertura_minima" on public.cobertura_minima
  for all using (public.esta_aprovado()) with check (public.esta_aprovado());

insert into public.cobertura_minima (area, papeis, dias, inicio, fim, minimo, ordem)
select * from (values
  ('Abertura',        null::text[],             '{0,2,3,4,5,6}'::smallint[], '16:00'::time, '16:30'::time, 1, 1),
  ('Responsável',     '{responsavel}'::text[],  '{0,2,3,4,5,6}'::smallint[], '16:00'::time, '02:00'::time, 1, 2),
  ('Caixa',           '{caixa}'::text[],        '{0,2,3,4,5,6}'::smallint[], '16:00'::time, '02:00'::time, 1, 3),
  ('Chapa',           '{chapa}'::text[],        '{0,2,3,4,5,6}'::smallint[], '17:00'::time, '01:30'::time, 1, 4),
  ('Espeteiro',       '{espeteiro}'::text[],    '{2,3,4,5,6}'::smallint[],   '17:00'::time, '01:30'::time, 1, 5),
  ('Cozinha',         '{cozinha}'::text[],      '{0,2,3,4,5,6}'::smallint[], '16:00'::time, '01:30'::time, 1, 6),
  ('Garçom',          '{garcom}'::text[],       '{0,2,3,4,5,6}'::smallint[], '18:00'::time, '02:00'::time, 1, 7),
  ('Garçom no pico',  '{garcom}'::text[],       '{0,2,3,4,5,6}'::smallint[], '20:00'::time, '23:00'::time, 2, 8)
) v(area, papeis, dias, inicio, fim, minimo, ordem)
where not exists (select 1 from public.cobertura_minima);

-- 5. Quem responde pela casa --------------------------------------------
alter table public.pessoas add column if not exists responde_pela_casa boolean not null default false;

-- 6. Cargo Gerente ------------------------------------------------------
insert into public.cargo_permissoes as cp (cargo_id, chave, nivel)
select c.id, v.chave, v.nivel
  from public.cargos c
 cross join (values ('gente.previsao', 'editar'), ('gente.jornada', 'ver')) v(chave, nivel)
 where c.nome ilike 'gerente'
on conflict (cargo_id, chave) do update set nivel = excluded.nivel
 where cp.nivel = 'nenhum';

-- Conferência -------------------------------------------------------------
select 'espeteiro na matriz' as item, exists (select 1 from public.matriz_cargos where papel = 'espeteiro')::text as ok
union all
select 'regras com espeteiro', (select count(*) from pg_constraint con join pg_class cl on cl.oid = con.conrelid
   where cl.relname in ('pessoas', 'matriz_cargos', 'presencas_diarias', 'premiacoes_diarias', 'previsoes_escala')
     and con.contype = 'c' and pg_get_constraintdef(con.oid) like '%''espeteiro''%')::text
union all
select 'cobertura_minima', (select count(*) from public.cobertura_minima)::text || ' áreas'
union all
select 'gerente: ' || cp.chave, cp.nivel
  from public.cargo_permissoes cp join public.cargos c on c.id = cp.cargo_id
 where c.nome ilike 'gerente' and cp.chave in ('gente.previsao', 'gente.jornada');
