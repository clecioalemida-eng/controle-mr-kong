-- 195_cadastro_unico_e_precos.sql — Mr Kong
--
-- Fase 1 do controle de estoque: cada produto existe uma vez, todo produto
-- comprado tem para onde ir, e o comprador enxerga o histórico de preços.
--
-- O que a 194 mostrou e esta migração resolve:
--   * Apagar um insumo apagava junto todas as compras dele. Agora o banco
--     não deixa: insumo com compra se junta com outro, não some.
--   * O banco só barrava o mesmo nome em maiúscula/minúscula. "Hortelã" e
--     "HORTELA" passavam. Agora o nome é comparado sem acento, espaço e
--     pontuação, em qualquer tela que crie insumo.
--   * 116 insumos são comprados e não estão em ficha nenhuma. Parte é
--     material de uso (limpeza, gás), que não vai em ficha mesmo. Cada
--     insumo ganha um TIPO para dizer isso: ingrediente, revenda, embalagem
--     ou uso e limpeza.
--
-- Cria:
--   1. insumos.tipo, já preenchido para quem está em ficha (ingrediente) e
--      para quem está marcado como revenda
--   2. nome_chave(texto) e a trava de nome repetido (gatilho)
--   3. compras presas ao insumo (on delete restrict)
--   4. cadastro_decisoes: o que já foi decidido na fila de arrumação
--   5. cadastro_insumos_raio(): os dados da fila "Arrumar o cadastro"
--   6. juntar_e_lembrar(origem, destino): junta dois insumos e guarda o
--      nome antigo como sinônimo, para a próxima nota já cair certo
--   7. historico_precos(insumo) e precos_em_alta(dias): histórico de preços
--
-- Pode rodar de novo sem efeito. Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

-- 1. Tipo do insumo -----------------------------------------------------------
alter table public.insumos add column if not exists tipo text;
alter table public.insumos drop constraint if exists insumos_tipo_check;
alter table public.insumos add constraint insumos_tipo_check
  check (tipo is null or tipo in ('ingrediente', 'revenda', 'embalagem', 'uso'));

update public.insumos i set tipo = 'ingrediente'
 where i.tipo is null
   and (exists (select 1 from public.prato_insumos pi where pi.insumo_id = i.id)
        or exists (select 1 from public.insumo_composicao ic where ic.insumo_filho_id = i.id));

do $revenda$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'insumos' and column_name = 'revenda') then
    execute $q$update public.insumos set tipo = 'revenda' where revenda is true and coalesce(tipo, '') <> 'revenda'$q$;
  end if;
end $revenda$;

-- 2. Nome único de verdade ------------------------------------------------------
-- "Hortelã", "HORTELA" e "hortela " viram a mesma chave: "hortela".
create or replace function public.nome_chave(p text)
returns text
language sql
immutable
as $$
  select trim(regexp_replace(
           translate(lower(coalesce(p, '')),
                     'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
           '[^a-z0-9]+', ' ', 'g'))
$$;

-- Gatilho, e não índice único: os pares repetidos que já existem continuam
-- de pé até alguém juntar na fila, mas nenhum novo entra.
create or replace function public.insumos_nome_unico_tg()
returns trigger
language plpgsql
as $$
declare
  v_existente text;
begin
  select i.nome into v_existente
    from public.insumos i
   where public.nome_chave(i.nome) = public.nome_chave(new.nome)
     and i.id <> new.id
   limit 1;
  if v_existente is not null then
    raise exception 'Já existe um insumo com esse nome: %', v_existente
      using errcode = '23505';
  end if;
  return new;
end;
$$;

drop trigger if exists insumos_nome_unico on public.insumos;
create trigger insumos_nome_unico
  before insert or update of nome on public.insumos
  for each row execute function public.insumos_nome_unico_tg();

-- 3. Compra não some junto com o insumo -----------------------------------------
do $fk$
declare
  v_nome text;
begin
  select c.conname into v_nome
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
   where c.conrelid = 'public.movimentacoes_estoque'::regclass
     and c.contype = 'f'
     and c.confrelid = 'public.insumos'::regclass
     and a.attname = 'insumo_id'
   limit 1;
  if v_nome is not null then
    execute format('alter table public.movimentacoes_estoque drop constraint %I', v_nome);
  end if;
  alter table public.movimentacoes_estoque
    add constraint movimentacoes_estoque_insumo_id_fkey
    foreign key (insumo_id) references public.insumos(id) on delete restrict;
end $fk$;

-- 4. Decisões da fila ---------------------------------------------------------
-- chave: 'par:<id menor>:<id maior>' (não são o mesmo produto),
--        'solto:<id>' (manter mesmo sem uso),
--        'nao:<nome_chave>' (é despesa mesmo, não é produto)
create table if not exists public.cadastro_decisoes (
  chave      text primary key,
  decisao    text not null,
  criado_por uuid references auth.users(id) default auth.uid(),
  criado_em  timestamptz not null default now()
);
alter table public.cadastro_decisoes enable row level security;
drop policy if exists "aprovados leem cadastro_decisoes" on public.cadastro_decisoes;
create policy "aprovados leem cadastro_decisoes" on public.cadastro_decisoes
  for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam cadastro_decisoes" on public.cadastro_decisoes;
create policy "aprovados gerenciam cadastro_decisoes" on public.cadastro_decisoes
  for all using (public.esta_aprovado()) with check (public.esta_aprovado());

-- 5. Os dados da fila -----------------------------------------------------------
create or replace function public.cadastro_insumos_raio()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if auth.uid() is not null and not public.esta_aprovado() then
    raise exception 'sem_acesso';
  end if;

  with compras as (
    select m.insumo_id, count(*) as vezes, max(coalesce(d.data_documento, m.criado_em::date)) as ultima,
           (array_agg(m.preco_unitario order by coalesce(d.data_documento, m.criado_em::date) desc, m.criado_em desc))[1] as ultimo_preco
      from public.movimentacoes_estoque m
      left join public.documentos_compra d on d.id = m.documento_compra_id
     where m.tipo = 'compra'
     group by m.insumo_id
  ),
  fichas as (
    select insumo_id, count(distinct prato_id) as pratos from public.prato_insumos group by insumo_id
  ),
  compostos as (
    select distinct insumo_filho_id as insumo_id from public.insumo_composicao
  ),
  nao as (
    select it.nome_lido, count(*) as vezes, max(coalesce(d.data_documento, d.confirmado_em::date)) as ultima,
           max(it.despesa_centro) as centro
      from public.itens_documento_compra it
      join public.documentos_compra d on d.id = it.documento_id and d.status = 'confirmado'
     where it.insumo_id is null and coalesce(trim(it.nome_lido), '') <> ''
     group by it.nome_lido
  )
  select jsonb_build_object(
    'insumos', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'nome', i.nome, 'unidade', i.unidade, 'tipo', i.tipo,
               'custo', i.custo_medio_atual,
               'fichas', coalesce(f.pratos, 0),
               'composto', (c.insumo_id is not null),
               'compras', coalesce(cp.vezes, 0),
               'ultima_compra', cp.ultima,
               'ultimo_preco', cp.ultimo_preco) order by i.nome)
        from public.insumos i
        left join fichas f on f.insumo_id = i.id
        left join compostos c on c.insumo_id = i.id
        left join compras cp on cp.insumo_id = i.id), '[]'::jsonb),
    'nao_insumo', coalesce((
      select jsonb_agg(jsonb_build_object('nome', n.nome_lido, 'vezes', n.vezes, 'ultima', n.ultima, 'centro', n.centro)
                       order by n.vezes desc, n.nome_lido)
        from nao n), '[]'::jsonb),
    'decisoes', coalesce((select jsonb_object_agg(chave, decisao) from public.cadastro_decisoes), '{}'::jsonb)
  ) into v;
  return v;
end;
$$;

revoke all on function public.cadastro_insumos_raio() from public, anon;
grant execute on function public.cadastro_insumos_raio() to authenticated;

-- 6. Juntar e lembrar -------------------------------------------------------------
-- Usa a juntar_insumos que já existe (aba Limpeza): ela leva ficha, estoque
-- e compras para o destino e apaga a origem. Antes disso, as regras de
-- embalagem passam para o destino; depois, o nome antigo vira sinônimo.
create or replace function public.juntar_e_lembrar(p_origem uuid, p_destino uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome_origem text;
  v_nome_destino text;
begin
  if auth.uid() is not null and not public.esta_aprovado() then
    raise exception 'sem_acesso';
  end if;
  if p_origem = p_destino then
    raise exception 'Escolha dois insumos diferentes.';
  end if;
  select nome into v_nome_origem from public.insumos where id = p_origem;
  select nome into v_nome_destino from public.insumos where id = p_destino;
  if v_nome_origem is null or v_nome_destino is null then
    raise exception 'Um dos insumos não existe mais.';
  end if;

  update public.produto_regras set insumo_id = p_destino where insumo_id = p_origem;

  perform public.juntar_insumos(p_origem, p_destino);

  if public.nome_chave(v_nome_origem) <> public.nome_chave(v_nome_destino)
     and not exists (select 1 from public.insumo_sinonimos s where lower(s.nome_variante) = lower(v_nome_origem)) then
    insert into public.insumo_sinonimos (nome_variante, insumo_id) values (v_nome_origem, p_destino);
  end if;
end;
$$;

revoke all on function public.juntar_e_lembrar(uuid, uuid) from public, anon;
grant execute on function public.juntar_e_lembrar(uuid, uuid) to authenticated;

-- 7. Histórico de preços --------------------------------------------------------
-- Uma linha por compra: a data é a da nota (ou a do lançamento, na compra
-- manual), e o preço é por unidade do insumo, já convertido.
create or replace function public.historico_precos(p_insumo uuid)
returns table (
  data         date,
  fornecedor   text,
  quantidade   numeric,
  preco        numeric,
  documento_id uuid,
  arquivo_path text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.esta_aprovado() then
    raise exception 'sem_acesso';
  end if;
  return query
  select coalesce(d.data_documento, m.criado_em::date),
         coalesce(nullif(trim(m.fornecedor), ''), d.fornecedor, '—'),
         m.quantidade,
         m.preco_unitario,
         d.id,
         d.arquivo_path
    from public.movimentacoes_estoque m
    left join public.documentos_compra d on d.id = m.documento_compra_id
   where m.insumo_id = p_insumo
     and m.tipo = 'compra'
     and coalesce(m.preco_unitario, 0) > 0
   order by 1 desc, m.criado_em desc;
end;
$$;

revoke all on function public.historico_precos(uuid) from public, anon;
grant execute on function public.historico_precos(uuid) to authenticated;

-- Por insumo comprado nos últimos p_dias: último preço contra a média de 90
-- dias ponderada pela quantidade, e o mais barato dos 90 dias.
create or replace function public.precos_em_alta(p_dias integer default 30)
returns table (
  insumo_id         uuid,
  nome              text,
  unidade           text,
  ultimo_preco      numeric,
  ultima_data       date,
  ultimo_fornecedor text,
  media_90d         numeric,
  variacao          numeric,
  menor_preco       numeric,
  menor_fornecedor  text,
  compras_90d       integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.esta_aprovado() then
    raise exception 'sem_acesso';
  end if;
  return query
  with c as (
    select m.insumo_id, m.quantidade, m.preco_unitario as preco, m.criado_em,
           coalesce(d.data_documento, m.criado_em::date) as dia,
           coalesce(nullif(trim(m.fornecedor), ''), d.fornecedor, '—') as forn
      from public.movimentacoes_estoque m
      left join public.documentos_compra d on d.id = m.documento_compra_id
     where m.tipo = 'compra' and coalesce(m.preco_unitario, 0) > 0
       and coalesce(d.data_documento, m.criado_em::date) >= current_date - 90
  ),
  ultima as (
    select distinct on (c.insumo_id) c.insumo_id, c.preco, c.dia, c.forn
      from c order by c.insumo_id, c.dia desc, c.criado_em desc
  ),
  menor as (
    select distinct on (c.insumo_id) c.insumo_id, c.preco, c.forn
      from c order by c.insumo_id, c.preco asc, c.dia desc
  ),
  media as (
    select c.insumo_id,
           sum(abs(c.quantidade) * c.preco) / nullif(sum(abs(c.quantidade)), 0) as media,
           count(*)::int as vezes
      from c group by c.insumo_id
  )
  select i.id, i.nome, i.unidade,
         u.preco, u.dia, u.forn,
         round(me.media, 4),
         case when me.media > 0 then round((u.preco / me.media - 1) * 100, 1) end,
         mn.preco, mn.forn,
         me.vezes
    from ultima u
    join public.insumos i on i.id = u.insumo_id
    join media me on me.insumo_id = u.insumo_id
    join menor mn on mn.insumo_id = u.insumo_id
   where u.dia >= current_date - p_dias
   order by 8 desc nulls last;
end;
$$;

revoke all on function public.precos_em_alta(integer) from public, anon;
grant execute on function public.precos_em_alta(integer) to authenticated;

-- Confere: quantos insumos ganharam tipo, e se a trava e a proteção entraram.
select (select count(*) from public.insumos)                          as insumos,
       (select count(*) from public.insumos where tipo is not null)    as com_tipo,
       (select count(*) from public.insumos where tipo is null)        as sem_tipo,
       exists (select 1 from pg_trigger where tgname = 'insumos_nome_unico') as trava_nome,
       (select confdeltype = 'r' from pg_constraint
         where conname = 'movimentacoes_estoque_insumo_id_fkey')       as compras_protegidas;
