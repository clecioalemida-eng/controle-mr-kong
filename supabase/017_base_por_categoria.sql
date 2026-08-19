-- Execute depois do 016_dados_pessoais_equipe.sql.
-- Adiciona a coluna base_categoria em premiacoes_diarias — um valor extra
-- configurado por cargo (não por pessoa), somado à comissão do dia de
-- cada pessoa daquele cargo, do jeito que já era feito na planilha de
-- referência ("valor diária" por Garçom/Equipe interna).

alter table public.premiacoes_diarias add column if not exists base_categoria numeric not null default 0;
