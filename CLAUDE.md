# Mega Brain

Terminal pessoal estilo "segundo cérebro" do Vini. Centraliza tarefas, projetos, TCC, trabalho, finanças, treino, saúde e hábitos. Tudo é alimentado escrevendo, sem apertar botões. Precisa ser rápido de abrir e usar de qualquer lugar, principalmente do celular.

## Como trabalhar comigo
- Sou iniciante em programação e em Claude Code. Explique cada passo em português, de forma simples, antes de fazer.
- Uma sessão por fase do roadmap. Ao terminar uma fase, atualize este arquivo.
- Mudanças pequenas e testáveis. Me diga como testar o que foi feito.
- Nunca apague dados salvos do usuário sem pedir.

## Visual: "Cybernetic Intelligence Terminal"
Terminal cru, underground. Fundo quase preto, uma fonte monoespaçada (JetBrains Mono), sensação de acesso direto ao núcleo.
- Regra de ouro: 85–90% da tela em silêncio. Destaque por contraste, não por excesso de efeito (efeitos sutis são bem-vindos).
- 6 cores (tokens em `css/style.css`): texto `--tx`, metadados marrom-acinzentado `--meta`, atividade verde `--act`, HUD/inteligência azul-bebê `--hud`, aviso amarelo `--warn`, erro vermelho `--err`.
- Raio 0–4px, bordas 1px cinza-azulado de baixa opacidade, sem sombras de card. Brilho só em elementos ativos.
- Estados nunca só por cor: sempre com texto (OK/WRN/ERR, READY/BUSY...) ou forma.
- Só dados reais. Sem dado → "NA", mas o campo não some.
- Layout: cabeçalho de sistema · núcleo (esq.) · terminal (centro) · telemetria (dir.) · rodapé de infraestrutura. No celular: cabeçalho, faixa do núcleo, terminal, rodapé.
- O terminal não executa comandos do sistema operacional: é uma linguagem própria (`js/commands.js`).
- Protótipo original guardado em `prototipo/mega-brain-fase0.html`.

## Alvo técnico (confirmado)
- HTML/CSS/JS puros com módulos ES, sem build e sem Node.
- PWA instalável no celular e no PC, com link próprio.
- Supabase: banco Postgres + login por **e-mail + senha** (decisão do Vini; código por e-mail fica como opção `/codigo`, mas o SMTP via Resend ainda dá erro 500), cadastro desligado, regras RLS (cada linha só do dono). Usuário: hornburg.vinicius@gmail.com.
- IA intérprete a partir da Fase 2 (chave guardada no Supabase, nunca no front).

## Como rodar localmente
`powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1` → http://localhost:5173
Testes: http://localhost:5173/tests/ (o título da aba mostra ✓ N ou ✕ N).

## Manual de manutenção (siga em toda mudança)
1. Mudanças pequenas. Explique ao Vini o que vai fazer antes de fazer.
2. Toda lógica nova que dá pra isolar vira **função pura** + teste em `tests/run.js`. Exemplos: `pickTargets`, `parseDue`.
3. Arquivo novo em `js/` → adicionar no `SHELL` do `sw.js`. **Toda mudança** em arquivo do app → aumentar o `CACHE` do `sw.js`.
4. Rodar `/tests/` (tudo verde) e testar no navegador antes do commit. Testes nunca usam as chaves reais (`mb.entries.v1`, `mb.hist.v1`, cache da nuvem): use `mb.test.*` e o Supabase falso.
5. Commit em português, explicando o porquê.
6. Comando novo: adicionar em `defs` no `js/commands.js` (`data: true` se mexe nas notas, `async: true` se usa rede/memória). Ele aparece sozinho no `/ajuda` e no Tab.
7. Banco: arquivo novo numerado em `supabase/` (`002_...sql`), escrito pra poder rodar mais de uma vez (`if not exists`). Toda tabela nova precisa de RLS "só o dono". O Vini roda no SQL Editor, ou Claude roda pelo MCP.
8. Texto do usuário sempre passa por `esc()`/`hl()` antes de virar HTML.
9. Nunca apagar notas sem pedido explícito. Ações em lote por texto ambíguo só listam e pedem números (veja o `/apagar`).
10. Erros pro usuário: `CmdError(código, origem, descrição, dica)`, com dica que diga o que fazer.

## Documentos
- `docs/publicar.md` · passo a passo do GitHub Pages
- `docs/fase-1.md` · proposta da Fase 1 com 4 perguntas pro Vini

## Estrutura
- `index.html` estrutura da tela · `css/style.css` visual
- `js/app.js` boot e ligação das peças · `js/terminal.js` saída, log, tarefas, teclado
- `js/commands.js` comandos · `js/ui.js` painéis · `js/core.js` visualização do núcleo
- `js/store.js` memória local · `js/cloud.js` login + memória na nuvem (mesma interface, com cache e fila offline)
- `js/config.js` URL e chave publishable do Supabase (vazia = modo local)
- `js/boot.js` tela de boot · `js/weather.js` clima (Open-Meteo, padrão Jaraguá do Sul)
- `js/dates.js` datas faladas → AAAA-MM-DD (`parseDue`, `fmtDue`), pronto pra prazos da Fase 1
- `tests/` testes no navegador · `docs/` passo a passo e planos
- `sw.js` + `manifest.webmanifest` + `icons/` PWA (ao mudar arquivos do app, aumentar `CACHE` no sw.js)
- `supabase/*.sql` banco (rodar no SQL Editor) · `tools/icons.ps1` gera os PNGs dos ícones
- `.mcp.json` conecta o MCP do Supabase (projeto xfvfgidvqrubdtogtczy)

## Formato de uma entrada (protótipo)
{ text, tags[], kind: "nota", ts (epoch ms), day "AAAA-MM-DD" }

## Roadmap
- [x] 0. Esqueleto (protótipo no Cowork): terminal, HUD (hoje, semana, ano, memória, tags, módulos), inbox, comandos /ajuda /inbox /hoje /buscar /apagar /desfazer /status /roadmap /limpar
- [ ] 0.5. Migrar o protótipo para app próprio (PWA + banco na nuvem + login)
  - [x] separar em arquivos + visual novo + terminal (histórico, tab, ctrl+c, ctrl+k, tarefas com ID, erros com código) + /clima
  - [x] boot animado, clima padrão Jaraguá do Sul, HUD sem repetições
  - [x] código do Supabase: login (senha ou código), memória na nuvem com fila offline e tempo real, /entrar /sair /sync /migrar /codigo
  - [x] Supabase configurado (tabela + RLS, usuário criado, cadastro desligado, chave em js/config.js) · login testado e funcionando
  - [x] /apagar em lote e por texto · /painel (ctrl+.) e /foco · tempo real autenticado + sync entre abas
  - [x] testes automáticos (tests/) · js/dates.js pronto pra Fase 1 · README e docs/
  - [x] erros inesperados viram `E_JS` no terminal · /importar (sem duplicar) · nuvem aceita colunas novas (`data`) · offline verificado com servidor desligado · prompt acima do teclado no celular
  - [ ] confirmar com o Vini que o tempo real funciona logado (RT `on` no rodapé, duas janelas)
  - [ ] confirmar no celular de verdade que o prompt fica visível com o teclado aberto
  - [ ] publicar no GitHub Pages (docs/publicar.md) + atualizar Site URL no Supabase
  - [x] PWA (manifest, ícones, service worker, /instalar)
- [ ] 1. Tarefas e projetos: tabs Hoje, TCC, WEG, Pessoal, prazos, concluir
- [ ] 2. IA intérprete: texto livre vira tarefa, gasto, treino etc.
- [ ] 3. Finanças: gastos, entradas, categorias, saldo do mês
- [ ] 4. Corpo e hábitos: treino, saúde, hábitos com filosofia "cadence" (padrão semanal, sem streak, sem bronca)
- [ ] 5. Dashboards: gráficos por área e tendências, só com dados reais
- [ ] 6. Coach: resumo do dia, revisão semanal, incentivo gentil
