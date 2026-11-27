-- 200_nao_e_estoque_qualquer_centro.sql — Mr Kong
--
-- Na fila "Arrumar o cadastro", o que não é estoque pode ser muita coisa:
-- energia elétrica (utilidades), entregador (pessoas), bloco de recibo
-- (administrativo), fritadeira (imobilizado). Só Utensílio e Imobilizado
-- não bastavam, e a conferência de notas só aceitava 6 destinos.
--
-- Agora o "não é estoque" usa os mesmos centros de custo do Contas a
-- pagar, que se editam em DRE → Listas → Centros de custo. Esta migração:
--   1. deixa itens_documento_compra.despesa_centro e
--      nomes_nao_insumo.despesa_centro aceitarem qualquer centro (antes:
--      só utensilios, manutencao, imobilizado, administrativo, pessoas e
--      nao_produto)
--   2. guarda no insumo o centro escolhido (insumos.despesa_centro) e
--      aceita o tipo 'despesa' para os centros que não são utensílio nem
--      imobilizado
--   3. refaz marcar_como_despesa(insumo, centro) para qualquer centro
--
-- Pode rodar de novo sem efeito. Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

-- 1. Qualquer centro, desde que preenchido ---------------------------------------
do $centros$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass::text as tabela, c.conname
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.contype = 'c'
       and a.attname = 'despesa_centro'
       and c.conrelid in ('public.itens_documento_compra'::regclass, 'public.nomes_nao_insumo'::regclass)
  loop
    execute format('alter table %s drop constraint %I', r.tabela, r.conname);
  end loop;
end $centros$;

alter table public.itens_documento_compra add constraint itens_documento_despesa_centro_chk
  check (despesa_centro is null or length(trim(despesa_centro)) > 0);
alter table public.nomes_nao_insumo add constraint nomes_nao_insumo_despesa_centro_chk
  check (length(trim(despesa_centro)) > 0);

-- 2. Centro no insumo e o tipo 'despesa' ----------------------------------------
alter table public.insumos add column if not exists despesa_centro text;
alter table public.insumos drop constraint if exists insumos_tipo_check;
alter table public.insumos add constraint insumos_tipo_check
  check (tipo is null or tipo in ('ingrediente', 'revenda', 'embalagem', 'uso', 'utensilio', 'imobilizado', 'despesa'));

-- 3. Marcar como despesa de qualquer centro ---------------------------------------
create or replace function public.marcar_como_despesa(p_insumo uuid, p_centro text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
  v_centro text := lower(trim(coalesce(p_centro, '')));
begin
  if auth.uid() is not null and not public.esta_aprovado() then
    raise exception 'sem_acesso';
  end if;
  if v_centro = '' or v_centro = 'insumos' then
    raise exception 'Escolha um centro de custo que não seja Insumos.';
  end if;
  select nome into v_nome from public.insumos where id = p_insumo;
  if v_nome is null then
    raise exception 'Esse insumo não existe mais.';
  end if;

  update public.insumos
     set tipo = case v_centro when 'utensilios' then 'utensilio' when 'imobilizado' then 'imobilizado' else 'despesa' end,
         despesa_centro = v_centro
   where id = p_insumo;

  -- o nome do cadastro e os nomes com que ele já chegou nas notas
  insert into public.nomes_nao_insumo (nome_variante, despesa_centro, criado_por)
  select n.nome, v_centro, auth.uid()
    from (select v_nome as nome
          union
          select s.nome_variante from public.insumo_sinonimos s where s.insumo_id = p_insumo) n
   where not exists (select 1 from public.nomes_nao_insumo x where lower(x.nome_variante) = lower(n.nome));
end;
$$;

revoke all on function public.marcar_como_despesa(uuid, text) from public, anon;
grant execute on function public.marcar_como_despesa(uuid, text) to authenticated;

-- Confere: os centros cadastrados em DRE → Listas (os que a fila vai mostrar)
select valor, rotulo, ativo
  from public.listas_opcoes
 where lista = 'centro_custo'
 order by ordem;
