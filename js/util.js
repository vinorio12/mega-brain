// Pequenas ferramentas usadas em todo o app.

export const VERSION = '0.10.0';

export const DOW = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export const pad = (n, w = 2) => String(n).padStart(w, '0');

// Escapa texto do usuário antes de colocar no HTML (evita quebrar a tela ou injetar código).
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const hhmmss = d => `${hhmm(d)}:${pad(d.getSeconds())}`;
export const ddmm = d => `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;

export function dur(ms) {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

const TAG = /#([\p{L}\p{N}_-]+)/gu;
export const tagsOf = text => [...new Set([...text.matchAll(TAG)].map(m => m[1].toLowerCase()))];
// Texto com as #tags destacadas.
export const hl = text => esc(text).replace(TAG, '<span class="c-act">#$1</span>');

export const motionOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// Espera que pode ser cancelada com ctrl+c.
export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, motionOK() ? ms : 0);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('cancelado', 'AbortError')); }, { once: true });
  });
}

// Erro com código, origem e dica do que fazer. É assim que o terminal mostra falhas.
export class CmdError extends Error {
  constructor(code, src, message, hint) {
    super(message);
    this.code = code;
    this.src = src;
    this.hint = hint; // HTML
  }
}

// Distância entre duas palavras (quantas letras mudar). Usado pra sugerir comandos.
export function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

export function kb(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}
