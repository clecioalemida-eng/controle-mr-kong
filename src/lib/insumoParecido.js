// ===== insumoParecido.js =====
// Diz se dois nomes de produto parecem o mesmo produto.
//
// Usado em toda tela que cria insumo (Insumos, Compras, Notas) e na fila
// "Arrumar o cadastro", para avisar ANTES de nascer um duplicado. O banco
// só barra o nome igual escrito de outro jeito (migração 195); aqui a
// conversa é sobre "BATATA 7MM MCCAIN" ser a "Batata palito".
//
// A conta é simples e previsível: tira acento, número, unidade e palavra
// vazia, e vê quantas palavras os dois nomes têm em comum (palavras com o
// mesmo começo contam: "mussarela" e "mussarelas", "frit" e "fritas").

const VAZIAS = new Set([
  "de", "da", "do", "das", "dos", "com", "sem", "para", "pra", "tipo", "e", "em", "a", "o",
  "kg", "g", "gr", "grs", "ml", "l", "lt", "lts", "un", "und", "unid", "cx", "pct", "pc", "pcte", "fd", "pa",
  "sc", "saco", "pacote", "caixa", "fardo", "bandeja", "pote", "lata", "garrafa", "frasco",
  "c", "s", "x", "ii", "iii", "tradicional", "especial", "extra",
]);

// mesma conta do banco (nome_chave, migração 195)
export function chaveNome(texto) {
  return String(texto || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function palavras(texto) {
  return chaveNome(texto).split(" ")
    .filter((p) => p.length >= 3 && !/\d/.test(p) && !VAZIAS.has(p))
    .map((p) => (p.length > 4 && p.endsWith("s") ? p.slice(0, -1) : p));
}

function mesmaPalavra(a, b) {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  return n >= 4 && a.slice(0, Math.max(4, n - 2)) === b.slice(0, Math.max(4, n - 2));
}

// 0 a 1: quanto do nome mais curto aparece no outro
export function parecenca(a, b) {
  if (chaveNome(a) === chaveNome(b)) return 1;
  const pa = [...new Set(palavras(a))], pb = [...new Set(palavras(b))];
  if (!pa.length || !pb.length) return 0;
  const comuns = pa.filter((x) => pb.some((y) => mesmaPalavra(x, y)));
  if (!comuns.length || !comuns.some((x) => x.length >= 4)) return 0;
  return comuns.length / Math.min(pa.length, pb.length);
}

// Os cadastrados que parecem `nome`. `insumos`: [{ id, nome, ... }].
// `sinonimos`: [{ nome_variante, insumo_id }] — um nome que a nota já
// trouxe para aquele insumo também conta.
export function parecidos(nome, insumos, { sinonimos = [], limite = 5, minimo = 0.5, excluir = null } = {}) {
  const alvo = String(nome || "").trim();
  if (alvo.length < 3) return [];
  const porInsumo = new Map();
  (sinonimos || []).forEach((s) => {
    if (!porInsumo.has(s.insumo_id)) porInsumo.set(s.insumo_id, []);
    porInsumo.get(s.insumo_id).push(s.nome_variante);
  });
  return (insumos || [])
    .filter((i) => i.id !== excluir)
    .map((i) => {
      const nomes = [i.nome, ...(porInsumo.get(i.id) || [])];
      let melhor = 0, pelo = i.nome;
      nomes.forEach((n) => { const p = parecenca(alvo, n); if (p > melhor) { melhor = p; pelo = n; } });
      return { ...i, nota: melhor, pelo: pelo !== i.nome ? pelo : null };
    })
    .filter((i) => i.nota >= minimo)
    .sort((a, b) => b.nota - a.nota || a.nome.length - b.nome.length)
    .slice(0, limite);
}
