  -- 218_horario_jesse_lidiane_maria_luiza.sql — Mr Kong
  -- Horário padrão na Jornada dos outros três registrados, pela proposta de
  -- escala para a regra de 42 h (todos depois das 17h, quando a casa abre):
  --
  --   Maria Luiza (gerente)  17:30 · intervalo 19:00–20:00 · saída 02:15  → 7h45/noite, 41h47 em 5 noites
  --   Lidiane (caixa)        17:30 · intervalo 19:00–20:00 · saída 02:15  → 7h45/noite, 41h47 em 5 noites
  --   Jesse (chapa)          17:45 · intervalo 22:00–23:00 · saída 02:30  → 7h45/noite, 41h15 em 5 noites
  --
  -- (horas em 5 noites contam a hora noturna: depois das 22h, 52min30 = 1 h)
  --
  -- Também marca Maria Luiza e Lidiane com domingo de folga a cada 15 dias
  -- (CLT art. 386). Só mexe no horário padrão; dias com horário próprio na
  -- Jornada continuam como estão. Pode rodar duas vezes.
  --
  -- Onde rodar: Supabase → SQL Editor.
  
  do $trava$
  declare
    n text;
    qtd int;
  begin
    if to_regclass('public.pratos') is null then
      raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
    end if;
    foreach n in array array['jesse pereira%', 'lidiane andrade%', 'maria luiza%'] loop
      select count(*) into qtd from public.pessoas where nome ilike n and ativo and tipo_contrato = 'registrado';
      if qtd <> 1 then
        raise exception 'Esperava 1 registrado ativo para "%", achei %. Nada foi mudado — me mande esta mensagem.', n, qtd;
      end if;
    end loop;
  end $trava$;
  
  update public.pessoas
     set jornada_entrada = '17:30', jornada_intervalo_inicio = '19:00', jornada_intervalo_fim = '20:00',
         jornada_saida = '02:15', domingo_quinzenal = true
   where nome ilike 'maria luiza%' and ativo and tipo_contrato = 'registrado';
  
  update public.pessoas
     set jornada_entrada = '17:30', jornada_intervalo_inicio = '19:00', jornada_intervalo_fim = '20:00',
         jornada_saida = '02:15', domingo_quinzenal = true
   where nome ilike 'lidiane andrade%' and ativo and tipo_contrato = 'registrado';
  
  update public.pessoas
     set jornada_entrada = '17:45', jornada_intervalo_inicio = '22:00', jornada_intervalo_fim = '23:00',
         jornada_saida = '02:30'
   where nome ilike 'jesse pereira%' and ativo and tipo_contrato = 'registrado';
  
  select nome,
         to_char(jornada_entrada, 'HH24:MI') as entrada,
         to_char(jornada_intervalo_inicio, 'HH24:MI') || '–' || to_char(jornada_intervalo_fim, 'HH24:MI') as intervalo,
         to_char(jornada_saida, 'HH24:MI') as saida,
         domingo_quinzenal
    from public.pessoas
   where ativo and tipo_contrato = 'registrado'
   order by nome;
