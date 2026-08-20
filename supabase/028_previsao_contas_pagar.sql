-- Execute depois do 027_checklist_editavel.sql.
-- Três coisas novas: Previsão de Escala (planejamento futuro, sem
-- cálculo), Contas a Pagar (gerado ao confirmar nota, com condição de
-- pagamento e pagamento parcial).

-- Previsão de escala: só marca quem está previsto pra trabalhar num dia
-- futuro, sem nenhum valor — vira ponto de partida quando o dia chegar
-- na Escala do dia de verdade.
create table if not exists public.previsoes_escala (
  id uuid primary key default gen_random_uuid(),
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  dia date not null,
  criado_em timestamptz not null default now(),
  unique (pessoa_id, dia)
);
alter table public.previsoes_escala enable row level security;
drop policy if exists "aprovados leem previsoes_escala" on public.previsoes_escala;
create policy "aprovados leem previsoes_escala" on public.previsoes_escala for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam previsoes_escala" on public.previsoes_escala;
create policy "aprovados gerenciam previsoes_escala" on public.previsoes_escala for all using (public.esta_aprovado()) with check (public.esta_aprovado());

-- Contas a pagar: gerada ao confirmar uma nota fiscal (ou criada na mão).
create table if not exists public.contas_pagar (
  id uuid primary key default gen_random_uuid(),
  documento_compra_id uuid references public.documentos_compra(id) on delete set null,
  fornecedor_id uuid references public.fornecedores(id),
  fornecedor_nome text,
  descricao text,
  valor_total numeric not null default 0,
  condicao_pagamento text, -- 'a_vista' | '7_dias' | '14_dias' | '21_dias' | '28_dias' | 'outro'
  data_vencimento date,
  valor_pago numeric not null default 0,
  status text not null default 'pendente' check (status in ('pendente', 'parcial', 'pago')),
  criado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id)
);
alter table public.contas_pagar enable row level security;
drop policy if exists "aprovados leem contas_pagar" on public.contas_pagar;
create policy "aprovados leem contas_pagar" on public.contas_pagar for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam contas_pagar" on public.contas_pagar;
create policy "aprovados gerenciam contas_pagar" on public.contas_pagar for all using (public.esta_aprovado()) with check (public.esta_aprovado());

-- Pagamentos parciais de uma conta a pagar — cada linha é um pagamento
-- feito; a soma dá o valor_pago da conta.
create table if not exists public.pagamentos_conta (
  id uuid primary key default gen_random_uuid(),
  conta_pagar_id uuid not null references public.contas_pagar(id) on delete cascade,
  valor numeric not null,
  data_pagamento date not null,
  observacao text,
  criado_em timestamptz not null default now(),
  criado_por uuid references auth.users(id)
);
alter table public.pagamentos_conta enable row level security;
drop policy if exists "aprovados leem pagamentos_conta" on public.pagamentos_conta;
create policy "aprovados leem pagamentos_conta" on public.pagamentos_conta for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam pagamentos_conta" on public.pagamentos_conta;
create policy "aprovados gerenciam pagamentos_conta" on public.pagamentos_conta for all using (public.esta_aprovado()) with check (public.esta_aprovado());
