# Fase 1 · Tarefas e projetos (rascunho)

Roadmap: *tabs Hoje, TCC, WEG, Pessoal, prazos, concluir.*
Este documento é uma **proposta** pra sessão da Fase 1 começar rápido. Nada aqui foi aplicado no banco.

## Perguntas pro Vini (responder antes de começar)

1. **Projetos:** fixos (TCC, WEG, Pessoal) ou qualquer `#tag` vira projeto?
   *Sugestão: qualquer tag serve. TCC, WEG e Pessoal ganham atalho de aba.*
2. **Criar tarefa:** `/t revisar cap 2 #tcc >sex` ou começar a linha com `- ` (`- revisar cap 2 #tcc >sex`)?
   *Sugestão: os dois. O `- ` é mais rápido no celular.*
3. **Abas como "pastas"** no prompt (`vini@core:~/tcc ›`): dentro de uma aba, o que você escreve já ganha `#tcc`.
   Curte a ideia?
4. **Tarefa concluída:** some na hora, ou fica riscada até o fim do dia?
   *Sugestão: fica riscada até o fim do dia. Dá sensação de progresso.*

## Proposta técnica

### Dados: reaproveitar a tabela `entries`

Uma tarefa é uma entrada com `kind: 'tarefa'` e os detalhes num campo `data` (JSON):

```js
{ id, text: 'revisar cap 2 #tcc', tags: ['tcc'], kind: 'tarefa', ts, day,
  data: { prazo: '2026-10-02', feito: null } }   // feito = horário (epoch ms) quando concluir
```

**Por que reaproveitar a mesma tabela:**
- O login, a fila offline, o tempo real e o cache já funcionam pra `entries`. **Zero código novo de sincronização.**
- Fase 2 (IA): o intérprete só precisa devolver `{ kind, data }`.
- Fases 3 e 4: gasto (`kind: 'gasto'`, `data: { valor, categoria }`) e treino seguem o mesmo padrão.
- Fase 5 (dashboards): tudo numa linha do tempo, filtrada por `kind`.

### Migração do banco (rodar no SQL Editor quando a fase começar)

Salvar como `supabase/002_data.sql`:

```sql
alter table public.entries add column if not exists data jsonb not null default '{}'::jsonb;
alter table public.entries add column if not exists updated_at timestamptz not null default now();
create index if not exists entries_user_kind on public.entries (user_id, kind);
```

As regras de segurança (RLS) já cobrem as colunas novas. Não precisa mexer nelas.

### Código: o que muda

| Arquivo | Mudança |
|---|---|
| `js/cloud.js` | `COLS` e `clean()` passam a incluir `data` (o resto não muda) |
| `js/store.js` | nada (já guarda o objeto inteiro) |
| `js/dates.js` | **já pronto e testado**: `parseDue('sex')` → `'2026-10-02'`, `fmtDue()` → `'sex 02.10'`, `'atrasada 2d'` |
| `js/commands.js` | comandos novos (abaixo). `pickTargets()` já serve pro `/feito 1 3` e pro `/feito 1-4` |
| `js/ui.js` | telemetria ganha "tarefas" (abertas, hoje, atrasadas). O `pendentes` do núcleo deixa de ser `NA` |
| `tests/run.js` | testes dos comandos novos |

### Comandos propostos

| Comando | Faz |
|---|---|
| `/t texto #proj >prazo` (ou linha começando com `- `) | cria tarefa. `>` marca o prazo: `>hoje`, `>amanhã`, `>sex`, `>15/10`, `>+3` |
| `/tarefas [proj]` (`/ts`) | abertas, agrupadas: **atrasadas · hoje · próximas · sem prazo** |
| `/feito n [n...]` | conclui (aceita `1 3`, `1-4` e texto, igual ao `/apagar`) |
| `/reabrir n` | desfaz a conclusão |
| `/adiar n >prazo` | muda o prazo |
| `/ir tcc` · `/ir ~` (ou `alt+1..4`) | entra numa aba/pasta. `~` volta pra inbox |

A numeração do `/feito` segue a **última lista de tarefas mostrada**, como os números do `/inbox`.

### Ordem sugerida de trabalho (pequenos passos testáveis)

1. Migração 002 + `data` no `cloud.js` + testes do Supabase falso
2. `/t` e `- ` criando tarefa, com `parseDue`
3. `/tarefas` com os grupos e o `fmtDue`
4. `/feito`, `/reabrir`, `/adiar`
5. Abas (`/ir`, prompt `~/tcc`, captura com a tag automática)
6. Telemetria e núcleo com números reais de tarefas
7. CLAUDE.md atualizado e testes passando
