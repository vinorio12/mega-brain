Bora pra fase 3 do Mega Brain: finanças. Antes de codar, entra em modo de planejamento, lê o CLAUDE.md inteiro e o que a gente fez nas fases 1, 2 e 2.5 (docs/plano-interprete.md e docs/plano-pessoas-memoria.md), e me devolve um plano em etapas pequenas. Só começa depois que eu aprovar.

Divide a fase em três partes, cada uma com plano aprovado separado:
- 3a: lançamento, categorias, aprendizado, visão do mês e HUD
- 3b: cartões, fatura e parcelas
- 3c: recorrentes

A ideia é plugar finanças no intérprete da fase 2, sem criar caminho paralelo. Gasto e entrada já são reconhecidos (js/tipos-financas.js, valor em centavos) e agora ganham regras, telas e comandos próprios. Tudo no mesmo contrato de resposta (js/tipos.js), então continua plug and play pra IA. Comandos novos de finanças ficam em arquivo próprio (ex: js/comandos-financas.js), porque o commands.js já está grande.

Vocabulário semente:
- Verbos de gasto: gastei, paguei, comprei, torrei, saiu, custou, deu.
- Verbos de entrada: recebi, ganhei, caiu, entrou, me pagou.
- "saiu", "deu" e "custou" só contam junto com um valor ("deu ruim" e "saiu o resultado" não são gasto).
- Formas de pagamento: pix, crédito, débito, dinheiro, boleto. "no cartão" = crédito no cartão padrão. Sem forma informada, usa uma padrão e marca como automática.
- Categorias padrão: alimentação, mercado, transporte, moradia, saúde, educação, vestuário, lazer, assinaturas e outros. Posso criar, renomear e arquivar por comando.

Campos: valor, categoria, lugar ou descrição, data, forma de pagamento e, se aparecer, pessoa (mesmo cadastro da fase 2.5).

Direção do dinheiro:
- Pix pra uma pessoa é gasto. Pix de uma pessoa ("pix do Pedro", "o João me pagou 30") é entrada.
- Transferência entre as minhas contas (poupança, investimento) não é gasto nem entrada e não mexe no saldo.
- Estorno ou reembolso volta como entrada ligada ao gasto, quando der pra saber qual.

Aprendizado: a memória da fase 2.5 (js/memoria.js) hoje aprende pessoa/palavra → projeto. Generaliza pra aprender qualquer campo: lugar → categoria, palavra → categoria, pessoa → categoria, palavra → forma de pagamento. Mesmas regras: peso (o app decidiu 1, eu escrevi 2, eu corrigi 3), só vota quem domina, pistas divididas = não chuta e me pergunta, e /memoria mostra e edita (/memoria ifood = alimentação). Se eu escrevo ifood e confirmo alimentação, ele grava; se eu sempre corrijo posto pra transporte, ele passa a acertar sozinho. Verbo novo de gasto ou entrada só entra no vocabulário depois do meu /sim (ex: "aprender 'rachei' como gasto?"), nunca sozinho.

Saldo do mês = entradas do mês − (pix, débito e dinheiro do mês + faturas que vencem no mês). Não é o saldo da conta no banco.

Os gastos e entradas que já existem (dado bruto desde a v0.9) ganham categoria pela memória ou por pergunta, sem perder a frase original.

Cartões e fatura (3b): cadastro de cartões com nome, dia de fechamento e dia de vencimento, e um cartão padrão. Gasto no crédito conta no mês da fatura (o mês em que ela vence), não no mês da compra. Compra depois do fechamento cai na fatura seguinte; compra no próprio dia do fechamento, decide no plano e me diz.

Parcelas (3b): "tênis 300 em 3x" (300 no total) e "3x de 100" viram uma compra só, com as parcelas dentro, em centavos e com o arredondamento na primeira (100 em 3x = 33,34 + 33,33 + 33,33). Cada parcela entra na fatura do seu mês. Na lista eu vejo a compra uma vez; se eu corrigir valor ou categoria, as parcelas acompanham.

Recorrentes (3c): contas fixas e assinaturas que se repetem todo mês sem eu digitar de novo, lançadas quando eu abrir o app, com aviso, e opção de pausar ou cancelar. Cada lançamento usa um id fixo por recorrente + mês, pra nunca duplicar se o celular e o PC abrirem no mesmo dia. Conta de valor variável (luz, água) não lança valor chutado: me lembra de lançar.

Tela e HUD: no HUD, poucas linhas (regra dos 85–90% de silêncio): saldo do mês, total gasto, as categorias que mais pesaram e a comparação com o mês passado. Uma visão do mês por categoria e uma visão da fatura de cada cartão, funcionando no celular. Comandos pra ver o mês, filtrar por categoria e corrigir lançamento, com /desfazer.

Testes: amplia a régua (tests/frases.js) com frases de finanças reais, incluindo as pegadinhas: valor com vírgula e com ponto (R$ 1.234,56, 30,50), valor sem verbo ("mercado 87", "uber 18,50"), "300 em 3x" e "3x de 100", compra depois do fechamento do cartão, pix pra pessoa, "pix do Pedro", "o João me pagou 30", "transferi 200 pra poupança", "deu ruim", "saiu o resultado". Aqui vão frases do meu jeito de escrever: [COLE AQUI 20–30 FRASES SUAS DE GASTO E ENTRADA, COM O QUE CADA UMA DEVE VIRAR].

Histórico e contexto: tudo segue a regra da fase 2, nenhuma mudança sobrescreve sem deixar histórico (os campos novos entram no rastrear do tipo). O montarContexto() passa a incluir um resumo financeiro curto do mês (totais e categorias, não cada lançamento).

Mantém o padrão do projeto. No fim de cada etapa, testa, faz commit e atualiza o CLAUDE.md e o roadmap, deixando no backlog: importar extrato do banco em CSV ou OFX pra conferir os lançamentos com o real; saldo real das contas; rachar conta entre pessoas.
