-- 186_gerente_so_percentual.sql — Mr Kong
-- Só leitura. Não muda nada no banco.
--
-- Regra do Clécio (06/11/2026): gerente ganha SÓ o percentual do
-- faturamento, nada mais. Hoje a gerente diarista leva também a diária
-- base de gerente da Matriz de cargos em cada noite. Esta consulta mostra,
-- noite a noite em outubro, quanto foi percentual e quanto foi diária,
-- e se a noite já teve o pagamento das diárias lançado.
--
-- Onde rodar: Supabase → SQL Editor. Colar o resultado (CSV) na conversa.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

with noites as (
  select pe.nome, pe.tipo_contrato, pr.dia, pr.faturamento_dia, pr.comissao, pr.base_categoria, pr.total_dia,
         exists (select 1 from public.pagamentos_diaria pg where pg.dia = pr.dia) as pago
    from public.premiacoes_diarias pr
    join public.pessoas pe on pe.id = pr.pessoa_id
   where pr.metodo_usado = 'gerente'
     and pr.dia between '2026-10-01' and '2026-10-31'
)
select '1. matriz' as parte, 'gerente' as item,
       format('diária base: %s · percentual: %s%%', diaria_base, percentual_faturamento) as valor
  from public.matriz_cargos where papel = 'gerente'
union all
select '2. noite', nome || ' · ' || to_char(dia, 'DD/MM'),
       format('faturamento %s · percentual %s (%s%%) · diária %s · total %s · %s',
              faturamento_dia, comissao,
              case when coalesce(faturamento_dia, 0) > 0 then round(comissao / faturamento_dia * 100, 2) end,
              base_categoria, total_dia, case when pago then 'pago' else 'sem pagamento lançado' end)
  from noites
union all
select '3. resumo', nome || ' (' || tipo_contrato || ')',
       format('%s noites · percentual %s · diária %s · total %s · diária em noites pagas %s · diária em noites sem pagamento %s',
              count(*), sum(comissao), sum(base_categoria), sum(total_dia),
              sum(base_categoria) filter (where pago), sum(base_categoria) filter (where not pago))
  from noites group by nome, tipo_contrato
order by 1, 2;
