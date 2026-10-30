-- ===========================================================================
-- 150 — Fichas com custo impossível: quem é o ingrediente culpado
--
-- O 148 foi procurar preço desatualizado e esbarrou noutra coisa, bem
-- pior: prato cujo CUSTO é maior que o PREÇO. Balde de Heineken vendido a
-- 49,99 com custo de 120,00. Halls a 2,99 com custo de 32,33.
--
-- Isso não é preço velho, é unidade errada: o insumo está cadastrado pelo
-- preço da CAIXA e a ficha gasta "1", então cada Halls vendido consome uma
-- caixa inteira na conta. Trocar o preço pelo da nota não conserta — só
-- troca uma caixa cara por outra mais cara ainda.
--
-- Esta consulta abre esses pratos linha por linha e mostra quanto cada
-- ingrediente está pesando. O culpado costuma ser óbvio: é a linha que
-- sozinha vale mais que o prato.
--
-- Só lê. Não escreve nada.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

with custo_do_prato as (
  select pi.prato_id, sum(pi.quantidade * coalesce(i.custo_medio_atual, 0)) as custo
    from public.prato_insumos pi
    join public.insumos i on i.id = pi.insumo_id
   group by pi.prato_id
),
quebrados as (
  select p.id, p.nome, p.preco_venda, c.custo
    from public.pratos p
    join custo_do_prato c on c.prato_id = p.id
   where coalesce(p.ativo, true)
     and p.preco_venda > 0
     and c.custo > p.preco_venda          -- custo maior que o preço: impossível
)
select q.nome                                             as prato,
       round(q.preco_venda::numeric, 2)                   as preco,
       round(q.custo::numeric, 2)                         as custo_total,
       i.nome                                             as ingrediente,
       i.unidade,
       pi.quantidade                                      as qtd_na_ficha,
       round(coalesce(i.custo_medio_atual, 0)::numeric, 4) as preco_do_insumo,
       round((pi.quantidade * coalesce(i.custo_medio_atual, 0))::numeric, 2) as custo_da_linha,
       case when q.custo > 0
            then round(((pi.quantidade * coalesce(i.custo_medio_atual, 0)) / q.custo * 100)::numeric, 0)
       end                                                as pct_do_custo
  from quebrados q
  join public.prato_insumos pi on pi.prato_id = q.id
  join public.insumos i        on i.id = pi.insumo_id
 order by q.custo desc, custo_da_linha desc
 limit 60;
