-- 197_raio_x_gente.sql — Mr Kong
-- Só leitura. Não muda nada no banco. Não mostra CPF, telefone nem PIX.
--
-- Para organizar FGTS, férias, 13º e o risco de quem trabalha sem
-- carteira, preciso saber o que o banco já guarda:
--   1. que colunas a tabela pessoas tem hoje (as migrações 035–138 não
--      estão no repositório, pode ter coisa que eu não conheço)
--   2. quem está ativo, com vínculo, cargo, salário e primeiro dia na escala
--   3. dias trabalhados por mês de cada diarista nos últimos 12 meses
--   4. se os holerites lançados na Folha ficam ligados à pessoa
--
-- Onde rodar: Supabase → SQL Editor. Colar o resultado (CSV) na conversa.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

with
colunas as (
  select string_agg(column_name || ' ' || data_type, ' · ' order by ordinal_position) as txt
    from information_schema.columns
   where table_schema = 'public' and table_name = 'pessoas'
),
primeiro_dia as (
  select pessoa_id, min(dia) as primeiro, max(dia) as ultimo, count(*) as dias
    from public.presencas_diarias group by pessoa_id
),
por_mes as (
  select pr.pessoa_id, to_char(pr.dia, 'YYYY-MM') as mes, count(*) as dias
    from public.presencas_diarias pr
   where pr.dia >= (current_date - interval '12 months')
   group by 1, 2
),
colunas_folha as (
  select string_agg(table_name || '.' || column_name, ' · ' order by table_name, ordinal_position) as txt
    from information_schema.columns
   where table_schema = 'public' and table_name in ('folha_itens', 'folhas_pagamento')
)
select '1. colunas de pessoas' as parte, '' as item, (select txt from colunas) as valor
union all
select '2. pessoa', pe.nome,
       format('%s · %s · ativo %s · salário %s · cadastrada %s · 1º dia na escala %s · último %s · %s dias no total',
              pe.tipo_contrato, pe.papel, pe.ativo, coalesce(pe.salario_base::text, '—'),
              to_char(pe.criado_em, 'DD/MM/YYYY'),
              coalesce(to_char(pd.primeiro, 'DD/MM/YYYY'), '—'),
              coalesce(to_char(pd.ultimo, 'DD/MM/YYYY'), '—'),
              coalesce(pd.dias, 0))
  from public.pessoas pe left join primeiro_dia pd on pd.pessoa_id = pe.id
union all
select '3. dias por mês', pe.nome,
       string_agg(pm.mes || ': ' || pm.dias, ' · ' order by pm.mes)
  from por_mes pm join public.pessoas pe on pe.id = pm.pessoa_id
 where pe.tipo_contrato = 'diarista'
 group by pe.nome
union all
select '4. colunas da folha', '', (select txt from colunas_folha)
union all
select '5. folha lançada', left(f.competencia::text, 7),
       format('%s pessoa(s) · total %s', f.pessoas, f.valor_total)
  from public.folhas_pagamento f
 where f.desfeita_em is null
order by 1, 2;
