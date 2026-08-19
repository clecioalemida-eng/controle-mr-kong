-- Execute depois do 015_mais_cargos.sql.
-- Adiciona CPF, telefone, e-mail e data de aniversário ao cadastro de
-- pessoas (equipe).

alter table public.pessoas add column if not exists cpf text;
alter table public.pessoas add column if not exists telefone text;
alter table public.pessoas add column if not exists email text;
alter table public.pessoas add column if not exists data_nascimento date;
