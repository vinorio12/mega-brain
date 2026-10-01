# Mega Brain

Terminal pessoal estilo "segundo cérebro". Tudo entra escrevendo: notas, tarefas, gastos, treinos.
Visual de terminal cru ("Cybernetic Intelligence Terminal"), instalável no celular e no PC (PWA),
com dados na nuvem e acesso só do dono.

```
MB//CORE v0.5.0-dev                                   ■ READY  ⇅ ON  ◫ NUVEM  ☁ 18° 98%
› ler cap 2 da fundamentação #tcc
20:14:07 OK  store  capturado #12 · #tcc · T0007 · 84ms
```

## Como funciona

- **HTML, CSS e JavaScript puros**, com módulos ES. Não tem build nem dependência pra instalar.
- **[Supabase](https://supabase.com)** guarda as notas (Postgres) e cuida do login (e-mail + senha, cadastro fechado).
- **Segurança por RLS:** cada linha do banco só pode ser lida e escrita pelo dono. A chave no
  `js/config.js` é a *publishable*, feita pra ficar pública. Ela não dá acesso a nada sem login.
- **Funciona offline:** um service worker guarda o app, e uma fila guarda o que você escreve sem internet
  e envia quando a rede volta.

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
| `js/terminal.js` | saída, log, tarefas assíncronas, teclado |
| `js/commands.js` | a linguagem de comandos (`/ajuda` lista todos) |
| `js/cloud.js`, `js/store.js` | memória na nuvem (com cache e fila offline) e local |
| `js/ui.js`, `js/core.js`, `js/boot.js` | painéis, visualização do núcleo, tela de boot |
| `supabase/*.sql` | estrutura do banco, rodada no SQL Editor do Supabase |
| `tests/` | testes que rodam no navegador |
| `docs/` | passo a passo e planos das próximas fases |

## Roadmap

0 esqueleto ✓ · 0.5 app próprio ✓ · 1 tarefas e projetos · 2 IA intérprete · 3 finanças ·
4 corpo e hábitos · 5 dashboards · 6 coach
