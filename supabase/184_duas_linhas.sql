-- 184_duas_linhas.sql — Mr Kong
--
-- Prepara o CRM para responder em duas linhas de WhatsApp: a oficial, só na
-- API, e a do balcão, em coexistência (app no celular, ligações no celular).
--
-- A 064 trocou "uma conversa por telefone" por "uma por telefone e linha",
-- mas a whatsapp-agente nunca passou a gravar a linha. Sem linha, o banco não
-- barra repetição: em 01/11/2026 um telefone abriu 7 conversas em meia hora.
--
-- O que esta migração faz, nesta ordem:
--   1. corrige as linhas: número da oficial e tipo da do balcão
--   2. cria o liga/desliga do agente por linha e o id do número na Meta
--   3. junta as conversas repetidas. Nenhuma mensagem é apagada: elas vão para
--      a conversa mais recente, e só as conversas que ficaram vazias saem.
--   4. coloca na oficial o que está sem linha (era o único número em uso)
--   5. deixa a oficial como padrão, e por isso o agente de hoje continua
--      funcionando até a função nova ser instalada
--
-- O balcão NÃO é ligado aqui: isso só acontece ao conectar na tela do CRM.
-- Pode rodar de novo sem efeito.
-- Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

-- 1 e 2. As linhas ---------------------------------------------------------
alter table public.wa_linhas drop constraint if exists wa_linhas_tipo_check;
alter table public.wa_linhas add constraint wa_linhas_tipo_check
  check (tipo in ('oficial', 'qr', 'coexistencia'));
alter table public.wa_linhas drop constraint if exists wa_linhas_qr_tem_instancia;
alter table public.wa_linhas add constraint wa_linhas_qr_tem_instancia
  check (tipo <> 'qr' or instancia is not null);

alter table public.wa_linhas add column if not exists phone_number_id text;
alter table public.wa_linhas add column if not exists agente_ligado boolean not null default true;
create unique index if not exists wa_linhas_phone_number_id on public.wa_linhas (phone_number_id);

update public.wa_linhas
   set nome = 'Oficial', numero = '5564992468524', phone_number_id = '1335888422936789'
 where tipo = 'oficial';

update public.wa_linhas
   set tipo = 'coexistencia', instancia = null
 where numero = '5564992667645' and tipo = 'qr';

-- 3. Conversas repetidas ---------------------------------------------------
-- Sem linha conta como oficial, porque é para lá que elas vão no passo 4.
do $$
declare
  oficial uuid := (select id from public.wa_linhas where tipo = 'oficial' limit 1);
  g record;
  fica uuid;
begin
  if oficial is null then raise exception 'Linha oficial não encontrada.'; end if;

  for g in
    select telefone, coalesce(linha_id, oficial) as linha
      from public.wa_conversas
     group by 1, 2
    having count(*) > 1
  loop
    -- Fica a conversa com a mensagem mais recente.
    select id into fica from public.wa_conversas
     where telefone = g.telefone and coalesce(linha_id, oficial) = g.linha
     order by ultima_msg_em desc nulls last, id
     limit 1;

    -- Junta o resumo antes de mover: atendente assumindo vale mais que agente.
    update public.wa_conversas f set
      ultima_msg_cliente_em = (select max(x.ultima_msg_cliente_em) from public.wa_conversas x
                                where x.telefone = g.telefone and coalesce(x.linha_id, oficial) = g.linha),
      nao_lidas = (select coalesce(sum(x.nao_lidas), 0) from public.wa_conversas x
                    where x.telefone = g.telefone and coalesce(x.linha_id, oficial) = g.linha),
      status = case when exists (select 1 from public.wa_conversas x
                                  where x.telefone = g.telefone and coalesce(x.linha_id, oficial) = g.linha
                                    and x.status = 'atendente') then 'atendente' else f.status end
     where f.id = fica;

    update public.wa_mensagens m set conversa_id = fica
      from public.wa_conversas x
     where m.conversa_id = x.id and x.id <> fica
       and x.telefone = g.telefone and coalesce(x.linha_id, oficial) = g.linha;
    update public.agente_sugestoes s set conversa_id = fica
      from public.wa_conversas x
     where s.conversa_id = x.id and x.id <> fica
       and x.telefone = g.telefone and coalesce(x.linha_id, oficial) = g.linha;
    update public.crm_avaliacao_pedidos a set conversa_id = fica
      from public.wa_conversas x
     where a.conversa_id = x.id and x.id <> fica
       and x.telefone = g.telefone and coalesce(x.linha_id, oficial) = g.linha;

    -- Só apaga o que ficou sem nenhuma mensagem.
    delete from public.wa_conversas x
     where x.id <> fica and x.telefone = g.telefone and coalesce(x.linha_id, oficial) = g.linha
       and not exists (select 1 from public.wa_mensagens m where m.conversa_id = x.id);
  end loop;

  -- 4. O que está sem linha --------------------------------------------------
  update public.wa_conversas set linha_id = oficial where linha_id is null;
  update public.wa_mensagens m set linha_id = c.linha_id
    from public.wa_conversas c
   where m.conversa_id = c.id and m.linha_id is null;

  -- 5. Oficial como padrão ---------------------------------------------------
  execute format('alter table public.wa_conversas alter column linha_id set default %L', oficial);
  execute format('alter table public.wa_mensagens alter column linha_id set default %L', oficial);
end $$;

-- Confere: linhas certas, sem nada sem linha e sem telefone repetido na linha.
select 'linha' as parte, nome as item,
       format('%s · %s · %s · agente: %s', numero, tipo, estado, agente_ligado) as valor
  from public.wa_linhas
union all
select 'sem linha', 'conversas', count(*)::text from public.wa_conversas where linha_id is null
union all
select 'sem linha', 'mensagens', count(*)::text from public.wa_mensagens where linha_id is null
union all
select 'repetidas', 'telefone e linha', count(*)::text
  from (select telefone, linha_id from public.wa_conversas group by 1, 2 having count(*) > 1) x
order by 1, 2;
