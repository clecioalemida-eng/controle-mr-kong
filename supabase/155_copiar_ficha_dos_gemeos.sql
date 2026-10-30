-- ===========================================================================
-- 155 — Copia a ficha do gêmeo para o prato que realmente vende
--
-- São 8 pares em que o mesmo lanche está cadastrado duas vezes: "Rei da
-- Selva" (o que o cliente pede) e "Rei da Selva (X-Tudo)" (o que tem a
-- ficha). Mesmo preço nos 8, então não há dúvida de que são o mesmo
-- produto.
--
-- Esta migração COPIA os ingredientes do gêmeo para o que vende. Não
-- apaga nada, não desativa nada, não mexe em preço: só preenche uma ficha
-- que está vazia. Se der errado, apagar as linhas copiadas devolve tudo
-- ao que era.
--
-- Por que copiar em vez de apagar o duplicado: o prato que vende é o que
-- tem histórico de pedido. Apagá-lo levaria junto o passado; apagar o
-- outro é seguro, mas isso você faz depois, com calma, escondendo-o em
-- Supply Chain → Fichas técnicas.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

-- "on commit drop" não serve aqui: cada statement do editor roda na sua
-- própria transação, e a tabela sumiria antes do insert. Mesmo padrão do
-- 128: derruba se existir e cria de novo.
drop table if exists _copia;
create temp table _copia as
with base as (
  select p.id,
         p.nome,
         p.preco_venda,
         regexp_replace(
           lower(translate(regexp_replace(p.nome, '\(.*?\)', '', 'g'),
                           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                           'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
           '[^a-z0-9]', '', 'g')                                   as chave,
         (select count(*) from public.prato_insumos pi where pi.prato_id = p.id) as ingredientes
    from public.pratos p
   where coalesce(p.ativo, true)
),
orfaos as (select * from base where ingredientes = 0),
-- Um gêmeo por chave, e na dúvida o mais completo: se por acaso houver
-- três cadastros do mesmo lanche, copia do que tem mais ingredientes.
fontes as (
  select distinct on (chave) chave, id, nome, ingredientes
    from base
   where ingredientes > 0
   order by chave, ingredientes desc, nome
)
select o.id as destino_id, o.nome as destino, o.preco_venda as preco_destino,
       f.id as origem_id,  f.nome as origem,  f.ingredientes
  from orfaos o
  join fontes f on f.chave = o.chave and f.id <> o.id;

insert into public.prato_insumos (prato_id, insumo_id, quantidade)
select c.destino_id, pi.insumo_id, pi.quantidade
  from _copia c
  join public.prato_insumos pi on pi.prato_id = c.origem_id;

-- conferência: como ficou cada um dos pares
select c.destino                                      as prato_que_vende,
       c.origem                                       as copiado_de,
       (select count(*) from public.prato_insumos pi
         where pi.prato_id = c.destino_id)            as ingredientes_agora,
       round((select sum(pi.quantidade * coalesce(i.custo_medio_atual, 0))
                from public.prato_insumos pi
                join public.insumos i on i.id = pi.insumo_id
               where pi.prato_id = c.destino_id)::numeric, 2)  as custo_agora,
       c.preco_destino                                as preco,
       case when c.preco_destino > 0 then
         round(((c.preco_destino - (select sum(pi.quantidade * coalesce(i.custo_medio_atual, 0))
                                      from public.prato_insumos pi
                                      join public.insumos i on i.id = pi.insumo_id
                                     where pi.prato_id = c.destino_id))
                / c.preco_destino * 100)::numeric, 1) end      as margem_agora
  from _copia c
 order by c.destino;
