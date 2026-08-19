-- Execute depois do 024_cache_taxas_do_dia.sql.
-- Cache também o faturamento bruto do dia, usado pra mostrar uma prévia
-- do 2% da gerente na Escala do dia (o valor oficial dela continua sendo
-- fechado por mês, no Fechamento mensal — isso aqui é só informativo).

alter table public.taxas_do_dia add column if not exists faturamento_bruto numeric not null default 0;
