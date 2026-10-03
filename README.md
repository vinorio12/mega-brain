# MB Core

Ambiente operacional de inteligência pessoal: um terminal com um núcleo vivo, em vez de um app com botões.
Tudo entra escrevendo, do seu jeito: notas, tarefas, gastos, treinos, links e textos. Matrix na austeridade, Jarvis na inteligência, Unix na interação.
Instalável no celular e no PC (PWA), com dados na nuvem e acesso só do dono.

```
MB CORE v0.14.0                                 ■ READY  ⇅ ON  ◫ NUVEM  ⋮ 18° 94%
› ligar pro dentista amanhã
18:03 OK  task   tarefa t4 · ligar pro dentista · T0007 · 84ms
          ↳ entendi · tarefa · #pessoal* · >amanhã · !média* · * auto · regra 80% · /desfazer ou /editar t4
```

## O que dá pra fazer

| Escrevendo | Acontece |
|---|---|
| `qualquer texto #tag` | guarda uma nota |
| `ligar pro dentista amanhã` · `preciso entregar o relatório dia 15` | vira tarefa, com o prazo lido da frase |
| `gastei 45 no ifood` · `caiu o salário 3.200` · `fiz um pix de 50 pro João` | lança gasto ou entrada com categoria, forma e pessoa (veja Finanças) |
| `treinei peito 1h` | guarda o treino (dado bruto; telas na Fase 4) |
| `- revisar cap 2 #tcc @fazendo >sex !alta` | sempre tarefa (projeto, status, prazo, prioridade). O que faltar, o app decide |
| `https://… contexto #tag` · `"texto curto` | guarda o link ou o texto no acervo |
| `nota: …` | guarda como nota, sem tentar entender |
| `/tipo tarefa` · `/tipo gasto #3` | corrige o que o app entendeu (sem número: a última coisa escrita) |
| `esperando o João mandar o orçamento` · `falar com a Ana amanhã` | reconhece quem já está cadastrado (sem @); "esperando/aguardando" vira @esperando |
| `/sim` · `/nao` | responde a última pergunta do app ("Carla é uma pessoa?", "era tarefa?") |
| `/pessoas` · `/pessoa João` · `/pessoa juntar Jão com João` | quem está cadastrado, tudo de uma pessoa, editar e juntar cadastros |
| `/memoria` · `/memoria planilha = weg` · `/memoria ifood = alimentação` | o que o app aprendeu (pessoa/palavra → projeto, categoria, forma) e como corrigir |
| `/saldo` · `/mes` · `/gastos alimentação` · `/fatura nubank` · `/recorrentes` · `/cat f3 lazer` · `/forma pix` | o mês em dinheiro, a lista numerada, a fatura do cartão, as contas fixas e as correções |
| `/palavras tcc +orientador` | palavras que puxam a tarefa pro projeto (atalho do `/memoria`) |
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

## Pessoas e memória

Escreva normal: quem está cadastrado (nome, primeiro nome ou apelido, sem ligar pra acento) fica ligado à entrada.
Nome novo → "↳ Carla é uma pessoa? /sim". O app aprende em que projeto cada pessoa e cada palavra aparece
(você escreveu vale 2, você corrigiu vale 3) e usa isso como pista: João quase sempre na WEG → tarefa nova com João vai pra WEG,
com o motivo na linha "↳ entendi". Pista dividida entre projetos não chuta: a tarefa fica sem projeto e o app pergunta.
`/memoria` mostra e corrige tudo isso.

## Finanças

Escreva como fala: `gastei 45 no ifood`, `mercado 87`, `uber 18,50`, `fiz um pix de 50 pro João`, `caiu o salário 3.200`,
`transferi 200 pra poupança`, `estorno de 45 do ifood`. O app tira valor (em centavos), data, categoria, forma de pagamento,
lugar e pessoa, e mostra na linha "↳ entendi" com um número (f1, f2...).

- **Direção do dinheiro:** pix *pro* alguém é gasto, pix *do* alguém ou "me pagou" é entrada; transferência pra poupança ou investimento
  não mexe no saldo; estorno volta como entrada ligada ao gasto; frase no futuro ("pagar o boleto de 120 amanhã") continua tarefa.
- **Categoria e forma aprendem pelo uso**, na mesma memória dos projetos: ifood → alimentação, posto → transporte, ifood → crédito.
  Quando o app não sabe, salva e pergunta (`/cat alimentação`, `/forma pix`); a resposta vira pista pro próximo.
  Verbo novo ("abasteci") só entra no vocabulário depois do seu `/sim`.
- **Cartões e parcelas:** `/cartao novo nubank fecha 3 vence 10` (o primeiro vira o padrão). `comprei um tênis 300 em 3x`,
  `fone 3x de 100` e `almoço 40 no nubank` vão pra fatura certa: compra antes do fechamento entra na fatura do mês; no dia do
  fechamento ou depois, na seguinte. Uma compra parcelada aparece uma vez na lista ("crédito nubank 3x") e cada parcela
  (centavos, a sobra na primeira: 100 em 3x = 33,34 + 33,33 + 33,33) entra na fatura do seu mês.
- **Saldo do mês** = entradas − o que sai à vista no mês (pix, débito, dinheiro, boleto) − as faturas que vencem no mês.
  Não é o saldo do banco. Sem cartão cadastrado, o crédito conta no mês da compra.
- Comandos: `/mes [-1]` · `/gastos [categoria] [mês]` · `/entradas` · `/fatura [cartão] [+1]` · `/cartoes` · `/cartao novo|padrao|renomear|arquivar` ·
  `/editar f3 45,90 débito ontem` · `/editar f3 3x` · `/editar f3 inter` · `/categorias` · `/categoria nova|renomear|arquivar` ·
  `/categorizar` (dá categoria aos lançamentos antigos) · `/memoria ifood = alimentação` · `/memoria ifood = nubank`.

- **Os três saldos** (o que você tem de verdade, no painel da direita e no `/saldo`): diga quanto tem uma vez
  (`/saldo 2.500` ou `tenho 2.500 na conta`, `tenho 5.000 na poupança`) e o app segue somando o que você lança depois.
  **Conta**: entradas − gastos à vista − o que guarda + o que resgata − faturas pagas (sozinhas no vencimento, ou
  antes com `paguei a fatura do nubank`, que não vira gasto). **Investimentos por lugar**: guardei, resgatei e `rendeu 32 na poupança`
  (`/investimentos`). **Cartões**: quanto ainda deve (com as parcelas futuras) e o limite livre (`/cartao nubank limite 5.000`).
  Corrigir o saldo mostra a diferença do que o app calculava (pra achar o que não foi lançado).
- **Recorrentes:** `netflix 55,90 todo mês dia 15`, `aluguel 1.200 todo dia 5 no pix`, `salário 3.200 todo dia 5` cadastram uma conta fixa
  que o app lança sozinho quando abre (↻), com um id fixo por mês: celular e PC nunca duplicam. Conta de valor variável
  (`luz todo mês dia 10`) não chuta valor: o app lembra até você escrever "paguei 120 de luz". `/recorrentes` lista;
  `/recorrente pausar | retomar | cancelar netflix` e `/recorrente netflix 59,90` editam; `/apagar f3` apaga um lançamento (e o mês não volta).

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
| `js/tipos.js`, `js/tipos-base.js`, `js/tipos-financas.js`, `js/tipos-corpo.js` | contrato + registro de tipos (nota, tarefa, link, trecho, gasto, entrada, transferência, treino) |
| `js/financas.js`, `js/comandos-financas.js` | finanças: leitura da frase, categorias, o mês e o saldo · os comandos e telas de dinheiro |
| `js/dates.js`, `js/valores.js` | datas faladas e valores em reais (centavos) |
| `js/historico.js`, `js/aprendizado.js`, `js/contexto.js` | histórico de mudanças, frases não entendidas e o resumo pra IA |
| `js/pessoas.js`, `js/memoria.js` | pessoas reconhecidas na frase e a memória que aprende projeto, categoria e forma pelo uso |
| `js/tasks.js`, `js/views.js` | tarefas (modelo, regras automáticas) e visões |
| `js/acervo.js` | links e textos guardados, busca em tudo |
| `js/cloud.js`, `js/store.js` | memória na nuvem (com cache e fila offline) e local |
| `supabase/*.sql` | estrutura do banco, rodada no SQL Editor do Supabase |
| `tests/` | testes que rodam no navegador · `tests/frases.js` é a régua do intérprete |
| `docs/` | planos e passo a passo |
