-- ===========================================================================
-- 156 — Conserta o preço do ovo
--
-- O insumo "Ovos" está cadastrado com o preço da CAIXA (R$ 179,81) e
-- unidade "un", e as 9 fichas gastam 1. Resultado: cada X-Tudo consome uma
-- caixa de ovos na conta, e quatro dos lanches mais vendidos aparecem com
-- margem de −300% a −442%.
--
-- ATENÇÃO — AJUSTE OS DOIS NÚMEROS ABAIXO ANTES DE RODAR.
-- Eu não sei quantos ovos vêm na caixa que você compra, e chutar isso
-- seria trocar um número errado por outro. Põe o que você paga e quantos
-- ovos vêm; a conta sai sozinha.
--
-- Também marca o insumo como MANUAL (migração 152), pra que a próxima
-- nota confirmada não desfaça o conserto — a nota vai continuar vindo com
-- o preço da caixa, e é justamente disso que o manual protege.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

do $ovo$
declare
  v_preco_da_caixa  numeric := 179.81;   -- <<< o que você paga na caixa
  v_ovos_na_caixa   int     := 360;      -- <<< 30 dúzias = 360. MUDE se for outra.
  v_por_ovo         numeric;
  v_id              uuid;
begin
  if v_ovos_na_caixa <= 1 then
    raise exception 'Quantos ovos vêm na caixa? Com % não dá pra dividir nada.', v_ovos_na_caixa;
  end if;
  v_por_ovo := round(v_preco_da_caixa / v_ovos_na_caixa, 4);

  select id into v_id from public.insumos where lower(nome) in ('ovos', 'ovo') limit 1;
  if v_id is null then
    raise exception 'Não achei o insumo "Ovos". Confira o nome no cadastro.';
  end if;

  update public.insumos
     set custo_medio_atual = v_por_ovo,
         custo_manual      = v_por_ovo,
         origem_custo      = 'manual',
         atualizado_em     = now()
   where id = v_id;

  raise notice 'Ovo passou a custar % (caixa de % por %)', v_por_ovo, v_ovos_na_caixa, v_preco_da_caixa;
end $ovo$;

-- conferência: como ficaram os pratos que levam ovo
select p.nome                                     as prato,
       p.preco_venda                              as preco,
       round(sum(pi.quantidade * coalesce(i.custo_medio_atual, 0))::numeric, 2) as custo_agora,
       case when p.preco_venda > 0 then
         round(((p.preco_venda - sum(pi.quantidade * coalesce(i.custo_medio_atual, 0)))
                / p.preco_venda * 100)::numeric, 1) end                          as margem_agora
  from public.pratos p
  join public.prato_insumos pi on pi.prato_id = p.id
  join public.insumos i        on i.id = pi.insumo_id
 where coalesce(p.ativo, true)
   and exists (select 1 from public.prato_insumos x
                 join public.insumos y on y.id = x.insumo_id
                where x.prato_id = p.id and lower(y.nome) in ('ovos', 'ovo'))
 group by p.id, p.nome, p.preco_venda
 order by p.nome;
