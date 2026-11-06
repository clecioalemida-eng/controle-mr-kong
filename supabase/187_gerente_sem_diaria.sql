-- 187_gerente_sem_diaria.sql — Mr Kong
--
-- Regra do Clécio (06/11/2026): gerente ganha SÓ o percentual do
-- faturamento da noite. A 186 mostrou que em outubro a gerente diarista
-- levou também R$ 100 de diária em cada noite (a Matriz de cargos tinha
-- diária de gerente; hoje já está em zero).
--
-- O que esta migração faz: tira a diária das noites de gerente que AINDA
-- NÃO tiveram o pagamento das diárias lançado. O total da noite passa a ser
-- só o percentual.
--
-- O que ela NÃO faz: as noites já pagas ficam como estão, porque esse
-- dinheiro já saiu do caixa e já está na conta de diárias. Descontar ou não
-- a diferença é decisão do Clécio, à parte.
--
-- Pode rodar de novo sem efeito.
-- Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

update public.premiacoes_diarias pr
   set base_categoria = 0,
       total_dia = pr.comissao,
       valor_metodo_comissao = pr.comissao
 where pr.metodo_usado = 'gerente'
   and pr.base_categoria > 0
   and not exists (select 1 from public.pagamentos_diaria pg where pg.dia = pr.dia);

-- Confere: o que ainda tem diária de gerente é só noite já paga.
select 'gerente com diária' as parte,
       case when exists (select 1 from public.pagamentos_diaria pg where pg.dia = pr.dia)
            then 'noites já pagas (ficaram como estavam)' else 'noites sem pagamento (deveria ser 0)' end as item,
       format('%s noites · diária %s', count(*), coalesce(sum(pr.base_categoria), 0)) as valor
  from public.premiacoes_diarias pr
 where pr.metodo_usado = 'gerente' and pr.base_categoria > 0
 group by 2
union all
select 'matriz', 'gerente', format('diária base: %s · percentual: %s%%', diaria_base, percentual_faturamento)
  from public.matriz_cargos where papel = 'gerente'
order by 1, 2;
