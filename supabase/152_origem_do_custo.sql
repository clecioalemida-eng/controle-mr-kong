-- ===========================================================================
-- 152 — Origem do custo de cada insumo
--
-- Até aqui o custo do insumo era um número só, e quem escrevesse por
-- último ganhava: a nota sobrescrevia o que você tinha digitado, e você
-- digitava por cima da nota. Daí nasceram os 26 divergentes — ninguém
-- estava errado, o campo é que não sabia a quem obedecer.
--
-- Agora cada insumo declara de onde vem o custo dele:
--
--   ultima_compra  (padrão) — a nota confirmada atualiza sozinha.
--   media_90d                — a média das compras do trimestre, que
--                              absorve a compra cara de emergência.
--   manual                   — você digita e a nota NÃO encosta. É o
--                              lugar do ovo, da embalagem rateada, do que
--                              tem preço de caixa.
--   receita                  — insumo composto: o custo é calculado pelos
--                              ingredientes dele, não comprado.
--
-- Esta migração NÃO recalcula nada. Ela só rotula o que já existe, para
-- que nenhum número mude hoje. A partir da próxima nota confirmada é que
-- o rótulo passa a valer.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

alter table public.insumos add column if not exists origem_custo text;
alter table public.insumos add column if not exists custo_manual numeric;

-- Rotula o que já existe, sem mexer em valor:
--   composto -> receita; todo o resto -> ultima_compra (o comportamento de
--   hoje). custo_manual guarda o número atual, pra que virar "manual"
--   depois não perca o que estava lá.
update public.insumos
   set origem_custo = case when coalesce(composto, false) then 'receita' else 'ultima_compra' end
 where origem_custo is null;

update public.insumos
   set custo_manual = custo_medio_atual
 where custo_manual is null;

alter table public.insumos alter column origem_custo set default 'ultima_compra';
alter table public.insumos alter column origem_custo set not null;

do $ck$
begin
  if not exists (select 1 from pg_constraint where conname = 'insumos_origem_custo_ck') then
    alter table public.insumos add constraint insumos_origem_custo_ck
      check (origem_custo in ('manual', 'ultima_compra', 'media_90d', 'receita'));
  end if;
end $ck$;

-- ---------------------------------------------------------------------------
-- Quanto o custo DEVERIA ser, segundo a origem declarada.
-- Devolve null quando não dá pra saber (origem automática sem compra
-- nenhuma) — e null aqui quer dizer "não mexe", nunca "zero". Zerar o
-- custo de um insumo por falta de dado seria inventar margem.
-- ---------------------------------------------------------------------------
create or replace function public.custo_pela_origem(p_insumo uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_origem text;
  v_manual numeric;
  v_valor  numeric;
begin
  select origem_custo, custo_manual into v_origem, v_manual
    from public.insumos where id = p_insumo;
  if v_origem is null then return null; end if;

  if v_origem = 'manual' then
    return v_manual;
  elsif v_origem = 'receita' then
    return null;                      -- quem cuida do composto é o cálculo dele
  elsif v_origem = 'ultima_compra' then
    select m.preco_unitario into v_valor
      from public.movimentacoes_estoque m
      left join public.documentos_compra d on d.id = m.documento_compra_id
     where m.insumo_id = p_insumo and m.tipo = 'compra' and m.preco_unitario > 0
     order by coalesce(d.data_documento::timestamptz, m.criado_em) desc
     limit 1;
    return v_valor;
  elsif v_origem = 'media_90d' then
    select round(avg(m.preco_unitario)::numeric, 4) into v_valor
      from public.movimentacoes_estoque m
      left join public.documentos_compra d on d.id = m.documento_compra_id
     where m.insumo_id = p_insumo and m.tipo = 'compra' and m.preco_unitario > 0
       and coalesce(d.data_documento::timestamptz, m.criado_em) >= now() - interval '90 days';
    return v_valor;
  end if;
  return null;
end;
$$;

-- Aplica a origem: grava o custo que a origem manda, se houver.
create or replace function public.aplicar_origem_custo(p_insumo uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v_novo numeric;
begin
  v_novo := public.custo_pela_origem(p_insumo);
  if v_novo is null then
    return (select custo_medio_atual from public.insumos where id = p_insumo);
  end if;
  update public.insumos
     set custo_medio_atual = v_novo, atualizado_em = now()
   where id = p_insumo;
  return v_novo;
end;
$$;

-- ---------------------------------------------------------------------------
-- A compra passa a respeitar a origem.
--
-- Isto é um gatilho de propósito, e não uma linha no NotasFiscais.jsx: o
-- custo tem que obedecer à origem venha a compra de onde vier — da tela de
-- notas, de um lançamento manual de estoque ou de qualquer coisa que a
-- gente escreva no ano que vem. Regra que mora no cliente é regra que
-- alguém esquece de copiar.
-- ---------------------------------------------------------------------------
create or replace function public.compra_atualiza_custo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_origem text;
begin
  if new.tipo <> 'compra' or coalesce(new.preco_unitario, 0) <= 0 then
    return new;
  end if;
  select origem_custo into v_origem from public.insumos where id = new.insumo_id;
  if v_origem in ('ultima_compra', 'media_90d') then
    perform public.aplicar_origem_custo(new.insumo_id);
  end if;
  return new;
end;
$$;

drop trigger if exists compra_atualiza_custo_tg on public.movimentacoes_estoque;
create trigger compra_atualiza_custo_tg
  after insert on public.movimentacoes_estoque
  for each row execute function public.compra_atualiza_custo();

-- ---------------------------------------------------------------------------
-- O que a tela chama pra mudar origem e/ou valor.
-- p_valor só é usado quando a origem é 'manual'.
-- ---------------------------------------------------------------------------
create or replace function public.definir_custo_insumo(
  p_insumo uuid, p_origem text, p_valor numeric default null)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare v_composto boolean;
begin
  if not public.esta_aprovado() then
    raise exception 'sem_acesso';
  end if;
  if p_origem not in ('manual', 'ultima_compra', 'media_90d', 'receita') then
    raise exception 'origem desconhecida: %', p_origem;
  end if;

  select coalesce(composto, false) into v_composto from public.insumos where id = p_insumo;
  if v_composto and p_origem <> 'receita' then
    raise exception 'insumo composto tem custo calculado pela receita; não aceita outra origem';
  end if;

  update public.insumos
     set origem_custo = p_origem,
         custo_manual = case when p_origem = 'manual' and p_valor is not null
                             then p_valor else custo_manual end,
         atualizado_em = now()
   where id = p_insumo;

  return public.aplicar_origem_custo(p_insumo);
end;
$$;

revoke all on function public.custo_pela_origem(uuid) from public;
revoke all on function public.aplicar_origem_custo(uuid) from public;
revoke all on function public.definir_custo_insumo(uuid, text, numeric) from public;
grant execute on function public.definir_custo_insumo(uuid, text, numeric) to authenticated;

-- conferência: como ficou o cadastro, sem nenhum valor ter mudado
select origem_custo,
       count(*)                                                   as insumos,
       count(*) filter (where coalesce(custo_medio_atual,0) = 0)  as sem_preco
  from public.insumos
 group by origem_custo
 order by origem_custo;
