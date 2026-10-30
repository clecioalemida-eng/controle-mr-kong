-- ===========================================================================
-- 169 — O que trava cada nota parada, uma por linha
--
-- A 168 mostrou 68 notas aguardando confirmação (R$ 31.022,83), nenhuma
-- com conta a pagar. A tela de conferência só deixa confirmar quando as
-- três travas estão livres (NotasFiscais.jsx, "podeConfirmar"):
--
--   1. todo item vinculado a um insumo;
--   2. a unidade do item igual à do insumo;
--   3. nenhum item com valor implausível (maior que 1,5× a própria nota,
--      ou mais de 10× a maior nota já confirmada).
--
-- Esta consulta repete as três travas no banco, nota por nota, e ainda
-- aponta duas coisas que a tela não mostra:
--
--   DATA ESTRANHA — data vazia, no futuro, ou muito longe do dia em que a
--   nota foi subida. Confirmar com data errada joga o custo no mês errado
--   do DRE. Corrija a data antes.
--
--   CONTA MANUAL PARECIDA — conta a pagar sem nota, do mesmo fornecedor,
--   com valor quase igual e data próxima. Se existir, a compra JÁ está no
--   financeiro: confirmar a nota cria uma segunda conta e o custo dobra.
--   Nesse caso, confira antes de confirmar.
--
-- Uma linha por nota, da maior para a menor. Só lê. Não escreve nada.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

with maior_nota as (
  select coalesce(max(valor_total), 0) as v
    from public.documentos_compra
   where status = 'confirmado'
),
paradas as (
  select d.id, d.fornecedor, d.fornecedor_id, d.data_documento, d.valor_total, d.criado_em,
         regexp_replace(lower(translate(coalesce(d.fornecedor, ''),
           'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
           'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]', '', 'g') as forn_k,
         -- dia de referência: a data da nota, ou o dia em que subiu se a data for estranha
         case when d.data_documento is null
                or d.data_documento > current_date + 3
                or abs(d.data_documento - d.criado_em::date) > 60
              then null
              else d.data_documento
         end as data_boa
    from public.documentos_compra d
   where d.status = 'aguardando_confirmacao'
),
travas as (
  select it.documento_id,
         count(*)                                              as itens,
         count(*) filter (where it.insumo_id is null)          as sem_insumo,
         count(*) filter (where i.id is not null
                            and i.unidade <> it.unidade)       as unidade_errada,
         count(*) filter (where it.quantidade * it.preco_unitario > 0
                            and ((p.valor_total > 0 and it.quantidade * it.preco_unitario > p.valor_total * 1.5)
                              or (m.v > 0 and it.quantidade * it.preco_unitario > m.v * 10))) as implausivel
    from public.itens_documento_compra it
    join paradas p on p.id = it.documento_id
    cross join maior_nota m
    left join public.insumos i on i.id = it.insumo_id
   group by it.documento_id
),
manuais as (
  select p.id as documento_id,
         count(*) as quantas,
         string_agg(coalesce(cp.fornecedor_nome, '?') || ' R$ ' ||
                    replace(round(cp.valor_total::numeric, 2)::text, '.', ',') || ' em ' ||
                    to_char(coalesce(cp.data_compra, cp.data_vencimento, cp.criado_em::date), 'DD/MM/YY'),
                    ' | ') as quais
    from paradas p
    join public.contas_pagar cp
      on cp.documento_compra_id is null
     -- mesmo fornecedor: pelo cadastro, ou pelo começo do nome
     and (   (p.fornecedor_id is not null and cp.fornecedor_id = p.fornecedor_id)
          or (length(p.forn_k) >= 6 and
              left(regexp_replace(lower(translate(coalesce(cp.fornecedor_nome, ''),
                     'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                     'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z0-9]', '', 'g'), 6)
              = left(p.forn_k, 6)))
     -- valor quase igual: até 2% ou R$ 1 de diferença
     and abs(coalesce(cp.valor_total, 0) - coalesce(p.valor_total, 0))
         <= greatest(1, coalesce(p.valor_total, 0) * 0.02)
     -- data próxima: até 20 dias
     and abs(coalesce(cp.data_compra, cp.data_vencimento, cp.criado_em::date)
             - coalesce(p.data_boa, p.criado_em::date)) <= 20
   group by p.id
)
select coalesce(nullif(trim(p.fornecedor), ''), '(sem fornecedor)')     as fornecedor,
       coalesce(to_char(p.data_documento, 'DD/MM/YY'), 'sem data')     as data_na_nota,
       to_char(p.criado_em at time zone 'America/Sao_Paulo', 'DD/MM/YY') as subiu_em,
       round(coalesce(p.valor_total, 0)::numeric, 2)                   as valor,
       coalesce(t.itens, 0)                                            as itens,
       coalesce(t.sem_insumo, 0)                                       as sem_insumo,
       coalesce(t.unidade_errada, 0)                                   as unidade_errada,
       coalesce(t.implausivel, 0)                                      as implausivel,
       case
         when p.data_documento is null              then 'SEM DATA'
         when p.data_documento > current_date + 3   then 'DATA NO FUTURO'
         when p.data_boa is null                    then 'DATA LONGE DO ENVIO'
         else ''
       end                                                             as data_estranha,
       coalesce(mn.quais, '')                                          as conta_manual_parecida,
       case
         when mn.quantas > 0                     then '1º CONFERIR: pode já estar no financeiro — confirmar pode dobrar'
         when coalesce(t.itens, 0) = 0           then 'nota sem itens lidos — refazer a leitura ou descartar'
         when p.data_boa is null                 then 'corrigir a data e depois destravar'
         when coalesce(t.sem_insumo, 0) > 0
           or coalesce(t.unidade_errada, 0) > 0
           or coalesce(t.implausivel, 0) > 0     then 'destravar os itens e confirmar'
         else 'nada trava — é só abrir e confirmar'
       end                                                             as o_que_fazer
  from paradas p
  left join travas  t  on t.documento_id  = p.id
  left join manuais mn on mn.documento_id = p.id
 order by p.valor_total desc nulls last;
