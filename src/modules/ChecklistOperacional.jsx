-- =====================================================================
-- 066_contagem_de_estoque.sql
-- Painel Mr. Kong — a contagem de estoque dentro do checklist
--
-- Uma contagem por DIA e por SETOR. A chave unica (dia, setor) e o que
-- impede duas pessoas abrirem duas contagens do bar no mesmo dia e cada
-- uma contar metade.
--
-- Item nao contado fica NULO, nao zero. Zero e uma afirmacao ("acabou"),
-- nulo e "ninguem olhou" — misturar os dois inventa perda que nao houve.
--
-- O saldo do sistema e CONGELADO na hora em que a pessoa digita. Sem
-- isso, uma venda que entra no meio da contagem faz a diferenca mudar
-- sozinha e ninguem consegue explicar o numero depois.
--
-- Quem conta: qualquer aprovado.
-- Quem FECHA e ajusta o estoque: so administrador — ajuste mexe no
-- custo do CMV e na DRE, entao segue a mesma regra do fiado.
--
-- IDEMPOTENTE. Rodar depois da 065.
-- =====================================================================

create table if not exists public.contagens_estoque (
  id          uuid primary key default gen_random_uuid(),
  dia         date not null,
  setor       text not null references public.setores_estoque(chave) on update cascade,
  status      text not null default 'aberta' check (status in ('aberta','fechada')),
  aberta_por  uuid,
  aberta_em   timestamptz not null default now(),
  fechada_por uuid,
  fechada_em  timestamptz,
  ajustou     boolean not null default false,
  unique (dia, setor)
);

create table if not exists public.contagens_itens (
  contagem_id   uuid not null references public.contagens_estoque(id) on delete cascade,
  insumo_id     uuid not null references public.insumos(id) on delete cascade,
  quantidade    numeric,          -- NULO = ninguem contou ainda
  saldo_sistema numeric,          -- congelado na hora de digitar
  custo         numeric,          -- custo medio na hora de digitar
  contado_por   uuid,
  contado_em    timestamptz not null default now(),
  primary key (contagem_id, insumo_id)
);

create index if not exists contagens_estoque_dia_idx on public.contagens_estoque (dia);

alter table public.contagens_estoque enable row level security;
alter table public.contagens_itens   enable row level security;

drop policy if exists "contagens_estoque_select" on public.contagens_estoque;
create policy "contagens_estoque_select" on public.contagens_estoque
  for select using (public.esta_aprovado());
drop policy if exists "contagens_estoque_admin" on public.contagens_estoque;
create policy "contagens_estoque_admin" on public.contagens_estoque
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "contagens_itens_select" on public.contagens_itens;
create policy "contagens_itens_select" on public.contagens_itens
  for select using (public.esta_aprovado());
drop policy if exists "contagens_itens_admin" on public.contagens_itens;
create policy "contagens_itens_admin" on public.contagens_itens
  for all using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------------
-- 1. Abrir (ou reaproveitar) a contagem do dia
-- ---------------------------------------------------------------------
create or replace function public.abrir_contagem(p_dia date, p_setor text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  if not public.esta_aprovado() then
    raise exception 'Sem permissão para contar estoque.';
  end if;
  if not exists (select 1 from public.setores_estoque e where e.chave = p_setor) then
    raise exception 'Setor inválido: %', p_setor;
  end if;

  select id into v_id from public.contagens_estoque
   where dia = p_dia and setor = p_setor;

  if v_id is null then
    insert into public.contagens_estoque (dia, setor, aberta_por)
    values (p_dia, p_setor, auth.uid())
    on conflict (dia, setor) do nothing
    returning id into v_id;

    -- Corrida: se outra pessoa abriu no mesmo instante, pega a dela.
    if v_id is null then
      select id into v_id from public.contagens_estoque
       where dia = p_dia and setor = p_setor;
    end if;
  end if;

  return v_id;
end $$;

grant execute on function public.abrir_contagem(date, text) to authenticated;


-- ---------------------------------------------------------------------
-- 2. A lista da contagem: insumo do setor + saldo + o que ja foi contado
-- ---------------------------------------------------------------------
create or replace function public.contagem_do_dia(p_dia date, p_setor text)
returns table (
  insumo_id     uuid,
  nome          text,
  unidade       text,
  custo         numeric,
  saldo_sistema numeric,
  contado       numeric,
  diferenca     numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.id,
    i.nome,
    i.unidade,
    coalesce(i.custo_medio_atual, 0),
    coalesce(ci.saldo_sistema, i.estoque_atual, 0),
    ci.quantidade,
    case when ci.quantidade is null then null
         else ci.quantidade - coalesce(ci.saldo_sistema, i.estoque_atual, 0) end
  from public.insumos i
  join public.insumo_setores s on s.insumo_id = i.id and s.setor = p_setor
  left join public.contagens_estoque c
         on c.dia = p_dia and c.setor = p_setor
  left join public.contagens_itens ci
         on ci.contagem_id = c.id and ci.insumo_id = i.id
 where public.esta_aprovado()
 order by public.chave_nome(i.nome);
$$;

grant execute on function public.contagem_do_dia(date, text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. Contar um insumo
--
--    p_qtd nulo APAGA a contagem daquele item (voltou pra "nao contado").
-- ---------------------------------------------------------------------
create or replace function public.contar_insumo(
  p_contagem uuid,
  p_insumo   uuid,
  p_qtd      numeric
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_saldo  numeric;
  v_custo  numeric;
begin
  if not public.esta_aprovado() then
    raise exception 'Sem permissão para contar estoque.';
  end if;

  select status into v_status from public.contagens_estoque where id = p_contagem;
  if v_status is null then
    raise exception 'Contagem não encontrada.';
  end if;
  if v_status = 'fechada' then
    raise exception 'Esta contagem já foi fechada. Peça a um administrador para reabrir.';
  end if;

  if p_qtd is null then
    delete from public.contagens_itens
     where contagem_id = p_contagem and insumo_id = p_insumo;
    return null;
  end if;

  if p_qtd < 0 then
    raise exception 'Quantidade contada não pode ser negativa.';
  end if;

  select coalesce(estoque_atual, 0), coalesce(custo_medio_atual, 0)
    into v_saldo, v_custo
    from public.insumos where id = p_insumo;

  insert into public.contagens_itens
      (contagem_id, insumo_id, quantidade, saldo_sistema, custo, contado_por, contado_em)
  values (p_contagem, p_insumo, p_qtd, v_saldo, v_custo, auth.uid(), now())
  on conflict (contagem_id, insumo_id) do update
     set quantidade  = excluded.quantidade,
         contado_por = excluded.contado_por,
         contado_em  = excluded.contado_em;
  -- saldo_sistema e custo NAO sao atualizados no conflito: valem os da
  -- primeira digitada, senao corrigir um numero errado mudaria a base
  -- de comparacao junto.

  return p_qtd;
end $$;

grant execute on function public.contar_insumo(uuid, uuid, numeric) to authenticated;


-- ---------------------------------------------------------------------
-- 4. Fechar — so administrador
--
--    p_ajustar = true grava a diferenca como movimentacao de estoque
--    (tipo 'ajuste'), que e o mesmo caminho do ajuste manual da tela de
--    Estoque. false so guarda a contagem, sem mexer no saldo.
-- ---------------------------------------------------------------------
create or replace function public.fechar_contagem(p_contagem uuid, p_ajustar boolean default false)
returns table (itens_contados integer, ajustes integer, perda numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_cont   integer := 0;
  v_aj     integer := 0;
  v_perda  numeric := 0;
begin
  if not public.is_admin() then
    raise exception 'Só administradores fecham a contagem de estoque.';
  end if;

  select status into v_status from public.contagens_estoque where id = p_contagem;
  if v_status is null then raise exception 'Contagem não encontrada.'; end if;
  if v_status = 'fechada' then raise exception 'Esta contagem já está fechada.'; end if;

  select count(*), coalesce(sum((ci.quantidade - coalesce(ci.saldo_sistema,0)) * coalesce(ci.custo,0)), 0)
    into v_cont, v_perda
    from public.contagens_itens ci
   where ci.contagem_id = p_contagem and ci.quantidade is not null;

  if p_ajustar then
    insert into public.movimentacoes_estoque (insumo_id, tipo, quantidade, motivo, criado_por)
    select ci.insumo_id,
           'ajuste',
           ci.quantidade - coalesce(ci.saldo_sistema, 0),
           format('Contagem de estoque %s (%s)', c.dia, c.setor),
           auth.uid()
      from public.contagens_itens ci
      join public.contagens_estoque c on c.id = ci.contagem_id
     where ci.contagem_id = p_contagem
       and ci.quantidade is not null
       and ci.quantidade - coalesce(ci.saldo_sistema, 0) <> 0;
    get diagnostics v_aj = row_count;
  end if;

  update public.contagens_estoque
     set status = 'fechada', fechada_por = auth.uid(), fechada_em = now(), ajustou = p_ajustar
   where id = p_contagem;

  return query select v_cont, v_aj, round(v_perda, 2);
end $$;

grant execute on function public.fechar_contagem(uuid, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- 5. Reabrir — tambem so administrador
-- ---------------------------------------------------------------------
create or replace function public.reabrir_contagem(p_contagem uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v_ajustou boolean;
begin
  if not public.is_admin() then
    raise exception 'Só administradores reabrem a contagem.';
  end if;

  select ajustou into v_ajustou from public.contagens_estoque where id = p_contagem;
  if v_ajustou is null then raise exception 'Contagem não encontrada.'; end if;
  if v_ajustou then
    raise exception 'Esta contagem já ajustou o estoque. Reabrir contaria o ajuste duas vezes — faça uma contagem nova.';
  end if;

  update public.contagens_estoque
     set status = 'aberta', fechada_por = null, fechada_em = null
   where id = p_contagem;

  return 'Contagem reaberta.';
end $$;

grant execute on function public.reabrir_contagem(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 6. Situacao do dia — pros cards do checklist mostrarem o andamento
-- ---------------------------------------------------------------------
create or replace function public.situacao_contagens(p_dia date)
returns table (
  setor    text,
  label    text,
  total    integer,
  contados integer,
  status   text,
  contagem_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.chave,
    e.label,
    (select count(*) from public.insumo_setores s where s.setor = e.chave)::integer,
    (select count(*) from public.contagens_itens ci
      where ci.contagem_id = c.id and ci.quantidade is not null)::integer,
    coalesce(c.status, 'nao_iniciada'),
    c.id
  from public.setores_estoque e
  left join public.contagens_estoque c on c.setor = e.chave and c.dia = p_dia
 where e.ativo and public.esta_aprovado()
 order by e.ordem, e.chave;
$$;

grant execute on function public.situacao_contagens(date) to authenticated;


-- ---------------------------------------------------------------------
-- Confere
-- ---------------------------------------------------------------------
select e.label, count(s.insumo_id) as insumos_no_setor
  from public.setores_estoque e
  left join public.insumo_setores s on s.setor = e.chave
 group by e.label, e.ordem
 order by e.ordem;
