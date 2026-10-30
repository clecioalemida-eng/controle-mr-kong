-- ===========================================================================
-- 163 — Os que ficaram de fora do 162, e por quê
--
-- Quase todos caem num de dois casos, e os dois são conserto rápido:
--
--   SEM PREÇO NO INSUMO — o insumo existe e o nome bate, mas o custo é
--   zero. Põe o preço em Formação de preços → Preço dos insumos e roda o
--   162 de novo; a ficha nasce certa.
--
--   PREÇO DE EMBALAGEM — o insumo está cadastrado pelo preço do fardo, da
--   caixa, do pote. Aí não basta criar a ficha: ou você corrige o preço
--   pra unidade (com a calculadora "paguei R$ X por Y un"), ou monta a
--   ficha com a fração (1/12, 1/24).
--
-- Só lê. Não escreve nada.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

with pratos_sem as (
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
select ps.nome                                       as prato,
       ps.preco_venda                                as preco,
       ik.nome                                       as insumo,
       ik.unidade,
       round(coalesce(ik.custo_medio_atual, 0)::numeric, 2) as custo_do_insumo,
       case
         when coalesce(ik.custo_medio_atual, 0) <= 0 then 'FALTA PREÇO no insumo'
         when ik.unidade <> 'un'                     then 'insumo em ' || ik.unidade || ' — a ficha precisa da quantidade, não de 1'
         when ik.custo_medio_atual >= ps.preco_venda then 'preço de EMBALAGEM — custa mais que o prato vende'
         else 'margem fora da faixa — confira a unidade'
       end                                           as por_que_ficou_de_fora
  from pratos_sem ps
  join insumos_k ik
    on ps.k = ik.k
    or (length(ik.k) >= 5 and ps.k like '%' || ik.k || '%')
    or (length(ps.k) >= 5 and ik.k like '%' || ps.k || '%')
 where not (ik.unidade = 'un'
            and coalesce(ik.custo_medio_atual, 0) > 0
            and ps.preco_venda > 0
            and (ps.preco_venda - ik.custo_medio_atual) / ps.preco_venda * 100 between 25 and 85)
 order by ps.nome;
