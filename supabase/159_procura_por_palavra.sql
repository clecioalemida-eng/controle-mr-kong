-- ===========================================================================
-- 159 — Quem tem ficha, procurando por palavra
--
-- O 154 cruzava os nomes ignorando o que está entre parênteses, e isso
-- achou "Rei da Selva" x "Rei da Selva (X-Tudo)". Mas não acha
-- "Milkshake" x "Milkshake Baunilha - 500ml", porque aí a diferença é uma
-- palavra no meio, não um parêntese. Daí a conclusão errada de que
-- milkshake e açaí não tinham ficha.
--
-- Esta consulta é mais burra e mais honesta: procura por PALAVRA e mostra
-- todos os pratos que batem, com e sem ficha, lado a lado. Assim dá pra
-- ver com os próprios olhos qual é o cadastro bom e qual é o vazio.
--
-- MUDE as palavras na linha marcada para procurar outra família de
-- produtos. Só lê. Não escreve nada.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

with palavras as (
  -- <<< as palavras procuradas, sem acento e em minúscula
  select unnest(array['milk', 'shake', 'acai', 'sundae', 'cascao', 'suco']) as palavra
),
base as (
  select p.id,
         p.nome,
         p.preco_venda,
         coalesce(p.ativo, true) as ativo,
         lower(translate(p.nome,
               'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
               'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) as nome_limpo,
         (select count(*) from public.prato_insumos pi where pi.prato_id = p.id) as ingredientes
    from public.pratos p
)
select b.nome                                       as prato,
       b.preco_venda                                as preco,
       case when b.ativo then 'ativo' else 'escondido' end as situacao,
       b.ingredientes,
       case when b.ingredientes = 0 then 'SEM FICHA' else 'tem ficha' end as ficha,
       round((select sum(pi.quantidade * coalesce(i.custo_medio_atual, 0))
                from public.prato_insumos pi
                join public.insumos i on i.id = pi.insumo_id
               where pi.prato_id = b.id)::numeric, 2)  as custo
  from base b
 where exists (select 1 from palavras w where b.nome_limpo like '%' || w.palavra || '%')
 order by regexp_replace(b.nome_limpo, '[^a-z]', '', 'g'), b.ingredientes desc;
