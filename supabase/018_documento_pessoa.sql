-- Execute depois do 017_base_por_categoria.sql.
-- Permite anexar um documento (RG, contrato etc.) a cada pessoa da
-- equipe, guardado num bucket privado — mesmo padrão do bucket de notas
-- fiscais.

alter table public.pessoas add column if not exists documento_path text;

insert into storage.buckets (id, name, public)
values ('documentos-pessoas', 'documentos-pessoas', false)
on conflict (id) do nothing;

drop policy if exists "aprovados leem documentos de pessoas" on storage.objects;
create policy "aprovados leem documentos de pessoas" on storage.objects
  for select using (bucket_id = 'documentos-pessoas' and public.esta_aprovado());
drop policy if exists "aprovados enviam documentos de pessoas" on storage.objects;
create policy "aprovados enviam documentos de pessoas" on storage.objects
  for insert with check (bucket_id = 'documentos-pessoas' and public.esta_aprovado());
drop policy if exists "aprovados apagam documentos de pessoas" on storage.objects;
create policy "aprovados apagam documentos de pessoas" on storage.objects
  for delete using (bucket_id = 'documentos-pessoas' and public.esta_aprovado());
