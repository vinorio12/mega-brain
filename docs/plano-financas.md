# Fase 3a · Finanças: lançamento, categorias, aprendizado, visão do mês e HUD

> Status: **aprovado pelo Vini em 02/10/2026** · etapa 0 feita. A 3b (cartões, fatura, parcelas) e a 3c (recorrentes) ganham planos próprios.
> Ritual de cada etapa: explico antes, função pura + teste, `/tests/` verde, teste no navegador (PC e 375px), `sw.js` (SHELL + CACHE), commit em português, `CLAUDE.md` + roadmap atualizados.

## Decisões do Vini (02/10)
- Forma de pagamento não informada e a memória não sabe: **pergunta** (`/forma pix`), não usa padrão.
- Crédito na 3a (antes dos cartões): **conta no mês da compra**, com aviso de provisório.
- Gasto sem pista de categoria: **grava em outros e pergunta qual é de verdade** (`/cat alimentação`).

## Contexto
Desde a v0.9, "gastei 30 no almoço" já vira `kind: gasto` com valor em centavos, mas é só dado bruto: sem categoria, sem forma de pagamento, sem tela, e "uber 18,50" ainda vira nota com pergunta. A 3a pluga finanças **no mesmo intérprete** (sem caminho paralelo), generaliza a memória da 2.5 pra aprender categoria e forma, e traz a visão do mês, o saldo e o HUD.

## O que já existe e vai ser reaproveitado
| Peça | Onde | Uso na 3a |
|---|---|---|
| `lerMovimento`, tipos `gasto`/`entrada` | `js/tipos-financas.js` | ganham categoria, forma, lugar, ligação do estorno |
| `findValor`/`fmtValor` (centavos) · `findDate` | `js/valores.js` · `js/dates.js` | valor e "ontem" |
| contrato + `validarInterpretacao` + `registrarTipo` | `js/tipos.js` | tipo novo `transferencia`; campos novos (enum de forma) |
| memória com peso/dominância, registros `kind: memoria` | `js/memoria.js` | vira genérica: pista → **campo** (projeto, categoria, forma, tipo) |
| `pessoasNaFrase` | `js/pessoas.js` | pix pro/do João, "rodízio com a Ana" |
| `withHistory` / `diffEvent` | `js/historico.js` | hoje só rastreia tarefa → passa a usar `REGISTRO.rastrear()` |
| fila `S.perguntas`, `/sim` `/nao`, `/tipo`, `S.undo` | `js/commands.js` | perguntas novas: categoria dividida, forma, "aprender verbo" |
| `seedId`/`seedEntries`, `registry()` | `js/tasks.js` | categorias semeadas com id fixo (dois aparelhos não duplicam) |
| `parseMonth` | `js/views.js` | `/mes out`, `/mes -1` |
| `montarContexto` + `resumo()` dos tipos | `js/contexto.js` | linha financeira do mês |

## Desenho

### Dados (sem migração: tudo em `data` jsonb)
- `gasto` / `entrada`: `data: { valor, descricao, data, categoria, forma, lugar?, pessoas?, ref? (id do gasto estornado), auto: { campos: [...] } }`. `text` continua a frase original.
- Kind novo de conteúdo **`transferencia`** (`data: { valor, conta: 'poupança', sentido: 'para'|'de', data }`): aparece nas listas e na busca, **não entra no saldo**. Entra em `CONTENT_KINDS`.
- Registro escondido **`kind: categoria`** (`text: nome`, `data: { tipo: gasto|entrada, ordem, arquivada }`), semeado com `seedId` como os projetos.
  Gasto: alimentação, mercado, transporte, moradia, saúde, educação, vestuário, lazer, assinaturas, outros · Entrada: salário, freela, reembolso, outros.
- Forma: enum `pix | credito | debito | dinheiro | boleto`. Na 3a "crédito" e "no cartão" gravam `forma: credito` (o cartão entra na 3b).

### Regras do intérprete (`js/financas.js` puro + `js/tipos-financas.js`)
- **Vocabulário semente**: verbos de gasto (gastei, paguei, comprei, torrei, saiu, custou, deu) e de entrada (recebi, ganhei, caiu, entrou, me pagou). **saiu/deu/custou só valem com o valor logo depois** ("deu 64", "saiu 1.234,56"); "deu ruim", "saiu o resultado" continuam nota.
- **Sem verbo**: frase que **começa** com palavra conhecida (semente ou memória: mercado, uber, farmácia, netflix, almoço…) + valor → gasto 0.85. (Por isso "uber 18,50" e "almoço R$ 32,90", que hoje na régua são "nota + pergunta", passam a ser gasto, como você pediu na frase 3.)
- **Futuro nunca é gasto**: começa com verbo no infinitivo (pagar, comprar) ou data futura → segue tarefa (frase 27).
- **Verbo desconhecido** + valor + pista de categoria em outro lugar ("abasteci 200 no posto") → sinal fraco 0.6 → nota + "era gasto?". `/sim` → vira gasto (transporte, pelo "posto") e pergunta **"aprender 'abasteci' como gasto? /sim"**. Só com esse segundo `/sim` o verbo entra (registro `memoria` com `chave: verbo:abasteci`, `campo: tipo`). Nunca sozinho.
- **Direção**: "pix … pro/pra <pessoa>" = gasto · "pix … do/da <pessoa>" e "<pessoa> me pagou" = entrada · "transferi/guardei/apliquei … pra poupança/investimento/reserva" = `transferencia` (pra uma **pessoa** é gasto via pix) · "resgatei … da poupança" = transferência de volta.
- **Estorno/reembolso**: "estorno de 45 do ifood" → entrada, categoria reembolso, `ref` = o gasto mais recente com o mesmo lugar/palavra (valor igual tem preferência, até 60 dias). Não achou → entrada sem ligação, e a linha diz.
- **Lugar**: "no/na/em <palavra>" que não é forma nem pessoa ("no ifood", "no bar", "no posto").
- **Forma**: palavra na frase (pix, crédito, cartão, débito, dinheiro, boleto) → senão a memória (ifood → crédito) → **senão pergunta** (sua escolha): grava sem forma e a linha diz `↳ forma? /forma pix · crédito · débito · dinheiro · boleto`. Responder ensina a memória (peso 2), então a pergunta some rápido pros lugares de sempre. No saldo, "sem forma" conta como saída no mês e o `/mes` mostra "N sem forma". (`FINANCAS.formaPadrao` em `config.js`, `null` = perguntar; dá pra trocar por `'pix'` depois.)

### Memória generalizada (`js/memoria.js`)
- A pista (pessoa, palavra, lugar = palavra) passa a votar num **campo**: `projeto` (como hoje), `categoria` (separada por gasto/entrada), `forma`, e `tipo` (verbos aprendidos, só fixados).
- Mesmos pesos derivados do que já existe: app decidiu 1 · você escreveu/confirmou 2 · você corrigiu (lido do histórico) 3 · `/memoria … = …` manda. **Padrão não é evidência**: `outros` sem pista e forma sem pista valem 0 (senão o padrão se reforça sozinho).
- Mesma dominância (≥70% e peso ≥3). Decidir categoria: fixado → memória dominante → semente → **`outros*` + pergunta** (sua escolha: grava em outros pra não travar, mas pergunta qual é de verdade): `↳ categoria? salvei em outros · qual é? /cat alimentação · lazer · …`. **Pistas divididas ou em conflito → sem categoria + pergunta** `↳ categoria? ifood: alimentação 3 · lazer 3 · /cat alimentação`.
- `/cat <categoria>` responde a pergunta da categoria (igual ao `/forma`); responder conta como "você escreveu" (peso 2), então a mesma palavra não pergunta de novo depois de poucas vezes. Ignorar a pergunta não tem problema: fica em outros.
- API antiga intacta (`info(k)` = projeto, `decidirProjeto` igual) → os 362 testes atuais seguem valendo.
- `/memoria ifood = alimentação` · `/memoria ifood = crédito` · `/memoria posto -lazer` · `/memoria` lista agrupado: projetos · categorias · formas · verbos aprendidos.

### Histórico
`withHistory` passa a usar `REGISTRO.rastrear()` (hoje só a tarefa tem histórico). Gasto/entrada/transferência rastreiam `valor, descricao, data, categoria, forma, lugar, pessoas, ref`. É daí que sai o peso 3 da correção.

### Saldo do mês (`saldoMes` em `js/financas.js`)
`saldo = entradas do mês − (pix + débito + dinheiro + boleto + sem forma do mês + crédito)`. **Na 3a o crédito conta no mês da compra** (sua escolha), com aviso "provisório até cadastrar cartões"; na 3b passa a contar no mês da fatura. Transferência fica fora. Não é o saldo do banco.

### Tela, comandos e HUD (`js/comandos-financas.js`, arquivo novo)
- Número próprio dos lançamentos: **f1, f2…** (da última lista, como t1 nas tarefas).
- Linha após salvar: `↳ entendi · gasto · R$ 45,00 · alimentação* · crédito · ifood · hoje · /desfazer ou /editar f3` (* = auto, motivo da memória entre parênteses, como nos projetos).
- `/mes [mês]` (`/fin`): saldo, entradas, gastos, categorias com barra de texto e %, comparação com o mês passado (+12%), "N sem forma", aviso do crédito provisório. Funciona em 375px.
- `/gastos [categoria] [mês]` · `/entradas [mês]`: lista numerada f1… (filtra por categoria).
- `/editar f3 alimentação | 45,90 | débito | ontem | "descrição"`: cada pedaço é lido pelo jeito (categoria, valor, forma, data); com `/desfazer` e histórico. `/forma pix` responde a pergunta da forma.
- `/categorias` · `/categoria nova pets [entrada]` · `/categoria renomear mercado = supermercado` (renomeia nos lançamentos também, num passo do `/desfazer`) · `/categoria arquivar pets`.
- `/categorizar`: os gastos/entradas antigos (dado bruto da v0.9) ganham categoria pela memória num passo só do `/desfazer`; os que ela não sabe viram perguntas, uma por vez. A frase original não muda.
- HUD (rail direito, poucas linhas): saldo do mês · gasto do mês e vs mês passado · 3 categorias que mais pesaram. Módulo "finanças" vira online. `/overview` ganha um bloco de finanças. No celular, o `/mes` é a tela.
- `montarContexto`: uma linha do mês (`finanças out: entradas R$ X · gastos R$ Y · saldo R$ Z · top: alimentação, mercado, transporte · vs set +12%`), sem lançamentos individuais.

## Etapas
| # | Etapa | Pronto quando |
|---|---|---|
| 0 | este plano em `docs/plano-financas.md`; `CLAUDE.md`/roadmap com 3a/3b/3c; `PHASES` | commit só de docs |
| 1 | `js/financas.js` puro: categorias (semente + `categoriasDe`), vocabulário, `lerFinanca` (valor, data, forma, lugar, direção, verbo) + testes | frases soltas lidas certo nos testes unitários |
| 2 | intérprete: `gasto`/`entrada` novos + tipo `transferencia`; regras (sem verbo, saiu/deu/custou, futuro, pix pro/do, me pagou, estorno com `ref`, verbo desconhecido fraco); categoria pela semente; histórico pelo registro; `CONTENT_KINDS`; **régua com as frases 1–18 e 23–27** (2 linhas antigas ajustadas) | régua verde; 27 = tarefa; 25/26 = nota |
| 3 | memória generalizada (campo) + `decidirCategoria`/`decidirForma`; padrão vale 0; verbos aprendidos | testes: ifood confirmado → alimentação; posto corrigido 3× → transporte; dividida → pergunta; testes antigos verdes |
| 4 | tela da captura: linha "↳ entendi" de finanças, f1…, perguntas (categoria em outros/dividida, forma, "era gasto?" → "aprender verbo?"), `/cat`, `/forma`, `/tipo transferencia`, estorno mostra o gasto ligado | frase 23 inteira no navegador: nota → /sim → gasto transporte → /sim → próxima "abasteci 50" já é gasto |
| 5 | `js/comandos-financas.js`: `/mes`, `/gastos`, `/entradas`, `/editar f3 …`, `/memoria … = categoria|forma` | corrigir pelo `/editar` volta no `/desfazer` e pesa 3 na memória |
| 6 | categorias por comando + `/categorizar` (dado antigo) | renomear/arquivar desfazem; antigos ganham categoria sem perder a frase |
| 7 | HUD + overview + `montarContexto` com o mês; conferência em 375px | HUD com 3–4 linhas reais; "NA" quando não há dado |
| 8 | fechamento: `/ajuda` grupo "finanças", README, v0.11.0, `CLAUDE.md` (3a feita; backlog mantém extrato CSV/OFX, saldo real, rachar conta) | você testa no celular e aprova; aí vem o plano da 3b |

## Decisões que tomei (mude se discordar)
1. **Transferência é um kind próprio** (aparece, não mexe no saldo), não um gasto marcado.
2. **Boleto e "sem forma" contam como saída no mês**, junto com pix/débito/dinheiro.
3. **Lugar é uma palavra-pista** como as outras (não um tipo de pista separado): `/memoria ifood = alimentação` funciona igual.
4. Frase 11 ("no crédito") e "no cartão": na 3a grava `forma: credito`; o "cartão padrão" chega na 3b.
5. Prévia para 3b: compra **no próprio dia do fechamento cai na fatura seguinte** (é o "melhor dia de compra" dos bancos). Confirmo no plano da 3b.
6. Frases 19–22 (parcelas, fatura) entram na régua só na 3b.

## Riscos
- **Gasto criado sem querer** pela regra "sem verbo" (ex: "mercado 2 coisas"): só vale se a frase **começa** pela palavra conhecida; verbo no infinitivo/data futura bloqueia; linha "↳ entendi" + `/desfazer` + `/tipo nota`.
- **Refatorar a memória** (fluxo de projetos já aprovado): API antiga mantida e toda a suíte antiga como rede; etapa 3 não mexe em tela.
- **Perguntas de forma e categoria no começo** vão aparecer bastante até a memória aprender (uma por vez, nunca travam o prompt); `FINANCAS.formaPadrao` permite trocar por um padrão sem código novo.

## Verificação
- `powershell -NoProfile -ExecutionPolicy Bypass -File tools/serve.ps1` → `http://localhost:5173/tests/` (título `✓ N`, zero falhas; só chaves `mb.test.*` e Supabase falso).
- Por etapa: digitar as frases da régua no terminal (navegador interno, PC e 375px) e conferir "↳ entendi", `/desfazer`, `/editar f3`, `/memoria`, `/mes`.
- Etapa 2/5: conferir que `/mudancas` mostra o histórico de um gasto corrigido.
- Etapa 7: HUD com dados reais e "NA" sem dados; `/contexto` com a linha do mês.
