-- ===========================================================================
-- 170 — Os itens sem insumo, agrupados pelo nome lido, com sugestão
--
-- A 169 mostrou que 53 das 68 notas paradas estão presas por item sem
-- insumo (119 itens). As compras se repetem — Costa, Onix, Mercadão — e o
-- mesmo produto aparece em várias notas. Esta consulta junta os itens pelo
-- nome lido, para você vincular cada nome UMA vez.
--
-- A sugestão de insumo vem de três lugares, nesta ordem de confiança:
--
--   SINÔNIMO — alguém já ensinou esse nome (insumo_sinonimos). Quase certo.
--   JÁ VINCULADO — o mesmo nome já foi vinculado em outra nota. Quase certo.
--   PALAVRAS — o insumo com mais palavras em comum com o nome lido.
--              É palpite: confira antes de aceitar.
--
-- Quando o vínculo é feito na tela e a nota é confirmada, o nome vira
-- sinônimo, e a próxima nota com esse nome já entra vinculada sozinha.
--
-- A coluna "em_nota" separa os itens de nota parada (destravam a
-- confirmação) dos 20 de nota já confirmada (o furo antigo da 166).
--
-- Só lê. Não escreve nada.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

with sem as (
  select it.nome_lido, it.unidade, it.quantidade, it.preco_unitario, it.documento_id,
         case when d.status = 'confirmado' then 'confirmada' else 'parada' end as em_nota,
         lower(trim(regexp_replace(it.nome_lido, '\s+', ' ', 'g'))) as chave
    from public.itens_documento_compra it
    join public.documentos_compra d on d.id = it.documento_id
   where it.insumo_id is null
     and d.status in ('aguardando_confirmacao', 'confirmado')
),
grupos as (
  select chave,
         min(nome_lido)                                        as nome_lido,
         em_nota,
         count(*)                                              as vezes,
         count(distinct documento_id)                          as notas,
         round(sum(quantidade * preco_unitario)::numeric, 2)   as valor,
         string_agg(distinct unidade, ', ')                    as unidade_lida
    from sem
   group by chave, em_nota
),
-- palavras de cada nome, sem acento, sem número, sem palavra de embalagem
palavras_item as (
  select distinct g.chave, w
    from grupos g,
         regexp_split_to_table(
           regexp_replace(lower(translate(g.nome_lido,
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z ]', ' ', 'g'),
           '\s+') as w
   where length(w) >= 3
     and w not in ('com','sem','para','tipo','und','unid','pct','pacote','cxa','caixa','fardo',
                   'kgs','grs','lts','litro','litros','gramas','quilo','pet','emb','embalagem',
                   'the','des','dos','das','uni','unidade','unidades','tradicional','original')
),
palavras_insumo as (
  select distinct i.id, w
    from public.insumos i,
         regexp_split_to_table(
           regexp_replace(lower(translate(i.nome,
             'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
             'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z ]', ' ', 'g'),
           '\s+') as w
   where coalesce(i.composto, false) = false
     and length(w) >= 3
),
por_palavra as (
  select distinct on (pi.chave)
         pi.chave, pin.id as insumo_id, count(*) as em_comum
    from palavras_item pi
    join palavras_insumo pin on pin.w = pi.w
    join public.insumos i on i.id = pin.id
   group by pi.chave, pin.id, i.nome
   order by pi.chave, count(*) desc, length(i.nome)
),
por_sinonimo as (
  select distinct on (lower(trim(s.nome_variante)))
         lower(trim(s.nome_variante)) as chave, s.insumo_id
    from public.insumo_sinonimos s
   order by lower(trim(s.nome_variante)), s.criado_em desc
),
por_historico as (
  select distinct on (lower(trim(regexp_replace(it.nome_lido, '\s+', ' ', 'g'))))
         lower(trim(regexp_replace(it.nome_lido, '\s+', ' ', 'g'))) as chave, it.insumo_id
    from public.itens_documento_compra it
   where it.insumo_id is not null
   order by lower(trim(regexp_replace(it.nome_lido, '\s+', ' ', 'g'))), it.criado_em desc
)
select g.nome_lido,
       g.em_nota,
       g.vezes,
       g.notas,
       g.valor,
       g.unidade_lida,
       coalesce(isin.nome, ihis.nome, ipal.nome, '')               as insumo_sugerido,
       coalesce(isin.unidade, ihis.unidade, ipal.unidade, '')      as unidade_do_insumo,
       case
         when isin.id is not null then 'SINÔNIMO — já ensinado'
         when ihis.id is not null then 'JÁ VINCULADO em outra nota'
         when ipal.id is not null then 'PALAVRAS — ' || pp.em_comum || ' em comum, confira'
         else 'nenhum parecido — criar insumo novo ou não é insumo'
       end                                                         as de_onde_veio,
       case
         when coalesce(isin.unidade, ihis.unidade, ipal.unidade) is not null
          and g.unidade_lida <> coalesce(isin.unidade, ihis.unidade, ipal.unidade)
         then 'unidade diferente — ajuste quantidade pelo lápis'
         else ''
       end                                                         as atencao
  from grupos g
  left join por_sinonimo  ps  on ps.chave = g.chave
  left join public.insumos isin on isin.id = ps.insumo_id
  left join por_historico ph  on ph.chave = g.chave
  left join public.insumos ihis on ihis.id = ph.insumo_id
  left join por_palavra   pp  on pp.chave = g.chave
  left join public.insumos ipal on ipal.id = pp.insumo_id
 order by g.em_nota desc,   -- paradas primeiro
          g.valor desc nulls last;
