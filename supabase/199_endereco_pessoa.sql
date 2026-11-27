-- 199_endereco_pessoa.sql — Mr Kong
-- Endereço no cadastro de pessoas, para a lista de pendências de cadastro
-- da aba "Encargos e riscos" (documento, telefone, endereço, CPF).
--
-- Só acrescenta uma coluna vazia. Não mexe em dado nenhum. Pode rodar
-- duas vezes. Rodar ANTES de subir o Equipe.jsx novo — senão salvar
-- uma pessoa dá erro de coluna inexistente.
--
-- Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

alter table public.pessoas add column if not exists endereco text;

comment on column public.pessoas.endereco is
  'Endereço completo (rua, número, bairro, cidade). Texto livre.';

select 'pessoas.endereco' as item,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'pessoas'
                  and column_name = 'endereco')::text as ok;
