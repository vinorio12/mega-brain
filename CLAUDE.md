# Mega Brain

Terminal pessoal estilo "segundo cérebro" do Vini. Centraliza tarefas, projetos, TCC, trabalho, finanças, treino, saúde e hábitos. Tudo é alimentado escrevendo, sem apertar botões. Precisa ser rápido de abrir e usar de qualquer lugar, principalmente do celular.

## Como trabalhar comigo
- Sou iniciante em programação e em Claude Code. Explique cada passo em português, de forma simples, antes de fazer.
- Uma sessão por fase do roadmap. Ao terminar uma fase, atualize este arquivo.
- Mudanças pequenas e testáveis. Me diga como testar o que foi feito.
- Nunca apague dados salvos do usuário sem pedir.

## Visual
Terminal escuro, verde neon, minimalista mas com dados na tela (HUD futurista, vibe Jarvis sem ser Jarvis). Referência: mega-brain-fase0.html (protótipo feito no Cowork).

## Alvo técnico (a confirmar na primeira sessão)
- App próprio instalável no celular e no PC (PWA), com link próprio
- Dados na nuvem com login só do Vini
- IA intérprete de texto livre a partir da Fase 2

## Formato de uma entrada (protótipo)
{ text, tags[], kind: "nota", ts (epoch ms), day "AAAA-MM-DD" }

## Roadmap
- [x] 0. Esqueleto (protótipo no Cowork): terminal, HUD (hoje, semana, ano, memória, tags, módulos), inbox, comandos /ajuda /inbox /hoje /buscar /apagar /desfazer /status /roadmap /limpar
- [ ] 0.5. Migrar o protótipo para app próprio (PWA + banco na nuvem + login)
- [ ] 1. Tarefas e projetos: tabs Hoje, TCC, WEG, Pessoal, prazos, concluir
- [ ] 2. IA intérprete: texto livre vira tarefa, gasto, treino etc.
- [ ] 3. Finanças: gastos, entradas, categorias, saldo do mês
- [ ] 4. Corpo e hábitos: treino, saúde, hábitos com filosofia "cadence" (padrão semanal, sem streak, sem bronca)
- [ ] 5. Dashboards: gráficos por área e tendências, só com dados reais
- [ ] 6. Coach: resumo do dia, revisão semanal, incentivo gentil
