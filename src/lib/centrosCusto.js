// ===== centrosCusto.js =====
// Os destinos de "não é estoque": os centros de custo do Contas a pagar,
// que se editam em DRE → Listas → Centros de custo (tabela listas_opcoes),
// menos "Insumos" (esse é o estoque), mais "Não é produto" (desconto, Pix,
// linha de pagamento: só acerta o total da nota).
//
// Usado pela fila "Arrumar o cadastro" e pelo "Não é insumo" da
// conferência de notas, para os dois mostrarem a mesma lista (migração 200).

import { supabase } from "./supabaseClient";

// mesmo padrão do ContasPagar.jsx, usado se a lista do banco estiver vazia
const PADRAO = [
  { valor: "pessoas", rotulo: "Pessoas" },
  { valor: "utensilios", rotulo: "Utensílios" },
  { valor: "manutencao", rotulo: "Consertos e manutenção" },
  { valor: "imobilizado", rotulo: "Imobilizado" },
  { valor: "ocupacao", rotulo: "Ocupação" },
  { valor: "utilidades", rotulo: "Utilidades" },
  { valor: "impostos", rotulo: "Impostos e taxas" },
  { valor: "marketing", rotulo: "Marketing e vendas" },
  { valor: "administrativo", rotulo: "Administrativo" },
];
const NAO_PRODUTO = { valor: "nao_produto", rotulo: "Não é produto" };

// exemplo curto ao lado de cada centro conhecido
export const AJUDA_CENTRO = {
  pessoas: "entregador, freela, refeição da equipe",
  utensilios: "pegador, panela, limpeza",
  manutencao: "peça, técnico, conserto",
  imobilizado: "fritadeira, freezer, chapa",
  ocupacao: "aluguel, condomínio",
  utilidades: "energia, água, gás, internet",
  impostos: "guias, taxas",
  marketing: "anúncio, panfleto, brinde",
  administrativo: "bloco de recibo, papelaria, sistema",
  nao_produto: "desconto, Pix, taxa da nota",
};

let cache = null;
export async function buscarCentrosDespesa() {
  if (cache) return cache;
  const { data, error } = await supabase
    .from("listas_opcoes").select("valor, rotulo, ordem")
    .eq("lista", "centro_custo").eq("ativo", true).order("ordem");
  const base = !error && data && data.length ? data : PADRAO;
  cache = [...base.filter((c) => c.valor !== "insumos" && c.valor !== "nao_produto"), NAO_PRODUTO];
  return cache;
}
export const CENTROS_DESPESA_PADRAO = [...PADRAO, NAO_PRODUTO];
