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
