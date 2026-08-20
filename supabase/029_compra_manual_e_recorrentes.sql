-- Execute depois do 028_previsao_contas_pagar.sql.
-- Unifica a forma de pagamento (pix/débito/crédito/boleto) tanto pra
-- compra manual quanto pra confirmação de nota fiscal, guarda isso
-- também na movimentação de estoque (serve de base pro DRE, mais pra
-- frente), e adiciona uma categoria pra reconhecer contas recorrentes
-- (água, luz, internet...) na previsão de custos mensais.

alter table public.movimentacoes_estoque add column if not exists forma_pagamento text; -- 'pix' | 'debito' | 'credito' | 'boleto'
alter table public.contas_pagar add column if not exists forma_pagamento text;
alter table public.contas_pagar add column if not exists categoria text; -- 'agua' | 'luz' | 'internet' | 'alvara' | 'aluguel' | 'telefone' | 'compra' | 'outro'
