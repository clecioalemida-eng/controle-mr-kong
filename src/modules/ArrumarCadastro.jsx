// ===== ArrumarCadastro.jsx =====
// Supply Chain → Arrumar o cadastro.
//
// Objetivo: cada produto existe uma vez, e todo produto comprado tem para
// onde ir (ficha de prato, revenda, embalagem, ou uso e limpeza). A fila
// some conforme o cadastro fica limpo.
//
// Dados: cadastro_insumos_raio() (migração 195). As decisões "não são o
// mesmo", "manter" e "é despesa mesmo" ficam em cadastro_decisoes, para
// a fila não perguntar de novo.
//
// Quatro blocos:
//   1. Pares sugeridos — um nome comprado sem ficha e um nome em ficha
//      nunca comprado que parecem o mesmo produto. Juntar usa
//      juntar_e_lembrar(): leva ficha, estoque e compras para um só e
//      guarda o nome antigo como sinônimo, para a próxima nota cair certo.
//   2. Comprado sem ficha — para onde ele vai? (o tipo do insumo)
//   3. Soltos — sem compra e sem ficha: excluir ou manter
//   4. Entrou como "não é insumo" — ligar a um produto (só vale para as
//      próximas notas; as já confirmadas não voltam ao estoque)

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { parecenca, chaveNome, parecidos } from "../lib/insumoParecido";
import { TIPOS_INSUMO, EscolherTipo, esquecerInsumos } from "./AvisoParecidos";

const ESCURO = "#22231F", CINZA = "#8A8778";

function brl(v) { return (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function dataBR(d) { if (!d) return ""; const [y, m, dd] = String(d).slice(0, 10).split("-"); return `${dd}/${m}/${y.slice(2)}`; }

export default function ArrumarCadastro({ irPara }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(null);
  // A resposta aparece NA LINHA clicada: o aviso só no topo ficava fora da
  // tela de quem estava no meio da lista, e parecia que nada acontecia.
  const [naLinha, setNaLinha] = useState(null); // { id, erro?, ok? }

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.rpc("cadastro_insumos_raio");
    if (error) {
      setErro(/does not exist|schema cache|Could not find/i.test(error.message || "")
        ? "Falta rodar a migração 195 no Supabase." : error.message);
      return;
    }
    setDados(data);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const decidir = async (chave, decisao) => {
    const { error } = await supabase.from("cadastro_decisoes").upsert({ chave, decisao }, { onConflict: "chave" });
    if (error) throw new Error(/relation .* does not exist|schema cache/i.test(error.message || "") ? "Falta rodar a migração 195 no Supabase." : error.message);
    return true;
  };
  const agir = async (id, fn) => {
    setOcupado(id); setErro(""); setAviso(""); setNaLinha(null);
    try {
      const ok = await fn();
      if (ok === false) throw new Error("Não deu para gravar a decisão.");
    } catch (e) {
      const texto = e?.message || e?.details || String(e);
      setNaLinha({ id, erro: texto });
      setOcupado(null);
      return;
    }
    esquecerInsumos();
    await carregar();
    setOcupado(null);
  };
  const Resposta = ({ id }) => (naLinha && naLinha.id === id && naLinha.erro ? (
    <div style={{ width: "100%", fontSize: 12, color: "#A32D2D", background: "#FCEBEB", border: "1px solid #F7C1C1", borderRadius: 8, padding: "6px 9px", marginTop: 6 }}>
      Não foi: {naLinha.erro}
    </div>
  ) : null);
  const rotulo = (id, texto, fazendo) => (ocupado === id ? fazendo : texto);

  const grupos = useMemo(() => {
    if (!dados) return null;
    const dec = dados.decisoes || {};
    const ins = dados.insumos || [];
    const emUso = (i) => i.fichas > 0 || i.composto;
    const semFicha = ins.filter((i) => i.compras > 0 && !emUso(i) && i.tipo !== "uso");
    const nuncaComprados = ins.filter((i) => i.compras === 0 && emUso(i));
    const soltos = ins.filter((i) => i.compras === 0 && !emUso(i) && !dec[`solto:${i.id}`]);
    const chavePar = (a, b) => `par:${[a.id, b.id].sort().join(":")}`;

    // pares: sem ficha × nunca comprado, e qualquer par com o mesmo nome
    const pares = [];
    const vistos = new Set();
    const somar = (a, b, nota) => {
      const k = chavePar(a, b);
      if (vistos.has(k) || dec[k]) return;
      vistos.add(k);
      pares.push({ a, b, nota, chave: k });
    };
    semFicha.forEach((a) => {
      let melhor = null, nota = 0;
      nuncaComprados.forEach((b) => { const p = parecenca(a.nome, b.nome); if (p > nota) { nota = p; melhor = b; } });
      if (melhor && nota >= 0.5) somar(a, melhor, nota);
    });
    const porChave = new Map();
    ins.forEach((i) => { const k = chaveNome(i.nome); porChave.set(k, [...(porChave.get(k) || []), i]); });
    porChave.forEach((lista) => { if (lista.length > 1) for (let k = 1; k < lista.length; k++) somar(lista[k], lista[0], 1); });
    pares.sort((x, y) => y.nota - x.nota);

    const paraOnde = semFicha.filter((i) => !i.tipo);
    const faltaFicha = semFicha.filter((i) => i.tipo && i.tipo !== "uso");
    const naoInsumo = (dados.nao_insumo || []).filter((n) => !dec[`nao:${chaveNome(n.nome)}`]);
    const completos = ins.filter((i) => (i.compras > 0 && emUso(i)) || i.tipo === "uso").length;
    return { ins, semFicha, nuncaComprados, soltos, pares, paraOnde, faltaFicha, naoInsumo, completos };
  }, [dados]);

  if (erro && !dados) return <div style={aviso_}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> {erro}</div>;
  if (!grupos) return <div style={{ fontSize: 13, color: CINZA, display: "flex", gap: 6, alignItems: "center" }}><Loader2 size={14} /> Lendo o cadastro…</div>;

  const g = grupos;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={card}>
        <div style={titulo}>Cada produto existe uma vez, e todo produto tem para onde ir</div>
        <div style={explica}>
          {g.completos} de {g.ins.length} insumos estão completos (comprados e usados em ficha, ou marcados como uso e limpeza).
          A fila abaixo some conforme o cadastro fica limpo.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginTop: 10 }}>
          <Numero titulo="Comprados sem ficha" valor={g.semFicha.length} sub="entram e não saem" />
          <Numero titulo="Na ficha, nunca comprados" valor={g.nuncaComprados.length} sub="muitas vezes o mesmo produto com outro nome" />
          <Numero titulo="Soltos" valor={g.soltos.length} sub="sem compra e sem ficha" />
          <Numero titulo='Entrou como "não é insumo"' valor={g.naoInsumo.length} sub="confira se é produto" />
        </div>
      </div>

      {erro && <div style={aviso_}><AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} /> {erro}</div>}
      {aviso && <div style={{ ...aviso_, background: "#E4F2E9", borderColor: "#BFE3CD", color: "#27500A" }}><CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 2 }} /> {aviso}</div>}

      {/* 1. pares */}
      <div style={card}>
        <div style={titulo}>Parecem o mesmo produto</div>
        <div style={explica}>
          Juntar leva ficha, estoque e compras para o nome que ficar, e o outro nome vira apelido: a próxima nota com ele já cai no lugar certo.
        </div>
        {g.pares.length === 0 && <Vazio texto="Nenhum par sugerido." />}
        {g.pares.slice(0, 30).map((p) => {
          const unidDif = p.a.unidade !== p.b.unidade;
          return (
            <div key={p.chave} style={linha}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <Nome i={p.a} /> <span style={{ color: CINZA }}>↔</span> <Nome i={p.b} />
                {unidDif && <div style={{ fontSize: 11.5, color: "#8A6A0F", marginTop: 2 }}>Unidades diferentes ({p.a.unidade} e {p.b.unidade}): troque a unidade de um deles na aba Insumos antes de juntar.</div>}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[[p.a, p.b], [p.b, p.a]].map(([origem, destino], k) => (
                  <button key={k} disabled={unidDif || !!ocupado} title={unidDif ? "Unidades diferentes: não dá para juntar daqui" : ""}
                    style={estilo(k === 0 && destino.fichas > 0 ? btnEscuro : btnClaro, unidDif || !!ocupado)}
                    onClick={() => agir(p.chave, async () => {
                      const { error } = await supabase.rpc("juntar_e_lembrar", { p_origem: origem.id, p_destino: destino.id });
                      if (error) throw error;
                      setAviso(`"${origem.nome}" foi juntado em "${destino.nome}".`);
                    })}>
                    {ocupado === p.chave ? "Juntando…" : `Ficar com "${destino.nome}"`}
                  </button>
                ))}
                <button style={estilo(btnClaro, !!ocupado)} disabled={!!ocupado}
                  onClick={() => agir(p.chave, () => decidir(p.chave, "diferentes"))}>Não são</button>
              </div>
              <Resposta id={p.chave} />
            </div>
          );
        })}
        {g.pares.length > 30 && <div style={{ ...explica, marginTop: 8 }}>Mostrando 30 de {g.pares.length}.</div>}
      </div>

      {/* 2. para onde vai */}
      <div style={card}>
        <div style={titulo}>Comprado sem ficha: para onde ele vai?</div>
        <div style={explica}>
          Uso e limpeza sai da fila. Ingrediente, revenda e embalagem precisam entrar numa ficha (revenda: ficha de 1 para 1 com o produto vendido).
        </div>
        {g.paraOnde.length === 0 && <Vazio texto="Todos os comprados sem ficha já têm tipo." />}
        {g.paraOnde.slice(0, 40).map((i) => (
          <div key={i.id} style={linha}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <Nome i={i} />
              <div style={{ fontSize: 11, color: CINZA }}>comprado {i.compras}× · última {dataBR(i.ultima_compra)}{i.ultimo_preco ? ` · ${brl(i.ultimo_preco)}/${i.unidade}` : ""}</div>
            </div>
            {ocupado === i.id ? <span style={{ fontSize: 12, color: CINZA }}>Gravando…</span> : (
              <EscolherTipo compacto valor={i.tipo} onMudar={(t) => !ocupado && agir(i.id, async () => {
                const { error } = await supabase.from("insumos").update({ tipo: t }).eq("id", i.id);
                if (error) throw error;
              })} />
            )}
            <Resposta id={i.id} />
          </div>
        ))}
        {g.paraOnde.length > 40 && <div style={{ ...explica, marginTop: 8 }}>Mostrando 40 de {g.paraOnde.length}.</div>}

        {g.faltaFicha.length > 0 && (
          <div style={{ marginTop: 12, background: "#F7F3E9", borderRadius: 10, padding: "10px 12px" }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: ESCURO }}>Faltam entrar numa ficha: {g.faltaFicha.length}</div>
            <div style={{ fontSize: 12, color: "#5C5A4E", marginTop: 4, lineHeight: 1.6 }}>
              {g.faltaFicha.map((i) => `${i.nome} (${(TIPOS_INSUMO.find((t) => t.valor === i.tipo) || {}).rotulo || i.tipo})`).join(" · ")}
            </div>
            {irPara && <button style={{ ...btnClaro, marginTop: 8 }} onClick={() => irPara("fichas")}>Abrir as fichas técnicas</button>}
          </div>
        )}
      </div>

      {/* 3. soltos */}
      <div style={card}>
        <div style={titulo}>Soltos: sem compra e sem ficha</div>
        <div style={explica}>Cadastrados que nunca foram comprados nem usados. Excluir não apaga histórico nenhum, porque não há.</div>
        {g.soltos.length === 0 && <Vazio texto="Nenhum insumo solto." />}
        {g.soltos.slice(0, 40).map((i) => (
          <div key={i.id} style={linha}>
            <div style={{ flex: 1, minWidth: 180 }}><Nome i={i} /></div>
            <button style={estilo(btnClaro, !!ocupado)} disabled={!!ocupado} onClick={() => agir(i.id, async () => {
              const { error } = await supabase.from("insumos").delete().eq("id", i.id);
              if (error) throw new Error(error.message);
            })}>{rotulo(i.id, "Excluir", "Aguarde…")}</button>
            <button style={estilo(btnClaro, !!ocupado)} disabled={!!ocupado} onClick={() => agir(i.id, () => decidir(`solto:${i.id}`, "manter"))}>Manter</button>
            <Resposta id={i.id} />
          </div>
        ))}
        {g.soltos.length > 40 && <div style={{ ...explica, marginTop: 8 }}>Mostrando 40 de {g.soltos.length}.</div>}
      </div>

      {/* 4. não é insumo */}
      <div style={card}>
        <div style={titulo}>Entrou como "não é insumo"</div>
        <div style={explica}>
          Linhas de notas confirmadas sem produto. Se for comida ou algo que você vende, ligue a um produto: as próximas notas com esse nome entram no estoque.
          As notas já confirmadas não voltam ao estoque.
        </div>
        {g.naoInsumo.length === 0 && <Vazio texto="Nada para conferir." />}
        {g.naoInsumo.slice(0, 40).map((n) => (
          <LinhaNaoInsumo key={n.nome} n={n} insumos={g.ins} ocupado={!!ocupado} resposta={<Resposta id={n.nome} />}
            onLigar={(insumo, criarTipo) => agir(n.nome, async () => {
              let alvo = insumo;
              if (!alvo) {
                const { data, error } = await supabase.from("insumos").insert({ nome: n.nome.trim(), unidade: "un", tipo: criarTipo }).select().single();
                if (error) throw error;
                alvo = data;
              }
              const { error: e1 } = await supabase.from("insumo_sinonimos").insert({ nome_variante: n.nome, insumo_id: alvo.id });
              if (e1 && e1.code !== "23505") throw e1;
              await supabase.from("nomes_nao_insumo").delete().ilike("nome_variante", n.nome);
              await decidir(`nao:${chaveNome(n.nome)}`, "ligado");
              setAviso(`As próximas notas com "${n.nome}" entram como "${alvo.nome}".`);
            })}
            onDespesa={() => agir(n.nome, () => decidir(`nao:${chaveNome(n.nome)}`, "despesa"))} />
        ))}
      </div>
    </div>
  );
}

function LinhaNaoInsumo({ n, insumos, ocupado, onLigar, onDespesa, resposta }) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState("");
  const sugestoes = useMemo(() => {
    const termo = busca.trim();
    if (termo) {
      const t = chaveNome(termo);
      return insumos.filter((i) => chaveNome(i.nome).includes(t)).slice(0, 6);
    }
    return parecidos(n.nome, insumos, { limite: 6, minimo: 0.34 });
  }, [busca, insumos, n.nome]);

  return (
    <div style={{ ...linha, display: "block" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <b style={{ fontWeight: 700, fontSize: 13 }}>{n.nome}</b>
          <div style={{ fontSize: 11, color: CINZA }}>{n.vezes}× · última {dataBR(n.ultima)}{n.centro ? ` · ${n.centro}` : ""}</div>
        </div>
        <button style={estilo(btnEscuro, ocupado)} disabled={ocupado} onClick={() => setAberto(!aberto)}>Ligar a um produto</button>
        <button style={estilo(btnClaro, ocupado)} disabled={ocupado} onClick={onDespesa}>É despesa mesmo</button>
      </div>
      {resposta}
      {aberto && (
        <div style={{ marginTop: 8, background: "#FBF8F1", border: "1px solid #EFE9DA", borderRadius: 9, padding: "8px 10px" }}>
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Procurar produto cadastrado"
            style={{ width: "100%", boxSizing: "border-box", padding: "7px 9px", borderRadius: 7, border: "1px solid #E8E2D2", fontSize: 13, fontFamily: "inherit", marginBottom: 6 }} />
          {sugestoes.map((i) => (
            <div key={i.id} style={{ display: "flex", gap: 8, alignItems: "center", padding: "5px 0", fontSize: 12.5 }}>
              <span style={{ flex: 1 }}>{i.nome} <span style={{ color: CINZA }}>· {i.unidade}</span></span>
              <button style={btnClaro} disabled={ocupado} onClick={() => onLigar(i)}>Ligar neste</button>
            </div>
          ))}
          {sugestoes.length === 0 && <div style={{ fontSize: 12, color: CINZA, padding: "4px 0" }}>Nenhum produto parecido.</div>}
          <div style={{ borderTop: "1px solid #EFE9DA", marginTop: 6, paddingTop: 7, display: "grid", gap: 6 }}>
            <div style={{ fontSize: 12, color: "#5C5A4E" }}>Ou cadastrar "{n.nome}" como produto novo:</div>
            <EscolherTipo compacto valor={tipo} onMudar={setTipo} />
            <div><button style={btnClaro} disabled={ocupado || !tipo} onClick={() => onLigar(null, tipo)}>Cadastrar e ligar</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Nome({ i }) {
  return (
    <span style={{ fontSize: 13 }}>
      <b style={{ fontWeight: 700 }}>{i.nome}</b>{" "}
      <span style={{ color: CINZA, fontSize: 11.5 }}>
        {i.unidade}{i.compras > 0 ? ` · comprado ${i.compras}×` : " · nunca comprado"}{i.fichas > 0 ? ` · em ${i.fichas} ficha${i.fichas > 1 ? "s" : ""}` : ""}
      </span>
    </span>
  );
}
function Numero({ titulo, valor, sub }) {
  return (
    <div style={{ background: "#F7F3E9", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontSize: 12, color: "#5C5A4E" }}>{titulo}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color: ESCURO, fontVariantNumeric: "tabular-nums" }}>{valor}</div>
      <div style={{ fontSize: 11, color: CINZA, lineHeight: 1.35 }}>{sub}</div>
    </div>
  );
}
function Vazio({ texto }) {
  return <div style={{ fontSize: 12.5, color: "#2F8F5B", marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}><CheckCircle2 size={14} /> {texto}</div>;
}

const card = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14 };
const titulo = { fontSize: 15, fontWeight: 800, color: ESCURO };
const explica = { fontSize: 12, color: CINZA, marginTop: 2, lineHeight: 1.45 };
const linha = { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", padding: "9px 0", borderTop: "1px solid #EFE9DA", marginTop: 4 };
const aviso_ = { display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A", color: "#7A6A1E", borderRadius: 10, padding: 12, fontSize: 13, alignItems: "flex-start" };
const btnBase = { borderRadius: 8, padding: "6px 11px", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap" };
const btnEscuro = { ...btnBase, background: ESCURO, color: "#F3EFE3", border: "1px solid #22231F" };
const btnClaro = { ...btnBase, background: "#FFFFFF", color: ESCURO, border: "1px solid #E8E2D2" };
// botão travado tem que PARECER travado
function estilo(base, travado) { return travado ? { ...base, opacity: 0.4, cursor: "not-allowed" } : base; }
