-- Execute depois do 004_fichas_tecnicas.sql (SQL Editor > New query > Run).
-- Garante que "pratos" nunca duplica pelo nome — importante porque agora
-- vamos ter pratos cadastrados manualmente (via planilha de custos, antes
-- de terem sido vendidos) E pratos descobertos pelo botão "Importar
-- pratos" do CardápioWeb. Sem isso, o mesmo hambúrguer viraria duas linhas
-- diferentes assim que fosse vendido pela primeira vez.

create unique index if not exists pratos_nome_unq on public.pratos (lower(nome));
