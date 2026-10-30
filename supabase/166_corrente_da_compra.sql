-- ===========================================================================
-- 166 — A corrente da compra: onde ela está quebrada
--
-- A regra: toda mercadoria comprada precisa virar ENTRADA DE ESTOQUE e
-- CUSTO DE INSUMO. Hoje o caminho existe — confirmar uma nota em Supply
-- Chain → Notas cria a movimentação de estoque, e o gatilho da migração
-- 152 atualiza o custo conforme a origem do insumo.
--
-- O que falha não é o caminho, é quem não entra nele. Nota que ficou sem
-- confirmar não vira nada: não entra no estoque, não mexe no custo, e o
-- dinheiro saiu do caixa do mesmo jeito. Item de nota sem insumo vinculado
-- idem.
--
-- Cada linha abaixo é um ponto de quebra, com quantas vezes acontece e
-- quanto dinheiro está parado ali. Só lê. Não escreve nada.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

select 1 as ordem,
       'Nota recebida e NÃO confirmada' as ponto_de_quebra,
       count(*)                          as quantas,
       round(coalesce(sum(d.valor_total), 0)::numeric, 2) as valor_envolvido,
       'Não virou estoque nem custo. Confirme em Supply Chain → Notas.' as o_que_fazer
  from public.documentos_compra d
 where coalesce(d.status, '') <> 'confirmado'

union all
select 2,
       'Item de nota sem insumo vinculado',
       count(*),
       round(coalesce(sum(it.quantidade * it.preco_unitario), 0)::numeric, 2),
       'A IA leu, mas ninguém disse a que insumo pertence — some da conta.'
  from public.itens_documento_compra it
  join public.documentos_compra d on d.id = it.documento_id
 where it.insumo_id is null

union all
select 3,
       'Compra lançada no estoque SEM preço',
       count(*),
       0,
       'Entrou mercadoria sem custo: infla o estoque e some do CMV.'
  from public.movimentacoes_estoque m
 where m.tipo = 'compra'
   and coalesce(m.preco_unitario, 0) <= 0

union all
select 4,
       'Insumo usado em ficha e NUNCA comprado',
       count(*),
       0,
       'O preço dele é palpite, e a margem de quem usa herda o palpite.'
  from public.insumos i
 where coalesce(i.composto, false) = false
   and exists (select 1 from public.prato_insumos pi where pi.insumo_id = i.id)
   and not exists (select 1 from public.movimentacoes_estoque m
                    where m.insumo_id = i.id and m.tipo = 'compra' and m.preco_unitario > 0)

union all
select 5,
       'Insumo em MANUAL (a nota não atualiza)',
       count(*),
       0,
       'É escolha sua e está certo pro ovo e pra embalagem — só não esqueça dele.'
  from public.insumos i
 where coalesce(i.origem_custo, '') = 'manual'

 order by ordem;
