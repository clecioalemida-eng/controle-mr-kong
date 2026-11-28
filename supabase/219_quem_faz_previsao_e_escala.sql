  -- 219_quem_faz_previsao_e_escala.sql — Mr Kong
  -- Quem faz o quê em Gente e Gestão:
  --   - Previsão de escala: a gerente (cargo Gerente) e os administradores
  --   - Escala do dia (ponto e premiação): SÓ administradores
  --
  -- Administrador (Clécio, Cristiane) passa por cima de qualquer permissão —
  -- não precisa de linha aqui. Então:
  --   1. gente.escala   → "nenhum" em TODOS os cargos
  --   2. gente.previsao → "editar" no cargo Gerente; "nenhum" nos demais
  --
  -- Atenção: se mais alguém tem o cargo Gerente (a Jackelyne, por exemplo),
  -- essa pessoa também faz a previsão. O resultado lista quem tem o cargo.
  --
  -- Pode rodar duas vezes. Onde rodar: Supabase → SQL Editor.
  
  do $trava$
  begin
    if to_regclass('public.pratos') is null then
      raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
    end if;
  end $trava$;
  
  -- 1. Escala do dia: ninguém além dos administradores.
  insert into public.cargo_permissoes as cp (cargo_id, chave, nivel)
  select c.id, 'gente.escala', 'nenhum' from public.cargos c
  on conflict (cargo_id, chave) do update set nivel = 'nenhum';
  
  -- 2. Previsão: só o cargo Gerente.
  insert into public.cargo_permissoes as cp (cargo_id, chave, nivel)
  select c.id, 'gente.previsao', case when c.nome ilike 'gerente' then 'editar' else 'nenhum' end
    from public.cargos c
  on conflict (cargo_id, chave) do update set nivel = excluded.nivel;
  
  -- Conferência --------------------------------------------------------------
  select '1. permissão' as parte, c.nome as cargo,
         string_agg(cp.chave || ': ' || cp.nivel, ' · ' order by cp.chave) as valor
    from public.cargos c
    join public.cargo_permissoes cp on cp.cargo_id = c.id and cp.chave in ('gente.escala', 'gente.previsao')
   group by c.nome
  union all
  select '2. quem faz a previsão', coalesce(p.nome, '(sem nome)'),
         case when p.is_admin then 'administrador' else coalesce(c.nome, 'sem cargo') end
    from public.perfis p
    left join public.cargos c on c.id = p.cargo_id
   where p.status = 'aprovado' and (p.is_admin or c.nome ilike 'gerente')
  order by 1, 2;
