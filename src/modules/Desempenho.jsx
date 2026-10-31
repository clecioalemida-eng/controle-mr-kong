import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  Loader2, AlertTriangle, Search, ChevronLeft, X,
  Clock, CheckCircle2, Ghost,
} from "lucide-react";
import { supabase } from "../lib/supabaseClient";
import { podeEditar } from "../lib/permissoes";

// ---------------------------------------------------------------------
// Desempenho — onde o tempo da operação vai
//
// O pedido não é uma esteira: ele se DIVIDE. Hambúrguer vai pra chapa,
// milk-shake pro bar, batata pra cozinha, chopp pro caixa — tudo ao mesmo
// tempo. O pedido só fica pronto quando a ÚLTIMA estação termina, e as
// outras ficam com a comida parada esperando.
//
// Por isso o tempo é por ESTAÇÃO dentro do pedido, não por pedido. E por
// isso existe a "espera de montagem", que é o tempo entre a primeira
// estação terminar e a última — o número que não existe em relatório
// nenhum e que é onde mora o "chegou tudo junto, mas frio".
//
// De onde vêm os dados (desde 29/10/2026, ver "Só análise" abaixo):
//   o webhook do CardápioWeb, com a hora de cada etapa do pedido. A
//   cozinha opera no KDS do CardápioWeb; o painel não é mais tablet.
// ---------------------------------------------------------------------

const ABAS = [
  { chave: "analise",  label: "Análise" },
  { chave: "produtos", label: "Produtos e setores" },
  { chave: "antes",    label: "Antes da troca" },
];

function semAcento(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}
function chaveNome(s) {
  return semAcento(s).trim().toLowerCase().replace(/\s+/g, " ");
}
function min1(v) {
  if (v === null || v === undefined) return "—";
  return Number(v).toFixed(1).replace(".", ",");
}

// ---------------------------------------------------------------------
// Só análise (30/10/2026)
//
// Até 28/10 a cozinha marcava "peguei" e "terminei" num tablet do painel.
// Dava o tempo exato de cada estação, mas a fila do painel dependia do
// aviso do CardápioWeb chegar certo, e aparecia pedido duplicado e
// fantasma no meio do serviço. Operar em dois lugares não funciona.
//
// Desde 29/10 a cozinha opera só no KDS do CardápioWeb, e o painel é só
// pra quem analisa. O tempo sai dos avisos que o CardápioWeb manda
// (migração 175): aceito → pronto → saiu → fechado, por pedido.
//
// O CardápioWeb divide o pedido por setor na tela dele, mas não manda pra
// fora qual setor terminou nem quando (conferido na 174). Por isso o tempo
// por setor é ESTIMADO: compara pedidos com e sem cada setor e separa
// quanto cada um soma. Não é cronômetro, mas aponta o mesmo gargalo.
//
// Os tempos exatos do tablet continuam no banco e aparecem em
// "Antes da troca".
// ---------------------------------------------------------------------
const TROCA_KDS = "2026-10-29";           // primeiro dia só com o CardápioWeb
const ULTIMO_DIA_TABLET = "2026-10-28";

export default function Desempenho({ perfil, permissoes, onVoltar }) {
  const editarProdutos = podeEditar(permissoes, "desempenho.produtos") || perfil?.is_admin;
  const [aba, setAba] = useState("analise");
  const [setores, setSetores] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await supabase
        // `estacao` separa quem PRODUZ de quem so faz checklist e conta
        // estoque. A Gerencia continua existindo nos dois outros lugares,
        // mas nao entra na conta de tempo por setor.
        .from("setores_estoque").select("chave, label, ordem")
        .eq("ativo", true).eq("estacao", true).order("ordem");
      if (!vivo) return;
      if (error) setErro(error.message);
      setSetores(data || []);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, []);

  return (
    <Shell titulo="Desempenho" subtitulo="Tempo de cozinha e gargalo por setor, pelo CardápioWeb" onVoltar={onVoltar}>
      {erro && (
        <div style={avisoErro}><AlertTriangle size={16} /> {erro}</div>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {ABAS.map((a) => (
          <button key={a.chave} onClick={() => setAba(a.chave)}
            style={{ ...chip, ...(aba === a.chave ? chipAtivo : {}) }}>
            {a.label}
          </button>
        ))}
      </div>

      {carregando ? (
        <div style={vazio}><Loader2 size={16} /> Carregando…</div>
      ) : aba === "analise" ? (
        <Analise setores={setores} aoMapear={() => setAba("produtos")} />
      ) : aba === "produtos" ? (
        <Produtos setores={setores} editar={editarProdutos} />
      ) : (
        <AntesDaTroca />
      )}
    </Shell>
  );
}

// =====================================================================
// ANÁLISE — o caminho do pedido e quanto cada setor soma
// =====================================================================
const PERIODOS = [
  { chave: "ontem", label: "Ontem" },
  { chave: "7",     label: "7 dias" },
  { chave: "30",    label: "30 dias" },
];
// Abaixo disso a estimativa por setor oscila de um dia pro outro.
const COBERTURA_MINIMA = 0.7;
const PEDIDOS_MINIMOS = 30;
const PEDIDOS_POR_SETOR = 8;

const fmtDiaSP = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
});
const fmtHoraSP = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23",
});
const fmtQuandoSP = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit",
});

// Dia operacional de agora: 5h às 5h, pelo relógio de Rio Verde.
function diaOperacionalHoje() {
  return fmtDiaSP.format(new Date(Date.now() - 5 * 3600 * 1000));
}
function somarDias(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function intervaloDoPeriodo(chave) {
  const hoje = diaOperacionalHoje();
  if (chave === "ontem") { const o = somarDias(hoje, -1); return { inicio: o, fim: o }; }
  const dias = Number(chave) || 7;
  return { inicio: somarDias(hoje, -(dias - 1)), fim: hoje };
}
function minutos(de, ate) {
  if (!de || !ate) return null;
  return (new Date(ate) - new Date(de)) / 60000;
}
function mediana(valores) {
  const v = valores.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function dataCurta(iso) {
  const [, m, d] = String(iso).split("-");
  return `${d}/${m}`;
}

// Mínimos quadrados com uma pitada de ridge: tempo = base + Σ setor.
// Com 3 a 5 setores o sistema é pequeno; a pitada evita que um setor que
// quase nunca aparece sozinho leve um número absurdo.
function estimarPorSetor(pedidos, chaves) {
  const k = chaves.length;
  if (k === 0 || pedidos.length === 0) return null;
  const n = k + 1;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (const p of pedidos) {
    const x = [1, ...chaves.map((c) => (p.setores.has(c) ? 1 : 0))];
    for (let i = 0; i < n; i++) {
      b[i] += x[i] * p.cozinha;
      for (let j = 0; j < n; j++) A[i][j] += x[i] * x[j];
    }
  }
  for (let i = 1; i < n; i++) A[i][i] += 1;
  // Eliminação de Gauss com pivô parcial.
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    if (Math.abs(A[piv][c]) < 1e-9) return null;
    [A[c], A[piv]] = [A[piv], A[c]];
    [b[c], b[piv]] = [b[piv], b[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let j = c; j < n; j++) A[r][j] -= f * A[c][j];
      b[r] -= f * b[c];
    }
  }
  const x = b.map((v, i) => v / A[i][i]);
  return { base: x[0], porSetor: Object.fromEntries(chaves.map((c, i) => [c, x[i + 1]])) };
}

function analisar(linhas, setores) {
  const nomeSetor = (c) => setores.find((s) => s.chave === c)?.label || c;
  const validos = linhas.filter((r) => !r.cancelado);
  const semTempo = validos.filter((r) => r.nasceu_fechado && !r.aceito_em).length;
  const fluxo = validos.filter((r) => r.aceito_em);

  const comSetores = (r) => new Set((r.itens || []).map((i) => i.setor).filter(Boolean));
  // Tempo de cozinha acima de 2 h é pedido esquecido aberto, não preparo.
  const medidos = fluxo
    .map((r) => ({ ...r, cozinha: minutos(r.aceito_em, r.pronto_em), setores: comSetores(r) }))
    .filter((r) => r.cozinha !== null && r.cozinha > 0 && r.cozinha <= 120);

  const etapas = {
    aceitar: mediana(validos.map((r) => minutos(r.criado_em, r.aceito_em)).filter((m) => m !== null && m >= 0 && m <= 60)),
    cozinha: mediana(medidos.map((r) => r.cozinha)),
    esperando: mediana(medidos.map((r) => minutos(r.pronto_em, r.saiu_em)).filter((m) => m !== null && m >= 0 && m <= 120)),
    fechar: mediana(validos.filter((r) => !r.nasceu_fechado)
      .map((r) => minutos(r.criado_em, r.fechado_em)).filter((m) => m !== null && m > 0 && m <= 300)),
  };

  // Ordem do cadastro primeiro; setor que só existe nos itens vai no fim.
  const presentes = new Set(medidos.flatMap((r) => [...r.setores]));
  const chaves = [...setores.map((s) => s.chave).filter((c) => presentes.has(c)),
                  ...[...presentes].filter((c) => !setores.some((s) => s.chave === c))];
  const comAlgum = medidos.filter((r) => r.setores.size > 0);
  const est = estimarPorSetor(comAlgum, chaves);
  const porSetor = chaves.map((c) => {
    const com = comAlgum.filter((r) => r.setores.has(c));
    const sem = comAlgum.filter((r) => !r.setores.has(c));
    return {
      chave: c, label: nomeSetor(c), n: com.length,
      soma: est ? est.porSetor[c] : null,
      com: mediana(com.map((r) => r.cozinha)), sem: mediana(sem.map((r) => r.cozinha)),
    };
  });

  const confiaveis = porSetor.filter((s) => s.n >= PEDIDOS_POR_SETOR && s.soma !== null && s.soma > 0);
  const pior = confiaveis.sort((a, b) => b.soma - a.soma)[0] || null;

  // O produto que mais pesa no pior setor: pedidos com ele × os outros
  // pedidos do mesmo setor sem ele.
  let produtoPesado = null;
  if (pior) {
    const doSetor = comAlgum.filter((r) => r.setores.has(pior.chave));
    const nomes = new Set(doSetor.flatMap((r) => (r.itens || []).filter((i) => i.setor === pior.chave).map((i) => i.nome)));
    for (const nome of nomes) {
      const com = doSetor.filter((r) => r.itens.some((i) => i.nome === nome));
      const sem = doSetor.filter((r) => !r.itens.some((i) => i.nome === nome));
      if (com.length < 5 || sem.length < 5) continue;
      const dif = mediana(com.map((r) => r.cozinha)) - mediana(sem.map((r) => r.cozinha));
      if (dif > 0 && (!produtoPesado || dif > produtoPesado.dif)) produtoPesado = { nome, dif, n: com.length };
    }
  }

  const grupos = {};
  for (const r of comAlgum) {
    const lista = chaves.filter((c) => r.setores.has(c));
    const chave = lista.join("+");
    (grupos[chave] ||= { setores: lista.map(nomeSetor), tempos: [] }).tempos.push(r.cozinha);
  }
  const combinacoes = Object.values(grupos)
    .filter((g) => g.tempos.length >= 3)
    .map((g) => ({ setores: g.setores, n: g.tempos.length, mediana: mediana(g.tempos) }))
    .sort((a, b) => a.mediana - b.mediana)
    .slice(0, 8);

  // Por hora de aceite. Depois da meia-noite entra no "22h+".
  const FAIXAS = ["antes das 17h", "17h", "18h", "19h", "20h", "21h", "22h+"];
  const porFaixa = {};
  for (const r of medidos) {
    const h = Number(fmtHoraSP.format(new Date(r.aceito_em)));
    const f = h >= 22 || h < 5 ? "22h+" : h < 17 ? "antes das 17h" : `${h}h`;
    (porFaixa[f] ||= []).push(r.cozinha);
  }
  const porHora = FAIXAS
    .filter((f) => f !== "antes das 17h" || porFaixa[f])
    .map((f) => ({ faixa: f, n: (porFaixa[f] || []).length, mediana: mediana(porFaixa[f] || []) }));

  const lentos = [...medidos].sort((a, b) => b.cozinha - a.cozinha).slice(0, 5)
    .map((r) => ({ ...r, setoresNomes: chaves.filter((c) => r.setores.has(c)).map(nomeSetor) }));

  const semSetor = new Set(validos.flatMap((r) => (r.itens || []).filter((i) => !i.setor).map((i) => i.nome)));

  return {
    total: validos.length, semTempo, fluxo: fluxo.length, medidos: medidos.length,
    cobertura: fluxo.length ? medidos.length / fluxo.length : 0,
    etapas, base: est?.base ?? null, porSetor, pior, produtoPesado,
    combinacoes, porHora, lentos, semSetor: [...semSetor].sort(),
  };
}

function Analise({ setores, aoMapear }) {
  const [periodo, setPeriodo] = useState("7");
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const { inicio, fim } = intervaloDoPeriodo(periodo);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro("");
    (async () => {
      const { data, error } = await supabase.rpc("desempenho_cardapioweb", { p_inicio: inicio, p_fim: fim });
      if (!vivo) return;
      if (error) {
        setErro(/desempenho_cardapioweb/.test(error.message || "")
          ? "Falta rodar a migração 175 no Supabase."
          : error.message);
      }
      setLinhas(data || []);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [inicio, fim]);

  const a = useMemo(() => analisar(linhas, setores), [linhas, setores]);
  const pouco = a.cobertura < COBERTURA_MINIMA || a.medidos < PEDIDOS_MINIMOS;
  const pct = Math.round(a.cobertura * 100);
  const corteNoMeio = inicio < TROCA_KDS;

  const positivos = a.porSetor.reduce((s, x) => s + Math.max(0, x.soma || 0), 0);
  const escala = Math.max(1, (a.base || 0) + positivos);
  const tetoHora = Math.max(1, ...a.porHora.map((h) => h.mediana || 0));
  const piorHora = a.porHora.reduce((m, h) => ((h.mediana || 0) > (m?.mediana || 0) ? h : m), null);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {PERIODOS.map((p) => (
          <button key={p.chave} onClick={() => setPeriodo(p.chave)}
            style={{ ...chip, ...(periodo === p.chave ? chipAtivo : {}) }}>
            {p.label}
          </button>
        ))}
      </div>

      {erro && <div style={avisoErro}><AlertTriangle size={16} /> {erro}</div>}

      {carregando ? (
        <div style={vazio}><Loader2 size={16} /> Carregando…</div>
      ) : a.total === 0 ? (
        <div style={avisoAmarelo}>
          <AlertTriangle size={16} />
          <div>Nenhum pedido do CardápioWeb entre {dataCurta(inicio)} e {dataCurta(fim)}.</div>
        </div>
      ) : (
        <>
          {/* Cobertura do "pronto": é ela que diz se o resto vale. */}
          <div style={{ ...cardStyle, marginBottom: 12,
                        ...(pouco ? { background: "#FBF3D9", borderColor: "#E8D48A" } : { background: "#EAF6EF", borderColor: "#BFE0CE" }) }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap",
                          color: pouco ? "#7A6A1E" : "#2F8F5B" }}>
              <span style={{ fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", gap: 6 }}>
                {pouco ? <AlertTriangle size={15} /> : <CheckCircle2 size={15} />}
                "Pronto" marcado em {a.medidos} de {a.fluxo} pedidos ({pct}%)
              </span>
              <span style={{ fontSize: 12 }}>meta: 90%</span>
            </div>
            <div style={{ height: 6, background: "#FFFFFF", borderRadius: 3, margin: "9px 0 7px" }}>
              <div style={{ width: `${Math.min(100, pct)}%`, height: 6, borderRadius: 3,
                            background: pouco ? "#854F0B" : "#2F8F5B" }} />
            </div>
            <div style={{ fontSize: 12, color: pouco ? "#7A6A1E" : "#2F6B45", lineHeight: 1.55 }}>
              Só pedido com "pronto" no KDS do CardápioWeb entra no tempo de cozinha.
              {pouco && " Com menos de 70%, o tempo por setor ainda oscila: vale cobrar o \"pronto\" em todo pedido."}
              {a.semTempo > 0 && ` ${a.semTempo} ${a.semTempo === 1 ? "mesa lançada já fechada não tem" : "mesas lançadas já fechadas não têm"} tempo e não ${a.semTempo === 1 ? "conta" : "contam"}.`}
              {corteNoMeio && ` Antes de ${dataCurta(TROCA_KDS)} a cozinha marcava no tablet do painel, e o "pronto" do CardápioWeb quase não aparece nesses dias — os tempos exatos deles estão em "Antes da troca".`}
            </div>
          </div>

          <div style={{ ...cardStyle, marginBottom: 12 }}>
            <div style={rotulo}>O caminho do pedido · mediana</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
              <Etapa label="Para aceitar" valor={a.etapas.aceitar} />
              <Etapa label="Cozinha" valor={a.etapas.cozinha} nota="aceito → pronto" />
              <Etapa label="Pronto esperando" valor={a.etapas.esperando} nota="pronto → saiu" />
              <Etapa label="Até fechar" valor={a.etapas.fechar} />
            </div>
          </div>

          <div style={{ ...cardStyle, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={rotulo}>Tempo por setor · estimado</div>
              <div style={{ fontSize: 11, color: "#8A8778" }}>pedidos medidos</div>
            </div>
            {a.base === null ? (
              <div style={{ fontSize: 13, color: "#8A8778" }}>
                Ainda não há pedidos com "pronto" e setor suficientes para separar o tempo de cada setor.
              </div>
            ) : (
              <>
                <LinhaSetor nome="Base" valor={a.base} largura={a.base / escala} cor="#C9BFA6"
                  direita={`${min1(a.base)} min · todo pedido`} />
                {a.porSetor.map((s) => {
                  const ehPior = a.pior?.chave === s.chave;
                  return (
                    <LinhaSetor key={s.chave} nome={s.label} forte={ehPior}
                      largura={Math.max(0, s.soma || 0) / escala} cor={ehPior ? "#D85A30" : "#888780"}
                      direita={s.n < PEDIDOS_POR_SETOR
                        ? `pouco dado · ${s.n}`
                        : `${(s.soma || 0) >= 0 ? "+" : "−"}${min1(Math.abs(s.soma || 0))} min · ${s.n}`} />
                  );
                })}
                {a.pior && !pouco && (
                  <div style={{ background: "#FDECEA", color: "#A32D2D", borderRadius: 9, padding: "10px 12px",
                                fontSize: 13, marginTop: 10, lineHeight: 1.55 }}>
                    <b>Onde melhorar: {a.pior.label}.</b> Pedido com {a.pior.label.toLowerCase()} leva {min1(a.pior.com)} min;
                    sem, {min1(a.pior.sem)}.
                    {a.produtoPesado && ` O item que mais pesa lá é ${a.produtoPesado.nome} (+${min1(a.produtoPesado.dif)} min em ${a.produtoPesado.n} pedidos).`}
                  </div>
                )}
                <div style={{ fontSize: 11.5, color: "#8A8778", marginTop: 8, lineHeight: 1.55 }}>
                  Estimado comparando pedidos com e sem cada setor: o CardápioWeb não manda a hora em que cada
                  setor terminou. Não é cronômetro por estação, mas aponta o mesmo gargalo, e fica mais firme
                  com mais pedidos marcados.
                </div>
              </>
            )}
          </div>

          {a.combinacoes.length > 0 && (
            <div style={{ ...cardStyle, marginBottom: 12 }}>
              <div style={rotulo}>Por combinação de setores</div>
              <table style={tabela}>
                <thead>
                  <tr>
                    <th style={th}>Pedido usa</th>
                    <th style={{ ...th, textAlign: "right" }}>Cozinha</th>
                    <th style={{ ...th, textAlign: "right" }}>Pedidos</th>
                  </tr>
                </thead>
                <tbody>
                  {a.combinacoes.map((c) => (
                    <tr key={c.setores.join("+")}>
                      <td style={td}>{c.setores.map((s) => <span key={s} style={pilula}>{s}</span>)}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700,
                                   color: a.etapas.cozinha !== null && c.mediana >= a.etapas.cozinha + 3 ? "#C4432B" : "#22231F" }}>
                        {min1(c.mediana)}
                      </td>
                      <td style={{ ...td, textAlign: "right", color: "#8A8778" }}>{c.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {a.porHora.some((h) => h.n > 0) && (
            <div style={{ ...cardStyle, marginBottom: 12 }}>
              <div style={rotulo}>Por hora · cozinha mediana</div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 80 }}>
                {a.porHora.map((h) => (
                  <div key={h.faixa} title={`${h.n} pedidos`}
                    style={{ flex: 1, height: `${Math.max(3, ((h.mediana || 0) / tetoHora) * 100)}%`,
                             background: h === piorHora ? "#D85A30" : "#C9BFA6", borderRadius: "3px 3px 0 0",
                             opacity: h.n === 0 ? 0.3 : 1 }} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                {a.porHora.map((h) => (
                  <div key={h.faixa} style={{ flex: 1, textAlign: "center", fontSize: 11, color: "#8A8778", lineHeight: 1.35 }}>
                    {h.faixa}<br />
                    <span style={{ color: h === piorHora ? "#C4432B" : "#6B6558", fontWeight: 700 }}>
                      {h.n ? `${min1(h.mediana)} min` : "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {a.lentos.length > 0 && (
            <div style={{ ...cardStyle, marginBottom: 12 }}>
              <div style={rotulo}>Pedidos mais lentos</div>
              {a.lentos.map((r, i) => (
                <div key={r.pedido_id} style={{ display: "flex", justifyContent: "space-between", gap: 8,
                                                 fontSize: 13, padding: "7px 0", alignItems: "center",
                                                 borderTop: i ? "1px solid #F4EEE3" : "none" }}>
                  <span>
                    {r.referencia || `#${r.pedido_id}`} · {fmtQuandoSP.format(new Date(r.aceito_em))}
                    {r.canal ? ` · ${r.canal}` : ""}{" "}
                    {r.setoresNomes.map((s) => <span key={s} style={pilula}>{s}</span>)}
                  </span>
                  <span style={{ fontWeight: 700, whiteSpace: "nowrap",
                                 color: a.etapas.cozinha !== null && r.cozinha >= a.etapas.cozinha * 1.5 ? "#C4432B" : "#22231F" }}>
                    {Math.round(r.cozinha)} min
                  </span>
                </div>
              ))}
            </div>
          )}

          {a.semSetor.length > 0 && (
            <div style={{ ...cardStyle, display: "flex", justifyContent: "space-between", alignItems: "center",
                          gap: 10, flexWrap: "wrap" }}>
              <div style={{ fontSize: 13 }}>
                {a.semSetor.length} {a.semSetor.length === 1 ? "produto vendido sem setor fica" : "produtos vendidos sem setor ficam"} fora da conta
                <div style={{ fontSize: 11.5, color: "#8A8778", marginTop: 2 }}>
                  {a.semSetor.slice(0, 4).join(", ")}{a.semSetor.length > 4 ? "…" : ""}
                </div>
              </div>
              <button onClick={aoMapear} style={{ ...btnSec, padding: "8px 14px", fontSize: 13 }}>Mapear setores</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Etapa({ label, valor, nota }) {
  return (
    <div style={{ background: "#F7F1E6", borderRadius: 9, padding: "10px 12px" }}>
      <div style={{ fontSize: 12, color: "#6B6558" }}>{label}</div>
      <div style={{ fontSize: 21, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
        {valor === null ? "—" : `${min1(valor)} min`}
      </div>
      {nota && <div style={{ fontSize: 11, color: "#8A8778" }}>{nota}</div>}
    </div>
  );
}

function LinhaSetor({ nome, largura, cor, direita, forte: destaque }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "90px minmax(0, 1fr) 140px", gap: 10,
                  alignItems: "center", fontSize: 13, margin: "7px 0" }}>
      <span style={{ fontWeight: destaque ? 800 : 400 }}>{nome}</span>
      <div><div style={{ width: `${Math.min(100, largura * 100)}%`, height: 14, borderRadius: 3, background: cor }} /></div>
      <span style={{ fontSize: 12, color: destaque ? "#C4432B" : "#6B6558", fontWeight: destaque ? 700 : 400,
                     textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{direita}</span>
    </div>
  );
}

// =====================================================================
// ANTES DA TROCA — os tempos exatos do tablet, até 28/10
// =====================================================================
function AntesDaTroca() {
  const [dia, setDia] = useState(ULTIMO_DIA_TABLET);
  return (
    <div>
      <div style={{ ...avisoAmarelo, marginBottom: 12 }}>
        <Clock size={16} />
        <div>
          Até {dataCurta(ULTIMO_DIA_TABLET)} a cozinha marcava "peguei" e "terminei" no tablet do painel.
          Estes são os tempos exatos por estação daquele período. Depois disso a cozinha passou para o
          KDS do CardápioWeb, e a análise está na aba Análise.
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: "#6B6558" }}>Dia</span>
        <input type="date" value={dia} max={ULTIMO_DIA_TABLET}
          onChange={(e) => e.target.value && setDia(e.target.value)} style={inputStyle} />
      </div>
      <Hoje key={dia} dia={dia} />
    </div>
  );
}

// =====================================================================
// HOJE — como cada estação foi
// =====================================================================
function Hoje({ dia }) {
  const [linhas, setLinhas] = useState([]);
  const [espera, setEspera] = useState(null);
  const [ranking, setRanking] = useState([]);
  const [piores, setPiores] = useState([]);
  const [porLinha, setPorLinha] = useState([]);
  const [inicioMedicao, setInicioMedicao] = useState(null);
  const [fantasmas, setFantasmas] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [{ data: est, error: e1 }, { data: esp, error: e2 },
              { data: rank }, { data: piores }, { data: linhasProd },
              { data: cfg }, { data: tempos }, { data: fant }] = await Promise.all([
        supabase.rpc("desempenho_estacoes", { p_inicio: dia, p_fim: dia }),
        supabase.rpc("espera_montagem", { p_inicio: dia, p_fim: dia }),
        // 048, 049 e 050 sao opcionais para esta tela: se ainda nao rodaram,
        // os blocos novos somem e o resto continua igual. Erro aqui nao
        // quebra nada — por isso nenhum destes tem `error` lido.
        supabase.rpc("kds_ranking_pratos", { p_inicio: dia, p_fim: dia }),
        supabase.rpc("kds_pedidos_espera", { p_inicio: dia, p_fim: dia, p_limite: 6 }),
        supabase.rpc("kds_ranking_linhas", { p_inicio: dia, p_fim: dia }),
        supabase.from("kds_config").select("inicio_medicao").maybeSingle(),
        supabase.rpc("kds_tempo_estacao", { p_inicio: dia, p_fim: dia }),
        // migração 133; sem ela o bloco de fantasmas só não aparece
        supabase.rpc("fantasmas_do_dia", { p_dia: dia }),
      ]);
      if (!vivo) return;
      if (e1) setErro(e1.message);
      if (e2) setErro(e2.message);
      // desempenho_estacoes continua sendo a fonte de "segurou", que depende
      // de comparar itens do mesmo pedido. kds_tempo_estacao (051) traz o
      // tempo de um item medido item a item, que e o que nao dava pra obter
      // somando duas medias. Se a 051 nao rodou, `tempos` vem vazio e a
      // coluna cai no total antigo — a tela nao quebra, so fica menos exata.
      const porSetor = {};
      for (const t of tempos || []) porSetor[t.setor] = t;
      setLinhas((est || []).map((l) => ({ ...l, tempo: porSetor[l.setor] || null })));
      setEspera(Array.isArray(esp) ? esp[0] : esp);
      setRanking(rank || []);
      setPiores(piores || []);
      setPorLinha(linhasProd || []);
      setInicioMedicao(cfg?.inicio_medicao || null);
      setFantasmas(Array.isArray(fant) ? fant[0] : fant);
      setCarregando(false);
    })();
    return () => { vivo = false; };
  }, [dia]);

  if (carregando) return <div style={vazio}><Loader2 size={16} /> Carregando…</div>;

  const comDado = linhas.filter((l) => Number(l.itens) > 0);
  // O KDS foi zerado: numero de antes do corte e fila presa e treino, nao
  // desempenho. Se o dia aberto e anterior ao corte, a tela diz isso em vez
  // de deixar alguem ler um 34,8 min de fila como se fosse real.
  const corte = inicioMedicao ? new Date(inicioMedicao) : null;
  const antesDoCorte = corte && new Date(dia + "T23:59:59") < corte;

  return (
    <div>
      {erro && <div style={avisoErro}><AlertTriangle size={16} /> {erro}</div>}

      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between",
                    gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ ...rotulo, marginBottom: 0 }}>Tempo médio de um item</div>
        {corte && (
          <div style={{ fontSize: 11, color: "#8A8778" }}>
            medindo desde {corte.toLocaleString("pt-BR", {
              day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
            })}
          </div>
        )}
      </div>

      {/* Pedido fantasma: só aparece quando houve. Zero fantasma não
          precisa de espaço na tela; três fantasmas numa noite, sim. */}
      {fantasmas && Number(fantasmas.total) > 0 && (
        <div style={{ ...cardStyle, marginBottom: 14, borderColor: "#EBC9C1", background: "#FDF4F1" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
            <Ghost size={16} color="#A32D2D" />
            <span style={{ fontSize: 20, fontWeight: 800, color: "#A32D2D",
                           fontVariantNumeric: "tabular-nums" }}>{fantasmas.total}</span>
            <span style={{ fontSize: 13, color: "#8E2420", fontWeight: 600 }}>
              pedido{Number(fantasmas.total) === 1 ? "" : "s"} fantasma neste dia
            </span>
          </div>
          {fantasmas.por_canal && Object.keys(fantasmas.por_canal).length > 0 && (
            <div style={{ fontSize: 11.5, color: "#6B6558", marginTop: 4 }}>
              {Object.entries(fantasmas.por_canal).map(([c, n]) => `${c}: ${n}`).join(" · ")}
            </div>
          )}
          {Array.isArray(fantasmas.ultimos) && fantasmas.ultimos.length > 0 && (
            <div style={{ fontSize: 11.5, color: "#8A8778", marginTop: 6, lineHeight: 1.7 }}>
              {fantasmas.ultimos.slice(0, 5).map((f, i) => (
                <div key={i}>
                  {f.hora} · {f.referencia || "sem referência"}
                  {f.setor ? ` · visto no ${f.setor}` : ""}
                </div>
              ))}
            </div>
          )}
          <div style={{ fontSize: 11, color: "#8A8778", marginTop: 8, lineHeight: 1.55 }}>
            Fantasma repetido no mesmo canal é defeito de integração, não distração da
            equipe: vale conferir o CardápioWeb antes de cobrar alguém.
          </div>
        </div>
      )}

      {antesDoCorte && (
        <div style={avisoAmarelo}>
          <AlertTriangle size={16} />
          <div>
            Este dia é anterior ao início da medição. O que aparece aqui é do período
            de treino e de fila presa — não vale como desempenho.
          </div>
        </div>
      )}

      {comDado.length === 0 ? (
        <div style={avisoAmarelo}>
          <AlertTriangle size={16} />
          <div>
            Nenhuma produção marcada no tablet neste dia.
          </div>
        </div>
      ) : (
        <>
          <ColunasEstacao linhas={comDado} />

          {espera && Number(espera.pedidos_com_varias) > 0 && (
            <>
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6,
                            color: "#8A8778", fontWeight: 800, marginBottom: 8 }}>
                Espera de montagem
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <Numero valor={`${min1(espera.espera_media_min)} min`} label="Média por pedido" alerta />
                <Numero valor={`${min1(espera.espera_p90_min)} min`} label="P90" alerta />
                <Numero valor={`${min1(espera.espera_total_horas)} h`} label="Somado no dia" />
                <Numero valor={`${espera.pct_varias_estacoes || 0}%`} label="Pedidos com 2+ estações" />
              </div>
              <div style={{ fontSize: 11.5, color: "#8A8778", marginTop: 10, lineHeight: 1.6 }}>
                É o tempo em que a comida ficou pronta esperando o resto do pedido.
                Não dá pra zerar — pedido de quatro estações sempre tem alguma espera —
                mas dá pra escalonar: se a chapa leva 9 min e a batata 4, a cozinha não
                devia começar a batata no minuto zero.
              </div>
            </>
          )}

          <MaisLentoPorLinha linhas={porLinha} />
          <PontosMelhoria estacoes={comDado} porLinha={porLinha} />

          <PioresPedidos pedidos={piores} />
          <MaisLentosRapidos pratos={ranking} />

          <ComoLer estacoes={comDado} temLinhas={porLinha.length > 0} />
        </>
      )}
    </div>
  );
}

// =====================================================================
// PIORES PEDIDOS — onde a comida mais esperou hoje
//
// A tabela de estações diz ONDE o tempo vai. Esta lista diz em QUAL pedido,
// e abre a linha do tempo dele. Sem isso, "a espera média foi 7 minutos"
// não aponta para nada que dê pra investigar na segunda-feira.
// =====================================================================
function PioresPedidos({ pedidos }) {
  const [aberto, setAberto] = useState(null);
  if (!pedidos || pedidos.length === 0) return null;

  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6,
                    color: "#8A8778", fontWeight: 800, marginBottom: 8 }}>
        Pedidos que mais esperaram
      </div>
      <div style={{ ...cardStyle, padding: 0, overflow: "hidden" }}>
        <table style={tabela}>
          <thead>
            <tr>
              <th style={th}>Pedido</th>
              <th style={{ ...th, textAlign: "right" }}>Estações</th>
              <th style={{ ...th, textAlign: "right" }}>Total</th>
              <th style={{ ...th, textAlign: "right" }}>Esperando</th>
              <th style={{ ...th, textAlign: "right" }}>Do pedido</th>
            </tr>
          </thead>
          <tbody>
            {pedidos.map((p) => {
              const grave = Number(p.espera_pct) >= 50;
              return (
                <React.Fragment key={p.pedido_id}>
                  <tr onClick={() => setAberto(aberto === p.pedido_id ? null : p.pedido_id)}
                      style={{ cursor: "pointer" }}>
                    <td style={td}>
                      <b>{p.pedido_id}</b>
                      <div style={{ fontSize: 11, color: "#8A8778" }}>
                        {p.itens} itens · {aberto === p.pedido_id ? "fechar" : "ver a linha do tempo"}
                      </div>
                    </td>
                    <td style={{ ...td, textAlign: "right" }}>{p.estacoes}</td>
                    <td style={{ ...td, textAlign: "right" }}>{min1(p.total_min)}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 800,
                                 color: grave ? "#C4432B" : "#22231F" }}>{min1(p.espera_min)}</td>
                    <td style={{ ...td, textAlign: "right",
                                 color: grave ? "#C4432B" : "#8A8778" }}>
                      {p.espera_pct == null ? "—" : `${p.espera_pct}%`}
                    </td>
                  </tr>
                  {aberto === p.pedido_id && (
                    <tr>
                      <td colSpan={5} style={{ ...td, background: "#F6F1E7", padding: "12px 14px" }}>
                        <LinhaDoTempo pedido={p.pedido_id} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 11.5, color: "#8A8778", marginTop: 9, lineHeight: 1.6 }}>
        <b>Esperando</b> é quanto tempo já havia comida pronta na janela enquanto o resto
        do pedido não saía. <b>Do pedido</b> é o quanto isso representou do tempo total:
        acima de 50% quer dizer que a maior parte do pedido foi comida parada, não comida
        sendo feita. Clique numa linha para ver em qual estação o tempo foi embora.
      </div>
    </div>
  );
}

// =====================================================================
// A LINHA DO TEMPO DE UM PEDIDO
//
// Uma barra por item, posicionada pelo relógio. A faixa vermelha é o
// intervalo em que já havia comida pronta esperando — é o desenho que
// mostra que o problema costuma ser QUANDO a estação foi acionada, não a
// velocidade dela.
// =====================================================================
function LinhaDoTempo({ pedido }) {
  const [itens, setItens] = useState(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await supabase.rpc("kds_pedido_linha", { p_pedido: pedido });
      if (!vivo) return;
      if (error) { setErro(error.message); setItens([]); return; }
      setItens(data || []);
    })();
    return () => { vivo = false; };
  }, [pedido]);

  if (erro) return <div style={{ fontSize: 12, color: "#C4432B" }}>{erro}</div>;
  if (!itens) return <div style={{ fontSize: 12, color: "#8A8778" }}>Carregando…</div>;
  if (itens.length === 0) return <div style={{ fontSize: 12, color: "#8A8778" }}>Sem itens.</div>;

  const total = Math.max(1, Number(itens[0].total_seg) || 1);
  const prim = Number(itens[0].primeiro_pronto) || 0;
  const ult = Number(itens[0].ultimo_pronto) || total;
  const pc = (s) => `${(100 * Number(s)) / total}%`;
  const corDe = (setor) =>
    setor === "chapa" ? "#22231F" : setor === "cozinha" ? "#6E6F63" : "#A9A496";

  return (
    <div>
      <div style={{ position: "relative", display: "grid", gap: 5 }}>
        {/* a faixa da espera, atrás de tudo */}
        {ult > prim && (
          <div aria-hidden="true" style={{
            position: "absolute", left: pc(prim), width: pc(ult - prim),
            top: 0, bottom: 0, background: "#C4432B", opacity: 0.09, pointerEvents: "none",
          }} />
        )}
        {itens.map((i, k) => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "minmax(90px,150px) 1fr 54px",
                                gap: 8, alignItems: "center", position: "relative" }}>
            <span style={{ fontSize: 11, color: "#22231F", overflow: "hidden",
                           textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{i.nome}</span>
            <span style={{ position: "relative", height: 16, background: "#FFFFFF",
                           border: "1px solid #E8E2D2", display: "block" }}>
              <span style={{
                position: "absolute", top: 0, bottom: 0,
                left: pc(i.inicio_seg),
                width: `max(3px, ${(100 * (Number(i.fim_seg) - Number(i.inicio_seg))) / total}%)`,
                background: i.aberto ? "#C9A227" : corDe(i.setor),
              }} />
            </span>
            <span style={{ fontSize: 10.5, color: "#8A8778", textAlign: "right",
                           fontVariantNumeric: "tabular-nums" }}>
              {i.aberto ? "aberto" : `${min1(i.producao_min)}m`}
            </span>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: "#8A8778", marginTop: 8, lineHeight: 1.5 }}>
        A faixa vermelha é o intervalo com comida pronta esperando. Barra que começa
        tarde não é estação lenta — é estação acionada tarde.
      </div>
    </div>
  );
}

// =====================================================================
// MAIS LENTOS E MAIS RÁPIDOS
//
// O módulo media por estação e nunca por prato. A coluna FILA é a que
// costuma explicar o problema: prato com produção curta e fila longa não
// é difícil de fazer, é esquecido na comanda — e aí aparecer entre os
// "mais rápidos" não quer dizer nada de bom.
//
// Prato que não foi produzido não aparece: sem produção não existe tempo
// para medir. O que não vendeu é pergunta do fechamento mensal.
//
// A mediana, e não a média: um pedido travado sozinho entorta a média de
// um prato feito cinco vezes.
// =====================================================================
function MaisLentosRapidos({ pratos }) {
  if (!pratos || pratos.length === 0) return null;
  const comAmostra = pratos.filter((p) => Number(p.itens) > 0);
  if (comAmostra.length === 0) return null;

  // Com poucos pratos, duas listas mostrariam os MESMOS itens dos dois
  // lados — "mais lento" e "mais rápido" do mesmo conjunto de cinco é
  // ridículo. Abaixo de seis pratos vira uma lista só, ordenada.
  const poucos = comAmostra.length < 6;
  const n = Math.min(5, Math.floor(comAmostra.length / 2));
  const lentos = comAmostra.slice(0, n);
  const rapidos = comAmostra.slice(comAmostra.length - n).reverse();

  return (
    <div style={{ marginTop: 34 }}>
      <div style={rotulo}>
        {poucos ? "Do mais lento ao mais rápido" : "Mais lentos e mais rápidos"}
      </div>
      {poucos ? (
        <ListaPratos itens={comAmostra} />
      ) : (
        <div style={{ display: "grid", gap: 26,
                      gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          <ListaPratos titulo="Mais lentos" itens={lentos} />
          <ListaPratos titulo="Mais rápidos" itens={rapidos} />
        </div>
      )}
      <div style={{ ...paragrafo, marginTop: 12 }}>
        O número é a <b style={forte}>mediana da produção</b> daquele prato — do
        "peguei" ao "terminei". Prato com produção curta e <b style={forte}>fila</b> longa
        não é difícil de fazer, é esquecido: estar entre os rápidos aí não é elogio.
      </div>
    </div>
  );
}

function ListaPratos({ titulo, itens }) {
  return (
    <div>
      {titulo && (
        <div style={{ fontSize: 12, fontWeight: 800, marginBottom: 4,
                      letterSpacing: -0.1 }}>
          {titulo}{" "}
          <span style={{ fontWeight: 400, color: "#8A8778", fontSize: 11 }}>
            · mediana por prato
          </span>
        </div>
      )}
      {itens.map((p, k) => {
        const filaAlta = Number(p.fila_mediana) > Number(p.producao_mediana);
        return (
          <div key={k} style={{ display: "flex", alignItems: "baseline", gap: 8,
                                padding: "9px 0", fontSize: 12.5,
                                borderTop: "1px solid #E8E2D2" }}>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", overflow: "hidden",
                             textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.nome}
              </span>
              <small style={{ display: "block", fontSize: 10.5, color: "#8A8778",
                              fontVariantNumeric: "tabular-nums" }}>
                {p.setor} · {p.itens} {Number(p.itens) === 1 ? "medição" : "medições"}
                {" · pior "}{min1(p.producao_pior)}m
                {filaAlta && (
                  <b style={{ color: "#C4432B" }}>
                    {" · fila "}{min1(p.fila_mediana)}m
                  </b>
                )}
              </small>
            </span>
            <b style={{ flex: "none", fontVariantNumeric: "tabular-nums",
                        color: filaAlta ? "#C4432B" : "#22231F" }}>
              {min1(p.producao_mediana)}m
            </b>
          </div>
        );
      })}
    </div>
  );
}

// =====================================================================
// PRODUTOS — em que estação cada produto é feito
// =====================================================================
function Produtos({ setores, editar }) {
  const [pratos, setPratos] = useState([]);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState("sem");
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [marcados, setMarcados] = useState(() => new Set());

  const carregar = useCallback(async () => {
    const { data, error } = await supabase
      .from("pratos").select("id, nome, setor").order("nome");
    if (error) setErro(error.message);
    setPratos(data || []);
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const semEstacao = pratos.filter((p) => !p.setor).length;

  const lista = useMemo(() => {
    const q = chaveNome(busca);
    return pratos.filter((p) => {
      if (q && !chaveNome(p.nome).includes(q)) return false;
      if (filtro === "sem" && p.setor) return false;
      if (filtro.startsWith("setor:") && p.setor !== filtro.slice(6)) return false;
      return true;
    });
  }, [pratos, busca, filtro]);

  const definir = async (prato, setor) => {
    setErro("");
    const valor = setor || null;
    const { error } = await supabase.from("pratos").update({ setor: valor }).eq("id", prato.id);
    if (error) { setErro(error.message); return; }
    setPratos((atual) => atual.map((p) => (p.id === prato.id ? { ...p, setor: valor } : p)));
  };

  const definirMarcados = async (setor) => {
    if (marcados.size === 0) return;
    setErro("");
    const ids = [...marcados];
    const { error } = await supabase.from("pratos").update({ setor }).in("id", ids);
    if (error) { setErro(error.message); return; }
    setPratos((atual) => atual.map((p) => (marcados.has(p.id) ? { ...p, setor } : p)));
    setMarcados(new Set());
  };

  const alterna = (id) => {
    setMarcados((s) => {
      const novo = new Set(s);
      if (novo.has(id)) novo.delete(id); else novo.add(id);
      return novo;
    });
  };

  if (carregando) return <div style={vazio}><Loader2 size={16} /> Carregando…</div>;

  return (
    <div>
      {erro && <div style={avisoErro}><AlertTriangle size={16} /> {erro}</div>}

      {semEstacao > 0 && (
        <div style={avisoAmarelo}>
          <AlertTriangle size={16} />
          <div style={{ fontSize: 13 }}>
            <b>{semEstacao} produto(s) sem estação.</b> Enquanto estiverem assim, eles
            não aparecem em tela nenhuma da produção — e o pedido que tiver um deles
            nunca fica 100% pronto, porque não existe ninguém pra dar o "terminei".
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Search size={14} style={{ position: "absolute", left: 10, top: 11, color: "#8A8778" }} />
          <input value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Procurar produto…"
            style={{ ...inputStyle, width: "100%", paddingLeft: 30 }} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={() => setFiltro("sem")}
          style={{ ...chip, ...(filtro === "sem" ? chipAtivo : {}) }}>
          Sem estação ({semEstacao})
        </button>
        <button onClick={() => setFiltro("todos")}
          style={{ ...chip, ...(filtro === "todos" ? chipAtivo : {}) }}>
          Todos ({pratos.length})
        </button>
        {setores.map((s) => {
          const chave = `setor:${s.chave}`;
          const n = pratos.filter((p) => p.setor === s.chave).length;
          return (
            <button key={s.chave} onClick={() => setFiltro(chave)}
              style={{ ...chip, ...(filtro === chave ? chipAtivo : {}) }}>
              {s.label} ({n})
            </button>
          );
        })}
      </div>

      {editar && marcados.size > 0 && (
        <div style={{ ...cardStyle, marginBottom: 12, display: "flex", gap: 6,
                      flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 700 }}>{marcados.size} marcado(s) →</span>
          {setores.map((s) => (
            <button key={s.chave} onClick={() => definirMarcados(s.chave)} style={chip}>
              {s.label}
            </button>
          ))}
          <button onClick={() => setMarcados(new Set())} style={{ ...chip, marginLeft: "auto" }}>
            <X size={12} /> Limpar
          </button>
        </div>
      )}

      {lista.length === 0 ? (
        <div style={vazio}>Nenhum produto com esse filtro.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {lista.map((p) => (
            <div key={p.id} style={{ ...linha, borderColor: p.setor ? "#E8E2D2" : "#F0D8CE",
                                     background: p.setor ? "#FFFFFF" : "#FFFBFA" }}>
              {editar && (
                <input type="checkbox" checked={marcados.has(p.id)}
                  onChange={() => alterna(p.id)} style={{ marginRight: 4 }} />
              )}
              <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}>{p.nome}</div>
              <select value={p.setor || ""} disabled={!editar}
                onChange={(e) => definir(p, e.target.value)}
                style={{ ...inputStyle, width: 128, padding: "7px 8px", fontSize: 13 }}>
                <option value="">sem estação</option>
                {setores.map((s) => (
                  <option key={s.chave} value={s.chave}>{s.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      <div style={{ fontSize: 11, color: "#8A8778", marginTop: 12, lineHeight: 1.6 }}>
        Produto que passa por duas estações (o lanche que leva batata junto, por
        exemplo) deve ficar na estação que <b>produz</b> o item, não na que monta.
        Se ele é vendido como um item só no cardápio, escolhe a estação que leva
        mais tempo — é ela que segura o pedido.
      </div>
    </div>
  );
}

// =====================================================================
// Peças de tela
// =====================================================================
function Shell({ titulo, subtitulo, children, onVoltar }) {
  return (
    <div style={pagina}>
      <div className="app-shell">
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          {onVoltar && (
            <button onClick={onVoltar} style={iconBtn}><ChevronLeft size={18} /></button>
          )}
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: "#22231F" }}>{titulo}</div>
            {subtitulo && <div style={{ fontSize: 12, color: "#8A8778" }}>{subtitulo}</div>}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// CARTÕES DE ESTAÇÃO
//
// Isto aqui era uma tabela com quatro colunas de jargão e números sem
// unidade. "0,1" e "34,8" na mesma linha não dizem nada: o bar levava
// 6 segundos para tirar uma bebida que tinha ficado 35 minutos parada,
// e isso — que é o achado mais caro do dia — se perdia entre as colunas.
//
// Agora cada estação é uma barra e uma frase. A barra mostra o caminho
// do item: quanto ficou parado na fila e quanto a estação trabalhou de
// fato. São dois problemas diferentes com dois remédios diferentes:
// fila grande é gente e ordem de acionar, produção grande é processo.
// A tabela crua continua embaixo, dobrada, para conferência.
// ---------------------------------------------------------------------
// ---------------------------------------------------------------------
// COLUNAS DE ESTAÇÃO
//
// Isto era uma tabela com quatro colunas de jargão e números sem unidade.
// "0,1" e "34,8" na mesma linha não dizem nada: o bar levava 6 segundos
// para tirar uma bebida que tinha ficado 35 minutos parada, e isso — que
// é o achado mais caro do dia — se perdia entre as colunas.
//
// Agora cada estação é uma coluna, TODAS NA MESMA ESCALA: a mais alta do
// dia define a altura e as outras ficam proporcionais a ela. Essa
// comparação entre estações é a coisa mais útil da tela e não existia,
// porque antes cada barra ia de 0 a 100% dela mesma.
//
// Verde embaixo é a estação trabalhando; o bloco de cima é o item parado
// na fila. São dois problemas com dois remédios: fila é gente e ordem de
// acionar, produção é processo da estação.
// ---------------------------------------------------------------------
function tempoCurto(min) {
  const v = Number(min);
  if (min === null || min === undefined || Number.isNaN(v)) return "—";
  if (v > 0 && v < 1) return `${Math.round(v * 60)} s`;
  return `${min1(v)} min`;
}

// A espera só é o problema quando ela domina o tempo do item. Estação que
// faz em 7 min e espera 5 está equilibrada; a que faz em 6 segundos e
// espera 35 minutos não é lenta, é esquecida.
function esperaDomina(l) {
  const prod = Number(l.producao_media) || 0;
  const fila = Number(l.fila_media) || 0;
  return fila >= 5 && fila > prod;
}

const ALTURA_TORRE = 150;

function ColunasEstacao({ linhas }) {
  // O tempo de um item vem medido item a item pela 051. Somar a fila media
  // com a producao media NAO devolve isso: com medianas a soma nem e valida
  // (mediana de a + mediana de b nao e a mediana de a+b). A soma fica so
  // como ultimo recurso, para a tela nao ficar vazia antes da 051 rodar.
  const total = (l) =>
    l.tempo && l.tempo.total_medio != null
      ? Number(l.tempo.total_medio)
      : (Number(l.fila_media) || 0) + (Number(l.producao_media) || 0);
  const ordenadas = [...linhas].sort((a, b) => total(b) - total(a));
  const teto = Math.max(...ordenadas.map(total), 0.0001);

  return (
    <div>
      <div style={{ display: "grid", gap: 14, alignItems: "end",
                    gridTemplateColumns: `repeat(${Math.max(ordenadas.length, 1)}, 1fr)` }}>
        {ordenadas.map((l) => {
          const prod = Number(l.producao_media) || 0;
          const fila = Number(l.fila_media) || 0;
          const seg = l.segurou_pct == null ? null : Number(l.segurou_pct);
          const grave = esperaDomina(l);
          // A torre tem a altura do tempo medido, repartida na proporcao
          // entre fila e producao. Sem reescalar, uma coluna cujo total
          // medido e menor que fila+producao estouraria a propria altura.
          const soma = fila + prod;
          const escala = soma > 0 ? total(l) / soma : 0;
          return (
            <div key={l.setor} style={{ display: "flex", flexDirection: "column",
                                        alignItems: "center", textAlign: "center" }}>
              <div style={{ fontSize: 18, fontWeight: 700,
                            fontVariantNumeric: "tabular-nums", letterSpacing: -0.3 }}>
                {min1(total(l))}
                <span style={{ fontSize: 11, color: "#8A8778", fontWeight: 400,
                               marginLeft: 1 }}>min</span>
              </div>
              <div style={{ fontSize: 10, color: "#8A8778", marginBottom: 7,
                            letterSpacing: 0.2, minHeight: 13 }}>
                {l.tempo && l.tempo.total_mediana != null
                  ? `mediana ${min1(l.tempo.total_mediana)}`
                  : ""}
              </div>

              <div style={{ width: 44, height: ALTURA_TORRE, display: "flex",
                            flexDirection: "column", justifyContent: "flex-end",
                            borderRadius: 4, overflow: "hidden" }}>
                {/* piso de 2px: sem ele a bebida (6 s contra 35 min de fila)
                    some da coluna e a legenda promete um verde que nao existe */}
                <div style={{ width: "100%", background: grave ? "#C4432B" : "#C9C3B1",
                              height: fila > 0
                                ? `max(2px, ${(fila * escala / teto) * ALTURA_TORRE}px)` : 0 }} />
                <div style={{ width: "100%", background: "#2F8F5B",
                              height: prod > 0
                                ? `max(2px, ${(prod * escala / teto) * ALTURA_TORRE}px)` : 0 }} />
              </div>

              <div style={{ marginTop: 9, paddingTop: 9, width: "100%",
                            borderTop: "1px solid #E8E2D2" }}>
                <div style={{ fontSize: 13.5, fontWeight: 700 }}>{l.label || l.setor}</div>
                <div style={{ fontSize: 11, color: "#8A8778", marginTop: 1 }}>
                  {l.itens} {Number(l.itens) === 1 ? "item" : "itens"}
                </div>
                <div style={{ fontSize: 11, color: "#8A8778", marginTop: 7,
                              lineHeight: 1.65, fontVariantNumeric: "tabular-nums" }}>
                  <span style={grave ? { color: "#C4432B", fontWeight: 700 } : undefined}>
                    {tempoCurto(fila)} esperando
                  </span><br />
                  {tempoCurto(prod)} fazendo<br />
                  {seg === null ? "—" : (
                    <span style={seg >= 50 ? { color: "#C4432B", fontWeight: 700 } : undefined}>
                      segurou {seg}%
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 18,
                    fontSize: 11, color: "#8A8778", flexWrap: "wrap" }}>
        <span>
          <i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2,
                      marginRight: 5, verticalAlign: -1, background: "#C9C3B1" }} />
          parado na fila
        </span>
        <span>
          <i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2,
                      marginRight: 5, verticalAlign: -1, background: "#C4432B" }} />
          fila dominando o tempo
        </span>
        <span>
          <i style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2,
                      marginRight: 5, verticalAlign: -1, background: "#2F8F5B" }} />
          estação trabalhando
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// O MAIS LENTO DE CADA LINHA  (precisa da 049)
//
// Um ranking geral de pratos é sempre dominado pelos hambúrgueres: o
// petisco mais lento da casa nunca apareceria. Separando por linha de
// produto, cada categoria mostra o seu pior.
//
// Prato sem linha_produto preenchida cai em "(sem linha)" e fica marcado
// em vermelho — é a lista do que falta classificar em Fichas Técnicas.
// Escondê-lo faria a tela mentir por omissão.
// ---------------------------------------------------------------------
function MaisLentoPorLinha({ linhas }) {
  if (!linhas || linhas.length === 0) return null;

  return (
    <div style={{ marginTop: 34 }}>
      <div style={rotulo}>O mais lento de cada linha</div>
      {linhas.map((l, i) => {
        const sem = String(l.linha || "").startsWith("(sem");
        return (
          <div key={l.linha} style={{ display: "flex", alignItems: "baseline", gap: 10,
                                      padding: "11px 0", flexWrap: "wrap",
                                      borderTop: i === 0 ? "none" : "1px solid #E8E2D2" }}>
            <span style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.5,
                           fontWeight: 800, width: 118, flex: "none", lineHeight: 1.35,
                           color: sem ? "#C4432B" : "#8A8778" }}>
              {sem ? "Sem linha" : l.linha}
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 600, flex: "1 1 55%", minWidth: 0 }}>
              {l.pior_prato || "—"}
              <small style={{ display: "block", fontSize: 11, color: "#8A8778",
                              fontWeight: 400, marginTop: 1,
                              fontVariantNumeric: "tabular-nums" }}>
                {sem
                  ? `${l.pratos} ${Number(l.pratos) === 1 ? "prato" : "pratos"} sem categoria — classifique em Fichas Técnicas`
                  : `${l.pior_prato_itens} ${Number(l.pior_prato_itens) === 1 ? "medição" : "medições"} · linha inteira ${min1(l.producao_mediana)}m`}
              </small>
            </span>
            <span style={{ fontSize: 15, fontWeight: 700, flex: "none",
                           fontVariantNumeric: "tabular-nums" }}>
              {min1(l.pior_prato_mediana)}
              <span style={{ fontSize: 10.5, color: "#8A8778", fontWeight: 400 }}>m</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------
// PONTOS DE MELHORIA
//
// Os mesmos números de cima, escritos como ação. A ordem é a do custo:
// quem comeu mais tempo aparece primeiro. Nada aqui é texto fixo — se a
// estação melhorar, o ponto some sozinho.
// ---------------------------------------------------------------------
function pontosDeMelhoria(estacoes, porLinha) {
  const pontos = [];
  const total = (l) => (Number(l.fila_media) || 0) + (Number(l.producao_media) || 0);
  const ordenadas = [...estacoes].sort((a, b) => total(b) - total(a));

  for (const l of ordenadas) {
    const nome = String(l.label || l.setor).toLowerCase();
    const prod = Number(l.producao_media) || 0;
    const fila = Number(l.fila_media) || 0;
    const seg = l.segurou_pct == null ? null : Number(l.segurou_pct);

    if (prod < 1 && fila >= 5) {
      pontos.push({
        titulo: `Acione ${nome === "bar" ? "o bar" : `a estação ${nome}`} junto com a chapa, não no fim.`,
        corpo: `O item leva ${tempoCurto(prod)} pra ficar pronto, mas ficou ${tempoCurto(fila)} parado esperando alguém apertar "peguei". É o tempo mais barato de recuperar da casa inteira.`,
      });
    } else if (fila > prod && fila >= 5) {
      const pct = Math.round((fila / (fila + prod)) * 100);
      pontos.push({
        titulo: `Alguém precisa olhar a tela ${nome === "cozinha" ? "da cozinha" : `de ${nome}`}.`,
        corpo: `Dos ${min1(total(l))} min de um item, ${min1(fila)} foram antes de qualquer um pegar — ${pct}% do tempo não foi comida sendo feita, foi comida esperando.`,
      });
    } else if (seg !== null && seg >= 50) {
      pontos.push({
        titulo: `A ${nome} dita o tempo do pedido.`,
        corpo: `Em ${seg}% dos pedidos foi ela a última a terminar. Reforço de gente entra aqui primeiro.`,
      });
    }
  }

  // O gargalo escondido: um prato muito acima da própria linha. Só vale
  // apontar com medição suficiente — um prato feito uma vez é anedota.
  for (const l of porLinha || []) {
    const pior = Number(l.pior_prato_mediana) || 0;
    const linha = Number(l.producao_mediana) || 0;
    if (Number(l.pior_prato_itens) >= 3 && Number(l.pratos) > 1 &&
        linha > 0 && pior >= linha * 1.8) {
      pontos.push({
        titulo: `${l.pior_prato} é o gargalo escondido de ${String(l.linha).toLowerCase()}.`,
        corpo: `${min1(pior)} min de mediana contra ${min1(linha)} min da linha inteira. Item que demora mais que os vizinhos da própria categoria quebra a ordem de servir.`,
      });
    }
  }

  return pontos.slice(0, 5);
}

function PontosMelhoria({ estacoes, porLinha }) {
  const pontos = pontosDeMelhoria(estacoes, porLinha);
  if (pontos.length === 0) {
    return (
      <div style={{ marginTop: 34 }}>
        <div style={rotulo}>Pontos de melhoria</div>
        <div style={{ fontSize: 13, color: "#8A8778", lineHeight: 1.7 }}>
          Nada gritando hoje: nenhuma estação com fila dominando o tempo e nenhuma
          segurando mais da metade dos pedidos. Os números crus continuam abaixo.
        </div>
      </div>
    );
  }
  return (
    <div style={{ marginTop: 34 }}>
      <div style={rotulo}>Pontos de melhoria</div>
      <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {pontos.map((p, i) => (
          <li key={i} style={{ position: "relative", paddingLeft: 26, marginBottom: 14,
                               fontSize: 13.5, lineHeight: 1.6 }}>
            <span style={{ position: "absolute", left: 0, top: 1, width: 17, height: 17,
                           borderRadius: "50%", background: "#22231F", color: "#F7F1E6",
                           fontSize: 10, fontWeight: 800, display: "flex",
                           alignItems: "center", justifyContent: "center" }}>
              {i + 1}
            </span>
            <b>{p.titulo}</b> {p.corpo}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------
// COMO LER + os números crus, dobrados
// ---------------------------------------------------------------------
function ComoLer({ estacoes, temLinhas }) {
  return (
    <>
      <div style={{ marginTop: 34 }}>
        <div style={rotulo}>Como ler</div>
        <p style={paragrafo}>
          Cada coluna é o caminho de um item naquela estação, e todas estão na mesma
          escala — a altura dá pra comparar entre si. A parte de cima é o tempo{" "}
          <b style={forte}>parado na fila</b>, antes de alguém apertar "peguei"; a verde
          é a estação <b style={forte}>trabalhando</b> de fato. Coluna alta e clara é
          problema de <b style={forte}>gente e ordem de acionar</b>. Coluna alta e verde
          é problema de <b style={forte}>processo da estação</b>. São dois remédios
          diferentes.
          <br /><br />
          O número grande de cada coluna é o <b style={forte}>tempo médio de um item</b>{" "}
          — medido de uma vez só, da abertura do pedido até o item ficar pronto, item a
          item, e só então tirada a média. Não é a soma da fila com a produção: somar
          duas médias não devolve o tempo de nada. A <b style={forte}>mediana</b> logo
          abaixo é o item do meio, e quando ela fica bem menor que a média é porque um
          item travado está puxando o dia.
          <br /><br />
          <b style={forte}>Segurou</b> é quantas vezes a estação foi a última a terminar
          o pedido — é esse número que decide onde entra gente. <b style={forte}>P90</b>{" "}
          é o pior 1 em cada 10: média boa com P90 alto quer dizer que às vezes trava
          feio, e é desse "às vezes" que o cliente reclama.
          {temLinhas && (
            <>
              <br /><br />
              <b style={forte}>O mais lento de cada linha</b> existe porque um ranking
              geral de pratos é sempre dominado pelos hambúrgueres: o petisco mais lento
              da casa nunca apareceria. Separando por linha, cada categoria mostra o seu
              pior.
            </>
          )}
          <br /><br />
          A fila presa é zerada todo dia às 04:00, então item esquecido de ontem não
          suja a conta de hoje.
        </p>
      </div>

      <details style={{ marginTop: 30, borderTop: "1px solid #E8E2D2", paddingTop: 14 }}>
        <summary style={{ ...rotulo, marginBottom: 0, cursor: "pointer" }}>
          Ver os números crus
        </summary>
        <div style={{ ...cardStyle, marginTop: 12, padding: 0, overflow: "hidden" }}>
          <table style={tabela}>
            <thead>
              <tr>
                <th style={th}>Estação</th>
                <th style={{ ...th, textAlign: "right" }}>Itens</th>
                <th style={{ ...th, textAlign: "right" }}>Fila</th>
                <th style={{ ...th, textAlign: "right" }}>Produção</th>
                <th style={{ ...th, textAlign: "right" }}>P90</th>
                <th style={{ ...th, textAlign: "right" }}>Segurou</th>
              </tr>
            </thead>
            <tbody>
              {estacoes.map((l) => (
                <tr key={l.setor}>
                  <td style={td}><b>{l.label || l.setor}</b></td>
                  <td style={{ ...td, textAlign: "right" }}>{l.itens}</td>
                  <td style={{ ...td, textAlign: "right" }}>{min1(l.fila_media)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{min1(l.producao_media)}</td>
                  <td style={{ ...td, textAlign: "right" }}>{min1(l.producao_p90)}</td>
                  <td style={{ ...td, textAlign: "right",
                               color: Number(l.segurou_pct) >= 50 ? "#C4432B" : "#22231F",
                               fontWeight: Number(l.segurou_pct) >= 50 ? 800 : 400 }}>
                    {l.segurou_pct == null ? "—" : `${l.segurou_pct}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11.5, color: "#8A8778", marginTop: 10, lineHeight: 1.6 }}>
          Tudo em minutos. <b>Produção</b> é do "peguei" ao "terminei" — a estação em si.
          <b> Fila</b> é o tempo antes de alguém pegar, que é falta de gente, não da estação.
        </div>
      </details>
    </>
  );
}

const rotulo = {
  fontSize: 11, textTransform: "uppercase", letterSpacing: 0.7,
  color: "#8A8778", fontWeight: 800, marginBottom: 11,
};
const paragrafo = { fontSize: 13, color: "#8A8778", lineHeight: 1.75, margin: 0 };
const forte = { color: "#22231F", fontWeight: 600 };

function Numero({ valor, label, alerta }) {
  return (
    <div style={{ ...cardStyle, flex: 1, minWidth: 128, textAlign: "center", padding: "12px 10px" }}>
      <div style={{ fontSize: 21, fontWeight: 800, fontVariantNumeric: "tabular-nums",
                    color: alerta ? "#C4432B" : "#22231F" }}>
        {valor}
      </div>
      <div style={{ fontSize: 11, color: "#8A8778", marginTop: 2 }}>{label}</div>
    </div>
  );
}

// =====================================================================
// Estilos
// =====================================================================
const pagina = { minHeight: "100vh", background: "#F7F1E6", padding: "18px 14px 40px" };
const cardStyle = {
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 12, padding: 14,
};
const linha = {
  display: "flex", alignItems: "center", gap: 10,
  background: "#FFFFFF", border: "1px solid #E8E2D2", borderRadius: 10, padding: "10px 12px",
};
const inputStyle = {
  boxSizing: "border-box", padding: "9px 11px", borderRadius: 9,
  border: "1px solid #E8E2D2", fontSize: 14, background: "#FFFFFF", color: "#22231F",
  fontFamily: "inherit",
};
const chip = {
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "7px 12px", borderRadius: 999, border: "1px solid #E8E2D2",
  background: "#FFFFFF", color: "#8A8778", fontSize: 12, fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit",
};
const chipAtivo = { background: "#22231F", color: "#F3EFE3", borderColor: "#22231F" };
const btnSec = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  background: "#F6F1E7", color: "#22231F", border: "1px solid #E8E2D2", borderRadius: 9,
  padding: "12px 14px", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
};
const iconBtn = {
  width: 34, height: 34, borderRadius: 8, border: "1px solid #E8E2D2", background: "#FFFFFF",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#22231F",
};
const vazio = {
  display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#8A8778", padding: "16px 0",
};
const avisoErro = {
  display: "flex", gap: 8, background: "#FDECEA", border: "1px solid #F0C0B8",
  color: "#A32D2D", borderRadius: 10, padding: "11px 13px", fontSize: 13,
  alignItems: "flex-start", marginBottom: 12,
};
const avisoAmarelo = {
  display: "flex", gap: 8, background: "#FBF3D9", border: "1px solid #E8D48A",
  color: "#7A6A1E", borderRadius: 10, padding: "11px 13px", fontSize: 13,
  alignItems: "flex-start",
};
const tabela = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const th = {
  textAlign: "left", fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.6,
  color: "#8A8778", fontWeight: 800, padding: "10px 10px 8px", borderBottom: "1px solid #E8E2D2",
};
const td = { padding: "10px", borderBottom: "1px solid #F4EEE3", fontVariantNumeric: "tabular-nums" };
const pilula = {
  display: "inline-block", fontSize: 11, padding: "2px 8px", borderRadius: 999, marginRight: 4,
  background: "#F7F1E6", border: "1px solid #E8E2D2", color: "#6B6558", whiteSpace: "nowrap",
};
