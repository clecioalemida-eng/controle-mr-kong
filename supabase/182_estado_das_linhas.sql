-- 182_estado_das_linhas.sql — Mr Kong
-- Só leitura. Não muda nada no banco. Não lê token nenhum.
--
-- Para o agente responder nos dois números, cada conversa precisa saber por
-- qual linha entrou. A 064 criou wa_linhas e linha_id, mas a função
-- whatsapp-agente nunca passou a gravar esse campo. Esta consulta mostra:
--   1. as linhas cadastradas
--   2. se a coexistência já foi ligada, e com qual número
--   3. se a configuração da janela da Meta existe
--   4. quantas conversas e mensagens estão sem linha
--   5. se o mesmo telefone já tem conversa repetida
--
-- Onde rodar: Supabase → SQL Editor. Colar o resultado (CSV) na conversa.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

select '1. linha' as parte, nome as item,
       format('%s · %s · %s · ativa: %s', numero, tipo, estado, ativa) as valor
  from public.wa_linhas
union all
select '2. coexistência', 'conexão',
       format('ativa: %s · número: %s · conectada em: %s · histórico: %s · token gravado: %s',
              ativo, coalesce(numero, '—'), coalesce(conectado_em::text, '—'),
              coalesce(historico_status, '—'), token is not null)
  from public.wa_conexao
union all
select '3. janela da Meta', 'config_id cadastrado',
       (meta_config_id is not null)::text
  from public.agente_config where id = 1
union all
select '4. sem linha', 'conversas', format('%s de %s', count(*) filter (where linha_id is null), count(*))
  from public.wa_conversas
union all
select '4. sem linha', 'mensagens', format('%s de %s', count(*) filter (where linha_id is null), count(*))
  from public.wa_mensagens
union all
select '5. repetidas', 'telefones com mais de uma conversa', count(*)::text
  from (select telefone from public.wa_conversas group by telefone having count(*) > 1) x
order by 1, 2;
