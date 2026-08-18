-- Execute depois do 014_equipe_premiacao.sql.
-- Adiciona os cargos Caixa, Bar, Chapa e Cozinha, além do Garçom que já
-- existia. Mantém "interno" como valor válido (não quebra pessoas já
-- cadastradas com esse cargo genérico antes), mas a tela agora sempre usa
-- um dos cargos específicos para gente nova. Pra cálculo da premiação,
-- continua a mesma regra: só "garcom" fica no bolo dos garçons — todos os
-- outros cargos (incluindo o "interno" antigo) caem juntos no bolo da
-- equipe interna.

alter table public.pessoas drop constraint if exists pessoas_papel_check;
alter table public.pessoas add constraint pessoas_papel_check
  check (papel in ('garcom', 'interno', 'caixa', 'bar', 'chapa', 'cozinha'));
