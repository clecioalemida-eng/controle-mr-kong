-- ===========================================================================
-- 164 — O 162 criou alguma coisa?
--
-- Ele devolveu "no rows". Duas explicações possíveis, e elas são opostas:
--   a) já tinha rodado antes e as fichas existem (e aí está tudo certo);
--   b) nenhum par passou nos filtros (e aí não se criou nada).
--
-- Esta consulta responde: lista todo prato cuja ficha é de uma linha só,
-- com 1 unidade de um insumo — que é a assinatura de uma ficha de
-- revenda — e mostra a margem de cada um.
--
-- Só lê. Não escreve nada.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

with uma_linha as (
  -- min() não existe para uuid no Postgres, então a linha única vem por
  -- distinct on em vez de agregação.
  select distinct on (pi.prato_id) pi.prato_id, pi.insumo_id, pi.quantidade as qtd
    from public.prato_insumos pi
   where pi.prato_id in (
     select prato_id from public.prato_insumos group by prato_id having count(*) = 1
   )
   order by pi.prato_id
)
select p.nome                                     as prato,
       p.preco_venda                              as preco,
       i.nome                                     as insumo,
       i.unidade,
       u.qtd                                      as quantidade_na_ficha,
       round(coalesce(i.custo_medio_atual, 0)::numeric, 2)                 as custo_do_insumo,
       round((u.qtd * coalesce(i.custo_medio_atual, 0))::numeric, 2)       as custo_do_prato,
       case when p.preco_venda > 0 then
         round(((p.preco_venda - u.qtd * coalesce(i.custo_medio_atual, 0))
                / p.preco_venda * 100)::numeric, 1) end                    as margem,
       to_char(i.atualizado_em, 'DD/MM HH24:MI')   as insumo_mexido_em
  from uma_linha u
  join public.pratos p  on p.id = u.prato_id
  join public.insumos i on i.id = u.insumo_id
 where coalesce(p.ativo, true)
   and u.qtd = 1
   and i.unidade = 'un'
 order by margem nulls last, p.nome;
