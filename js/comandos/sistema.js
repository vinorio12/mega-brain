// Sistema e tela: /ajuda, /condition, /clima, /log, /historico, conta (/entrar, /codigo, /sair, /sync, /migrar),
// /instalar, /boot, /roadmap, /painel, /foco, /limpar. PHASES = as fases que o /roadmap e o painel mostram.
// Uma das áreas da linguagem de comandos: js/commands.js junta todas (veja o comentário de lá).

import { esc, dayKey, hhmm, dur, kb, VERSION } from '../util.js';
import { geocode, locate, fetchWeather, savedPlace, describe } from '../weather.js';
import { taskStats } from '../tasks.js';

export const PHASES = [
  ['0', 'esqueleto · terminal, hud, inbox', 'ok'],
  ['0.5', 'app próprio · pwa, nuvem, login', 'ok'],
  ['1', 'tarefas e projetos · hoje, tcc, weg, pessoal', 'ok'],
  ['2', 'intérprete · escreva do seu jeito (regras; ia encaixável, desligada) · histórico · contexto', 'ok'],
  ['2.5', 'pessoas e memória · nomes na frase, projeto aprendido pelo uso', 'ok'],
  ['3', 'finanças · lançamento, categorias, mês, cartões, parcelas, recorrentes · saldos', 'ok'],
  ['4', 'corpo e hábitos · treino, saúde, padrão semanal', ''],
  ['5', 'dashboards · gráficos e tendências', ''],
  ['6', 'coach · ia lê tudo e sugere próximos passos, resumo do dia, revisão da semana', ''],
];

export function criarSistema(kit) {
  const { S, term, ctx, usage, fin } = kit;
  // de outras áreas: lidos na hora do uso (a ordem em que as áreas nascem não importa)
  const table = (...a) => kit.table(...a);
  const get = (...a) => kit.get(...a);
  const notFound = (...a) => kit.notFound(...a);

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
        table([['- texto #proj @status >prazo !prio', 'cria tarefa (igual ao /t) · o que faltar vira ↳ auto'], ['gastei 45 no ifood · caiu o salário 3.200', 'lança gasto ou entrada (categoria e forma aprendem pelo uso) · /mes mostra o mês'], ['https://… contexto', 'guarda o link no acervo'], ['"texto', 'guarda o texto no acervo']], 'cmd');
        const groups = [
          ['tarefas e projetos', c => ['overview', 'inicio', 't', 'tarefas', 'ver', 'feito', 'mover', 'editar', 'reabrir', 'adiar', 'feitas', 'projeto', 'status', 'ir'].includes(c.name)],
          ['pessoas', c => ['pessoas', 'pessoa', 'sim', 'nao'].includes(c.name)],
          ['finanças', c => fin.defs.includes(c)],
          ['intérprete', c => ['tipo', 'memoria', 'palavras', 'aprendizado', 'mudancas', 'contexto'].includes(c.name)],
          ['acervo', c => ['acervo', 'guardar', 'buscar'].includes(c.name)],
          ['memória', c => c.data],
          ['conta', c => ['entrar', 'codigo', 'sair'].includes(c.name)],
          ['tela', c => ['painel', 'foco', 'limpar', 'log', 'historico', 'boot'].includes(c.name)],
        ];
        const used = new Set();
        const section = (title, pick) => {
          const list = kit.defs().filter(c => !used.has(c) && pick(c));
          if (!list.length) return;
          list.forEach(c => used.add(c));
          term.print(`── ${title}`, 'sep');
          table(list.map(c => [`/${c.name}${c.args ? ' ' + esc(c.args) : ''}`, esc(c.desc)]), 'cmd');
        };
        groups.forEach(([title, pick]) => section(title, pick));
        section('sistema', () => true);
        term.print('── teclado', 'sep');
        table([
          ['tab', 'completa /comandos e #tags'],
          ['↑ ↓', 'navega no histórico'],
          ['ctrl+c', 'cancela a tarefa em andamento'],
          ['ctrl+k', 'limpa a tela (o log continua)'],
          ['ctrl+.', 'mostra/esconde o painel de contexto'],
          ['alt+1..4', 'abas: ~ · tcc · weg · pessoal'],
          ['esc', 'apaga a linha'],
        ]);
      },
    },
    {
      name: 'condition', alias: ['sys', 'sistema'], desc: 'condição completa do sistema (estado, memória, rede, sessão)',
      run() {
        const k = dayKey(new Date());
        const state = ctx.ui.state();
        const wx = S.weather;
        const [memText, memTone] = ctx.ui.mem();
        const st = ctx.store?.status;
        table([
          ['estado', `<span class="${state === 'ready' ? 'c-act' : state === 'busy' ? 'c-hud' : 'c-warn'}">${state.toUpperCase()}</span>`],
          ['sessão', S.user ? esc((S.operator ? S.operator + ' · ' : '') + S.user.email) : S.locked ? '<span class="c-warn">bloqueada · digite a senha</span>' : 'modo local'],
          ['memória', `<span class="${memTone === 'ok' ? 'c-act' : memTone === 'na' ? 'c-meta' : 'c-warn'}">${memText}</span>` +
            (ctx.store?.kind === 'local' ? ' <span class="dim">· só neste navegador</span>' : '') +
            (st?.lastSync ? ` <span class="dim">· último sync ${hhmm(new Date(st.lastSync))}</span>` : '') +
            (st?.lastError ? ` <span class="c-warn">· ${esc(st.lastError)}</span>` : '')],
          ['tempo real', st?.realtime ?? '<span class="dim">NA</span>'],
          ['leitura', st?.modo ? `${st.modo === 'leve' ? 'leve (só o que mudou)' : 'completa'} · ${st.linhas ?? 0} linhas` : '<span class="dim">NA</span>'],
          ['tarefas', (s => `${s.abertas} abertas · hoje ${s.hoje}` + (s.atrasadas ? ` · <span class="c-warn">${s.atrasadas} atrasadas</span>` : '') + ` · feitas hoje ${s.feitasHoje}`)(taskStats(S.entries))],
          ['aba', S.ctx ? `<span class="c-act">~/${esc(S.ctx)}</span>` : '~ (inbox)'],
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
      name: 'entrar', alias: ['login'], args: '[outro]', desc: 'entra na conta (usuário e senha) · "outro" troca de usuário',
      run(arg) { ctx.actions.login(String(arg).trim().toLowerCase()); },
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
      name: 'migrar', exec: true, desc: 'envia pra nuvem as notas que ficaram no modo local', async: true, announce: true, data: true,
      async run(arg, signal, t) { await ctx.actions.migrate(t); },
    },
    {
      name: 'instalar', alias: ['install'], desc: 'instala o Mega Brain como app neste aparelho',
      run() { ctx.actions.install(); },
    },
    {
      name: 'boot', args: '[completo | curto]', desc: 'repete a inicialização completa · "completo" deixa sempre a longa',
      run(arg) {
        const a = String(arg).trim().toLowerCase();
        if (a === 'completo' || a === 'longo') {
          try { localStorage.setItem('mb.boot.v1', 'full'); } catch {}
          return term.say('a inicialização completa (~5s) vai rodar sempre que o MB Core abrir. <span class="c-int">/boot curto</span> volta pra rápida.');
        }
        if (a === 'curto' || a === 'rapido' || a === 'rápido') {
          try { localStorage.setItem('mb.boot.v1', 'auto'); } catch {}
          return term.say('inicialização rápida (~1,5s) a partir da próxima abertura.');
        }
        if (a) throw usage('boot', '[completo | curto]');
        try { sessionStorage.setItem('mb.boot.once', 'full'); } catch {}
        term.say('reiniciando o núcleo…');
        setTimeout(() => location.reload(), 350);
      },
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
      name: 'painel', alias: ['tele'], desc: 'mostra/esconde o painel de contexto (ctrl+.)',
      run() {
        const on = ctx.ui.toggle('tele');
        term.say(on ? 'telemetria visível.' : 'telemetria escondida · <span class="c-hud">/painel</span> ou ctrl+. traz de volta.');
      },
    },
    {
      name: 'foco', alias: ['zen'], desc: 'só núcleo e terminal na tela (de novo pra voltar)',
      run() {
        const on = ctx.ui.toggle('focus');
        term.say(on ? 'modo foco · <span class="c-hud">/foco</span> de novo traz os painéis.' : 'painéis de volta.');
      },
    },
    {
      name: 'limpar', alias: ['clear', 'cls'], desc: 'limpa a tela sem apagar o log (ctrl+k)',
      run() { term.clear(); },
    },
  ];
  return { defs };
}
