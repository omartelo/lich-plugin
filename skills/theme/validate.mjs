#!/usr/bin/env node
// Checks a lich theme against the rules internal/themes/themes.go enforces on
// import. A theme copied straight into the themes directory fails silently
// (log warning, absent from the UI), which is what this is for.
//
// Usage: node validate.mjs my-theme.json
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

// The token sets come from the shipped template so this stays in step with it.
const template = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "template.json"), "utf8"),
)
const APP = Object.keys(template.app)
const TERMINAL = Object.keys(template.terminal)

const ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
const APP_COLOR =
  /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([0-9a-zA-Z.,%/ +-]*\))$/
const HEX = /^#[0-9a-fA-F]{3,8}$/
const RESERVED = ["light", "dark", "system", "match"]
const WINDOWS_DEVICES = [
  "con", "prn", "aux", "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]

const path = process.argv[2]
if (!path) {
  console.error("usage: node validate.mjs <theme.json>")
  process.exit(2)
}

const theme = JSON.parse(readFileSync(path, "utf8"))
const errors = []

if (!ID.test(theme.id ?? "")) errors.push(`id ${JSON.stringify(theme.id)} must match ${ID}`)
if (RESERVED.includes(theme.id)) errors.push(`id "${theme.id}" is bundled or reserved`)
if (WINDOWS_DEVICES.includes(theme.id)) errors.push(`id "${theme.id}" is a Windows device name`)
if (!theme.name?.trim()) errors.push("name is required")
if ([...(theme.name ?? "")].length > 128) errors.push("name cannot exceed 128 characters")
if (theme.scheme !== "light" && theme.scheme !== "dark") errors.push('scheme must be "light" or "dark"')

function checkColors(group, allowed, pattern, requireAll) {
  const colors = theme[group]
  if (!colors || typeof colors !== "object") return errors.push(`${group} colors are required`)
  for (const [key, value] of Object.entries(colors)) {
    if (!allowed.includes(key)) errors.push(`unknown ${group} color "${key}"`)
    else if (!pattern.test(String(value).trim()) || String(value).trim().length > 128)
      errors.push(`${group}.${key} is not an accepted color value: ${JSON.stringify(value)}`)
  }
  for (const key of requireAll ?? []) {
    if (!colors[key]?.trim()) errors.push(`${group}.${key} is required`)
  }
}

checkColors("app", APP, APP_COLOR, APP)
checkColors("terminal", TERMINAL, HEX, ["background", "foreground"])

if (errors.length) {
  console.error(`${path}: ${errors.length} problem(s)`)
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}
console.log(`${path}: ok — install as ${theme.id}.json`)
