-- 190_painel_operacao.sql — Mr Kong
--
-- Função do Dashboard → aba Operação. Junta, num só JSON, o que a tela
-- precisa para o período escolhido e para o período anterior de mesmo
-- tamanho:
--   * faturamento, pedidos e faturamento por noite
--   * faturamento por canal: Mesa, Delivery próprio, Retirada, iFood, Keeta
--   * cada cancelamento, separado em "interno" (teste, transferência,
--     duplicado, cadastro errado) e venda perdida de verdade
--   * cada checklist feito, se caiu no horário (entrada 17h–20h, saída
--     23h–04h) e os itens não conformes
--   * os setores que têm checklist cadastrado (para saber o esperado)
--
-- Tudo sai do cache de pedidos (pedidos_cache), que o robô grava de
-- madrugada. Não chama o CardápioWeb. A noite vale pelo dia em que abriu:
-- dia operacional = (hora de São Paulo − 5h)::date.
--
-- O faturamento por linha de produto NÃO está aqui: a tela usa a função
-- desempenho_linhas, que já existe (migração 079).
--
-- Só administrador consegue chamar: mostra quem lançou cada cancelamento.
-- Pode rodar de novo sem efeito.
-- Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

create or replace function public.painel_operacao(
  p_inicio date, p_fim date, p_inicio_ant date, p_fim_ant date
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  resultado jsonb;
begin
  if not public.is_admin() then
    raise exception 'Só administrador vê o painel da operação.';
  end if;

  with pedidos as (
    select c.status,
           coalesce(c.total, (c.payload->>'total')::numeric, 0) as valor,
           (coalesce((c.payload->>'created_at')::timestamptz, c.criado_em) at time zone 'America/Sao_Paulo') as hora_local,
           ((coalesce((c.payload->>'created_at')::timestamptz, c.criado_em) at time zone 'America/Sao_Paulo')
              - interval '5 hours')::date as noite,
           coalesce(c.payload->>'order_type', '') as tipo,
           coalesce(c.payload->>'sales_channel', '') as canal_cru,
           coalesce(c.payload#>>'{user,name}', '') as quem,
           nullif(trim(coalesce(c.payload->>'cancellation_reason', '')), '') as motivo
      from public.pedidos_cache c
     -- o campo dia do cache pode estar um dia antes ou depois da noite
     where c.dia between p_inicio_ant - 1 and p_fim + 1
  ),
  classificados as (
    select p.*,
           case
             when p.canal_cru ilike '%ifood%' then 'iFood'
             when p.canal_cru ilike '%keeta%' then 'Keeta'
             when p.tipo ilike '%deliver%' then 'Delivery próprio'
             when p.tipo ~* '(takeout|pickup|retirada)' then 'Retirada'
             else 'Mesa'
           end as canal,
           case when p.noite between p_inicio and p_fim then 'atual'
                when p.noite between p_inicio_ant and p_fim_ant then 'anterior'
           end as periodo
      from pedidos p
  ),
  fechados as (
    select * from classificados where status = 'closed' and periodo is not null
  ),
  resumo as (
    select f.periodo,
           jsonb_build_object(
             'faturamento', round(sum(f.valor), 2),
             'pedidos', count(*),
             'por_noite', (select jsonb_agg(jsonb_build_object('dia', n.noite, 'valor', n.valor) order by n.noite)
                             from (select noite, round(sum(valor), 2) as valor
                                     from fechados x where x.periodo = f.periodo group by noite) n),
             'por_canal', (select jsonb_agg(jsonb_build_object('canal', k.canal, 'valor', k.valor, 'pedidos', k.pedidos) order by k.valor desc)
                             from (select canal, round(sum(valor), 2) as valor, count(*) as pedidos
                                     from fechados x where x.periodo = f.periodo group by canal) k)
           ) as dados
      from fechados f
     group by f.periodo
  )
  select jsonb_build_object(
    'atual',    coalesce((select dados from resumo where periodo = 'atual'), '{}'::jsonb),
    'anterior', coalesce((select dados from resumo where periodo = 'anterior'), '{}'::jsonb),

    'cancelados', coalesce((
      select jsonb_agg(jsonb_build_object(
               'dia', c.noite,
               'hora', to_char(c.hora_local, 'HH24:MI'),
               'valor', round(c.valor, 2),
               'canal', c.canal,
               'tipo', c.tipo,
               'motivo', c.motivo,
               'quem', nullif(c.quem, ''),
               'interno', coalesce(c.motivo ~* '(teste|transferid|duplicad|duplicidade|cadastro errado)', false)
             ) order by c.hora_local)
        from classificados c
       where c.status <> 'closed' and c.periodo = 'atual'
    ), '[]'::jsonb),

    'cancelados_anterior', (
      select jsonb_build_object(
               'qtd', count(*) filter (where not coalesce(c.motivo ~* '(teste|transferid|duplicad|duplicidade|cadastro errado)', false)),
               'valor', coalesce(round(sum(c.valor) filter (where not coalesce(c.motivo ~* '(teste|transferid|duplicad|duplicidade|cadastro errado)', false)), 2), 0))
        from classificados c
       where c.status <> 'closed' and c.periodo = 'anterior'
    ),

    -- Noites com venda: é o que conta como "casa aberta" (pega segunda
    -- aberta em feriado e não cobra checklist de noite fechada).
    'noites', coalesce((
      select jsonb_agg(distinct f.noite) from fechados f where f.periodo = 'atual'
    ), '[]'::jsonb),

    'checklists', coalesce((
      select jsonb_agg(jsonb_build_object(
               'dia', r.dia_operacional,
               'setor', r.departamento,
               'etapa', r.etapa,
               'responsavel', r.responsavel,
               'quando', to_char(r.completado_em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'),
               'no_horario', case
                 when r.etapa = 'abertura' then
                   (r.completado_em at time zone 'America/Sao_Paulo') >= r.dia_operacional + time '17:00'
                   and (r.completado_em at time zone 'America/Sao_Paulo') < r.dia_operacional + time '20:00'
                 else
                   (r.completado_em at time zone 'America/Sao_Paulo') >= r.dia_operacional + time '23:00'
                   and (r.completado_em at time zone 'America/Sao_Paulo') < (r.dia_operacional + 1) + time '04:00'
               end,
               'nao_conformes', coalesce((
                 select jsonb_agg(jsonb_build_object('item', v.key, 'motivo', nullif(trim(coalesce(r.observacoes_itens->>v.key, '')), '')))
                   from jsonb_each(coalesce(r.itens, '{}'::jsonb)) v
                  where v.value #>> '{}' = 'nao_conforme'
               ), '[]'::jsonb)
             ) order by r.dia_operacional, r.departamento, r.etapa)
        from public.registros_checklist r
       where r.dia_operacional between p_inicio and p_fim
    ), '[]'::jsonb),

    'setores', coalesce((
      select jsonb_agg(jsonb_build_object(
               'chave', s.chave,
               'label', s.label,
               'abertura', exists (select 1 from public.checklist_itens i where i.departamento = s.chave and i.turno = 'abertura'),
               'fechamento', exists (select 1 from public.checklist_itens i where i.departamento = s.chave and i.turno = 'fechamento')
             ) order by s.ordem)
        from public.setores_estoque s
       where s.ativo
    ), '[]'::jsonb)
  ) into resultado;

  return resultado;
end;
$$;

revoke all on function public.painel_operacao(date, date, date, date) from public, anon;
grant execute on function public.painel_operacao(date, date, date, date) to authenticated;

-- Conferência: os últimos 30 dias contra os 30 anteriores.
-- No SQL Editor você entra como dono do banco, e não como administrador
-- do painel, por isso a conferência abaixo não chama a função: ela só
-- confirma que ela foi criada.
select 'função criada' as parte,
       p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as valor
  from pg_proc p
 where p.proname = 'painel_operacao';
