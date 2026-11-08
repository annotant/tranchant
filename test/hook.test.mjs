// scripts/hook.mjs, run as Claude Code runs a finding's agent's hooks: the
// event as JSON on stdin, a deny as JSON on stdout.
import assert from 'node:assert/strict'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import {
  createStore,
  historyPath,
  progressPath,
} from '../skills/tranchant/scripts/lib/store.mjs'
import { SCRIPTS, importReview, run, tempDir } from './helpers.mjs'

/** @type {string} */
let stateDir

before(async (t) => {
  stateDir = await tempDir(t)
})

const HOOK = path.join(SCRIPTS, 'hook.mjs')
let ids = 0
let reviews = 0

/**
 * A review with its first `count` findings queued for a fix; `lockRoot`: the
 * repository the project is in.
 * @param {import('node:test').TestContext} t
 * @param {number} [count]
 * @param {{ lockRoot?: string }} [options]
 */
async function world(t, count = 1, { lockRoot } = {}) {
  const { dir, project } = await importReview(t, 'ours', stateDir, {
    id: `review-${++reviews}`,
    ...(lockRoot ? { project: path.join(lockRoot, `web${reviews}`) } : {}),
  })
  const root = lockRoot ? path.join(lockRoot, `web${reviews}`) : project
  const store = createStore(dir)
  /** @type {string[]} */
  const queued = []
  for (let i = 0; i < count; i++) {
    const id = `f-0${i + 1}`
    await store.decide(id, { action: 'fix' })
    queued.push(id)
  }
  const id = (/** @type {number} */ index) => queued[index]
  /**
   * Runs the hook of finding `index`'s agent.
   * @param {number} index
   * @param {string} mode
   * @param {Record<string, unknown> | string} [event] A string as is.
   */
  const hook = async (index, mode, event = {}) => {
    const ran = await run(
      process.execPath,
      [
        HOOK,
        mode,
        '--finding',
        id(index),
        '--review',
        dir,
        '--project',
        root,
        ...(lockRoot ? ['--lock-root', lockRoot] : []),
      ],
      {
        input:
          typeof event === 'string'
            ? event
            : JSON.stringify({ agent_id: `a${index + 1}`, ...event }),
        env: {
          TRANCHANT_STATE_DIR: stateDir,
          TRANCHANT_LOCK_WAIT_MS: '300',
          // The machine's settings would name a model for the Started step.
          XDG_CONFIG_HOME: stateDir,
        },
      },
    )
    assert.equal(ran.code, 0, ran.stderr)
    return ran.stdout
      ? JSON.parse(ran.stdout).hookSpecificOutput.permissionDecisionReason
      : undefined
  }
  /**
   * A tool's two hooks, `between` run between them; the deny when pre refuses it.
   * @param {number} index
   * @param {string} name
   * @param {Record<string, unknown>} input
   * @param {{ between?: () => Promise<unknown>, error?: string }} [options]
   */
  const tool = async (index, name, input, { between, error } = {}) => {
    const event = { tool_name: name, tool_input: input, tool_use_id: `t${++ids}` }
    const deny = await hook(index, 'pre', event)
    if (deny) return deny
    await between?.()
    await hook(index, 'post', error ? { ...event, error } : event)
    return undefined
  }
  const claim = (index) =>
    tool(
      index,
      'Bash',
      { command: `node ${SCRIPTS}claim.mjs ${id(index)} --review ${dir}` },
      {
        between: () =>
          store.claim(id(index), { agent: `a${index + 1}`, model: 'claude-opus-5-5' }),
      },
    )
  const progress = async (index) =>
    (await readFile(progressPath(dir, id(index)), 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  /** Moves the finding as the reviewer would, in the file. */
  const setState = async (index, state) => {
    const file = path.join(dir, 'decisions.json')
    const decisions = JSON.parse(await readFile(file, 'utf8'))
    decisions.findings[id(index)].state = state
    await writeFile(file, JSON.stringify(decisions))
  }
  return { dir, root, store, hook, tool, claim, progress, setState, id }
}

const edit = (file) => ({ file_path: file, old_string: 'a', new_string: 'b' })

test("records a claimed run's steps, and ends the run on done", async (t) => {
  const w = await world(t, 2)
  await w.tool(0, 'Read', { file_path: path.join(w.root, 'package.json') })
  await w.claim(0)
  await w.tool(0, 'Edit', edit(path.join(w.root, 'src/App.tsx')))
  const steps = await w.progress(0)
  // Nothing before the claim: no run yet. The Started step names the model.
  assert.deepEqual(
    steps.map((step) => ({
      kind: step.kind,
      label: step.label,
      state: step.state,
      run: step.run,
      agent: step.agent,
    })),
    [
      { kind: 'start', label: 'Started', state: 'done', run: 'r1', agent: 'a1' },
      { kind: 'edit', label: 'src/App.tsx', state: 'running', run: 'r1', agent: 'a1' },
      { kind: 'edit', label: 'src/App.tsx', state: 'done', run: 'r1', agent: 'a1' },
    ],
  )
  assert.equal(steps[0].model, 'claude-opus-5-5')
  assert.equal(steps[1].file, 'src/App.tsx')

  await w.tool(
    0,
    'Bash',
    { command: `node ${SCRIPTS}done.mjs ${w.id(0)} --review . "Done."` },
    { between: () => w.store.done(w.id(0), 'Done.') },
  )
  assert.deepEqual(await w.progress(0), [])
  // The whole run is in the history: its three steps, the done.mjs call as
  // it started, and that call done, last.
  const history = (await readFile(historyPath(w.dir, w.id(0)), 'utf8'))
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert.deepEqual(
    history.map((step) => [step.kind, step.state, step.run]),
    [
      ['start', 'done', 'r1'],
      ['edit', 'running', 'r1'],
      ['edit', 'done', 'r1'],
      ['bash', 'running', 'r1'],
      ['bash', 'done', undefined],
    ],
  )
  // Its locks went with the run.
  await w.claim(1)
  assert.equal(await w.tool(1, 'Edit', edit(path.join(w.root, 'src/App.tsx'))), undefined)
})

test('a write records its path from the project; outside the repository, its label is a name', async (t) => {
  const w = await world(t, 1)
  await w.claim(0)
  await w.tool(0, 'Write', { file_path: '/tmp/elsewhere/App.tsx', content: 'x' })
  const outside = (await w.progress(0)).at(-1)
  assert.equal(outside?.label, 'App.tsx')
  assert.equal(outside?.file, path.relative(w.root, '/tmp/elsewhere/App.tsx'))
  assert.match(outside?.file ?? '', /^\.\.\//)
})

test("refuses a file another finding's agent holds, after the wait", async (t) => {
  const w = await world(t, 2)
  await w.claim(0)
  await w.claim(1)
  assert.equal(
    await w.tool(1, 'Edit', edit(path.join(w.root, 'src/Other.tsx'))),
    undefined,
  )
  assert.equal(await w.tool(0, 'Edit', edit(path.join(w.root, 'src/App.tsx'))), undefined)

  const deny = await w.tool(1, 'Edit', edit(path.join(w.root, 'src/App.tsx')))
  assert.match(
    deny ?? '',
    new RegExp(`src/App\\.tsx is being changed by the agent of finding ${w.id(0)}`),
  )
  assert.match(deny ?? '', /Your 1 lock\(s\) were released/)
  assert.equal((await w.progress(1)).at(-1).state, 'failed')
  // The second agent let src/Other.tsx go: the first takes it at once.
  assert.equal(
    await w.tool(0, 'Edit', edit(path.join(w.root, 'src/Other.tsx'))),
    undefined,
  )
})

test('an agent that stops holds nothing; one whose finding was stopped neither', async (t) => {
  const w = await world(t, 3)
  for (const index of [0, 1, 2]) await w.claim(index)
  await w.tool(0, 'Edit', edit(path.join(w.root, 'src/App.tsx')))
  await w.hook(0, 'stop', { hook_event_name: 'Stop' })
  assert.equal(await w.tool(1, 'Edit', edit(path.join(w.root, 'src/App.tsx'))), undefined)
  // The reviewer stopped finding 2: its agent's lock is stale.
  await w.setState(1, 'stopped')
  assert.equal(await w.tool(2, 'Edit', edit(path.join(w.root, 'src/App.tsx'))), undefined)
})

test('a finding its agent left working when its turn ended fails', async (t) => {
  const w = await world(t, 3)
  await w.claim(0)
  await w.claim(1)
  await w.store.done(w.id(1), 'Done.')
  await w.store.claim(w.id(2), { agent: 'a3' })
  await w.tool(0, 'Edit', edit(path.join(w.root, 'src/App.tsx')))
  const ended = (index, agent = 'a1') =>
    run(
      process.execPath,
      [
        HOOK,
        'ended',
        '--finding',
        w.id(index),
        '--review',
        w.dir,
        '--project',
        w.root,
        '--agent',
        agent,
      ],
      { input: '', env: { TRANCHANT_STATE_DIR: stateDir } },
    )
  assert.equal((await ended(0)).stdout.trim(), `AGENT_ENDED ${w.id(0)}`)
  // A fixed finding, or one failed already, stays as it is.
  assert.equal((await ended(1)).stdout, '')
  assert.equal((await ended(0)).stdout, '')
  // Another agent's end leaves a run it did not claim.
  assert.equal((await ended(2, 'a1')).stdout, '')
  const { findings } = await w.store.readDecisions()
  assert.equal(findings[w.id(2)].state, 'working')
  assert.equal(findings[w.id(0)].state, 'failed')
  assert.equal(findings[w.id(0)].reason, 'the agent ended without done.mjs or ask.mjs')
  assert.equal(findings[w.id(0)].runs[0].outcome, 'failed')
  assert.equal(findings[w.id(1)].state, 'fixed')
  // Its lock went with it.
  assert.equal(await w.tool(2, 'Edit', edit(path.join(w.root, 'src/App.tsx'))), undefined)
})

test('tells an agent whose finding the reviewer stopped or dropped to stop', async (t) => {
  const w = await world(t)
  await w.claim(0)
  for (const state of ['stopped', 'dropped', 'fixed']) {
    await w.setState(0, state)
    assert.match(
      (await w.tool(0, 'Edit', edit(path.join(w.root, 'src/App.tsx')))) ?? '',
      /reply "CANCELLED"/,
      state,
    )
  }
})

test("the Started step takes the settings' model when claim.mjs recorded none", async (t) => {
  const w = await world(t)
  const file = path.join(stateDir, 'tranchant', 'settings.json')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ version: 1, fixModel: 'claude-haiku-5-5' }))
  try {
    await w.tool(
      0,
      'Bash',
      { command: `node ${SCRIPTS}claim.mjs ${w.id(0)} --review ${w.dir}` },
      { between: () => w.store.claim(w.id(0), { agent: 'a1' }) },
    )
    assert.equal((await w.progress(0))[0].model, 'claude-haiku-5-5')
  } finally {
    await rm(file, { force: true })
  }
})

test("refuses to write the person's settings file, by any tool", async (t) => {
  const w = await world(t)
  await w.claim(0)
  const file = path.join(stateDir, 'tranchant', 'settings.json')
  /** @type {[string, Record<string, unknown>][]} */
  const attempts = [
    ['Write', { file_path: file, content: '{}' }],
    ['Edit', edit(file)],
    ['Bash', { command: `cat > ${file} <<'EOF'\n{}\nEOF` }],
  ]
  for (const [tool, input] of attempts) {
    assert.match(
      (await w.tool(0, tool, input)) ?? '',
      /settings file|Edit or Write tool/,
      tool,
    )
  }
})

test('refuses a Bash command that writes files, which no lock covers', async (t) => {
  const w = await world(t)
  await w.claim(0)
  const writes = [
    `python3 - <<'EOF'\np='src/a.ts'\nopen(p, 'w').write('x')\nEOF`,
    `node -e "require('fs').writeFileSync('src/a.ts', 'x')"`,
    `sed -i '' 's/a/b/' src/a.ts`,
    `perl -pi -e 's/a/b/' src/a.ts`,
    `cat > src/a.ts <<'EOF'\nx\nEOF`,
    `echo x | tee src/a.ts`,
  ]
  for (const command of writes) {
    assert.match(
      (await w.tool(0, 'Bash', { command })) ?? '',
      /Edit or Write tool/,
      command,
    )
  }
  assert.equal((await w.progress(0)).at(-1).state, 'failed')
  for (const command of ['pnpm exec vitest run src/people', `sed -n '1,20p' src/a.ts`]) {
    assert.equal(await w.tool(0, 'Bash', { command }), undefined, command)
  }
  // Its summary passes, whatever it quotes.
  const summary = `node ${SCRIPTS}done.mjs ${w.id(0)} --review ${w.dir} <<'EOF'\nNo more open(p, 'w').\nEOF`
  assert.equal(
    await w.hook(0, 'pre', { tool_name: 'Bash', tool_input: { command: summary } }),
    undefined,
  )
})

test('sends AskUserQuestion to the page', async (t) => {
  const w = await world(t)
  await w.claim(0)
  const deny = await w.tool(0, 'AskUserQuestion', { questions: [] })
  // The review folder quoted: a path may hold a space.
  assert.ok(
    deny?.includes(
      `node ${JSON.stringify(path.join(SCRIPTS, 'ask.mjs'))} ${w.id(0)} --review ${JSON.stringify(w.dir)} "<question>"`,
    ),
    deny,
  )
  // Not a step the reviewer sees.
  assert.deepEqual(
    (await w.progress(0)).map((step) => step.kind),
    ['start'],
  )
})

test('locks files across the git repository, outside the project too', async (t) => {
  const repo = await tempDir(t)
  const w = await world(t, 2, { lockRoot: repo })
  await w.claim(0)
  await w.claim(1)
  const shared = path.join(repo, 'scanner/x.py')
  assert.equal(await w.tool(0, 'Edit', edit(shared)), undefined)
  assert.equal((await w.progress(0)).at(-1).label, '../scanner/x.py')
  assert.match(
    (await w.tool(1, 'Edit', edit(shared))) ?? '',
    /scanner\/x\.py is being changed/,
  )
})

test('keeps a lock another review of the repository holds while its finding is at work', async (t) => {
  const repo = await tempDir(t)
  const web = await world(t, 1, { lockRoot: repo })
  const admin = await world(t, 1, { lockRoot: repo })
  await web.claim(0)
  await admin.claim(0)
  const shared = path.join(repo, 'packages/ui/Button.tsx')
  assert.equal(await web.tool(0, 'Edit', edit(shared)), undefined)
  assert.match(
    (await admin.tool(0, 'Edit', edit(shared))) ?? '',
    /packages\/ui\/Button\.tsx is being changed/,
  )
  // Stale once the reviewer stopped it, in its own review's decisions.
  await web.setState(0, 'stopped')
  assert.equal(await admin.tool(0, 'Edit', edit(shared)), undefined)
})

test('a build holds the build lock until it ends, failed or not', async (t) => {
  const w = await world(t, 2)
  await w.claim(0)
  await w.claim(1)
  let during
  await w.tool(
    0,
    'Bash',
    { command: 'npm run build' },
    {
      between: async () => {
        during = await w.tool(1, 'Bash', { command: 'npx vite build' })
      },
      error: 'Exit code 1',
    },
  )
  assert.match(during ?? '', /@build is being changed/)
  assert.equal((await w.progress(0)).at(-1).detail, 'Exit code 1')
  assert.equal(await w.tool(1, 'Bash', { command: 'npx vite build' }), undefined)
})

test("records what the hooks module notes of the agent's words, in the run", async (t) => {
  const w = await world(t)
  await w.hook(0, 'note', '{"at":1,"kind":"note","label":"Before the claim"}')
  await w.claim(0)
  await w.hook(0, 'note', '{"at":2,"kind":"note","label":"Early return added."}')
  assert.deepEqual(
    (await w.progress(0)).map((step) => [step.kind, step.run]),
    [
      ['start', 'r1'],
      ['note', 'r1'],
    ],
  )
})

test('never stands in the way of the tool when it cannot read its input', async (t) => {
  const w = await world(t)
  assert.equal(await w.hook(0, 'pre', 'not json'), undefined)
})
