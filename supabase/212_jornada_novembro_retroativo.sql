    -- 212_jornada_novembro_retroativo.sql — Mr Kong
    -- Preenche a Jornada de novembro/2026 com o que aconteceu de verdade,
    -- a partir da Escala do dia.
    --
    -- Como funciona:
    --   - As noites que TÊM ponto na Escala do dia (presencas_diarias) a
    --     Jornada já lê sozinha — não precisa copiar nada.
    --   - O que faltava: os dias em que o registrado NÃO trabalhou. Sem
    --     marcação, a Jornada achava que ele veio no horário padrão. Esta
    --     migração marca FOLGA nesses dias.
    --
    -- Só para registrados ativos, de 01/11 até ONTEM, sem as segundas (casa
    -- fechada, já é folga). Não mexe em dia que já tem marcação na Jornada,
    -- não mexe no ponto nem na premiação. Pode rodar duas vezes.
    --
    -- Para desfazer (só o que esta migração criou):
    --   delete from public.escala_jornada
    --    where observacao = 'retroativo 212' ;
    --
    -- Onde rodar: Supabase → SQL Editor. O resultado mostra, por pessoa, as
    -- noites com ponto e as folgas marcadas — confira se bate com o mês.
    
    do $trava$
    begin
      if to_regclass('public.pratos') is null then
        raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
      end if;
      if to_regclass('public.escala_jornada') is null then
        raise exception 'Rode a migração 210 antes desta.';
      end if;
    end $trava$;
    
    insert into public.escala_jornada (pessoa_id, dia, folga, observacao)
    select pe.id, d::date, true, 'retroativo 212'
      from public.pessoas pe
     cross join generate_series(date '2026-11-01', least(date '2026-11-30', current_date - 1), interval '1 day') d
     where pe.ativo
       and pe.tipo_contrato = 'registrado'
       and extract(isodow from d) <> 1                      -- segunda: casa fechada
       and (pe.data_admissao is null or d::date >= pe.data_admissao)     -- antes da admissão não é folga
       and not exists (select 1 from public.presencas_diarias pr where pr.pessoa_id = pe.id and pr.dia = d::date)
    on conflict (pessoa_id, dia) do nothing;
    
    -- Conferência por pessoa ---------------------------------------------------
    select pe.nome,
           (select count(*) from public.presencas_diarias pr
             where pr.pessoa_id = pe.id and pr.dia between '2026-11-01' and '2026-11-30') as noites_com_ponto,
           (select count(*) from public.presencas_diarias pr
             where pr.pessoa_id = pe.id and pr.dia between '2026-11-01' and '2026-11-30'
               and (pr.hora_entrada is null or pr.hora_saida is null)) as noites_sem_entrada_saida,
           (select count(*) from public.escala_jornada ej
             where ej.pessoa_id = pe.id and ej.dia between '2026-11-01' and '2026-11-30' and ej.folga) as folgas_marcadas,
           (select count(*) from public.escala_jornada ej
             where ej.pessoa_id = pe.id and ej.observacao = 'retroativo 212') as criadas_agora,
           pe.jornada_entrada is not null as tem_horario_padrao
      from public.pessoas pe
     where pe.ativo and pe.tipo_contrato = 'registrado'
     order by pe.nome;
