// Tudo ao redor do terminal: cabeçalho, núcleo + satélites, rail cognitivo (esquerda),
// rail de contexto (direita) e rodapé. Regra: só dados reais; sem dado → NA, mas o campo fica.

import { esc, pad, dayKey, hhmm, ddmm, dur, DOW, VERSION } from './util.js';
import { createCore } from './core.js';
import { describe } from './weather.js';
import { PHASES } from './commands.js';
import { taskStats, groupTasks, projectOf, briefing, prioOf, projectsSummary, isNoteKind } from './tasks.js';
import { fmtDue, fmtDia } from './dates.js';
import { fmtValor } from './valores.js';
import { hudFinancas, fmtMes, FORMA_ROTULO, resumoMes, cartoesDe, proximasFaturas } from './financas.js';
import { shortUrl, isAcervo, isLink, safeUrl } from './acervo.js';
import { deriveState, describeState, readIntent, LISTEN_MS, FAULT_MS } from './state.js';
import { pessoasDe } from './pessoas.js';

const MODULES = [
  { name: 'inbox', phase: '0' },
  { name: 'tarefas', phase: '1' },
  { name: 'ia intérprete', phase: '2' },
  { name: 'pessoas e memória', phase: '2.5' },
  { name: 'finanças', phase: '3' },
  { name: 'corpo e hábitos', phase: '4' },
  { name: 'dashboards', phase: '5' },
  { name: 'coach', phase: '6' },
];
const LEVEL_TONE = { OK: 'c-act', INF: 'c-meta', WRN: 'c-warn', ERR: 'c-err', AI: 'c-int' };

export function createUI(ctx) {
  const { S } = ctx;
  const $ = s => document.getElementById(s);
  const app = $('app');

  $('h-ver').textContent = 'v' + VERSION;

  /* ---------- núcleo ---------- */
  const satEls = Object.fromEntries([...document.querySelectorAll('.sat')].map(el => [el.dataset.sat, el]));
  const core = createCore($('core'), satEls);

  /* ---------- painéis escondíveis (lembra a escolha neste aparelho) ---------- */
  const LAYOUT_KEY = 'mb.layout.v1';
  let layout = { tele: true, focus: false };
  try { layout = { ...layout, ...JSON.parse(localStorage.getItem(LAYOUT_KEY)) }; } catch {}
  const applyLayout = () => {
    app.classList.toggle('no-tele', !layout.tele);
    app.classList.toggle('focus', layout.focus);
  };
  applyLayout();

  function toggle(what) {
    if (what === 'focus') layout.focus = !layout.focus;
    else { layout.tele = !layout.tele; layout.focus = false; }
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch {}
    applyLayout();
    return what === 'focus' ? layout.focus : layout.tele;
  }
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === '.') { e.preventDefault(); toggle('tele'); }
  });

  // celular: com o teclado aberto, o app encolhe pra área visível
  const vv = window.visualViewport;
  if (vv) {
    let lastH = vv.height;
    const fit = () => {
      if (Math.abs(vv.scale - 1) > 0.01) return;
      document.documentElement.style.setProperty('--app-h', vv.height + 'px');
      window.scrollTo(0, 0);
      const out = $('out');
      if (out && vv.height < lastH - 80) out.scrollTop = out.scrollHeight;
      lastH = vv.height;
    };
    vv.addEventListener('resize', fit);
    fit();
  }

  /* ---------- sinais vindos do terminal ---------- */
  let lastKey = 0, faultUntil = 0, ctxChangedAt = 0, inputValue = '';
  let stateKey = 'initializing', stateSince = Date.now();

  function onInput(v) { inputValue = v; render(); }
  function onKey() { lastKey = Date.now(); core.keystroke(); render(); setTimeout(render, LISTEN_MS + 50); }
  function onFault() { faultUntil = Date.now() + FAULT_MS; core.pulse('err'); render(); setTimeout(render, FAULT_MS + 50); }
  function onCtx() { ctxChangedAt = Date.now(); core.pulse('int', 1); render(); setTimeout(render, 1600); }

  /* ---------- memória e estado ---------- */

  function mem() {
    const st = ctx.store;
    if (!st) return S.locked ? ['bloqueada', 'warn'] : ['NA', 'na'];
    if (st.kind === 'local') return ['local', 'warn'];
    const p = st.pending();
    if (p) return [`fila ${p}`, 'warn'];
    if (st.status.state === 'cache') return ['sincronizando', 'na'];
    return ['nuvem', 'ok'];
  }

  function isDegraded() {
    if (S.degraded) return true;
    const st = ctx.store?.status;
    if (!st || ctx.store.kind !== 'nuvem') return false;
    return (ctx.store.pending() > 0 && navigator.onLine && !!st.lastError) || ['channel_error', 'timed_out', 'erro'].includes(st.realtime);
  }

  // Uma ação muito rápida (ex: captura local, 1ms) ainda fica visível por meio segundo:
  // o núcleo precisa mostrar que fez algo, senão a ação "some" sem resposta.
  const HOLD_MS = 550;
  let recent = null;
  function noteTasks() {
    const T = [...ctx.term.tasks.values()];
    if (T.length) {
      const last = T[T.length - 1];
      recent = { kind: last.kind, label: last.label, until: Date.now() + HOLD_MS };
      setTimeout(render, HOLD_MS + 30);
    }
    render();
  }
  // a entrada pertence à aba atual? (projeto da tarefa ou #tag)
  const inCtx = e => projectOf(e, ctx.reg().projects) === S.ctx || (e.tags || []).includes(S.ctx);

  const taskList = () => {
    const T = [...ctx.term.tasks.values()];
    return T.length ? T : recent && Date.now() < recent.until ? [recent] : [];
  };

  function state() {
    return deriveState({
      booting: S.booting, now: Date.now(), faultUntil, tasks: taskList(), lastKey,
      locked: S.locked, degraded: isDegraded(), online: navigator.onLine,
    });
  }

  /* ---------- render (agrupado: no máximo uma vez por quadro) ---------- */

  let queued = false;
  function render() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; renderNow(); });
  }

  function renderNow() {
    const now = new Date(), E = S.entries, T = taskList();
    const key = state();
    if (key !== stateKey) { stateKey = key; stateSince = Date.now(); }
    const st = describeState(key, { tasks: T, mode: S.mode });
    app.dataset.state = key;
    core.setState(key);

    // tom do estado nos lugares que mostram o estado
    for (const el of [$('h-state'), document.querySelector('.ident'), document.querySelector('.cog-state'), document.querySelector('.field-strip')]) {
      if (el) el.dataset.tone = st.tone;
    }

    renderHeader(st, now);
    renderCog(st, T);
    renderSats(E, T, key);
    renderCtx(E, now);
    renderFoot();
    if (ovOpen) renderOverview(E, now);
    $('work-meta').textContent = ({ email: 'login · e-mail', password: 'login · senha', code: 'login · código' }[S.mode] || 'captura') + ' · ~' + (S.ctx ? '/' + S.ctx : '');
    $('f-state').textContent = st.label;
    $('f-desc').textContent = st.desc;
  }

  function field(id, value, tone) {
    const el = $(id);
    el.classList.remove('is-ok', 'is-warn', 'is-err', 'is-na');
    if (tone) el.classList.add('is-' + tone);
    el.querySelector('b').textContent = value;
  }

  function renderHeader(st) {
    $('h-state').querySelector('b').textContent = st.label;
    field('h-net', navigator.onLine ? 'ON' : 'OFF', navigator.onLine ? 'ok' : 'err');
    const [memText, memTone] = mem();
    field('h-mem', memText.toUpperCase(), memTone);
    field('h-user', S.user ? (S.operator || S.user.email.split('@')[0]) : (S.locked ? '—' : 'local'), S.user ? '' : 'na');
    const wx = S.weather, wxEl = $('h-wx');
    wxEl.className = 'hf' + (wx ? '' : ' is-na');
    wxEl.querySelector('.k').textContent = wx ? describe(wx.code).icon : '◌';
    wxEl.querySelector('b').textContent = wx ? `${Math.round(wx.temp)}° ${wx.hum}%` : 'NA';
    wxEl.title = wx ? `${wx.place.name} · ${describe(wx.code).text} · ${hhmm(new Date(wx.at))}` : 'clima · /clima ativa';
  }

  // esquerda: estado cognitivo e operacional
  function renderCog(st, T) {
    $('c-state').textContent = st.label;
    $('c-desc').textContent = st.desc;
    $('c-focus').textContent = '~' + (S.ctx ? '/' + S.ctx : '');
    $('c-mode').textContent = { email: 'login · e-mail', password: 'login · senha', code: 'login · código' }[S.mode] || (S.locked ? 'bloqueado' : 'captura');

    const pending = ctx.store?.pending?.() || 0;
    const real = T.filter(t => t.id); // o "eco" de meio segundo não entra na lista
    $('c-proc-n').textContent = real.length + (pending ? ` · fila ${pending}` : '');
    const rows = real.map(t => `<li><span class="${t.kind === 'exec' ? 'c-act' : 'c-int'}">${t.id}</span><span>${esc(t.label)}</span><span class="t"><span class="proc-spin">${t.kind === 'exec' ? '▸' : '◴'}</span> <span data-t0="${t.t0}">${fmtMs(performance.now() - t.t0)}</span></span></li>`);
    if (pending) rows.push(`<li><span class="c-warn">SYNC</span><span>${pending} na fila · sobe quando der</span><span></span></li>`);
    $('c-procs').innerHTML = rows.length ? rows.join('') : '<li class="empty">— ocioso</li>';

    const L = ctx.term.log;
    $('c-ev-n').textContent = L.length;
    $('c-stream').innerHTML = L.length
      ? L.slice(-12).reverse().map(e => {
        const d = new Date(e.ts);
        return `<li><span class="t">${hhmm(d)}</span><span class="lv ${LEVEL_TONE[e.level]}">${e.level}</span><span title="${esc(e.text)}">${esc(e.text)}</span></li>`;
      }).join('')
      : '<li class="empty">— nenhum</li>';

    const nowMs = Date.now(), bins = Array(30).fill(0);
    for (const e of L) { const m = Math.floor((nowMs - e.ts) / 60000); if (m < 30) bins[29 - m]++; }
    const max = Math.max(1, ...bins);
    $('c-spark').innerHTML = bins.map(n => `<i${n ? '' : ' class="z"'} style="height:${n ? Math.max(8, n / max * 100) : 3}%"></i>`).join('');
    $('c-act').textContent = bins.reduce((a, b) => a + b, 0);
  }

  // satélites: valores reais + qual subsistema está ativo agora
  function renderSats(E, T, key) {
    const proc = T.filter(t => t.kind !== 'exec'), exec = T.filter(t => t.kind === 'exec');
    const pending = ctx.store?.pending?.() || 0;
    const ctxTasks = taskStats(S.ctx ? E.filter(e => inCtx(e)) : E);
    const [memText] = mem();
    const st = ctx.store?.status;
    const intent = readIntent(inputValue, { mode: S.mode, ctx: S.ctx, catalog: ctx.commands.catalog(), reg: ctx.reg(), entries: S.entries, records: S.records || [], pessoas: pessoasDe(S.records || []) });

    set('s-context', '~' + (S.ctx ? '/' + S.ctx : ''), `${ctxTasks.abertas} abertas${ctxTasks.atrasadas ? ` · ${ctxTasks.atrasadas} atrasadas` : ''}`);
    set('s-memory', memText, `${E.length} entradas`);
    set('s-network', navigator.onLine ? 'online' : 'offline',
      [st?.realtime && st.realtime !== 'NA' ? 'rt ' + st.realtime : null, S.lastLatency != null ? S.lastLatency + 'ms' : null].filter(Boolean).join(' · ') || 'NA');
    set('s-process', T.length ? T[T.length - 1].label : 'ocioso', `${T.length} ativos${pending ? ` · fila ${pending}` : ''}`);
    set('s-input', intentWord(intent), key === 'listening' ? 'escutando' : '');

    const now = Date.now();
    const listening = key === 'listening';
    core.activate('input', listening);
    core.activate('context', now - ctxChangedAt < 1500 || (listening && !!S.ctx));
    core.activate('memory', exec.length > 0 || pending > 0);
    core.activate('network', proc.length > 0);
    core.activate('process', T.length > 0);
    for (const k of Object.keys(satEls)) {
      satEls[k].classList.toggle('is-active',
        { input: listening, context: now - ctxChangedAt < 1500, memory: exec.length > 0, network: proc.length > 0, process: T.length > 0 }[k]);
    }
  }
  function set(id, main, sub) {
    $(id).textContent = main;
    $(id + '-2').textContent = sub || '';
  }
  function intentWord(i) {
    if (i.type === 'registro') return i.tipo;
    if (i.type === 'note' && i.pergunta) return 'nota?';
    return { idle: 'aguardando', login: { email: 'usuário', password: 'senha', code: 'código' }[i.field], note: 'nota', task: 'tarefa', link: 'link', trecho: 'texto', 'task-error': 'prazo?', commands: 'comando', command: '/' + (i.cmd?.name || ''), unknown: 'desconhecido' }[i.type] || 'aguardando';
  }

  // direita: o contexto do momento. Digitando → mostra o que o Enter vai fazer. Parado → tarefas relevantes.
  function renderCtx(E, now) {
    const intent = readIntent(inputValue, { mode: S.mode, ctx: S.ctx, catalog: ctx.commands.catalog(), reg: ctx.reg(), entries: S.entries, records: S.records || [], pessoas: pessoasDe(S.records || []) });
    const body = $('x-body'), line = $('intent-line');
    let title = 'contexto', sub = '~' + (S.ctx ? '/' + S.ctx : ''), html = '', short = '';

    if (intent.type === 'login') {
      title = 'acesso';
      sub = 'memória bloqueada';
      html = `<div class="empty">${{ email: 'digite o usuário (ex: vini)', password: 'digite a senha' + (S.operator ? ' do operador ' + esc(S.operator) : '') + ' · /entrar outro troca', code: 'digite o código do e-mail' }[intent.field]}</div>`;
    } else if (intent.type === 'commands') {
      title = 'comandos';
      sub = '/' + intent.query;
      html = intent.matches.map(c => `<div class="ctx-cmd"><b>/${esc(c.name)} <span>${esc(c.args || '')}</span></b><span>${esc(c.desc)}</span></div>`).join('') +
        '<div class="ctx-hint">tab completa · enter executa</div>';
      short = `→ ${intent.matches.map(c => '/' + c.name).join(' ')}`;
    } else if (intent.type === 'command') {
      title = 'comando';
      sub = '/' + intent.cmd.name;
      html = `<div class="ctx-cmd"><b>/${esc(intent.cmd.name)} <span>${esc(intent.cmd.args || '')}</span></b><span>${esc(intent.cmd.desc)}</span></div><div class="ctx-hint">enter executa</div>`;
      short = `→ /${intent.cmd.name} · ${intent.cmd.desc}`;
    } else if (intent.type === 'unknown') {
      title = 'comando';
      sub = 'desconhecido';
      html = `<div class="c-warn">/${esc(intent.query)} não existe</div>` +
        (intent.near.length ? `<div class="ctx-hint">talvez: ${intent.near.map(c => `<span class="c-int">/${esc(c.name)}</span>`).join(' ')}</div>` : '<div class="ctx-hint">/ajuda lista todos</div>');
      short = `✕ /${intent.query} não existe`;
    } else if (intent.type === 'task') {
      title = 'nova tarefa';
      sub = 'enter cria';
      // cada campo: o valor + "auto" quando o app vai decidir sozinho
      const A = k => intent.auto.includes(k) ? ' <span class="auto-tag">auto</span>' : '';
      html = `<dl class="ctx-intent"><dt>texto</dt><dd>${esc(intent.text)}</dd>` +
        `<dt>projeto</dt><dd class="c-act">${intent.projeto ? "#" + esc(intent.projeto) + A("projeto") : '<span class="c-warn">? (as pistas não decidem: pergunto depois)</span>'}</dd>` +
        `<dt>status</dt><dd class="c-int">@${esc(intent.status)}${A('status')}</dd>` +
        `<dt>prioridade</dt><dd class="${intent.prioridade === 'alta' ? 'c-warn' : ''}">!${esc(intent.prioridade)}${A('prioridade')}</dd>` +
        `<dt>prazo</dt><dd class="c-int">${intent.prazo ? esc(fmtDue(intent.prazo, now)) : '<span class="dim">sem prazo</span>'}${A('prazo')}</dd>` +
        (intent.pessoas?.length ? `<dt>pessoas</dt><dd class="c-act">${intent.pessoas.map(esc).join(', ')}</dd>` : '') + '</dl>' +
        (intent.inferido ? `<div class="ctx-hint">entendi como tarefa (regra, ${Math.round(intent.confianca * 100)}%) · escreva "nota:" antes pra guardar como nota</div>` : '') +
        '<div class="ctx-hint">auto = o app decide · informe com #proj @status >prazo !prio</div>';
      short = `→ tarefa · ${intent.projeto ? "#" + intent.projeto : "projeto?"} · @${intent.status} · !${intent.prioridade}${intent.prazo ? ' · ' + fmtDue(intent.prazo, now) : ''}${intent.auto.length ? ' (auto: ' + intent.auto.join(', ') + ')' : ''}`;
    } else if (intent.type === 'task-error') {
      title = 'nova tarefa';
      sub = intent.error === 'prazo' ? 'prazo?' : 'vazia';
      html = intent.error === 'prazo'
        ? `<div class="c-warn">não entendi o prazo ${esc(intent.token || '')}</div><div class="ctx-hint">use >hoje >amanhã >sex >15/10 >+3</div>`
        : '<div class="empty">escreva o texto da tarefa</div>';
      short = intent.error === 'prazo' ? `✕ prazo ${intent.token} não entendido` : '';
    } else if (intent.type === 'link') {
      title = 'novo link';
      sub = 'enter guarda no acervo';
      html = `<dl class="ctx-intent"><dt>link</dt><dd class="c-int">${esc(shortUrl(intent.url))}</dd>` +
        `<dt>contexto</dt><dd>${intent.contexto ? esc(intent.contexto) : '<span class="dim">— (opcional)</span>'}</dd>` +
        `<dt>tags</dt><dd class="c-act">${intent.tags.length ? intent.tags.map(t => '#' + esc(t)).join(' ') : '<span class="dim">—</span>'}</dd></dl>`;
      short = `→ link · ${shortUrl(intent.url, 30)}`;
    } else if (intent.type === 'trecho') {
      title = 'novo texto';
      sub = 'enter guarda no acervo';
      html = `<dl class="ctx-intent"><dt>texto</dt><dd>${esc(intent.text)}</dd><dt>tags</dt><dd class="c-act">${intent.tags.length ? intent.tags.map(t => '#' + esc(t)).join(' ') : '<span class="dim">—</span>'}</dd></dl>`;
      short = '→ texto guardado no acervo';
    } else if (intent.type === 'registro') {
      // gasto, entrada, transferência (Fase 3a) · treino: só o dado bruto por enquanto
      const c = intent.campos, A = k => (intent.auto.includes(k) ? ' <span class="auto-tag">auto</span>' : '');
      const dinheiro = ['gasto', 'entrada'].includes(intent.tipo);
      title = { transferencia: 'nova transferência', entrada: 'nova entrada' }[intent.tipo] || 'novo ' + intent.tipo;
      sub = 'enter guarda';
      const rows = [
        c.valor !== undefined ? ['valor', `<span class="c-act">${esc(fmtValor(c.valor))}</span>`] : null,
        c.parcelas ? ['parcelas', `${c.parcelas}x de ${esc(fmtValor(Math.floor(c.valor / c.parcelas)))}`] : null,
        dinheiro ? ['categoria', c.categoria ? esc(c.categoria) + A('categoria') : '<span class="c-warn">vou perguntar</span>'] : null,
        dinheiro && intent.tipo === 'gasto' ? ['forma', c.forma ? esc(FORMA_ROTULO[c.forma] || c.forma) + A('forma') : '<span class="c-warn">vou perguntar</span>'] : null,
        c.lugar ? ['lugar', esc(c.lugar)] : null,
        intent.tipo === 'transferencia' ? ['conta', `${c.sentido === 'de' ? 'da' : 'pra'} ${esc(c.conta || '?')} <span class="dim">· não mexe no saldo</span>`] : null,
        c.descricao && !dinheiro ? ['descrição', esc(c.descricao)] : null,
        c.duracao_min ? ['duração', c.duracao_min + ' min'] : null,
        c.distancia_km ? ['distância', c.distancia_km + ' km'] : null,
        c.data ? ['data', esc(fmtDia(c.data, now)) + A('data')] : null,
      ].filter(Boolean);
      html = `<dl class="ctx-intent">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>` +
        `<div class="ctx-hint">entendi como ${esc(intent.tipo)} (regra, ${Math.round(intent.confianca * 100)}%) · "nota:" antes guarda como nota</div>`;
      short = `→ ${intent.tipo}${c.valor !== undefined ? ' · ' + fmtValor(c.valor) : ''}`;
    } else if (intent.type === 'note') {
      title = 'nova nota';
      sub = 'enter captura';
      html = `<dl class="ctx-intent"><dt>tags</dt><dd class="c-act">${intent.tags.length ? intent.tags.map(t => '#' + esc(t)).join(' ') : '<span class="dim">—</span>'}</dd>` +
        `<dt>destino</dt><dd>${esc(mem()[0])}</dd></dl>` +
        (intent.pergunta
          ? `<div class="ctx-hint c-warn">parece ${esc(intent.palpite || 'outra coisa')}, mas não tenho certeza · salvo como nota e pergunto</div>`
          : '<div class="ctx-hint">comece com "- " pra virar tarefa</div>');
      short = `→ nota${intent.pergunta ? ' (' + intent.palpite + '?)' : ''}${intent.tags.length ? ' · #' + intent.tags.join(' #') : ''}`;
    } else {
      // parado: o essencial (mesma regra da tela inicial): atrasadas → !alta → vencem primeiro
      const b = briefing(E, { reg: ctx.reg(), now, proj: S.ctx, limit: 7 });
      const s = taskStats(S.ctx ? E.filter(e => inCtx(e)) : E, now);
      sub = `${S.ctx ? '#' + S.ctx : 'todas'} · ${b.abertas} abertas`;
      html = b.items.map(e => {
        const due = e.data?.prazo ? fmtDue(e.data.prazo, now) : '';
        const tone = due.startsWith('atrasada') ? 'c-warn' : due === 'hoje' ? 'c-act' : 'c-meta';
        const hi = prioOf(e) === 'alta' ? '<span class="c-warn">!</span> ' : '';
        return `<div class="ctx-task"><span class="n">[ ]</span><span title="${esc(e.text)}">${hi}${esc(e.text)}</span><span class="due ${tone}">${esc(due)}</span></div>`;
      }).join('');
      if (!html) html = `<div class="empty">${b.abertas ? 'nada atrasado nem urgente' : 'nenhuma tarefa aberta' + (S.ctx ? ' aqui' : '')}</div><div class="ctx-hint">- revisar cap 2 #tcc >sex</div>`;
      else html += `<div class="ctx-hint">${b.atrasadas ? `<span class="c-warn">${b.atrasadas} atrasadas</span> · ` : ''}${s.feitasHoje ? `✓ ${s.feitasHoje} feitas hoje · ` : ''}/inicio · /tarefas</div>`;
    }

    $('x-title').textContent = title;
    $('x-sub').textContent = sub;
    body.innerHTML = html;
    line.textContent = short;
    line.classList.toggle('has-intent', !!short);

    // ambiente
    const wx = S.weather;
    const st = ctx.store?.status;
    $('x-env').innerHTML = [
      ['dia', `${DOW[now.getDay()]} ${ddmm(now)} · ${hhmm(now)}`],
      ['local', wx ? `${esc(wx.place.name)} · ${describe(wx.code).icon} ${Math.round(wx.temp)}°` : 'NA'],
      ['rede', navigator.onLine ? `online${S.lastLatency != null ? ' · ' + S.lastLatency + 'ms' : ''}` : '<span class="c-warn">offline</span>'],
      ['memória', `${esc(mem()[0])} · ${E.length}${st?.lastSync ? ' · ' + hhmm(new Date(st.lastSync)) : ''}`],
      ['hoje', `${E.filter(e => e.day === dayKey(now)).length} capturas`],
    ].map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('');

    // finanças do mês: poucas linhas, só dado real (sem lançamento → NA, mas o campo fica)
    const fin = hudFinancas(E, now, { cartoes: cartoesDe(S.records || [], { todos: true }) });
    $('x-fin-sub').textContent = fmtMes(fin.mes, now);
    const na = '<span class="dim">NA</span>';
    $('x-fin').innerHTML = [
      ['saldo', fin.vazio ? na : `<span class="${fin.saldo < 0 ? 'c-warn' : 'c-act'}">${esc(fmtValor(fin.saldo))}</span>`],
      ['gastos', fin.vazio ? na : esc(fmtValor(fin.gastos))],
      [`vs ${fmtMes(fin.mesAnterior, now)}`, fin.vs === null ? na : `<span class="${fin.vs > 0 ? 'c-warn' : 'c-act'}">${fin.vs > 0 ? '+' : ''}${fin.vs}%</span>`],
      ['pesou', fin.top.length ? fin.top.map(([c]) => esc(c)).join(' · ') : na],
    ].map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('');

    // módulos
    const phaseState = Object.fromEntries(PHASES.map(([n, , s]) => [n, s]));
    $('x-mods').innerHTML = MODULES.map(m => {
      const s = phaseState[m.phase];
      const cls = s === 'ok' ? 'is-on' : s === 'wip' ? 'is-on is-wip' : '';
      const label = s === 'ok' ? 'online' : s === 'wip' ? 'beta' : 'fase ' + m.phase;
      return `<li class="${cls}"><span>${m.name}</span><span class="st">${label}</span></li>`;
    }).join('');
  }

  // rodapé: infraestrutura
  function renderFoot() {
    const sw = 'serviceWorker' in navigator && navigator.serviceWorker.controller ? ['ativo', 'ok'] : ['NA', 'na'];
    const [memText, memTone] = mem();
    const rt = ctx.store?.status?.realtime ?? 'NA';
    const f = [
      ['ENV', location.hostname || 'arquivo', ''],
      ['MEM', memText, memTone],
      ['RT', rt, rt === 'on' ? 'ok' : rt === 'NA' ? 'na' : 'warn'],
      ['NET', navigator.onLine ? 'online' : 'offline', navigator.onLine ? 'ok' : 'err'],
      ['LAT', S.lastLatency == null ? 'NA' : S.lastLatency + 'ms', S.lastLatency == null ? 'na' : ''],
      ['SESS', dur(Date.now() - S.startedAt), '', 'f-sess'],
      ['TASK', ctx.term.tasks.size, ctx.term.tasks.size ? 'ok' : ''],
      ['LOG', ctx.term.log.length, ''],
      ['SW', sw[0], sw[1]],
      ['VER', VERSION, ''],
    ];
    $('foot').innerHTML = f.map(([k, v, tone, id]) =>
      `<span class="ff${tone ? ' is-' + tone : ''}"><i>${k}</i><b${id ? ` id="${id}"` : ''}>${esc(v)}</b></span>`).join('');
  }

  /* ---------- /overview: o geral de tudo, no lugar do núcleo ---------- */
  let ovOpen = false;
  function toggleOverview(force) {
    ovOpen = force ?? !ovOpen;
    if (ovOpen) {
      // a numeração t1, t2... do overview vale pros próximos comandos (/feito t1)
      S.taskList = briefing(S.entries, { reg: ctx.reg(), proj: S.ctx, limit: 8 }).items.map(e => e.id);
      core.pulse('int', 1);
    }
    app.classList.toggle('ov-open', ovOpen);
    $('overview').hidden = !ovOpen;
    renderNow();
    return ovOpen;
  }
  $('ov-close').addEventListener('click', () => toggleOverview(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ovOpen) toggleOverview(false); });

  function renderOverview(E, now) {
    const reg = ctx.reg();
    const byId = new Map(E.map(e => [e.id, e]));
    const b = briefing(E, { reg, now, proj: S.ctx, limit: 8 });
    const isNote = isNoteKind;
    const notes = E.filter(isNote), acv = E.filter(isAcervo);
    const num = new Map();
    notes.forEach((e, i) => num.set(e.id, '#' + (i + 1)));
    acv.forEach((e, i) => num.set(e.id, 'a' + (i + 1)));
    const when = ts => { const d = new Date(ts); return dayKey(d) === dayKey(now) ? hhmm(d) : ddmm(d); };

    $('ov-meta').textContent = `${DOW[now.getDay()]} ${ddmm(now)} · ${hhmm(now)} · ~${S.ctx ? '/' + S.ctx : ''}`;

    // tarefas: o essencial, na numeração aberta junto com o overview
    const tasks = (S.taskList || []).map(id => byId.get(id)).filter(e => e && e.kind === 'tarefa');
    const taskHtml = tasks.length ? tasks.map((e, i) => {
      const due = e.data?.prazo ? fmtDue(e.data.prazo, now) : '';
      const done = !!(e.data?.feito_em ?? e.data?.feito);
      const tone = done ? 'c-meta' : due.startsWith('atrasada') ? 'c-warn' : due === 'hoje' ? 'c-act' : 'c-meta';
      const hi = prioOf(e) === 'alta' && !done ? '<span class="c-warn">!</span> ' : '';
      return `<div class="ov-row"><span class="n">t${i + 1}</span><span class="${done ? 'dim' : ''}" title="${esc(e.text)}">${done ? '✓ ' : ''}${hi}${esc(e.text)}</span><span class="r ${tone}">${esc(due)}</span></div>`;
    }).join('') : '<div class="ov-empty">nada atrasado nem urgente</div>';

    const noteHtml = notes.length ? notes.slice(-6).reverse().map(e =>
      `<div class="ov-row"><span class="n">${when(e.ts)}</span><span title="${esc(e.text)}">${esc(e.text)}</span><span class="r dim">${num.get(e.id)}</span></div>`).join('')
      : '<div class="ov-empty">nenhuma nota</div>';

    const acvHtml = acv.length ? acv.slice(-5).reverse().map(e => {
      const url = isLink(e) ? safeUrl(e.data?.url) : null;
      const label = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">↗ ${esc(shortUrl(url, 28))}</a>` : `<span class="dim">»</span> ${esc(e.text)}`;
      return `<div class="ov-row"><span class="n">${num.get(e.id)}</span><span>${label}</span><span class="r dim">${when(e.ts)}</span></div>`;
    }).join('') : '<div class="ov-empty">acervo vazio</div>';

    const { projects } = projectsSummary(E, now, reg.projects);
    const max = Math.max(1, ...projects.map(p => p.abertas));
    const projHtml = projects.map(p =>
      `<div class="ov-proj"><div class="top"><span class="c-act">#${esc(p.proj)}</span><span>${p.abertas}${p.atrasadas ? ` <span class="c-warn">· ${p.atrasadas}!</span>` : ''}</span></div>` +
      `<div class="ov-bar"><i class="${p.atrasadas ? 'late' : ''}" style="width:${Math.round(p.abertas / max * 100)}%"></i></div></div>`).join('');

    // finanças do mês: saldo e as categorias que mais pesaram, com barra
    const fin = hudFinancas(E, now, { cartoes: cartoesDe(S.records || [], { todos: true }) });
    const rm = resumoMes(E, fin.mes, { cartoes: cartoesDe(S.records || [], { todos: true }) });
    const maxCat = Math.max(1, ...rm.porCategoria.map(([, v]) => v));
    const finHtml = fin.vazio ? '<div class="ov-empty">nada lançado este mês</div>' :
      `<div class="ov-row"><span class="n">saldo</span><span class="${fin.saldo < 0 ? 'c-warn' : 'c-act'}">${esc(fmtValor(fin.saldo))}</span><span class="r dim"></span></div>` +
      `<div class="ov-row"><span class="n">gastos</span><span>${esc(fmtValor(fin.gastos))}</span><span class="r dim">${fin.vs === null ? '' : `${fin.vs > 0 ? '+' : ''}${fin.vs}%`}</span></div>` +
      // a próxima fatura de cada cartão (Fase 3b)
      proximasFaturas(E, cartoesDe(S.records || [], { todos: true }), now).map(f =>
        `<div class="ov-row"><span class="n">${esc(f.nome)}</span><span>${esc(fmtValor(f.total))}</span><span class="r dim">vence ${esc(ddmm(new Date(f.vence + 'T12:00')))}</span></div>`).join('') +
      rm.porCategoria.slice(0, 5).map(([c, v]) =>
        `<div class="ov-proj"><div class="top"><span>${esc(c)}</span><span>${esc(fmtValor(v))}</span></div><div class="ov-bar"><i style="width:${Math.round(v / maxCat * 100)}%"></i></div></div>`).join('');

    $('ov-grid').innerHTML =
      `<div class="ov-b"><h3>tarefas <span>${b.abertas} abertas${b.atrasadas ? ` · <span class="c-warn">${b.atrasadas} atrasadas</span>` : ''}</span></h3>${taskHtml}</div>` +
      `<div class="ov-b"><h3>notas <span>${notes.length}</span></h3>${noteHtml}</div>` +
      `<div class="ov-b"><h3>acervo <span>${acv.length}</span></h3>${acvHtml}</div>` +
      `<div class="ov-b"><h3>projetos <span>${projects.length}</span></h3>${projHtml}</div>` +
      `<div class="ov-b"><h3>finanças <span>${esc(fmtMes(fin.mes, now))}</span></h3>${finHtml}</div>`;
  }

  const fmtMs = ms => ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(1) + 's';
  const ago = ms => ms < 60000 ? 'agora' : ms < 3600000 ? `há ${Math.floor(ms / 60000)} min` : `há ${Math.floor(ms / 3600000)} h`;

  /* ---------- a cada segundo ---------- */
  let lastMinute = -1;
  function tick() {
    const d = new Date();
    $('h-clock').textContent = `${hhmm(d)}:${pad(d.getSeconds())}`;
    $('h-date').textContent = `${DOW[d.getDay()]} ${ddmm(d)}`;
    $('c-since').textContent = ago(Date.now() - stateSince);
    const f = $('f-sess'); if (f) f.textContent = dur(Date.now() - S.startedAt);
    document.querySelectorAll('[data-t0]').forEach(el => { el.textContent = fmtMs(performance.now() - +el.dataset.t0); });
    core.setDay((d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400);
    if (state() !== stateKey) render();
    if (d.getMinutes() !== lastMinute) { lastMinute = d.getMinutes(); renderNow(); }
  }

  return { render, renderNow, tick, state, mem, toggle, pulse: core.pulse, core, onInput, onKey, onFault, onCtx, noteTasks, toggleOverview, overviewOpen: () => ovOpen };
}
