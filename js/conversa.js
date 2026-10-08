// Conversa com o terminal (v0.14): o que uma frase curta quer dizer ANTES de virar captura. Funções puras, testadas em tests/.
//
//   lerAtalhoTarefa("t2 sexta")          → { alvos: 't2', acao: 'prazo', prazo: '2026-10-09' }
//   lerAtalhoTarefa("hoje concluí t1, t2") → { alvos: 't1 t2', acao: 'feito' }
//   respostaPergunta("débito", perguntas)  → '/forma debito f3'   (só quando o app acabou de perguntar)
//   comandoSozinho("ajuda", get)          → 'ajuda'              (a frase inteira é o nome de um comando)
//
// Quem chama (js/commands.js → interceptar) transforma o resultado no comando de verdade (/feito, /adiar, /mover…).

import { parseDue, findDate } from './dates.js';
import { matchStatus } from './tasks.js';
import { acharForma, acharCategoria } from './financas.js';

const strip = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// t1 · t1-t3 · "t1, t2 e t3" · "a t1 e a t4"
const NUM = String.raw`t\d+(?:-t?\d+)?`;
const LISTA = String.raw`(?:(?:a|o)\s+)?${NUM}(?:\s*(?:,|\+|\be\b|\s)\s*(?:(?:a|o)\s+)?${NUM})*`;
const CONCLUI = new RegExp(String.raw`^(?:(?:hoje|ja|agora|enfim)\s+)*(?:eu\s+)?(?:conclui|terminei|fiz|finalizei|entreguei|acabei|feito|feita|feitas|feitos)\s+(?<lista>${LISTA})[.!]?$`);
const ALVO_E_RESTO = new RegExp(String.raw`^(?<lista>${LISTA})\s+(?<resto>.+)$`);
const FEITO = /^(?:feito|feita|feitas|feitos|ok|concluida|concluido|concluidas|pronto|pronta|done|fiz|terminei|✓)[.!]?$/;
const SEM_PRAZO = /^(?:sem prazo|sem data|tira o prazo|tirar prazo|>sem|sem)$/;
const so = lista => lista.match(new RegExp(NUM, 'g')).join(' ');

// "t2 sexta" · "t2 05.10" · "t2 sem prazo" · "t2 feito" · "t2 fazendo" · "t1 t3 feito" · "t2 #weg !alta"
// "hoje concluí t1, t2, t3" · "fiz t2" · "terminei t1 e t4"
//   → { alvos: 't1 t3', acao: 'feito' | 'prazo' | 'status' | 'editar', prazo ('AAAA-MM-DD' ou '' = sem), status, marcadores } | null
export function lerAtalhoTarefa(texto, { statuses = [], now = new Date() } = {}) {
  const t = String(texto ?? '').trim();
  const s = strip(t).replace(/\s+/g, ' ');
  let m = s.match(CONCLUI);
  if (m) return { alvos: so(m.groups.lista), acao: 'feito' };
  m = s.match(ALVO_E_RESTO);
  if (!m) return null;
  const alvos = so(m.groups.lista);
  const resto = m.groups.resto.trim();
  const restoOriginal = t.slice(t.length - resto.length).trim(); // com acento e maiúscula (pros marcadores)
  if (FEITO.test(resto)) return { alvos, acao: 'feito' };
  if (SEM_PRAZO.test(resto)) return { alvos, acao: 'prazo', prazo: '' };
  // só marcadores: "#weg !alta @fazendo >sex"
  if (restoOriginal.split(/\s+/).every(w => /^[#@>!]\S/.test(w))) return { alvos, acao: 'editar', marcadores: restoOriginal };
  const st = matchStatus(resto.replace(/^@/, ''), statuses);
  if (st) return { alvos, acao: 'status', status: st };
  const due = parseDue(resto.replace(/^>/, ''), now);
  if (due) return { alvos, acao: 'prazo', prazo: due };
  // "semana que vem", "dia 15", "15 de outubro": data que ocupa a frase toda
  const d = findDate(resto, now);
  if (d && !d.resto.trim()) return { alvos, acao: 'prazo', prazo: d.data };
  return null;
}

// Resposta sem barra a uma pergunta pendente. perguntas = a fila (S.perguntas), cada uma com { tipo, n?, lista? }:
//   forma → "débito", "no pix", "crédito" · categoria → "saúde" (das categorias do lançamento)
//   tipo / pessoa / projeto / verbo → "sim", "s", "isso", "não", "n"
// → o comando ('/forma debito f3', '/cat saúde f3', '/sim', '/nao') · null = não é resposta (lê a frase normal)
const SIM = /^(?:s|sim|isso|claro|pode|yes|y|aham|uhum|exato|bora|cria|criar)[.!]?$/;
const NAO = /^(?:n|nao|no|nope|negativo|deixa|deixa assim)[.!]?$/;
const SIM_NAO = ['tipo', 'pessoa', 'projeto', 'verbo'];
export function respostaPergunta(texto, perguntas = []) {
  const s = strip(texto).trim().replace(/\s+/g, ' ');
  if (!s || s.length > 40) return null;
  for (const q of perguntas) {
    if (q.tipo === 'forma') {
      const f = acharForma(s.replace(/^(?:no|na|de|do|da|com|via|pelo|pela)\s+/, ''));
      if (f) return `/forma ${f}${q.n ? ' ' + q.n : ''}`;
    } else if (q.tipo === 'categoria') {
      const c = acharCategoria(s, q.lista || []);
      if (c) return `/cat ${c}${q.n ? ' ' + q.n : ''}`;
    } else if (SIM_NAO.includes(q.tipo)) {
      if (SIM.test(s)) return '/sim';
      if (NAO.test(s)) return '/nao';
    }
  }
  return null;
}

// A frase inteira é o nome de um comando ("ajuda", "inbox", "mês", "desfazer")? → o nome · null
// Só comandos que funcionam sem argumento, e nunca os de conta/arquivo (sair, importar…): uma nota não pode deslogar você.
const NUNCA_SOZINHO = new Set(['sair', 'entrar', 'codigo', 'migrar', 'importar', 'exportar', 'instalar', 'boot', 'apagar', 'limpar']);
export function comandoSozinho(texto, get) {
  const w = String(texto ?? '').trim().toLowerCase();
  if (w.length < 3 || /\s/.test(w) || w.startsWith('/')) return null;
  const c = get(w);
  if (!c || NUNCA_SOZINHO.has(c.name) || String(c.args || '').startsWith('<')) return null;
  return c.name;
}
