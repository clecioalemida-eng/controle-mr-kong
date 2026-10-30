-- ===========================================================================
-- 160 — A laranja passa a ser medida em suco
--
-- Você compra laranja por quilo e vende suco por mililitro, e as duas
-- coisas nunca vão pesar o mesmo. Hoje o insumo está com R$ 50,00 "por kg"
-- — mas R$ 50,00 é o preço do SACO de 20 kg, não do quilo. O quilo custa
-- R$ 2,50.
--
-- A conta que importa não é nenhuma das duas: é o preço do LITRO DE SUCO,
-- porque é isso que vai no copo.
--
--     R$ 50,00 o saco ÷ 8 litros que ele rende = R$ 6,25 o litro
--
-- Então o insumo passa a ser medido em litro, a R$ 6,25. A ficha do prato
-- guarda 0,5 — que em quilo aparecia como 500 g e em litro aparece como
-- 500 ml. O número não muda; muda o que ele quer dizer, e aí passa a estar
-- certo.
--
-- Fica em MANUAL de propósito: a nota do fornecedor vem em quilo de
-- laranja, e em "segue a nota" ela sobrescreveria o preço do litro de
-- suco na primeira compra. É o mesmo motivo do ovo.
--
-- AJUSTE OS TRÊS NÚMEROS ABAIXO se algum estiver diferente.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

do $laranja$
declare
  v_preco_do_saco numeric := 50.00;   -- <<< o que você paga no saco
  v_kg_no_saco    numeric := 20;      -- <<< quantos quilos vêm nele
  v_litros        numeric := 8;       -- <<< quantos litros de suco ele rende
  v_por_litro     numeric;
  v_id            uuid;
  v_nome          text;
begin
  if v_litros <= 0 then
    raise exception 'Quantos litros o saco rende? Com % não dá pra dividir.', v_litros;
  end if;
  v_por_litro := round(v_preco_do_saco / v_litros, 4);

  select id, nome into v_id, v_nome
    from public.insumos
   where lower(translate(nome, 'ãáâàç', 'aaaac')) like 'laranja%'
   order by length(nome)
   limit 1;

  if v_id is null then
    raise exception 'Não achei um insumo começando por "Laranja". Confira o nome no cadastro.';
  end if;

  update public.insumos
     set unidade           = 'l',
         custo_medio_atual = v_por_litro,
         custo_manual      = v_por_litro,
         origem_custo      = 'manual',
         atualizado_em     = now()
   where id = v_id;

  raise notice 'Insumo "%" agora é % por litro (saco de % por R$ %, rendendo % l). O quilo da laranja sai a %.',
    v_nome, v_por_litro, v_kg_no_saco, v_preco_do_saco, v_litros,
    round(v_preco_do_saco / nullif(v_kg_no_saco, 0), 4);
end $laranja$;

-- conferência: todo prato que leva laranja, com o custo e a margem de agora
select p.nome                                     as prato,
       p.preco_venda                              as preco,
       pi.quantidade                              as litros_na_ficha,
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
                where x.prato_id = p.id
                  and lower(translate(y.nome, 'ãáâàç', 'aaaac')) like 'laranja%')
 group by p.id, p.nome, p.preco_venda, pi.quantidade
 order by p.nome;
