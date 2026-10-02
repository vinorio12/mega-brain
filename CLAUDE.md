# Mega Brain

Terminal pessoal estilo "segundo cérebro" do Vini. Centraliza tarefas, projetos, TCC, trabalho, finanças, treino, saúde e hábitos. Tudo é alimentado escrevendo, sem apertar botões. Precisa ser rápido de abrir e usar de qualquer lugar, principalmente do celular.

## Como trabalhar comigo
- Sou iniciante em programação e em Claude Code. Explique cada passo em português, de forma simples, antes de fazer.
- Uma sessão por fase do roadmap. Ao terminar uma fase, atualize este arquivo.
- Mudanças pequenas e testáveis. Me diga como testar o que foi feito.
- Nunca apague dados salvos do usuário sem pedir.

## Visual: MB Core · AI operating environment (v0.6)
Nome do app: **MB Core** (repositório continua `mega-brain`). Matrix na austeridade, Jarvis na inteligência, Unix na interação.
Não é um dashboard com terminal no meio: é uma inteligência com ambiente operacional próprio.
- Regra de ouro: 85–90% da tela em silêncio. Sem glitch, scanlines, partículas ou enfeite. Tudo funcional e deliberado.
- Cores (tokens em `css/style.css`): ciano `--int` = inteligência/processamento · verde `--act` = atividade/confirmação · cinza `--meta` = metadados · âmbar `--warn` = atenção · vermelho `--err` = erro · texto `--tx`.
- Três camadas: **terminal** (painel elevado, logs brutos) · **inteligência** (o núcleo, único elemento com brilho) · **periferia** (rails e barras, baixo contraste).
- Layout: cabeçalho · esquerda = estado cognitivo (estado, atenção, processos, fluxo, atividade) · centro = núcleo + 5 satélites em cima, terminal embaixo · direita = contexto (o que o Enter vai fazer, ou tarefas relevantes), ambiente, módulos · rodapé de infraestrutura. Celular: cabeçalho, faixa do núcleo, terminal, rodapé.
- **Núcleo** (`js/core.js`, canvas): nucleus · raios · reator · rede neural · órbitas · anel HUD (progresso do dia) · conectores pros satélites CONTEXT, MEMORY, NETWORK, INPUT, PROCESS. Reage a dados reais: conector acende quando o subsistema trabalha; cada tecla manda uma faísca do INPUT.
- **Estados** (`js/state.js`, `deriveState`): INITIALIZING · LOCKED · READY · LISTENING (tecla nos últimos 2,5s) · PROCESSING (tarefa `proc`: rede, leitura) · EXECUTING (tarefa `exec`: grava) · DEGRADED · OFFLINE · FAULT (2,2s após erro). Ação rápida fica visível no mínimo 550ms. Comando novo que grava: `exec: true` no `defs`.
- **Boot** (`js/boot.js`): o MESMO núcleo nasce em tela cheia, satélites aparecem, "CORE ONLINE" → "INTELLIGENCE READY"/"MEMORY LOCKED", o núcleo voa pro lugar e a interface se monta; terminal por último com cursor de bloco piscando. Primeira vez ~5s, depois ~1,3s; qualquer tecla pula; `/boot` repete; `/boot completo` deixa sempre o longo.
- Estados nunca só por cor: sempre com texto ou forma. Só dados reais; sem dado → "NA", mas o campo não some.
- O terminal não executa comandos do sistema operacional: é uma linguagem própria (`js/commands.js`).
- Protótipo original guardado em `prototipo/mega-brain-fase0.html`.

## Alvo técnico (confirmado)
- HTML/CSS/JS puros com módulos ES, sem build e sem Node.
- PWA instalável no celular e no PC, com link próprio.
- Supabase: banco Postgres + login por **usuário + senha** (usuário → e-mail via `OPERATORS` no config.js) (decisão do Vini; código por e-mail fica como opção `/codigo`, mas o SMTP via Resend ainda dá erro 500), cadastro desligado, regras RLS (cada linha só do dono). Usuário: hornburg.vinicius@gmail.com.
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
- `docs/fase-1.md` · proposta da Fase 1 (feita)
- `docs/plano-tarefas-acervo.md` · tarefas v2, visões e acervo (feito; Etapa 5 = IA no backlog)
- `docs/plano-interprete.md` · Fase 2: intérprete por regras com IA encaixável, histórico e `montarContexto` (em execução)

## Estrutura
- `index.html` estrutura da tela · `css/style.css` visual
- `js/app.js` boot e ligação das peças · `js/terminal.js` saída, log, tarefas, teclado
- `js/commands.js` comandos · `js/ui.js` periferia + liga estado, núcleo e satélites · `js/core.js` núcleo (canvas) · `js/state.js` estados e leitura da intenção
- `js/store.js` memória local · `js/cloud.js` login + memória na nuvem (mesma interface, com cache e fila offline)
- `js/config.js` URL e chave publishable do Supabase (vazia = modo local)
- `js/boot.js` sequência de boot (usa o mesmo núcleo) · `js/weather.js` clima (Open-Meteo, padrão Jaraguá do Sul)
- `js/views.js` visões das tarefas (`viewGroups`, `calendarModel`) · `js/tasks.js` modelo de tarefa, registros, regras automáticas, `briefing`
- `js/dates.js` datas faladas → AAAA-MM-DD (`parseDue` pro marcador `>sex`, `findDate` pra data dentro de frase, `fmtDue`)
- `js/valores.js` valores em reais → centavos inteiros (`parseValor`, `findValor`, `fmtValor`)
- `js/historico.js` histórico de mudanças: `withHistory(store)` anota cada gravação de tarefa como `kind: evento` (origem: `store.restore(e, { origem })`); o que chega da nuvem não gera evento
- `js/tipos.js` contrato do intérprete (`validarInterpretacao`) + registro de tipos (`registrarTipo`, `REGISTRO.schema()` pra IA)
- `js/tipos-base.js` tipos nota, tarefa, link, trecho (`reconhecer` + `montar`) · `js/provedor-regras.js` motor de regras (síncrono, devolve o contrato)
- `js/tipos-financas.js` gasto e entrada (`lerMovimento`) · `js/tipos-corpo.js` treino (`lerDuracao`, `lerDistancia`): só dado bruto, Fases 3 e 4 expandem
- `tests/frases.js` régua do intérprete: frase → resultado esperado (regras e IA passam na mesma lista; `FRASES_IA` só pra IA)
- `tests/` testes no navegador · `docs/` passo a passo e planos
- `sw.js` + `manifest.webmanifest` + `icons/` PWA (ao mudar arquivos do app, aumentar `CACHE` no sw.js)
- `supabase/*.sql` banco (rodar no SQL Editor) · `tools/icons.ps1` gera os PNGs dos ícones
- `.mcp.json` conecta o MCP do Supabase (projeto xfvfgidvqrubdtogtczy)

## Formato das entradas (tabela `entries`)
{ id, text, tags[], kind, ts (epoch ms), day "AAAA-MM-DD", data {} }
- kind `nota` · `tarefa` (data: projeto, status, prazo, prioridade, feito_em, auto) · `link` (data: url, contexto) · `trecho` · `gasto`/`entrada` (data: valor em centavos, descricao, data) · `treino` (data: descricao, duracao_min, distancia_km, data)
- registros: kind `projeto` (data: ordem, arquivado) · `status` (data: ordem, final) · `evento` (histórico, só cresce: data: alvo, alvo_kind, acao, mudancas {campo: [de, para]}, origem, texto), ficam em `S.records`, fora das listas
- só `nota`, `tarefa`, `link`, `trecho`, `gasto`, `entrada`, `treino` aparecem (`CONTENT_KINDS` em tasks.js); qualquer outro kind fica escondido. Tipo novo de conteúdo (ex: gasto) precisa entrar nessa lista

## Roadmap
- [x] 0. Esqueleto (protótipo no Cowork): terminal, HUD (hoje, semana, ano, memória, tags, módulos), inbox, comandos /ajuda /inbox /hoje /buscar /apagar /desfazer /status /roadmap /limpar
- [x] 0.5. Migrar o protótipo para app próprio (PWA + banco na nuvem + login) · publicado em https://vinorio12.github.io/mega-brain/
  - [x] separar em arquivos + visual novo + terminal (histórico, tab, ctrl+c, ctrl+k, tarefas com ID, erros com código) + /clima
  - [x] boot animado, clima padrão Jaraguá do Sul, HUD sem repetições
  - [x] código do Supabase: login (senha ou código), memória na nuvem com fila offline e tempo real, /entrar /sair /sync /migrar /codigo
  - [x] Supabase configurado (tabela + RLS, usuário criado, cadastro desligado, chave em js/config.js) · login testado e funcionando
  - [x] /apagar em lote e por texto · /painel (ctrl+.) e /foco · tempo real autenticado + sync entre abas
  - [x] testes automáticos (tests/) · js/dates.js pronto pra Fase 1 · README e docs/
  - [x] erros inesperados viram `E_JS` no terminal · /importar (sem duplicar) · nuvem aceita colunas novas (`data`) · offline verificado com servidor desligado · prompt acima do teclado no celular
  - [x] tempo real confirmado (RT on) · prompt visível com teclado no celular confirmado
  - [x] publicado no GitHub Pages + Site URL no Supabase · instalado no celular
  - [x] PWA (manifest, ícones, service worker, /instalar)
- [ ] 1. Tarefas e projetos: tabs Hoje, TCC, WEG, Pessoal, prazos, concluir
  - Decisões do Vini: qualquer #tag é projeto · criar com `/t` e com `- ` · abas como pastas (`/ir tcc`, prompt `~/tcc`) · concluída fica riscada até o fim do dia + histórico em `/feitas`
  - [x] `js/tasks.js` (funções puras) · tarefa = entrada `kind: 'tarefa'` com `data: { prazo, feito }`
  - [x] comandos: /t, "- ", /tarefas [proj], /feito, /reabrir, /adiar, /feitas [proj] [dias], /projetos, /ir (alt+1..4), /apagar t1, /desfazer de qualquer mudança
  - [x] HUD: telemetria "tarefas" (da aba), "pendentes" real no núcleo, módulo tarefas online · 104 testes
  - [x] 002_data.sql rodado · publicado
- [x] 0.6. Redesign MB Core: núcleo vivo com estados reais, satélites, rails contextuais, boot cinematográfico · publicado
- [x] 1b. Tarefas v2, visões e acervo · plano em `docs/plano-tarefas-acervo.md` (decisões do Vini lá) · publicado v0.7.0 · testado e aprovado pelo Vini (01/10/2026)
  - [x] 0 · plano aprovado, 0.6 publicado
  - [x] 0.5 · login usuário + senha (OPERATORS em config.js; tela bloqueada pede direto a senha; `/entrar outro`) · `/status` do sistema virou `/condition` (`/sys`)
  - [x] 1 · modelo de dados v2 (`data: { projeto, status, prazo, prioridade, feito_em }`, lê o formato antigo) · registros `kind: projeto|status` separados das notas (`S.records`) · semente com ids fixos (`seedId`) · `/projeto [novo|renomear|arquivar]` · `/desfazer` desfaz criação
  - [x] 2 · `#proj @status >prazo !prioridade` (`parseTaskInput`) · regras (`fillByRules`: projeto pelo texto/histórico, `a fazer`, `média`, prazo alta+1 média+3 baixa+7 corridos) · linha `↳ auto (regra)` · `/editar`, `/mover`, `/status [novo|renomear]` · prévia na direita com "auto"
  - [x] 3 · tela inicial `/inicio` (`briefing`: atrasadas → !alta → vencem primeiro, até 6 linhas) depois do boot e do login · painel da direita usa a mesma regra
  - [x] 4 · visões (`js/views.js`): `/ver prazo|lista|status|kanban|calendario [proj] [mês]` (salva em `mb.view.v1`, `/tarefas` usa a atual) · kanban empilha no celular · calendário: grade no PC, agenda no celular, `/ver calendario +1`
  - [x] 6 · acervo (`js/acervo.js`): colar link (http/https) guarda com contexto, linha com aspas ou `/guardar` guarda texto, `/acervo [links|textos] [termo]`, `/buscar termo [tipo:link|texto|tarefa|nota]` em tudo, agrupado por tipo · visão atual em `S.view`
  - [x] 7 · README, ajuda agrupada, publicado
- [x] 0.8. UX por módulo: notas = diário por dia (`/inbox` só notas, números #3) · acervo = cartões (a2) · tarefas = lista de execução (t1) · `/apagar 3 | a2 | t1` · `/overview` (`/ov`) no lugar do núcleo com tarefas, notas, acervo e projetos (esc fecha; outro comando fecha)
- [ ] 2. Intérprete: tudo que escrevo passa por `interpretar(texto)` · plano em `docs/plano-interprete.md` (aprovado 01/10/2026)
  - Motor por **regras** agora; IA (Haiku 4.5) fica **criada e desligada**, pra só encaixar depois. Ordem: regras primeiro → confiança baixa e IA ligada = IA → IA desligada = salva como nota e pergunta o que é (`/tipo`)
  - Contrato fixo de resposta `{ tipo, campos, confianca, origem: regra|ia, auto, ... }` · provedores trocáveis · registro de tipos (cada fase futura registra o seu: agora tarefa, nota, link, trecho e, só com dado bruto, gasto, entrada, treino)
  - Regras: leitor de datas em frases, leitor de valores (centavos), palavras-chave por projeto (`/palavras`) · linha "↳ entendi" depois de salvar · log de frases não entendidas (`/aprendizado`) · régua de frases de exemplo (`tests/frases.js`) que a IA também precisa passar
  - Pra Fase 6: histórico de mudanças (registros `kind: evento`, append-only) e `montarContexto` (resumo enxuto do estado)
  - [x] 0 · plano aprovado e roadmap atualizado
  - [x] 1 datas em frases (`findDate` em dates.js, 195 testes) · [x] 2 valores (`js/valores.js`: centavos inteiros, 202 testes) · [x] 3 histórico de mudanças (`js/historico.js`: `withHistory` em volta da memória, `/mudancas [t1]`) + kinds desconhecidos escondidos (214 testes) · [x] 4 contrato + registro de tipos (`js/tipos.js`: `criarRegistro`, `REGISTRO`, `validarInterpretacao`, 222 testes) · [x] 5 régua (`tests/frases.js`, 24 frases) + provedor de regras (`js/provedor-regras.js`, tipos em `js/tipos-base.js`) · 255 testes · [x] 6 gasto/entrada/treino brutos (`js/tipos-financas.js`, `js/tipos-corpo.js`; aparecem no `/buscar`, não no `/inbox`; 40 frases, 276 testes) · [ ] 7 `interpretar()` + provedor de IA desligado · [ ] 8 palavras-chave por projeto · [ ] 9 ligar na tela (9a sem mudar nada, 9b texto livre + `/tipo`) · [ ] 10 aprendizado · [ ] 11 `montarContexto` · [ ] 12 fechamento
- [ ] 3. Finanças: gastos, entradas, categorias, saldo do mês
- [ ] 4. Corpo e hábitos: treino, saúde, hábitos com filosofia "cadence" (padrão semanal, sem streak, sem bronca)
- [ ] 5. Dashboards: gráficos por área e tendências, só com dados reais
- [ ] 6. Coach: a IA vira assistente de verdade. Lê o contexto completo (`montarContexto` + histórico de mudanças + dados de todas as áreas) e sugere **next steps, updates e prioridades**, além do resumo do dia e da revisão semanal. Tom gentil, sem bronca. Depende do provedor de IA ligado (backlog) e dos dados da Fase 2 em diante.

## Backlog (ideias guardadas, sem data)
- **Ligar o provedor de IA do intérprete** com o Haiku 4.5 (`claude-haiku-4-5-20251001`, ou outro modelo escolhido): Edge Function `interpretar` no Supabase (chave só nos secrets) + **travas de custo**: limite diário de chamadas e cache de respostas. O cliente já nasce com os ganchos (`guard`, `cache`) na Fase 2. Sem cartão no momento.
- IA no servidor pras tarefas (Etapa 5 do plano antigo, agora absorvida pelo item acima) · antes, pesquisar a API de IA mais barata
- Arquivar eventos antigos do histórico se o cache local passar de ~2 MB
- Login por biometria (passkey/WebAuthn) ou câmera, no celular e no PC
- Título automático dos links do acervo
- "Cofre"/"Vault" pra algo secreto
