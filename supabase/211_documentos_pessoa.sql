-- 211_documentos_pessoa.sql — Mr Kong
-- Vários documentos por pessoa (RG, CPF, comprovante de endereço,
-- carteira de trabalho, contrato…), cada um com o tipo. É daqui que a
-- leitura por IA tira os dados para atualizar o cadastro.
--
-- Os arquivos continuam no mesmo bucket privado "documentos-pessoas"
-- (migração 018). O campo antigo pessoas.documento_path continua valendo
-- e é copiado para cá, para nada sumir da tela.
--
-- Também cria pessoas.rg (o número do RG lido do documento).
--
-- Só acrescenta. Pode rodar duas vezes. Rodar ANTES de subir o código.
--
-- Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

alter table public.pessoas add column if not exists rg text;

create table if not exists public.pessoas_documentos (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  caminho text not null,                 -- caminho no bucket documentos-pessoas
  nome_arquivo text,
  tipo text not null default 'outro'
    check (tipo in ('rg', 'cnh', 'cpf', 'endereco', 'ctps', 'contrato', 'outro')),
  criado_em timestamptz not null default now(),
  unique (pessoa_id, caminho)
);

create index if not exists pessoas_documentos_pessoa_idx on public.pessoas_documentos (pessoa_id);

alter table public.pessoas_documentos enable row level security;

drop policy if exists "aprovados gerenciam pessoas_documentos" on public.pessoas_documentos;
create policy "aprovados gerenciam pessoas_documentos" on public.pessoas_documentos
  for all using (public.esta_aprovado()) with check (public.esta_aprovado());

-- O documento que já estava anexado do jeito antigo entra na lista nova.
insert into public.pessoas_documentos (pessoa_id, caminho, nome_arquivo, tipo)
select id, documento_path, documento_path, 'outro'
  from public.pessoas
 where documento_path is not null
on conflict (pessoa_id, caminho) do nothing;

-- Conferência -------------------------------------------------------------
select 'pessoas.rg' as item,
       exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'pessoas' and column_name = 'rg')::text as ok
union all
select 'pessoas_documentos', (select count(*) from public.pessoas_documentos)::text || ' documento(s)';
