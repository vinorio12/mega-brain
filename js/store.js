// Memória: onde as entradas ficam guardadas.
//
// Por enquanto é o armazenamento do próprio navegador (localStorage).
// No passo do Supabase entra um segundo "store" com as MESMAS funções
// (connect, subscribe, add, remove, restore), então o resto do app não muda.

import { uid } from './util.js';

export const LOCAL_KEY = 'mb.entries.v1';
const KEY = LOCAL_KEY;

export function createLocalStore() {
  let entries = [];
  const subs = new Set();

  const read = () => {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; }
  };
  const write = () => {
    try { localStorage.setItem(KEY, JSON.stringify(entries)); }
    catch (e) {
      const err = new Error('o navegador recusou salvar (armazenamento cheio ou bloqueado)');
      err.code = 'E_STORE_WRITE';
      throw err;
    }
  };
  const emit = () => subs.forEach(fn => fn(entries));
  const sort = list => list.sort((a, b) => a.ts - b.ts);

  // Se o app estiver aberto em outra aba, mantém as duas iguais.
  addEventListener('storage', e => { if (e.key === KEY) { entries = sort(read()); emit(); } });

  return {
    kind: 'local',
    label: 'este navegador',

    async connect() {
      entries = sort(read());
      emit();
      return entries.length;
    },

    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    async add(doc) {
      const entry = { id: uid(), ...doc };
      const prev = entries;
      entries = sort([...entries, entry]);
      try { write(); } catch (e) { entries = prev; throw e; }
      emit();
      return entry;
    },

    async remove(id) {
      const prev = entries;
      entries = entries.filter(e => e.id !== id);
      try { write(); } catch (e) { entries = prev; throw e; }
      emit();
    },

    async restore(entry) {
      const prev = entries;
      entries = sort([...entries.filter(e => e.id !== entry.id), entry]);
      try { write(); } catch (e) { entries = prev; throw e; }
      emit();
    },

    bytes() {
      return (localStorage.getItem(KEY) || '').length * 2;
    },

    pending: () => 0,
    status: { state: 'local', realtime: 'NA', lastSync: null, lastError: null },
  };
}
