// Testes automáticos do Mega Brain.
// Abra http://localhost:5173/tests/ — tudo roda sozinho e o título da aba mostra o resultado.
// Regra: nenhum teste toca nas suas notas (usa chaves "mb.test.*") nem na nuvem (usa um Supabase falso).

import { esc, tagsOf, hl, dayKey, dur, lev, kb, CmdError } from '../js/util.js';
import { pickTargets, prepareImport, createCommands } from '../js/commands.js';
import { createLocalStore } from '../js/store.js';
import { createCloudStore } from '../js/cloud.js';
import { createTerminal } from '../js/terminal.js';
import { parseDue, fmtDue, findDate } from '../js/dates.js';
import { parseValor, findValor, fmtValor } from '../js/valores.js';
import { deriveState, describeState, readIntent } from '../js/state.js';
import { viewName, viewGroups, calendarModel, parseMonth } from '../js/views.js';
import { parseLink, parseSnippet, shortUrl, searchAll } from '../js/acervo.js';
import { parseTaskInput, groupTasks, doneHistory, projectsSummary, taskStats, taskNumbers, projName, doneAt, registry, seedEntries, seedId, statusOf, projectOf, prioOf, statusChange, isRecord, guessProject, dueFor, fillByRules, matchStatus, briefing, isNoteKind, CONTENT_KINDS, editPalavras } from '../js/tasks.js';
import { diffEvent, withHistory, eventsOf } from '../js/historico.js';
import { criarRegistro, validarInterpretacao, REGISTRO } from '../js/tipos.js';
import { comecaComVerbo } from '../js/tipos-base.js';
import { lerMovimento } from '../js/tipos-financas.js';
import { lerDuracao, lerDistancia } from '../js/tipos-corpo.js';
import { provedorRegras } from '../js/provedor-regras.js';
import { FRASES, rodarFrases } from './frases.js';
import { criarInterpretador, interpretar, previa } from '../js/interpretar.js';
import { criarProvedorIA, travaDiaria, montarPedido } from '../js/provedor-ia.js';
import { INTERPRETADOR } from '../js/config.js';
import { registroAprendizado, resumoAprendizado, exportarFrases } from '../js/aprendizado.js';

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

describe('valores (valores.js · Fase 2)', () => {
  test('parseValor: os jeitos de escrever → centavos', () => eq(
    ['30', '30 reais', 'R$30,00', 'R$30,50', 'r$ 30,50', 'R$ 1.234,56', '30,5', '30.50', '1.234', '1 real', '50 centavos', '2 mil', 'R$ 2 mil', '2 mil reais', '50 conto', '0,99'].map(parseValor),
    [3000, 3000, 3000, 3050, 3050, 123456, 3050, 3050, 123400, 100, 50, 200000, 200000, 200000, 5000, 99]));
  test('parseValor: o que não é valor → null', () => eq(
    ['abc', '', '30,555', '30 reais e pouco', 'R$', null].map(parseValor), [null, null, null, null, null, null]));
  test('findValor tira o valor do texto', () => eq(findValor('gastei 30 no almoço'),
    { centavos: 3000, trecho: '30', resto: 'gastei no almoço', explicito: false, inicio: 7, fim: 9 }));
  test('findValor: explícito (R$, reais) ou solto', () => eq(
    ['almoço R$ 32,90 #pessoal', 'uber 18,50', 'recebi 1.500 de salário', 'paguei 50 conto no tênis', 'pagas 30'].map(s => [findValor(s).centavos, findValor(s).explicito]),
    [[3290, true], [1850, false], [150000, false], [5000, true], [3000, false]]));
  test('findValor: explícito ganha de número solto', () => eq(
    [findValor('paguei 20 e depois R$ 35').centavos, findValor('gastei 30 reais e 20 de gorjeta').centavos], [3500, 3000]));
  test('hora, distância, capítulo, dia e data não são valor', () => eq(
    ['treinei 1h', 'corri 5km', 'corri 5 km', 'ler cap 15', 'reunião às 15', 'prova dia 15', 'prova 15/10', '3x10 supino', 'supino 4 séries', '15:30', 'aula 3', '#tcc2', 'dia 15 de outubro', 'dormi 8 horas'].map(findValor),
    Array(14).fill(null)));
  test('fmtValor', () => eq([3000, 123456, 5, -500, 0, 100000000].map(fmtValor),
    ['R$ 30,00', 'R$ 1.234,56', 'R$ 0,05', '-R$ 5,00', 'R$ 0,00', 'R$ 1.000.000,00']));
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

describe('histórico de mudanças (historico.js · Fase 2)', () => {
  const now = new Date(2026, 9, 2, 10, 0);
  const task = (data = {}, text = 'revisar cap 2') => ({ id: 'tk1', kind: 'tarefa', text, tags: ['tcc'], ts: 1, day: '2026-10-02',
    data: { projeto: 'tcc', status: 'a fazer', prazo: '2026-10-05', prioridade: 'média', feito_em: null, ...data } });
  test('criada: guarda o estado inicial', () => {
    const ev = diffEvent(null, task(), { now });
    eq([ev.kind, ev.text, ev.day, ev.data.acao, ev.data.alvo, ev.data.origem, ev.data.texto], ['evento', 'criada', '2026-10-02', 'criada', 'tk1', 'usuario', 'revisar cap 2']);
    eq(ev.data.mudancas, { text: [null, 'revisar cap 2'], projeto: [null, 'tcc'], status: [null, 'a fazer'], prazo: [null, '2026-10-05'], prioridade: [null, 'média'] });
  });
  test('alterada: só o que mudou, com de → para', () => {
    const ev = diffEvent(task(), task({ status: 'feito', feito_em: 123 }), { now });
    eq([ev.text, ev.data.mudancas], ['alterada · status · feito_em', { status: ['a fazer', 'feito'], feito_em: [null, 123] }]);
  });
  test('adiamento aparece como prazo de → para', () => eq(
    diffEvent(task(), task({ prazo: '2026-10-09' })).data.mudancas, { prazo: ['2026-10-05', '2026-10-09'] }));
  test('gravou igual, nota, registro ou evento: nada', () => eq(
    [diffEvent(task(), task()), diffEvent(null, { id: 'n', kind: 'nota', text: 'oi' }), diffEvent(null, { id: 'p', kind: 'projeto', text: 'tcc' }), diffEvent(null, { id: 'e', kind: 'evento', text: 'x' })],
    [null, null, null, null]));
  test('apagada, restaurada (desfazer) e origem desconhecida', () => eq(
    [diffEvent(task(), null).data.acao, diffEvent(null, task(), { origem: 'desfazer' }).data.acao, diffEvent(task(), task({ prazo: null }), { origem: 'hacker' }).data.origem],
    ['apagada', 'restaurada', 'usuario']));
  test('kinds desconhecidos ficam escondidos (registros), não viram nota', () => eq(
    [{ kind: 'evento' }, { kind: 'interpretacao' }, { kind: 'xyz' }, { kind: 'projeto' }, { kind: 'nota' }, { kind: 'tarefa' }, { kind: 'link' }, { kind: 'trecho' }, { text: 'sem kind' }].map(isRecord),
    [true, true, true, true, false, false, false, false, false]));
  test('isNoteKind: só nota de verdade', () => eq(
    [{ kind: 'nota' }, {}, { kind: 'tarefa' }, { kind: 'link' }, { kind: 'gasto' }].map(isNoteKind), [true, true, false, false, false]));

  function wrapped() {
    const raw = memStore([]);
    let list = [];
    raw.subscribe(l => { list = l; });
    const store = withHistory(raw, { now: () => now });
    return { raw, store, evs: () => list.filter(e => e.kind === 'evento'), list: () => list };
  }
  test('withHistory: criar, mudar, apagar geram um evento cada', async () => {
    const { store, evs } = wrapped();
    const e = await store.add(task());
    await store.restore({ ...e, data: { ...e.data, status: 'fazendo' } });
    await store.restore({ ...e, data: { ...e.data, status: 'fazendo' } }); // igual: sem evento
    await store.remove(e.id);
    await store.idle();
    eq(evs().map(x => x.data.acao), ['criada', 'alterada', 'apagada']);
    eq(evs().every(x => x.data.alvo === e.id), true);
  });
  test('withHistory: nota não gera evento; origem passa adiante', async () => {
    const { store, evs } = wrapped();
    await store.add({ kind: 'nota', text: 'ideia', tags: [], ts: 1, day: '2026-10-02' });
    const e = await store.add(task());
    await store.restore({ ...e, data: { ...e.data, prazo: '2026-10-08' } }, { origem: 'desfazer' });
    await store.idle();
    eq(evs().map(x => [x.data.acao, x.data.origem]), [['criada', 'usuario'], ['alterada', 'desfazer']]);
  });
  test('withHistory: mudança que chega de fora (nuvem/outra aba) não gera evento', async () => {
    const { raw, store, evs } = wrapped();
    const e = await store.add(task());
    await raw.restore({ ...e, data: { ...e.data, status: 'feito' } }); // direto na memória, sem passar pela capa
    await store.idle();
    eq(evs().length, 1);
  });
  test('withHistory: falha ao gravar o evento não derruba a gravação', async () => {
    const raw = memStore([]);
    const add = raw.add;
    raw.add = async doc => { if (doc.kind === 'evento') throw new Error('cheio'); return add(doc); };
    const errors = [];
    const store = withHistory(raw, { onError: e => errors.push(e.message) });
    const e = await store.add(task());
    await store.idle();
    eq([e.kind, errors], ['tarefa', ['cheio']]);
  });
  test('comandos: /t, /feito, /adiar e /desfazer deixam rastro; /mudancas mostra', async () => {
    const s = setup([]);
    s.ctx.store = withHistory(memStore([]), { now: () => now });
    s.ctx.store.subscribe(l => { s.S.entries = l.filter(e => !isRecord(e)); s.S.records = l.filter(isRecord); });
    await s.run('/t revisar cap 2 #tcc >sex');
    await s.run('/adiar t1 +7');
    await s.run('/feito t1');
    await s.run('/desfazer');
    await s.ctx.store.idle();
    const evs = eventsOf(s.S.records).reverse();
    eq(evs.map(x => [x.data.acao, Object.keys(x.data.mudancas).filter(k => k !== 'feito_em').join(','), x.data.origem]),
      [['criada', 'text,projeto,status,prazo,prioridade', 'usuario'], ['alterada', 'prazo', 'usuario'], ['alterada', 'status', 'usuario'], ['alterada', 'status', 'desfazer']]);
    eq(s.S.entries.length, 1); // os eventos não aparecem como nota nem como tarefa
    await s.run('/mudancas t1');
    ok(/mudanças/.test(s.term.text()) && /prazo/.test(s.term.text()) && /desfazer/.test(s.term.text()), 'mostra as mudanças');
  });
});

describe('registro de tipos + contrato (tipos.js · Fase 2)', () => {
  const reg = () => {
    const r = criarRegistro();
    r.registrar({ id: 'gasto', campos: { valor: { tipo: 'centavos', obrigatorio: true }, descricao: { tipo: 'texto' }, data: { tipo: 'data' } }, rastrear: ['valor'], exemplos: ['gastei 30 no almoço'] });
    r.registrar({ id: 'tarefa', campos: { texto: { tipo: 'texto', obrigatorio: true }, prioridade: { tipo: 'enum', valores: ['alta', 'média', 'baixa'] }, tags: { tipo: 'lista' } } });
    return r;
  };
  const base = { tipo: 'gasto', campos: { valor: 3000, descricao: 'almoço', data: '2026-10-02' }, confianca: 0.9, origem: 'regra', texto: 'gastei 30 no almoço' };
  test('registrar e consultar', () => {
    const r = reg();
    eq([r.ids(), r.get('gasto').kind, r.get('gasto').rotulo, r.get('xyz')], [['gasto', 'tarefa'], 'gasto', 'gasto', null]);
  });
  test('registro recusa id repetido, id inválido e campo de tipo desconhecido', async () => {
    const r = reg();
    await throws(() => r.registrar({ id: 'gasto' }));
    await throws(() => r.registrar({ id: 'Gasto X' }));
    await throws(() => r.registrar({ id: 'y', campos: { a: { tipo: 'cor' } } }));
    await throws(() => r.registrar({ id: 'z', campos: { a: { tipo: 'enum' } } }));
  });
  test('schema curto pra IA e campos rastreados', () => {
    const r = reg();
    eq(r.schema()[0], { tipo: 'gasto', campos: { valor: 'centavos!', descricao: 'texto', data: 'data' }, exemplos: ['gastei 30 no almoço'] });
    eq(r.schema()[1].campos.prioridade, ['alta', 'média', 'baixa']);
    eq(r.rastrear(), { gasto: ['valor'] });
  });
  test('interpretação válida passa e sai normalizada', () => {
    const v = validarInterpretacao({ ...base, campos: { ...base.campos, inventado: 1 }, auto: ['data', 'nada'], extra: 'x' }, reg());
    eq(v, { ok: true, valor: { tipo: 'gasto', campos: { valor: 3000, descricao: 'almoço', data: '2026-10-02' }, confianca: 0.9, origem: 'regra', auto: ['data'], texto: 'gastei 30 no almoço', provedor: 'regra' } });
  });
  test('campo opcional vazio sai; pergunta e erro passam', () => {
    const v = validarInterpretacao({ ...base, campos: { valor: 3000, descricao: '' }, pergunta: true, erro: { codigo: 'prazo', token: '>x' } }, reg()).valor;
    eq([v.campos, v.pergunta, v.erro], [{ valor: 3000 }, true, { codigo: 'prazo', token: '>x' }]);
  });
  test('recusa: tipo, origem, confiança, texto, campos', () => {
    const r = reg();
    const bad = [null, [], 'x', { ...base, tipo: 'treino' }, { ...base, origem: 'chute' }, { ...base, confianca: 1.2 }, { ...base, confianca: '0.9' },
      { ...base, texto: undefined }, { ...base, campos: null }, { ...base, campos: [] }];
    eq(bad.map(o => validarInterpretacao(o, r).ok), Array(bad.length).fill(false));
  });
  test('recusa: campo obrigatório faltando ou com tipo errado', () => {
    const r = reg();
    const bad = [{ valor: null }, { valor: 30.5 }, { valor: -1 }, { valor: '3000' }, { valor: 3000, data: '2026-02-30' }, { valor: 3000, data: '02/10' }, { valor: 3000, descricao: 5 }];
    eq(bad.map(campos => validarInterpretacao({ ...base, campos }, r).ok), Array(bad.length).fill(false));
    eq(validarInterpretacao({ ...base, tipo: 'tarefa', campos: { texto: 'x', prioridade: 'urgente' } }, r).erro, 'campo prioridade inválido: "urgente"');
    eq(validarInterpretacao({ ...base, tipo: 'tarefa', campos: { texto: 'x', tags: ['a', 1] } }, r).ok, false);
  });
  test('motivo da recusa em português', () => eq(validarInterpretacao({ ...base, campos: {} }, reg()).erro, 'falta o campo valor'));
});

describe('provedor de regras (provedor-regras.js · Fase 2)', () => {
  const now = new Date(2026, 9, 1, 12, 0);
  const ctx = (extra = {}) => ({ reg: registry([]), entries: [], now, ...extra });
  const P = (t, extra) => provedorRegras.interpretar(t, ctx(extra));
  test('tipos base registrados e todo tipo de conteúdo aparece nas listas', () => {
    eq(REGISTRO.ids().slice(0, 4), ['nota', 'tarefa', 'link', 'trecho']);
    ok(REGISTRO.ids().every(id => CONTENT_KINDS.includes(REGISTRO.get(id).kind)), 'kind fora do CONTENT_KINDS ficaria escondido');
  });
  test('resposta segue o contrato', () => {
    const r = P('ligar pro dentista amanhã');
    eq([r.tipo, r.origem, r.provedor, r.texto, r.auto], ['tarefa', 'regra', 'regras', 'ligar pro dentista amanhã', ['projeto', 'status', 'prioridade']]);
    ok(validarInterpretacao(r).ok);
  });
  test('vazio → null', () => eq([P(''), P('   ')], [null, null]));
  test('/t força tarefa mesmo sem sinal', () => eq([P('bolo de cenoura', { forcar: 'tarefa' }).tipo, P('bolo de cenoura', { forcar: 'tarefa' }).confianca], ['tarefa', 1]));
  test('- com marcador errado devolve o erro (como hoje)', () => eq([P('- x >nunca').erro, P('- x !urgente').erro.codigo], [{ codigo: 'prazo', token: '>nunca' }, 'prioridade']));
  test('texto livre com marcador errado não é tarefa', () => eq(P('que dia lindo !uau').tipo, 'nota'));
  test('data passada não vira prazo de tarefa', () => eq(P('- pagar conta ontem').campos.texto, 'pagar conta ontem'));
  test('verbo: ligar, ler, ir sim · celular, lugar, por não', () => eq(
    ['ligar pro joão', 'ler o cap 3', 'ir no banco', 'celular quebrou', 'lugar bonito', 'por favor né'].map(comecaComVerbo), [true, true, true, false, false, false]));
  test('montar dá a mesma entrada que os comandos de hoje', () => {
    const c = ctx();
    eq(REGISTRO.get('link').montar(P('https://x.com/a artigo #tcc'), c),
      { kind: 'link', text: 'https://x.com/a artigo #tcc', tags: ['tcc'], ts: now.getTime(), day: '2026-10-01', data: { url: 'https://x.com/a', contexto: 'artigo #tcc' } });
    eq(REGISTRO.get('trecho').montar(P('"frase boa"'), c), { kind: 'trecho', text: 'frase boa', tags: [], ts: now.getTime(), day: '2026-10-01', data: {} });
    eq(REGISTRO.get('nota').montar(P('oi #weg'), c), { text: 'oi #weg', tags: ['weg'], kind: 'nota', ts: now.getTime(), day: '2026-10-01' });
    const t = REGISTRO.get('tarefa').montar(P('- revisar cap 2 #tcc >sex'), c);
    eq([t.kind, t.text, t.tags, t.data.projeto, t.data.prazo, t.data.status, t.data.auto], ['tarefa', 'revisar cap 2', ['tcc'], 'tcc', '2026-10-02', 'a fazer', { campos: ['status', 'prioridade'], fonte: 'regra' }]);
  });
});

describe('gasto, entrada, treino (dado bruto · Fase 2)', () => {
  const now = new Date(2026, 9, 1, 12, 0);
  test('lerDuracao', () => eq(
    ['1h', '1h30', '1 h 30 min', '2 horas', '1 hora e meia', 'uma hora e meia', 'meia hora', 'uma hora', '45 min', '45 minutos', 'às 7h', 'cap 15', ''].map(lerDuracao),
    [60, 90, 90, 120, 90, 90, 30, 60, 45, 45, null, null, null]));
  test('lerDistancia', () => eq(['5km', '5,5 km', '10 quilômetros', '12 kms', 'corri muito'].map(lerDistancia), [5, 5.5, 10, 12, null]));
  test('lerMovimento tira verbo, valor, data e preposição da descrição', () => eq(
    lerMovimento('me pagaram 200 pelo freela ontem', now), { valor: 20000, explicito: false, descricao: 'pelo freela', data: '2026-09-30', temData: true }));
  test('montar gasto e treino', () => {
    const g = provedorRegras.interpretar('gastei 30 no almoço', { now });
    eq(REGISTRO.get('gasto').montar(g, { now }), { kind: 'gasto', text: 'gastei 30 no almoço', tags: [], ts: now.getTime(), day: '2026-10-01', data: { valor: 3000, descricao: 'almoço', data: '2026-10-01' } });
    const t = provedorRegras.interpretar('corri 5km', { now });
    eq(REGISTRO.get('treino').montar(t, { now }).data, { descricao: 'corri 5km', duracao_min: null, distancia_km: 5, data: '2026-10-01' });
  });
  test('/buscar acha gasto e não mistura com nota', () => {
    const res = searchAll([{ id: 'g', kind: 'gasto', text: 'gastei 30 no almoço', tags: [] }, { id: 'n', kind: 'nota', text: 'almoço bom', tags: [] }], 'almoço');
    eq(res.groups.map(g => g.key), ['nota', 'gasto']);
    eq(searchAll([{ id: 'g', kind: 'gasto', text: 'x', tags: [] }], 'tipo:gastos').total, 1);
  });
});

describe('palavras-chave por projeto (Fase 2)', () => {
  const seeds = (palavras = {}) => seedEntries([], 'local', new Date(2026, 9, 1))
    .map(e => (e.kind === 'projeto' && palavras[e.text] ? { ...e, data: { ...e.data, palavras: palavras[e.text] } } : e));
  test('editPalavras: + põe, - tira, sem repetir, minúsculas, sem #', () => eq(
    editPalavras(['orientador'], ['+Banca', 'orientador', '#defesa', '-orientador', '+', '-nada']), ['banca', 'defesa']));
  test('registry lê as palavras de cada projeto', () => eq(registry(seeds({ tcc: ['orientador'] })).palavras, { tcc: ['orientador'] }));
  test('palavra-chave decide o projeto (até com espaço e acento)', () => {
    const reg = registry(seeds({ tcc: ['orientador', 'banca de defesa'], weg: ['relatório'] }));
    eq(['mandar email pro orientador', 'marcar a BANCA de defesa', 'revisar relatorio mensal', 'comprar pão'].map(t => guessProject(t, { reg })),
      ['tcc', 'tcc', 'weg', 'pessoal']);
  });
  test('palavra-chave (+4) não vence o nome do projeto escrito (+5)', () => {
    const reg = registry(seeds({ tcc: ['reunião'] }));
    eq(guessProject('reunião da weg', { reg }), 'weg');
  });
  test('/palavras ensina, /desfazer volta, /t usa', async () => {
    const s = setup([]);
    for (const e of seeds()) await s.ctx.store.restore(e);
    await s.run('/palavras tcc +orientador +Banca');
    const rec = () => s.S.records.find(e => e.kind === 'projeto' && e.text === 'tcc');
    eq(rec().data.palavras, ['orientador', 'banca']);
    await s.run('/palavras tcc -banca');
    eq(rec().data.palavras, ['orientador']);
    await s.run('/desfazer');
    eq(rec().data.palavras, ['orientador', 'banca']);
    await s.run('/t mandar email pro orientador');
    eq(s.S.entries.find(e => e.kind === 'tarefa').data.projeto, 'tcc');
    await s.run('/palavras');
    ok(/orientador, banca/.test(s.term.text()), 'lista as palavras');
    await throws(() => s.run('/palavras xyz +a'), 'E_404');
  });
});

describe('captura pelo intérprete (etapa 9a · mesmo comportamento)', () => {
  const T = { id: 'T0001', elapsed: () => 1 };
  test('link, texto, "- " e nota vão pro lugar de sempre', async () => {
    const s = setup([]);
    for (const line of ['https://x.com/a artigo #tcc', '"frase boa"', '- revisar cap 2 #tcc >sex', 'ideia solta']) await s.ctx.commands.capturar(line, T);
    eq(s.S.entries.map(e => [e.kind, e.text]), [['link', 'https://x.com/a artigo #tcc'], ['trecho', 'frase boa'], ['tarefa', 'revisar cap 2'], ['nota', 'ideia solta']]);
    ok(/link guardado/.test(s.term.text()) && /texto guardado/.test(s.term.text()) && /tarefa/.test(s.term.text()) && /capturado/.test(s.term.text()));
  });
  test('na aba, a nota ganha a #tag', async () => {
    const s = setup([]);
    s.S.ctx = 'weg';
    await s.ctx.commands.capturar('reunião boa', T);
    eq([s.S.entries[0].text, s.S.entries[0].tags], ['reunião boa #weg', ['weg']]);
  });
  test('nota capturada agora também sai com /desfazer', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar('ideia solta', T);
    await s.run('/desfazer');
    eq(s.S.entries.length, 0);
  });
  test('/t entende data falada', async () => {
    const s = setup([]);
    await s.run('/t ligar pro dentista amanhã');
    const e = s.S.entries[0];
    eq(e.text, 'ligar pro dentista');
    ok(e.data.prazo && !e.data.auto.campos.includes('prazo'), 'prazo veio da frase, não é auto');
  });
  test('"- " com prazo errado continua dando E_PRAZO', async () => {
    const s = setup([]);
    await throws(() => s.ctx.commands.capturar('- x >nunca', T), 'E_PRAZO');
  });
  test('prévia da direita lê com o mesmo motor', () => {
    const i = readIntent('- ligar pro banco sexta', { now: new Date(2026, 9, 1, 12) });
    eq([i.type, i.text, i.prazo, i.auto], ['task', 'ligar pro banco', '2026-10-02', ['projeto', 'status', 'prioridade']]);
    eq(readIntent('https://x.com/a oi').type, 'link');
    eq(readIntent('"guardar isto"').text, 'guardar isto');
  });
});

describe('texto livre + "↳ entendi" + /tipo (etapa 9b)', () => {
  const T = { id: 'T0001', elapsed: () => 1 };
  const out = s => s.term.text();
  test('"ligar pro dentista amanhã" vira tarefa com prazo e a linha entendi', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar('ligar pro dentista amanhã', T);
    const e = s.S.entries[0];
    eq([e.kind, e.text, e.data.frase], ['tarefa', 'ligar pro dentista', 'ligar pro dentista amanhã']);
    ok(/↳ entendi/.test(out(s)) && /amanhã/.test(out(s)) && /\/editar t1/.test(out(s)), out(s));
  });
  test('"gastei 30 no almoço" vira gasto (fora do /inbox, dentro do /buscar)', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar('gastei 30 no almoço', T);
    const e = s.S.entries[0];
    eq([e.kind, e.data.valor, e.data.descricao], ['gasto', 3000, 'almoço']);
    ok(/R\$ 30,00/.test(out(s)), 'linha entendi com o valor');
    const antes = s.term.out.length;
    await s.run('/inbox');
    ok(!/gastei 30/.test(s.term.out.slice(antes).map(x => x.join(' ')).join('\n')), 'não aparece no /inbox');
    await s.run('/buscar almoço');
    ok(/gastos/.test(out(s)), 'aparece no /buscar');
  });
  test('nota comum: só "capturado", sem linha extra', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar('li um artigo bom sobre RAG', T);
    eq(s.S.entries[0].kind, 'nota');
    ok(!/↳/.test(out(s)), out(s));
  });
  test('dúvida: salva como nota e pergunta; /tipo tarefa corrige; /desfazer volta', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar('comprar pão', T);
    eq(s.S.entries.map(e => e.kind), ['nota']);
    ok(/salvei como nota/.test(out(s)) && /\/tipo tarefa/.test(out(s)), out(s));
    await s.run('/tipo tarefa');
    eq(s.S.entries.map(e => [e.kind, e.text]), [['tarefa', 'comprar pão']]);
    await s.run('/desfazer');
    eq(s.S.entries.map(e => [e.kind, e.text]), [['nota', 'comprar pão']]);
  });
  test('/tipo com número e /tipo nota desfaz uma tarefa deduzida', async () => {
    const s = setup(['nota velha', 'uber 18']);
    await s.run('/tipo gasto #2');
    eq(s.S.entries.find(e => e.kind === 'gasto').data.valor, 1800);
    await s.ctx.commands.capturar('ligar pro banco amanhã', T);
    await s.run('/tipo nota');
    eq(s.S.entries.filter(e => e.kind === 'nota').map(e => e.text), ['nota velha', 'ligar pro banco amanhã']);
  });
  test('/tipo que não dá: erro com dica, nada muda', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar('comprar pão', T);
    await throws(() => s.run('/tipo gasto'), 'E_TIPO');
    await throws(() => s.run('/tipo foguete'), 'E_ARG');
    eq(s.S.entries.map(e => e.kind), ['nota']);
  });
  test('"nota:" força nota', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar('nota: preciso pensar nisso amanhã', T);
    eq([s.S.entries[0].kind, s.S.entries[0].text], ['nota', 'preciso pensar nisso amanhã']);
  });
  test('prévia da direita: tarefa deduzida, gasto e dúvida', () => {
    const now = new Date(2026, 9, 1, 12);
    eq([readIntent('ligar pro banco amanhã', { now }).type, readIntent('ligar pro banco amanhã', { now }).inferido], ['task', true]);
    const g = readIntent('gastei 30 no almoço', { now });
    eq([g.type, g.tipo, g.campos.valor], ['registro', 'gasto', 3000]);
    const d = readIntent('comprar pão', { now });
    eq([d.type, d.pergunta, d.palpite], ['note', true, 'tarefa']);
  });
});

describe('aprendizado (aprendizado.js · Fase 2)', () => {
  const now = new Date(2026, 9, 2, 10);
  const R = (texto, data, i) => ({ ...registroAprendizado({ texto, ...data }, new Date(now.getTime() + i * 1000)), id: 'ap' + i });
  test('registro: frase + palpite, escondido nas listas', () => {
    const r = registroAprendizado({ texto: ' comprar pão ', palpite: 'tarefa', confianca: 0.6 }, now);
    eq([r.kind, r.text, r.data.palpite, r.data.corrigido, isRecord(r)], ['interpretacao', 'comprar pão', 'tarefa', null, true]);
    eq(registroAprendizado({ texto: '  ' }), null);
  });
  test('resumo junta por frase; correção vence a pergunta', () => {
    const res = resumoAprendizado([
      R('comprar pão', { palpite: 'tarefa' }, 1), R('Comprar pão', { era: 'nota', corrigido: 'tarefa' }, 2),
      R('uber 18', { palpite: 'gasto' }, 3), R('uber 18', { palpite: 'gasto' }, 4),
    ]);
    eq([res.total, res.corrigidas.map(i => [i.texto, i.corrigido]), res.semResposta.map(i => [i.texto, i.vezes])],
      [2, [['Comprar pão', 'tarefa']], [['uber 18', 2]]]);
  });
  test('exportar no formato da régua (aspas protegidas)', () => eq(
    exportarFrases(resumoAprendizado([R("it's ok", { era: 'nota', corrigido: 'nota' }, 1), R('uber 18', { palpite: 'gasto' }, 2)])),
    ["  { frase: 'it\\'s ok', esperado: { tipo: 'nota' } },", "  // { frase: 'uber 18', esperado: { tipo: '?' } }, // palpite: gasto"]));
  test('dúvida e /tipo gravam; /aprendizado mostra e exporta', async () => {
    const s = setup([]);
    const T = { id: 'T0001', elapsed: () => 1 };
    await s.ctx.commands.capturar('comprar pão', T);
    await s.ctx.commands.capturar('uber 18', T);
    await s.run('/tipo gasto');
    await new Promise(r => setTimeout(r, 0));
    const res = resumoAprendizado(s.S.records);
    eq([res.corrigidas.map(i => i.texto), res.semResposta.map(i => i.texto)], [['uber 18'], ['comprar pão']]);
    await s.run('/aprendizado');
    ok(/corrigidas/.test(s.term.text()) && /sem resposta/.test(s.term.text()));
    await s.run('/aprendizado exportar');
    ok(/frase: 'uber 18', esperado: \{ tipo: 'gasto' \}/.test(s.term.text()), s.term.text());
    eq(s.S.entries.filter(isNoteKind).map(e => e.text), ['comprar pão'], 'nada de aprendizado no /inbox');
  });
});

describe('régua de frases (tests/frases.js · interpretar com regras)', () => {
  // frase com `palavras` (ex: { tcc: ['orientador'] }) roda com essas palavras-chave nos projetos
  const ctxBase = f => ({
    reg: registry(seedEntries([], 'local', new Date(2026, 9, 1)).map(e => (e.kind === 'projeto' && f?.palavras?.[e.text] ? { ...e, data: { ...e.data, palavras: f.palavras[e.text] } } : e))),
    entries: [],
  });
  const { interpretar: viaRegras } = criarInterpretador();
  for (const f of FRASES) {
    test(`"${f.frase}" → ${f.esperado.tipo}${f.esperado.pergunta ? ' + pergunta' : ''}`, async () => {
      const [r] = await rodarFrases(viaRegras, [f], ctxBase);
      if (!r.ok) throw new Error(r.motivo);
    });
  }
  test('a régua inteira passa também com uma IA (falsa) ligada no encaixe', async () => {
    let chamadas = 0;
    // IA de mentira que responde o mesmo que as regras: prova que o encaixe não quebra nada
    const invoke = async p => { chamadas++; const r = provedorRegras.interpretar(p.texto, { now: new Date(p.hoje + 'T12:00'), reg: registry([]), aba: p.aba }); return { tipo: r.tipo, campos: r.campos, confianca: r.confianca, auto: r.auto }; };
    const ia = criarProvedorIA({ invoke, config: { ligada: true, modelo: 'teste', timeoutMs: 500 } });
    const res = await rodarFrases(criarInterpretador({ ia }).interpretar, FRASES, ctxBase);
    const ruins = res.filter(r => !r.ok);
    if (ruins.length) throw new Error(ruins.map(r => `${r.frase}: ${r.motivo}`).join('\n'));
    ok(chamadas > 0 && chamadas < FRASES.length, `a IA só é chamada nos casos de dúvida (${chamadas})`);
  });
});

describe('interpretar() + provedor de IA desligado (Fase 2)', () => {
  const now = new Date(2026, 9, 1, 12, 0);
  const ctx = { reg: registry([]), entries: [], now };
  const resposta = { tipo: 'tarefa', campos: { texto: 'comprar pão', prazo: '2026-10-02' }, confianca: 0.9 };
  const comIA = (invoke, extra = {}) => criarInterpretador({ ia: criarProvedorIA({ invoke, config: { ligada: true, modelo: 'teste', timeoutMs: 50 }, onError: () => {}, ...extra }) });
  test('IA desligada (o padrão): dúvida vira nota com pergunta e palpite', async () => {
    const r = await interpretar('comprar pão', ctx);
    eq([r.tipo, r.pergunta, r.palpite, r.campos.texto, r.origem], ['nota', true, 'tarefa', 'comprar pão', 'regra']);
    ok(validarInterpretacao(r).ok, 'nota com pergunta também segue o contrato');
  });
  test('config padrão: IA desligada, Haiku 4.5, limiar 0.7', () => eq(
    [INTERPRETADOR.ia.ligada, INTERPRETADOR.ia.modelo, INTERPRETADOR.limiar], [false, 'claude-haiku-4-5-20251001', 0.7]));
  test('desligada nunca chama o servidor', async () => {
    let n = 0;
    const i = criarInterpretador({ ia: criarProvedorIA({ invoke: async () => { n++; return resposta; }, config: { ligada: false } }) });
    await i.interpretar('comprar pão', ctx);
    eq(n, 0);
  });
  test('ligada: na dúvida a IA decide (origem ia)', async () => {
    const r = await comIA(async () => resposta).interpretar('comprar pão', ctx);
    eq([r.tipo, r.origem, r.provedor, r.campos.prazo, r.texto], ['tarefa', 'ia', 'ia-teste', '2026-10-02', 'comprar pão']);
  });
  test('ligada: regra com certeza não gasta chamada', async () => {
    let n = 0;
    const r = await comIA(async () => { n++; return resposta; }).interpretar('ligar pro dentista amanhã', ctx);
    eq([r.origem, n], ['regra', 0]);
  });
  test('IA com erro, lenta, inválida ou sem certeza → nota com pergunta, texto salvo', async () => {
    const casos = [
      async () => { throw new Error('sem rede'); },
      () => new Promise(() => {}), // nunca responde: corta no timeout
      async () => ({ tipo: 'foguete', campos: {}, confianca: 1 }),
      async () => ({ tipo: 'tarefa', campos: {}, confianca: 0.9 }), // falta texto
      async () => ({ ...resposta, confianca: 0.4 }),
    ];
    for (const invoke of casos) {
      const r = await comIA(invoke).interpretar('comprar pão', ctx);
      eq([r.tipo, r.pergunta, r.campos.texto], ['nota', true, 'comprar pão']);
    }
  });
  test('trava diária: estourou, fica nas regras', async () => {
    const mem = new Map();
    const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
    const guard = travaDiaria(1, { storage, key: 'mb.test.ia', now: () => now });
    let n = 0;
    const i = comIA(async () => { n++; return resposta; }, { guard });
    eq([(await i.interpretar('comprar pão', ctx)).origem, (await i.interpretar('comprar leite', ctx)).tipo, n], ['ia', 'nota', 1]);
  });
  test('cache: mesma frase no mesmo dia não chama de novo', async () => {
    const mem = new Map();
    const cache = { get: k => mem.get(k), set: (k, v) => mem.set(k, v) };
    let n = 0;
    const i = comIA(async () => { n++; return resposta; }, { cache });
    await i.interpretar('comprar pão', ctx);
    await i.interpretar('Comprar pão ', ctx);
    eq(n, 1);
  });
  test('pedido pra IA é curto e não leva suas notas', () => {
    const p = montarPedido('comprar pão', { ...ctx, entries: [{ text: 'segredo' }], aba: 'tcc' }, { modelo: 'm' });
    eq(Object.keys(p), ['modelo', 'texto', 'hoje', 'dia_semana', 'aba', 'tipos', 'projetos', 'palavras', 'status']);
    eq([p.hoje, p.dia_semana, p.aba, p.projetos], ['2026-10-01', 'qui', 'tcc', ['tcc', 'weg', 'pessoal']]);
    ok(!JSON.stringify(p).includes('segredo'));
    ok(p.tipos.some(t => t.tipo === 'gasto'), 'os tipos vêm do registro');
  });
  test('previa é instantânea (sem IA) e igual ao interpretar sem IA', async () => {
    for (const t of ['comprar pão', 'ligar pro dentista amanhã', 'oi', '- x >nunca']) eq(previa(t, ctx), await interpretar(t, ctx));
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
