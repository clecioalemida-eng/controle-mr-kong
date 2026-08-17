-- Execute depois do 002_auth_e_modulos.sql (SQL Editor > New query > Run).
-- Cadastra os 5 novos cards. Cada um começa "em construção" no app até
-- ganhar uma tela própria. O admin decide quem vê cada card no Painel Admin.

insert into public.modulos (chave, nome, descricao) values
  ('financeiro', 'Financeiro', 'Contas a pagar/receber, fluxo de caixa e relatórios financeiros.'),
  ('marketing', 'Marketing', 'Campanhas, redes sociais e calendário de promoções.'),
  ('comercial', 'Comercial', 'Vendas, metas e acompanhamento de clientes.'),
  ('sac', 'SAC', 'Atendimento, reclamações e acompanhamento de chamados dos clientes.'),
  ('rastreabilidade', 'Rastreabilidade', 'Controle de lotes, validade e origem dos insumos.')
on conflict (chave) do nothing;
