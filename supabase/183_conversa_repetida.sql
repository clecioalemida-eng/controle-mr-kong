-- 183_conversa_repetida.sql — Mr Kong
-- Só leitura. Não muda nada no banco.
--
-- A próxima migração coloca todas as conversas sem linha na linha oficial e
-- volta a impedir conversa repetida. Antes disso, as repetidas precisam ser
-- juntadas, e juntar exige saber o que aponta para elas. Esta consulta mostra:
--   1. cada conversa repetida: quando abriu, quantas mensagens tem, situação.
--      O telefone aparece só com os 4 últimos dígitos, e sem nome nem texto.
--   2. todas as tabelas com chave estrangeira para wa_conversas
--
-- Onde rodar: Supabase → SQL Editor. Colar o resultado (CSV) na conversa.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

with repetidas as (
  select c.*
    from public.wa_conversas c
   where c.telefone in (select telefone from public.wa_conversas group by telefone having count(*) > 1)
)
select '1. conversa'::text as parte,
       '…' || right(r.telefone, 4) as item,
       format('id %s · linha: %s · situação: %s · última msg: %s · %s mensagens',
              r.id, coalesce(r.linha_id::text, 'sem linha'), r.status, coalesce(r.ultima_msg_em::text, '—'),
              (select count(*) from public.wa_mensagens m where m.conversa_id = r.id)) as valor
  from repetidas r
union all
select '2. aponta para wa_conversas',
       con.conrelid::regclass::text,
       format('%s · ao apagar: %s', con.conname,
              case con.confdeltype when 'a' then 'bloqueia' when 'r' then 'bloqueia'
                                   when 'c' then 'apaga junto' when 'n' then 'fica vazio' else con.confdeltype::text end)
  from pg_constraint con
 where con.contype = 'f'
   and con.confrelid = 'public.wa_conversas'::regclass
order by 1, 2, 3;
