-- 177_ate_quando_tem_venda_por_item.sql — Mr Kong
-- Só leitura. Não muda nada no banco.
--
-- A linha do tempo do Comercial mostra até 6 meses, semana a semana, e o
-- detalhe por item vem de pedidos_cache. Antes de desenhar a consulta,
-- esta lista mostra, mês a mês desde o início do cache, o quanto dele
-- existe e o quanto bate com o faturamento de vendas_diarias.
--
-- Onde rodar: Supabase → SQL Editor. Colar o resultado (CSV) na conversa.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

with cache as (
  select date_trunc('month', dia)::date as mes,
         count(distinct dia)            as dias_com_pedido,
         count(*)                       as pedidos,
         round(sum(total) filter (where status = 'closed'), 0) as total_fechado
    from public.pedidos_cache
   group by 1
),
vendas as (
  select date_trunc('month', dia)::date as mes,
         count(*)                       as dias_vendas,
         round(sum(faturamento_bruto), 0) as faturamento
    from public.vendas_diarias
   group by 1
)
select to_char(coalesce(c.mes, v.mes), 'YYYY-MM') as mes,
       coalesce(c.dias_com_pedido, 0)             as dias_com_pedido,
       coalesce(c.pedidos, 0)                     as pedidos,
       c.total_fechado,
       coalesce(v.dias_vendas, 0)                 as dias_vendas,
       v.faturamento,
       case when v.faturamento > 0
            then round(c.total_fechado / v.faturamento * 100, 0) end as pct_coberto
  from cache c
  full join vendas v on v.mes = c.mes
 order by 1 desc;
