-- 141_operacao_do_dia.sql — Mr Kong
-- O check de fim de expediente: a equipe está marcando produção?
-- Dia operacional das 5h às 5h, pelo relógio de Rio Verde — nunca por
-- current_date, que no banco é UTC e depois das 21h já virou amanhã.
with janela as (
  select (date_trunc('day', (now() at time zone 'America/Sao_Paulo') - interval '5 hours')
          + interval '5 hours') at time zone 'America/Sao_Paulo' as ini
)
select count(*)                                                as itens_do_dia,
       count(*) filter (where i.pego_em is not null)            as pegos,
       count(*) filter (where i.pronto_em is not null)          as terminados,
       count(distinct i.pedido_id)                              as pedidos,
       count(*) filter (where i.pronto_em is null)              as ainda_abertos,
       round(avg(extract(epoch from (i.pronto_em - i.pego_em))/60)
             filter (where i.pronto_em is not null and i.pego_em is not null)::numeric, 1)
                                                                as producao_media_min
from public.producao_itens i, janela j
where i.criado_em >= j.ini;
