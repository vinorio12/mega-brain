// Painéis ao redor do terminal: cabeçalho, núcleo, telemetria e rodapé.
// Regra: só dados reais. Se não tiver o dado, mostra NA, mas o campo continua lá.

import { esc, pad, dayKey, hhmm, ddmm, dur, kb, DOW, VERSION } from './util.js';
import { createCore } from './core.js';
import { describe } from './weather.js';
import { PHASES } from './commands.js';

const MODULES = [
  { name: 'inbox', on: true, phase: '0' },
  { name: 'tarefas', phase: '1' },
  { name: 'ia intérprete', phase: '2' },
  { name: 'finanças', phase: '3' },
  { name: 'corpo e hábitos', phase: '4' },
  { name: 'dashboards', phase: '5' },
  { name: 'coach', phase: '6' },
];

export function createUI(ctx) {
  const { S } = ctx;
  const $ = s => document.getElementById(s);
  const app = $('app');
  const core = createCore($('core'), MODULES);

  $('h-ver').textContent = 'v' + VERSION;

  /* ---------- painéis escondíveis (lembra a escolha neste aparelho) ---------- */
  const LAYOUT_KEY = 'mb.layout.v1';
  let layout = { tele: true, focus: false };
  try { layout = { ...layout, ...JSON.parse(localStorage.getItem(LAYOUT_KEY)) }; } catch {}
  const applyLayout = () => {
    app.classList.toggle('no-tele', !layout.tele);
    app.classList.toggle('focus', layout.focus);
  };
  applyLayout();

  // 'tele' liga/desliga a telemetria · 'focus' deixa só o terminal. Devolve o estado novo.
  function toggle(what) {
    if (what === 'focus') layout.focus = !layout.focus;
    else { layout.tele = !layout.tele; layout.focus = false; }
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch {}
    applyLayout();
    return what === 'focus' ? layout.focus : layout.tele;
  }

  // ctrl+. alterna a telemetria
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === '.') { e.preventDefault(); toggle('tele'); }
  });

  // estado geral, em ordem de prioridade
  function state() {
    if (S.booting) return 'boot';
    if (S.locked) return 'locked';
    if (ctx.term.tasks.size) return 'busy';
    if (S.degraded) return 'degraded';
    if (!navigator.onLine) return 'offline';
    return 'ready';
  }

  // campo do cabeçalho: símbolo + valor + tom (ok / warn / err / na)
  function field(id, value, tone) {
    const el = $(id);
    el.classList.remove('is-ok', 'is-warn', 'is-err', 'is-na');
    if (tone) el.classList.add('is-' + tone);
    el.querySelector('b').textContent = value;
  }

  // situação da memória: [texto, tom]
  function mem() {
    const st = ctx.store;
    if (!st) return S.locked ? ['bloqueada', 'warn'] : ['NA', 'na'];
    if (st.kind === 'local') return ['local', 'warn'];
    const p = st.pending();
    if (p) return [`fila ${p}`, 'warn'];
    if (st.status.state === 'cache') return ['sincronizando', 'na'];
    return ['nuvem', 'ok'];
  }

  function yearInfo(d) {
    const start = new Date(d.getFullYear(), 0, 1), next = new Date(d.getFullYear() + 1, 0, 1);
    const day = Math.floor((d - start) / 864e5) + 1, total = Math.round((next - start) / 864e5);
    return { day, total, pct: day / total };
  }

  /* ---------- render completo (chamado quando algo muda) ---------- */

  // Vários eventos seguidos (ex: boot, sync) viram UM redesenho por quadro.
  let queued = false;
  function render() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; renderNow(); });
  }

  function renderNow() {
    const now = new Date(), tk = dayKey(now), E = S.entries;
    const st = state();
    app.dataset.state = st;
    core.setState(st);

    // cabeçalho
    $('h-state').querySelector('b').textContent = st.toUpperCase();
    field('h-net', navigator.onLine ? 'ON' : 'OFF', navigator.onLine ? 'ok' : 'err');
    const [memText, memTone] = mem();
    field('h-mem', memText.toUpperCase(), memTone);
    field('h-user', S.user ? S.user.email.split('@')[0] : (S.locked ? '—' : 'local'), S.user ? '' : 'na');
    const wx = S.weather;
    const wxEl = $('h-wx');
    wxEl.className = 'hf' + (wx ? '' : ' is-na');
    wxEl.querySelector('.k').textContent = wx ? describe(wx.code).icon : '◌';
    wxEl.querySelector('b').textContent = wx ? `${Math.round(wx.temp)}° ${wx.hum}%` : 'NA';
    wxEl.title = wx ? `${wx.place.name} · ${describe(wx.code).text} · ${hhmm(new Date(wx.at))}` : 'clima · /clima ativa';

    // núcleo
    const today = E.filter(e => e.day === tk).length;
    const y = yearInfo(now);
    core.update({ yearPct: y.pct, today });

    const kv = [
      ['hoje', today, today ? 'ok' : ''],
      ['memória', memText, memTone === 'na' ? '' : memTone],
      ['entradas', E.length, ''],
      ['processos', ctx.term.tasks.size, ctx.term.tasks.size ? 'hud' : ''],
      ['pendentes', 'NA', 'na'],
      ['uptime', dur(Date.now() - S.startedAt), '', 'k-up'],
    ];
    $('core-kv').innerHTML = kv.map(([k, v, tone, id]) =>
      `<dt>${k}</dt><dd${tone ? ` class="is-${tone}"` : ''}${id ? ` id="${id}"` : ''}>${esc(v)}</dd>`).join('');

    renderSpark();
    renderProcs();
    renderEvents();
    renderTele(now, tk, E, today, y);
    renderFoot();
  }

  // atividade: eventos do log por minuto, últimos 30 min
  function renderSpark() {
    const now = Date.now(), bins = Array(30).fill(0);
    for (const e of ctx.term.log) {
      const m = Math.floor((now - e.ts) / 60000);
      if (m < 30) bins[29 - m]++;
    }
    const max = Math.max(1, ...bins);
    $('spark').innerHTML = bins.map(n => `<i${n ? '' : ' class="z"'} style="height:${n ? Math.max(8, n / max * 100) : 3}%"></i>`).join('');
    $('act-sum').textContent = bins.reduce((a, b) => a + b, 0);
  }

  function renderProcs() {
    const T = [...ctx.term.tasks.values()];
    $('proc-n').textContent = T.length;
    $('procs').innerHTML = T.length
      ? T.map(t => `<li><span class="c-hud">${t.id}</span><span>${esc(t.label)}</span><span class="t"><span class="proc-spin">◴</span> <span data-t0="${t.t0}">${fmtMs(performance.now() - t.t0)}</span></span></li>`).join('')
      : '<li class="empty">— ocioso</li>';
  }

  function renderEvents() {
    const L = ctx.term.log;
    $('ev-n').textContent = L.length;
    const cls = { OK: 'c-act', INF: 'c-meta', WRN: 'c-warn', ERR: 'c-err', AI: 'c-hud' };
    $('events').innerHTML = L.length
      ? L.slice(-6).reverse().map(e => {
        const d = new Date(e.ts);
        return `<li><span class="t">${hhmm(d)}:${pad(d.getSeconds())}</span><span class="lv ${cls[e.level]}">${e.level}</span><span title="${esc(e.text)}">${esc(e.text)}</span></li>`;
      }).join('')
      : '<li class="empty">— nenhum</li>';
  }

  function renderTele(now, tk, E, today, y) {
    $('t-date').textContent = `${DOW[now.getDay()]} ${ddmm(now)}`;
    const big = $('t-today');
    big.textContent = today;
    big.classList.toggle('is-zero', !today);

    const dow = (now.getDay() + 6) % 7;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    const days = [...Array(7)].map((_, i) => {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      const k = dayKey(d);
      return { k, n: E.filter(e => e.day === k).length, today: k === tk, future: d > now && k !== tk, label: 'STQQSSD'[i] };
    });
    const max = Math.max(1, ...days.map(x => x.n));
    $('t-week').innerHTML = days.map(x =>
      `<div class="wd${x.today ? ' is-today' : ''}${x.future ? ' is-future' : ''}" title="${x.k}: ${x.n}">` +
      `<span>${x.future ? '' : x.n}</span><span class="wb"><i style="height:${Math.round(x.n / max * 100)}%"></i></span><span>${x.label}</span></div>`).join('');
    $('t-week-sum').textContent = days.reduce((a, x) => a + x.n, 0);

    $('t-year-title').textContent = `ano ${now.getFullYear()}`;
    $('t-year-pct').textContent = Math.round(y.pct * 100) + '%';
    $('t-year-bar').style.width = (y.pct * 100).toFixed(1) + '%';
    $('t-year').textContent = `dia ${y.day} de ${y.total}`;

    $('t-total').textContent = E.length;
    $('t-since').textContent = E.length ? (d => `${ddmm(d)}.${d.getFullYear()}`)(new Date(E[0].ts)) : 'NA';
    $('t-size').textContent = ctx.store ? kb(ctx.store.bytes()) : 'NA';
    $('t-dest').textContent = mem()[0];

    const cnt = {};
    E.forEach(e => (e.tags || []).forEach(t => { cnt[t] = (cnt[t] || 0) + 1; }));
    const top = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 6);
    $('t-tags').innerHTML = top.length
      ? top.map(([t, n]) => `<li><span class="c-act">#${esc(t)}</span><b>${n}</b></li>`).join('')
      : '<li class="empty">use #tags nas notas</li>';

    const phaseState = Object.fromEntries(PHASES.map(([n, , s]) => [n, s]));
    $('t-mods').innerHTML = MODULES.map(m => {
      const pill = m.on ? '<span class="pill on">online</span>' : `<span class="pill${phaseState[m.phase] === 'wip' ? ' wip' : ''}">fase ${m.phase}</span>`;
      return `<li class="${m.on ? 'is-on' : ''}"><span>${m.name}</span>${pill}</li>`;
    }).join('');
  }

  // rodapé: metadados de infraestrutura
  function renderFoot() {
    const sw = 'serviceWorker' in navigator ? (navigator.serviceWorker.controller ? ['ativo', 'ok'] : ['NA', 'na']) : ['NA', 'na'];
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
    $('work-meta').textContent = { email: 'login · e-mail', password: 'login · senha', code: 'login · código' }[S.mode] || 'captura';
  }

  const fmtMs = ms => ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(1) + 's';

  /* ---------- a cada segundo: relógio e contadores de tempo ---------- */

  let lastMinute = -1;
  function tick() {
    const d = new Date();
    $('h-clock').textContent = `${hhmm(d)}:${pad(d.getSeconds())}`;
    $('h-date').textContent = `${DOW[d.getDay()]} ${ddmm(d)}`;
    const up = dur(Date.now() - S.startedAt);
    const k = $('k-up'); if (k) k.textContent = up;
    const f = $('f-sess'); if (f) f.textContent = up;
    document.querySelectorAll('[data-t0]').forEach(el => { el.textContent = fmtMs(performance.now() - +el.dataset.t0); });
    if (d.getMinutes() !== lastMinute) { lastMinute = d.getMinutes(); renderNow(); }
  }

  return { render, tick, state, mem, toggle, pulse: core.pulse };
}
