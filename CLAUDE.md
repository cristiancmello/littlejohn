# Linguagem de Análise Hierárquica — Documentação do Protótipo

## Contexto

O usuário propôs uma linguagem pessoal de anotação inspirada na teoria das ideias de **John Locke**: toda ideia é composta de partes menores e pode se generalizar. O objetivo é representar **ações e comportamentos** (evitando excesso de abstração) em estrutura hierárquica, com relações semânticas explícitas entre eles.

---

## A Linguagem Semântica

### Princípio filosófico

Baseada em Locke: ideias simples se compõem em ideias complexas, que por sua vez podem ser abstraídas. A linguagem evita termos puramente abstratos e ancora tudo em **ações e comportamentos concretos**.

### Símbolos e semântica

| Símbolo | Nome | Semântica |
|---------|------|-----------|
| `>` | **Ação** | Comportamento ou ação expressa em frase imperativa. Unidade raiz da hierarquia. |
| `—` | **Conceito** | Decomposição hierárquica da ação — do composto ao simples. Representa os constituintes abstratos que formam a ação. Direção descendente (Locke: do complexo ao simples). |
| `→` | **Relação lateral** | Associação entre duas ações. Indica caminhos variados e possíveis. Direção horizontal — sem hierarquia entre as ações relacionadas. |
| `⟹` | **Implicação** | Uma ação que ocorre **obrigatoriamente em sequência** à ação anterior. Caminho único, sem ramificação. Corresponde à causalidade necessária. |
| `//` | **Comentário** | Texto livre explicativo sobre a ação. Não formalizado. Sempre o último elemento do tópico. |

### Estrutura de uma ação completa

```
> Ação ou comportamento (imperativo)
— Conceito abstraído nível 0
— Conceito abstraído nível 1
→ Relação com outra ação (lateral)
// Comentário livre sobre a ação

> Outra ação independente

> Ação com implicação
⟹ Ação implicada obrigatoriamente em sequência
```

### Regras da linguagem

1. **Conceitos** (`—`) sempre precedem a relação lateral (`→`) dentro de uma ação.
2. **Conceitos** não possuem sub-conceitos — a decomposição é plana dentro de cada ação.
3. **Relação lateral** (`→`) e **implicação** (`⟹`) são mutuamente exclusivas em uma mesma ação:
   - Se existe `⟹`, não pode haver `→` (caminho único não admite caminhos variados).
   - Se existe `→`, não pode haver `⟹` (caminhos variados não podem ser sequência obrigatória).
4. **Comentários** (`//`) podem ser múltiplos e são sempre o último elemento do tópico.
5. **Ação implicada** (`⟹`) deve ser criada imediatamente após a ação que a implicou — sem fragmentação com ações não-implicadas.
6. **Relação lateral** pré-cria uma ação **stub** se a ação referenciada ainda não existe, permitindo expansão futura.
7. Um **stub** se desativa automaticamente ao receber texto editado ou ao receber o primeiro filho.

---

## Requisitos do App

### Estrutura de dados

- Cada nó possui: `id`, `type` (action | implied | concept | lateral | comment), `text`, `expanded`, `children`, `media`, `stub`, `impliedBy`, `targetId`.
- Árvore recursiva — ações podem ter filhos de qualquer tipo permitido pelas regras.
- Ações implicadas (`implied`) vivem no nível raiz, imediatamente após a ação que as gerou.

### Interface

- **Painel esquerdo**: árvore hierárquica de anotações com renderização visual por tipo semântico.
- **Painel direito**: visualizador de mídia sincronizado com o tópico selecionado (scroll automático).
- **Toolbar global**: botões de importação e exportação.
- **Legenda**: exibe os símbolos e seus nomes no rodapé do painel esquerdo.

### Edição

- Duplo clique para editar qualquer nó.
- Textarea com auto-resize (suporte a múltiplas linhas).
- `Esc` confirma; se vazio, deleta o nó.
- Novo nó entra automaticamente em modo de edição com cursor focado.

### Criação de nós

- Botão **"+ nova ação"** cria ação raiz.
- Hover em qualquer ação revela botões contextuais:
  - **— conceito**: desabilitado se já existe relação lateral.
  - **→ relação**: desabilitada se já existe implicação.
  - **// nota**: sempre disponível, múltiplos permitidos.
  - **⟹ implicar**: desabilitado se já existe relação lateral. Cria ação implicada no nível raiz, imediatamente abaixo.
  - **× deletar**: disponível em todos os tipos.
- Hover em conceito revela: **↑**, **↓** (reordenar entre irmãos) e **×**.

### Referência visual de implicação

- A ação que implicou exibe dentro dela, como sub-item visual, uma referência `⟹ texto…` para a ação implicada.
- A ação implicada exibe um badge `← primeiras palavras` apontando para quem a gerou.
- Clicar na referência navega para o nó correspondente.

### Stub

- Relações laterais (`→`) que referenciam ações ainda não existentes criam automaticamente uma ação **stub** no nível raiz.
- Stubs são visualmente dimidos (opacidade reduzida).
- Um stub é desativado quando: (a) seu texto é editado e confirmado, ou (b) recebe seu primeiro filho.

### Renderização de texto rico

- `` `código` `` → código inline com fonte monoespacada.
- ```` ```linguagem ```` → bloco de código com label de linguagem e scroll horizontal.

### Exportação

- Serializa a árvore no formato textual da linguagem (`>`, `—`, `→`, `⟹`, `//`).
- Gera arquivo `analise.txt` para download.

### Importação

- Modal com campo de texto livre.
- Parser linha a linha reconhecendo todos os símbolos da linguagem.
- Suporta também variantes: `-` como alias de `—`, `-->` como alias de `→`.
- Substitui o conteúdo atual pela anotação importada.

---

## Stack técnica

- **React 18** com hooks (`useState`, `useCallback`, `useEffect`, `useRef`).
- **Vite 5** como bundler.
- Sem dependências externas além de React — toda a lógica é vanilla.
- Estilização via CSS-in-JS (string de estilos injetada no `<style>`).
- Fontes: Playfair Display (títulos), Lora (corpo), JetBrains Mono (código e símbolos).
- Tema claro com paleta papel creme (`#f7f4ef`), superfícies brancas, acentos em âmbar, verde-musgo e roxo.

---

## Conexão com teoria

A linguagem mapeia conceitos de teoria de linguagens e semântica formal:

| Símbolo | Equivalente formal |
|---------|--------------------|
| `>` | Semântica operacional — definição de comportamento |
| `—` | Tipagem e taxonomia — decomposição em tipos simples |
| `⟹` | Sequenciamento obrigatório / efeitos (cf. monads em Haskell) |
| `→` | Polimorfismo e despacho — caminhos variados por contexto |
| `//` | Especificação informal / documentação |

Referências afins: **CCS** (Calculus of Communicating Systems, Milner), **π-calculus**, teoria de tipos de **Martin-Löf**.
