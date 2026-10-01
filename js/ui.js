// Tudo ao redor do terminal: cabeçalho, núcleo + satélites, rail cognitivo (esquerda),
// rail de contexto (direita) e rodapé. Regra: só dados reais; sem dado → NA, mas o campo fica.

import { esc, pad, dayKey, hhmm, ddmm, dur, DOW, VERSION } from './util.js';
import { createCore } from './core.js';
import { describe } from './weather.js';
import { PHASES } from './commands.js';
import { taskStats, groupTasks, projectOf } from './tasks.js';
import { fmtDue } from './dates.js';
import { deriveState, describeState, readIntent, LISTEN_MS, FAULT_MS } from './state.js';

const MODULES = [
  { name: 'inbox', phase: '0' },
  { name: 'tarefas', phase: '1' },
  { name: 'ia intérprete', phase: '2' },
  { name: 'finanças', phase: '3' },
  { name: 'corpo e hábitos', phase: '4' },
  { name: 'dashboards', phase: '5' },
  { name: 'coach', phase: '6' },
];
const LEVEL_TONE = { OK: 'c-act', INF: 'c-meta', WRN: 'c-warn', ERR: 'c-err', AI: 'c-int' };

export function createUI(ctx) {
  const { S } = ctx;
  const $ = s => document.getElementById(s);
  const app = $('app');

  $('h-ver').textContent = 'v' + VERSION;

  /* ---------- núcleo ---------- */
  const satEls = Object.fromEntries([...document.querySelectorAll('.sat')].map(el => [el.dataset.sat, el]));
  const core = createCore($('core'), satEls);

  /* ---------- painéis escondíveis (lembra a escolha neste aparelho) ---------- */
  const LAYOUT_KEY = 'mb.layout.v1';
  let layout = { tele: true, focus: false };
  try { layout = { ...layout, ...JSON.parse(localStorage.getItem(LAYOUT_KEY)) }; } catch {}
  const applyLayout = () => {
    app.classList.toggle('no-tele', !layout.tele);
    app.classList.toggle('focus', layout.focus);
  };
  applyLayout();

  function toggle(what) {
    if (what === 'focus') layout.focus = !layout.focus;
    else { layout.tele = !layout.tele; layout.focus = false; }
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch {}
    applyLayout();
    return what === 'focus' ? layout.focus : layout.tele;
  }
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === '.') { e.preventDefault(); toggle('tele'); }
  });

  // celular: com o teclado aberto, o app encolhe pra área visível
  const vv = window.visualViewport;
  if (vv) {
    let lastH = vv.height;
    const fit = () => {
      if (Math.abs(vv.scale - 1) > 0.01) return;
      document.documentElement.style.setProperty('--app-h', vv.height + 'px');
      window.scrollTo(0, 0);
      const out = $('out');
      if (out && vv.height < lastH - 80) out.scrollTop = out.scrollHeight;
      lastH = vv.height;
    };
    vv.addEventListener('resize', fit);
    fit();
  }

  /* ---------- sinais vindos do terminal ---------- */
  let lastKey = 0, faultUntil = 0, ctxChangedAt = 0, inputValue = '';
  let stateKey = 'initializing', stateSince = Date.now();

  function onInput(v) { inputValue = v; render(); }
  function onKey() { lastKey = Date.now(); core.keystroke(); render(); setTimeout(render, LISTEN_MS + 50); }
  function onFault() { faultUntil = Date.now() + FAULT_MS; core.pulse('err'); render(); setTimeout(render, FAULT_MS + 50); }
  function onCtx() { ctxChangedAt = Date.now(); core.pulse('int', 1); render(); setTimeout(render, 1600); }

  /* ---------- memória e estado ---------- */

  function mem() {
    const st = ctx.store;
    if (!st) return S.locked ? ['bloqueada', 'warn'] : ['NA', 'na'];
    if (st.kind === 'local') return ['local', 'warn'];
    const p = st.pending();
    if (p) return [`fila ${p}`, 'warn'];
    if (st.status.state === 'cache') return ['sincronizando', 'na'];
    return ['nuvem', 'ok'];
  }

  function isDegraded() {
    if (S.degraded) return true;
    const st = ctx.store?.status;
    if (!st || ctx.store.kind !== 'nuvem') return false;
    return (ctx.store.pending() > 0 && navigator.onLine && !!st.lastError) || ['channel_error', 'timed_out', 'erro'].includes(st.realtime);
  }

  // Uma ação muito rápida (ex: captura local, 1ms) ainda fica visível por meio segundo:
  // o núcleo precisa mostrar que fez algo, senão a ação "some" sem resposta.
  const HOLD_MS = 550;
  let recent = null;
  function noteTasks() {
    const T = [...ctx.term.tasks.values()];
    if (T.length) {
      const last = T[T.length - 1];
      recent = { kind: last.kind, label: last.label, until: Date.now() + HOLD_MS };
      setTimeout(render, HOLD_MS + 30);
    }
    render();
  }
  // a entrada pertence à aba atual? (projeto da tarefa ou #tag)
  const inCtx = e => projectOf(e, ctx.reg().projects) === S.ctx || (e.tags || []).includes(S.ctx);

  const taskList = () => {
    const T = [...ctx.term.tasks.values()];
    return T.length ? T : recent && Date.now() < recent.until ? [recent] : [];
  };

  function state() {
    return deriveState({
      booting: S.booting, now: Date.now(), faultUntil, tasks: taskList(), lastKey,
      locked: S.locked, degraded: isDegraded(), online: navigator.onLine,
    });
  }

  /* ---------- render (agrupado: no máximo uma vez por quadro) ---------- */

  let queued = false;
  function render() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; renderNow(); });
  }

  function renderNow() {
    const now = new Date(), E = S.entries, T = taskList();
    const key = state();
    if (key !== stateKey) { stateKey = key; stateSince = Date.now(); }
    const st = describeState(key, { tasks: T, mode: S.mode });
    app.dataset.state = key;
    core.setState(key);

    // tom do estado nos lugares que mostram o estado
    for (const el of [$('h-state'), document.querySelector('.ident'), document.querySelector('.cog-state'), document.querySelector('.field-strip')]) {
      if (el) el.dataset.tone = st.tone;
    }

    renderHeader(st, now);
    renderCog(st, T);
    renderSats(E, T, key);
    renderCtx(E, now);
    renderFoot();
    $('work-meta').textContent = ({ email: 'login · e-mail', password: 'login · senha', code: 'login · código' }[S.mode] || 'captura') + ' · ~' + (S.ctx ? '/' + S.ctx : '');
    $('f-state').textContent = st.label;
    $('f-desc').textContent = st.desc;
  }

  function field(id, value, tone) {
    const el = $(id);
    el.classList.remove('is-ok', 'is-warn', 'is-err', 'is-na');
    if (tone) el.classList.add('is-' + tone);
    el.querySelector('b').textContent = value;
  }

  function renderHeader(st) {
    $('h-state').querySelector('b').textContent = st.label;
    field('h-net', navigator.onLine ? 'ON' : 'OFF', navigator.onLine ? 'ok' : 'err');
    const [memText, memTone] = mem();
    field('h-mem', memText.toUpperCase(), memTone);
    field('h-user', S.user ? (S.operator || S.user.email.split('@')[0]) : (S.locked ? '—' : 'local'), S.user ? '' : 'na');
    const wx = S.weather, wxEl = $('h-wx');
    wxEl.className = 'hf' + (wx ? '' : ' is-na');
    wxEl.querySelector('.k').textContent = wx ? describe(wx.code).icon : '◌';
    wxEl.querySelector('b').textContent = wx ? `${Math.round(wx.temp)}° ${wx.hum}%` : 'NA';
    wxEl.title = wx ? `${wx.place.name} · ${describe(wx.code).text} · ${hhmm(new Date(wx.at))}` : 'clima · /clima ativa';
  }

  // esquerda: estado cognitivo e operacional
  function renderCog(st, T) {
    $('c-state').textContent = st.label;
    $('c-desc').textContent = st.desc;
    $('c-focus').textContent = '~' + (S.ctx ? '/' + S.ctx : '');
    $('c-mode').textContent = { email: 'login · e-mail', password: 'login · senha', code: 'login · código' }[S.mode] || (S.locked ? 'bloqueado' : 'captura');

    const pending = ctx.store?.pending?.() || 0;
    const real = T.filter(t => t.id); // o "eco" de meio segundo não entra na lista
    $('c-proc-n').textContent = real.length + (pending ? ` · fila ${pending}` : '');
    const rows = real.map(t => `<li><span class="${t.kind === 'exec' ? 'c-act' : 'c-int'}">${t.id}</span><span>${esc(t.label)}</span><span class="t"><span class="proc-spin">${t.kind === 'exec' ? '▸' : '◴'}</span> <span data-t0="${t.t0}">${fmtMs(performance.now() - t.t0)}</span></span></li>`);
    if (pending) rows.push(`<li><span class="c-warn">SYNC</span><span>${pending} na fila · sobe quando der</span><span></span></li>`);
    $('c-procs').innerHTML = rows.length ? rows.join('') : '<li class="empty">— ocioso</li>';

    const L = ctx.term.log;
    $('c-ev-n').textContent = L.length;
    $('c-stream').innerHTML = L.length
      ? L.slice(-12).reverse().map(e => {
        const d = new Date(e.ts);
        return `<li><span class="t">${hhmm(d)}</span><span class="lv ${LEVEL_TONE[e.level]}">${e.level}</span><span title="${esc(e.text)}">${esc(e.text)}</span></li>`;
      }).join('')
      : '<li class="empty">— nenhum</li>';

    const nowMs = Date.now(), bins = Array(30).fill(0);
    for (const e of L) { const m = Math.floor((nowMs - e.ts) / 60000); if (m < 30) bins[29 - m]++; }
    const max = Math.max(1, ...bins);
    $('c-spark').innerHTML = bins.map(n => `<i${n ? '' : ' class="z"'} style="height:${n ? Math.max(8, n / max * 100) : 3}%"></i>`).join('');
    $('c-act').textContent = bins.reduce((a, b) => a + b, 0);
  }

  // satélites: valores reais + qual subsistema está ativo agora
  function renderSats(E, T, key) {
    const proc = T.filter(t => t.kind !== 'exec'), exec = T.filter(t => t.kind === 'exec');
    const pending = ctx.store?.pending?.() || 0;
    const ctxTasks = taskStats(S.ctx ? E.filter(e => inCtx(e)) : E);
    const [memText] = mem();
    const st = ctx.store?.status;
    const intent = readIntent(inputValue, { mode: S.mode, ctx: S.ctx, catalog: ctx.commands.catalog() });

    set('s-context', '~' + (S.ctx ? '/' + S.ctx : ''), `${ctxTasks.abertas} abertas${ctxTasks.atrasadas ? ` · ${ctxTasks.atrasadas} atrasadas` : ''}`);
    set('s-memory', memText, `${E.length} entradas`);
    set('s-network', navigator.onLine ? 'online' : 'offline',
      [st?.realtime && st.realtime !== 'NA' ? 'rt ' + st.realtime : null, S.lastLatency != null ? S.lastLatency + 'ms' : null].filter(Boolean).join(' · ') || 'NA');
    set('s-process', T.length ? T[T.length - 1].label : 'ocioso', `${T.length} ativos${pending ? ` · fila ${pending}` : ''}`);
    set('s-input', intentWord(intent), key === 'listening' ? 'escutando' : '');

    const now = Date.now();
    const listening = key === 'listening';
    core.activate('input', listening);
    core.activate('context', now - ctxChangedAt < 1500 || (listening && !!S.ctx));
    core.activate('memory', exec.length > 0 || pending > 0);
    core.activate('network', proc.length > 0);
    core.activate('process', T.length > 0);
    for (const k of Object.keys(satEls)) {
      satEls[k].classList.toggle('is-active',
        { input: listening, context: now - ctxChangedAt < 1500, memory: exec.length > 0, network: proc.length > 0, process: T.length > 0 }[k]);
    }
  }
  function set(id, main, sub) {
    $(id).textContent = main;
    $(id + '-2').textContent = sub || '';
  }
  function intentWord(i) {
    return { idle: 'aguardando', login: { email: 'usuário', password: 'senha', code: 'código' }[i.field], note: 'nota', task: 'tarefa', 'task-error': 'prazo?', commands: 'comando', command: '/' + (i.cmd?.name || ''), unknown: 'desconhecido' }[i.type] || 'aguardando';
  }

  // direita: o contexto do momento. Digitando → mostra o que o Enter vai fazer. Parado → tarefas relevantes.
  function renderCtx(E, now) {
    const intent = readIntent(inputValue, { mode: S.mode, ctx: S.ctx, catalog: ctx.commands.catalog() });
    const body = $('x-body'), line = $('intent-line');
    let title = 'contexto', sub = '~' + (S.ctx ? '/' + S.ctx : ''), html = '', short = '';

    if (intent.type === 'login') {
      title = 'acesso';
      sub = 'memória bloqueada';
      html = `<div class="empty">${{ email: 'digite o usuário (ex: vini)', password: 'digite a senha' + (S.operator ? ' do operador ' + esc(S.operator) : '') + ' · /entrar outro troca', code: 'digite o código do e-mail' }[intent.field]}</div>`;
    } else if (intent.type === 'commands') {
      title = 'comandos';
      sub = '/' + intent.query;
      html = intent.matches.map(c => `<div class="ctx-cmd"><b>/${esc(c.name)} <span>${esc(c.args || '')}</span></b><span>${esc(c.desc)}</span></div>`).join('') +
        '<div class="ctx-hint">tab completa · enter executa</div>';
      short = `→ ${intent.matches.map(c => '/' + c.name).join(' ')}`;
    } else if (intent.type === 'command') {
      title = 'comando';
      sub = '/' + intent.cmd.name;
      html = `<div class="ctx-cmd"><b>/${esc(intent.cmd.name)} <span>${esc(intent.cmd.args || '')}</span></b><span>${esc(intent.cmd.desc)}</span></div><div class="ctx-hint">enter executa</div>`;
      short = `→ /${intent.cmd.name} · ${intent.cmd.desc}`;
    } else if (intent.type === 'unknown') {
      title = 'comando';
      sub = 'desconhecido';
      html = `<div class="c-warn">/${esc(intent.query)} não existe</div>` +
        (intent.near.length ? `<div class="ctx-hint">talvez: ${intent.near.map(c => `<span class="c-int">/${esc(c.name)}</span>`).join(' ')}</div>` : '<div class="ctx-hint">/ajuda lista todos</div>');
      short = `✕ /${intent.query} não existe`;
    } else if (intent.type === 'task') {
      title = 'nova tarefa';
      sub = 'enter cria';
      html = `<dl class="ctx-intent"><dt>texto</dt><dd>${esc(intent.text.replace(/#[\p{L}\p{N}_-]+/gu, '').trim() || intent.text)}</dd>` +
        `<dt>projeto</dt><dd class="c-act">${intent.tags.length ? intent.tags.map(t => '#' + esc(t)).join(' ') : '<span class="dim">—</span>'}</dd>` +
        `<dt>prazo</dt><dd class="c-int">${intent.prazo ? esc(fmtDue(intent.prazo, now)) : '<span class="dim">sem prazo</span>'}</dd></dl>`;
      short = `→ tarefa${intent.tags.length ? ' · #' + intent.tags.join(' #') : ''}${intent.prazo ? ' · ' + fmtDue(intent.prazo, now) : ''}`;
    } else if (intent.type === 'task-error') {
      title = 'nova tarefa';
      sub = intent.error === 'prazo' ? 'prazo?' : 'vazia';
      html = intent.error === 'prazo'
        ? `<div class="c-warn">não entendi o prazo ${esc(intent.token || '')}</div><div class="ctx-hint">use >hoje >amanhã >sex >15/10 >+3</div>`
        : '<div class="empty">escreva o texto da tarefa</div>';
      short = intent.error === 'prazo' ? `✕ prazo ${intent.token} não entendido` : '';
    } else if (intent.type === 'note') {
      title = 'nova nota';
      sub = 'enter captura';
      html = `<dl class="ctx-intent"><dt>tags</dt><dd class="c-act">${intent.tags.length ? intent.tags.map(t => '#' + esc(t)).join(' ') : '<span class="dim">—</span>'}</dd>` +
        `<dt>destino</dt><dd>${esc(mem()[0])}</dd></dl><div class="ctx-hint">comece com "- " pra virar tarefa</div>`;
      short = `→ nota${intent.tags.length ? ' · #' + intent.tags.join(' #') : ''}`;
    } else {
      // parado: tarefas que importam agora (atrasadas, hoje, próximas)
      const { groups } = groupTasks(E, { proj: S.ctx, now, projects: ctx.reg().projects });
      const s = taskStats(S.ctx ? E.filter(e => inCtx(e)) : E, now);
      sub = `${S.ctx ? '#' + S.ctx : 'todas'} · ${s.abertas} abertas`;
      const relevant = groups.filter(g => g.key !== 'feitas');
      let shownN = 0;
      html = relevant.map(g => {
        const items = g.items.slice(0, Math.max(0, 7 - shownN));
        shownN += items.length;
        if (!items.length) return '';
        return `<div class="ctx-grp">${esc(g.title)}</div>` + items.map(e => {
          const due = e.data?.prazo ? fmtDue(e.data.prazo, now) : '';
          const tone = due.startsWith('atrasada') ? 'c-warn' : due === 'hoje' ? 'c-act' : 'c-meta';
          return `<div class="ctx-task"><span class="n">[ ]</span><span title="${esc(e.text)}">${esc(e.text)}</span><span class="due ${tone}">${esc(due)}</span></div>`;
        }).join('');
      }).join('');
      if (!html) html = `<div class="empty">nenhuma tarefa aberta${S.ctx ? ' aqui' : ''}</div><div class="ctx-hint">- revisar cap 2 #tcc >sex</div>`;
      else if (s.feitasHoje) html += `<div class="ctx-hint">✓ ${s.feitasHoje} feitas hoje · /tarefas numera</div>`;
    }

    $('x-title').textContent = title;
    $('x-sub').textContent = sub;
    body.innerHTML = html;
    line.textContent = short;
    line.classList.toggle('has-intent', !!short);

    // ambiente
    const wx = S.weather;
    const st = ctx.store?.status;
    $('x-env').innerHTML = [
      ['dia', `${DOW[now.getDay()]} ${ddmm(now)} · ${hhmm(now)}`],
      ['local', wx ? `${esc(wx.place.name)} · ${describe(wx.code).icon} ${Math.round(wx.temp)}°` : 'NA'],
      ['rede', navigator.onLine ? `online${S.lastLatency != null ? ' · ' + S.lastLatency + 'ms' : ''}` : '<span class="c-warn">offline</span>'],
      ['memória', `${esc(mem()[0])} · ${E.length}${st?.lastSync ? ' · ' + hhmm(new Date(st.lastSync)) : ''}`],
      ['hoje', `${E.filter(e => e.day === dayKey(now)).length} capturas`],
    ].map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('');

    // módulos
    const phaseState = Object.fromEntries(PHASES.map(([n, , s]) => [n, s]));
    $('x-mods').innerHTML = MODULES.map(m => {
      const s = phaseState[m.phase];
      const cls = s === 'ok' ? 'is-on' : s === 'wip' ? 'is-on is-wip' : '';
      const label = s === 'ok' ? 'online' : s === 'wip' ? 'beta' : 'fase ' + m.phase;
      return `<li class="${cls}"><span>${m.name}</span><span class="st">${label}</span></li>`;
    }).join('');
  }

  // rodapé: infraestrutura
  function renderFoot() {
    const sw = 'serviceWorker' in navigator && navigator.serviceWorker.controller ? ['ativo', 'ok'] : ['NA', 'na'];
    const [memText, memTone] = mem();
    const rt = ctx.store?.status?.realtime ?? 'NA';
    const f = [
      ['ENV', location.hostname || 'arquivo', ''],
      ['MEM', memText, memTone],
      ['RT', rt, rt === 'on' ? 'ok' : rt === 'NA' ? 'na' : 'warn'],
      ['NET', navigator.onLine ? 'online' : 'offline', navigator.onLine ? 'ok' : 'err'],
      ['LAT', S.lastLatency == null ? 'NA' : S.lastLatency + 'ms', S.lastLatency == null ? 'na' : ''],
      ['SESS', dur(Date.now() - S.startedAt), '', 'f-sess'],
      ['TASK', ctx.term.tasks.size, ctx.term.tasks.size ? 'ok' : ''],
      ['LOG', ctx.term.log.length, ''],
      ['SW', sw[0], sw[1]],
      ['VER', VERSION, ''],
    ];
    $('foot').innerHTML = f.map(([k, v, tone, id]) =>
      `<span class="ff${tone ? ' is-' + tone : ''}"><i>${k}</i><b${id ? ` id="${id}"` : ''}>${esc(v)}</b></span>`).join('');
  }

  const fmtMs = ms => ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(1) + 's';
  const ago = ms => ms < 60000 ? 'agora' : ms < 3600000 ? `há ${Math.floor(ms / 60000)} min` : `há ${Math.floor(ms / 3600000)} h`;

  /* ---------- a cada segundo ---------- */
  let lastMinute = -1;
  function tick() {
    const d = new Date();
    $('h-clock').textContent = `${hhmm(d)}:${pad(d.getSeconds())}`;
    $('h-date').textContent = `${DOW[d.getDay()]} ${ddmm(d)}`;
    $('c-since').textContent = ago(Date.now() - stateSince);
    const f = $('f-sess'); if (f) f.textContent = dur(Date.now() - S.startedAt);
    document.querySelectorAll('[data-t0]').forEach(el => { el.textContent = fmtMs(performance.now() - +el.dataset.t0); });
    core.setDay((d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400);
    if (state() !== stateKey) render();
    if (d.getMinutes() !== lastMinute) { lastMinute = d.getMinutes(); renderNow(); }
  }

  return { render, renderNow, tick, state, mem, toggle, pulse: core.pulse, core, onInput, onKey, onFault, onCtx, noteTasks };
}
