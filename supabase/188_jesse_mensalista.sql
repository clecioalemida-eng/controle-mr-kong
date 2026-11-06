-- 188_jesse_mensalista.sql — Mr Kong
-- Só leitura. Não muda nada no banco. Não mostra telefone nem PIX.
--
-- O Jesse já era mensalista em outubro, mas as noites dele foram
-- calculadas como diarista (diária base do cargo + comissão, ou por hora).
-- Mensalista ganha só a comissão do dia; o salário entra no fechamento.
-- Esta consulta mostra, noite a noite em outubro:
--   - a comissão (o que ele deveria ter ganho na noite)
--   - a diária e o método por hora (o que entrou a mais)
--   - se a noite teve o Pagamento das diárias lançado — nesse caso ele
--     pode ter recebido em dinheiro na saída, como diarista
-- E compara com a comissão da Lidiane nas mesmas noites (mesmo bolo:
-- equipe interna).
--
-- Onde rodar: Supabase → SQL Editor. Colar o resultado (CSV) na conversa.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

with jesse as (
  select pr.*, exists (select 1 from public.pagamentos_diaria pg where pg.dia = pr.dia) as pago
    from public.premiacoes_diarias pr
    join public.pessoas pe on pe.id = pr.pessoa_id
   where pe.nome ilike 'jesse pereira%'
     and pr.dia between '2026-10-01' and '2026-10-31'
),
lidiane as (
  select pr.dia, pr.comissao
    from public.premiacoes_diarias pr
    join public.pessoas pe on pe.id = pr.pessoa_id
   where pe.nome ilike 'lidiane andrade%'
     and pr.dia between '2026-10-01' and '2026-10-31'
)
select '1. cadastro' as parte, pe.nome as item,
       format('%s · %s · salário %s · %s pessoa(s) com esse nome', pe.tipo_contrato, pe.papel, pe.salario_base,
              (select count(*) from public.pessoas x where x.nome ilike 'jesse pereira%')) as valor
  from public.pessoas pe where pe.nome ilike 'jesse pereira%'
union all
select '2. noite', to_char(j.dia, 'DD/MM'),
       format('comissão %s · Lidiane %s · diária %s · método %s · por hora %s · total %s · %s',
              j.comissao, coalesce(l.comissao::text, 'não trabalhou'), j.base_categoria, coalesce(j.metodo_usado, '—'),
              coalesce(j.valor_metodo_hora::text, '—'), j.total_dia,
              case when j.pago then 'pagamento lançado' else 'sem pagamento' end)
  from jesse j left join lidiane l on l.dia = j.dia
union all
select '3. resumo', 'Jesse em outubro',
       format('%s noites · comissão %s · total gravado %s · a mais %s · total gravado em noites com pagamento lançado %s',
              count(*), sum(comissao), sum(total_dia), sum(total_dia) - sum(comissao),
              sum(total_dia) filter (where pago))
  from jesse
order by 1, 2;
