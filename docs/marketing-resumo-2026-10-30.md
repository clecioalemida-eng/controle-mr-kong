# Marketing · Painel Mr Kong — resumo (30/10/2026)

Este resumo é só do Mr Kong. A Dinâmico Construtora é outro painel, outro
projeto Supabase e outro repositório. Nada daqui vale para lá.

## Onde fica

- Painel: https://controle-mr-kong.vercel.app (React/Vite, módulos em `src/modules/`).
- Supabase: projeto mr kong (`wujyqamgzvhsjlojscmt`).
- Código local: `/Users/cleci/Downloads/controle-mr-kong`.
- Página do Facebook: Mr Kong Rio Verde (ID `879092795279114`). Em 30/10 só o
  Instagram estava conectado a ela, nenhum WhatsApp (conferido em Business
  Manager → Páginas → Ativos conectados).

## Números de WhatsApp (a documentação está desencontrada)

| Número | O que é |
|---|---|
| +55 64 9246-8524 | Número do agente (API oficial). Confirmado por "Testar ligação com a Meta": qualidade alta, app inscrito, webhook `.../functions/v1/whatsapp-agente`. No Business Manager aparece como **Conectado**, qualidade **Alta**. O CLAUDE.md diz que é o número real desde 22/09. |
| 5564992010442 (99201-0442) | Aparece como "Pedidos · Meta / oficial" em `supabase/064_linhas_de_whatsapp.sql` e em `docs/PAINEL-MR-KONG-contexto.md`. Também está no portfólio do Business Manager. Ver a correção abaixo. |
| 5564992667645 (99266-7645) | Linha "Balcão" (QR). |
| (64) 99227-3857 | Apareceu já preenchido ao vincular WhatsApp na Página pelo Facebook (✓ verde, ou seja, existe num app de WhatsApp). Falta descobrir de quem é. |

A corrigir: a doc e a seed 064 ainda tratam o 99201-0442 como o número oficial.

### Correção medida em 30/10 (tela "Conectar WhatsApp" da Página no Facebook)

- **9246-8524** → aviso vermelho: "Esse número não está associado a uma conta
  do WhatsApp ou WhatsApp Business". É só-API, não dá para vincular por ali.
- **99201-0442** → **✓ verde**: o número existe num app de WhatsApp em algum
  celular. A seed 064 diz "não toca em celular", e isso não confere. Dá para
  vincular à Página por código, desde que alguém ache o aparelho.
  **Ninguém sabe onde esse celular está.** Não vincular antes de achar, senão
  o anúncio manda cliente para um WhatsApp que ninguém olha.

## Problema aberto: anúncio "Mensagens no WhatsApp" no Patrocinar

Sintoma: o X-Tudo (29/10, 17:14) e o teaser de 22/10 falharam. Os anúncios de
"Visitas ao cardápio" publicam normalmente (22/10 e 27/10).

Os dois erros da Meta:

- **100 / 2446886** (sem número indicado): a Página não tem WhatsApp vinculado.
- **100 / 1487246** (com número indicado): "This WhatsApp phone number is not
  linked to your account".

Causa raiz: a Meta exige que o número esteja ligado à Página para fazer
anúncio de conversa, e nenhum número está.

- Ligar o 9246-8524 pelo Facebook (Configurações da Página → WhatsApp) não
  funciona: a Meta manda o código pelo WhatsApp, e um número só-API não recebe.
- Trocar o número em "Configuração do patrocínio" (`cfg.whatsapp_numeros`, que
  alimenta a lista "Para qual WhatsApp" do `Patrocinar.jsx`) sozinho não
  resolve, porque cai no mesmo erro 1487246.
- O menu "Conectar ativos" da Página no Business Manager só oferece Instagram.

Caminhos possíveis, do mais rápido ao mais demorado:

1. **Usar "Visitas ao cardápio" para vender.** Funciona hoje e leva direto ao
   link de pedido.
2. **Achar o celular do 99201-0442** (mandar mensagem ou ligar para ele e ver
   quem responde), receber o código e vincular a Página. Aí o anúncio leva
   para esse aparelho, com uma pessoa atendendo, não o agente.
3. **Business Manager:** em business.facebook.com/settings → Contas do
   WhatsApp → +55 64 9246-8524 → More ▾, procurar "Ativos conectados" ou
   "Página do Facebook" para ligar a Página sem código. Foi pedido um print
   desse menu, e ele ainda não foi enviado.
4. **Concluir a coexistência:** "Conectar WhatsApp do Kong" no CRM, com o
   celular na mão. Pendente desde 22/09; o painel mostra "WhatsApp do Kong ·
   não conectado". Com o app e a API no mesmo número, o código passa a chegar
   e a Página pode ser vinculada.

Depois de vincular, ajustar `cfg.whatsapp_numeros` para o número vinculado e
tentar de novo.

## Outros pontos

- **Possível golpe:** em `wa_mensagens` (id 4480, 29/10) chegou uma
  "notificação extrajudicial" de cobrança em nome de "Oesa Comércio e
  Representações S/A", com prazo de 24h e telefone (47) 3026-6097. É um
  padrão comum de golpe. Conferir com o contador ou advogado antes de
  qualquer contato ou pagamento, e não responder pelo agente.
- **Texto fixo no CRM:** a frase "o agente está no número de teste" em
  `CrmAgente.jsx` (linha 196, e o botão "Voltar para o número de teste") está
  escrita direto no código e não reflete a realidade (o agente já está no
  9246-8524).

## Regras que valem sempre

- Nunca pedir token colado no chat. Segredo fica no Vault ou nos secrets da
  Edge Function, nunca no código nem no navegador.
- Nada de disparo em massa nem de WhatsApp Web automatizado.
- `whatsapp-agente` e `crm-campanhas` não estão versionados. Não alterar de
  memória: pedir a versão no ar antes.
- O Claude não publica, não patrocina e não muda verba pelo chat. O painel
  prepara, a pessoa aprova e o painel chama a API.
- Confirmar com o Clecio antes de commitar direto.
- Português do Brasil. Diagnosticar antes de propor.
