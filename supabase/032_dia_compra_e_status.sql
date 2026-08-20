-- Execute depois do 031_centro_custo_e_sync_estoque.sql.
-- Guarda o dia da compra separado do dia de vencimento (hoje so tinha
-- vencimento). Tenta preencher retroativamente pras contas que vieram
-- de nota fiscal, usando a data do documento.

alter table public.contas_pagar add column if not exists data_compra date;

update public.contas_pagar cp
set data_compra = coalesce(dc.data_documento, cp.criado_em::date)
from public.documentos_compra dc
where cp.documento_compra_id = dc.id
  and cp.data_compra is null;

update public.contas_pagar
set data_compra = criado_em::date
where data_compra is null and documento_compra_id is null;
