Bora pra fase 3 do Mega Brain: finanças. Antes de codar, entra em modo de planejamento, lê o CLAUDE.md inteiro e o que a gente fez nas fases 1, 2 e 2.5 (docs/plano-interprete.md e docs/plano-pessoas-memoria.md), e me devolve um plano em etapas pequenas. Só começa depois que eu aprovar.

## Divisão
A fase tem três partes, cada uma com plano aprovado separado:
- 3a: lançamento, categorias, aprendizado, visão do mês e HUD
- 3b: cartões, fatura e parcelas
- 3c: recorrentes

## Ideia
Plugar finanças no intérprete da fase 2, sem criar caminho paralelo. Gasto e entrada já são reconhecidos (js/tipos-financas.js, valor em centavos) e agora ganham regras, telas e comandos próprios. Tudo no mesmo contrato de resposta (js/tipos.js), então continua plug and play pra IA. Comandos novos de finanças ficam em arquivo próprio (ex: js/comandos-financas.js), porque o commands.js já está grande.

## Vocabulário semente
- Verbos de gasto: gastei, paguei, comprei, torrei, saiu, custou, deu.
- Verbos de entrada: recebi, ganhei, caiu, entrou, me pagou.
- "saiu", "deu" e "custou" só contam junto com um valor ("deu ruim" e "saiu o resultado" não são gasto).
- Formas de pagamento: pix, crédito, débito, dinheiro, boleto. "no cartão" = crédito no cartão padrão. Sem forma informada, usa uma padrão e marca como automática.
- Categorias de gasto: alimentação, mercado, transporte, moradia, saúde, educação, vestuário, lazer, assinaturas e outros.
- Categorias de entrada: salário, freela, reembolso e outros.
- Posso criar, renomear e arquivar categorias por comando.

## Campos
Valor, categoria, lugar ou descrição, data, forma de pagamento e, se aparecer, pessoa (mesmo cadastro da fase 2.5).

## Direção do dinheiro
- Pix pra uma pessoa é gasto. Pix de uma pessoa ("pix do Pedro", "o João me pagou 30") é entrada.
- Transferência entre as minhas contas (poupança, investimento) não é gasto nem entrada e não mexe no saldo.
- Estorno ou reembolso volta como entrada ligada ao gasto, quando der pra saber qual.
- Frase no futuro ("pagar o boleto de 120 amanhã") continua sendo tarefa, não gasto.

## Aprendizado
A memória da fase 2.5 (js/memoria.js) hoje aprende pessoa/palavra → projeto. Generaliza pra aprender qualquer campo: lugar → categoria, palavra → categoria, pessoa → categoria, palavra → forma de pagamento. Mesmas regras: peso (o app decidiu 1, eu escrevi 2, eu corrigi 3), só vota quem domina, pistas divididas = não chuta e me pergunta, e /memoria mostra e edita (/memoria ifood = alimentação). Se eu escrevo ifood e confirmo alimentação, ele grava; se eu sempre corrijo posto pra transporte, ele passa a acertar sozinho. Verbo novo de gasto ou entrada só entra no vocabulário depois do meu /sim (ex: "aprender 'abasteci' como gasto?"), nunca sozinho.

## Saldo do mês
Saldo = entradas do mês − (pix, débito e dinheiro do mês + faturas que vencem no mês). Não é o saldo da conta no banco.

## O que já existe
Os gastos e entradas gravados desde a v0.9 (dado bruto) ganham categoria pela memória ou por pergunta, sem perder a frase original.

## Cartões e fatura (3b)
Cadastro de cartões com nome, dia de fechamento e dia de vencimento, e um cartão padrão. Gasto no crédito conta no mês da fatura (o mês em que ela vence), não no mês da compra. Compra depois do fechamento cai na fatura seguinte; compra no próprio dia do fechamento, decide no plano e me diz.

## Parcelas (3b)
"tênis 300 em 3x" (300 no total) e "3x de 100" viram uma compra só, com as parcelas dentro, em centavos e com o arredondamento na primeira (100 em 3x = 33,34 + 33,33 + 33,33). Cada parcela entra na fatura do seu mês. Na lista eu vejo a compra uma vez; se eu corrigir valor ou categoria, as parcelas acompanham.

## Recorrentes (3c)
Contas fixas e assinaturas que se repetem todo mês sem eu digitar de novo, lançadas quando eu abrir o app, com aviso, e opção de pausar ou cancelar. Cada lançamento usa um id fixo por recorrente + mês, pra nunca duplicar se o celular e o PC abrirem no mesmo dia. Conta de valor variável (luz, água) não lança valor chutado: me lembra de lançar.

## Tela e HUD
No HUD, poucas linhas (regra dos 85–90% de silêncio): saldo do mês, total gasto, as categorias que mais pesaram e a comparação com o mês passado. Uma visão do mês por categoria e uma visão da fatura de cada cartão, funcionando no celular. Comandos pra ver o mês, filtrar por categoria e corrigir lançamento, com /desfazer.

## Testes
Amplia a régua (tests/frases.js) com as frases abaixo, do meu jeito de escrever. Elas são a referência: o que cada uma deve virar está depois da seta. Se alguma não fizer sentido no desenho, me pergunta antes de mudar.

Gastos do dia a dia
1. gastei 45 no ifood → gasto · R$ 45,00 · alimentação · lugar ifood
2. mercado 87 → gasto · R$ 87,00 · mercado
3. uber 18,50 → gasto · R$ 18,50 · transporte
4. almoço 32 no débito → gasto · R$ 32,00 · alimentação · débito
5. farmácia R$ 42,30 → gasto · R$ 42,30 · saúde
6. paguei 120,50 de luz → gasto · R$ 120,50 · moradia
7. saiu 1.234,56 o aluguel → gasto · R$ 1.234,56 · moradia
8. torrei 150 no bar ontem → gasto · R$ 150,00 · lazer · data de ontem
9. deu 64 o rodízio com a Ana → gasto · R$ 64,00 · alimentação · pessoa Ana
10. paguei o boleto da faculdade 890 → gasto · R$ 890,00 · educação · boleto
11. comprei livro do tcc 89 no crédito → gasto · R$ 89,00 · educação · crédito no cartão padrão
12. netflix 55,90 → gasto · R$ 55,90 · assinaturas

Pix, pessoas e entradas
13. fiz um pix de 50 pro João → gasto · R$ 50,00 · pix · pessoa João
14. pix de 80 do Pedro → entrada · R$ 80,00 · pix · pessoa Pedro
15. o João me pagou 30 → entrada · R$ 30,00 · pessoa João
16. caiu o salário 3.200 → entrada · R$ 3.200,00 · salário
17. recebi 1.500 do freela → entrada · R$ 1.500,00 · freela
18. transferi 200 pra poupança → transferência · R$ 200,00 · não mexe no saldo

Parcelas e cartão
19. comprei um tênis 300 em 3x → gasto · R$ 300,00 no total · vestuário · crédito · 3 parcelas de R$ 100,00
20. fone 3x de 100 → gasto · R$ 300,00 no total · crédito · 3 parcelas de R$ 100,00
21. 100 em 3x no cartão → parcelas de R$ 33,34 + 33,33 + 33,33
22. compra no crédito depois do fechamento → entra na fatura do mês seguinte

Pegadinhas
23. abasteci 200 no posto → verbo que o app ainda não conhece: salva como nota e pergunta "era gasto?"; depois do meu /sim, vira gasto de transporte e oferece aprender "abasteci"
24. estorno de 45 do ifood → entrada · R$ 45,00 · reembolso · ligada ao gasto do ifood
25. deu ruim a prova → nota (não é gasto)
26. saiu o resultado da prova → nota (não é gasto)
27. pagar o boleto de 120 amanhã → tarefa com prazo amanhã (é futuro, não gasto)

## Histórico e contexto
Tudo segue a regra da fase 2: nenhuma mudança sobrescreve sem deixar histórico (os campos novos entram no rastrear do tipo). O montarContexto() passa a incluir um resumo financeiro curto do mês (totais e categorias, não cada lançamento).

## Padrão
Mantém o padrão do projeto. No fim de cada etapa, testa, faz commit e atualiza o CLAUDE.md e o roadmap, deixando no backlog: importar extrato do banco em CSV ou OFX pra conferir os lançamentos com o real; saldo real das contas; rachar conta entre pessoas.
