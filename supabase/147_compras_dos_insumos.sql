-- ===========================================================================
-- 147 — Última compra de cada insumo, para a Formação de preços
--
-- O elo entre compra e insumo JÁ existe: quando você confirma uma nota,
-- cada item vira uma linha em movimentacoes_estoque (tipo 'compra', com
-- preco_unitario e o fornecedor) e o custo do insumo é gravado com o preço
-- daquela compra. O que faltava era a tela de preços conseguir enxergar
-- isso sem baixar o extrato inteiro pro navegador.
--
-- Esta função devolve UMA linha por insumo já comprado: o preço da última
-- compra, quando foi, de quem, e como esse preço se comportou nos últimos
-- 90 dias (quantas compras, média, mínimo e máximo). Com isso a tela
-- consegue dizer "você digitou 32,00 e a última nota veio a 38,50", que é
-- a conversa que interessa.
--
-- Ela NÃO escreve nada. Continua valendo a regra da casa: o custo do
-- insumo é o que você digita no painel. A compra sugere; quem decide é
-- você, clicando.
--
-- Observação pra não assustar: rodando aqui no SQL Editor esta função
-- devolve 0 linhas, porque esta_aprovado() não acha um usuário logado no
-- editor. Isso é o esperado — no painel ela responde normalmente. A
-- conferência do fim do arquivo lê as tabelas direto, justamente pra você
-- ver que o dado está lá.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

create or replace function public.compras_dos_insumos()
returns table (
  insumo_id        uuid,
  ultimo_preco     numeric,
  ultima_data      timestamptz,
  ultimo_fornecedor text,
  compras_90d      int,
  preco_medio_90d  numeric,
  preco_min_90d    numeric,
  preco_max_90d    numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with compras as (
    -- A data que vale é a da NOTA, não a do dia em que alguém digitou:
    -- nota de quinta lançada no domingo é compra de quinta. Quando não há
    -- nota vinculada, sobra o criado_em, que aí é o melhor que existe.
    select m.insumo_id,
           m.preco_unitario,
           coalesce(d.data_documento::timestamptz, m.criado_em) as quando,
           coalesce(nullif(m.fornecedor, ''), d.fornecedor)     as fornecedor
      from public.movimentacoes_estoque m
      left join public.documentos_compra d on d.id = m.documento_compra_id
     where m.tipo = 'compra'
       and m.preco_unitario is not null
       and m.preco_unitario > 0
  ),
  ultima as (
    select distinct on (c.insumo_id)
           c.insumo_id, c.preco_unitario, c.quando, c.fornecedor
      from compras c
     order by c.insumo_id, c.quando desc
  ),
  noventa as (
    select c.insumo_id,
           count(*)::int                        as compras_90d,
           round(avg(c.preco_unitario)::numeric, 4) as preco_medio_90d,
           min(c.preco_unitario)                as preco_min_90d,
           max(c.preco_unitario)                as preco_max_90d
      from compras c
     where c.quando >= now() - interval '90 days'
     group by c.insumo_id
  )
  select u.insumo_id,
         u.preco_unitario,
         u.quando,
         u.fornecedor,
         coalesce(n.compras_90d, 0),
         n.preco_medio_90d,
         n.preco_min_90d,
         n.preco_max_90d
    from ultima u
    left join noventa n on n.insumo_id = u.insumo_id
   where public.esta_aprovado();
$$;

revoke all on function public.compras_dos_insumos() from public;
grant execute on function public.compras_dos_insumos() to authenticated;

-- conferência: quantos insumos têm compra registrada e quantos não têm
select count(*)                                                     as insumos,
       count(*) filter (where c.insumo_id is not null)               as com_compra,
       count(*) filter (where c.insumo_id is null)                   as nunca_comprados,
       count(*) filter (where c.insumo_id is not null
                          and abs(coalesce(i.custo_medio_atual,0) - c.ultimo) > 0.005
                          and coalesce(i.composto, false) = false)   as preco_diferente_da_ultima_compra
  from public.insumos i
  left join (
    select distinct on (m.insumo_id) m.insumo_id,
           m.preco_unitario as ultimo
      from public.movimentacoes_estoque m
      left join public.documentos_compra d on d.id = m.documento_compra_id
     where m.tipo = 'compra' and m.preco_unitario > 0
     order by m.insumo_id, coalesce(d.data_documento::timestamptz, m.criado_em) desc
  ) c on c.insumo_id = i.id;
