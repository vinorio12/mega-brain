# Prompt pro Claude Code · MB Core v0.14 "usar de verdade"

> Pedido do Vini (08/10/2026), depois de 5 dias de uso real (01 a 08/10). Plano em `docs/plano-ux.md`.

Oi! Testei o MB Core por uns cinco dias com dados reais (01 a 08/10). Usei menos do que queria, e o motivo principal é que a experiência está ruim, no computador e no celular: pouco visual, pouco intuitiva, com sobreposições, texto que não cabe e alguns bugs. Antes de qualquer fase nova (corpo, dashboards, coach), quero uma rodada só de polimento e bugs. Nada de funcionalidade nova além do que está aqui.

Como sempre: me explique o plano em português simples, escreva o plano em `docs/plano-ux.md`, espere eu aprovar e depois vá em etapas pequenas e testáveis, seguindo o manual de manutenção do `CLAUDE.md`.

## 1. O que o uso real mostrou (dados do Supabase, 01–08/10)

- 33 coisas digitadas fora de comandos: 23 viraram o que eu queria, 10 viraram lixo (cerca de 30%). Quase todas viraram "nota" sem eu querer.
- 23 correções manuais depois de lançar, ou seja, uma correção pra cada coisa que deu certo. As mais comuns: prazo (11) e forma de pagamento (6 de 7 gastos).
- Uso caiu: forte de 02 a 06/10, nada no dia 07, um link no dia 08. Usei mais em horário de trabalho (10h–12h) e pra finanças.
- 6 de 6 vezes que o app perguntou "era tarefa?", a resposta foi sim.
- Hoje tenho 10 tarefas abertas, 7 vencidas desde 06/10, e o app não me puxa de volta pra elas. Algumas eu já fiz fora do app.
- O prazo automático criou falsa urgência: no dia 05 eu adiei 7 tarefas de uma vez, de 05 pra 06, e elas venceram de novo.

Exemplos reais do que virou nota sem querer:

- `debito` e `débito`, digitados como resposta logo depois do app perguntar "forma? /forma pix · crédito · débito…"
- `pix de 270`, `fiz pix de 270`, `pix de $270` (só `paguei 270` funcionou)
- `gastei $45 na farmácia` (com `R$46` funcionou)
- `ajuda`, `inbox` (comando sem a barra)
- `t2 05.10` (tentei mudar o prazo da t2)
- uma tarefa chamada só `fazendo` (tentei mudar status)

## 2. Bugs (reproduza cada um, corrija e crie teste quando for lógica)

1. Sobreposição no painel direito em 1280×720: a lista do CONTEXTO (tarefas) passa por cima do bloco AMBIENTE ("enviar comprovante…" e "/inicio · /tarefas" em cima de "dia qui 08.10").
2. Overview corta tudo em 1280×720: 5 colunas espremidas, títulos com 3–4 letras ("modelo de pre…", "mapear qua…") e valores em dinheiro cortados ("saldo R$ 2.79…", "gastos R$ 54,…"). Dinheiro nunca pode ser cortado.
3. Overview no celular (390×844): a seção FINANÇAS fica escondida atrás do terminal, não dá pra ver.
4. Kanban: fica dentro da área de rolagem do terminal, então só aparecem 2 cartões por vez; as colunas têm ~190px e o texto quebra palavra por palavra. No celular vira uma lista comprida que não é kanban.
5. Parser engole espaço e não lê prioridade quando a data está no meio: `- trabalhar no tcc #tcc amanhã !alta` vira o título `trabalhar no tcc #tcc!alta`, e a prioridade não é aplicada.
6. Tag desconhecida fica no título e o projeto é chutado: `enviar comprovante… #faculdade` ficou com `#faculdade` no texto e foi pra `#weg`. Tag que não é projeto: tirar do título e perguntar (ou criar o projeto com `/sim`).
7. Descrição do gasto vira o verbo: `paguei 270` → descrição "paguei"; `gastei 36` → "gastei"; `entrou 400` → "entrou". Sem descrição, deixe vazio e mostre "sem descrição", nunca o verbo.
8. `$` não é lido como valor (`gastei $45`). Aceitar `$`, `R$`, `r$`, `reais`, `conto(s)`.
9. Pix sem pessoa não vira gasto: `pix de 270`, `fiz pix de 270`. Pix com valor e sem "do/da" é gasto (forma pix), pessoa opcional.
10. Faça também uma varredura geral: console sem erros, cada comando do `/ajuda` rodando nos três tamanhos de tela, e me liste o que mais achar. Eu esqueci de anotar alguns bugs que vi, então procure.

Teste os três tamanhos sempre: 1440×900, 1280×720 (notebook do trabalho) e 390×844 (celular). Tire print antes e depois de cada etapa e me mostre.

## 3. Conversa com o terminal (fricção)

- Pergunta pendente aceita resposta sem barra. Se o app acabou de perguntar a forma, `debito`, `débito`, `pix`, `crédito` respondem a pergunta. Mesmo pra categoria (`saúde`) e pra "era tarefa?" (`sim`, `s`, `não`). Fora de uma pergunta, continua como hoje.
- Comando sem barra: palavras sozinhas que são nome de comando (`ajuda`, `inbox`, `hoje`, `mes`, `desfazer`) rodam o comando, com a linha "rodei /ajuda · pra guardar como nota use nota: ajuda".
- Opções tocáveis: tudo que aparece em ciano como sugestão (`/forma pix`, `crédito`, `/sim`, `/cat saúde`) vira clicável/tocável e executa na hora. No celular isso é o principal.
- Resposta curta por padrão: hoje cada lançamento gera 3–4 linhas ("OK store capturado #3 · T0005 · 1ms", "regra 90%", "* auto"). Quero uma linha legível, ex.: `✓ gasto R$ 46,00 · saúde · farmácia · hoje` + chips das perguntas. Os detalhes técnicos (T0005, ms, %, regra) só com `/detalhes` ligado.
- Menos "era tarefa?": como acertou 6 de 6, quando o palpite for tarefa, crie a tarefa direto e mostre `desfazer` / `era nota` como chips.
- Prazo não é automático. Tarefa sem data na frase fica sem prazo. Prazo só quando eu escrever.
- Mudar prazo e status com frase curta: `t2 sexta`, `t2 05.10`, `t2 feito`, `t2 fazendo` funcionam (hoje viram nota ou tarefa nova).

## 4. Visual: a tela tem que mostrar a minha vida, não a máquina

Hoje a maior parte da tela mostra telemetria do sistema: núcleo animado, satélites CONTEXT/MEMORY/NETWORK/PROCESS/INPUT ("~", "local", "online", "ocioso", "aguardando"), rail esquerdo com "processos 0" e um "fluxo" que repete o terminal, rodapé com ENV/MEM/RT/LAT/SESS/SW/VER. Os meus dados de verdade ocupam um canto do painel direito. Por isso parece pouco visual: o visual existe, mas não mostra nada meu.

Mantém a estética (escuro, verde/ciano, mono, HUD), mas troca o conteúdo:

- Núcleo vira o anel do dia: progresso real (tarefas de hoje feitas/total, vencidas em âmbar).
- Satélites viram as minhas áreas com números reais: TCC, WEG, PESSOAL, DINHEIRO (e depois CORPO). Ex.: "WEG · 4 abertas · 2 vencidas", "DINHEIRO · conta R$ 1.106 · crédito 640/1.500". Tocar no satélite abre a área.
- Telemetria vai pra um modo opcional (`/sistema` ou `/debug`): rede, latência, cache, versão, processos. Fora dele, some do rodapé e do rail esquerdo.
- Gráficos com dados reais onde fizer sentido: gastos por categoria (barras), crédito usado vs limite, tarefas por projeto e por status. Nada inventado; sem dado, estado vazio explicando como alimentar.
- Overview e kanban em painel próprio, ocupando o centro inteiro (no lugar do núcleo + terminal) e não dentro do terminal. Layout responsivo de verdade: colunas que se reorganizam (5 → 3 → 2 → 1) em vez de cortar texto; títulos em até 2 linhas; valores em dinheiro nunca truncados. No celular, kanban vira abas por status (deslizar).
- Atualize a seção "Visual" do `CLAUDE.md` com a nova regra: o silêncio continua, mas o que aparece é dado da minha vida; telemetria é opcional.

## 5. Celular

- Esconder a faixa do núcleo "READY · aguardando operador" e o rodapé de infra no celular (ou reduzir pra uma linha só). Hoje cabeçalho + faixa + rodapé ocupam ~1/4 da tela.
- Barra de atalhos acima do teclado com chips: `hoje`, `mês`, `desfazer`, e os chips da última pergunta.
- Abrir o app no celular deve cair numa tela "Hoje" útil (o que vence hoje + vencidas + gasto do mês), com o campo de escrever embaixo.
- Teste com o teclado aberto (a área visível encolhe) e sem cortes de texto em 390px.

## 6. Finanças: saldo de conta e saldo de crédito

Eu penso o dinheiro em dois saldos separados:

- Conta (débito): entradas − o que sai à vista (pix, débito, dinheiro, boleto) − pagamento de fatura.
- Crédito do mês: eu tenho um valor de crédito por mês pra usar (faz parte da minha estratégia). Cada compra no crédito desconta desse saldo e vai pra fatura.

Regras:

- `/credito 1500` define o crédito do mês (fica valendo pros meses seguintes até eu mudar). Se eu tiver cartão cadastrado, o limite do cartão pode ser sugerido, mas o valor que vale é o que eu definir.
- Compra no crédito → desconta do crédito do mês, entra na fatura, conta nos gastos por categoria.
- Pagar a fatura não é gasto novo, é transferência da conta pro cartão (senão conta duas vezes). Ex.: `paguei a fatura 1.680` / `paguei cartão de crédito 1.680` → sai da conta, categoria "fatura", fora do gráfico de gastos por categoria. Hoje isso entrou como gasto "outros" e virou 79% dos meus gastos do mês.
- HUD e `/mes` mostram os dois: `conta R$ X` e `crédito usado Y de Z (resta W)`, com barra.
- Escreva o plano disso dentro do `docs/plano-ux.md` (ou num `docs/plano-saldos.md`), com exemplos de frases e o resultado esperado na régua `tests/frases.js`.
- Me sugira melhorias nesse modelo se achar algo melhor.

## 7. Revisão rápida das tarefas

- Ao abrir o app (uma vez por dia), se tiver tarefa vencida: "3 tarefas ficaram de ontem" com chips por tarefa: `feito` · `amanhã` · `sexta` · `sem prazo` · `apagar`. Um toque resolve cada uma.
- Nada de bronca, só o aviso.

## 8. Arrumar os meus dados atuais (só com o meu /sim)

Mostre a lista e peça confirmação antes de mexer:

- as notas que eram respostas ou tentativas (`debito`, `débito`, `pix de 270`, `fiz pix de 270`, `pix de $270`, `ajuda`, `inbox`, `gastei $45 na farmácia`): sugerir apagar;
- a tarefa chamada `fazendo` (#tcc): sugerir apagar;
- `paguei cartão de crédito 1.680`: reclassificar como pagamento de fatura;
- `#faculdade` no título da tarefa do comprovante de horas.

## Ordem sugerida (ajuste no plano se fizer sentido)

1. Bugs 1–9 + varredura (com prints antes/depois)
2. Conversa com o terminal (seção 3)
3. Finanças com dois saldos (seção 6)
4. Visual novo no computador (seção 4)
5. Celular (seção 5)
6. Revisão rápida + arrumar dados (seções 7 e 8)

Cada etapa: explique, faça, rode `/tests/`, mostre os prints nos três tamanhos, me diga como testar, commit em português, aumente o `CACHE` do `sw.js`. No fim, atualize o `CLAUDE.md` e o roadmap (esta rodada como "v0.14 · polimento com uso real").
