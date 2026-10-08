// Pessoas (Fase 2.5): /pessoas lista, /pessoa vê e edita (nova, apelido, renomear, juntar, arquivar).
// Uma das áreas da linguagem de comandos: js/commands.js junta todas (veja o comentário de lá).

import { esc, hl, dayKey, ddmm, CmdError } from '../util.js';
import { isTask, doneAt } from '../tasks.js';
import { pessoasDe, acharPessoa, editApelidos, juntarPessoas, fold, resumoPessoa } from '../pessoas.js';

export function criarPessoas(kit) {
  const { S, term, ctx, usage } = kit;
  // de outras áreas: lidos na hora do uso (a ordem em que as áreas nascem não importa)
  const noteRows = (...a) => kit.noteRows(...a);
  const showByType = (...a) => kit.showByType(...a);
  const showTaskGroups = (...a) => kit.showTaskGroups(...a);

  // cartão de uma pessoa: nome, apelidos e o que está ligado a ela
  function mostrarPessoa(r) {
    const res = resumoPessoa(r.id, S.entries, S.records || [], { projetos: ctx.reg().projects });
    const ap = (r.data?.apelidos || []).length ? ` <span class="dim">· ${r.data.apelidos.map(esc).join(', ')}</span>` : '';
    term.print(`── ${esc(r.text)}${ap} · ${res.total} ligadas ${'─'.repeat(8)}`, 'sep');
    if (!res.total) return term.say(`nada ligado a ${esc(r.text)} ainda · escreva normal ("falar com ${esc(r.text.split(' ')[0])} amanhã") que o app liga sozinho.`);
    if (res.projetos.length) term.print(`<span class="k">projetos</span><span>${res.projetos.map(([p, n]) => `<span class="c-act">#${esc(p)}</span> ${n}`).join(' · ')}</span>`, 'tbl');
    // tarefas numeradas t1, t2... (dá pra usar /feito t1 direto daqui)
    const grupos = [
      { key: 'esperando', title: `esperando ${r.text.split(' ')[0]}`, items: res.esperando },
      { key: 'abertas', title: 'abertas', items: res.abertas },
      { key: 'feitas', title: 'feitas em 30 dias', items: res.feitas },
    ].filter(g => g.items.length);
    if (grupos.length) showTaskGroups(grupos, grupos.flatMap(g => g.items.map(e => e.id)), g => g.title);
    if (res.notas.length) { term.print(`notas <span class="c-meta">${res.notas.length}</span>`, 'tgrp'); noteRows(res.notas.slice(0, 5)); }
    if (res.outros.length) { term.print(`outros <span class="c-meta">${res.outros.length}</span>`, 'tgrp'); showByType(res.outros.slice(0, 5)); }
    if (res.eventos.length) {
      term.print('últimas mudanças', 'tgrp');
      for (const ev of res.eventos.slice(0, 4)) term.print(`<span class="c-meta">${ddmm(new Date(ev.ts))}</span> ${esc(ev.data?.acao || '')} · ${hl(ev.data?.texto || '')}${ev.data?.acao === 'alterada' ? ` <span class="dim">(${Object.keys(ev.data.mudancas || {}).map(esc).join(', ')})</span>` : ''}`);
    }
  }

  const defs = [
    {
      name: 'pessoas', alias: ['gente', 'contatos'], data: true, desc: 'quem está cadastrado, com quantas coisas ligadas',
      run() {
        const pes = pessoasDe(S.records || []);
        if (!pes.length) return term.say('ninguém cadastrado ainda · <span class="c-int">/pessoa nova Ana</span> cadastra (ou escreva normal: o app pergunta quando vir um nome novo)');
        term.print(`── pessoas · ${pes.length} ${'─'.repeat(10)}`, 'sep');
        for (const p of pes.sort((a, b) => a.nome.localeCompare(b.nome))) {
          const ligadas = S.entries.filter(e => (e.data?.pessoas || []).includes(p.id));
          const abertas = ligadas.filter(e => isTask(e) && !doneAt(e)).length;
          term.print(`<span class="k c-act">${esc(p.nome)}</span><span>${p.apelidos.length ? `<span class="dim">${p.apelidos.map(esc).join(', ')} · </span>` : ''}${ligadas.length} ligadas${abertas ? ` · ${abertas} abertas` : ''}</span>`, 'tbl');
        }
        term.print('<span class="dim">/pessoa João mostra tudo dela · /pessoa nova · apelido · renomear · juntar · arquivar</span>');
      },
    },
    {
      name: 'pessoa', data: true, async: true, exec: true,
      args: '<nome> | nova Ana [+apelido] | apelido João +jão -joca | renomear Jão = João Silva | juntar Jão com João | arquivar Ana',
      desc: 'vê ou edita uma pessoa · juntar = os dois cadastros viram um só',
      async run(arg, signal, t) {
        const raw = String(arg).trim();
        const [sub0, ...rest] = raw.split(/\s+/);
        const sub = (sub0 || '').toLowerCase();
        const pes = pessoasDe(S.records || []);
        const rec = id => S.records.find(e => e.id === id);
        // acha o cadastro pelo nome digitado (ou explica o que deu errado)
        const qual = nome => {
          const r = acharPessoa(nome, pes);
          if (r.pessoa) return rec(r.pessoa.id);
          if (r.ambiguo) throw new CmdError('E_AMBIGUO', 'pessoa', `"${nome}" bate com ${r.ambiguo.length} pessoas: ${r.ambiguo.map(p => p.nome).join(', ')}`, 'use o nome completo');
          throw new CmdError('E_404', 'pessoa', `não conheço "${nome}"`, 'veja quem está cadastrado com <span class="c-int">/pessoas</span> · <span class="c-int">/pessoa nova Nome</span> cadastra');
        };
        const separa = (txt, re) => { const i = txt.search(re); return i < 0 ? null : [txt.slice(0, i).trim(), txt.slice(i).replace(re, '').trim()]; };
        const done = (msg, tone = 'act') => { S.lastLatency = t.elapsed(); term.ok('pessoa', `${msg} <span class="c-meta">· /desfazer volta · ${t.id}</span>`); ctx.ui.pulse(tone); };

        if (!sub) return kit.get('pessoas').run('');
        if (sub === 'nova' || sub === 'novo' || sub === 'criar') {
          const words = rest.filter(w => !w.startsWith('+'));
          const nome = words.join(' ').trim();
          if (!nome) throw usage('pessoa', 'nova Ana [+aninha]');
          if (pes.some(p => fold(p.nome) === fold(nome))) return term.say(`${esc(nome)} já está cadastrada.`);
          const apelidos = editApelidos([], rest.filter(w => w.startsWith('+')), nome);
          const e = await ctx.store.add({ kind: 'pessoa', text: nome, tags: [], ts: Date.now(), day: dayKey(new Date()), data: { apelidos, arquivada: false, juntada_em: null } });
          S.undo.push({ label: 'pessoa cadastrada', items: [], created: [e.id] });
          return done(`pessoa cadastrada · <span class="c-act">${esc(nome)}</span>${apelidos.length ? ' · ' + apelidos.map(esc).join(', ') : ''}`);
        }
        if (sub === 'apelido' || sub === 'apelidos') {
          const nome = rest.filter(w => !/^[+-]/.test(w)).join(' ');
          const r = qual(nome);
          const apelidos = editApelidos(r.data?.apelidos || [], rest.filter(w => /^[+-]/.test(w)), r.text);
          S.undo.push({ label: 'apelidos', items: [r] });
          await ctx.store.restore({ ...r, data: { ...(r.data || {}), apelidos } });
          return done(`apelidos de <span class="c-act">${esc(r.text)}</span> · ${apelidos.map(esc).join(', ') || 'nenhum'}`);
        }
        if (sub === 'renomear') {
          const par = separa(rest.join(' '), /\s*(?:=|\bpara\b|\bpra\b)\s*/);
          if (!par || !par[0] || !par[1]) throw usage('pessoa', 'renomear Jão = João Silva');
          const r = qual(par[0]);
          if (pes.some(p => p.id !== r.id && fold(p.nome) === fold(par[1]))) throw new CmdError('E_ARG', 'pessoa', `${par[1]} já existe`, `pra virar um cadastro só, use <span class="c-int">/pessoa juntar ${esc(r.text)} com ${esc(par[1])}</span>`);
          // o nome antigo vira apelido: o app continua reconhecendo do jeito que você escrevia
          const apelidos = editApelidos(r.data?.apelidos || [], ['+' + r.text], par[1]);
          S.undo.push({ label: 'pessoa renomeada', items: [r] });
          await ctx.store.restore({ ...r, text: par[1], data: { ...(r.data || {}), apelidos } });
          return done(`${esc(r.text)} → <span class="c-act">${esc(par[1])}</span> (o nome antigo virou apelido)`);
        }
        if (sub === 'juntar' || sub === 'mesclar' || sub === 'unir') {
          const par = separa(rest.join(' '), /\s*(?:\bcom\b|\bem\b|=)\s*/);
          if (!par || !par[0] || !par[1]) throw usage('pessoa', 'juntar Jão com João  (o primeiro some, tudo dele vai pro segundo)');
          const de = qual(par[0]), para = qual(par[1]);
          if (de.id === para.id) return term.say('é a mesma pessoa.');
          const { novoPara, novoDe, religadas } = juntarPessoas(de, para, S.entries);
          S.undo.push({ label: 'pessoas juntadas', items: [de, para, ...S.entries.filter(e => religadas.some(r => r.id === e.id))] });
          await ctx.store.restore(novoPara);
          await ctx.store.restore(novoDe);
          for (const e of religadas) await ctx.store.restore(e);
          return done(`<span class="c-act">${esc(de.text)}</span> juntado em <span class="c-act">${esc(para.text)}</span> · ${religadas.length} ${religadas.length === 1 ? 'entrada religada' : 'entradas religadas'} · apelidos: ${novoPara.data.apelidos.map(esc).join(', ')}`);
        }
        if (sub === 'arquivar') {
          const r = qual(rest.join(' '));
          S.undo.push({ label: 'pessoa arquivada', items: [r] });
          await ctx.store.restore({ ...r, data: { ...(r.data || {}), arquivada: true } });
          return done(`${esc(r.text)} arquivada · o app para de reconhecer · as entradas continuam como estão`, 'warn');
        }
        // /pessoa João: o cartão da pessoa (a visão completa vem na etapa 5)
        const r = qual(raw);
        mostrarPessoa(r);
      },
    },
  ];
  return { defs, mostrarPessoa };
}
