import React, { useState, useEffect, useCallback } from "react";
import {
  Loader2, AlertTriangle, Info, Gift, Copy, Download, RefreshCw, ExternalLink, Check,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";

// ---------------------------------------------------------------------------
// Sorteio — pelos comentários de um post, ou de todos os posts do período.
//
// Por que comentário e não curtida: a Meta entrega a CONTAGEM de curtidas e
// nunca a lista de quem curtiu. Repost idem. Comentário é o único lugar onde
// o @ de quem participou vem junto. Seguidor também não dá: vem o número,
// não os nomes.
//
// A ideia que manda nesta tela: um sorteio só vale se você puder mostrar
// depois como ele foi feito. Por isso nada some sem motivo — quem fica de
// fora aparece riscado, com a razão escrita do lado — e a lista inteira
// fica guardada junto com a semente do sorteio.
// ---------------------------------------------------------------------------

export { Gift as IconeSorteio };

async function chamarProxy(acao, corpo = {}) {
  const { data, error } = await supabase.functions.invoke("meta-ads-proxy", {
    body: { acao, ...corpo },
  });
  if (error) {
    let detalhe = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) detalhe = j.error; } catch { /* não era json */ }
    return { erro: detalhe };
  }
  if (data?.error) return { erro: data.error };
  return { data };
}

// Hoje e 30 dias atrás, no formato que o <input type="date"> entende.
function hojeISO(deslocaDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + deslocaDias);
  return d.toISOString().slice(0, 10);
}

function dataBonita(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default function Sorteio() {
  const [posts, setPosts] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [aviso, setAviso] = useState("");

  // O que a pessoa escolheu.
  const [escopo, setEscopo] = useState("post");          // post | periodo | colado
  const [midiaId, setMidiaId] = useState(null);
  const [de, setDe] = useState(hojeISO(-30));
  const [ate, setAte] = useState(hojeISO());
  const [regra, setRegra] = useState("pessoa");          // pessoa | comentario | marcou
  const [minimo, setMinimo] = useState(1);
  const [teto, setTeto] = useState("");
  const [tirarCasa, setTirarCasa] = useState(true);
  const [tirarRespostas, setTirarRespostas] = useState(true);
  const [suplentes, setSuplentes] = useState(2);
  const [colados, setColados] = useState("");
  // No período a janela é obrigatória. Num post só, ela é opcional: o padrão
  // é valer tudo desde que o post saiu.
  const [usarJanela, setUsarJanela] = useState(false);

  // O que voltou do servidor.
  const [previa, setPrevia] = useState(null);
  const [resultado, setResultado] = useState(null);
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const [historico, setHistorico] = useState([]);
  const [copiado, setCopiado] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [r, h] = await Promise.all([
      chamarProxy("patrocinio_dados"),
      supabase.from("v_sorteios").select("*").limit(8),
    ]);
    if (r.erro) setAviso(r.erro);
    else setPosts(r.data?.posts ?? []);
    setHistorico(h.data ?? []);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  // Trocar qualquer coisa invalida o que já estava na tela: prévia velha com
  // regra nova é a forma mais fácil de alguém sortear achando que filtrou.
  const mexeu = (fn) => (v) => { setPrevia(null); setResultado(null); setErro(""); fn(v); };

  // Quando a janela de datas vale: sempre no período, e no post só se você
  // pedir. Colar lista não tem data nenhuma — os @ vêm sem hora.
  const comJanela = escopo === "periodo" || (escopo === "post" && usarJanela);

  const corpo = () => ({
    escopo,
    midia_id: midiaId,
    de: comJanela ? `${de}T00:00:00` : null,
    ate: comJanela ? `${ate}T23:59:59` : null,
    regra,
    min_comentarios: Number(minimo) || 1,
    teto_chances: regra === "comentario" && teto ? Number(teto) : null,
    tirar_casa: tirarCasa,
    tirar_respostas: tirarRespostas,
    suplentes: Number(suplentes) || 0,
    arrobas: escopo === "colado"
      ? colados.split(/[\s,;\n]+/).map((x) => x.trim()).filter(Boolean)
      : undefined,
  });

  const conferir = async () => {
    setErro(""); setResultado(null); setOcupado("previa");
    const r = await chamarProxy("sorteio_previa", corpo());
    setOcupado("");
    if (r.erro) { setErro(r.erro); return; }
    setPrevia(r.data);
  };

  const sortear = async () => {
    setErro(""); setOcupado("sorteio");
    const r = await chamarProxy("sortear", corpo());
    setOcupado("");
    if (r.erro) { setErro(r.erro); return; }
    setResultado(r.data);
    setPrevia(null);
    const h = await supabase.from("v_sorteios").select("*").limit(8);
    setHistorico(h.data ?? []);
  };

  const lista = (resultado ?? previa)?.participantes ?? [];
  const fora = (resultado ?? previa)?.descartados ?? [];
  const contas = resultado ?? previa;

  const textoDaLista = () =>
    lista.map((p) => p.arroba + (p.chances > 1 ? ` (${p.chances})` : "")).join("\n");

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(textoDaLista());
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setErro("O navegador não deixou copiar. Use o botão de baixar.");
    }
  };

  const baixar = () => {
    const cab = resultado
      ? `Sorteio Mr Kong — ${dataBonita(resultado.criado_em)}\nGanhador: ${resultado.ganhador}\n` +
        `Participantes: ${resultado.total_pessoas} · Comentários: ${resultado.total_comentarios}\n` +
        `Semente: ${resultado.semente}\n\n`
      : `Participantes — prévia\n\n`;
    const url = URL.createObjectURL(new Blob([cab + textoDaLista()], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `sorteio-mrkong-${hojeISO()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (carregando) {
    return <div style={{ ...dica, padding: 14 }}><Loader2 size={13} /> Carregando os posts…</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {aviso && (
        <div style={avisoInfo}><Info size={14} /><span>{aviso}</span></div>
      )}

      <div style={cardStyle}>
        <div style={sectionLabel}>O que a Meta deixa sortear</div>
        <div style={{ ...dica, fontSize: 11.5 }}>
          A Meta entrega a <b>contagem</b> de curtidas, de reposts e de seguidores — nunca os
          nomes. Comentário é o único lugar onde o @ de quem participou vem junto. Por isso o
          sorteio é pelos comentários, e não por curtida ou por seguidor novo.
        </div>
      </div>

      {/* 1 — de onde vêm os comentários */}
      <div style={cardStyle}>
        <div style={sectionLabel}>1 · De onde</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 9 }}>
          <Opcao ativo={escopo === "post"} onClick={() => mexeu(setEscopo)("post")} nome="Um post" />
          <Opcao ativo={escopo === "periodo"} onClick={() => mexeu(setEscopo)("periodo")}
                 nome="Todos os posts do período" />
          <Opcao ativo={escopo === "colado"} onClick={() => mexeu(setEscopo)("colado")}
                 nome="Colar uma lista de @" desc="post de colaboração de outra conta" />
        </div>

        {escopo === "post" && (
          <>
            <div style={{ display: "grid", gap: 8,
                          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
              {posts.map((p) => {
                const on = midiaId === p.id;
                return (
                  <div key={p.id} onClick={() => mexeu(setMidiaId)(on ? null : p.id)}
                       style={{ border: on ? "2px solid #22231F" : "1px solid #E8E2D2",
                                borderRadius: 10, overflow: "hidden", cursor: "pointer",
                                background: "#fff", minWidth: 0 }}>
                    <div style={{ height: 86, background: "#F0ECE2", display: "flex",
                                  alignItems: "center", justifyContent: "center" }}>
                      {p.foto ? <img src={p.foto} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                              : <span style={{ fontSize: 18 }}>{p.tipo === "VIDEO" ? "▶" : "▣"}</span>}
                    </div>
                    <div style={{ padding: "6px 8px 8px" }}>
                      <div style={{ fontSize: 11.5, lineHeight: 1.3, overflow: "hidden",
                                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                        {p.texto || "sem legenda"}
                      </div>
                      <div style={{ ...dica, marginTop: 3 }}>
                        {(p.data || "").slice(8, 10)}/{(p.data || "").slice(5, 7)} ·{" "}
                        {p.comentarios ?? 0} comentário{p.comentarios === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ ...dica, marginTop: 7 }}>
              Os posts mais recentes do Instagram da casa — colaboração incluída, quando o convite
              partiu daqui. Post em que outra conta convidou o Mr Kong pertence a ela, e a Meta não
              libera os comentários: nesse caso use "Colar uma lista de @".
            </div>
          </>
        )}

        {escopo === "post" && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 11 }}>
            <Opcao ativo={!usarJanela} onClick={() => mexeu(setUsarJanela)(false)}
                   nome="Desde que o post saiu" desc="vale todo comentário" />
            <Opcao ativo={usarJanela} onClick={() => mexeu(setUsarJanela)(true)}
                   nome="Só entre datas" desc="fecha a janela do sorteio" />
          </div>
        )}

        {comJanela && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center",
                          marginTop: 9 }}>
              <span style={{ ...dica, fontWeight: 700, color: "#22231F" }}>Comentários de</span>
              <input type="date" style={inputStyle} value={de} onChange={(e) => mexeu(setDe)(e.target.value)} />
              <span style={{ ...dica, fontWeight: 700, color: "#22231F" }}>até</span>
              <input type="date" style={inputStyle} value={ate} onChange={(e) => mexeu(setAte)(e.target.value)} />
            </div>
            <div style={{ ...dica, marginTop: 7 }}>
              A janela vai das 00h00 do primeiro dia às 23h59 do último. Quem comentou fora fica de
              fora e aparece riscado com o motivo — é o que deixa você sortear no dia 31 valendo só
              o que foi dito até o dia 30, com o post ainda recebendo comentário.
              {escopo === "periodo" && " Entram todos os posts publicados dentro dela."}
            </div>
          </>
        )}

        {escopo === "colado" && (
          <>
            <textarea style={{ ...inputStyle, width: "100%", minHeight: 96, resize: "vertical" }}
                      placeholder={"@fulano\n@sicrano\n@beltrano"}
                      value={colados} onChange={(e) => mexeu(setColados)(e.target.value)} />
            <div style={{ ...dica, marginTop: 6 }}>
              Um @ por linha (ou separados por vírgula). Serve para post de colaboração de outra
              conta: peça a lista a quem publicou e cole aqui. O sorteio roda igual, com o mesmo
              registro guardado.
            </div>
          </>
        )}
      </div>

      {/* 2 — a regra */}
      <div style={cardStyle}>
        <div style={sectionLabel}>2 · Quem entra</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <Opcao ativo={regra === "pessoa"} onClick={() => mexeu(setRegra)("pessoa")}
                 nome="Uma chance por pessoa" desc="comentou 5 vezes, entra 1" />
          <Opcao ativo={regra === "comentario"} onClick={() => mexeu(setRegra)("comentario")}
                 nome="Uma chance por comentário" desc="comentou 5 vezes, tem 5 chances" />
          <Opcao ativo={regra === "marcou"} onClick={() => mexeu(setRegra)("marcou")}
                 nome="Só quem marcou amigo" desc="precisa ter um @ no comentário" />
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 10 }}>
          <label style={{ ...dica, fontWeight: 700, color: "#22231F" }}>
            Mínimo por pessoa{" "}
            <input type="number" min="1" max="50" style={{ ...inputStyle, width: 68, marginLeft: 5 }}
                   value={minimo} onChange={(e) => mexeu(setMinimo)(e.target.value)} />
          </label>
          {regra === "comentario" && (
            <label style={{ ...dica, fontWeight: 700, color: "#22231F" }}>
              Teto de chances{" "}
              <input type="number" min="1" max="500" placeholder="sem teto"
                     style={{ ...inputStyle, width: 92, marginLeft: 5 }}
                     value={teto} onChange={(e) => mexeu(setTeto)(e.target.value)} />
            </label>
          )}
          <label style={{ ...dica, fontWeight: 700, color: "#22231F" }}>
            Suplentes{" "}
            <input type="number" min="0" max="5" style={{ ...inputStyle, width: 62, marginLeft: 5 }}
                   value={suplentes} onChange={(e) => mexeu(setSuplentes)(e.target.value)} />
          </label>
        </div>

        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9 }}>
          <Opcao ativo={tirarCasa} onClick={() => mexeu(setTirarCasa)(!tirarCasa)}
                 nome="Tirar comentários da própria casa" />
          <Opcao ativo={tirarRespostas} onClick={() => mexeu(setTirarRespostas)(!tirarRespostas)}
                 nome="Tirar respostas a outros comentários" />
        </div>

        {regra === "comentario" && !teto && (
          <div style={{ ...avisoInfo, marginTop: 10 }}>
            <AlertTriangle size={14} />
            <span>Sem teto, quem estiver disposto a comentar 50 vezes ganha quase sempre, e o
              resto percebe. Um teto de 10 mantém o estímulo a comentar sem entregar o sorteio
              a uma pessoa só.</span>
          </div>
        )}
      </div>

      {/* 3 — conferir e sortear */}
      <div style={cardStyle}>
        <div style={sectionLabel}>3 · Conferir e sortear</div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
          <button style={btnSecondary} onClick={conferir} disabled={!!ocupado}>
            {ocupado === "previa" ? <Loader2 size={13} /> : <RefreshCw size={13} />} Conferir antes
          </button>
          <button style={btnPrimary} onClick={sortear} disabled={!!ocupado}>
            {ocupado === "sorteio" ? <Loader2 size={13} /> : <Gift size={13} />} Sortear
          </button>
        </div>

        {erro && (
          <div style={{ ...avisoErro, marginTop: 10 }}><AlertTriangle size={14} /><span>{erro}</span></div>
        )}

        {contas && (
          <>
            <div style={{ display: "grid", gap: 10, marginTop: 12,
                          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
              <Numero v={contas.total_comentarios} r="comentários lidos" />
              <Numero v={contas.total_pessoas} r="entraram no sorteio" />
              <Numero v={fora.length} r="ficaram de fora" />
              {contas.posts > 0 && <Numero v={contas.posts} r={contas.posts === 1 ? "post" : "posts"} />}
            </div>
            {contas.truncado && (
              <div style={{ ...avisoInfo, marginTop: 10 }}>
                <AlertTriangle size={14} />
                <span>Esse post tem comentários demais e eu parei de ler em 3.000. A lista pode
                  estar incompleta — prefiro dizer isso a te entregar meia lista como se fosse
                  inteira.</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* o ganhador */}
      {resultado && (
        <div style={{ ...cardStyle, border: "2px solid #2F8F5B" }}>
          <div style={{ ...sectionLabel, color: "#2F8F5B", marginBottom: 4 }}>
            Ganhador · sorteado {dataBonita(resultado.criado_em)}
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, wordBreak: "break-all" }}>{resultado.ganhador}</div>
          {resultado.ganhador_comentario && (
            <div style={{ fontSize: 13, marginTop: 7, paddingLeft: 9,
                          borderLeft: "2px solid #E8E2D2", lineHeight: 1.45 }}>
              “{resultado.ganhador_comentario}”
            </div>
          )}
          <div style={{ ...dica, marginTop: 7 }}>
            Comentou em {dataBonita(resultado.ganhador_quando)}. Entre {resultado.total_pessoas} nomes.
            {" "}Semente <code>{resultado.semente}</code> — com ela e a lista, qualquer pessoa refaz
            o sorteio e chega no mesmo nome.
          </div>

          {resultado.suplentes?.length > 0 && (
            <div style={{ marginTop: 9 }}>
              <div style={{ ...dica, fontWeight: 700, color: "#22231F" }}>Se o primeiro não responder</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {resultado.suplentes.map((s, i) => (
                  <span key={s} style={chip}>{i + 1}º · {s}</span>
                ))}
              </div>
            </div>
          )}

          <div style={{ ...avisoInfo, marginTop: 11 }}>
            <Info size={14} />
            <span>Se a regra era "siga o perfil", confira agora: abra o perfil do ganhador e veja se
              ele segue. A Meta não entrega a lista de seguidores, então essa parte é no olho — mas
              é um perfil para olhar, não {resultado.total_pessoas}.</span>
          </div>

          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 10 }}>
            <a href={`https://instagram.com/${String(resultado.ganhador).replace(/^@/, "")}`}
               target="_blank" rel="noreferrer" style={{ ...btnSecondary, textDecoration: "none" }}>
              <ExternalLink size={13} /> Abrir o perfil
            </a>
            <button style={btnSecondary} onClick={sortear} disabled={!!ocupado}>
              <RefreshCw size={13} /> Sortear outro nome
            </button>
          </div>
        </div>
      )}

      {/* a lista */}
      {lista.length > 0 && (
        <div style={cardStyle}>
          <div style={sectionLabel}>Os {lista.length} que entraram</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {lista.map((p) => (
              <span key={p.arroba} style={chip}>
                {p.arroba}{p.chances > 1 ? ` · ${p.chances}` : ""}
              </span>
            ))}
          </div>

          {fora.length > 0 && (
            <>
              <div style={{ ...sectionLabel, marginTop: 12 }}>E os {fora.length} que ficaram de fora</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {fora.slice(0, 120).map((f, i) => (
                  <span key={i} style={{ ...chip, color: "#8A8778", textDecoration: "line-through" }}
                        title={f.motivo}>
                    {f.arroba} · {f.motivo}
                  </span>
                ))}
              </div>
              {fora.length > 120 && (
                <div style={{ ...dica, marginTop: 5 }}>
                  …e mais {fora.length - 120}. O arquivo baixado traz todos.
                </div>
              )}
            </>
          )}

          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 11 }}>
            <button style={btnSecondary} onClick={copiar}>
              {copiado ? <Check size={13} /> : <Copy size={13} />} {copiado ? "Copiado" : "Copiar a lista"}
            </button>
            <button style={btnSecondary} onClick={baixar}>
              <Download size={13} /> Baixar em texto
            </button>
          </div>
          <div style={{ ...dica, marginTop: 7 }}>
            Essa lista é o que você publica no story. É ela que responde a quem disser que o
            sorteio foi arranjado.
          </div>
        </div>
      )}

      {/* o que já foi sorteado antes */}
      {historico.length > 0 && (
        <div style={cardStyle}>
          <div style={sectionLabel}>Sorteios anteriores</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {historico.map((h) => (
              <div key={h.id} style={{ display: "flex", gap: 9, flexWrap: "wrap",
                                       alignItems: "baseline", borderBottom: "1px solid #F0ECE2",
                                       paddingBottom: 6 }}>
                <b style={{ fontSize: 13 }}>{h.ganhador}</b>
                <span style={dica}>
                  {dataBonita(h.criado_em)} · {h.total_pessoas} participantes ·{" "}
                  {h.regra === "pessoa" ? "uma chance por pessoa"
                    : h.regra === "comentario" ? "uma chance por comentário" : "só quem marcou amigo"}
                  {h.posts > 0 ? ` · ${h.posts} post${h.posts === 1 ? "" : "s"}` : ""}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={avisoInfo}>
        <Info size={14} />
        <span><b>Antes de publicar:</b> sorteio no Instagram precisa dizer que o Instagram não
          participa nem patrocina a promoção, e não pode exigir que a pessoa marque a si mesma
          numa foto. Marcar amigos de verdade, pode.</span>
      </div>
    </div>
  );
}

function Numero({ v, r }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
      <b style={{ fontSize: 23, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{v ?? 0}</b>
      <span style={dica}>{r}</span>
    </div>
  );
}

function Opcao({ ativo, onClick, nome, desc }) {
  return (
    <button onClick={onClick}
            style={{ textAlign: "left", border: ativo ? "2px solid #22231F" : "1px solid #E8E2D2",
                     borderRadius: 9, background: ativo ? "#FBF9F4" : "#fff",
                     padding: ativo ? "6px 10px" : "7px 11px", cursor: "pointer", color: "#22231F" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{nome}</div>
      {desc && <div style={{ fontSize: 10.5, color: "#8A8778" }}>{desc}</div>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// estilos (os mesmos do MetaAds.jsx e do Patrocinar.jsx)
// ---------------------------------------------------------------------------
const cardStyle = { background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 13 };
const sectionLabel = {
  fontSize: 11, fontWeight: 800, letterSpacing: 0.4, textTransform: "uppercase",
  color: "#8A8778", marginBottom: 7,
};
const dica = { fontSize: 10.5, color: "#8A8778", lineHeight: 1.5 };
const btnPrimary = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
  background: "#22231F", color: "#F3EFE3", border: "none",
  borderRadius: 8, padding: "9px 15px", fontSize: 13, fontWeight: 700, cursor: "pointer",
};
const btnSecondary = {
  display: "inline-flex", alignItems: "center", gap: 6,
  background: "#F6F1E7", border: "1px solid #E8E2D2", color: "#22231F",
  borderRadius: 8, padding: "8px 13px", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
};
const inputStyle = {
  padding: "7px 9px", borderRadius: 8, border: "1px solid #E8E2D2",
  fontSize: 13, background: "#FFFFFF", color: "#22231F", boxSizing: "border-box",
};
const chip = { border: "1px solid #E8E2D2", borderRadius: 999, padding: "3px 9px",
               fontWeight: 600, fontSize: 11.5 };
const avisoInfo = {
  display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A",
  color: "#7A6A1E", borderRadius: 10, padding: "12px 13px", fontSize: 12.5, lineHeight: 1.5,
};
const avisoErro = {
  display: "flex", gap: 8, background: "#C4432B12", border: "1px solid #C4432B",
  color: "#A5351F", borderRadius: 10, padding: "12px 13px", fontSize: 12.5, lineHeight: 1.5,
};
