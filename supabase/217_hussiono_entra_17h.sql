-- 217_hussiono_entra_17h.sql — Mr Kong
-- Horário padrão do Hussiono na Jornada: entrada às 17:00 (a casa voltou
-- a abrir às 17h).
--
--   antes (proposta):  16:00 · intervalo 18:00–20:00 · saída 01:45
--   agora:             17:00 · intervalo 19:00–20:00 · saída 01:45
--
-- Continua com 7h45 trabalhadas por noite (8h17 pela lei, por causa da
-- hora noturna) e 41h26 em 5 noites — dentro das 42 h. O intervalo fica
-- antes do pico das 20h.
--
-- Só mexe no horário padrão dele. Dias com horário próprio marcado na
-- Jornada continuam como estão. Pode rodar duas vezes.
--
-- Onde rodar: Supabase → SQL Editor.

do $trava$
declare
  qtd int;
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
  select count(*) into qtd from public.pessoas where nome ilike 'hussiono%' and ativo;
  if qtd <> 1 then
    raise exception 'Esperava 1 Hussiono ativo, achei %. Me mande esta mensagem.', qtd;
  end if;
end $trava$;

update public.pessoas
   set jornada_entrada = '17:00',
       jornada_intervalo_inicio = '19:00',
       jornada_intervalo_fim = '20:00',
       jornada_saida = '01:45'
 where nome ilike 'hussiono%' and ativo;

select nome,
       to_char(jornada_entrada, 'HH24:MI') as entrada,
       to_char(jornada_intervalo_inicio, 'HH24:MI') || '–' || to_char(jornada_intervalo_fim, 'HH24:MI') as intervalo,
       to_char(jornada_saida, 'HH24:MI') as saida
  from public.pessoas
 where nome ilike 'hussiono%';
