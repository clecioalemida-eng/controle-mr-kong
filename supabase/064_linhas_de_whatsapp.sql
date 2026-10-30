-- 064_linhas_de_whatsapp.sql
--
-- O painel passa a ter DUAS linhas de WhatsApp:
--
--   (64) 99201-0442  oficial  registrada na Meta, não toca em celular,
--                             é a dos anúncios e do agente automático.
--   (64) 99266-7645  balcão   continua tocando no celular; o painel entra
--                             como aparelho conectado, por QR code.
--
-- CORREÇÃO (30/10/2026) — o número oficial acima está ERRADO:
--
--   - O agente roda no (64) 99246-8524 (API da Meta desde 22/09/2026),
--     confirmado por "Testar ligação com a Meta" e no Business Manager
--     (Conectado, qualidade Alta).
--   - O (64) 99201-0442 está no portfólio, mas também existe num app de
--     WhatsApp em algum celular (o Facebook o aceita para vincular à
--     Página), então "não toca em celular" não confere. Em 30/10 ninguém
--     sabia onde está esse aparelho.
--
-- Esta migração já rodou, e a linha 'Pedidos · Meta' foi gravada no banco
-- com 5564992010442. O texto fica como estava, por ser o registro do que
-- foi executado; o dado em wa_linhas precisa de correção à parte.
-- Ver docs/marketing-resumo-2026-10-30.md.
--
-- Por que isto é uma migração e não só uma tela: hoje `wa_conversas` não
-- guarda por onde a conversa entrou, porque só existia uma porta. Com duas,
-- uma resposta pode sair pela linha errada — o cliente que falou com o
-- balcão receberia do número dos anúncios, e nem saberia quem é.
-- Cada conversa e cada mensagem passam a dizer de qual linha vieram.
--
-- Onde rodar: Supabase → SQL Editor.

-- ---------------------------------------------------------------------
-- 1. As linhas
-- ---------------------------------------------------------------------
create table if not exists public.wa_linhas (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  numero      text not null unique
              check (numero ~ '^55\d{10,11}$'),
  -- oficial = API da Meta (Cloud API). qr = conexão por código, não oficial.
  tipo        text not null check (tipo in ('oficial', 'qr')),

  -- Só para a linha de QR: o nome da sessão no servidor que segura a conexão.
  instancia   text unique,

  -- O que a tela mostra no selo.
  estado      text not null default 'desconectada'
              check (estado in ('conectada', 'aguardando', 'desconectada', 'erro')),
  estado_em   timestamptz not null default now(),
  detalhe     text,

  -- Linha desligada some da tela sem perder o histórico das conversas.
  ativa       boolean not null default true,
  criada_em   timestamptz not null default now(),

  -- O servidor de QR code tem endereço e chave. Ficam nos secrets da Edge
  -- Function, nunca aqui: esta tabela é lida pela tela, e tela é público.
  constraint wa_linhas_qr_tem_instancia
    check (tipo = 'oficial' or instancia is not null)
);

alter table public.wa_linhas enable row level security;

drop policy if exists wa_linhas_leitura on public.wa_linhas;
create policy wa_linhas_leitura on public.wa_linhas
  for select to authenticated using (true);
-- Sem policy de escrita: só a Edge Function, com a chave de serviço, muda
-- estado de linha. A tela pede, ela decide.

-- ---------------------------------------------------------------------
-- 2. As duas linhas da casa
-- ---------------------------------------------------------------------
insert into public.wa_linhas (nome, numero, tipo, instancia, estado)
values ('Pedidos · Meta', '5564992010442', 'oficial', null, 'conectada')
on conflict (numero) do nothing;

insert into public.wa_linhas (nome, numero, tipo, instancia, estado)
values ('Balcão', '5564992667645', 'qr', 'mrkong-balcao', 'desconectada')
on conflict (numero) do nothing;

-- ---------------------------------------------------------------------
-- 3. De qual linha veio cada conversa e cada mensagem
--
-- Tudo o que existe hoje entrou pela linha oficial — era a única. O
-- backfill diz isso em vez de deixar nulo: nulo obrigaria toda consulta
-- futura a adivinhar, e adivinhação em cima de resposta ao cliente é o
-- tipo de erro que só aparece depois de já ter mandado.
-- ---------------------------------------------------------------------
alter table public.wa_conversas add column if not exists linha_id uuid;
alter table public.wa_mensagens add column if not exists linha_id uuid;

update public.wa_conversas
   set linha_id = (select id from public.wa_linhas where tipo = 'oficial' limit 1)
 where linha_id is null;

update public.wa_mensagens
   set linha_id = (select id from public.wa_linhas where tipo = 'oficial' limit 1)
 where linha_id is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'wa_conversas_linha_fk') then
    alter table public.wa_conversas
      add constraint wa_conversas_linha_fk foreign key (linha_id)
      references public.wa_linhas (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'wa_mensagens_linha_fk') then
    alter table public.wa_mensagens
      add constraint wa_mensagens_linha_fk foreign key (linha_id)
      references public.wa_linhas (id) on delete set null;
  end if;
end $$;

create index if not exists wa_conversas_linha on public.wa_conversas (linha_id);
create index if not exists wa_mensagens_linha on public.wa_mensagens (linha_id);

-- ---------------------------------------------------------------------
-- 4. O mesmo telefone pode falar com as duas linhas
--
-- Se existir um índice único só por telefone em wa_conversas, o cliente
-- que já falou com a linha oficial nunca conseguiria abrir conversa com o
-- balcão. Este bloco troca esse índice por um de telefone + linha.
-- Se não existir, não faz nada.
-- ---------------------------------------------------------------------
do $$
declare
  nome_indice text;
  nome_regra  text;
begin
  -- O índice pode existir sozinho (create unique index) ou ser o "corpo" de
  -- uma constraint unique. No segundo caso o Postgres recusa o drop index e
  -- manda tirar a constraint — então aqui se descobre qual é o caso antes.
  select i.relname, c.conname into nome_indice, nome_regra
    from pg_index x
    join pg_class i on i.oid = x.indexrelid
    join pg_class t on t.oid = x.indrelid
    left join pg_constraint c on c.conindid = x.indexrelid and c.contype in ('u', 'p')
   where t.relname = 'wa_conversas'
     and x.indisunique
     and not x.indisprimary
     and (select count(*) from unnest(x.indkey) k where k > 0) = 1
     and exists (
       select 1 from pg_attribute a
        where a.attrelid = t.oid and a.attnum = x.indkey[0] and a.attname = 'telefone')
   limit 1;

  if nome_regra is not null then
    execute format('alter table public.wa_conversas drop constraint %I', nome_regra);
    raise notice 'Regra única só por telefone removida: %', nome_regra;
  elsif nome_indice is not null then
    execute format('drop index public.%I', nome_indice);
    raise notice 'Índice único só por telefone removido: %', nome_indice;
  end if;
end $$;

create unique index if not exists wa_conversas_telefone_linha
  on public.wa_conversas (telefone, linha_id);

-- Confere: deve devolver  linhas 2 | conversas_sem_linha 0 | mensagens_sem_linha 0
select
  (select count(*) from public.wa_linhas)                              as linhas,
  (select count(*) from public.wa_conversas where linha_id is null)    as conversas_sem_linha,
  (select count(*) from public.wa_mensagens where linha_id is null)    as mensagens_sem_linha;
