# Tucano Zen — vídeos e como testar

Ramo com o código: [`feat/tucano-zen`](https://github.com/zenfoco/tucano/tree/feat/tucano-zen) (11 commits sobre o `main` atual).

**Tucano Zen** é um modo para quem quer foco, sem distrações, sem perder o poder do time de agentes. A pessoa conversa só com o Tuca. Tarefas simples ele responde sozinho. As complexas ele divide e passa cada parte, ao mesmo tempo, ao especialista da área (com `pedir`). Quando tudo volta, ele entrega uma resposta só e completa. O time trabalha nos bastidores, e quem quiser ver quem fez o quê abre o painel "Bastidores".

## Vídeos (60 fps, gravados de verdade, Tuca e agentes no Codex `gpt-6-luna`)

1. [`1-simples-e-complexo.mp4`](1-simples-e-complexo.mp4) (28 s): "Quanto é 16 × 25?" o Tuca responde sozinho; um pedido de curso online com cinco partes ele divide entre Iara (pesquisa), Bia (preço e meta), Nico (Instagram), Caio (página de vendas) e Teo (cronograma), ao mesmo tempo.
2. [`2-varios-agentes-padaria.mp4`](2-varios-agentes-padaria.mp4) (2 min 12 s): quatro partes para quatro especialistas, a entrega única e os Bastidores no fim.
3. [`3-pedidos-rapidos.mp4`](3-pedidos-rapidos.mp4) (53 s): uma conta, uma tradução e um lembrete criado pelo próprio Tuca como rotina.

## Como testar

```bash
git remote add zenfoco https://github.com/zenfoco/tucano.git
git fetch zenfoco feat/tucano-zen
git switch -c tucano-zen zenfoco/feat/tucano-zen
npm install
npm run dev
```

No app: clique no nome do workspace (canto de cima) → **Tucano Zen**. Para voltar, **Modo completo**. Ter dois ou mais agentes com papéis diferentes ajuda a ver a orquestração; com o time vazio, o Tuca propõe criar quem cuida do pedido.

## O que muda no código

- **Tela** (`src/renderer/src/components/Auto.tsx`): a conversa com o Tuca, a mesma caixa de mensagem do app, uma linha discreta enquanto a equipe trabalha, os arquivos e as aprovações da equipe na conversa do Tuca, e os Bastidores ("Quem fez", "O que sei de você", "Rotinas", "Pare tudo").
- **Tuca orquestrador** (`src/core/tuca.ts` `autoOrchestratorSection`): uma seção que só entra enquanto a pessoa está no Zen. As instruções gravadas dele não mudam, e fora do Zen ele é o mesmo de sempre.
- **Núcleo** (`src/core/runs.ts`, `src/core/delegations.ts`):
  - no Zen, a conversa do Tuca fica contínua, sem threads, e ele vê o que já entregou;
  - a entrega traz o trabalho completo, até 32 mil caracteres, com os arquivos da equipe;
  - cada pedido da pessoa é entregue por conta própria;
  - quem recebe uma parte do Tuca faz só a parte dele.
- **Configuração:** `Settings.auto`, que é de cada pessoa.
- **Testes:** `test/tucano-auto.test.tsx`, `test/tuca-auto-orchestrator.test.ts` e casos novos em `test/delegations.test.ts`. A suíte inteira passa (2.670). Há também `scripts/e2e-tuca-auto-real.mjs`, que roda o app compilado com harnesses de verdade.
