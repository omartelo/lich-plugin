---
name: theme
description: Write, port, or fix a color theme for the lich harness — the JSON that recolors lich's interface tokens and its xterm terminal palette. Use when asked to build a lich theme, port a palette (Tokyo Night, Gruvbox, Catppuccin, Nord…) into lich, tweak the colors of an installed theme, or when a custom theme is rejected on import or silently missing from Settings › Appearance.
---

# lich themes

A lich theme is one JSON file with two color blocks that are consumed by two
different engines:

- **`app`** — 31 CSS custom properties applied to `<html>`. Repaints the whole
  interface.
- **`terminal`** — an xterm.js theme object handed straight to the terminal.
  Repaints the PTY panes only.

They are picked independently in Settings › Appearance: the terminal picker has
a `Match app theme` default, so one theme can dress both.

`template.json`, next to this file, is the same starter lich itself hands out
(Settings › Appearance › **Save template**). It names every supported color —
start from it, don't type the shape from memory.

## Where the file lives

| OS      | Directory                                     |
|---------|-----------------------------------------------|
| Linux   | `${XDG_CONFIG_HOME:-$HOME/.config}/lich/themes/` |
| macOS   | `~/Library/Application Support/lich/themes/`   |
| Windows | `%AppData%\lich\themes\`                       |

A lich started with `LICH_DEV` (that's `task dev`) reads `themes-dev/` instead —
a theme dropped in `themes/` will not show up there, and vice versa.

## Building one

1. Copy `template.json` and set `id`, `name`, `scheme`.
2. Fill `app` by **role**, not by hue — see the token table below.
3. Fill `terminal`. `background`/`foreground` are required; give the 16 ANSI
   colors too unless you want xterm's built-in palette fighting your background.
4. Validate: `node validate.mjs <file>` (in this skill's directory). It checks
   the same rules the backend checks, so a pass means the import will not bounce.
5. Install, either way:
   - **Copy it** to the themes directory above as `<id>.json`, then reload the
     lich window (the theme list is read once, at page load).
   - **Import it** from Settings › Appearance › Import theme. lich validates it,
     names the file, applies it immediately and selects it. Prefer this when you
     want the validation error spelled out on screen.

## Validation rules (the backend rejects anything else)

- `id`: required, matches `^[a-z0-9][a-z0-9._-]{0,63}$`. Not `light`, `dark`,
  `system` or `match`; not a Windows device name (`con`, `prn`, `aux`, `nul`,
  `com1`–`com9`, `lpt1`–`lpt9`) — the id names a file.
- `name`: required, non-blank, ≤ 128 characters.
- `scheme`: `light` or `dark`. Nothing else.
- `app`: **every one of the 31 tokens** must be present. An unknown token is an
  error, not a warning.
- `terminal`: `background` and `foreground` required; the other 20 tokens
  optional. Unknown tokens rejected.
- Color values: non-blank, ≤ 128 characters.
  - `app` accepts hex (`#rgb` … `#rrggbbaa`), a CSS color name, or
    `rgb()`/`rgba()`/`hsl()`/`hsla()`/`oklch()`/`oklab()`/`lab()`/`lch()`/`color()`.
    `var()`, `color-mix()`, `url()`, `attr()`, `image-set()` are rejected —
    a theme may not name a resource or defer a value.
  - `terminal` accepts **hex only**. See the traps.
- The file is read only if it is a regular file ≤ 1 MB.

## Traps

- **A bad file copied straight into the themes directory disappears in
  silence.** Invalid JSON, a failed rule, or a filename that isn't `<id>.json`
  makes lich skip the theme with a warning in the log and nothing in the UI.
  Run `validate.mjs`, or import through Settings.
- **A non-hex terminal color half-applies.** xterm parses hex directly;
  everything else goes through a round-trip that throws on translucency and is
  swallowed into a fallback. The backend rejects it up front — don't work around
  it, convert the color to hex.
- **`scheme` is not decoration.** It toggles the `.dark` class on the root, which
  drives every `dark:` variant in the components. A dark palette declared
  `"scheme": "light"` renders half-lit.
- **Missing ANSI colors are not inherited from the previous theme** — they fall
  back to xterm's defaults, which were not chosen against your background.
- **`origin` is overwritten with `custom` on install.** Leave it out.
- **The status colors are not yours.** Done/added is `emerald-500`, waiting is
  `amber-500`, terminal search hits are amber, and diff gutters use both. They
  are hardcoded, so check they still read on your `background`, `card` and
  terminal background.
- Reimporting an id that already exists asks before replacing it.

## App tokens by role

Surfaces (each `*-foreground` is the text drawn **on** that surface — keep the
pair contrasty, they are never used apart):

| Token | Role |
|---|---|
| `background` / `foreground` | app ground and primary text |
| `card` / `popover` (+ `-foreground`) | raised chrome: tabs, footer, dock, menus, dialogs |
| `sidebar` / `sidebar-foreground` | the session sidebar |
| `accent` / `accent-foreground` | **the workhorse** — hover and selected fill everywhere. Also used at `/50`–`/60` opacity for hover, so it must read as a step off `background`, not as a color |
| `secondary` (+ `-foreground`) | low-emphasis fills |
| `muted` / `muted-foreground` | secondary text, resting icons, paths, meta |
| `primary` / `primary-foreground` | the single high-emphasis button fill, and the Switch when on |
| `destructive` | destructive actions and diff removals — must stay legible as red |
| `border` | hairline seams. Translucent works well in dark (`oklch(1 0 0 / 10%)`) |
| `input` | input and control edges, usually a touch stronger than `border` |
| `ring` | focus ring, always visible |
| `chart-1` … `chart-5` | data series |
| `sidebar-primary`, `sidebar-accent`, `sidebar-border`, `sidebar-ring` (+ their `-foreground`s) | the same roles scoped to the sidebar; mirroring the app values is fine |

The bundled Light and Dark are achromatic zinc by design — a chromatic palette
is exactly what a custom theme is for.

## Terminal tokens

Required: `background`, `foreground`.
Optional: `cursor`, `cursorAccent`, `selectionBackground`, `selectionForeground`,
`black`, `red`, `green`, `yellow`, `blue`, `magenta`, `cyan`, `white`,
`brightBlack`, `brightRed`, `brightGreen`, `brightYellow`, `brightBlue`,
`brightMagenta`, `brightCyan`, `brightWhite`.

`cursorAccent` is the glyph *under* a block cursor — set it to the background.
`brightBlack` is what dim TUI text lands on; too close to `background` and
Claude Code's own meta lines vanish.

## Checklist

- [ ] `validate.mjs` passes
- [ ] `scheme` matches the actual lightness of the palette
- [ ] `accent` is visibly a step off `background` but not a second brand color
- [ ] `border` reads as a hairline, not a rule
- [ ] `emerald-500` / `amber-500` / `destructive` still read on your surfaces
- [ ] Terminal `background` sits well beside app `background` (they touch)
- [ ] Installed as `<id>.json`, and the window reloaded
