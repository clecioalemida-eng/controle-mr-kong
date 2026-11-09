-- 189_setor_espetinho.sql — Mr Kong
--
-- Acrescenta o setor Espetinho. É o mesmo cadastro (setores_estoque) que
-- o Checklist, o estoque e o Desempenho usam, então ele aparece nos três.
-- No Desempenho entra como estação (`estacao = true`): conta no tempo por
-- setor e nas combinações.
--
-- Também põe no Espetinho os pratos com "espet" no nome. O resultado
-- mostra o setor que cada um tinha antes, para conferir. Prato de
-- espetinho com outro nome se marca à mão em Desempenho → Produtos e
-- setores.
--
-- Pode rodar de novo sem efeito.
-- Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

insert into public.setores_estoque (chave, label, ordem, ativo, estacao)
select 'espetinho', 'Espetinho', coalesce(max(ordem), 0) + 1, true, true
  from public.setores_estoque
 where not exists (select 1 from public.setores_estoque where chave = 'espetinho');

update public.setores_estoque set ativo = true, estacao = true where chave = 'espetinho';

-- Guarda o setor antigo antes de trocar, só para a conferência abaixo.
drop table if exists espetinho_antes;
create temp table espetinho_antes as
select id, nome, setor as setor_antes from public.pratos
 where nome ilike '%espet%' and coalesce(setor, '') <> 'espetinho';

update public.pratos set setor = 'espetinho'
 where nome ilike '%espet%' and coalesce(setor, '') <> 'espetinho';

select '1. setor' as parte, chave as item,
       format('%s · ordem %s · ativo %s · estação %s', label, ordem, ativo, estacao) as valor
  from public.setores_estoque where chave = 'espetinho'
union all
select '2. prato movido', nome, format('antes: %s', coalesce(setor_antes, 'sem setor'))
  from espetinho_antes
union all
select '3. pratos no espetinho', count(*)::text, string_agg(nome, ', ' order by nome)
  from public.pratos where setor = 'espetinho'
order by 1, 2;
