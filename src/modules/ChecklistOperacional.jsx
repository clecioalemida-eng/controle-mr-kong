-- =====================================================================
-- 067_lista_de_compra.sql
-- Painel Mr. Kong — a lista de compra que sai da contagem
--
-- A contagem so vale se virar decisao. Esta funcao pega o que foi
-- contado no dia e devolve o que precisa comprar, com quanto comprar.
--
-- Duas coisas entram na lista:
--   1. quem esta ABAIXO DO MINIMO  -> sugere minimo - saldo
--   2. quem foi contado como ZERO  -> acabou, entra mesmo sem minimo
--      cadastrado (o minimo e opcional, e quase ninguem preenche todos)
--
-- O saldo usado e o CONTADO do dia. So cai pro estoque do sistema quem
-- ainda nao foi contado — assim a lista melhora conforme o pessoal conta,
-- em vez de depender de um saldo teorico que ninguem confere.
--
-- Insumo em dois setores aparece UMA vez, com os dois setores no nome.
-- Senao o gerente compra em dobro.
--
-- IDEMPOTENTE. Rodar depois da 066.
-- =====================================================================

create or replace function public.lista_de_compra(
  p_dia   date,
  p_setor text default null
)
returns table (
  insumo_id  uuid,
  nome       text,
  unidade    text,
  setores    text,
  saldo      numeric,
  minimo     numeric,
  sugestao   numeric,
  custo      numeric,
  valor      numeric,
  contado    boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      i.id,
      i.nome,
      i.unidade,
      coalesce(i.estoque_minimo, 0)     as minimo,
      coalesce(i.custo_medio_atual, 0)  as custo,
      -- contagem do dia, se existir, em qualquer setor do insumo
      (select ci.quantidade
         from public.contagens_itens ci
         join public.contagens_estoque c on c.id = ci.contagem_id
        where ci.insumo_id = i.id
          and c.dia = p_dia
          and ci.quantidade is not null
        order by ci.contado_em desc
        limit 1)                        as contado,
      coalesce(i.estoque_atual, 0)      as sistema,
      (select string_agg(e.label, ' · ' order by e.ordem)
         from public.insumo_setores s
         join public.setores_estoque e on e.chave = s.setor
        where s.insumo_id = i.id)       as setores
    from public.insumos i
   where public.esta_aprovado()
     and (p_setor is null or exists (
           select 1 from public.insumo_setores s
            where s.insumo_id = i.id and s.setor = p_setor))
  ),
  calc as (
    select
      b.*,
      coalesce(b.contado, b.sistema) as saldo
    from base b
  )
  select
    c.id,
    c.nome,
    c.unidade,
    coalesce(c.setores, '—'),
    c.saldo,
    c.minimo,
    case
      when c.minimo > 0 and c.saldo < c.minimo then round(c.minimo - c.saldo, 3)
      else null
    end,
    c.custo,
    case
      when c.minimo > 0 and c.saldo < c.minimo then round((c.minimo - c.saldo) * c.custo, 2)
      else null
    end,
    (c.contado is not null)
  from calc c
 where (c.minimo > 0 and c.saldo < c.minimo)     -- abaixo do minimo
    or (c.contado is not null and c.contado = 0) -- contado e acabou
 order by (c.contado is null), public.chave_nome(c.nome);
$$;

grant execute on function public.lista_de_compra(date, text) to authenticated;


-- ---------------------------------------------------------------------
-- Quem pode ver a lista de compra
--
--    A tela pergunta isto antes de mostrar o icone. Administrador sempre
--    pode; os outros dependem da permissao de supply.
-- ---------------------------------------------------------------------
create or replace function public.pode_ver_compras()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin()
      or coalesce(public.nivel_acesso('supply.insumos'), 'nenhum') <> 'nenhum'
      or coalesce(public.nivel_acesso('supply.compras'), 'nenhum') <> 'nenhum';
$$;

grant execute on function public.pode_ver_compras() to authenticated;


-- ---------------------------------------------------------------------
-- Confere
-- ---------------------------------------------------------------------
select count(*) as itens_na_lista_de_hoje
  from public.lista_de_compra(current_date, null);
