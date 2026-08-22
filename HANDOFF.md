# Painel Mr. Kong — estado do projeto (handoff v2)

Substitui o handoff anterior, que está desatualizado em quase tudo que
importa. Cole este arquivo no início da próxima sessão.

Última atualização: 22/08/2026.

---

## Visão geral

App interno de gestão do **Mr Kong Fast Food** (Rio Verde, GO). Login por
e-mail/senha, com aprovação de administrador. Página inicial com cards de
módulo, cada um liberado por **cargo**.

## Stack e endereços

- **Frontend**: React 18 + Vite → Vercel (`controle-mr-kong.vercel.app`)
- **Backend**: Supabase — projeto **`wujyqamgzvhsjlojscmt`**
- **Repo**: `github.com/clecioalemida-eng/controle-mr-kong` (público)
- **APIs externas**: CardápioWeb (`X-API-KEY`), Anthropic (OCR de notas,
  `claude-haiku-4-5-20251001`)

**Atenção à estrutura**: os arquivos ficam em `src/` e `supabase/` na
**raiz** do repositório. O handoff antigo falava em `scaffold/`, que não
existe mais.

## Fluxo de trabalho estabelecido

- **Mostrar mockup antes de codar.** Pedido explícito do usuário, em vigor
  desde sempre. Desenhar a tela (HTML/SVG), confirmar, só depois escrever.
- **O usuário edita pelo GitHub no navegador**, arquivo por arquivo, pelo
  ícone de lápis. Sempre entregue arquivo inteiro, nunca diff.
  Link direto que economiza tempo:
  `github.com/clecioalemida-eng/controle-mr-kong/edit/main/CAMINHO`
  Para arquivo novo: `.../new/main/PASTA`
- **Ordem importa no deploy**: arquivos novos primeiro, arquivos que os
  importam por último. Build quebrado não derruba o site — a Vercel mantém
  o último deploy verde.
- **`.sql` vai no Supabase, `.jsx`/`.js` vai no GitHub.** Já houve confusão.
- **Migração SQL primeiro, código depois**, quando a tela depende de tabela
  ou coluna nova.
- **Cache do Safari engana muito.** Quando o usuário disser "não apareceu",
  peça para testar em janela privada (Cmd+Shift+N) antes de investigar.
- **Não confie em ferramenta de leitura de web para ler código.** Ela
  resume em vez de devolver verbatim, e já mentiu ("o arquivo não contém X"
  quando continha). Peça o arquivo colado ou anexado.
- Erros de runtime aparecem como tela branca — peça o print do Console
  (Desenvolver → Mostrar Console de JavaScript).

## Pessoas

| Nome | Papel |
|---|---|
| Clécio | Administrador (dono) |
| Cristiane | Administradora — `financeiromrkong@gmail.com` |
| Jackelyne | Gerente — `jackborgesramos@gmail.com` |

Confirmação de e-mail no Supabase está **desligada** (Authentication →
Sign In / Providers → Email). Foi desligada porque o limite de envio do
plano Free bloqueava o cadastro da equipe. Quem se cadastra entra direto
na fila de aprovação.

---

## Módulos (tabela `modulos` + `COMPONENTES_MODULO` em App.jsx)

| chave | nome | componente |
|---|---|---|
| `checklist` | Checklist Operacional | ChecklistOperacional.jsx |
| `dashboard` | Dashboard | DashboardModulo.jsx → Dashboard.jsx |
| `gente` | Gente e Gestão | GenteGestao.jsx → Equipe.jsx |
| `financeiro` | Financeiro | Financeiro.jsx |
| `supply` | Supply Chain | SupplyChain.jsx |
| `marketing` | Marketing | Marketing.jsx |
| `comercial` | Comercial | Comercial.jsx |
| `sac` | SAC | Sac.jsx |

`Rastreabilidade.jsx` ficou órfão (o módulo virou `supply`). Pode apagar.

### Financeiro — 7 sub-abas
Vendas, Pedidos, Pagamentos, Fechamento, Conferência de caixa, Plano de
Contas, Fiado.

### Supply Chain — 4 sub-abas
Notas, Compras (Estoque.jsx), Fichas técnicas, Curva ABC.

### Gente e Gestão — 5 sub-abas (dentro de Equipe.jsx)
Pessoas, Matriz de cargos (só admin), Previsão de escala, Escala do dia,
Fechamento mensal (só admin).

---

## Permissões (o pedaço mais novo e mais delicado)

**A permissão mora no CARGO, não na pessoa.** A `acessos_modulo` antiga
(por usuário) continua no banco mas não é mais consultada.

**Tabelas**: `cargos`, `cargo_permissoes` (cargo × chave × nível),
`perfis.cargo_id`.

**Níveis**: `nenhum` | `ver` | `editar`.

**Chaves**: `financeiro`, `financeiro.vendas`, `supply.notas`, etc. Elas
precisam bater **exatamente** entre três lugares:
`src/lib/permissoes.js` (CATALOGO), o array `ABAS` do componente, e o que
está gravado em `cargo_permissoes`. Divergiu, nada funciona — já aconteceu
com `financeiro.compras` vs `financeiro.estoque`.

**Funções SQL**: `nivel_acesso(chave)`, `pode_ver(chave)`,
`pode_editar(chave)`. Administrador (`is_admin`) passa por cima de tudo,
tanto na tela quanto no banco.

**Tela**: `src/modules/Permissoes.jsx` — card na home, só admin. Duas
abas: Cargos (com matriz de níveis) e Usuários (aprovar + atribuir cargo).
Substituiu o antigo Painel Admin, que não existe mais. O sino do topo abre
essa tela na aba Usuários.

**Cargos existentes**: Administrador (protegido), Gerente, Caixa, Garçom,
Chapeiro, Barman, Cozinheiro, Entregador, Marketing.

**Armadilha conhecida**: salvar um cargo na tela grava TODAS as chaves,
inclusive as em "—", que viram `nenhum` no banco. Isso faz migração com
`on conflict do nothing` não conseguir mais preencher aquele cargo. Se
precisar completar um cargo já salvo, use
`do update ... where nivel = 'nenhum'`.

**Limitação atual**: o nível `ver` só decide se a aba aparece. Ele **não**
trava edição dentro da tela — para isso seria preciso mexer em cada um dos
componentes internos. Use `—` para o que a pessoa não pode alcançar.

---

## Cache do CardápioWeb (resolve o limite de 5 consultas/minuto)

O endpoint de histórico do CardápioWeb aceita 5 consultas por minuto. Era
ele que derrubava Dashboard, Pagamentos e Curva ABC.

**Tabelas**: `vendas_diarias` (total e qtd por dia, para o Dashboard),
`pedidos_cache` (detalhe cru de cada pedido, em jsonb), `dias_sincronizados`
(marca dia completo — existe separado porque dia sem venda não gera linha
em `pedidos_cache`).

**Quem popula**: Edge Function `sincronizar-vendas-diarias`. Roda via
pg_cron às **07:00 UTC = 04:00 BRT**, e manualmente pelo botão "Popular
histórico inicial" do Dashboard (fatias de 4 dias).

**Quem lê**: o `cardapioweb-proxy` consulta o cache antes de ir à
internet — dia já sincronizado vem do banco. O proxy **só lê**, nunca
grava: gravar dia pela metade (como a janela 17h–03h da taxa de serviço)
corromperia o cache silenciosamente.

**Detalhes que custaram tempo**: `pg_net` está no schema `net` (não
`public`, apesar do que o painel de Extensions mostra). O cron chama a
função com a anon key no header `Authorization`, porque o Verify JWT está
ligado.

---

## Notas fiscais — aprendizado e travas

**OCR** lê a nota via Anthropic. Casa item por nome exato → sinônimo
aprendido → aproximação.

**`produto_regras`** (migração 038): aprende **como o produto vem
embalado**. Guarda o significado (20 pacotes × 50 un, preço por pacote) e
também os **fatores** (razão entre o que a IA leu e o que estava certo).
São os fatores que se aplicam na próxima nota — guardar o número absoluto
erraria quando o volume da compra mudasse. Detecta o padrão `20X50U` do
próprio nome do produto e sugere.

**Trava de implausibilidade**: bloqueia o botão de confirmar quando um
item vale mais que o total da nota ou dez vezes a maior nota já
registrada. Não depende de regra nenhuma. Foi construída depois de uma
nota vir com R$ 270.000,00 em copos descartáveis.

**`reverter_conferencia_nota(uuid)`** (migrações 049/050): desfaz a
conferência de uma nota confirmada — apaga a conta a pagar e a
movimentação de estoque, devolve o status. Atômica, só admin, bloqueia se
houver pagamento lançado em `pagamentos_conta`. O botão fica na lista de
notas, só para admin. **O custo médio do insumo não volta** — é
sobrescrito na confirmação e o valor anterior não é guardado em lugar
nenhum.

**Valor do documento** agora é sincronizado com a soma dos itens na
confirmação (migração 051). Antes, o número lido do cabeçalho ficava para
sempre, e a lista mostrava valores que não correspondiam a nada.

---

## Escala do dia — ponto

`presencas_diarias` ganhou `hora_entrada`, `hora_saida` e
`intervalo_minutos` (migração 044). Preenchendo entrada e saída, as horas
são calculadas; sem elas, o campo de horas continua digitado à mão (para
não quebrar dias antigos).

**Vira o dia**: saída menor que entrada é tratada como madrugada do dia
seguinte. A casa trabalha 17h–03h, então isso é o caso comum.

As horas alimentam o **peso** do rateio da taxa de serviço (horas ÷ 8 =
peso 1). Ou seja, o número tem consequência no pagamento.

**A trava que o usuário pediu já existia**: escala salva abre em modo
leitura, e só admin vê o botão de editar.

---

## Checklist Operacional

Itens vêm de `checklist_itens` (departamento × turno × texto × ordem).

**Mudança importante**: a lista de departamentos agora sai do **banco**,
não de um objeto fixo no código. O `APARENCIA` no topo do
`ChecklistOperacional.jsx` é só visual (nome bonito, ícone, cor). Cargo
que não estiver lá funciona igual, só herda nome capitalizado e ícone
genérico.

**"+ Novo cargo"** no Editar checklist cria departamento pela tela. O
nome é convertido para minúsculo sem acento (`Entregador` → `entregador`),
porque a coluna tem constraint de formato (migração 045 trocou a lista
fixa antiga por validação de formato).

**Departamentos hoje**: caixa, bar, chapa, gerencia, garcom.

---

## Migrações (036 em diante — as anteriores estão no handoff antigo)

| # | Conteúdo |
|---|---|
| 036 | `vendas_diarias` + agendamento pg_cron (substitui a 035, que tinha placeholders) |
| 037 | `pedidos_cache` + `dias_sincronizados` |
| 038 | `produto_regras` (regras de embalagem) |
| 039 | `cargos`, `cargo_permissoes`, `perfis.cargo_id`, funções de acesso |
| 040 | conserta o vínculo pessoa→cargo (a 039 tentava adivinhar pelo texto de `perfis.cargo`, que estava NULL) |
| 041 | cargos da operação — **nunca rodou**, substituída pela 047/048 |
| 042 | Cristiane admin, Jackelyne gerente, limpa cargos "Importado" |
| 043 | Dashboard e Gente e Gestão viram módulos; corrige chaves `estoque`/`contaspagar` |
| 044 | ponto na escala (`hora_entrada`, `hora_saida`, `intervalo_minutos`) |
| 045 | checklist do Garçom + troca a constraint de departamento por validação de formato |
| 046 | Supply Chain (renomeia `rastreabilidade`, migra as 4 sub-abas) |
| 047 | cargos operacionais (falhou parcialmente por causa das linhas `nenhum`) |
| 048 | preenche só o que estava em `nenhum` |
| 049 | `reverter_conferencia_nota()` |
| 050 | corrige a trava da reversão (era `valor_pago > 0`, virou `pagamentos_conta`) |
| 051 | sincroniza `documentos_compra.valor_total` com a soma dos itens |

---

## Edge Functions

- **`cardapioweb-proxy`** — proxy autenticado, lê o cache antes de ir à
  API. Ações: `resumo_financeiro` (padrão), `importar_pratos`,
  `taxa_servico_dia`, `diagnostico_marketing`.
- **`processar-documento-compra`** — OCR de nota via Anthropic.
- **`sincronizar-vendas-diarias`** — job de fundo, popula os três caches.
  Usa `SUPABASE_SERVICE_ROLE_KEY`, não exige usuário logado.

Secrets: `CARDAPIOWEB_API_TOKEN`, `ANTHROPIC_API_KEY`.

---

## Pendências conhecidas

1. **Curva ABC ainda não usa o cache de forma direta** — ela chama o
   `resumo_financeiro`, que agora lê `pedidos_cache`, então na prática já
   melhorou. Mas períodos longos com cache incompleto ainda podem falhar.
2. **Carga inicial do histórico** — confirmar se foi rodada e se o cron
   das 4h está funcionando (`select dia, atualizado_em from vendas_diarias
   order by dia desc limit 3`).
3. **Nível `ver` não trava edição** dentro das telas. Seria preciso mexer
   em ContasPagar, Estoque, ConferenciaCaixa, etc.
4. **RLS por cargo nas tabelas sensíveis** — nunca foi escrito. A migração
   022 tem políticas antigas que ninguém revisou. Rodar
   `select * from pg_policies where schemaname='public'` antes de mexer.
5. **Custo médio não tem histórico** — impede reversão completa de nota.
6. **DRE completo** e **conciliação bancária** — mencionados desde o
   início, nunca construídos.
7. **Mostarda da ONIX** ficou como "2 un" em vez de convertida para
   sachês. Corrigir na próxima compra, criando a regra de embalagem.
8. **Módulos ainda placeholder**: Comercial, SAC. Marketing tem
   arquivos novos (`PistaMarketing.jsx`, `DiagnosticoSocial.jsx`,
   `RadarConcorrentes.jsx`) criados fora desta sessão — estado desconhecido.
9. **Tem outro assistente commitando no mesmo repositório.** Vários
   arquivos apareceram sozinhos durante a sessão, e um `Dashboard.jsx`
   chegou a ser sobrescrito. Vale combinar quem mexe em quê.

---

## Variáveis e acesso

- **Vercel**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — redeploy
  manual depois de mudar (Vite lê em tempo de build).
- **Anon key**: Supabase → Settings → API Keys → aba **Legacy API Keys** →
  `anon`. É a chave JWT (`eyJ...`), não a `publishable`. As legacy serão
  descontinuadas no fim de 2026 — migrar é uma tarefa futura.
- **Primeiro admin**:
  `update public.perfis set is_admin = true, status = 'aprovado' where email = '...';`
