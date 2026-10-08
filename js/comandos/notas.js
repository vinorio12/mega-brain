// Notas e acervo: /inbox (diário), /hoje, /acervo (links e textos), /guardar, /buscar em tudo.
// Uma das áreas da linguagem de comandos: js/commands.js junta todas (veja o comentário de lá).

import { dayKey } from '../util.js';
import { isLink, isSnippet, isAcervo, parseLink, searchAll } from '../acervo.js';
import { groupTasks } from '../tasks.js';

export function criarNotas(kit) {
  const { S, term, ctx, usage } = kit;
  // de outras áreas: lidos na hora do uso (a ordem em que as áreas nascem não importa)
  const notesPool = (...a) => kit.notesPool(...a);
  const noteRows = (...a) => kit.noteRows(...a);
  const showSearch = (...a) => kit.showSearch(...a);
  const showTaskGroups = (...a) => kit.showTaskGroups(...a);
  const addLink = (...a) => kit.addLink(...a);
  const addSnippet = (...a) => kit.addSnippet(...a);

  const defs = [
    {
      name: 'inbox', data: true, alias: ['ls', 'notas'], args: '[n]', desc: 'suas notas, em diário (últimas n, padrão 15)',
      run(arg) {
        const n = Math.max(1, Math.min(500, parseInt(arg, 10) || 15));
        const all = notesPool();
        if (!all.length) return term.say('nenhuma nota ainda. escreva qualquer coisa pra capturar.');
        const items = all.slice(-n);
        term.print(`── inbox · notas · ${items.length} de ${all.length} ${'─'.repeat(8)}`, 'sep');
        noteRows(items);
        term.print('<span class="dim">tarefas: /tarefas · links e textos: /acervo · tudo: /overview</span>');
      },
    },
    {
      name: 'hoje', data: true, desc: 'a tela Hoje: o que vence hoje e o atrasado, o dinheiro do mês, os próximos dias e as notas de hoje',
      run() {
        // v0.14: uma tela (palco), a mesma que o celular abre ao entrar · sem tela (testes), o texto de antes
        if (ctx.ui?.openStage) { ctx.ui.openStage('hoje'); return term.say('o seu dia · o círculo conclui · escreva normal que a lista se atualiza · <span class="c-int">esc</span> fecha'); }
        const k = dayKey(new Date());
        const notes = notesPool().filter(e => e.day === k);
        if (notes.length) { term.print(`── notas de hoje ${'─'.repeat(10)}`, 'sep'); noteRows(notes); }
        else term.say('nenhuma nota hoje.');
        const { groups } = groupTasks(S.entries, { proj: S.ctx, projects: ctx.reg().projects });
        const due = groups.filter(g => g.key === 'atrasadas' || g.key === 'hoje');
        if (due.length) {
          term.print(`── tarefas pra hoje ${'─'.repeat(10)}`, 'sep');
          showTaskGroups(due, due.flatMap(g => g.items.map(e => e.id)));
        }
      },
    },
    {
      name: 'buscar', data: true, alias: ['grep', 'b'], args: '<termo | #tag> [tipo:link|texto|tarefa|nota]',
      desc: 'procura em tudo (notas, tarefas, links, textos) · ex: /buscar rag tipo:link',
      run(arg) {
        if (!String(arg).trim()) throw usage('buscar', 'rag  ·  #tcc  ·  rag tipo:link');
        showSearch(searchAll(S.entries, arg), `busca "${arg}"`);
      },
    },
    {
      name: 'acervo', alias: ['ac'], data: true, args: '[links | textos] [termo]',
      desc: 'links e textos guardados · cole um link pra guardar · /guardar texto',
      run(arg) {
        const words = String(arg).trim().split(/\s+/).filter(Boolean);
        const tipo = { links: 'link', link: 'link', textos: 'trecho', texto: 'trecho', trechos: 'trecho' }[(words[0] || '').toLowerCase()];
        if (tipo) words.shift();
        const pool = S.entries.filter(e => isAcervo(e) && (!tipo || (tipo === 'link' ? isLink(e) : isSnippet(e))));
        if (!pool.length) {
          return term.say('acervo vazio. cole um link (<span class="c-int">https://… contexto #tag</span>) ou use <span class="c-int">/guardar texto</span>.');
        }
        showSearch(searchAll(pool.slice().reverse(), words.join(' ')), `acervo${tipo ? ' · ' + (tipo === 'link' ? 'links' : 'textos') : ''}`);
        term.print('<span class="dim">toque no cartão pra abrir · /apagar a2 remove · /buscar termo procura em tudo</span>');
      },
    },
    {
      name: 'guardar', alias: ['g', 'salvar'], exec: true, data: true, async: true, args: '<texto>',
      desc: 'guarda um texto curto no acervo (ou comece a linha com aspas ")',
      async run(arg, signal, t) {
        if (!String(arg).trim()) throw usage('guardar', 'texto curto pra guardar');
        const l = parseLink(arg);
        return l ? addLink(arg, t) : addSnippet(arg, t);
      },
    },
  ];
  return { defs };
}
