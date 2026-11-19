// Self-contained unit tests for the swarmBoard projection (lib/index.js).
// Run from the repo root: node --test
import test from 'node:test'
import assert from 'node:assert/strict'

const { swarmBoardProjectionDefinition: def } = await import(new URL('../lib/index.js', import.meta.url))

const T0 = 1794928500000

function splice(time, inserted) {
  return { type: 'agent/inbox/spliced', time, data: { removedCount: 0, inserted } }
}

function fold(header, events) {
  let state = def.init(header, 0)
  for (const e of events) state = def.apply(state, e)
  def.stateSchema.parse(state)
  return def.wire.viewSchema.parse(def.wire.view(state))
}

test('synthetic swarm run: user prompt, briefs, relays and closing reports fold with exact times', () => {
  const IDS = {
    coordinator: 'lead-1',
    'worker-math': 'child-math',
    'worker-strings': 'child-strings',
    'verifier-1': 'child-verifier',
  }

  const sessions = {
    coordinator: {
      header: { id: IDS.coordinator, origin: 'user' },
      events: [
        splice(T0, [{
          id: 'u1',
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'Add math and string helpers with tests.' }],
        }]),
        splice(T0 + 4000, [{
          id: 'r1',
          source: { kind: 'subagent-settled', senderSessionId: IDS['worker-math'], stopReason: 'completed' },
          content: [
            { type: 'text', text: 'Subagent worker-math settled.' },
            { type: 'text', text: 'Its closing message:' },
            { type: 'text', text: 'Added math.js and math.test.js. Tests pass.' },
          ],
        }]),
        splice(T0 + 5000, [{
          id: 'r2',
          source: { kind: 'subagent-settled', senderSessionId: IDS['worker-strings'], stopReason: 'completed' },
          content: [
            { type: 'text', text: 'Subagent worker-strings settled.' },
            { type: 'text', text: 'Its closing message:' },
            { type: 'text', text: 'Added strings.js and strings.test.js. Tests pass.' },
          ],
        }]),
        splice(T0 + 8000, [{
          id: 'r3',
          source: { kind: 'subagent-settled', senderSessionId: IDS['verifier-1'], stopReason: 'completed' },
          content: [
            { type: 'text', text: 'Subagent verifier-1 settled.' },
            { type: 'text', text: 'Its closing message:' },
            { type: 'text', text: 'VERDICT: PASS\nAll checks passed.' },
          ],
        }]),
      ],
    },
    'worker-math': {
      header: { id: IDS['worker-math'], origin: 'subagent', parentSession: IDS.coordinator },
      events: [
        splice(T0 + 1000, [{
          id: 'b1',
          source: { kind: 'user' },
          content: [
            { type: 'text', text: 'Own src/math.js and test/math.test.js.' },
            { type: 'text', text: 'Your final answer is delivered automatically to your parent.' },
          ],
        }]),
        splice(T0 + 2500, [{
          id: 'm1',
          source: { kind: 'agent-message', senderSessionId: IDS['worker-strings'] },
          content: [
            { type: 'text', text: 'Agent worker-strings sent a message:' },
            { type: 'text', text: 'What is the export name for clamp?' },
          ],
        }]),
      ],
    },
    'worker-strings': {
      header: { id: IDS['worker-strings'], origin: 'subagent', parentSession: IDS.coordinator },
      events: [
        splice(T0 + 1000, [{
          id: 'b2',
          source: { kind: 'user' },
          content: [
            { type: 'text', text: 'Own src/strings.js and test/strings.test.js.' },
            { type: 'text', text: 'Your final answer is delivered automatically to your parent.' },
          ],
        }]),
        splice(T0 + 3000, [{
          id: 'm2',
          source: { kind: 'agent-message', senderSessionId: IDS['worker-math'] },
          content: [
            { type: 'text', text: 'Agent worker-math sent a message:' },
            { type: 'text', text: 'Exported as named function clamp(value, min, max).' },
          ],
        }]),
      ],
    },
    'verifier-1': {
      header: { id: IDS['verifier-1'], origin: 'subagent', parentSession: IDS.coordinator },
      events: [
        splice(T0 + 6000, [{
          id: 'b3',
          source: { kind: 'user' },
          content: [
            { type: 'text', text: 'Verify math and strings slices and run tests.' },
            { type: 'text', text: 'Your final answer is delivered automatically to your parent.' },
          ],
        }]),
      ],
    },
  }

  const nameOf = Object.fromEntries(Object.entries(IDS).map(([n, id]) => [id, n]))
  const board = []
  for (const [name, { header, events }] of Object.entries(sessions)) {
    for (const p of fold(header, events)) {
      board.push({ ...p, to: name, from: nameOf[p.from] || p.from })
    }
  }
  board.sort((a, b) => a.at - b.at)

  const kinds = (k) => board.filter((p) => p.kind === k)
  assert.equal(kinds('user').length, 1, 'one user prompt')
  assert.equal(kinds('brief').length, 3, 'three briefs')
  assert.equal(kinds('message').length, 2, 'two peer send_message relays')
  assert.equal(kinds('report').length, 3, 'three closing reports reach the coordinator')
  assert.ok(kinds('brief').every((p) => p.from === 'coordinator'), 'briefs come from the coordinator')
  assert.ok(kinds('report').every((p) => p.to === 'coordinator'))
  assert.match(kinds('report').at(-1).text, /VERDICT: PASS/)
  assert.ok(kinds('brief').every((p) => !p.text.includes('Your final answer is delivered')), 'harness note stripped')
  assert.equal(kinds('message')[0].text, 'What is the export name for clamp?', 'message frame stripped')
  assert.ok(board.every((p) => p.at >= T0), 'every post keeps its timestamp')
})

test('subagent/descriptor marks child sessions even when header lacks parentSession', () => {
  const posts = fold({ id: 'late-child' }, [
    { type: 'subagent/descriptor', time: T0, data: {} },
    splice(T0 + 100, [{
      id: 'b1',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'First prompt is the brief.' }],
    }]),
    splice(T0 + 200, [{
      id: 'u2',
      source: { kind: 'user' },
      content: [{ type: 'text', text: 'Second user input is human typing.' }],
    }]),
  ])
  assert.equal(posts.length, 2)
  assert.equal(posts[0].kind, 'brief')
  assert.equal(posts[0].from, 'parent')
  assert.equal(posts[1].kind, 'user')
  assert.equal(posts[1].from, 'you')
})

test('fold is pure: unrelated events and empty inserts return the same state object', () => {
  const s = def.init({ id: 'x' }, 0)
  assert.equal(def.apply(s, { type: 'assistant/message', data: {} }), s)
  assert.equal(def.apply(s, { type: 'agent/inbox/spliced', data: { removedCount: 1, inserted: [] } }), s)
})
