// Nuvem: login (Supabase Auth) + memória sincronizada (tabela public.entries).
//
// Como funciona a memória na nuvem:
//   1. abre na hora com a cópia salva neste aparelho (cache)
//   2. busca a versão do servidor e junta as duas
//   3. toda escrita entra numa FILA e é enviada; sem internet, espera e envia depois
//   4. escuta mudanças em tempo real (escreveu no PC → aparece no celular)
//
// Tem as mesmas funções da memória local (connect, subscribe, add, remove, restore, bytes),
// então o resto do app não precisa saber de onde vêm os dados.

import { uid, CmdError } from './util.js';

const CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const COLS = 'id,text,tags,kind,ts,day';

/* ---------------- login ---------------- */

function authError(e) {
  const msg = String(e?.message || e).toLowerCase();
  if (msg.includes('signups not allowed') || msg.includes('user not found'))
    return new CmdError('E_AUTH_USER', 'auth', 'este e-mail não tem acesso', 'o Mega Brain só aceita o usuário criado no painel do Supabase');
  if (msg.includes('invalid login credentials'))
    return new CmdError('E_AUTH_PASS', 'auth', 'e-mail ou senha incorretos', 'digite a senha de novo · <span class="c-hud">/codigo</span> entra por código no e-mail');
  if (msg.includes('email not confirmed'))
    return new CmdError('E_AUTH_CONFIRM', 'auth', 'usuário ainda não confirmado', 'no Supabase: Authentication → Users → confirme o usuário');
  if (msg.includes('error sending'))
    return new CmdError('E_AUTH_SMTP', 'auth', 'o servidor de e-mail (SMTP) recusou o envio',
      'confira host, porta, usuário, senha e remetente em Authentication → Emails → SMTP · detalhe em Logs → Auth');
  if (msg.includes('not authorized') || msg.includes('not allowed for this'))
    return new CmdError('E_AUTH_SMTP', 'auth', 'o e-mail padrão do Supabase não entrega pra este endereço',
      'use o e-mail da sua conta Supabase, ou ative o SMTP próprio em Authentication → Emails');
  if (msg.includes('api key') || msg.includes('apikey'))
    return new CmdError('E_CLOUD_KEY', 'auth', 'chave do Supabase inválida', 'confira a chave publishable em <span class="c-hud">js/config.js</span>');
  if (msg.includes('token') || msg.includes('otp') || msg.includes('expired'))
    return new CmdError('E_AUTH_CODE', 'auth', 'código inválido ou expirado', 'confira o código ou digite <span class="c-hud">/entrar</span> pra receber outro');
  if (msg.includes('rate limit') || e?.status === 429)
    return new CmdError('E_AUTH_RATE', 'auth', 'muitos pedidos de código em pouco tempo', 'espere alguns minutos e tente de novo');
  if (msg.includes('fetch'))
    return new CmdError('E_NET', 'auth', 'sem resposta do servidor de login', 'confira a internet');
  return new CmdError('E_AUTH', 'auth', String(e?.message || e));
}

export async function createCloud(url, key) {
  const { createClient } = await import(CDN);
  const sb = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'mb.auth.v1' },
  });

  return {
    sb,
    async session() {
      const { data } = await sb.auth.getSession();
      return data.session;
    },
    // manda o e-mail com o código (e o link). Não cria usuário novo.
    async sendCode(email) {
      const { error } = await sb.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
      });
      if (error) throw authError(error);
    },
    async signInPassword(email, password) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw authError(error);
      return data.session;
    },
    async verify(email, token) {
      const { data, error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw authError(error);
      return data.session;
    },
    async signOut() {
      await sb.auth.signOut();
    },
    onAuth(fn) {
      sb.auth.onAuthStateChange((event, session) => fn(event, session));
    },
  };
}

/* ---------------- memória sincronizada ---------------- */

export function createCloudStore(sb, user, { onSync } = {}) {
  const CACHE = 'mb.cloud.cache.v1:' + user.id;
  const OUTBOX = 'mb.cloud.outbox.v1:' + user.id;

  const read = k => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  let server = read(CACHE);   // última versão conhecida do servidor
  let outbox = read(OUTBOX);  // operações esperando envio: {op:'put', entry} | {op:'del', id}
  let entries = [];
  let flushing = null;
  let channel = null;
  const subs = new Set();

  const status = { state: 'cache', lastSync: null, lastError: null, latency: null, realtime: 'NA' };
  const setStatus = patch => { Object.assign(status, patch); onSync?.(status); };

  // o que você vê = servidor + o que ainda está na fila
  function rebuild() {
    const map = new Map(server.map(e => [e.id, e]));
    for (const op of outbox) {
      if (op.op === 'put') map.set(op.entry.id, op.entry);
      else map.delete(op.id);
    }
    entries = [...map.values()].sort((a, b) => a.ts - b.ts);
    subs.forEach(fn => fn(entries));
  }

  const clean = r => ({ id: r.id, text: r.text, tags: r.tags || [], kind: r.kind, ts: Number(r.ts), day: r.day });

  async function pull() {
    const t0 = performance.now();
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('entries').select(COLS).order('ts').range(from, from + 999);
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
    }
    server = rows.map(clean);
    write(CACHE, server);
    rebuild();
    setStatus({ latency: Math.round(performance.now() - t0), lastSync: Date.now() });
    return server.length;
  }

  // envia a fila, na ordem. Se falhar (ex: sem rede), para e tenta de novo depois.
  function flush() {
    if (flushing) return flushing;
    flushing = (async () => {
      while (outbox.length && navigator.onLine) {
        const op = outbox[0];
        const t0 = performance.now();
        const { error } = op.op === 'put'
          ? await sb.from('entries').upsert(op.entry)
          : await sb.from('entries').delete().eq('id', op.id);
        if (error) {
          setStatus({ state: 'pending', lastError: error.message || 'falha ao enviar' });
          return false;
        }
        outbox.shift();
        write(OUTBOX, outbox);
        if (op.op === 'put') server = [...server.filter(e => e.id !== op.entry.id), op.entry];
        else server = server.filter(e => e.id !== op.id);
        write(CACHE, server);
        setStatus({ latency: Math.round(performance.now() - t0), lastSync: Date.now(), lastError: null });
      }
      setStatus({ state: outbox.length ? 'pending' : 'sync' });
      return !outbox.length;
    })().finally(() => { flushing = null; });
    return flushing;
  }

  async function queue(op) {
    outbox.push(op);
    write(OUTBOX, outbox);
    rebuild();
    await flush();
    // se um envio anterior estava terminando, ele pode não ter visto esta operação: envia de novo
    if (outbox.includes(op)) await flush();
  }

  async function listen() {
    // O canal de tempo real precisa da sua credencial ANTES de conectar.
    // Sem ela, a trava "só o dono" (RLS) faz o banco não mandar nada: o canal fica ligado, mas mudo.
    const { data } = await sb.auth.getSession();
    if (data.session) await sb.realtime.setAuth(data.session.access_token);
    channel = sb.channel('entries:' + user.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, p => {
        if (p.eventType === 'DELETE') server = server.filter(e => e.id !== p.old.id);
        else server = [...server.filter(e => e.id !== p.new.id), clean(p.new)];
        write(CACHE, server);
        rebuild();
      })
      .subscribe((s, err) => setStatus({
        realtime: s === 'SUBSCRIBED' ? 'on' : s === 'CLOSED' ? 'off' : s.toLowerCase(),
        ...(err ? { lastError: 'tempo real: ' + err.message } : {}),
      }));
  }

  // ao voltar a rede ou reabrir o app: envia a fila e confere o servidor
  let alive = true; // vira false no /sair
  const resync = () => { if (alive && navigator.onLine) flush().then(() => pull()).catch(e => setStatus({ state: 'pending', lastError: e.message })); };
  addEventListener('online', resync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resync(); });

  // outra aba do app neste mesmo aparelho salvou algo: atualiza na hora, sem depender da internet
  addEventListener('storage', e => { if (alive && e.key === CACHE) { server = read(CACHE); rebuild(); } });

  // rede de segurança: se o tempo real cair, confere o servidor a cada 60s (só com o app visível)
  setInterval(() => { if (!document.hidden) resync(); }, 60000);

  return {
    kind: 'nuvem',
    label: 'supabase',
    status,

    // abre na hora com o cache; a sincronização acontece em seguida (sync())
    async connect() {
      rebuild();
      listen().catch(e => setStatus({ realtime: 'erro', lastError: 'tempo real: ' + e.message }));
      return entries.length;
    },

    async sync() {
      await flush();
      const n = await pull();
      setStatus({ state: outbox.length ? 'pending' : 'sync' });
      return n;
    },

    subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },

    async add(doc) {
      const entry = { id: uid(), ...doc };
      await queue({ op: 'put', entry });
      return entry;
    },
    async remove(id) { await queue({ op: 'del', id }); },
    async restore(entry) { await queue({ op: 'put', entry }); },

    pending: () => outbox.length,
    bytes: () => ((localStorage.getItem(CACHE) || '').length + (localStorage.getItem(OUTBOX) || '').length) * 2,

    // apaga a cópia deste aparelho (não mexe no servidor). Usado no /sair.
    forget() {
      alive = false;
      if (channel) sb.removeChannel(channel);
      localStorage.removeItem(CACHE);
      localStorage.removeItem(OUTBOX);
    },
  };
}
