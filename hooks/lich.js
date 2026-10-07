// The one module hooks/hooks.json names under `modules`: Claude Code takes a
// single entry there, so each mod lives in a file of its own and is registered
// from here.

import { register as registerAgentCards } from "./agent-cards.js"
import { register as registerEditGuard } from "./edit-guard.js"
import { register as registerModControl } from "./mod-control.js"
import { register as registerModStatus } from "./mod-status.js"
import { register as registerModUsage } from "./mod-usage.js"
import { register as registerStatusLine } from "./status-line.js"
import { register as registerWorkerAnswer } from "./worker-answer.js"

/** @param {import('claude-code').On} on */
export function register(on) {
  registerModControl(on)
  registerAgentCards(on)
  registerModUsage(on)
  registerEditGuard(on)
  registerWorkerAnswer(on)
  registerModStatus(on)
  registerStatusLine(on)
}
