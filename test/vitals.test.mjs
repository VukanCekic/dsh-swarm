// Self-contained unit tests for swarmVitals (lib/index.js) and stall classification in buildModel (lib/client.js).
// Run from the repo root: node --test
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const LIB_URL = new URL('../lib/index.js', import.meta.url)
const CLIENT_URL = new URL('../lib/client.js', import.meta.url)
const { swarmVitalsProjectionDefinition: def } = await import(LIB_URL)

const T0 = 1794928556000
const MIN = 60000
const call = (callId, name, time) => ({ type: 'tool/call', seq: 1, time, data: { turn: 1, step: 1, callId, name, arguments: '{}' } })
const result = (callId, time, extra = {}, text = 'ok', isError = false) => ({
  type: 'tool/result', seq: 2, time, surfaceOp: 'append',
  data: { turn: 1, step: 1, message: { role: 'tool', source: { kind: 'tool', callId }, toolCallId: callId, content: [{ type: 'text', text }], isError, id: 'm-' + callId }, ...extra },
})
const fold = (events) => events.reduce((s, e) => def.apply(s, e), def.init({ id: 'x' }, 0))

test('lastEventAt follows the newest event of any kind; unrelated older events change nothing', () => {
  let s = def.init({ id: 'x' }, 0)
  s = def.apply(s, { type: 'turn/start', seq: 6, time: T0, data: { turn: 1 } })
  assert.equal(s.lastEventAt, T0)
  const s2 = def.apply(s, { type: 'step/start', seq: 8, time: T0 + 5000, data: { turn: 1, step: 1 } })
  assert.equal(s2.lastEventAt, T0 + 5000)
  assert.equal(def.apply(s2, { type: 'assistant/message', seq: 9, time: T0 + 1, data: {} }), s2, 'older event: same state object')
  assert.equal(def.apply(s2, null), s2)
  def.stateSchema.parse(s2)
})

test('open tool call: tracked from tool/call, closed by its tool/result, dropped by turn/end', () => {
  let s = fold([call('c1', 'pwsh', T0), call('c2', 'read', T0 + 100)])
  assert.deepEqual(Object.keys(s.open), ['c1', 'c2'])
  assert.equal(s.pub.openSince, T0)
  assert.equal(s.pub.openTool, 'pwsh')
  s = def.apply(s, result('c1', T0 + 8000))
  assert.deepEqual(Object.keys(s.open), ['c2'])
  assert.equal(s.pub.openSince, T0 + 100)
  assert.equal(s.pub.openTool, 'read')
  s = def.apply(s, { type: 'turn/end', seq: 45, time: T0 + 9000, data: { turn: 1, reason: { kind: 'completed' } } })
  assert.deepEqual(s.open, {})
  assert.equal(s.pub.openSince, 0)
  assert.equal(s.lastError, null, 'a completed turn is not an error')
  // a result with no recorded call is harmless (stats projection does the same)
  assert.equal(def.apply(s, result('constructor', T0 + 9500)).pub.openSince, 0)
})

test('wait_agent / ask_user_question block by design: not an open-call stall, flagged waiting', () => {
  const s = fold([call('w', 'wait_agent', T0), call('a', 'ask_user_question', T0 + 10)])
  assert.equal(s.pub.openSince, 0)
  assert.equal(s.pub.waiting, true)
  const s2 = def.apply(s, call('p', 'pwsh', T0 + 20))
  assert.equal(s2.pub.openSince, T0 + 20)
  assert.equal(s2.pub.openTool, 'pwsh')
})

test('lastError: failed tool result (FS_NOT_FOUND shape), turn error, llm retry; success keeps it', () => {
  let s = fold([call('c1', 'read', T0)])
  s = def.apply(s, result('c1', T0 + 400, { error: { name: 'FsError', code: 'FS_NOT_FOUND' } },
    'Error: cannot read "/project/missing.md": not found', true))
  assert.deepEqual({ ...s.lastError }, {
    at: T0 + 400, kind: 'tool', tool: 'read', code: 'FS_NOT_FOUND',
    message: 'Error: cannot read "/project/missing.md": not found',
  })
  assert.deepEqual(s.open, {})
  const s2 = def.apply(def.apply(s, call('c2', 'read', T0 + 500)), result('c2', T0 + 600))
  assert.equal(s2.lastError, s.lastError, 'a later success does not erase the last error')
  const s3 = def.apply(s2, {
    type: 'llm/retry', seq: 42, time: T0 + 700,
    data: { retryId: 'r', turn: 1, step: 2, provider: 'opencode-go', retry: 1, maxRetries: 5, delayMs: 484, failure: { message: 'stream idle timeout after 300000ms', code: 'TIMEOUT' } },
  })
  assert.equal(s3.lastError.kind, 'llm')
  assert.equal(s3.lastError.code, 'TIMEOUT')
  const s4 = def.apply(s3, {
    type: 'turn/end', seq: 50, time: T0 + 800,
    data: { turn: 1, reason: { kind: 'error', error: { message: 'Authentication failed (HTTP 401)', code: 'AUTH', status: 401 } } },
  })
  assert.equal(s4.lastError.kind, 'turn')
  assert.equal(s4.lastError.code, 'AUTH')
  assert.match(s4.lastError.message, /Authentication failed/)
  // a compaction rewrite (surfaceOp is an object) is history, not a new error
  const rewrite = { ...result('c9', T0 + 900, { error: { code: 'X' } }, 'Error: old', true), surfaceOp: { op: 'replace', startSeq: 3, endSeq: 3 } }
  assert.equal(def.apply(s4, rewrite).lastError, s4.lastError)
  for (const x of [s, s2, s3, s4]) def.stateSchema.parse(x)
})

test('error text is clipped and the open-call map is capped', () => {
  const s = fold([call('c', 'read', T0), result('c', T0 + 1, { error: { code: 'E' } }, 'x'.repeat(5000), true)])
  assert.ok(s.lastError.message.length <= 240)
  let big = def.init({ id: 'x' }, 0)
  for (let i = 0; i < 500; i++) big = def.apply(big, call('id' + i, 'read', T0 + i))
  assert.equal(Object.keys(big.open).length, 64)
  assert.ok('id499' in big.open && !('id0' in big.open), 'oldest calls are dropped first')
})

test('pure: apply never mutates the input state', () => {
  const s0 = fold([call('c1', 'pwsh', T0)])
  const snapshot = JSON.stringify(s0)
  def.apply(s0, result('c1', T0 + 5, { error: { code: 'E' } }, 'boom', true))
  def.apply(s0, call('c2', 'read', T0 + 6))
  def.apply(s0, { type: 'turn/end', seq: 9, time: T0 + 7, data: { turn: 1, reason: { kind: 'completed' } } })
  assert.equal(JSON.stringify(s0), snapshot)
})

test('view is the published object: same reference while only lastEventAt creeps (no frame per event)', () => {
  let s = fold([call('c1', 'pwsh', T0)])
  const pub = def.wire.view(s)
  for (let i = 1; i <= 5; i++) s = def.apply(s, { type: 'step/start', seq: 10 + i, time: T0 + i * 1000, data: { turn: 1, step: i } })
  assert.equal(s.lastEventAt, T0 + 5000, 'state keeps the exact time')
  assert.equal(def.wire.view(s), pub, 'view reference unchanged within 10 s')
  s = def.apply(s, { type: 'step/start', seq: 30, time: T0 + 11000, data: { turn: 1, step: 9 } })
  assert.notEqual(def.wire.view(s), pub)
  assert.equal(def.wire.view(s).lastEventAt, T0 + 11000)
  def.wire.viewSchema.parse(def.wire.view(s))
  // an error changes the view at once
  const e = def.apply(s, result('c1', T0 + 11500, { error: { code: 'E' } }, 'boom', true))
  assert.equal(def.wire.view(e).lastError.code, 'E')
})

test('synthetic multi-turn session folds cleanly and validates both state and wire schemas', () => {
  const events = [
    { type: 'turn/start', seq: 1, time: T0, data: { turn: 1 } },
    call('c1', 'read', T0 + 200),
    result('c1', T0 + 500, { error: { name: 'FsError', code: 'FS_NOT_FOUND' } }, 'missing file', true),
    call('c2', 'bash', T0 + 1000),
    result('c2', T0 + 14000, {}, 'tests pass', false),
    { type: 'turn/end', seq: 6, time: T0 + 15000, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const s = fold(events)
  def.stateSchema.parse(s)
  const view = def.wire.viewSchema.parse(def.wire.view(s))
  assert.equal(s.lastEventAt, T0 + 15000)
  assert.equal(view.openSince, 0)
  assert.equal(view.lastError.code, 'FS_NOT_FOUND')
})

// ---- stall classification in buildModel (client.js) ----
function loadClient() {
  let mod
  const React = { createElement: () => null, useState: (v) => [v, () => {}], useMemo: (f) => f(), useEffect: () => {} }
  const sandbox = {
    window: { __ModuleLoader__: { load: ({ factory }) => { mod = factory((n) => (n === 'react' ? React : {})) } } },
    URLSearchParams, Date, Math, Symbol, Object, Array, String, Set, RegExp, setInterval, clearInterval,
  }
  vm.runInNewContext(readFileSync(CLIENT_URL, 'utf8'), sandbox)
  return mod
}
const { buildModel } = loadClient()
const NOW = T0 + 60 * MIN
const vit = (over = {}) => ({ lastEventAt: NOW - MIN, lastError: null, openSince: 0, openTool: '', waiting: false, ...over })
function model(vitals, { running = true, timing } = {}) {
  const w = { values: vitals === undefined ? {} : { swarmVitals: vitals, ...(timing ? { subagentTiming: timing } : {}) } }
  return buildModel('r', {
    r: { values: { agentPreset: 'swarm-lead', subagentCatalog: [{ id: 'w', name: 'worker-a', label: 'A', mode: 'continuable' }] } },
    w,
  }, { r: { running: true }, w: { running } }, NOW)
}

test('stall: running member quiet for over 5 minutes is stalled; recent activity is not', () => {
  assert.equal(model(vit({ lastEventAt: NOW - 6 * MIN })).members[0].status, 'stalled')
  assert.equal(model(vit({ lastEventAt: NOW - 6 * MIN })).members[0].stall.kind, 'silent')
  assert.equal(model(vit({ lastEventAt: NOW - 4 * MIN })).members[0].status, 'working')
  const m = model(vit({ lastEventAt: NOW - 6 * MIN }))
  assert.equal(m.stalled, 1)
  assert.equal(m.running, 1, 'a stalled member still counts as running')
})

test('stall: a tool call open over 5 minutes is stalled even with recent events', () => {
  const a = model(vit({ lastEventAt: NOW - 1000, openSince: NOW - 7 * MIN, openTool: 'pwsh' })).members[0]
  assert.equal(a.status, 'stalled')
  assert.equal(a.stall.kind, 'tool')
  assert.equal(a.stall.tool, 'pwsh')
  assert.equal(model(vit({ lastEventAt: NOW - 1000, openSince: NOW - 2 * MIN, openTool: 'pwsh' })).members[0].status, 'working')
})

test('stall: not for idle members, blocked-by-design waits, missing vitals, or a freshly woken member', () => {
  assert.notEqual(model(vit({ lastEventAt: NOW - 30 * MIN }), { running: false }).members[0].status, 'stalled', 'idle is not stalled')
  assert.equal(model(vit({ lastEventAt: NOW - 30 * MIN, waiting: true })).members[0].status, 'working', 'wait_agent / ask_user_question')
  assert.equal(model(undefined).members[0].status, 'working', 'no swarmVitals (older host): unchanged')
  assert.equal(model(vit({ lastEventAt: NOW - 3 * 60 * MIN }), { timing: { settledMs: 0, active: { since: NOW - 5000, through: NOW - 5000 } } }).members[0].status, 'working', 'turn just started')
})

test('stall: the lead is never marked stalled; lastError reaches the member row', () => {
  const m = model(vit({ lastEventAt: NOW - 6 * MIN, lastError: { at: NOW - 2 * MIN, kind: 'tool', tool: 'read', code: 'FS_NOT_FOUND', message: 'not found' } }))
  assert.equal(m.lead.stall, null)
  assert.equal(m.members[0].lastError.code, 'FS_NOT_FOUND')
  assert.equal(m.now, NOW)
})
