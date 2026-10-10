// The agent-facing text the hooks add to a session, in every language lich can
// talk to its agents in. lich exports the user's prompt language into every
// session as LICH_PROMPT_LANG (`internal/prompt` there); an empty or unknown
// value is English, as it is for lich itself.
//
// A text is a template with `{name}` slots. Tool and command names, the `[lich]`
// marker and the status enums are literal in every locale: the model matches on
// them, and so does the contract.

/** @type {Record<string, string>} */
export const en = {
  askPreamble:
    "This is a side question asked from outside your turn, while you work. It does not " +
    "interrupt your turn and your answer is not added to the conversation. Tools are " +
    "unavailable: do not call any tool. Answer from what the conversation already holds, " +
    "in plain text, briefly. Question: ",
  onBranch: "on branch {branch}",
  whereBranch: "on branch {branch} in {path}, not in this checkout",
  whereShared: "in this same checkout, {path}, and edits its files as you do",
  backgrounded:
    'The agent runs as the lich session "{label}", {where}. ' +
    "Its full report arrives at this prompt on its own as a [lich] note, not as a task notification, so there " +
    "is no need to call wait_for_answer (it still works). SendMessage cannot reach that session; " +
    "send_to_session or lich send can.",
  completedBranch:
    'The work is on branch {branch} in {path} (lich session "{label}"), not in this checkout. ' +
    "Reach that session with send_to_session or lich send, not SendMessage.",
  completedShared:
    'The work is in this same checkout, {path} (lich session "{label}"). ' +
    "Reach that session with send_to_session or lich send, not SendMessage.",
  denyNeverReached: 'the task never reached "{label}" ({status}): open its card.',
  denyAnswered: 'lich answered "{status}" about "{label}"{branchPart}: open its card.',
  denyInterrupted:
    "interrupted; a lich session{branchPart} may already have the task, and a report it sends arrives here as a [lich] note.",
  denyStopFailed: 'lich could not stop "{label}": {reason}',
  lichExited: "lich exited {code}",
  editNoteJustNow: "under a minute ago",
  editNoteAgo: "{minutes} min ago",
  editNote:
    "{path} was also edited by the lich session {who} at {at} ({ago}), which shares this checkout and may " +
    "still be working on it. Re-read the file before building on it, and coordinate with that session through " +
    "send_to_session or lich send rather than undoing its change.",
  skillNote:
    "\n\nIn this session a built-in slash command (compact, clear, and the like) can be named here too, " +
    "when the user asks you to run it: it is queued and runs once your turn ends, so end your turn right after.",
  controlNote:
    "\n\nIn this session, action command is accepted with this session itself as the target: pass session " +
    '"{sessionId}". The command is queued and runs once your turn ends, so end your turn right after.',
  denyDefaultSaved:
    "/{name} run from inside the session would be saved as the default for every new Claude Code " +
    "session. Ask the user to set it from lich, whose {name} override applies to this session only.",
  skillQueued: "{queued} is queued and runs once this turn ends. End the turn now.",
  controlQueued: "{queued} is queued on this session and runs once this turn ends. End the turn now.",
}

/** @type {Record<string, string>} */
export const ptBR = {
  askPreamble:
    "Esta é uma pergunta lateral feita de fora do seu turno, enquanto você trabalha. Ela não " +
    "interrompe o seu turno e a sua resposta não entra na conversa. As ferramentas estão " +
    "indisponíveis: não chame nenhuma. Responda com o que a conversa já contém, " +
    "em texto simples e de forma breve. Pergunta: ",
  onBranch: "na branch {branch}",
  whereBranch: "na branch {branch} em {path}, não neste checkout",
  whereShared: "neste mesmo checkout, {path}, e edita os arquivos dele como você",
  backgrounded:
    'O agente roda como a sessão lich "{label}", {where}. ' +
    "O relatório completo chega neste prompt por conta própria como uma nota [lich], não como task notification, " +
    "então não é preciso chamar wait_for_answer (ele ainda funciona). SendMessage não alcança essa sessão; " +
    "send_to_session ou lich send alcançam.",
  completedBranch:
    'O trabalho está na branch {branch} em {path} (sessão lich "{label}"), não neste checkout. ' +
    "Fale com essa sessão por send_to_session ou lich send, não por SendMessage.",
  completedShared:
    'O trabalho está neste mesmo checkout, {path} (sessão lich "{label}"). ' +
    "Fale com essa sessão por send_to_session ou lich send, não por SendMessage.",
  denyNeverReached: 'a tarefa nunca chegou a "{label}" ({status}): abra o card dela.',
  denyAnswered: 'o lich respondeu "{status}" sobre "{label}"{branchPart}: abra o card dela.',
  denyInterrupted:
    "interrompido; uma sessão lich{branchPart} pode já ter a tarefa, e o relatório que ela enviar chega aqui como nota [lich].",
  denyStopFailed: 'o lich não conseguiu parar "{label}": {reason}',
  lichExited: "o lich saiu com {code}",
  editNoteJustNow: "há menos de um minuto",
  editNoteAgo: "há {minutes} min",
  editNote:
    "{path} também foi editado pela sessão lich {who} em {at} ({ago}), que divide este checkout e pode " +
    "ainda estar trabalhando nele. Releia o arquivo antes de continuar a partir dele e combine com essa sessão por " +
    "send_to_session ou lich send em vez de desfazer a mudança dela.",
  skillNote:
    "\n\nNesta sessão um slash command embutido (compact, clear e afins) também pode ser nomeado aqui, " +
    "quando o usuário pedir para você executá-lo: ele entra na fila e roda quando o seu turno terminar, então encerre o turno logo em seguida.",
  controlNote:
    "\n\nNesta sessão, a ação command aceita a própria sessão como alvo: passe session " +
    '"{sessionId}". O comando entra na fila e roda quando o seu turno terminar, então encerre o turno logo em seguida.',
  denyDefaultSaved:
    "/{name} executado de dentro da sessão seria salvo como padrão de toda nova sessão do Claude Code. " +
    "Peça ao usuário para definir pelo lich, cujo override de {name} vale só para esta sessão.",
  skillQueued: "{queued} está na fila e roda quando este turno terminar. Encerre o turno agora.",
  controlQueued: "{queued} está na fila nesta sessão e roda quando este turno terminar. Encerre o turno agora.",
}

/** @type {Record<string, Record<string, string>>} */
const catalogs = { en, "pt-BR": ptBR }

/**
 * The text `key` names in `lang`, its slots filled from `vars`. English stands
 * in for an unknown language; a key missing from English throws, which the
 * parity test turns into a failure long before a session sees it.
 *
 * @param {string | undefined} lang
 * @param {string} key
 * @param {Record<string, string | number>} [vars]
 */
export function say(lang, key, vars = {}) {
  const template = (catalogs[lang ?? "en"] ?? en)[key] ?? en[key]
  if (template === undefined) throw new Error(`no prompt text named "${key}"`)
  return template.replace(/\{(\w+)\}/g, (slot, name) => String(vars[name] ?? slot))
}

/**
 * The catalog language for a LICH_PROMPT_LANG value. The hook reads the env
 * itself: the engine never follows $ across an import.
 *
 * @param {string | undefined} tag
 */
export function promptLang(tag) {
  return tag && tag in catalogs ? tag : "en"
}
