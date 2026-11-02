-- 179_precos_mais_vendidos.sql — Mr Kong
--
-- O botão "Puxar preços" da Tabela de preços lia o catálogo do CardápioWeb,
-- que exige uma chave de parceiro que não temos (erro 4011). O preço também
-- está nos pedidos, e a 178 mostrou que ele bate com a tabela.
--
-- Esta função devolve, por item, o preço mais vendido nos últimos dias, só
-- nos canais próprios (portal e catálogo). iFood e Keeta ficam de fora: lá
-- o preço é outro, e a Keeta nem manda o código do item. Item cancelado
-- também não conta.
--
-- A tela decide o que fazer com isso. Mandando o preço e os outros preços
-- vendidos, ela reconhece a promoção (Heineken a 12,99 e a 10,99) em vez de
-- gravar o preço errado sem avisar.
--
-- Só cria a função. Não muda dado nenhum.
-- Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

create or replace function public.precos_mais_vendidos(p_dias integer default 30)
returns table (
  item_id        text,
  nome           text,
  preco          numeric,
  vendidos       numeric,
  total_vendidos numeric,
  outros_precos  jsonb
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
  with vendido as (
    select nullif(it->>'item_id', '')                         as codigo,
           trim(it->>'name')                                  as nome_item,
           round(nullif(it->>'unit_price', '')::numeric, 2)   as valor,
           coalesce(nullif(it->>'quantity', '')::numeric, 1)  as qtd
      from public.pedidos_cache c,
           jsonb_array_elements(case when jsonb_typeof(c.payload->'items') = 'array'
                                     then c.payload->'items' else '[]'::jsonb end) it
     where c.status = 'closed'
       and c.dia >= ((now() at time zone 'America/Sao_Paulo') - interval '5 hours')::date - p_dias
       and c.payload->>'sales_channel' in ('portal', 'catalog')
       and coalesce(it->>'status', '') <> 'canceled'
  ),
  -- Mesmo código é o mesmo item, mesmo que o nome tenha mudado no período.
  com_chave as (
    select coalesce(v.codigo, 'nome:' || lower(v.nome_item)) as chave, v.*
      from vendido v
     where v.valor > 0 and v.nome_item <> ''
  ),
  por_preco as (
    select cc.chave, cc.valor, sum(cc.qtd) as qtd
      from com_chave cc
     group by cc.chave, cc.valor
  ),
  ordenado as (
    select pp.*,
           row_number() over (partition by pp.chave order by pp.qtd desc, pp.valor desc) as posicao,
           sum(pp.qtd) over (partition by pp.chave) as total
      from por_preco pp
  ),
  nomes as (
    select distinct on (cc.chave) cc.chave, cc.codigo, cc.nome_item
      from (select c2.chave, c2.codigo, c2.nome_item, sum(c2.qtd) as qtd
              from com_chave c2
             group by c2.chave, c2.codigo, c2.nome_item) cc
     order by cc.chave, cc.qtd desc
  )
  select n.codigo,
         n.nome_item,
         o.valor,
         o.qtd,
         o.total,
         coalesce((select jsonb_agg(jsonb_build_object('preco', x.valor, 'vendidos', x.qtd) order by x.qtd desc)
                     from ordenado x
                    where x.chave = o.chave and x.posicao > 1), '[]'::jsonb)
    from ordenado o
    join nomes n on n.chave = o.chave
   where o.posicao = 1;
end;
$$;

revoke all on function public.precos_mais_vendidos(integer) from public, anon;
grant execute on function public.precos_mais_vendidos(integer) to authenticated;

-- Confere: quantos itens vieram, e quantos bateram com o preço da tabela.
select count(*)                                                       as itens,
       count(*) filter (where pr.id is not null)                      as acharam_prato,
       count(*) filter (where abs(pr.preco_venda - m.preco) < 0.005)  as preco_igual,
       count(*) filter (where abs(pr.preco_venda - m.preco) >= 0.005) as preco_diferente
  from public.precos_mais_vendidos(30) m
  left join public.pratos pr on pr.cardapioweb_item_id::text = m.item_id;
