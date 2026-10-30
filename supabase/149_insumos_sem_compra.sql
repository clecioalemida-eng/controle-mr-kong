-- ===========================================================================
-- 149 — Os insumos sem compra que REALMENTE importam
--
-- 107 insumos nunca comprados parece muito, mas a maioria pode ser
-- cadastro velho que não está em ficha nenhuma — esse não atrapalha conta
-- nenhuma. O que machuca é o insumo que está dentro de um prato que você
-- vende: ali o custo é palpite, e a margem daquele prato herda o palpite.
--
-- Esta lista é a fila de trabalho, do que mais pesa para o que menos pesa.
-- Só lê. Não escreve nada.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

with comprados as (
  select distinct m.insumo_id
    from public.movimentacoes_estoque m
   where m.tipo = 'compra' and m.preco_unitario > 0
),
uso as (
  select pi.insumo_id,
         count(distinct pi.prato_id)                                    as pratos,
         sum(pi.quantidade * coalesce(i.custo_medio_atual, 0))          as custo_somado
    from public.prato_insumos pi
    join public.insumos i on i.id = pi.insumo_id
    left join public.pratos p on p.id = pi.prato_id
   where coalesce(p.ativo, true)
   group by pi.insumo_id
)
select i.nome                                        as insumo,
       i.unidade,
       round(coalesce(i.custo_medio_atual, 0)::numeric, 4) as preco_no_painel,
       case when coalesce(i.custo_medio_atual, 0) > 0 then 'palpite' else 'ZERADO' end as situacao,
       u.pratos                                      as em_quantos_pratos,
       round(u.custo_somado::numeric, 2)             as peso_no_custo_dos_pratos
  from public.insumos i
  join uso u        on u.insumo_id = i.id
  left join comprados c on c.insumo_id = i.id
 where c.insumo_id is null
   and coalesce(i.composto, false) = false
 order by u.pratos desc, u.custo_somado desc
 limit 40;
