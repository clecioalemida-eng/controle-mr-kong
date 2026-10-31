-- 173_etapas_do_cardapioweb.sql — Mr Kong
-- Só leitura. Não muda nada no banco.
--
-- A 172 mostrou que a marcação no tablet do painel parou em 29/10 (a
-- cozinha foi pro KDS do CardápioWeb) e que existem pedidos_eventos (cada
-- aviso do webhook) e producao_pedidos (aceito/pronto/saiu/entregue).
--
-- Pergunta: o CardápioWeb manda as etapas do pedido — em especial o
-- "pronto" que o KDS dele marca? Se manda, a análise pode ser por pedido
-- sem ninguém marcar nada no painel.
--
-- Uma tabela só, em duas partes:
--   1. que status chegam pelo webhook, por dia (14 dias)
--   2. quantos pedidos têm cada horário preenchido em producao_pedidos
--
-- Onde rodar: Supabase → SQL Editor. Colar o resultado (CSV) na conversa.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

with eventos as (
  select ((coalesce(e.ocorrido_em, e.recebido_em) at time zone 'America/Sao_Paulo') - interval '5 hours')::date as dia,
         coalesce(e.event_type, '?') || ' / ' || coalesce(e.order_status, '?') as tipo,
         e.pedido_id
    from public.pedidos_eventos e
   where coalesce(e.ocorrido_em, e.recebido_em) >= now() - interval '14 days'
),
parte1 as (
  select '1. avisos do webhook'                                    as parte,
         dia::text                                                 as dia,
         string_agg(tipo || ': ' || n, ' · ' order by n desc)      as detalhe
    from (select dia, tipo, count(distinct pedido_id) as n from eventos group by dia, tipo) x
   group by dia
),
pedidos as (
  select ((p.criado_em at time zone 'America/Sao_Paulo') - interval '5 hours')::date as dia, p.*
    from public.producao_pedidos p
   where p.criado_em >= now() - interval '14 days'
),
parte2 as (
  select '2. horários em producao_pedidos'                         as parte,
         dia::text                                                 as dia,
         format('%s pedidos · aceito %s · pronto %s · saiu %s · entregue %s · fechado %s · cancelado %s · canais: %s',
                count(*),
                count(aceito_em), count(pronto_em), count(saiu_em),
                count(entregue_em), count(fechado_em), count(cancelado_em),
                string_agg(distinct coalesce(canal, '?'), '/'))    as detalhe
    from pedidos
   group by dia
)
select * from parte1
union all
select * from parte2
order by parte, dia desc;
