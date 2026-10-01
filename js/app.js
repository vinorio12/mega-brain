// Ponto de partida: liga as peças, faz o boot e cuida do login.

import { esc, dayKey, tagsOf, sleep, uid, CmdError, VERSION } from './util.js';
import { createLocalStore, LOCAL_KEY } from './store.js';
import { createCloud, createCloudStore } from './cloud.js';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { createTerminal } from './terminal.js';
import { createCommands } from './commands.js';
import { createUI } from './ui.js';
import { createBootScreen } from './boot.js';
import { savedPlace, fetchWeather } from './weather.js';

const CLOUD = Boolean(SUPABASE_URL && SUPABASE_KEY);

// O link do e-mail volta pro app com o resultado no endereço (depois do "#").
// Lemos antes da biblioteca do Supabase limpar, pra poder explicar se deu erro.
const AUTH_URL = (() => {
  const p = new URLSearchParams(location.hash.slice(1) + '&' + location.search.slice(1));
  const r = { token: p.has('access_token'), code: p.has('code'), error: p.get('error_code') || p.get('error'), desc: p.get('error_description') };
  return r.token || r.code || r.error ? r : null;
})();

function linkError(r) {
  if (r.error === 'otp_expired') {
    return new CmdError('E_AUTH_LINK', 'auth', 'o link do e-mail expirou ou já foi usado',
      'cada link vale uma vez, e só o do último e-mail pedido · digite seu e-mail de novo e clique só no link mais novo');
  }
  if (r.error) return new CmdError('E_AUTH_LINK', 'auth', `o login pelo link falhou: ${r.desc || r.error}`, 'digite seu e-mail de novo pra receber outro link');
  return new CmdError('E_AUTH_LINK', 'auth', 'o link chegou, mas a sessão não abriu', 'digite seu e-mail de novo · se repetir, me mande esta mensagem');
}
const EMAIL_KEY = 'mb.email.v1';
const MIGRATED_KEY = 'mb.migrated.v1';

// Estado compartilhado do app.
const S = {
  booting: true,
  locked: false,     // nuvem ligada mas ainda sem login
  degraded: false,
  mode: null,        // null | 'email' | 'code' (o que o prompt está pedindo)
  email: null,
  user: null,
  entries: [],
  undo: [],
  lastLatency: null,
  weather: null,
  startedAt: Date.now(),
};

const ctx = { S, store: null, cloud: null };
const input = document.getElementById('cmd');
const PLACEHOLDER = input.placeholder;

ctx.term = createTerminal({
  out: document.getElementById('out'),
  input,
  form: document.getElementById('form'),
  hint: document.getElementById('hint'),
  completions: {
    commands: () => ctx.commands.names(),
    tags: () => [...new Set(S.entries.flatMap(e => e.tags || []))].sort(),
  },
  // e-mail e código não vão pro histórico; o código aparece mascarado
  privacy: () => (S.mode === 'code' ? 'mask' : S.mode === 'email' ? 'nohist' : null),
  onSubmit: text => run(text),
  onChange: kind => {
    if (!ctx.ui) return;
    if (kind === 'task') ctx.term.renderHint();
    ctx.ui.render();
  },
});
ctx.commands = createCommands(ctx);
ctx.ui = createUI(ctx);
ctx.actions = { login, logout, sync, migrate, install };

const { term, ui } = ctx;

/* ================= executar o que foi digitado ================= */

async function run(text) {
  if (!text.startsWith('/')) {
    if (S.mode === 'email') return submitEmail(text);
    if (S.mode === 'code') return submitCode(text);
    if (!ctx.store) return lockedError();
    return capture(text);
  }

  const [name, ...rest] = text.slice(1).split(/\s+/);
  const arg = rest.join(' ');
  const cmd = ctx.commands.get(name || '');
  if (!cmd) { ui.pulse('err'); return term.error(ctx.commands.notFound(name || '')); }
  if (cmd.data && !ctx.store) return lockedError();

  if (cmd.async) {
    await term.task('/' + cmd.name + (arg ? ' ' + arg : ''), (signal, t) => cmd.run(arg, signal, t), { announce: cmd.announce });
  } else {
    try { cmd.run(arg); ui.pulse('hud'); }
    catch (e) { ui.pulse('err'); term.error(e); }
  }
}

function lockedError() {
  ui.pulse('warn');
  term.error(new CmdError('E_LOCKED', 'auth', 'memória bloqueada até você entrar',
    S.mode ? 'responda o que o prompt está pedindo' : 'digite <span class="c-hud">/entrar</span>'));
}

// Texto livre vira uma entrada na inbox.
async function capture(text) {
  await term.task('captura', async (signal, t) => {
    const now = new Date();
    const tags = tagsOf(text);
    const entry = await ctx.store.add({ text, tags, kind: 'nota', ts: now.getTime(), day: dayKey(now) });
    S.lastLatency = t.elapsed();
    const n = S.entries.findIndex(e => e.id === entry.id) + 1;
    const tagHtml = tags.length ? ' · ' + tags.map(x => `<span class="c-act">#${esc(x)}</span>`).join(' ') : '';
    const queued = ctx.store.pending() > 0;
    term[queued ? 'warn' : 'ok']('store',
      `${queued ? 'capturado · na fila, sobe quando a rede voltar' : 'capturado'} <span class="c-meta">#${n}</span>${tagHtml} <span class="c-meta">· ${t.id} · ${S.lastLatency}ms</span>`);
    ui.pulse(queued ? 'warn' : 'act');
  });
}

/* ================= memória ================= */

let unsubscribe = null;
function attachStore(store) {
  unsubscribe?.();
  ctx.store = store;
  unsubscribe = store.subscribe(list => { S.entries = list; ui.render(); });
}

async function openLocal() {
  const store = createLocalStore();
  attachStore(store);
  const n = await store.connect();
  term.ok('store', `memória local · ${n} entradas`);
  term.warn('store', 'modo local · os dados ficam só neste navegador');
  return n;
}

async function openSession(session) {
  if (S.user?.id === session.user.id) return;
  S.user = { id: session.user.id, email: session.user.email };
  S.locked = false;
  setMode(null);

  const store = createCloudStore(ctx.cloud.sb, S.user, { onSync: () => ui.render() });
  attachStore(store);
  const n = await store.connect();
  term.ok('auth', `sessão · ${esc(S.user.email)}`);
  term.ok('store', `memória aberta · ${n} entradas no cache deste aparelho`);

  // sincroniza em segundo plano
  term.task('sync', (signal, t) => sync(t));

  // notas antigas do modo local ainda não enviadas?
  let local = [];
  try { local = JSON.parse(localStorage.getItem(LOCAL_KEY)) || []; } catch {}
  if (local.length && !localStorage.getItem(MIGRATED_KEY)) {
    term.warn('store', `${local.length} notas do modo local ainda não estão na nuvem · <span class="c-hud">/migrar</span> envia`);
  }
}

function closeSession(reason) {
  unsubscribe?.();
  unsubscribe = null;
  ctx.store = null;
  S.user = null;
  S.entries = [];
  S.undo = [];
  S.locked = true;
  ui.render();
  if (reason) term.warn('auth', esc(reason));
  login();
}

function dbError(e) {
  const msg = String(e?.message || e);
  if (e?.code === '42P01' || e?.code === 'PGRST205' || /does not exist|schema cache/i.test(msg))
    return new CmdError('E_DB_TABLE', 'sync', 'a tabela entries não existe no banco', 'rode <span class="c-hud">supabase/001_entries.sql</span> no SQL Editor do Supabase');
  if (/fetch|network/i.test(msg))
    return new CmdError('E_NET', 'sync', 'sem resposta da nuvem', 'as notas ficam na fila e sobem quando a rede voltar');
  return new CmdError('E_SYNC', 'sync', msg, '<span class="c-hud">/sync</span> tenta de novo');
}

async function sync(t) {
  let n;
  try { n = await ctx.store.sync(); }
  catch (e) { throw dbError(e); }
  const st = ctx.store.status;
  S.lastLatency = st.latency;
  const p = ctx.store.pending();
  if (p) term.warn('sync', `${p} na fila · ${esc(st.lastError || 'sem rede')} · envia sozinho quando der`);
  else term.ok('sync', `sincronizado · ${n} entradas na nuvem <span class="c-meta">· ${t.id} · ${t.elapsed()}ms</span>`);
  ui.pulse(p ? 'warn' : 'act');
}

async function migrate(t) {
  if (ctx.store?.kind !== 'nuvem') return term.say('a nuvem não está ligada · nada pra migrar.');
  let local = [];
  try { local = JSON.parse(localStorage.getItem(LOCAL_KEY)) || []; } catch {}
  if (!local.length) return term.say('nenhuma nota local pra migrar.');
  const have = new Set(S.entries.map(e => e.id));
  const isUuid = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const todo = local.filter(e => !have.has(e.id));
  for (const e of todo) {
    await ctx.store.restore({ id: isUuid(e.id) ? e.id : uid(), text: e.text, tags: e.tags || [], kind: e.kind || 'nota', ts: e.ts, day: e.day });
  }
  try { localStorage.setItem(MIGRATED_KEY, new Date().toISOString()); } catch {}
  term.ok('store', `migradas ${todo.length} notas · ${local.length - todo.length} já estavam na nuvem · a cópia local foi mantida <span class="c-meta">· ${t.id} · ${t.elapsed()}ms</span>`);
}

/* ================= login ================= */

function setMode(mode) {
  S.mode = mode;
  input.placeholder = { email: 'seu e-mail', code: 'aguardando o link do e-mail (ou digite o código)' }[mode] || PLACEHOLDER;
  input.inputMode = mode === 'code' ? 'numeric' : mode === 'email' ? 'email' : 'text';
  input.autocomplete = mode === 'code' ? 'one-time-code' : mode === 'email' ? 'email' : 'off';
  ui.render();
}

function login() {
  if (!ctx.cloud) {
    return term.error(new CmdError('E_CLOUD_OFF', 'auth', 'nuvem não configurada', 'coloque a chave publishable em <span class="c-hud">js/config.js</span>'));
  }
  if (S.user) return term.say(`você já está dentro como ${esc(S.user.email)}.`);
  setMode('email');
  term.say('memória bloqueada. digite seu e-mail pra receber o acesso.');
  try {
    const saved = localStorage.getItem(EMAIL_KEY);
    if (saved) input.value = saved;
  } catch {}
  term.focus();
}

async function submitEmail(text) {
  const email = text.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return term.error(new CmdError('E_EMAIL', 'auth', 'e-mail inválido', 'ex: voce@gmail.com'));
  }
  await term.task('enviar código', async (signal, t) => {
    await ctx.cloud.sendCode(email);
    S.email = email;
    try { localStorage.setItem(EMAIL_KEY, email); } catch {}
    setMode('code');
    term.ok('auth', `e-mail de acesso enviado pra ${esc(email)} <span class="c-meta">· ${t.id} · ${t.elapsed()}ms</span>`);
    term.say('abra o e-mail e clique no link de login. esta tela libera sozinha. ' +
      'se o e-mail trouxer um código, digite aqui · <span class="c-hud">/entrar</span> recomeça');
  }, { announce: true });
}

async function submitCode(text) {
  const code = text.replace(/\s/g, '');
  if (!/^\d{6,10}$/.test(code)) {
    return term.error(new CmdError('E_CODE', 'auth', 'o código tem só números', 'confira no e-mail · <span class="c-hud">/entrar</span> pede outro'));
  }
  await term.task('verificar código', async (signal, t) => {
    const session = await ctx.cloud.verify(S.email, code);
    term.ok('auth', `acesso liberado <span class="c-meta">· ${t.id} · ${t.elapsed()}ms</span>`);
    await openSession(session);
    ui.pulse('act');
    term.say('pronto. memória aberta · escreva qualquer coisa pra capturar.');
  }, { announce: true });
}

async function logout(t) {
  if (!S.user) return term.say('você não está logado.');
  const p = ctx.store.pending();
  if (p) {
    throw new CmdError('E_PENDING', 'auth', `${p} notas ainda não subiram pra nuvem`, 'conecte na internet e rode <span class="c-hud">/sync</span> antes de sair');
  }
  ctx.store.forget();
  await ctx.cloud.signOut();
  term.ok('auth', `sessão encerrada · cópia deste aparelho apagada (a nuvem continua intacta) <span class="c-meta">· ${t.id}</span>`);
  closeSession();
}

// eventos de login vindos do Supabase (ex: clicou no link do e-mail, sessão expirou)
function onAuthEvent(event, session) {
  setTimeout(() => {
    if (event === 'SIGNED_IN' && session && S.locked) {
      openSession(session).then(() => term.say('pronto. memória aberta.'));
    } else if (event === 'SIGNED_OUT' && S.user) {
      closeSession('a sessão terminou · entre de novo');
    }
  }, 0);
}

/* ================= app instalável (PWA) ================= */

let installPrompt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
addEventListener('appinstalled', () => { term.ok('pwa', 'instalado como app'); ui.pulse('act'); });

function install() {
  if (matchMedia('(display-mode: standalone)').matches || navigator.standalone) {
    return term.say('você já está usando o app instalado.');
  }
  if (installPrompt) {
    installPrompt.prompt();
    installPrompt.userChoice.then(c => term.info('pwa', c.outcome === 'accepted' ? 'instalação aceita' : 'instalação cancelada'));
    installPrompt = null;
    return;
  }
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  term.say(ios
    ? 'no iPhone: abra no Safari → botão compartilhar → "Adicionar à Tela de Início".'
    : 'o navegador ainda não liberou o botão. no Chrome: menu ⋮ → "Instalar app" (ou "Adicionar à tela inicial" no celular).');
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => { term.ok('pwa', 'service worker ativo · abre mesmo sem internet'); ui.render(); })
    .catch(e => term.warn('pwa', `service worker não registrou · ${esc(e.message)}`));
  navigator.serviceWorker.addEventListener('controllerchange', () => ui.render());
}

/* ================= clima ================= */

async function refreshWeather() {
  if (!navigator.onLine) return;
  const place = savedPlace();
  await term.task('clima', async (signal, t) => {
    S.weather = await fetchWeather(place, signal);
    term.ok('wx', `clima · ${esc(place.name)} ${Math.round(S.weather.temp)}° <span class="c-meta">· ${t.id} · ${t.elapsed()}ms</span>`);
  });
}

/* ================= rede ================= */

addEventListener('online', () => { term.ok('net', 'conexão restabelecida'); ui.pulse('act'); ui.render(); refreshWeather(); });
addEventListener('offline', () => { term.warn('net', 'sem conexão · o que você escrever fica na fila'); ui.pulse('warn'); ui.render(); });

/* ================= boot ================= */

async function boot() {
  const screen = createBootScreen(6);
  ui.tick();
  setInterval(ui.tick, 1000);
  ui.render();

  term.print(`<b>MEGA BRAIN</b><span>cybernetic intelligence terminal · v${VERSION}</span>`, 'title');
  const coreMs = Math.round(performance.now());
  screen.step('núcleo', `${coreMs}ms`);
  term.ok('core', `núcleo carregado · ${coreMs}ms`);

  await Promise.race([document.fonts.ready, sleep(1500)]);
  screen.step('interface', 'jetbrains mono · 3 painéis');
  term.ok('ui', 'interface · núcleo, terminal, telemetria');

  let needLogin = false;
  if (!CLOUD) {
    const n = await openLocal();
    screen.step('memória', `local · ${n}`, 'warn');
    screen.step('sessão', 'modo local', 'warn');
  } else {
    try {
      ctx.cloud = await createCloud(SUPABASE_URL, SUPABASE_KEY);
      screen.step('nuvem', 'supabase');
      ctx.cloud.onAuth(onAuthEvent);
      const session = await ctx.cloud.session();
      if (AUTH_URL) {
        if (session) term.ok('auth', 'login pelo link do e-mail');
        else { ui.pulse('err'); term.error(linkError(AUTH_URL)); }
        history.replaceState(null, '', location.pathname); // tira os dados do link da barra de endereço
      }
      if (session) {
        await openSession(session);
        screen.step('sessão', session.user.email);
        screen.step('memória', `cache · ${S.entries.length}`);
      } else {
        S.locked = true;
        needLogin = true;
        term.warn('auth', 'memória bloqueada · precisa entrar');
        screen.step('sessão', 'bloqueada', 'warn');
        screen.step('memória', 'bloqueada', 'warn');
      }
    } catch (e) {
      console.error(e);
      S.degraded = true;
      term.error(new CmdError('E_CLOUD_LOAD', 'cloud', 'não consegui carregar a nuvem', 'confira a internet e recarregue · usando memória local por enquanto'));
      screen.step('nuvem', 'falhou', 'err');
      const n = await openLocal();
      screen.step('memória', `local · ${n}`, 'warn');
    }
  }

  const online = navigator.onLine;
  screen.step('rede', online ? 'online' : 'offline', online ? 'ok' : 'warn');
  term[online ? 'ok' : 'warn']('net', online ? 'rede online' : 'rede offline');

  S.booting = false;
  ui.render();
  await screen.done();
  ui.pulse('hud');

  if (needLogin) login();
  else term.say('pronto. escreva qualquer coisa pra capturar · <span class="c-act">/ajuda</span> mostra os comandos.');

  registerSW();
  refreshWeather();
  setInterval(refreshWeather, 15 * 60 * 1000);

  if (matchMedia('(pointer: fine)').matches) term.focus();
}

boot();
