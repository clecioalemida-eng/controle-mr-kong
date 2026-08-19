-- Execute depois do 020_repasse_entregador.sql.
-- Reestrutura a remuneração da equipe:
--
-- - Diarista: agora tem DOIS jeitos de calcular o dia (base+comissão, ou
--   hora trabalhada), e vale o MAIOR dos dois. Os valores de referência
--   (diária base e valor da hora) não são mais digitados pessoa por
--   pessoa — vêm de uma matriz por CARGO (matriz_cargos), aplicada
--   automaticamente.
-- - Registrado: ganha salário base INDIVIDUAL (cada um o seu, diferente
--   da matriz de diarista) + comissão acumulada do mês.
-- - Novo cargo "gerente": não participa da divisão diária de comissão —
--   ganha salário base + 2% do faturamento bruto do mês, calculado só no
--   fechamento mensal.

alter table public.pessoas drop constraint if exists pessoas_papel_check;
alter table public.pessoas add constraint pessoas_papel_check
  check (papel in ('garcom', 'interno', 'caixa', 'bar', 'chapa', 'cozinha', 'limpeza', 'gerente'));

alter table public.pessoas add column if not exists salario_base numeric; -- registrado (não-gerente): salário individual; gerente: salário base fixo, some 2% por cima

create table if not exists public.matriz_cargos (
  papel text primary key,
  diaria_base numeric not null default 0,
  valor_hora numeric not null default 0
);

insert into public.matriz_cargos (papel) values
  ('garcom'), ('caixa'), ('bar'), ('chapa'), ('cozinha'), ('limpeza')
on conflict (papel) do nothing;

alter table public.matriz_cargos enable row level security;
drop policy if exists "aprovados leem matriz" on public.matriz_cargos;
create policy "aprovados leem matriz" on public.matriz_cargos for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam matriz" on public.matriz_cargos;
create policy "aprovados gerenciam matriz" on public.matriz_cargos for all using (public.esta_aprovado()) with check (public.esta_aprovado());

-- Horas trabalhadas no dia, separado do peso (peso continua sendo usado
-- só pra dividir a comissão; horas alimenta o método por hora).
alter table public.presencas_diarias add column if not exists horas_trabalhadas numeric not null default 0;

-- Registra qual dos dois métodos "ganhou" naquele dia, pra dar
-- transparência no extrato depois (não é usado no cálculo em si).
alter table public.premiacoes_diarias add column if not exists metodo_usado text; -- 'comissao' | 'hora'
alter table public.premiacoes_diarias add column if not exists valor_metodo_comissao numeric;
alter table public.premiacoes_diarias add column if not exists valor_metodo_hora numeric;

-- Faturamento bruto mensal, usado no cálculo da gerente — buscado do
-- CardápioWeb e guardado aqui pra não precisar buscar de novo toda vez
-- que a tela de fechamento mensal for aberta.
create table if not exists public.faturamento_mensal (
  mes_referencia text primary key, -- formato "YYYY-MM"
  faturamento_bruto numeric not null default 0,
  atualizado_em timestamptz not null default now()
);
alter table public.faturamento_mensal enable row level security;
drop policy if exists "aprovados leem faturamento_mensal" on public.faturamento_mensal;
create policy "aprovados leem faturamento_mensal" on public.faturamento_mensal for select using (public.esta_aprovado());
drop policy if exists "aprovados gerenciam faturamento_mensal" on public.faturamento_mensal;
create policy "aprovados gerenciam faturamento_mensal" on public.faturamento_mensal for all using (public.esta_aprovado()) with check (public.esta_aprovado());
