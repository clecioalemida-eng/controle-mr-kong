import Link from "next/link";
import { supabaseServidor } from "@/lib/supabase/server";
import { moverEtapa, moverSituacao } from "../acoes";
import {
  ETAPAS, NO_QUADRO, SITUACOES, ABERTAS, data, venceu, frenteVenceu, faltam, responsavel,
  nomeSegmento, nomePrioridade, nomeEtapa, nomeSituacao, um, type Projeto,
} from "../comum";

// O Kanban tem duas leituras do mesmo cadastro:
//
//   por FRENTE (padrão) — uma coluna por frente do catálogo. O projeto aparece
//   em cada coluna em que tem frente aberta, porque ele está em várias ao mesmo
//   tempo. É a pergunta de quem desenha: "o que está no Estrutural hoje?".
//
//   por FASE — o quadro antigo, uma coluna por fase do projeto. Continua aqui
//   porque Parado e Aguardando cliente são do projeto, não de uma frente.
//
// Nada novo no banco: lê arq_frentes e arq_projeto_frentes, os mesmos do Mapa.
//
// O QUE MUDOU NA 55 — a coluna é do que está ANDANDO
//
// Antes, "na vez" mostrava também as `a_fazer` cujas dependências já tinham
// terminado. A coluna virava uma mistura de "alguém está mexendo nisto" com
// "isto poderia começar", e as duas coisas pedem ações diferentes de quem olha.
// Agora a coluna mostra só o que saiu de `a_fazer`, e a fila vira um número no
// topo — ela não some, deixa de ser cartão.
//
// O número leva para /quadro/tudo, que já existia: era o botão "tudo que está
// aberto". Não inventei rota nem parâmetro — e parâmetro aqui seria defeito,
// porque as ações voltam para `de` + "?aviso=…" e um endereço com "?" sairia
// quebrado. O comentário abaixo, sobre os três endereços, continua valendo.
//
// E o relógio deixou de ser "distância até a data prevista" e passou a ser
// "há quanto tempo está nesta etapa", lido de `inicio` — o carimbo que a
// migração 55 passou a manter. São perguntas diferentes: a primeira é "furamos
// o combinado?", a segunda é "há quanto tempo isto está em cima da mesa?". O
// quadro responde a segunda; a data prevista continua no rodapé do cartão para
// quem precisa da primeira.

type FrenteCat = {
  id: number; nome: string; tipo: string; ordem: number;
  depende_de: number[] | null;
  // Entrou na 55: é contra ele que o relógio da etapa é medido.
  prazo_dias: number | null;
};
type Linha = {
  id: number; projeto_id: number; frente_id: number; situacao: string;
  previsto: string | null; responsavel_id: string | null;
  // Carimbo de quando entrou em em_andamento. Null em a_fazer, por regra do
  // gatilho: voltar para a fila zera o relógio.
  inicio: string | null;
  perfis?: { nome: string | null } | { nome: string | null }[] | null;
};

const CHIP: React.CSSProperties = {
  padding: "5px 11px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--raised)",
  color: "var(--ink-2)", fontSize: 12, textDecoration: "none", whiteSpace: "nowrap",
};
const CHIP_ON: React.CSSProperties = { ...CHIP, background: "var(--ink)", borderColor: "var(--ink)", color: "#fff", fontWeight: 600 };
const TITULO_COL = (tipo: string): React.CSSProperties => ({
  display: "inline-block", fontSize: 11, fontWeight: 600, padding: "2.5px 9px", borderRadius: 3, whiteSpace: "nowrap",
  background: tipo === "aprovacao" ? "rgba(91,75,158,.12)" : tipo === "sem" ? "var(--sunken)" : "rgba(45,95,158,.10)",
  color: tipo === "aprovacao" ? "#5b4b9e" : tipo === "sem" ? "var(--ink-2)" : "var(--azul)",
});
const VAZIA: React.CSSProperties = {
  border: "1px dashed var(--border-strong)", borderRadius: 9, padding: "14px 12px", fontSize: 12, color: "var(--ink-3)", textAlign: "center",
};
// A fila que espera. Linha de texto e não caixa tracejada: tracejado no painel
// quer dizer "falta alguma coisa", e aqui não falta — tem gente na fila.
const FILA: React.CSSProperties = {
  display: "block", fontSize: 11.5, color: "var(--ink-3)", textDecoration: "none",
  padding: "2px 3px 9px",
};
const RELOGIO: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--ink-3)", margin: "6px 0 2px",
};
const MEDIDOR: React.CSSProperties = {
  flex: "0 1 54px", height: 3, borderRadius: 2, background: "var(--border)", overflow: "hidden",
};

// Data de verdade? O quadro já mostrou "730477 d atrasada" porque uma linha
// tinha o ano gravado como 26 em vez de 2026. Conta feita em cima de lixo não
// vira aviso: vira número absurdo que ninguém sabe ler. Melhor dizer que a data
// está errada.
function dataOk(iso: string | null): boolean {
  if (!iso) return false;
  const ano = Number(iso.slice(0, 4));
  return Number.isFinite(ano) && ano >= 1900 && ano <= 2100;
}

// Quantos dias desde `inicio`. `faltam` devolve dias ATÉ a data (negativo no
// passado), então o sinal se inverte.
function diasNaEtapa(inicio: string | null): number | null {
  if (!dataOk(inicio)) return null;
  const f = faltam(inicio);
  return f == null ? null : Math.max(0, -f);
}

// Três endereços, uma tela: /quadro (na vez), /quadro/tudo e /quadro/fase. São
// caminhos e não ?parâmetros porque as ações voltam para `de` + "?aviso=…":
// um endereço que já tivesse "?" sairia quebrado.
export type Modo = "vez" | "tudo" | "fase";

export default async function Kanban(
  { modo, searchParams }: { modo: Modo; searchParams: Promise<{ aviso?: string; tipo?: string }> },
) {
  const q = await searchParams;
  const porFase = modo === "fase";
  const tudo = modo === "tudo";
  const supabase = await supabaseServidor();

  const [{ data: minhas }, { data: lista }, catRes, linhasRes] = await Promise.all([
    supabase.rpc("minhas_permissoes"),
    supabase
      .from("arq_projetos")
      .select("id, nome, responsavel_id, segmento, etapa, prioridade, previsao_arquitetonico, entrega, responsavel_nome, perfis!arq_projetos_responsavel_id_fkey(nome)")
      .order("previsao_arquitetonico", { ascending: true, nullsFirst: false }),
    porFase ? Promise.resolve({ data: [], error: null })
      : supabase.from("arq_frentes").select("id, nome, tipo, ordem, depende_de, prazo_dias").eq("ativa", true),
    porFase ? Promise.resolve({ data: [], error: null })
      : supabase.from("arq_projeto_frentes")
          .select("id, projeto_id, frente_id, situacao, previsto, inicio, responsavel_id, perfis!arq_projeto_frentes_responsavel_id_fkey(nome)"),
  ]);

  const permissoes: string[] = (minhas as string[]) ?? [];
  const podeMover = permissoes.includes("arquitetura.etapa")
    || permissoes.includes("arquitetura.lancar");

  const projetos = (lista ?? []) as unknown as Projeto[];
  const endereco = (ver: string, mostrar: string) =>
    `/arquitetura/quadro${ver === "fase" ? "/fase" : mostrar === "tudo" ? "/tudo" : ""}`;
  const aqui = endereco(porFase ? "fase" : "frente", tudo ? "tudo" : "vez");

  const filtros = (
    <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", margin: "0 0 14px", fontSize: 12, color: "var(--ink-3)" }}>
      Ver por
      <Link href={endereco("frente", tudo ? "tudo" : "vez")} style={porFase ? CHIP : CHIP_ON}>Frente</Link>
      <Link href={endereco("fase", "vez")} style={porFase ? CHIP_ON : CHIP}>Fase do projeto</Link>
      {!porFase && (
        <>
          <span style={{ marginLeft: 8 }}>Mostrar</span>
          <Link href={endereco("frente", "vez")} style={tudo ? CHIP : CHIP_ON}>o que está andando</Link>
          <Link href={endereco("frente", "tudo")} style={tudo ? CHIP_ON : CHIP}>tudo que está aberto</Link>
        </>
      )}
    </div>
  );

  const recado = q.aviso && (
    <div className="recado" data-tipo={q.tipo === "erro" ? "erro" : undefined}>{q.aviso}</div>
  );

  // ------------------------------------------------------------ por fase ---
  if (porFase) {
    return (
      <>
        {recado}
        {filtros}
        <div className="quadro">
          {NO_QUADRO.map((etapa) => {
            const daColuna = projetos.filter((p) => p.etapa === etapa.cod);
            return (
              <div className="coluna" key={etapa.cod}>
                <div className="topo">
                  <span className="etapa" data-e={etapa.cod}>{etapa.nome}</span>
                  <span className="qt">{daColuna.length}</span>
                </div>

                {daColuna.map((p) => {
                  const resp = responsavel(p);
                  // A data do cartão é sempre a previsão do arquitetônico: é ela que
                  // o cliente ouviu, e é por ela que alguém cobra. A data de entrega
                  // real só interessa depois de entregue, e isso vive em Fechados.
                  const quando = p.previsao_arquitetonico;
                  const atrasou = venceu(p.previsao_arquitetonico, p.etapa);
                  return (
                    <div className="cartao" key={p.id}>
                      <b>
                        <a href={`/arquitetura/projeto/${p.id}`} style={{ color: "var(--ink)" }}>
                          {p.nome}
                        </a>
                      </b>

                      {(p.segmento || p.prioridade) && (
                        <div className="meta">
                          {p.segmento && <span className="stage-chip">{nomeSegmento(p.segmento)}</span>}
                          {p.prioridade && (
                            <span className="prio" data-p={p.prioridade}>{nomePrioridade(p.prioridade)}</span>
                          )}
                        </div>
                      )}

                      <div className="pe">
                        <span className={atrasou ? "quando venceu" : "quando"}>{data(quando)}</span>
                        {resp && <span className="resp">{resp}</span>}
                      </div>

                      {podeMover && (
                        <form action={moverEtapa} className="mover">
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="de" value="/arquitetura/quadro/fase" />
                          <select name="etapa" defaultValue={p.etapa} aria-label={`Etapa de ${p.nome}`}>
                            {ETAPAS.map((e) => <option key={e.cod} value={e.cod}>{e.nome}</option>)}
                          </select>
                          <button className="acao calma" type="submit"
                            style={{ fontSize: 11.5, padding: "3px 9px", marginLeft: 5 }}>ok</button>
                        </form>
                      )}
                    </div>
                  );
                })}

                {daColuna.length === 0 && (
                  <div style={{
                    border: "1px dashed var(--border-strong)", borderRadius: 9,
                    padding: "14px 12px", fontSize: 12, color: "var(--ink-3)", textAlign: "center",
                  }}>
                    vazia
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="rodape-nota" style={{ borderTop: 0, paddingLeft: 0 }}>
          Projeto entregue não aparece aqui — está em <b>Fechados</b>. A fase é do projeto inteiro e muda pelo seletor do cartão.
        </p>
      </>
    );
  }

  // ---------------------------------------------------------- por frente ---
  const erro = catRes.error?.message ?? linhasRes.error?.message ?? null;
  const frentes = ((catRes.data ?? []) as unknown as FrenteCat[])
    // Disciplinas antes das aprovações, e dentro de cada grupo a ordem do catálogo.
    .sort((a, b) => (a.tipo === b.tipo ? a.ordem - b.ordem : a.tipo === "disciplina" ? -1 : 1));
  const todas = (linhasRes.data ?? []) as unknown as Linha[];

  const vivos = projetos.filter((p) => p.etapa !== "entregue");
  const porId = new Map(vivos.map((p) => [p.id, p]));
  const chave = (p: number, f: number) => `${p}:${f}`;
  const indice = new Map(todas.map((l) => [chave(l.projeto_id, l.frente_id), l]));
  const FIM: string[] = SITUACOES.filter((s) => s.fim).map((s) => s.cod);

  // Andando = saiu da fila. Escrito pela negativa, e não como uma lista
  // ("em_andamento ou reprovado"), de propósito: se amanhã nascer uma situação
  // nova — "em revisão", "com o cliente" —, ela aparece sozinha. Uma lista
  // fechada esconderia a novidade até alguém reparar na falta.
  const andando = (l: Linha) => l.situacao !== "a_fazer";

  // Quem está na fila e já poderia começar: `a_fazer` com tudo de que depende
  // concluído NESTE projeto. Dependência que o projeto nem abriu não segura
  // ninguém — ela não se aplica a ele. Não vira cartão; vira contagem no topo.
  const podeComecar = (l: Linha, f: FrenteCat): boolean => {
    if (l.situacao !== "a_fazer") return false;
    return (f.depende_de ?? []).every((d) => {
      const dep = indice.get(chave(l.projeto_id, d));
      return !dep || FIM.includes(dep.situacao);
    });
  };

  const abertas = todas.filter((l) => ABERTAS.includes(l.situacao) && porId.has(l.projeto_id));
  const comFrenteAberta = new Set(abertas.map((l) => l.projeto_id));
  const semFrente = vivos.filter((p) => !comFrenteAberta.has(p.id));

  const colunas = frentes.map((f) => {
    const daFrente = abertas.filter((l) => l.frente_id === f.id);
    const cartoes = daFrente
      .filter((l) => (tudo ? true : andando(l)))
      // Mais tempo na etapa em cima — é o que está travado há mais tempo.
      // Quem não tem carimbo vai para o fim: não dá para ordenar o que não se
      // sabe, e fingir que é zero poria o desconhecido no lugar do mais novo.
      .sort((a, b) => (diasNaEtapa(b.inicio) ?? -1) - (diasNaEtapa(a.inicio) ?? -1));
    const naFila = daFrente.filter((l) => l.situacao === "a_fazer");
    const prontas = naFila.filter((l) => podeComecar(l, f)).length;
    return { f, cartoes, fila: naFila.length, prontas };
  });
  const atrasadas = abertas.filter((l) => frenteVenceu(l)).length;
  const emFila = colunas.reduce((n, c) => n + c.fila, 0);
  const andandoTotal = abertas.filter(andando).length;

  return (
    <>
      {recado}
      {erro && <div className="recado" data-tipo="erro">Não consegui ler as frentes: {erro}</div>}
      {filtros}

      <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--ink-2)" }}>
        <b>{andandoTotal}</b> frente(s) andando em <b>{comFrenteAberta.size}</b> projeto(s)
        {atrasadas > 0 && <> · <span className="venceu">{atrasadas} passou do prazo</span></>}
        {!tudo && emFila > 0 && <> · <b>{emFila}</b> esperando alguém começar</>}
      </p>

      <div className="quadro">
        <div className="coluna">
          <div className="topo">
            <span style={TITULO_COL("sem")}>Sem frentes abertas</span>
            <span className="qt">{semFrente.length}</span>
          </div>
          {semFrente.map((p) => (
            <div className="cartao" key={p.id}>
              <b><a href={`/arquitetura/projeto/${p.id}`} style={{ color: "var(--ink)" }}>{p.nome}</a></b>
              <div className="pe">
                <span className="etapa" data-e={p.etapa}>{nomeEtapa(p.etapa)}</span>
                <a href={`/arquitetura/projeto/${p.id}`} style={{ fontSize: 11.5 }}>abrir frentes →</a>
              </div>
            </div>
          ))}
          {semFrente.length === 0 && <div style={VAZIA}>nenhum</div>}
        </div>

        {colunas.map(({ f, cartoes, fila, prontas }) => (
          <div className="coluna" key={f.id}>
            <div className="topo">
              <span style={TITULO_COL(f.tipo)}>{f.nome}</span>
              <span className="qt">{cartoes.length}</span>
            </div>

            {/* A fila: um número, não cartões. Continua achável — o link é o
                mesmo "tudo que está aberto" que já existia no topo da tela. */}
            {!tudo && fila > 0 && (
              <Link href={endereco("frente", "tudo")} style={FILA}>
                <b style={{ fontFamily: "var(--mono)", color: "var(--ink-2)" }}>{fila}</b>
                {" a fazer"}
                {prontas > 0 && <>, <b style={{ color: "var(--ink-2)" }}>{prontas}</b> já pode começar</>}
              </Link>
            )}

            {cartoes.map((l) => {
              const p = porId.get(l.projeto_id)!;
              const atrasou = frenteVenceu(l);
              const quem = um(l.perfis)?.nome ?? null;
              const dias = diasNaEtapa(l.inicio);
              const prazo = f.prazo_dias ?? null;
              const estourou = dias != null && prazo != null && dias > prazo;
              const cor = estourou ? "var(--alert)" : "var(--ink)";
              return (
                <div className="cartao" key={l.id} style={estourou ? { borderLeft: "3px solid var(--alert)" } : undefined}>
                  <b><a href={`/arquitetura/projeto/${p.id}`} style={{ color: "var(--ink)" }}>{p.nome}</a></b>

                  <div className="meta">
                    <span className="sit" data-s={l.situacao}>{nomeSituacao(l.situacao)}</span>
                    {p.etapa === "parado" || p.etapa === "aguardando_cliente"
                      ? <span className="etapa" data-e={p.etapa}>{nomeEtapa(p.etapa)}</span>
                      : p.prioridade === "alta" && <span className="prio" data-p="alta">Alta</span>}
                  </div>

                  {/* O relógio da etapa. Cartão dentro do prazo não ganha cor:
                      se tudo fosse colorido, nada chamaria atenção. */}
                  <div style={RELOGIO}>
                    {dias == null ? (
                      <span>sem carimbo de início</span>
                    ) : (
                      <>
                        <b style={{ fontFamily: "var(--mono)", fontSize: 12.5, color: cor }}>{dias} d</b>
                        {prazo != null && (
                          <>
                            <span style={MEDIDOR}>
                              <span style={{
                                display: "block", height: "100%", borderRadius: 2,
                                width: `${Math.min(100, Math.round((dias / Math.max(1, prazo)) * 100))}%`,
                                background: estourou ? "var(--alert)" : "var(--ink-3)",
                              }} />
                            </span>
                            <span style={estourou ? { color: "var(--alert)" } : undefined}>
                              {estourou ? `${dias - prazo} d além de ${prazo}` : `de ${prazo} d`}
                            </span>
                          </>
                        )}
                        {prazo == null && <span>nesta etapa</span>}
                      </>
                    )}
                  </div>

                  <div className="pe">
                    <span className={atrasou ? "quando venceu" : "quando"}>
                      {!l.previsto ? "sem prazo"
                        : !dataOk(l.previsto) ? "data inválida"
                        : `vence ${data(l.previsto)}`}
                    </span>
                    <span className="resp">{quem ?? "— ninguém cobra"}</span>
                  </div>

                  {podeMover && (
                    <form action={moverSituacao} className="mover">
                      <input type="hidden" name="id" value={l.id} />
                      <input type="hidden" name="de" value={aqui} />
                      <select name="situacao" defaultValue={l.situacao} aria-label={`Situação de ${f.nome} em ${p.nome}`}>
                        {SITUACOES.map((s) => <option key={s.cod} value={s.cod}>{s.nome}</option>)}
                      </select>
                      <button className="acao calma" type="submit"
                        style={{ fontSize: 11.5, padding: "3px 9px", marginLeft: 5 }}>ok</button>
                    </form>
                  )}
                </div>
              );
            })}

            {cartoes.length === 0 && (
              <div style={VAZIA}>{fila > 0 && !tudo ? "ninguém tocando nisto agora" : "vazia"}</div>
            )}
          </div>
        ))}
      </div>

      <p className="rodape-nota" style={{ borderTop: 0, paddingLeft: 0 }}>
        Uma coluna por frente do catálogo (disciplinas em azul, aprovações em roxo), na ordem da aba <b>Frentes</b>.
        O mesmo projeto aparece em mais de uma coluna porque está em várias frentes ao mesmo tempo. O seletor muda a
        situação <b>daquela frente</b>, não do projeto. Frente marcada Entregue, Aprovado ou Não se aplica sai da coluna.
        {" "}O número cinza no topo é a <b>fila</b>: o que está a fazer e ainda não virou cartão.
        {" "}O relógio conta desde o dia em que alguém marcou <b>Em andamento</b>, contra o prazo da frente no catálogo —
        voltar para A fazer zera a contagem, porque tempo parado não é tempo trabalhado.
      </p>
    </>
  );
}
