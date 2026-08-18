-- Execute depois do 006_seed_fichas_tecnicas_hamburgueres.sql (SQL Editor > New query > Run).
-- Ficha técnica virou uma aba dentro do card Financeiro em vez de card
-- próprio — isso só remove a entrada da tela inicial. Os dados (insumos,
-- pratos, prato_insumos e as 14 fichas técnicas já cadastradas) não são
-- tocados, continuam intactos no banco.

delete from public.modulos where chave = 'fichas_tecnicas';
