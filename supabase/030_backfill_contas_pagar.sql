-- Execute depois do 029_compra_manual_e_recorrentes.sql.
-- Preenche retroativamente as contas a pagar das notas fiscais que ja
-- estavam confirmadas antes dessa funcionalidade existir. Como essas
-- notas antigas nao tinham forma de pagamento registrada, entram todas
-- como "pago" (nao da pra saber quais ainda devem so pelos dados que
-- existem). So cria pra notas que ainda nao tem conta a pagar vinculada
-- (evita duplicar se essa migracao for rodada mais de uma vez).

insert into public.contas_pagar (
  documento_compra_id, fornecedor_id, fornecedor_nome, descricao,
  valor_total, valor_pago, status, categoria, data_vencimento, criado_por
)
select
  dc.id,
  dc.fornecedor_id,
  dc.fornecedor,
  'Nota fiscal (retroativa) - ' || coalesce(dc.fornecedor, 'fornecedor nao identificado'),
  coalesce(dc.valor_total, 0),
  coalesce(dc.valor_total, 0),
  'pago',
  'compra',
  coalesce(dc.data_documento, dc.confirmado_em::date, dc.criado_em::date),
  dc.criado_por
from public.documentos_compra dc
where dc.status = 'confirmado'
  and not exists (
    select 1 from public.contas_pagar cp where cp.documento_compra_id = dc.id
  );
