-- 174_tem_setor_no_cardapioweb.sql — Mr Kong
-- Só leitura. Não muda nada no banco.
--
-- O KDS do CardápioWeb divide o pedido por setor (chapa, bar…). A 173
-- contou os avisos do webhook, que vêm por pedido inteiro. Falta saber se
-- DENTRO do aviso (pedidos_eventos.bruto) ou do pedido completo
-- (pedidos_cache.payload) vem o setor de cada item e a hora em que cada
-- setor terminou. Se vier, dá pra medir por estação sem o tablet.
--
-- Mostra, de dados dos últimos 3 dias:
--   1. os campos de cada tipo de aviso do webhook (com um exemplo de valor)
--   2. os campos do pedido completo e dos ITENS dele
--   3. um aviso "ready" inteiro, como chegou
-- Nenhum dado de cliente é listado além do que já está no próprio aviso.
--
-- Onde rodar: Supabase → SQL Editor. Colar o resultado (CSV) na conversa.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

with ev as (
  select e.event_type, e.order_status, e.bruto
    from public.pedidos_eventos e
   where coalesce(e.ocorrido_em, e.recebido_em) >= now() - interval '3 days'
     and jsonb_typeof(e.bruto) = 'object'
),
campos_aviso as (
  select '1. campos do aviso'                                       as parte,
         event_type || ' / ' || order_status                        as onde,
         k.key                                                      as campo,
         left(min(k.value::text), 120)                              as exemplo
    from ev, jsonb_each(ev.bruto) k
   group by 2, 3
),
ped as (
  select c.payload
    from public.pedidos_cache c
   where c.criado_em >= now() - interval '3 days'
     and jsonb_typeof(c.payload) = 'object'
),
campos_pedido as (
  select '2. campos do pedido'                                      as parte,
         'pedido'                                                   as onde,
         k.key                                                      as campo,
         left(min(k.value::text), 120)                              as exemplo
    from ped, jsonb_each(ped.payload) k
   group by 3
),
campos_item as (
  select '2. campos do pedido'                                      as parte,
         'item do pedido'                                           as onde,
         k.key                                                      as campo,
         left(min(k.value::text), 120)                              as exemplo
    from ped,
         jsonb_array_elements(case when jsonb_typeof(ped.payload->'items') = 'array'
                                   then ped.payload->'items' else '[]'::jsonb end) it,
         jsonb_each(case when jsonb_typeof(it) = 'object' then it else '{}'::jsonb end) k
   group by 3
),
um_ready as (
  select '3. um aviso ready inteiro'                                as parte,
         event_type || ' / ' || order_status                        as onde,
         ''                                                         as campo,
         left(bruto::text, 3000)                                    as exemplo
    from ev
   where order_status = 'ready'
   limit 1
)
select * from campos_aviso
union all select * from campos_pedido
union all select * from campos_item
union all select * from um_ready
order by parte, onde, campo;
