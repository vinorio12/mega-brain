// Tudo ao redor do terminal: cabeçalho, núcleo + satélites, rail cognitivo (esquerda),
// rail de contexto (direita) e rodapé. Regra: só dados reais; sem dado → NA, mas o campo fica.

import { esc, hl, pad, dayKey, hhmm, ddmm, dur, DOW, VERSION } from './util.js';
import { createCore } from './core.js';
import { describe } from './weather.js';
import { PHASES } from './commands.js';
import { taskStats, groupTasks, projectOf, briefing, prioOf, projectsSummary, isNoteKind, doneAt } from './tasks.js';
import { viewGroups } from './views.js';
import { fmtDue, fmtDia } from './dates.js';
import { fmtValor } from './valores.js';
import { hudFinancas, fmtMes, FORMA_ROTULO, resumoMes, cartoesDe, proximasFaturas, resumoSaldos, ciclosCredito, parcelasNoMes, cartaoDoGasto, mesDe } from './financas.js';
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
    if (stage) renderStage(E, now);
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
    // "t2 sexta", "débito" (respondendo), "ajuda": a prévia mostra o comando que o Enter vai rodar
    const ic = !S.mode && ctx.store && inputValue.trim() && !inputValue.trim().startsWith('/') ? ctx.commands.interceptar(inputValue.trim()) : null;
    const icCmd = ic && ctx.commands.get(ic.cmd.slice(1).split(/\s+/)[0]);
    const intent = icCmd ? { type: 'command', cmd: icCmd, via: ic.cmd }
      : readIntent(inputValue, { mode: S.mode, ctx: S.ctx, catalog: ctx.commands.catalog(), reg: ctx.reg(), entries: S.entries, records: S.records || [], pessoas: pessoasDe(S.records || []) });
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
      html = intent.via
        ? `<div class="ctx-cmd"><b>${esc(intent.via)}</b><span>${esc(intent.cmd.desc)}</span></div><div class="ctx-hint">enter roda · "nota:" antes guarda como nota</div>`
        : `<div class="ctx-cmd"><b>/${esc(intent.cmd.name)} <span>${esc(intent.cmd.args || '')}</span></b><span>${esc(intent.cmd.desc)}</span></div><div class="ctx-hint">enter executa</div>`;
      short = intent.via ? `→ ${intent.via}` : `→ /${intent.cmd.name} · ${intent.cmd.desc}`;
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

    // finanças: os três saldos (Fase 3d) + os gastos do mês · só dado real (sem dado → NA, mas o campo fica)
    // (o saldo do mês, entradas − gastos, continua no /mes)
    const fin = hudFinancas(E, now, { cartoes: ciclosCredito(S.records || []) });
    const sd = resumoSaldos(E, S.records || [], now);
    $('x-fin-sub').textContent = fmtMes(fin.mes, now);
    const na = '<span class="dim">NA</span>';
    const tom = v => (v < 0 ? 'c-warn' : 'c-act');
    // v0.14: os dois saldos do Vini (conta e crédito, com barra) + gastos do mês; investido só se tiver · tocar abre /financas
    const rc = sd.credito;
    const corCred = rc.resta < 0 || rc.frac > 0.8 ? 'c-warn' : 'c-act';
    $('x-fin').innerHTML = [
      ['conta', sd.conta == null ? na : `<span class="${tom(sd.conta)}">${esc(fmtValor(sd.conta))}</span>`],
      ['crédito', rc.limite == null ? na : `<span class="${corCred}">${rc.resta < 0 ? 'passou ' + esc(fmtValor(-rc.resta)) : 'resta ' + esc(fmtValor(rc.resta))}</span>`],
      ...(rc.limite == null ? [] : [['', `<span class="dim">${esc(fmtValor(rc.usado))} de ${esc(fmtValor(rc.limite))}</span>`],
        ['meter', `<li class="meter${rc.resta < 0 || rc.frac > 0.8 ? ' is-warn' : ''}" title="crédito usado ${Math.round((rc.frac || 0) * 100)}%"><i style="width:${Math.min(100, Math.round((rc.frac || 0) * 100))}%"></i></li>`]]),
      ['gastos', fin.vazio ? na : `${esc(fmtValor(fin.gastos))}${fin.vs === null ? '' : ` <span class="${fin.vs > 0 ? 'c-warn' : 'c-act'}">${fin.vs > 0 ? '+' : ''}${fin.vs}%</span>`}`],
      ...(sd.investido != null ? [['investido', esc(fmtValor(sd.investido))]] : []),
    ].map(([k, v]) => (k === 'meter' ? v : `<li><span>${k}</span><b>${v}</b></li>`)).join('');

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

  /* ---------- palco: telas grandes no centro (overview, kanban) ---------- */
  // Ocupa o lugar do núcleo (e do rail esquerdo no PC); o terminal encolhe pra 3–4 linhas embaixo,
  // então dá pra fazer /feito t1 com o kanban aberto e ver o cartão mudar de coluna.
  // stage = { kind: 'overview' | 'kanban', proj, status } · null = fechado
  let stage = null, stageHtml = '', kbTab = 0;
  function openStage(kind, opts = {}) {
    // html/titulo: conteúdo pronto de quem chamou (ex: a ajuda de uma área, montada em js/comandos/sistema.js)
    stage = { kind, proj: opts.proj ?? S.ctx, status: opts.status ?? null, html: opts.html ?? null, titulo: opts.titulo ?? null };
    stageHtml = '';
    // a numeração t1, t2... da tela vale pros próximos comandos (/feito t1) e não muda enquanto ela está aberta
    if (kind === 'overview') S.taskList = briefing(S.entries, { reg: ctx.reg(), proj: stage.proj, limit: 8 }).items.map(e => e.id);
    if (kind === 'kanban') S.taskList = viewGroups(S.entries, 'kanban', { reg: ctx.reg(), proj: stage.proj, status: stage.status }).list.slice();
    core.pulse('int', 1);
    app.classList.add('stage-open');
    $('stage').hidden = false;
    renderNow();
    // o terminal encolheu: mostra as últimas linhas (a resposta do que você acabou de digitar)
    setTimeout(() => { const o = $('out'); o.scrollTop = o.scrollHeight; }, 0);
    return true;
  }
  function closeStage() {
    if (!stage) return false;
    stage = null;
    app.classList.remove('stage-open');
    $('stage').hidden = true;
    renderNow();
    return false;
  }
  // /overview liga e desliga (o kanban abre pelo /ver kanban)
  const toggleOverview = force => ((force ?? stage?.kind !== 'overview') ? openStage('overview') : closeStage());
  $('st-close').addEventListener('click', closeStage);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && stage) closeStage(); });

  function renderStage(E, now) {
    const meta = `${DOW[now.getDay()]} ${ddmm(now)} · ${hhmm(now)} · ~${stage.proj ? '/' + stage.proj : ''}`;
    $('st-title').textContent = stage.titulo || { kanban: 'KANBAN', financas: 'FINANÇAS' }[stage.kind] || 'OVERVIEW';
    $('st-meta').textContent = stage.kind === 'kanban' ? `${stage.proj ? '#' + stage.proj : 'todas'}${stage.status ? ' · @' + stage.status : ''} · ${hhmm(now)}` : meta;
    const html = stage.html ?? (stage.kind === 'kanban' ? kanbanHtml(E, now) : stage.kind === 'financas' ? financasHtml(E, now) : overviewHtml(E, now));
    // só troca o HTML quando muda: digitar não reinicia a rolagem nem a aba do kanban
    if (html !== stageHtml) { $('st-body').innerHTML = html; stageHtml = html; }
  }

  // número estável de uma tarefa na tela (as novas entram no fim)
  const numDe = id => { if (!S.taskList) S.taskList = []; let i = S.taskList.indexOf(id); if (i < 0) { S.taskList.push(id); i = S.taskList.length - 1; } return i + 1; };

  // KANBAN: uma coluna por status · no celular, abas (toque ou deslize pra trocar)
  function kanbanHtml(E, now) {
    const reg = ctx.reg();
    const { groups } = viewGroups(E, 'kanban', { reg, proj: stage.proj, status: stage.status });
    if (kbTab >= groups.length) kbTab = 0;
    const card = e => {
      const done = !!doneAt(e), proj = projectOf(e, reg.projects), pr = prioOf(e);
      const due = e.data?.prazo ? fmtDue(e.data.prazo, now) : '';
      const tone = done ? 'c-meta' : due.startsWith('atrasada') ? 'c-warn' : due === 'hoje' ? 'c-act' : 'c-meta';
      const text = proj ? e.text.replace(new RegExp(`\\s*#${proj}(?![\\p{L}\\p{N}_-])`, 'giu'), '') : e.text;
      const meta = [proj && !stage.proj ? `<span class="c-act">#${esc(proj)}</span>` : '', pr === 'alta' && !done ? '<span class="c-warn">!alta</span>' : '', due ? `<span class="${tone}">${esc(due)}</span>` : ''].filter(Boolean).join(' ');
      return `<div class="kcard${done ? ' is-done' : ''}"><span class="n">t${numDe(e.id)}</span><span class="kt" title="${esc(e.text)}">${hl(text)}</span>${meta ? `<span class="km">${meta}</span>` : ''}</div>`;
    };
    const tabs = groups.map((g, i) => `<button type="button" class="kb-tab${i === kbTab ? ' is-on' : ''}${g.final ? ' is-final' : ''}" data-tab="${i}">${esc(g.title)} <b>${g.items.length}</b></button>`).join('');
    const cols = groups.map((g, i) => `<section class="kcol${g.final ? ' is-final' : ''}${i === kbTab ? ' is-tab' : ''}"><header><span>${esc(g.title)}</span><b>${g.items.length}</b></header>` +
      `${g.items.map(card).join('') || '<div class="kempty">nada aqui</div>'}</section>`).join('');
    return `<div class="kb"><nav class="kb-tabs">${tabs}</nav><div class="kb-cols">${cols}</div>` +
      `<div class="st-foot">/feito t1 · /mover t1 fazendo · /editar t1 >sex · esc fecha</div></div>`;
  }
  // abas do kanban: toque no nome ou deslize o dedo pro lado
  const kbGo = i => { const n = document.querySelectorAll('#st-body .kb-tab').length; if (!n) return; kbTab = (i + n) % n; stageHtml = ''; renderNow(); };
  const rodar = cmd => { const i = $('cmd'); i.value = cmd; $('form').requestSubmit(); };
  $('st-body').addEventListener('click', e => {
    const b = e.target.closest('.kb-tab');
    if (b) return kbGo(+b.dataset.tab);
    const c = e.target.closest('[data-cmd]');
    if (c) { e.preventDefault(); rodar(c.dataset.cmd); }
    // botão tracejado: escreve o comando no campo pra você completar (a tela continua aberta)
    const f = e.target.closest('[data-fill]');
    if (f) { e.preventDefault(); const i = $('cmd'); i.value = f.dataset.fill; i.dispatchEvent(new Event('input', { bubbles: true })); i.focus(); }
  });
  // tocar no bloco de finanças do painel abre a tela de finanças
  document.querySelector('.ctx-fin')?.addEventListener('click', () => rodar('/financas'));
  let touchX = null;
  $('st-body').addEventListener('touchstart', e => { touchX = e.touches[0].clientX; }, { passive: true });
  $('st-body').addEventListener('touchend', e => {
    if (touchX === null || stage?.kind !== 'kanban') return;
    const dx = e.changedTouches[0].clientX - touchX; touchX = null;
    if (Math.abs(dx) > 60) kbGo(kbTab + (dx < 0 ? 1 : -1));
  }, { passive: true });

  // FINANÇAS (v0.14): conta e crédito no topo, gastos por categoria (barras), gastos dia a dia e os últimos lançamentos.
  // Só dado real; sem dado, cada bloco diz como alimentar. Uma série por gráfico (uma cor só); âmbar = atenção, sempre com texto.
  function financasHtml(E, now) {
    const recs = S.records || [], cic = ciclosCredito(recs);
    const sd = resumoSaldos(E, recs, now), rc = sd.credito;
    const fin = hudFinancas(E, now, { cartoes: cic });
    const rm = resumoMes(E, fin.mes, { cartoes: cic });
    const btn = (label, cmd) => `<button type="button" class="chip" data-cmd="${esc(cmd)}">${esc(label)}</button>`;
    const kpi = (rot, valor, sub = '', extra = '') => `<div class="fz-kpi"><span class="fz-rot">${rot}</span><b class="fz-val">${valor}</b>${sub ? `<span class="fz-sub">${sub}</span>` : ''}${extra}</div>`;
    const pct = Math.min(100, Math.round((rc.frac || 0) * 100)), alerta = rc.resta < 0 || rc.frac > 0.8;
    const kpis = [
      sd.conta == null ? kpi('conta', '<span class="dim">NA</span>', 'diga quanto tem no banco', btn('/saldo 2.500', '/saldo 2.500'))
        : kpi('conta', `<span class="${sd.conta < 0 ? 'c-warn' : 'c-act'}">${esc(fmtValor(sd.conta))}</span>`, 'hoje, pelo que você registrou'),
      rc.limite == null ? kpi('crédito', '<span class="dim">NA</span>', 'quanto você se dá por mês?', btn('/credito 1500', '/credito 1500'))
        : kpi('crédito', `<span class="${alerta ? 'c-warn' : 'c-act'}">${rc.resta < 0 ? 'passou ' + esc(fmtValor(-rc.resta)) : 'resta ' + esc(fmtValor(rc.resta))}</span>`,
          `usado ${esc(fmtValor(rc.usado))} de ${esc(fmtValor(rc.limite))}${alerta && rc.resta >= 0 ? ' · quase no limite' : ''}${rc.proxima ? ` · fatura ${esc(fmtValor(rc.proxima.total))} vence ${esc(ddmm(new Date(rc.proxima.vence + 'T12:00')))}` : ''}`,
          `<div class="fz-meter${alerta ? ' is-warn' : ''}" title="crédito usado ${pct}%"><i style="width:${pct}%"></i></div>`),
      kpi(`gastos · ${esc(fmtMes(fin.mes, now))}`, fin.vazio ? '<span class="dim">NA</span>' : esc(fmtValor(fin.gastos)),
        fin.vazio ? 'nada lançado este mês' : `à vista + fatura que vence no mês${fin.vs === null ? '' : ` · ${fin.vs > 0 ? '+' : ''}${fin.vs}% vs ${esc(fmtMes(fin.mesAnterior, now))}`}`),
      kpi('entradas', fin.entradas ? esc(fmtValor(fin.entradas)) : '<span class="dim">NA</span>', fin.entradas ? `sobra ${esc(fmtValor(fin.saldo))}` : 'escreva "caiu o salário 3.200"'),
    ].join('');

    // gastos por categoria: barras horizontais, uma cor; o valor escrito ao lado (a fatura paga não entra: não é gasto)
    const maxCat = Math.max(1, ...rm.porCategoria.map(([, v]) => v));
    const cats = rm.porCategoria.length ? rm.porCategoria.map(([c, v]) =>
      `<div class="fz-hbar" title="${esc(c)} · ${esc(fmtValor(v))} · ${Math.round((v / (rm.gastos || 1)) * 100)}% do mês"><span>${esc(c)}</span><span class="fz-track"><i style="width:${Math.max(2, Math.round((v / maxCat) * 100))}%"></i></span><b>${esc(fmtValor(v))}</b></div>`).join('')
      : '<div class="ov-empty">nada lançado este mês · escreva <span class="c-int">gastei 30 no almoço</span></div>';

    // saídas dia a dia, com a MESMA conta dos "gastos do mês" (os totais batem): à vista no dia da compra + cada fatura no dia
    // em que vence (a compra no crédito aparece no quadro do crédito) · o mês inteiro: os dias que vêm ficam apagados
    const [y, m] = fin.mes.split('-').map(Number), hoje = now.getDate(), ultimo = new Date(y, m, 0).getDate();
    const porDia = Array(ultimo).fill(0);
    for (const e of E) {
      if (e.kind !== 'gasto' || mesDe(e) !== fin.mes || !Number.isInteger(e.data?.valor) || (e.data?.forma === 'credito' && cartaoDoGasto(e, cic))) continue;
      porDia[+String(e.data?.data || e.day).slice(8, 10) - 1] += e.data.valor;
    }
    for (const pc of parcelasNoMes(E, fin.mes, cic)) porDia[+pc.vence.slice(8, 10) - 1] += pc.valor;
    const maxDia = Math.max(1, ...porDia), totalDias = porDia.reduce((t, v) => t + v, 0);
    const dias = totalDias ? `<div class="fz-days">${porDia.map((v, i) =>
      `<span class="fz-day${i + 1 === hoje ? ' is-today' : ''}${i + 1 > hoje ? ' is-future' : ''}" title="${pad(i + 1)}/${pad(m)} · ${v ? esc(fmtValor(v)) : 'nada'}${i + 1 > hoje && v ? ' (vai sair)' : ''}"><i style="height:${v ? Math.max(4, Math.round((v / maxDia) * 100)) : 0}%"></i></span>`).join('')}</div>` +
      `<div class="fz-axis"><span>1</span><span>maior dia ${esc(fmtValor(maxDia))}</span><span>${ultimo}</span></div>`
      : '<div class="ov-empty">nenhum gasto este mês ainda</div>';

    // últimos lançamentos
    const ult = E.filter(e => ['gasto', 'entrada'].includes(e.kind)).sort((a, b) => b.ts - a.ts).slice(0, 8);
    const lanc = ult.length ? ult.map(e => {
      const d = e.data || {};
      const quando = d.data ? `${d.data.slice(8, 10)}.${d.data.slice(5, 7)}` : '';
      return `<div class="fz-lanc"><span class="n">${esc(quando)}</span><span class="t">${esc(d.descricao || e.text)}<span class="dim"> · ${esc(d.categoria || 'sem categoria')}${d.forma ? ' · ' + esc(FORMA_ROTULO[d.forma] || d.forma) : ''}</span></span><b class="${e.kind === 'entrada' ? 'c-act' : ''}">${e.kind === 'entrada' ? '+' : ''}${esc(fmtValor(d.valor))}</b></div>`;
    }).join('') : '<div class="ov-empty">nenhum lançamento ainda</div>';

    return `<div class="fz"><div class="fz-kpis">${kpis}</div>` +
      `<div class="fz-grid"><section class="ov-b"><h3>gastos por categoria <span>${esc(fmtMes(fin.mes, now))}</span></h3>${cats}</section>` +
      `<section class="ov-b"><h3>saídas dia a dia <span>${esc(fmtValor(totalDias))}</span></h3>${dias}</section>` +
      `<section class="ov-b"><h3>últimos lançamentos <span>${ult.length}</span></h3>${lanc}</section></div>` +
      `<div class="st-foot">/mes em texto · /credito · /gastos · "paguei a fatura 1.680" · esc fecha</div></div>`;
  }

  // OVERVIEW: blocos que se reorganizam pela largura (5 → 3 → 2 → 1) · título até 2 linhas · dinheiro nunca corta
  function overviewHtml(E, now) {
    const reg = ctx.reg();
    const byId = new Map(E.map(e => [e.id, e]));
    const b = briefing(E, { reg, now, proj: stage.proj, limit: 8 });
    const notes = E.filter(isNoteKind), acv = E.filter(isAcervo);
    const num = new Map();
    notes.forEach((e, i) => num.set(e.id, '#' + (i + 1)));
    acv.forEach((e, i) => num.set(e.id, 'a' + (i + 1)));
    const when = ts => { const d = new Date(ts); return dayKey(d) === dayKey(now) ? hhmm(d) : ddmm(d); };
    const kv = (k, v, cls = '', extra = '') => `<div class="ov-kv"><span>${k}</span><b class="${cls}">${v}</b>${extra ? `<i>${extra}</i>` : ''}</div>`;

    // tarefas: as da numeração aberta junto com a tela (mais as novas)
    const tasks = (S.taskList || []).map(id => byId.get(id)).filter(e => e && e.kind === 'tarefa');
    const taskHtml = tasks.length ? tasks.map(e => {
      const due = e.data?.prazo ? fmtDue(e.data.prazo, now) : '';
      const done = !!doneAt(e);
      const tone = done ? 'c-meta' : due.startsWith('atrasada') ? 'c-warn' : due === 'hoje' ? 'c-act' : 'c-meta';
      const hi = prioOf(e) === 'alta' && !done ? '<span class="c-warn">!</span> ' : '';
      return `<div class="ov-row"><span class="n">t${numDe(e.id)}</span><span class="t ${done ? 'dim' : ''}" title="${esc(e.text)}">${done ? '✓ ' : ''}${hi}${hl(e.text)}</span><span class="r ${tone}">${esc(due)}</span></div>`;
    }).join('') : '<div class="ov-empty">nada atrasado nem urgente</div>';

    const noteHtml = notes.length ? notes.slice(-6).reverse().map(e =>
      `<div class="ov-row"><span class="n">${when(e.ts)}</span><span class="t" title="${esc(e.text)}">${hl(e.text)}</span><span class="r dim">${num.get(e.id)}</span></div>`).join('')
      : '<div class="ov-empty">nenhuma nota</div>';

    const acvHtml = acv.length ? acv.slice(-5).reverse().map(e => {
      const url = isLink(e) ? safeUrl(e.data?.url) : null;
      const label = url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">↗ ${esc(shortUrl(url, 40))}</a>` : `<span class="dim">»</span> ${esc(e.text)}`;
      return `<div class="ov-row"><span class="n">${num.get(e.id)}</span><span class="t">${label}</span><span class="r dim">${when(e.ts)}</span></div>`;
    }).join('') : '<div class="ov-empty">acervo vazio · cole um link pra guardar</div>';

    const { projects } = projectsSummary(E, now, reg.projects);
    const max = Math.max(1, ...projects.map(p => p.abertas));
    const projHtml = projects.map(p =>
      `<div class="ov-bar-row"><div class="top"><span class="c-act">#${esc(p.proj)}</span><b>${p.abertas}${p.atrasadas ? ` <span class="c-warn">· ${p.atrasadas} atrasada${p.atrasadas > 1 ? 's' : ''}</span>` : ''}</b></div>` +
      `<div class="ov-bar"><i class="${p.atrasadas ? 'late' : ''}" style="width:${Math.round(p.abertas / max * 100)}%"></i></div></div>`).join('') || '<div class="ov-empty">nenhum projeto</div>';

    // finanças: saldos no topo, o mês e as categorias que mais pesaram, com barra
    const cartoes = ciclosCredito(S.records || []);
    const fin = hudFinancas(E, now, { cartoes });
    const rm = resumoMes(E, fin.mes, { cartoes });
    const maxCat = Math.max(1, ...rm.porCategoria.map(([, v]) => v));
    const sdo = resumoSaldos(E, S.records || [], now);
    const finHtml = [
      sdo.conta != null ? kv('conta', esc(fmtValor(sdo.conta)), sdo.conta < 0 ? 'c-warn' : 'c-act') : '',
      sdo.investido != null ? kv('investido', esc(fmtValor(sdo.investido))) : '',
      sdo.credito.limite != null ? kv('crédito', (sdo.credito.resta < 0 ? 'passou ' + esc(fmtValor(-sdo.credito.resta)) : 'resta ' + esc(fmtValor(sdo.credito.resta))), sdo.credito.resta < 0 || sdo.credito.frac > 0.8 ? 'c-warn' : 'c-act', `${esc(fmtValor(sdo.credito.usado))} de ${esc(fmtValor(sdo.credito.limite))}`) : '',
      fin.vazio ? '<div class="ov-empty">nada lançado este mês · escreva <span class="c-int">gastei 30 no almoço</span></div>' : [
        kv('sobra do mês', esc(fmtValor(fin.saldo)), fin.saldo < 0 ? 'c-warn' : 'c-act'),
        kv('gastos', esc(fmtValor(fin.gastos)), '', fin.vs === null ? '' : `${fin.vs > 0 ? '+' : ''}${fin.vs}%`),
        ...proximasFaturas(E, cartoes, now).map(f => kv(esc(f.nome), esc(fmtValor(f.total)), '', `vence ${esc(ddmm(new Date(f.vence + 'T12:00')))}`)),
        ...rm.porCategoria.slice(0, 5).map(([c, v]) =>
          `<div class="ov-bar-row"><div class="top"><span>${esc(c)}</span><b>${esc(fmtValor(v))}</b></div><div class="ov-bar"><i style="width:${Math.round(v / maxCat * 100)}%"></i></div></div>`),
      ].join(''),
    ].join('');

    return `<div class="ov-grid">` +
      `<div class="ov-b ov-tasks"><h3>tarefas <span>${b.abertas} abertas${b.atrasadas ? ` · <span class="c-warn">${b.atrasadas} atrasadas</span>` : ''}</span></h3>${taskHtml}</div>` +
      `<div class="ov-b"><h3>finanças <span>${esc(fmtMes(fin.mes, now))}</span></h3>${finHtml}</div>` +
      `<div class="ov-b"><h3>projetos <span>${projects.length}</span></h3>${projHtml}</div>` +
      `<div class="ov-b"><h3>notas <span>${notes.length}</span></h3>${noteHtml}</div>` +
      `<div class="ov-b"><h3>acervo <span>${acv.length}</span></h3>${acvHtml}</div>` +
      `</div>`;
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

  return { render, renderNow, tick, state, mem, toggle, pulse: core.pulse, core, onInput, onKey, onFault, onCtx, noteTasks, toggleOverview, openStage, closeStage, stageOpen: () => stage?.kind || null, overviewOpen: () => !!stage };
}
