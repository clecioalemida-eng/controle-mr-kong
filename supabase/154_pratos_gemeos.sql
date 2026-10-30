-- ===========================================================================
-- 154 — Produtos duplicados: o que vende não tem ficha, o que tem ficha
--       não vende
--
-- O 153 derrubou minha primeira explicação: prato_insumos tem 479 linhas,
-- longe do teto de 1000, então nada estava sendo cortado. O que há são 241
-- pratos ativos para 174 fichas — e os 67 sem ficha são justamente os que
-- aparecem vendendo na tela.
--
-- A suspeita: o cardápio tem o mesmo produto duas vezes, com nomes
-- diferentes. "Rei da Selva" (o que o cliente pede, e que veio do
-- CardápioWeb) e "Rei da Selva (X-Tudo)" (o que alguém cadastrou aqui e
-- montou a ficha). A venda cai num, a receita está no outro, e a margem
-- fica no limbo entre os dois.
--
-- Esta consulta cruza os dois pelo nome sem os parênteses. Se a coluna
-- gemeo_com_ficha vier preenchida, é isso mesmo: não falta ficha, falta
-- juntar os dois cadastros.
--
-- Só lê. Não escreve nada.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

with base as (
  select p.id,
         p.nome,
         p.preco_venda,
         -- nome sem acento, sem o que está entre parênteses e sem
         -- pontuação: é o que faz "Rei da Selva (X-Tudo)" encontrar
         -- "Rei da Selva"
         regexp_replace(
           lower(translate(regexp_replace(p.nome, '\(.*?\)', '', 'g'),
                           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                           'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')),
           '[^a-z0-9]', '', 'g')                                   as chave,
         (select count(*) from public.prato_insumos pi where pi.prato_id = p.id) as ingredientes
    from public.pratos p
   where coalesce(p.ativo, true)
)
select sem.nome                                   as prato_que_vende_sem_ficha,
       sem.preco_venda                            as preco,
       com.nome                                   as gemeo_com_ficha,
       com.preco_venda                            as preco_do_gemeo,
       com.ingredientes                           as ingredientes_do_gemeo,
       case when com.id is null then 'ficha nunca foi feita'
            when com.preco_venda is distinct from sem.preco_venda then 'juntar — e os preços diferem'
            else 'juntar os dois cadastros' end   as o_que_fazer
  from base sem
  left join base com
    on com.chave = sem.chave
   and com.id <> sem.id
   and com.ingredientes > 0
 where sem.ingredientes = 0
 order by (com.id is null), sem.nome
 limit 80;
