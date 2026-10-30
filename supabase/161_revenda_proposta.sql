-- ===========================================================================
-- 161 — Proposta de ficha para os produtos de revenda (NÃO escreve nada)
--
-- "Isca de frango já é o produto final, eu compro e vendo a embalagem."
-- Isso vale pra boa parte do que ainda está sem ficha: refrigerante,
-- cerveja, chocolate, bala, água. A ficha desses é uma linha só —
-- 1 unidade do próprio insumo — e o custo é o que você pagou por ela.
--
-- Esta consulta procura, para cada prato ATIVO SEM FICHA, um insumo com
-- nome parecido. O casamento é por nome reduzido a letras e números, sem
-- acento: "Coca Cola 355ml" encontra "coca lata 355", "Halls cereja"
-- encontra "halls cereja".
--
-- NÃO GRAVA NADA. É pra você ler e dizer o que está certo. O que estiver
-- errado aqui viraria ficha errada lá — e ficha errada é margem errada
-- em silêncio, que é o problema que a gente passou a semana consertando.
--
-- Confira principalmente a coluna `conferir`: "mesmo nome" é seguro,
-- "um contém o outro" merece um olhar.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

with chave as (
  select 'x'::text as nada
),
pratos_sem as (
  select p.id, p.nome, p.preco_venda,
         regexp_replace(lower(translate(p.nome,
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
           'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]', '', 'g') as k
    from public.pratos p
   where coalesce(p.ativo, true)
     and not exists (select 1 from public.prato_insumos pi where pi.prato_id = p.id)
),
insumos_k as (
  select i.id, i.nome, i.unidade, i.custo_medio_atual,
         regexp_replace(lower(translate(i.nome,
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
           'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]', '', 'g') as k
    from public.insumos i
   where coalesce(i.composto, false) = false
)
select ps.nome                                   as prato_sem_ficha,
       ps.preco_venda                            as preco,
       ik.nome                                   as insumo_sugerido,
       ik.unidade,
       round(coalesce(ik.custo_medio_atual, 0)::numeric, 2) as custo_do_insumo,
       case when ps.preco_venda > 0 and ik.custo_medio_atual is not null
            then round(((ps.preco_venda - ik.custo_medio_atual) / ps.preco_venda * 100)::numeric, 1)
       end                                       as margem_se_1_unidade,
       case when ps.k = ik.k then 'mesmo nome'
            else 'um contém o outro' end         as conferir
  from pratos_sem ps
  join insumos_k ik
    on ps.k = ik.k
    or (length(ik.k) >= 5 and ps.k like '%' || ik.k || '%')
    or (length(ps.k) >= 5 and ik.k like '%' || ps.k || '%')
 order by (ps.k = ik.k) desc, ps.nome;
