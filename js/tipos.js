// Registro de tipos + contrato do intérprete. Funções puras, testadas em tests/.
//
// CONTRATO: todo intérprete (regras hoje, IA depois) devolve SEMPRE este formato:
//   { tipo: 'tarefa',                       // um tipo registrado
//     campos: { texto, prazo, ... },        // os campos declarados pelo tipo
//     confianca: 0.9,                       // 0 a 1
//     origem: 'regra' | 'ia',
//     auto: ['projeto', 'prazo'],           // campos que o app decidiu sozinho (linha "↳ entendi")
//     provedor: 'regras', texto: '<o que foi digitado>',
//     pergunta?: true,                      // não reconheceu: salvou como nota e quer saber o que é
//     palpite?: 'tarefa',                   // junto com a pergunta: o que as regras acharam, sem certeza
//     erro?: { codigo, token } }            // ex: prazo inválido num marcador >xyz
// validarInterpretacao confere tudo isso. Resposta da IA só vale depois de passar aqui.
//
// REGISTRO: cada fase cadastra os seus tipos (registrarTipo) e o resto do app passa a enxergá-los:
//   { id: 'gasto', rotulo: 'gasto', kind: 'gasto',
//     campos: { valor: { tipo: 'centavos', obrigatorio: true }, descricao: { tipo: 'texto' }, data: { tipo: 'data' } },
//     reconhecer(texto, ctx) → { confianca, campos, auto? } | null,   // usado pelo provedor de regras
//     montar(interp, ctx) → entrada pra gravar,
//     rastrear: ['valor', ...],             // campos com histórico de mudanças
//     exemplos: ['gastei 30 no almoço'] }   // vão pro pedido da IA e pra régua de testes

import { safeUrl } from './acervo.js';

export const ORIGENS = ['regra', 'ia'];
const TIPOS_DE_CAMPO = ['texto', 'data', 'centavos', 'numero', 'lista', 'enum', 'url', 'booleano'];
const ID = /^[a-z][a-z0-9_]*$/;

export function criarRegistro() {
  const tipos = new Map();
  return {
    registrar(def) {
      if (!def || !ID.test(def.id || '')) throw new Error(`tipo sem id válido: ${def?.id}`);
      if (tipos.has(def.id)) throw new Error(`tipo já registrado: ${def.id}`);
      for (const [nome, c] of Object.entries(def.campos || {})) {
        if (!TIPOS_DE_CAMPO.includes(c?.tipo)) throw new Error(`campo ${def.id}.${nome} com tipo desconhecido: ${c?.tipo}`);
        if (c.tipo === 'enum' && !Array.isArray(c.valores)) throw new Error(`campo ${def.id}.${nome} (enum) sem valores`);
      }
      tipos.set(def.id, { rotulo: def.id, kind: def.id, campos: {}, rastrear: [], exemplos: [], ...def });
      return tipos.get(def.id);
    },
    get: id => tipos.get(id) || null,
    lista: () => [...tipos.values()],
    ids: () => [...tipos.keys()],
    // o que a IA precisa saber dos tipos, curto (cada caractere custa)
    schema: () => [...tipos.values()].map(t => ({
      tipo: t.id,
      campos: Object.fromEntries(Object.entries(t.campos).map(([k, c]) => [k, c.tipo === 'enum' ? c.valores : c.tipo + (c.obrigatorio ? '!' : '')])),
      ...(t.exemplos.length ? { exemplos: t.exemplos.slice(0, 3) } : {}),
    })),
    // campos rastreados por kind (alimenta o histórico de mudanças)
    rastrear: () => Object.fromEntries([...tipos.values()].filter(t => t.rastrear.length).map(t => [t.kind, t.rastrear])),
  };
}

// o registro do app (os tipos base entram em js/tipos-base.js)
export const REGISTRO = criarRegistro();
export const registrarTipo = def => REGISTRO.registrar(def);

const isDay = v => /^\d{4}-\d{2}-\d{2}$/.test(v) && (() => {
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
})();

// um valor bate com o tipo do campo? (null/undefined = vazio, decidido fora)
function campoOk(c, v) {
  switch (c.tipo) {
    case 'texto': return typeof v === 'string' && v.length <= 10000;
    case 'data': return typeof v === 'string' && isDay(v);
    case 'centavos': return Number.isInteger(v) && v >= 0 && v <= 1e12;
    case 'numero': return typeof v === 'number' && Number.isFinite(v);
    case 'lista': return Array.isArray(v) && v.every(x => typeof x === 'string');
    case 'enum': return c.valores.includes(v);
    case 'url': return typeof v === 'string' && !!safeUrl(v);
    case 'booleano': return typeof v === 'boolean';
    default: return false;
  }
}

// Confere o contrato. Devolve { ok: true, valor } (normalizado: campos que o tipo não declara saem)
// ou { ok: false, erro: 'motivo em português' }.
export function validarInterpretacao(obj, registro = REGISTRO) {
  const no = erro => ({ ok: false, erro });
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return no('resposta não é um objeto');
  const t = registro.get(obj.tipo);
  if (!t) return no(`tipo desconhecido: ${obj.tipo}`);
  if (!ORIGENS.includes(obj.origem)) return no(`origem inválida: ${obj.origem}`);
  if (typeof obj.confianca !== 'number' || !(obj.confianca >= 0 && obj.confianca <= 1)) return no('confiança fora de 0 a 1');
  if (typeof obj.texto !== 'string') return no('sem o texto original');
  const entrada = obj.campos && typeof obj.campos === 'object' && !Array.isArray(obj.campos) ? obj.campos : null;
  if (!entrada) return no('sem campos');
  const campos = {};
  for (const [nome, c] of Object.entries(t.campos)) {
    const v = entrada[nome];
    if (v === null || v === undefined || v === '') {
      if (c.obrigatorio) return no(`falta o campo ${nome}`);
      continue;
    }
    if (!campoOk(c, v)) return no(`campo ${nome} inválido: ${JSON.stringify(v)}`);
    campos[nome] = v;
  }
  const auto = Array.isArray(obj.auto) ? obj.auto.filter(k => k in t.campos) : [];
  const valor = { tipo: t.id, campos, confianca: obj.confianca, origem: obj.origem, auto, texto: obj.texto, provedor: String(obj.provedor || obj.origem) };
  if (obj.pergunta === true) valor.pergunta = true;
  if (obj.palpite && registro.get(obj.palpite)) valor.palpite = obj.palpite;
  if (obj.erro && typeof obj.erro === 'object') valor.erro = { codigo: String(obj.erro.codigo || ''), token: String(obj.erro.token || '') };
  return { ok: true, valor };
}
