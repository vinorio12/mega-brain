// Linguagem de comandos do Mega Brain.
// Não executa nada do sistema operacional: cada comando é uma função daqui.
//
// Pra criar um comando novo, adicione um objeto na lista `defs`:
//   name   nome usado depois da barra
//   alias  outros nomes aceitos
//   args   como usar (aparece no /ajuda)
//   desc   o que faz
//   async  true se demora (ganha ID de tarefa e pode ser cancelado com ctrl+c)
//   run    a função

import { esc, hl, dayKey, hhmm, ddmm, dur, lev, kb, CmdError, VERSION } from './util.js';
import { geocode, locate, fetchWeather, savedPlace, describe } from './weather.js';

export const PHASES = [
  ['0', 'esqueleto · terminal, hud, inbox', 'ok'],
  ['0.5', 'app próprio · pwa, nuvem, login', 'wip'],
  ['1', 'tarefas e projetos · hoje, tcc, weg, pessoal', ''],
  ['2', 'ia intérprete · escrever sem decorar comando', ''],
  ['3', 'finanças · gastos, entradas, saldo do mês', ''],
  ['4', 'corpo e hábitos · treino, saúde, padrão semanal', ''],
  ['5', 'dashboards · gráficos e tendências', ''],
  ['6', 'coach · resumo do dia, revisão da semana', ''],
];

export function createCommands(ctx) {
  const { S, term } = ctx;
  const usage = (name, args) => new CmdError('E_ARG', 'shell', 'argumento faltando ou inválido', `uso: <span class="c-hud">/${name} ${esc(args)}</span>`);

  const numberOf = () => new Map(S.entries.map((e, i) => [e.id, i + 1]));

  function list(items, title) {
    if (!items.length) return term.say(`nada em ${esc(title)}.`);
    term.print(`── ${esc(title)} ${'─'.repeat(10)}`, 'sep');
    const num = numberOf();
    for (const e of items) {
      const d = new Date(e.ts);
      term.print(`<span class="n">#${num.get(e.id)}</span><span class="d">${ddmm(d)} ${hhmm(d)}</span><span>${hl(e.text)}</span>`, 'ent');
    }
  }

  const table = (rows, cls = '') => rows.forEach(([k, v]) => term.print(`<span class="k">${k}</span><span>${v}</span>`, 'tbl ' + cls));

  const defs = [
    {
      name: 'ajuda', alias: ['help', '?'], args: '[comando]', desc: 'lista os comandos, ou detalha um',
      run(arg) {
        if (arg) {
          const c = get(arg.replace(/^\//, ''));
          if (!c) throw notFound(arg.replace(/^\//, ''));
          table([
            ['uso', `<span class="c-act">/${c.name}</span> ${esc(c.args || '')}`],
            ['faz', esc(c.desc)],
            ['atalhos', c.alias?.length ? c.alias.map(a => '/' + esc(a)).join(' ') : '<span class="dim">—</span>'],
            ['tipo', c.async ? 'assíncrono · ganha ID, ctrl+c cancela' : 'imediato'],
          ]);
          return;
        }
        table([['qualquer texto', 'captura na inbox · use #tags: <span class="dim">ler cap 2</span> <span class="c-act">#tcc</span>']], 'cmd');
        table(defs.map(c => [`/${c.name}${c.args ? ' ' + esc(c.args) : ''}`, esc(c.desc)]), 'cmd');
        term.print('', '');
        table([
          ['tab', 'completa /comandos e #tags'],
          ['↑ ↓', 'navega no histórico'],
          ['ctrl+c', 'cancela a tarefa em andamento'],
          ['ctrl+k', 'limpa a tela (o log continua)'],
          ['esc', 'apaga a linha'],
        ]);
      },
    },
    {
      name: 'inbox', data: true, alias: ['ls'], args: '[n]', desc: 'últimas n entradas (padrão 10)',
      run(arg) {
        const n = Math.max(1, Math.min(500, parseInt(arg, 10) || 10));
        const items = S.entries.slice(-n);
        list(items, `inbox · ${items.length} de ${S.entries.length}`);
      },
    },
    {
      name: 'hoje', data: true, desc: 'o que entrou hoje',
      run() {
        const k = dayKey(new Date());
        list(S.entries.filter(e => e.day === k), 'hoje');
      },
    },
    {
      name: 'buscar', data: true, alias: ['grep', 'b'], args: '<termo>', desc: 'procura nas entradas (texto ou #tag)',
      run(arg) {
        if (!arg) throw usage('buscar', '<termo>');
        const q = arg.toLowerCase();
        const tag = q.startsWith('#') ? q.slice(1) : null;
        const hits = S.entries.filter(e => tag ? (e.tags || []).includes(tag) : String(e.text).toLowerCase().includes(q));
        list(hits, `busca "${arg}" · ${hits.length}`);
      },
    },
    {
      name: 'apagar', data: true, alias: ['rm'], args: '<n> | <n n n> | <n-n> | <texto>',
      desc: 'apaga por número (1 2 3 · 1-4) ou pelo texto (dá pra desfazer)', async: true,
      async run(arg, signal, t) {
        const raw = String(arg).trim();
        if (!raw) throw usage('apagar', '1  ·  1 2 3  ·  1-4  ·  comprar café');
        const tokens = raw.split(/[\s,;]+/).filter(Boolean);
        let targets;

        if (tokens.every(x => /^#?\d+(-#?\d+)?$/.test(x))) {
          // por número: "1 2 3", "1,2,3", "1-4" (números do /inbox)
          const nums = new Set(), bad = [];
          for (const tk of tokens) {
            const [a, b] = tk.replace(/#/g, '').split('-').map(Number);
            const lo = Math.min(a, b ?? a), hi = Math.min(Math.max(a, b ?? a), S.entries.length);
            if (lo < 1 || lo > hi) { bad.push(tk); continue; }
            for (let n = lo; n <= hi; n++) nums.add(n);
            const top = Math.max(a, b ?? a), from = S.entries.length + 1;
            if (b != null && top >= from) bad.push(top === from ? from : `${from}-${top}`);
          }
          if (!nums.size) throw new CmdError('E_ARG', 'shell', `nenhuma entrada com ${bad.length > 1 ? 'esses números' : 'esse número'}`, 'os números aparecem no <span class="c-hud">/inbox</span>');
          if (bad.length) term.warn('shell', `ignorados (não existem): ${bad.map(n => '#' + n).join(' ')}`);
          targets = [...nums].sort((a, b) => a - b).map(n => ({ n, e: S.entries[n - 1] }));
        } else {
          // pelo texto: só apaga sozinho se UMA entrada bater
          const q = raw.toLowerCase();
          const hits = S.entries.map((e, i) => ({ n: i + 1, e })).filter(({ e }) => String(e.text).toLowerCase().includes(q));
          if (!hits.length) throw new CmdError('E_404', 'store', `nenhuma entrada contém "${raw}"`, 'confira com <span class="c-hud">/buscar</span>');
          if (hits.length > 1) {
            list(hits.map(h => h.e), `"${raw}" bate com ${hits.length} entradas`);
            term.say(`não apaguei nada, pra não sumir coisa errada. escolha pelos números, ex: <span class="c-hud">/apagar ${hits.slice(0, 3).map(h => h.n).join(' ')}</span>`);
            return;
          }
          targets = hits;
        }

        for (const { e } of targets) await ctx.store.remove(e.id);
        S.undo.push(targets.map(x => x.e)); // o lote inteiro volta com /desfazer
        S.lastLatency = t.elapsed();
        const meta = `<span class="c-meta">· ${t.id} · ${S.lastLatency}ms · /desfazer recupera</span>`;
        if (targets.length === 1) term.warn('store', `apagado #${targets[0].n} · ${hl(targets[0].e.text)} ${meta}`);
        else {
          term.warn('store', `apagadas ${targets.length} entradas ${meta}`);
          targets.forEach(({ n, e }) => term.print(`<span class="n">#${n}</span><span class="d"></span><span class="dim">${hl(e.text)}</span>`, 'ent'));
        }
        ctx.ui.pulse('warn');
      },
    },
    {
      name: 'desfazer', data: true, alias: ['undo'], desc: 'recupera o que foi apagado por último', async: true,
      async run(arg, signal, t) {
        const batch = S.undo.pop();
        if (!batch) return term.say('nada pra desfazer.');
        for (const e of batch) await ctx.store.restore(e);
        S.lastLatency = t.elapsed();
        const what = batch.length === 1 ? hl(batch[0].text) : `${batch.length} entradas`;
        term.ok('store', `recuperado · ${what} <span class="c-meta">· ${t.id} · ${S.lastLatency}ms</span>`);
        ctx.ui.pulse('act');
      },
    },
    {
      name: 'status', alias: ['st'], desc: 'estado completo do sistema',
      run() {
        const k = dayKey(new Date());
        const state = ctx.ui.state();
        const wx = S.weather;
        const [memText, memTone] = ctx.ui.mem();
        const st = ctx.store?.status;
        table([
          ['estado', `<span class="${state === 'ready' ? 'c-act' : state === 'busy' ? 'c-hud' : 'c-warn'}">${state.toUpperCase()}</span>`],
          ['sessão', S.user ? esc(S.user.email) : S.locked ? '<span class="c-warn">bloqueada · digite seu e-mail</span>' : 'modo local'],
          ['memória', `<span class="${memTone === 'ok' ? 'c-act' : memTone === 'na' ? 'c-meta' : 'c-warn'}">${memText}</span>` +
            (ctx.store?.kind === 'local' ? ' <span class="dim">· só neste navegador</span>' : '') +
            (st?.lastSync ? ` <span class="dim">· último sync ${hhmm(new Date(st.lastSync))}</span>` : '') +
            (st?.lastError ? ` <span class="c-warn">· ${esc(st.lastError)}</span>` : '')],
          ['tempo real', st?.realtime ?? '<span class="dim">NA</span>'],
          ['entradas', `${S.entries.length} <span class="dim">· hoje ${S.entries.filter(e => e.day === k).length} · ${ctx.store ? kb(ctx.store.bytes()) : 'NA'}</span>`],
          ['rede', navigator.onLine ? '<span class="c-act">online</span>' : '<span class="c-err">offline</span>'],
          ['latência', S.lastLatency == null ? '<span class="dim">NA</span>' : `${S.lastLatency}ms <span class="dim">· última operação</span>`],
          ['clima', wx ? `${describe(wx.code).icon} ${Math.round(wx.temp)}° ${esc(wx.place.name)} <span class="dim">· ${hhmm(new Date(wx.at))}</span>` : '<span class="dim">NA · /clima ativa</span>'],
          ['tarefas', `${term.tasks.size} em execução`],
          ['sessão', dur(Date.now() - S.startedAt)],
          ['log', `${term.log.length} eventos`],
          ['versão', `${VERSION} · ${location.hostname || 'arquivo local'}`],
        ]);
      },
    },
    {
      name: 'clima', alias: ['wx'], args: '[cidade | aqui]', desc: 'clima agora · padrão jaraguá do sul · "aqui" usa sua localização', async: true, announce: true,
      async run(arg, signal, t) {
        const place = !arg ? savedPlace() : arg.toLowerCase() === 'aqui' ? await locate(signal) : await geocode(arg, signal);
        const w = await fetchWeather(place, signal);
        S.weather = w;
        const d = describe(w.code);
        table([
          ['local', `${esc(place.name)}${place.region ? ' <span class="dim">· ' + esc(place.region) + '</span>' : ''}`],
          ['agora', `${d.icon} ${d.text}`],
          ['temperatura', `${w.temp.toFixed(1)}° <span class="dim">· sensação ${Math.round(w.feels)}°</span>`],
          ['umidade', `${w.hum}%`],
          ['vento', `${Math.round(w.wind)} km/h`],
        ]);
        term.ok('wx', `clima atualizado · ${esc(place.name)} ${Math.round(w.temp)}° <span class="c-meta">· ${t.id} · ${t.elapsed()}ms · open-meteo</span>`);
        ctx.ui.render();
      },
    },
    {
      name: 'log', args: '[n]', desc: 'reimprime os últimos n eventos do log (padrão 40)',
      run(arg) {
        const n = Math.max(1, parseInt(arg, 10) || 40);
        const items = term.log.slice(-n);
        term.print(`── log · ${items.length} de ${term.log.length} ${'─'.repeat(10)}`, 'sep');
        items.forEach(term.replay);
      },
    },
    {
      name: 'historico', alias: ['history', 'h'], desc: 'comandos que você digitou',
      run() {
        const h = term.history().slice(-30);
        if (!h.length) return term.say('histórico vazio.');
        const start = term.history().length - h.length;
        h.forEach((c, i) => term.print(`<span class="n">${start + i + 1}</span><span class="d"></span><span>${esc(c)}</span>`, 'ent'));
      },
    },
    {
      name: 'exportar', data: true, alias: ['export'], desc: 'baixa uma cópia de todas as entradas (.json)',
      run() {
        const blob = new Blob([JSON.stringify({ app: 'mega-brain', version: VERSION, exportedAt: new Date().toISOString(), entries: S.entries }, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `mega-brain-${dayKey(new Date())}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        term.ok('store', `exportadas ${S.entries.length} entradas · ${esc(a.download)}`);
      },
    },
    {
      name: 'entrar', alias: ['login'], desc: 'entra na sua conta (pede e-mail e código)',
      run() { ctx.actions.login(); },
    },
    {
      name: 'codigo', alias: ['código', 'code'], desc: 'no login: manda um código pro e-mail em vez de usar senha', async: true,
      async run() { await ctx.actions.sendCode(); },
    },
    {
      name: 'sair', alias: ['logout'], desc: 'sai da conta e apaga a cópia deste aparelho', async: true,
      async run(arg, signal, t) { await ctx.actions.logout(t); },
    },
    {
      name: 'sync', desc: 'envia o que está na fila e busca a versão da nuvem', async: true, announce: true, data: true,
      async run(arg, signal, t) { await ctx.actions.sync(t); },
    },
    {
      name: 'migrar', desc: 'envia pra nuvem as notas que ficaram no modo local', async: true, announce: true, data: true,
      async run(arg, signal, t) { await ctx.actions.migrate(t); },
    },
    {
      name: 'instalar', alias: ['install'], desc: 'instala o Mega Brain como app neste aparelho',
      run() { ctx.actions.install(); },
    },
    {
      name: 'roadmap', desc: 'fases do projeto',
      run() {
        PHASES.forEach(([n, t, s]) => {
          const mark = s === 'ok' ? '<span class="c-act">[ok]</span>' : s === 'wip' ? '<span class="c-hud">[..]</span>' : '<span class="dim">[  ]</span>';
          term.print(`${mark} <span class="${s ? 'c-tx' : 'dim'}">fase ${n.padEnd(3)}</span> ${esc(t)}`);
        });
      },
    },
    {
      name: 'limpar', alias: ['clear', 'cls'], desc: 'limpa a tela sem apagar o log (ctrl+k)',
      run() { term.clear(); },
    },
  ];

  const byName = new Map();
  defs.forEach(c => [c.name, ...(c.alias || [])].forEach(n => byName.set(n, c)));

  function get(name) { return byName.get(String(name).toLowerCase()); }

  function notFound(name) {
    const all = defs.map(c => c.name);
    const near = all
      .map(n => [n, n.startsWith(name.toLowerCase()) ? 0 : lev(name.toLowerCase(), n)])
      .filter(([, d]) => d <= 2)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 3)
      .map(([n]) => `<span class="c-hud">/${n}</span>`);
    return new CmdError('E_CMD_404', 'shell', `comando desconhecido: /${name}`,
      (near.length ? `você quis dizer ${near.join(', ')}? · ` : '') + '<span class="c-hud">/ajuda</span> lista todos');
  }

  return {
    get,
    notFound,
    names: () => defs.map(c => c.name),
  };
}
