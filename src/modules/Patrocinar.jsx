-- 060_midia_id_opcional.sql
--
-- O que quebrou:
--   "null value in column midia_id of relation patrocinios violates not-null"
--
-- Por quê:
--   `patrocinios.midia_id` guarda o id do POST do Instagram que foi
--   impulsionado. Quando a tabela nasceu, todo anúncio era um post — então
--   a coluna virou NOT NULL, e isso estava certo na época.
--   A 058 abriu um caminho novo: anúncio feito de um arquivo subido, que
--   não existe como post e portanto não tem id de post. A função grava
--   `midia_id = null` e `midia_subida_id = <o arquivo>`. O NOT NULL de
--   antes barra justamente o caminho novo.
--
-- O que este arquivo faz:
--   1. tira o NOT NULL de midia_id;
--   2. põe no lugar uma regra que diz a verdade nova: todo patrocínio tem
--      OU um post OU um arquivo subido — nunca nenhum dos dois, nunca os
--      dois ao mesmo tempo. Sem isso, trocar NOT NULL por nada deixaria
--      passar um patrocínio sem criativo nenhum.
--
-- Onde rodar: Supabase → SQL Editor.

alter table public.patrocinios
  alter column midia_id drop not null;

alter table public.patrocinios
  drop constraint if exists patrocinios_tem_criativo;

-- `not (a and b)` e `(a or b)` juntos = exatamente um dos dois.
-- Linhas antigas têm midia_id preenchido e midia_subida_id nulo: passam.
alter table public.patrocinios
  add constraint patrocinios_tem_criativo
  check (
    (midia_id is not null and midia_subida_id is null)
    or
    (midia_id is null and midia_subida_id is not null)
  )
  not valid;

-- `not valid` acima evita travar na checagem das linhas antigas no momento
-- do alter; o validate abaixo confere todas elas, mas sem bloquear escrita.
alter table public.patrocinios
  validate constraint patrocinios_tem_criativo;

-- Confere: deve devolver  nulo_permitido = true  e  regra = 1
select
  (select is_nullable = 'YES'
     from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'patrocinios'
      and column_name  = 'midia_id') as nulo_permitido,
  (select count(*)
     from pg_constraint
    where conrelid = 'public.patrocinios'::regclass
      and conname  = 'patrocinios_tem_criativo') as regra;
