// Tipos de corpo e hábitos (Fase 2: só o treino, dado bruto · a Fase 4 traz saúde, hábitos e o padrão semanal).
//
//   treino { kind: 'treino', text, tags, ts, day, data: { descricao, duracao_min, distancia_km, data: 'AAAA-MM-DD' } }
//
// Reconhece: verbo de treino no passado → 0.9 ("treinei peito 1h", "corri 5km", "joguei futebol")
//            só a palavra "treino"/"academia" → 0.6 (fraco: pergunta)

import { REGISTRO } from './tipos.js';
import { tagsOf, dayKey } from './util.js';
import { findDate } from './dates.js';

const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ESPORTE = 'bola|futebol|futsal|volei|basquete|tenis|padel|beach|handebol';
const FORTE = new RegExp(String.raw`(?<![a-z])(?:treinei|malhei|corri|pedalei|nadei|caminhei|remei|lutei|alonguei|joguei\s+(?:\S+\s+)?(?:${ESPORTE})|fiz\s+(?:\S+\s+)?(?:treino|academia|musculacao|cardio|perna|pernas|peito|costas|braco|bracos|ombro|ombros|abdomen|abdominal|yoga|pilates|crossfit|funcional|alongamento))(?![a-z])`);
const FRACO = /(?<![a-z])(?:treino|academia|musculacao|crossfit|pilates|yoga)(?![a-z])/;

// "1h", "1h30", "1 hora e meia", "45 min", "meia hora", "uma hora" → minutos · null se não tem
export function lerDuracao(texto) {
  const s = fold(String(texto));
  let m = s.match(/(?<![\d,.])(?<!(?:as|ate)\s)(\d{1,2})\s*h(?:oras?|rs?|s)?\s*(?:e\s*)?(\d{1,2})?\s*(?:min(?:utos?)?)?(?![a-z\d])/);
  if (m) return +m[1] * 60 + (m[2] ? +m[2] : 0) + (/hora\s+e\s+meia/.test(s) ? 30 : 0);
  m = s.match(/(?<![\d,.])(\d{1,3})\s*(?:min|mins|minutos?)(?![a-z])/);
  if (m) return +m[1];
  if (/(?<![a-z])uma\s+hora\s+e\s+meia(?![a-z])/.test(s)) return 90;
  if (/(?<![a-z])meia\s+hora(?![a-z])/.test(s)) return 30;
  if (/(?<![a-z])uma\s+hora(?![a-z])/.test(s)) return 60;
  return null;
}

// "5km", "5,5 km", "10 quilômetros" → número · null se não tem
export function lerDistancia(texto) {
  const m = fold(String(texto)).match(/(?<![\d,.])(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:km|kms|quilometros?)(?![a-z])/);
  return m ? Number(m[1].replace(',', '.')) : null;
}

export function registrarTiposCorpo(r = REGISTRO) {
  r.registrar({
    id: 'treino', rotulo: 'treino',
    campos: {
      descricao: { tipo: 'texto', obrigatorio: true }, duracao_min: { tipo: 'numero' }, distancia_km: { tipo: 'numero' },
      data: { tipo: 'data' }, tags: { tipo: 'lista' },
    },
    rastrear: ['descricao', 'duracao_min', 'distancia_km', 'data'],
    exemplos: ['treinei peito 1h', 'corri 5km em 30 min'],
    reconhecer(texto, ctx) {
      const now = ctx?.now || new Date();
      const s = fold(String(texto));
      const confianca = ctx?.forcar === 'treino' ? 1 : FORTE.test(s) ? 0.9 : FRACO.test(s) ? 0.6 : 0;
      if (!confianca) return null;
      const d = findDate(texto, now);
      const campos = { descricao: (d ? d.resto : String(texto).trim()) || String(texto).trim(), data: d ? d.data : dayKey(now), tags: tagsOf(texto) };
      const dur = lerDuracao(texto), dist = lerDistancia(texto);
      if (dur !== null) campos.duracao_min = dur;
      if (dist !== null) campos.distancia_km = dist;
      return { confianca, campos, auto: d ? [] : ['data'] };
    },
    montar: (i, ctx) => {
      const now = ctx?.now || new Date();
      const c = i.campos;
      return {
        kind: 'treino', text: i.texto, tags: c.tags || tagsOf(i.texto), ts: now.getTime(), day: dayKey(now),
        data: { descricao: c.descricao, duracao_min: c.duracao_min ?? null, distancia_km: c.distancia_km ?? null, data: c.data || dayKey(now) },
      };
    },
  });
  return r;
}

registrarTiposCorpo(REGISTRO);
