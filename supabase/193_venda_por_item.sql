-- 193_venda_por_item.sql — Mr Kong
--
-- Comercial → "Venda de cada item". A tela quer saber quantos hambúrgueres,
-- batatas e bebidas saíram de verdade, somando o que foi vendido sozinho
-- com o que saiu dentro de combo.
--
-- Como o combo chega do CardápioWeb (consultas 191 e 192):
--   * Combo montado (o mais comum): o lanche vem como item próprio, mais um
--     item "coca + fritas", "milkshake morango + fritas" etc. Esse segundo
--     item é a bebida + batata P do combo.
--   * Combo fechado (plataformas que exigem tudo junto): um item só,
--     "Combo X Tudo | Lanche + Batata + Bebida". O lanche está no nome, e a
--     bebida vem na opção ("Coca Cola + fritas"). Alguns vêm sem opção.
--
-- Esta função só devolve, por nome de item, quantas unidades saíram no
-- período e no período anterior. Para o combo fechado devolve também a
-- opção escolhida (a bebida). Quem desmonta o combo é a tela
-- (ComercialItens.jsx): assim, quando o cardápio mudar um nome, o ajuste é
-- no código e não pede migração nova.
--
-- Conta só pedido fechado e item não cancelado. A noite vale pelo dia em que
-- abriu: (hora de São Paulo − 5h)::date.
--
-- Só cria a função. Não muda dado nenhum. Pode rodar de novo.
-- Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

create or replace function public.venda_por_item(
  p_inicio date, p_fim date, p_inicio_ant date, p_fim_ant date
)
returns table (
  nome      text,
  opcao     text,
  qtd_atual numeric,
  qtd_ant   numeric
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- No SQL Editor não há usuário; pelo painel, só quem foi aprovado.
  if auth.uid() is not null and not public.esta_aprovado() then
    raise exception 'sem_acesso';
  end if;

  return query
  with pedidos as (
    select c.payload,
           ((coalesce((c.payload->>'created_at')::timestamptz, c.criado_em) at time zone 'America/Sao_Paulo')
              - interval '5 hours')::date as noite
      from public.pedidos_cache c
     where c.status = 'closed'
       -- o campo dia do cache pode estar um dia antes ou depois da noite
       and c.dia between least(p_inicio, p_inicio_ant) - 1 and greatest(p_fim, p_fim_ant) + 1
  ),
  itens as (
    select regexp_replace(trim(it->>'name'), '\s+', ' ', 'g')     as nome_item,
           case when it->>'name' ilike '%combo%'
                 and jsonb_typeof(it->'options') = 'array'
                 and jsonb_array_length(it->'options') > 0
                then regexp_replace(trim(it->'options'->0->>'name'), '\s+', ' ', 'g')
           end                                                    as opcao_item,
           coalesce(nullif(it->>'quantity', '')::numeric, 1)      as qtd,
           case when p.noite between p_inicio and p_fim then 'atual'
                when p.noite between p_inicio_ant and p_fim_ant then 'anterior'
           end                                                    as periodo
      from pedidos p,
           jsonb_array_elements(case when jsonb_typeof(p.payload->'items') = 'array'
                                     then p.payload->'items' else '[]'::jsonb end) it
     where coalesce(it->>'status', '') <> 'canceled'
  )
  select i.nome_item,
         i.opcao_item,
         coalesce(sum(i.qtd) filter (where i.periodo = 'atual'), 0),
         coalesce(sum(i.qtd) filter (where i.periodo = 'anterior'), 0)
    from itens i
   where i.periodo is not null
     and coalesce(i.nome_item, '') <> ''
   group by i.nome_item, i.opcao_item;
end;
$$;

revoke all on function public.venda_por_item(date, date, date, date) from public, anon;
grant execute on function public.venda_por_item(date, date, date, date) to authenticated;

-- Confere: os 30 itens que mais saíram nos últimos 30 dias, contra os 30 antes.
select *
  from public.venda_por_item(
         ((now() at time zone 'America/Sao_Paulo') - interval '5 hours')::date - 30,
         ((now() at time zone 'America/Sao_Paulo') - interval '5 hours')::date - 1,
         ((now() at time zone 'America/Sao_Paulo') - interval '5 hours')::date - 60,
         ((now() at time zone 'America/Sao_Paulo') - interval '5 hours')::date - 31)
 order by qtd_atual desc
 limit 30;
