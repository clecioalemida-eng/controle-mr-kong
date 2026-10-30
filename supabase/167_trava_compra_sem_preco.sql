-- ===========================================================================
-- 167 — Trava: compra sem preço não entra
--
-- "Toda mercadoria comprada precisa estar conectada a uma entrada e a um
-- custo." Esta migração põe essa frase dentro do banco, onde ela vale
-- para qualquer tela — a de notas, a de estoque, e a que a gente
-- escrever ano que vem.
--
-- A regra: movimentação do tipo 'compra' precisa ter preço unitário maior
-- que zero. Entrada sem custo infla o estoque e some do CMV, que é o
-- melhor jeito de ter lucro no papel e não ter no caixa.
--
-- É NOT VALID de propósito: vale para o que entrar daqui pra frente e
-- não rejeita o passado. O passado a gente conserta olhando o 166 — e
-- rejeitá-lo agora só impediria você de mexer nas linhas antigas.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

do $ck$
begin
  if not exists (select 1 from pg_constraint where conname = 'movimentacao_compra_tem_preco') then
    alter table public.movimentacoes_estoque
      add constraint movimentacao_compra_tem_preco
      check (tipo <> 'compra' or (preco_unitario is not null and preco_unitario > 0))
      not valid;
  end if;
end $ck$;

-- conferência: a trava existe e quantas linhas antigas não passariam nela
select c.conname                                  as trava,
       c.convalidated                             as valida_o_passado,
       (select count(*) from public.movimentacoes_estoque m
         where m.tipo = 'compra' and coalesce(m.preco_unitario, 0) <= 0) as compras_antigas_sem_preco
  from pg_constraint c
 where c.conname = 'movimentacao_compra_tem_preco';
