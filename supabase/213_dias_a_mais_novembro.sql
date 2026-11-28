-- 213_dias_a_mais_novembro.sql — Mr Kong
-- Só leitura. Não muda nada no banco.
--
-- Na conferência da 212, Lidiane e Maria Luiza apareceram com mais noites
-- de ponto em novembro do que noites de casa aberta (23, de 01 a 27/11,
-- sem as segundas). Esta consulta mostra, para cada registrado, as noites
-- de ponto que caem:
--   - numa SEGUNDA (casa fechada), ou
--   - de HOJE em diante (ponto lançado antes da hora ou com a data errada)
-- E, para cada uma: horário do ponto, quantas pessoas da equipe têm ponto
-- naquela noite, se a noite teve premiação calculada e se a casa teve
-- venda naquele dia.
--
-- Onde rodar: Supabase → SQL Editor. Colar o resultado (CSV) na conversa.

do $trava$
begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;

select pe.nome,
       to_char(pr.dia, 'DD/MM') as dia,
       case extract(isodow from pr.dia)::int
         when 1 then 'segunda' when 2 then 'terça' when 3 then 'quarta' when 4 then 'quinta'
         when 5 then 'sexta' when 6 then 'sábado' else 'domingo' end as dia_semana,
       case when extract(isodow from pr.dia) = 1 then 'segunda (casa fechada)'
            else 'de hoje em diante' end as motivo,
       left(pr.hora_entrada::text, 5) || '–' || left(pr.hora_saida::text, 5) as ponto,
       (select count(*) from public.presencas_diarias x where x.dia = pr.dia) as pessoas_com_ponto_na_noite,
       exists (select 1 from public.premiacoes_diarias pm where pm.dia = pr.dia and pm.pessoa_id = pr.pessoa_id) as tem_premiacao,
       (select vd.faturamento_bruto from public.vendas_diarias vd where vd.dia = pr.dia limit 1) as venda_do_dia
  from public.presencas_diarias pr
  join public.pessoas pe on pe.id = pr.pessoa_id
 where pe.tipo_contrato = 'registrado'
   and pr.dia between '2026-11-01' and '2026-11-30'
   and (extract(isodow from pr.dia) = 1 or pr.dia >= current_date)
 order by pe.nome, pr.dia;
