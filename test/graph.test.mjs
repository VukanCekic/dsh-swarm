import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

function renderGraph(m, replayAt = null) {
  const elements = []
  let firstState = true
  const React = {
    createElement(type, props, ...children) {
      const element = { type, props: props || {}, children }
      elements.push(element)
      return element
    },
    useState(initial) {
      const value = firstState ? replayAt : initial
      firstState = false
      return [value, () => {}]
    },
    useRef: () => ({ current: null }),
    useId: () => 'graph-test',
    useEffect: () => {},
  }
  let Graph
  const window = {
    __ModuleLoader__: {
      load({ factory }) {
        Graph = factory(name => name === 'react' ? React : {}).Graph
      },
    },
  }
  // Expose the private component in the VM only.
  vm.runInNewContext(client.replace('return module.exports;', 'exports.Graph = Graph; return module.exports;'), { window })
  Graph({ m })
  return elements
}

const roles = ['worker', 'worker', 'worker', 'verifier', 'monitor']
const statuses = ['working', 'done', 'pass', 'fail', 'stopped', 'stalled']
const members = Array.from({ length: 60 }, (_, i) => ({
  name: roles[i % roles.length] + '-' + (i + 1) + '-with-a-deliberately-long-name',
  role: roles[i % roles.length],
  status: statuses[i % statuses.length],
}))

test('the coordinator and all 60 members fit in the viewBox without overlapping', () => {
  const elements = renderGraph({ members, posts: [], leadRunning: true })
  const [x, y, width, height] = elements.find(el => el.type === 'svg').props.viewBox.split(' ').map(Number)
  const boxes = elements.filter(el => el.type === 'g' && el.props.className === 'node').map(node => {
    const rect = node.children.find(el => el.type === 'rect').props
    const [left, top] = node.props.transform.slice('translate('.length, -1).split(',').map(Number)
    return { name: node.props.key, left, top, right: left + rect.width, bottom: top + rect.height }
  })
  assert.equal(boxes.length, members.length + 1)
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      assert.ok(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top,
        a.name + ' overlaps ' + b.name)
    }
    assert.ok(a.left >= x && a.top >= y && a.right <= x + width && a.bottom <= y + height,
      a.name + ' is outside the viewBox')
  }
})

test('replay highlights the sender and every recipient and retains peer arrows', () => {
  const [a, b, c] = members
  const posts = [
    { no: 1, from: 'coordinator', to: [a.name], kind: 'brief', at: 1000, exact: true },
    { no: 2, from: a.name, to: [b.name, c.name], kind: 'message', at: 2000, exact: true },
    { no: 3, from: b.name, to: ['coordinator'], kind: 'report', at: 3000, exact: true },
  ]
  const elements = renderGraph({ members, posts, leadRunning: true }, 2)
  const hotNodes = elements.filter(el => el.props.className === 'node' && el.props['data-hot'] !== undefined)
  assert.deepEqual(hotNodes.map(el => el.props.key), [a.name, b.name, c.name])
  assert.equal(elements.filter(el => el.type === 'path' && el.props.className === 'edge').length, 2)
  assert.deepEqual(elements.filter(el => el.props.className === 'node-count').map(el => el.children[0]),
    [1, ...Array(members.length - 1).fill(0)])
})
