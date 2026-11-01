-- 176_precos_canais.sql — Mr Kong
--
-- Guarda a margem e a entrega de cada aplicativo, usadas na Tabela de
-- preços (Financeiro → Formação de preços). Os dois percentuais valem
-- sobre o preço final no aplicativo:
--
--   preço no app = preço ÷ (1 − margem − entrega)
--
-- É só a configuração da conta. Não muda preço de prato nenhum, nem no
-- painel, nem no iFood, nem na Keeta.
--
-- Os valores iniciais são um ponto de partida: 20% é o que a tela já usava
-- para o iFood. Os reais são digitados na própria tabela. Rodar de novo não
-- apaga o que foi digitado.
--
-- Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

create table if not exists public.precos_canais (
  canal         text primary key check (canal in ('ifood', 'keeta')),
  margem_pct    numeric not null default 0 check (margem_pct >= 0),
  entrega_pct   numeric not null default 0 check (entrega_pct >= 0),
  atualizado_em timestamptz not null default now(),
  -- Em 100% a conta divide por zero. A tela usa o mesmo limite de 90%.
  constraint precos_canais_soma_chk check (margem_pct + entrega_pct <= 90)
);

alter table public.precos_canais enable row level security;
drop policy if exists "aprovados leem precos_canais" on public.precos_canais;
create policy "aprovados leem precos_canais" on public.precos_canais
  for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam precos_canais" on public.precos_canais;
create policy "aprovados gerenciam precos_canais" on public.precos_canais
  for all using (public.esta_aprovado()) with check (public.esta_aprovado());

insert into public.precos_canais (canal, margem_pct, entrega_pct)
values ('ifood', 20, 0), ('keeta', 20, 0)
on conflict (canal) do nothing;

-- Confere: duas linhas, ifood e keeta.
select canal, margem_pct, entrega_pct from public.precos_canais order by canal;
