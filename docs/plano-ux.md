# v0.14 · polimento com uso real (UX, bugs e dois saldos)

> Status: **aprovado pelo Vini em 08/10/2026**, com as mudanças da seção "Decisões do Vini" · **feito até a etapa 4.5 (v0.14.7)** · próxima: etapa 5 (visual), 6 (celular), 7 (`/revisar` + `/arrumar`, que corrige o "paguei cartão de crédito 1.680" antigo), 8 (fechamento) · pedido completo em `docs/prompt-ux-uso-real.md`.
> Nada de funcionalidade nova além do pedido. Ritual de cada etapa: explico antes → faço → `/tests/` verde → prints **antes e depois** em 1440×900, 1280×720 e 390×844 → como testar → `sw.js` (`CACHE`) → commit em português → `CLAUDE.md`.
> Versão: cada etapa sobe um número (v0.14.1, v0.14.2…), porque a v0.14.0 já é a da 3d. No roadmap a rodada aparece como "v0.14 · polimento com uso real".

## O que eu já reproduzi (08/10, modo local, com as suas frases)

| # | Bug | Reproduzi? | Causa encontrada |
|---|---|---|---|
| 1 | painel direito sobreposto em 1280×720 | ✓ "marcar dentista" em cima de "ambiente" | a lista do contexto não tem limite de altura e transborda |
| 2 | overview cortando tudo | ✓ até em 1440×900 ("gastos R$ 2.0…") | 5 colunas fixas + toda linha com reticências |
| 3 | overview no celular sem finanças | ✓ | o overview ocupa só a faixa do núcleo; o resto fica atrás do terminal |
| 4 | kanban dentro do terminal | ✓ 2 cartões por vez, colunas de 190px | o kanban é "impresso" no terminal |
| 5 | `- trabalhar no tcc #tcc amanhã !alta` → título `…#tcc!alta`, sem prioridade | ✓ | ao tirar "amanhã", o leitor de datas apaga o espaço antes de `!` (regra feita pra vírgula e ponto) e `#tcc!alta` vira uma palavra só |
| 6 | `#faculdade` fica no título e o projeto é chutado | ✓ (aqui foi pra #pessoal; aí foi pra #weg pela memória) | tag que não é projeto é ignorada pelo leitor e sobra no texto |
| 7 | descrição = verbo (`paguei 270` → "paguei") | ✓ | a limpeza da descrição só tira o verbo se vier algo depois dele |
| 8 | `$45` não é valor | ✓ | o `$` está na lista de "caracteres que não podem vir antes de um número" |
| 9 | `pix de 270` vira nota | ✓ | pix só virava gasto com pessoa ("pro João") |

**Achados extras** (a varredura completa vem na etapa 2):
- `paguei cartão de crédito 1.680` vira **gasto no crédito** "outros": entra no mês **e** na fatura (conta duas vezes). A 3d só reconhece "paguei **o** cartão" e só com cartão cadastrado.
- `debito` depois do "forma?" vira nota porque as perguntas de dinheiro só aparecem na tela; elas não entram na fila que o `/sim` usa.
- Tarefa com tag desconhecida aparece com duas tags na lista (`#faculdade #pessoal`).
- A lista de tarefas mostra `trabalhar no tcc!alta` (consequência do bug 5).
- O boot diz "local · 55 entradas" e logo depois "memória local · 21 entradas" (um conta os registros escondidos, o outro não).
- Rodapé cortado mesmo em 1440 ("RT NA" pela metade). Some na etapa 5.
- Console sem erros nas telas que abri.

---

## Etapas

### Etapa 1 · Bugs do leitor (5 a 9) · só lógica, com testes
- **Valores**: aceitar `$45`, `$ 45`, `r$45`, `R$ 45`, `45 reais`, `45 conto(s)`. Teste em `tests/run.js`.
- **Espaço antes de marcador**: tirar a data (ou o valor) do meio da frase nunca cola `!alta`, `#tcc`, `@fazendo`, `>sex` na palavra anterior. Teste com a sua frase exata.
- **Descrição sem verbo**: `paguei 270` → descrição vazia. Na tela aparece "sem descrição", nunca "paguei".
- **Pix sem pessoa**: `pix de 270`, `fiz pix de 270`, `pix de $270` → gasto, forma pix, pessoa opcional. "pix **do** Pedro" continua entrada.
- **Tag desconhecida** (`#faculdade`): sai do título; a tarefa fica **sem projeto** e aparece a pergunta `↳ #faculdade não é projeto · /sim cria e move · /nao`. (Não chuta outro projeto.)
- Régua `tests/frases.js`: as frases que viraram lixo entram com o resultado certo.

### Etapa 2 · Bugs da tela (1 a 4) + varredura
- **Painel direito** (bug 1): a lista do contexto ganha altura máxima; o que não cabe vira "+3 · /tarefas". Nada passa por cima de nada em 1280×720.
- **Overview e kanban em painel próprio** (bugs 2, 3, 4): os dois deixam de ficar dentro do terminal/faixa do núcleo e passam a ocupar **o centro inteiro** (núcleo + terminal somem enquanto estão abertos; `esc` ou qualquer comando volta). O campo de escrever continua embaixo.
  - colunas que se reorganizam pela largura: 5 → 3 → 2 → 1, em vez de espremer;
  - títulos em até 2 linhas (corta só na 3ª);
  - **dinheiro nunca corta** (valor não quebra e não leva reticências; quem encolhe é o rótulo);
  - kanban no celular = abas por status (`a fazer · fazendo · esperando · feito`), deslizando o dedo troca a aba.
- **Varredura**: rodo cada comando do `/ajuda` nos 3 tamanhos, olho o console e te entrego a lista do que achei. Conserto aqui o que for pequeno; o que for maior vira item do plano ou do backlog (te aviso).

### Etapa 3 · Conversa com o terminal (seção 3)
- **Fila única de perguntas**: "forma?", "categoria?", "era tarefa?", "é uma pessoa?", "projeto?", "#faculdade não é projeto" entram todas na mesma fila. Enquanto tem pergunta pendente, a resposta pode vir **sem barra**: `debito`, `débito`, `pix`, `crédito`, `saúde`, `sim`, `s`, `não`, `n`. Só vale se a palavra for uma resposta válida; qualquer outra coisa é lida normalmente (e a pergunta continua ali).
- **Comando sem barra**: quando a frase inteira é **só** o nome de um comando (`ajuda`, `inbox`, `hoje`, `mes`, `mês`, `desfazer`, `tarefas`…), ele roda, com a linha `rodei /ajuda · pra guardar como nota use nota: ajuda`.
- **Chips tocáveis**: tudo que hoje é sugestão em ciano (`/forma pix`, `crédito`, `/sim`, `/cat saúde`, `/editar t3`) vira botão: um clique/toque executa na hora.
- **Resposta em uma linha**: `✓ gasto R$ 46,00 · saúde · farmácia · hoje` + chips das perguntas. Tarefa: `✓ tarefa t3 · trabalhar no tcc · #tcc · amanhã · !alta`. Os detalhes técnicos (T0005, ms, %, regra, `* auto`) só com **`/detalhes`** ligado (fica lembrado neste aparelho).
- **Menos "era tarefa?"**: quando o palpite é tarefa, ela é criada direto, com os chips `desfazer` · `era nota`. (Palpite de gasto/entrada continua perguntando, porque dinheiro errado bagunça o mês.)
- **Prazo não é automático**: tarefa sem data na frase fica **sem prazo**. A prioridade padrão continua "média", mas não gera prazo.
- **Concluir falando**: `hoje concluí t1, t2, t3`, `fiz t2`, `terminei t1 e t4` concluem as tarefas (um passo só no `/desfazer`).
- **Frase curta pra mudar tarefa**: `t2 sexta`, `t2 05.10`, `t2 amanhã`, `t2 sem prazo`, `t2 feito`, `t2 fazendo`, `t2 esperando` (qualquer status cadastrado). Entra no `/desfazer` e no histórico.

### Etapa 4 · Finanças: conta, crédito e a tela de finanças (seção 6) · **feita (v0.14.6)** · detalhes logo abaixo

### Etapa 4.5 · `/ajuda` enxuta (pedido do Vini, 08/10) · **feita (v0.14.7)**
Hoje o `/ajuda` despeja todos os comandos numa lista só. Vira um menu curto:
- o que dá pra **escrever sem barra** (3–4 exemplos: tarefa, gasto, "t2 sexta", link);
- as **áreas** como botões (tarefas · dinheiro · pessoas · notas e acervo · sistema): tocar numa área mostra só os comandos dela, curtos, com exemplo;
- `/ajuda mes` continua detalhando um comando; a lista completa de antes fica em `/ajuda tudo`.

### Etapa 5 · Visual novo no computador (seção 4)
Mesma estética (escuro, verde/ciano, mono, HUD), conteúdo trocado: a tela mostra a sua vida.
- **Núcleo = anel do dia**: tarefas de hoje feitas/total (verde), vencidas como arco âmbar, número no meio ("3/5"). O núcleo continua reagindo (digitando, gravando), só que discreto.
- **Satélites = suas áreas**, com números reais: `TCC · 3 abertas · 1 vencida` · `WEG · 4 abertas · 2 vencidas` · `PESSOAL · 2 abertas` · `DINHEIRO · conta R$ 1.106 · crédito 640/1.500`. Tocar abre a área (`/ir tcc` + lista; DINHEIRO abre o `/mes`). Os satélites seguem os projetos que você tem (até 4 + dinheiro); CORPO entra na Fase 4.
- **Rail esquerdo vira "hoje"**: o que vence hoje + vencidas (com chip `feito`), e tarefas por projeto e por status em barrinhas.
- **Rail direito**: contexto (o que o Enter vai fazer, ou tarefas relevantes) + dinheiro (conta, crédito usado vs. o do mês em barra, gastos por categoria em barras) + dia e clima.
- **Telemetria opcional**: `/sistema` liga/desliga rede, latência, cache, versão, processos, fluxo, módulos e o rodapé de infraestrutura. Desligado (padrão), nada disso aparece.
- **Gráficos só com dado real**; sem dado, o lugar fica com uma frase de como alimentar ("escreva `gastei 30 no almoço`").
- `CLAUDE.md` seção Visual reescrita com a regra nova: o silêncio continua, mas o que aparece é dado da sua vida; telemetria é opcional.

### Etapa 6 · Celular (seção 5)
- Some a faixa "READY · aguardando operador" e o rodapé de infra (o estado vira um pontinho no cabeçalho).
- **Barra de chips acima do teclado**: `hoje` · `mês` · `desfazer` + os chips da última pergunta.
- **Abrir cai na tela "Hoje"**: vence hoje + vencidas + gasto do mês (e crédito restante), com o campo de escrever embaixo.
- Testo com o teclado aberto (a área visível encolhe) e sem corte de texto em 390px.

### Etapa 7 · Revisão rápida + arrumar os dados (seções 7 e 8)
- **`/revisar`** (abre sozinho uma vez por dia se tiver vencida, dá pra pular): `3 tarefas ficaram pra trás · vamos uma por uma?` e mostra **uma de cada vez** com os chips `feito` · `amanhã` · `sexta` · `semana que vem` · `sem prazo` · `apagar`. Um toque resolve e aparece a próxima, até "pronto, nada vencido". Sem bronca. (`apagar` pede confirmação, como hoje.)
- **`/arrumar`**: procura e **lista**, sem mexer em nada:
  - notas que eram resposta ou tentativa (`debito`, `pix de 270`, `ajuda`, `inbox`, `gastei $45 na farmácia`…) → sugere apagar (as que agora seriam gasto, sugere trocar pra gasto);
  - tarefa com nome de status (`fazendo` #tcc) → sugere apagar;
  - gasto que era pagamento de fatura (`paguei cartão de crédito 1.680`) → sugere reclassificar;
  - tag desconhecida no título (`#faculdade`) → sugere tirar e criar o projeto ou não;
  - tarefas abertas com **prazo automático** antigo (as que você adiou em lote) → sugere tirar o prazo.
  - Você responde `/sim` (tudo), `/arrumar 1 3` (só esses) ou `/nao`. Tudo entra no `/desfazer`. O comando é genérico (procura padrões), então serve de novo se acontecer.

### Etapa 8 · Fechamento
README, `/ajuda` (comandos novos: `/detalhes`, `/sistema`, `/credito`, `/financas`, `/revisar`, `/arrumar`), `CLAUDE.md` (Visual, roadmap "v0.14 · polimento com uso real", formato do registro novo), backlog.

---

## Finanças: conta, crédito e a tela de finanças (etapa 4)

### O modelo (decisões do Vini, 08/10)
- **Conta** = o dinheiro no banco. Continua como na 3d: você diz quanto tem uma vez (`/saldo 2.500`) e o app soma o que vier depois: **+ entradas − gastos à vista (pix, débito, dinheiro, boleto) − pagamentos de fatura**. Sem `/saldo`, aparece `conta NA · /saldo 2.500 acerta com o banco` (chip tocável).
- **Crédito** = um limite seu (a sua estratégia), não o do banco. `/credito 1500` define e vale até você mudar.
  - **Pelo ciclo da fatura**: a sua fecha dia **29** e você paga dia **5**. Compra até o dia 28 cai na fatura que fecha no 29; compra no dia 29 ou depois, na seguinte (a mesma regra da 3b).
  - **Funciona como limite de verdade**: cada compra no crédito ocupa o valor **total** (parcelada também: `tênis 300 em 3x` ocupa 300 na hora). Quando uma fatura é paga, a parte dela (as parcelas daquele ciclo) **volta** pro crédito.
  - **usado** = tudo o que ainda não foi pago (fatura aberta + fechada não paga + parcelas futuras) · **resta** = crédito − usado. É a mesma conta do "deve" da 3d (`devoNoCartao`), só que contra o valor que você escolheu.
  - O ciclo vem do cartão cadastrado. Sem cartão, o `/credito` pede o ciclo uma vez: `/credito 1500 fecha 29 vence 5`.
  - Compra **parcelada no boleto** (carnê) conta igual: é gasto planejado, ocupa o crédito e vai liberando a cada parcela. *(Entendi assim o que você falou; se não for isso, me corrige.)*
- **Pagar a fatura** não é gasto: é a conta pagando o cartão. Sai da conta, libera o crédito, aparece no `/mes` como "fatura paga", **fora** dos gastos e do gráfico por categoria. Funciona com o valor que você escreveu. Sem você escrever nada, a fatura conta como paga sozinha no vencimento (dia 5), como na 3d.

### Frases e comandos
| Você escreve | Resultado |
|---|---|
| `/credito 1500` | crédito = R$ 1.500 (registro escondido `kind: 'credito'`, `data: { valor, fechamento?, vencimento? }`) |
| `/credito` | `crédito · usado R$ 640 de R$ 1.500 · resta R$ 860` + barra + o que ocupa (fatura aberta, fechada, parcelas futuras). Sem valor definido e com cartão cadastrado: sugere o limite do cartão |
| `ifood 54,90 no crédito` | gasto crédito · `✓ gasto R$ 54,90 · alimentação · crédito · resta R$ 805,10` |
| `tênis 300 em 3x` | gasto crédito parcelado · ocupa R$ 300 de uma vez · `resta R$ 505,10` |
| `paguei a fatura 1.680` | fatura paga R$ 1.680 · sai da conta · libera o crédito · não é gasto |
| `paguei cartão de crédito 1.680` | igual (hoje vira gasto "outros" no crédito) |
| `paguei o cartão 1.680` · `fatura 1.680 paga` | igual |
| `paguei a fatura do nubank` (sem valor, cartão cadastrado) | como na 3d: marca paga com o total que o app calculou |
| `paguei 1.680 no cartão` | **gasto** no crédito (é compra no cartão, não pagamento de fatura) |
| `gastei 45 no débito` | gasto à vista · sai da conta · não mexe no crédito |

Na régua (`tests/frases.js`): `paguei a fatura 1.680` e `paguei cartão de crédito 1.680` → `{ tipo: 'faturapaga', campos: { valor: 168000 } }` (sem cartão) · `paguei 1.680 no cartão` → `{ tipo: 'gasto', campos: { forma: 'credito' } }`. A frase antiga `paguei a fatura 1.200` → gasto (decisão da 3d) passa a ser fatura paga.

### Tela de finanças (pedido do Vini, 08/10)
- Uma tela própria, no centro (como o overview), que abre tocando no satélite DINHEIRO, no bloco de dinheiro do painel, ou com `/financas` (o `/mes` continua no terminal).
- Começa simples, só com dado real:
  - topo: **conta** e **crédito** (barra usado/resta, com a próxima fatura e o dia que vence);
  - **gráfico de barras dos gastos por categoria** do mês (a fatura paga fica fora);
  - **gastos dia a dia** do mês (barrinhas por dia, pra ver o ritmo);
  - últimos lançamentos (f1, f2…) com os chips de corrigir.
- Sem dado: cada bloco diz como alimentar (`escreva gastei 30 no almoço`).
- No celular, os blocos empilham, sem corte.

### HUD e `/mes`
- **Painel direito e `/mes`**: `conta R$ 1.106` · `crédito 640 de 1.500 · resta 860` com barra · `gastos do mês R$ 960 +12%` · `investido` (só se você tiver). O "deve no cartão / livre" sai do HUD (virou o próprio crédito) e continua no `/saldo` e no `/cartoes`.
- `/mes` ganha a linha `fatura paga R$ 1.680 (saiu da conta · não é gasto)` e o gráfico por categoria deixa de ter a fatura.
- O "saldo do mês" antigo do `/mes` vira **"sobra do mês"**, pra não confundir com o saldo da conta.
- **Aviso gentil** (aprovado): a linha de cada compra no crédito diz quanto resta; passando de 80% fica âmbar, passando de 100% `passou R$ 40 do seu crédito`. Sem bronca.
- **Fatura paga com diferença** (aprovado, só com cartão cadastrado): `R$ 140 de compras que não estão no app`, igual ao reajuste do `/saldo`.

---

## Decisões do Vini (08/10)
1. **Crédito pelo ciclo da fatura** (fecha 29, paga 5).
2. **Parcelado ocupa o total** e vai liberando a cada fatura paga (lógica de limite). Parcelado no boleto conta igual.
3. Aviso gentil e diferença da fatura: entram.
4. **Frases naturais, além do comando sem barra**: `hoje concluí t1, t2, t3` (também `fiz t2`, `terminei t1 e t4`, `t3 feito`) conclui as tarefas; `preciso ir no mercado`, `preciso comprar pão` viram tarefa direto, sem perguntar; `hoje foi um dia bom` continua nota. Nome de comando sozinho (`ajuda`, `mes`) roda o comando.
5. **`/arrumar` oferece tirar o prazo automático** das tarefas antigas (só com `/sim`). Em palavras simples: as tarefas que ganharam prazo sozinhas (sem você escrever data) vencem do nada; o `/arrumar` mostra quais são e, se você quiser, deixa elas sem prazo.
6. **Vencidas, uma por uma**: `/revisar` (etapa 7).
7. **Fase 3d aprovada.**
8. **O foco é dar vontade de abrir**: captura rápida no celular (comprou → abre → escreve → fecha) e uma tela bonita de olhar. O visual (etapas 5 e 6) é a parte mais importante da rodada e vai com cuidado de design, não só conserto.
9. Backlog: **contar o dia falando** (um parágrafo ou 2–3 minutos de voz: o app conclui tarefas, cria as novas, lança os gastos e os hábitos). Depende da IA ligada.

## Riscos
- **Resposta sem barra pegando frase normal**: só vale com pergunta pendente **e** palavra que é resposta válida daquela pergunta. Teste cobre `débito` com e sem pergunta.
- **Comando sem barra engolindo nota**: só a frase inteira igual ao nome do comando; `nota: ajuda` sempre guarda.
- **Visual novo grande demais**: a etapa 5 vai em pedaços (núcleo → satélites → rails → `/sistema`), cada um com print e commit.
- **"paguei … cartão" ambíguo**: "paguei **o/a** cartão/fatura" = pagamento; "paguei X **no** cartão" = compra. Régua cobre os dois lados.

## Verificação (em toda etapa)
- `/tests/` verde (o título da aba mostra ✓ N).
- Navegador em `/?local` com as suas frases reais (as 10 que viraram lixo + as de tarefa), nos 3 tamanhos, com print antes/depois.
- Console sem erros.
