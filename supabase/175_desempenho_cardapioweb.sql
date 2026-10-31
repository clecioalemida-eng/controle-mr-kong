-- 175_desempenho_cardapioweb.sql — Mr Kong
--
-- A cozinha passou a operar só no KDS do CardápioWeb (29/10/2026). O
-- Desempenho do painel vira só análise, e o tempo sai dos avisos que o
-- CardápioWeb manda pelo webhook (pedidos_eventos), não mais do
-- "peguei/terminei" do tablet.
--
-- Esta função devolve UMA linha por pedido do período, com:
--   - os horários de cada etapa, tirados dos avisos:
--       criado    → ORDER_CREATED
--       aceito    → primeiro "confirmed"
--       pronto    → primeiro "ready" (o KDS do CardápioWeb)
--       saiu      → primeiro "released" ou "waiting_to_catch"
--       fechado   → primeiro "closed"
--   - se foi cancelado, e se já nasceu fechado (mesa lançada fechada no
--     caixa: não passa por etapa nenhuma, então não tem tempo);
--   - os itens com o setor de cada um. O setor vem do cadastro do prato
--     (aba Produtos do Desempenho) e, se o prato não tiver, do que ficou
--     gravado no item. Assim, mapear um produto hoje corrige os dias
--     passados também.
--
-- A tela faz as contas (medianas, quanto cada setor soma, combinações,
-- por hora). Aqui só se junta o que pertence a cada pedido.
--
-- O CardápioWeb não manda o setor nem a hora de cada setor (conferido na
-- 174). Se um dia mandar, é aqui que entra.
--
-- Dia operacional das 5h às 5h, pelo relógio de Rio Verde.
--
-- Só cria a função. Não muda dado nenhum.
-- Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

create or replace function public.desempenho_cardapioweb(p_inicio date, p_fim date)
returns table (
  pedido_id      text,
  referencia     text,
  canal          text,
  dia            date,
  criado_em      timestamptz,
  aceito_em      timestamptz,
  pronto_em      timestamptz,
  saiu_em        timestamptz,
  fechado_em     timestamptz,
  cancelado      boolean,
  nasceu_fechado boolean,
  itens          jsonb
)
language sql
stable
as $$
  with ev as (
    select e.pedido_id::text                          as pedido_id,
           e.event_type,
           e.order_status,
           coalesce(e.ocorrido_em, e.recebido_em)     as em
      from public.pedidos_eventos e
     -- Folga de um dia nas pontas; o corte certo é pelo dia operacional, abaixo.
     where coalesce(e.ocorrido_em, e.recebido_em) >= (p_inicio - 1)::timestamp at time zone 'America/Sao_Paulo'
       and coalesce(e.ocorrido_em, e.recebido_em) <  (p_fim + 2)::timestamp at time zone 'America/Sao_Paulo'
       and e.pedido_id is not null
  ),
  ped as (
    select ev.pedido_id,
           min(em) filter (where event_type = 'ORDER_CREATED')                       as criado_em,
           min(em) filter (where order_status = 'confirmed')                         as aceito_em,
           min(em) filter (where order_status = 'ready')                             as pronto_em,
           min(em) filter (where order_status in ('released', 'waiting_to_catch'))   as saiu_em,
           min(em) filter (where order_status = 'closed')                            as fechado_em,
           bool_or(order_status = 'canceled')                                        as cancelado,
           coalesce(bool_or(event_type = 'ORDER_CREATED' and order_status = 'closed'), false) as nasceu_fechado,
           min(em)                                                                   as primeiro
      from ev
     group by ev.pedido_id
  ),
  noperiodo as (
    select p.*,
           ((coalesce(p.criado_em, p.primeiro) at time zone 'America/Sao_Paulo') - interval '5 hours')::date as dia
      from ped p
  ),
  itens as (
    select i.pedido_id::text as pedido_id,
           jsonb_agg(jsonb_build_object(
             'nome',  coalesce(pr.nome, i.nome),
             'setor', coalesce(pr.setor, i.setor)
           ) order by coalesce(pr.nome, i.nome)) as itens
      from public.producao_itens i
      left join public.pratos pr on pr.id = i.prato_id
     where i.pedido_id::text in (select n.pedido_id from noperiodo n where n.dia between p_inicio and p_fim)
     group by i.pedido_id::text
  )
  select n.pedido_id,
         pp.referencia,
         pp.canal,
         n.dia,
         n.criado_em,
         n.aceito_em,
         n.pronto_em,
         n.saiu_em,
         n.fechado_em,
         coalesce(n.cancelado, false),
         n.nasceu_fechado,
         coalesce(it.itens, '[]'::jsonb)
    from noperiodo n
    left join itens it on it.pedido_id = n.pedido_id
    left join public.producao_pedidos pp on pp.pedido_id::text = n.pedido_id
   where n.dia between p_inicio and p_fim
   order by n.criado_em nulls last;
$$;

grant execute on function public.desempenho_cardapioweb(date, date) to authenticated;

-- Confere, nos últimos 7 dias: quantos pedidos, quantos com "pronto", e
-- quantos acharam os itens (e o setor) — se "com_itens" vier 0, o número
-- do pedido nos avisos não bate com o dos itens, e a tela fica sem setor.
select count(*)                                                        as pedidos,
       count(*) filter (where pronto_em is not null)                   as com_pronto,
       count(*) filter (where jsonb_array_length(itens) > 0)           as com_itens,
       count(*) filter (where exists (select 1 from jsonb_array_elements(itens) x
                                       where x->>'setor' is not null)) as com_setor,
       count(*) filter (where nasceu_fechado)                          as nasceram_fechados
  from public.desempenho_cardapioweb(
         ((now() at time zone 'America/Sao_Paulo') - interval '5 hours')::date - 6,
         ((now() at time zone 'America/Sao_Paulo') - interval '5 hours')::date);
