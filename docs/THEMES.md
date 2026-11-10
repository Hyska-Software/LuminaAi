# Temas personalizados

O Zylara instala temas a partir de um pacote `.zip` local. Um tema é **declarativo**: ele fornece paletas (claro/escuro), raios, fontes e papel de parede opcionais. Não há CSS nem JavaScript arbitrário no pacote.

O tema embutido **Zylara** (`themeId: "zylara"`) é o padrão e não pode ser removido. O modo Claro/Escuro/Sistema é independente do tema: cada pacote fornece as duas paletas.

## Onde os temas ficam

```
<app-data>/themes/<id>/
  theme.json
  fonts/...
  images/...
```

O id vem do manifesto. Reinstalar o mesmo id substitui a pasta atomicamente. A pasta pode ser aberta em **Configurações → Temas → Abrir pasta de temas**; use **Recarregar temas** depois de copiar uma pasta manualmente.

## Pacote

- ZIP de até 24 MB, com até 256 arquivos.
- `theme.json` na raiz **ou** dentro de uma única pasta de primeiro nível (`meu-tema/theme.json`).
- Somente os arquivos referenciados pelo manifesto são extraídos (`fonts` e `wallpaper`).
- Nomes de arquivo usam `/`, sem `..`, sem caminho absoluto e sem `\`.

## Manifesto

```json
{
  "schemaVersion": 1,
  "id": "ocean",
  "name": "Ocean",
  "version": "1.0.0",
  "author": "Jane Doe",
  "description": "Azul profundo para uso noturno.",
  "tokens": {
    "light": {
      "background": "#f7fbff",
      "surface": "#eef5ff",
      "surface-raised": "#ffffff",
      "surface-hover": "#e3edff",
      "surface-active": "#d8e6ff",
      "foreground": "#0a1020",
      "foreground-muted": "#46536b",
      "foreground-subtle": "#6b7890",
      "border": "#d6e2f5",
      "border-strong": "#b9cbe6",
      "accent": "#2563eb",
      "accent-hover": "#1d4ed8",
      "accent-foreground": "#ffffff",
      "accent-soft": "#e8f0ff",
      "success": "#15803d",
      "success-soft": "#e8f8ee",
      "warning": "#a16207",
      "warning-soft": "#fff7e0",
      "danger": "#dc2626",
      "danger-soft": "#fef2f2",
      "user-bubble": "#e8f0ff",
      "code-bg": "#f4f8ff",
      "terminal-selection": "#2563eb33",
      "radius-md": "0.875rem"
    },
    "dark": {
      "background": "#071018",
      "surface": "#0b1624",
      "surface-raised": "#102033",
      "surface-hover": "#152942",
      "surface-active": "#1b3350",
      "foreground": "#e8f0ff",
      "foreground-muted": "#a7b8d0",
      "foreground-subtle": "#7186a3",
      "border": "#1c3048",
      "border-strong": "#2b4565",
      "accent": "#60a5fa",
      "accent-hover": "#93c5fd",
      "accent-foreground": "#04101f",
      "accent-soft": "#10263f",
      "success": "#4ade80",
      "success-soft": "#0d2418",
      "warning": "#fbbf24",
      "warning-soft": "#2a2110",
      "danger": "#f87171",
      "danger-soft": "#2b1313",
      "user-bubble": "#152942",
      "code-bg": "#0a1522",
      "terminal-selection": "#60a5fa44",
      "radius-md": "0.875rem"
    }
  },
  "fonts": {
    "sans": "fonts/Manrope.woff2",
    "mono": "fonts/JetBrainsMono.woff2"
  },
  "wallpaper": {
    "light": "images/ocean-light.webp",
    "dark": "images/ocean-dark.webp"
  }
}
```

### Tokens

As chaves são nomes de custom properties CSS **sem** `--`; valores são aplicados em `<html>`.

Obrigatórios nos dois modos (todos cores):

| Grupo | Tokens |
|---|---|
| Superfícies | `background`, `surface`, `surface-raised`, `surface-hover`, `surface-active` |
| Texto | `foreground`, `foreground-muted`, `foreground-subtle` |
| Bordas | `border`, `border-strong` |
| Marca | `accent`, `accent-hover`, `accent-foreground`, `accent-soft` |
| Estados | `success`, `success-soft`, `warning`, `warning-soft`, `danger`, `danger-soft` |
| Chat/código/terminal | `user-bubble`, `code-bg`, `terminal-selection` |

Opcionais:

- Cores: `accent-ring`, `context-system`, `context-tools`, `context-messages`, `assistant-bubble`, `terminal-ansi-{black,red,green,yellow,blue,magenta,cyan,white}` e `terminal-ansi-bright-{black,red,green,yellow,blue,magenta,cyan,white}`.
- Raios (comprimentos `px`, `rem` ou `em`): `radius-xs`, `radius-sm`, `radius-md`, `radius-lg`, `radius-xl`, `radius-2xl`, `radius-3xl`. O app os consome via `--theme-radius-*`, o que permite trocar o arredondamento sem rebuildar o CSS.

Formatos de cor aceitos: `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `transparent` e funções `rgb()`, `rgba()`, `hsl()`, `hsla()`, `oklch()`, `oklab()`, `lab()`, `lch()`, `color(...)`.

Tokens ausentes e opcionais preservam o valor embutido correspondente ao modo ativo.

### Fontes

`fonts.sans` e `fonts.mono` são opcionais e apontam para arquivos `woff2`, `woff`, `ttf` ou `otf` (até 4 MB cada). A fonte é registrada com um nome interno do tema e usada pela interface e pelo terminal; se o arquivo falhar, o tema mantém a fonte padrão.

### Papel de parede

`wallpaper.light` e `wallpaper.dark` são opcionais e aceitam `png`, `jpg`/`jpeg`, `webp` ou `gif` (até 8 MB e 8192 px por lado). A imagem é aplicada ao `body` como fundo fixo. As superfícies do app são opacas por padrão: para o papel de parede aparecer, use cores de superfície com alfa (`background`, `surface`, `surface-raised`, …, por exemplo `#0b1624cc`).

## Limites e segurança

- ZIP: 24 MB, 256 entradas, manifesto de 256 KB.
- Só arquivos referenciados são extraídos; extensões e assinaturas (magic bytes) são validadas. Imagens também têm dimensões verificadas.
- Links simbólicos, caminhos com `..`, caminhos absolutos, separadores `\` e nomes duplicados são rejeitados.
- Nenhum CSS, JavaScript, HTML ou expressão é executado. O renderer aplica somente tokens validados e data URLs de assets validados.
- Reinstalar o mesmo `id` substitui o tema (atualização). Remover o tema ativo volta para o Zylara.

## Fluxo de uso

1. Gere o ZIP com `theme.json` na raiz (ou em uma pasta única).
2. **Configurações → Temas → Instalar tema…** e selecione o arquivo.
3. Clique em **Usar** no card do tema.
4. Alterne Claro/Escuro/Sistema para conferir as duas paletas.

O tema ativo é persistido em `settings.json` como `themeId`.
