-- 063_whatsapp_de_verdade.sql
--
-- Troca os números de WhatsApp do painel. Os que estão lá hoje
-- (5564999990001 e 556436210000) são EXEMPLOS que eu deixei num arquivo
-- anterior e que acabaram salvos como se fossem reais. Anúncio criado com
-- eles manda o cliente para um número que não existe.
--
-- >>> VOCÊ PRECISA EDITAR AS DUAS LINHAS MARCADAS ABAIXO. <<<
-- Se rodar sem editar, o arquivo PARA com uma mensagem — de propósito.
-- Não existe jeito de ele gravar um número de mentira por descuido.
--
-- Formato: DDI + DDD + número, só dígitos, sem espaço, traço ou parêntese.
--   55 = Brasil, 64 = Rio Verde.
--   (64) 99999-0001  ->  5564999990001
--   (64) 3621-0000   ->  556436210000
--
-- Onde rodar: Supabase → SQL Editor.

do $$
declare
  -- ======================= EDITE AQUI =======================
  numero_pedidos text := 'TROQUE_PELO_NUMERO_DE_PEDIDOS';
  numero_loja    text := 'TROQUE_PELO_NUMERO_DA_LOJA';
  -- ==========================================================
  -- Se a loja só tem um número, apague a linha do `numero_loja`
  -- lá embaixo, no bloco do jsonb, e deixe só o de pedidos.

  so_digitos_pedidos text;
  so_digitos_loja    text;
  quantas int;
begin
  so_digitos_pedidos := regexp_replace(coalesce(numero_pedidos, ''), '\D', '', 'g');
  so_digitos_loja    := regexp_replace(coalesce(numero_loja, ''),    '\D', '', 'g');

  -- Primeira barreira: o texto de exemplo não vira dígito nenhum.
  if length(so_digitos_pedidos) = 0 or length(so_digitos_loja) = 0 then
    raise exception
      'Você não trocou os números. Abra o arquivo, substitua TROQUE_PELO_NUMERO_DE_PEDIDOS e TROQUE_PELO_NUMERO_DA_LOJA pelos números reais, e rode de novo.';
  end if;

  -- Segunda: tamanho de número brasileiro com DDI e DDD.
  if length(so_digitos_pedidos) not between 12 and 13
     or length(so_digitos_loja) not between 12 and 13 then
    raise exception
      'Número fora do formato. Use DDI + DDD + número, só dígitos: 5564999990001 tem 13, 556436210000 tem 12. Veio "%" (% dígitos) e "%" (% dígitos).',
      so_digitos_pedidos, length(so_digitos_pedidos),
      so_digitos_loja,    length(so_digitos_loja);
  end if;

  -- Terceira: os meus exemplos continuam proibidos, caso alguém os copie.
  if so_digitos_pedidos in ('5564999990001', '556436210000')
     or so_digitos_loja in ('5564999990001', '556436210000') then
    raise exception
      'Esse é o número de exemplo, não o da casa. Use o número real do WhatsApp do Mr Kong.';
  end if;

  update public.patrocinio_config
     set whatsapp_numeros = jsonb_build_array(
           jsonb_build_object('nome', 'Pedidos', 'numero', so_digitos_pedidos),
           jsonb_build_object('nome', 'Loja',    'numero', so_digitos_loja)
         );

  get diagnostics quantas = row_count;
  if quantas = 0 then
    raise exception 'Nenhuma linha em patrocinio_config para atualizar.';
  end if;

  raise notice 'Pronto: % conta(s) atualizada(s).', quantas;
end $$;

-- Confere: tem de mostrar os seus números, e nenhum deles pode ser exemplo.
select
  n->>'nome'   as nome,
  n->>'numero' as numero,
  (n->>'numero') in ('5564999990001', '556436210000') as ainda_e_exemplo
from public.patrocinio_config c,
     lateral jsonb_array_elements(c.whatsapp_numeros) n;
