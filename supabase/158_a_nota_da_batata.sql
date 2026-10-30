-- ===========================================================================
-- 158 — Como a batata foi lançada nas notas
--
-- O painel diz R$ 0,07/kg e a última nota diz a mesma coisa. Então o erro
-- não é de atualização: está na própria nota, no momento em que o item foi
-- conferido. Esta consulta abre os itens de nota ligados à batata para
-- mostrar COMO foi lançado — quantidade, unidade, preço unitário e o total
-- da linha.
--
-- O que procurar: se `total_do_item` for um valor plausível (uns R$ 200,
-- R$ 400) mas a `quantidade` estiver absurda (20000 em vez de 20), o que
-- aconteceu foi grama lançada como quilo. Se o total também estiver
-- absurdo, a nota foi lida errada pela IA e ninguém conferiu.
--
-- Isso importa além do preço: cada uma dessas linhas também virou entrada
-- de ESTOQUE. Quantidade errada na nota é estoque errado desde então.
--
-- Só lê. Não escreve nada.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

select d.data_documento                                   as data_da_nota,
       coalesce(d.fornecedor, '(sem fornecedor)')         as fornecedor,
       d.status,
       round(d.valor_total::numeric, 2)                   as total_da_nota,
       it.nome_lido                                       as como_foi_lido,
       it.quantidade,
       it.unidade,
       round(it.preco_unitario::numeric, 4)               as preco_unitario,
       round((it.quantidade * it.preco_unitario)::numeric, 2) as total_do_item
  from public.itens_documento_compra it
  join public.documentos_compra d on d.id = it.documento_id
  join public.insumos i           on i.id = it.insumo_id
 where lower(i.nome) in ('batata frita', 'salsicha', 'molho tártaro', 'molho tartaro')
 order by i.nome, d.data_documento desc nulls last
 limit 40;
