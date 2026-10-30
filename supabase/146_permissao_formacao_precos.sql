-- ===========================================================================
-- 146 — Permissão da nova aba "Formação de preços" (Financeiro)
--
-- A tela nova nasce invisível: a chave financeiro.precos não existe em
-- cargo_permissoes, e o que não existe lá vale "nenhum". Então quem tem
-- acesso ao DRE — que é a mesma informação de custo e margem, só olhada de
-- outro ângulo — recebe o mesmo nível aqui. Ninguém ganha acesso novo: a
-- lista de quem vê custo continua exatamente a mesma de ontem.
-- ===========================================================================

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong. Abra o projeto mr kong e rode de novo.';
  end if;
end $trava$;

insert into public.cargo_permissoes (cargo_id, chave, nivel)
select cp.cargo_id, 'financeiro.precos', cp.nivel
  from public.cargo_permissoes cp
 where cp.chave = 'financeiro.dre'
   and cp.nivel in ('ver', 'editar')
on conflict (cargo_id, chave) do update set nivel = excluded.nivel;

-- conferência: quem passa a ver a formação de preços
select c.nome as cargo, cp.nivel
  from public.cargo_permissoes cp
  join public.cargos c on c.id = cp.cargo_id
 where cp.chave = 'financeiro.precos'
 order by c.nome;
