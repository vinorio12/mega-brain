# Fase 3b · Finanças: cartões, fatura e parcelas

> Status: **aprovado pelo Vini em 03/10/2026** · **etapas 1 a 7 feitas (v0.12.0)**, **testada e aprovada pelo Vini em 03/10/2026**. A 3c (recorrentes) vem depois, com plano próprio.
> Ritual de cada etapa: explico antes, função pura + teste, `/tests/` verde, teste no navegador (`/?local`, PC e 375px), `sw.js` (SHELL + CACHE), commit em português, `CLAUDE.md` + roadmap atualizados.

## Contexto
Na 3a o gasto no crédito grava só `forma: credito` e conta no saldo do mês da compra, com aviso de "provisório". Isso só está certo
pra quem paga à vista. O pedido do Vini é que o crédito conte **no mês em que a fatura vence**, com cartões cadastrados (fechamento e
vencimento), e que compras parceladas virem **uma compra só, com as parcelas dentro**, cada uma na fatura do seu mês.

## O que já existe e vai ser reaproveitado
| Peça | Onde | Uso na 3b |
|---|---|---|
| `lerFinanca` (forma, lugar, verbo…) · `findValor` | `js/financas.js` · `js/valores.js` | ganham "em 3x" / "3x de 100" e o nome do cartão ("no nubank") |
| `tipoFinanceiro`, `decidirForma` | `js/tipos-financas.js` | parcelado é gasto no crédito; cartão pela frase, pela memória ou o padrão |
| `resumoMes`, `hudFinancas`, `linhaContexto` | `js/financas.js` | o saldo passa a usar as faturas que vencem no mês |
| memória por campo (`decidirPorPistas`) | `js/memoria.js` | campo novo `cartao` (ifood → nubank) |
| registros semeados/editados por comando (categorias) | `js/comandos-financas.js` | mesmo padrão pra `kind: cartao` |
| `/mes`, `/gastos`, `/editar f3`, `/cat`, `/forma`, f1… | `js/comandos-financas.js` | `/fatura`, `/cartao`, `/editar f3 3x`, `/editar f3 nubank` |

## Desenho

### Cartões (registro escondido, sincroniza, RLS igual)
`{ kind: 'cartao', text: 'nubank', data: { fechamento: 3, vencimento: 10, padrao: true, arquivado: false } }`.
- `/cartao novo nubank fecha 3 vence 10 [padrão]` (o primeiro já nasce padrão) · `/cartao padrao inter` · `/cartao nubank fecha 5 vence 12` (editar) · `/cartao renomear` · `/cartao arquivar` · `/cartoes` lista com a próxima fatura de cada um. Tudo com `/desfazer`.
- O gasto no crédito guarda `data.cartao: <id>`. Qual cartão: nome na frase ("no nubank", "no cartão do inter") → memória (ifood → nubank) → o padrão.
- **Sem cartão nenhum cadastrado**: continua como na 3a (mês da compra + aviso) e a linha sugere `/cartao novo`.
- **Gastos no crédito sem cartão** (os da 3a): usam o cartão padrão **na hora de ler**, sem reescrever nada. `/editar f3 inter` muda.

### Em que fatura cai (`mesDaFatura` em `js/financas.js`, pura)
- A fatura que **fecha** no dia F do mês M pega as compras de F do mês anterior até F−1 de M. **Compra no próprio dia do fechamento cai na fatura seguinte** (é o "melhor dia de compra" dos bancos; você pediu que eu decidisse).
- O mês da fatura é o mês do **vencimento**: vencimento depois do fechamento → mesmo mês; antes (ex.: fecha 28, vence 5) → mês seguinte.
- Dia que o mês não tem (fecha 31 em fevereiro) → último dia do mês.

### Parcelas
- "tênis 300 em 3x" = 300 no total · "fone 3x de 100" = 3 de 100 · "100 em 3x no cartão" → total 100.
- Grava **uma compra só**: `data.valor` = total, `data.parcelas` = 3. Os valores das parcelas **não são gravados**, saem de `parcelasDe(total, n)` (centavos, a sobra na primeira: 10000 em 3x = 3334 + 3333 + 3333). Corrigir valor, número de parcelas ou categoria → as parcelas acompanham sozinhas.
- Parcelado sem forma escrita = **crédito** (não pergunta forma).
- Parcela k (1..n) entra na fatura do mês `mesDaFatura(compra) + (k−1)`.
- Na lista aparece **uma linha**: `f3 · 03.10 · R$ 300,00 · vestuário · nubank 3x` ; na fatura aparece a parcela do mês: `tênis · 2/3 · R$ 100,00`.

### Saldo do mês (como você pediu)
`saldo = entradas do mês − (pix + débito + dinheiro + boleto + sem forma do mês) − faturas que vencem no mês`.
`resumoMes` passa a separar: `aVista` (o que sai no mês) e `faturas: [{ cartao, total, vence: 'AAAA-MM-DD' }]`.
O aviso "crédito provisório" some quando existe cartão.

### Telas e comandos
- `/fatura [cartão] [mês]`: fatura do mês (padrão: a próxima a vencer) com fechamento, vencimento, total e as linhas (parcelas com "2/3"). Sem argumento e com vários cartões: uma tabela curta com o total de cada um.
- `/mes`: a linha "gastos" vira "à vista" + "faturas que vencem" (por cartão, com o dia do vencimento). As categorias contam **as parcelas do mês**, não a compra cheia.
- `/gastos`: a compra parcelada aparece uma vez, com "3x".
- `/editar f3 3x` (muda parcelas, `1x` tira) · `/editar f3 nubank` (muda cartão). Entram no histórico (`rastrear` ganha `cartao` e `parcelas`).
- HUD: as mesmas 4 linhas (saldo já considera as faturas). `/overview` e `montarContexto` citam a próxima fatura: `fatura nubank R$ 420,00 vence 10.10`.

### Régua (frases 19–22)
- 19 `comprei um tênis 300 em 3x` → gasto · 30000 · vestuário · crédito · parcelas 3
- 20 `fone 3x de 100` → gasto · 30000 · crédito · parcelas 3
- 21 `100 em 3x no cartão` → gasto · 10000 · crédito · parcelas 3 (e `parcelasDe(10000, 3)` = [3334, 3333, 3333] num teste unitário)
- 22 compra no crédito depois do fechamento → teste unitário de `mesDaFatura` (e no dia do fechamento → fatura seguinte)

## Etapas
| # | Etapa | Pronto quando |
|---|---|---|
| 0 | plano em `docs/plano-cartoes.md`, `CLAUDE.md`/roadmap | commit só de docs |
| 1 | puras: `parcelasDe`, `mesDaFatura`, `vencimentoDa`, `cartoesDe` (registros), `cartaoPadrao` + testes | arredondamento, fechamento no dia/depois, mês curto, vencimento antes do fechamento |
| 2 | intérprete: "em 3x" / "3x de 100" em `lerFinanca`, cartão pelo nome na frase, parcelado = crédito; régua 19–21 | régua verde (as 27 frases) |
| 3 | cartões por comando: `/cartoes`, `/cartao novo|padrao|editar|renomear|arquivar`; memória ganha o campo `cartao`; captura grava `data.cartao` | cadastrar, trocar padrão, desfazer; "no inter" escolhe o inter |
| 4 | fatura e saldo: `resumoMes` com à vista + faturas, `/fatura`, `/mes` novo, aviso provisório só sem cartão | frase 22 e o saldo do jeito pedido, testados com datas fixas |
| 5 | listas e correção: `/gastos` com "3x", `/editar f3 3x | nubank`, histórico | corrigir valor/parcelas recalcula as faturas; `/desfazer` volta |
| 6 | HUD/overview/contexto com a próxima fatura; 375px | linhas reais, NA sem dado |
| 7 | fechamento: README, `/ajuda`, v0.12.0, `CLAUDE.md` | você testa no celular e aprova; aí vem o plano da 3c |

## Decisões que tomei (mude se discordar)
1. **Compra no dia do fechamento → fatura seguinte.**
2. **As parcelas não são gravadas uma a uma**: só total e quantidade. Assim nunca dessincronizam quando você corrige algo.
3. **Gasto no crédito sem cartão usa o padrão na hora de ler** (os da 3a entram sozinhos na fatura do cartão padrão quando você cadastrar o primeiro).
4. **Parcelado sem forma = crédito**, sem perguntar.
5. **"no nubank"** (nome de cartão cadastrado) já diz crédito + qual cartão.
6. As categorias do `/mes` contam o que **pesou no mês** (a parcela), não a compra inteira.

## Riscos
- "3x" em outras frases ("treinei 3x essa semana"): só vira parcela com valor junto e frase de dinheiro; treino continua treino (régua cobre).
- Mudar o saldo da 3a: os números do `/mes` mudam quando o primeiro cartão é cadastrado; a linha do `/mes` explica ("crédito agora conta na fatura").
- Nome de cartão igual a palavra comum ("inter", "c6"): só vale depois de "no/na/do cartão" ou no fim da frase.

## Verificação
- `http://localhost:5174/tests/` (título `✓ N`), só chaves `mb.test.*`.
- No navegador (`/?local`): `/cartao novo nubank fecha 3 vence 10` → `comprei um tênis 300 em 3x` → `/fatura` (100 em cada uma das 3 faturas) → `/mes` (saldo com a fatura que vence) → `/editar f1 600` (parcelas viram 200) → `/desfazer`.
- Datas fixas nos testes pra fechamento/vencimento (incluindo virada de ano e fevereiro).
