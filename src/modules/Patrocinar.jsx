import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  Loader2, AlertTriangle, CheckCircle2, Info, ExternalLink, Rocket, MapPin, RefreshCw, Download, X,
  Maximize2, Minimize2,
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
  const recarregarMidias = useCallback(async () => {
    const { data } = await supabase.from("anuncio_midias")
      .select("*").order("criado_em", { ascending: false }).limit(24);
    setMidias(data || []);
  }, []);
  const [erro, setErro] = useState("");
  // Posts escolhidos (até 3). Um só = patrocínio simples; mais = teste lado a lado.
  const [sel, setSel] = useState([]);
  // (058) Arquivo subido que não passa pelo feed. É exclusivo com os posts:
  // ou se patrocina um post do Instagram, ou um arquivo — nunca os dois.
  const [midias, setMidias] = useState([]);
  const [midiaSubida, setMidiaSubida] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const r = await chamarProxy("patrocinio_dados");
    // As mídias subidas vêm direto do banco: são do painel, não da Meta.
    const { data: ms } = await supabase.from("anuncio_midias")
      .select("*").order("criado_em", { ascending: false }).limit(24);
    setMidias(ms || []);
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

      <NoAr lista={noAr} podeEncerrar={podeAprovar} aoRecarregar={carregar} />

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
        <SubirMidia contaId={cfg.conta_id} midias={midias} aoMudar={recarregarMidias}
                    escolhida={midiaSubida}
                    aoEscolher={(id) => { setMidiaSubida(id); if (id) setSel([]); }}
                    podeAprovar={podeAprovar && !semPonto} />

        <div style={sectionLabel}>Posts do Instagram {cfg.instagram_usuario ? `@${cfg.instagram_usuario}` : ""}</div>
        {posts.length === 0 ? (
          <div style={dica}>Nenhum post encontrado.</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(165px, 1fr))", gap: 9 }}>
            {posts.map((p) => (
              <Post key={p.id} p={p} ordem={sel.findIndex((x) => x.id === p.id) + 1}
                    onClick={() => { if (podeAprovar && !semPonto) { setMidiaSubida(null); alternar(p); } }}
                    clicavel={podeAprovar && !semPonto} />
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

      {(sel.length > 0 || midiaSubida) && (
        <BarraAprovacao sel={sel} cfg={cfg} sobra={sobra} curva={d.curva_pedidos}
                        subida={midias.find((m) => m.id === midiaSubida) || null}
                        pontosSalvos={d.pontos_salvos} aoSalvarPontos={carregar}
                        enviando={enviando}
                        aoCancelar={() => { setSel([]); setMidiaSubida(null); }}
                        aoAprovar={aprovar} />
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

// A tela escrevia so o que estava LIGADO — "0h-17h, 21h-0h" — e quem olha
// tem que fazer a conta de cabeca para perceber que 18h, 19h e 20h sumiram.
// Foi exatamente assim que o jantar inteiro de uma hamburgueria ficou fora
// do ar sem ninguem notar. Agora o desligado tambem e escrito, em vermelho.
function horasDesligadas(horas) {
  if (!horas || horas.length === 24) return [];
  const ligadas = new Set(horas);
  return Array.from({ length: 24 }, (_, h) => h).filter((h) => !ligadas.has(h));
}

// As janelas em que um restaurante vende. Nao sao palpite sobre o negocio:
// sao os dois momentos em que alguem decide o que vai comer. Desligar o
// anuncio dentro de uma delas quase nunca e proposital.
const REFEICOES = [
  { nome: "almoço", de: 11, ate: 14 },
  { nome: "jantar", de: 18, ate: 22 },
];

function refeicoesDesligadas(horas) {
  if (!horas || horas.length === 24) return [];
  const ligadas = new Set(horas);
  return REFEICOES.filter((r) => {
    let fora = 0, total = 0;
    for (let h = r.de; h < r.ate; h++) { total++; if (!ligadas.has(h)) fora++; }
    return fora >= Math.ceil(total / 2);   // metade ou mais da refeicao fora
  });
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

// ---------------------------------------------------------------------
// MAPA DE PONTOS  (precisa da 057 e da meta-ads-proxy nova)
//
// Um raio só de 6 km em volta da loja faz você pagar por gente que mora
// onde a entrega não chega, e deixa de fora o shopping que fica a 7 km.
// A Meta aceita até 20 pontos num conjunto, cada um com o seu raio —
// `custom_locations` sempre foi uma lista; o painel é que só mandava um.
//
// O Leaflet entra por CDN e não pelo package.json de propósito: assim o
// mapa não vira uma dependência do build inteiro, e quem sobe arquivo à
// mão não precisa subir package.json junto. Se o CDN não responder, a
// tela cai no modo sem mapa — dá pra digitar a coordenada e continuar.
// ---------------------------------------------------------------------
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

function usarLeaflet() {
  // `typeof window` e não `window.L` direto: o app é só navegador hoje,
  // mas um render fora dele quebraria aqui, e o custo do guarda é zero.
  const [pronto, setPronto] = useState(typeof window !== "undefined" && !!window.L);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.L) { setPronto(true); return; }
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = LEAFLET_CSS;
      document.head.appendChild(l);
    }
    let s = document.querySelector(`script[src="${LEAFLET_JS}"]`);
    if (!s) {
      s = document.createElement("script");
      s.src = LEAFLET_JS; s.async = true;
      document.head.appendChild(s);
    }
    const ok = () => setPronto(true);
    const ruim = () => setFalhou(true);
    s.addEventListener("load", ok);
    s.addEventListener("error", ruim);
    return () => { s.removeEventListener("load", ok); s.removeEventListener("error", ruim); };
  }, []);
  return { pronto, falhou };
}

function MapaPontos({ pontos, aoMudar, centro }) {
  const { pronto, falhou } = usarLeaflet();
  // Marcar bairro por bairro num mapa de 230 px é adivinhação. Começa alto e
  // tem o botão de ampliar para quando o trabalho é mais fino.
  const [grande, setGrande] = useState(false);
  const caixa = useRef(null);
  const mapa = useRef(null);
  const camadas = useRef([]);
  // A lista mais recente, sem reinscrever os eventos do mapa a cada render.
  const atual = useRef(pontos);
  useEffect(() => { atual.current = pontos; }, [pontos]);

  useEffect(() => {
    if (!pronto || !caixa.current || mapa.current) return;
    const L = window.L;
    const m = L.map(caixa.current, { zoomControl: true })
      .setView([centro.lat, centro.lng], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "© OpenStreetMap",
    }).addTo(m);
    // Clicar no mapa põe um ponto novo com 2 km.
    m.on("click", (e) => {
      const lista = atual.current;
      if (lista.length >= 20) return;
      aoMudar([...lista, {
        lat: Number(e.latlng.lat.toFixed(6)),
        lng: Number(e.latlng.lng.toFixed(6)),
        raio: 2, nome: "",
      }]);
    });
    mapa.current = m;
    // O mapa nasce dentro de uma barra que acabou de abrir; sem isto ele
    // calcula o tamanho errado e metade dos tiles fica cinza.
    setTimeout(() => m.invalidateSize(), 60);
    return () => { m.remove(); mapa.current = null; };
  }, [pronto, centro.lat, centro.lng, aoMudar]);

  // Ao crescer ou encolher, o Leaflet precisa remedir a caixa, senão fica
  // metade do mapa cinza. O atraso espera a transição de altura terminar.
  useEffect(() => {
    if (!mapa.current) return;
    const t = setTimeout(() => mapa.current && mapa.current.invalidateSize(), 220);
    return () => clearTimeout(t);
  }, [grande]);

  // Redesenha pinos e círculos quando a lista muda.
  useEffect(() => {
    if (!mapa.current || !window.L) return;
    const L = window.L;
    for (const c of camadas.current) c.remove();
    camadas.current = [];
    pontos.forEach((p, i) => {
      const circulo = L.circle([p.lat, p.lng], {
        radius: p.raio * 1000, color: "#C4432B", weight: 1.5,
        fillColor: "#C4432B", fillOpacity: 0.12,
      }).addTo(mapa.current);
      const pino = L.marker([p.lat, p.lng], { draggable: true })
        .addTo(mapa.current)
        .bindTooltip(String(i + 1), { permanent: true, direction: "top", className: "pino-num" });
      pino.on("dragend", (e) => {
        const ll = e.target.getLatLng();
        const nova = atual.current.map((x, j) => j === i
          ? { ...x, lat: Number(ll.lat.toFixed(6)), lng: Number(ll.lng.toFixed(6)) } : x);
        aoMudar(nova);
      });
      camadas.current.push(circulo, pino);
    });
  }, [pontos, pronto, aoMudar]);

  const porMira = () => {
    if (!mapa.current || pontos.length >= 20) return;
    const c = mapa.current.getCenter();
    aoMudar([...pontos, {
      lat: Number(c.lat.toFixed(6)), lng: Number(c.lng.toFixed(6)), raio: 2, nome: "",
    }]);
  };

  if (falhou) {
    return (
      <div style={{ ...avisoInfo, marginBottom: 8 }}>
        <Info size={14} />
        <span>Não consegui carregar o mapa (sem internet para o OpenStreetMap?).
        Dá para continuar: os pontos já escolhidos valem, e o raio de cada um
        você ajusta na lista abaixo.</span>
      </div>
    );
  }

  return (
    <>
      <div ref={caixa} style={{ height: grande ? "76vh" : 440, minHeight: 300,
                                transition: "height .18s ease",
                                borderRadius: 10, overflow: "hidden",
                                border: "1px solid #E8E2D2", marginBottom: 8,
                                background: "#EDE7DA" }}>
        {!pronto && <div style={{ ...dica, padding: 10 }}>Carregando o mapa…</div>}
      </div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 8 }}>
        <button style={btnSecondary} onClick={porMira} disabled={pontos.length >= 20}>
          <MapPin size={13} /> Pôr ponto na mira (centro do mapa)
        </button>
        <button style={btnGhost} onClick={() => setGrande((g) => !g)}>
          {grande ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          {grande ? " Diminuir o mapa" : " Ampliar o mapa"}
        </button>
      </div>
    </>
  );
}

// A lista ao lado do mapa: nome, raio e o botão de tirar.
function ListaDePontos({ pontos, aoMudar }) {
  if (!pontos.length) {
    return <div style={dica}>Nenhum ponto ainda. Clique no mapa, ou use a mira.</div>;
  }
  const mudar = (i, campo, valor) =>
    aoMudar(pontos.map((p, j) => (j === i ? { ...p, [campo]: valor } : p)));

  return (
    <div style={{ display: "grid", gap: 6 }}>
      {pontos.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8,
                              border: "1px solid #E8E2D2", borderRadius: 9, padding: "7px 9px" }}>
          <span style={{ width: 19, height: 19, borderRadius: "50%", background: "#22231F",
                         color: "#F3EFE3", fontSize: 10, fontWeight: 800, flex: "none",
                         display: "flex", alignItems: "center", justifyContent: "center" }}>
            {i + 1}
          </span>
          <input style={{ ...inputStyle, flex: 1, minWidth: 70, padding: "5px 7px" }}
                 placeholder={`Ponto ${i + 1}`} value={p.nome || ""}
                 onChange={(e) => mudar(i, "nome", e.target.value.slice(0, 60))} />
          <input type="range" min={1} max={80} value={p.raio} style={{ flex: 1, minWidth: 60 }}
                 onChange={(e) => mudar(i, "raio", Number(e.target.value))} />
          <input style={{ ...inputStyle, width: 52, padding: "5px 7px" }} inputMode="numeric"
                 value={p.raio}
                 onChange={(e) => {
                   const n = Math.max(1, Math.min(80, Number(e.target.value) || 1));
                   mudar(i, "raio", n);
                 }} />
          <span style={{ fontSize: 11, color: "#8A8778" }}>km</span>
          <button style={{ ...btnGhost, borderColor: "#E7BDB2", color: "#C4432B", padding: "3px 7px" }}
                  onClick={() => aoMudar(pontos.filter((_, j) => j !== i))}>
            tirar
          </button>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------
// INTERESSES
//
// A busca vai à Meta pela proxy. O tamanho do público vem junto porque
// existe "Hambúrguer" com 200 milhões de pessoas e um homônimo com 300 —
// escolher o errado é pagar caro por um anúncio que não entrega.
// ---------------------------------------------------------------------
function Interesses({ escolhidos, aoMudar }) {
  const [termo, setTermo] = useState("");
  const [achados, setAchados] = useState([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    const t = String(termo).trim();
    if (t.length < 2) { setAchados([]); return; }
    let vivo = true;
    // Espera a pessoa parar de digitar: sem isto é uma chamada por tecla.
    const timer = setTimeout(async () => {
      setBuscando(true);
      const r = await chamarProxy("buscar_interesses", { q: t });
      if (!vivo) return;
      setBuscando(false);
      setAchados(r.data?.itens ?? []);
    }, 400);
    return () => { vivo = false; clearTimeout(timer); };
  }, [termo]);

  const juntar = (x) => {
    if (escolhidos.some((e) => e.id === x.id)) return;
    aoMudar([...escolhidos, { id: x.id, nome: x.nome }]);
    setTermo(""); setAchados([]);
  };

  return (
    <div>
      <input style={{ ...inputStyle, width: "100%" }} value={termo}
             placeholder="buscar… ex.: hambúrguer, delivery, chopp"
             onChange={(e) => setTermo(e.target.value)} />
      {buscando && <div style={{ ...dica, marginTop: 4 }}>procurando…</div>}
      {achados.length > 0 && (
        <div style={{ border: "1px solid #E8E2D2", borderRadius: 9, marginTop: 5,
                      maxHeight: 160, overflowY: "auto" }}>
          {achados.map((x) => (
            <div key={x.id} onClick={() => juntar(x)}
                 style={{ padding: "7px 10px", cursor: "pointer", fontSize: 12.5,
                          borderTop: "1px solid #F4EFE4" }}>
              {x.nome}
              <span style={{ ...dica, marginLeft: 6 }}>
                {x.tamanho ? `${numero(x.tamanho)} pessoas` : ""}{x.caminho ? ` · ${x.caminho}` : ""}
              </span>
            </div>
          ))}
        </div>
      )}
      {escolhidos.length > 0 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 }}>
          {escolhidos.map((e) => (
            <span key={e.id} style={{ ...chip, display: "inline-flex", gap: 5, alignItems: "center" }}>
              {e.nome}
              <X size={11} style={{ cursor: "pointer", color: "#8A8778" }}
                 onClick={() => aoMudar(escolhidos.filter((y) => y.id !== e.id))} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// SUBIR VÍDEO OU FOTO  (058)
//
// Anúncio que não passa pelo feed: o arquivo vai para o Storage, de lá
// para a Meta, e vira criativo sem nunca aparecer no Instagram.
//
// O caminho é navegador -> Storage -> Edge Function -> Meta. O navegador
// nunca toca no token da Meta, e a função não recebe 30 MB pelo corpo da
// requisição — ela busca do Storage.
//
// Vídeo a Meta processa de forma assíncrona. Enquanto não fica pronto,
// aprovar falha com um erro que não explica nada. Por isso a tela fica
// perguntando o estado e só libera a seleção quando pode.
// ---------------------------------------------------------------------
const TIPOS_ACEITOS = "video/mp4,video/quicktime,image/jpeg,image/png";
// O limite real não é o do balde: o Supabase no plano Free recusa qualquer
// arquivo acima de 50 MB antes de olhar a configuração do balde. Deixar 500
// aqui só faz a tela aceitar o arquivo e o erro aparecer depois do envio.
const TAMANHO_MAX = 50 * 1024 * 1024;

function SubirMidia({ contaId, midias, aoMudar, escolhida, aoEscolher, podeAprovar }) {
  const [subindo, setSubindo] = useState(false);
  const [progresso, setProgresso] = useState(null);
  const [erro, setErro] = useState("");
  const entrada = useRef(null);

  // Enquanto houver vídeo processando, pergunta à Meta de 4 em 4 segundos.
  useEffect(() => {
    const processando = (midias || []).filter((m) => m.estado === "processando");
    if (!processando.length) return;
    let vivo = true;
    const t = setInterval(async () => {
      for (const m of processando) {
        const r = await chamarProxy("estado_midia", { midia_id: m.id });
        if (!vivo) return;
        if (r.data?.estado && r.data.estado !== "processando") { aoMudar(); return; }
      }
    }, 4000);
    return () => { vivo = false; clearInterval(t); };
  }, [midias, aoMudar]);

  const escolher = async (arquivo) => {
    if (!arquivo) return;
    setErro("");
    if (arquivo.size > TAMANHO_MAX) {
      setErro(`O arquivo tem ${(arquivo.size / 1048576).toFixed(0)} MB. O limite por arquivo é 50 MB. Exporte em 1080p: um vídeo de 30 a 60 segundos fica entre 20 e 40 MB.`);
      return;
    }
    const ehVideo = arquivo.type.startsWith("video");
    setSubindo(true);
    try {
      // Nome com carimbo de hora: dois arquivos com o mesmo nome não se
      // atropelam, e dá para reconhecer qual é qual depois.
      const limpo = arquivo.name.replace(/[^\w.\-]+/g, "_").slice(-60);
      const caminho = `${contaId}/${Date.now()}_${limpo}`;

      const { error: errUp } = await supabase.storage.from("anuncios")
        .upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
      if (errUp) {
        // A mensagem do Storage vem em inglês e não diz o que fazer.
        const bruto = String(errUp.message || "");
        const porTamanho = /maximum allowed size|exceeded the maximum|payload too large/i.test(bruto);
        throw new Error(porTamanho
          ? "O arquivo passou do limite de 50 MB por arquivo. Exporte em 1080p: um vídeo de 30 a 60 segundos fica entre 20 e 40 MB."
          : `Não consegui subir o arquivo: ${bruto}`);
      }

      const { data: linha, error: errIns } = await supabase.from("anuncio_midias").insert({
        conta_id: contaId,
        caminho,
        nome: arquivo.name.slice(0, 120),
        tipo: ehVideo ? "video" : "imagem",
        bytes: arquivo.size,
      }).select("id").single();
      if (errIns) throw new Error(`Subiu, mas não consegui registrar: ${errIns.message}`);

      // (059) Vídeo vai em pedaços e pode não caber numa chamada só. Enquanto
      // a função devolver "enviando", ela parou por tempo, não por erro —
      // chama de novo e o envio continua do ponto guardado.
      let volta = 10;
      for (;;) {
        const r = await chamarProxy("subir_midia", { midia_id: linha.id });
        if (r.erro || r.data?.ok === false) {
          throw new Error(r.data?.error || r.erro || "A Meta não aceitou o arquivo.");
        }
        if (r.data?.estado !== "enviando") break;
        setProgresso(r.data?.pct ?? null);
        if (--volta <= 0) {
          throw new Error("O envio está demorando demais. O que já subiu ficou guardado: aperte em subir de novo e ele continua de onde parou.");
        }
      }
      setProgresso(null);
      aoMudar();
    } catch (e) {
      setErro(String(e instanceof Error ? e.message : e));
    } finally {
      setSubindo(false);
      if (entrada.current) entrada.current.value = "";
    }
  };

  const apagar = async (m) => {
    if (!window.confirm(`Apagar "${m.nome || "este arquivo"}"? Some daqui; anúncio já criado com ele continua rodando.`)) return;
    await supabase.storage.from("anuncios").remove([m.caminho]);
    await supabase.from("anuncio_midias").delete().eq("id", m.id);
    if (escolhida === m.id) aoEscolher(null);
    aoMudar();
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={sectionLabel}>Enviados por aqui</div>
      <div style={{ display: "grid", gap: 9,
                    gridTemplateColumns: "repeat(auto-fill, minmax(165px, 1fr))" }}>
        <div onClick={() => podeAprovar && !subindo && entrada.current?.click()}
             style={{ border: "1.5px dashed #D8D0BE", borderRadius: 10, minHeight: 150,
                      display: "flex", flexDirection: "column", alignItems: "center",
                      justifyContent: "center", gap: 4, textAlign: "center", padding: 10,
                      cursor: podeAprovar && !subindo ? "pointer" : "default",
                      opacity: podeAprovar ? 1 : 0.5 }}>
          {subindo ? <Loader2 size={18} /> : <span style={{ fontSize: 22, lineHeight: 1 }}>+</span>}
          <div style={{ fontSize: 12.5, fontWeight: 600 }}>
            {subindo ? (progresso != null ? `Enviando… ${progresso}%` : "Enviando…") : "Subir vídeo ou foto"}
          </div>
          <div style={dica}>sem postar no Instagram</div>
        </div>

        {(midias || []).map((m) => {
          const pronta = m.estado === "pronto";
          const falhou = m.estado === "falhou";
          const marcada = escolhida === m.id;
          return (
            <div key={m.id}
                 onClick={() => pronta && podeAprovar && aoEscolher(marcada ? null : m.id)}
                 style={{ border: marcada ? "2px solid #22231F" : "1px solid #E8E2D2",
                          borderRadius: 10, overflow: "hidden", position: "relative",
                          cursor: pronta && podeAprovar ? "pointer" : "default",
                          background: "#FFFFFF" }}>
              <div style={{ height: 105, background: "#F0ECE2", display: "flex",
                            alignItems: "center", justifyContent: "center" }}>
                {m.meta_thumb_url
                  ? <img src={m.meta_thumb_url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  : <span style={{ fontSize: 20 }}>{m.tipo === "video" ? "▶" : "▣"}</span>}
              </div>
              <div style={{ padding: "7px 9px" }}>
                <div style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis",
                              whiteSpace: "nowrap" }}>{m.nome || "arquivo"}</div>
                <div style={{ ...dica, marginTop: 2 }}>
                  {m.estado === "processando" && <>a Meta está processando…</>}
                  {m.estado === "enviando" && <>enviando para a Meta… (continua ao subir de novo)</>}
                  {pronta && <>pronto para patrocinar</>}
                  {falhou && <span style={{ color: "#C4432B" }}>{m.erro || "falhou"}</span>}
                </div>
              </div>
              {podeAprovar && (
                <button onClick={(e) => { e.stopPropagation(); apagar(m); }}
                        style={{ position: "absolute", top: 5, right: 5, border: "none",
                                 background: "rgba(34,35,31,.72)", color: "#F3EFE3",
                                 borderRadius: 7, width: 22, height: 22, cursor: "pointer",
                                 display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <X size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <input ref={entrada} type="file" accept={TIPOS_ACEITOS} style={{ display: "none" }}
             onChange={(e) => escolher(e.target.files?.[0])} />

      {erro && <div style={{ ...avisoErro, marginTop: 8 }}><AlertTriangle size={14} /> {erro}</div>}

      <div style={{ ...dica, marginTop: 8 }}>
        MP4, MOV, JPG ou PNG, até 500 MB — mas um Reel de 30 s em 1080×1920 fica
        entre 20 e 40 MB, e a Meta recomprime tudo de qualquer jeito, então arquivo
        grande só deixa o envio lento sem melhorar a imagem. O arquivo vira anúncio direto na Meta e
        <b> não aparece no seu feed</b>. Em compensação ele nasce sem curtida e sem
        comentário — para oferta direta isso não atrapalha, para conteúdo que depende
        de credibilidade o post do feed costuma render mais.
      </div>
    </div>
  );
}

function BarraAprovacao({ sel, cfg, sobra, curva, subida, pontosSalvos, aoSalvarPontos, enviando, aoCancelar, aoAprovar }) {
  const [valor, setValor] = useState(String(cfg.valor_padrao ?? ""));
  const [dias, setDias] = useState(String(cfg.dias_padrao ?? ""));
  const [mais, setMais] = useState(false);
  const [objetivo, setObjetivo] = useState("whatsapp");
  const [posicionamento, setPosicionamento] = useState("auto");
  const [publico, setPublico] = useState("raio");
  const [inicio, setInicio] = useState("");
  const [horas, setHoras] = useState(null); // null = o dia todo
  // (057) O que não existia: pontos no mapa, interesses, número de WhatsApp
  // e idade por patrocínio. Tudo começa vazio — e vazio significa "usa a
  // configuração", que é exatamente o comportamento de antes.
  const [ondeTipo, setOndeTipo] = useState("config");   // config | pontos
  const [pontos, setPontos] = useState([]);
  const [interesses, setInteresses] = useState([]);
  const [zap, setZap] = useState("");
  const [idadeMin, setIdadeMin] = useState(String(cfg.idade_min ?? 18));
  const [idadeMax, setIdadeMax] = useState(String(cfg.idade_max ?? 45));
  const [quemConta, setQuemConta] = useState(cfg.quem_conta ?? "mora_ou_esteve");
  const [nomeConjunto, setNomeConjunto] = useState("");
  // (058) O arquivo subido não tem legenda vinda do Instagram: ela é
  // escrita aqui e vai no criativo.
  const [legenda, setLegenda] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [confirmo, setConfirmo] = useState(false);

  const mexeu = (fn) => (...a) => { fn(...a); setConfirmo(false); };
  // Trocou os posts escolhidos: a confirmação anterior não vale mais.
  const chave = subida ? `subida:${subida.id}` : sel.map((p) => p.id).join(",");
  useEffect(() => { setConfirmo(false); }, [chave]);
  const valorNum = Number(String(valor).replace(",", "."));
  const sugestao = sugerirHoras(curva);
  const desligadas = horasDesligadas(horas);
  const semRefeicao = refeicoesDesligadas(horas);
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
    // (057) Só vai o que foi escolhido. Lista vazia vira null, e a proxy
    // cai na configuração — o mesmo pedido de antes desta tela.
    pontos: ondeTipo === "pontos" && pontos.length ? pontos : null,
    interesses: interesses.length ? interesses : null,
    whatsapp_numero: objetivo === "whatsapp" && zap ? zap : null,
    idade_min: Number(idadeMin) || cfg.idade_min,
    idade_max: Number(idadeMax) || cfg.idade_max,
    quem_conta: quemConta,
    midia_subida_id: subida ? subida.id : null,
    legenda: subida ? legenda : null,
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
          {subida
            ? <>Patrocinar o arquivo “{subida.nome || "subido"}” · não vai para o feed</>
            : sel.length === 1
              ? <>Patrocinar: “{sel[0].texto?.slice(0, 70) || `post ${sel[0].id}`}”</>
              : <>Testar {sel.length} posts juntos, dividindo a verba</>}
        </div>

        {subida && (
          <div>
            <textarea style={{ ...inputStyle, width: "100%", minHeight: 54, resize: "vertical" }}
                      placeholder="Legenda do anúncio — o texto que aparece acima do vídeo"
                      value={legenda} maxLength={2000}
                      onChange={(e) => mexeu(setLegenda)(e.target.value)} />
            <div style={dica}>
              Este anúncio não existe como post, então a legenda é escrita aqui.
              Sem ela o anúncio sai só com a mídia e o botão.
            </div>
          </div>
        )}

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

            {/* (057) Para qual WhatsApp. É o campo que resolve o 100/2446886:
                sem ele a Meta tenta achar um número na Página e não acha. */}
            {objetivo === "whatsapp" && (
              <>
                <Grupo titulo="Para qual WhatsApp">
                  {(cfg.whatsapp_numeros ?? []).map((n) => (
                    <Opcao key={n.numero} ativo={zap === n.numero}
                           onClick={() => mexeu(setZap)(n.numero)}
                           nome={`${n.nome} · ${formatarZap(n.numero)}`} />
                  ))}
                  <Opcao ativo={!zap} onClick={() => mexeu(setZap)("")} nome="Deixar a Meta escolher" />
                </Grupo>
                <div style={dica}>
                  {(cfg.whatsapp_numeros ?? []).length === 0
                    ? 'Nenhum número cadastrado. Em "Configuração do patrocínio" você guarda os números da casa — sem isso a Meta tenta achar um na Página, e é aí que ela recusa.'
                    : "Deixar a Meta escolher é o que o painel fazia antes, e o que vinha falhando: ela procura um número na Página e recusa quando não acha."}
                </div>
              </>
            )}

            {/* (057) Onde: o ponto da configuração, ou vários pontos no mapa. */}
            <Grupo titulo="Onde">
              <Opcao ativo={ondeTipo === "config"} onClick={() => mexeu(setOndeTipo)("config")}
                     nome={`Um ponto · ${cfg.raio_km} km`} />
              <Opcao ativo={ondeTipo === "pontos"} onClick={() => mexeu(setOndeTipo)("pontos")}
                     nome={pontos.length ? `${pontos.length} ponto${pontos.length > 1 ? "s" : ""} no mapa` : "Vários pontos"} />
            </Grupo>

            {ondeTipo === "pontos" && (
              <div style={{ border: "1px solid #E8E2D2", borderRadius: 10, padding: 10 }}>
                <div style={{ display: "flex", gap: 7, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                  <span style={dica}>Pontos salvos:</span>
                  <select style={{ ...inputStyle, padding: "5px 7px" }}
                          defaultValue=""
                          onChange={(e) => {
                            const c = (pontosSalvos ?? []).find((x) => x.id === e.target.value);
                            if (c) mexeu(setPontos)(c.pontos || []);
                          }}>
                    <option value="">{(pontosSalvos ?? []).length ? "escolher…" : "nenhum salvo"}</option>
                    {(pontosSalvos ?? []).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                  </select>
                  <input style={{ ...inputStyle, flex: 1, minWidth: 120, padding: "5px 7px" }}
                         placeholder="nome, ex.: Bairros do delivery"
                         value={nomeConjunto} onChange={(e) => setNomeConjunto(e.target.value)} />
                  <button style={btnGhost} disabled={salvando || !nomeConjunto.trim() || !pontos.length}
                          onClick={async () => {
                            setSalvando(true);
                            await supabase.from("patrocinio_pontos").upsert({
                              conta_id: cfg.conta_id, nome: nomeConjunto.trim(), pontos,
                            }, { onConflict: "conta_id,nome" });
                            setSalvando(false); setNomeConjunto("");
                            aoSalvarPontos?.();
                          }}>
                    {salvando ? <Loader2 size={12} /> : null} Salvar estes pontos
                  </button>
                </div>

                <MapaPontos pontos={pontos} aoMudar={mexeu(setPontos)}
                            centro={{ lat: Number(cfg.centro_lat) || -17.7922,
                                      lng: Number(cfg.centro_lng) || -50.9269 }} />
                <ListaDePontos pontos={pontos} aoMudar={mexeu(setPontos)} />
                <div style={{ ...dica, marginTop: 7 }}>
                  Clique no mapa para pôr um ponto, ou arraste até o bairro e use a mira (até 20).
                  Arraste o pino para ajustar. Raio de 1 a 80 km, um para cada ponto.
                </div>
              </div>
            )}

            <Grupo titulo="Quem vê">
              {PUB.map((o) => <Opcao key={o.v} ativo={publico === o.v} onClick={() => mexeu(setPublico)(o.v)} nome={o.n} />)}
            </Grupo>
            <div style={dica}>
              {ondeTipo === "pontos" && pontos.length
                ? `Dentro dos ${pontos.length} ponto${pontos.length > 1 ? "s" : ""} marcados no mapa.`
                : `Sempre dentro do raio de ${cfg.raio_km} km.`}
              {" "}"Quem já interagiu" é quem curtiu, comentou, salvou ou mandou mensagem ao @ no último ano; o público é criado na primeira vez que você usar.
            </div>

            {/* (057) Idade e "quem conta" deixaram de ser fixos na configuração. */}
            <Grupo titulo="Quem">
              <label style={{ fontSize: 12.5 }}>Idade <input style={{ ...inputStyle, width: 52 }} inputMode="numeric"
                     value={idadeMin} onChange={(e) => mexeu(setIdadeMin)(e.target.value)} /></label>
              <label style={{ fontSize: 12.5 }}>a <input style={{ ...inputStyle, width: 52 }} inputMode="numeric"
                     value={idadeMax} onChange={(e) => mexeu(setIdadeMax)(e.target.value)} /></label>
              <Opcao ativo={quemConta === "mora"} onClick={() => mexeu(setQuemConta)("mora")} nome="quem mora" />
              <Opcao ativo={quemConta !== "mora"} onClick={() => mexeu(setQuemConta)("mora_ou_esteve")} nome="mora ou esteve" />
            </Grupo>
            <div style={dica}>
              Para restaurante, <b>"mora ou esteve"</b> costuma valer mais: pega quem passou
              pelo shopping ou pela faculdade na hora do almoço, não só quem mora ali.
            </div>

            {/* (057) Interesses. Sem eles, público amplo — como era antes. */}
            <Grupo titulo="Interesses">
              <Opcao ativo={interesses.length === 0} onClick={() => mexeu(setInteresses)([])} nome="Amplo" />
              <Opcao ativo={interesses.length > 0} onClick={() => {}}
                     nome={interesses.length ? `${interesses.length} escolhido${interesses.length > 1 ? "s" : ""}` : "Escolher"} />
            </Grupo>
            <Interesses escolhidos={interesses} aoMudar={mexeu(setInteresses)} />

            <Grupo titulo="Quando começa">
              <Opcao ativo={!inicio} onClick={() => mexeu(setInicio)("")} nome="Agora" />
              <input type="date" style={{ ...inputStyle, height: 34 }} min={hojeISO()} value={inicio}
                     onChange={(e) => mexeu(setInicio)(e.target.value)} />
            </Grupo>

            <div>
              <div style={{ ...dica, fontWeight: 700, color: "#22231F", marginBottom: 5 }}>
                Horário do dia em que roda: {descreverHoras(horas)}
              </div>
              {desligadas.length > 0 && (
                <div style={{ ...dica, color: "#C4432B", fontWeight: 700, marginBottom: 5 }}>
                  Fora do ar: {descreverHoras(desligadas)}
                </div>
              )}
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
              {semRefeicao.length > 0 && (
                <div style={{ border: "1px solid #E7BDB2", background: "#FBF0ED",
                              borderRadius: 8, padding: "9px 11px", marginTop: 7,
                              fontSize: 12, lineHeight: 1.55, color: "#22231F" }}>
                  <b style={{ color: "#C4432B" }}>
                    O anúncio não roda na hora do {semRefeicao.map((r) => r.nome).join(" nem do ")}.
                  </b>{" "}
                  É quando a pessoa decide o que vai comer. Se não foi de propósito,
                  toque nas horas apagadas acima ou use "O dia todo".
                </div>
              )}
              <div style={{ ...dica, marginTop: 4 }}>
                {sugestao ? "A sugestão vem dos pedidos do CardápioWeb nos últimos 30 dias, com uma hora antes de cada pico." : "Sem curva de pedidos ainda: rode \"Buscar ontem\" em Ajustes para ter sugestão — enquanto isso, a faixa acima é escolha sua, não recomendação do painel."}
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
function NoAr({ lista, podeEncerrar, aoRecarregar }) {
  const [encerrando, setEncerrando] = useState(null);
  const [msg, setMsg] = useState(null);

  const semana = lista.reduce((s, x) => s + (Number(x.gasto_7d) || 0), 0);
  // "Previsto" só soma o que tem verba própria. Anúncio com orçamento na
  // campanha não entra: somar o que não se conhece dá um total falso.
  const previsto = lista.reduce((s, x) => {
    const v = x.painel ? Number(x.painel.valor) : (x.orcamento_total ?? null);
    return s + (Number.isFinite(v) ? v : 0);
  }, 0);

  const encerrar = async (a, motivo) => {
    // Dinheiro no ar: uma confirmação explícita antes, sempre. O texto diz o
    // que já foi gasto, porque pausar não devolve o que saiu.
    const gasto = Number(a.gasto) || 0;
    const texto = `Encerrar este patrocínio na Meta?\n\n${a.texto || a.nome}\n\n` +
      `Já gastou ${dinheiro(gasto)}; pausar não devolve esse valor. ` +
      `O anúncio para de entregar na hora e não volta sozinho.`;
    if (!window.confirm(texto)) return;

    setEncerrando(a.anuncio_id);
    setMsg(null);
    const { data, error } = await supabase.functions.invoke("meta-encerrar-anuncio", {
      body: { anuncio_id: a.anuncio_id, nome: a.texto || a.nome, gasto, motivo: motivo || null },
    });
    setEncerrando(null);
    if (error || data?.ok !== true) {
      setMsg({ tipo: "erro", texto: data?.erro || error?.message || "Não consegui encerrar." });
    } else {
      setMsg({ tipo: "ok", texto: "Patrocínio encerrado. A Meta leva alguns minutos para parar de entregar." });
      await aoRecarregar?.();
    }
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={sectionLabel}>No ar agora · {lista.length} {lista.length === 1 ? "anúncio" : "anúncios"}</div>
        {lista.length > 0 && (
          <div style={{ ...dica, fontWeight: 700 }}>
            gastaram {dinheiro(semana)} nos últimos 7 dias
            {previsto > 0 ? ` · previsto: ${dinheiro(previsto)}` : ""}
          </div>
        )}
      </div>
      {msg && <Aviso tipo={msg.tipo} texto={msg.texto} />}
      {lista.length === 0 ? (
        <div style={dica}>Nenhum anúncio rodando na conta agora — nem pelo painel, nem pelo Gerenciador.</div>
      ) : lista.map((a) => (
        <AnuncioNoAr key={a.anuncio_id} a={a}
                     podeEncerrar={podeEncerrar}
                     encerrando={encerrando === a.anuncio_id}
                     aoEncerrar={encerrar} />
      ))}
    </div>
  );
}

// Data por extenso, como no painel da Dinâmico: "15 de out." lê melhor que
// "15/10" num número grande, e tira a dúvida de mês com dia.
function dataExtenso(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short" })
    .replace(".", ".");
}

// Dias inteiros entre duas datas, pelo calendário e não pelo relógio: um
// anúncio aprovado ontem às 23h começou "ontem", não "há 3 horas".
function diasEntre(a, b) {
  const d1 = new Date(a), d2 = new Date(b);
  d1.setHours(12, 0, 0, 0); d2.setHours(12, 0, 0, 0);
  return Math.round((d2 - d1) / 86400000);
}

// Como a Meta chama o objetivo de cada anúncio, em português.
const OTIMIZA = {
  CONVERSATIONS: "conversas", REACH: "alcance", IMPRESSIONS: "impressões",
  LINK_CLICKS: "cliques", LANDING_PAGE_VIEWS: "visitas ao site", POST_ENGAGEMENT: "engajamento",
  THRUPLAY: "vídeo assistido", OFFSITE_CONVERSIONS: "vendas", LEAD_GENERATION: "cadastros",
  PROFILE_VISIT: "visitas ao perfil", VALUE: "valor de venda",
};

function AnuncioNoAr({ a, podeEncerrar, aoEncerrar, encerrando }) {
  const emAnalise = a.situacao !== "no ar";
  // Conversa só é resultado quando o anúncio foi feito para isso. Num anúncio
  // de alcance ou engajamento, "0 conversas" não é fracasso — é outra meta.
  const deMensagem = !a.otimiza || a.otimiza === "CONVERSATIONS";
  const porConversa = deMensagem && a.conversas > 0 ? a.gasto / a.conversas : null;
  const ctr = a.impressoes > 0 ? (a.cliques / a.impressoes) * 100 : null;

  // A verba só existe quando ela é DESTE anúncio. Anúncio da agência com
  // orçamento na campanha não tem total — e inventar um dividindo seria
  // mentira com cara de número.
  const verba = a.painel ? Number(a.painel.valor) : (a.orcamento_total ?? null);
  const temVerba = Number.isFinite(verba) && verba > 0;
  const gasto = Number(a.gasto) || 0;
  const usoVerba = temVerba ? Math.min(100, (gasto / verba) * 100) : null;
  const falta = temVerba ? Math.max(0, verba - gasto) : null;

  const hoje = Date.now();
  const diasRodando = a.inicio ? Math.max(0, diasEntre(a.inicio, hoje)) : null;
  const diasAteFim = a.termina ? diasEntre(hoje, a.termina) : null;
  // Gasto por dia medido, não prometido: o que saiu dividido pelos dias que
  // de fato rodaram. É o número que denuncia anúncio contínuo esquecido.
  const porDia = diasRodando && diasRodando > 0 ? gasto / diasRodando : null;

  const origem = a.painel
    ? `feito pelo painel · aprovado ${dataExtenso(a.painel.aprovado_em)} · ${dinheiro(a.painel.valor)} em ${a.painel.dias} dias${a.painel.varios ? " (verba dividida entre os posts do teste)" : ""}`
    : `feito no Gerenciador${a.otimiza ? ` · busca ${OTIMIZA[a.otimiza] || a.otimiza.toLowerCase()}` : ""} · ${a.orcamento_diario ? `${dinheiro(a.orcamento_diario)} por dia` : a.orcamento_total ? `${dinheiro(a.orcamento_total)} no total` : "orçamento na campanha"}${a.inicio ? ` · desde ${dataExtenso(a.inicio)}` : ""}`;

  // O aviso ao lado do botão muda conforme o caso. Mostrar "gastou sem
  // conversa" num anúncio de alcance seria injusto: ele nunca buscou conversa.
  let aviso = null, avisoGrave = false;
  if (deMensagem && gasto > 0 && !a.conversas) {
    aviso = `gastou ${dinheiro(gasto)} sem conversa`; avisoGrave = true;
  } else if (gasto === 0) {
    aviso = temVerba
      ? `ainda não gastou nada — encerrar agora devolve ${dinheiro(verba)} ao teto`
      : "ainda não gastou nada";
  } else if (diasRodando >= 30 && !a.termina) {
    aviso = `${dinheiro(gasto)} em ${diasRodando} dias, sem data de fim`; avisoGrave = true;
  } else if (a.alcance != null && a.alcance < 500 && diasRodando >= 14) {
    aviso = `${numero(a.alcance)} pessoas em ${diasRodando} dias: está no ar mas quase não entrega`;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "84px 1fr", gap: 11,
                  padding: "13px 0", borderTop: "1px solid #E8E2D2" }}>
      <div style={{ width: 84, height: 105, borderRadius: 9, background: "#F0ECE2", overflow: "hidden" }}>
        {a.foto && <img src={a.foto} alt="" loading="lazy"
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8,
                      flexWrap: "wrap", marginBottom: 2 }}>
          <span style={{ fontWeight: 700, fontSize: 12.5, overflow: "hidden",
                         textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
            {a.texto || a.nome}
          </span>
          <span style={{ ...tagBase, ...(emAnalise ? tagAnalise : tagOk) }}>
            {cap(a.situacao)}{!emAnalise ? (a.termina ? ` · termina ${dataExtenso(a.termina)}` : " · contínuo") : ""}
          </span>
        </div>
        <div style={{ ...dica, marginBottom: 8 }}>{origem}</div>

        {/* A vida do patrocínio: quanto, de quando até quando, a que ritmo. */}
        <div style={{ display: "grid", gap: 1, background: "#E8E2D2", border: "1px solid #E8E2D2",
                      borderRadius: 9, overflow: "hidden", marginBottom: 7,
                      gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))" }}>
          <Grande v={temVerba ? dinheiro(verba) : "—"}
                  r={temVerba ? "valor previsto" : "verba na campanha, não no anúncio"} />
          <Grande v={a.inicio ? dataExtenso(a.inicio) : "—"}
                  r={diasRodando == null ? "início"
                     : diasRodando === 0 ? "início · hoje"
                     : `início · há ${diasRodando} ${diasRodando === 1 ? "dia" : "dias"}`} />
          <Grande v={a.termina ? dataExtenso(a.termina) : "contínuo"}
                  r={a.termina
                     ? (diasAteFim > 0 ? `fim · faltam ${diasAteFim} ${diasAteFim === 1 ? "dia" : "dias"}`
                        : "fim · termina hoje")
                     : "sem data de fim"} />
          <Grande v={porDia != null ? dinheiro(porDia) : "—"} r="por dia, em média" />
        </div>

        <div style={{ display: "grid", gap: 6, opacity: emAnalise && !gasto ? 0.6 : 1,
                      gridTemplateColumns: "repeat(auto-fill, minmax(106px, 1fr))" }}>
          <Numero v={dinheiro(a.gasto_7d)} r="gasto nos últimos 7 dias" />
          <Numero v={dinheiro(gasto)} r="gasto desde o início" />
          <Numero v={falta != null ? dinheiro(falta) : "—"}
                  r={falta != null ? "ainda vai gastar" : "sem fim, sem previsão"} />
          <Numero v={deMensagem ? numero(a.conversas) : "—"}
                  r={deMensagem ? "conversas no WhatsApp" : "não busca conversas"} />
          <Numero v={porConversa != null ? dinheiro(porConversa) : "—"} r="por conversa" />
          <Numero v={a.alcance ? numero(a.alcance) : "—"} r="pessoas alcançadas" />
          <Numero v={ctr != null ? `${ctr.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%` : "—"}
                  r="clicaram no link" />
        </div>

        {usoVerba != null && (
          <>
            <div style={{ height: 6, background: "#F0ECE2", borderRadius: 99,
                          overflow: "hidden", marginTop: 9 }}>
              <div style={{ width: `${usoVerba}%`, height: "100%",
                            background: usoVerba >= 90 ? "#C4432B" : "#22231F" }} />
            </div>
            <div style={{ ...dica, marginTop: 3 }}>
              {Math.round(usoVerba)}% da verba usada
              {diasRodando != null && a.painel?.dias ? ` · ${Math.min(diasRodando, a.painel.dias)} de ${a.painel.dias} dias` : ""}
            </div>
          </>
        )}

        {(podeEncerrar || aviso) && (
          <div style={{ display: "flex", gap: 9, alignItems: "center",
                        flexWrap: "wrap", marginTop: 10 }}>
            {podeEncerrar && (
              <button
                style={{ ...btnGhost, borderColor: "#E7BDB2", color: "#C4432B",
                         opacity: encerrando ? 0.6 : 1,
                         cursor: encerrando ? "default" : "pointer" }}
                disabled={encerrando}
                onClick={() => aoEncerrar(a, aviso)}>
                {encerrando ? <Loader2 size={12} /> : <X size={12} />} Encerrar patrocínio
              </button>
            )}
            {aviso && (
              <span style={{ fontSize: 11.5, lineHeight: 1.45,
                             color: avisoGrave ? "#C4432B" : "#8A8778",
                             fontWeight: avisoGrave ? 700 : 400 }}>
                {aviso}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Grande({ v, r }) {
  return (
    <div style={{ background: "#FFFFFF", padding: "9px 11px" }}>
      <div style={{ fontSize: 15.5, fontWeight: 700, letterSpacing: -0.2,
                    fontVariantNumeric: "tabular-nums" }}>{v}</div>
      <div style={{ fontSize: 10.5, color: "#8A8778", marginTop: 1, lineHeight: 1.3 }}>{r}</div>
    </div>
  );
}
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
// +5564999990001 -> (64) 99999-0001
function formatarZap(n) {
  const d = String(n ?? "").replace(/\D/g, "");
  const semDdi = d.startsWith("55") ? d.slice(2) : d;
  if (semDdi.length < 10) return d;
  const ddd = semDdi.slice(0, 2);
  const resto = semDdi.slice(2);
  const meio = resto.length > 8 ? resto.slice(0, 5) : resto.slice(0, 4);
  return `(${ddd}) ${meio}-${resto.slice(meio.length)}`;
}

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
