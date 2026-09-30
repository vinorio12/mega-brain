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
- Supabase: banco Postgres + login por e-mail, cadastro desligado, regras RLS (cada linha só do dono).
- IA intérprete a partir da Fase 2 (chave guardada no Supabase, nunca no front).

## Como rodar localmente
`powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1` → http://localhost:5173

## Estrutura
- `index.html` estrutura da tela · `css/style.css` visual
- `js/app.js` boot e ligação das peças · `js/terminal.js` saída, log, tarefas, teclado
- `js/commands.js` comandos · `js/ui.js` painéis · `js/core.js` visualização do núcleo
- `js/store.js` memória local · `js/cloud.js` login + memória na nuvem (mesma interface, com cache e fila offline)
- `js/config.js` URL e chave publishable do Supabase (vazia = modo local)
- `js/boot.js` tela de boot · `js/weather.js` clima (Open-Meteo, padrão Jaraguá do Sul)
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
  - [x] código do Supabase: login por código no e-mail, memória na nuvem com fila offline e tempo real, /entrar /sair /sync /migrar
  - [ ] Supabase configurado (rodar supabase/001_entries.sql, criar usuário, desligar cadastro, chave em js/config.js)
  - [x] PWA (manifest, ícones, service worker, /instalar)
  - [ ] publicar no GitHub Pages (repositório público)
- [ ] 1. Tarefas e projetos: tabs Hoje, TCC, WEG, Pessoal, prazos, concluir
- [ ] 2. IA intérprete: texto livre vira tarefa, gasto, treino etc.
- [ ] 3. Finanças: gastos, entradas, categorias, saldo do mês
- [ ] 4. Corpo e hábitos: treino, saúde, hábitos com filosofia "cadence" (padrão semanal, sem streak, sem bronca)
- [ ] 5. Dashboards: gráficos por área e tendências, só com dados reais
- [ ] 6. Coach: resumo do dia, revisão semanal, incentivo gentil
