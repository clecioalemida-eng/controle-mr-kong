import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.warn(
    "Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (arquivo .env local, ou nas Environment Variables do projeto na Vercel)."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Nome da tabela usada para armazenar os checklists preenchidos.
export const TABELA_CHECKLIST = "registros_checklist";

// Quando uma Edge Function responde com erro (status != 2xx), o
// supabase-js só entrega uma mensagem genérica ("Edge Function returned
// a non-2xx status code") no `error.message` — o motivo real fica dentro
// do corpo da resposta, em `error.context`. Essa função extrai o motivo
// de verdade, pra aparecer explicado na tela em vez de genérico.
export async function extrairErroFuncao(error) {
  if (!error) return "";
  if (error.context && typeof error.context.json === "function") {
    try {
      const corpo = await error.context.json();
      if (corpo?.error) return corpo.detalhe ? `${corpo.error} — ${JSON.stringify(corpo.detalhe)}` : corpo.error;
    } catch {
      // corpo não era JSON, ou já foi consumido — cai pra mensagem genérica abaixo
    }
  }
  return error.message || String(error);
}
