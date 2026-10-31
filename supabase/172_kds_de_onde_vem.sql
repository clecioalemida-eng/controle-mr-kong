-- 172_kds_de_onde_vem.sql — Mr Kong
-- Só leitura. Não muda nada no banco.
--
-- A cozinha passou a usar o KDS do próprio CardápioWeb. O Desempenho do
-- painel calcula tempo com o "peguei" e o "terminei" que a equipe marcava
-- no tablet do painel (producao_itens.pego_em / pronto_em). Se ninguém
-- marca mais, a análise fica vazia — a não ser que o CardápioWeb mande
-- os horários de cada etapa do pedido.
--
-- Esta consulta responde duas perguntas, numa tabela só:
--   1. Até quando a equipe marcou produção no painel (por dia, 21 dias).
--   2. Que tabelas e colunas de pedido/status/horário existem no banco,
--      pra saber se o webhook do CardápioWeb já guarda as etapas.
--
-- Onde rodar: Supabase → SQL Editor. Colar o resultado (CSV) na conversa.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

with dia as (
  -- Dia operacional das 5h às 5h, pelo relógio de Rio Verde.
  select ((i.criado_em at time zone 'America/Sao_Paulo') - interval '5 hours')::date as dia,
         i.pego_em, i.pronto_em, i.pedido_id
    from public.producao_itens i
   where i.criado_em >= now() - interval '21 days'
),
marcacao as (
  select '1. marcação no painel'                                   as parte,
         dia::text                                                 as nome,
         format('%s itens · %s pedidos · %s pegos · %s terminados',
                count(*), count(distinct pedido_id),
                count(*) filter (where pego_em is not null),
                count(*) filter (where pronto_em is not null))     as detalhe
    from dia
   group by dia
),
colunas as (
  select '2. colunas no banco'                                     as parte,
         c.table_name                                              as nome,
         string_agg(c.column_name || ' (' || c.data_type || ')', ', ' order by c.ordinal_position) as detalhe
    from information_schema.columns c
   where c.table_schema = 'public'
     and (c.table_name ilike '%pedido%' or c.table_name ilike '%kds%'
          or c.table_name ilike '%producao%' or c.table_name ilike '%cardapio%'
          or c.table_name ilike '%webhook%')
   group by c.table_name
)
select * from marcacao
union all
select * from colunas
order by parte, nome desc;
