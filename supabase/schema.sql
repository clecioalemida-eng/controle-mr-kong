-- Execute este script no Supabase: Project > SQL Editor > New query > Run

create table if not exists public.registros_checklist (
  id uuid primary key default gen_random_uuid(),
  dia_operacional date not null,
  departamento text not null,
  etapa text not null check (etapa in ('abertura', 'fechamento')),
  responsavel text,
  itens jsonb not null default '{}'::jsonb,
  completado_em timestamptz not null default now(),
  criado_em timestamptz not null default now(),
  unique (dia_operacional, departamento, etapa)
);

-- Row Level Security
alter table public.registros_checklist enable row level security;

-- ATENÇÃO: estas políticas liberam leitura e escrita para qualquer pessoa
-- que tenha a "anon key" pública do projeto (é o modo mais simples para
-- colocar no ar rápido, sem tela de login). Se depois você quiser exigir
-- login (Supabase Auth) para preencher os checklists, troque estas
-- políticas por regras que checam auth.uid().

create policy "leitura publica" on public.registros_checklist
  for select using (true);

create policy "insercao publica" on public.registros_checklist
  for insert with check (true);

create policy "atualizacao publica" on public.registros_checklist
  for update using (true);
