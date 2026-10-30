# Formação de preços — o que foi feito, e por quê

Resumo de 23 a 29 de outubro de 2026. Serve de mapa para mexer no código:
cada decisão aqui existe por causa de um erro real que apareceu nos dados
do Mr Kong, e está anotada junto com ele.

---

## 1. O número que mudou

| | início (23/10) | agora (29/10) |
|---|---|---|
| Lucro sobre faturamento | **9,2%** | **66,9%** |
| Faturamento sem ficha técnica | **R$ 39.012,88** | **R$ 2,21** |
| Pratos ativos com ficha | 174 de 241 | ~239 de 241 |

O lucro não subiu porque a operação mudou em seis dias. Subiu porque o
cálculo passou a enxergar o custo que já existia. Quase metade do
faturamento entrava com **custo zero** — e custo zero vira margem de 100%,
que o sistema somava alegremente ao resultado.

**Isto é margem de contribuição**: faturamento menos ingredientes. Não
desconta pessoal, aluguel, cartão nem imposto.

---

## 2. O que foi construído

### `src/modules/FormacaoPrecos.jsx` (novo)

Três abas dentro de Financeiro → Formação de preços.

**Preços** — produto a produto. Margem ↔ preço (as duas pontas da mesma
fórmula), ficha técnica editável embaixo de cada prato, filtro por margem
(≥, ≤, sem margem, sem preço) e o preço derivado de combo/iFood que vinha
da planilha.

**Tabela de preços** — o cardápio inteiro numa grade, para fechar preço de
241 produtos sem abrir 241 produtos. Também traz o importador do
CardápioWeb.

**Preço dos insumos** — a raiz de tudo. Preço, unidade e **origem** de cada
insumo, com a última compra ao lado e o impacto prato a prato antes de
gravar.

### `supabase/152_origem_do_custo.sql` — a mudança estrutural

Antes, o custo do insumo era um campo só e **quem escrevesse por último
ganhava**: a nota sobrescrevia o que você digitou, e você digitava por cima
da nota. Os 26 divergentes nasceram daí — ninguém estava errado, o campo é
que não sabia a quem obedecer.

Agora cada insumo declara de onde vem o custo:

- `ultima_compra` (padrão) — a nota confirmada atualiza sozinha
- `media_90d` — média do trimestre; absorve a compra cara de emergência
- `manual` — você digita e a nota não encosta
- `receita` — insumo composto, custo calculado

A regra mora num **gatilho em `movimentacoes_estoque`**, não no cliente.
Venha a compra da tela de notas, de um lançamento manual ou de algo que a
gente escreva ano que vem, ela respeita a origem. Por isso o
`NotasFiscais.jsx` perdeu a linha que atualizava o custo por fora.

### `supabase/167_trava_compra_sem_preco.sql`

`check (tipo <> 'compra' or preco_unitario > 0)`, `NOT VALID`. Entrada de
mercadoria sem custo infla o estoque e some do CMV. Vale para o que entrar
daqui pra frente; o passado se conserta pelo `166`.

### Arquivos tocados

```
src/App.jsx                    rota no hash (#financeiro/precos/insumos)
src/lib/permissoes.js          chave financeiro.precos
src/modules/Financeiro.jsx     aba nova + sub-rota
src/modules/FormacaoPrecos.jsx a tela (novo)
src/modules/FichasTecnicas.jsx fração 1/24 e botão ÷
src/modules/NotasFiscais.jsx   deixou de escrever custo (gatilho assumiu)
supabase/146 … 167             permissão, funções, diagnósticos e correções
```

---

## 3. Os erros que os dados revelaram

Todos o mesmo padrão: **insumo cadastrado pelo preço da embalagem, ficha
gastando a unidade.**

| insumo | estava | era | efeito |
|---|---|---|---|
| Ovos | R$ 179,81 "por un" | caixa de 360 → R$ 0,50 | 9 pratos, 4 deles a −300%/−442% |
| Heineken | R$ 24,00 a garrafa | fardo de 12 → R$ 2,00 | balde a −140% |
| Laranja | R$ 50,00 "por kg" | saco de 20 kg → R$ 6,25/**litro de suco** | suco a −66,8%, real 79,2% |
| Água com gás | R$ 23,89 a unidade | fardo | 106 vendas/mês a −378% |
| Batata frita | R$ 0,07/kg | nota também errada | 38 pratos |

E o oposto, que não escandaliza e por isso fica anos: batata a R$ 0,07/kg,
molho tártaro a R$ 1,00/kg com **300 g por lanche** em 30 fichas.

**Cadastros duplicados** — "Rei da Selva" e "Rei da Selva (X-Tudo)": a
venda caía num, a ficha estava no outro. 8 pares resolvidos pelo `155`,
mais uma dezena encontrada depois (Croqueta, Bolinho, Monster, Cerveja
Sol…). O cruzamento do `154` só pegava diferença entre parênteses.

**Corrigido com a diagnose errada, uma vez:** eu disse que o Supabase
cortava a consulta em 1000 linhas. `prato_insumos` tinha 479. Não era
corte; era cadastro duplicado. A paginação ficou no código assim mesmo
(`tabelaInteira`), porque o teto é real e um dia essa tabela passa de mil.

---

## 4. Decisões de interface, e o erro que cada uma corrigiu

| decisão | o erro que a motivou |
|---|---|
| Painel abre sozinho ao editar; sem botão "Salvar" na linha | O botão estava na última coluna, fora da tela numa tabela larga |
| Botões no **topo** do painel | Com 30 pratos afetados, "Confirmar" ficava três scrolls abaixo |
| Filtro olha o **gravado**, não o digitado | Editar fazia a linha sumir do filtro no meio do trabalho |
| Campo contém o valor (não placeholder) | Número cinza que o backspace não apagava |
| Digitar no custo já põe em Manual | Exigia entender "origem" antes de conseguir editar |
| Recarregar não apaga a tela | Cada gravação fechava o produto e voltava ao topo |
| Salvar trava se todas as linhas estão vazias | Salvar em branco esvaziava a ficha e parecia "não salvou" |
| Trocar unidade apaga a quantidade | 100 un viraria 100.000 g sem ninguém ver |
| Copiar ficha **soma**, não substitui | O combo é lanche + batata + bebida |

Nada disso é polimento. Cada linha é um relato de uso que falhou.

---

## 5. O que ainda não está resolvido

**Importar do CardápioWeb** — o `catalogo_precos` pode estar lendo os
**pedidos**, não o catálogo (o `/catalog` exige `X-PARTNER-KEY`, que talvez
nunca tenha sido registrado nos secrets). Se for isso, produto novo só
aparece depois da primeira venda. O importador mostra "N itens no cardápio
· N já estão no painel · N novos" — esse número responde a pergunta.
Alternativa: um "criar prato" manual na tela.

**6 compras antigas sem preço** no estoque (achadas pelo `167`).
Mercadoria que entrou e nunca virou custo.

**Molho tártaro** — 30 fichas com 300 g e preço de R$ 1,00/kg, os dois
inventados. Falta: quanto custa o pote e quantos gramas vão no lanche.
Corrigir só o preço faria 23 lanches custarem R$ 7,50 de molho — **a ordem
é quantidade primeiro**.

**Duplicatas com preços diferentes** — "Suco 300ml" R$ 16,99 e "Sucos
300ml" R$ 14,99; "Sundae NUT Chocolate" R$ 14,99 e "Sundae Nutella
Chocolate" R$ 16,99. Mesmo produto, dois preços vivos no cardápio.

**Lixo no cardápio** — "Lanche funcionario" a R$ 0,01 com 22 vendas/mês
(refeição de equipe entrando como venda, mexendo no ticket médio) e
"orangotango de borneu ( dinamico)", que é da outra empresa.

**Refrigerante lata** — 49,3% de margem com **601 vendas/mês**. É o mais
vendido e está abaixo da referência de 65%.

---

## 6. Armadilhas para quem mexer no código

1. **`prato_insumos.quantidade` é sempre na unidade base** (kg, l, un). A
   tela mostra g/ml/un. A conversão vive em `paraBase`/`paraTela` e em
   lugar nenhum mais. Dois caminhos de conversão = duas verdades.
2. **Trocar `insumos.unidade` não converte as fichas.** 0,15 em kg é 150 g;
   virando un, continua 0,15 — e passa a ser 0,15 unidade.
3. **Margem é sobre o preço de venda**: `preço = custo / (1 − margem)`.
   "Custo + 65%" dá 39% de margem real.
4. **A margem do cabeçalho é ponderada** pelo que vendeu, não é média das
   margens. Média simples daria 69,7% onde a casa faz 64,1%.
5. **Faturamento tem dois valores**: o que entrou no caixa e
   quantidade × preço de tabela. A diferença é desconto, combo e promoção
   (R$ 1.542,99 no mês).
6. **`esta_aprovado()` devolve false no SQL Editor.** Função `security
   definer` que depende dela retorna 0 linhas ali — é esperado, não é erro.
7. **Toda migração que escreve leva o `do $trava$`** conferindo
   `to_regclass('public.pratos')`. Já se rodou SQL do Mr Kong no projeto da
   Dinâmico.
8. **O editor do Supabase só mostra o último `select`.** Toda migração
   termina com uma conferência.
9. **Custo de hoje aplicado ao mês inteiro.** Certo para decidir preço
   (você quer a margem com o custo que vai pagar amanhã), errado para
   fechar mês contábil — ali vale o custo de cada compra na data dela.
