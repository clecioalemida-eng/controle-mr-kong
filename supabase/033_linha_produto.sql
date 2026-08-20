-- Execute depois do 032_dia_compra_e_status.sql.
-- Segmentacao de produtos em linhas (Hamburguer Gourmet, Hamburguer
-- Tradicional, Bebidas, Bombons e Balas, Milkshake e Sorvetes, Cremes,
-- Petiscos, Chapa, Combos, Batatas Fritas, Acai) -- usada na Curva ABC
-- por linha e no dashboard.

alter table public.pratos add column if not exists linha_produto text;
