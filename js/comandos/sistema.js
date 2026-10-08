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
  const chip = (...a) => kit.chip(...a);
  const chips = (...a) => kit.chips(...a);
  const strip = x => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const get = (...a) => kit.get(...a);
  const notFound = (...a) => kit.notFound(...a);

  const defs = [
    {
      name: 'ajuda', alias: ['help', '?'], args: '[área | comando | tudo]', desc: 'o essencial e as áreas · /ajuda dinheiro mostra uma área · /ajuda mes detalha um comando',
      run(arg) {
        const a = String(arg || '').trim().toLowerCase().replace(/^\//, '');
        const todos = kit.defs();
        // as áreas (v0.14, pedido do Vini: o /ajuda era muita coisa numa lista só)
        const AREAS = [
          { key: 'tarefas', nome: 'tarefas', alias: ['tarefa', 'projetos'], pick: c => ['overview', 'inicio', 't', 'tarefas', 'ver', 'feito', 'mover', 'editar', 'reabrir', 'adiar', 'feitas', 'projeto', 'status', 'ir'].includes(c.name),
            ex: [['- revisar cap 2 #tcc sexta', 'cria tarefa'], ['t2 feito · t2 sexta · t2 fazendo', 'mexe na t2'], ['hoje concluí t1, t3', 'conclui várias']] },
          { key: 'dinheiro', nome: 'dinheiro', alias: ['financas', 'finanças', 'fin'], pick: c => fin.defs.includes(c),
            ex: [['gastei 45 no ifood', 'gasto (categoria e forma aprendem)'], ['paguei a fatura 1.680', 'sai da conta, não é gasto'], ['netflix 55,90 todo mês dia 15', 'recorrente']] },
          { key: 'pessoas', nome: 'pessoas', alias: ['pessoa'], pick: c => ['pessoas', 'pessoa', 'sim', 'nao'].includes(c.name),
            ex: [['falar com a Ana amanhã', 'o app liga a tarefa à Ana']] },
          { key: 'notas', nome: 'notas e acervo', alias: ['acervo', 'nota'], pick: c => ['inbox', 'hoje', 'acervo', 'guardar', 'buscar'].includes(c.name),
            ex: [['https://… contexto', 'guarda o link'], ['"uma frase', 'guarda o texto'], ['nota: qualquer coisa', 'força nota']] },
          { key: 'interprete', nome: 'intérprete', alias: ['intérprete', 'memoria'], pick: c => ['tipo', 'memoria', 'palavras', 'aprendizado', 'mudancas', 'contexto'].includes(c.name),
            ex: [['/tipo tarefa', 'corrige o que o app entendeu']] },
          { key: 'sistema', nome: 'sistema', alias: ['tela', 'conta'], pick: () => true, ex: [] },
        ];
        // cada comando cai na primeira área que o pega (o resto vai pra "sistema")
        const areaDe = new Map();
        for (const c of todos) areaDe.set(c, AREAS.find(ar => ar.pick(c)).key);
        const curto = d => esc(String(d || '').split(' · ')[0]);
        const exemplos = ex => ex.forEach(([f, o]) => term.print(`<span class="c-int">${esc(f)}</span> <span class="dim">→ ${esc(o)}</span>`, 'ex'));

        // /ajuda (sem nada): o essencial em poucas linhas + as áreas como botões
        if (!a) {
          term.print(`── ajuda ${'─'.repeat(12)}`, 'sep');
          term.print('escreva do seu jeito, sem barra:', 'tgrp');
          exemplos([['- revisar cap 2 #tcc sexta', 'tarefa'], ['gastei 45 no ifood', 'gasto'], ['t2 feito · t2 sexta', 'mexe na tarefa t2'], ['https://… · "uma frase', 'acervo']]);
          term.print(`áreas${chips(AREAS.map(ar => chip(ar.nome, '/ajuda ' + ar.key)))}`, 'tgrp');
          term.print(`<span class="dim">/ajuda mes detalha um comando ·</span> <span class="c-int">/ajuda tudo</span> <span class="dim">lista todos</span>`);
          return;
        }

        // /ajuda dinheiro e /ajuda tudo: na tela grande do centro (o terminal embaixo do núcleo mostrava poucos comandos por vez).
        // Comandos em colunas, botão e descrição lado a lado; as áreas viram abas no topo; esc fecha.
        const NUNCA = ['sair', 'entrar', 'codigo', 'boot', 'migrar', 'importar', 'exportar', 'limpar'];
        const item = c => {
          const roda = !c.exec && !String(c.args || '').startsWith('<') && !NUNCA.includes(c.name);
          const botao = roda
            ? `<button type="button" class="cmdpill" data-cmd="/${esc(c.name)}">/${esc(c.name)}</button>`
            : `<button type="button" class="cmdpill is-fill" data-fill="/${esc(c.name)} ">/${esc(c.name)}</button>`;
          return `<div class="aj-item" title="${esc(c.desc)}">${botao}<span class="cd">${curto(c.desc)}</span></div>`;
        };
        const abas = atual => `<nav class="aj-tabs">${AREAS.map(x => `<button type="button" class="chip${x.key === atual ? ' is-on' : ''}" data-cmd="/ajuda ${x.key}">${esc(x.nome)}</button>`).join('')}` +
          `<button type="button" class="chip${atual === 'tudo' ? ' is-on' : ''}" data-cmd="/ajuda tudo">tudo</button></nav>`;
        const legenda = '<div class="aj-leg"><span class="cmdpill">/cheio</span> roda na hora · <span class="cmdpill is-fill">/tracejado</span> escreve no campo pra você completar · <span class="c-int">/ajuda mes</span> detalha um comando</div>';
        const exHtml = ex => (ex.length ? `<div class="aj-ex">${ex.map(([f, o]) => `<span><span class="c-int">${esc(f)}</span> <span class="dim">→ ${esc(o)}</span></span>`).join('')}</div>` : '');

        if (a === 'tudo' || a === 'todos') {
          const secoes = AREAS.map(x => {
            const lista = todos.filter(c => areaDe.get(c) === x.key);
            return lista.length ? `<section class="aj-sec"><h3>${esc(x.nome)} <span>${lista.length}</span></h3><div class="aj-grid">${lista.map(item).join('')}</div></section>` : '';
          }).join('');
          ctx.ui.openStage('ajuda', { titulo: 'AJUDA', html: `<div class="aj">${abas('tudo')}${legenda}${secoes}</div>` });
          return term.say(`todos os ${todos.length} comandos abertos na tela · <span class="c-int">esc</span> fecha`);
        }

        const ar = AREAS.find(x => x.key === a || x.alias.includes(a) || strip(x.nome) === strip(a));
        if (ar) {
          const lista = todos.filter(c => areaDe.get(c) === ar.key);
          const teclas = ar.key === 'sistema'
            ? `<section class="aj-sec"><h3>teclado</h3><div class="aj-ex">${[['tab', 'completa'], ['↑ ↓', 'histórico'], ['ctrl+c', 'cancela'], ['ctrl+k', 'limpa a tela'], ['ctrl+.', 'painel'], ['alt+1..4', 'abas'], ['esc', 'fecha a tela grande']].map(([k, d]) => `<span><span class="c-int">${k}</span> <span class="dim">${d}</span></span>`).join('')}</div></section>` : '';
          ctx.ui.openStage('ajuda', { titulo: `AJUDA · ${ar.nome.toUpperCase()}`, html: `<div class="aj">${abas(ar.key)}${exHtml(ar.ex)}${legenda}<div class="aj-grid">${lista.map(item).join('')}</div>${teclas}</div>` });
          return term.say(`ajuda de ${esc(ar.nome)} aberta na tela · as abas trocam de área · <span class="c-int">esc</span> fecha`);
        }

        // /ajuda mes: um comando
        const c = get(a);
        if (!c) throw notFound(a);
        table([
          ['uso', `<span class="c-act">/${c.name}</span> ${esc(c.args || '')}`],
          ['faz', esc(c.desc)],
          ['atalhos', c.alias?.length ? c.alias.map(x => '/' + esc(x)).join(' ') : '<span class="dim">—</span>'],
          ['área', esc(AREAS.find(x => x.key === areaDe.get(c))?.nome || 'sistema')],
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
      name: 'detalhes', alias: ['tecnico', 'técnico', 'verbose'], desc: 'liga/desliga as linhas técnicas (T0005, ms, regra 90%, * auto) depois de cada lançamento',
      run() {
        S.detalhes = !S.detalhes;
        try { localStorage.setItem('mb.detalhes.v1', S.detalhes ? '1' : '0'); } catch {}
        term.say(S.detalhes ? 'detalhes ligados · cada lançamento mostra a linha técnica e o "↳ entendi" com regra e %.' : 'detalhes desligados · cada lançamento vira uma linha só (✓). <span class="c-hud">/detalhes</span> liga de novo.');
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
