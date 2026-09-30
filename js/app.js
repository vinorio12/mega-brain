// Ponto de partida: liga as peças e faz a sequência de boot.

import { esc, dayKey, tagsOf, sleep, CmdError, VERSION } from './util.js';
import { createLocalStore } from './store.js';
import { createTerminal } from './terminal.js';
import { createCommands } from './commands.js';
import { createUI } from './ui.js';
import { savedPlace, fetchWeather } from './weather.js';

// Estado compartilhado do app.
const S = {
  booting: true,
  degraded: false,
  entries: [],
  undo: [],
  storeKind: null,
  lastLatency: null,
  weather: null,
  startedAt: Date.now(),
};

const ctx = { S };

ctx.term = createTerminal({
  out: document.getElementById('out'),
  input: document.getElementById('cmd'),
  form: document.getElementById('form'),
  hint: document.getElementById('hint'),
  completions: {
    commands: () => ctx.commands.names(),
    tags: () => [...new Set(S.entries.flatMap(e => e.tags || []))].sort(),
  },
  onSubmit: text => run(text),
  onChange: kind => {
    if (!ctx.ui) return;
    if (kind === 'task') ctx.term.renderHint();
    ctx.ui.render();
  },
});
ctx.commands = createCommands(ctx);
ctx.ui = createUI(ctx);

const { term, ui } = ctx;

/* ---------- executar o que foi digitado ---------- */

async function run(text) {
  if (!text.startsWith('/')) return capture(text);

  const [name, ...rest] = text.slice(1).split(/\s+/);
  const arg = rest.join(' ');
  const cmd = ctx.commands.get(name || '');
  if (!cmd) { ui.pulse('err'); return term.error(ctx.commands.notFound(name || '')); }

  if (cmd.async) {
    await term.task('/' + cmd.name + (arg ? ' ' + arg : ''), (signal, t) => cmd.run(arg, signal, t), { announce: cmd.announce });
  } else {
    try { cmd.run(arg); ui.pulse('hud'); }
    catch (e) { ui.pulse('err'); term.error(e); }
  }
}

// Texto livre vira uma entrada na inbox.
async function capture(text) {
  await term.task('captura', async (signal, t) => {
    if (!ctx.store) throw new CmdError('E_BOOT', 'store', 'a memória ainda está carregando', 'espere o READY e tente de novo');
    const now = new Date();
    const tags = tagsOf(text);
    const entry = await ctx.store.add({ text, tags, kind: 'nota', ts: now.getTime(), day: dayKey(now) });
    S.lastLatency = t.elapsed();
    const n = S.entries.findIndex(e => e.id === entry.id) + 1;
    const tagHtml = tags.length ? ' · ' + tags.map(x => `<span class="c-act">#${esc(x)}</span>`).join(' ') : '';
    term.ok('store', `capturado <span class="c-meta">#${n}</span>${tagHtml} <span class="c-meta">· ${t.id} · ${S.lastLatency}ms</span>`);
    ui.pulse('act');
  });
}

/* ---------- clima automático (se você já escolheu um local) ---------- */

async function refreshWeather() {
  const place = savedPlace();
  if (!place || !navigator.onLine) return;
  await term.task('clima', async (signal, t) => {
    S.weather = await fetchWeather(place, signal);
    term.ok('wx', `clima · ${esc(place.name)} ${Math.round(S.weather.temp)}° <span class="c-meta">· ${t.id} · ${t.elapsed()}ms</span>`);
  });
}

/* ---------- rede ---------- */

addEventListener('online', () => { term.ok('net', 'conexão restabelecida'); ui.pulse('act'); ui.render(); refreshWeather(); });
addEventListener('offline', () => { term.warn('net', 'sem conexão · a memória local continua funcionando'); ui.pulse('warn'); ui.render(); });

/* ---------- boot ---------- */

async function boot() {
  ui.tick();
  setInterval(ui.tick, 1000);
  ui.render();

  term.print(`<b>MEGA BRAIN</b><span>cybernetic intelligence terminal · v${VERSION}</span>`, 'title');
  await sleep(140);
  term.ok('core', 'núcleo carregado');
  await sleep(120);
  term.ok('ui', 'interface · núcleo, terminal, telemetria');
  await sleep(120);

  // memória
  const store = createLocalStore();
  ctx.store = store;
  S.storeKind = store.kind;
  store.subscribe(list => { S.entries = list; ui.render(); });
  try {
    const n = await store.connect();
    term.ok('store', `memória carregada · ${n} entradas`);
    term.warn('store', 'modo local · os dados ficam só neste navegador até a nuvem ser ligada');
  } catch (e) {
    S.degraded = true;
    term.error(Object.assign(e, { src: 'store', code: e.code || 'E_STORE_READ', hint: 'recarregue a página' }));
  }
  await sleep(120);

  term[navigator.onLine ? 'ok' : 'warn']('net', navigator.onLine ? 'rede online' : 'rede offline');

  S.booting = false;
  ui.render();
  ui.pulse('hud');
  term.say('pronto. escreva qualquer coisa pra capturar · <span class="c-act">/ajuda</span> mostra os comandos.');

  refreshWeather();
  setInterval(refreshWeather, 15 * 60 * 1000);

  if (matchMedia('(pointer: fine)').matches) term.focus();
}

boot();
