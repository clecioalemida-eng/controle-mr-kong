-- Execute este script DEPOIS do schema.sql original (SQL Editor > New query > Run).
-- Ele adiciona: perfis de usuário, aprovação de cadastro, módulos (cards) e
-- controle de acesso por módulo. Também restringe o checklist para só ser
-- lido/editado por usuários aprovados (antes era público).

-- ---------------------------------------------------------------------------
-- 1) Perfis de usuário (estende a tabela interna auth.users do Supabase)
-- ---------------------------------------------------------------------------
create table if not exists public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  email text not null,
  is_admin boolean not null default false,
  status text not null default 'pendente' check (status in ('pendente', 'aprovado', 'rejeitado')),
  criado_em timestamptz not null default now()
);

alter table public.perfis enable row level security;

-- Função auxiliar (SECURITY DEFINER) para checar se o usuário logado é admin
-- sem cair em recursão de RLS dentro da própria tabela perfis.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select is_admin from public.perfis where id = auth.uid()), false);
$$;

drop policy if exists "ver proprio perfil" on public.perfis;
create policy "ver proprio perfil" on public.perfis
  for select using (auth.uid() = id);

drop policy if exists "admin ve todos perfis" on public.perfis;
create policy "admin ve todos perfis" on public.perfis
  for select using (public.is_admin());

drop policy if exists "admin atualiza perfis" on public.perfis;
create policy "admin atualiza perfis" on public.perfis
  for update using (public.is_admin());

-- Cria automaticamente um perfil (status pendente) sempre que alguém se cadastra
create or replace function public.criar_perfil_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (id, nome, email, is_admin, status)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', new.email), new.email, false, 'pendente')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario
  after insert on auth.users
  for each row execute function public.criar_perfil_novo_usuario();

-- ---------------------------------------------------------------------------
-- 2) Módulos (cards) e controle de acesso por usuário
-- ---------------------------------------------------------------------------
create table if not exists public.modulos (
  id uuid primary key default gen_random_uuid(),
  chave text unique not null,
  nome text not null,
  descricao text,
  criado_em timestamptz not null default now()
);

insert into public.modulos (chave, nome, descricao)
values ('checklist', 'Checklist Operacional', 'Abertura e fechamento por departamento, com dashboard de pendências')
on conflict (chave) do nothing;

alter table public.modulos enable row level security;

drop policy if exists "leitura publica modulos" on public.modulos;
create policy "leitura publica modulos" on public.modulos
  for select using (auth.role() = 'authenticated');

drop policy if exists "admin gerencia modulos" on public.modulos;
create policy "admin gerencia modulos" on public.modulos
  for all using (public.is_admin());

create table if not exists public.acessos_modulo (
  usuario_id uuid not null references public.perfis(id) on delete cascade,
  modulo_id uuid not null references public.modulos(id) on delete cascade,
  concedido_em timestamptz not null default now(),
  primary key (usuario_id, modulo_id)
);

alter table public.acessos_modulo enable row level security;

drop policy if exists "ver proprio acesso" on public.acessos_modulo;
create policy "ver proprio acesso" on public.acessos_modulo
  for select using (auth.uid() = usuario_id);

drop policy if exists "admin ve todos acessos" on public.acessos_modulo;
create policy "admin ve todos acessos" on public.acessos_modulo
  for select using (public.is_admin());

drop policy if exists "admin gerencia acessos" on public.acessos_modulo;
create policy "admin gerencia acessos" on public.acessos_modulo
  for all using (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3) Restringe o checklist: só usuário aprovado lê/escreve (antes era público)
-- ---------------------------------------------------------------------------
drop policy if exists "leitura publica" on public.registros_checklist;
drop policy if exists "insercao publica" on public.registros_checklist;
drop policy if exists "atualizacao publica" on public.registros_checklist;

create or replace function public.esta_aprovado()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select status = 'aprovado' from public.perfis where id = auth.uid()), false);
$$;

create policy "aprovados leem checklist" on public.registros_checklist
  for select using (public.esta_aprovado());

create policy "aprovados inserem checklist" on public.registros_checklist
  for insert with check (public.esta_aprovado());

create policy "aprovados atualizam checklist" on public.registros_checklist
  for update using (public.esta_aprovado());
