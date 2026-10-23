-- 139_entregas_batem.sql — Mr Kong
-- "Nunca bate as entregas": põe lado a lado o que o CLIENTE pagou de taxa
-- de entrega e o que foi PAGO ao entregador, dia a dia.
--
-- As duas pontas vêm de lugares diferentes, e é por isso que a conta some:
--   taxas_do_dia.taxa_entrega  → soma do delivery_fee dos pedidos (CardápioWeb)
--   repasses_delivery          → quantidade × valor por entrega, digitado na
--                                Conferência de caixa
--
-- Olhe três coisas: a diferença em reais, a taxa média que o cliente pagou
-- por entrega e quantas entregas cada lado contou.

select r.dia,
       (r.qtd_ate_22h + r.qtd_apos_22h)                                   as entregas,
       r.qtd_ate_22h, r.valor_ate_22h,
       r.qtd_apos_22h, r.valor_apos_22h,
       round((r.qtd_ate_22h * r.valor_ate_22h
            + r.qtd_apos_22h * r.valor_apos_22h)::numeric, 2)             as pago_ao_entregador,
       round(coalesce(t.taxa_entrega, 0)::numeric, 2)                     as cobrado_do_cliente,
       round((coalesce(t.taxa_entrega, 0)
            - (r.qtd_ate_22h * r.valor_ate_22h
             + r.qtd_apos_22h * r.valor_apos_22h))::numeric, 2)           as sobra_ou_falta,
       round((coalesce(t.taxa_entrega, 0)
            / nullif(r.qtd_ate_22h + r.qtd_apos_22h, 0))::numeric, 2)     as taxa_media_cobrada,
       case when t.dia is null then 'sem taxa do dia no cache' else '' end as aviso
from public.repasses_delivery r
left join public.taxas_do_dia t on t.dia = r.dia
where r.dia >= current_date - 45
order by r.dia desc;
