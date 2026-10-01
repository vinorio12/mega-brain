# MB Core

Ambiente operacional de inteligência pessoal: um terminal com um núcleo vivo, em vez de um app com botões.
Tudo entra escrevendo: notas, tarefas, links e textos. Matrix na austeridade, Jarvis na inteligência, Unix na interação.
Instalável no celular e no PC (PWA), com dados na nuvem e acesso só do dono.

```
MB CORE v0.7.0                                  ■ READY  ⇅ ON  ◫ NUVEM  ⋮ 18° 94%
› - mandar email pro orientador
18:03 OK  task   tarefa t4 · mandar email pro orientador · T0007 · 84ms
          ↳ auto (regra) · #tcc · @a fazer · !média · >dom 04.10 · /desfazer ou /editar t4
```

## O que dá pra fazer

| Escrevendo | Acontece |
|---|---|
| `qualquer texto #tag` | guarda uma nota |
| `- revisar cap 2 #tcc @fazendo >sex !alta` | cria tarefa (projeto, status, prazo, prioridade). O que faltar, o app decide e mostra em `↳ auto` |
| `https://… contexto #tag` | guarda o link no acervo |
| `"texto curto` | guarda o texto no acervo |
| `/inicio` | o essencial: atrasadas, prioridade alta, as que vencem primeiro |
| `/ver lista \| status \| kanban \| calendario` | visões das tarefas |
| `/editar t2 #weg !alta` · `/mover t3 fazendo` · `/feito t1-t3` | mexe nas tarefas |
| `/projeto novo nome` · `/status novo nome` | cria projetos e status |
| `/buscar termo [tipo:link]` | procura em tudo |
| `/desfazer` | desfaz a última mudança |
| `/ajuda` | lista todos os comandos |

## Como funciona

- **HTML, CSS e JavaScript puros**, com módulos ES. Não tem build nem dependência pra instalar.
- **[Supabase](https://supabase.com)** guarda tudo (Postgres) e cuida do login (usuário + senha, cadastro fechado).
- **Segurança por RLS:** cada linha do banco só pode ser lida e escrita pelo dono. A chave no
  `js/config.js` é a *publishable*, feita pra ficar pública. Ela não dá acesso a nada sem login.
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
| `js/core.js`, `js/boot.js`, `js/state.js` | o núcleo, a sequência de boot, os estados e a leitura da intenção |
| `js/terminal.js`, `js/commands.js` | o terminal e a linguagem de comandos |
| `js/tasks.js`, `js/views.js`, `js/dates.js` | tarefas (modelo, regras automáticas), visões e datas faladas |
| `js/acervo.js` | links e textos guardados, busca em tudo |
| `js/cloud.js`, `js/store.js` | memória na nuvem (com cache e fila offline) e local |
| `supabase/*.sql` | estrutura do banco, rodada no SQL Editor do Supabase |
| `tests/` | testes que rodam no navegador |
| `docs/` | planos e passo a passo |
