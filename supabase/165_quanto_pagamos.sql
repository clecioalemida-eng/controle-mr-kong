-- ===========================================================================
-- 165 — Quanto pagamos por isso?
--
-- Procura um insumo pelo nome e mostra tudo que o banco sabe sobre o
-- preço dele: o que está cadastrado hoje, e cada compra registrada — a
-- data, o fornecedor, a quantidade, o preço unitário e o total da linha.
--
-- Serve pra responder "quanto custa X?" sem depender da memória de
-- ninguém. Se vier vazio, a resposta é honesta: nunca passou nota
-- confirmada desse insumo pelo sistema, e o preço dele é palpite.
--
-- MUDE as palavras na linha marcada para procurar outro insumo.
-- Só lê. Não escreve nada.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

with palavras as (
  -- <<< o que procurar, sem acento e em minúscula
  select unnest(array['red bull', 'redbull', 'energetico', 'monster', 'baly']) as palavra
),
alvo as (
  select i.*
    from public.insumos i
   where exists (
     select 1 from palavras w
      where lower(translate(i.nome,
            'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
            'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) like '%' || w.palavra || '%'
   )
)
select a.nome                                               as insumo,
       a.unidade,
       round(coalesce(a.custo_medio_atual, 0)::numeric, 4)  as preco_cadastrado,
       coalesce(a.origem_custo, '(sem 152)')                as origem,
       coalesce(d.data_documento::text, to_char(m.criado_em, 'YYYY-MM-DD')) as data_da_compra,
       coalesce(nullif(m.fornecedor, ''), d.fornecedor)     as fornecedor,
       m.quantidade                                         as qtd_comprada,
       round(m.preco_unitario::numeric, 4)                  as preco_unitario,
       round((m.quantidade * m.preco_unitario)::numeric, 2) as total_pago,
       (select count(*) from public.prato_insumos pi where pi.insumo_id = a.id) as usado_em_pratos
  from alvo a
  left join public.movimentacoes_estoque m
         on m.insumo_id = a.id and m.tipo = 'compra' and m.preco_unitario > 0
  left join public.documentos_compra d on d.id = m.documento_compra_id
 order by a.nome, data_da_compra desc nulls last;
