// Intérprete na tela: tudo o que é escrito sem "/" passa por aqui (capturar → salvar → linha "↳ entendi"),
// a fila de perguntas (/sim, /nao) e os comandos que ensinam ou corrigem o app: /tipo, /memoria, /palavras,
// /aprendizado, /contexto.
// Uma das áreas da linguagem de comandos: js/commands.js junta todas (veja o comentário de lá).

import { esc, hl, dayKey, ddmm, CmdError } from '../util.js';
import { fmtDue, fmtDia } from '../dates.js';
import { projName, groupTasks } from '../tasks.js';
import { verboCandidato, categoriasDe, acharCategoria, acharForma, cartoesDe, FORMA_ROTULO } from '../financas.js';
import { isFinanca } from './financas.js';
import { REGISTRO } from '../tipos.js';
import { previa, interpretar } from '../interpretar.js';
import { registroAprendizado, resumoAprendizado, exportarFrases } from '../aprendizado.js';
import { montarContexto, estimarTokens } from '../contexto.js';
import { pessoasDe, acharPessoa } from '../pessoas.js';
import { chavePalavra, campoCategoria } from '../memoria.js';

export function criarInterprete(kit) {
  const { S, term, ctx, usage, ictx, mem, gravarMemoria, fin } = kit;
  // de outras áreas: lidos na hora do uso (a ordem em que as áreas nascem não importa)
  const nums = (...a) => kit.nums(...a);
  const linkHtml = (...a) => kit.linkHtml(...a);
  const taskPool = (...a) => kit.taskPool(...a);
  const addTask = (...a) => kit.addTask(...a);
  const get = (...a) => kit.get(...a);

  // Grava o que o intérprete entendeu (qualquer tipo registrado) e mostra a confirmação. Tudo entra no /desfazer.
  async function salvar(interp, t) {
    const tipo = REGISTRO.get(interp.tipo);
    const doc = tipo.montar(interp, ictx());
    // quem aparece na frase fica ligado à entrada (o texto continua como foi escrito)
    if (interp.pessoas?.length) doc.data = { ...(doc.data || {}), pessoas: interp.pessoas };
    const e = await ctx.store.add(doc);
    S.lastLatency = t.elapsed();
    const queued = ctx.store.pending() > 0;
    const meta = `<span class="c-meta">· ${t.id} · ${S.lastLatency}ms</span>`;
    let n = null;
    if (interp.tipo === 'tarefa') {
      S.undo.push({ label: 'tarefa criada', items: [], created: [e.id] });
      // entra no fim da lista atual, pra já ter um número
      if (!S.taskList?.length) S.taskList = groupTasks(S.entries, { proj: S.ctx, projects: ctx.reg().projects }).list;
      else if (!S.taskList.includes(e.id)) S.taskList.push(e.id);
      n = 't' + (S.taskList.indexOf(e.id) + 1);
      term[queued ? 'warn' : 'ok']('task', `tarefa${queued ? ' na fila' : ''} <span class="c-meta">${n}</span> · ${hl(e.text)} ${meta}`);
    } else if (interp.tipo === 'link') {
      S.undo.push({ label: 'link guardado', items: [], created: [e.id] });
      n = nums().get(e.id) || '';
      term.ok('acervo', `link guardado <span class="c-meta">${n}</span> · ${linkHtml(e)} <span class="c-meta">· ${t.id} · /acervo lista</span>`);
    } else if (interp.tipo === 'trecho') {
      S.undo.push({ label: 'texto guardado', items: [], created: [e.id] });
      n = nums().get(e.id) || '';
      term.ok('acervo', `texto guardado <span class="c-meta">${n}</span> · ${hl(e.text)} <span class="c-meta">· ${t.id} · /acervo lista</span>`);
    } else if (interp.tipo === 'nota') {
      S.undo.push({ label: 'nota capturada', items: [], created: [e.id] });
      n = nums().get(e.id) || '';
      const tagHtml = e.tags?.length ? ' · ' + e.tags.map(x => `<span class="c-act">#${esc(x)}</span>`).join(' ') : '';
      term[queued ? 'warn' : 'ok']('store', `${queued ? 'capturado · na fila, sobe quando a rede voltar' : 'capturado'} <span class="c-meta">${esc(n)}</span>${tagHtml} ${meta}`);
    } else if (e.kind === 'saldo' || e.kind === 'faturapaga') {
      // Fase 3d: âncora do saldo ("tenho 2.500 na conta") e fatura paga: registros, com /desfazer
      S.undo.push({ label: e.kind === 'saldo' ? 'saldo' : 'fatura paga', items: [], created: [e.id] });
      term[queued ? 'warn' : 'ok']('fin', `${e.kind === 'saldo' ? 'saldo anotado' : 'fatura paga'}${queued ? ' na fila' : ''} · ${hl(e.text)} ${meta}`);
    } else if (e.kind === 'recorrente') {
      // o cadastro (Fase 3c): os gastos de cada mês quem lança é o lançador
      S.undo.push({ label: 'recorrente cadastrada', items: [], created: [e.id] });
      term[queued ? 'warn' : 'ok']('fin', `recorrente cadastrada${queued ? ' na fila' : ''} · ${hl(e.text)} ${meta}`);
    } else if (isFinanca(e)) {
      // gasto, entrada, transferência: número f1, f2...
      S.undo.push({ label: `${tipo.rotulo} lançado`, items: [], created: [e.id] });
      n = fin.numero(e);
      term[queued ? 'warn' : 'ok']('fin', `${esc(tipo.rotulo)} ${/a$/.test(tipo.rotulo) ? 'lançada' : 'lançado'}${queued ? ' na fila' : ''} <span class="c-meta">${n}</span> · ${hl(e.text)} ${meta}`);
    } else {
      // treino...: só o dado bruto por enquanto
      S.undo.push({ label: `${tipo.rotulo} guardado`, items: [], created: [e.id] });
      term[queued ? 'warn' : 'ok']('store', `${esc(tipo.rotulo)} ${/a$/.test(tipo.rotulo) ? 'guardada' : 'guardado'}${queued ? ' na fila' : ''} · ${hl(e.text)} ${meta}`);
    }
    ctx.ui.pulse(queued ? 'warn' : 'act');
    return { e, n };
  }

  // Texto livre digitado no terminal (sem "/"): o intérprete decide o que é.
  //   "- " = tarefa, sempre · o resto: interpretar() (regras → IA, se ligada → nota com pergunta)
  async function capturar(text, t) {
    if (/^-\s+\S/.test(text)) return addTask(text.replace(/^-\s+/, ''), t);
    const r = await interpretar(text, ictx());
    const { e, n } = await salvar(r, t);
    S.ultima = { id: e.id, texto: text }; // o /tipo sem alvo corrige esta
    entendiLine(r, e, n);
    if (isFinanca(e)) fin.perguntar(r, e, n);
    // recorrente nova com o dia de hoje: já lança (e o /desfazer do cadastro leva o lançamento junto)
    if (e.kind === 'recorrente') {
      const ids = await fin.lancarRecorrentes({ lembretes: false });
      if (ids.length && S.undo.at(-1)?.created?.includes(e.id)) S.undo.at(-1).created.push(...ids);
    }
    if (r.pergunta) aprender({ texto: text, palpite: r.palpite, confianca: r.confianca, origem: r.origem, era: 'nota' });
    // perguntas pendentes (/sim, /nao respondem a primeira) · escrever outra coisa troca a fila
    S.perguntas = [
      ...(r.pergunta && r.palpite ? [{ tipo: 'tipo', palpite: r.palpite, id: e.id, texto: text, mostrada: true }] : []),
      ...tagsNovas(r).map(tag => ({ tipo: 'projeto', tag, id: e.id })),
      ...(r.pessoasNovas || []).map(nome => ({ tipo: 'pessoa', nome, id: e.id, texto: text })),
    ];
    mostrarPergunta();
    return { e, n };
  }

  // tarefa com #tag que não é projeto ("#faculdade"): a tag saiu do título e o app pergunta se cria o projeto
  const tagsNovas = r => (r?.tipo === 'tarefa' && r.motivos?.projeto?.tipo === 'tagnova' ? r.motivos.projeto.tags : []);

  // mostra a primeira pergunta da fila (se ainda não apareceu)
  function mostrarPergunta() {
    const q = S.perguntas?.[0];
    if (!q || q.mostrada) return;
    q.mostrada = true;
    const mais = S.perguntas.length > 1 ? ` <span class="dim">· depois tem mais ${S.perguntas.length - 1}</span>` : '';
    if (q.tipo === 'projeto') {
      term.print(`<span class="c-warn">↳ #${esc(q.tag)} não é projeto</span> <span class="dim">· a tarefa ficou sem projeto ·</span> <span class="c-int">/sim</span> <span class="dim">cria #${esc(q.tag)} e move ·</span> <span class="c-int">/nao</span> <span class="dim">deixa assim</span>${mais}`, 'auto');
    } else if (q.tipo === 'pessoa') {
      term.print(`<span class="c-int">↳ ${esc(q.nome)} é uma pessoa?</span> <span class="c-int">/sim</span> <span class="dim">cadastra e liga ·</span> <span class="c-int">/nao</span> <span class="dim">não pergunto mais</span>${mais}`, 'auto');
    } else if (q.tipo === 'verbo') {
      term.print(`<span class="c-int">↳ aprender "${esc(q.palavra)}" como ${esc(q.valor)}?</span> <span class="c-int">/sim</span> <span class="dim">da próxima vez já entendo ·</span> <span class="c-int">/nao</span>${mais}`, 'auto');
    }
  }

  // /sim e /nao: respondem a pergunta mais antiga da fila
  async function responder(sim, t) {
    const q = S.perguntas?.[0];
    if (!q) return term.say('nada pra responder agora.');
    S.perguntas.shift();
    if (q.tipo === 'tipo') {
      if (sim) {
        S.ultima = { id: q.id, texto: q.texto };
        await get('tipo').run(q.palpite, null, t);
        // "abasteci 200 no posto" virou gasto: oferece aprender o verbo (só entra com outro /sim, nunca sozinho)
        const w = ['gasto', 'entrada'].includes(q.palpite) && verboCandidato(q.texto);
        if (w) S.perguntas.unshift({ tipo: 'verbo', palavra: w, valor: q.palpite });
      } else { aprender({ texto: q.texto, era: 'nota', corrigido: 'nota' }); term.ok('store', 'fica como nota · anotado no /aprendizado'); }
    } else if (q.tipo === 'verbo') {
      if (sim) {
        const e = await gravarMemoria('verbo:' + q.palavra, 'fixar', null, q.palavra, { campo: 'tipo', valor: q.valor });
        S.undo.push({ label: 'verbo aprendido', items: [], created: [e.id] });
        term.ok('fin', `aprendi · "<span class="c-act">${esc(q.palavra)}</span>" agora é ${esc(q.valor)} <span class="c-meta">· /memoria mostra · /desfazer volta</span>`);
        ctx.ui.pulse('act');
      } else term.ok('fin', `ok · "${esc(q.palavra)}" continua sem significado pra mim`);
    } else if (q.tipo === 'projeto') {
      const entry = S.entries.find(x => x.id === q.id);
      if (sim) {
        const reg = ctx.reg();
        const p = reg.projects.includes(q.tag) ? null
          : await ctx.store.add({ kind: 'projeto', text: q.tag, tags: [], ts: Date.now(), day: dayKey(new Date()), data: { ordem: reg.projects.length + 1, arquivado: false } });
        if (entry) await ctx.store.restore({ ...entry, tags: [...new Set([q.tag, ...(entry.tags || [])])], data: { ...(entry.data || {}), projeto: q.tag } });
        S.undo.push({ label: 'projeto criado', items: entry ? [entry] : [], created: p ? [p.id] : [] });
        term.ok('task', `projeto criado · <span class="c-act">#${esc(q.tag)}</span>${entry ? ` · ${hl(entry.text)} foi pra ele` : ''} <span class="c-meta">· /desfazer volta</span>`);
        ctx.ui.pulse('act');
      } else term.ok('task', `ok · fica sem projeto <span class="c-meta">· #${esc(q.tag)} continua como etiqueta · /editar muda</span>`);
    } else if (q.tipo === 'pessoa') {
      if (sim) {
        const p = await ctx.store.add({ kind: 'pessoa', text: q.nome, tags: [], ts: Date.now(), day: dayKey(new Date()), data: { apelidos: [], arquivada: false, juntada_em: null } });
        const entry = S.entries.find(x => x.id === q.id);
        if (entry) await ctx.store.restore({ ...entry, data: { ...(entry.data || {}), pessoas: [...new Set([...(entry.data?.pessoas || []), p.id])] } });
        S.undo.push({ label: 'pessoa cadastrada', items: entry ? [entry] : [], created: [p.id] });
        term.ok('pessoa', `pessoa cadastrada · <span class="c-act">${esc(q.nome)}</span>${entry ? ' · ligada à entrada' : ''} <span class="c-meta">· /pessoa ${esc(q.nome)} · /desfazer volta</span>`);
        ctx.ui.pulse('act');
      } else {
        aprender({ texto: q.nome, naoPessoa: q.nome });
        term.ok('pessoa', `ok · não pergunto mais sobre <span class="c-act">${esc(q.nome)}</span>`);
      }
    }
    mostrarPergunta();
  }

  // guarda pro /aprendizado (frase não entendida ou corrigida). Nunca atrapalha a captura.
  function aprender(dados) {
    const reg = registroAprendizado(dados);
    if (reg) Promise.resolve(ctx.store.add(reg)).catch(e => console.warn('aprendizado', e));
  }
  // rótulo do processo que aparece enquanto grava
  const rotuloCaptura = text => (/^-\s+\S/.test(text) ? 'nova tarefa'
    : { link: 'guardar link', trecho: 'guardar texto', tarefa: 'nova tarefa', gasto: 'novo gasto', entrada: 'nova entrada', transferencia: 'transferência', recorrente: 'nova recorrente', saldo: 'saldo', faturapaga: 'fatura paga', rendimento: 'rendimento', treino: 'novo treino' }[previa(text, ictx())?.tipo] || 'captura');

  // A linha curta "↳ entendi": o que o app concluiu sozinho, pra conferir e corrigir.
  // Só aparece quando o tipo foi deduzido (tarefa, gasto...) ou quando ficou em dúvida. Nota comum não ganha linha.
  function entendiLine(r, e, n) {
    if (r.pergunta) {
      const outros = ['tarefa', 'gasto', 'entrada', 'treino'].filter(x => x !== r.palpite);
      term.print(`<span class="c-warn">↳ salvei como nota</span> <span class="dim">· não tive certeza ·</span> era ${esc(r.palpite || 'outra coisa')}? ` +
        `<span class="c-int">/sim</span> <span class="dim">·</span> <span class="c-int">/nao</span> <span class="dim">(é nota) · ou /tipo ${outros.map(esc).join(', ')}</span>`, 'auto');
      return;
    }
    if (['nota', 'link', 'trecho'].includes(r.tipo)) return ambiguas(r);
    if (isFinanca({ kind: r.tipo })) { fin.entendi(r, e, n); return ambiguas(r); }
    if (r.tipo === 'recorrente') return fin.entendiRecorrente(r, e);
    if (r.tipo === 'saldo') return fin.entendiSaldo(r, e);
    if (r.tipo === 'faturapaga') return fin.entendiFatura(r, e);
    const c = r.campos, A = k => (r.auto.includes(k) ? '<span class="dim">*</span>' : '');
    // por que esse projeto: "(João: 8 de 9 na weg)" · "(planilha: fixado)"
    const mp = r.motivos?.projeto;
    const porque = mp?.tipo === 'pista' ? ` <span class="dim">(${esc(mp.pista)}: ${mp.estado === 'fixado' ? 'fixado' : `${mp.peso} de ${mp.total}`})</span>` : '';
    const partes = {
      tarefa: () => [c.projeto ? `<span class="c-act">#${esc(c.projeto)}</span>${A('projeto')}${porque}` : '<span class="c-warn">sem projeto</span>', `${c.prazo ? '>' + esc(fmtDue(c.prazo)) : '>sem prazo'}${A('prazo')}`, `!${esc(c.prioridade || 'média')}${A('prioridade')}`],
      treino: () => [c.duracao_min ? c.duracao_min + 'min' : '', c.distancia_km ? c.distancia_km + 'km' : '', `${esc(fmtDia(c.data))}${A('data')}`],
    };
    const campos = (partes[r.tipo]?.() || []).filter(Boolean);
    const corrigir = r.tipo === 'tarefa' ? `/editar ${n}` : '/tipo nota';
    term.print(`<span class="c-int">↳ entendi</span> · ${esc(REGISTRO.get(r.tipo)?.rotulo || r.tipo)} · ${campos.join(' · ')}` +
      ` <span class="dim">· ${r.auto.length ? '* auto · ' : ''}${esc(r.origem)} ${Math.round(r.confianca * 100)}% · /desfazer ou ${corrigir}</span>`, 'auto');
    // a memória não chutou o projeto: mostra as pistas e como resolver
    if (r.tipo === 'tarefa' && !c.projeto && mp && ['dividida', 'conflito'].includes(mp.tipo)) {
      const det = mp.tipo === 'dividida'
        ? `${esc(mp.pista)} aparece em ${mp.porProjeto.map(([p, w]) => `<span class="c-act">#${esc(p)}</span> ${w}`).join(' · ')}`
        : mp.pistas.map(x => `${esc(x.pista)} → <span class="c-act">#${esc(x.projeto)}</span>`).join(' · ');
      const sug = mp.tipo === 'dividida' ? mp.porProjeto[0]?.[0] : mp.pistas[0]?.projeto;
      term.print(`<span class="c-warn">↳ projeto?</span> ${det} <span class="dim">· não chutei ·</span> <span class="c-int">/editar ${esc(n)} #${esc(sug || 'projeto')}</span>`, 'auto');
    }
    ambiguas(r);
  }
  // "joão" com dois cadastros e sem como decidir: avisa (o texto fica salvo, só não liga a ninguém)
  function ambiguas(r) {
    if (!r.pessoasAmbiguas?.length) return;
    const nomes = id => S.records.find(e => e.id === id)?.text || '?';
    term.print(`<span class="c-warn">↳ qual?</span> ${r.pessoasAmbiguas.map(a => `${esc(a.trecho)}: ${a.ids.map(nomes).map(esc).join(' ou ')}`).join(' · ')} <span class="dim">· escreva o nome completo ou use um apelido</span>`, 'auto');
  }

  // Acervo: guardar link e texto (mesma fila, nuvem e desfazer de tudo)
  async function addLink(line, t) {
    const r = previa(String(line).trim(), ictx());
    if (r?.tipo !== 'link') throw new CmdError('E_LINK', 'acervo', 'link inválido', 'só http:// e https://');
    await salvar(r, t);
  }
  async function addSnippet(text, t) {
    const r = previa('"' + String(text).trim().replace(/^["“”]/, ''), ictx());
    if (r?.tipo !== 'trecho') throw usage('guardar', 'texto curto pra guardar');
    await salvar(r, t);
  }

  const defs = [
    {
      name: 'palavras', alias: ['palavra', 'keywords'], data: true, async: true, exec: true, args: '[projeto] [+palavra] [-palavra]',
      desc: 'palavras-chave que puxam a tarefa pro projeto · ex: /palavras tcc +orientador +banca · /palavras tcc -banca',
      // (atalho do /memoria: "+palavra" fixa a palavra no projeto, "-palavra" solta)
      async run(arg, signal, t) {
        const [first, ...rest] = String(arg).trim().split(/\s+/).filter(Boolean);
        const reg = ctx.reg();
        const fixadas = p => mem().todas('projeto').filter(i => i.chave.startsWith('palavra:') && i.estado === 'fixado' && i.dominante === p).map(i => i.rotulo);
        const show = p => `<span class="k c-act">#${esc(p)}</span><span>${fixadas(p).map(esc).join(', ') || '<span class="dim">nenhuma</span>'}</span>`;
        if (!first) {
          term.print(`── palavras-chave ${'─'.repeat(10)}`, 'sep');
          reg.projects.forEach(p => term.print(show(p), 'tbl'));
          return term.print('<span class="dim">/palavras tcc +orientador ensina · a tarefa que tiver a palavra vai pro projeto · /memoria mostra o que o app aprendeu sozinho</span>');
        }
        const name = projName(first);
        if (!name || !reg.projects.includes(name)) throw new CmdError('E_404', 'task', `projeto #${first} não existe`, 'veja os projetos com <span class="c-int">/projeto</span> · cria com <span class="c-int">/projeto novo nome</span>');
        if (!rest.length) return term.print(show(name), 'tbl');
        const criadas = [];
        // "+banca de defesa" vale como uma expressão só: junta as palavras até o próximo + ou -
        const itens = rest.join(' ').split(/\s+(?=[+-])/).map(s => s.trim()).filter(Boolean);
        for (const it of itens) {
          const tira = it.startsWith('-'), w = it.replace(/^[+-]/, '').replace(/^#/, '').trim();
          if (!w) continue;
          const atual = mem().info(chavePalavra(w));
          if (tira && !(atual.estado === 'fixado' && atual.dominante === name)) continue;
          if (!tira && atual.estado === 'fixado' && atual.dominante === name) continue;
          criadas.push(await gravarMemoria(chavePalavra(w), tira ? 'desafixar' : 'fixar', name, w));
        }
        if (!criadas.length) return term.say('nada mudou.');
        S.undo.push({ label: 'palavras-chave', items: [], created: criadas.map(e => e.id) });
        term.ok('task', `palavras de <span class="c-act">#${esc(name)}</span> · ${fixadas(name).map(esc).join(', ') || 'nenhuma'} <span class="c-meta">· /desfazer volta · ${t.id}</span>`);
        ctx.ui.pulse('act');
      },
    },
    {
      name: 'memoria', alias: ['memória', 'pistas', 'associar'], data: true, async: true, exec: true,
      args: '[pista] [= projeto | categoria | forma] [-valor | solta | limpar]',
      desc: 'o que o app aprendeu (pessoa/palavra → projeto, categoria, forma) · ex: /memoria · /memoria João · /memoria planilha = weg · /memoria ifood = alimentação',
      async run(arg, signal, t) {
        const raw = String(arg).trim();
        const reg = ctx.reg();
        const m = mem();
        const cats = categoriasDe(S.records || []);
        // campo e valor pelo que foi escrito depois do "=": projeto, categoria (gasto ou entrada) ou forma
        const campoDe = v => {
          if (reg.projects.includes(v.toLowerCase())) return { campo: 'projeto', valor: v.toLowerCase() };
          for (const tipo of ['gasto', 'entrada']) { const c = acharCategoria(v, cats[tipo]); if (c) return { campo: campoCategoria(tipo), valor: c }; }
          const f = acharForma(v);
          if (f) return { campo: 'forma', valor: f };
          const k = cartoesDe(S.records || []).find(x => x.nome === v.toLowerCase()); // Fase 3b: /memoria ifood = nubank
          return k ? { campo: 'cartao', valor: k.id } : null;
        };
        const NOME = { projeto: 'projeto', 'categoria:gasto': 'categoria', 'categoria:entrada': 'categoria de entrada', forma: 'forma', cartao: 'cartão', tipo: 'verbo' };
        const val = (campo, v) => (campo === 'projeto' ? '#' + v : campo === 'forma' ? FORMA_ROTULO[v] || v : campo === 'cartao' ? (S.records || []).find(e => e.id === v)?.text || '?' : v);
        const pct = i => (i.total ? Math.round(((i.peso || 0) / i.total) * 100) : 0);
        const linha = (i, mostraCampo = false) => {
          const V = v => esc(val(i.campo, v));
          const por = i.porProjeto.map(([p, w]) => `<span class="c-act">${V(p)}</span> ${w}`).join(' · ') || '<span class="dim">sem aparições</span>';
          const est = { fixado: `<span class="c-int">fixada em ${V(i.dominante)}</span>`, dominante: `<span class="c-act">→ ${V(i.dominante)}</span> <span class="dim">${pct(i)}%</span>`,
            dividida: '<span class="c-warn">dividida (não vota)</span>', pouca: '<span class="dim">pouca evidência</span>', nada: '<span class="dim">nada ainda</span>' }[i.estado];
          const k = mostraCampo ? esc(NOME[i.campo] || i.campo) : esc(i.rotulo);
          return `<span class="k">${k}</span><span>${est}${i.campo === 'tipo' ? '' : ' · ' + por}${i.bloqueados.length ? ` · <span class="dim">bloqueada em ${i.bloqueados.map(V).join(', ')}</span>` : ''}</span>`;
        };
        if (!raw) {
          const todas = m.todas().filter(i => i.estado !== 'nada' && i.estado !== 'pouca');
          if (!todas.length) return term.say('ainda não aprendi nada · conforme você cria e corrige tarefas e lançamentos, eu vou ligando pessoas e palavras a projetos, categorias e formas.');
          term.print(`── memória · o que eu aprendi ${'─'.repeat(8)}`, 'sep');
          const dom = (filtro, n = 12) => todas.filter(i => i.estado === 'dominante' && filtro(i)).sort((a, b) => b.peso - a.peso).slice(0, n);
          const grupos = [
            ['fixadas por você', todas.filter(i => i.estado === 'fixado' && i.campo !== 'tipo')],
            ['pessoas', todas.filter(i => i.campo === 'projeto' && i.chave.startsWith('pessoa:') && i.estado !== 'fixado')],
            ['palavras que puxam projeto', dom(i => i.campo === 'projeto' && i.chave.startsWith('palavra:'))],
            ['categorias', dom(i => i.campo.startsWith('categoria:'))],
            ['formas', dom(i => i.campo === 'forma', 8)],
            ['cartões', dom(i => i.campo === 'cartao', 8)],
            ['verbos que você ensinou', todas.filter(i => i.campo === 'tipo' && i.estado === 'fixado')],
          ].filter(([, l]) => l.length);
          for (const [titulo, l] of grupos) { term.print(titulo, 'tgrp'); l.forEach(i => term.print(linha(i), 'tbl')); }
          return term.print('<span class="dim">/memoria planilha = weg · ifood = alimentação · ifood = crédito fixa · -valor bloqueia · solta · limpar esquece · só vota quem tem ≥70%</span>');
        }
        // "<pista> = valor" · "<pista> -valor" · "<pista> solta" · "<pista> limpar"
        let pista = raw, acao = null, alvo = null;
        let mm;
        if ((mm = raw.match(/^(.+?)\s*=\s*#?(\S+)$/))) { pista = mm[1]; acao = 'fixar'; alvo = mm[2]; }
        else if ((mm = raw.match(/^(.+?)\s+-#?(\S+)$/))) { pista = mm[1]; acao = 'bloquear'; alvo = mm[2]; }
        else if ((mm = raw.match(/^(.+?)\s+(solta|soltar|desafixar)$/i))) { pista = mm[1]; acao = 'desafixar'; }
        else if ((mm = raw.match(/^(.+?)\s+(limpar|esquecer|zerar)$/i))) { pista = mm[1]; acao = 'limpar'; }
        const cv = alvo ? campoDe(alvo) : null;
        if (alvo && !cv) throw new CmdError('E_404', 'memoria', `não conheço "${alvo}"`, `projeto (${reg.projects.map(p => '#' + esc(p)).join(' ')}), categoria (${cats.gasto.map(esc).join(', ')}) ou forma (pix, crédito, débito, dinheiro, boleto)`);
        const p = acharPessoa(pista, pessoasDe(S.records || []));
        if (p.ambiguo) throw new CmdError('E_AMBIGUO', 'pessoa', `"${pista}" bate com ${p.ambiguo.map(x => x.nome).join(', ')}`, 'use o nome completo');
        const chave = p.pessoa ? 'pessoa:' + p.pessoa.id : chavePalavra(pista);
        const verbo = 'verbo:' + chavePalavra(pista).slice(8);
        // o que a memória sabe dessa pista em cada campo (o verbo ensinado também)
        const campos = ['projeto', campoCategoria('gasto'), campoCategoria('entrada'), 'forma', 'cartao'];
        const sabe = mm2 => [...campos.map(c => mm2.info(chave, c)), mm2.info(verbo, 'tipo')].filter(i => i.estado !== 'nada' || i.bloqueados.length);
        if (!acao) {
          term.print(`── memória · ${esc(pista)} ${'─'.repeat(8)}`, 'sep');
          const l = sabe(m);
          if (!l.length) return term.print(`<span class="k">${esc(pista)}</span><span class="dim">nada ainda</span>`, 'tbl');
          return l.forEach(i => term.print(linha(i, true), 'tbl'));
        }
        const rot = p.pessoa ? p.pessoa.nome : pista;
        // fixar/bloquear valem pro campo do valor · soltar/limpar valem pra tudo que a pista tem
        const alvos = cv ? [{ chave, campo: cv.campo }] : sabe(m).map(i => ({ chave: i.chave, campo: i.campo }));
        if (!alvos.length) return term.say(`não sei nada de ${esc(pista)} ainda.`);
        const criadas = [];
        for (const a of alvos) {
          criadas.push(await (a.campo === 'projeto'
            ? gravarMemoria(a.chave, acao, cv?.valor, rot)
            : gravarMemoria(a.chave, acao, null, rot, { campo: a.campo, valor: cv?.valor })));
        }
        S.undo.push({ label: 'memória', items: [], created: criadas.map(e => e.id) });
        S.lastLatency = t.elapsed();
        const depois = mem();
        term.ok('memoria', `${{ fixar: 'fixado', bloquear: 'bloqueado', desafixar: 'solto', limpar: 'esquecido' }[acao]} · ${alvos.map(a => linha(depois.info(a.chave, a.campo), true)).join(' · ')} <span class="c-meta">· ${esc(rot)} · /desfazer volta · ${t.id}</span>`);
        ctx.ui.pulse('act');
      },
    },
    {
      name: 'sim', alias: ['s', 'yes'], data: true, async: true, exec: true, desc: 'responde sim à última pergunta do app (é uma pessoa? era tarefa?)',
      async run(arg, signal, t) { await responder(true, t); },
    },
    {
      name: 'nao', alias: ['não', 'n', 'no'], data: true, async: true, exec: true, desc: 'responde não à última pergunta do app (não é pessoa / é nota mesmo)',
      async run(arg, signal, t) { await responder(false, t); },
    },
    {
      name: 'tipo', alias: ['era', 'corrigir'], data: true, async: true, exec: true, args: '<tarefa|nota|gasto|entrada|transferência|treino|link|texto> [#3 | t2 | a1]',
      desc: 'corrige o que o app entendeu · sem alvo, vale pra última coisa que você escreveu · ex: /tipo tarefa · /tipo nota t4',
      async run(arg, signal, t) {
        const [rawTipo, alvo] = String(arg).trim().toLowerCase().split(/\s+/);
        const ALIAS = { texto: 'trecho', textos: 'trecho', tarefas: 'tarefa', notas: 'nota', gastos: 'gasto', entradas: 'entrada', treinos: 'treino', 'transferência': 'transferencia', transferir: 'transferencia' };
        const tipo = ALIAS[rawTipo] || rawTipo;
        if (!tipo || !REGISTRO.get(tipo)) throw usage('tipo', `${REGISTRO.ids().map(x => (x === 'trecho' ? 'texto' : x)).join('|')} [#3 | t2]`);
        // qual entrada: a última escrita, ou a do número (#3 nota, a2 acervo, t1 tarefa)
        let e = null, frase = null;
        if (!alvo) {
          e = S.entries.find(x => x.id === S.ultima?.id) || null;
          frase = S.ultima?.texto;
          if (!e) throw new CmdError('E_ARG', 'store', 'não sei qual corrigir', 'diga o número: <span class="c-int">/tipo tarefa #3</span> (nota) · <span class="c-int">t2</span> (tarefa) · <span class="c-int">a1</span> (acervo)');
        } else if (/^t\d+$/.test(alvo)) {
          e = taskPool()[+alvo.slice(1) - 1];
          if (!e || e.missing) throw new CmdError('E_404', 'task', `tarefa ${alvo} não existe`, 'os números aparecem no <span class="c-hud">/tarefas</span>');
        } else {
          const label = /^\d+$/.test(alvo) ? '#' + alvo : alvo;
          const id = [...nums()].find(([, v]) => v === label)?.[0];
          e = id && S.entries.find(x => x.id === id);
          if (!e) throw new CmdError('E_404', 'store', `${alvo} não existe`, 'os números aparecem no <span class="c-hud">/inbox</span> (#3) e no <span class="c-hud">/acervo</span> (a1)');
        }
        if (e.kind === tipo) return term.say(`já é ${esc(REGISTRO.get(tipo).rotulo)}.`);
        // relê a frase original com o tipo forçado
        const texto = frase || e.data?.frase || e.text;
        const r = tipo === 'tarefa' ? previa(texto.replace(/^-\s+/, ''), ictx({ forcar: 'tarefa' })) : previa(texto, ictx({ forcar: tipo }));
        if (!r || r.tipo !== tipo || r.erro) {
          const dica = { gasto: 'precisa de um valor, ex: <span class="c-int">gastei 30 no almoço</span>', entrada: 'precisa de um valor, ex: <span class="c-int">recebi 1.500 de salário</span>',
            link: 'precisa começar com http:// ou https://', trecho: 'use <span class="c-int">/guardar texto</span>' }[tipo] || 'escreva de novo de outro jeito';
          throw new CmdError('E_TIPO', 'store', `não consegui ler "${texto}" como ${REGISTRO.get(tipo).rotulo}`, dica + ' · <span class="c-hud">/desfazer</span> apaga o que foi salvo');
        }
        // troca: apaga a versão antiga e grava a nova · /desfazer volta as duas coisas de uma vez
        await ctx.store.remove(e.id);
        const { e: novo, n } = await salvar(r, t);
        S.undo.pop(); // o salvar empilhou só a criação; o passo certo inclui a antiga
        S.undo.push({ label: `virou ${REGISTRO.get(tipo).rotulo}`, items: [e], created: [novo.id] });
        S.ultima = { id: novo.id, texto };
        // perguntas que falavam da versão antiga passam a falar da nova; a do tipo já foi respondida
        S.perguntas = (S.perguntas || []).filter(q => !(q.tipo === 'tipo' && q.id === e.id)).map(q => (q.id === e.id ? { ...q, id: novo.id } : q));
        aprender({ texto, era: e.kind, corrigido: tipo });
        entendiLine({ ...r, pergunta: false }, novo, n);
        if (isFinanca(novo)) fin.perguntar(r, novo, n);
      },
    },
    {
      name: 'contexto', alias: ['ctx'], data: true, args: '[dias]',
      desc: 'o resumo do seu estado que a IA vai ler (Fase 6) · ex: /contexto · /contexto 14',
      run(arg) {
        const d = Math.min(60, Math.max(1, parseInt(arg, 10) || 7));
        const texto = montarContexto(S.entries, S.records || [], { reg: ctx.reg(), dias: d, pessoas: pessoasDe(S.records || []) });
        term.print(`── contexto · ${d} dias · ${texto.length} caracteres · ≈ ${estimarTokens(texto)} tokens ${'─'.repeat(4)}`, 'sep');
        texto.split('\n').forEach(l => term.print(`<span class="${l.startsWith('  ') ? '' : 'c-int'}">${esc(l).replace(/^ +/, m => '&nbsp;'.repeat(m.length))}</span>`));
        term.print('<span class="dim">é isto (e só isto) que o Coach vai ler · curto de propósito pra gastar pouco</span>');
      },
    },
    {
      name: 'aprendizado', alias: ['aprender'], data: true, args: '[exportar]',
      desc: 'frases que o app não entendeu e as que você corrigiu com /tipo · exportar = formato da régua de testes',
      run(arg) {
        const res = resumoAprendizado(S.records || []);
        if (!res.total && !res.naoPessoas.length) return term.say('nada ainda · quando o app ficar em dúvida ou você usar /tipo, a frase aparece aqui.');
        if (/^export/i.test(String(arg).trim())) {
          term.print(`── aprendizado · cole em tests/frases.js ${'─'.repeat(6)}`, 'sep');
          exportarFrases(res).forEach(l => term.print(`<span class="${l.trimStart().startsWith('//') ? 'dim' : ''}">${esc(l)}</span>`));
          return term.print('<span class="dim">corrigidas viram teste · as comentadas (//) precisam do tipo certo antes</span>');
        }
        term.print(`── aprendizado · ${res.total} frases · ${res.corrigidas.length} corrigidas · ${res.semResposta.length} sem resposta ${'─'.repeat(4)}`, 'sep');
        const linha = (i, extra) => term.print(`<span class="c-meta">${ddmm(new Date(i.ts))}</span> ${hl(i.texto)} ${extra}${i.vezes > 1 ? ` <span class="dim">· ${i.vezes}x</span>` : ''}`);
        if (res.corrigidas.length) {
          term.print('corrigidas', 'tgrp');
          res.corrigidas.slice(0, 15).forEach(i => linha(i, `<span class="dim">${esc(i.era || '?')} →</span> <span class="c-act">${esc(i.corrigido)}</span>`));
        }
        if (res.semResposta.length) {
          term.print('sem resposta', 'tgrp');
          res.semResposta.slice(0, 15).forEach(i => linha(i, `<span class="dim">palpite: ${esc(i.palpite || '—')}</span>`));
        }
        if (res.naoPessoas.length) term.print(`<span class="dim">não são pessoa (/nao):</span> ${res.naoPessoas.map(esc).join(', ')}`);
        term.print('<span class="dim">/aprendizado exportar gera as linhas pra régua de testes</span>');
      },
    },
  ];
  return { defs, salvar, capturar, tagsNovas, mostrarPergunta, responder, aprender, rotuloCaptura, entendiLine, ambiguas, addLink, addSnippet };
}
