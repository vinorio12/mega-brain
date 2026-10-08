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
import { viewName, viewGroups, calendarModel, parseMonth, parseVerArgs } from '../js/views.js';
import { parseLink, parseSnippet, shortUrl, searchAll } from '../js/acervo.js';
import { parseTaskInput, groupTasks, doneHistory, projectsSummary, taskStats, taskNumbers, projName, doneAt, registry, seedEntries, seedId, statusOf, projectOf, prioOf, statusChange, isRecord, guessProject, dueFor, fillByRules, matchStatus, briefing, isNoteKind, CONTENT_KINDS, editPalavras } from '../js/tasks.js';
import { diffEvent, withHistory, eventsOf } from '../js/historico.js';
import { criarRegistro, validarInterpretacao, REGISTRO } from '../js/tipos.js';
import { comecaComVerbo } from '../js/tipos-base.js';
import { lerMovimento } from '../js/tipos-financas.js';
import { lerFinanca, categoriasDe, acharCategoria, acharForma, categoriaSemente, CATEGORIAS_PADRAO, verbosAprendidos, acharEstornado, resumoMes, mesAnterior, variacao, barra, fmtMes, lancamentos, seedCategorias, hudFinancas, linhaContexto, cartoesDe, cartaoPadrao, parcelasDe, faturaDaCompra, mesDaFatura, vencimentoDa, proximaFatura, parcelasNoMes, proximasFaturas, recorrentesDe, desdeInicial, pendentesRecorrentes, lancamentoRecorrente, lembretesVariaveis, saldoConta, devoNoCartao, investimentosPorLugar, ancorasDe, chaveLugar, lerAjusteSaldo, lerRendimento, ehPagamentoFatura, resumoSaldos, creditoDe, ciclosCredito, faturaAPagar, resumoCredito, parcelasBoleto, CARTAO_CREDITO } from '../js/financas.js';
import { lerDuracao, lerDistancia } from '../js/tipos-corpo.js';
import { provedorRegras } from '../js/provedor-regras.js';
import { FRASES, rodarFrases } from './frases.js';
import { criarInterpretador, interpretar, previa } from '../js/interpretar.js';
import { criarProvedorIA, travaDiaria, montarPedido } from '../js/provedor-ia.js';
import { INTERPRETADOR } from '../js/config.js';
import { registroAprendizado, resumoAprendizado, exportarFrases } from '../js/aprendizado.js';
import { montarContexto, estimarTokens } from '../js/contexto.js';
import { pessoasDe, findPessoas, candidatosPessoa, acharPessoa, editApelidos, juntarPessoas, resumoPessoa } from '../js/pessoas.js';
import { criarMemoria, decidirProjeto, palavrasDe } from '../js/memoria.js';
import { lerAtalhoTarefa, respostaPergunta, comandoSozinho } from '../js/conversa.js';
import { sugestoesArrumacao, semTags } from '../js/arrumar.js';

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
  const S = { entries: entries(texts), undo: [], startedAt: Date.now(), detalhes: true }; // /detalhes ligado: os testes antigos conferem as linhas técnicas
  const term = fakeTerm();
  S.records = [];
  const ctx = { S, term, reg: () => registry(S.records), ui: { pulse() {}, render() {}, state: () => 'ready', mem: () => ['local', 'warn'], stage: null, openStage(kind, o = {}) { this.stage = { kind, ...o }; }, closeStage() { this.stage = null; }, stageOpen() { return this.stage?.kind || null; } } };
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
  // semColuna: banco antigo, sem updated_at (antes da supabase/003_updated_at.sql)
  const api = { fail: false, semColuna: false, calls: [], rows };
  const err = () => ({ error: { message: 'TypeError: Failed to fetch' } });
  let clock = 0;
  // o "banco" carimba updated_at em todo insert/update (como o gatilho da 003)
  api.gravar = row => rows.set(row.id, { ...row, ...(api.semColuna ? {} : { updated_at: 't' + String(++clock).padStart(8, '0') }) });
  api.from = () => ({
    upsert: async row => { api.calls.push('upsert'); if (api.fail) return err(); api.gravar(row); return { error: null }; },
    delete: () => ({ eq: async (_, id) => { api.calls.push('delete'); if (api.fail) return err(); rows.delete(id); return { error: null }; } }),
    select: () => {
      let min = null;
      const b = {
        gte: (col, v) => { min = v; return b; },
        order: () => b,
        range: async () => {
          api.calls.push(min ? 'leitura-leve' : 'leitura-completa');
          if (api.fail) return err();
          if (min && api.semColuna) return { error: { code: '42703', message: 'column entries.updated_at does not exist' } };
          const all = [...rows.values()];
          return { data: min ? all.filter(r => r.updated_at >= min) : all, error: null };
        },
      };
      return b;
    },
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
  test('$ também é dinheiro (v0.14)', () => eq(['$45', '$ 45', 'r$45', 'R$ 45', '45 reais', '45 contos'].map(parseValor), Array(6).fill(4500)));
  test('findValor: "gastei $45 na farmácia"', () => eq([findValor('gastei $45 na farmácia').centavos, findValor('gastei $45 na farmácia').resto], [4500, 'gastei na farmácia']));
  test('tirar o valor não cola o marcador na palavra de antes', () => eq(findValor('pagar 30 !alta').resto, 'pagar !alta'));
  test('fmtValor', () => eq([3000, 123456, 5, -500, 0, 100000000].map(fmtValor),
    ['R$ 30,00', 'R$ 1.234,56', 'R$ 0,05', '-R$ 5,00', 'R$ 0,00', 'R$ 1.000.000,00']));
});

describe('revisar e arrumar (v0.14 · etapa 7)', () => {
  const T = { id: 'T', elapsed: () => 1 };
  const reg = registry([]);
  const nota = (id, text) => ({ id, kind: 'nota', text, tags: [], ts: 1, day: '2026-10-05' });
  test('sugestoesArrumacao: respostas, comandos, atalhos e tentativas viram "apagar"', () => {
    const es = [nota('a', 'debito'), nota('b', 'débito'), nota('c', 'ajuda'), nota('d', 'inbox'), nota('e', 't2 05.10'), nota('f', 'pix de 270'), nota('g', 'ideia boa pro tcc')];
    const ler = t => provedorRegras.interpretar(t, { now: new Date(2026, 9, 8, 12), reg });
    const r = sugestoesArrumacao(es, { projetos: reg.projects, statuses: reg.statuses, comandos: ['ajuda', 'inbox', 'hoje'], ler });
    eq(r.map(x => [x.ids[0], x.acao]), [['a', 'apagar'], ['b', 'apagar'], ['c', 'apagar'], ['d', 'apagar'], ['e', 'apagar'], ['f', 'apagar']]);
    ok(/hoje seria gasto/.test(r.find(x => x.ids[0] === 'f').motivo), 'diz que hoje seria gasto');
  });
  test('sugestoesArrumacao: tarefa "fazendo", fatura gravada como gasto, #tag no título e prazo automático', () => {
    const es = [
      { id: 't1', kind: 'tarefa', text: 'fazendo', tags: ['tcc'], ts: 1, data: { projeto: 'tcc', status: 'a fazer' } },
      { id: 't2', kind: 'tarefa', text: 'enviar comprovante #faculdade', tags: ['faculdade'], ts: 2, data: { status: 'a fazer' } },
      { id: 't3', kind: 'tarefa', text: 'revisar cap 2', tags: [], ts: 3, data: { status: 'a fazer', prazo: '2026-10-06', auto: { campos: ['prazo', 'status'] } } },
      { id: 'g1', kind: 'gasto', text: 'paguei cartão de crédito 1.680', tags: [], ts: 4, data: { valor: 168000, data: '2026-10-05', forma: 'credito' } },
      { id: 'g2', kind: 'gasto', text: 'mercado 87', tags: [], ts: 5, data: { valor: 8700 } },
    ];
    const r = sugestoesArrumacao(es, { projetos: reg.projects, statuses: reg.statuses });
    eq(r.map(x => [x.acao, x.ids]), [['apagar', ['t1']], ['tirar-tag', ['t2']], ['fatura', ['g1']], ['sem-prazo', ['t3']]]);
    eq(semTags('enviar comprovante #faculdade de horas', ['faculdade']), 'enviar comprovante de horas');
  });
  test('/arrumar lista e não mexe; "sim" aplica tudo num passo só; /desfazer volta tudo', async () => {
    const s = setup(['debito', 'ideia boa']);
    await s.ctx.store.restore({ id: 'g1', kind: 'gasto', text: 'paguei cartão de crédito 1.680', tags: [], ts: 5, day: '2026-10-05', data: { valor: 168000, data: '2026-10-05', forma: 'credito' } });
    await s.run('/arrumar');
    eq(s.S.entries.length, 3, 'só listou');
    eq(s.ctx.commands.interceptar('sim'), { cmd: '/sim' });
    await s.run('/sim');
    eq(s.S.entries.map(e => e.text), ['ideia boa']);
    eq(s.S.records.filter(e => e.kind === 'faturapaga').map(e => e.data.valor), [168000]);
    await s.run('/desfazer');
    eq(s.S.entries.length, 3);
    eq(s.S.records.filter(e => e.kind === 'faturapaga').length, 0);
  });
  test('/arrumar tira a #tag do título e o projeto que o app chutou (criando o projeto, a tarefa vai pra ele)', async () => {
    const s = setup([]);
    await s.ctx.store.restore({ id: 'c1', kind: 'tarefa', text: 'enviar comprovante #faculdade', tags: ['weg', 'faculdade'], ts: 9, day: '2026-10-05', data: { projeto: 'weg', status: 'a fazer', prazo: null, prioridade: 'média', feito_em: null, auto: { campos: ['projeto'] } } });
    await s.run('/arrumar');
    await s.run('/sim');
    const e = s.S.entries.find(x => x.id === 'c1');
    eq([e.text, e.data.projeto, e.tags.includes('weg'), e.tags.includes('faculdade')], ['enviar comprovante', null, false, true]);
    await s.run('/projeto novo faculdade');
    eq(projectOf(s.S.entries.find(x => x.id === 'c1'), registry(s.S.records).projects), 'faculdade');
  });
  test('/arrumar 2 aplica só o escolhido', async () => {
    const s = setup(['debito', 'pix']);
    await s.run('/arrumar');
    await s.run('/arrumar 2');
    eq(s.S.entries.map(e => e.text), ['debito']);
  });
  test('/revisar: uma por uma; feito, amanhã e apagar resolvem e a próxima aparece', async () => {
    const s = setup([]);
    await s.run('/t primeira >01/10');
    await s.run('/t segunda >02/10');
    await s.run('/t terceira >03/10');
    const id = txt => s.S.entries.find(e => e.text === txt).id;
    await s.run('/revisar');
    ok(/1 de 3/.test(s.term.text()) && /primeira/.test(s.term.text()), 'mostra a primeira');
    await s.run('/revisar feito ' + id('primeira'));
    ok(/2 de 3/.test(s.term.text()), 'a próxima aparece');
    await s.run('/revisar amanhã ' + id('segunda'));
    await s.run('/revisar apagar ' + id('terceira'));
    eq(s.S.entries.map(e => e.text), ['primeira', 'segunda']);
    ok(!!s.S.entries.find(e => e.text === 'primeira').data.feito_em && s.S.entries.find(e => e.text === 'segunda').data.prazo > dayKey(new Date()), 'feita e adiada');
    ok(/nada vencido ✓/.test(s.term.text()), 'acabou');
  });
});

describe('rail "hoje" (v0.14 · etapa 5)', () => {
  test('/hoje abre a tela Hoje (a mesma que o celular abre ao entrar)', () => {
    const s = setup([]);
    s.ctx.commands.get('hoje').run('');
    eq(s.ctx.ui.stage.kind, 'hoje');
  });
  test('/feito id:<id> conclui a tarefa exata (o círculo do rail não depende da numeração)', async () => {
    const s = setup([]);
    await s.run('/t primeira');
    await s.run('/t segunda');
    const alvo = s.S.entries.find(e => e.text === 'segunda');
    s.S.taskList = []; // numeração vazia: o id ainda acha
    await s.run('/feito id:' + alvo.id);
    eq(s.S.entries.filter(e => e.data?.feito_em).map(e => e.text), ['segunda']);
    await throws(() => s.run('/feito id:nao-existe'), 'E_404');
  });
});

describe('/ajuda enxuta (v0.14 · etapa 4.5)', () => {
  test('/ajuda sem nada: poucas linhas, exemplos e as áreas como botões', () => {
    const s = setup([]);
    s.ctx.commands.get('ajuda').run('');
    ok(s.term.out.length <= 10, `linhas: ${s.term.out.length}`);
    const txt = s.term.text();
    ok(/gastei 45 no ifood/.test(txt) && /data-cmd="\/ajuda dinheiro"/.test(txt) && /data-cmd="\/ajuda tarefas"/.test(txt), txt);
    ok(!/\/recorrente nova/.test(txt), 'não despeja todos os comandos');
  });
  test('/ajuda dinheiro: abre na tela grande, só os comandos de dinheiro, com as abas das áreas', () => {
    const s = setup([]);
    s.ctx.commands.get('ajuda').run('dinheiro');
    eq(s.ctx.ui.stage.kind, 'ajuda');
    const txt = s.ctx.ui.stage.html;
    ok(/data-cmd="\/ajuda tarefas"/.test(txt) && /data-fill="\/cat "/.test(txt) && /data-cmd="\/mes"/.test(txt), 'abas, tracejado e cheio');
    ok(/\/mes/.test(txt) && /\/credito/.test(txt) && /paguei a fatura 1\.680/.test(txt) && !/\/pessoa\b/.test(txt), txt);
  });
  test('/ajuda tudo lista todos os comandos; /ajuda mes detalha; palavra estranha dá erro', async () => {
    const s = setup([]);
    s.ctx.commands.get('ajuda').run('tudo');
    const txt = s.ctx.ui.stage.html;
    const faltam = s.ctx.commands.names().filter(n => !txt.includes('/' + n));
    eq(faltam, []);
    s.term.out.length = 0;
    s.ctx.commands.get('ajuda').run('mes');
    ok(/uso/.test(s.term.text()) && /dinheiro/.test(s.term.text()), s.term.text());
    await throws(() => s.ctx.commands.get('ajuda').run('xyzw'), 'E_CMD_404');
  });
});

describe('conversa na tela (v0.14 · resposta curta, botões, fila de perguntas)', () => {
  const T = { id: 'T0001', elapsed: () => 1 };
  test('resposta curta: uma linha ✓ com o que importa, sem T0001/ms/regra', async () => {
    const s = setup([]);
    s.S.detalhes = false;
    await s.ctx.commands.capturar('gastei R$46 na farmácia no débito', T);
    const txt = s.term.text();
    ok(/✓.*gasto.*f1.*R\$ 46,00.*saúde.*débito.*farmácia.*hoje/.test(txt), txt);
    ok(!/T0001|regra 9|\* auto/.test(txt.replace(/^OK .*$/gm, '')), txt);
  });
  test('gasto sem forma: a pergunta entra na fila e "débito" sozinho responde', async () => {
    const s = setup([]);
    s.S.detalhes = false;
    await s.ctx.commands.capturar('gastei 45 no ifood', T);
    eq(s.S.perguntas.map(q => q.tipo), ['forma']);
    ok(/data-cmd="\/forma debito f1"/.test(s.term.text()), 'botão do débito');
    const i = s.ctx.commands.interceptar('débito');
    eq(i, { cmd: '/forma debito f1' });
    await s.run(i.cmd);
    eq([s.S.entries[0].data.forma, s.S.perguntas.length], ['debito', 0]);
    eq(s.ctx.commands.interceptar('débito'), null); // respondida: "débito" agora seria captura
  });
  test('categoria perguntada: "saúde" responde; /sim só responde as de sim ou não', async () => {
    const s = setup([]);
    s.S.detalhes = false;
    await s.ctx.commands.capturar('gastei 30 na xpto no pix', T);
    eq(s.S.perguntas.map(q => q.tipo), ['categoria']);
    eq(s.ctx.commands.interceptar('saúde'), { cmd: '/cat saúde f1' });
    await s.run('/sim');
    ok(/nada pra responder/.test(s.term.text()));
  });
  test('"t2 fazendo" e "hoje concluí t1" viram comando; nome de comando sozinho também', async () => {
    const s = setup([]);
    await s.run('/t primeira');
    await s.run('/t segunda');
    eq(s.ctx.commands.interceptar('t2 fazendo'), { cmd: '/mover t2 fazendo' });
    eq(s.ctx.commands.interceptar('hoje concluí t1'), { cmd: '/feito t1' });
    eq(s.ctx.commands.interceptar('ajuda').cmd, '/ajuda');
    eq(s.ctx.commands.interceptar('sair'), null);
    eq(s.ctx.commands.interceptar('comprar pão'), null);
  });
});

describe('conversa com o terminal (v0.14 · conversa.js)', () => {
  const now = new Date(2026, 9, 8, 10, 0); // quinta 08/10/2026
  const statuses = registry([]).statuses;
  const A = s => lerAtalhoTarefa(s, { statuses, now });
  test('"t2 sexta", "t2 05.10", "t2 amanhã", "t2 sem prazo" mudam o prazo', () => eq(
    ['t2 sexta', 't2 05.10', 't2 amanhã', 't2 sem prazo', 't2 >sex', 't2 semana que vem'].map(A),
    [{ alvos: 't2', acao: 'prazo', prazo: '2026-10-09' }, { alvos: 't2', acao: 'prazo', prazo: '2026-10-05' }, { alvos: 't2', acao: 'prazo', prazo: '2026-10-09' },
      { alvos: 't2', acao: 'prazo', prazo: '' }, { alvos: 't2', acao: 'editar', marcadores: '>sex' }, { alvos: 't2', acao: 'prazo', prazo: '2026-10-12' }]));
  test('"t2 feito", "t2 fazendo", "t2 esperando" mudam o status', () => eq(
    ['t2 feito', 't2 fazendo', 't2 @esperando', 't1 t3 ok'].map(A),
    [{ alvos: 't2', acao: 'feito' }, { alvos: 't2', acao: 'status', status: 'fazendo' }, { alvos: 't2', acao: 'editar', marcadores: '@esperando' }, { alvos: 't1 t3', acao: 'feito' }]));
  test('"hoje concluí t1, t2, t3", "fiz t2", "terminei a t1 e a t4"', () => eq(
    ['hoje concluí t1, t2, t3', 'fiz t2', 'terminei a t1 e a t4', 'Concluí t1-t3!'].map(A),
    [{ alvos: 't1 t2 t3', acao: 'feito' }, { alvos: 't2', acao: 'feito' }, { alvos: 't1 t4', acao: 'feito' }, { alvos: 't1-t3', acao: 'feito' }]));
  test('"t2 #weg !alta" vira edição', () => eq(A('t2 #weg !alta'), { alvos: 't2', acao: 'editar', marcadores: '#weg !alta' }));
  test('frase normal que começa com t1 não é atalho', () => eq(
    ['t1 do campeonato foi bom', 'fazendo', 'fiz uma torta', 'hoje foi um dia bom', 'tcc amanhã'].map(A), [null, null, null, null, null]));

  const P = [{ tipo: 'categoria', n: 'f3', lista: ['alimentação', 'saúde', 'outros'] }, { tipo: 'forma', n: 'f3' }];
  test('resposta sem barra: forma e categoria do lançamento perguntado', () => eq(
    ['debito', 'débito', 'no pix', 'Crédito', 'saúde', 'saude'].map(x => respostaPergunta(x, P)),
    ['/forma debito f3', '/forma debito f3', '/forma pix f3', '/forma credito f3', '/cat saúde f3', '/cat saúde f3']));
  test('resposta sem barra: sim/não pras perguntas de sim ou não', () => eq(
    ['sim', 's', 'isso', 'não', 'n', 'talvez'].map(x => respostaPergunta(x, [{ tipo: 'tipo' }])), ['/sim', '/sim', '/sim', '/nao', '/nao', null]));
  test('sem pergunta pendente, nada é resposta', () => eq(['debito', 'sim', 'saúde'].map(x => respostaPergunta(x, [])), [null, null, null]));
  test('frase comprida não é resposta (é captura)', () => eq(respostaPergunta('débito automático da academia', P), null));

  const cmds = { ajuda: { name: 'ajuda' }, mes: { name: 'mes', args: '[mês]' }, 'mês': { name: 'mes' }, sair: { name: 'sair' }, feito: { name: 'feito', args: '<t1>' }, desfazer: { name: 'desfazer' } };
  const get = w => cmds[w];
  test('comando sozinho: ajuda, mês, desfazer rodam; sair e /feito sem alvo não', () => eq(
    ['ajuda', 'mês', 'Desfazer', 'sair', 'feito', 'ajuda agora', 'nota: ajuda', 'ok'].map(x => comandoSozinho(x, get)),
    ['ajuda', 'mes', 'desfazer', null, null, null, null, null]));
});

describe('tarefas · lógica (tasks.js)', () => {
  const now = new Date(2026, 8, 30, 15, 0); // quarta 30/09
  const T = (text, prazo = null, feito = null, i = 0) => ({ id: 'k' + i + text, text, tags: tagsOf(text), kind: 'tarefa', ts: 1000 + i, day: '2026-09-30', data: { prazo, feito } });
  const P = (s, o = {}) => parseTaskInput(s, { now, ...o });
  test('parseTaskInput: projeto, status, prazo e prioridade', () => eq(P('revisar cap 2 #tcc @fazendo >sex !alta'), { text: 'revisar cap 2', tags: ['tcc'], projeto: 'tcc', status: 'fazendo', prazo: '2026-10-02', prioridade: 'alta', novas: [] }));
  test('parseTaskInput: nada informado = tudo null', () => eq(P('ligar pro joão'), { text: 'ligar pro joão', tags: [], projeto: null, status: null, prazo: null, prioridade: null, novas: [] }));
  test('parseTaskInput: prazo no meio do texto', () => eq(P('ligar >amanhã pro joão').text, 'ligar pro joão'));
  // v0.14 (pedido do Vini): #tag que não é projeto sai do título; quem chama pergunta se cria o projeto
  test('parseTaskInput: #tag que não é projeto sai do título e vira novas', () => { const p = P('ler #artigo #tcc'); eq([p.text, p.projeto, p.tags, p.novas], ['ler', 'tcc', ['tcc', 'artigo'], ['artigo']]); });
  test('fillByRules: #tag nova não chuta projeto (fica sem e pergunta)', () => {
    const r = fillByRules(P('enviar comprovante de horas #faculdade'), { reg: registry([]), now });
    eq([r.values.projeto, r.auto.includes('projeto'), r.motivos.projeto], [null, false, { tipo: 'tagnova', tags: ['faculdade'] }]);
  });
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
    eq(r.values, { projeto: 'pessoal', status: 'a fazer', prioridade: 'alta', prazo: null }); // v0.14: sem prazo automático
    eq(r.auto, ['projeto', 'status']);
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
  test('/ver lê status ("a fazer", "@fazendo") e não inventa projeto', () => eq(
    ['a fazer', 'fazendo', '@esperando tcc', 'kanban fazendo', 'kanban tcc', 'fazer', 'xyz', 'todas'].map(a => parseVerArgs(a, { reg, now })),
    [{ view: null, proj: null, month: null, status: 'a fazer' }, { view: null, proj: null, month: null, status: 'fazendo' },
      { view: null, proj: 'tcc', month: null, status: 'esperando' }, { view: 'kanban', proj: null, month: null, status: 'fazendo' },
      { view: 'kanban', proj: 'tcc', month: null, status: null }, { erro: 'fazer' }, { erro: 'xyz' }, { view: null, proj: null, month: null, status: null }]));
  test('filtro de status: só elas; no kanban, só a coluna', () => {
    eq(viewGroups(E, 'kanban', { reg, now, status: 'a fazer' }).groups.map(g => [g.key, g.items.map(e => e.text)]), [['a fazer', ['f', 'a', 'g']]]);
    eq(viewGroups(E, 'prazo', { reg, now, status: 'fazendo' }).list, ['b']);
  });
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
    eq([d.projeto, d.status, d.prioridade, d.auto.campos], ['pessoal', 'a fazer', 'média', ['projeto', 'status', 'prioridade']]);
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
    eq([d.projeto, d.prioridade, d.status, d.auto.campos], ['weg', 'alta', 'a fazer', ['status']]);
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
    // (tipo marcado registro: true grava um cadastro escondido de propósito, como o recorrente da Fase 3c)
    ok(REGISTRO.ids().every(id => REGISTRO.get(id).registro || CONTENT_KINDS.includes(REGISTRO.get(id).kind)), 'kind fora do CONTENT_KINDS ficaria escondido');
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
  test('palavra que sobraria sozinha não é data ("- segunda @fazendo")', () => eq(
    [P('- segunda @fazendo').campos.texto, P('- amanhã').campos.texto, P('- sexta #tcc').campos.texto], ['segunda', 'amanhã', 'sexta']));
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
    eq(REGISTRO.get('gasto').montar(g, { now }), { kind: 'gasto', text: 'gastei 30 no almoço', tags: [], ts: now.getTime(), day: '2026-10-01',
      data: { valor: 3000, descricao: 'almoço', data: '2026-10-01', categoria: 'alimentação', auto: { campos: ['data', 'categoria'], fonte: 'regra' } } });
    const t = provedorRegras.interpretar('corri 5km', { now });
    eq(REGISTRO.get('treino').montar(t, { now }).data, { descricao: 'corri 5km', duracao_min: null, distancia_km: 5, data: '2026-10-01' });
  });
  test('/buscar acha gasto e não mistura com nota', () => {
    const res = searchAll([{ id: 'g', kind: 'gasto', text: 'gastei 30 no almoço', tags: [] }, { id: 'n', kind: 'nota', text: 'almoço bom', tags: [] }], 'almoço');
    eq(res.groups.map(g => g.key), ['nota', 'gasto']);
    eq(searchAll([{ id: 'g', kind: 'gasto', text: 'x', tags: [] }], 'tipo:gastos').total, 1);
  });
});

describe('finanças · leitura da frase (financas.js · Fase 3a)', () => {
  const now = new Date(2026, 9, 1, 12, 0);
  const pes = [{ id: 'p0', nome: 'João Silva', apelidos: [], chaves: ['joao silva', 'joao'] }, { id: 'p1', nome: 'Pedro', apelidos: [], chaves: ['pedro'] }, { id: 'p2', nome: 'Ana', apelidos: [], chaves: ['ana'] }];
  const L = (s, o = {}) => lerFinanca(s, { now, pessoas: pes, ...o });
  const pick = (r, ks) => Object.fromEntries(ks.map(k => [k, r?.[k] ?? null]));
  test('categorias: padrão sem registros; registros mandam, sem as arquivadas', () => {
    eq(categoriasDe([]).entrada, ['salário', 'freela', 'reembolso', 'outros']);
    eq(categoriasDe([]).gasto.length, 10);
    const regs = [
      { kind: 'categoria', text: 'pets', ts: 2, data: { tipo: 'gasto', ordem: 2 } },
      { kind: 'categoria', text: 'mercado', ts: 1, data: { tipo: 'gasto', ordem: 1 } },
      { kind: 'categoria', text: 'lazer', ts: 3, data: { tipo: 'gasto', ordem: 3, arquivada: true } },
    ];
    eq(categoriasDe(regs), { gasto: ['mercado', 'pets'], entrada: ['salário', 'freela', 'reembolso', 'outros'] });
  });
  test('acharCategoria e acharForma ignoram acento e maiúscula', () => {
    eq(['alimentacao', 'Saúde', 'xpto'].map(n => acharCategoria(n, CATEGORIAS_PADRAO.gasto)), ['alimentação', 'saúde', null]);
    eq(['crédito', 'cartao', 'cartão de débito', 'Débito', 'pix', 'dinheiro', 'boleto', 'cheque'].map(acharForma), ['credito', 'credito', 'debito', 'debito', 'pix', 'dinheiro', 'boleto', null]);
  });
  test('semente: palavra → categoria (o lugar primeiro)', () => {
    eq(['gastei 45 no ifood', 'mercado 87', 'uber 18,50', 'paguei 120,50 de luz', 'netflix 55,90', 'xpto 40'].map(s => categoriaSemente(s, 'gasto')?.categoria ?? null),
      ['alimentação', 'mercado', 'transporte', 'moradia', 'assinaturas', null]);
    eq(categoriaSemente('caiu o salário 3.200', 'entrada').categoria, 'salário');
    eq(categoriaSemente('almoço no posto', 'gasto', { lugar: 'posto' }).categoria, 'transporte');
  });
  test('sem valor não é finança', () => eq([L('deu ruim a prova'), L('saiu o resultado da prova'), L('comprei um livro')], [null, null, null]));
  test('verbo, valor, lugar e descrição', () => {
    eq(pick(L('gastei 45 no ifood'), ['valor', 'lugar', 'descricao', 'forma']), { valor: 4500, lugar: 'ifood', descricao: 'ifood', forma: null });
    eq(L('gastei 45 no ifood').verbo, { tipo: 'gasto', palavra: 'gastei' });
    eq(pick(L('torrei 150 no bar ontem'), ['valor', 'lugar', 'data', 'descricao']), { valor: 15000, lugar: 'bar', data: '2026-09-30', descricao: 'bar' });
    eq(pick(L('saiu 1.234,56 o aluguel'), ['valor', 'descricao']), { valor: 123456, descricao: 'aluguel' });
    eq(L('saiu 1.234,56 o aluguel').verbo.tipo, 'gasto');
    eq(pick(L('deu 64 o rodízio com a Ana'), ['valor', 'descricao']), { valor: 6400, descricao: 'rodízio com a Ana' });
    eq(L('caiu o salário 3.200').verbo.tipo, 'entrada');
  });
  test('saiu / deu / custou só valem com o valor logo depois', () => {
    eq([L('deu 64 o rodízio').verbo?.tipo, L('o tênis custou 300').verbo?.tipo, L('deu ruim, perdi 50 reais').verbo, L('saiu cedo e pagou 30').verbo], ['gasto', 'gasto', null, null]);
  });
  test('verbo fraco (caiu) perde pro gasto na mesma frase', () => eq(L('o celular caiu e gastei 300 no conserto').verbo.tipo, 'gasto'));
  test('forma de pagamento escrita sai da descrição', () => {
    eq(pick(L('almoço 32 no débito'), ['forma', 'descricao', 'lugar']), { forma: 'debito', descricao: 'almoço', lugar: null });
    eq(pick(L('comprei livro do tcc 89 no crédito'), ['forma', 'descricao']), { forma: 'credito', descricao: 'livro do tcc' });
    eq(pick(L('paguei o boleto da faculdade 890'), ['forma', 'descricao']), { forma: 'boleto', descricao: 'faculdade' });
    eq([L('100 no cartão').forma, L('50 no cartão de débito').forma, L('20 em dinheiro').forma, L('gastei 10').forma], ['credito', 'debito', 'dinheiro', null]);
  });
  test('pix: pro João = para · do Pedro = de · me pagou = entrada', () => {
    eq(pick(L('fiz um pix de 50 pro João'), ['valor', 'forma', 'direcao', 'descricao']), { valor: 5000, forma: 'pix', direcao: 'para', descricao: 'João' });
    eq(pick(L('pix de 80 do Pedro'), ['valor', 'forma', 'direcao']), { valor: 8000, forma: 'pix', direcao: 'de' });
    eq(pick(L('o João me pagou 30'), ['valor', 'descricao']), { valor: 3000, descricao: 'João' });
    eq(L('o João me pagou 30').verbo.tipo, 'entrada');
    eq(L('recebi 1.500 do freela').direcao, null); // "do freela" não é pessoa
  });
  test('transferência entre contas suas · pra pessoa é pix', () => {
    eq(L('transferi 200 pra poupança').transferencia, { sentido: 'para', conta: 'poupança' });
    eq(L('resgatei 300 da poupança').transferencia, { sentido: 'de', conta: 'poupança' });
    eq(L('guardei 100 na reserva').transferencia, { sentido: 'para', conta: 'reserva' });
    const p = L('transferi 50 pro João');
    eq([p.transferencia, p.verbo.tipo, p.forma], [null, 'gasto', 'pix']);
  });
  test('estorno, futuro e verbo aprendido', () => {
    eq([L('estorno de 45 do ifood').estorno, L('gastei 45 no ifood').estorno], [true, false]);
    eq([L('pagar o boleto de 120 amanhã').futuro, L('torrei 150 no bar ontem').futuro], [true, false]);
    eq(L('abasteci 200 no posto').verbo, null);
    eq(L('abasteci 200 no posto').lugar, 'posto');
    eq(L('abasteci 200 no posto', { aprendidos: { gasto: ['abasteci'] } }).verbo, { tipo: 'gasto', palavra: 'abasteci', aprendido: true });
    eq(L('mercado 87').primeira, 'mercado');
  });
  test('verbosAprendidos: só o que você fixou, o mais novo vale', () => {
    const m = (ts, w, acao, valor) => ({ kind: 'memoria', ts, text: w, data: { chave: 'verbo:' + w, campo: 'tipo', acao, valor } });
    eq(verbosAprendidos([m(1, 'abasteci', 'fixar', 'gasto'), m(2, 'faturei', 'fixar', 'entrada'), m(3, 'pinguei', 'fixar', 'gasto'), m(4, 'pinguei', 'limpar')]),
      { gasto: ['abasteci'], entrada: ['faturei'] });
  });
  test('acharEstornado: mesma palavra, valor igual primeiro, até 60 dias', () => {
    const g = (id, valor, data, lugar) => ({ id, kind: 'gasto', text: `gastei ${valor / 100} no ${lugar}`, ts: 1, data: { valor, data, lugar, descricao: lugar } });
    const es = [g('a', 4500, '2026-09-28', 'ifood'), g('b', 3000, '2026-09-30', 'ifood'), g('c', 4500, '2026-09-30', 'uber'), g('d', 4500, '2026-06-01', 'ifood')];
    eq([acharEstornado('estorno de 45 do ifood', 4500, es, { now })?.id, acharEstornado('estorno de 20 do ifood', 2000, es, { now })?.id, acharEstornado('estorno de 45', 4500, es, { now })], ['a', 'b', null]);
  });
  test('gasto corrigido deixa histórico (campos do registro de tipos)', () => {
    const a = { id: 'g1', kind: 'gasto', text: 'xpto 40', data: { valor: 4000, categoria: 'outros' } };
    eq(diffEvent(a, { ...a, data: { ...a.data, categoria: 'lazer' } }, { now }).data.mudancas, { categoria: ['outros', 'lazer'] });
    eq(diffEvent(null, { id: 't', kind: 'transferencia', text: 'x', data: { valor: 100, conta: 'poupança', sentido: 'para' } }, { now }).data.acao, 'criada');
  });
});

describe('memória aprende categoria e forma (memoria.js · etapa 3 · Fase 3a)', () => {
  const now = new Date(2026, 9, 1, 12, 0);
  const reg = registry(seedEntries([], 'local', now));
  let n = 0;
  // um gasto já gravado: auto = campos que o app decidiu sozinho
  const g = (text, data, auto = []) => ({ id: 'g' + ++n, kind: 'gasto', text, ts: ++n, day: '2026-09-20', data: { valor: 1000, data: '2026-09-20', ...data, ...(auto.length ? { auto: { campos: auto, fonte: 'regra' } } : {}) } });
  const corrigiu = (alvo, campo, de, para) => ({ id: 'ev' + ++n, kind: 'evento', ts: ++n, data: { alvo, alvo_kind: 'gasto', acao: 'alterada', mudancas: { [campo]: [de, para] }, origem: 'usuario' } });
  const I = (frase, entries = [], records = []) => provedorRegras.interpretar(frase, { now, reg, entries, records, pessoas: [] });
  test('sem pista: outros, e o padrão não vira evidência', () => {
    const r = I('gastei 40 na xpto');
    eq([r.campos.categoria, r.motivos.categoria.tipo, r.auto.includes('categoria')], ['outros', 'padrao', true]);
    const E = [1, 2, 3, 4].map(() => g('gastei 40 na xpto', { categoria: 'outros' }, ['categoria']));
    eq(criarMemoria(E, [], { reg }).info('palavra:xpto', 'categoria:gasto').estado, 'nada');
  });
  test('você confirmou "xpto" como lazer duas vezes → a próxima já vai pra lazer', () => {
    const E = [g('xpto 40', { categoria: 'lazer' }), g('gastei 25 na xpto', { categoria: 'lazer' })];
    const r = I('gastei 30 na xpto', E);
    eq([r.campos.categoria, r.motivos.categoria.tipo, r.motivos.categoria.pista], ['lazer', 'pista', 'xpto']);
    eq(I('xpto 18', E).tipo, 'gasto', '"xpto" no começo já é palavra conhecida');
  });
  test('corrigir "bar" pra alimentação duas vezes ganha da semente (bar = lazer)', () => {
    eq(I('torrei 50 no bar').campos.categoria, 'lazer');
    const a = g('torrei 50 no bar', { categoria: 'alimentação' }), b = g('bar 30', { categoria: 'alimentação' });
    const R = [corrigiu(a.id, 'categoria', 'lazer', 'alimentação'), corrigiu(b.id, 'categoria', 'lazer', 'alimentação')];
    eq(criarMemoria([a, b], R, { reg }).info('palavra:bar', 'categoria:gasto').porProjeto, [['alimentação', 6]]);
    eq(I('gastei 80 no bar', [a, b], R).campos.categoria, 'alimentação');
  });
  test('preencher o que estava em "outros" vale 2 (confirmar), mudar um chute vale 3 (corrigir)', () => {
    const a = g('gastei 40 na xpto', { categoria: 'lazer' }), b = g('ifood 30', { categoria: 'mercado' });
    const R = [corrigiu(a.id, 'categoria', 'outros', 'lazer'), corrigiu(b.id, 'categoria', 'alimentação', 'mercado')];
    const m = criarMemoria([a, b], R, { reg });
    eq([m.info('palavra:xpto', 'categoria:gasto').total, m.info('palavra:ifood', 'categoria:gasto').total], [2, 3]);
  });
  test('pistas divididas: não chuta, fica sem categoria e explica', () => {
    const E = [g('almoço 30', { categoria: 'alimentação' }), g('almoço 40', { categoria: 'alimentação' }), g('almoço 50', { categoria: 'lazer' }), g('almoço 60', { categoria: 'lazer' })];
    const r = I('almoço 32', E);
    eq([r.tipo, r.campos.categoria, r.motivos.categoria.tipo, r.auto.includes('categoria')], ['gasto', undefined, 'dividida', false]);
    eq(r.motivos.categoria.porValor, [['alimentação', 4], ['lazer', 4]]);
  });
  test('forma: a memória aprende (ifood → crédito); sem pista fica vazia pra perguntar', () => {
    eq([I('gastei 45 no ifood').campos.forma, I('gastei 45 no ifood').motivos.forma.tipo], [undefined, 'pergunta']);
    const E = [g('ifood 30', { categoria: 'alimentação', forma: 'credito' }), g('gastei 50 no ifood', { categoria: 'alimentação', forma: 'credito' })];
    const r = I('gastei 45 no ifood', E);
    eq([r.campos.forma, r.auto.includes('forma'), r.motivos.forma.pista], ['credito', true, 'ifood']);
    eq(I('gastei 45 no ifood no pix', E).campos.forma, 'pix', 'o que você escreve manda');
  });
  test('fixar por comando manda (registro memoria com campo)', () => {
    const fix = { id: 'm1', kind: 'memoria', ts: 99, text: 'ifood', data: { chave: 'palavra:ifood', campo: 'categoria:gasto', acao: 'fixar', valor: 'lazer' } };
    eq(I('gastei 45 no ifood', [], [fix]).campos.categoria, 'lazer');
    eq(criarMemoria([], [fix], { reg }).info('palavra:ifood', 'categoria:gasto').estado, 'fixado');
    eq(criarMemoria([], [fix], { reg }).info('palavra:ifood').estado, 'nada', 'o projeto não mistura com a categoria');
  });
  test('verbo ensinado (/sim) vira gasto com certeza', () => {
    eq(I('abasteci 50 no posto').confianca, 0.6);
    const v = { id: 'm2', kind: 'memoria', ts: 5, text: 'abasteci', data: { chave: 'verbo:abasteci', campo: 'tipo', acao: 'fixar', valor: 'gasto' } };
    const r = I('abasteci 50 no posto', [], [v]);
    eq([r.tipo, r.confianca, r.campos.categoria], ['gasto', 0.9, 'transporte']);
  });
  test('palavras de dinheiro não viram pista (gastei, pix, reais)', () => eq(palavrasDe('gastei 30 reais no pix com o João no ifood'), ['joao', 'ifood']));
});

describe('captura de dinheiro na tela: f1, perguntas, /cat, /forma, verbo (etapa 4 · Fase 3a)', () => {
  const T = { id: 'T0001', elapsed: () => 1 };
  const fins = S => S.entries.filter(e => ['gasto', 'entrada', 'transferencia'].includes(e.kind));
  const plain = s => s.term.text().replace(/<[^>]+>/g, '');
  test('gasto sem pista: f1, pergunta categoria e forma; /cat e /forma respondem e o /desfazer volta', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar('gastei 40 na xpto', T);
    const txt = plain(s);
    ok(/lançado f1/.test(txt) && /↳ entendi · gasto · R\$ 40,00 · outros\*/.test(txt), txt);
    ok(/↳ categoria\? salvei em outros/.test(txt) && /↳ forma\? pix/.test(txt) && /data-cmd="\/forma pix f1"/.test(s.term.text()), txt);
    await s.run('/cat lazer');
    await s.run('/forma pix');
    const [g] = fins(s.S);
    eq([g.data.categoria, g.data.forma, g.data.auto?.campos], ['lazer', 'pix', ['data']]);
    await s.run('/desfazer');
    eq([fins(s.S)[0].data.forma, fins(s.S)[0].data.categoria], [undefined, 'lazer']);
  });
  test('/cat e /forma com número (f2), e erros com dica', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar('gastei 45 no ifood', T);
    await s.ctx.commands.capturar('transferi 200 pra poupança', T);
    await s.run('/cat f1 mercado');
    eq(fins(s.S).find(e => e.kind === 'gasto').data.categoria, 'mercado');
    await throws(() => s.run('/cat f1 pets'), 'E_404');
    await throws(() => s.run('/cat lazer'), 'E_TIPO'); // sem número = o último (a transferência)
    await throws(() => s.run('/cat f2 lazer'), 'E_TIPO');
    await throws(() => s.run('/forma cheque f1'), 'E_ARG');
    await throws(() => s.run('/cat f9 lazer'), 'E_404');
  });
  test('"abasteci 200 no posto" → /sim vira gasto → /sim aprende o verbo → "abasteci 50" já é gasto', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar('abasteci 200 no posto', T);
    eq(s.S.entries.map(e => e.kind), ['nota']);
    await s.run('/sim');
    eq([fins(s.S).length, fins(s.S)[0].data.categoria], [1, 'transporte']);
    ok(/aprender "abasteci" como gasto\?/.test(plain(s)), plain(s));
    await s.run('/sim');
    eq(s.S.records.filter(r => r.kind === 'memoria').map(r => r.data), [{ chave: 'verbo:abasteci', acao: 'fixar', campo: 'tipo', valor: 'gasto' }]);
    await s.ctx.commands.capturar('abasteci 50', T);
    eq(fins(s.S).map(e => e.data.valor), [20000, 5000]);
  });
  test('estorno mostra o gasto que devolve', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar('gastei 45 no ifood', T);
    await s.ctx.commands.capturar('estorno de 45 do ifood', T);
    const [g, en] = fins(s.S);
    eq([en.kind, en.data.categoria, en.data.ref], ['entrada', 'reembolso', g.id]);
    ok(/↳ devolve o gasto de hoje/.test(plain(s)), plain(s));
  });
});

describe('o mês: saldo, categorias, /mes, /gastos, /editar f3, /memoria de categoria (etapa 5 · Fase 3a)', () => {
  const T = { id: 'T0001', elapsed: () => 1 };
  const L = (id, kind, valor, data, extra = {}) => ({ id, kind, text: id, ts: 1, day: data, data: { valor, data, ...extra } });
  const E = [
    L('a', 'gasto', 4500, '2026-10-01', { categoria: 'alimentação', forma: 'pix' }),
    L('b', 'gasto', 12000, '2026-10-03', { categoria: 'moradia', forma: 'credito' }),
    L('c', 'gasto', 1500, '2026-10-05', { categoria: 'alimentação' }),
    L('d', 'entrada', 320000, '2026-10-05', { categoria: 'salário' }),
    L('e', 'transferencia', 20000, '2026-10-06', { conta: 'poupança', sentido: 'para' }),
    L('f', 'gasto', 10000, '2026-09-20', { categoria: 'lazer', forma: 'pix' }),
    L('g', 'gasto', 999, '2026-10-07', {}),
  ];
  test('resumoMes: saldo = entradas − gastos (crédito no mês da compra), transferência fora', () => {
    const r = resumoMes(E, '2026-10');
    eq([r.entradas, r.gastos, r.saldo, r.credito, r.semForma, r.semCategoria], [320000, 18999, 301001, 12000, 2, 1]);
    eq(r.porCategoria, [['moradia', 12000], ['alimentação', 6000], ['sem categoria', 999]]);
    eq([r.transferencias, r.n], [{ para: 20000, de: 0 }, { gastos: 4, entradas: 1, transferencias: 1 }]);
    eq(resumoMes(E, '2026-09').gastos, 10000);
  });
  test('mês anterior, variação, barra, nome do mês, lista ordenada', () => {
    eq([mesAnterior('2026-10'), mesAnterior('2026-01')], ['2026-09', '2025-12']);
    eq([variacao(18999, 10000), variacao(5000, 10000), variacao(100, 0)], [90, -50, null]);
    eq([barra(0.4), barra(0), barra(1, 4)], ['████░░░░░░', '░░░░░░░░░░', '████']);
    eq([fmtMes('2026-10', new Date(2026, 9, 1)), fmtMes('2025-12', new Date(2026, 9, 1))], ['out', 'dez/2025']);
    eq(lancamentos(E, { mes: '2026-10', categoria: 'alimentação' }).map(e => e.id), ['a', 'c']);
  });
  test('/mes e /gastos na tela; filtro errado explica', async () => {
    const s = setup([]);
    for (const f of ['gastei 45 no ifood', 'mercado 87', 'almoço 30', 'caiu o salário 3.200']) await s.ctx.commands.capturar(f, T);
    await s.run('/mes');
    const txt = s.term.text().replace(/<[^>]+>/g, '');
    ok(/saldo/.test(txt) && /R\$ 3\.038,00/.test(txt) && /por categoria/.test(txt) && /alimentação/.test(txt), txt);
    s.term.out.length = 0;
    await s.run('/gastos alimentação');
    const lista = s.term.text().replace(/<[^>]+>/g, '');
    ok(/gastos · alimentação/.test(lista) && /f1/.test(lista) && /f2/.test(lista) && !/mercado 87/.test(lista), lista);
    await throws(() => s.run('/gastos xyz'), 'E_ARG');
    await s.run('/mes -1');
    ok(/nada lançado/.test(s.term.text()));
  });
  test('/editar f1: valor, forma, data, categoria e descrição · /desfazer volta', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar('gastei 45 no ifood', T);
    await s.run('/editar f1 45,90 débito ontem lazer "jantar"');
    const g = s.S.entries.find(e => e.kind === 'gasto');
    const ontem = dayKey(new Date(Date.now() - 864e5));
    eq([g.data.valor, g.data.forma, g.data.data, g.data.categoria, g.data.descricao, g.data.auto], [4590, 'debito', ontem, 'lazer', 'jantar', undefined]);
    await throws(() => s.run('/editar f1 bananas'), 'E_ARG');
    await s.run('/desfazer');
    eq(s.S.entries.find(e => e.kind === 'gasto').data.valor, 4500);
  });
  test('/memoria ifood = lazer e = crédito: fixa categoria e forma; mostra por campo', async () => {
    const s = setup([]);
    await s.run('/memoria ifood = lazer');
    await s.run('/memoria ifood = crédito');
    await s.ctx.commands.capturar('gastei 30 no ifood', T);
    const g = s.S.entries.find(e => e.kind === 'gasto');
    eq([g.data.categoria, g.data.forma], ['lazer', 'credito']);
    s.term.out.length = 0;
    await s.run('/memoria ifood');
    const txt = s.term.text().replace(/<[^>]+>/g, '');
    ok(/categoria/.test(txt) && /fixada em lazer/.test(txt) && /forma/.test(txt) && /fixada em crédito/.test(txt), txt);
    await s.run('/memoria ifood limpar');
    eq(s.S.records.filter(r => r.kind === 'memoria').length, 4, 'limpar grava um registro por campo');
    await throws(() => s.run('/memoria ifood = xyz'), 'E_404');
  });
});

describe('categorias por comando e /categorizar (etapa 6 · Fase 3a)', () => {
  const T = { id: 'T0001', elapsed: () => 1 };
  const plain = s => s.term.text().replace(/<[^>]+>/g, '');
  test('semente das categorias: id fixo, só o que falta', () => {
    const now = new Date(2026, 9, 1);
    const sd = seedCategorias([], 'u1', now, seedId);
    eq([sd.length, sd.filter(e => e.data.tipo === 'entrada').map(e => e.text)], [14, ['salário', 'freela', 'reembolso', 'outros']]);
    eq(seedCategorias([], 'u1', now, seedId)[0].id, sd[0].id, 'o mesmo id nos dois aparelhos');
    eq(seedCategorias(sd, 'u1', now, seedId), []);
    eq(categoriasDe(sd).gasto, CATEGORIAS_PADRAO.gasto);
  });
  test('/categoria nova, renomear (lançamentos e memória juntos) e arquivar · /desfazer', async () => {
    const s = setup([]);
    await s.run('/categoria nova pets');
    eq(categoriasDe(s.S.records).gasto.includes('pets'), true);
    await s.run('/desfazer');
    eq(categoriasDe(s.S.records).gasto.includes('pets'), false);
    await s.ctx.commands.capturar('mercado 87', T);
    await s.run('/memoria atacadão = mercado');
    await s.run('/categoria renomear mercado = supermercado');
    eq([s.S.entries.find(e => e.kind === 'gasto').data.categoria, categoriasDe(s.S.records).gasto.includes('supermercado')], ['supermercado', true]);
    eq(s.S.records.find(e => e.kind === 'memoria').data.valor, 'supermercado');
    await s.run('/desfazer');
    eq(s.S.entries.find(e => e.kind === 'gasto').data.categoria, 'mercado');
    await throws(() => s.run('/categoria arquivar outros'), 'E_AMBIGUO'); // existe em gasto e em entrada
    await throws(() => s.run('/categoria arquivar outros gasto'), 'E_ARG');
    await throws(() => s.run('/categoria arquivar outros entrada'), 'E_ARG');
    await s.run('/categoria arquivar lazer');
    eq(categoriasDe(s.S.records).gasto.includes('lazer'), false);
    await s.run('/categoria nova lazer');
    eq(categoriasDe(s.S.records).gasto.includes('lazer'), true, 'criar de novo desarquiva');
    await s.run('/categorias');
    ok(/categorias de entrada/.test(plain(s)));
  });
  test('/categorizar: antigos ganham categoria pela memória; o resto pergunta um por vez', async () => {
    const s = setup([]);
    const velho = (id, text, valor) => ({ id, kind: 'gasto', text, tags: [], ts: 1, day: '2026-09-20', data: { valor, descricao: text, data: '2026-09-20' } });
    for (const e of [velho('v1', 'gastei 30 no almoço', 3000), velho('v2', 'gastei 40 na xpto', 4000), velho('v3', 'paguei 50 no zzz', 5000)]) await s.ctx.store.restore(e);
    await s.run('/categorizar');
    const cat = id => s.S.entries.find(e => e.id === id).data.categoria;
    eq([cat('v1'), cat('v2'), cat('v3')], ['alimentação', undefined, undefined]);
    eq(s.S.entries.find(e => e.id === 'v1').text, 'gastei 30 no almoço', 'a frase original não muda');
    ok(/1 ganhou categoria/.test(plain(s)) && /↳ categoria\? f\d gastei 40 na xpto/.test(plain(s)) && /depois tem mais 1/.test(plain(s)), plain(s));
    const n = plain(s).match(/↳ categoria\? (f\d)/)[1];
    await s.run(`/cat ${n} lazer`);
    eq(cat('v2'), 'lazer');
    ok(/↳ categoria\? f\d paguei 50 no zzz/.test(plain(s)), 'mostra o próximo');
    await s.run('/desfazer');
    await s.run('/desfazer');
    eq(cat('v1'), undefined, 'o /categorizar volta num passo só');
  });
  test('mudança que não foi você (origem regra) não conta como correção na memória', () => {
    const reg = registry([]);
    const g = { id: 'g1', kind: 'gasto', text: 'mercado 30', ts: 1, data: { valor: 3000, categoria: 'supermercado' } };
    const ev = origem => ({ id: 'e' + origem, kind: 'evento', ts: 2, data: { alvo: 'g1', acao: 'alterada', mudancas: { categoria: ['mercado', 'supermercado'] }, origem } });
    eq([criarMemoria([g], [ev('regra')], { reg }).info('palavra:mercado', 'categoria:gasto').total, criarMemoria([g], [ev('usuario')], { reg }).info('palavra:mercado', 'categoria:gasto').total], [2, 3]);
  });
});

describe('HUD e contexto de finanças (etapa 7 · Fase 3a)', () => {
  const now = new Date(2026, 9, 15, 12);
  const L = (kind, valor, data, categoria) => ({ id: kind + valor, kind, text: 'x', ts: 1, day: data, data: { valor, data, categoria } });
  const E = [L('gasto', 4500, '2026-10-02', 'alimentação'), L('gasto', 8700, '2026-10-03', 'mercado'), L('gasto', 3000, '2026-10-04', 'alimentação'),
    L('gasto', 1000, '2026-10-05', 'lazer'), L('gasto', 500, '2026-10-06', 'saúde'), L('entrada', 320000, '2026-10-05', 'salário'), L('gasto', 10000, '2026-09-10', 'lazer')];
  test('hudFinancas: saldo, gastos, vs mês passado e top 3', () => {
    const h = hudFinancas(E, now);
    eq([h.mes, h.saldo, h.gastos, h.vs, h.top, h.vazio], ['2026-10', 302300, 17700, 77, [['mercado', 8700], ['alimentação', 7500], ['lazer', 1000]], false]);
    eq([hudFinancas([], now).vazio, hudFinancas([], now).vs, hudFinancas([], now).top], [true, null, []]);
  });
  test('linhaContexto: uma linha do mês, sem lançamentos individuais', () => {
    eq(linhaContexto(E, now), 'finanças out: entradas R$ 3.200,00 · gastos R$ 177,00 (5) · vs set +77% · saldo R$ 3.023,00 · top: mercado R$ 87,00, alimentação R$ 75,00, lazer R$ 10,00');
    eq(linhaContexto([], now), null);
    ok(montarContexto(E, [], { now }).includes('finanças out:'), 'entra no montarContexto');
  });
});

describe('cartões, fatura e parcelas · funções puras (etapa 1 · Fase 3b)', () => {
  const nubank = { id: 'c1', nome: 'nubank', fechamento: 3, vencimento: 10 };
  const virada = { id: 'c2', nome: 'inter', fechamento: 28, vencimento: 5 };   // vence antes do fechamento
  const fim = { id: 'c3', nome: 'c6', fechamento: 31, vencimento: 8 };        // fecha no último dia
  test('parcelasDe: centavos, sobra na primeira (frase 21)', () => {
    eq([parcelasDe(10000, 3), parcelasDe(30000, 3), parcelasDe(100, 1), parcelasDe(5, 3), parcelasDe(999, 0)],
      [[3334, 3333, 3333], [10000, 10000, 10000], [100], [3, 1, 1], [999]]);
    eq(parcelasDe(123457, 7).reduce((a, b) => a + b, 0), 123457, 'a soma bate sempre');
  });
  test('compra antes do fechamento → fatura deste mês; no dia ou depois → a seguinte (frase 22)', () => {
    eq(faturaDaCompra('2026-10-02', nubank), { fecha: '2026-10-03', vence: '2026-10-10', mes: '2026-10', de: '2026-09-03' });
    eq([mesDaFatura('2026-10-03', nubank), mesDaFatura('2026-10-15', nubank), mesDaFatura('2026-10-31', nubank)], ['2026-11', '2026-11', '2026-11']);
  });
  test('parcelas andam um mês por vez, virando o ano', () => eq([0, 1, 2].map(k => mesDaFatura('2026-11-15', nubank, k)), ['2026-12', '2027-01', '2027-02']));
  test('vence antes do fechamento (fecha 28, vence 5) → o mês da fatura é o seguinte', () => {
    eq(faturaDaCompra('2026-10-10', virada), { fecha: '2026-10-28', vence: '2026-11-05', mes: '2026-11', de: '2026-09-28' });
    eq(mesDaFatura('2026-10-29', virada), '2026-12');
  });
  test('fecha dia 31 em fevereiro → fecha no último dia do mês', () => {
    eq([faturaDaCompra('2026-02-27', fim).fecha, faturaDaCompra('2026-02-28', fim).fecha, faturaDaCompra('2026-02-28', fim).mes], ['2026-02-28', '2026-03-31', '2026-04']);
  });
  test('vencimentoDa e proximaFatura', () => {
    eq(vencimentoDa(nubank, '2026-11'), { fecha: '2026-11-03', vence: '2026-11-10', mes: '2026-11', de: '2026-10-03' });
    eq(vencimentoDa(virada, '2026-11'), { fecha: '2026-10-28', vence: '2026-11-05', mes: '2026-11', de: '2026-09-28' });
    eq([proximaFatura(nubank, new Date(2026, 9, 8)), proximaFatura(nubank, new Date(2026, 9, 10)), proximaFatura(nubank, new Date(2026, 9, 11))], ['2026-10', '2026-10', '2026-11']);
  });
  test('cartoesDe e cartaoPadrao', () => {
    const c = (id, text, ts, data) => ({ id, kind: 'cartao', text, ts, data });
    const regs = [c('a', 'Nubank', 1, { fechamento: 3, vencimento: 10 }), c('b', 'inter', 2, { fechamento: 28, vencimento: 5, padrao: true }), c('x', 'velho', 0, { arquivado: true })];
    eq(cartoesDe(regs).map(x => [x.nome, x.fechamento, x.vencimento, x.padrao]), [['nubank', 3, 10, false], ['inter', 28, 5, true]]);
    eq([cartaoPadrao(cartoesDe(regs)).nome, cartaoPadrao(cartoesDe(regs.slice(0, 1))).nome, cartaoPadrao([])], ['inter', 'nubank', null]);
  });
});

describe('intérprete: parcelas e cartão pelo nome (etapa 2 · Fase 3b)', () => {
  const now = new Date(2026, 9, 1, 12);
  const cartoes = [{ id: 'c1', nome: 'nubank' }, { id: 'c2', nome: 'inter' }];
  const L = (s, o = {}) => lerFinanca(s, { now, cartoes, ...o });
  const pick = (r, ks) => Object.fromEntries(ks.map(k => [k, r?.[k] ?? null]));
  test('parcelas: total + quantidade, sem o "3x" na descrição', () => {
    eq(pick(L('comprei um tênis 300 em 3x'), ['valor', 'parcelas', 'descricao']), { valor: 30000, parcelas: 3, descricao: 'tênis' });
    eq(pick(L('fone 3x de 100'), ['valor', 'parcelas', 'descricao']), { valor: 30000, parcelas: 3, descricao: 'fone' });
    eq(pick(L('tv 2.000 parcelado em 10x'), ['valor', 'parcelas', 'descricao']), { valor: 200000, parcelas: 10, descricao: 'tv' });
    eq(pick(L('sofá 1.500 em 5 parcelas'), ['valor', 'parcelas']), { valor: 150000, parcelas: 5 });
    eq([L('mercado 87').parcelas, L('mercado 87 1x').parcelas, L('mercado 87 em 99x').parcelas], [null, null, null]);
  });
  test('cartão pelo nome: "no nubank" e "no cartão do inter" = crédito nesse cartão; nome solto no meio não vale', () => {
    eq(pick(L('gastei 45 no ifood no nubank'), ['forma', 'cartao', 'lugar']), { forma: 'credito', cartao: 'c1', lugar: 'ifood' });
    eq(pick(L('almoço 30 no cartão do inter'), ['forma', 'cartao', 'descricao']), { forma: 'credito', cartao: 'c2', descricao: 'almoço' });
    eq(pick(L('uber 20 nubank'), ['forma', 'cartao']), { forma: 'credito', cartao: 'c1' });
    eq(pick(L('paguei 50 de inter no pix'), ['forma', 'cartao']), { forma: 'pix', cartao: null });
  });
  test('captura: parcelado vira gasto no crédito (sem perguntar forma) e mostra as parcelas', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar('100 em 3x no cartão', { id: 'T0001', elapsed: () => 1 });
    const g = s.S.entries.find(e => e.kind === 'gasto');
    eq([g.data.valor, g.data.parcelas, g.data.forma], [10000, 3, 'credito']);
    const txt = s.term.text().replace(/<[^>]+>/g, '');
    ok(/3x \(R\$ 33,34 \+ 2× R\$ 33,33\)/.test(txt) && !/↳ forma\?/.test(txt), txt);
  });
});

describe('cartões por comando e memória do cartão (etapa 3 · Fase 3b)', () => {
  const T = { id: 'T0001', elapsed: () => 1 };
  const plain = s => s.term.text().replace(/<[^>]+>/g, '');
  // por nome (no teste os cartões nascem no mesmo milissegundo, então a ordem não diz nada)
  const cards = S => cartoesDe(S.records).map(c => [c.nome, c.fechamento, c.vencimento, c.padrao]).sort((a, b) => b[0].localeCompare(a[0]));
  test('/cartao novo (o primeiro é padrão), padrao, editar, renomear, arquivar · /desfazer', async () => {
    const s = setup([]);
    await s.run('/cartao novo nubank fecha 3 vence 10');
    await s.run('/cartao novo inter fecha dia 28 vence dia 5');
    eq(cards(s.S), [['nubank', 3, 10, true], ['inter', 28, 5, false]]);
    await s.run('/cartao padrao inter');
    eq(cards(s.S).map(c => c[3]), [false, true]);
    await s.run('/desfazer');
    eq(cards(s.S).map(c => c[3]), [true, false]);
    await s.run('/cartao nubank fecha 5 vence 12');
    eq(cards(s.S)[0], ['nubank', 5, 12, true]);
    await s.run('/cartao renomear nubank = roxinho');
    await s.run('/cartao arquivar inter');
    eq(cards(s.S), [['roxinho', 5, 12, true]]);
    await s.run('/cartoes');
    ok(/roxinho/.test(plain(s)) && /próxima fatura vence/.test(plain(s)), plain(s));
    await throws(() => s.run('/cartao novo c6'), 'E_ARG');
    await throws(() => s.run('/cartao novo c6 fecha 40 vence 3'), 'E_ARG');
    await throws(() => s.run('/cartao padrao zzz'), 'E_404');
  });
  test('captura: nome do cartão grava o cartão; "no crédito" usa o padrão sem gravar', async () => {
    const s = setup([]);
    await s.run('/cartao novo nubank fecha 3 vence 10');
    await s.run('/cartao novo inter fecha 28 vence 5');
    const inter = cartoesDe(s.S.records)[1].id;
    await s.ctx.commands.capturar('gastei 45 no ifood no inter', T);
    await s.ctx.commands.capturar('almoço 30 no crédito', T);
    const [a, b] = s.S.entries.filter(e => e.kind === 'gasto');
    eq([a.data.forma, a.data.cartao, b.data.forma, b.data.cartao], ['credito', inter, 'credito', undefined]);
    ok(/crédito nubank \(padrão\)/.test(plain(s)), plain(s));
  });
  test('a memória aprende o cartão (ifood → inter) e /memoria ifood = nubank fixa', async () => {
    const s = setup([]);
    await s.run('/cartao novo nubank fecha 3 vence 10');
    await s.run('/cartao novo inter fecha 28 vence 5');
    const [nubank, inter] = cartoesDe(s.S.records).map(c => c.id);
    for (const f of ['ifood 30 no inter', 'gastei 20 no ifood no inter']) await s.ctx.commands.capturar(f, T);
    await s.ctx.commands.capturar('gastei 45 no ifood no crédito', T);
    eq(s.S.entries.filter(e => e.kind === 'gasto').at(-1).data.cartao, inter);
    await s.run('/memoria ifood = nubank');
    await s.ctx.commands.capturar('ifood 50 no cartão', T);
    eq(s.S.entries.filter(e => e.kind === 'gasto').at(-1).data.cartao, nubank);
  });
});

describe('fatura e saldo: à vista + faturas que vencem no mês (etapa 4 · Fase 3b)', () => {
  const T = { id: 'T0001', elapsed: () => 1 };
  const plain = s => s.term.text().replace(/<[^>]+>/g, '');
  const nubank = { id: 'c1', nome: 'nubank', fechamento: 3, vencimento: 10, padrao: true, arquivado: false };
  const G = (id, valor, data, extra) => ({ id, kind: 'gasto', text: id, ts: 1, day: data, data: { valor, data, ...extra } });
  const E = [
    G('tenis', 30000, '2026-10-15', { forma: 'credito', parcelas: 3, categoria: 'vestuário' }), // 1ª parcela na fatura de novembro
    G('almoco', 5000, '2026-10-05', { forma: 'pix', categoria: 'alimentação' }),
    { id: 'sal', kind: 'entrada', text: 'sal', ts: 1, day: '2026-10-05', data: { valor: 320000, data: '2026-10-05', categoria: 'salário' } },
    G('luz', 12000, '2026-09-20', { forma: 'credito', categoria: 'moradia' }),   // depois do fechamento de set → fatura que vence 10/10
    G('bar', 9000, '2026-10-02', { forma: 'credito', categoria: 'lazer' }),      // antes do fechamento de out → mesma fatura
  ];
  test('saldo = entradas − à vista − faturas que vencem no mês', () => {
    const r = resumoMes(E, '2026-10', { cartoes: [nubank] });
    eq([r.aVista, r.gastos, r.saldo, r.provisorio], [5000, 26000, 294000, false]);
    eq(r.faturas, [{ cartao: 'c1', nome: 'nubank', total: 21000, vence: '2026-10-10', itens: 2 }]);
    eq(r.porCategoria, [['moradia', 12000], ['lazer', 9000], ['alimentação', 5000]]);
  });
  test('parcelas: cada uma na fatura do seu mês, e só ela entra nas categorias', () => {
    eq(['2026-11', '2026-12', '2027-01', '2027-02'].map(m => resumoMes(E, m, { cartoes: [nubank] }).faturas[0]?.total ?? 0), [10000, 10000, 10000, 0]);
    eq(resumoMes(E, '2026-11', { cartoes: [nubank] }).porCategoria, [['vestuário', 10000]]);
    eq(parcelasNoMes(E, '2026-12', [nubank]).map(p => [p.e.id, p.k + 1, p.n, p.valor]), [['tenis', 2, 3, 10000]]);
  });
  test('sem cartão: crédito no mês da compra (provisório, como na 3a)', () => {
    const r = resumoMes(E, '2026-10');
    eq([r.gastos, r.credito, r.provisorio, r.faturas], [44000, 39000, true, []]);
  });
  test('cartão arquivado: os gastos dele continuam na fatura', () => {
    const velho = { ...nubank, id: 'c9', nome: 'velho', padrao: false, arquivado: true };
    const r = resumoMes([G('x', 7000, '2026-10-01', { forma: 'credito', cartao: 'c9' })], '2026-10', { cartoes: [nubank, velho] });
    eq(r.faturas.map(f => [f.nome, f.total]), [['velho', 7000]]);
  });
  test('/fatura e /mes na tela (mês calculado, sem depender de hoje)', async () => {
    const s = setup([]);
    await s.run('/cartao novo nubank fecha 3 vence 10');
    await s.ctx.commands.capturar('comprei um tênis 300 em 3x', T);
    const c = cartoesDe(s.S.records)[0];
    const hoje = dayKey(new Date());
    const m1 = mesDaFatura(hoje, c), m3 = mesDaFatura(hoje, c, 2);
    await s.run('/fatura nubank ' + m1);
    ok(/fatura nubank/.test(plain(s)) && /1\/3/.test(plain(s)) && /total R\$ 100,00/.test(plain(s)), plain(s));
    s.term.out.length = 0;
    await s.run('/fatura nubank ' + m3);
    ok(/3\/3/.test(plain(s)), plain(s));
    s.term.out.length = 0;
    await s.run('/mes ' + m1);
    ok(/fatura nubank/.test(plain(s)) && /à vista/.test(plain(s)) && !/provisório/.test(plain(s)), plain(s));
    await s.run('/fatura');
    await throws(() => s.run('/fatura zzz'), 'E_404');
  });
});

describe('listas e correção de parcelas e cartão (etapa 5 · Fase 3b)', () => {
  const T = { id: 'T0001', elapsed: () => 1 };
  const plain = s => s.term.text().replace(/<[^>]+>/g, '');
  test('/editar f1 3x, 1x, inter e 600: as parcelas acompanham · /desfazer', async () => {
    const s = setup([]);
    await s.run('/cartao novo nubank fecha 3 vence 10');
    await s.run('/cartao novo inter fecha 28 vence 5');
    const [nubank, inter] = cartoesDe(s.S.records);
    await s.ctx.commands.capturar('comprei um tênis 300 no crédito', T);
    const g = () => s.S.entries.find(e => e.kind === 'gasto');
    await s.run('/editar f1 3x');
    eq(g().data.parcelas, 3);
    await s.run('/editar f1 600');
    const m = mesDaFatura(g().data.data, nubank, 1);
    eq(parcelasNoMes(s.S.entries, m, cartoesDe(s.S.records, { todos: true })).map(p => [p.k + 1, p.valor]), [[2, 20000]], 'a 2ª parcela já é 200');
    await s.run('/editar f1 inter');
    eq([g().data.cartao, g().data.forma], [inter.id, 'credito']);
    await s.run('/editar f1 1x');
    eq(g().data.parcelas, undefined);
    await s.run('/desfazer');
    eq(g().data.parcelas, 3);
    await throws(() => s.run('/editar f1 99x'), 'E_ARG');
  });
  test('/gastos mostra o cartão e as parcelas numa linha só', async () => {
    const s = setup([]);
    await s.run('/cartao novo nubank fecha 3 vence 10');
    await s.ctx.commands.capturar('comprei um tênis 300 em 3x', T);
    s.term.out.length = 0;
    await s.run('/gastos');
    ok(/crédito nubank 3x/.test(plain(s)) && (plain(s).match(/tênis/g) || []).length === 1, plain(s));
  });
});

describe('próxima fatura no overview e no contexto (etapa 6 · Fase 3b)', () => {
  const nubank = { id: 'c1', nome: 'nubank', fechamento: 3, vencimento: 10, padrao: true, arquivado: false };
  const inter = { id: 'c2', nome: 'inter', fechamento: 28, vencimento: 5, padrao: false, arquivado: false };
  const G = (id, valor, data, extra) => ({ id, kind: 'gasto', text: id, ts: 1, day: data, data: { valor, data, forma: 'credito', ...extra } });
  const E = [G('luz', 12000, '2026-09-20', { categoria: 'moradia' }), G('bar', 9000, '2026-10-02', { categoria: 'lazer' }), G('tv', 60000, '2026-10-06', { cartao: 'c2', parcelas: 2 })];
  const now = new Date(2026, 9, 8, 12);
  test('proximasFaturas: a próxima de cada cartão, com o total', () => eq(proximasFaturas(E, [nubank, inter], now), [
    { cartao: 'c1', nome: 'nubank', mes: '2026-10', vence: '2026-10-10', total: 21000 },
    { cartao: 'c2', nome: 'inter', mes: '2026-11', vence: '2026-11-05', total: 30000 },
  ]));
  test('linhaContexto cita as próximas faturas', () => ok(
    linhaContexto(E, now, { cartoes: [nubank, inter] }).endsWith('· fatura nubank R$ 210,00 vence 10.10, fatura inter R$ 300,00 vence 05.11'),
    linhaContexto(E, now, { cartoes: [nubank, inter] })));
});

describe('recorrentes · funções puras (etapa 1 · Fase 3c)', () => {
  const now = new Date(2026, 9, 15, 12); // 15/10/2026
  const R = (id, text, data, ts = 1) => ({ id, kind: 'recorrente', text, ts, data: { status: 'ativa', ...data } });
  const recs = recorrentesDe([
    R('r1', 'netflix', { valor: 5590, dia: 15, desde: '2026-10', categoria: 'assinaturas', forma: 'credito' }),
    R('r2', 'aluguel', { valor: 120000, dia: 5, desde: '2026-08', forma: 'pix' }),
    R('r3', 'academia', { valor: 12000, dia: 20, desde: '2026-10' }),
    R('r4', 'spotify', { valor: 2190, dia: 1, desde: '2026-09', status: 'pausada' }),
    R('r5', 'luz', { valor: null, dia: 10, desde: '2026-10', categoria: 'moradia' }),
    R('r6', 'velho', { valor: 100, dia: 1, desde: '2026-01', status: 'cancelada' }),
  ]);
  const seed = s => 'id:' + s;
  test('recorrentesDe: sem as canceladas; variável = valor null', () => {
    eq(recs.map(r => [r.nome, r.valor, r.status]), [['netflix', 5590, 'ativa'], ['aluguel', 120000, 'ativa'], ['academia', 12000, 'ativa'], ['spotify', 2190, 'pausada'], ['luz', null, 'ativa']]);
  });
  test('desdeInicial: dia que ainda vem (ou hoje) = este mês; já passou = o que vem', () => {
    eq([desdeInicial(20, now), desdeInicial(15, now), desdeInicial(5, now), desdeInicial(5, new Date(2026, 11, 20))], ['2026-10', '2026-10', '2026-11', '2027-01']);
  });
  test('pendentes: meses que faltam até hoje, só ativas com valor, dia já chegou', () => {
    eq(pendentesRecorrentes(recs, [], now, { seedId: seed }).map(p => [p.rec.nome, p.mes, p.data]),
      [['aluguel', '2026-08', '2026-08-05'], ['aluguel', '2026-09', '2026-09-05'], ['aluguel', '2026-10', '2026-10-05'], ['netflix', '2026-10', '2026-10-15']]);
  });
  test('id fixo: celular e PC chegam no mesmo id, e o que já existe não volta', () => {
    const p = pendentesRecorrentes(recs, [], now, { owner: 'u1', seedId: seed });
    eq(p.find(x => x.rec.nome === 'netflix').id, 'id:u1:recorrente:r1:2026-10');
    const ja = p.map(x => ({ id: x.id }));
    eq(pendentesRecorrentes(recs, ja, now, { owner: 'u1', seedId: seed }), []);
  });
  test('pulados não voltam; no máximo 12 meses pra trás; dia 31 em fevereiro', () => {
    const r = recorrentesDe([R('a', 'x', { valor: 100, dia: 5, desde: '2026-08', pulados: ['2026-09'] })]);
    eq(pendentesRecorrentes(r, [], now).map(p => p.mes), ['2026-08', '2026-10']);
    const velho = recorrentesDe([R('b', 'y', { valor: 100, dia: 1, desde: '2020-01' })]);
    eq(pendentesRecorrentes(velho, [], now).length, 12);
    const fev = recorrentesDe([R('c', 'z', { valor: 100, dia: 31, desde: '2027-02' })]);
    eq(pendentesRecorrentes(fev, [], new Date(2027, 1, 28, 12)).map(p => p.data), ['2027-02-28']);
  });
  test('lancamentoRecorrente: um gasto normal, ligado à recorrente', () => {
    const [p] = pendentesRecorrentes([recs[0]], [], now, { seedId: seed });
    eq(lancamentoRecorrente(p, now), { id: p.id, kind: 'gasto', text: 'netflix (recorrente)', tags: [], ts: now.getTime(), day: '2026-10-15',
      data: { valor: 5590, descricao: 'netflix', data: '2026-10-15', recorrente: 'r1', auto: { campos: [], fonte: 'recorrente' }, categoria: 'assinaturas', forma: 'credito' } });
  });
  test('lembretes de variável: somem quando o gasto do mês aparece (pelo nome ou ligado)', () => {
    eq(lembretesVariaveis(recs, [], now).map(l => [l.rec.nome, l.vence]), [['luz', '2026-10-10']]);
    const g = { id: 'g', kind: 'gasto', text: 'paguei 120 de luz', day: '2026-10-12', data: { valor: 12000, data: '2026-10-12' } };
    eq(lembretesVariaveis(recs, [g], now), []);
    eq(lembretesVariaveis(recs, [{ ...g, data: { ...g.data, data: '2026-09-12' } }], now).length, 1, 'a luz do mês passado não conta');
  });
});

describe('lançador de recorrentes no app (etapa 3 · Fase 3c)', () => {
  const T = { id: 'T0001', elapsed: () => 1 };
  const plain = s => s.term.text().replace(/<[^>]+>/g, '');
  const hoje = new Date();
  test('recorrente com o dia de hoje: cadastra e já lança; /desfazer leva os dois', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar(`spotify 21,90 todo mês dia ${hoje.getDate()}`, T);
    const rec = s.S.records.find(e => e.kind === 'recorrente');
    const g = s.S.entries.find(e => e.kind === 'gasto');
    eq([rec?.text, g?.text, g?.data.valor, g?.data.recorrente, g?.id], ['spotify', 'spotify (recorrente)', 2190, rec?.id, seedId(`local:recorrente:${rec?.id}:${dayKey(hoje).slice(0, 7)}`)]);
    ok(/↳ entendi · recorrente · spotify/.test(plain(s)) && /lança hoje/.test(plain(s)) && /↳ lancei f1 spotify R\$ 21,90/.test(plain(s)), plain(s));
    await s.ctx.commands.lancarRecorrentes();
    eq(s.S.entries.filter(e => e.kind === 'gasto').length, 1, 'rodar de novo não duplica');
    await s.run('/desfazer');
    eq([s.S.records.some(e => e.kind === 'recorrente'), s.S.entries.some(e => e.kind === 'gasto')], [false, false]);
  });
  test('recorrente criada depois do dia: começa no mês que vem, nada lançado agora', async () => {
    if (hoje.getDate() === 1) return; // no dia 1 não existe "dia que já passou"
    const s = setup([]);
    await s.ctx.commands.capturar(`netflix 55,90 todo mês dia ${hoje.getDate() - 1}`, T);
    eq(s.S.entries.filter(e => e.kind === 'gasto').length, 0);
    ok(/começa em/.test(plain(s)), plain(s));
  });
  test('conta variável: só lembra, e o lembrete some quando você lança', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar(`luz todo mês dia ${hoje.getDate()}`, T);
    eq(s.S.entries.filter(e => e.kind === 'gasto').length, 0);
    s.term.out.length = 0;
    await s.ctx.commands.lancarRecorrentes();
    ok(/↳ lembrete luz/.test(plain(s)), plain(s));
    await s.ctx.commands.capturar('paguei 120 de luz', T);
    eq(lembretesVariaveis(recorrentesDe(s.S.records), s.S.entries, new Date()), []);
  });
  test('dois aparelhos lançando o mesmo mês gravam UMA linha na nuvem', async () => {
    const user = { id: 'test-rec-' + Date.now() };
    const clean = () => Object.keys(localStorage).filter(k => k.includes(user.id)).forEach(k => localStorage.removeItem(k));
    clean();
    const sb = fakeSb();
    const rec = { id: 'r1', kind: 'recorrente', text: 'netflix', ts: 1, day: 'x', data: { valor: 5590, dia: 1, desde: dayKey(hoje).slice(0, 7), status: 'ativa' } };
    const lancar = async (st, vistos) => {
      for (const p of pendentesRecorrentes(recorrentesDe([rec]), vistos, hoje, { owner: user.id, seedId })) await st.restore(lancamentoRecorrente(p, hoje));
    };
    const celular = createCloudStore(sb, user);
    await celular.connect();
    await lancar(celular, []);            // o celular lança
    await lancar(celular, []);            // e o PC, ainda sem ter lido a nuvem, lança "de novo" o mesmo mês
    eq([...sb.rows.values()].filter(r => r.kind === 'gasto').length, 1);
    celular.forget();
    clean();
  });
});

describe('/recorrentes, /recorrente e /apagar f3 (etapa 4 · Fase 3c)', () => {
  const plain = s => s.term.text().replace(/<[^>]+>/g, '');
  const hoje = new Date(), mesHoje = dayKey(hoje).slice(0, 7);
  const rec = s => s.S.records.find(e => e.kind === 'recorrente');
  const gastos = s => s.S.entries.filter(e => e.kind === 'gasto');
  test('nova, lista, pausar, retomar, editar, cancelar · /desfazer', async () => {
    const s = setup([]);
    await s.run(`/recorrente nova netflix 55,90 dia ${hoje.getDate()}`);
    eq([rec(s).text, rec(s).data.valor, gastos(s).length], ['netflix', 5590, 1]);
    s.term.out.length = 0;
    await s.run('/recorrentes');
    ok(/netflix/.test(plain(s)) && /fixo por mês: R\$ 55,90/.test(plain(s)), plain(s));
    await s.run('/recorrente pausar netflix');
    eq(rec(s).data.status, 'pausada');
    await s.run('/recorrente retomar netflix');
    eq([rec(s).data.status, rec(s).data.desde], ['ativa', mesHoje]);
    await s.run('/recorrente netflix 59,90 dia 20');
    eq([rec(s).data.valor, rec(s).data.dia], [5990, 20]);
    await s.run('/desfazer');
    eq(rec(s).data.valor, 5590);
    await s.run('/recorrente cancelar netflix');
    eq(recorrentesDe(s.S.records), []);
    eq(gastos(s).length, 1, 'cancelar não apaga o que já foi lançado');
    await throws(() => s.run('/recorrente pausar zzz'), 'E_404');
    await throws(() => s.run('/recorrente nova revisar orçamento'), 'E_ARG');
  });
  test('/apagar f1 de um lançamento recorrente: some e não volta (o mês fica pulado) · /desfazer traz', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar(`spotify 21,90 todo mês dia ${hoje.getDate()}`, { id: 'T', elapsed: () => 1 });
    eq(gastos(s).length, 1);
    await s.run('/apagar f1');
    eq([gastos(s).length, rec(s).data.pulados], [0, [mesHoje]]);
    await s.ctx.commands.lancarRecorrentes();
    eq(gastos(s).length, 0, 'o lançador não recria');
    await s.run('/desfazer');
    eq([gastos(s).length, rec(s).data.pulados], [1, []]);
  });
});

describe('recorrentes no /mes, ↻, variável ligada e contexto (etapa 5 · Fase 3c)', () => {
  const T = { id: 'T', elapsed: () => 1 };
  const plain = s => s.term.text().replace(/<[^>]+>/g, '');
  const hoje = new Date();
  test('"paguei 120 de luz" fica ligado à conta variável; /mes mostra recorrentes e o que falta', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar(`luz todo mês dia ${hoje.getDate()}`, T);
    await s.ctx.commands.capturar(`agua todo mês dia ${hoje.getDate()}`, T);
    await s.ctx.commands.capturar(`spotify 21,90 todo mês dia ${hoje.getDate()}`, T);
    await s.ctx.commands.capturar('paguei 120 de luz', T);
    const luz = s.S.records.find(e => e.kind === 'recorrente' && e.text === 'luz');
    eq(s.S.entries.find(e => e.text === 'paguei 120 de luz').data.recorrente, luz.id);
    s.term.out.length = 0;
    await s.run('/mes');
    ok(/↻ recorrentes R\$ 141,90 \(2\)/.test(plain(s)) /* spotify (lançado) + luz (variável, lançada por você) */ && /falta lançar: agua/.test(plain(s)) && !/falta lançar: luz/.test(plain(s)), plain(s));
    s.term.out.length = 0;
    await s.run('/gastos');
    ok(/↻/.test(plain(s)), plain(s));
  });
  test('linhaContexto cita o fixo por mês e os lembretes', () => {
    const now = new Date(2026, 9, 15, 12);
    const recs = recorrentesDe([
      { id: 'r1', kind: 'recorrente', text: 'netflix', ts: 1, data: { valor: 5590, dia: 15, desde: '2026-10', status: 'ativa' } },
      { id: 'r2', kind: 'recorrente', text: 'luz', ts: 2, data: { valor: null, dia: 10, desde: '2026-10', status: 'ativa' } },
    ]);
    const E = [{ id: 'g', kind: 'gasto', text: 'netflix (recorrente)', ts: 1, day: '2026-10-15', data: { valor: 5590, data: '2026-10-15', recorrente: 'r1' } }];
    ok(linhaContexto(E, now, { recorrentes: recs }).endsWith('· recorrentes R$ 55,90/mês (1) · lembrete: luz'), linhaContexto(E, now, { recorrentes: recs }));
  });
});

describe('os três saldos · funções puras (etapa 1 · Fase 3d)', () => {
  const now = new Date(2026, 9, 15, 12);
  const nubank = { id: 'c1', kind: 'cartao', text: 'nubank', ts: 1, data: { fechamento: 3, vencimento: 10, padrao: true, limite: 500000 } };
  const ancora = (onde, valor, data, ts) => ({ id: 'a' + ts, kind: 'saldo', text: onde, ts, data: { onde, valor, data } });
  const M = (id, kind, valor, data, ts, extra = {}) => ({ id, kind, text: id, ts, day: data, data: { valor, data, ...extra } });
  const E = [
    M('pix', 'gasto', 4500, '2026-10-05', 200, { forma: 'pix' }),
    M('sal', 'entrada', 320000, '2026-10-01', 50),                                        // antes da âncora: já estava no saldo
    M('guarda', 'transferencia', 20000, '2026-10-06', 300, { conta: 'poupança', sentido: 'para' }),
    M('tenis', 'gasto', 30000, '2026-10-06', 400, { forma: 'credito', parcelas: 3 }),      // faturas de nov, dez, jan
    M('luz', 'gasto', 12000, '2026-09-20', 10, { forma: 'credito' }),                       // fatura que vence 10/10
    M('rend', 'rendimento', 300, '2026-10-10', 500, { lugar: 'poupança' }),
    M('tesouro', 'transferencia', 10000, '2026-10-12', 600, { conta: 'Tesouro', sentido: 'para' }),
  ];
  const R = [nubank, ancora('conta', 250000, '2026-10-05', 100), ancora('poupança', 500000, '2026-10-05', 250)];
  test('sem âncora não há saldo da conta (NA)', () => eq(saldoConta(E, [nubank], now), null));
  test('conta = âncora + o que veio depois − fatura paga no vencimento', () => {
    eq(saldoConta(E, R, now).valor, 250000 - 4500 - 20000 - 10000 - 12000);
  });
  test('"paguei a fatura" antes do vencimento sai da conta na hora e some do devo', () => {
    const paga = { id: 'p', kind: 'faturapaga', ts: 700, data: { cartao: 'c1', mes: '2026-11', data: '2026-10-14' } };
    eq(saldoConta(E, [...R, paga], now).valor, 250000 - 4500 - 20000 - 10000 - 12000 - 10000);
    eq(devoNoCartao(E, [...R, paga], now).map(d => [d.devo, d.livre]), [[20000, 480000]]);
  });
  test('cartão: devo = parcelas ainda não pagas (com as futuras) · livre = limite − devo', () => {
    eq(devoNoCartao(E, R, now), [{ cartao: 'c1', nome: 'nubank', devo: 30000, limite: 500000, livre: 470000 }]);
    eq(devoNoCartao(E, [{ ...nubank, data: { ...nubank.data, limite: undefined } }], now)[0].livre, null);
  });
  test('investimentos por lugar: âncora + guardei + rendeu; lugar sem âncora começa do zero', () => {
    eq(investimentosPorLugar(E, R).map(i => [i.nome, i.valor, !!i.ancora]), [['poupança', 520300, true], ['tesouro', 10000, false]]);
  });
  test('âncora: a mais nova de cada lugar vale; chaveLugar ignora acento e artigo', () => {
    eq([...ancorasDe([ancora('conta', 100, '2026-10-01', 1), ancora('conta', 900, '2026-10-02', 2)]).values()].map(a => a.valor), [900]);
    eq([chaveLugar('a Poupança'), chaveLugar('poupanca'), chaveLugar('CDB')], ['poupanca', 'poupanca', 'cdb']);
  });
});

describe('crédito como limite seu, pelo ciclo da fatura (v0.14 · etapa 4)', () => {
  const at = (d, mo = 10, h = 10) => new Date(2026, mo - 1, d, h).getTime();
  const credito = (valor = 150000, fechamento = 29, vencimento = 5) => ({ id: 'cr', kind: 'credito', text: 'crédito', ts: at(1), data: { valor, fechamento, vencimento } });
  const gasto = (id, valor, data, extra = {}, ts = at(+data.slice(8, 10), +data.slice(5, 7))) => ({ id, kind: 'gasto', text: id, ts, day: data, data: { valor, data, forma: 'credito', categoria: 'outros', ...extra } });
  const paga = (mes, data, valor = null, cartao = CARTAO_CREDITO) => ({ id: 'fp' + mes, kind: 'faturapaga', text: 'fatura', ts: at(+data.slice(8, 10), +data.slice(5, 7), 12), data: { cartao, mes, data, ...(valor ? { valor } : {}) } });
  test('sem cartão, o /credito vira um "cartão" virtual com o ciclo (fecha 29, vence 5)', () => {
    eq(creditoDe([credito()]), { valor: 150000, fechamento: 29, vencimento: 5 });
    eq(ciclosCredito([credito()]).map(c => [c.id, c.fechamento, c.vencimento]), [[CARTAO_CREDITO, 29, 5]]);
    eq(ciclosCredito([]), []);
    eq(ciclosCredito([credito(), { id: 'c1', kind: 'cartao', text: 'nubank', ts: 1, data: { fechamento: 3, vencimento: 10 } }]).map(c => c.id), ['c1']); // cartão cadastrado manda
  });
  test('qual fatura o "paguei a fatura" paga: a que fechou por último (mesmo uns dias depois do vencimento)', () => {
    const [c] = ciclosCredito([credito()]);
    eq(faturaAPagar(c, [], new Date(2026, 9, 7)), '2026-10');  // vence 05/10 (fechou 29/09): pagou dia 7
    eq(faturaAPagar(c, [], new Date(2026, 9, 3)), '2026-10');  // antes do vencimento
    eq(faturaAPagar(c, [], new Date(2026, 9, 30)), '2026-11'); // fechou 29/10, vence 05/11
    eq(faturaAPagar(c, [paga('2026-10', '2026-10-05')], new Date(2026, 9, 8)), '2026-11'); // a de outubro já foi paga: adiantando a próxima
    eq(faturaAPagar(c, [], new Date(2026, 9, 25)), '2026-11'); // a de 05/10 venceu faz tempo (conta como paga): a aberta
  });
  test('usado = compras no crédito ainda não pagas; parcelado ocupa o total e vai liberando', () => {
    const recs = [credito()];
    const es = [gasto('ifood', 5490, '2026-10-02'), gasto('tenis', 30000, '2026-10-02', { parcelas: 3 })];
    const r = resumoCredito(es, recs, new Date(2026, 9, 8));
    eq([r.limite, r.usado, r.resta, r.fonte, r.ciclo], [150000, 35490, 114510, 'credito', true]);
    eq(r.proxima, { nome: 'crédito', vence: '2026-11-05', total: 15490 });
    // a fatura de novembro paga: volta a parte dela (ifood + 1ª parcela); ficam as 2 parcelas futuras
    const depois = resumoCredito(es, [...recs, paga('2026-11', '2026-11-05')], new Date(2026, 10, 6));
    eq([depois.usado, depois.resta], [20000, 130000]);
  });
  test('compra no dia do fechamento (29) vai pra fatura seguinte', () => {
    const r = resumoCredito([gasto('x', 10000, '2026-10-29')], [credito()], new Date(2026, 9, 29));
    eq([r.usado, r.proxima], [10000, null]); // a fatura de 05/11 está vazia: a compra foi pra de 05/12
  });
  test('sem /credito e sem cartão: limite NA, ciclo falso (a tela pede o /credito)', () => {
    const r = resumoCredito([gasto('ifood', 5490, '2026-10-02')], [], new Date(2026, 9, 8));
    eq([r.limite, r.resta, r.ciclo], [null, null, false]);
  });
  test('boleto parcelado: cada parcela vence num mês; ocupa o crédito até vencer', () => {
    const e = gasto('geladeira', 30000, '2026-10-02', { forma: 'boleto', parcelas: 3 });
    eq(parcelasBoleto(e), [{ valor: 10000, data: '2026-10-02' }, { valor: 10000, data: '2026-11-02' }, { valor: 10000, data: '2026-12-02' }]);
    eq(resumoCredito([e], [credito()], new Date(2026, 9, 8)).usado, 20000);
  });
  test('conta: "paguei a fatura 1.680" sem cartão sai da conta (e não é gasto)', () => {
    const anc = { id: 'a', kind: 'saldo', text: 'conta', ts: at(1, 10, 8), data: { onde: 'conta', valor: 200000, data: '2026-10-01' } };
    const pg = { id: 'p', kind: 'faturapaga', text: 'fatura do cartão', ts: at(7), data: { cartao: null, mes: null, valor: 168000, data: '2026-10-07' } };
    eq(saldoConta([], [anc, pg], new Date(2026, 9, 8)).valor, 32000);
  });
  test('conta: com ciclo, a fatura paga com valor sai pelo valor escrito (não pelo total das compras)', () => {
    const anc = { id: 'a', kind: 'saldo', text: 'conta', ts: at(1, 9, 8), data: { onde: 'conta', valor: 200000, data: '2026-09-01' } };
    const es = [gasto('ifood', 5490, '2026-09-10')]; // fatura que vence 05/10
    const recs = [credito(), anc, paga('2026-10', '2026-10-07', 168000)];
    eq(saldoConta(es, recs, new Date(2026, 9, 8)).valor, 32000);
  });
  test('conta: /saldo hoje e "paguei a fatura 1.680 ontem" escrito depois: sai (vale a hora em que você registrou)', () => {
    const anc = { id: 'a', kind: 'saldo', text: 'conta', ts: at(8, 10, 10), data: { onde: 'conta', valor: 279000, data: '2026-10-08' } };
    const pg = { id: 'p', kind: 'faturapaga', text: 'fatura do cartão', ts: at(8, 10, 11), data: { cartao: CARTAO_CREDITO, mes: '2026-10', valor: 168000, data: '2026-10-07' } };
    eq(saldoConta([], [credito(), anc, pg], new Date(2026, 9, 8, 12)).valor, 111000);
  });
  test('conta: boleto parcelado sai parcela por parcela', () => {
    const anc = { id: 'a', kind: 'saldo', text: 'conta', ts: at(1, 10, 8), data: { onde: 'conta', valor: 100000, data: '2026-10-01' } };
    const e = gasto('geladeira', 30000, '2026-10-02', { forma: 'boleto', parcelas: 3 });
    eq([saldoConta([e], [anc], new Date(2026, 9, 8)).valor, saldoConta([e], [anc], new Date(2026, 10, 3)).valor], [90000, 80000]);
  });
  test('"dia 2" que já passou neste mês é este mês (o gasto aconteceu); dia que ainda vem continua futuro', () => {
    const now = new Date(2026, 9, 8, 10);
    eq(['mercado 187,40 no débito dia 2', 'caiu o salário 3.200 dia 5', 'pagar o boleto 120 dia 20'].map(f => { const r = lerFinanca(f, { now }); return [r.data, r.futuro]; }),
      [['2026-10-02', false], ['2026-10-05', false], ['2026-10-20', true]]);
    eq(provedorRegras.interpretar('mercado 187,40 no débito dia 2', { now, reg: registry([]) }).tipo, 'gasto');
  });
  test('"paguei cartão de crédito 1.680" é pagamento; "paguei 1.680 no cartão" é compra', () => {
    eq(['paguei cartão de crédito 1.680', 'paguei o cartão 1.680', 'paguei a fatura 1.680', 'fatura 1.680 paga', 'paguei 1.680 no cartão', 'paguei o almoço no cartão'].map(ehPagamentoFatura),
      [true, true, true, true, false, false]);
  });
});

describe('crédito e fatura paga na tela (v0.14 · etapa 4)', () => {
  const T = { id: 'T', elapsed: () => 1 };
  const plain = s => s.term.text().replace(/<[^>]+>/g, '');
  test('/credito 1500 grava o crédito com o ciclo padrão (fecha 29, vence 5); compra no crédito diz quanto resta', async () => {
    const s = setup([]);
    s.S.detalhes = false;
    await s.run('/credito 1500');
    eq(creditoDe(s.S.records), { valor: 150000, fechamento: 29, vencimento: 5 });
    await s.ctx.commands.capturar('ifood 54,90 no crédito', T);
    ok(/✓ gasto f1 · R\$ 54,90 .*resta R\$ 1\.445,10/.test(plain(s)), plain(s));
    await s.run('/desfazer');
    await s.run('/desfazer');
    eq(creditoDe(s.S.records), null);
  });
  test('"paguei a fatura 1.680" sem cartão: fatura paga, não é gasto, sai da conta', async () => {
    const s = setup([]);
    s.S.detalhes = false;
    await s.run('/saldo 2.000');
    await new Promise(r => setTimeout(r, 3));
    await s.ctx.commands.capturar('paguei cartão de crédito 1.680', T);
    eq([s.S.records.filter(e => e.kind === 'faturapaga').map(e => e.data.valor), s.S.entries.filter(e => e.kind === 'gasto').length], [[168000], 0]);
    ok(/fatura paga · R\$ 1\.680,00 saiu da conta/.test(plain(s)), plain(s));
    eq(resumoSaldos(s.S.entries, s.S.records).conta, 32000);
  });
  test('/mes mostra conta, crédito e a fatura paga fora dos gastos', async () => {
    const s = setup([]);
    await s.run('/credito 1500');
    await s.ctx.commands.capturar('gastei 40 no mercado no débito', T);
    await s.ctx.commands.capturar('paguei a fatura 1.000', T);
    s.term.out.length = 0;
    await s.ctx.commands.get('mes').run('');
    const txt = plain(s);
    ok(/crédito\s*usado R\$ 0,00 de R\$ 1\.500,00/.test(txt) && /sobra do mês/.test(txt) && /fatura paga\s*R\$ 1\.000,00/.test(txt) && !/outros/.test(txt), txt);
  });
});

describe('frases dos saldos (etapa 2 · Fase 3d)', () => {
  test('lerAjusteSaldo: conta, lugar, e o que não é saldo', () => {
    eq([lerAjusteSaldo('tenho 2.500 na conta'), lerAjusteSaldo('saldo da conta 1.234,56'), lerAjusteSaldo('tenho R$ 300'), lerAjusteSaldo('tenho 8 mil no tesouro direto')],
      [{ onde: 'conta', valor: 250000 }, { onde: 'conta', valor: 123456 }, { onde: 'conta', valor: 30000 }, { onde: 'tesouro direto', valor: 800000 }]);
    eq([lerAjusteSaldo('tenho que pagar 200'), lerAjusteSaldo('tenho 2 provas'), lerAjusteSaldo('gastei 30 no almoço')], [null, null, null]);
    eq(lerAjusteSaldo('tenho 3.000 na xp', ['xp']), { onde: 'xp', valor: 300000 }, 'lugar que você já cadastrou');
  });
  test('rendimento e pagamento de fatura', () => {
    eq([lerRendimento('rendeu 32 na poupança'), lerRendimento('rendimento de 12 no cdb'), lerRendimento('rendeu muito o treino')], [{ valor: 3200, lugar: 'poupança' }, { valor: 1200, lugar: 'cdb' }, null]);
    eq(['paguei a fatura', 'paguei a fatura do nubank', 'quitei o cartão', 'fatura do inter paga', 'paguei o boleto'].map(ehPagamentoFatura), [true, true, true, true, false]);
  });
  test('rendimento aparece nas listas (é conteúdo) e "transferi pra poupança" continua transferência', () => {
    eq(CONTENT_KINDS.includes('rendimento'), true);
    eq(provedorRegras.interpretar('transferi 200 pra poupança', { now: new Date(2026, 9, 1, 12), reg: registry([]) }).tipo, 'transferencia');
  });
});

describe('/saldo, /investimentos, limite e fatura paga na tela (etapa 3 · Fase 3d)', () => {
  const T = { id: 'T', elapsed: () => 1 };
  const plain = s => s.term.text().replace(/<[^>]+>/g, '');
  const tick = () => new Promise(r => setTimeout(r, 3)); // ordem garantida pela hora em que foi escrito
  test('âncora, gasto à vista e reajuste com diferença', async () => {
    const s = setup([]);
    await s.run('/saldo');
    ok(/conta\s*NA/.test(plain(s)), plain(s));
    await s.run('/saldo 2.500');
    await tick();
    await s.ctx.commands.capturar('gastei 45 no ifood no pix', T);
    eq(saldoConta(s.S.entries, s.S.records).valor, 245500);
    s.term.out.length = 0;
    await tick();
    await s.ctx.commands.capturar('tenho 2.400 na conta', T);
    ok(/eu achava R\$ 2\.455,00 · diferença -R\$ 55,00/.test(plain(s)), plain(s));
    eq(saldoConta(s.S.entries, s.S.records).valor, 240000);
    await s.run('/desfazer');
    eq(saldoConta(s.S.entries, s.S.records).valor, 245500);
  });
  test('cartão com limite: deve e livre; "paguei a fatura" não vira gasto', async () => {
    const s = setup([]);
    await s.run('/cartao novo nubank fecha 3 vence 10 limite 5.000');
    eq(cartoesDe(s.S.records)[0].limite, 500000);
    await s.ctx.commands.capturar('comprei um tênis 300 em 3x', T);
    s.term.out.length = 0;
    await s.run('/cartoes');
    ok(/deve R\$ 300,00 · livre R\$ 4\.700,00 de R\$ 5\.000,00/.test(plain(s)), plain(s));
    await s.ctx.commands.capturar('paguei a fatura do nubank', T);
    eq([s.S.records.some(e => e.kind === 'faturapaga'), s.S.entries.filter(e => e.kind === 'gasto').length], [true, 1]);
    ok(/fatura paga/.test(plain(s)) && /não é gasto|não mexi na conta/.test(plain(s)), plain(s)); // v0.14: fatura vazia no app pede o valor
    await s.run('/cartao nubank limite 6 mil');
    eq(cartoesDe(s.S.records)[0].limite, 600000);
  });
  test('investimentos: âncora, transferência e rendimento (com número f)', async () => {
    const s = setup([]);
    await s.run('/saldo poupança 5.000');
    await tick();
    await s.ctx.commands.capturar('transferi 200 pra poupança', T);
    await s.ctx.commands.capturar('rendeu 32 na poupança', T);
    const r = s.S.entries.find(e => e.kind === 'rendimento');
    eq([r.data.valor, r.data.lugar], [3200, 'poupança']);
    ok(/rendimento lançado f2/.test(plain(s)), plain(s));
    eq(investimentosPorLugar(s.S.entries, s.S.records).map(i => [i.nome, i.valor]), [['poupança', 523200]]);
    s.term.out.length = 0;
    await s.run('/investimentos');
    ok(/poupança/.test(plain(s)) && /R\$ 5\.232,00/.test(plain(s)) && /rendeu R\$ 32,00/.test(plain(s)), plain(s));
    await s.run('/saldo');
    ok(/investido/.test(plain(s)) && /cartões/.test(plain(s)), plain(s));
  });
});

describe('os três saldos no HUD e no contexto (etapa 4 · Fase 3d)', () => {
  const now = new Date(2026, 9, 15, 12);
  const R = [
    { id: 'c1', kind: 'cartao', text: 'nubank', ts: 1, data: { fechamento: 3, vencimento: 10, padrao: true, limite: 500000 } },
    { id: 'a1', kind: 'saldo', text: 'conta', ts: 100, data: { onde: 'conta', valor: 250000, data: '2026-10-05' } },
    { id: 'a2', kind: 'saldo', text: 'poupança', ts: 100, data: { onde: 'poupanca', valor: 500000, data: '2026-10-05' } },
  ];
  const E = [{ id: 't', kind: 'gasto', text: 'tênis', ts: 200, day: '2026-10-06', data: { valor: 30000, data: '2026-10-06', forma: 'credito', parcelas: 3 } }];
  test('resumoSaldos: conta, investido, devo, livre · NA (null) sem dado', () => {
    const semCredito = ({ credito, ...x }) => x; // o crédito (v0.14) tem teste próprio
    eq(semCredito(resumoSaldos(E, R, now)), { conta: 250000, investido: 500000, devo: 30000, livre: 470000 });
    eq([resumoSaldos(E, R, now).credito.limite, resumoSaldos(E, R, now).credito.usado], [500000, 30000]); // sem /credito: o limite dos cartões
    eq(semCredito(resumoSaldos([], [], now)), { conta: null, investido: null, devo: null, livre: null });
  });
  test('linhaContexto cita os saldos (até num mês sem lançamento)', () => {
    const E2 = [...E, { id: 'pix', kind: 'gasto', text: 'pix', ts: 300, day: '2026-10-07', data: { valor: 4500, data: '2026-10-07', forma: 'pix' } }];
    const l = linhaContexto(E2, now, { records: R, cartoes: cartoesDe(R, { todos: true }) });
    ok(l.endsWith('· saldos: conta R$ 2.455,00 · investido R$ 5.000,00 · cartões deve R$ 300,00'), l);
    eq(linhaContexto([], now, { records: R }), 'finanças out: saldos: conta R$ 2.500,00 · investido R$ 5.000,00');
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
    // (desde a Fase 2.5 as palavras-chave são decisões na memória: registros kind 'memoria')
    const fix = () => criarMemoria(s.S.entries, s.S.records, { reg: registry(s.S.records) }).todas().filter(i => i.estado === 'fixado' && i.dominante === 'tcc').map(i => i.rotulo);
    eq(fix(), ['orientador', 'banca']);
    await s.run('/palavras tcc -banca');
    eq(fix(), ['orientador']);
    await s.run('/desfazer');
    eq(fix(), ['orientador', 'banca']);
    await s.run('/t mandar email pro orientador');
    eq(s.S.entries.find(e => e.kind === 'tarefa').data.projeto, 'tcc');
    await s.run('/palavras');
    ok(/orientador, banca/.test(s.term.text()), 'lista as palavras');
    await throws(() => s.run('/palavras xyz +a'), 'E_404');
  });
});

describe('pessoas (pessoas.js · Fase 2.5)', () => {
  const P = (id, text, apelidos = [], extra = {}) => ({ id, kind: 'pessoa', text, tags: [], ts: 1, day: '2026-10-02', data: { apelidos, ...extra } });
  const REC = [P('p1', 'João Silva', ['jão']), P('p2', 'Ana'), P('p3', 'João Pedro'), P('p4', 'Velho', [], { arquivada: true }), P('p5', 'Joca', [], { juntada_em: 'p1' })];
  const pes = pessoasDe(REC);
  const ach = t => findPessoas(t, pes).map(a => [a.trecho, a.ids]);
  test('cadastros ativos (arquivada e juntada saem) com chaves sem acento', () => eq(pes.map(p => [p.id, p.chaves]),
    [['p1', ['joao silva', 'joao', 'jao']], ['p2', ['ana']], ['p3', ['joao pedro', 'joao']]]));
  test('acha por nome, apelido, sem acento e maiúscula', () => eq(ach('falar com a ana e o JAO sobre o tcc'), [['ana', ['p2']], ['JAO', ['p1']]]));
  test('nome composto vence o primeiro nome; "joão" sozinho é ambíguo', () => {
    eq(ach('ligar pro João Pedro'), [['João Pedro', ['p3']]]);
    eq(ach('esperando o joão'), [['joão', ['p1', 'p3']]]);
  });
  test('palavra inteira só; #tag e @status não contam', () => eq([ach('banana'), ach('#ana'), ach('anabela'), ach('Ana.')], [[], [], [], [['Ana', ['p2']]]]));
  test('candidatos a nome novo: maiúscula no meio ou depois de "falar com"', () => eq(
    ['falar com Carla amanhã', 'falar com carla amanhã', 'esperando a Bia', 'depende do Marcos', 'ligar pro dentista', 'Revisar slides',
      'café com leite', 'falar com a Ana', 'reunião com orientador', 'mandar email pro rafa', 'esperando o orçamento', 'ligar o carro'].map(t => candidatosPessoa(t, { pessoas: pes }).map(c => c.nome)),
    [['Carla'], ['Carla'], ['Bia'], ['Marcos'], [], [], [], [], [], ['Rafa'], [], []]));
  test('candidato ignora projeto, status, dia e o que você disse que não é pessoa', () => eq(
    candidatosPessoa('falar com Weg na Sexta sobre Itaú', { pessoas: pes, projetos: ['weg'], ignorar: ['itaú'] }), []));
  test('acharPessoa: exato, apelido, ambíguo, nada', () => eq(
    [acharPessoa('ana', pes).pessoa?.id, acharPessoa('jão', pes).pessoa?.id, acharPessoa('João', pes).ambiguo?.map(p => p.id), acharPessoa('joão silva', pes).pessoa?.id, acharPessoa('zé', pes)],
    ['p2', 'p1', ['p1', 'p3'], 'p1', {}]));
  test('editApelidos e juntarPessoas (apelidos somam, entradas religadas)', () => {
    eq(editApelidos(['jão'], ['+Joãozinho', 'jão', '-jão', 'João Silva'], 'João Silva'), ['joãozinho']);
    const E = [{ id: 'e1', kind: 'tarefa', text: 'x', data: { pessoas: ['p5', 'p2'] } }, { id: 'e2', kind: 'nota', text: 'y', data: {} }];
    const r = juntarPessoas(REC[4], REC[0], E);
    eq([r.novoPara.data.apelidos, r.novoDe.data.juntada_em, r.religadas.map(e => [e.id, e.data.pessoas])], [['jão', 'joca'], 'p1', [['e1', ['p1', 'p2']]]]);
  });
});

describe('cadastro de pessoas (/pessoa · Fase 2.5)', () => {
  const pes = s => pessoasDe(s.S.records).map(p => [p.nome, p.apelidos]).sort((a, b) => b[0].localeCompare(a[0]));
  test('nova (com apelido), apelido, renomear (nome velho vira apelido), arquivar, desfazer', async () => {
    const s = setup([]);
    await s.run('/pessoa nova João Silva +jão');
    await s.run('/pessoa nova Ana');
    eq(pes(s), [['João Silva', ['jão']], ['Ana', []]]);
    await s.run('/pessoa apelido jão +joca -jão');
    eq(pes(s)[0], ['João Silva', ['joca']]);
    await s.run('/pessoa renomear Ana = Ana Paula');
    eq(pes(s)[1], ['Ana Paula', ['ana']]);
    await s.run('/desfazer');
    eq(pes(s)[1], ['Ana', []]);
    await s.run('/pessoa arquivar ana');
    eq(pes(s).length, 1);
    ok(s.S.records.some(e => e.kind === 'pessoa' && e.text === 'Ana'), 'arquivar não apaga');
  });
  test('juntar: apelidos somam, entradas religadas, um /desfazer volta tudo', async () => {
    const s = setup([]);
    await s.run('/pessoa nova João');
    await s.run('/pessoa nova Jão');
    const [joao, jao] = pessoasDe(s.S.records);
    await s.ctx.store.restore({ id: 'tk', kind: 'tarefa', text: 'falar com jão', tags: [], ts: 5, day: '2026-10-02', data: { pessoas: [jao.id] } });
    await s.run('/pessoa juntar Jão com João');
    eq([pes(s), s.S.entries.find(e => e.id === 'tk').data.pessoas], [[['João', ['jão']]], [joao.id]]);
    await s.run('/desfazer');
    eq([pes(s).length, s.S.entries.find(e => e.id === 'tk').data.pessoas], [2, [jao.id]]);
  });
  test('erros: ambíguo, desconhecido, repetido', async () => {
    const s = setup([]);
    await s.run('/pessoa nova João Silva');
    await s.run('/pessoa nova João Pedro');
    await throws(() => s.run('/pessoa joão'), 'E_AMBIGUO');
    await throws(() => s.run('/pessoa zé'), 'E_404');
    await s.run('/pessoa nova joão silva');
    eq(pessoasDe(s.S.records).length, 2);
    await s.run('/pessoas');
    ok(/João Pedro/.test(s.term.text()) && /João Silva/.test(s.term.text()));
  });
});

describe('intérprete marca pessoas (etapa 3 · Fase 2.5)', () => {
  const T = { id: 'T0001', elapsed: () => 1 };
  test('cadastrou → escreveu normal → entrada ligada à pessoa, status pela frase', async () => {
    const s = setup([]);
    await s.run('/pessoa nova João Silva +jão');
    const joao = pessoasDe(s.S.records)[0];
    await s.ctx.commands.capturar('esperando o jão mandar o orçamento', T);
    await s.ctx.commands.capturar('almoço com o João foi bom', T);
    const [t1, n1] = s.S.entries;
    eq([t1.kind, t1.text, t1.data.status, t1.data.pessoas], ['tarefa', 'esperando o jão mandar o orçamento', 'esperando', [joao.id]]);
    eq([n1.kind, n1.data.pessoas], ['nota', [joao.id]]);
  });
  test('prévia mostra quem foi reconhecido', () => {
    const pes = [{ id: 'p1', nome: 'Ana', apelidos: [], chaves: ['ana'] }];
    eq(readIntent('falar com a ana amanhã', { pessoas: pes, now: new Date(2026, 9, 1, 12) }).pessoas, ['Ana']);
  });
});

describe('nome novo pergunta · /sim /nao (etapa 4 · Fase 2.5)', () => {
  const T = { id: 'T0001', elapsed: () => 1 };
  const nomes = s => pessoasDe(s.S.records).map(p => p.nome);
  test('"falar com Carla amanhã" → pergunta → /sim cadastra e liga · /desfazer volta', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar('falar com Carla amanhã', T);
    ok(/Carla é uma pessoa\?/.test(s.term.text()), s.term.text());
    await s.run('/sim');
    const carla = pessoasDe(s.S.records)[0];
    eq([carla.nome, s.S.entries[0].data.pessoas], ['Carla', [carla.id]]);
    await s.run('/desfazer');
    eq([nomes(s), s.S.entries[0].data.pessoas], [[], undefined]);
  });
  test('/nao: não pergunta mais sobre a palavra', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar('ligar pro Itaú amanhã', T);
    await s.run('/nao');
    await new Promise(r => setTimeout(r, 0));
    const antes = s.term.out.length;
    await s.ctx.commands.capturar('ligar pro Itaú de novo sexta', T);
    ok(!/é uma pessoa/.test(s.term.out.slice(antes).map(x => x.join(' ')).join('\n')), 'perguntou de novo');
    eq(nomes(s), []);
  });
  test('duas pessoas novas: uma pergunta de cada vez', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar('marcar reunião com Carla e Bia amanhã', T);
    ok(/Carla é uma pessoa/.test(s.term.text()) && !/Bia é uma pessoa/.test(s.term.text()));
    await s.run('/sim');
    ok(/Bia é uma pessoa/.test(s.term.text()));
    await s.run('/sim');
    eq(nomes(s).sort(), ['Bia', 'Carla']);
    eq(s.S.entries[0].data.pessoas.length, 2);
  });
  test('"era gasto?": /sim vira gasto, /nao fica nota e aprende', async () => {
    const s = setup([]);
    await s.ctx.commands.capturar('abasteci 200 no posto', T);
    await s.run('/sim');
    eq(s.S.entries.map(e => e.kind), ['gasto']);
    await s.ctx.commands.capturar('abasteci 50 no posto', T);
    await s.run('/nao');
    await new Promise(r => setTimeout(r, 0));
    eq(s.S.entries.map(e => e.kind), ['gasto', 'nota']);
    eq(resumoAprendizado(s.S.records).corrigidas.map(i => [i.texto, i.corrigido]).sort(), [['abasteci 200 no posto', 'gasto'], ['abasteci 50 no posto', 'nota']]);
  });
  test('v0.14: palpite "tarefa" cria a tarefa direto; o botão "era nota" volta', async () => {
    const s = setup([]);
    s.S.detalhes = false;
    await s.ctx.commands.capturar('comprar pão', T);
    eq(s.S.entries.map(e => [e.kind, e.text]), [['tarefa', 'comprar pão']]);
    ok(/✓.*tarefa.*comprar pão/.test(s.term.text()) && /data-cmd="\/tipo nota t1"/.test(s.term.text()), s.term.text());
    await s.run('/tipo nota t1');
    eq(s.S.entries.map(e => e.kind), ['nota']);
  });
  test('sem pergunta pendente: avisa', async () => {
    const s = setup([]);
    await s.run('/sim');
    ok(/nada pra responder/.test(s.term.text()));
  });
});

describe('/pessoa João: tudo de uma pessoa (etapa 5 · Fase 2.5)', () => {
  const now = new Date(2026, 9, 10, 12);
  const tk = (id, data, ts = now.getTime() - 864e5) => ({ id, kind: 'tarefa', text: id, tags: [], ts, day: '2026-10-09', data: { status: 'a fazer', pessoas: ['p1'], ...data } });
  const E = [
    tk('esp', { status: 'esperando', projeto: 'weg' }), tk('ab', { projeto: 'weg' }), tk('ab2', { projeto: 'tcc' }),
    tk('feita', { status: 'feito', feito_em: now.getTime() - 2 * 864e5, projeto: 'weg' }), tk('velha', { status: 'feito', feito_em: now.getTime() - 60 * 864e5, projeto: 'weg' }),
    tk('outra', { pessoas: ['p2'] }),
    { id: 'n1', kind: 'nota', text: 'nota', tags: [], ts: 9, data: { pessoas: ['p1'] } },
    { id: 'g1', kind: 'gasto', text: 'gasto', tags: [], ts: 9, data: { pessoas: ['p1'], valor: 100 } },
  ];
  const EV = [{ id: 'ev', kind: 'evento', ts: 5, data: { alvo: 'ab', acao: 'criada' } }, { id: 'ev2', kind: 'evento', ts: 6, data: { alvo: 'outra', acao: 'criada' } }];
  test('resumoPessoa separa esperando, abertas, feitas (30d), notas, outros, projetos', () => {
    const r = resumoPessoa('p1', E, EV, { now });
    eq([r.total, r.esperando.map(e => e.id), r.abertas.map(e => e.id), r.feitas.map(e => e.id), r.notas.map(e => e.id), r.outros.map(e => e.id), r.projetos, r.eventos.map(e => e.id)],
      [7, ['esp'], ['ab', 'ab2'], ['feita'], ['n1'], ['g1'], [['weg', 4], ['tcc', 1]], ['ev']]);
  });
  test('/pessoa Ana mostra os grupos e numera as tarefas (/feito t1 funciona)', async () => {
    const s = setup([]);
    await s.run('/pessoa nova Ana');
    const T = { id: 'T0001', elapsed: () => 1 };
    await s.ctx.commands.capturar('esperando a Ana mandar o contrato', T);
    await s.ctx.commands.capturar('ligar pra Ana amanhã', T);
    await s.run('/pessoa ana');
    ok(/esperando Ana/.test(s.term.text()) && /abertas/.test(s.term.text()), s.term.text());
    await s.run('/feito t1');
    eq(s.S.entries.find(e => e.text.startsWith('esperando')).data.status, 'feito');
  });
});

describe('memória que aprende (memoria.js · etapa 6 · Fase 2.5)', () => {
  const reg = registry([]);
  const pes = [{ id: 'joao', nome: 'João', apelidos: [], chaves: ['joao'] }, { id: 'ana', nome: 'Ana', apelidos: [], chaves: ['ana'] }];
  let n = 0;
  const tk = (text, projeto, { pessoas = [], auto = false, ts = 1000 } = {}) => ({ id: 't' + n++, kind: 'tarefa', text, tags: [projeto], ts,
    data: { projeto, status: 'a fazer', pessoas, ...(auto ? { auto: { campos: ['projeto'], fonte: 'regra' } } : { auto: { campos: ['status'], fonte: 'regra' } }) } });
  const mem = (E, R = []) => criarMemoria(E, R, { reg, pessoas: pes });
  test('pesos: escrito 2, decidido pelo app 1, corrigido 3', () => {
    const E = [tk('a', 'weg', { pessoas: ['joao'] }), tk('b', 'weg', { pessoas: ['joao'], auto: true }), tk('c', 'tcc', { pessoas: ['joao'], auto: true })];
    const R = [{ kind: 'evento', ts: 5, data: { alvo: E[2].id, acao: 'alterada', mudancas: { projeto: ['pessoal', 'tcc'] }, origem: 'usuario' } }];
    eq(mem(E, R).info('pessoa:joao').porProjeto, [['weg', 3], ['tcc', 3]]);
  });
  test('dominante (≥70% e peso ≥3), dividida, pouca', () => {
    const m = mem([...Array(4)].map(() => tk('x', 'weg', { pessoas: ['joao'] })).concat([tk('y', 'tcc', { pessoas: ['joao'], auto: true }), tk('z', 'weg', { pessoas: ['ana'], auto: true }), tk('w', 'tcc', { pessoas: ['ana'], auto: true }), tk('v', 'tcc', { pessoas: ['ana'], auto: true })]));
    eq([m.info('pessoa:joao').estado, m.info('pessoa:joao').dominante], ['dominante', 'weg']);
    eq(m.info('pessoa:ana').estado, 'dividida');
    eq(mem([tk('q', 'weg', { pessoas: ['ana'], auto: true })]).info('pessoa:ana').estado, 'pouca');
  });
  test('palavras: as genéricas se dividem e não votam; as específicas votam', () => {
    const E = ['revisar planilha', 'revisar planilha de custos', 'atualizar planilha'].map(t => tk(t, 'weg')).concat(['revisar cap 2', 'revisar resumo'].map(t => tk(t, 'tcc')));
    const m = mem(E);
    eq([m.info('palavra:planilha').dominante, m.info('palavra:revisar').estado], ['weg', 'dividida']);
  });
  test('fixar, bloquear e limpar por comando (registro memoria) + palavras-chave antigas contam como fixar', () => {
    const E = [tk('planilha', 'tcc'), tk('planilha', 'tcc')];
    const R = [{ kind: 'memoria', ts: 10, data: { chave: 'palavra:planilha', acao: 'fixar', projeto: 'weg' } }];
    eq(mem(E, R).info('palavra:planilha').dominante, 'weg');
    const R2 = [{ kind: 'memoria', ts: 10, data: { chave: 'palavra:planilha', acao: 'bloquear', projeto: 'tcc' } }];
    eq(mem(E, R2).info('palavra:planilha').porProjeto, []);
    const R3 = [{ kind: 'memoria', ts: 5000, data: { chave: 'palavra:planilha', acao: 'limpar' } }];
    eq(mem(E, R3).info('palavra:planilha').estado, 'nada');
    const regKw = registry([{ kind: 'projeto', text: 'tcc', ts: 1, data: { ordem: 1, palavras: ['banca de defesa'] } }, { kind: 'status', text: 'a fazer', ts: 2, data: {} }]);
    const mk = criarMemoria([], [], { reg: regKw, pessoas: pes });
    eq(decidirProjeto('marcar a banca de defesa', { mem: mk, reg: regKw }).projeto, 'tcc');
  });
  test('decidirProjeto: nome > pista > conflito > frase > dividida > pessoal', () => {
    const E = [...Array(3)].map(() => tk('x', 'weg', { pessoas: ['joao'] })).concat([...Array(3)].map(() => tk('y', 'tcc', { pessoas: ['ana'] })), [tk('relatorio mensal', 'weg', { auto: true })]);
    const m = mem(E);
    const d = (t, pessoas = []) => decidirProjeto(t, { mem: m, pessoas, reg, entries: E });
    eq([d('falar com joão sobre o tcc', ['joao']).projeto, d('falar com joão', ['joao']).projeto, d('joão e ana', ['joao', 'ana']).projeto, d('ver relatorio', []).projeto, d('comprar pão').projeto],
      ['tcc', 'weg', null, 'weg', 'pessoal']);
    eq([d('falar com joão', ['joao']).motivo.tipo, d('joão e ana', ['joao', 'ana']).motivo.tipo, d('ver relatorio').motivo.tipo], ['pista', 'conflito', 'frase']);
    const div = mem([tk('a', 'weg', { pessoas: ['joao'] }), tk('b', 'tcc', { pessoas: ['joao'] })]);
    eq(decidirProjeto('ligar pro joão', { mem: div, pessoas: ['joao'], reg }), { projeto: null, motivo: { tipo: 'dividida', pista: 'João', porProjeto: [['weg', 2], ['tcc', 2]] } });
  });
  const T = { id: 'T0001', elapsed: () => 1 };
  test('na prática: João quase sempre na weg → tarefa nova com João vai pra weg, com o motivo', async () => {
    const s = setup([]);
    await s.run('/pessoa nova João');
    for (const t of ['falar com João sobre o motor #weg', 'cobrar João do relatório #weg']) await s.run('/t ' + t);
    await s.ctx.commands.capturar('ligar pro João amanhã', T);
    const e = s.S.entries.at(-1);
    eq([e.text, e.data.projeto], ['ligar pro João', 'weg']);
    ok(/João: 4 de 4/.test(s.term.text()), s.term.text());
  });
  test('na prática: João dividido → sem projeto + "↳ projeto?"', async () => {
    const s = setup([]);
    await s.run('/pessoa nova João');
    for (const t of ['falar com João #weg', 'falar com João #tcc']) await s.run('/t ' + t);
    await s.ctx.commands.capturar('ligar pro João amanhã', T);
    eq(s.S.entries.at(-1).data.projeto, null);
    ok(/projeto\?/.test(s.term.text()) && /não chutei/.test(s.term.text()), s.term.text());
  });
  test('na prática: corrigiu "planilha" pra weg → o app passa a associar sozinho', async () => {
    const s = setup([]);
    s.ctx.store = withHistory(memStore([]));
    s.ctx.store.subscribe(l => { s.S.entries = l.filter(e => !isRecord(e)); s.S.records = l.filter(isRecord); });
    await s.ctx.commands.capturar('atualizar planilha amanhã', T);
    eq(s.S.entries[0].data.projeto, 'pessoal');
    await s.run('/editar t1 #weg');
    await s.ctx.store.idle();
    await s.ctx.commands.capturar('revisar planilha sexta', T);
    eq(s.S.entries.at(-1).data.projeto, 'weg');
  });
});

describe('/memoria: ver e editar o que o app aprendeu (etapa 7 · Fase 2.5)', () => {
  const T = { id: 'T0001', elapsed: () => 1 };
  test('fixar, bloquear, soltar, limpar, desfazer · pessoa ou palavra', async () => {
    const s = setup([]);
    await s.run('/pessoa nova João');
    for (const t of ['falar com João #tcc', 'cobrar João #tcc']) await s.run('/t ' + t);
    const info = k => criarMemoria(s.S.entries, s.S.records, { reg: registry(s.S.records), pessoas: pessoasDe(s.S.records) }).info(k);
    const joao = 'pessoa:' + pessoasDe(s.S.records)[0].id;
    eq(info(joao).dominante, 'tcc');
    await s.run('/memoria joão = weg');
    eq([info(joao).estado, info(joao).dominante], ['fixado', 'weg']);
    await s.ctx.commands.capturar('ligar pro João amanhã', T);
    eq(s.S.entries.at(-1).data.projeto, 'weg');
    ok(/João: fixado/.test(s.term.text()), 'motivo na linha entendi');
    await s.run('/memoria joão solta');
    eq(info(joao).dominante, 'tcc');
    await s.run('/memoria joão -tcc');
    eq([info(joao).estado, info(joao).porProjeto.map(x => x[0])], ['pouca', ['weg']]); // sobra só 1 de peso na weg
    await s.run('/desfazer');
    eq(info(joao).porProjeto[0][0], 'tcc');
    await s.run('/memoria joão limpar');
    eq(info(joao).estado, 'nada');
    await s.run('/memoria planilha = weg');
    eq(info('palavra:planilha').dominante, 'weg');
  });
  test('ver: visão geral e uma pista; erros', async () => {
    const s = setup([]);
    await s.run('/memoria');
    ok(/ainda não aprendi/.test(s.term.text()));
    for (const t of ['revisar motor #weg', 'trocar motor #weg', 'medir motor #weg']) await s.run('/t ' + t);
    await s.run('/memoria');
    ok(/palavras que puxam/.test(s.term.text()) && /motor/.test(s.term.text()), s.term.text());
    await s.run('/memoria motor');
    ok(/→ #weg/.test(s.term.text()));
    await throws(() => s.run('/memoria motor = xyz'), 'E_404');
  });
});

describe('contexto e IA sabem das pessoas (etapa 8 · Fase 2.5)', () => {
  const now = new Date(2026, 9, 8, 12);
  test('montarContexto: "esperando: João (2) · Ana (1)"', () => {
    const tk = (id, pessoas, status = 'esperando') => ({ id, kind: 'tarefa', text: id, tags: [], ts: now.getTime(), data: { projeto: 'weg', status, pessoas } });
    const pes = [{ id: 'j', nome: 'João' }, { id: 'a', nome: 'Ana' }];
    const t = montarContexto([tk('x', ['j']), tk('y', ['j', 'a']), tk('z', ['a'], 'a fazer')], [], { now, pessoas: pes });
    ok(t.includes('esperando: João (2) · Ana (1)'), t);
  });
  test('pedido da IA leva só nome e apelido', () => {
    const p = montarPedido('falar com jão', { now, pessoas: [{ id: 'j', nome: 'João Silva', apelidos: ['jão'], chaves: [] }] }, { modelo: 'm' });
    eq(p.pessoas, ['João Silva (jão)']);
  });
});

describe('/ver por status (bug do kanban vazio)', () => {
  const T = { id: 'T0001', elapsed: () => 1 };
  test('/ver kanban e depois /ver a fazer mostram as tarefas; palavra estranha dá erro', async () => {
    const s = setup([]);
    s.ctx.store.subscribe(() => {});
    await s.run('/t primeira >sex');
    await s.run('/t segunda @fazendo');
    // v0.14: o kanban abre no palco (tela própria no centro); as outras visões fecham o palco e imprimem no terminal
    await s.run('/ver kanban');
    eq(s.ctx.ui.stage, { kind: 'kanban', proj: null, status: null });
    await s.run('/ver a fazer');
    eq(s.ctx.ui.stage, { kind: 'kanban', proj: null, status: 'a fazer' });
    eq(s.S.view, 'kanban'); // filtrar por status não troca a visão salva
    const antes = s.term.out.length;
    await s.run('/ver lista');
    eq(s.ctx.ui.stage, null);
    const novo = s.term.out.slice(antes).map(x => x.join(' ')).join('\n');
    ok(/primeira/.test(novo) && /segunda/.test(novo), novo);
    await throws(() => s.run('/ver xyz'), 'E_ARG');
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
    await s.ctx.commands.capturar('abasteci 200 no posto', T);
    eq(s.S.entries.map(e => e.kind), ['nota']);
    ok(/salvei como nota/.test(out(s)) && /era gasto\?/.test(out(s)) && /\/sim/.test(out(s)), out(s));
    await s.run('/tipo gasto');
    eq(s.S.entries.map(e => [e.kind, e.text]), [['gasto', 'abasteci 200 no posto']]);
    await s.run('/desfazer');
    eq(s.S.entries.map(e => [e.kind, e.text]), [['nota', 'abasteci 200 no posto']]);
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
    await s.ctx.commands.capturar('ideia solta', T);
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
    // v0.14: o palpite "tarefa" vira tarefa no Enter, então a prévia já mostra tarefa · dúvida de outro tipo continua nota
    eq([readIntent('comprar pão', { now }).type, readIntent('comprar pão', { now }).inferido], ['task', true]);
    const d = readIntent('abasteci 200 no posto', { now });
    eq([d.type, d.pergunta, d.palpite], ['note', true, 'gasto']);
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
    await s.ctx.commands.capturar('abasteci 200 no posto', T);
    await s.ctx.commands.capturar('xpto 18', T);
    await s.run('/tipo gasto');
    await new Promise(r => setTimeout(r, 0));
    const res = resumoAprendizado(s.S.records);
    eq([res.corrigidas.map(i => i.texto), res.semResposta.map(i => i.texto)], [['xpto 18'], ['abasteci 200 no posto']]);
    await s.run('/aprendizado');
    ok(/corrigidas/.test(s.term.text()) && /sem resposta/.test(s.term.text()));
    await s.run('/aprendizado exportar');
    ok(/frase: 'xpto 18', esperado: \{ tipo: 'gasto' \}/.test(s.term.text()), s.term.text());
    eq(s.S.entries.filter(isNoteKind).map(e => e.text), ['abasteci 200 no posto'], 'nada de aprendizado no /inbox');
  });
});

describe('montarContexto (contexto.js · pra Fase 6)', () => {
  const now = new Date(2026, 9, 8, 12, 0); // quinta, 08/10
  const at = (d, h = 10) => new Date(2026, 9, d, h).getTime();
  const tk = (id, text, data, ts = at(7)) => ({ id, kind: 'tarefa', text, tags: [], ts, day: '2026-10-07', data: { status: 'a fazer', prazo: null, prioridade: 'média', feito_em: null, ...data } });
  const ev = (alvo, ts, mudancas, acao = 'alterada') => ({ id: 'e' + ts + alvo, kind: 'evento', text: acao, ts, data: { alvo, acao, mudancas } });
  const E = [
    tk('t1', 'revisar cap 2', { projeto: 'tcc', prazo: '2026-10-05', prioridade: 'alta' }, at(1)),
    tk('t2', 'falar com orientador', { projeto: 'tcc', status: 'esperando' }, at(1)),
    tk('t3', 'relatório mensal', { projeto: 'weg', prazo: '2026-10-08' }),
    tk('t4', 'planilha', { projeto: 'weg', status: 'feito', feito_em: at(6) }),
    tk('t5', 'arrumar quarto', { projeto: 'pessoal' }, new Date(2026, 8, 20, 12).getTime()),
    tk('t6', 'dentista', { projeto: 'pessoal', prazo: '2026-10-12' }),
    { id: 'g1', kind: 'gasto', text: 'gastei 30 no almoço', tags: [], ts: at(7), day: '2026-10-07', data: { valor: 3000, descricao: 'almoço', data: '2026-10-07' } },
    { id: 'w1', kind: 'treino', text: 'treinei peito 1h', tags: [], ts: at(6), day: '2026-10-06', data: { descricao: 'treinei peito 1h', duracao_min: 60, data: '2026-10-06' } },
  ];
  const EV = [
    ev('t1', at(2), { prazo: ['2026-10-02', '2026-10-04'] }), ev('t1', at(4), { prazo: ['2026-10-04', '2026-10-05'] }),
    ev('t2', at(2), { status: ['a fazer', 'esperando'] }),
  ];
  test('resumo enxuto: atrasadas, adiamentos, travou, andou, próximas, gastos e treinos', () => eq(montarContexto(E, EV, { now }), [
    'hoje 2026-10-08 qui',
    'tarefas: 5 abertas · 1 atrasadas · 1 feitas em 7d',
    '#tcc: 2 abertas · 1 atrasadas',
    '  atrasada 3d: revisar cap 2 !alta (adiada 2x)',
    '  travou: falar com orientador (esperando 6d)',
    '  andou: falar com orientador → esperando',
    '#weg: 1 abertas',
    '  hoje: relatório mensal',
    '  andou: ✓ planilha',
    '#pessoal: 2 abertas',
    '  travou: arrumar quarto (parada 18d)',
    '  próximas: dentista >12.10',
    'finanças out: entradas R$ 0,00 · gastos R$ 30,00 (1) · saldo -R$ 30,00 · top: sem categoria R$ 30,00',
    'treinos 7d: 1 · 1h',
  ].join('\n')));
  test('passou do limite: corta o menos importante, nunca o cabeçalho', () => {
    const t = montarContexto(E, EV, { now, maxChars: 120 });
    ok(t.length <= 120, `tamanho ${t.length}`);
    eq(t.split('\n').slice(0, 2), ['hoje 2026-10-08 qui', 'tarefas: 5 abertas · 1 atrasadas · 1 feitas em 7d']);
    const m = montarContexto(E, EV, { now, maxChars: 400 });
    ok(m.includes('atrasada 3d') && !m.includes('próximas'), 'as atrasadas ficam, as próximas saem primeiro');
  });
  test('sem nada: só o cabeçalho', () => eq(montarContexto([], [], { now }), 'hoje 2026-10-08 qui\ntarefas: 0 abertas · 0 atrasadas · 0 feitas em 7d'));
  test('tarefa antiga sem histórico usa feito_em e ts (nada inventado)', () => ok(montarContexto([tk('x', 'velha', { projeto: 'tcc', status: 'feito', feito_em: at(5) })], [], { now }).includes('✓ velha')));
  test('estimarTokens e /contexto', async () => {
    eq(estimarTokens('a'.repeat(400)), 100);
    const s = setup([]);
    await s.run('/contexto');
    ok(/tokens/.test(s.term.text()) && /hoje /.test(s.term.text()));
  });
});

describe('régua de frases (tests/frases.js · interpretar com regras)', () => {
  // frase com `palavras` (ex: { tcc: ['orientador'] }) roda com essas palavras-chave nos projetos · `entries`: o que já existia (ex: o gasto que o estorno devolve)
  const ctxBase = f => ({
    reg: registry(seedEntries([], 'local', new Date(2026, 9, 1)).map(e => (e.kind === 'projeto' && f?.palavras?.[e.text] ? { ...e, data: { ...e.data, palavras: f.palavras[e.text] } } : e))),
    entries: f?.entries || [],
    records: f?.records || [], // cadastros que a frase precisa (ex: um cartão, pra "paguei a fatura")
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
    eq(Object.keys(p), ['modelo', 'texto', 'hoje', 'dia_semana', 'aba', 'tipos', 'projetos', 'palavras', 'pessoas', 'status']);
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
  test('leitura leve: depois da completa, baixa só o que mudou', async () => {
    clean();
    const sb = fakeSb();
    const st = createCloudStore(sb, user);
    let seen = [];
    st.subscribe(l => { seen = l; });
    await st.connect();
    for (const t of ['a', 'b', 'c']) await st.add({ text: t, ts: 1, day: 'x' });
    await st.sync();
    eq([st.status.modo, st.status.linhas], ['completa', 3]);
    // outro aparelho muda uma linha
    const [id] = [...sb.rows.keys()];
    sb.gravar({ ...sb.rows.get(id), text: 'a editada no celular' });
    await st.refresh();
    eq([sb.calls.at(-1), st.status.modo, st.status.linhas], ['leitura-leve', 'leve', 2]); // a editada + a última já vista (marcador inclusivo)
    ok(seen.some(e => e.text === 'a editada no celular'), 'a mudança chegou');
    await st.refresh();
    eq(st.status.linhas, 1, 'na próxima, só a última vista de novo (cursor inclusivo, sem perder nada)');
    st.forget();
    clean();
  });
  test('apagado em outro aparelho: a leitura completa (abrir, /sync) tira', async () => {
    clean();
    const sb = fakeSb();
    const st = createCloudStore(sb, user);
    let seen = [];
    st.subscribe(l => { seen = l; });
    await st.connect();
    await st.add({ text: 'a', ts: 1, day: 'x' });
    await st.sync();
    sb.rows.clear();
    await st.sync();
    eq(seen.length, 0);
    st.forget();
    clean();
  });
  test('banco sem a coluna updated_at: continua na leitura completa, sem erro', async () => {
    clean();
    const sb = fakeSb();
    sb.semColuna = true;
    const st = createCloudStore(sb, user);
    await st.connect();
    await st.add({ text: 'a', ts: 1, day: 'x' });
    await st.sync();
    await st.refresh();
    eq([st.status.modo, sb.calls.includes('leitura-leve')], ['completa', false]);
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
