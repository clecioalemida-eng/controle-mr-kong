-- Execute depois do 010_estoque.sql.
-- Recepção de notas fiscais/recibos: bucket de Storage para os arquivos,
-- tabelas do documento e dos itens lidos pela IA, e um dicionário de
-- sinônimos que aprende com as correções manuais ao longo do tempo.

create table if not exists public.documentos_compra (
  id uuid primary key default gen_random_uuid(),
  arquivo_path text not null,
  tipo_documento text check (tipo_documento in ('nota_fiscal', 'recibo')),
  fornecedor text,
  data_documento date,
  valor_total numeric,
  status text not null default 'processando' check (status in ('processando', 'aguardando_confirmacao', 'confirmado', 'erro')),
  erro_mensagem text,
  criado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id),
  confirmado_em timestamptz
);

create table if not exists public.itens_documento_compra (
  id uuid primary key default gen_random_uuid(),
  documento_id uuid not null references public.documentos_compra(id) on delete cascade,
  nome_lido text not null,
  quantidade numeric not null default 0,
  unidade text not null default 'un' check (unidade in ('un', 'g', 'kg', 'ml', 'l')),
  preco_unitario numeric not null default 0,
  insumo_id uuid references public.insumos(id) on delete set null,
  alerta_preco boolean not null default false,
  preco_anterior numeric,
  criado_em timestamptz not null default now()
);

-- Dicionário de-para: nome como apareceu num documento -> insumo real.
-- Toda vez que alguém vincula manualmente um item não reconhecido a um
-- insumo, isso é gravado aqui, e passa a valer para as próximas leituras.
create table if not exists public.insumo_sinonimos (
  id uuid primary key default gen_random_uuid(),
  nome_variante text not null,
  insumo_id uuid not null references public.insumos(id) on delete cascade,
  criado_em timestamptz not null default now()
);

create unique index if not exists insumo_sinonimos_nome_variante_unq on public.insumo_sinonimos (lower(nome_variante));

alter table public.documentos_compra enable row level security;
alter table public.itens_documento_compra enable row level security;
alter table public.insumo_sinonimos enable row level security;

drop policy if exists "aprovados leem documentos" on public.documentos_compra;
create policy "aprovados leem documentos" on public.documentos_compra for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam documentos" on public.documentos_compra;
create policy "aprovados gerenciam documentos" on public.documentos_compra for all using (public.esta_aprovado()) with check (public.esta_aprovado());

drop policy if exists "aprovados leem itens_documento" on public.itens_documento_compra;
create policy "aprovados leem itens_documento" on public.itens_documento_compra for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam itens_documento" on public.itens_documento_compra;
create policy "aprovados gerenciam itens_documento" on public.itens_documento_compra for all using (public.esta_aprovado()) with check (public.esta_aprovado());

drop policy if exists "aprovados leem sinonimos" on public.insumo_sinonimos;
create policy "aprovados leem sinonimos" on public.insumo_sinonimos for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam sinonimos" on public.insumo_sinonimos;
create policy "aprovados gerenciam sinonimos" on public.insumo_sinonimos for all using (public.esta_aprovado()) with check (public.esta_aprovado());

-- Bucket privado para as fotos/PDFs das notas fiscais e recibos.
insert into storage.buckets (id, name, public)
values ('notas-fiscais', 'notas-fiscais', false)
on conflict (id) do nothing;

drop policy if exists "aprovados leem arquivos de notas" on storage.objects;
create policy "aprovados leem arquivos de notas" on storage.objects
  for select using (bucket_id = 'notas-fiscais' and public.esta_aprovado());
drop policy if exists "aprovados enviam arquivos de notas" on storage.objects;
create policy "aprovados enviam arquivos de notas" on storage.objects
  for insert with check (bucket_id = 'notas-fiscais' and public.esta_aprovado());
drop policy if exists "aprovados apagam arquivos de notas" on storage.objects;
create policy "aprovados apagam arquivos de notas" on storage.objects
  for delete using (bucket_id = 'notas-fiscais' and public.esta_aprovado());
