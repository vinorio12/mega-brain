# Fase 2 · Intérprete (regras agora, IA encaixável depois)

> Status: **aprovado pelo Vini em 01/10/2026**, em execução. Uma etapa por vez; no fim de cada uma: testes verdes (`/tests/`),
> teste no navegador, `sw.js` (SHELL + CACHE), commit em português e `CLAUDE.md` atualizado.
> Quem for executar: leia o `CLAUDE.md` inteiro antes e explique ao Vini o que vai fazer antes de fazer.

## Contexto

Hoje o `app.js` decide o que cada linha é com regex soltas: `http…` vira link, aspas viram trecho, `- ` vira tarefa, o resto vira nota. O `readIntent` (state.js) repete essa lógica pra prévia. Não há como "descobrir" o tipo sozinho, e a IA não teria onde se encaixar.

Objetivo: **tudo que o Vini escreve passa por uma função única `interpretar(texto)`**, que devolve sempre o mesmo formato. Regras decidem primeiro; a IA (Haiku 4.5, desligada) entra só quando as regras têm pouca confiança. Junto, deixamos os **dados prontos pra Fase 6** (histórico de mudanças + `montarContexto`).

## O que a Fase 1 deixou (e vamos reaproveitar)

| Peça | Onde | Papel na Fase 2 |
|---|---|---|
| `parseTaskInput`, `fillByRules`, `guessProject`, `dueFor` | `js/tasks.js` | viram o reconhecedor do tipo `tarefa` (continuam puras) |
| `parseDue` (hoje, sex, 15/10, +3) | `js/dates.js` | base do novo leitor de datas em frases |
| `registry()` (projetos/status), registros `kind: projeto/status`, `isRecord` | `tasks.js`, `app.js` | projeto ganha `data.palavras`; novos registros (`evento`, `interpretacao`) entram como `isRecord` |
| `parseLink`, `parseSnippet` | `js/acervo.js` | viram os tipos `link` e `trecho` (confiança 1.0) |
| `S.undo` (`items`/`created`) | `commands.js` | continua o `/desfazer` de tudo |
| `autoLine` "↳ auto (regra)" | `commands.js` | evolui pra linha "↳ entendi" |
| `readIntent` | `state.js` | passa a chamar o motor de regras (prévia = realidade) |
| Banco `entries` com `kind` + `data` jsonb, RLS, fila offline | `cloud.js`, `supabase/` | **sem migração**: tipos e registros novos são só `kind` novos |

(O "cloud.md" é o `CLAUDE.md`; li ele e o `js/cloud.js`. Nenhum arquivo tem esse nome.)

## Desenho

### 1. Contrato fixo (`js/interpretar.js`)
```js
Interpretacao = {
  tipo: 'tarefa' | 'nota' | 'gasto' | 'entrada' | 'treino' | 'link' | 'trecho' | (tipos futuros),
  campos: { ... },            // depende do tipo (schema no registro de tipos)
  confianca: 0..1,            // do tipo escolhido
  origem: 'regra' | 'ia',
  auto: ['projeto','prazo'],  // campos que o app decidiu sozinho (alimenta a linha ↳)
  provedor: 'regras' | 'ia-haiku',
  texto: '<original>',
  pergunta?: true,            // não reconheceu: salvou como nota e quer saber o que é
  erro?: { codigo, token }    // ex: prazo inválido (mantém os E_PRAZO/E_PRIO da fase 1)
}
```
`validarInterpretacao(obj)` confere contra o registro de tipos. **Resposta da IA é sempre validada** antes de valer; inválida = ignorada.

### 2. Registro de tipos (`js/tipos.js` + `js/tipos-base.js`)
`registrarTipo({ id, rotulo, kind, campos, reconhecer(texto, ctx), montar(interp, ctx) → entrada, rastrear: [...], resumo?(entries, ctx) })`. Cada fase futura chama `registrarTipo` no seu arquivo e pronto: o motor de regras, o schema da IA, o histórico e o `montarContexto` passam a enxergar o tipo.
- Agora com lógica completa: `nota`, `tarefa` (usa tasks.js), `link`, `trecho` (usam acervo.js, confiança 1.0: comportamento idêntico ao de hoje).
- Agora só **dado bruto**: `gasto` (`valor` em centavos, `descricao`, `data`), `entrada` (idem), `treino` (`descricao`, `duracao_min?`, `data`). Gravados com esse `kind`; sem telas ainda (Fases 3 e 4).

### 3. Provedores trocáveis
- `provedor-regras.js`: roda `reconhecer` de cada tipo, escolhe o de maior confiança. **Síncrono** (serve também pra prévia a cada tecla).
- `provedor-ia.js`: **criado e desligado**. Recebe um `invoke(payload)` injetável (padrão: `sb.functions.invoke('interpretar')`, função do servidor que fica no backlog). Config em `js/config.js`: `INTERPRETADOR = { limiar: 0.7, ia: { ligada: false, modelo: 'claude-haiku-4-5-20251001', timeoutMs: 4000 } }`. Pedido = `{ texto, hoje, tipos (do registro), projetos + palavras, status }`; resposta validada. Ganchos `guard` (limite diário) e `cache` ficam como no-op, pra travas de custo entrarem sem refazer nada.
- Ordem em `interpretar(texto, opts)`: regras → se `confianca >= limiar`, vale. Senão, **IA ligada** → chama (timeout 4s; erro/lenta/inválida/offline cai nas regras). **IA desligada** → salva como `nota` com `pergunta: true`.
- Salvar **nunca falha** por causa do interpretador.

### 4. Confirmação e correção
Linha curta após salvar: `↳ entendi · tarefa · #tcc · >sex · !média · auto (regra, 90%) · /desfazer ou /editar t4`. Para `pergunta`: `↳ salvei como nota · não reconheci o tipo · era tarefa, gasto, entrada, treino? /tipo tarefa`. **Não bloqueia**: a próxima linha digitada segue normal. Novo `/tipo <tipo> [alvo]` reclassifica (reinterpreta forçando o tipo, com `/desfazer`). Escape pra nota pura sem pergunta: começar com `nota:`.

### 5. Regras novas
- **Datas em frases** (`findDate` em `dates.js`): amanhã, depois de amanhã, sexta / sexta-feira, próxima sexta, semana que vem (segunda), mês que vem, dia 15, dia 15 de outubro, 15/10, daqui a 3 dias/semanas, em 2 semanas, fim de semana, ontem/anteontem (gasto e treino). Devolve `{ data, trecho }` pra remover a frase do texto da tarefa.
- **Valores** (`js/valores.js`, `parseValor`): `30`, `30 reais`, `R$30,00`, `R$30,50`, `R$ 1.234,56`, `30,5`; resultado em **centavos inteiros** (sem float). Número solto só vira valor com palavra de contexto (gastei, paguei, recebi…); com `R$`/`reais` vale sozinho.
- **Palavras-chave por projeto**: ficam em `data.palavras` do registro do projeto (sincroniza, entra no `/desfazer`). Comando `/palavras <projeto> [+palavra] [-palavra]`. `guessProject` passa a somar: nome (+5), palavra-chave (+4), histórico (+1). Regras da fase 1 (projeto/status/prazo automáticos) passam a rodar dentro do reconhecedor de `tarefa`.
- Tarefa a partir de texto livre: marcadores (`#proj @st >prazo !prio`) 0.9 · "preciso / tenho que / lembrar de" 0.8 · verbo no infinitivo no começo + data 0.8 · só o verbo 0.6 (abaixo do limiar = nota com pergunta). `- ` e `/t` = 1.0.
- **Nota normal não pergunta nada** (revisão 02/10): texto sem nenhum indício de outro tipo é `nota` com confiança 0.8. A pergunta só aparece quando há indício fraco (verbo sem data, número sem contexto, "academia" sem "treinei"…). Senão toda nota viraria pergunta.

### 6. Aprendizado
Frase que as regras não entendem (e as correções do `/tipo`) viram registro `kind: 'interpretacao'` (`isRecord`, sincroniza, sai do `/inbox`) com `{ texto, resultado, corrigido? }`. `/aprendizado` lista e conta; `/aprendizado exportar` gera o formato da régua de testes (uma correção vira teste novo fácil, e depois exemplo pra IA).

### 7. Histórico de mudanças (pra Fase 6)
Registros **append-only** `kind: 'evento'` (`isRecord`): `{ alvo: id, campo, de, para, origem: usuario|regra|ia|desfazer|importar }` + `ts`. Cobre: criada, cada troca de `status` (conclusão = status final), cada `prazo` (adiamento = prazo maior), `prioridade`, `projeto`, `texto`, apagada, restaurada. Escolhi **linhas de evento** em vez de array dentro da tarefa porque: (a) dois aparelhos editando não perdem evento, (b) `/desfazer` não apaga história (ele mesmo gera evento `origem: desfazer`), (c) apagar a tarefa não apaga o passado. Ponto único: `withHistory(store)` envolve `add/restore/remove`, calcula o diff antes/depois e grava os eventos; os campos rastreados vêm de `rastrear` no registro de tipos. Nenhum comando precisa lembrar de gravar. Tarefas antigas não ganham eventos inventados (o contexto usa `ts`/`feito_em` delas).

Ajustes da revisão (02/10):
- **Uma linha por gravação**, não por campo: `{ alvo, alvo_kind, mudancas: { status: [de, para], prazo: [de, para] }, origem }`. Menos linhas e a mudança fica junta. O `text` da linha nunca é vazio (o banco exige 1+ letra): ex. `t · status · prazo`.
- **A origem vem de quem grava**: `store.restore(entry, { origem: 'desfazer' })`; sem nada = `usuario`.
- **Só gravações feitas neste aparelho geram evento**. O que chega da nuvem/tempo real/outra aba não gera de novo (senão dois aparelhos duplicariam).
- **Tipos desconhecidos ficam escondidos**: hoje o app trata como nota tudo que não é tarefa nem acervo, então um `kind: 'evento'` apareceria no `/inbox`. Antes de gravar qualquer `kind` novo, a regra vira "só é nota o que é `nota` (ou não tem kind)"; o resto vai pra `S.records`. Isso vai pro ar junto, na mesma etapa.
- **Sobe pra etapa 3**: cada commit já vai pro ar (Pages publica a `main`), então quanto antes, mais história a Fase 6 vai ter. Os campos rastreados da tarefa ficam numa lista em `historico.js` até o registro de tipos existir (etapa 4), que depois passa a fornecer.

### 8. `montarContexto(entries, eventos, { reg, now, dias = 7, maxChars = 1500 })`
Função pura (`js/contexto.js`) que devolve texto enxuto: data; por projeto, abertas / atrasadas (com dias e nº de adiamentos) / o que andou na semana (concluídas, mudanças de status) / o que travou (sem evento há N dias, em `esperando` há tempo, adiada 2x+). Corta por prioridade até caber em `maxChars`. Cada tipo pode registrar `resumo()` pra entrar no contexto (finanças, treino). Comando de depuração `/contexto` mostra o texto e uma estimativa de tokens (chars/4). Só existe e é testada; a IA lê na Fase 6.

### 9. Régua de testes (`tests/frases.js`)
Lista `{ frase, hoje: '2026-10-01', esperado: { tipo, campos parciais, minConfianca? } }` + `rodarFrases(provedor)`. Hoje roda contra o provedor de regras (teste automático em `tests/run.js`). Mesma lista roda contra um `provedorIA` com transporte falso (prova que o encaixe funciona e que resposta inválida/lenta cai nas regras). Quando a IA for ligada de verdade, é rodar a mesma lista com `?ia=1` (manual, gasta chamadas). Frases que só a IA deve acertar ficam numa segunda lista, fora da exigência das regras.

## Etapas (cada uma: testes verdes em `/tests/`, teste no navegador, `sw.js` SHELL + CACHE, commit em português, atualiza `CLAUDE.md`)

| # | Etapa | Tam. | Pronto quando |
|---|---|---|---|
| 0 | Plano em `docs/plano-interprete.md`; `CLAUDE.md`: Fase 2 detalhada, **Fase 6 reescrita** (Coach = assistente que lê o contexto completo e sugere next steps, updates, prioridades, resumo do dia e revisão semanal), backlog "ligar provedor IA (Haiku) + travas de custo: limite diário e cache"; `PHASES` do `/roadmap` | P | só docs, commit |
| 1 | `findDate` em `dates.js` · **feito** | P | frases de data testadas (fixando `now` = 2026-10-01, quinta) |
| 2 | **feito** · `js/valores.js` (`parseValor`, `findValor`, `fmtValor`) | P | 30 / 30 reais / R$30,00 / R$30,50 / R$ 1.234,56 testados |
| 3 | **feito** · Histórico: `evento`, `diffEvent`, `withHistory`, `/mudancas`; kinds desconhecidos escondidos; ligado no `attachStore` (subiu da 8 na revisão) | M | criar/mover/adiar/concluir/desfazer/apagar geram eventos; nada some; nada novo aparece no `/inbox` |
| 4 | **feito** · `js/tipos.js` (registro) + contrato + `validarInterpretacao` | P | tipo inválido/campo faltando é recusado |
| 5 | **feito** · Régua (`tests/frases.js`) + provedor de regras com `nota`, `tarefa`, `link`, `trecho` | M | frases-base verdes; `- tarefa`, link, aspas dão o mesmo que hoje |
| 6 | **feito** · `gasto`, `entrada`, `treino` (dado bruto) + frases na régua | M | "gastei 30 no almoço" → gasto 3000 centavos; "treinei peito 1h" → treino |
| 7 | **feito** · `interpretar()` (orquestrador, limiar, fallback nota+pergunta) + `provedor-ia.js` desligado + `INTERPRETADOR` em `config.js` | M | régua passa também com IA falsa; falha/lenta/inválida/desligada → nota com pergunta, nunca perde texto |
| 8 | Palavras-chave por projeto + `/palavras`; `guessProject` usa | P | palavra do projeto decide; edição desfaz; sincroniza |
| 9a | Ligar na tela, **sem mudar comportamento**: `run()` e `readIntent` chamam o motor; `/t` e `- ` passam por ele; `isNote`/`tipoOf`/overview tratam `kind` novos | M | testes antigos todos verdes (181 hoje) + captura de nota/link/texto/tarefa idêntica |
| 9b | Texto livre vira tarefa/gasto/entrada/treino; linha "↳ entendi"; nota com pergunta; `/tipo` | M | "ligar pro dentista amanhã" vira tarefa com prazo; "bla bla" vira nota + pergunta |
| 10 | Aprendizado: registro `interpretacao`, `/aprendizado [exportar]` | P | frase desconhecida registrada; correção `/tipo` grava o par |
| 11 | `montarContexto` + `/contexto` | M | testado com tarefas/eventos fixos; cabe em `maxChars` |
| 12 | Fechamento: `/ajuda` (grupo "intérprete"), README, `docs/`, `VERSION` 0.9.0, `PHASES`, `CLAUDE.md` | P | Vini testa no celular e aprova |

## Decisões que tomei (mude se discordar)
1. **Limiar 0.7**, ajustável em `config.js`.
2. **A pergunta não bloqueia**: é uma linha + `/tipo`. Perguntar travando o prompt atrapalharia a captura rápida do celular.
3. **Eventos como linhas** (explicado em 7), não array na tarefa.
4. **Gasto/entrada/treino gravam com `kind` próprio** e não aparecem no `/inbox` (a etapa 3 já troca a regra: só é nota o que é `nota`).
5. **Edge Function `interpretar` e travas de custo ficam no backlog**, como você pediu. O cliente já nasce com o contrato e os ganchos.
6. Frase de data é **removida do texto** da tarefa ("ligar pro dentista amanhã" → texto "ligar pro dentista", prazo amanhã); o original fica no evento `criada`.
7. Datas (etapa 1): numa quinta, "próxima sexta" e "sexta que vem" = amanhã; "sexta da semana que vem" = a outra. "próxima quinta" nunca é hoje. "mês que vem" = dia 1. "segunda/quarta/quinta/sexta" sozinhas só valem com preposição, "-feira", "que vem" ou no fim da frase. Em frase livre, data com ponto (15.10) não vale (confunde com "nota 7.5"); no marcador `>15.10` vale.

## Riscos
- **Tarefa criada sem querer** por texto livre: limiar conservador, linha "entendi" sempre visível, `/desfazer`, log de aprendizado.
- **Regressão na captura de nota** (fluxo mais usado): por isso a 9a é refatoração pura, com toda a suíte antiga como rede.
- **Crescimento do cache local**: cada mudança vira uma linha de evento. Pra uso pessoal é pequeno, mas o `/condition` já mostra o tamanho; arquivar eventos velhos vai pro backlog se passar de ~2 MB.
- Prévia a cada tecla chama só o provedor de regras (síncrono); a IA nunca é chamada por tecla.

## Verificação
- `http://localhost:5173/tests/` (subir com `tools/serve.ps1`): título da aba `✓ N`, zero falhas; testes só com chaves `mb.test.*` e Supabase falso.
- Por etapa: testes novos da peça pura primeiro; depois teste manual no navegador (PC e 375px) com a lista de comandos de cada etapa, que eu passo ao Vini em português.
- Etapa 9b/10: digitar as frases da régua no terminal e conferir a linha "↳ entendi", `/desfazer`, `/tipo`, `/aprendizado`.
- Etapa 8: conferir no Supabase (MCP) que as linhas `kind='evento'` chegam e que a RLS segue só-dono.
- Final: `/boot`, `/sync`, offline (servidor desligado) ainda salva tudo e sobe a fila.
