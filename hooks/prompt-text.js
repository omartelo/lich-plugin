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

/** @type {Record<string, string>} */
export const zhCN = {
  askPreamble:
    "这是在你的回合之外、你工作期间提出的旁路问题。它不会打断你的回合，你的回答也不会加入对话。" +
    "工具不可用：不要调用任何工具。请仅根据对话中已有的内容，用纯文本简要回答。问题：",
  onBranch: "在分支 {branch} 上",
  whereBranch: "在分支 {branch} 上的 {path} 中，不在当前 checkout 里",
  whereShared: "在同一个 checkout {path} 中，并且和你一样编辑其中的文件",
  backgrounded:
    'agent 作为 lich 会话 "{label}" 运行，{where}。' +
    "它的完整报告会作为 [lich] 备注自动出现在此提示中，而不是 task notification，因此无需调用 " +
    "wait_for_answer（调用仍然有效）。SendMessage 无法联系该会话；send_to_session 或 lich send 可以。",
  completedBranch:
    '工作位于分支 {branch} 上的 {path}（lich 会话 "{label}"），不在当前 checkout 里。' +
    "请通过 send_to_session 或 lich send 联系该会话，不要用 SendMessage。",
  completedShared:
    '工作位于同一个 checkout {path}（lich 会话 "{label}"）中。' +
    "请通过 send_to_session 或 lich send 联系该会话，不要用 SendMessage。",
  denyNeverReached: '任务从未送达 "{label}"（{status}）：请打开它的卡片。',
  denyAnswered: 'lich 针对 "{label}"{branchPart} 返回了 "{status}"：请打开它的卡片。',
  denyInterrupted:
    "已中断；某个 lich 会话{branchPart}可能已经拿到任务，它发送的报告会作为 [lich] 备注出现在这里。",
  denyStopFailed: 'lich 无法停止 "{label}"：{reason}',
  lichExited: "lich 退出，退出码 {code}",
  editNoteJustNow: "不到一分钟前",
  editNoteAgo: "{minutes} 分钟前",
  editNote:
    "{path} 也被 lich 会话 {who} 在 {at}（{ago}）编辑过，该会话与你共用此 checkout，可能仍在处理它。" +
    "在基于该文件继续之前请重新读取，并通过 send_to_session 或 lich send 与该会话协调，不要撤销它的改动。",
  skillNote:
    "\n\n在此会话中，内置斜杠命令（compact、clear 等）也可以在这里指定，只要用户要求你运行它：" +
    "它会进入队列，在你的回合结束后运行，因此请在之后立即结束你的回合。",
  controlNote:
    "\n\n在此会话中，action 为 command 时可以把会话自身作为目标：传入 session " +
    '"{sessionId}"。该命令会进入队列，在你的回合结束后运行，因此请在之后立即结束你的回合。',
  denyDefaultSaved:
    "在会话内部运行 /{name} 会把它保存为每个新 Claude Code 会话的默认值。" +
    "请让用户通过 lich 来设置，lich 的 {name} 覆盖只对此会话生效。",
  skillQueued: "{queued} 已进入队列，将在本回合结束后运行。现在请结束本回合。",
  controlQueued: "{queued} 已在此会话中排队，将在本回合结束后运行。现在请结束本回合。",
}

/** @type {Record<string, string>} */
export const es = {
  askPreamble:
    "Esta es una pregunta lateral hecha desde fuera de tu turno, mientras trabajas. No " +
    "interrumpe tu turno y tu respuesta no se añade a la conversación. Las herramientas no están " +
    "disponibles: no llames a ninguna. Responde con lo que la conversación ya contiene, " +
    "en texto plano y de forma breve. Pregunta: ",
  onBranch: "en la rama {branch}",
  whereBranch: "en la rama {branch} en {path}, no en este checkout",
  whereShared: "en este mismo checkout, {path}, y edita sus archivos igual que tú",
  backgrounded:
    'El agente se ejecuta como la sesión lich "{label}", {where}. ' +
    "Su informe completo llega a este prompt por sí solo como una nota [lich], no como task notification, así que no " +
    "hace falta llamar a wait_for_answer (sigue funcionando). SendMessage no puede llegar a esa sesión; " +
    "send_to_session o lich send sí.",
  completedBranch:
    'El trabajo está en la rama {branch} en {path} (sesión lich "{label}"), no en este checkout. ' +
    "Comunícate con esa sesión con send_to_session o lich send, no con SendMessage.",
  completedShared:
    'El trabajo está en este mismo checkout, {path} (sesión lich "{label}"). ' +
    "Comunícate con esa sesión con send_to_session o lich send, no con SendMessage.",
  denyNeverReached: 'la tarea nunca llegó a "{label}" ({status}): abre su tarjeta.',
  denyAnswered: 'lich respondió "{status}" sobre "{label}"{branchPart}: abre su tarjeta.',
  denyInterrupted:
    "interrumpido; puede que una sesión lich{branchPart} ya tenga la tarea, y el informe que envíe llega aquí como una nota [lich].",
  denyStopFailed: 'lich no pudo detener "{label}": {reason}',
  lichExited: "lich terminó con {code}",
  editNoteJustNow: "hace menos de un minuto",
  editNoteAgo: "hace {minutes} min",
  editNote:
    "{path} también fue editado por la sesión lich {who} en {at} ({ago}), que comparte este checkout y puede " +
    "seguir trabajando en él. Vuelve a leer el archivo antes de continuar a partir de él y coordínate con esa sesión " +
    "mediante send_to_session o lich send en lugar de deshacer su cambio.",
  skillNote:
    "\n\nEn esta sesión, un slash command integrado (compact, clear y similares) también puede nombrarse aquí, " +
    "cuando el usuario te pida ejecutarlo: se pone en cola y se ejecuta cuando termina tu turno, así que termina tu turno justo después.",
  controlNote:
    "\n\nEn esta sesión, la acción command acepta la propia sesión como destino: pasa session " +
    '"{sessionId}". El comando se pone en cola y se ejecuta cuando termina tu turno, así que termina tu turno justo después.',
  denyDefaultSaved:
    "/{name} ejecutado desde dentro de la sesión se guardaría como valor predeterminado de toda nueva sesión de Claude Code. " +
    "Pide al usuario que lo defina desde lich, cuyo override de {name} vale solo para esta sesión.",
  skillQueued: "{queued} está en cola y se ejecuta cuando termine este turno. Termina el turno ahora.",
  controlQueued: "{queued} está en cola en esta sesión y se ejecuta cuando termine este turno. Termina el turno ahora.",
}

/** @type {Record<string, Record<string, string>>} */
const catalogs = { en, "pt-BR": ptBR, "zh-CN": zhCN, es }

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
