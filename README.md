# MB Core

Ambiente operacional de inteligência pessoal: um terminal com um núcleo vivo, em vez de um app com botões.
Tudo entra escrevendo, do seu jeito: notas, tarefas, gastos, treinos, links e textos. Matrix na austeridade, Jarvis na inteligência, Unix na interação.
Instalável no celular e no PC (PWA), com dados na nuvem e acesso só do dono.

```
MB CORE v0.9.0                                  ■ READY  ⇅ ON  ◫ NUVEM  ⋮ 18° 94%
› ligar pro dentista amanhã
18:03 OK  task   tarefa t4 · ligar pro dentista · T0007 · 84ms
          ↳ entendi · tarefa · #pessoal* · >amanhã · !média* · * auto · regra 80% · /desfazer ou /editar t4
```

## O que dá pra fazer

| Escrevendo | Acontece |
|---|---|
| `qualquer texto #tag` | guarda uma nota |
| `ligar pro dentista amanhã` · `preciso entregar o relatório dia 15` | vira tarefa, com o prazo lido da frase |
| `gastei 30 no almoço` · `recebi 1.500 de salário` · `treinei peito 1h` | guarda o gasto, a entrada ou o treino (dado bruto; telas nas próximas fases) |
| `- revisar cap 2 #tcc @fazendo >sex !alta` | sempre tarefa (projeto, status, prazo, prioridade). O que faltar, o app decide |
| `https://… contexto #tag` · `"texto curto` | guarda o link ou o texto no acervo |
| `nota: …` | guarda como nota, sem tentar entender |
| `/tipo tarefa` · `/tipo gasto #3` | corrige o que o app entendeu (sem número: a última coisa escrita) |
| `/palavras tcc +orientador` | palavras que puxam a tarefa pro projeto |
| `/inicio` · `/ver lista \| status \| kanban \| calendario` | o essencial e as visões das tarefas |
| `/editar t2 #weg !alta` · `/mover t3 fazendo` · `/feito t1-t3` | mexe nas tarefas |
| `/mudancas t2` | o histórico de uma tarefa (criada, status, prazos, concluída) |
| `/buscar termo [tipo:gasto]` | procura em tudo |
| `/desfazer` | desfaz a última mudança |
| `/ajuda` | lista todos os comandos |

## O intérprete

Tudo o que você escreve passa por uma função só, `interpretar(texto)` (`js/interpretar.js`):

1. **Regras primeiro** (`js/provedor-regras.js`): leem datas (amanhã, sexta, dia 15, semana que vem), valores (30, R$ 30,50),
   começos como "preciso", "tenho que", verbos e palavras-chave dos projetos. Cada tipo (`js/tipos-*.js`) diz como se reconhece.
2. **Na dúvida**, se a IA estiver ligada, ela decide. Hoje ela está **criada e desligada** (`INTERPRETADOR` em `js/config.js`).
3. **Sem certeza e sem IA**: salva como nota e pergunta "era tarefa? `/tipo tarefa`". Nunca perde o que foi escrito.

Toda resposta segue o mesmo contrato (`js/tipos.js`): tipo, campos, confiança e origem (regra ou IA).
A régua `tests/frases.js` tem as frases de exemplo com o resultado esperado. As regras passam nela, e a IA vai ter que passar também.
O que o app não entende vai pro `/aprendizado`. Cada mudança nas tarefas fica num histórico (`/mudancas`), e `/contexto`
mostra o resumo curto que a IA vai ler quando virar Coach (Fase 6).

## Como funciona

- **HTML, CSS e JavaScript puros**, com módulos ES. Não tem build nem dependência pra instalar.
- **[Supabase](https://supabase.com)** guarda tudo (Postgres) e cuida do login (usuário + senha, cadastro fechado).
- **Segurança por RLS:** cada linha do banco só pode ser lida e escrita pelo dono. A chave no
  `js/config.js` é a *publishable*, feita pra ficar pública. Ela não dá acesso a nada sem login.
  A chave da IA, quando existir, fica só no servidor.
- **Funciona offline:** um service worker guarda o app, e uma fila guarda o que você escreve sem internet
  e envia quando a rede volta. O tempo real sincroniza entre os aparelhos.
- **O núcleo** (canvas) reage ao estado real: READY, LISTENING, PROCESSING, EXECUTING, LOCKED, OFFLINE, DEGRADED, FAULT.

## Rodar localmente

No Windows, sem instalar nada:

```
powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1
```

Abra http://localhost:5173. Os testes ficam em http://localhost:5173/tests/.

## Estrutura

| Caminho | O que é |
|---|---|
| `index.html`, `css/style.css` | a tela e o visual |
| `js/app.js` | boot, login e ligação das peças |
| `js/core.js`, `js/boot.js`, `js/state.js` | o núcleo, a sequência de boot, os estados e a prévia do que o Enter vai fazer |
| `js/terminal.js`, `js/commands.js` | o terminal e a linguagem de comandos |
| `js/interpretar.js`, `js/provedor-regras.js`, `js/provedor-ia.js` | o intérprete: regras, IA (desligada) e a ordem entre eles |
| `js/tipos.js`, `js/tipos-base.js`, `js/tipos-financas.js`, `js/tipos-corpo.js` | contrato + registro de tipos (nota, tarefa, link, trecho, gasto, entrada, treino) |
| `js/dates.js`, `js/valores.js` | datas faladas e valores em reais (centavos) |
| `js/historico.js`, `js/aprendizado.js`, `js/contexto.js` | histórico de mudanças, frases não entendidas e o resumo pra IA |
| `js/tasks.js`, `js/views.js` | tarefas (modelo, regras automáticas) e visões |
| `js/acervo.js` | links e textos guardados, busca em tudo |
| `js/cloud.js`, `js/store.js` | memória na nuvem (com cache e fila offline) e local |
| `supabase/*.sql` | estrutura do banco, rodada no SQL Editor do Supabase |
| `tests/` | testes que rodam no navegador · `tests/frases.js` é a régua do intérprete |
| `docs/` | planos e passo a passo |
