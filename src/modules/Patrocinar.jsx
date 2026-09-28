import React, { useState, useEffect, useCallback } from "react";
import {
  Loader2, AlertTriangle, CheckCircle2, Info, ExternalLink, Rocket, MapPin, RefreshCw, Download,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";

// ---------------------------------------------------------------------------
// Patrocinar — impulsionar um post que já existe no Instagram
//
// O painel prepara, você aprova aqui, a Edge Function chama a Meta.
// Esta tela nunca fala com a Meta direto e nunca vê token.
//
// O que NÃO mora aqui, de propósito:
//   - O teto do mês. Quem barra é o banco (gatilho em `patrocinios`):
//     esconder o botão não protege nada.
//   - Quem pode aprovar. A lista fica em `patrocinio_aprovador` e só muda
//     pelo SQL Editor. A tela só pergunta e obedece.
// ---------------------------------------------------------------------------

export { Rocket as IconePatrocinar };

async function chamarProxy(acao, corpo = {}) {
  const { data, error } = await supabase.functions.invoke("meta-ads-proxy", {
    body: { acao, ...corpo },
  });
  if (error) {
    let detalhe = error.message;
    try { const j = await error.context?.json?.(); if (j?.error) detalhe = j.error; } catch { /* não era json */ }
    return { erro: detalhe };
  }
  if (data?.error && !data?.etapas) return { erro: data.error };
  return { data };
}

export default function Patrocinar() {
  const [d, setD] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  // Posts escolhidos (até 3). Um só = patrocínio simples; mais = teste lado a lado.
  const [sel, setSel] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const r = await chamarProxy("patrocinio_dados");
    if (r.erro) setErro(r.erro);
    else { setErro(""); setD(r.data); }
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const alternar = (post) => {
    setResultado(null);
    setSel((atual) => {
      if (atual.some((p) => p.id === post.id)) return atual.filter((p) => p.id !== post.id);
      if (atual.length >= 3) return atual;
      return [...atual, post];
    });
  };

  const aprovar = async (pedido) => {
    setEnviando(true);
    setResultado(null);
    const r = await chamarProxy("patrocinar", { ...pedido, midia_ids: sel.map((p) => p.id), confirmo: true });
    setEnviando(false);
    if (r.erro) {
      setResultado({ tipo: "erro", texto: r.erro });
    } else if (r.data?.ok) {
      const comeca = new Date(r.data.comeca) > new Date(Date.now() + 3600000) ? `Começa em ${dataBR(r.data.comeca)}, ` : "No ar. ";
      setResultado({ tipo: "ok", texto: `${comeca}termina em ${dataBR(r.data.termina)}. A Meta ainda analisa o anúncio; costuma levar de minutos a algumas horas.` });
      setSel([]);
      await carregar();
    } else {
      const feitas = (r.data?.etapas || []).map((e) => e.etapa).join(", ");
      setResultado({
        tipo: "erro",
        texto: `A Meta recusou: ${r.data?.error || "erro sem detalhe"}.${feitas ? ` Chegou a criar (pausado, gastando zero): ${feitas}.` : ""} Não conta no teto.`,
      });
      await carregar();
    }
  };

  if (carregando && !d) return <Carregando />;
  if (erro) return <Aviso tipo="erro" texto={erro} />;
  if (!d) return null;

  const { config: cfg, mes, posts, ultimos, avisos, pode_aprovar: podeAprovar, no_ar: noAr = [] } = d;
  const sobra = Math.max(0, (mes?.teto || 0) - (mes?.aprovado || 0));
  const pct = mes?.teto ? Math.min(100, (mes.aprovado / mes.teto) * 100) : 0;
  const semPonto = cfg.centro_lat == null;

  return (
    <div style={{ display: "grid", gap: 10, paddingBottom: sel.length ? 260 : 0 }}>
      {resultado && <Aviso tipo={resultado.tipo} texto={resultado.texto} />}
      {(avisos || []).map((a, i) => <Aviso key={i} tipo="info" texto={a} />)}

      <NoAr lista={noAr} />

      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={sectionLabel}>Teto do mês</div>
          <button style={btnGhost} onClick={carregar} disabled={carregando}>
            {carregando ? <Loader2 size={12} /> : <RefreshCw size={12} />} Atualizar
          </button>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 13 }}>
          <strong>{dinheiro(mes?.aprovado)} aprovados de {dinheiro(mes?.teto)}</strong>
          <span style={{ color: "#8A8778" }}>sobram {dinheiro(sobra)}</span>
        </div>
        <div style={{ height: 9, background: "#F0ECE2", borderRadius: 99, overflow: "hidden", margin: "8px 0 4px" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: pct >= 90 ? "#C4432B" : "#22231F" }} />
        </div>
        <div style={dica}>
          O teto é barrado no banco: um patrocínio que passe dele é recusado antes de chegar na Meta.
          {!podeAprovar && " Você vê, mas não aprova: só quem está na lista de aprovadores."}
        </div>
        {mes?.gasto_conta != null && (
          <div style={{ ...dica, marginTop: 6, color: "#22231F" }}>
            Gasto real da conta neste mês (painel + agência + Gerenciador): <strong>{dinheiro(mes.gasto_conta)}</strong>.
            O teto acima só trava o que é aprovado aqui.
          </div>
        )}
      </div>

      <div style={cardStyle}>
        <div style={sectionLabel}>Posts do Instagram {cfg.instagram_usuario ? `@${cfg.instagram_usuario}` : ""}</div>
        {posts.length === 0 ? (
          <div style={dica}>Nenhum post encontrado.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(165px, 1fr))", gap: 9 }}>
            {posts.map((p) => (
              <Post key={p.id} p={p} ordem={sel.findIndex((x) => x.id === p.id) + 1}
                    onClick={() => podeAprovar && !semPonto && alternar(p)} clicavel={podeAprovar && !semPonto} />
            ))}
          </div>
        )}
        <div style={{ ...dica, marginTop: 8 }}>
          Clique em até 3 posts: com mais de um, eles dividem a verba e a Meta empurra o que funcionar melhor.
          Quer patrocinar um vídeo novo? Poste primeiro no Instagram; ele aparece aqui sozinho.
        </div>
      </div>

      {ultimos?.length > 0 && (
        <div style={cardStyle}>
          <div style={sectionLabel}>Últimas aprovações</div>
          {ultimos.map((u) => (
            <div key={u.id} style={{ borderTop: "1px solid #E8E2D2", padding: "7px 0", fontSize: 12.5 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {u.midias?.length > 1 ? `${u.midias.length} posts testados` : (u.midia_texto || `post ${u.midia_id}`)}
                  {u.objetivo === "cardapio" ? " · cardápio" : ""}
                </span>
                <span style={{ whiteSpace: "nowrap", fontWeight: 700 }}>
                  {dinheiro(u.valor)} · {u.dias}d · <Estado e={u.estado} />
                </span>
              </div>
              <div style={dica}>
                aprovado {dataBR(u.aprovado_em)}
                {u.erro && <span style={{ color: "#A5351F" }}> · {u.erro}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <Configuracao cfg={cfg} podeEditar={podeAprovar} aoSalvar={carregar} />

      {sel.length > 0 && (
        <BarraAprovacao sel={sel} cfg={cfg} sobra={sobra} curva={d.curva_pedidos}
                        enviando={enviando} aoCancelar={() => setSel([])} aoAprovar={aprovar} />
      )}
    </div>
  );
}

function Post({ p, ordem, onClick, clicavel }) {
  const h = p.historico;
  return (
    <div onClick={onClick}
         style={{ background: "#fff", border: ordem ? "2px solid #22231F" : "1px solid #E8E2D2",
                  borderRadius: 11, overflow: "hidden", cursor: clicavel ? "pointer" : "default", position: "relative" }}>
      {ordem > 0 && (
        <div style={{ position: "absolute", top: 7, right: 7, width: 22, height: 22, borderRadius: 99,
                      background: "#22231F", color: "#F3EFE3", fontSize: 12, fontWeight: 800,
                      display: "flex", alignItems: "center", justifyContent: "center" }}>{ordem}</div>
      )}
      <div style={{ aspectRatio: "4 / 5", background: "#F0ECE2" }}>
        {p.foto && <img src={p.foto} alt="" loading="lazy"
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
      </div>
      <div style={{ padding: 8 }}>
        <div style={{ fontSize: 12, lineHeight: 1.35, height: 32, overflow: "hidden", marginBottom: 5 }}>
          {p.texto || <span style={{ color: "#8A8778" }}>sem legenda</span>}
        </div>
        {!h ? (
          <span style={{ ...tagBase, color: "#8A8778" }}>Nunca patrocinado</span>
        ) : h.no_ar ? (
          <span style={{ ...tagBase, ...tagOk }}>No ar · {dinheiro(h.gasto)}</span>
        ) : (
          <span style={{ ...tagBase, color: "#555" }}>{cap(h.situacao || "encerrado")} · {dinheiro(h.gasto)}</span>
        )}
        <div style={{ ...dica, marginTop: 5 }}>
          {resumoPost(p)}
        </div>
        <div style={{ ...dica, marginTop: 2 }}>
          {h ? `${numero(h.conversas)} conversas` : "sem anúncio"}
          {h?.no_ar && h.termina ? ` · até ${dataCurta(h.termina)}` : ""}
          {p.link && (
            <> · <a href={p.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
                    style={{ color: "#8A8778" }}>ver <ExternalLink size={10} /></a></>
          )}
          {p.arquivo && (
            <> · <a href={p.arquivo} onClick={(e) => { e.stopPropagation(); e.preventDefault(); baixar(p); }}
                    style={{ color: "#8A8778", cursor: "pointer" }}>baixar <Download size={10} /></a></>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barra de aprovação. O básico fica sempre à vista (valor e dias); o resto
// ("Mais opções") começa no padrão, que é exatamente o patrocínio simples.
// ---------------------------------------------------------------------------
const OBJ = [
  { v: "whatsapp", n: "Mensagens no WhatsApp", d: "A pessoa chama no WhatsApp." },
  { v: "cardapio", n: "Visitas ao cardápio", d: "Leva direto ao link de pedido." },
  { v: "vendas", n: "Vendas", d: "A Meta busca quem compra.", trava: "precisa do Pixel no CardápioWeb" },
];
const POS = [
  { v: "auto", n: "Automático" },
  { v: "stories_reels", n: "Só Reels e Stories" },
  { v: "feed", n: "Só feed" },
];
const PUB = [
  { v: "raio", n: "Todo mundo no raio" },
  { v: "raio_engajou", n: "Só quem já interagiu com o @" },
  { v: "raio_sem_engajou", n: "Raio, sem quem já interagiu" },
];

// Sugestão: horas com pelo menos 25% do pico de pedidos, mais a hora antes de
// cada bloco (a pessoa vê o anúncio e pede em seguida).
function sugerirHoras(curva) {
  if (!curva) return null;
  const pico = Math.max(...curva);
  if (!pico) return null;
  const fortes = new Set(curva.map((v, h) => (v >= pico * 0.25 ? h : null)).filter((h) => h != null));
  for (const h of [...fortes]) if (h > 0 && !fortes.has(h - 1)) fortes.add(h - 1);
  return [...fortes].sort((a, b) => a - b);
}

function descreverHoras(horas) {
  if (!horas || horas.length === 24) return "o dia todo";
  const h = [...horas].sort((a, b) => a - b);
  const blocos = [];
  for (const x of h) {
    const u = blocos[blocos.length - 1];
    if (u && u[1] === x) u[1] = x + 1; else blocos.push([x, x + 1]);
  }
  return blocos.map(([a, b]) => `${a}h–${b === 24 ? "0" : b}h`).join(", ");
}

function hojeISO() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function BarraAprovacao({ sel, cfg, sobra, curva, enviando, aoCancelar, aoAprovar }) {
  const [valor, setValor] = useState(String(cfg.valor_padrao ?? ""));
  const [dias, setDias] = useState(String(cfg.dias_padrao ?? ""));
  const [mais, setMais] = useState(false);
  const [objetivo, setObjetivo] = useState("whatsapp");
  const [posicionamento, setPosicionamento] = useState("auto");
  const [publico, setPublico] = useState("raio");
  const [inicio, setInicio] = useState("");
  const [horas, setHoras] = useState(null); // null = o dia todo
  const [confirmo, setConfirmo] = useState(false);

  const mexeu = (fn) => (...a) => { fn(...a); setConfirmo(false); };
  // Trocou os posts escolhidos: a confirmação anterior não vale mais.
  const chave = sel.map((p) => p.id).join(",");
  useEffect(() => { setConfirmo(false); }, [chave]);
  const valorNum = Number(String(valor).replace(",", "."));
  const sugestao = sugerirHoras(curva);
  const semCardapio = objetivo === "cardapio" && !cfg.cardapio_url;

  const alternarHora = mexeu((h) => {
    const atual = new Set(horas ?? Array.from({ length: 24 }, (_, i) => i));
    if (atual.has(h)) atual.delete(h); else atual.add(h);
    const lista = [...atual].sort((a, b) => a - b);
    setHoras(lista.length === 24 ? null : lista.length ? lista : null);
  });

  const enviar = () => aoAprovar({
    valor: valorNum,
    dias: Number(dias),
    objetivo, posicionamento, publico,
    inicio: inicio || null,
    horas,
  });

  const resumo = [
    OBJ.find((o) => o.v === objetivo).n,
    `${sel.length} post${sel.length > 1 ? "s" : ""}`,
    POS.find((o) => o.v === posicionamento).n.toLowerCase(),
    PUB.find((o) => o.v === publico).n.toLowerCase(),
    inicio ? `começa ${inicio.split("-").reverse().slice(0, 2).join("/")}` : "começa agora",
    descreverHoras(horas),
  ].join(" · ");

  return (
    <div style={barraFixa}>
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "11px 16px", display: "grid", gap: 8, maxHeight: "75vh", overflowY: "auto" }}>
        <div style={{ fontWeight: 700, fontSize: 13 }}>
          {sel.length === 1
            ? <>Patrocinar: “{sel[0].texto?.slice(0, 70) || `post ${sel[0].id}`}”</>
            : <>Testar {sel.length} posts juntos, dividindo a verba</>}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }}>
          <label>Valor R$ <input style={{ ...inputStyle, width: 80 }} inputMode="decimal"
                 value={valor} onChange={(e) => mexeu(setValor)(e.target.value)} /></label>
          <label>Dias <input style={{ ...inputStyle, width: 56 }} inputMode="numeric"
                 value={dias} onChange={(e) => mexeu(setDias)(e.target.value)} /></label>
          <span style={chip}>{cfg.raio_km} km</span>
          <span style={chip}>{cfg.idade_min}–{cfg.idade_max} anos</span>
          <button style={btnGhost} onClick={() => setMais(!mais)}>{mais ? "Menos opções" : "Mais opções"}</button>
        </div>

        {mais && (
          <div style={{ display: "grid", gap: 10, borderTop: "1px solid #E8E2D2", paddingTop: 9 }}>
            <Grupo titulo="O que você quer que aconteça">
              {OBJ.map((o) => (
                <Opcao key={o.v} ativo={objetivo === o.v} travado={!!o.trava}
                       onClick={() => !o.trava && mexeu(setObjetivo)(o.v)} nome={o.n} desc={o.trava || o.d} />
              ))}
            </Grupo>
            {semCardapio && <Aviso tipo="info" texto="Cadastre o link do cardápio na Configuração do patrocínio (Editar) para usar esse objetivo." />}

            <Grupo titulo="Onde aparece">
              {POS.map((o) => <Opcao key={o.v} ativo={posicionamento === o.v} onClick={() => mexeu(setPosicionamento)(o.v)} nome={o.n} />)}
            </Grupo>
            <div style={dica}>Post que é Reel serve para Stories e Reels. Foto quadrada em Stories fica com faixa em volta — por isso o padrão é automático.</div>

            <Grupo titulo="Quem vê">
              {PUB.map((o) => <Opcao key={o.v} ativo={publico === o.v} onClick={() => mexeu(setPublico)(o.v)} nome={o.n} />)}
            </Grupo>
            <div style={dica}>Sempre dentro do raio de {cfg.raio_km} km. "Quem já interagiu" é quem curtiu, comentou, salvou ou mandou mensagem ao @ no último ano; o público é criado na primeira vez que você usar.</div>

            <Grupo titulo="Quando começa">
              <Opcao ativo={!inicio} onClick={() => mexeu(setInicio)("")} nome="Agora" />
              <input type="date" style={{ ...inputStyle, height: 34 }} min={hojeISO()} value={inicio}
                     onChange={(e) => mexeu(setInicio)(e.target.value)} />
            </Grupo>

            <div>
              <div style={{ ...dica, fontWeight: 700, color: "#22231F", marginBottom: 5 }}>
                Horário do dia em que roda: {descreverHoras(horas)}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 2 }}>
                {Array.from({ length: 24 }, (_, h) => {
                  const on = !horas || horas.includes(h);
                  return (
                    <button key={h} onClick={() => alternarHora(h)} title={`${h}h`}
                            style={{ height: 26, border: 0, borderRadius: 3, cursor: "pointer", padding: 0, fontSize: 9,
                                     background: on ? "#22231F" : "#F0ECE2", color: on ? "#F3EFE3" : "#8A8778" }}>
                      {h % 3 === 0 ? h : ""}
                    </button>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                <button style={btnGhost} onClick={() => mexeu(setHoras)(null)}>O dia todo</button>
                {sugestao && (
                  <button style={btnGhost} onClick={() => mexeu(setHoras)(sugestao.length === 24 ? null : sugestao)}>
                    Usar horário dos pedidos ({descreverHoras(sugestao)})
                  </button>
                )}
              </div>
              <div style={{ ...dica, marginTop: 4 }}>
                {sugestao ? "A sugestão vem dos pedidos do CardápioWeb nos últimos 30 dias, com uma hora antes de cada pico." : "Sem curva de pedidos ainda: rode \"Buscar ontem\" em Ajustes para ter sugestão."}
              </div>
            </div>
          </div>
        )}

        <div style={{ ...dica, color: "#22231F" }}>{resumo}</div>
        <label style={{ fontSize: 12.5, display: "flex", gap: 7, alignItems: "flex-start" }}>
          <input type="checkbox" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} />
          <span>
            Confirmo gastar até <strong>{dinheiro(valorNum)}</strong> em <strong>{dias || "?"} dias</strong>
            {Number.isFinite(valorNum) && ` (sobram ${dinheiro(Math.max(0, sobra - valorNum))} no mês depois deste)`}.
          </span>
        </label>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={btnSecondary} onClick={aoCancelar} disabled={enviando}>Cancelar</button>
          <button style={{ ...btnPrimary, opacity: confirmo && !semCardapio ? 1 : 0.45 }} onClick={enviar}
                  disabled={!confirmo || enviando || semCardapio}>
            {enviando ? <Loader2 size={13} /> : <Rocket size={13} />} {enviando ? "Criando na Meta…" : sel.length > 1 ? "Aprovar e criar campanha" : "Aprovar e patrocinar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Grupo({ titulo, children }) {
  return (
    <div>
      <div style={{ ...dica, fontWeight: 700, color: "#22231F", marginBottom: 5 }}>{titulo}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "stretch" }}>{children}</div>
    </div>
  );
}

function Opcao({ ativo, travado, onClick, nome, desc }) {
  return (
    <button onClick={onClick} disabled={travado}
            style={{ textAlign: "left", border: ativo ? "2px solid #22231F" : "1px solid #E8E2D2", borderRadius: 9,
                     background: ativo ? "#FBF9F4" : "#fff", padding: ativo ? "6px 10px" : "7px 11px",
                     cursor: travado ? "not-allowed" : "pointer", opacity: travado ? 0.5 : 1, color: "#22231F" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700 }}>{nome}</div>
      {desc && <div style={{ fontSize: 10.5, color: travado ? "#8A6E12" : "#8A8778" }}>{desc}</div>}
    </button>
  );
}

// Baixa o arquivo original do post. Se o navegador não deixar baixar direto
// (o servidor do Instagram às vezes recusa), abre numa aba nova — aí é só
// clicar com o botão direito e "Salvar como".
async function baixar(p) {
  const ext = p.tipo === "VIDEO" ? "mp4" : "jpg";
  const nome = `mrkong-${(p.data || "").slice(0, 10)}-${p.id}.${ext}`;
  try {
    const r = await fetch(p.arquivo);
    if (!r.ok) throw new Error(String(r.status));
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement("a");
    a.href = url; a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch {
    window.open(p.arquivo, "_blank", "noopener");
  }
}

// Tudo o que está rodando na conta agora — do painel, da agência, do Gerenciador.
function NoAr({ lista }) {
  const semana = lista.reduce((s, x) => s + (Number(x.gasto_7d) || 0), 0);
  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={sectionLabel}>No ar agora · {lista.length} {lista.length === 1 ? "anúncio" : "anúncios"}</div>
        {lista.length > 0 && <div style={{ ...dica, fontWeight: 700 }}>gastaram {dinheiro(semana)} nos últimos 7 dias</div>}
      </div>
      {lista.length === 0 ? (
        <div style={dica}>Nenhum anúncio rodando na conta agora — nem pelo painel, nem pelo Gerenciador.</div>
      ) : lista.map((a) => <AnuncioNoAr key={a.anuncio_id} a={a} />)}
    </div>
  );
}

function AnuncioNoAr({ a }) {
  const emAnalise = a.situacao !== "no ar";
  // Conversa só é resultado quando o anúncio foi feito para isso. Num anúncio
  // de alcance ou engajamento, "0 conversas" não é fracasso — é outra meta.
  const deMensagem = !a.otimiza || a.otimiza === "CONVERSATIONS";
  const porConversa = deMensagem && a.conversas > 0 ? a.gasto / a.conversas : null;
  const ctr = a.impressoes > 0 ? (a.cliques / a.impressoes) * 100 : null;
  const verba = a.painel ? Number(a.painel.valor) : a.orcamento_total;
  const usoVerba = verba ? Math.min(100, (a.gasto / verba) * 100) : null;
  let prazo = null;
  if (a.inicio && a.termina) {
    const ini = new Date(a.inicio).getTime(), fim = new Date(a.termina).getTime();
    const totalDias = Math.max(1, Math.round((fim - ini) / 86400000));
    const passados = Math.min(totalDias, Math.max(0, Math.ceil((Date.now() - ini) / 86400000)));
    prazo = `${passados} de ${totalDias} dias`;
  }
  const origem = a.painel
    ? `feito pelo painel · aprovado ${dataCurta(a.painel.aprovado_em)} · ${dinheiro(a.painel.valor)} em ${a.painel.dias} dias${a.painel.varios ? " (verba dividida entre os posts do teste)" : ""}`
    : `feito no Gerenciador${a.otimiza ? ` · busca ${OTIMIZA[a.otimiza] || a.otimiza.toLowerCase()}` : ""} · ${a.orcamento_diario ? `${dinheiro(a.orcamento_diario)} por dia` : a.orcamento_total ? `${dinheiro(a.orcamento_total)} no total` : "orçamento na campanha"}${a.inicio ? ` · desde ${dataCurta(a.inicio)}` : ""}`;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 11, padding: "10px 0", borderTop: "1px solid #E8E2D2" }}>
      <div style={{ width: 84, height: 105, borderRadius: 9, background: "#F0ECE2", overflow: "hidden" }}>
        {a.foto && <img src={a.foto} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 2 }}>
          <span style={{ fontWeight: 700, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
            {a.texto || a.nome}
          </span>
          <span style={{ ...tagBase, ...(emAnalise ? tagAnalise : tagOk) }}>
            {cap(a.situacao)}{!emAnalise ? (a.termina ? ` · termina ${dataCurta(a.termina)}` : " · contínuo") : ""}
          </span>
        </div>
        <div style={{ ...dica, marginBottom: 7 }}>{origem}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))", gap: 6, opacity: emAnalise && !a.gasto ? 0.5 : 1 }}>
          <Numero v={dinheiro(a.gasto_7d)} r="gasto nos últimos 7 dias" />
          <Numero v={dinheiro(a.gasto)} r="gasto desde o início" />
          <Numero v={deMensagem ? numero(a.conversas) : "—"} r={deMensagem ? "conversas no WhatsApp" : "não busca conversas"} />
          <Numero v={porConversa != null ? dinheiro(porConversa) : "—"} r="por conversa" />
          <Numero v={a.alcance ? numero(a.alcance) : "—"} r="pessoas alcançadas" />
          <Numero v={ctr != null ? `${ctr.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"} r="clicaram no link" />
        </div>
        {usoVerba != null && (
          <>
            <div style={{ height: 6, background: "#F0ECE2", borderRadius: 99, overflow: "hidden", marginTop: 8 }}>
              <div style={{ width: `${usoVerba}%`, height: "100%", background: "#22231F" }} />
            </div>
            <div style={{ ...dica, marginTop: 3 }}>
              {Math.round(usoVerba)}% da verba usada{prazo ? ` · ${prazo}` : ""}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const OTIMIZA = {
  CONVERSATIONS: "conversas", REACH: "alcance", IMPRESSIONS: "impressões",
  LINK_CLICKS: "cliques", LANDING_PAGE_VIEWS: "visitas ao site", POST_ENGAGEMENT: "engajamento",
  THRUPLAY: "vídeo assistido", OFFSITE_CONVERSIONS: "vendas", LEAD_GENERATION: "cadastros",
  PROFILE_VISIT: "visitas ao perfil", VALUE: "valor de venda",
};

function Numero({ v, r }) {
  return (
    <div style={{ background: "#F6F1E7", borderRadius: 8, padding: "6px 8px" }}>
      <div style={{ fontWeight: 800, fontSize: 14 }}>{v}</div>
      <div style={{ fontSize: 10, color: "#8A8778" }}>{r}</div>
    </div>
  );
}

// "vídeo · 8 curtidas · 1 comentário · 25/09", como no painel da Dinâmico.
const TIPOS = { VIDEO: "vídeo", IMAGE: "foto", CAROUSEL_ALBUM: "carrossel" };
function resumoPost(p) {
  const partes = [TIPOS[p.tipo] || "post"];
  if (p.curtidas != null) partes.push(`${numero(p.curtidas)} ${p.curtidas === 1 ? "curtida" : "curtidas"}`);
  if (p.comentarios != null) partes.push(`${numero(p.comentarios)} ${p.comentarios === 1 ? "comentário" : "comentários"}`);
  partes.push(dataCurta(p.data));
  return partes.join(" · ");
}

function Configuracao({ cfg, podeEditar, aoSalvar }) {
  const [f, setF] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState(null);

  const abrir = () => setF({
    ponto: cfg.centro_lat != null ? `${cfg.centro_lat}, ${cfg.centro_lng}` : "",
    raio_km: cfg.raio_km, quem_conta: cfg.quem_conta,
    idade_min: cfg.idade_min, idade_max: cfg.idade_max,
    teto_mensal: cfg.teto_mensal, valor_padrao: cfg.valor_padrao, dias_padrao: cfg.dias_padrao,
    cardapio_url: cfg.cardapio_url ?? "",
  });

  const salvar = async () => {
    // Aceita "-17.79, -50.93" ou um link do Google Maps com "@-17.79,-50.93".
    const m = String(f.ponto).match(/(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/);
    if (!m) { setMsg({ tipo: "erro", texto: "Ponto inválido. Cole as coordenadas do Google Maps, por exemplo -17.7923, -50.9194." }); return; }
    const n = (v) => Number(String(v).replace(",", "."));
    setSalvando(true);
    const { error } = await supabase.from("patrocinio_config").update({
      centro_lat: n(m[1]), centro_lng: n(m[2]),
      raio_km: n(f.raio_km), quem_conta: f.quem_conta,
      idade_min: n(f.idade_min), idade_max: n(f.idade_max),
      teto_mensal: n(f.teto_mensal), valor_padrao: n(f.valor_padrao), dias_padrao: n(f.dias_padrao),
      cardapio_url: String(f.cardapio_url || "").trim() || null,
    }).eq("conta_id", cfg.conta_id);
    setSalvando(false);
    if (error) setMsg({ tipo: "erro", texto: traduzir(error.message) });
    else { setMsg({ tipo: "ok", texto: "Salvo." }); setF(null); aoSalvar(); }
  };

  const campo = (k, rotulo, props = {}) => (
    <label style={{ display: "grid", gap: 3, fontSize: 11.5, color: "#8A8778" }}>
      {rotulo}
      <input style={campoStyle} value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...props} />
    </label>
  );

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={sectionLabel}>Configuração do patrocínio</div>
        {podeEditar && !f && <button style={btnGhost} onClick={abrir}>Editar</button>}
      </div>
      {msg && <div style={{ marginBottom: 8 }}><Aviso tipo={msg.tipo} texto={msg.texto} /></div>}

      {!f ? (
        <>
          <Linha nome="Página" valor={cfg.pagina_nome || "—"} />
          <Linha nome="Instagram" valor={cfg.instagram_usuario ? `@${cfg.instagram_usuario}` : "—"} />
          <Linha nome="Para onde a pessoa vai" valor="WhatsApp ligado à Página, ou o cardápio" />
          <Linha nome="Link do cardápio" valor={cfg.cardapio_url
            ? <a style={{ color: "#22231F" }} href={cfg.cardapio_url} target="_blank" rel="noreferrer">{cfg.cardapio_url.replace(/^https:\/\//, "").slice(0, 40)}</a>
            : <span style={{ color: "#8A8778" }}>não cadastrado</span>} />
          <Linha nome="Onde" valor={cfg.centro_lat != null
            ? <a style={{ color: "#22231F" }} target="_blank" rel="noreferrer"
                 href={`https://www.google.com/maps?q=${cfg.centro_lat},${cfg.centro_lng}`}>
                <MapPin size={11} /> {cfg.raio_km} km do ponto
              </a>
            : <span style={{ color: "#A5351F" }}>falta marcar o ponto</span>} />
          <Linha nome="Quem" valor={`${cfg.idade_min} a ${cfg.idade_max} anos · ${cfg.quem_conta === "mora" ? "quem mora na área" : "quem mora ou esteve na área"}`} />
          <Linha nome="Teto do mês" valor={dinheiro(cfg.teto_mensal)} />
          <Linha nome="Padrão de cada patrocínio" valor={`${dinheiro(cfg.valor_padrao)} · ${cfg.dias_padrao} dias`} />
        </>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {campo("cardapio_url", "Link do cardápio para pedir (usado no objetivo \"Visitas ao cardápio\")", { placeholder: "https://…" })}
          {campo("ponto", "Ponto do restaurante (cole do Google Maps: botão direito no local → clicar nos números)", { placeholder: "-17.7923, -50.9194" })}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
            {campo("raio_km", "Raio (km)", { inputMode: "numeric" })}
            <label style={{ display: "grid", gap: 3, fontSize: 11.5, color: "#8A8778" }}>
              Quem conta
              <select style={campoStyle} value={f.quem_conta} onChange={(e) => setF({ ...f, quem_conta: e.target.value })}>
                <option value="mora_ou_esteve">Mora ou esteve na área</option>
                <option value="mora">Só quem mora</option>
              </select>
            </label>
            {campo("idade_min", "Idade mínima", { inputMode: "numeric" })}
            {campo("idade_max", "Idade máxima", { inputMode: "numeric" })}
            {campo("teto_mensal", "Teto do mês (R$)", { inputMode: "decimal" })}
            {campo("valor_padrao", "Valor padrão (R$)", { inputMode: "decimal" })}
            {campo("dias_padrao", "Dias padrão", { inputMode: "numeric" })}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button style={btnSecondary} onClick={() => { setF(null); setMsg(null); }} disabled={salvando}>Cancelar</button>
            <button style={btnPrimary} onClick={salvar} disabled={salvando}>
              {salvando ? <Loader2 size={13} /> : null} Salvar
            </button>
          </div>
        </div>
      )}
      <div style={{ ...dica, marginTop: 8 }}>
        Página e Instagram vêm da própria Meta; não se digitam. O número do WhatsApp é o que está ligado à Página no Facebook.
      </div>
    </div>
  );
}

// As travas do banco falam em nome de restrição; aqui vira frase.
function traduzir(m) {
  if (/pc_padrao/.test(m)) return "O valor padrão tem que ser maior que zero e caber no teto do mês.";
  if (/pc_teto/.test(m)) return "O teto tem que ser maior que zero (e no máximo R$ 20.000).";
  if (/pc_idade/.test(m)) return "Idade de 18 a 65, e a mínima não pode passar da máxima.";
  if (/pc_raio/.test(m)) return "Raio de 1 a 80 km.";
  if (/pc_dias/.test(m)) return "Dias padrão de 1 a 30.";
  if (/pc_centro/.test(m)) return "O ponto tem que estar no Brasil.";
  if (/pc_cardapio/.test(m)) return "O link do cardápio tem que começar com https://";
  if (/permission|policy|row-level/i.test(m)) return "Só quem aprova patrocínio muda esta configuração.";
  return m;
}

function Estado({ e }) {
  if (e === "publicado") return <span style={{ color: "#2F8F5B" }}>publicado</span>;
  if (e === "falhou") return <span style={{ color: "#C4432B" }}>falhou</span>;
  return <span style={{ color: "#8A6E12" }}>aprovado</span>;
}

function Linha({ nome, valor }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0",
                  borderTop: "1px solid #E8E2D2", fontSize: 12.5 }}>
      <span style={{ color: "#8A8778" }}>{nome}</span>
      <span style={{ fontWeight: 700, textAlign: "right" }}>{valor}</span>
    </div>
  );
}

function Carregando() {
  return <div style={{ ...cardStyle, color: "#8A8778", fontSize: 12.5 }}><Loader2 size={13} /> Buscando posts e gastos na Meta…</div>;
}

function Aviso({ tipo, texto }) {
  const estilo = tipo === "ok" ? avisoOk : tipo === "erro" ? avisoErro : avisoInfo;
  const Icone = tipo === "ok" ? CheckCircle2 : tipo === "erro" ? AlertTriangle : Info;
  return (
    <div style={estilo}>
      <Icone size={15} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{texto}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formato
// ---------------------------------------------------------------------------
function dinheiro(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function numero(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("pt-BR", { maximumFractionDigits: 0 }) : "—";
}
function dataBR(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function dataCurta(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// ---------------------------------------------------------------------------
// estilos (os mesmos do MetaAds.jsx)
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
const btnGhost = {
  display: "inline-flex", alignItems: "center", gap: 5, background: "transparent",
  border: "1px solid #E8E2D2", color: "#22231F", borderRadius: 8, padding: "4px 9px",
  fontSize: 11.5, fontWeight: 600, cursor: "pointer",
};
const inputStyle = {
  padding: "7px 9px", borderRadius: 8, border: "1px solid #E8E2D2",
  fontSize: 13, background: "#FFFFFF", color: "#22231F", boxSizing: "border-box",
};
// No formulário o campo ocupa a célula inteira e nunca passa da borda.
const campoStyle = { ...inputStyle, width: "100%", minWidth: 0 };
const chip = { border: "1px solid #E8E2D2", borderRadius: 999, padding: "3px 9px", fontWeight: 600 };
const tagBase = {
  fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 999,
  border: "1px solid #E8E2D2", background: "#F6F1E7", display: "inline-block",
};
const tagAnalise = { color: "#8A6E12", borderColor: "#C9A227", background: "#C9A22722" };
const tagOk = { color: "#2F8F5B", borderColor: "#2F8F5B", background: "#2F8F5B14" };
const barraFixa = {
  position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50,
  background: "#FFFFFF", borderTop: "1px solid #E8E2D2", boxShadow: "0 -6px 20px rgba(0,0,0,.07)",
};
const avisoInfo = {
  display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A",
  color: "#7A6A1E", borderRadius: 10, padding: "12px 13px", fontSize: 12.5, lineHeight: 1.5,
};
const avisoOk = {
  display: "flex", gap: 8, background: "#2F8F5B14", border: "1px solid #2F8F5B",
  color: "#256F47", borderRadius: 10, padding: "12px 13px", fontSize: 12.5, lineHeight: 1.5,
};
const avisoErro = {
  display: "flex", gap: 8, background: "#C4432B12", border: "1px solid #C4432B",
  color: "#A5351F", borderRadius: 10, padding: "12px 13px", fontSize: 12.5, lineHeight: 1.5,
};
