/* ================================================================
   ROTA INSTRUMENTAÇÃO — lógica do app
   Estado salvo no navegador (localStorage) e, quando disponível,
   na conta (db do artifact, privado para quem usa). Exportar/importar
   no menu Backup.
   ================================================================ */
"use strict";
const PROVA = "2026-12-06";
const LOCKS = { P18: "2026-11-14", T23: "2026-11-22" }; // provas guardadas para os simulados do calendário
const DISC = { esp: "Específicas", por: "Português", mat: "Matemática" };
const KEY = "rotaInstr.v1";
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nome = a => NOMES[a] || a;

/* ---------- datas (sempre no fuso do aparelho) ---------- */
function hoje() { const d = new Date(); return ymd(d); }
function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
function addDias(s, n) { const [y, m, d] = s.split("-").map(Number); const x = new Date(y, m - 1, d + n); return ymd(x); }
function difDias(a, b) { const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number); return Math.round((new Date(y2, m2 - 1, d2) - new Date(y1, m1 - 1, d1)) / 864e5); }
function fmtData(s) { const [y, m, d] = s.split("-"); const dw = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][new Date(+y, m - 1, +d).getDay()]; return `${dw} ${d}/${m}`; }

/* ---------- estado ---------- */
function novoEstado() { return { v: 1, upd: 0, ans: {}, errs: [], topics: {}, cal: {}, days: {}, sims: [], settings: { leitura: true, unlock: false } }; }
let S = novoEstado();
let mem = null; // fallback em memória se o localStorage falhar
function carregarLocal() {
  try { const raw = localStorage.getItem(KEY); if (raw) S = Object.assign(novoEstado(), JSON.parse(raw)); }
  catch (e) { if (mem) S = mem; }
}
let dbRef = null, saveTimer = null, syncMsg = "Salvo neste aparelho";
function salvar() {
  S.upd = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { mem = S; }
  if (dbRef) { clearTimeout(saveTimer); saveTimer = setTimeout(salvarNuvem, 1500); }
}
async function salvarNuvem() {
  try { await dbRef.set({ json: JSON.stringify(S), upd: S.upd }); syncMsg = "Salvo na sua conta e neste aparelho"; }
  catch (e) { syncMsg = "Salvo só neste aparelho (a conta não respondeu)"; }
  const el = $("#sync"); if (el) el.textContent = syncMsg;
}
async function conectarConta() {
  try {
    if (!window.claude || !claude.use) return;
    const [db, user] = await Promise.all([claude.use("db"), claude.use("user")]);
    if (!db || !user) return;
    const id = await user.id(); if (!id) return;
    const ref = db.collection("data/users/" + id).doc("estado");
    const t = setTimeout(() => {}, 10000);
    let snap = await ref.get(); clearTimeout(t);
    let d = snap && (typeof snap.data === "function" ? snap.data() : (snap.data !== undefined ? snap.data : snap));
    if (d && d.json && (d.upd || 0) > (S.upd || 0)) { S = Object.assign(novoEstado(), JSON.parse(d.json)); try { localStorage.setItem(KEY, d.json); } catch (e) {} render(); }
    dbRef = ref; syncMsg = "Salvo na sua conta e neste aparelho";
    if (!d || (S.upd || 0) > (d.upd || 0)) salvarNuvem();
    const el = $("#sync"); if (el) el.textContent = syncMsg;
  } catch (e) { /* segue só com o aparelho */ }
}

/* ---------- banco: disponibilidade ---------- */
function bloqueada(q) {
  if (S.settings.unlock || q.simulada) return false;
  const p = q.orig.slice(0, 3); return LOCKS[p] && hoje() < LOCKS[p];
}
function disponiveis() { return BANK.filter(q => !bloqueada(q)); }
const byId = Object.fromEntries(BANK.map(q => [q.id, q]));

/* ---------- registro de respostas ---------- */
function registrar(q, letra, viaSim) {
  const ok = letra === q.gab, d = hoje();
  const a = S.ans[q.id] || (S.ans[q.id] = { n: 0, c: 0, dias: [], ult: null });
  a.n++; if (ok) { a.c++; if (!a.dias.includes(d)) a.dias.push(d); }
  a.ult = { d, ok, ch: letra };
  S.days[d] = (S.days[d] || 0) + 1;
  if (!S.topics[q.ass]) S.topics[q.ass] = { first: d, rev: {} };
  if (!ok) S.errs.push({ id: q.id, ch: letra, d });
  if (S.errs.length > 600) S.errs = S.errs.slice(-600);
  salvar(); return ok;
}
function erradasIds() { return Object.entries(S.ans).filter(([id, a]) => a.ult && !a.ult.ok && byId[id]).map(([id]) => id); }
function statsDisc(disc) {
  let n = 0, c = 0; for (const [id, a] of Object.entries(S.ans)) { const q = byId[id]; if (q && (!disc || q.disc === disc)) { n += a.n; c += a.c; } }
  return { n, c, p: n ? Math.round(100 * c / n) : null };
}
function statsAss() {
  const m = {}; for (const [id, a] of Object.entries(S.ans)) { const q = byId[id]; if (!q) continue; const s = m[q.ass] || (m[q.ass] = { n: 0, c: 0, dias: new Set(), disc: q.disc }); s.n += a.n; s.c += a.c; a.dias.forEach(x => s.dias.add(x)); }
  return m;
}
function dominados() { return Object.entries(statsAss()).filter(([a, s]) => s.n >= 4 && s.c / s.n >= .8 && s.dias.size >= 2).map(([a]) => a); }
function revisoesDevidas() {
  const t = hoje(), out = [];
  for (const [a, info] of Object.entries(S.topics)) for (const k of [1, 3, 7]) {
    const due = addDias(info.first, k); if (due <= t && !(info.rev || {})[k]) out.push({ a, k, due });
  }
  return out;
}
function precisaRevisar() {
  const s = statsAss(); const fracos = Object.entries(s).filter(([a, v]) => v.n >= 2 && v.c / v.n < .6).map(([a]) => a);
  return [...new Set([...fracos, ...revisoesDevidas().map(r => r.a)])];
}
function sequencia() {
  let n = 0, d = hoje(); if (!S.days[d]) d = addDias(d, -1);
  while (S.days[d]) { n++; d = addDias(d, -1); } return n;
}
function marcarRevisao(a, k) { if (!S.topics[a]) return; S.topics[a].rev = S.topics[a].rev || {}; S.topics[a].rev[k] = hoje(); salvar(); }

/* ================================================================
   ROTEAMENTO (#hash)
   ================================================================ */
const VIEWS = ["inicio", "questoes", "cafe", "calendario", "mais", "formulas", "erros", "simulado", "analise", "banca", "backup", "quiz"];
let quiz = null; // sessão em andamento
function rota() { const h = location.hash.slice(1); return VIEWS.includes(h) ? h : "inicio"; }
function ir(v) { if (location.hash.slice(1) === v) render(); else location.hash = v; }
window.addEventListener("hashchange", render);
function render() {
  const v = rota(); const app = $("#app");
  if (v === "quiz" && !quiz) { location.hash = "questoes"; return; }
  app.innerHTML = (R[v] || R.inicio)();
  document.querySelectorAll("nav.tabs a").forEach(a => a.classList.toggle("on", a.dataset.v === v || (a.dataset.v === "mais" && ["formulas", "erros", "simulado", "analise", "banca", "backup"].includes(v)) || (a.dataset.v === "questoes" && v === "quiz")));
  if (v === "quiz") montarQuiz();
  window.scrollTo(0, 0);
}

/* ---------- pequenos componentes ---------- */
function barra(p, cor) { return `<div class="bar"><span style="width:${Math.max(0, Math.min(100, p || 0))}%;${cor ? "background:" + cor : ""}"></span></div>`; }
function chip(t, cls = "") { return `<span class="chip ${cls}">${esc(t)}</span>`; }
function diaCal(d) { return CAL.find(c => c.d === d); }

/* ================================================================
   TELAS
   ================================================================ */
const R = {};

R.inicio = () => {
  const t = hoje(), faltam = difDias(t, PROVA), dc = diaCal(t);
  const g = statsDisc(), e = statsDisc("esp"), p = statsDisc("por"), m = statsDisc("mat");
  const meta = dc ? dc.meta : 15, feitas = S.days[t] || 0;
  const totDias = CAL.filter(c => c.tipo !== "prova").length;
  const tarefas = CAL.reduce((n, c) => n + Object.values(S.cal[c.d] || {}).filter(Boolean).length, 0);
  const totTarefas = CAL.reduce((n, c) => n + tarefasDia(c).length, 0);
  const prog = totTarefas ? Math.round(100 * tarefas / totTarefas) : 0;
  const dom = dominados(), rev = precisaRevisar();
  const ult7 = [...Array(7)].map((_, i) => addDias(t, i - 6));
  const max7 = Math.max(meta, ...ult7.map(d => S.days[d] || 0), 1);
  return `
  <section class="hero card">
    <div class="eyebrow">Contagem regressiva</div>
    <div class="big">${faltam > 0 ? faltam + (faltam === 1 ? " dia" : " dias") : faltam === 0 ? "É hoje" : "Prova realizada"}</div>
    <div class="muted">Até a prova — domingo, 06/12/2026 · 40 Específicas + 10 Português + 10 Matemática</div>
    ${barra(100 * (1 - Math.max(0, faltam) / 26))}
  </section>
  <section class="card">
    <div class="row between"><h2>Hoje · ${fmtData(t)}</h2>${dc ? chip(dc.tipo === "simulado" ? "Simulado" : dc.tipo === "prova" ? "Prova" : dc.tipo === "descanso" ? "Leve" : "Estudo", dc.tipo) : ""}</div>
    ${dc ? `<p class="plan"><b>Específicas:</b> ${esc(dc.esp)}</p><p class="plan"><b>Português:</b> ${esc(dc.por)} · <b>Matemática:</b> ${esc(dc.mat)}</p>` : `<p class="muted">Fora do período do calendário.</p>`}
    <div class="row between small"><span>Meta de questões: <b>${feitas} / ${meta}</b></span><span>${feitas >= meta && meta ? "Meta cumprida" : ""}</span></div>
    ${barra(meta ? 100 * feitas / meta : 0)}
    <div class="btns">
      <button class="btn primary" onclick="iniciarCafe()">Café de 10 min</button>
      ${dc && (dc.ass.length || dc.pass.length || dc.mass.length) ? `<button class="btn" onclick="praticarDia('${dc.d}')">Praticar o tema do dia</button>` : ""}
    </div>
  </section>
  <section class="grid2">
    <div class="card stat"><div class="muted small">Questões resolvidas</div><div class="num">${g.n}</div></div>
    <div class="card stat"><div class="muted small">Acerto geral</div><div class="num">${g.p === null ? "—" : g.p + "%"}</div></div>
    <div class="card stat"><div class="muted small">Sequência de dias</div><div class="num">${sequencia()}</div></div>
    <div class="card stat"><div class="muted small">Calendário cumprido</div><div class="num">${prog}%</div></div>
  </section>
  <section class="card">
    <h2>Desempenho por disciplina</h2>
    <p class="muted small">Alvo: 70% em Específicas (28 de 40) e 60% em Português e em Matemática (6 de 10).</p>
    ${[["Específicas", e, 70, "var(--esp)"], ["Português", p, 60, "var(--por)"], ["Matemática", m, 60, "var(--mat)"]].map(([n, s, alvo, cor]) => `
      <div class="row between small"><span>${n}</span><span>${s.p === null ? "sem questões ainda" : s.p + "% de " + s.n + (s.p >= alvo ? " · no alvo" : " · alvo " + alvo + "%")}</span></div>${barra(s.p, cor)}`).join("")}
  </section>
  <section class="card">
    <h2>Últimos 7 dias</h2>
    <div class="spark">${ult7.map(d => `<div class="sb"><span style="height:${Math.round(100 * (S.days[d] || 0) / max7)}%" class="${(S.days[d] || 0) >= meta ? "full" : ""}"></span><small>${d.slice(8)}</small></div>`).join("")}</div>
    <p class="muted small">Barras escuras = dias em que a meta foi cumprida.</p>
  </section>
  <section class="grid2">
    <div class="card"><h3>Dominados</h3>${dom.length ? dom.map(a => chip(nome(a), "ok")).join(" ") : `<p class="muted small">Ainda nenhum. Um assunto entra aqui com pelo menos 4 respostas, 80% de acerto e acertos em 2 dias diferentes.</p>`}</div>
    <div class="card"><h3>Precisam de revisão</h3>${rev.length ? rev.map(a => `<button class="chip warn" onclick="praticarAssuntos(['${a}'])">${esc(nome(a))}</button>`).join(" ") : `<p class="muted small">Nada pendente.</p>`}</div>
  </section>
  ${revisoesDevidas().length ? `<section class="card"><h3>Revisões espaçadas de hoje</h3>${revisoesDevidas().map(r => `<div class="row between rv"><span>${esc(nome(r.a))} · revisão de ${r.k} dia${r.k > 1 ? "s" : ""}</span><span><button class="btn sm" onclick="praticarAssuntos(['${r.a}'],'${r.a}',${r.k})">Revisar</button></span></div>`).join("")}</section>` : ""}
  <p class="muted small center" id="sync">${esc(syncMsg)}</p>`;
};

/* ---------- Questões: filtros ---------- */
let filtro = { disc: "esp", ass: "", tipo: "", dif: "", modo: "aleatorio", qtd: 10 };
R.questoes = () => {
  const disp = disponiveis();
  const asses = [...new Set(BANK.filter(q => !filtro.disc || q.disc === filtro.disc).map(q => q.ass))];
  const lista = filtrar();
  const bloq = BANK.filter(bloqueada).length;
  return `
  <section class="card">
    <h2>Banco de questões</h2>
    <p class="muted small">${BANK.length} questões: ${BANK.filter(q => !q.simulada).length} originais das provas (gabarito oficial conferido) e ${BANK.filter(q => q.simulada).length} simuladas para itens do edital que nunca caíram.${bloq ? ` ${bloq} estão guardadas para os simulados do calendário e liberam sozinhas na data.` : ""}</p>
    <label>Disciplina<select onchange="filtro.disc=this.value;filtro.ass='';render()">
      <option value="">Todas</option>${Object.entries(DISC).map(([k, v]) => `<option value="${k}" ${filtro.disc === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
    <label>Assunto<select onchange="filtro.ass=this.value;render()"><option value="">Todos</option>${asses.map(a => `<option value="${a}" ${filtro.ass === a ? "selected" : ""}>${esc(nome(a))} (${BANK.filter(q => q.ass === a).length})</option>`).join("")}</select></label>
    <div class="grid2">
      <label>Tipo<select onchange="filtro.tipo=this.value;render()"><option value="">Todos</option><option value="conceito" ${filtro.tipo === "conceito" ? "selected" : ""}>Conceito</option><option value="calculo" ${filtro.tipo === "calculo" ? "selected" : ""}>Cálculo</option><option value="afirmativas" ${filtro.tipo === "afirmativas" ? "selected" : ""}>Afirmativas</option></select></label>
      <label>Dificuldade<select onchange="filtro.dif=this.value;render()"><option value="">Todas</option><option value="1" ${filtro.dif === "1" ? "selected" : ""}>Fácil</option><option value="2" ${filtro.dif === "2" ? "selected" : ""}>Média</option><option value="3" ${filtro.dif === "3" ? "selected" : ""}>Difícil</option></select></label>
    </div>
    <div class="seg">${[["aleatorio", "Aleatórias"], ["ordem", "Na ordem"], ["erradas", "Só erradas"], ["novas", "Não respondidas"]].map(([k, v]) => `<button class="${filtro.modo === k ? "on" : ""}" onclick="filtro.modo='${k}';render()">${v}</button>`).join("")}</div>
    <label>Quantidade<select onchange="filtro.qtd=+this.value;render()">${[5, 10, 20, 40].map(n => `<option ${filtro.qtd === n ? "selected" : ""}>${n}</option>`).join("")}<option value="999" ${filtro.qtd === 999 ? "selected" : ""}>Todas</option></select></label>
    <label class="check"><input type="checkbox" ${S.settings.leitura ? "checked" : ""} onchange="S.settings.leitura=this.checked;salvar()"> Antes de responder, identificar o que a banca está cobrando</label>
    <button class="btn primary full" ${lista.length ? "" : "disabled"} onclick="iniciarTreino(filtrar())">Começar · ${Math.min(lista.length, filtro.qtd)} questões</button>
    ${lista.length ? "" : `<p class="muted small">Nenhuma questão com esses filtros${filtro.modo === "erradas" ? " (você ainda não errou nenhuma)" : ""}.</p>`}
  </section>
  <section class="card"><h3>Questões neste filtro</h3>
  ${lista.slice(0, 60).map(q => { const a = S.ans[q.id]; return `<div class="qrow"><span class="tag ${q.simulada ? "sim" : ""}">${esc(q.simulada ? "Simulada" : q.orig)}</span><span class="grow">${esc(q.sub)}</span>${a ? chip(a.ult.ok ? "acertou" : "errou", a.ult.ok ? "ok" : "bad") : ""}</div>`; }).join("") || `<p class="muted small">—</p>`}
  </section>`;
};
function filtrar() {
  let l = disponiveis().filter(q => (!filtro.disc || q.disc === filtro.disc) && (!filtro.ass || q.ass === filtro.ass) && (!filtro.tipo || q.tipo === filtro.tipo) && (!filtro.dif || String(q.dif) === filtro.dif));
  if (filtro.modo === "erradas") { const e = new Set(erradasIds()); l = l.filter(q => e.has(q.id)); }
  if (filtro.modo === "novas") l = l.filter(q => !S.ans[q.id]);
  if (filtro.modo !== "ordem") l = embaralhar(l);
  return l.slice(0, filtro.qtd);
}
function embaralhar(a) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function praticarAssuntos(lista, revA, revK) {
  const l = embaralhar(disponiveis().filter(q => lista.includes(q.ass))).slice(0, 10);
  if (!l.length) { aviso("Ainda não há questões liberadas desse assunto no banco. Use as provas em PDF."); return; }
  iniciarTreino(l, { revA, revK });
}
function praticarDia(d) { const c = diaCal(d); praticarAssuntos([...c.ass, ...c.pass, ...c.mass]); }

/* ---------- Sessão de treino (feedback a cada questão) ---------- */
function iniciarTreino(lista, extra = {}) {
  quiz = { modo: "treino", lista: lista.map(q => q.id), i: 0, resp: {}, leitura: {}, fase: S.settings.leitura ? "leitura" : "resposta", acertos: 0, ...extra };
  ir("quiz");
}
function iniciarCafe() {
  const disp = disponiveis(), dc = diaCal(hoje());
  const errs = embaralhar(erradasIds().map(id => byId[id]).filter(q => q && !bloqueada(q))).slice(0, 4);
  const revs = revisoesDevidas().map(r => r.a);
  const tema = dc ? [...dc.ass, ...dc.pass, ...dc.mass] : [];
  const pick = (f, n) => embaralhar(disp.filter(f)).slice(0, n);
  const ids = new Set(errs.map(q => q.id)); const out = [...errs];
  for (const q of [...pick(q => revs.includes(q.ass), 4), ...pick(q => tema.includes(q.ass), 6), ...pick(q => !S.ans[q.id], 10), ...embaralhar(disp)]) {
    if (out.length >= 20) break; if (!ids.has(q.id)) { ids.add(q.id); out.push(q); }
  }
  quiz = { modo: "cafe", lista: out.map(q => q.id), i: 0, resp: {}, leitura: {}, fase: "leitura", acertos: 0, fim: Date.now() + 10 * 60 * 1000, leituraOk: 0 };
  ir("quiz");
}

/* ---------- Simulado (sem gabarito até o fim) ---------- */
R.simulado = () => `
  <section class="card">
    <h2>Simulados</h2>
    <p class="muted small">No simulado, o gabarito só aparece quando você finalizar. Use a navegação para voltar e marque as questões para revisar.</p>
    <div class="opt"><b>Rápido · 20 questões, 30 min</b><span class="muted small">12 Específicas, 4 Português, 4 Matemática</span><button class="btn primary" onclick="iniciarSimulado('rapido')">Começar</button></div>
    <div class="opt"><b>Completo · todas as liberadas, 4 min por questão</b><span class="muted small">Até 40 Específicas, 10 Português e 10 Matemática, como na prova</span><button class="btn" onclick="iniciarSimulado('completo')">Começar</button></div>
    <div class="opt"><b>Só erradas · retenção</b><span class="muted small">As questões cuja última resposta foi errada, misturadas (Simulado 3 do calendário)</span><button class="btn" onclick="iniciarSimulado('erradas')">Começar</button></div>
    <p class="muted small">Os simulados 1 e 2 do calendário (14/11 e 22/11) são as provas completas da Petrobras 2018 e da Transpetro 2023 em PDF, feitas no papel em 4 horas.</p>
  </section>
  ${S.sims.length ? `<section class="card"><h3>Histórico</h3>${S.sims.slice().reverse().map(s => `<div class="row between small rv"><span>${fmtData(s.d)} · ${esc(s.tipo)}</span><span><b>${s.c}/${s.n}</b> · Esp ${s.por.esp ?? "—"} · Port ${s.por.por ?? "—"} · Mat ${s.por.mat ?? "—"}</span></div>`).join("")}</section>` : ""}`;
function iniciarSimulado(tipo) {
  const d = disponiveis(); let l;
  const pega = (disc, n) => embaralhar(d.filter(q => q.disc === disc && !q.simulada)).slice(0, n);
  if (tipo === "rapido") l = [...pega("esp", 12), ...pega("por", 4), ...pega("mat", 4)];
  else if (tipo === "completo") l = [...pega("esp", 40), ...pega("por", 10), ...pega("mat", 10)];
  else { const e = new Set(erradasIds()); l = embaralhar(d.filter(q => e.has(q.id))); }
  if (!l.length) { aviso(tipo === "erradas" ? "Você ainda não tem questões erradas. Ótimo sinal, ou ainda é cedo." : "Não há questões liberadas."); return; }
  const min = tipo === "rapido" ? 30 : Math.max(10, l.length * 4);
  quiz = { modo: "simulado", tipo, lista: l.map(q => q.id), i: 0, resp: {}, marc: {}, leitura: {}, fim: Date.now() + min * 60000, fase: "resposta" };
  ir("quiz");
}

/* ---------- Tela da questão ---------- */
let tick = null;
R.quiz = () => `<div id="qz"></div>`;
function montarQuiz() { clearInterval(tick); if (quiz.fim) tick = setInterval(atualizarRelogio, 1000); desenharQ(); }
function atualizarRelogio() {
  const el = $("#clock"); if (!quiz || !quiz.fim) { clearInterval(tick); return; }
  const s = Math.max(0, Math.round((quiz.fim - Date.now()) / 1000));
  if (el) el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  if (s === 0) { clearInterval(tick); if (quiz.modo === "simulado") finalizarSimulado(); else if (quiz.modo === "cafe" && !quiz.encerrado) { quiz.encerrado = true; if (quiz.fase !== "feedback") resumoSessao(); } }
}
function realce(texto, chaves) {
  let h = esc(texto).replace(/\n/g, "<br>");
  (chaves || []).forEach(k => { const e = esc(k).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); h = h.replace(new RegExp(e, "i"), m => `<mark>${m}</mark>`); });
  return h;
}
function opcoesLeitura(q) {
  // 4 opções: o assunto certo + 3 da mesma disciplina
  const pool = [...new Set(BANK.filter(x => x.disc === q.disc && x.ass !== q.ass).map(x => x.ass))];
  const ops = embaralhar([q.ass, ...embaralhar(pool).slice(0, 3)]);
  return ops;
}
function desenharQ() {
  const q = byId[quiz.lista[quiz.i]], box = $("#qz"); if (!q || !box) return;
  const n = quiz.lista.length, sim = quiz.modo === "simulado", r = quiz.resp[q.id];
  const topo = `<div class="qtop"><button class="btn sm ghost" onclick="sairQuiz()">Sair</button><span class="muted small">${quiz.modo === "cafe" ? "Café · " : sim ? "Simulado · " : ""}${quiz.i + 1} de ${n}</span>${quiz.fim ? `<span class="clock" id="clock">—</span>` : `<span></span>`}</div>
    ${barra(100 * (quiz.i + (quiz.fase === "feedback" ? 1 : 0)) / n)}`;
  const cab = `<div class="row wrap gap">${chip(DISC[q.disc], q.disc)}${q.simulada ? chip("QUESTÃO SIMULADA — ESTILO CESGRANRIO", "sim") : chip(q.orig + " · gabarito oficial", "")}${!sim && quiz.fase !== "leitura" ? chip(nome(q.ass)) : ""}</div>`;
  const mostrarChaves = quiz.fase === "feedback";
  const enun = `<div class="enun">${mostrarChaves ? realce(q.enun, q.chaves) : esc(q.enun).replace(/\n/g, "<br>")}</div>`;
  let corpo = "";
  if (quiz.fase === "leitura") {
    if (!quiz.ops || quiz.ops.id !== q.id) quiz.ops = { id: q.id, l: opcoesLeitura(q) };
    corpo = `<div class="lei"><b>Antes de responder: o que a banca está cobrando?</b><p class="muted small">Leia o comando e procure as palavras-chave. Você não precisa saber a resposta ainda.</p>
      ${quiz.ops.l.map(a => `<button class="alt" onclick="responderLeitura('${a}')">${esc(nome(a))}</button>`).join("")}
      <button class="btn sm ghost" onclick="quiz.fase='resposta';desenharQ()">Pular esta etapa</button></div>`;
  } else {
    const lido = quiz.leitura[q.id];
    const fb = quiz.fase === "feedback";
    corpo = (lido ? `<p class="small ${lido.ok ? "okt" : "badt"}">${lido.ok ? "Leitura certa: é " + esc(nome(q.ass)) + "." : "Leitura: você marcou " + esc(nome(lido.a)) + ". A banca está cobrando " + esc(nome(q.ass)) + "."}</p>` : "")
      + `<div class="alts">${q.alts.map((t, k) => { const L = "ABCDE"[k]; let cls = ""; if (fb) { if (L === q.gab) cls = "right"; else if (L === r) cls = "wrong"; } else if (L === quiz.sel || (sim && L === r)) cls = "sel";
        return `<button class="alt ${cls}" ${fb ? "disabled" : ""} onclick="selecionar('${L}')"><b>(${L})</b> ${esc(t)}</button>`; }).join("")}</div>`;
    if (!fb && !sim) corpo += `<button class="btn primary full" ${quiz.sel ? "" : "disabled"} onclick="confirmar()">Confirmar resposta</button>`;
    if (sim) corpo += `<div class="row between gap"><button class="btn" ${quiz.i ? "" : "disabled"} onclick="navSim(-1)">Anterior</button><button class="btn ${quiz.marc[q.id] ? "warnb" : ""}" onclick="quiz.marc['${q.id}']=!quiz.marc['${q.id}'];desenharQ()">${quiz.marc[q.id] ? "Marcada" : "Marcar p/ revisar"}</button><button class="btn primary" onclick="navSim(1)">${quiz.i + 1 < n ? "Próxima" : "Revisar e finalizar"}</button></div>
      <div class="navgrid">${quiz.lista.map((id, k) => `<button class="${k === quiz.i ? "cur" : ""} ${quiz.resp[id] ? "done" : ""} ${quiz.marc[id] ? "mk" : ""}" onclick="quiz.i=${k};desenharQ()">${k + 1}</button>`).join("")}</div>
      <button class="btn danger full" onclick="pedirFinalizar()">Finalizar simulado</button>`;
    if (fb) corpo += explicacao(q, r === q.gab) + `<button class="btn primary full" onclick="proxima()">${quiz.i + 1 < n && !quiz.encerrado ? "Próxima questão" : "Ver resultado"}</button>`;
  }
  box.innerHTML = `<section class="card qcard">${topo}${cab}${enun}${corpo}</section>`;
  atualizarRelogio();
}
function explicacao(q, ok) {
  const curto = quiz.modo === "cafe";
  const blocos = `<div class="exp"><h4>1. O que a banca está cobrando</h4><p>${esc(q.exp.cobra)}</p><h4>2. Como reconhecer</h4><p>${esc(q.exp.reconhecer)}</p><h4>3. Como resolver</h4><p>${esc(q.exp.resolver)}</p><h4>4. Armadilha da banca</h4><p>${esc(q.exp.armadilha)}</p></div>`;
  return `<div class="fb ${ok ? "ok" : "bad"}"><b>${ok ? "Correto." : "Errado. A resposta é (" + q.gab + ")."}</b><p class="dica">Dica para reconhecer: ${esc(q.dica)}</p></div>
    ${curto ? `<details><summary>Ver a explicação completa</summary>${blocos}</details>` : blocos}`;
}
function responderLeitura(a) { const q = byId[quiz.lista[quiz.i]]; quiz.leitura[q.id] = { a, ok: a === q.ass }; if (a === q.ass) quiz.leituraOk = (quiz.leituraOk || 0) + 1; quiz.fase = "resposta"; quiz.sel = null; desenharQ(); }
function selecionar(L) { const q = byId[quiz.lista[quiz.i]]; if (quiz.modo === "simulado") { quiz.resp[q.id] = L; desenharQ(); } else { quiz.sel = L; desenharQ(); } }
function confirmar() { const q = byId[quiz.lista[quiz.i]]; quiz.resp[q.id] = quiz.sel; if (registrar(q, quiz.sel)) quiz.acertos++; quiz.fase = "feedback"; desenharQ(); }
function proxima() {
  if (quiz.i + 1 >= quiz.lista.length || quiz.encerrado) { resumoSessao(); return; }
  quiz.i++; quiz.sel = null; quiz.fase = (quiz.modo === "cafe" || S.settings.leitura) ? "leitura" : "resposta"; desenharQ();
}
function navSim(d) { const n = quiz.lista.length; if (quiz.i + d >= n) { pedirFinalizar(); return; } quiz.i = Math.max(0, quiz.i + d); desenharQ(); }
function pedirFinalizar() {
  const sem = quiz.lista.filter(id => !quiz.resp[id]).length, mk = quiz.lista.filter(id => quiz.marc[id]).length;
  dialogo(`Finalizar o simulado?`, `${sem ? sem + " sem resposta. " : ""}${mk ? mk + " marcadas para revisar. " : ""}Na prova, erro não desconta: não deixe nenhuma em branco.`, "Finalizar", finalizarSimulado);
}
function finalizarSimulado() {
  clearInterval(tick); const res = { esp: [0, 0], por: [0, 0], mat: [0, 0] }, fracos = {};
  for (const id of quiz.lista) { const q = byId[id], L = quiz.resp[id]; res[q.disc][1]++; if (L) { const ok = registrar(q, L, true); if (ok) res[q.disc][0]++; else fracos[q.ass] = (fracos[q.ass] || 0) + 1; } else fracos[q.ass] = (fracos[q.ass] || 0) + 1; }
  const c = res.esp[0] + res.por[0] + res.mat[0], n = quiz.lista.length;
  const pct = k => res[k][1] ? Math.round(100 * res[k][0] / res[k][1]) + "%" : null;
  S.sims.push({ d: hoje(), tipo: { rapido: "Rápido", completo: "Completo", erradas: "Só erradas" }[quiz.tipo], c, n, por: { esp: pct("esp"), por: pct("por"), mat: pct("mat") } }); salvar();
  quiz.fase = "resultado"; quiz.res = { res, fracos, c, n };
  const box = $("#qz");
  box.innerHTML = `<section class="card"><h2>Resultado do simulado</h2><div class="big">${c} / ${n}</div>
    ${["esp", "por", "mat"].filter(k => res[k][1]).map(k => `<div class="row between small"><span>${DISC[k]}</span><span>${res[k][0]} de ${res[k][1]} · ${pct(k)}</span></div>${barra(100 * res[k][0] / res[k][1], "var(--" + k + ")")}`).join("")}
    <h3>Assuntos que mais precisam de atenção</h3>${Object.entries(fracos).sort((a, b) => b[1] - a[1]).map(([a, k]) => `<button class="chip warn" onclick="praticarAssuntos(['${a}'])">${esc(nome(a))} · ${k}</button>`).join(" ") || `<p class="muted small">Nenhum erro.</p>`}
    <h3>Gabarito comentado</h3>${quiz.lista.map((id, k) => { const q = byId[id], L = quiz.resp[id], ok = L === q.gab; return `<details class="rev"><summary><span class="${ok ? "okt" : "badt"}">${k + 1}. ${ok ? "Certa" : L ? "Errada" : "Em branco"}</span> · ${esc(q.orig)} · ${esc(nome(q.ass))}</summary><div class="enun">${esc(q.enun).replace(/\n/g, "<br>")}</div><p class="small">Sua resposta: <b>${L || "—"}</b> · Correta: <b>${q.gab}</b> — ${esc(q.alts["ABCDE".indexOf(q.gab)])}</p>${explicacaoPura(q)}</details>`; }).join("")}
    <button class="btn primary full" onclick="quiz=null;ir('simulado')">Voltar aos simulados</button></section>`;
}
function explicacaoPura(q) { return `<div class="exp"><h4>O que cobra</h4><p>${esc(q.exp.cobra)}</p><h4>Como reconhecer</h4><p>${esc(q.exp.reconhecer)}</p><h4>Como resolver</h4><p>${esc(q.exp.resolver)}</p><h4>Armadilha</h4><p>${esc(q.exp.armadilha)}</p></div>`; }
function resumoSessao() {
  clearInterval(tick); const feitas = Object.keys(quiz.resp).length, box = $("#qz"); if (!box) return;
  if (quiz.revA) marcarRevisao(quiz.revA, quiz.revK);
  const lidas = Object.keys(quiz.leitura).length;
  box.innerHTML = `<section class="card"><h2>${quiz.modo === "cafe" ? "Café concluído" : "Sessão concluída"}</h2>
    <div class="big">${quiz.acertos} / ${feitas}</div><p class="muted">acertos nas questões respondidas${quiz.encerrado ? " (os 10 minutos acabaram)" : ""}.</p>
    ${lidas ? `<p>Leitura da banca: identificou o assunto em <b>${quiz.leituraOk || 0} de ${lidas}</b>. É essa habilidade que faz você reconhecer a questão com outra roupa.</p>` : ""}
    ${feitas - quiz.acertos ? `<p class="small">As ${feitas - quiz.acertos} erradas foram para o Caderno de erros e voltam no próximo Café.</p>` : ""}
    <div class="btns"><button class="btn primary" onclick="quiz=null;ir('inicio')">Início</button><button class="btn" onclick="quiz=null;ir('erros')">Caderno de erros</button></div></section>`;
}
function sairQuiz() { if (quiz && quiz.modo === "simulado" && quiz.fase !== "resultado") { dialogo("Sair do simulado?", "As respostas deste simulado não serão salvas.", "Sair", () => { clearInterval(tick); quiz = null; ir("simulado"); }); return; } if (quiz && quiz.modo !== "simulado" && Object.keys(quiz.resp).length && quiz.fase !== "resultado") { resumoSessao(); return; } clearInterval(tick); quiz = null; ir("inicio"); }

/* ---------- Calendário ---------- */
function tarefasDia(c) {
  if (c.tipo === "prova") return [];
  const t = [["esp", "Específicas: " + c.esp]];
  if (c.por !== "—") t.push(["por", "Português: " + c.por]);
  if (c.mat !== "—") t.push(["mat", "Matemática: " + c.mat]);
  if (c.tipo === "estudo") t.push(["rev", "10 min de revisão sem consulta (ontem e 7 dias atrás)"]);
  return t;
}
R.calendario = () => {
  const t = hoje();
  return `<section class="card"><h2>Calendário · 11/11 a 06/12</h2><p class="muted small">Tempo de estudo: 65% Específicas, 20% Português e 15% Matemática. As revisões espaçadas (1, 3 e 7 dias depois do primeiro estudo de um assunto) aparecem no dia em que vencem.</p></section>
  ${CAL.map(c => {
    const tasks = tarefasDia(c), st = S.cal[c.d] || {}, feitas = tasks.filter(([k]) => st[k]).length;
    const revs = Object.entries(S.topics).flatMap(([a, i]) => [1, 3, 7].filter(k => addDias(i.first, k) === c.d).map(k => ({ a, k, done: (i.rev || {})[k] })));
    const q = S.days[c.d] || 0;
    return `<section class="card day ${c.d === t ? "today" : ""} ${c.d < t ? "past" : ""} ${c.tipo}" id="d${c.d}">
      <div class="row between"><b>${fmtData(c.d)}${c.d === t ? " · hoje" : ""}</b><span class="small muted">${tasks.length ? feitas + "/" + tasks.length + " feitas" : ""}${c.meta ? " · " + q + "/" + c.meta + " questões" : ""}</span></div>
      ${c.tipo === "prova" ? `<p><b>${esc(c.esp)}</b></p>` : tasks.map(([k, txt]) => `<label class="check"><input type="checkbox" ${st[k] ? "checked" : ""} onchange="marcarTarefa('${c.d}','${k}',this.checked)"> ${esc(txt)}</label>`).join("")}
      ${revs.length ? `<div class="revs">${revs.map(r => `<span class="chip ${r.done ? "ok" : "warn"}">Revisar ${esc(nome(r.a))} (${r.k}d)${r.done ? " ✓" : ""}</span>`).join(" ")}</div>` : ""}
      ${(c.ass.length || c.pass.length || c.mass.length) ? `<button class="btn sm" onclick="praticarDia('${c.d}')">Praticar questões do dia</button>` : ""}
    </section>`;
  }).join("")}`;
};
function marcarTarefa(d, k, v) { (S.cal[d] = S.cal[d] || {})[k] = v; salvar(); }

/* ---------- Mais ---------- */
R.mais = () => `<section class="card"><h2>Mais</h2>
  ${[["formulas", "Caderno de fórmulas", FORMULAS.length + " fórmulas com exemplo e erros comuns"], ["erros", "Caderno de erros", erradasIds().length + " questões para refazer"], ["simulado", "Simulados", "Cronometrados, com gabarito no fim"], ["analise", "Análise das provas", "275 questões de 5 provas classificadas"], ["banca", "Como a banca pergunta", "Comandos da Cesgranrio e como ler cada um"], ["backup", "Backup e configurações", "Exportar, importar e liberar provas"]].map(([v, t, s]) => `<a class="menu" href="#${v}"><b>${t}</b><span class="muted small">${s}</span></a>`).join("")}
  </section>`;

/* ---------- Fórmulas ---------- */
let fDisc = "esp";
R.formulas = () => `<section class="card"><h2>Caderno de fórmulas</h2>
  <div class="seg">${[["esp", "Específicas"], ["mat", "Matemática"]].map(([k, v]) => `<button class="${fDisc === k ? "on" : ""}" onclick="fDisc='${k}';render()">${v}</button>`).join("")}</div></section>
  ${[...new Set(FORMULAS.filter(f => f.disc === fDisc).map(f => f.grupo))].map(g => `<h3 class="sec">${esc(g)}</h3>${FORMULAS.filter(f => f.disc === fDisc && f.grupo === g).map(f => `
    <details class="card fcard"><summary><b>${esc(f.nome)}</b><code>${esc(f.f)}</code></summary>
      <dl><dt>Variáveis</dt><dd>${esc(f.vars)}</dd><dt>Unidade</dt><dd>${esc(f.un)}</dd><dt>Quando usar</dt><dd>${esc(f.quando)}</dd><dt>Exemplo resolvido</dt><dd>${esc(f.ex)}</dd><dt>Erros comuns</dt><dd>${esc(f.erros)}</dd><dt>Atalho</dt><dd>${esc(f.atalho)}</dd><dt>Onde caiu</dt><dd>${esc(f.onde)}</dd></dl>
    </details>`).join("")}`).join("")}`;

/* ---------- Caderno de erros ---------- */
R.erros = () => {
  const grupos = {}; S.errs.forEach(e => { const g = grupos[e.id] || (grupos[e.id] = { n: 0, ult: e }); g.n++; g.ult = e; });
  const ids = Object.keys(grupos).filter(id => byId[id]).sort((a, b) => grupos[b].ult.d.localeCompare(grupos[a].ult.d));
  const porAss = {}; ids.forEach(id => { const a = byId[id].ass; porAss[a] = (porAss[a] || 0) + grupos[id].n; });
  const ab = erradasIds();
  return `<section class="card"><h2>Caderno de erros</h2>
    <p class="muted small">Toda resposta errada entra aqui sozinha. Uma questão sai da lista de "refazer" quando você acerta na próxima tentativa, mas o histórico fica.</p>
    <button class="btn primary full" ${ab.length ? "" : "disabled"} onclick="iniciarTreino(embaralhar(erradasIds().map(i=>byId[i])))">Refazer as ${ab.length} erradas</button></section>
    ${Object.keys(porAss).length ? `<section class="card"><h3>Assuntos com mais erros</h3>${Object.entries(porAss).sort((a, b) => b[1] - a[1]).map(([a, n]) => `<div class="row between small rv"><span>${esc(nome(a))}</span><span><b>${n}</b> erro${n > 1 ? "s" : ""} <button class="btn sm" onclick="praticarAssuntos(['${a}'])">Treinar</button></span></div>`).join("")}</section>` : ""}
    ${ids.map(id => { const q = byId[id], g = grupos[id], ok = S.ans[id] && S.ans[id].ult.ok; return `<details class="card"><summary><span class="tag">${esc(q.orig)}</span> ${esc(nome(q.ass))} · errou ${g.n}x · ${fmtData(g.ult.d)} ${ok ? chip("já acertou depois", "ok") : ""}</summary>
      <p class="small muted">${DISC[q.disc]} · ${esc(q.sub)}</p><div class="enun">${esc(q.enun).replace(/\n/g, "<br>")}</div>
      <p class="small">Você marcou <b>(${g.ult.ch})</b> ${esc(q.alts["ABCDE".indexOf(g.ult.ch)] || "")}</p><p class="small okt">Correta <b>(${q.gab})</b> ${esc(q.alts["ABCDE".indexOf(q.gab)])}</p>${explicacaoPura(q)}</details>`; }).join("") || `<section class="card"><p class="muted">Nenhum erro registrado ainda.</p></section>`}`;
};

/* ---------- Análise das provas ---------- */
let aF = { disc: "esp", ass: "", classe: "", tipo: "", rep: "" };
R.analise = () => {
  const rows = PROVAS_ROWS.filter(r => (!aF.disc || r[2] === aF.disc) && (!aF.ass || r[3] === aF.ass) && (!aF.classe || (ASSUNTO_CLASSE[r[3]] || [])[0] === aF.classe) && (!aF.tipo || r[5] === aF.tipo) && (!aF.rep || r[7] >= 2));
  const asses = Object.keys(ASSUNTO_CLASSE).filter(a => PROVAS_ROWS.some(r => r[3] === a && (!aF.disc || r[2] === aF.disc)));
  const resumo = {}; rows.forEach(r => resumo[r[3]] = (resumo[r[3]] || 0) + 1);
  return `<section class="card"><h2>Análise das provas</h2>
    <p class="muted small">275 questões classificadas: Transpetro 2008 (15 específicas), Petrobras 2011, 2012 e 2018 e Transpetro 2023. Classes: A = caiu nas 5 provas; B = em 4; C = em 3; D = em 2; E = em 1. Frequência passada não garante cobrança em 2026.</p>
    <div class="grid2">
      <label>Disciplina<select onchange="aF.disc=this.value;aF.ass='';render()"><option value="">Todas</option>${Object.entries(DISC).map(([k, v]) => `<option value="${k}" ${aF.disc === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label>Assunto<select onchange="aF.ass=this.value;render()"><option value="">Todos</option>${asses.map(a => `<option value="${a}" ${aF.ass === a ? "selected" : ""}>${esc(nome(a))}</option>`).join("")}</select></label>
      <label>Recorrência<select onchange="aF.classe=this.value;render()"><option value="">Todas</option>${["A", "B", "C", "D", "E"].map(c => `<option ${aF.classe === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
      <label>Tipo<select onchange="aF.tipo=this.value;render()"><option value="">Todos</option>${["conceito", "calculo", "figura", "afirmativas"].map(c => `<option value="${c}" ${aF.tipo === c ? "selected" : ""}>${c === "calculo" ? "cálculo" : c}</option>`).join("")}</select></label>
    </div>
    <label class="check"><input type="checkbox" ${aF.rep ? "checked" : ""} onchange="aF.rep=this.checked?'1':'';render()"> Só Específicas que se repetem em 2 ou mais provas</label>
    <p class="small"><b>${rows.length}</b> questões no filtro.</p></section>
    <section class="card"><h3>Por assunto</h3>${Object.entries(resumo).sort((a, b) => b[1] - a[1]).map(([a, n]) => { const c = ASSUNTO_CLASSE[a] || []; return `<div class="row between small rv"><span>${esc(nome(a))} ${c[0] ? chip("classe " + c[0]) : ""}</span><span>${n} · em ${c[1] || "?"} de 5 provas</span></div>`; }).join("")}</section>
    <section class="card"><h3>Questões</h3><div class="tbl">${rows.slice(0, 200).map(r => { const id = r[0] + "-" + String(r[1]).padStart(2, "0"); const tem = byId[id] && !bloqueada(byId[id]); return `<div class="trow"><span class="tag">${r[0]} Q${r[1]}</span><span class="grow"><b>${esc(nome(r[3]))}</b> · ${esc(r[4])}${r[8] && r[8] !== "—" ? `<br><span class="muted small">Pegadinha: ${esc(r[8])}</span>` : ""}</span><span class="small">${r[5] === "calculo" ? "cálculo" : esc(r[5])}<br>gab. ${r[6]}${r[7] >= 2 ? "<br>repete " + r[7] + " provas" : ""}</span>${tem ? `<button class="btn sm" onclick="iniciarTreino([byId['${id}']])">Resolver</button>` : ""}</div>`; }).join("")}${rows.length > 200 ? `<p class="muted small">Mostrando 200 de ${rows.length}. Use os filtros.</p>` : ""}</div></section>`;
};

/* ---------- Como a banca pergunta ---------- */
R.banca = () => `<section class="card"><h2>Como a banca pergunta</h2><p class="muted small">Padrões dos comandos que se repetem nas provas da Cesgranrio analisadas. Treine com o Café: a etapa "o que a banca está cobrando" exercita exatamente isso.</p></section>
  ${BANCA.map(b => `<section class="card"><h3>${esc(b.t)}</h3><p>${esc(b.o)}</p><p class="muted small">Exemplo real: ${esc(b.ex)}</p></section>`).join("")}`;

/* ---------- Backup ---------- */
let downloadsApi = null;
R.backup = () => `<section class="card"><h2>Backup e configurações</h2>
  <p class="small" id="sync">${esc(syncMsg)}</p>
  <h3>Exportar progresso</h3><p class="muted small">Gera um arquivo (ou um texto) com todas as respostas, erros, calendário e simulados.</p>
  <div class="btns">${downloadsApi ? `<button class="btn" onclick="exportarArquivo()">Baixar arquivo .json</button>` : ""}<button class="btn" onclick="exportarTexto()">Mostrar texto para copiar</button></div>
  <textarea id="exp" class="hide" readonly></textarea><button id="cpy" class="btn sm hide" onclick="copiar()">Copiar</button>
  <h3>Importar progresso</h3><input type="file" accept=".json,application/json" onchange="importarArquivo(this.files[0])"><p class="muted small">Ou cole o texto exportado:</p><textarea id="imp" placeholder="Cole aqui o texto exportado"></textarea><button class="btn" onclick="importarTexto()">Importar texto</button>
  <h3>Provas guardadas para os simulados</h3><p class="muted small">As questões da Petrobras 2018 liberam em 14/11 e as da Transpetro 2023 em 22/11, depois dos simulados no papel. Libere antes só se já fez ou desistiu desses simulados.</p>
  <label class="check"><input type="checkbox" ${S.settings.unlock ? "checked" : ""} onchange="S.settings.unlock=this.checked;salvar()"> Liberar todas as questões agora</label>
  <h3>Apagar tudo</h3><button class="btn danger" onclick="dialogo('Apagar todo o progresso?','Respostas, erros, calendário e simulados serão apagados deste aparelho e da sua conta. Exporte antes se quiser guardar.','Apagar',()=>{S=novoEstado();salvar();ir('inicio')})">Apagar progresso</button>
  </section>`;
function exportarTexto() { const t = $("#exp"); t.value = JSON.stringify(S); t.classList.remove("hide"); $("#cpy").classList.remove("hide"); t.select(); }
async function copiar() { try { await navigator.clipboard.writeText($("#exp").value); aviso("Copiado."); } catch (e) { $("#exp").select(); aviso("Selecione o texto e copie manualmente."); } }
async function exportarArquivo() { try { await downloadsApi.save({ filename: "progresso-instrumentacao-" + hoje() + ".json", data: JSON.stringify(S, null, 1) }); } catch (e) { aviso("O download não foi concluído. Use 'Mostrar texto para copiar'."); } }
function importar(txt) { try { const o = JSON.parse(txt); if (!o || o.v !== 1 || !o.ans) throw 0; S = Object.assign(novoEstado(), o); salvar(); aviso("Progresso importado."); ir("inicio"); } catch (e) { aviso("Esse texto não é um backup válido deste app."); } }
function importarTexto() { importar($("#imp").value.trim()); }
function importarArquivo(f) { if (!f) return; const r = new FileReader(); r.onload = () => importar(r.result); r.readAsText(f); }

/* ---------- avisos e diálogos dentro da página ---------- */
function aviso(t) { const el = $("#toast"); el.textContent = t; el.classList.add("show"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 3200); }
function dialogo(tit, txt, ok, fn) {
  const d = $("#dlg"); d.innerHTML = `<div class="dbox"><h3>${esc(tit)}</h3><p>${esc(txt)}</p><div class="btns"><button class="btn" id="dno">Cancelar</button><button class="btn primary" id="dok">${esc(ok)}</button></div></div>`;
  d.classList.add("show"); $("#dno").onclick = () => d.classList.remove("show"); $("#dok").onclick = () => { d.classList.remove("show"); fn(); };
}

/* ---------- início ---------- */
carregarLocal(); render(); conectarConta();
(async () => { try { if (window.claude && claude.use) { downloadsApi = await claude.use("downloads"); if (rota() === "backup") render(); } } catch (e) {} })();

/* ---------- Café: tela de entrada (quando aberto pelo link #cafe) ---------- */
R.cafe = () => `<section class="card"><h2>Café de 10 minutos</h2>
  <p>Uma rodada rápida para a hora do café: até 20 questões em 10 minutos.</p>
  <ol class="small"><li>Primeiro voltam as questões que você errou.</li><li>Depois, os assuntos com revisão vencendo (1, 3 e 7 dias).</li><li>Depois, o tema do dia no calendário e questões que você ainda não respondeu.</li></ol>
  <p class="small">Em cada questão, antes de responder, você diz <b>o que a banca está cobrando</b>. É o treino de leitura do enunciado.</p>
  <button class="btn primary full" onclick="iniciarCafe()">Começar agora</button></section>`;
