-- Execute depois do 011_notas_fiscais.sql.
-- Adiciona o fornecedor à movimentação de estoque, pra aparecer no extrato
-- (ex.: "Compra · Distribuidora Boi Bom") em vez de só "Compra".

alter table public.movimentacoes_estoque add column if not exists fornecedor text;
