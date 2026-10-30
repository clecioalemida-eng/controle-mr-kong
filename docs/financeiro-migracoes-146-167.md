# Migrações 146–167 — índice

Duas naturezas bem diferentes, e misturá-las é perigoso:

- **escreve** — muda dados ou estrutura. Roda uma vez, com atenção.
- **só lê** — diagnóstico. Pode rodar quando quiser, não altera nada.

Todas as que escrevem começam com o `do $trava$` conferindo
`to_regclass('public.pratos')` — já se rodou SQL do Mr Kong no projeto da
Dinâmico por engano.

A coluna "rodou" diz o que **eu vi acontecer** nesta conversa (resultado
colado, tela mudando). Onde está em branco, não é "não rodou" — é "não
tenho como afirmar".

| arquivo | o que faz | tipo | rodou |
|---|---|---|---|
| 146_permissao_formacao_precos | libera a aba para quem já vê o DRE | escreve | sim |
| 147_compras_dos_insumos | `compras_dos_insumos()`: última compra por insumo | escreve (função) | sim |
| 148_margem_real_vs_notas | margem da tela × margem pelas notas | só lê | sim |
| 149_insumos_sem_compra | insumos sem compra que estão em ficha | só lê | — |
| 150_fichas_impossiveis | pratos com custo maior que o preço | só lê | sim |
| 151_ovos_antes_de_mexer | o que cada ficha espera antes de mexer no ovo | só lê | sim |
| **152_origem_do_custo** | **origem do custo + gatilho da compra** | **escreve** | **sim** |
| 153_quantas_linhas | mede o teto de 1000 linhas (hipótese descartada) | só lê | sim |
| 154_pratos_gemeos | duplicados por parênteses no nome | só lê | sim |
| 155_copiar_ficha_dos_gemeos | copia a ficha do gêmeo pro que vende | escreve | sim |
| 156_conserta_o_ovo | ovo passa a custar por unidade, em manual | escreve | sim |
| 157_os_quatro_que_faltam | batata, tártaro, salsicha e ovo lado a lado | só lê | sim |
| 158_a_nota_da_batata | como a batata foi lançada nas notas | só lê | — |
| 159_procura_por_palavra | acha pratos por palavra (com e sem ficha) | só lê | — |
| 160_laranja_vira_suco | laranja medida em litro de suco | escreve | sim |
| 161_revenda_proposta | propõe fichas de revenda (não grava) | só lê | sim |
| 162_revenda_aplica | cria as fichas de revenda que passam nos filtros | escreve | sim |
| 163_revenda_falta_preco | quem ficou de fora do 162, e por quê | só lê | — |
| 164_confere_revenda | lista as fichas de revenda existentes | só lê | sim |
| 165_quanto_pagamos | histórico de compra de um insumo, por palavra | só lê | — |
| 166_corrente_da_compra | onde compra → estoque → custo está quebrada | só lê | — |
| **167_trava_compra_sem_preco** | **compra sem preço não entra** | **escreve** | **sim** |

## As duas que mudam o comportamento do sistema

**152** — cria `insumos.origem_custo` e `insumos.custo_manual`, as funções
`custo_pela_origem` / `aplicar_origem_custo` / `definir_custo_insumo`, e o
gatilho `compra_atualiza_custo_tg` em `movimentacoes_estoque`. A migração
**não recalcula nada**: só rotula o que existe, para nenhum número mudar
no dia. O `NotasFiscais.jsx` depende dela — ele deixou de escrever custo
porque o gatilho assumiu.

**167** — `check (tipo <> 'compra' or preco_unitario > 0)`, `NOT VALID`.
Vale do momento da criação em diante. Quando rodou, o banco informou que
**6 compras antigas** não passariam nela: mercadoria que entrou e nunca
virou custo.

## As que ficaram pendentes de leitura

`163` e `166` são as que mais rendem agora. O `163` lista cada produto de
revenda que não pôde virar ficha com o motivo escrito ("FALTA PREÇO no
insumo", "preço de EMBALAGEM"). O `166` mede os cinco pontos onde a
corrente compra → estoque → custo se rompe, incluindo **nota recebida e
não confirmada**, com o valor em reais — dinheiro que saiu do caixa e que
o DRE não está contando.
