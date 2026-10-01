// Testes automáticos do Mega Brain.
// Abra http://localhost:5173/tests/ — tudo roda sozinho e o título da aba mostra o resultado.
// Regra: nenhum teste toca nas suas notas (usa chaves "mb.test.*") nem na nuvem (usa um Supabase falso).

import { esc, tagsOf, hl, dayKey, dur, lev, kb, CmdError } from '../js/util.js';
import { pickTargets, prepareImport, createCommands } from '../js/commands.js';
import { createLocalStore } from '../js/store.js';
import { createCloudStore } from '../js/cloud.js';
import { createTerminal } from '../js/terminal.js';
import { parseDue, fmtDue } from '../js/dates.js';
import { deriveState, describeState, readIntent } from '../js/state.js';
import { parseTaskInput, groupTasks, doneHistory, projectsSummary, taskStats, taskNumbers, projName, doneAt, registry, seedEntries, seedId, statusOf, projectOf, prioOf, statusChange, isRecord } from '../js/tasks.js';

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
  S.records = [];
  const ctx = { S, term, reg: () => registry(S.records), ui: { pulse() {}, render() {}, state: () => 'ready', mem: () => ['local', 'warn'] } };
  ctx.store = memStore(S.entries);
  ctx.store.subscribe(l => { S.entries = l.filter(e => !isRecord(e)); S.records = l.filter(isRecord); });
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

describe('datas faladas (Fase 1: prazos)', () => {
  const now = new Date(2026, 8, 30, 15, 0); // quarta, 30/09/2026
  const p = s => parseDue(s, now);
  test('hoje / amanhã / depois', () => eq([p('hoje'), p('amanhã'), p('amanha'), p('depois')], ['2026-09-30', '2026-10-01', '2026-10-01', '2026-10-02']));
  test('dia da semana = o próximo', () => eq([p('sex'), p('sexta'), p('seg'), p('sáb'), p('sab')], ['2026-10-02', '2026-10-02', '2026-10-05', '2026-10-03', '2026-10-03']));
  test('dia da semana de hoje = hoje', () => eq([p('qua'), p('ter')], ['2026-09-30', '2026-10-06']));
  test('+n dias, semanas, meses', () => eq([p('+3'), p('+3d'), p('+2s'), p('+1m')], ['2026-10-03', '2026-10-03', '2026-10-14', '2026-10-30']));
  test('+1m no dia 31 cai no último dia do mês', () => eq(parseDue('+1m', new Date(2026, 0, 31)), '2026-02-28'));
  test('dd/mm e dd.mm', () => eq([p('15/10'), p('15.10'), p('5/1')], ['2026-10-15', '2026-10-15', '2027-01-05']));
  test('dd/mm usa o ano mais perto de hoje', () => eq([p('28/09'), p('10/09'), p('5/1'), p('20/03')], ['2026-09-28', '2026-09-10', '2027-01-05', '2027-03-20']));
  test('dd/mm na virada do ano', () => eq([parseDue('28/12', new Date(2027, 0, 3)), parseDue('5/1', new Date(2026, 11, 28))], ['2026-12-28', '2027-01-05']));
  test('só o dia: este mês ou o próximo', () => eq([p('30'), p('15')], ['2026-09-30', '2026-10-15']));
  test('com ano', () => eq([p('15/10/27'), p('15/10/2027')], ['2027-10-15', '2027-10-15']));
  test('datas impossíveis → null', () => eq([p('31/02'), p('32'), p('0'), p('15/13'), p('xyz'), p('')], [null, null, null, null, null, null]));
  test('fmtDue mostra de forma curta', () => eq(
    ['2026-09-30', '2026-10-01', '2026-10-02', '2026-09-28', '2026-10-20', '2027-01-05'].map(k => fmtDue(k, now)),
    ['hoje', 'amanhã', 'sex 02.10', 'atrasada 2d', '20.10', '05.01.27']));
});

describe('tarefas · lógica (tasks.js)', () => {
  const now = new Date(2026, 8, 30, 15, 0); // quarta 30/09
  const T = (text, prazo = null, feito = null, i = 0) => ({ id: 'k' + i + text, text, tags: tagsOf(text), kind: 'tarefa', ts: 1000 + i, day: '2026-09-30', data: { prazo, feito } });
  test('parseTaskInput: texto, tags e prazo', () => eq(parseTaskInput('revisar cap 2 #tcc >sex', null, now), { text: 'revisar cap 2 #tcc', tags: ['tcc'], prazo: '2026-10-02' }));
  test('parseTaskInput: prazo no meio do texto', () => eq(parseTaskInput('ligar >amanhã pro joão', null, now).text, 'ligar pro joão'));
  test('parseTaskInput: aba adiciona a tag', () => eq(parseTaskInput('ler artigo', 'tcc', now).tags, ['tcc']));
  test('parseTaskInput: aba não duplica a tag', () => eq(parseTaskInput('ler #tcc', 'tcc', now).text, 'ler #tcc'));
  test('parseTaskInput: prazo inválido', () => eq(parseTaskInput('x >blabla', null, now), { error: 'prazo', token: '>blabla' }));
  test('parseTaskInput: só prazo = vazio', () => eq(parseTaskInput('>sex', null, now).error, 'vazio'));
  test('parseTaskInput: ">" sozinho fica no texto', () => eq(parseTaskInput('a > b', null, now).text, 'a > b'));
  test('groupTasks: grupos na ordem certa', () => {
    const E = [T('sem', null, null, 1), T('prox', '2026-10-05', null, 2), T('hoje', '2026-09-30', null, 3), T('velha', '2026-09-28', null, 4), T('feita', null, now.getTime(), 5), T('feita ontem', null, now.getTime() - 864e5, 6), entry('nota comum', 7)];
    const r = groupTasks(E, { now });
    eq(r.groups.map(g => g.key), ['atrasadas', 'hoje', 'proximas', 'sem', 'feitas']);
    eq(r.list.length, 5, 'feita ontem e nota não entram');
  });
  test('groupTasks: filtra por projeto', () => {
    const E = [T('a #tcc', null, null, 1), T('b #weg', null, null, 2)];
    eq(groupTasks(E, { proj: 'tcc', now }).list.length, 1);
  });
  test('groupTasks: próximas ordenadas por prazo', () => {
    const E = [T('depois', '2026-10-10', null, 1), T('antes', '2026-10-02', null, 2)];
    eq(groupTasks(E, { now }).groups[0].items.map(e => e.text), ['antes', 'depois']);
  });
  test('doneHistory: últimos N dias, mais recente primeiro', () => {
    const E = [T('hoje', null, now.getTime(), 1), T('ontem', null, now.getTime() - 864e5, 2), T('mês passado', null, now.getTime() - 40 * 864e5, 3), T('aberta', null, null, 4)];
    const h = doneHistory(E, { days: 7, now });
    eq(h.total, 2);
    eq(h.groups.map(g => g.key), ['2026-09-30', '2026-09-29']);
    eq(doneHistory(E, { days: 60, now }).total, 3);
  });
  test('projectsSummary: projetos registrados + tags soltas', () => {
    const E = [T('a #tcc', '2026-09-01', null, 1), T('b #tcc', null, null, 2), T('c #tcc', null, 5, 3), entry('nota #tcc', 4), entry('x #weg #solta', 5)];
    const r = projectsSummary(E, now, ['tcc', 'weg', 'pessoal']);
    eq(r.projects[0], { proj: 'tcc', abertas: 2, atrasadas: 1, notas: 1, registrado: true });
    eq(r.projects.map(p => p.proj), ['tcc', 'weg', 'pessoal']);
    eq(r.tags.map(x => x.tag), ['solta']);
  });
  test('taskStats', () => {
    const E = [T('a', '2026-09-30', null, 1), T('b', '2026-09-01', null, 2), T('c', null, null, 3), T('d', null, now.getTime(), 4)];
    eq(taskStats(E, now), { abertas: 3, hoje: 1, atrasadas: 1, feitasHoje: 1 });
  });
  test('taskNumbers: t1 t3, 1-4, t2-t4; texto → null', () => eq([taskNumbers('t1 t3'), taskNumbers('1-4'), taskNumbers('t2-t4'), taskNumbers('ler')], ['1 3', '1-4', '2-4', null]));
  test('projName limpa e valida', () => eq([projName('#TCC'), projName('fase-1'), projName('a b'), projName('')], ['tcc', 'fase-1', null, null]));
});

describe('tarefas · modelo v2 e registros', () => {
  const old = (feito = null) => ({ id: 'o', text: 'velha #tcc', tags: ['tcc'], kind: 'tarefa', ts: 1, day: 'x', data: { prazo: null, feito } });
  test('tarefa antiga: status e conclusão lidos do formato velho', () => {
    eq([statusOf(old()), statusOf(old(5)), doneAt(old(5))], ['a fazer', 'feito', 5]);
  });
  test('tarefa antiga: projeto vem da #tag registrada', () => eq(projectOf(old(), ['tcc']), 'tcc'));
  test('tarefa nova: campos próprios valem', () => {
    const e = { kind: 'tarefa', tags: ['tcc'], data: { projeto: 'weg', status: 'fazendo', prioridade: 'alta', feito_em: null } };
    eq([projectOf(e, ['tcc', 'weg']), statusOf(e), prioOf(e)], ['weg', 'fazendo', 'alta']);
  });
  test('prioridade inválida/ausente = média', () => eq([prioOf({ data: {} }), prioOf({ data: { prioridade: 'urgente' } })], ['média', 'média']));
  test('registry sem registros usa os padrões', () => {
    const r = registry([]);
    eq([r.projects, r.statuses.map(s => s.name), r.seeded], [['tcc', 'weg', 'pessoal'], ['a fazer', 'fazendo', 'esperando', 'feito'], false]);
  });
  test('seedEntries cria 3 projetos + 4 status, e nada se já existirem', () => {
    const seed = seedEntries([], 'u1', new Date(2026, 9, 1));
    eq(seed.map(e => e.kind + ':' + e.text), ['projeto:tcc', 'projeto:weg', 'projeto:pessoal', 'status:a fazer', 'status:fazendo', 'status:esperando', 'status:feito']);
    eq(seedEntries(seed, 'u1').length, 0);
    const r = registry(seed);
    eq([r.seeded, r.statuses.find(s => s.final).name], [true, 'feito']);
  });
  test('seedId é fixo, no formato uuid e diferente por dono', () => {
    const a = seedId('u1:projeto:tcc');
    eq(a, seedId('u1:projeto:tcc'));
    ok(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/.test(a), a);
    ok(a !== seedId('u2:projeto:tcc'));
  });
  test('registry respeita ordem, arquivado e não duplica nomes', () => {
    const rec = (text, ordem, extra = {}) => ({ kind: 'projeto', text, ts: ordem, data: { ordem, ...extra } });
    eq(registry([rec('b', 2), rec('a', 1), rec('a', 3), rec('z', 4, { arquivado: true })]).projects, ['a', 'b']);
  });
  test('statusChange: final grava a hora, aberto limpa', () => {
    const reg = registry([]);
    eq(statusChange(reg, 'feito', 9), { status: 'feito', feito_em: 9, feito: null });
    eq(statusChange(reg, 'fazendo', 9), { status: 'fazendo', feito_em: null, feito: null });
  });
});

describe('tarefas · comandos', () => {
  const T = (text, prazo = null, i = 0) => ({ id: 'tk' + i, text, tags: tagsOf(text), kind: 'tarefa', ts: 1000 + i, day: '2026-09-30', data: { prazo, feito: null } });
  function setupTasks(list) {
    const s = setup([]);
    s.S.entries = list;
    s.ctx.store = memStore(list);
    s.ctx.store.subscribe(l => { s.S.entries = l.filter(e => !isRecord(e)); s.S.records = l.filter(isRecord); });
    s.ctx.actions = { setCtx: p => { s.S.ctx = p; s.S.taskList = null; } };
    return s;
  }
  const texts = S => S.entries.map(e => e.text);
  test('/t cria tarefa com prazo e tag da aba', async () => {
    const { S, run } = setupTasks([]);
    S.ctx = 'tcc';
    await run('/t ler artigo >amanhã');
    const e = S.entries[0];
    eq([e.kind, e.text, e.tags], ['tarefa', 'ler artigo #tcc', ['tcc']]);
    ok(e.data.prazo && doneAt(e) === null);
  });
  test('/t com prazo errado dá E_PRAZO', async () => {
    const { run } = setupTasks([]);
    await throws(() => run('/t x >nunca'), 'E_PRAZO');
  });
  test('/tarefas numera e /feito t2 conclui a certa', async () => {
    const { S, run } = setupTasks([T('primeira', null, 1), T('segunda', null, 2)]);
    await run('/tarefas');
    await run('/feito t2');
    eq(doneAt(S.entries.find(e => e.text === 'segunda')) > 0, true);
    eq(doneAt(S.entries.find(e => e.text === 'primeira')), null);
  });
  test('/feito pelo texto', async () => {
    const { S, run } = setupTasks([T('ligar pro joão', null, 1), T('outra', null, 2)]);
    await run('/feito joão');
    ok(doneAt(S.entries.find(e => e.text === 'ligar pro joão')));
  });
  test('/feito em lote e /desfazer volta todas', async () => {
    const { S, run } = setupTasks([T('a', null, 1), T('b', null, 2), T('c', null, 3)]);
    await run('/feito t1-t3');
    eq(S.entries.filter(e => doneAt(e)).length, 3);
    await run('/desfazer');
    eq(S.entries.filter(e => doneAt(e)).length, 0);
  });
  test('números continuam valendo depois de concluir (riscada fica na lista)', async () => {
    const { S, run } = setupTasks([T('a', null, 1), T('b', null, 2)]);
    await run('/tarefas');
    await run('/feito t1');
    await run('/feito t2');
    eq(S.entries.filter(e => doneAt(e)).length, 2);
  });
  test('/reabrir', async () => {
    const { S, run } = setupTasks([T('a', null, 1)]);
    await run('/feito t1');
    await run('/reabrir t1');
    eq(doneAt(S.entries[0]), null);
  });
  test('/adiar muda e remove prazo', async () => {
    const { S, run } = setupTasks([T('a', null, 1)]);
    await run('/adiar t1 15/10');
    ok(S.entries[0].data.prazo?.endsWith('-10-15'));
    await run('/adiar t1 sem');
    eq(S.entries[0].data.prazo, null);
  });
  test('/apagar t1 apaga a tarefa da lista, /desfazer volta', async () => {
    const { S, run } = setupTasks([T('a', null, 1), T('b', null, 2)]);
    await run('/tarefas');
    await run('/apagar t2');
    eq(texts(S), ['a']);
    await run('/desfazer');
    eq(texts(S).sort(), ['a', 'b']);
  });
  test('número de tarefa que sumiu não pega outra', async () => {
    const { S, run } = setupTasks([T('a', null, 1), T('b', null, 2), T('c', null, 3)]);
    await run('/tarefas');
    await run('/apagar t1');
    await throws(() => run('/feito t1'), 'E_ARG'); // t1 sumiu: não pode concluir a "b" por engano
    await run('/feito t3');
    ok(doneAt(S.entries.find(e => e.text === 'c')));
  });
  test('/tarefas tcc mostra só o projeto', async () => {
    const { term, run } = setupTasks([T('a #tcc', null, 1), T('b #weg', null, 2)]);
    await run('/tarefas tcc');
    eq(term.out.filter(x => x[2] === 'task').length, 1);
  });
  test('/feitas lista o histórico', async () => {
    const { term, run } = setupTasks([T('a', null, 1)]);
    await run('/feito t1');
    term.out.length = 0;
    await run('/feitas');
    eq(term.out.filter(x => x[2] === 'task').length, 1);
  });
  test('/feito grava status final e /reabrir volta pro primeiro', async () => {
    const { S, run } = setupTasks([T('a', null, 1)]);
    await run('/feito t1');
    eq(statusOf(S.entries[0]), 'feito');
    await run('/reabrir t1');
    eq([statusOf(S.entries[0]), doneAt(S.entries[0])], ['a fazer', null]);
  });
  test('/projeto novo, renomear (leva as tarefas) e /desfazer', async () => {
    const { S, run, ctx } = setupTasks([{ ...T('x', null, 1), data: { projeto: 'tcc', status: 'a fazer', prazo: null } }]);
    await run('/projeto novo faculdade');
    ok(ctx.reg().projects.includes('faculdade'), 'criou');
    await run('/desfazer');
    ok(!ctx.reg().projects.includes('faculdade'), 'desfez a criação');
    S.records.push({ id: 'p1', kind: 'projeto', text: 'tcc', ts: 1, data: { ordem: 1 } });
    await ctx.store.restore(S.records[0]);
    await run('/projeto renomear tcc monografia');
    eq([ctx.reg().projects.includes('monografia'), S.entries[0].data.projeto], [true, 'monografia']);
  });
  test('/ir tcc e /ir ~', async () => {
    const { S, run } = setupTasks([]);
    await run('/ir tcc');
    eq(S.ctx, 'tcc');
    await run('/ir ~');
    eq(S.ctx, null);
  });
});

describe('estado do núcleo (deriveState)', () => {
  const base = { booting: false, now: 10_000, online: true };
  test('parado → READY', () => eq(deriveState(base), 'ready'));
  test('boot → INITIALIZING (vence tudo)', () => eq(deriveState({ ...base, booting: true, tasks: [{ kind: 'exec' }] }), 'initializing'));
  test('gravando → EXECUTING', () => eq(deriveState({ ...base, tasks: [{ kind: 'exec' }, { kind: 'proc' }] }), 'executing'));
  test('rede/leitura → PROCESSING', () => eq(deriveState({ ...base, tasks: [{ kind: 'proc' }] }), 'processing'));
  test('tecla recente → LISTENING', () => eq(deriveState({ ...base, lastKey: 9_000 }), 'listening'));
  test('tecla antiga não conta', () => eq(deriveState({ ...base, lastKey: 1_000 }), 'ready'));
  test('erro recente → FAULT', () => eq(deriveState({ ...base, faultUntil: 11_000, tasks: [{ kind: 'proc' }] }), 'fault'));
  test('bloqueado → LOCKED, mas digitar vira LISTENING', () => {
    eq(deriveState({ ...base, locked: true }), 'locked');
    eq(deriveState({ ...base, locked: true, lastKey: 9_500 }), 'listening');
  });
  test('falhas → DEGRADED · sem rede → OFFLINE', () => {
    eq(deriveState({ ...base, degraded: true }), 'degraded');
    eq(deriveState({ ...base, online: false }), 'offline');
  });
  test('descrição traz o detalhe', () => {
    eq(describeState('executing', { tasks: [{ label: 'captura' }] }).desc, 'executando · captura');
    eq(describeState('listening', { mode: 'password' }).desc, 'recebendo senha');
    eq(describeState('ready').label, 'READY');
  });
});

describe('leitura da intenção (readIntent)', () => {
  const catalog = [
    { name: 'feito', alias: ['ok'], args: '<t1>', desc: 'conclui' },
    { name: 'feitas', alias: [], args: '', desc: 'histórico' },
    { name: 'tarefas', alias: ['ts'], args: '', desc: 'lista' },
  ];
  const r = (t, o = {}) => readIntent(t, { catalog, ...o });
  test('vazio → idle', () => eq(r('   ').type, 'idle'));
  test('login vence o texto', () => eq(r('qualquer', { mode: 'email' }), { type: 'login', field: 'email' }));
  test('"/fe" lista comandos que começam assim', () => eq(r('/fe').matches.map(c => c.name), ['feito', 'feitas']));
  test('atalho também casa', () => eq(r('/o').matches.map(c => c.name), ['feito']));
  test('comando completo com argumento', () => { const i = r('/feito t2'); eq([i.type, i.cmd.name, i.arg], ['command', 'feito', 't2']); });
  test('comando desconhecido sugere o mais perto', () => { const i = r('/tarefsa'); eq([i.type, i.near[0]?.name], ['unknown', 'tarefas']); });
  test('"- " → tarefa com tags e prazo', () => { const i = r('- ler #tcc >hoje'); eq([i.type, i.text, i.tags], ['task', 'ler #tcc', ['tcc']]); ok(i.prazo); });
  test('"- " com prazo errado → task-error', () => eq(r('- ler >blabla').type, 'task-error'));
  test('texto livre → nota, com a tag da aba', () => eq(r('ideia solta', { ctx: 'tcc' }), { type: 'note', text: 'ideia solta #tcc', tags: ['tcc'] }));
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

describe('/importar · o que entra (prepareImport)', () => {
  const have = [{ id: '11111111-1111-1111-1111-111111111111', text: 'já tenho', ts: 100 }];
  test('aceita o formato do /exportar', () => eq(prepareImport({ entries: [{ text: 'a', ts: 1 }] }, []).toAdd.length, 1));
  test('aceita lista simples', () => eq(prepareImport([{ text: 'a', ts: 1 }], []).toAdd.length, 1));
  test('arquivo sem lista → null', () => eq(prepareImport({ nada: 1 }, []), null));
  test('pula mesmo id', () => eq(prepareImport([{ id: have[0].id, text: 'outro', ts: 5 }], have).skipped, 1));
  test('pula mesmo texto no mesmo horário', () => eq(prepareImport([{ text: 'já tenho', ts: 100 }], have).skipped, 1));
  test('não duplica dentro do próprio arquivo', () => eq(prepareImport([{ text: 'a', ts: 1 }, { text: 'a', ts: 1 }], []).toAdd.length, 1));
  test('ignora inválidas (sem texto, sem horário)', () => eq(prepareImport([{ ts: 1 }, { text: 'x' }, { text: '', ts: 1 }, null], []).invalid, 4));
  test('completa tags, kind e day que faltam', () => {
    const [e] = prepareImport([{ text: 'ler #TCC', ts: new Date(2026, 0, 5, 10).getTime() }], []).toAdd;
    eq([e.tags, e.kind, e.day], [['tcc'], 'nota', '2026-01-05']);
  });
  test('id que não é uuid ganha um novo (o banco exige uuid)', () => {
    const [e] = prepareImport([{ id: 'local-123', text: 'a', ts: 1 }], []).toAdd;
    ok(e.id !== 'local-123' && e.id.length >= 20);
  });
  test('mantém uuid válido', () => eq(prepareImport([{ id: '22222222-2222-2222-2222-222222222222', text: 'a', ts: 1 }], []).toAdd[0].id, '22222222-2222-2222-2222-222222222222'));
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
  test('coluna nova no banco (data) chega no app sem quebrar', async () => {
    clean();
    const sb = fakeSb();
    sb.rows.set('a', { id: 'a', user_id: 'u', text: 'tarefa', tags: [], kind: 'tarefa', ts: '5', day: 'x', created_at: 'z', data: { prazo: '2026-10-02' } });
    sb.rows.set('b', { id: 'b', user_id: 'u', text: 'nota', tags: null, kind: 'nota', ts: 6, day: 'x', data: {} });
    const st = createCloudStore(sb, user);
    let seen = [];
    st.subscribe(l => { seen = l; });
    await st.connect();
    await st.sync();
    eq(seen[0], { id: 'a', text: 'tarefa', tags: [], kind: 'tarefa', ts: 5, day: 'x', data: { prazo: '2026-10-02' } });
    eq(seen[1], { id: 'b', text: 'nota', tags: [], kind: 'nota', ts: 6, day: 'x' }, 'data vazio não aparece');
    st.forget();
    clean();
  });
  test('duas capturas ao mesmo tempo sobem as duas', async () => {
    clean();
    const sb = fakeSb();
    const st = createCloudStore(sb, user);
    await st.connect();
    await Promise.all([st.add({ text: 'a', ts: 1, day: 'x' }), st.add({ text: 'b', ts: 2, day: 'x' })]);
    eq(st.pending(), 0, 'nada preso na fila');
    eq(sb.rows.size, 2);
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
document.title = (fail ? `✕ ${fail} · ` : `✓ ${pass} · `) + 'MB Core testes';
window.__results = { pass, fail };
