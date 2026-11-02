-- 178_precos_nos_pedidos.sql — Mr Kong
-- Só leitura. Não muda nada no banco.
--
-- O catálogo do CardápioWeb exige uma chave de parceiro que não temos. O
-- preço de cada item também está nos pedidos (pedidos_cache.payload), com o
-- canal da venda. Antes de ligar o botão "Puxar preços" nisso, esta consulta
-- mostra, nos últimos 30 dias, sem nenhum dado de cliente:
--
--   1. quantos itens vendeu cada canal, e quantos têm preço e código
--   2. quantos itens de cada canal acham o prato (por código ou por nome)
--   3. o preço mais vendido de 40 itens, para comparar com o da tabela
--
-- Onde rodar: Supabase → SQL Editor. Colar o resultado (CSV) na conversa.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

with vendido as (
  select coalesce(c.payload->>'sales_channel', '?')                 as canal,
         it->>'item_id'                                             as item_id,
         trim(it->>'name')                                          as nome,
         round(nullif(it->>'unit_price', '')::numeric, 2)           as preco,
         coalesce(nullif(it->>'quantity', '')::numeric, 1)          as qtd,
         coalesce(it->>'status', '')                                as status_item
    from public.pedidos_cache c,
         jsonb_array_elements(case when jsonb_typeof(c.payload->'items') = 'array'
                                   then c.payload->'items' else '[]'::jsonb end) it
   where c.dia >= current_date - 30
     and c.status = 'closed'
),
valido as (
  select * from vendido where status_item <> 'canceled'
),
casado as (
  select v.*,
         exists (select 1 from public.pratos p where p.cardapioweb_item_id::text = v.item_id) as por_codigo,
         exists (select 1 from public.pratos p where lower(trim(p.nome)) = lower(v.nome))     as por_nome
    from valido v
),
parte1 as (
  select '1. canal'::text as parte, canal as nome, ''::text as detalhe,
         format('%s itens · %s com preço · %s com código · %s nomes · %s cancelados fora',
                count(*), count(*) filter (where preco > 0), count(item_id), count(distinct nome),
                (select count(*) from vendido x where x.canal = v.canal and x.status_item = 'canceled')) as resultado
    from valido v
   group by canal
),
parte2 as (
  select '2. acha o prato'::text as parte, canal as nome, ''::text as detalhe,
         format('%s nomes: %s pelo código · %s só pelo nome · %s sem prato',
                count(*), count(*) filter (where cod), count(*) filter (where nomep and not cod),
                count(*) filter (where not cod and not nomep)) as resultado
    from (select canal, nome, bool_or(por_codigo) as cod, bool_or(por_nome) as nomep
            from casado group by canal, nome) x
   group by canal
),
por_preco as (
  select canal, nome, preco, sum(qtd) as vendidos
    from valido
   where preco > 0
   group by canal, nome, preco
),
principais as (
  select nome, sum(vendidos) as total
    from por_preco
   group by nome
   order by total desc
   limit 40
),
parte3 as (
  select '3. preços'::text as parte, pp.nome, pp.canal as detalhe,
         string_agg(format('%s (%s)', pp.preco, pp.vendidos), ' · ' order by pp.vendidos desc)
           || ' | tabela: ' || coalesce((select max(round(p.preco_venda::numeric, 2))::text
                                           from public.pratos p
                                          where lower(trim(p.nome)) = lower(pp.nome)), 'sem prato') as resultado
    from por_preco pp
    join principais t on t.nome = pp.nome
   group by pp.nome, pp.canal
)
select * from parte1
union all select * from parte2
union all select * from parte3
order by parte, nome, detalhe;
