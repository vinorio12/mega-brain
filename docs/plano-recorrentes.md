# Fase 3c · Finanças: recorrentes (contas fixas e assinaturas)

> Status: **aprovado pelo Vini em 03/10/2026** · **etapas 1 a 6 feitas (v0.13.0)**, esperando o Vini testar 3a + 3b + 3c. Última parte da Fase 3; o Vini testa 3a + 3b + 3c juntas no fim.
> Ritual de cada etapa: explico antes, função pura + teste, `/tests/` verde, teste no navegador (`/?local`, PC e 375px), `sw.js` (SHELL + CACHE), commit em português, `CLAUDE.md` + roadmap.

## Contexto
Netflix, aluguel, academia, internet: todo mês o Vini digitaria a mesma coisa. O pedido: contas fixas e assinaturas que **se lançam sozinhas
quando o app abre**, com aviso, com opção de **pausar ou cancelar**, **sem nunca duplicar** (celular e PC abrindo no mesmo dia) e,
para conta de valor variável (luz, água), **sem chutar valor**: só lembrar de lançar.

## O que já existe e vai ser reaproveitado
| Peça | Onde | Uso na 3c |
|---|---|---|
| `seedId` (id fixo a partir de um texto) + `restore` = upsert na nuvem | `js/tasks.js`, `js/cloud.js` | id do lançamento = `seedId(dono:recorrente:<id>:<AAAA-MM>)` → dois aparelhos gravam a MESMA linha |
| `ensureSeed()` depois da leitura completa | `js/app.js` | o lançador roda logo depois, no boot e no `/sync` |
| `lerFinanca`, `decidirCategoria`, `decidirForma`, cartões | `js/financas.js`, `js/tipos-financas.js` | ler "netflix 55,90 todo mês dia 15 no nubank" |
| registros por comando com `/desfazer` (categorias, cartões) | `js/comandos-financas.js` | mesmo padrão pra `kind: recorrente` |
| `resumoMes`, faturas, `/mes`, `montarContexto` | `js/financas.js` | lançamentos recorrentes são gastos normais: entram no saldo e nas faturas sem código novo |

## Desenho

### Registro (escondido, sincroniza, RLS igual)
`{ kind: 'recorrente', text: 'netflix', data: { tipo: 'gasto'|'entrada', valor: 5590 | null (variável), dia: 15, categoria, forma, cartao?,
   desde: 'AAAA-MM', status: 'ativa'|'pausada'|'cancelada', pulados: ['AAAA-MM'] } }`

### Criar escrevendo (pelo intérprete, mesmo contrato) ou por comando
- Frase com "todo mês", "todo dia 10", "por mês", "mensal", "mensalidade", "assinatura" + o resto de sempre:
  `netflix 55,90 todo mês dia 15` · `aluguel 1.200 todo dia 5 no pix` · `salário 3.200 todo dia 5` (entrada) · `luz todo mês dia 10` (sem valor = **variável**).
  Vira o tipo novo `recorrente` (registrado em `js/tipos-financas.js`, validado pelo contrato) e **não** um gasto avulso.
- Sem "dia N": usa o dia de hoje. Comando equivalente: `/recorrente nova netflix 55,90 dia 15 [crédito] [nubank] [assinaturas]`.
- **Primeiro mês**: se o dia ainda não chegou, lança quando chegar; **se já passou, começa no mês que vem** (você provavelmente já lançou este à mão) e a linha diz isso.

### O lançador (`pendentesRecorrentes` em `js/financas.js`, puro)
- Pra cada recorrente **ativa** com valor: cada mês de `desde` até hoje (no mês atual, só se o dia já chegou), que não está em `pulados`
  e cujo lançamento (`seedId(...mes)`) ainda não existe → vira um gasto/entrada normal:
  `text: 'netflix (recorrente)'`, `data: { valor, data: AAAA-MM-DD (dia 31 em fevereiro → 28), categoria, forma, cartao, recorrente: <id> }`.
- **Atrasados** (app ficou dias sem abrir): lança os meses que faltaram, até 12 meses pra trás, e avisa quantos.
- Roda depois da leitura completa (boot, login, `/sync`) e na virada do dia com o app aberto. Grava com origem `regra` (histórico sem contar como correção sua).
- **Variável**: não lança nada. Se no mês ainda não há um gasto com o nome dela (ex.: "paguei 120 de luz"), mostra o lembrete; quando você lança, o gasto fica ligado (`data.recorrente`) e o lembrete some.

### Aviso ao abrir (uma vez por abertura, sem travar)
`↳ lancei netflix R$ 55,90 (dia 15) · spotify R$ 21,90 · /recorrentes` · `↳ lembrete: luz (variável) vence dia 10 · escreva "paguei 120 de luz"`

### Pausar, cancelar, editar
- `/recorrentes` lista: valor (ou "variável"), dia, categoria, forma/cartão, status, próximo lançamento, total fixo por mês.
- `/recorrente pausar netflix` · `retomar` (volta a partir deste mês, **sem lançar os meses pausados**) · `cancelar` (para pra sempre; os já lançados ficam) ·
  `/recorrente netflix 59,90` / `dia 20` / `nubank` (editar: vale do próximo lançamento em diante) · `renomear`. Tudo com `/desfazer`.
- **Apagar um lançamento recorrente** (`/apagar f3`, que a 3a não tinha pra dinheiro): apaga e anota o mês em `pulados`, senão o lançador recriaria na próxima abertura.

### Tela e contexto
- `/mes`: linha "recorrentes R$ X (3 lançadas) · 1 lembrete". Na lista, o lançamento recorrente tem um ↻.
- `montarContexto`: "recorrentes R$ 132,80/mês (3) · lembrete: luz". HUD sem linha nova.

### Régua
`netflix 55,90 todo mês dia 15` → recorrente (gasto, 5590, dia 15, assinaturas) · `luz todo mês dia 10` → recorrente variável ·
`salário 3.200 todo dia 5` → recorrente (entrada) · `aluguel 1.200 todo dia 5 no pix` → forma pix ·
`gastei 45 no ifood` continua gasto · `pagar o boleto de 120 amanhã` continua tarefa.

## Etapas
| # | Etapa | Pronto quando |
|---|---|---|
| 0 | plano em `docs/plano-recorrentes.md`, `CLAUDE.md`/roadmap | commit só de docs |
| 1 | puras: `recorrentesDe`, `pendentesRecorrentes(recs, entries, now)` (meses faltando, dia 31, pulados, pausa, 12 meses), `lembretesVariaveis`, `idLancamento` + testes | celular e PC = mesmo id; pausado não lança; mês pulado não volta |
| 2 | intérprete: "todo mês / todo dia N / mensal / assinatura" → tipo `recorrente` (com e sem valor); régua | régua verde; gasto avulso e tarefa futura não mudam |
| 3 | lançador no app: depois do `ensureSeed`, no `/sync` e na virada do dia; aviso; primeiro mês | abrir 2× no mesmo mês não duplica (teste com dois "aparelhos" no Supabase falso) |
| 4 | comandos: `/recorrentes`, `/recorrente nova|pausar|retomar|cancelar|renomear|<nome> valor/dia/cartão`, `/apagar f3` com `pulados` | tudo com `/desfazer`; apagar recorrente não volta |
| 5 | `/mes`, ↻ na lista, lembretes de variável, `montarContexto`; 375px | linhas reais |
| 6 | fechamento: README, `/ajuda`, v0.13.0, `CLAUDE.md` (Fase 3 inteira esperando o teste do Vini) | você testa 3a+3b+3c no celular |

## Decisões que tomei (mude se discordar)
1. **Recorrente criada depois do dia** dela no mês → começa no mês que vem (evita duplicar com o que você já lançou à mão).
2. **Meses perdidos** (app fechado) são lançados, até 12 pra trás, com aviso.
3. **Retomar não lança os meses pausados.**
4. **Editar valor/dia vale daqui pra frente**; lançamentos antigos não mudam (corrige um com `/editar f3`).
5. **Variável é ligada pelo nome**: um gasto no mês com a palavra da recorrente ("luz") conta como lançado.
6. `/apagar f3` passa a valer pra lançamentos de dinheiro (faltava na 3a).

## Riscos
- **Duplicar entre aparelhos**: id fixo por recorrente + mês + upsert; o lançador só roda depois da leitura completa. Teste com dois aparelhos falsos.
- **Lançar sem querer** (frase "todo mês" numa nota): a linha "↳ entendi" mostra "recorrente" e `/desfazer` apaga o cadastro.
- **Histórico em dobro**: os dois aparelhos podem anotar "criada" pro mesmo lançamento; não muda saldo nem memória (origem regra).

## Verificação
- `http://localhost:5174/tests/` verde.
- No navegador (`/?local`): `netflix 55,90 todo mês dia 1` (dia já passado → começa mês que vem) · `spotify 21,90 todo mês dia <hoje>` (lança agora) ·
  recarregar a página (não duplica) · `/recorrente pausar spotify` · `luz todo mês dia 10` (lembrete) → `paguei 120 de luz` (lembrete some) · `/mes` · `/apagar f1` + recarregar (não volta).
