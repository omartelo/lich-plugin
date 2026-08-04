#!/usr/bin/env node
// Checks a lich theme against the rules internal/themes/themes.go enforces on
// import, so a rejection lands here instead of in the middle of the user's
// import. A directory is checked as a theme repository: its lich-theme.json
// manifest plus every theme beside it, the same way an install reads it.
//
// Usage: node validate.mjs my-theme.json
//        node validate.mjs my-lich-themes/
import { readdirSync, readFileSync, statSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { basename, dirname, extname, join } from "node:path"

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
const RELEASE = /^v?\d+\.\d+\.\d+$/
const RESERVED = ["light", "dark", "system", "match"]
const WINDOWS_DEVICES = [
  "con", "prn", "aux", "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]
const MANIFEST = "lich-theme.json"
const MAX_THEMES = 32

const target = process.argv[2]
if (!target) {
  console.error("usage: node validate.mjs <theme.json | repository-directory>")
  process.exit(2)
}

function themeErrors(theme) {
  const errors = []
  if (!ID.test(theme.id ?? "")) errors.push(`id ${JSON.stringify(theme.id)} must match ${ID}`)
  if (RESERVED.includes(theme.id)) errors.push(`id "${theme.id}" is bundled or reserved`)
  if (WINDOWS_DEVICES.includes(theme.id)) errors.push(`id "${theme.id}" is a Windows device name`)
  if (!theme.name?.trim()) errors.push("name is required")
  if ([...(theme.name ?? "")].length > 128) errors.push("name cannot exceed 128 characters")
  if (theme.scheme !== "light" && theme.scheme !== "dark")
    errors.push('scheme must be "light" or "dark"')

  const checkColors = (group, allowed, pattern, requireAll) => {
    const colors = theme[group]
    if (!colors || typeof colors !== "object") return errors.push(`${group} colors are required`)
    for (const [key, value] of Object.entries(colors)) {
      if (!allowed.includes(key)) errors.push(`unknown ${group} color "${key}"`)
      else if (!pattern.test(String(value).trim()) || String(value).trim().length > 128)
        errors.push(`${group}.${key} is not an accepted color value: ${JSON.stringify(value)}`)
    }
    for (const key of requireAll ?? []) {
      if (!colors?.[key]?.trim()) errors.push(`${group}.${key} is required`)
    }
  }
  checkColors("app", APP, APP_COLOR, APP)
  checkColors("terminal", TERMINAL, HEX, ["background", "foreground"])
  return errors
}

function read(path) {
  try {
    return { value: JSON.parse(readFileSync(path, "utf8")) }
  } catch (error) {
    const reason = error.code === "ENOENT" ? "not found" : error.message
    return { error: `${basename(path)}: ${reason}` }
  }
}

function checkTheme(path) {
  const { value, error } = read(path)
  return error ? [error] : themeErrors(value).map((problem) => `${basename(path)}: ${problem}`)
}

// A repository is checked the way an install reads it: the manifest first, then
// every other root-level JSON as a theme. lich renames them to <id>.json when it
// stores them, so the names in here are the author's business — the ids are not.
function checkRepository(dir) {
  const manifest = read(join(dir, MANIFEST))
  if (manifest.error) return [`${manifest.error} — every theme repository needs one at its root`]
  const errors = []
  if (!manifest.value.name?.trim()) errors.push(`${MANIFEST}: name is required`)
  if ([...(manifest.value.name ?? "")].length > 128)
    errors.push(`${MANIFEST}: name cannot exceed 128 characters`)
  if (!RELEASE.test(manifest.value.version ?? ""))
    errors.push(
      `${MANIFEST}: version ${JSON.stringify(manifest.value.version)} must be MAJOR.MINOR.PATCH`,
    )

  const files = readdirSync(dir)
    .filter((name) => name !== MANIFEST && extname(name) === ".json")
    .sort()
  if (files.length === 0) errors.push(`no theme JSON next to ${MANIFEST}`)
  if (files.length > MAX_THEMES) errors.push(`more than ${MAX_THEMES} themes in one repository`)

  const seen = new Map()
  for (const name of files) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) continue
    errors.push(...checkTheme(path))
    const { value } = read(path)
    const id = value?.id
    if (!id) continue
    if (seen.has(id)) errors.push(`${name}: id "${id}" is already used by ${seen.get(id)}`)
    else seen.set(id, name)
  }
  return errors
}

const isDirectory = statSync(target).isDirectory()
const errors = isDirectory ? checkRepository(target) : checkTheme(target)

if (errors.length) {
  console.error(`${target}: ${errors.length} problem(s)`)
  for (const error of errors) console.error(`  - ${error}`)
  process.exit(1)
}
console.log(
  isDirectory
    ? `${target}: ok — install it from Settings › Appearance › Import, pasting this path`
    : `${target}: ok — install it from Settings › Appearance › Import › Choose file`,
)
