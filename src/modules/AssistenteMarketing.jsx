-- =====================================================================
-- 041_assistente_estrategia.sql  ·  A cascata da estratégia
--
-- Transforma o assistente de uma caixa de perguntas numa cascata: o
-- prompt-mestre é a base, e dele descem trimestre, mês e semana. Cada
-- nível só pode existir depois que o de cima foi aprovado.
--
-- Quatro decisões que moram aqui:
--
-- 1. O PROMPT-MESTRE É VERSIONADO, NUNCA SOBRESCRITO. Cada edição cria
--    uma versão nova. Toda estratégia guarda em qual versão foi
--    construída — assim, quando a base muda, dá para saber exatamente o
--    que ficou apoiado em premissa velha.
--
-- 2. MUDAR A BASE NÃO APAGA NADA. Um gatilho marca as estratégias
--    aprovadas com `revisar = true`. Elas continuam valendo e a pauta já
--    aceita continua no calendário. Quem decide o que cai é gente.
--
-- 3. A CASCATA É REGRA DE BANCO, NÃO DE TELA. Não existe micro sem macro
--    aprovado, e o banco recusa. Esconder o botão na tela seria acordo de
--    cavalheiros; a restrição aqui é o que garante a linhagem.
--
-- 4. A OPERADORA LÊ, NÃO EDITA. Ela precisa entender a estratégia para
--    executar — quem executa no escuro executa mal. Mas base e estratégia
--    são decisão do dono.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Nível 0 — a base
-- ---------------------------------------------------------------------
create table if not exists public.assistente_briefing (
  id uuid primary key default gen_random_uuid(),
  versao int not null,

  -- O texto do dono, inteiro, como ele escreveu. Entra como instrução de
  -- sistema em TODA chamada, sem resumo e sem reinterpretação.
  prompt_mestre text not null,

  -- O que o método não tem como saber sozinho.
  --
  -- "nao_fazemos" é o campo mais importante da tabela e por isso já nasce
  -- preenchido: estratégia se define mais pelo que recusa do que pelo que
  -- promete, e um assistente sem limite escrito sugere guerra de preço
  -- com quem tem seis vezes mais seguidores — com ótima fundamentação.
  nao_fazemos text,
  objetivo_agora text,
  restricoes text,

  criado_por uuid references auth.users(id) on delete set null,
  criado_em timestamptz not null default now()
);

create unique index if not exists idx_briefing_versao on public.assistente_briefing (versao);

create or replace view public.v_briefing_atual
with (security_invoker = true) as
select * from public.assistente_briefing order by versao desc limit 1;

-- ---------------------------------------------------------------------
-- Níveis 1 e 2 — macro (trimestre) e micro (mês)
-- ---------------------------------------------------------------------
create table if not exists public.assistente_estrategias (
  id uuid primary key default gen_random_uuid(),
  nivel text not null check (nivel in ('macro', 'micro')),

  periodo_inicio date not null,
  periodo_fim    date not null check (periodo_fim >= periodo_inicio),

  -- Linhagem. É o que permite a trilha "base v3 → macro → setembro".
  briefing_versao int not null,
  pai_id uuid references public.assistente_estrategias(id) on delete set null,

  titulo text,
  texto  text,                                   -- a leitura em prosa
  conteudo jsonb not null default '{}'::jsonb,   -- pilares, pesos, distribuição

  status text not null default 'proposta'
    check (status in ('proposta', 'aprovada', 'descartada')),

  -- Separado do status de propósito: "aprovada e precisando de revisão" é
  -- um estado real. Colapsar os dois faria a estratégia parecer não
  -- aprovada só porque a base mudou.
  revisar boolean not null default false,

  conversa_id uuid references public.assistente_conversas(id) on delete set null,
  decidida_por uuid references auth.users(id) on delete set null,
  decidida_em timestamptz,
  criado_em timestamptz not null default now()
);

create index if not exists idx_estrategias_nivel on public.assistente_estrategias (nivel, periodo_inicio desc);
create index if not exists idx_estrategias_pai on public.assistente_estrategias (pai_id);

-- Micro sem macro é conteúdo sem estratégia. O banco recusa.
create or replace function public.assistente_valida_cascata()
returns trigger language plpgsql as $$
declare pai record;
begin
  if new.nivel = 'micro' then
    if new.pai_id is null then
      raise exception 'Estratégia mensal precisa apontar para um trimestre (pai_id).';
    end if;
    select * into pai from public.assistente_estrategias where id = new.pai_id;
    if pai is null or pai.nivel <> 'macro' then
      raise exception 'O pai de uma estratégia mensal tem que ser um trimestre.';
    end if;
    if pai.status <> 'aprovada' then
      raise exception 'O trimestre precisa estar aprovado antes de gerar o mês.';
    end if;
  elsif new.nivel = 'macro' and new.pai_id is not null then
    raise exception 'Trimestre não tem pai — ele nasce direto do prompt-mestre.';
  end if;
  return new;
end $$;

drop trigger if exists trg_valida_cascata on public.assistente_estrategias;
create trigger trg_valida_cascata
  before insert or update on public.assistente_estrategias
  for each row execute function public.assistente_valida_cascata();

-- Base nova marca o que veio de base velha. Não apaga, não descarta.
create or replace function public.assistente_marca_revisao()
returns trigger language plpgsql as $$
begin
  update public.assistente_estrategias
     set revisar = true
   where status = 'aprovada'
     and briefing_versao < new.versao;
  return new;
end $$;

drop trigger if exists trg_marca_revisao on public.assistente_briefing;
create trigger trg_marca_revisao
  after insert on public.assistente_briefing
  for each row execute function public.assistente_marca_revisao();

-- Trimestre reaprovado marca os meses que dependem dele.
create or replace function public.assistente_marca_filhos()
returns trigger language plpgsql as $$
begin
  if new.nivel = 'macro' and new.conteudo is distinct from old.conteudo then
    update public.assistente_estrategias
       set revisar = true
     where pai_id = new.id and status = 'aprovada';
  end if;
  return new;
end $$;

drop trigger if exists trg_marca_filhos on public.assistente_estrategias;
create trigger trg_marca_filhos
  after update on public.assistente_estrategias
  for each row execute function public.assistente_marca_filhos();

-- ---------------------------------------------------------------------
-- Nível 3 — a pauta ganha linhagem
-- ---------------------------------------------------------------------
alter table public.assistente_propostas
  add column if not exists estrategia_id uuid references public.assistente_estrategias(id) on delete set null;
alter table public.assistente_propostas
  add column if not exists briefing_versao int;

-- ---------------------------------------------------------------------
-- Onde a cascata está agora
--
-- Uma linha só, com tudo que a tela precisa para saber o que destravar.
-- security definer porque ela é o mapa da navegação: a operadora precisa
-- enxergar o estado mesmo sem poder editar nada.
-- ---------------------------------------------------------------------
create or replace function public.assistente_cascata()
returns table (
  briefing_versao int,
  briefing_em timestamptz,
  macro_id uuid, macro_titulo text, macro_status text, macro_revisar boolean,
  macro_inicio date, macro_fim date,
  micro_id uuid, micro_titulo text, micro_status text, micro_revisar boolean,
  micro_inicio date, micro_fim date,
  pode_macro boolean, pode_micro boolean, pode_pauta boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with b as (
    select versao, criado_em from public.assistente_briefing order by versao desc limit 1
  ),
  ma as (
    select * from public.assistente_estrategias
     where nivel = 'macro' and status = 'aprovada'
       and current_date between periodo_inicio and periodo_fim
     order by periodo_inicio desc limit 1
  ),
  mi as (
    select e.* from public.assistente_estrategias e
     where e.nivel = 'micro' and e.status = 'aprovada'
       and current_date between e.periodo_inicio and e.periodo_fim
       and e.pai_id = (select id from ma)
     order by e.periodo_inicio desc limit 1
  )
  select
    b.versao, b.criado_em,
    ma.id, ma.titulo, ma.status, ma.revisar, ma.periodo_inicio, ma.periodo_fim,
    mi.id, mi.titulo, mi.status, mi.revisar, mi.periodo_inicio, mi.periodo_fim,
    b.versao is not null                    as pode_macro,
    ma.id is not null                       as pode_micro,
    mi.id is not null                       as pode_pauta
  from b
  left join ma on true
  left join mi on true
  where public.esta_aprovado();
$$;

-- ---------------------------------------------------------------------
-- Semente
--
-- O prompt_mestre entra vazio de propósito: ele é o texto do dono, e um
-- texto meu ali seria a minha estratégia disfarçada de dele. Já o
-- "nao_fazemos" nasce escrito, porque campo vazio nesse lugar é o que
-- deixa a marca desprotegida — e é mais fácil riscar uma linha que
-- discordar do que inventar as sete do zero.
-- ---------------------------------------------------------------------
insert into public.assistente_briefing (versao, prompt_mestre, nao_fazemos, objetivo_agora)
select 1,
'', -- cole aqui o seu prompt-mestre pela tela, em Assistente › Base
'Não competimos por preço mais baixo — quem ganha guerra de preço é quem tem mais caixa, e não somos nós.
Não prometemos prazo de entrega que a cozinha não consegue cumprir.
Não citamos nem alfinetamos concorrente pelo nome.
Não usamos humor forçado, trend de dancinha nem áudio viral que não tenha a ver com comida.
Não fazemos afirmação sobre ingrediente, origem ou saúde que a gente não consiga provar.
Não publicamos foto de cliente sem a pessoa saber e concordar.
Não respondemos reclamação com ironia — reclamação pública se responde na frente de todo mundo, e direito.',
'Aumentar alcance por post. Somos o perfil mais ativo da praça e o que menos gente atinge por publicação.'
where not exists (select 1 from public.assistente_briefing);

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.assistente_briefing    enable row level security;
alter table public.assistente_estrategias enable row level security;

-- A operadora LÊ os dois. Executar sem entender o porquê é executar no
-- escuro, e foi decisão explícita do dono que ela enxergue a estratégia.
drop policy if exists "aprovados leem briefing" on public.assistente_briefing;
create policy "aprovados leem briefing" on public.assistente_briefing
  for select using (public.esta_aprovado());

drop policy if exists "aprovados leem estrategias" on public.assistente_estrategias;
create policy "aprovados leem estrategias" on public.assistente_estrategias
  for select using (public.esta_aprovado());

-- Só o dono edita a base e decide estratégia. Quem grava proposta é a
-- Edge Function com a service_role; o admin só aprova ou descarta.
drop policy if exists "admin cria briefing" on public.assistente_briefing;
create policy "admin cria briefing" on public.assistente_briefing
  for insert with check (public.is_admin());

drop policy if exists "admin decide estrategias" on public.assistente_estrategias;
create policy "admin decide estrategias" on public.assistente_estrategias
  for update using (public.is_admin()) with check (public.is_admin());
