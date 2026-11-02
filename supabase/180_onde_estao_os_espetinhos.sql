-- 180_onde_estao_os_espetinhos.sql — Mr Kong
-- Só leitura. Não muda nada no banco.
--
-- A Tabela de preços monta as linhas a partir de pratos.linha_produto, e
-- não apareceu uma linha de espetinhos. Esta consulta mostra:
--   1. os pratos com "espet" no nome e a linha de cada um
--   2. o que foi vendido com "espet" no nome nos últimos 60 dias, e se
--      acha prato pelo código ou pelo nome
--
-- Onde rodar: Supabase → SQL Editor. Colar o resultado (CSV) na conversa.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

with vendido as (
  select it->>'item_id'                                     as item_id,
         trim(it->>'name')                                  as nome,
         coalesce(c.payload->>'sales_channel', '?')         as canal,
         coalesce(nullif(it->>'quantity', '')::numeric, 1)  as qtd,
         round(nullif(it->>'unit_price', '')::numeric, 2)   as preco
    from public.pedidos_cache c,
         jsonb_array_elements(case when jsonb_typeof(c.payload->'items') = 'array'
                                   then c.payload->'items' else '[]'::jsonb end) it
   where c.dia >= current_date - 60
     and c.status = 'closed'
     and it->>'name' ilike '%espet%'
     and coalesce(it->>'status', '') <> 'canceled'
)
select '1. prato'::text                                     as parte,
       p.nome,
       coalesce(p.linha_produto, 'sem linha')               as linha_ou_canal,
       case when p.ativo then 'ativo' else 'desativado' end as situacao,
       round(p.preco_venda::numeric, 2)                     as preco,
       null::numeric                                        as vendidos
  from public.pratos p
 where p.nome ilike '%espet%'
union all
select '2. vendido',
       v.nome,
       v.canal,
       case when exists (select 1 from public.pratos p where p.cardapioweb_item_id::text = v.item_id) then 'acha pelo código'
            when exists (select 1 from public.pratos p where lower(trim(p.nome)) = lower(v.nome)) then 'acha pelo nome'
            else 'sem prato' end,
       max(v.preco),
       sum(v.qtd)
  from vendido v
 group by v.nome, v.canal, v.item_id
 order by 1, 2, 3;
