-- ===========================================================================
-- 157 — O que falta para fechar as fichas: os quatro insumos suspeitos
--
-- Depois do ovo, sobraram quatro insumos com número que não fecha. Para
-- cada um, esta consulta põe lado a lado tudo que é preciso para decidir:
-- o preço que está no painel, o que a última nota pagou, em quantos
-- pratos ele entra e QUANTO entra em cada um (mínimo, máximo e o valor
-- mais comum).
--
-- A coluna que mais importa é a `qtd_mais_comum`. É ela que separa os dois
-- tipos de erro:
--
--   batata frita  — 0,15 / 0,4 / 0,6 kg estão certos (pequena, média,
--                   grande). Só o PREÇO está errado.
--   molho tártaro — 0,3 kg é meio pote de molho em cada lanche. Aqui a
--                   QUANTIDADE está errada, e corrigir só o preço faria
--                   23 lanches custarem R$ 7,50 de molho.
--
-- Só lê. Não escreve nada.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

with alvo as (
  select i.*
    from public.insumos i
   where lower(i.nome) in ('batata frita', 'molho tártaro', 'molho tartaro', 'salsicha', 'ovos')
),
nota as (
  select distinct on (m.insumo_id)
         m.insumo_id,
         m.preco_unitario,
         coalesce(d.data_documento::timestamptz, m.criado_em) as quando,
         coalesce(nullif(m.fornecedor, ''), d.fornecedor)     as fornecedor
    from public.movimentacoes_estoque m
    left join public.documentos_compra d on d.id = m.documento_compra_id
   where m.tipo = 'compra' and m.preco_unitario > 0
   order by m.insumo_id, coalesce(d.data_documento::timestamptz, m.criado_em) desc
),
uso as (
  select pi.insumo_id,
         count(distinct pi.prato_id)  as pratos,
         min(pi.quantidade)           as qtd_min,
         max(pi.quantidade)           as qtd_max,
         mode() within group (order by pi.quantidade) as qtd_mais_comum,
         sum(pi.quantidade)           as qtd_somada
    from public.prato_insumos pi
    join public.pratos p on p.id = pi.prato_id
   where coalesce(p.ativo, true)
   group by pi.insumo_id
)
select a.nome                                            as insumo,
       a.unidade,
       coalesce(a.origem_custo, '(sem 152)')             as origem,
       round(coalesce(a.custo_medio_atual, 0)::numeric, 4) as preco_no_painel,
       round(n.preco_unitario::numeric, 4)               as ultima_nota,
       n.quando::date                                    as data_da_nota,
       n.fornecedor,
       u.pratos,
       u.qtd_min, u.qtd_mais_comum, u.qtd_max,
       round((u.qtd_somada * coalesce(a.custo_medio_atual, 0))::numeric, 2) as peso_hoje_somando_tudo
  from alvo a
  left join nota n on n.insumo_id = a.id
  left join uso  u on u.insumo_id = a.id
 order by a.nome;
