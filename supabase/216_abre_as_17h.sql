-- 216_abre_as_17h.sql — Mr Kong
-- A casa volta a abrir às 17h. Ajusta a cobertura mínima da Previsão de
-- escala (migração 215), que tinha sido criada com abertura às 16h:
--   - Abertura: 17:00 às 17:30
--   - toda área que começava às 16:00 passa a começar às 17:00
-- Não mexe em área que você já tenha mudado para outro horário.
-- Pode rodar duas vezes.
--
-- Onde rodar: Supabase → SQL Editor.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
  if to_regclass('public.cobertura_minima') is null then
    raise exception 'Rode a migração 215 antes desta.';
  end if;
end $trava$;

update public.cobertura_minima
   set inicio = '17:00', fim = '17:30'
 where area = 'Abertura' and inicio = '16:00' and fim = '16:30';

update public.cobertura_minima
   set inicio = '17:00'
 where inicio = '16:00';

select area, to_char(inicio, 'HH24:MI') as das, to_char(fim, 'HH24:MI') as ate, minimo
  from public.cobertura_minima
 order by ordem;
