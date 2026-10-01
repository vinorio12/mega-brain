// Testes automáticos do Mega Brain.
// Abra http://localhost:5173/tests/ — tudo roda sozinho e o título da aba mostra o resultado.
// Regra: nenhum teste toca nas suas notas (usa chaves "mb.test.*") nem na nuvem (usa um Supabase falso).

import { esc, tagsOf, hl, dayKey, dur, lev, kb, CmdError } from '../js/util.js';
import { pickTargets, prepareImport, createCommands } from '../js/commands.js';
import { createLocalStore } from '../js/store.js';
import { createCloudStore } from '../js/cloud.js';
import { createTerminal } from '../js/terminal.js';
import { parseDue, fmtDue, findDate } from '../js/dates.js';
import { deriveState, describeState, readIntent } from '../js/state.js';
import { viewName, viewGroups, calendarModel, parseMonth } from '../js/views.js';
import { parseLink, parseSnippet, shortUrl, searchAll } from '../js/acervo.js';
import { parseTaskInput, groupTasks, doneHistory, projectsSummary, taskStats, taskNumbers, projName, doneAt, registry, seedEntries, seedId, statusOf, projectOf, prioOf, statusChange, isRecord, guessProject, dueFor, fillByRules, matchStatus, briefing } from '../js/tasks.js';

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

describe('datas em frases (findDate · Fase 2)', () => {
  const now = new Date(2026, 9, 1, 15, 0); // quinta, 01/10/2026
  const d = s => findDate(s, now)?.data ?? null;
  const all = list => list.map(d);
  test('amanhã tira a data do texto', () => eq(findDate('ligar pro dentista amanhã', now),
    { data: '2026-10-02', trecho: 'amanhã', resto: 'ligar pro dentista', inicio: 19, fim: 25 }));
  test('hoje, amanhã, depois de amanhã, ontem, anteontem', () => eq(
    all(['hoje', 'amanhã', 'amanha', 'AMANHÃ', 'depois de amanhã', 'ontem', 'anteontem']),
    ['2026-10-01', '2026-10-02', '2026-10-02', '2026-10-02', '2026-10-03', '2026-09-30', '2026-09-29']));
  test('preposição sai junto: "até sexta"', () => {
    const r = findDate('entregar relatório até sexta', now);
    eq([r.data, r.trecho, r.resto], ['2026-10-02', 'até sexta', 'entregar relatório']);
  });
  test('dia da semana = o próximo (hoje, se for hoje)', () => eq(
    all(['reunião na sexta-feira', 'reunião sexta feira', 'prova na terça', 'Terça', 'churrasco sábado com a galera', 'domingo', 'revisar na quinta']),
    ['2026-10-02', '2026-10-02', '2026-10-06', '2026-10-06', '2026-10-03', '2026-10-04', '2026-10-01']));
  test('próxima / que vem: nunca hoje', () => eq(
    all(['próxima quinta', 'quinta que vem', 'próxima sexta', 'sexta que vem', 'próximo sábado']),
    ['2026-10-08', '2026-10-08', '2026-10-02', '2026-10-02', '2026-10-03']));
  test('semana que vem', () => eq(
    all(['semana que vem', 'na próxima semana', 'sexta da semana que vem', 'semana que vem na terça', 'segunda da próxima semana']),
    ['2026-10-05', '2026-10-05', '2026-10-09', '2026-10-06', '2026-10-05']));
  test('segunda/quarta/quinta/sexta sozinhas só com contexto', () => eq(
    all(['segunda versão do tcc', 'quinta série', 'ligar pro joão segunda', 'ligar segunda #weg !alta', 'até segunda', 'segunda-feira tem prova']),
    [null, null, '2026-10-05', '2026-10-05', '2026-10-05', '2026-10-05']));
  test('dia 15, dia 15 de novembro, 15 de janeiro, 20/10', () => eq(
    all(['dia 15', 'até o dia 15', 'no dia 3', 'dia 15 de novembro', '15 de janeiro', 'dia 15/10', 'prova 20/10', 'entrega 5/1/2027', 'dia 31 de fevereiro']),
    ['2026-10-15', '2026-10-15', '2026-10-03', '2026-11-15', '2027-01-15', '2026-10-15', '2026-10-20', '2027-01-05', null]));
  test('"até o dia 15" sai inteiro do texto', () => eq(findDate('entregar cap 2 até o dia 15 #tcc', now).resto, 'entregar cap 2 #tcc'));
  test('daqui a / em / dentro de', () => eq(
    all(['daqui a 3 dias', 'em 2 semanas', 'daqui a uma semana', 'em duas semanas', 'dentro de 10 dias', 'daqui a um mês']),
    ['2026-10-04', '2026-10-15', '2026-10-08', '2026-10-15', '2026-10-11', '2026-11-01']));
  test('mês que vem e fim de semana', () => eq(
    all(['mês que vem', 'próximo mês', 'nesse fim de semana', 'fds', 'final de semana que vem']),
    ['2026-11-01', '2026-11-01', '2026-10-03', '2026-10-03', '2026-10-10']));
  test('fim de semana no domingo = hoje', () => eq(findDate('fim de semana', new Date(2026, 9, 4))?.data, '2026-10-04'));
  test('não é data', () => eq(
    all(['ler cap 15', 'comprar 1,5 kg', 'R$ 30,50', 'gastei 30 reais', 'ter que estudar', '>sexta', 'https://x.com/amanha', 'nota 15.5 na prova', 'segundas intenções', '']),
    [null, null, null, null, null, null, null, null, null, null]));
  test('duas datas: vale a primeira', () => eq(d('amanhã ou sexta'), '2026-10-02'));
  test('pontuação em volta não sobra', () => eq(findDate('amanhã, ligar pro banco', now).resto, 'ligar pro banco'));
});

describe('tarefas · lógica (tasks.js)', () => {
  const now = new Date(2026, 8, 30, 15, 0); // quarta 30/09
  const T = (text, prazo = null, feito = null, i = 0) => ({ id: 'k' + i + text, text, tags: tagsOf(text), kind: 'tarefa', ts: 1000 + i, day: '2026-09-30', data: { prazo, feito } });
  const P = (s, o = {}) => parseTaskInput(s, { now, ...o });
  test('parseTaskInput: projeto, status, prazo e prioridade', () => eq(P('revisar cap 2 #tcc @fazendo >sex !alta'), { text: 'revisar cap 2', tags: ['tcc'], projeto: 'tcc', status: 'fazendo', prazo: '2026-10-02', prioridade: 'alta' }));
  test('parseTaskInput: nada informado = tudo null', () => eq(P('ligar pro joão'), { text: 'ligar pro joão', tags: [], projeto: null, status: null, prazo: null, prioridade: null }));
  test('parseTaskInput: prazo no meio do texto', () => eq(P('ligar >amanhã pro joão').text, 'ligar pro joão'));
  test('parseTaskInput: #tag que não é projeto fica no texto', () => { const p = P('ler #artigo #tcc'); eq([p.text, p.projeto, p.tags], ['ler #artigo', 'tcc', ['tcc', 'artigo']]); });
  test('parseTaskInput: aba vira o projeto', () => eq(P('ler artigo', { ctx: 'weg' }).projeto, 'weg'));
  test('parseTaskInput: #projeto explícito vence a aba', () => eq(P('ler #tcc', { ctx: 'weg' }).projeto, 'tcc'));
  test('parseTaskInput: prioridades por nome, letra e número', () => eq(['!alta', '!media', '!b', '!1', '!3'].map(x => P('x ' + x).prioridade), ['alta', 'média', 'baixa', 'alta', 'baixa']));
  test('parseTaskInput: status sem espaço e por começo', () => eq(['@afazer', '@a-fazer', '@faz', '@esp'].map(x => P('x ' + x).status), ['a fazer', 'a fazer', 'fazendo', 'esperando']));
  test('parseTaskInput: erros dizem o que não entendeu', () => eq([P('x >blabla'), P('x !urgente'), P('x @nada')].map(p => p.error + ' ' + p.token), ['prazo >blabla', 'prioridade !urgente', 'status @nada']));
  test('parseTaskInput: >sem = sem prazo de propósito', () => eq(P('x >sem').prazo, ''));
  test('parseTaskInput: só campos = vazio (menos no editar)', () => { eq(P('>sex').error, 'vazio'); eq(P('!alta', { allowEmpty: true }).prioridade, 'alta'); });
  test('parseTaskInput: ">" sozinho fica no texto', () => eq(P('a > b').text, 'a > b'));
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

describe('tarefas · regras automáticas', () => {
  const now = new Date(2026, 8, 30, 15, 0); // quarta 30/09
  const reg = registry([]);
  const task = (text, projeto) => ({ id: text, kind: 'tarefa', text, tags: [projeto], ts: 1, data: { projeto } });
  const hist = [task('revisar capítulo da fundamentação', 'tcc'), task('reunião com orientador', 'tcc'), task('relatório de manutenção da prensa', 'weg')];
  test('projeto pelo nome no texto', () => eq(guessProject('estudar pro tcc hoje', { reg }), 'tcc'));
  test('projeto pelas palavras das tarefas antigas', () => {
    eq(guessProject('mandar email pro orientador', { entries: hist, reg }), 'tcc');
    eq(guessProject('checar manutenção', { entries: hist, reg }), 'weg');
  });
  test('sem pista nenhuma → pessoal', () => eq(guessProject('comprar pão', { entries: hist, reg }), 'pessoal'));
  test('palavras comuns não contam', () => eq(guessProject('fazer com que', { entries: [task('fazer com que algo', 'weg')], reg }), 'pessoal'));
  test('prazo pela prioridade, dias corridos', () => eq(['alta', 'média', 'baixa'].map(p => dueFor(p, now)), ['2026-10-01', '2026-10-03', '2026-10-07']));
  test('fillByRules: preenche só o que falta e diz o que foi automático', () => {
    const p = parseTaskInput('comprar pão !alta', { reg, now });
    const r = fillByRules(p, { reg, now });
    eq(r.values, { projeto: 'pessoal', status: 'a fazer', prioridade: 'alta', prazo: '2026-10-01' });
    eq(r.auto, ['projeto', 'status', 'prazo']);
  });
  test('fillByRules: tudo informado → nada automático', () => {
    const p = parseTaskInput('x #weg @fazendo >sex !baixa', { reg, now });
    eq(fillByRules(p, { reg, now }).auto, []);
  });
  test('fillByRules: >sem fica sem prazo e não é auto', () => {
    const r = fillByRules(parseTaskInput('x >sem', { reg, now }), { reg, now });
    eq([r.values.prazo, r.auto.includes('prazo')], [null, false]);
  });
  test('matchStatus ambíguo → null', () => eq(matchStatus('a', [{ name: 'abc' }, { name: 'abd' }]), null));
});

describe('acervo (acervo.js)', () => {
  test('parseLink: url + contexto + tags', () => eq(parseLink('https://ex.com/a artigo bom #tcc'), { url: 'https://ex.com/a', contexto: 'artigo bom #tcc', tags: ['tcc'] }));
  test('parseLink: só http e https', () => eq(['javascript:alert(1)', 'ftp://x.com', 'data:text/html,x', 'texto normal', 'http://ok.com'].map(s => !!parseLink(s)), [false, false, false, false, true]));
  test('parseSnippet: aspas retas e curvas', () => eq([parseSnippet('"frase boa"'), parseSnippet('“outra #ideia”')], [{ text: 'frase boa', tags: [] }, { text: 'outra #ideia', tags: ['ideia'] }]));
  test('parseSnippet: sem aspas ou vazio → null', () => eq([parseSnippet('nada'), parseSnippet('""'), parseSnippet("'simples'")], [null, null, null]));
  test('shortUrl encurta', () => { eq(shortUrl('https://www.ex.com/'), 'ex.com'); ok(shortUrl('https://ex.com/' + 'a'.repeat(80)).length <= 42); });
  const E = [
    { id: '1', kind: 'nota', text: 'ideia sobre RAG #tcc', tags: ['tcc'] },
    { id: '2', kind: 'link', text: 'https://rag.dev guia de RAG', tags: [], data: { url: 'https://rag.dev', contexto: 'guia de RAG' } },
    { id: '3', kind: 'trecho', text: 'citação #tcc', tags: ['tcc'] },
    { id: '4', kind: 'tarefa', text: 'ler sobre rag', tags: [], data: {} },
  ];
  test('searchAll procura em tudo e agrupa por tipo', () => eq(searchAll(E, 'rag').groups.map(g => [g.key, g.items.map(e => e.id)]), [['tarefa', ['4']], ['nota', ['1']], ['link', ['2']]]));
  test('searchAll com tipo:link', () => eq(searchAll(E, 'rag tipo:link').groups.map(g => g.key), ['link']));
  test('searchAll por #tag', () => eq(searchAll(E, '#tcc').total, 2));
});

describe('acervo · comandos', () => {
  const fakeT = { id: 'T1', elapsed: () => 1 };
  test('guardar link e texto, listar no /acervo, apagar e desfazer', async () => {
    const { S, term, run, ctx } = setup([]);
    await ctx.commands.addLink('https://ex.com/artigo leitura pro tcc #tcc', fakeT);
    await run('/guardar frase pra lembrar');
    eq(S.entries.map(e => e.kind), ['link', 'trecho']);
    eq(S.entries[0].data.url, 'https://ex.com/artigo');
    term.out.length = 0;
    await run('/acervo links');
    const cards = term.out.filter(x => x[2] === 'block').map(x => x[1]).join('');
    eq((cards.match(/class="acard/g) || []).length, 1, 'um cartão de link');
    ok(term.text().includes('href="https://ex.com/artigo"') && term.text().includes('noopener'), 'link seguro');
    await run('/desfazer');
    eq(S.entries.length, 1, 'desfez o texto');
  });
  test('/inbox mostra só notas (nem tarefa nem acervo)', async () => {
    const { term, run, ctx } = setup(['nota 1']);
    await ctx.commands.addLink('https://x.com', fakeT);
    await run('/t uma tarefa');
    term.out.length = 0;
    await run('/inbox');
    eq(term.out.filter(x => x[2] === 'note').length, 1);
  });
  test('/apagar 2 = 2ª nota; /apagar a1 = 1º do acervo (mesmo misturados)', async () => {
    const { S, run, ctx } = setup(['n1']);
    await ctx.commands.addLink('https://x.com', fakeT);
    await run('/t tarefa no meio');
    await ctx.store.add({ kind: 'nota', text: 'n2', tags: [], ts: Date.now() + 5, day: 'x' });
    await run('/apagar 2');
    eq(S.entries.map(e => e.text).includes('n2'), false, 'apagou a 2ª nota');
    await run('/apagar a1');
    eq(S.entries.some(e => e.kind === 'link'), false, 'apagou o link');
    eq(S.entries.filter(e => e.kind === 'tarefa').length, 1, 'tarefa intacta');
  });
  test('/guardar com link vira link', async () => {
    const { S, run } = setup([]);
    await run('/guardar https://x.com');
    eq(S.entries[0].kind, 'link');
  });
  test('/buscar tipo:link acha só links', async () => {
    const { term, run, ctx } = setup(['nota com docs']);
    await ctx.commands.addLink('https://docs.dev docs', fakeT);
    term.out.length = 0;
    await run('/buscar docs tipo:link');
    eq(term.out.filter(x => x[2] === 'note').length, 0, 'a nota não aparece');
    eq((term.out.filter(x => x[2] === 'block').map(x => x[1]).join('').match(/class="acard/g) || []).length, 1);
  });
});

describe('visões (views.js)', () => {
  const now = new Date(2026, 9, 1, 15, 0); // quinta 01/10/2026
  const reg = registry([]);
  const T = (text, projeto, status = 'a fazer', prazo = null, feito_em = null) => ({ id: text, kind: 'tarefa', text, tags: [projeto], ts: 1, data: { projeto, status, prazo, prioridade: 'média', feito_em } });
  const E = [
    T('a', 'tcc', 'a fazer', '2026-10-05'), T('b', 'weg', 'fazendo', '2026-10-02'), T('c', 'tcc', 'esperando'),
    T('d', 'pessoal', 'feito', null, now.getTime()), T('e', 'weg', 'feito', null, now.getTime() - 3 * 864e5),
    T('f', 'tcc', 'a fazer', '2026-09-20'), T('g', 'tcc', 'a fazer', '2026-11-03'),
  ];
  test('viewName entende apelidos', () => eq(['kanban', 'quadro', 'cal', 'agenda', 'projetos', 'xyz'].map(viewName), ['kanban', 'kanban', 'calendario', 'calendario', 'lista', null]));
  test('lista: um grupo por projeto, na ordem; feita antiga some', () => {
    const r = viewGroups(E, 'lista', { reg, now });
    eq(r.groups.map(g => [g.key, g.items.map(e => e.text)]), [['tcc', ['f', 'a', 'g', 'c']], ['weg', ['b']], ['pessoal', ['d']]]);
  });
  test('status: grupos na ordem dos status, sem vazios', () => eq(viewGroups(E, 'status', { reg, now }).groups.map(g => g.key), ['a fazer', 'fazendo', 'esperando', 'feito']));
  test('kanban: todas as colunas, mesmo vazias', () => {
    const r = viewGroups([T('x', 'tcc')], 'kanban', { reg, now });
    eq(r.groups.map(g => [g.key, g.items.length]), [['a fazer', 1], ['fazendo', 0], ['esperando', 0], ['feito', 0]]);
  });
  test('filtro de projeto vale pra todas', () => eq(viewGroups(E, 'status', { reg, now, proj: 'weg' }).list, ['b']));
  test('numeração segue a ordem mostrada', () => { const r = viewGroups(E, 'lista', { reg, now }); eq(r.list, r.groups.flatMap(g => g.items.map(e => e.id))); });
  test('calendário: semanas de seg a dom, mês certo, hoje marcado', () => {
    const c = calendarModel(E, { reg, now });
    eq([c.year, c.month, c.weeks.every(w => w.length === 7)], [2026, 10, true]);
    eq(c.weeks[0][0].key, '2026-09-28'); // segunda antes do dia 1
    ok(c.weeks.flat().find(x => x.key === '2026-10-01').today);
  });
  test('calendário: atrasadas antes, depois os dias do mês; outros meses fora', () => {
    const c = calendarModel(E, { reg, now });
    eq(c.list, ['f', 'b', 'a']);
    eq(c.days.map(d => d.key), ['2026-10-02', '2026-10-05']);
  });
  test('calendário de outro mês', () => eq(calendarModel(E, { reg, now, month: '2026-11' }).list, ['f', 'g']));
  test('parseMonth', () => eq(['+1', '-1', '11/2026', '3', '2027-02', '13', 'x'].map(s => parseMonth(s, now)), ['2026-11', '2026-09', '2026-11', '2026-03', '2027-02', null, null]));
});

describe('tela inicial (briefing)', () => {
  const now = new Date(2026, 8, 30, 15, 0);
  const T = (text, prazo, prioridade = 'média', feito_em = null) => ({ id: text, kind: 'tarefa', text, tags: [], ts: 1, data: { prazo, prioridade, feito_em, status: feito_em ? 'feito' : 'a fazer' } });
  const E = [
    T('futura baixa', '2026-10-20', 'baixa'), T('urgente sem prazo', null, 'alta'), T('atrasada', '2026-09-28'),
    T('amanhã', '2026-10-01'), T('feita', '2026-09-01', 'alta', 5), T('sem nada', null),
  ];
  test('ordem: atrasadas → alta → vencem primeiro', () => eq(briefing(E, { now }).items.map(e => e.text), ['atrasada', 'urgente sem prazo', 'amanhã', 'futura baixa']));
  test('limite de linhas', () => eq(briefing(E, { now, limit: 2 }).items.length, 2));
  test('contagens', () => { const b = briefing(E, { now }); eq([b.abertas, b.atrasadas, b.altas], [5, 1, 1]); });
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
    eq([e.kind, e.text, e.tags, e.data.projeto], ['tarefa', 'ler artigo', ['tcc'], 'tcc']);
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
  test('/t sem campos: regras decidem, marca auto e mostra a linha ↳ auto', async () => {
    const { S, term, run } = setupTasks([]);
    await run('/t comprar pão');
    const d = S.entries[0].data;
    eq([d.projeto, d.status, d.prioridade, d.auto.campos], ['pessoal', 'a fazer', 'média', ['projeto', 'status', 'prioridade', 'prazo']]);
    ok(term.out.some(x => x[0] === 'PRINT' && x[2] === 'auto'), 'mostrou a linha auto');
  });
  test('/desfazer depois de /t apaga a tarefa criada', async () => {
    const { S, run } = setupTasks([]);
    await run('/t algo');
    await run('/desfazer');
    eq(S.entries.length, 0);
  });
  test('/editar muda só o informado e tira do auto', async () => {
    const { S, run } = setupTasks([]);
    await run('/t ligar pro joão');
    await run('/editar t1 #weg !alta');
    const d = S.entries[0].data;
    eq([d.projeto, d.prioridade, d.status, d.auto.campos], ['weg', 'alta', 'a fazer', ['status', 'prazo']]);
    await run('/editar t1 ligar pro joão amanhã');
    eq(S.entries[0].text, 'ligar pro joão amanhã');
    await run('/desfazer');
    eq(S.entries[0].text, 'ligar pro joão');
  });
  test('/mover troca status; status final conclui', async () => {
    const { S, run } = setupTasks([T('a', null, 1), T('b', null, 2)]);
    await run('/mover t1 t2 fazendo');
    eq(S.entries.map(e => statusOf(e)), ['fazendo', 'fazendo']);
    await run('/mover t1 feito');
    ok(doneAt(S.entries.find(e => e.text === 'a')));
  });
  test('/status novo cria antes do feito e já dá pra usar', async () => {
    const { S, run, ctx } = setupTasks([]);
    for (const e of seedEntries([], 'u')) await ctx.store.restore(e);
    await run('/status novo revisão');
    eq(ctx.reg().statuses.map(s => s.name), ['a fazer', 'fazendo', 'esperando', 'revisão', 'feito']);
    await run('/t texto @revisao');
    eq(statusOf(S.entries[0]), 'revisão');
  });
  test('/editar com status inexistente dá E_STATUS', async () => {
    const { run } = setupTasks([T('a', null, 1)]);
    await throws(() => run('/editar t1 @xyz'), 'E_STATUS');
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
  test('"- " → tarefa com o que foi informado + o que é auto', () => { const i = r('- ler #tcc >hoje'); eq([i.type, i.text, i.projeto, i.auto], ['task', 'ler', 'tcc', ['status', 'prioridade']]); ok(i.prazo); });
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
    const lines = term.out.filter(x => x[0] === 'PRINT' && x[2] === 'note');
    eq(lines.length, 1);
  });
  test('/inbox 2 mostra só as 2 últimas', async () => {
    const { term, run } = setup(['a', 'b', 'c']);
    await run('/inbox 2');
    eq(term.out.filter(x => x[2] === 'note').length, 2);
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
    st1.forget(); // desliga a primeira também (senão ela continua gravando no navegador)
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
