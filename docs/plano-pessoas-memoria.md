# Pessoas + memória que aprende (Fase 2.5)

> Status: **proposta, esperando o Vini aprovar** (02/10/2026). Mesmo ritual das outras fases: uma etapa por vez,
> testes verdes, `sw.js`, commit em português, `CLAUDE.md` atualizado. Nada de IA: tudo por regras e pelo uso.

## O que o Vini pediu
1. Escrever normal ("falar com o João sobre a planilha") e o app **reconhecer pessoas** já cadastradas, por nome ou apelido. Sem `@` (o `@` é do status).
2. **Nome novo**: o app pergunta se é uma pessoa; confirmou, cadastra.
3. "esperando o João", "aguardando a Ana" → status **esperando** + pessoa marcada.
4. Comandos pra **ver tudo de uma pessoa**, **editar** e **juntar cadastros** (João e Jão são a mesma pessoa).
5. **Uma memória só**, pra pessoas e palavras-chave, que aprende com o uso: guarda em que projeto cada pessoa/palavra aparece e usa como pista.
   João quase sempre na WEG → tarefa nova com João provavelmente é WEG. Corrigir "planilha" pra WEG sempre → o app passa a associar sozinho.
   Toda confirmação ou correção atualiza. **Pistas divididas, sem um projeto dominante → não chuta** (usa outras pistas da frase ou pergunta).
   Dá pra **editar a associação por comando**.

## Desenho

### Pessoas (`js/pessoas.js`, funções puras)
- Registro escondido `kind: 'pessoa'` (sincroniza, RLS igual): `{ text: 'João Silva', data: { apelidos: ['joão', 'jão'], arquivada, juntada_em } }`.
- Cada entrada (tarefa, nota, gasto…) ganha `data.pessoas: [id, ...]`. **O texto fica como você escreveu.**
- `findPessoas(texto, pessoas)`: acha nomes e apelidos como palavra inteira, sem ligar pra acento ou maiúscula, inclusive nome composto ("João Pedro").
  Dois cadastros com o mesmo apelido → a memória escolhe pelo projeto; se nem ela souber, pergunta.
- **Nome novo** (`candidatoPessoa`): palavra com maiúscula no meio da frase ("falar com Ana"), ou palavra depois de "com / pro / pra / da / do / esperando / aguardando / ligar pro / falar com" ("falar com ana", que é como se digita no celular),
  que não é dia, mês, projeto, status nem palavra comum. Linha: `↳ Ana é uma pessoa? /sim cadastra · /nao ignora`.
- **Esperando alguém**: "esperando (o|a)", "aguardando (o|a)", "esperando retorno/resposta d(o|a)", "depende d(o|a)" + pessoa → status `esperando` (o status com esse nome no registro) e a pessoa marcada. O texto continua o que você escreveu.

### Memória única (`js/memoria.js`, funções puras)
Uma **pista** é uma pessoa (`pessoa:<id>`) ou uma palavra (`palavra:planilha`). A memória sabe, pra cada pista, **em quais projetos ela apareceu e com que força**:

| De onde vem | Peso |
|---|---|
| tarefa com a pista, projeto decidido pelo app e não corrigido | 1 |
| tarefa com a pista, projeto escrito por você (`#weg`, aba) ou `/sim` | 2 |
| **correção**: você mudou o projeto (`/mover`, `/editar`, `/tipo`), lido do histórico | 3 |
| **fixar por comando** (`/memoria planilha = weg`) | manda sempre |
| **bloquear** (`/memoria planilha -tcc`) / **limpar** (esquece o passado da pista) | — |

- **Derivada, não copiada:** a contagem sai das tarefas e do histórico que já existem (etapa 3 da Fase 2). Corrigiu uma tarefa → a próxima leitura já sabe. Nada de contador separado que dessincroniza entre aparelhos.
  Só o que você **fixa/bloqueia/limpa** vira registro (`kind: 'memoria'`, só cresce, o mais novo vale).
- **As palavras-chave do `/palavras` entram aqui** como "fixar" (o que já foi cadastrado continua valendo). `/palavras` vira atalho do `/memoria`.
- **Dominância:** uma pista só vota se o projeto mais forte tem **≥ 70% do peso e pelo menos 3 de peso**. Ex.: João = weg 8, tcc 1 → vota weg. João = weg 3, tcc 3 → dividida, não vota.
- **Decidir o projeto da tarefa**, nesta ordem: escrito (`#weg`, aba) → nome do projeto na frase → pistas dominantes (somadas; se duas pistas fortes discordam, não decide) → nada.
  **Nada decidiu = não chuta**: a tarefa fica sem projeto e a linha pergunta `↳ projeto? João: weg 3 · tcc 3 · /mover t4 weg`.
- A linha "↳ entendi" mostra o motivo: `#weg* (João: 8 de 9 na weg)`.

### Comandos
| Comando | Faz |
|---|---|
| `/pessoas` | lista quem está cadastrado, com quantas coisas ligadas e o projeto mais comum |
| `/pessoa João` | tudo ligado à pessoa: abertas, esperando ela, notas, gastos, projetos em que aparece, últimas mudanças |
| `/pessoa nova Ana [apelido ...]` · `/pessoa apelido João +jão -joãozinho` · `/pessoa renomear João João Silva` | cadastro |
| `/pessoa juntar Jão João` | junta os dois: apelidos somam, as entradas do Jão passam a apontar pro João (com `/desfazer`) |
| `/pessoa arquivar Ana` | some das sugestões; as entradas continuam como estão |
| `/sim` · `/nao` | responde a última pergunta do app (pessoa nova, ou "era tarefa?") |
| `/memoria [pista]` | o que o app aprendeu: `planilha → weg 7 · tcc 1 (weg 88%)` |
| `/memoria planilha = weg` · `-tcc` · `limpar` | fixa, bloqueia ou zera a associação |

## Etapas
| # | Etapa | Pronto quando |
|---|---|---|
| 0 | este plano aprovado | Vini aprova |
| 1 | `js/pessoas.js`: registro, `findPessoas`, `candidatoPessoa` + testes | nomes, apelidos, acento, composto, ambíguo, "não é pessoa" (dia, mês, projeto) |
| 2 | cadastro: `/pessoas`, `/pessoa nova|apelido|renomear|juntar|arquivar` com `/desfazer` | juntar religa as entradas; desfazer volta tudo |
| 3 | intérprete marca pessoas (`data.pessoas` em todo tipo) + "esperando o João" → `esperando` + frases na régua | régua verde com frases de pessoas |
| 4 | nome novo pergunta; `/sim` e `/nao` (valem também pro "era tarefa?") | "falar com ana" → pergunta → `/sim` cadastra e liga a entrada |
| 5 | `/pessoa João`: tudo de uma pessoa | mostra abertas, esperando, notas, projetos, histórico |
| 6 | `js/memoria.js`: pistas derivadas com peso + dominância; `guessProject` usa; dividida = não chuta; `/palavras` vira parte | João 8×weg → weg; 3×3 → sem projeto + pergunta; correção pesa 3 |
| 7 | `/memoria` ver/fixar/bloquear/limpar + motivo na linha "↳ entendi" | fixar manda; limpar esquece o passado |
| 8 | contexto e IA: `montarContexto` cita "esperando João (2)"; pedido da IA leva os nomes cadastrados (só nome e apelido); fechamento, README, v0.10 | Vini testa no celular e aprova |

## Decisões que tomei (mude se discordar)
1. **Texto fica como você escreveu** ("falar com o João"); a pessoa vai em `data.pessoas`. Assim a busca e a leitura continuam naturais.
2. **Pistas divididas e nada mais na frase → tarefa sem projeto + pergunta**, em vez do `pessoal` de hoje. (Hoje, sem pista nenhuma, vai pra `pessoal`; isso continua.)
3. **A pergunta não trava** (como o `/tipo`): é uma linha; `/sim` responde a última.
4. **Memória derivada do que já existe** + registros só pro que você fixa. Nada de contador que pode divergir.
5. Limiar de dominância **70% e peso ≥ 3**, ajustável em `config.js`.
6. "comecei a fazer X" / "tô fazendo X" → `fazendo`. Só esperando/aguardando/depende de mudam o status por frase; o resto segue `a fazer`.

## Riscos
- **Falso nome** ("falar com Itaú", "pro Santander"): por isso só pergunta, nunca cadastra sozinho; `/nao` faz ele não perguntar de novo por essa palavra.
- **Prévia a cada tecla mais pesada** (memória lê as tarefas): calcular uma vez por mudança dos dados, não por tecla.
- **Juntar cadastros** mexe em várias entradas: tudo num passo só do `/desfazer`, e cada mudança entra no histórico.
