-- ===========================================================================
-- 162 — Cria a ficha dos produtos de revenda que passam no teste
--
-- O 161 propôs 29 casamentos. Este aplica só os que sobrevivem a quatro
-- filtros, e os quatro existem por causa de erro que já aconteceu aqui:
--
--   1. Insumo contado por UNIDADE. Em kg/l, "1" significaria um quilo
--      inteiro por porção — foi assim que a picanha casou com 1 kg de
--      picanha e a rúcula com 1 kg de rúcula.
--   2. Insumo COM PREÇO. Preço zero vira ficha de custo zero e margem de
--      100%, que é pior que não ter ficha: some o aviso e fica a mentira.
--   3. Margem resultante entre 25% e 85%. Fora dessa faixa não é revenda
--      normal, é unidade errada — o Halls casando com a caixa de R$ 32,33
--      dava -708%, e a nutella a R$ 0,49 dava 91,8%.
--   4. Um insumo por prato, preferindo o de nome exato e, entre dois, o
--      que tem preço maior (o "Pastelzinho de camarão 350g" em vez do
--      "Pastelzinho de camarão" zerado).
--
-- O que ficar de fora não é erro do sistema: é insumo sem preço ou
-- embalagem mal cadastrada. A segunda consulta do arquivo mostra esses.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

drop table if exists _revenda;
create temp table _revenda as
with pratos_sem as (
  select p.id, p.nome, p.preco_venda,
         regexp_replace(lower(translate(p.nome,
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
           'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]', '', 'g') as k
    from public.pratos p
   where coalesce(p.ativo, true)
     and p.preco_venda > 0
     and not exists (select 1 from public.prato_insumos pi where pi.prato_id = p.id)
),
insumos_k as (
  select i.id, i.nome, i.unidade, i.custo_medio_atual,
         regexp_replace(lower(translate(i.nome,
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
           'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]', '', 'g') as k
    from public.insumos i
   where coalesce(i.composto, false) = false
     and i.unidade = 'un'                      -- filtro 1
     and coalesce(i.custo_medio_atual, 0) > 0  -- filtro 2
),
pares as (
  select ps.id as prato_id, ps.nome as prato, ps.preco_venda as preco,
         ik.id as insumo_id, ik.nome as insumo, ik.custo_medio_atual as custo,
         (ps.preco_venda - ik.custo_medio_atual) / ps.preco_venda * 100 as margem,
         (ps.k = ik.k) as nome_exato
    from pratos_sem ps
    join insumos_k ik
      on ps.k = ik.k
      or (length(ik.k) >= 5 and ps.k like '%' || ik.k || '%')
      or (length(ps.k) >= 5 and ik.k like '%' || ps.k || '%')
)
select distinct on (prato_id) *                 -- filtro 4
  from pares
 where margem between 25 and 85                 -- filtro 3
 order by prato_id, nome_exato desc, custo desc;

insert into public.prato_insumos (prato_id, insumo_id, quantidade)
select r.prato_id, r.insumo_id, 1
  from _revenda r;

-- conferência: as fichas criadas agora
select r.prato,
       r.preco,
       r.insumo                                   as ficha_virou,
       round(r.custo::numeric, 2)                 as custo,
       round(r.margem::numeric, 1)                as margem,
       case when r.nome_exato then 'nome exato' else 'nome parecido — confira' end as origem_do_casamento
  from _revenda r
 order by r.nome_exato desc, r.prato;
