-- ===========================================================================
-- 168 — As notas paradas: o que é dinheiro de verdade e o que é lixo
--
-- A 166 mostrou 71 notas sem confirmar (R$ 31.022,83) e 139 itens sem
-- insumo (R$ 16.897,87). Os dois números NÃO podem ser somados: item sem
-- insumo de nota não confirmada já está dentro dos R$ 31 mil.
--
-- Esta consulta separa as coisas:
--
--   A — as 71 notas por situação. "erro" e "processando" antigo costumam
--       ser leitura que falhou, não compra perdida.
--   B — quantas dessas têm conta a pagar, e quanto já foi PAGO. Nota
--       paga e não confirmada é o caso grave: o dinheiro saiu e o DRE
--       não viu.
--   C — quantas parecem repetidas de uma nota já confirmada (mesmo
--       fornecedor, mesmo valor, mesmo dia). Essas é só descartar.
--   D — os itens sem insumo, divididos entre nota confirmada (esse é o
--       furo real) e nota parada (some quando a nota for tratada).
--   E — as 15 maiores notas paradas, para começar por elas.
--
-- Só lê. Não escreve nada.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

with paradas as (
  select d.*,
         exists (select 1 from public.documentos_compra c
                  where c.status = 'confirmado'
                    and c.id <> d.id
                    and lower(trim(coalesce(c.fornecedor, ''))) = lower(trim(coalesce(d.fornecedor, '')))
                    and round(coalesce(c.valor_total, 0)::numeric, 2) = round(coalesce(d.valor_total, 0)::numeric, 2)
                    and c.data_documento is not distinct from d.data_documento) as parece_repetida
    from public.documentos_compra d
   where coalesce(d.status, '') <> 'confirmado'
),
contas as (
  select cp.documento_compra_id,
         sum(cp.valor_total) as a_pagar,
         sum(cp.valor_pago)  as pago
    from public.contas_pagar cp
   where cp.documento_compra_id is not null
   group by cp.documento_compra_id
)

-- A — por situação
select 'A' as bloco,
       'situação: ' || coalesce(p.status, '(vazio)') as o_que,
       count(*) as quantas,
       round(coalesce(sum(p.valor_total), 0)::numeric, 2) as valor,
       'de ' || coalesce(to_char(min(coalesce(p.data_documento, p.criado_em::date)), 'DD/MM/YY'), '?')
         || ' a ' || coalesce(to_char(max(coalesce(p.data_documento, p.criado_em::date)), 'DD/MM/YY'), '?') as detalhe
  from paradas p
 group by p.status

-- B — dinheiro que já saiu
union all
select 'B',
       'paradas COM conta a pagar',
       count(*),
       round(coalesce(sum(c.a_pagar), 0)::numeric, 2),
       'já pago: R$ ' || replace(round(coalesce(sum(c.pago), 0)::numeric, 2)::text, '.', ',')
  from paradas p
  join contas c on c.documento_compra_id = p.id

union all
select 'B',
       'paradas SEM conta a pagar',
       count(*),
       round(coalesce(sum(p.valor_total), 0)::numeric, 2),
       'não aparecem nem no financeiro'
  from paradas p
 where not exists (select 1 from contas c where c.documento_compra_id = p.id)

-- C — repetidas
union all
select 'C',
       'parece repetida de nota já confirmada',
       count(*),
       round(coalesce(sum(p.valor_total), 0)::numeric, 2),
       'mesmo fornecedor, valor e dia — candidata a descartar'
  from paradas p
 where p.parece_repetida

-- D — itens sem insumo
union all
select 'D',
       'item sem insumo em nota ' || case when x.confirmada then 'CONFIRMADA' else 'parada' end,
       count(*),
       round(coalesce(sum(x.valor), 0)::numeric, 2),
       case when x.confirmada
            then 'furo real: a nota fechou e o item não virou custo'
            else 'já contado no bloco A'
       end
  from (select coalesce(d.status, '') = 'confirmado' as confirmada,
               it.quantidade * it.preco_unitario    as valor
          from public.itens_documento_compra it
          join public.documentos_compra d on d.id = it.documento_id
         where it.insumo_id is null) x
 group by x.confirmada

-- E — as maiores paradas
union all
select * from (
  select 'E',
         coalesce(nullif(trim(p.fornecedor), ''), '(sem fornecedor)'),
         1,
         round(coalesce(p.valor_total, 0)::numeric, 2),
         coalesce(to_char(p.data_documento, 'DD/MM/YY'), 'sem data') || ' · ' || coalesce(p.status, '?')
           || case when p.parece_repetida then ' · REPETIDA?' else '' end
           || case when c.pago > 0 then ' · PAGO R$ ' || replace(round(c.pago::numeric, 2)::text, '.', ',') else '' end
    from paradas p
    left join contas c on c.documento_compra_id = p.id
   order by p.valor_total desc nulls last
   limit 15
) maiores

order by 1, 4 desc;
