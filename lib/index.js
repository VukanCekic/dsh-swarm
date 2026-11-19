/**
 * Host half of dsh-swarm: the `swarmBoard` session projection.
 *
 * DeepSeek Harness already delivers every message a member of a subagent tree receives through its inbox and logs it
 * as `agent/inbox/spliced` with an exact time, the sender's session id and the full text. This projection folds those
 * received posts per session; the pane (lib/client.js) merges the coordinator's and every member's list into one
 * board, Antigravity-style. It reads only events that are already logged and appends nothing.
 *
 * Post kinds:
 * - `brief`   the first `user` input of a subagent session (its parent's delegation prompt)
 * - `user`    a `user` input on a root session, or a later one on a child (the human typing)
 * - `message` an `agent-message` relay (send_message from any member of the tree)
 * - `report`  a `subagent-settled` notice (a child's closing message to its parent)
 *
 * A second projection, `swarmVitals`, is the passive stall signal: when the session last logged anything, its last
 * error, and whether a tool call has been open for a long time. It is separate from `swarmBoard` on purpose: a
 * projection frame carries the whole view, and the board view (up to 400 posts) must not be re-sent on every event.
 */

/** Cordis plugin name. */
export const name = 'dsh-swarm-board'
/** The projection registry is the plugin's whole purpose. */
export const inject = ['sessionProjections']

const MAX_POSTS = 400
const MAX_TEXT = 4000

function textOf(blocks, from = 0) {
  const parts = []
  for (let i = from; i < (blocks || []).length; i++) {
    const b = blocks[i]
    if (b && b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
  }
  const t = parts.join('\n').trim()
  return t.length > MAX_TEXT ? t.slice(0, MAX_TEXT - 1) + '…' : t
}

/**
 * Turn one inbox item into a post, or null when it is not a message between members or from the human.
 * @param item - one inserted inbox entry ({ content, source, id }).
 * @param state - current fold state (is this a child, was its brief seen).
 * @param time - the event's time in ms.
 */
export function postOf(item, state, time) {
  const src = (item && item.source) || {}
  const content = item && item.content
  if (src.kind === 'agent-message') {
    // Block 0 is the frame "Agent <name> sent a message: "; the message follows.
    const first = content && content[0] && content[0].text
    const framed = typeof first === 'string' && /^Agent .* sent a message:\s*$/.test(first)
    return { at: time, kind: 'message', from: src.senderSessionId || '', text: textOf(content, framed ? 1 : 0), id: item.id || '' }
  }
  if (src.kind === 'subagent-settled') {
    // Blocks: summary line, "Its closing message:", the message.
    const idx = (content || []).findIndex((b) => b && b.type === 'text' && /^Its closing message:?\s*$/.test(b.text || ''))
    return {
      at: time, kind: 'report', from: src.senderSessionId || '', text: textOf(content, idx >= 0 ? idx + 1 : 0),
      stop: src.stopReason || '', id: item.id || '',
    }
  }
  if (src.kind === 'user') {
    if (state.child && !state.briefSeen) {
      // Block 0 is the parent's prompt; block 1 is the harness note about the final answer.
      return { at: time, kind: 'brief', from: state.parent || 'parent', text: textOf(content, 0).split('\nYour final answer is delivered automatically')[0], id: item.id || '' }
    }
    return { at: time, kind: 'user', from: 'you', text: textOf(content, 0), id: item.id || '' }
  }
  return null
}

/** Fold one logged event. Pure; returns the same state object when nothing changes. */
export function applyBoard(state, event) {
  if (!event || event.type !== 'agent/inbox/spliced') {
    if (event && event.type === 'subagent/descriptor' && !state.child) return { ...state, child: true }
    return state
  }
  const inserted = event.data && Array.isArray(event.data.inserted) ? event.data.inserted : []
  if (!inserted.length) return state
  let posts = state.posts
  let briefSeen = state.briefSeen
  for (const item of inserted) {
    const p = postOf(item, { ...state, briefSeen }, event.time || 0)
    if (!p || !p.text) continue
    if (p.kind === 'brief') briefSeen = true
    posts = posts === state.posts ? posts.concat([p]) : (posts.push(p), posts)
  }
  if (posts === state.posts) return state
  if (posts.length > MAX_POSTS) posts = posts.slice(posts.length - MAX_POSTS)
  return { ...state, briefSeen, posts }
}

function initBoard(header) {
  const child = !!(header && (header.origin === 'subagent' || header.parentSession || header.delegationDepth > 0))
  return { child, parent: (header && header.parentSession) || '', briefSeen: false, posts: [] }
}

// The registry only calls .parse() on these (dsh-session-projection), so a small validator replaces zod.
function isPost(p) {
  return p && typeof p === 'object' && typeof p.at === 'number' && typeof p.kind === 'string'
    && typeof p.from === 'string' && typeof p.text === 'string'
}
const stateSchema = {
  parse(value) {
    if (!value || typeof value !== 'object' || typeof value.child !== 'boolean' || !Array.isArray(value.posts) || !value.posts.every(isPost)) {
      throw new Error('swarmBoard: invalid state')
    }
    return value
  },
}
const viewSchema = {
  parse(value) {
    if (!Array.isArray(value) || !value.every(isPost)) throw new Error('swarmBoard: invalid view')
    return value
  },
}

/** The `swarmBoard` unit registered on `ctx.sessionProjections` (exported for tests). */
export const swarmBoardProjectionDefinition = {
  key: 'swarmBoard',
  stateVersion: 1,
  stateSchema,
  init: initBoard,
  apply: applyBoard,
  wire: { viewSchema, view: (state) => state.posts, summary: false },
}

// ---------------------------------------------------------------------------------------------------------------
// swarmVitals: zero-LLM stall signal.
//
// Events used (field names confirmed in the DSH runtime source and session logs):
// - every event: `time` (ms) -> lastEventAt.
// - `tool/call`   data.callId, data.name; `tool/result` data.message.source.callId (the pairing dsh-session-stats uses),
//   data.message.isError, data.message.content[].text, data.error.{name,code} (dsh-headless json-stream.ts reads the same).
//   Only results whose envelope `surfaceOp` is 'append' (or absent) count; compaction rewrites older results.
// - `turn/end`    data.reason.kind 'error' carries data.reason.error.{message,code}; a turn end also drops every open call
//   (dsh-session-stats does the same: a call whose result never landed belonged to a cancelled or failed turn).
// - `llm/retry`   data.failure.{message,code}: a provider call failed and is being retried (e.g. TIMEOUT after 300 s idle).
// ---------------------------------------------------------------------------------------------------------------

/** Tools that block by design (waiting on a peer or on the human); an open call to one is not a stall. */
export const WAITING_TOOLS = ['wait_agent', 'ask_user_question']
const MAX_OPEN = 64
const MAX_ERROR_TEXT = 240
/** The published view moves its lastEventAt only this often (the client's threshold is minutes), so frames stay rare. */
const PUBLISH_STEP_MS = 10000

function clip(text, n = MAX_ERROR_TEXT) {
  const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n - 1) + '…' : t
}

function resultText(message) {
  const parts = []
  for (const b of (message && message.content) || []) if (b && b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
  return parts.join(' ')
}

function derivePub(state) {
  let openSince = 0
  let openTool = ''
  let waiting = false
  for (const call of Object.values(state.open)) {
    if (WAITING_TOOLS.includes(call.name)) { waiting = true; continue }
    if (!openSince || call.at < openSince) { openSince = call.at; openTool = call.name }
  }
  return { lastEventAt: state.lastEventAt, lastError: state.lastError, openSince, openTool, waiting }
}

/** Fold one logged event into the vitals. Pure; returns the same state object when the event changes nothing. */
export function applyVitals(state, event) {
  if (!event || typeof event.type !== 'string') return state
  const time = typeof event.time === 'number' && isFinite(event.time) ? event.time : 0
  const data = event.data || {}
  let open = state.open
  let lastError = state.lastError
  if (event.type === 'tool/call' && typeof data.callId === 'string') {
    open = { ...open, [data.callId]: { at: time || state.lastEventAt, name: String(data.name || '') } }
    const keys = Object.keys(open)
    if (keys.length > MAX_OPEN) open = Object.fromEntries(keys.slice(keys.length - MAX_OPEN).map((k) => [k, open[k]]))
  } else if (event.type === 'tool/result' && data.message && data.message.source) {
    const callId = data.message.source.callId
    const call = Object.hasOwn(open, callId) ? open[callId] : undefined
    if (call) open = Object.fromEntries(Object.entries(open).filter(([k]) => k !== callId))
    if (data.message.isError === true && (event.surfaceOp === undefined || event.surfaceOp === 'append')) {
      const err = data.error || {}
      lastError = {
        at: time, kind: 'tool', tool: call ? call.name : '', code: String(err.code || err.name || ''),
        message: clip(resultText(data.message)),
      }
    }
  } else if (event.type === 'turn/end') {
    if (Object.keys(open).length) open = {}
    const reason = data.reason
    if (reason && reason.kind === 'error') {
      const err = reason.error || {}
      lastError = { at: time, kind: 'turn', tool: '', code: String(err.code || ''), message: clip(err.message) }
    }
  } else if (event.type === 'llm/retry') {
    const f = data.failure || {}
    lastError = { at: time, kind: 'llm', tool: '', code: String(f.code || ''), message: clip(f.message) }
  }
  const lastEventAt = Math.max(state.lastEventAt, time)
  if (open === state.open && lastError === state.lastError && lastEventAt === state.lastEventAt) return state
  const next = { lastEventAt, lastError, open, pub: state.pub }
  const pub = derivePub(next)
  const old = state.pub
  // Keep the published object (same reference, so no frame goes out) while only lastEventAt moved a little.
  const same = pub.lastError === old.lastError && pub.openSince === old.openSince && pub.openTool === old.openTool
    && pub.waiting === old.waiting && pub.lastEventAt - old.lastEventAt < PUBLISH_STEP_MS
  return same ? next : { ...next, pub }
}

function initVitals() {
  return { lastEventAt: 0, lastError: null, open: {}, pub: { lastEventAt: 0, lastError: null, openSince: 0, openTool: '', waiting: false } }
}

function isError(e) {
  return e === null || (!!e && typeof e === 'object' && typeof e.at === 'number' && typeof e.kind === 'string'
    && typeof e.code === 'string' && typeof e.message === 'string' && typeof e.tool === 'string')
}
function isPub(p) {
  return !!p && typeof p === 'object' && typeof p.lastEventAt === 'number' && isError(p.lastError)
    && typeof p.openSince === 'number' && typeof p.openTool === 'string' && typeof p.waiting === 'boolean'
}
const vitalsStateSchema = {
  parse(value) {
    if (!value || typeof value !== 'object' || typeof value.lastEventAt !== 'number' || !isError(value.lastError)
      || !value.open || typeof value.open !== 'object' || Array.isArray(value.open) || !isPub(value.pub)) {
      throw new Error('swarmVitals: invalid state')
    }
    return value
  },
}
const vitalsViewSchema = {
  parse(value) {
    if (!isPub(value)) throw new Error('swarmVitals: invalid view')
    return value
  },
}

/** The `swarmVitals` unit registered on `ctx.sessionProjections` (exported for tests). */
export const swarmVitalsProjectionDefinition = {
  key: 'swarmVitals',
  stateVersion: 1,
  stateSchema: vitalsStateSchema,
  init: initVitals,
  apply: applyVitals,
  wire: { viewSchema: vitalsViewSchema, view: (state) => state.pub, summary: false },
}

/**
 * Register the projections; each registration is an effect on this plugin's fiber, so unloading removes the keys.
 * @param ctx - registrant context carrying the projection registry.
 */
export async function apply(ctx) {
  await ctx.sessionProjections.register(swarmBoardProjectionDefinition)
  await ctx.sessionProjections.register(swarmVitalsProjectionDefinition)
}
