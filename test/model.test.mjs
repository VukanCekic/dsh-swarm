// Self-contained unit tests for the Swarm pane model in lib/client.js.
// Loads lib/client.js with a stub module loader and checks buildModel against synthetic fixtures.
// Run from the repo root: node --test
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const CLIENT_URL = new URL('../lib/client.js', import.meta.url)

function load() {
  let mod
  const React = { createElement: () => null, useState: (v) => [v, () => {}], useMemo: (f) => f(), useEffect: () => {} }
  const sandbox = {
    window: { __ModuleLoader__: { load: ({ factory }) => { mod = factory((n) => (n === 'react' ? React : {})) } } },
    URLSearchParams, Date, Math, Symbol, Object, Array, String, Set, RegExp, setInterval, clearInterval,
  }
  vm.runInNewContext(readFileSync(CLIENT_URL, 'utf8'), sandbox)
  return mod
}

test('fallback board (pre-swarmBoard): lead, 2 workers, 1 verifier with PASS, cost and context', () => {
  const { buildModel } = load()
  const T0 = 1794928500000
  const projections = {
    lead: {
      state: 'ready',
      values: {
        agentPreset: 'swarm-lead',
        contextPressure: { pressureTokens: 48000, contextWindow: 1000000 },
        modelSelection: { lastUsed: { model: 'deepseek-v4.1-flash', reasoningEffort: 'max' } },
        tokenUsage: { totals: { uncachedInputTokens: 20000, cacheReadTokens: 100000, cacheWriteTokens: 10000, outputTokens: 5000 } },
        turnOutline: { turns: [{ turn: 1, response: 'SWARM DONE\nAll slices merged and verified.' }] },
        subagentCatalog: [
          { id: 'w1', name: 'worker-math', label: 'Add math helpers', mode: 'continuable', childCreatedAt: T0 + 1000 },
          { id: 'w2', name: 'worker-strings', label: 'Add string helpers', mode: 'continuable', childCreatedAt: T0 + 1100 },
          { id: 'v1', name: 'verifier-1', label: 'Verify slices', mode: 'continuable', childCreatedAt: T0 + 40000 },
        ],
      },
    },
    w1: {
      state: 'ready',
      values: {
        agentPreset: 'swarm-worker',
        modelSelection: { lastUsed: { model: 'deepseek-v4.1-flash', reasoningEffort: 'high' } },
        tokenUsage: { totals: { uncachedInputTokens: 30000, cacheReadTokens: 150000, cacheWriteTokens: 15000, outputTokens: 10000 } },
        subagentTiming: { settledMs: 32000, lastTurnCompleted: true },
        turnOutline: {
          turns: [
            { turn: 1, response: 'Implemented math.js.' },
            { turn: 2, response: 'Fixed edge case in clamp().' },
          ],
        },
      },
    },
    w2: {
      state: 'ready',
      values: {
        agentPreset: 'swarm-worker',
        modelSelection: { lastUsed: { model: 'deepseek-v4.1-flash', reasoningEffort: 'high' } },
        tokenUsage: { totals: { uncachedInputTokens: 25000, cacheReadTokens: 120000, cacheWriteTokens: 10000, outputTokens: 8000 } },
        subagentTiming: { settledMs: 28000, lastTurnCompleted: true },
        turnOutline: { turns: [{ turn: 1, response: 'Implemented strings.js.' }] },
      },
    },
    v1: {
      state: 'ready',
      values: {
        agentPreset: 'swarm-verifier',
        modelSelection: { lastUsed: { model: 'deepseek-v4.1-flash', reasoningEffort: 'max' } },
        tokenUsage: { totals: { uncachedInputTokens: 40000, cacheReadTokens: 200000, cacheWriteTokens: 20000, outputTokens: 6000 } },
        subagentTiming: { settledMs: 18000, lastTurnCompleted: true },
        turnOutline: { turns: [{ turn: 1, response: 'PASS\nAll tests pass.' }] },
      },
    },
  }
  const byId = {
    lead: { running: false, title: 'Utility helpers' },
    w1: { running: false },
    w2: { running: false },
    v1: { running: false },
  }
  const m = buildModel('lead', projections, byId, T0 + 70000)

  assert.equal(m.isSwarm, true)
  assert.equal(m.realBoard, false)
  assert.equal(m.title, 'Utility helpers')
  assert.deepEqual(
    JSON.parse(JSON.stringify(m.members.map((a) => [a.name, a.role]))),
    [['worker-math', 'worker'], ['worker-strings', 'worker'], ['verifier-1', 'verifier']],
  )
  const v = m.members[2]
  assert.equal(v.verdict, 'PASS')
  assert.equal(v.status, 'pass')
  assert.equal(m.members[0].effort, 'high')
  assert.equal(v.effort, 'max')
  assert.equal(m.lead.ctx.contextWindow, 1000000)
  assert.ok(m.cost > 0.08 && m.cost < 0.10, `expected synthetic cost around $0.089, got ${m.cost}`)
  assert.equal(m.posts.filter((p) => p.kind === 'brief').length, 3)
  assert.equal(m.posts.filter((p) => p.kind === 'followup').length, 1)
  assert.equal(m.posts.filter((p) => p.kind === 'report').length, 4)
  assert.equal(m.posts.at(-1).kind, 'done')
  assert.deepEqual(
    JSON.parse(JSON.stringify(m.posts.map((p) => p.no))),
    Array.from({ length: m.posts.length }, (_, i) => i + 1),
  )
  assert.equal(v.lastPost.verdict, 'PASS')
  for (const a of m.members) {
    const mine = m.posts.filter((p) => p.member === a.name)
    assert.equal(mine[0].kind, 'brief', `${a.name}: the brief comes first`)
  }
})

test('real board: swarmBoard lists merge into one timed board, worker-to-worker included', () => {
  const { buildModel } = load()
  const projections = {
    r: {
      values: {
        agentPreset: 'swarm-lead',
        subagentCatalog: [
          { id: 'a', name: 'worker-a', label: 'A', mode: 'continuable' },
          { id: 'b', name: 'worker-b', label: 'B', mode: 'continuable' },
          { id: 'v', name: 'verifier-1', label: 'check', mode: 'continuable' },
          { id: 'm', name: 'monitor', label: 'Watch for stalls', mode: 'continuable' },
        ],
        swarmBoard: [
          { at: 1000, kind: 'user', from: 'you', text: 'do it' },
          { at: 5000, kind: 'report', from: 'v', text: 'VERDICT: FAIL\n1. a.js:3' },
        ],
      },
    },
    a: {
      values: {
        swarmBoard: [
          { at: 2000, kind: 'brief', from: 'r', text: 'own a.js' },
          { at: 4500, kind: 'message', from: 'v', text: '1. a.js:3 off by one' },
        ],
      },
    },
    b: {
      values: {
        swarmBoard: [
          { at: 2000, kind: 'brief', from: 'r', text: 'own b.js' },
          { at: 3000, kind: 'message', from: 'a', text: 'what is the export name?' },
        ],
      },
    },
    v: { values: {} },
    m: { values: { agentPreset: 'swarm-monitor' } },
  }
  const m = buildModel('r', projections, { r: {}, a: {}, b: {}, v: {}, m: {} })
  assert.equal(m.realBoard, true)
  // JSON compare: arrays built inside the vm sandbox have another Array prototype.
  assert.deepEqual(
    JSON.parse(JSON.stringify(m.posts.map((p) => p.from + '>' + p.to[0]))),
    ['you>coordinator', 'coordinator>worker-a', 'coordinator>worker-b', 'worker-a>worker-b', 'verifier-1>worker-a', 'verifier-1>coordinator'],
  )
  assert.equal(m.posts.at(-1).verdict, 'FAIL')
  assert.ok(m.posts.every((p) => p.exact))
  assert.equal(m.members[3].role, 'monitor')
})

test('a worker chat resolves to its coordinator', () => {
  const { buildModel } = load()
  const projections = {
    r: { values: { agentPreset: 'swarm-lead', subagentCatalog: [{ id: 'w', name: 'worker-a', label: 'A', mode: 'continuable' }] } },
    w: { values: {} },
  }
  const m = buildModel('w', projections, { r: { running: false }, w: { running: true, parentId: 'r' } })
  assert.equal(m.rootId, 'r')
  assert.equal(m.members[0].name, 'worker-a')
})

test('browser shape: turnOutline as a plain array still yields the verdict', () => {
  const { buildModel } = load()
  const m = buildModel('r', {
    r: {
      values: {
        agentPreset: 'swarm-lead',
        tokenUsage: { uncachedInputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        subagentCatalog: [{ id: 'v', name: 'verifier-1', label: 'check', mode: 'continuable' }],
      },
    },
    v: { values: { turnOutline: [{ turn: 1, seq: 3, prompt: '', response: 'VERDICT: FAIL\n1. a.js:3 off by one' }] } },
  }, { r: { running: false }, v: { running: false } })
  assert.equal(m.members[0].verdict, 'FAIL')
  assert.equal(m.members[0].status, 'fail')
  assert.equal(m.lead.status, 'done')
})

test('running worker shows as working; empty session is not a swarm', () => {
  const { buildModel } = load()
  const m = buildModel('x', {
    x: { values: { agentPreset: 'swarm-lead', subagentCatalog: [{ id: 'w', name: 'worker-a', label: 'A', mode: 'continuable' }] } },
  }, { x: { running: false }, w: { running: true } })
  assert.equal(m.running, 1)
  assert.equal(m.members[0].status, 'working')
  assert.equal(buildModel('y', {}, {}).isSwarm, false)
})
