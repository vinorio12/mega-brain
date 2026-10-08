// Linguagem de comandos do MB Core (índice).
// Não executa nada do sistema operacional: cada comando é uma função de js/comandos/.
//
// Onde está cada coisa (uma área por arquivo):
//   js/comandos/tela.js        desenhos que todas usam: notas #3, acervo a2, linha de tarefa t1, tabela, busca
//   js/comandos/interprete.js  texto livre (capturar → salvar → "↳ entendi"), perguntas (/sim /nao), /tipo, /memoria,
//                              /palavras, /aprendizado, /contexto
//   js/comandos/tarefas.js     /t, "- ", /tarefas, /ver, /inicio, /overview, /feito, /editar, /mover, /adiar, /projeto…
//   js/comandos/pessoas.js     /pessoas, /pessoa
//   js/comandos/notas.js       /inbox, /hoje, /acervo, /guardar, /buscar
//   js/comandos/dados.js       /apagar, /desfazer, /exportar, /importar (+ pickTargets e prepareImport, puras)
//   js/comandos/sistema.js     /ajuda, /condition, /clima, conta (/entrar /sair /sync…), /boot, /painel… (+ PHASES)
//   js/comandos/financas.js    tudo de dinheiro (/mes, /gastos, /cat, /forma, /fatura, /cartao, /saldo…)
//
// Como as áreas conversam: cada uma é criarX(kit) e devolve { defs, ...funções }. O `kit` é um objeto só,
// compartilhado: o estado (S), o terminal, o ctx do app, os ajudantes daqui (usage, ictx, mem…) e as funções
// que cada área devolve (kit.taskLine, kit.salvar…). Uma área usa a função de outra por um apelido que lê o kit
// na hora do uso, então a ordem em que as áreas nascem não importa.
//
// Pra criar um comando novo: um objeto no `defs` da área certa (e o nome no ORDEM abaixo):
//   name   nome usado depois da barra       alias  outros nomes aceitos
//   args   como usar (aparece no /ajuda)    desc   o que faz
//   data   true se mexe nas notas            async  true se demora (ganha ID de tarefa, ctrl+c cancela)
//   exec   true se grava (estado EXECUTING) run    a função

import { esc, lev, dayKey, CmdError } from './util.js';
import { pessoasDe } from './pessoas.js';
import { memoriaDe } from './memoria.js';
import { criarTela } from './comandos/tela.js';
import { criarInterprete } from './comandos/interprete.js';
import { criarTarefas } from './comandos/tarefas.js';
import { criarPessoas } from './comandos/pessoas.js';
import { criarNotas } from './comandos/notas.js';
import { criarDados } from './comandos/dados.js';
import { criarSistema } from './comandos/sistema.js';
import { criarFinancas } from './comandos/financas.js';

export { PHASES } from './comandos/sistema.js';
export { pickTargets, prepareImport } from './comandos/dados.js';

// A ordem dos comandos no /ajuda, no Tab e no painel (os de finanças vêm depois, na ordem de js/comandos/financas.js)
const ORDEM = ['ajuda', 'inbox', 'hoje', 'overview', 'inicio', 't', 'tarefas', 'ver', 'feito', 'reabrir', 'adiar', 'editar', 'mover', 'status',
  'feitas', 'mudancas', 'palavras', 'memoria', 'sim', 'nao', 'pessoas', 'pessoa', 'tipo', 'contexto', 'aprendizado', 'projeto', 'ir',
  'buscar', 'acervo', 'guardar', 'apagar', 'desfazer', 'condition', 'clima', 'log', 'historico', 'exportar', 'entrar', 'codigo', 'sair',
  'sync', 'migrar', 'instalar', 'importar', 'boot', 'roadmap', 'painel', 'foco', 'limpar'];

export function createCommands(ctx) {
  const { S, term } = ctx;
  const kit = { S, term, ctx };

  /* ---------- ajudantes que todas as áreas usam ---------- */
  kit.usage = (name, args) => new CmdError('E_ARG', 'shell', 'argumento faltando ou inválido', `uso: <span class="c-hud">/${name} ${esc(args)}</span>`);
  // palavras que você disse que não são pessoa (/nao): ficam no aprendizado
  kit.ignorados = () => (S.records || []).filter(e => e.kind === 'interpretacao' && e.data?.naoPessoa).map(e => e.data.naoPessoa);
  // o que o intérprete precisa saber: projetos e status, entradas (histórico de projetos), aba atual
  kit.ictx = (extra = {}) => ({ reg: ctx.reg(), entries: S.entries, records: S.records || [], aba: S.ctx, now: new Date(), pessoas: pessoasDe(S.records || []), ignorarPessoas: kit.ignorados(), ...extra });
  // a memória do momento (pessoas/palavras → projeto); recalcula só quando os dados mudam
  kit.mem = () => memoriaDe(S.entries, S.records || [], { reg: ctx.reg(), pessoas: pessoasDe(S.records || []) });
  // decisão sua sobre uma pista (/memoria, /palavras): registro que só cresce, o mais novo vale
  // (campo projeto: o valor fica em data.projeto, como na 2.5 · outros campos: { campo: 'categoria:gasto', valor: 'alimentação' })
  kit.gravarMemoria = (chave, acao, projeto, rotulo, outro = null) => ctx.store.add({
    kind: 'memoria', text: String(rotulo || chave), tags: [], ts: Date.now(), day: dayKey(new Date()),
    data: outro ? { chave, acao, campo: outro.campo, valor: outro.valor ?? null } : { chave, acao, projeto: projeto || null },
  });

  /* ---------- as áreas ---------- */
  // cada uma devolve { defs, ...funções }; as funções entram no kit (os defs não: eles são juntados abaixo)
  const juntar = criar => { const { defs, ...fns } = criar(kit); Object.assign(kit, fns); return defs; };
  const porArea = [juntar(criarTela)];
  // finanças: números f1…, linha "↳ entendi" de dinheiro, perguntas, /cat, /forma (nasce antes: as outras usam kit.fin)
  kit.fin = criarFinancas({ S, term, ctx, usage: kit.usage, mem: kit.mem, ictx: kit.ictx, table: (...a) => kit.table(...a) });
  porArea.push(...[criarInterprete, criarTarefas, criarPessoas, criarNotas, criarDados, criarSistema].map(juntar));

  const todos = porArea.flat();
  const defs = ORDEM.map(name => {
    const c = todos.find(x => x.name === name);
    if (!c) throw new Error(`comando /${name} está no ORDEM mas nenhuma área criou`);
    return c;
  });
  const sobra = todos.filter(c => !defs.includes(c));
  if (sobra.length) throw new Error(`faltou no ORDEM: ${sobra.map(c => '/' + c.name).join(' ')}`);
  defs.push(...kit.fin.defs);
  kit.defs = () => defs;

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
  kit.get = get;
  kit.notFound = notFound;

  return {
    get,
    notFound,
    addTask: kit.addTask,
    capturar: kit.capturar,
    rotuloCaptura: kit.rotuloCaptura,
    salvar: kit.salvar,
    // recorrentes (Fase 3c): o app.js chama depois da leitura completa e na virada do dia
    lancarRecorrentes: o => kit.fin.lancarRecorrentes(o),
    addLink: kit.addLink,
    addSnippet: kit.addSnippet,
    // lista leve dos comandos (nome, atalhos, uso, descrição) pro painel de contexto
    catalog: () => defs.map(c => ({ name: c.name, alias: c.alias || [], args: c.args || '', desc: c.desc })),
    names: () => defs.map(c => c.name),
  };
}
