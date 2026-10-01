# Plano · Tarefas v2, visões, inteligência e acervo

> Status: **aprovado em 01/10/2026, em execução nesta mesma sessão.** A Etapa 5 (IA) foi pro backlog (sem cartão no momento).
> Para quem for executar (Sonnet ou outra sessão): leia o `CLAUDE.md` inteiro antes, siga o "Manual de manutenção"
> e faça **uma etapa por vez**. No fim de cada etapa: testes verdes (`/tests/`), teste no navegador (mobile primeiro),
> commit em português, atualizar `CLAUDE.md` (roadmap + estrutura). Explique ao Vini o que vai fazer antes de fazer.

## Ponto de partida (o que já existe)

- Tudo fica na tabela `entries` (Supabase), com `kind` e um campo `data` (jsonb) para detalhes. A sincronização, a fila offline, o tempo real e o cache já funcionam para qualquer `kind`. **Não precisa de tabela nova.**
- Tarefa hoje: `kind: 'tarefa'`, `data: { prazo, feito }`. Projeto = qualquer `#tag`.
- Já prontos: `js/tasks.js` (agrupar, histórico, números t1/t2), `js/dates.js` (`parseDue`: hoje, amanhã, sex, 15/10, +3), `pickTargets` (1 3 / 1-4 / texto), `/desfazer` genérico (guarda versões anteriores), `readIntent` (prévia do Enter no painel da direita).
- Comandos de tarefa atuais: `/t`, `- texto`, `/tarefas`, `/feito`, `/reabrir`, `/adiar`, `/feitas`, `/projetos`, `/ir`.
- **Conflito de nome:** `/status` já existe (é o estado do sistema). Os status de tarefa precisam de outro comando (proposta abaixo: `/coluna`).
- O redesign **0.6 (MB Core)** está commitado mas **não publicado**. Decidir antes da Etapa 1 (veja as perguntas).

## Decisões do Vini (01/10/2026)

| Assunto | Decisão |
|---|---|
| Redesign 0.6 | publicado |
| Sintaxe ao escrever | projeto `#tcc` · status `@fazendo` · prazo `>sex` · prioridade `!alta` (aceita também `!1 !2 !3`) |
| Prioridades | 3 níveis: `alta`, `média`, `baixa` (padrão `média`). **As de prioridade alta aparecem na tela inicial** |
| Projetos iniciais | `tcc`, `weg`, `pessoal` (criar novo: `/projeto novo nome`) |
| Status iniciais | `a fazer` → `fazendo` → `esperando` → `feito` (criar novo: **`/status novo nome`**) |
| Comando do sistema | o antigo `/status` (estado do sistema) vira **`/condition`** (atalho `/sys`) |
| Status "final" | `feito` é final: conta como concluída, entra no histórico, fica riscada até a meia-noite |
| `#tag` que não é projeto | continua sendo só tag (busca/filtro); o projeto vem das regras |
| Nome dos "guardados" | **Acervo** (`/acervo`). "Cofre"/"Vault" ficam reservados pra algo secreto no futuro |
| Prazo automático | alta → amanhã · média → +3 dias · baixa → +7 dias, **em dias corridos** |
| IA | **backlog**: por enquanto só as regras (`auto (regra)`). Quando voltar, pesquisar a opção mais barata |
| Login | **usuário + senha** (em vez de e-mail + senha). Biometria/câmera → backlog |

## Modelo de dados (tudo em `entries`)

```js
// tarefa
{ kind: 'tarefa', text: 'revisar cap 2', tags: ['tcc'],
  data: {
    projeto: 'tcc',            // nome de um projeto registrado
    status: 'a fazer',         // nome de um status registrado
    prazo: '2026-10-03',       // ou null
    prioridade: 'média',       // alta | média | baixa
    feito_em: null,            // epoch ms quando entrou num status final
    auto: { campos: ['projeto', 'prazo'], fonte: 'ia' }  // o que o app decidiu sozinho ('ia' | 'regra')
  } }

// registros editáveis por comando (também em entries, pra sincronizar igual)
{ kind: 'projeto', text: 'tcc', data: { ordem: 1, arquivado: false } }
{ kind: 'status',  text: 'a fazer', data: { ordem: 1, final: false } }

// acervo
{ kind: 'link',   text: 'https://... contexto opcional', tags: [...], data: { url, contexto, titulo: null } }
{ kind: 'trecho', text: 'texto curto guardado', tags: [...] }
```

Compatibilidade: tarefas antigas (`data.feito`) são lidas por uma função `normalizeTask(e)`:
- `feito` vira `status: 'feito'` + `feito_em`;
- o projeto vem da primeira `#tag` que for um projeto registrado.

A tarefa antiga só é regravada no formato novo quando for editada. Assim nada é apagado nem reescrito em massa.

## Etapas

Cada etapa é pequena, testável e termina com commit + CLAUDE.md atualizado. Entre parênteses, o tamanho estimado.

### Etapa 0 · Preparação (P)
- Decidir sobre o redesign 0.6: publicar como está, ajustar antes, ou seguir em cima dele sem publicar.
- Criar este roteiro no CLAUDE.md: Fase 1b = Tarefas v2 + visões · Fase 2a = IA de tarefas · novo módulo Acervo.

### Etapa 0.5 · Login com usuário + senha (P)
- O prompt de login pede **usuário** (ex: `vini`) e depois a senha. O app traduz o usuário pro e-mail do Supabase por um mapa em `js/config.js` (`OPERATORS`).
- Com um operador só configurado, a tela bloqueada já pede **direto a senha** ("senha do operador vini"). `/entrar outro` deixa digitar outro usuário ou um e-mail.
- `/status` → `/condition` (`/sys`), liberando `/status` pras tarefas.

### Etapa 1 · Modelo de dados e registros (M)
1. `js/tasks.js`: `normalizeTask`, `isFinal(status)` e prioridades, tudo em funções puras e com testes.
2. Registros: funções pra ler projetos e status de `entries` (`kind: 'projeto' | 'status'`), com **semente automática** na primeira vez (`tcc`, `weg`, `pessoal` / `a fazer`, `fazendo`, `esperando`, `feito`), sem duplicar se já existirem.
3. `groupTasks`, `taskStats` e o histórico passam a usar `status`, e não mais `feito`.
4. Os testes antigos continuam passando, mais os novos de compatibilidade.

**Pronto quando:** as tarefas antigas aparecem certas, e `/projetos` mostra os 3 projetos.

### Etapa 2 · Escrever e editar tarefas (M)
1. Parser v2 (`parseTaskInput`): lê `#projeto @status >prazo !prioridade` e devolve **o que foi informado** e **o que falta**.
2. Regras simples de preenchimento (`fillByRules`, função pura). Elas são o fallback da IA:
   - **projeto:** a palavra do texto que mais combina com os projetos e com as tarefas antigas de cada projeto; sem combinação, `pessoal`;
   - **status:** `a fazer`;
   - **prioridade:** `média`;
   - **prazo:** alta → amanhã · média → +3 dias · baixa → +7 dias (dias corridos).
3. **Linha "auto":** sempre que o app decidir algo, mostra uma linha curta marcada:
   `↳ auto (regra) · #pessoal · a fazer · !média · seg 06.10 · /desfazer ou /editar t4`
4. Comandos:
   - `/editar t3 #weg @fazendo >sex !alta [texto novo]`: muda só o que for informado;
   - `/mover t3 fazendo`: troca o status (atalho);
   - `/feito`: passa a significar mover pro status final;
   - `/projeto [novo | renomear | arquivar | lista]`;
   - `/status [novo | renomear | lista]`: os status das tarefas.
5. `/desfazer` também desfaz **a criação** de uma tarefa (hoje ele só restaura versões anteriores).
6. A prévia do Enter (`readIntent`) mostra os campos informados, e "auto" nos que faltam.

**Pronto quando:** `- revisar cap 2` cria a tarefa com a linha auto, e `/editar` e `/desfazer` corrigem.

### Etapa 3 · Tela inicial (P)
1. Depois do boot (e com `/inicio`), um bloco curto no terminal: **atrasadas** + **prioridade alta** + **as que vencem primeiro**, no máximo umas 6 linhas, no visual HUD.
2. O painel da direita, quando parado, segue a mesma regra (já é quase isso hoje).

**Pronto quando:** abrir o app mostra só o essencial, sem rolar a tela.

### Etapa 4 · Visões (G, dividida em 4)
Comando `/ver <lista | status | kanban | calendario>` (alias `/v`). A visão escolhida fica salva, e `/tarefas` usa a visão atual. Todas aceitam um filtro de projeto (`/ver kanban tcc`) e usam os números t1, t2...
1. **4a · lista por projeto:** um grupo por projeto, e dentro dele por prazo.
2. **4b · lista por status:** um grupo por status, na ordem das colunas.
3. **4c · kanban:** no PC, colunas lado a lado. No celular, colunas empilhadas e compactas (mobile primeiro), com contagem no topo de cada uma. Mover continua sendo por comando (`/mover t3 fazendo`).
4. **4d · calendário por prazo:** no celular, uma agenda dos próximos 14 dias, dia a dia, com as atrasadas no topo. No PC, uma grade do mês, com a quantidade de tarefas por dia. `/ver calendario 10/2026` muda o mês.

**Pronto quando:** as 4 visões funcionam no celular (375px) e no PC, com testes das funções que agrupam.

### Etapa 5 · Inteligência no servidor (G, dividida em 4) · **BACKLOG**
> Adiada pelo Vini (sem cartão de crédito agora). O app funciona 100% com as regras da Etapa 2.
> Quando retomar: comparar custo entre provedores (Anthropic Haiku, outros) antes de criar conta.
**Regra:** a chave da API **nunca** vai pro app nem pro repositório. Ela fica só nos *secrets* do Supabase.
1. **5a · conta e chave:** o Vini cria a conta em console.anthropic.com e põe créditos. A assinatura do Claude não inclui a API, mas o custo com o Haiku é de centavos. Ele gera a chave e cola **só** no Supabase: Edge Functions → Secrets → `ANTHROPIC_API_KEY`. Nunca no chat.
2. **5b · Edge Function `interpretar`** (`supabase/functions/interpretar/index.ts`):
   - só aceita usuário logado (JWT);
   - recebe `{ texto, informados, projetos, status, hoje }`;
   - chama o Claude e devolve só os campos que faltam: `{ projeto, projeto_novo, status, prazo, prioridade }`, em JSON validado;
   - publicação pelo MCP do Supabase (`.mcp.json`) ou pelo editor do painel.
3. **5c · no app:**
   - ao criar uma tarefa, primeiro vale o que foi informado;
   - pros campos que faltam, chama a função com limite de **4 segundos**;
   - se falhar, demorar ou estiver offline, entram as regras da Etapa 2;
   - **a tarefa é salva sempre**;
   - a linha auto diz a fonte (`auto (ia)` ou `auto (regra)`);
   - se a IA sugerir um projeto novo, ele é criado e a linha avisa.
   - Durante a chamada, o núcleo fica em `PROCESSING` e o satélite NETWORK acende.
4. **5d · testes:** função falsa nos testes (ok, erro, demora, resposta inválida), garantindo que a tarefa sempre é salva.

**Pronto quando:** `- mandar email pro orientador` vira tarefa no `#tcc` com `auto (ia)`. Desligando a rede, o mesmo comando usa `auto (regra)`.

### Etapa 6 · Acervo (M, dividida em 3)
1. **6a · links:**
   - colar um link no terminal (a linha começa com `http://` ou `https://`) **guarda** como link;
   - o resto da linha vira o contexto opcional: `https://... artigo bom sobre RAG #tcc`;
   - mostra "link guardado";
   - `/acervo` lista, e `/acervo links` lista só os links;
   - tocar no link abre numa aba nova (`target="_blank" rel="noopener"`).
2. **6b · textos curtos:** `/guardar texto` (ou a linha começando com `"`) guarda um trecho. `/acervo textos` lista.
3. **6c · tags e busca pra tudo:**
   - `/buscar termo` procura em notas, tarefas, links e trechos, agrupando por tipo;
   - filtro opcional: `/buscar rag tipo:link`;
   - `/apagar` e `/desfazer` funcionam no acervo.
4. *(Opcional, depois)* título automático do link pela Edge Function.

**Pronto quando:** colar um link guarda, `/buscar` acha ele, e nada disso interfere nas tarefas.

### Etapa 7 · Fechamento (P)
- `/ajuda` com os grupos novos (tarefas, visões, acervo).
- README atualizado.
- Publicar (`git push`, aumentando o `CACHE` do `sw.js`) e o Vini testar no celular.
- Roadmap do CLAUDE.md marcado.

## Ordem
0 → 0.5 → 1 → 2 → 3 → 4a → 4b → 4c → 4d → 6a → 6b → 6c → 7. (5 no backlog)

## Backlog
- Etapa 5 (IA no servidor), com pesquisa da opção mais barata.
- Login por biometria (passkey/WebAuthn: digital, Face ID, Windows Hello) ou câmera, no celular e no PC.
- Título automático dos links do acervo (precisa de servidor).
- "Cofre"/"Vault" pra algo secreto.

## O que o Vini precisa providenciar
- Em cada etapa: testar no celular e dizer se aprova.
