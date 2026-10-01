// Ponto de partida: liga as peças, faz o boot e cuida do login.

import { esc, dayKey, tagsOf, sleep, uid, CmdError, VERSION } from './util.js';
import { createLocalStore, LOCAL_KEY } from './store.js';
import { createCloud, createCloudStore } from './cloud.js';
import { SUPABASE_URL, SUPABASE_KEY, OPERATORS } from './config.js';
import { createTerminal } from './terminal.js';
import { createCommands } from './commands.js';
import { createUI } from './ui.js';
import { createBoot, bootMode } from './boot.js';
import { savedPlace, fetchWeather } from './weather.js';
import { isRecord, registry, seedEntries } from './tasks.js';

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
const MIGRATED_KEY = 'mb.migrated.v1';

// Estado compartilhado do app.
const S = {
  booting: true,
  locked: false,     // nuvem ligada mas ainda sem login
  degraded: false,
  mode: null,        // null | 'email' | 'code' (o que o prompt está pedindo)
  email: null,
  user: null,
  entries: [],       // notas, tarefas e acervo
  records: [],       // registros: projetos e status (veja js/tasks.js)
  undo: [],          // cada item: { label, items: [versões anteriores] }
  ctx: null,         // aba atual (projeto), ex: 'tcc' · null = inbox (~)
  taskList: null,    // ids na ordem dos números t1, t2... da última lista mostrada
  lastLatency: null,
  weather: null,
  startedAt: Date.now(),
};

const ctx = { S, store: null, cloud: null, reg: () => registry(S.records) };
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
  // (comandos com "/" aparecem normais mesmo no modo senha)
  privacy: v => (v?.startsWith('/') ? null : S.mode === 'code' || S.mode === 'password' ? 'mask' : S.mode === 'email' ? 'nohist' : null),
  onSubmit: text => run(text),
  // sinais do terminal viram reações do núcleo
  onChange: (kind, value) => {
    if (!ctx.ui) return;
    if (kind === 'input') return ctx.ui.onInput(value);
    if (kind === 'key') return ctx.ui.onKey();
    if (kind === 'fault') return ctx.ui.onFault();
    if (kind === 'task') { ctx.term.renderHint(); return ctx.ui.noteTasks(); }
    ctx.ui.render();
  },
});
ctx.commands = createCommands(ctx);
ctx.ui = createUI(ctx);
ctx.actions = { login, logout, sync, migrate, install, sendCode, setCtx };

const { term, ui } = ctx;

/* ================= executar o que foi digitado ================= */

async function run(text) {
  if (!text.startsWith('/')) {
    if (S.mode === 'email') return submitEmail(text);
    if (S.mode === 'password') return submitPassword(text);
    if (S.mode === 'code') return submitCode(text);
    if (!ctx.store) return lockedError();
    // "- revisar cap 2 #tcc >sex" vira tarefa
    if (/^-\s+\S/.test(text)) return term.task('nova tarefa', (signal, t) => ctx.commands.addTask(text.replace(/^-\s+/, ''), t), { kind: 'exec' });
    return capture(text);
  }

  const [name, ...rest] = text.slice(1).split(/\s+/);
  const arg = rest.join(' ');
  const cmd = ctx.commands.get(name || '');
  if (!cmd) { ui.pulse('err'); return term.error(ctx.commands.notFound(name || '')); }
  if (cmd.data && !ctx.store) return lockedError();

  if (cmd.async) {
    await term.task('/' + cmd.name + (arg ? ' ' + arg : ''), (signal, t) => cmd.run(arg, signal, t), { announce: cmd.announce, kind: cmd.exec ? 'exec' : 'proc' });
  } else {
    try { cmd.run(arg); ui.pulse('int', 0.9); }
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
    // dentro de uma aba, a nota ganha a #tag dela
    if (S.ctx && !tagsOf(text).includes(S.ctx)) text += ' #' + S.ctx;
    const tags = tagsOf(text);
    const entry = await ctx.store.add({ text, tags, kind: 'nota', ts: now.getTime(), day: dayKey(now) });
    S.lastLatency = t.elapsed();
    const n = S.entries.findIndex(e => e.id === entry.id) + 1;
    const tagHtml = tags.length ? ' · ' + tags.map(x => `<span class="c-act">#${esc(x)}</span>`).join(' ') : '';
    const queued = ctx.store.pending() > 0;
    term[queued ? 'warn' : 'ok']('store',
      `${queued ? 'capturado · na fila, sobe quando a rede voltar' : 'capturado'} <span class="c-meta">#${n}</span>${tagHtml} <span class="c-meta">· ${t.id} · ${S.lastLatency}ms</span>`);
    ui.pulse(queued ? 'warn' : 'act');
  }, { kind: 'exec' });
}

/* ================= memória ================= */

let unsubscribe = null;
function attachStore(store) {
  unsubscribe?.();
  ctx.store = store;
  // registros (projetos, status) ficam separados das notas/tarefas: não entram no /inbox nem nas contagens
  unsubscribe = store.subscribe(list => {
    S.entries = list.filter(e => !isRecord(e));
    S.records = list.filter(isRecord);
    ui.render();
  });
}

// Cria os projetos (tcc, weg, pessoal) e status (a fazer, fazendo, esperando, feito) iniciais, se faltarem.
// Só roda depois de a memória estar completa (nuvem sincronizada), pra não duplicar.
async function ensureSeed() {
  const missing = seedEntries(S.records, S.user?.id || 'local');
  if (!missing.length) return;
  for (const e of missing) await ctx.store.restore(e);
  term.ok('store', `registros iniciais · ${missing.filter(e => e.kind === 'projeto').map(e => '#' + e.text).join(' ')} ${missing.filter(e => e.kind === 'status').map(e => '@' + esc(e.text)).join(' ')}`.trim());
}

async function openLocal() {
  const store = createLocalStore();
  attachStore(store);
  const n = await store.connect();
  term.ok('store', `memória local · ${S.entries.length} entradas`);
  term.warn('store', 'modo local · os dados ficam só neste navegador');
  await ensureSeed();
  return n;
}

async function openSession(session) {
  if (S.user?.id === session.user.id) return;
  S.user = { id: session.user.id, email: session.user.email };
  S.operator = Object.keys(OPERATORS).find(k => OPERATORS[k] === S.user.email) || S.user.email.split('@')[0];
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
  S.records = [];
  S.undo = [];
  S.locked = true;
  ui.render();
  if (reason) term.warn('auth', esc(reason));
  login();
}

function dbError(e) {
  const msg = String(e?.message || e);
  if (e?.code === '42703' || e?.code === 'PGRST204' || /column .*data/i.test(msg))
    return new CmdError('E_DB_MIGRATION', 'sync', 'o banco ainda não tem a coluna das tarefas', 'rode <span class="c-hud">supabase/002_data.sql</span> no SQL Editor do Supabase');
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
  await ensureSeed();
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
  input.value = '';
  input.placeholder = { email: 'usuário', password: 'senha' + (S.operator ? ' · ' + S.operator : ''), code: 'código do e-mail' }[mode] || PLACEHOLDER;
  input.type = mode === 'password' ? 'password' : 'text';
  input.inputMode = mode === 'code' ? 'numeric' : 'text';
  input.autocomplete = { code: 'one-time-code', email: 'username', password: 'current-password' }[mode] || 'off';
  ui.render();
}

// Login por usuário: "vini" → e-mail do Supabase (OPERATORS em config.js). Também aceita o e-mail direto.
const OPERATOR_KEY = 'mb.operator.v1';
function resolveOperator(name) {
  const v = String(name).trim().toLowerCase();
  if (v.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? { operator: v.split('@')[0], email: v } : null;
  return OPERATORS[v] ? { operator: v, email: OPERATORS[v] } : null;
}

// arg 'outro' = perguntar o usuário mesmo tendo um salvo
function login(arg = '') {
  if (!ctx.cloud) {
    return term.error(new CmdError('E_CLOUD_OFF', 'auth', 'nuvem não configurada', 'coloque a chave publishable em <span class="c-int">js/config.js</span>'));
  }
  if (S.user) return term.say(`você já está dentro como ${esc(S.operator || S.user.email)}.`);
  let saved = null;
  try { saved = localStorage.getItem(OPERATOR_KEY); } catch {}
  const names = Object.keys(OPERATORS);
  const known = arg !== 'outro' && resolveOperator(saved || (names.length === 1 ? names[0] : ''));
  if (known) {
    S.operator = known.operator;
    S.email = known.email;
    setMode('password');
    term.say(`memória bloqueada · senha do operador <span class="c-act">${esc(known.operator)}</span> · <span class="c-int">/entrar outro</span> troca de usuário`);
  } else {
    setMode('email');
    term.say('memória bloqueada · digite o usuário');
  }
  term.focus();
}

async function submitEmail(text) {
  const op = resolveOperator(text);
  if (!op) {
    return term.error(new CmdError('E_USER', 'auth', 'usuário desconhecido', `usuários: ${Object.keys(OPERATORS).map(esc).join(', ')} · ou digite o e-mail da conta`));
  }
  S.operator = op.operator;
  S.email = op.email;
  setMode('password');
  term.say(`senha do operador <span class="c-act">${esc(op.operator)}</span>`);
}

async function submitPassword(text) {
  await term.task('entrar', async (signal, t) => {
    const session = await ctx.cloud.signInPassword(S.email, text);
    try { localStorage.setItem(OPERATOR_KEY, S.operator || S.email); } catch {}
    term.ok('auth', `acesso liberado · operador ${esc(S.operator || S.email)} <span class="c-meta">· ${t.id} · ${t.elapsed()}ms</span>`);
    await openSession(session);
    ui.pulse('act');
    term.say('pronto. memória aberta · escreva qualquer coisa pra capturar.');
  }, { announce: true });
}

// alternativa à senha: código de uso único enviado por e-mail (precisa do SMTP funcionando)
async function sendCode() {
  if (!ctx.cloud || S.user) return login();
  if (!S.email) { setMode('email'); return term.say('digite o usuário primeiro.'); }
  const email = S.email;
  await term.task('enviar código', async (signal, t) => {
    await ctx.cloud.sendCode(email);
    setMode('code');
    term.ok('auth', `e-mail de acesso enviado pra ${esc(email)} <span class="c-meta">· ${t.id} · ${t.elapsed()}ms</span>`);
    term.say('digite aqui o código que chegou no e-mail. (o link do e-mail também funciona) · <span class="c-hud">/entrar</span> recomeça');
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

/* ================= abas (projetos como pastas) ================= */

const CTX_KEY = 'mb.ctx.v1';
const TABS = [null, 'tcc', 'weg', 'pessoal']; // alt+1..4

function setCtx(proj, { quiet = false } = {}) {
  S.ctx = proj || null;
  S.taskList = null; // a numeração t1, t2... passa a ser a da aba nova
  try { proj ? localStorage.setItem(CTX_KEY, proj) : localStorage.removeItem(CTX_KEY); } catch {}
  document.querySelector('.ps-path').textContent = ':~' + (S.ctx ? '/' + S.ctx : '');
  document.querySelector('.prompt').classList.toggle('has-ctx', !!S.ctx);
  ui.render();
  if (!quiet) {
    term.say(S.ctx
      ? `aba <span class="c-act">~/${esc(S.ctx)}</span> · o que você escrever aqui ganha <span class="c-act">#${esc(S.ctx)}</span> · <span class="c-int">/tarefas</span> lista as daqui · <span class="c-int">/ir ~</span> volta`
      : 'aba <span class="c-act">~</span> · inbox geral');
    ui.onCtx(); // o satélite CONTEXT acende
  }
}

addEventListener('keydown', e => {
  // alt+1..4 troca de aba (sem ctrl, pra não confundir com AltGr)
  if (e.altKey && !e.ctrlKey && !e.metaKey && /^[1-4]$/.test(e.key)) {
    e.preventDefault();
    setCtx(TABS[+e.key - 1]);
  }
});

/* ================= erros inesperados ================= */

// Qualquer bug vira uma linha E_JS no terminal (com arquivo e linha), em vez de falhar calado.
const seenErrors = new Set();
function reportBug(message, where) {
  const key = message + where;
  if (seenErrors.has(key)) return; // não repete o mesmo erro
  seenErrors.add(key);
  ui.pulse('err');
  term.error(new CmdError('E_JS', 'core', `${message}${where ? ' · ' + where : ''}`, 'se repetir, me manda esta linha'));
}
addEventListener('error', e => {
  if (!e.message) return; // falha de carregar imagem/fonte, não é bug
  reportBug(e.message, e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : '');
});
addEventListener('unhandledrejection', e => {
  const r = e.reason;
  if (r?.name === 'AbortError') return; // cancelamento com ctrl+c, normal
  reportBug(String(r?.message || r), '');
});

/* ================= rede ================= */

addEventListener('online', () => { term.ok('net', 'conexão restabelecida'); ui.pulse('act'); ui.render(); refreshWeather(); });
addEventListener('offline', () => { term.warn('net', 'sem conexão · o que você escrever fica na fila'); ui.pulse('warn'); ui.render(); });

/* ================= boot ================= */

async function boot() {
  // o MESMO núcleo da interface nasce em tela cheia (veja js/boot.js)
  const mode = bootMode();
  const seq = createBoot({
    core: ui.core, app: document.getElementById('app'),
    field: document.getElementById('field'), slot: document.getElementById('field-slot'), mode,
  });
  ui.tick();
  setInterval(ui.tick, 1000);
  ui.render();

  seq.head(`v${VERSION}`, mode === 'full' ? 'cold boot' : 'warm boot');
  term.print(`<b>MB <i>CORE</i></b><span>ambiente operacional de inteligência · v${VERSION}</span>`, 'title');
  const coreMs = Math.round(performance.now());
  seq.step('kernel', `módulos carregados · ${coreMs}ms`);
  term.ok('core', `kernel · ${coreMs}ms`);

  await Promise.race([document.fonts.ready, sleep(1500)]);
  const canvasInfo = `canvas ${Math.min(2, devicePixelRatio || 1)}x`;
  seq.step('interface', `jetbrains mono · ${canvasInfo}`);
  term.ok('ui', `interface · núcleo, terminal, contexto · ${canvasInfo}`);

  let needLogin = false;
  if (!CLOUD) {
    const n = await openLocal();
    seq.step('memory', `local · ${n} entradas`, 'warn');
  } else {
    try {
      ctx.cloud = await createCloud(SUPABASE_URL, SUPABASE_KEY);
      seq.step('memory net', 'supabase · postgres · rls');
      ctx.cloud.onAuth(onAuthEvent);
      const session = await ctx.cloud.session();
      if (AUTH_URL) {
        if (session) term.ok('auth', 'login pelo link do e-mail');
        else { ui.pulse('err'); term.error(linkError(AUTH_URL)); }
        history.replaceState(null, '', location.pathname); // tira os dados do link da barra de endereço
      }
      if (session) {
        await openSession(session);
        seq.step('operator', esc(S.operator));
        seq.step('memory', `unlocked · ${S.entries.length} entradas`);
      } else {
        S.locked = true;
        needLogin = true;
        term.warn('auth', 'memória bloqueada · precisa entrar');
        seq.step('memory', 'LOCKED · aguardando operador', 'lock');
      }
    } catch (e) {
      console.error(e);
      S.degraded = true;
      term.error(new CmdError('E_CLOUD_LOAD', 'cloud', 'não consegui carregar a nuvem', 'confira a internet e recarregue · usando memória local por enquanto'));
      seq.step('memory net', 'falhou · modo local', 'err');
      const n = await openLocal();
      seq.step('memory', `local · ${n} entradas`, 'warn');
    }
  }

  const online = navigator.onLine;
  seq.step('network', online ? 'online' : 'offline · fila local ativa', online ? 'ok' : 'warn');
  term[online ? 'ok' : 'warn']('net', online ? 'rede online' : 'rede offline');

  // volta na última aba usada neste aparelho
  try { const saved = localStorage.getItem(CTX_KEY); if (saved) setCtx(saved, { quiet: true }); } catch {}
  seq.step('context', '~' + (S.ctx ? '/' + esc(S.ctx) : ''), 'int');

  // declaração + montagem; o estado sai de INITIALIZING na hora do "CORE ONLINE"
  await seq.finish({ locked: S.locked, onOnline: () => { S.booting = false; ui.render(); } });
  term.ok('core', `core online · ${S.locked ? 'memory locked' : 'intelligence ready'} · boot ${mode === 'full' ? 'completo' : mode === 'short' ? 'rápido' : 'instantâneo'}`);

  if (needLogin) login();
  else term.say('pronto. escreva qualquer coisa pra capturar · <span class="c-act">- texto >sex</span> cria tarefa · <span class="c-act">/ajuda</span> mostra os comandos.' +
    (S.ctx ? ` · você está na aba <span class="c-act">~/${esc(S.ctx)}</span>` : ''));

  registerSW();
  refreshWeather();
  setInterval(refreshWeather, 15 * 60 * 1000);

  if (matchMedia('(pointer: fine)').matches) term.focus();
}

boot();
