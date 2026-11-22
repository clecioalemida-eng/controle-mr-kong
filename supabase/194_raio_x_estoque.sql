-- 194_raio_x_estoque.sql — Mr Kong
--
-- Só consulta. Não cria nada e não muda dado nenhum.
--
-- Raio-x do controle de estoque antes de mexer nele. Responde o que o
-- código não mostra, porque parte das funções só existe no banco:
--   A. Alguma função do banco lança saída de estoque pela venda?
--   B. Que tipos de movimentação o banco aceita?
--   C. Apagar um insumo apaga o histórico de compra dele?
--   D. Quantos insumos existem, quantos entram e não saem, quantos estão soltos
--   E. Nomes que parecem o mesmo insumo cadastrado duas vezes
--   F. O que mais entra como "não é insumo" nas notas
--
-- Onde rodar: Supabase → SQL Editor. Mande o CSV ou a foto do resultado.

with
-- A. funções que inserem em movimentacoes_estoque
funcoes as (
  select 'A. funcao que mexe no estoque' as secao,
         p.proname::text as item,
         case when pg_get_functiondef(p.oid) ~* '(venda|pedido|prato_insumos|cardapio)' then 'fala de venda/pedido' else '' end as valor
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where p.prokind = 'f'
     and pg_get_functiondef(p.oid) ilike '%insert into%movimentacoes_estoque%'
),
-- B. tipos aceitos
tipos as (
  select 'B. tipos aceitos' as secao, c.conname::text as item, pg_get_constraintdef(c.oid) as valor
    from pg_constraint c
   where c.conrelid = 'public.movimentacoes_estoque'::regclass and c.contype = 'c'
),
-- C. o que acontece com o histórico quando o insumo é apagado
chaves as (
  select 'C. ao apagar o insumo' as secao,
         (c.conrelid::regclass)::text || '.' || a.attname as item,
         case c.confdeltype when 'c' then 'APAGA junto' when 'r' then 'bloqueia' when 'a' then 'bloqueia'
                            when 'n' then 'fica sem insumo' else c.confdeltype::text end as valor
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
   where c.contype = 'f' and c.confrelid = 'public.insumos'::regclass
),
-- D. retrato dos insumos
uso as (
  select i.id,
         exists (select 1 from public.prato_insumos pi where pi.insumo_id = i.id) as em_ficha,
         exists (select 1 from public.insumo_composicao ic where ic.insumo_filho_id = i.id) as em_composto,
         exists (select 1 from public.movimentacoes_estoque m where m.insumo_id = i.id and m.tipo = 'compra') as comprado
    from public.insumos i
),
retrato as (
  select 'D. insumos' as secao, x.item, x.valor
    from (
      select 1 as o, 'total cadastrados' as item, count(*)::text as valor from uso
      union all select 2, 'comprados e usados em ficha ou composto', count(*) filter (where comprado and (em_ficha or em_composto))::text from uso
      union all select 3, 'comprados mas sem ficha nenhuma (entra e não sai)', count(*) filter (where comprado and not em_ficha and not em_composto)::text from uso
      union all select 4, 'em ficha mas nunca comprados', count(*) filter (where not comprado and (em_ficha or em_composto))::text from uso
      union all select 5, 'soltos (sem compra e sem ficha)', count(*) filter (where not comprado and not em_ficha and not em_composto)::text from uso
      union all select 6, 'compras registradas', (select count(*) from public.movimentacoes_estoque where tipo = 'compra')::text
      union all select 7, 'compras com preço', (select count(*) from public.movimentacoes_estoque where tipo = 'compra' and coalesce(preco_unitario, 0) > 0)::text
    ) x
),
-- E. possíveis duplicados: mesmo nome sem acento, espaço, pontuação e plural simples
normalizado as (
  select i.id, i.nome, i.unidade,
         regexp_replace(
           regexp_replace(
             translate(lower(i.nome), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
             '[^a-z0-9]+', '', 'g'),
           's$', '') as chave
    from public.insumos i
),
duplicados as (
  select 'E. parecem o mesmo insumo' as secao,
         string_agg(n.nome || ' (' || n.unidade || ')', '  |  ' order by n.nome) as item,
         count(*)::text || ' cadastros' as valor
    from normalizado n
   group by n.chave
  having count(*) > 1
),
-- F. o que mais vira "não é insumo"
nao_insumo as (
  select 'F. entra como não é insumo' as secao,
         it.nome_lido as item,
         count(*)::text || ' vezes · ' || coalesce(max(it.despesa_centro), '') as valor
    from public.itens_documento_compra it
    join public.documentos_compra d on d.id = it.documento_id and d.status = 'confirmado'
   where it.insumo_id is null
   group by it.nome_lido
   order by count(*) desc
   limit 25
)
select * from funcoes
union all select * from tipos
union all select * from chaves
union all select * from retrato
union all (select * from duplicados order by item limit 60)
union all select * from nao_insumo;
