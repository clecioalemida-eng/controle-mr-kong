-- Execute depois do 030_backfill_contas_pagar.sql.
-- Centro de custo em cada conta (Pessoas, Insumos, Utensilios,
-- Consertos e manutencao, Imobilizado, Ocupacao, Utilidades, Impostos e
-- taxas, Marketing e vendas, Administrativo) -- fica em branco pra
-- contas ja existentes, que precisam ser revisadas manualmente. Tambem
-- liga uma conta a pagar de compra manual (sem nota) a movimentacao de
-- estoque que ela gerou, pra sincronizar a forma de pagamento nos dois
-- lugares quando editar em qualquer um.

alter table public.contas_pagar add column if not exists centro_custo text;
-- valores esperados: 'pessoas' | 'insumos' | 'utensilios' | 'manutencao' |
-- 'imobilizado' | 'ocupacao' | 'utilidades' | 'impostos' | 'marketing' |
-- 'administrativo' | null (pendente de classificar)

alter table public.contas_pagar add column if not exists movimentacao_estoque_id uuid references public.movimentacoes_estoque(id) on delete set null;
