# Anotações

App de anotações com tópicos aninhados e visualizador de mídia sincronizado.

## Como rodar

Precisa ter o [Node.js](https://nodejs.org/) instalado (versão 18 ou superior).

```bash
# 1. Instalar dependências
pnpm install

# 2. Rodar em modo desenvolvimento
pnpm dev
```

Abra http://localhost:5173 no navegador.

## Build para produção

```bash
pnpm build
pnpm preview
```

## Atalhos de teclado

| Tecla | Ação |
|-------|------|
| `Enter` | Nova linha no tópico |
| `Shift+Enter` | Criar tópico irmão |
| `Tab` | Indentar (tornar filho) |
| `Shift+Tab` | Des-indentar (subir um nível) |
| `Esc` | Confirmar edição |
| Duplo clique | Editar tópico |

## Markdown suportado

- `` `código` `` → código inline
- ` ```linguagem ` → bloco de código com syntax highlight
