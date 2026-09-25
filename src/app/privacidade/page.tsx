// src/app/privacidade/page.tsx
//
// Página pública de política de privacidade. Existe por exigência da Meta para
// a análise do app, e fica fora da área logada de propósito: os rastreadores
// dela precisam abrir sem login e sem bloqueio geográfico.
export const metadata = {
  title: "Política de Privacidade · Painel Mr Kong",
  description: "Como o Painel Mr Kong trata dados obtidos das plataformas da Meta.",
};

const ATUALIZADO = "25 de setembro de 2026";

export default function Privacidade() {
  return (
    <main style={{
      maxWidth: 760, margin: "0 auto", padding: "48px 20px 80px",
      font: "16px/1.7 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      color: "#15202b",
    }}>
      <h1 style={{ fontSize: 28, margin: "0 0 6px" }}>Política de Privacidade</h1>
      <p style={{ color: "#6b7a90", margin: "0 0 32px", fontSize: 14 }}>
        Painel Mr Kong · atualizado em {ATUALIZADO}
      </p>

      <h2 style={{ fontSize: 19, marginTop: 32 }}>Quem somos</h2>
      <p>
        O Painel Mr Kong é um sistema interno da <b>MR. KONG FAST FOOD LTDA</b>, usado apenas por
        funcionários e responsáveis da própria empresa para acompanhar marketing, operação e
        resultados do negócio. Ele não é oferecido ao público, não tem cadastro aberto e não presta
        serviço a terceiros.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 32 }}>Que dados o app acessa nas plataformas da Meta</h2>
      <p>Com autorização da própria empresa, o painel lê:</p>
      <ul>
        <li>dados das <b>contas de anúncios da empresa</b>: campanhas, verba, gasto, impressões, cliques e conversas geradas;</li>
        <li>dados das <b>páginas do Facebook e perfis do Instagram da empresa</b>: publicações, data, curtidas e comentários em números agregados;</li>
        <li>informações de configuração necessárias para criar anúncios, como identificação de página e de conta.</li>
      </ul>
      <p>
        O painel também <b>cria e gerencia anúncios nas contas da própria empresa</b>, sempre após
        aprovação de uma pessoa responsável dentro do sistema. Nenhuma publicação ou anúncio é criado
        automaticamente.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 32 }}>Que dados o app NÃO acessa</h2>
      <ul>
        <li>Não acessa dados de contas, páginas ou perfis de outras empresas.</li>
        <li>Não coleta nem armazena mensagens privadas, telefones, e-mails ou endereços de clientes obtidos da Meta.</li>
        <li>Não monta listas de pessoas para prospecção e não faz upload de públicos personalizados.</li>
        <li>Não usa dados de perfis de pessoas físicas para publicidade individualizada.</li>
      </ul>

      <h2 style={{ fontSize: 19, marginTop: 32 }}>Como os dados são guardados</h2>
      <p>
        Os dados ficam em banco de dados hospedado no Supabase, com acesso restrito por regras no
        próprio banco: apenas administradores da empresa leem informações financeiras. As credenciais
        de acesso às APIs ficam em cofre de segredos do servidor, nunca no navegador e nunca no código.
        O acesso ao painel exige login individual.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 32 }}>Por quanto tempo</h2>
      <p>
        Métricas de anúncios e de publicações são mantidas enquanto forem úteis para comparação
        histórica do negócio. Qualquer dado pode ser apagado a pedido do responsável da empresa.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 32 }}>Compartilhamento</h2>
      <p>
        Não vendemos, alugamos nem compartilhamos esses dados com terceiros. Eles são usados somente
        para a gestão do próprio negócio.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 32 }}>Exclusão de dados</h2>
      <p>
        Para solicitar a exclusão dos dados tratados por este app, envie um e-mail para o contato
        abaixo identificando a solicitação. O atendimento é feito em até 30 dias.
      </p>

      <h2 style={{ fontSize: 19, marginTop: 32 }}>Contato</h2>
      <p>
        MR. KONG FAST FOOD LTDA — Rio Verde, GO<br />
        E-mail: <a href="mailto:cleciog@hotmail.com" style={{ color: "#2d5f9e" }}>cleciog@hotmail.com</a>
      </p>
    </main>
  );
}
