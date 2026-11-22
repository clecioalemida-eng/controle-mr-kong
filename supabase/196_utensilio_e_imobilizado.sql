-- 196_utensilio_e_imobilizado.sql — Mr Kong
--
-- Na fila "Arrumar o cadastro" apareceram produtos comprados que não são
-- insumo: o abafador inox é imobilizado; espátula, pegador e afins são
-- utensílios. Eles não vão em ficha e não deveriam entrar no estoque.
--
-- Esta migração:
--   1. aceita dois tipos novos de insumo: 'utensilio' e 'imobilizado'
--   2. cria marcar_como_despesa(insumo, centro): marca o tipo e ensina o
--      nome (e os apelidos dele) como "não é insumo" daquele centro, para
--      que a próxima nota com esse nome já entre como despesa, sem estoque.
--
-- As compras que já entraram continuam no histórico (não se apaga
-- histórico). O imobilizado de valor alto também vale cadastrar em
-- Financeiro → DRE → Imobilizado, para entrar como depreciação.
--
-- Pode rodar de novo sem efeito. Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

alter table public.insumos drop constraint if exists insumos_tipo_check;
alter table public.insumos add constraint insumos_tipo_check
  check (tipo is null or tipo in ('ingrediente', 'revenda', 'embalagem', 'uso', 'utensilio', 'imobilizado'));

create or replace function public.marcar_como_despesa(p_insumo uuid, p_centro text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
begin
  if auth.uid() is not null and not public.esta_aprovado() then
    raise exception 'sem_acesso';
  end if;
  if p_centro not in ('utensilios', 'imobilizado') then
    raise exception 'Centro inválido: %', p_centro;
  end if;
  select nome into v_nome from public.insumos where id = p_insumo;
  if v_nome is null then
    raise exception 'Esse insumo não existe mais.';
  end if;

  update public.insumos
     set tipo = case p_centro when 'utensilios' then 'utensilio' else 'imobilizado' end
   where id = p_insumo;

  -- o nome do cadastro e os nomes com que ele já chegou nas notas
  insert into public.nomes_nao_insumo (nome_variante, despesa_centro, criado_por)
  select n.nome, p_centro, auth.uid()
    from (select v_nome as nome
          union
          select s.nome_variante from public.insumo_sinonimos s where s.insumo_id = p_insumo) n
   where not exists (select 1 from public.nomes_nao_insumo x where lower(x.nome_variante) = lower(n.nome));
end;
$$;

revoke all on function public.marcar_como_despesa(uuid, text) from public, anon;
grant execute on function public.marcar_como_despesa(uuid, text) to authenticated;

-- Confere: a regra nova do tipo
select pg_get_constraintdef(oid) as tipos_aceitos
  from pg_constraint where conname = 'insumos_tipo_check';
