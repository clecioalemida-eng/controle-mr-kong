-- ===========================================================================
-- 171 — "Não é insumo": item de nota que vai para despesa, não para estoque
--
-- A conferência da nota só deixava confirmar com TODO item vinculado a um
-- insumo. Nota tem desinfetante, compressor, caneta, desconto, Pix — e
-- nada disso é insumo. Resultado medido em 29/10 (consultas 166 a 170):
--
--   - 68 notas paradas, R$ 31.022,83 fora do estoque, do custo e do DRE;
--   - utensílio e material de escritório cadastrados como insumo
--     (cortador de legumes, bloco de recibo, abafador) só para destravar;
--   - um sinônimo ensinando que "Transferência Pix" é "abafador inox para
--     hambúrguer" — toda nota com Pix passou a entrar vinculada nele.
--
-- Esta migração:
--
--   1. Cria itens_documento_compra.despesa_centro. Vazio = item comum, vai
--      para o estoque. Preenchido = não é insumo, e diz para qual centro
--      de custo o valor vai (os mesmos de Contas a Pagar).
--   2. Cria nomes_nao_insumo: o nome lido que você marcou como "nunca é
--      insumo". A leitura da próxima nota já chega com ele resolvido.
--   3. Apaga o sinônimo "Transferência Pix" → abafador.
--
-- Rodar antes de colar o NotasFiscais.jsx novo e a Edge Function nova.
-- Pode rodar duas vezes sem dano.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

-- 1. O destino do item que não é insumo -----------------------------------
--
-- 'nao_produto' é desconto, Pix, linha de pagamento: não é custo de nada,
-- só acerta o total pago. Os outros são centros de custo de Contas a Pagar.
alter table public.itens_documento_compra
  add column if not exists despesa_centro text;

alter table public.itens_documento_compra
  drop constraint if exists itens_documento_despesa_centro_chk;
alter table public.itens_documento_compra
  add constraint itens_documento_despesa_centro_chk
  check (despesa_centro is null
         or despesa_centro in ('utensilios', 'manutencao', 'imobilizado',
                               'administrativo', 'pessoas', 'nao_produto'));

-- 2. Nomes que nunca são insumo --------------------------------------------
create table if not exists public.nomes_nao_insumo (
  id uuid primary key default gen_random_uuid(),
  nome_variante text not null,
  despesa_centro text not null check (despesa_centro in ('utensilios', 'manutencao', 'imobilizado',
                                                         'administrativo', 'pessoas', 'nao_produto')),
  criado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id)
);

create unique index if not exists nomes_nao_insumo_nome_unq
  on public.nomes_nao_insumo (lower(nome_variante));

alter table public.nomes_nao_insumo enable row level security;
drop policy if exists "aprovados leem nomes_nao_insumo" on public.nomes_nao_insumo;
create policy "aprovados leem nomes_nao_insumo" on public.nomes_nao_insumo
  for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam nomes_nao_insumo" on public.nomes_nao_insumo;
create policy "aprovados gerenciam nomes_nao_insumo" on public.nomes_nao_insumo
  for all using (public.esta_aprovado()) with check (public.esta_aprovado());

-- 3. O sinônimo errado do Pix ----------------------------------------------
--
-- Só os sinônimos de "transferência pix" (com ou sem acento). Os itens que
-- já foram vinculados por causa dele em nota PARADA são soltos, para você
-- decidir de novo na tela. Nota já confirmada não é tocada.
update public.itens_documento_compra it
   set insumo_id = null
  from public.documentos_compra d, public.insumo_sinonimos s
 where d.id = it.documento_id
   and d.status <> 'confirmado'
   and s.insumo_id = it.insumo_id
   and lower(translate(s.nome_variante, 'êé', 'ee')) like 'transferencia%pix%'
   and lower(translate(it.nome_lido, 'êé', 'ee')) like 'transferencia%pix%';

delete from public.insumo_sinonimos
 where lower(translate(nome_variante, 'êé', 'ee')) like 'transferencia%pix%';

-- Conferência ---------------------------------------------------------------
-- Esperado: coluna_criada = sim, tabela_criada = sim, sinonimos_pix_restantes = 0.
select
  case when exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'itens_documento_compra'
                       and column_name = 'despesa_centro') then 'sim' else 'NÃO' end as coluna_criada,
  case when to_regclass('public.nomes_nao_insumo') is not null then 'sim' else 'NÃO' end as tabela_criada,
  (select count(*) from public.insumo_sinonimos
    where lower(translate(nome_variante, 'êé', 'ee')) like 'transferencia%pix%') as sinonimos_pix_restantes,
  (select count(*) from public.nomes_nao_insumo) as nomes_ja_lembrados;
