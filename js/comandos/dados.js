// Dados: /apagar (nota, acervo, tarefa, lançamento ou texto), /desfazer, /exportar, /importar e /arrumar (limpeza com o seu /sim).
// pickTargets e prepareImport são funções puras (testadas em tests/run.js).
// Uma das áreas da linguagem de comandos: js/commands.js junta todas (veja o comentário de lá).

import { esc, hl, dayKey, tagsOf, uid, CmdError, VERSION } from '../util.js';
import { isTask } from '../tasks.js';
import { previa } from '../interpretar.js';
import { sugestoesArrumacao, semTags } from '../arrumar.js';

// Decide quais entradas um "/apagar ..." está pedindo. Função pura (não apaga nada), testada em tests/.
//   números: "3", "1 2 3", "1,2,3", "1-4", "#2"  → { mode: 'num', targets: [{n, e}], bad: ['#9', ...] }
//   texto:   "comprar café"                      → { mode: 'text', targets: [{n, e}] }  (todas que contêm o texto)
export function pickTargets(raw, entries) {
  const tokens = String(raw).trim().split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length) return { mode: 'empty', targets: [], bad: [] };

  if (tokens.every(x => /^#?\d+(-#?\d+)?$/.test(x))) {
    const nums = new Set(), bad = [];
    for (const tk of tokens) {
      const [a, b] = tk.replace(/#/g, '').split('-').map(Number);
      const lo = Math.min(a, b ?? a), hi = Math.min(Math.max(a, b ?? a), entries.length);
      if (lo < 1 || lo > hi) { bad.push(tk.replace(/#/g, '')); continue; }
      for (let n = lo; n <= hi; n++) nums.add(n);
      const top = Math.max(a, b ?? a), from = entries.length + 1;
      if (b != null && top >= from) bad.push(top === from ? String(from) : `${from}-${top}`);
    }
    const targets = [...nums].sort((x, y) => x - y).map(n => ({ n, e: entries[n - 1] }));
    return { mode: 'num', targets, bad };
  }

  const q = String(raw).trim().toLowerCase();
  const targets = entries.map((e, i) => ({ n: i + 1, e })).filter(({ e }) => String(e.text).toLowerCase().includes(q));
  return { mode: 'text', targets, bad: [] };
}

// Decide o que entra num /importar. Função pura, testada em tests/.
// Aceita o arquivo do /exportar ({ entries: [...] }) ou uma lista simples.
// Nunca sobrescreve: pula o que já existe (mesmo id, ou mesmo texto no mesmo horário).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function prepareImport(json, existing) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.entries) ? json.entries : null;
  if (!list) return null;
  const ids = new Set(existing.map(e => e.id));
  const sigs = new Set(existing.map(e => e.ts + '|' + e.text));
  const toAdd = [];
  let skipped = 0, invalid = 0;
  for (const r of list) {
    const text = typeof r?.text === 'string' ? r.text.trim() : '';
    const ts = Number(r?.ts);
    if (!text || text.length > 10000 || !Number.isFinite(ts) || ts <= 0) { invalid++; continue; }
    const sig = ts + '|' + text;
    if (ids.has(r.id) || sigs.has(sig)) { skipped++; continue; }
    const e = {
      id: UUID.test(r.id || '') ? r.id : uid(),
      text,
      tags: Array.isArray(r.tags) ? r.tags.map(String) : tagsOf(text),
      kind: typeof r.kind === 'string' ? r.kind : 'nota',
      ts,
      day: /^\d{4}-\d{2}-\d{2}$/.test(r.day || '') ? r.day : dayKey(new Date(ts)),
    };
    if (r.data && typeof r.data === 'object') e.data = r.data;
    ids.add(e.id);
    sigs.add(sig);
    toAdd.push(e);
  }
  return { toAdd, skipped, invalid };
}

export function criarDados(kit) {
  const { S, term, ctx, usage, fin } = kit;
  // de outras áreas: lidos na hora do uso (a ordem em que as áreas nascem não importa)
  const notesPool = (...a) => kit.notesPool(...a);
  const acervoPool = (...a) => kit.acervoPool(...a);
  const nums = (...a) => kit.nums(...a);
  const list = (...a) => kit.list(...a);
  const resolveTasks = (...a) => kit.resolveTasks(...a);
  const chip = (...a) => kit.chip(...a);
  const chips = (...a) => kit.chips(...a);
  const ictx = (...a) => kit.ictx(...a);

  /* ---------- /arrumar (v0.14): sugere limpezas e só aplica com o seu sim ---------- */

  const ROTULO = { apagar: 'apagar', fatura: 'virar fatura paga', 'tirar-tag': 'tirar do título', 'sem-prazo': 'tirar o prazo' };
  function mostrarArrumacao() {
    const reg = ctx.reg();
    const comandos = kit.defs().flatMap(c => [c.name, ...(c.alias || [])]);
    const lista = sugestoesArrumacao(S.entries, { projetos: reg.projects, statuses: reg.statuses, comandos, ler: t => previa(t, ictx()) });
    S.arrumacao = lista;
    S.perguntas = (S.perguntas || []).filter(q => q.tipo !== 'arrumar');
    if (!lista.length) return term.say('nada pra arrumar ✓ · as notas, tarefas e gastos parecem certos.');
    term.print(`── arrumar · ${lista.length} sugest${lista.length > 1 ? 'ões' : 'ão'} · nada muda sem o seu sim ${'─'.repeat(4)}`, 'sep');
    const num = nums();
    lista.forEach((x, i) => {
      // alternativas por item: a nota que hoje seria gasto pode virar gasto; a #tag pode virar projeto
      const alt = [];
      if (x.kind === 'nota' && /hoje seria (gasto|entrada|tarefa)/.test(x.motivo)) { const tipo = x.motivo.match(/hoje seria (\w+)/)[1]; const n = num.get(x.ids[0]); if (n) alt.push(chip(`virar ${tipo}`, `/tipo ${tipo} ${n}`)); }
      if (x.acao === 'tirar-tag') x.extra.tags.forEach(tag => alt.push(chip(`criar #${tag}`, `/projeto novo ${tag}`)));
      term.print(`<span class="n">${i + 1}</span> <span class="dim">${esc(x.kind)}</span> ${hl(x.texto.length > 60 ? x.texto.slice(0, 59) + '…' : x.texto)} <span class="c-int">→ ${esc(ROTULO[x.acao])}</span> <span class="dim">· ${esc(x.motivo)}</span>${chips(alt)}`, 'arr');
    });
    term.print(`<span class="c-warn">↳ faço tudo isso?</span>${chips([chip('sim, arruma tudo', '/sim'), chip('não', '/nao')])} <span class="dim">· ou escolha: /arrumar 1 3 · tudo volta com um /desfazer</span>`, 'auto');
    S.perguntas.push({ tipo: 'arrumar', mostrada: true });
  }

  // aplica as sugestões escolhidas (todas, ou os números) num passo só do /desfazer
  async function aplicarArrumacao(numeros, t) {
    const lista = S.arrumacao || [];
    const escolhidas = numeros ? numeros.map(n => lista[n - 1]).filter(Boolean) : lista;
    if (!escolhidas.length) throw new CmdError('E_ARG', 'store', 'nada escolhido', 'rode <span class="c-int">/arrumar</span> e use os números da lista');
    const items = [], created = [], cont = { apagar: 0, fatura: 0, 'tirar-tag': 0, 'sem-prazo': 0 };
    const achar = id => S.entries.find(e => e.id === id);
    for (const x of escolhidas) {
      for (const id of x.ids) {
        const e = achar(id);
        if (!e) continue;
        items.push(e);
        if (x.acao === 'apagar') await ctx.store.remove(e.id);
        else if (x.acao === 'fatura') {
          // o gasto sai; entra o pagamento de fatura com o mesmo valor e a mesma hora (a conta continua igual, os gastos não contam mais)
          await ctx.store.remove(e.id);
          const f = await ctx.store.add({ kind: 'faturapaga', text: 'fatura do cartão', tags: [], ts: e.ts, day: e.day,
            data: { cartao: null, mes: null, valor: e.data?.valor, data: e.data?.data || e.day } });
          created.push(f.id);
        } else if (x.acao === 'tirar-tag') {
          // a #tag sai do título (fica nas etiquetas); o projeto chutado pelo app sai também
          const chute = x.extra.chute, campos = (e.data?.auto?.campos || []).filter(k => !(chute && k === 'projeto'));
          const data = chute ? { ...e.data, projeto: null, auto: campos.length ? { ...e.data.auto, campos } : null } : e.data;
          if (data && !data.auto) delete data.auto;
          await ctx.store.restore({ ...e, text: semTags(e.text, x.extra.tags), data, tags: [...new Set([...(e.tags || []).filter(tg => tg !== chute), ...x.extra.tags])] });
        }
        else if (x.acao === 'sem-prazo') {
          const campos = (e.data?.auto?.campos || []).filter(k => k !== 'prazo');
          const data = { ...e.data, prazo: null, auto: campos.length ? { ...e.data.auto, campos } : null };
          if (!data.auto) delete data.auto;
          await ctx.store.restore({ ...e, data });
        }
        cont[x.acao]++;
      }
    }
    S.undo.push({ label: 'arrumação', items, created });
    S.arrumacao = null;
    S.lastLatency = t.elapsed();
    const partes = [cont.apagar && `${cont.apagar} apagada${cont.apagar > 1 ? 's' : ''}`, cont.fatura && `${cont.fatura} virou fatura paga`, cont['tirar-tag'] && `${cont['tirar-tag']} título${cont['tirar-tag'] > 1 ? 's' : ''} sem #tag`, cont['sem-prazo'] && `${cont['sem-prazo']} sem prazo automático`].filter(Boolean);
    term.ok('store', `arrumado · ${partes.join(' · ')} <span class="c-meta">· ${t.id}</span>${chips([chip('desfazer', '/desfazer', 'is-undo')])}`);
    ctx.ui.pulse('act');
  }

  const defs = [
    {
      name: 'arrumar', alias: ['limpar-dados', 'faxina'], data: true, async: true, exec: true, args: '[1 3 5]',
      desc: 'procura o que limpar (notas que eram respostas, tarefa "fazendo", fatura gravada como gasto, prazo automático) e só mexe com o seu sim',
      async run(arg, signal, t) {
        const ns = String(arg).trim().split(/[\s,]+/).filter(Boolean);
        if (!ns.length) return mostrarArrumacao();
        if (!S.arrumacao) mostrarArrumacao();
        if (!ns.every(n => /^\d+$/.test(n))) throw usage('arrumar', '[números da lista] · ex: /arrumar 1 3');
        S.perguntas = (S.perguntas || []).filter(q => q.tipo !== 'arrumar');
        await aplicarArrumacao(ns.map(Number), t);
      },
    },
    {
      name: 'apagar', exec: true, data: true, alias: ['rm'], args: '<3 | a2 | t1 | f3 | 1-4 | texto>',
      desc: 'apaga: 3 = nota · a2 = acervo · t1 = tarefa · f3 = lançamento · ou pelo texto (dá pra desfazer)', async: true,
      async run(arg, signal, t) {
        const raw = String(arg).trim();

        // lançamentos de dinheiro (f3): js/comandos/financas.js (recorrente apagado pula o mês)
        if (/^f\d/i.test(raw)) return fin.apagar(raw, t);

        // números de tarefa (t1, t2-t4) usam a lista do /tarefas
        if (/^t\d/i.test(raw)) {
          const targets = resolveTasks(raw, 'apagar', 't1');
          if (!targets) return;
          for (const { e } of targets) await ctx.store.remove(e.id);
          S.undo.push({ label: targets.length === 1 ? 'tarefa apagada' : `${targets.length} tarefas apagadas`, items: targets.map(x => x.e) });
          S.lastLatency = t.elapsed();
          term.warn('task', `apagada${targets.length > 1 ? 's ' + targets.length : ''} · ${targets.map(x => `t${x.n} ${hl(x.e.text)}`).join(' · ')} <span class="c-meta">· ${t.id} · /desfazer recupera</span>`);
          ctx.ui.pulse('warn');
          return;
        }

        // acervo: a1 · a1 a3 · a2-a4  ·  notas: 3 · #3 · 1 2 · 1-4  ·  texto: procura em tudo
        const isAcv = /^a\d/i.test(raw);
        const numeric = s => s.split(/[\s,;]+/).filter(Boolean).every(x => /^#?\d+(-#?\d+)?$/.test(x));
        let pick, prefix = '#';
        if (isAcv) {
          const n = raw.replace(/a/gi, '');
          if (!numeric(n)) throw usage('apagar', 'a1  ·  a1 a3  ·  a2-a4');
          pick = pickTargets(n, acervoPool());
          prefix = 'a';
        } else {
          pick = pickTargets(raw, numeric(raw) ? notesPool() : S.entries);
        }
        if (pick.mode === 'empty') throw usage('apagar', '3 (nota)  ·  a2 (acervo)  ·  t1 (tarefa)  ·  texto');
        const { targets } = pick;
        const label = e => nums().get(e.id) || (isTask(e) ? 'tarefa' : '');

        if (pick.mode === 'num') {
          if (!targets.length) throw new CmdError('E_ARG', 'shell', `nada com ${pick.bad.length > 1 ? 'esses números' : 'esse número'}`, isAcv ? 'os números a1, a2... aparecem no <span class="c-int">/acervo</span>' : 'os números das notas aparecem no <span class="c-int">/inbox</span> · acervo usa a1 · tarefa usa t1');
          if (pick.bad.length) term.warn('shell', `ignorados (não existem): ${pick.bad.map(n => prefix + esc(n)).join(' ')}`);
        } else {
          // pelo texto: só apaga sozinho se UMA coisa bater
          if (!targets.length) throw new CmdError('E_404', 'store', `nada contém "${raw}"`, 'confira com <span class="c-int">/buscar</span>');
          if (targets.length > 1) {
            list(targets.map(h => h.e), `"${raw}" bate com ${targets.length}`);
            term.say('não apaguei nada, pra não sumir coisa errada. escolha pelo número: <span class="c-int">/apagar 3</span> (nota) · <span class="c-int">a2</span> (acervo) · <span class="c-int">t1</span> (tarefa)');
            return;
          }
        }

        for (const { e } of targets) await ctx.store.remove(e.id);
        S.undo.push({ label: targets.length === 1 ? 'apagado' : `${targets.length} apagados`, items: targets.map(x => x.e) }); // o lote inteiro volta com /desfazer
        S.lastLatency = t.elapsed();
        const meta = `<span class="c-meta">· ${t.id} · ${S.lastLatency}ms · /desfazer recupera</span>`;
        if (targets.length === 1) term.warn('store', `apagado ${esc(isAcv ? 'a' + targets[0].n : pick.mode === 'num' ? '#' + targets[0].n : label(targets[0].e))} · ${hl(targets[0].e.text)} ${meta}`);
        else {
          term.warn('store', `apagados ${targets.length} ${meta}`);
          targets.forEach(({ n, e }) => term.print(`<span class="nt">${esc(prefix + n)}</span><span class="nx dim">${hl(e.text)}</span><span class="nn"></span>`, 'note'));
        }
        ctx.ui.pulse('warn');
      },
    },
    {
      name: 'desfazer', exec: true, data: true, alias: ['undo'], desc: 'desfaz a última mudança (apagar, concluir, adiar...)', async: true,
      async run(arg, signal, t) {
        // cada passo guarda as versões ANTERIORES (items) e o que foi criado (created);
        // desfazer = restaurar as versões antigas e apagar o que foi criado
        const step = S.undo.pop();
        if (!step) return term.say('nada pra desfazer.');
        for (const id of step.created || []) await ctx.store.remove(id, { origem: 'desfazer' });
        for (const e of step.items) await ctx.store.restore(e, { origem: 'desfazer' });
        S.lastLatency = t.elapsed();
        const n = step.items.length + (step.created?.length || 0);
        const what = step.items.length === 1 && !step.created?.length ? hl(step.items[0].text) : `${n} ${n === 1 ? 'item' : 'itens'}`;
        term.ok('store', `desfeito · ${esc(step.label)} · ${what} <span class="c-meta">· ${t.id} · ${S.lastLatency}ms</span>`);
        ctx.ui.pulse('act');
      },
    },
    {
      name: 'exportar', data: true, alias: ['export'], desc: 'baixa uma cópia de todas as entradas (.json)',
      run() {
        const blob = new Blob([JSON.stringify({ app: 'mega-brain', version: VERSION, exportedAt: new Date().toISOString(), entries: [...S.entries, ...(S.records || [])] }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `mega-brain-${dayKey(new Date())}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        term.ok('store', `exportadas ${S.entries.length} entradas · ${esc(a.download)}`);
      },
    },
    {
      name: 'importar', alias: ['import'], data: true, desc: 'restaura notas de um backup .json (do /exportar) sem duplicar',
      run() {
        // o seletor de arquivo precisa abrir direto do Enter (o navegador exige um gesto seu)
        const pick = document.createElement('input');
        pick.type = 'file';
        pick.accept = '.json,application/json';
        pick.onchange = () => {
          const file = pick.files?.[0];
          if (!file) return;
          term.task(`/importar ${file.name}`, async (signal, t) => {
            let json;
            try { json = JSON.parse(await file.text()); }
            catch { throw new CmdError('E_IMPORT', 'store', 'o arquivo não é um JSON válido', 'use o arquivo gerado pelo <span class="c-hud">/exportar</span>'); }
            const plan = prepareImport(json, [...S.entries, ...(S.records || [])]);
            if (!plan) throw new CmdError('E_IMPORT', 'store', 'não achei uma lista de entradas no arquivo', 'use o arquivo gerado pelo <span class="c-hud">/exportar</span>');
            for (const e of plan.toAdd) await ctx.store.restore(e, { origem: 'importar' });
            S.lastLatency = t.elapsed();
            term.ok('store', `importadas ${plan.toAdd.length} · já existiam ${plan.skipped}` +
              (plan.invalid ? ` · <span class="c-warn">ignoradas ${plan.invalid} inválidas</span>` : '') +
              ` <span class="c-meta">· ${esc(file.name)} · ${t.id} · ${S.lastLatency}ms</span>`);
            ctx.ui.pulse('act');
          }, { announce: true, kind: 'exec' });
        };
        pick.click();
        term.say('escolha o arquivo .json do backup.');
      },
    },
  ];
  return { defs, aplicarArrumacao };
}
