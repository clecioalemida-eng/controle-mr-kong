-- =====================================================================
-- 082_ficha_e_margem.sql
-- Painel Mr. Kong — ficha tecnica, margem pretendida e troca de insumo
--
-- Tres assuntos que andam juntos na mesma tela:
--
--   1. REVENDA x COMPOSICAO. Heineken se compra pronta e se vende
--      pronta; omelete e receita. Por baixo nao muda nada: revenda
--      grava UM insumo com quantidade 1, entao CMV, baixa de estoque e
--      DRE continuam iguais. O flag so diz o que a tela pede.
--
--   2. MARGEM PRETENDIDA em tres niveis: geral (65%), por linha de
--      produto, por prato. O mais especifico ganha. O preco sugerido e
--      custo / (1 - margem) — margem sobre o PRECO DE VENDA, nao markup
--      sobre o custo. Com 12,69 e 65%: 12,69 / 0,35 = R$ 36,26.
--      Usa o preco CHEIO, sem descontar Simples nem taxa de cartao.
--
--   3. SUBSTITUIR INSUMO nas fichas. Hoje a lixeira do insumo avisa
--      "esta em 1 ficha" e para por ai. A funcao troca em todas as
--      fichas de uma vez, somando quando o insumo novo ja esta no mesmo
--      prato (a chave e (prato_id, insumo_id): duas linhas iguais nao
--      cabem).
--
-- IDEMPOTENTE. Rodar depois da 052.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. Revenda x composicao
-- ---------------------------------------------------------------------
alter table public.pratos
  add column if not exists revenda boolean not null default false;

comment on column public.pratos.revenda is
  'true = comprado pronto e revendido (Heineken). false = receita com varios insumos.';


-- ---------------------------------------------------------------------
-- 2. Margem pretendida — os tres niveis
-- ---------------------------------------------------------------------
insert into public.dre_config (chave, valor, descricao) values
  ('margem_pretendida', 65,
   'Margem de contribuicao alvo, em % do preco de venda. Preco sugerido = custo / (1 - margem).')
on conflict (chave) do nothing;

alter table public.pratos
  add column if not exists margem_pretendida numeric
    check (margem_pretendida is null or (margem_pretendida >= 0 and margem_pretendida < 100));

comment on column public.pratos.margem_pretendida is
  'Margem so deste prato, em %. NULO = herda a linha; a linha herda a geral.';

create table if not exists public.linhas_margem (
  linha     text primary key,
  margem    numeric not null check (margem >= 0 and margem < 100),
  criado_em timestamptz not null default now()
);

comment on table public.linhas_margem is
  'Margem pretendida por linha de produto. Linha sem registro herda a margem geral.';

alter table public.linhas_margem enable row level security;

drop policy if exists "linhas_margem_select" on public.linhas_margem;
create policy "linhas_margem_select" on public.linhas_margem
  for select to authenticated using (public.esta_aprovado());

drop policy if exists "linhas_margem_admin" on public.linhas_margem;
create policy "linhas_margem_admin" on public.linhas_margem
  for all to authenticated using (public.is_admin()) with check (public.is_admin());


-- ---------------------------------------------------------------------
-- 3. Onde um insumo esta sendo usado
--
--    A tela mostra ANTES de perguntar qualquer coisa. Hoje o aviso diz
--    "1 ficha" e a pessoa abre prato por prato pra descobrir qual.
-- ---------------------------------------------------------------------
create or replace function public.fichas_do_insumo(p_insumo uuid)
returns table (
  prato_id   uuid,
  prato      text,
  quantidade numeric,
  unidade    text,
  custo      numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select pr.id, pr.nome, pi.quantidade, i.unidade,
         round(pi.quantidade * coalesce(i.custo_medio_atual, 0), 4)
  from public.prato_insumos pi
  join public.pratos  pr on pr.id = pi.prato_id
  join public.insumos i  on i.id  = pi.insumo_id
  where pi.insumo_id = p_insumo
  order by pr.nome;
$$;

grant execute on function public.fichas_do_insumo(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 4. Substituir o insumo em todas as fichas
--
--    p_quantidade:
--      NULO  = mantem a quantidade que ja estava (usar quando as duas
--              unidades sao iguais)
--      valor = grava esta quantidade em todas as fichas (usar quando a
--              unidade muda: 0,1 kg nao vira 0,1 un)
--
--    Se o insumo novo JA estiver no mesmo prato, as duas linhas viram
--    uma e as quantidades somam.
-- ---------------------------------------------------------------------
create or replace function public.substituir_insumo_nas_fichas(
  p_de         uuid,
  p_para       uuid,
  p_quantidade numeric default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fichas integer := 0;
  v_nome_de   text;
  v_nome_para text;
begin
  if not public.pode_editar('supply.fichas') and not public.is_admin() then
    raise exception 'Você não tem permissão para mexer nas fichas técnicas.';
  end if;

  if p_de = p_para then
    raise exception 'O insumo de origem e o de destino são o mesmo.';
  end if;

  select nome into v_nome_de   from public.insumos where id = p_de;
  select nome into v_nome_para from public.insumos where id = p_para;
  if v_nome_de is null or v_nome_para is null then
    raise exception 'Insumo não encontrado.';
  end if;

  select count(*) into v_fichas
    from public.prato_insumos where insumo_id = p_de;

  if v_fichas = 0 then
    return 0;
  end if;

  -- 1) pratos que JA tem o insumo novo: soma na linha que existe e
  --    apaga a antiga. Feito primeiro pra nao esbarrar na chave.
  update public.prato_insumos novo
     set quantidade = novo.quantidade
                    + coalesce(p_quantidade, velho.quantidade)
    from public.prato_insumos velho
   where velho.insumo_id = p_de
     and novo.insumo_id  = p_para
     and novo.prato_id   = velho.prato_id;

  delete from public.prato_insumos velho
   where velho.insumo_id = p_de
     and exists (
       select 1 from public.prato_insumos novo
        where novo.insumo_id = p_para
          and novo.prato_id  = velho.prato_id
     );

  -- 2) o resto: so troca o apontamento
  update public.prato_insumos
     set insumo_id  = p_para,
         quantidade = coalesce(p_quantidade, quantidade)
   where insumo_id = p_de;

  return v_fichas;
end;
$$;

comment on function public.substituir_insumo_nas_fichas(uuid, uuid, numeric) is
  'Troca um insumo por outro em todas as fichas tecnicas, somando quando o destino ja esta no mesmo prato.';

grant execute on function public.substituir_insumo_nas_fichas(uuid, uuid, numeric) to authenticated;


-- ---------------------------------------------------------------------
-- 5. Por que um insumo nao pode ser excluido
--
--    A tela chama isso depois da troca. Nota fiscal e movimentacao de
--    estoque sao HISTORIA: o que foi comprado naquele dia foi aquilo
--    mesmo. Reescrever mudaria o custo medio e o estoque passado — por
--    isso a substituicao nao toca nesses, e o insumo pode continuar
--    preso. Melhor dizer o motivo do que falhar calado.
-- ---------------------------------------------------------------------
create or replace function public.insumo_em_uso(p_insumo uuid)
returns table (
  fichas         integer,
  notas          integer,
  movimentacoes  integer,
  contagens      integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*) from public.prato_insumos         where insumo_id = p_insumo)::integer,
    (select count(*) from public.itens_documento_compra where insumo_id = p_insumo)::integer,
    (select count(*) from public.movimentacoes_estoque  where insumo_id = p_insumo)::integer,
    (select count(*) from public.contagens_itens        where insumo_id = p_insumo)::integer;
$$;

grant execute on function public.insumo_em_uso(uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 6. Verificacao
-- ---------------------------------------------------------------------
select 'margem geral' as bloco, valor from public.dre_config where chave = 'margem_pretendida';

select 'colunas novas' as bloco,
       count(*) filter (where column_name = 'revenda')           as tem_revenda,
       count(*) filter (where column_name = 'margem_pretendida') as tem_margem
from information_schema.columns
where table_schema = 'public' and table_name = 'pratos';

select 'linhas com margem propria' as bloco, count(*) from public.linhas_margem;
