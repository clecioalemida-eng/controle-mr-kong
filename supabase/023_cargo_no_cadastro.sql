-- Execute depois do 022_acesso_a_valores.sql.
-- Adiciona o cargo escolhido no cadastro (visível pro admin na hora de
-- aprovar) e garante que o gatilho que cria o perfil também capture esse
-- campo.

alter table public.perfis add column if not exists cargo text
  check (cargo in ('administrador', 'gerente', 'garcom', 'chapa', 'bar', 'cozinha', 'caixa'));

create or replace function public.criar_perfil_novo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis (id, nome, email, is_admin, status, cargo)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome', new.email), new.email, false, 'pendente', new.raw_user_meta_data->>'cargo')
  on conflict (id) do nothing;
  return new;
end;
$$;
