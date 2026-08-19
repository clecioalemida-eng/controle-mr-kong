-- Execute depois do 021_equipe_matriz_e_salarios.sql.
-- Trava valores sensíveis (salário e matriz de cargos) pra só admin poder
-- editar — reforçado no banco (gatilho/política), não só escondido na
-- tela, senão alguém chamando a API direto ainda conseguiria mudar.

-- Ninguém além de admin consegue mudar salario_base de uma pessoa —
-- mesmo que tente via update, o valor volta pro que já estava (ou fica
-- nulo na criação).
create or replace function public.impedir_edicao_salario_por_nao_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    if TG_OP = 'UPDATE' then
      new.salario_base := old.salario_base;
    elsif TG_OP = 'INSERT' then
      new.salario_base := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists protege_salario_base on public.pessoas;
create trigger protege_salario_base
  before insert or update on public.pessoas
  for each row execute function public.impedir_edicao_salario_por_nao_admin();

-- Matriz de cargos: todo aprovado continua podendo LER (precisa, pro
-- cálculo da comissão funcionar pra qualquer um), mas só admin escreve.
drop policy if exists "aprovados gerenciam matriz" on public.matriz_cargos;
drop policy if exists "so admin insere matriz" on public.matriz_cargos;
create policy "so admin insere matriz" on public.matriz_cargos for insert with check (public.is_admin());
drop policy if exists "so admin atualiza matriz" on public.matriz_cargos;
create policy "so admin atualiza matriz" on public.matriz_cargos for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "so admin apaga matriz" on public.matriz_cargos;
create policy "so admin apaga matriz" on public.matriz_cargos for delete using (public.is_admin());
