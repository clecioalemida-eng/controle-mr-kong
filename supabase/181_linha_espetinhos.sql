-- 181_linha_espetinhos.sql — Mr Kong
--
-- A 180 mostrou que nenhum espetinho tem cadastro em `pratos`: eles vendem
-- no CardápioWeb, mas não aparecem na Tabela de preços nem têm linha. Esta
-- migração cria os pratos que já venderam, na linha "Espetinhos".
--
-- De onde vem cada campo, sempre dos pedidos do cardápio próprio (portal e
-- catálogo) dos últimos 60 dias:
--   nome    o que o CardápioWeb manda, para o prato casar com a venda
--   código  o item do CardápioWeb
--   preço   o mais vendido. iFood e Keeta ficam de fora: lá o preço é outro.
--
-- Pode rodar de novo: prato que já existe, pelo nome ou pelo código, fica
-- como está. Só cria; não muda nem apaga nenhum prato.
--
-- Eles entram sem ficha técnica, então ainda não têm custo nem margem.
--
-- Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

with vendido as (
  select nullif(it->>'item_id', '')::bigint                 as item_id,
         trim(it->>'name')                                  as nome,
         round(nullif(it->>'unit_price', '')::numeric, 2)   as preco,
         coalesce(nullif(it->>'quantity', '')::numeric, 1)  as qtd
    from public.pedidos_cache c,
         jsonb_array_elements(case when jsonb_typeof(c.payload->'items') = 'array'
                                   then c.payload->'items' else '[]'::jsonb end) it
   where c.dia >= current_date - 60
     and c.status = 'closed'
     and c.payload->>'sales_channel' in ('portal', 'catalog')
     and it->>'name' ilike 'espetinho%'
     and coalesce(it->>'status', '') <> 'canceled'
),
-- O mesmo nome com mais de um preço ou código: fica o que mais vendeu.
mais_vendido as (
  select distinct on (lower(nome)) nome, item_id, preco
    from (select nome, item_id, preco, sum(qtd) as qtd
            from vendido
           where preco > 0
           group by nome, item_id, preco) x
   order by lower(nome), qtd desc, preco desc
)
insert into public.pratos (nome, preco_venda, cardapioweb_item_id, linha_produto, ativo)
select m.nome, m.preco, m.item_id, 'Espetinhos', true
  from mais_vendido m
 where not exists (select 1 from public.pratos p where lower(trim(p.nome)) = lower(m.nome))
   and (m.item_id is null
        or not exists (select 1 from public.pratos p where p.cardapioweb_item_id = m.item_id));

-- Confere: os espetinhos cadastrados, com linha, preço e código.
select nome, linha_produto, round(preco_venda::numeric, 2) as preco, cardapioweb_item_id, ativo
  from public.pratos
 where nome ilike 'espetinho%'
 order by nome;
