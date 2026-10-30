-- ===========================================================================
-- 148 — Onde a margem da tela é ficção
--
-- A pergunta que os 26 divergentes levantam não é "quais insumos estão
-- desatualizados", é "quanto dinheiro isso esconde". Então esta consulta
-- refaz o custo de CADA prato duas vezes:
--
--   custo_hoje  = com o preço que está cadastrado no insumo
--   custo_notas = com o preço da última nota confirmada de cada insumo
--                 (quando existe; quando não existe, usa o cadastrado)
--
-- e mostra as duas margens lado a lado. Onde a diferença é grande, a
-- margem que você vê na tela não é a margem que você tem.
--
-- Só lê. Não escreve nada.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

with ultima as (
  select distinct on (m.insumo_id)
         m.insumo_id,
         m.preco_unitario as preco_nota,
         coalesce(d.data_documento::timestamptz, m.criado_em) as quando
    from public.movimentacoes_estoque m
    left join public.documentos_compra d on d.id = m.documento_compra_id
   where m.tipo = 'compra' and m.preco_unitario > 0
   order by m.insumo_id, coalesce(d.data_documento::timestamptz, m.criado_em) desc
),
custos as (
  select pi.prato_id,
         sum(pi.quantidade * coalesce(i.custo_medio_atual, 0))                      as custo_hoje,
         -- insumo composto tem custo calculado, não comprado: para ele o
         -- cadastrado continua valendo mesmo que exista nota
         sum(pi.quantidade * case when coalesce(i.composto, false) then coalesce(i.custo_medio_atual, 0)
                                  else coalesce(u.preco_nota, i.custo_medio_atual, 0) end) as custo_notas,
         count(*)                                                                    as ingredientes,
         count(*) filter (where u.insumo_id is null
                            and coalesce(i.composto, false) = false)                 as ingredientes_sem_nota
    from public.prato_insumos pi
    join public.insumos i on i.id = pi.insumo_id
    left join ultima u on u.insumo_id = pi.insumo_id
   group by pi.prato_id
)
select p.nome                                                        as prato,
       round(p.preco_venda::numeric, 2)                              as preco,
       round(c.custo_hoje::numeric, 2)                               as custo_cadastrado,
       round(c.custo_notas::numeric, 2)                              as custo_pelas_notas,
       round((c.custo_notas - c.custo_hoje)::numeric, 2)             as diferenca,
       case when p.preco_venda > 0
            then round((((p.preco_venda - c.custo_hoje) / p.preco_venda) * 100)::numeric, 1) end  as margem_da_tela,
       case when p.preco_venda > 0
            then round((((p.preco_venda - c.custo_notas) / p.preco_venda) * 100)::numeric, 1) end as margem_real,
       c.ingredientes,
       c.ingredientes_sem_nota
  from public.pratos p
  join custos c on c.prato_id = p.id
 where coalesce(p.ativo, true)
   and abs(c.custo_notas - c.custo_hoje) > 0.01
 order by abs(c.custo_notas - c.custo_hoje) desc
 limit 30;
