-- ===========================================================================
-- 151 — Conferência antes de corrigir o preço dos Ovos
--
-- O insumo "Ovos" está com o preço da caixa (R$ 179,81) e unidade "un", e
-- as fichas gastam 1. Antes de trocar o preço pelo preço de UM ovo, é
-- preciso ter certeza de que nenhuma ficha já usa fração — se alguma
-- estiver com 1/360, baixar o preço quebraria justamente a que estava
-- certa.
--
-- A regra pra ler o resultado:
--   qtd_na_ficha = 1          -> essa ficha espera preço POR OVO. Pode trocar.
--   qtd_na_ficha < 0,01       -> essa ficha espera preço POR CAIXA. Trocar
--                                o preço quebraria ela; corrija a ficha.
--
-- O mesmo exame vale para os três insumos baratos demais que apareceram
-- junto (batata frita a R$ 0,07/kg, molho tártaro e salsicha a R$ 1,00/kg):
-- esses puxam o custo pra baixo e fazem a margem parecer melhor do que é.
--
-- Só lê. Não escreve nada.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

select i.nome                                              as insumo,
       i.unidade,
       round(coalesce(i.custo_medio_atual, 0)::numeric, 4)  as preco_hoje,
       p.nome                                              as prato,
       coalesce(p.preco_venda, 0)                          as preco_do_prato,
       pi.quantidade                                       as qtd_na_ficha,
       round((pi.quantidade * coalesce(i.custo_medio_atual, 0))::numeric, 2) as custo_da_linha,
       case when pi.quantidade >= 0.5 then 'espera preço POR UNIDADE'
            when pi.quantidade > 0    then 'espera preço POR EMBALAGEM'
            else 'quantidade zerada' end                   as o_que_a_ficha_espera
  from public.insumos i
  join public.prato_insumos pi on pi.insumo_id = i.id
  left join public.pratos p    on p.id = pi.prato_id
 where lower(i.nome) in ('ovos', 'ovo', 'batata frita', 'molho tártaro', 'molho tartaro', 'salsicha')
   and coalesce(p.ativo, true)
 order by i.nome, pi.quantidade desc, p.nome;
