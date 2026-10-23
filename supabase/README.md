# supabase/migracoes

Todo SQL que roda no banco do Mr Kong mora aqui.

## Por que isso existe

Até o arquivo 141 nada disso ficava guardado: o SQL era colado no editor do
Supabase, rodava, e sumia. Isso cobra o preço em dois momentos — quando
alguém precisa entender **por que** uma função é do jeito que é, e quando
o banco precisa ser recriado do zero. Nenhum dos dois acontece com
frequência; os dois acontecem no pior dia possível.

## Como usar

1. O arquivo é criado aqui, com número na frente: `142_o_que_faz.sql`.
   O número nunca se repete e nunca volta atrás.
2. Cola no SQL Editor do projeto **mr kong** e roda.
   https://supabase.com/dashboard/project/wujyqamgzvhsjlojscmt/sql/new
3. Sobe o arquivo para esta pasta no GitHub, rodado ou não — se deu erro,
   sobe junto a correção com o número seguinte, em vez de apagar.

## Regras que já custaram caro

**Trava de projeto.** Todo arquivo que ESCREVE no banco começa conferindo
se está no projeto certo. Existe outro projeto na mesma conta (Dinâmico
Construtora) e já rodamos coisa do Mr Kong lá dentro:

```sql
do $trava$ begin
  if to_regclass('public.pratos') is null then
    raise exception 'PROJETO ERRADO: isto é do Mr Kong.';
  end if;
end $trava$;
```

**O dia é de Rio Verde, não do banco.** `current_date` no Supabase é UTC:
depois das 21h ele já virou amanhã. Usar `current_date` para "hoje" uma
vez apagou a fila inteira do KDS no meio do serviço. O dia operacional
vai das 5h às 5h e se escreve assim:

```sql
(date_trunc('day', (now() at time zone 'America/Sao_Paulo') - interval '5 hours')
 + interval '5 hours') at time zone 'America/Sao_Paulo'
```

**Uma consulta no fim.** O editor do Supabase só mostra o resultado do
ÚLTIMO comando. Então cada arquivo termina com um `select` de conferência
— é ele que prova que o que devia acontecer aconteceu.

**Tipo de coluna não se adivinha.** `pedido_id` é texto em umas tabelas e
uuid em outras. Comparar direto dá `operator does not exist: uuid = text`.
Quando houver dúvida, compare os dois lados como texto.

## O que está aqui

| arquivo | o que faz | escreve no banco? |
| --- | --- | --- |
| `139_entregas_batem.sql` | taxa de entrega cobrada do cliente × repasse pago ao entregador, dia a dia | não |
| `140_entregas_resumo.sql` | o mesmo, somado no período, com custo médio por entrega | não |
| `141_operacao_do_dia.sql` | check de fim de expediente do KDS: itens, pegos, terminados | não |

Os arquivos de 001 a 034 estão em `supabase/`, na raiz do repositório.
O intervalo de 035 a 138 rodou no banco mas não foi guardado — está no
histórico das conversas, e vai sendo recuperado se algum dia precisar.
