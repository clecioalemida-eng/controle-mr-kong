// src/lib/permissoes.js
//
// Catálogo das telas do painel e leitura das permissões do usuário logado.
//
// As chaves daqui são as MESMAS que existem em `cargo_permissoes` e nas
// funções pode_ver()/pode_editar() do banco — e, no caso das sub-abas do
// Financeiro, precisam bater exatamente com as chaves do array ABAS do
// Financeiro.jsx. Se divergirem, a permissão é salva num nome e conferida
// em outro, e nada funciona.
import { supabase } from "./supabaseClient";

export const CATALOGO = [
  { chave: "checklist", nome: "Checklist Operacional" },
  { chave: "dashboard", nome: "Dashboard",      sensivel: true },
  {
    // Gente e Gestão era uma chave só, e isso obrigava a escolher entre
    // dar TUDO ou NADA: quem podia montar a escala do dia também via
    // salário, matriz de cargos e folha de pagamento. As sub-abas aqui
    // precisam bater exatamente com as chaves do array SUBABAS do
    // Equipe.jsx — se divergirem, a permissão é salva num nome e
    // conferida em outro, e nada funciona.
    chave: "gente",
    nome: "Gente e Gestão",
    sensivel: true,
    filhos: [
      { chave: "gente.pessoas",   nome: "Pessoas" },
      { chave: "gente.salarios",  nome: "Salários e dados pessoais", sensivel: true },
      { chave: "gente.matriz",    nome: "Matriz de cargos",          sensivel: true },
      { chave: "gente.previsao",  nome: "Previsão de escala" },
      { chave: "gente.escala",    nome: "Escala do dia" },
      { chave: "gente.mensal",    nome: "Fechamento mensal",         sensivel: true },
      { chave: "gente.folha",     nome: "Folha de pagamento",        sensivel: true },
    ],
  },
  {
    chave: "financeiro",
    nome: "Financeiro",
    filhos: [
      { chave: "financeiro.vendas",      nome: "Vendas" },
      { chave: "financeiro.pedidos",     nome: "Pedidos" },
      { chave: "financeiro.pagamentos",  nome: "Pagamentos" },
      { chave: "financeiro.fechamento",  nome: "Fechamento",           sensivel: true },
      { chave: "financeiro.conferencia", nome: "Conferência de caixa" },
      { chave: "financeiro.contaspagar", nome: "Contas a pagar",       sensivel: true },
      { chave: "financeiro.dre",         nome: "DRE",                  sensivel: true },
      { chave: "financeiro.fiado",       nome: "Fiado" },
    ],
  },
  {
    chave: "supply",
    nome: "Supply Chain",
    filhos: [
      { chave: "supply.notas",    nome: "Notas" },
      { chave: "supply.compras",  nome: "Compras" },
      { chave: "supply.insumos",  nome: "Insumos" },
      { chave: "supply.fichas",   nome: "Fichas técnicas" },
      { chave: "supply.curvaabc", nome: "Curva ABC" },
    ],
  },
  {
    chave: "desempenho",
    nome: "Desempenho",
    filhos: [
      { chave: "desempenho.estacao",  nome: "Marcar produção" },
      { chave: "desempenho.produtos", nome: "Estação dos produtos" },
    ],
  },
  { chave: "marketing",       nome: "Marketing" },
  { chave: "comercial",       nome: "Comercial" },
  { chave: "sac",             nome: "SAC" },
];

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
  if (n === "ver" || n === "editar") return true;
  // Módulo com sub-abas abre quando QUALQUER sub-aba está liberada.
  //
  // Sem isso existe uma armadilha silenciosa: você libera "Escala do dia"
  // pra gerente, salva, e ela continua sem conseguir entrar — porque a
  // linha do módulo ficou em "—". O módulo não é uma permissão à parte;
  // ele é a porta pro que tem dentro. Se tem alguma coisa lá dentro que
  // a pessoa pode ver, a porta abre.
  const modulo = CATALOGO.find((m) => m.chave === chave);
  if (!modulo || !modulo.filhos) return false;
  return modulo.filhos.some((f) => {
    const nf = nivelDe(permissoes, f.chave);
    return nf === "ver" || nf === "editar";
  });
}

export function podeEditar(permissoes, chave) {
  return nivelDe(permissoes, chave) === "editar";
}
