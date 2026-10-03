# Fase 3d · Finanças: os três saldos (conta, investimentos, cartões)

> Status: **aprovado pelo Vini em 03/10/2026** · etapa 0 feita.
> Ritual de cada etapa: explico antes, função pura + teste, `/tests/` verde, navegador (`/?local`, PC e 375px), `sw.js`, commit em português, `CLAUDE.md`.

## Decisões do Vini (03/10)
- Saldo da conta: **uma conta só**.
- Investimentos: **por lugar** (poupança, tesouro, CDB…).
- Cartões: **os dois** (quanto devo e limite livre).
- Tela: **HUD com os 3 saldos + `/saldo`** (o saldo do mês continua no `/mes`).

## Como cada saldo é calculado (funções puras em `js/financas.js`)

### Âncora: você diz quanto tem, o app segue daí
- Registro escondido `kind: 'saldo'` (só cresce, o mais novo vale): `{ text: 'conta' | 'poupança' | …, data: { onde: 'conta' | <lugar>, valor, data: 'AAAA-MM-DD' } }`.
- `/saldo 2.500` (ou escrever `tenho 2.500 na conta`, `saldo 2.500`) marca a conta · `/saldo poupança 5.000` (ou `tenho 5.000 na poupança`) marca um investimento.
- A partir daí o app soma só o que você **registrar depois** da âncora (pela hora em que foi escrito). Sem âncora → **NA** (o campo não some).
- Reajustar mostra a diferença: `conta R$ 2.430 · eu achava R$ 2.480 · diferença −R$ 50 (algo não foi lançado?)`.

### 1. Conta
`âncora + entradas − gastos à vista (pix, débito, dinheiro, boleto, sem forma) − guardar em investimento + resgatar − faturas pagas`
- **Fatura paga**: no dia do vencimento ela é considerada paga sozinha (sai da conta). Escrever `paguei a fatura do nubank` marca como paga antes (e **não** vira gasto, senão contaria duas vezes).
- Transferência pra investimento sai da conta e entra no lugar; resgate faz o contrário.

### 2. Investimentos, por lugar
`âncora do lugar + o que você guardou − o que resgatou + rendimentos`
- Os lugares vêm das transferências que você já escreve (`transferi 200 pra poupança`, `guardei 100 no tesouro`, `resgatei 300 do cdb`) e das âncoras. "poupança" e "poupanca" são o mesmo.
- Tipo novo `rendimento`: `rendeu 32 na poupança`, `rendimento de 12 no cdb` → soma no lugar; não é entrada do mês nem mexe na conta.
- `/investimentos` lista por lugar, com o total.

### 3. Cartões
- **Devo**: tudo o que ainda não foi pago no cartão: fatura aberta + fechada que ainda não venceu (nem foi marcada paga) + **parcelas futuras**. Por cartão e no total.
- **Livre**: `limite − devo`. O limite é um campo novo do cartão: `/cartao nubank limite 5.000` (sem limite → NA no livre).

## Tela e comandos
- **HUD** (4 linhas): `conta R$ 2.430` · `investido R$ 8.200` · `cartões deve R$ 1.240 · livre R$ 3.760` · `gastos do mês R$ 1.960 +12%`. NA onde não há dado.
- `/saldo`: os três com detalhe (âncora, data, o que mudou desde então) · `/saldo 2.500` · `/saldo poupança 5.000` · `/investimentos` · `/cartoes` ganha devo/limite/livre · `/cartao nubank limite 5.000`.
- `/overview` e `montarContexto`: uma linha `saldos: conta R$ 2.430 · investido R$ 8.200 · cartões deve R$ 1.240`.
- Tudo com `/desfazer` e histórico.

## Régua (frases novas)
`tenho 2.500 na conta` → ajuste de saldo (conta) · `tenho 5.000 na poupança` → ajuste (poupança) · `paguei a fatura do nubank` → pagamento de fatura (não gasto) ·
`rendeu 32 na poupança` → rendimento · `transferi 200 pra poupança` continua transferência · `gastei 45 no ifood` continua gasto.

## Etapas
| # | Etapa | Pronto quando |
|---|---|---|
| 0 | plano em `docs/plano-saldos.md`; `CLAUDE.md`: Fase 3 (3a/3b/3c) **aprovada**, 3d no roadmap, `PHASES` 3 ok + módulo finanças online | commit só de docs |
| 1 | puras: `ancoras`, `saldoConta`, `investimentosPorLugar`, `devoNoCartao`, `faturasPagas` + testes | âncora + movimentos depois dela; fatura paga no vencimento ou quando você diz; parcelas futuras contam no devo |
| 2 | intérprete: ajuste de saldo, pagamento de fatura, rendimento; régua | régua verde; gasto/transferência não mudam |
| 3 | comandos: `/saldo`, `/investimentos`, `/cartao x limite N`, `/cartoes` com devo/livre, diferença ao reajustar | tudo com `/desfazer` |
| 4 | HUD com os 3 saldos, `/overview`, `montarContexto`; 375px | NA sem âncora, valores reais com |
| 5 | fechamento: README, `/ajuda`, v0.14.0, `CLAUDE.md` (saldo real sai do backlog) | você testa |

## Decisões que tomei (mude se discordar)
1. **Só conta o que você registra depois da âncora** (pela hora em que escreveu). Simples e previsível; se esquecer algo, o reajuste mostra a diferença.
2. **Fatura conta como paga no vencimento**, sozinha. "paguei a fatura" só antecipa (pagamento parcial fica pra depois, se precisar).
3. **Rendimento não é entrada do mês** (o dinheiro não passou pela conta); ele só aumenta o investimento.
4. A transferência "pra conta do João" continua sendo pix pra pessoa (gasto), como hoje.

## Riscos
- **"paguei a fatura" virando gasto** (contaria duas vezes): o tipo novo ganha da regra de gasto, e a régua cobre.
- **Saldo divergente do banco** (lançamento esquecido): o reajuste mostra a diferença em vez de esconder.

## Verificação
- `/tests/` verde.
- Navegador (`/?local`): `/saldo 2.500` → `gastei 45 no ifood no pix` (conta 2.455) → `transferi 200 pra poupança` (conta 2.255, poupança +200) →
  `rendeu 3 na poupança` → `/cartao nubank limite 5.000` + `comprei um tênis 300 em 3x` (deve 300, livre 4.700) → `/saldo` → HUD → `/saldo 2.200` (diferença −55).
