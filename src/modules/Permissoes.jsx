// src/lib/permissoes.js
//
// Catálogo das telas do painel e leitura das permissões do usuário logado.
//
// As mesmas chaves usadas aqui existem na tabela `cargo_permissoes` e nas
// funções pode_ver()/pode_editar() do banco. Se você adicionar uma tela
// nova, adicione a chave aqui — é isso que faz ela aparecer na matriz de
// permissões, sem precisar mexer em SQL.
import { supabase } from "./supabaseClient";

export const CATALOGO = [
  { chave: "checklist", nome: "Checklist Operacional" },
  {
    chave: "financeiro",
    nome: "Financeiro",
    filhos: [
      { chave: "financeiro.dashboard",   nome: "Dashboard",            sensivel: true },
      { chave: "financeiro.vendas",      nome: "Vendas" },
      { chave: "financeiro.pedidos",     nome: "Pedidos" },
      { chave: "financeiro.pagamentos",  nome: "Pagamentos" },
      { chave: "financeiro.fechamento",  nome: "Fechamento",           sensivel: true },
      { chave: "financeiro.fichas",      nome: "Fichas técnicas" },
      { chave: "financeiro.notas",       nome: "Notas" },
      { chave: "financeiro.compras",     nome: "Compras" },
      { chave: "financeiro.equipe",      nome: "Equipe",               sensivel: true },
      { chave: "financeiro.conferencia", nome: "Conferência de caixa" },
      { chave: "financeiro.contas",      nome: "Plano de Contas",      sensivel: true },
      { chave: "financeiro.fiado",       nome: "Fiado" },
      { chave: "financeiro.curvaabc",    nome: "Curva ABC" },
    ],
  },
  { chave: "marketing",       nome: "Marketing" },
  { chave: "comercial",       nome: "Comercial" },
  { chave: "sac",             nome: "SAC" },
  { chave: "rastreabilidade", nome: "Rastreabilidade" },
];

// Lista achatada, útil pra percorrer tudo de uma vez
export const TODAS_AS_CHAVES = CATALOGO.flatMap((m) => [m.chave, ...(m.filhos || []).map((f) => f.chave)]);

export function nomeDaChave(chave) {
  for (const m of CATALOGO) {
    if (m.chave === chave) return m.nome;
    for (const f of m.filhos || []) if (f.chave === chave) return `${m.nome} › ${f.nome}`;
  }
  return chave;
}

// Carrega as permissões do usuário. Administrador não consulta nada:
// ele passa por cima de qualquer cargo, igualzinho ao que a função
// nivel_acesso() faz no banco. As duas pontas precisam concordar.
export async function carregarPermissoes(perfil) {
  if (perfil?.is_admin) return { admin: true, mapa: {}, cargoId: perfil.cargo_id || null };
  if (!perfil?.cargo_id) return { admin: false, mapa: {}, cargoId: null };
  const { data } = await supabase
    .from("cargo_permissoes")
    .select("chave, nivel")
    .eq("cargo_id", perfil.cargo_id);
  const mapa = {};
  (data || []).forEach((r) => { mapa[r.chave] = r.nivel; });
  return { admin: false, mapa, cargoId: perfil.cargo_id };
}

export function nivelDe(permissoes, chave) {
  if (permissoes?.admin) return "editar";
  return permissoes?.mapa?.[chave] || "nenhum";
}

export function podeVer(permissoes, chave) {
  const n = nivelDe(permissoes, chave);
  return n === "ver" || n === "editar";
}

export function podeEditar(permissoes, chave) {
  return nivelDe(permissoes, chave) === "editar";
}
