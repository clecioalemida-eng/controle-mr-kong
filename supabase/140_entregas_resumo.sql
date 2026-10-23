-- 140_entregas_resumo.sql — Mr Kong
-- O mesmo da 139, somado: quanto o delivery deu ou custou no período.
select count(*)                                                            as dias,
       sum(r.qtd_ate_22h + r.qtd_apos_22h)                                 as entregas,
       round(sum(coalesce(t.taxa_entrega, 0))::numeric, 2)                 as cobrado_do_cliente,
       round(sum(r.qtd_ate_22h * r.valor_ate_22h
               + r.qtd_apos_22h * r.valor_apos_22h)::numeric, 2)           as pago_ao_entregador,
       round((sum(coalesce(t.taxa_entrega, 0))
            - sum(r.qtd_ate_22h * r.valor_ate_22h
                + r.qtd_apos_22h * r.valor_apos_22h))::numeric, 2)         as sobra_ou_falta,
       round((sum(coalesce(t.taxa_entrega, 0))
            / nullif(sum(r.qtd_ate_22h + r.qtd_apos_22h), 0))::numeric, 2) as taxa_media_cobrada,
       round((sum(r.qtd_ate_22h * r.valor_ate_22h
                + r.qtd_apos_22h * r.valor_apos_22h)
            / nullif(sum(r.qtd_ate_22h + r.qtd_apos_22h), 0))::numeric, 2) as custo_medio_entrega
from public.repasses_delivery r
left join public.taxas_do_dia t on t.dia = r.dia
where r.dia >= current_date - 45;
