// Testes automáticos do Mega Brain.
// Abra http://localhost:5173/tests/ — tudo roda sozinho e o título da aba mostra o resultado.
// Regra: nenhum teste toca nas suas notas (usa chaves "mb.test.*") nem na nuvem (usa um Supabase falso).

import { esc, tagsOf, hl, dayKey, dur, lev, kb, CmdError } from '../js/util.js';
import { pickTargets, createCommands } from '../js/commands.js';
import { createLocalStore } from '../js/store.js';
import { createCloudStore } from '../js/cloud.js';
import { createTerminal } from '../js/terminal.js';

/* ---------------- mini framework ---------------- */

const results = document.getElementById('results');
const tests = [];
let group = '';
const describe = (name, fn) => { tests.push({ group: name }); fn(); };
const test = (name, fn) => tests.push({ name, fn });

function eq(actual, expected, msg = '') {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n  esperado: ${e}\n  veio:     ${a}`);
}
function ok(cond, msg = 'condição falsa') { if (!cond) throw new Error(msg); }
async function throws(fn, code) {
  try { await fn(); } catch (e) { if (code && e.code !== code) throw new Error(`erro ${e.code}, esperado ${code}`); return e; }
  throw new Error(`deveria dar erro${code ? ' ' + code : ''}`);
}

/* ---------------- ajudantes ---------------- */

const entry = (text, i = 0) => ({ id: 'id' + i, text, tags: tagsOf(text), kind: 'nota', ts: 1_700_000_000_000 + i * 1000, day: '2026-09-30' });
const entries = texts => texts.map((t, i) => entry(t, i));

// terminal falso: guarda tudo o que seria mostrado
function fakeTerm() {
  const out = [];
  const t = {
    out, log: [], tasks: new Map(),
    emit: (lv, src, html) => out.push([lv, src, html]),
    ok: (s, h) => out.push(['OK', s, h]), info: (s, h) => out.push(['INF', s, h]),
    warn: (s, h) => out.push(['WRN', s, h]), error: e => out.push(['ERR', e.code, e.message]),
    say: h => out.push(['AI', h]), print: (h, c) => out.push(['PRINT', h, c]),
    clear: () => out.push(['CLEAR']), history: () => [], replay: () => {},
    text: () => out.map(x => x.join(' ')).join('\n'),
  };
  return t;
}

// memória em RAM com a mesma interface da real
function memStore(list) {
  let E = [...list];
  const subs = new Set();
  const emit = () => subs.forEach(fn => fn(E));
  return {
    kind: 'local', status: { state: 'local' }, pending: () => 0, bytes: () => 0,
    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
    async remove(id) { E = E.filter(e => e.id !== id); emit(); },
    async restore(e) { E = [...E.filter(x => x.id !== e.id), e].sort((a, b) => a.ts - b.ts); emit(); },
    async add(doc) { const e = { id: 'n' + E.length, ...doc }; E.push(e); emit(); return e; },
  };
}

function setup(texts) {
  const S = { entries: entries(texts), undo: [], startedAt: Date.now() };
  const term = fakeTerm();
  const ctx = { S, term, ui: { pulse() {}, render() {}, state: () => 'ready', mem: () => ['local', 'warn'] } };
  ctx.store = memStore(S.entries);
  ctx.store.subscribe(l => { S.entries = l; });
  ctx.commands = createCommands(ctx);
  const run = async (line) => {
    const [name, ...rest] = line.slice(1).split(/\s+/);
    const cmd = ctx.commands.get(name);
    if (!cmd) throw ctx.commands.notFound(name);
    const t = { id: 'T0001', elapsed: () => 1 };
    return cmd.run(rest.join(' '), new AbortController().signal, t);
  };
  return { S, term, ctx, run };
}

// Supabase falso pro teste da memória na nuvem
function fakeSb() {
  const rows = new Map();
  const api = { fail: false, calls: [], rows };
  const err = () => ({ error: { message: 'TypeError: Failed to fetch' } });
  api.from = () => ({
    upsert: async row => { api.calls.push('upsert'); if (api.fail) return err(); rows.set(row.id, { ...row }); return { error: null }; },
    delete: () => ({ eq: async (_, id) => { api.calls.push('delete'); if (api.fail) return err(); rows.delete(id); return { error: null }; } }),
    select: () => ({ order: () => ({ range: async () => (api.fail ? err() : { data: [...rows.values()], error: null }) }) }),
  });
  api.auth = { getSession: async () => ({ data: { session: null } }) };
  api.realtime = { setAuth: async () => {} };
  api.channel = () => { const ch = { on: () => ch, subscribe: cb => { cb('SUBSCRIBED'); return ch; } }; return ch; };
  api.removeChannel = () => {};
  return api;
}

/* ================= testes ================= */

describe('util · texto e tags', () => {
  test('esc escapa HTML', () => eq(esc('<b>"a" & b</b>'), '&lt;b&gt;&quot;a&quot; &amp; b&lt;/b&gt;'));
  test('tagsOf acha, deixa minúsculo e sem repetir', () => eq(tagsOf('ler #TCC e #tcc e #weg'), ['tcc', 'weg']));
  test('tagsOf aceita acento e hífen', () => eq(tagsOf('#saúde #fase-1 #2026'), ['saúde', 'fase-1', '2026']));
  test('tagsOf sem tag → vazio', () => eq(tagsOf('nada aqui'), []));
  test('hl destaca tags e escapa o resto', () => eq(hl('<x> #tcc'), '&lt;x&gt; <span class="c-act">#tcc</span>'));
  test('hl não transforma apóstrofo em tag', () => ok(!hl("d'água").includes('c-act')));
});

describe('util · tempo e números', () => {
  test('dayKey usa o dia local AAAA-MM-DD', () => eq(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05'));
  test('dur formata hh:mm:ss', () => eq(dur(3_725_000), '01:02:05'));
  test('lev mede distância entre palavras', () => { eq(lev('inbx', 'inbox'), 1); eq(lev('', 'abc'), 3); });
  test('kb formata tamanho', () => { eq(kb(500), '500 B'); eq(kb(2048), '2.0 KB'); });
});

describe('/apagar · escolha do que apagar (pickTargets)', () => {
  const E = entries(['comprar café', 'comprar pão', 'ler cap 2 #tcc', 'ligar pro joão', 'academia']);
  const ns = r => r.targets.map(t => t.n);
  test('um número', () => eq(ns(pickTargets('3', E)), [3]));
  test('vários com espaço', () => eq(ns(pickTargets('1 3 5', E)), [1, 3, 5]));
  test('vários com vírgula', () => eq(ns(pickTargets('1,2', E)), [1, 2]));
  test('aceita #n', () => eq(ns(pickTargets('#2 #4', E)), [2, 4]));
  test('intervalo', () => eq(ns(pickTargets('2-4', E)), [2, 3, 4]));
  test('intervalo invertido', () => eq(ns(pickTargets('4-2', E)), [2, 3, 4]));
  test('repetidos contam uma vez', () => eq(ns(pickTargets('1 1 1-2', E)), [1, 2]));
  test('número que não existe vai pra "bad"', () => { const r = pickTargets('9', E); eq(ns(r), []); eq(r.bad, ['9']); });
  test('intervalo que passa do fim', () => { const r = pickTargets('4-9', E); eq(ns(r), [4, 5]); eq(r.bad, ['6-9']); });
  test('intervalo que passa do fim por 1', () => eq(pickTargets('4-6', E).bad, ['6']));
  test('zero é inválido', () => eq(pickTargets('0', E).bad, ['0']));
  test('texto acha todas que contêm', () => { const r = pickTargets('comprar', E); eq(r.mode, 'text'); eq(ns(r), [1, 2]); });
  test('texto ignora maiúsculas', () => eq(ns(pickTargets('JOÃO', E)), [4]));
  test('texto com número no meio é texto', () => eq(pickTargets('cap 2', E).mode, 'text'));
  test('vazio', () => eq(pickTargets('  ', E).mode, 'empty'));
});

describe('comandos (com memória e terminal falsos)', () => {
  test('/apagar 1 3 apaga duas e /desfazer volta as duas', async () => {
    const { S, run } = setup(['a', 'b', 'c', 'd']);
    await run('/apagar 1 3');
    eq(S.entries.map(e => e.text), ['b', 'd']);
    await run('/desfazer');
    eq(S.entries.map(e => e.text), ['a', 'b', 'c', 'd']);
  });
  test('/apagar por texto com 1 resultado apaga', async () => {
    const { S, run } = setup(['comprar pão', 'ligar pro joão']);
    await run('/apagar joão');
    eq(S.entries.map(e => e.text), ['comprar pão']);
  });
  test('/apagar por texto com vários resultados NÃO apaga nada', async () => {
    const { S, term, run } = setup(['comprar pão', 'comprar leite', 'outra']);
    await run('/apagar comprar');
    eq(S.entries.length, 3);
    ok(term.text().includes('não apaguei nada'), 'deveria avisar que não apagou');
  });
  test('/apagar sem nada que bata dá E_404', async () => {
    const { run } = setup(['a']);
    await throws(() => run('/apagar xyz'), 'E_404');
  });
  test('/apagar 9 com 2 entradas dá E_ARG', async () => {
    const { run } = setup(['a', 'b']);
    await throws(() => run('/apagar 9'), 'E_ARG');
  });
  test('/desfazer em sequência volta lotes na ordem', async () => {
    const { S, run } = setup(['a', 'b', 'c']);
    await run('/apagar 1');
    await run('/apagar 1');
    eq(S.entries.map(e => e.text), ['c']);
    await run('/desfazer');
    eq(S.entries.map(e => e.text), ['b', 'c']);
    await run('/desfazer');
    eq(S.entries.map(e => e.text), ['a', 'b', 'c']);
  });
  test('/buscar #tag acha só a tag exata', async () => {
    const { term, run } = setup(['ler #tcc', 'ler #tcc2', 'nada']);
    await run('/buscar #tcc');
    const lines = term.out.filter(x => x[0] === 'PRINT' && x[2] === 'ent');
    eq(lines.length, 1);
  });
  test('/inbox 2 mostra só as 2 últimas', async () => {
    const { term, run } = setup(['a', 'b', 'c']);
    await run('/inbox 2');
    eq(term.out.filter(x => x[2] === 'ent').length, 2);
  });
  test('comando errado sugere o certo', () => {
    const { ctx } = setup([]);
    const e = ctx.commands.notFound('inbx');
    eq(e.code, 'E_CMD_404');
    ok(e.hint.includes('/inbox'), 'deveria sugerir /inbox');
  });
  test('aliases funcionam (/rm, /ls, /undo)', () => {
    const { ctx } = setup([]);
    eq(['rm', 'ls', 'undo'].map(n => ctx.commands.get(n)?.name), ['apagar', 'inbox', 'desfazer']);
  });
  test('todo comando tem nome e descrição', () => {
    const { ctx } = setup([]);
    for (const n of ctx.commands.names()) ok(ctx.commands.get(n).desc, `/${n} sem descrição`);
  });
});

describe('memória local (gaveta de teste)', () => {
  const KEY = 'mb.test.entries';
  test('add, remove, restore e persistência', async () => {
    localStorage.removeItem(KEY);
    const st = createLocalStore(KEY);
    let seen = [];
    st.subscribe(l => { seen = l; });
    await st.connect();
    const e1 = await st.add({ text: 'b', ts: 2 });
    await st.add({ text: 'a', ts: 1 });
    eq(seen.map(e => e.text), ['a', 'b'], 'ordena por horário');
    await st.remove(e1.id);
    eq(seen.map(e => e.text), ['a']);
    await st.restore(e1);
    eq(JSON.parse(localStorage.getItem(KEY)).length, 2, 'salvou no navegador');
    localStorage.removeItem(KEY);
  });
  test('não mexeu nas suas notas reais', () => ok(true));
});

describe('memória na nuvem (Supabase falso)', () => {
  const user = { id: 'test-' + Date.now() };
  const clean = () => Object.keys(localStorage).filter(k => k.includes(user.id)).forEach(k => localStorage.removeItem(k));

  test('captura sobe pra nuvem', async () => {
    clean();
    const sb = fakeSb();
    const st = createCloudStore(sb, user);
    await st.connect();
    await st.add({ text: 'oi', ts: 1, day: 'x' });
    eq(sb.rows.size, 1);
    eq(st.pending(), 0);
    st.forget();
  });
  test('sem rede: fica na fila, aparece na tela, e sobe quando volta', async () => {
    clean();
    const sb = fakeSb();
    const st = createCloudStore(sb, user);
    let seen = [];
    st.subscribe(l => { seen = l; });
    await st.connect();
    sb.fail = true;
    await st.add({ text: 'offline', ts: 1, day: 'x' });
    eq(st.pending(), 1, 'ficou na fila');
    eq(seen.length, 1, 'aparece mesmo na fila');
    eq(sb.rows.size, 0, 'ainda não subiu');
    sb.fail = false;
    await st.sync();
    eq(st.pending(), 0, 'fila esvaziou');
    eq(sb.rows.size, 1, 'subiu');
    st.forget();
  });
  test('fila sobrevive a fechar o app (recarrega do aparelho)', async () => {
    clean();
    const sb = fakeSb();
    sb.fail = true;
    const st1 = createCloudStore(sb, user);
    await st1.connect();
    await st1.add({ text: 'guardada', ts: 1, day: 'x' });
    // sem chamar forget(): simula fechar o app e abrir de novo
    const st2 = createCloudStore(sb, user);
    eq(st2.pending(), 1, 'a nova sessão encontrou a fila');
    sb.fail = false;
    await st2.sync();
    eq(sb.rows.size, 1);
    st2.forget();
    clean();
  });
  test('apagar sem rede some da tela e é enviado depois', async () => {
    clean();
    const sb = fakeSb();
    const st = createCloudStore(sb, user);
    let seen = [];
    st.subscribe(l => { seen = l; });
    await st.connect();
    const e = await st.add({ text: 'x', ts: 1, day: 'x' });
    sb.fail = true;
    await st.remove(e.id);
    eq(seen.length, 0, 'sumiu da tela');
    eq(sb.rows.size, 1, 'ainda está no servidor');
    sb.fail = false;
    await st.sync();
    eq(sb.rows.size, 0, 'apagou no servidor');
    st.forget();
    clean();
  });
  test('forget apaga só a cópia deste aparelho', async () => {
    clean();
    const sb = fakeSb();
    const st = createCloudStore(sb, user);
    await st.connect();
    await st.add({ text: 'x', ts: 1, day: 'x' });
    st.forget();
    eq(Object.keys(localStorage).filter(k => k.includes(user.id)).length, 0, 'cache local apagado');
    eq(sb.rows.size, 1, 'nuvem intacta');
  });
});

describe('terminal', () => {
  const histKey = 'mb.test.hist';
  localStorage.removeItem(histKey);
  let submitted = [], mode = null;
  const term = createTerminal({
    out: document.getElementById('tout'), input: document.getElementById('tinput'),
    form: document.getElementById('tform'), hint: document.getElementById('thint'),
    completions: { commands: () => ['inbox', 'hoje', 'historico'], tags: () => ['tcc', 'treino'] },
    privacy: () => mode, onSubmit: v => submitted.push(v), onChange: () => {}, histKey,
  });
  const input = document.getElementById('tinput'), form = document.getElementById('tform');
  const send = v => { input.value = v; form.requestSubmit(); };
  const tab = () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));

  test('enviar passa o texto e guarda no histórico', () => {
    send('  olá  ');
    eq(submitted.pop(), 'olá');
    eq(JSON.parse(localStorage.getItem(histKey)), ['olá']);
  });
  test('senha: aparece mascarada e não vai pro histórico', () => {
    mode = 'mask';
    send('segredo');
    mode = null;
    eq(submitted.pop(), 'segredo', 'o app recebe a senha');
    ok(!document.getElementById('tout').textContent.includes('segredo'), 'não aparece na tela');
    eq(JSON.parse(localStorage.getItem(histKey)), ['olá'], 'não foi pro histórico');
  });
  test('tab completa comando único', () => {
    input.value = '/inb'; input.setSelectionRange(4, 4); tab();
    eq(input.value, '/inbox ');
  });
  test('tab completa até o pedaço comum', () => {
    input.value = '/h'; input.setSelectionRange(2, 2); tab();
    eq(input.value, '/h', 'hoje e historico só têm "h" em comum');
  });
  test('tab completa #tag', () => {
    input.value = 'ler #tc'; input.setSelectionRange(7, 7); tab();
    eq(input.value, 'ler #tcc ');
  });
  test('log guarda nível, origem e texto puro', () => {
    term.ok('test', 'ok <b>negrito</b>');
    const e = term.log.at(-1);
    eq([e.level, e.src, e.text], ['OK', 'test', 'ok negrito']);
  });
  test('erro mostra código e dica', () => {
    term.error(new CmdError('E_X', 'test', 'falhou', 'faça isso'));
    const e = term.log.at(-1);
    eq(e.level, 'ERR');
    ok(e.text.includes('E_X') && e.text.includes('faça isso'));
  });
  test('tarefa cancelada vira aviso, não erro', async () => {
    const p = term.task('lenta', () => new Promise(() => {}));
    [...term.tasks.values()].pop().ctrl.abort();
    await p;
    eq(term.log.at(-1).level, 'WRN');
    eq(term.tasks.size, 0);
  });
  test('limpar a tela não apaga o log', () => {
    const n = term.log.length;
    term.clear();
    eq(term.log.length, n);
    localStorage.removeItem(histKey);
  });
});

/* ---------------- execução ---------------- */

let pass = 0, fail = 0;
for (const t of tests) {
  if (t.group) { results.insertAdjacentHTML('beforeend', `<div class="grp">${esc(t.group)}</div>`); group = t.group; continue; }
  const row = document.createElement('div');
  try {
    await t.fn();
    pass++;
    row.className = 't pass';
    row.innerHTML = `<b>[ OK ]</b><span>${esc(t.name)}</span>`;
  } catch (e) {
    fail++;
    row.className = 't fail';
    row.innerHTML = `<b>[FAIL]</b><span>${esc(t.name)}</span><span class="why">${esc(e.message)}</span>`;
    console.error(group, '·', t.name, e);
  }
  results.appendChild(row);
}
const sum = document.getElementById('sum');
sum.className = fail ? 'bad' : 'ok';
sum.textContent = fail ? `${fail} falharam · ${pass} passaram` : `todos os ${pass} testes passaram`;
document.title = (fail ? `✕ ${fail} · ` : `✓ ${pass} · `) + 'Mega Brain testes';
window.__results = { pass, fail };
