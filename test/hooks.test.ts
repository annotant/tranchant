// The hooks module (hooks/register.ts), run by `claude plugin test .` against
// Claude Code itself: the disk, processes and tools beneath it are in memory.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { AgentOfferInput, CommandRunInput, EngineInterface, On } from 'claude-code'

import type { Served } from '../types'

type AgentSpec = Parameters<EngineInterface['agent']['register']>[0]

/** `agent.offer`'s input for one of the plugin's agent types. */
const offerOf = (agent: string): AgentOfferInput => ({
  agent,
  description: '',
  source: 'plugin',
  provider: { plugin: 'tranchant', tier: 'user' },
})

const ROOT = '/repo/web'
const FILE = `${ROOT}/.tranchant/review.json`
const DIR = '/home/u/.cache/tranchant/0123456789ab/reviews/rev-1'
const TITLE = 'Classification overview'
const READY = `READY http://127.0.0.1:4599 review=rev-1 project=${ROOT}`
const HEAD = '3552e3ef0c1d'
const INBOX = '/home/u/.cache/tranchant/inbox/rev-1.json'
const lens = (name: string) =>
  `LENS ${JSON.stringify({ name, prompt: `/lenses/${name}.md`, paths: ['**'] })}`
/** prepare.mjs's lines: the envelope it wrote, and two lenses. */
const PREPARED = [`INBOX ${INBOX}`, lens('bugs'), lens('style'), ''].join('\n')

const ok = (stdout: string, exitCode = 0) => ({
  value: {
    exitCode,
    stdout,
    stderr: '',
    isStdoutTruncated: false,
    isStderrTruncated: false,
  },
})

/** The disk, processes and tools beneath the mod, in memory. */
/** `gitRoot`: the repository the project is in, as `git rev-parse` answers. */
/** `seeded`: what `$.state`'s `serving` holds before the module runs, as after a reload. */
/** `refusing`: what open.mjs prints instead of `REVIEW <dir>`. */
/** `preparing`: what prepare.mjs prints; `pending`: what each `verify.mjs --pending` prints, in turn. */
/** `spawnRefused`: why every spawn is refused; `completeSays`: complete.mjs's refusal, exit 2. */
/** `unreadable`: the review's review.json, which the hooks cannot load. */
function world(
  on: On,
  {
    gitRoot,
    refused,
    seeded,
    refusing,
    preparing = PREPARED,
    pending = [],
    spawnRefused,
    completeSays,
    unreadable,
  }: {
    spawnRefused?: string
    completeSays?: string
    unreadable?: string
    gitRoot?: string
    refused?: string
    seeded?: Record<string, Served>
    refusing?: string
    preparing?: string
    pending?: string[]
  } = {},
) {
  const files = new Map<string, string>([
    [FILE, JSON.stringify({ version: 1, id: 'rev-1' })],
    [
      `${DIR}/review.json`,
      JSON.stringify({
        version: 1,
        id: 'rev-1',
        title: TITLE,
        project: ROOT,
        base: 'main',
        headSha: HEAD,
        ownership: 'ours',
      }),
    ],
    // The envelope prepare.mjs writes.
    [INBOX, JSON.stringify({ version: 1, id: 'rev-1', status: 'reviewing' })],
    ['/lenses/bugs.md', 'Look for bugs.\n'],
    ['/lenses/style.md', 'Look at the style.\n'],
  ])
  if (unreadable !== undefined) files.set(`${DIR}/review.json`, unreadable)
  // What the hooks did, in order: the import, the server, the page, the agents.
  const order: string[] = []
  on('fs.read', (_$, e) => {
    // The plugin's agent files.
    if (e.path.endsWith('/agents/worker.md'))
      return { value: '---\nname: worker\n---\n\nYou apply one finding.\n' }
    if (e.path.endsWith('/agents/reviewer.md'))
      return { value: '---\nname: reviewer\n---\n\nYou review one lens.\n' }
    if (e.path.endsWith('/agents/verifier.md'))
      return { value: '---\nname: verifier\n---\n\nYou verify one finding.\n' }
    const text = files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_$, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('fs.exists', (_$, e) => ({ value: files.has(e.path) }))
  // Claude Code refuses a command named after a skill (`refused`).
  on('command.register', (_$, e) => {
    if (e.name === refused)
      throw new Error(`"/${e.name}" refused: it is the plugin's skill`)
    return { value: { command: e.name } }
  })
  const tools: { name: string; isDeferred?: boolean }[] = []
  on('tool.register', (_$, e) => {
    tools.push({ name: e.name, isDeferred: e.isDeferred })
    return { value: { tool: `mcp__tranchant__${e.name}` } }
  })
  on('session.cwd', () => ({ value: ROOT }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  const toasts: string[] = []
  const logged: string[] = []
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_$, e) => {
    logged.push(e.text)
    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  // What the hooks ran: open.mjs's file, the browser's URL, each `hook.mjs
  // ended`'s and `note`'s arguments.
  const imported: string[] = []
  const browsed: string[] = []
  const endings: string[][] = []
  const notes: { argv: string[]; stdin: string }[] = []
  const prepared: { argv: string[]; cwd?: string }[] = []
  const completed: string[][] = []
  on('process.run', (_$, e) => {
    if (e.argv[1]?.endsWith('/scripts/prepare.mjs')) {
      prepared.push({ argv: e.argv.slice(2), cwd: e.init?.cwd })
      return ok(preparing)
    }
    if (e.argv[1]?.endsWith('/scripts/verify.mjs'))
      return ok((pending.shift() ?? []).map((id) => `UNVERIFIED ${id}\n`).join(''))
    if (e.argv[1]?.endsWith('/scripts/complete.mjs')) {
      completed.push(e.argv.slice(2))
      order.push('complete')
      return completeSays === undefined ? ok('COMPLETE\n') : ok(`${completeSays}\n`, 2)
    }
    if (e.argv.includes('--show-toplevel')) {
      return {
        value: {
          exitCode: gitRoot ? 0 : 128,
          stdout: gitRoot ? `${gitRoot}\n` : '',
          stderr: gitRoot ? '' : 'fatal: not a git repository',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    }
    if (e.argv[1]?.endsWith('/scripts/open.mjs')) {
      imported.push(e.argv[2] ?? '')
      order.push('import')
      return ok(`${refusing ?? `REVIEW ${DIR}`}\n`)
    }
    if (e.argv[2] === 'ended') {
      endings.push(e.argv.slice(3))
      return ok('')
    }
    if (e.argv[2] === 'note') {
      notes.push({ argv: e.argv.slice(3), stdin: e.init?.stdin ?? '' })
      return ok('')
    }
    if (e.argv[0] === 'open' || e.argv[0] === 'xdg-open') {
      browsed.push(`${e.argv[0]} ${e.argv[1] ?? ''}`)
      order.push('page')
      return ok('')
    }
    return ok('')
  })
  const stopped: string[] = []
  on('tool.call', (_$, e) => {
    if (e.tool === 'TaskStop') stopped.push(e.task_id ?? '')
    return { result: 'ok' }
  })
  // Claude Code offers the model every agent type no hook keeps from it.
  on('agent.offer', () => ({ isOffered: true }))
  on('turn.complete', () => ({ text: '' }))
  on('session.receive', (_$, e) => ({ text: e.text }))
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  // The agent types the plugin defines, by full name.
  const registered = new Map<string, AgentSpec>()
  on('agent.register', (_$, e) => {
    registered.set(`tranchant:${e.name}`, e)
    return { value: { agent: `tranchant:${e.name}` } }
  })
  const spawned: { prompt: string; name?: string; type: string; description?: string }[] =
    []
  // A spawn the plugin makes, answered here, carries no id: the list has it.
  on('agent.list', () => ({
    value: spawned.map((agent, index) => ({
      id: `a${index + 1}`,
      name: agent.name,
      type: agent.type,
      description: '',
      status: 'running' as const,
    })),
  }))
  // Held, a spawn answers only once released: an agent slow to start.
  let held: Promise<void> | undefined
  let release: () => void = ignore
  on('agent.spawn', async (_$, e) => {
    if (spawnRefused !== undefined) return { deny: spawnRefused }
    // Claude Code's own check of an agent's name.
    if (e.name !== undefined && !/^[A-Za-z0-9][\w-]{0,63}$/.test(e.name))
      return { deny: `InputValidationError: name ${e.name}` }
    await held
    const input: Record<string, unknown> = { ...e }
    const type = String(input.subagent_type ?? e.subagentType)
    spawned.push({ prompt: e.prompt, name: e.name, type, description: e.description })
    order.push(`spawn ${type}`)
    return { model: 'claude-sonnet-5-5', agentId: `a${spawned.length}` }
  })
  // The state a reload finds: `serving` as the module left it before.
  let seed = seeded
  on('state.get', (_$, e, next) =>
    seed && e.key === 'serving' ? { value: { value: seed, version: 1 } } : next(e),
  )
  on('state.set', (_$, e, next) => {
    if (e.key === 'serving') seed = undefined
    return next(e)
  })
  mock.env(on, { HOME: '/home/u' })
  const clock = mock.clock(on, { now: 1_000 })

  // The review's server: the lines the test prints, until it ends.
  const servers: string[][] = []
  const serverEnvs: (Record<string, string> | undefined)[] = []
  // A line on stdout, or `{ stderr }` one on stderr.
  const printing: (string | { stderr: string })[] = []
  let wake: () => void = ignore
  let exitCode: number | undefined
  on('process.spawn', async function* (_$, e) {
    servers.push([...e.argv])
    order.push('server')
    serverEnvs.push(e.env)
    for (;;) {
      const line = printing.shift()
      if (typeof line === 'object')
        yield { stream: 'stderr' as const, text: `${line.stderr}\n` }
      else if (line !== undefined) yield { stream: 'stdout' as const, text: `${line}\n` }
      else if (exitCode !== undefined) {
        // The next server runs until it is told to exit in turn.
        const code = exitCode
        exitCode = undefined
        return { value: { code, signal: null } }
      } else await new Promise<void>((resolve) => (wake = resolve))
    }
  })
  /** The server prints lines; what they start has started once it resolves. */
  const print = async (...lines: (string | { stderr: string })[]) => {
    printing.push(...lines)
    wake()
    await clock.settle()
  }

  return {
    registered,
    spawned,
    servers,
    serverEnvs,
    print,
    holdSpawns: () => {
      held = new Promise<void>((done) => (release = done))
    },
    releaseSpawns: async () => {
      held = undefined
      release()
      await clock.settle()
    },
    exit: async (code: number) => {
      exitCode = code
      wake()
      await clock.settle()
    },
    toasts,
    tools,
    logged,
    stopped,
    imported,
    browsed,
    ended: endings,
    notes,
    clock,
    order,
    prepared,
    completed,
  }
}

const ignore = () => undefined

const command = (args = ''): CommandRunInput => ({
  command: 'tranchant',
  args,
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 100 },
})
const fix = (id: string) => `FIX ${id}`
const turnEnded = (agentId: string, answer = '') => ({
  answer,
  durationMs: 1,
  isAborted: false,
  turnId: 'turn',
  agentId,
  reason: 'answer' as const,
})

/** `/tranchant <review.json>`, its server ready. */
async function open($: Engine, w: ReturnType<typeof world>) {
  const answer = $.command.run(command(FILE))
  await w.print(READY)
  return (await answer).text
}

test('registers the tool and the command at the session start', async ($, on) => {
  const w = world(on)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(w.tools).toEqual([{ name: 'open', isDeferred: false }])
})

test('registers the tool even when Claude Code refuses the name /tranchant', async ($, on) => {
  const w = world(on, { refused: 'tranchant' })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  expect(w.tools.map((tool) => tool.name)).toEqual(['open'])
})

test('opening a review file imports it, serves it and opens the page', async ($, on) => {
  const w = world(on)
  const ran = $.tool.call({
    tool: 'mcp__tranchant__open',
    review: FILE,
    tool_use_id: 'o1',
  })
  await w.print(READY)
  const { result } = await ran
  expect(w.imported).toEqual([FILE])
  expect(w.servers).toEqual([
    [
      'node',
      expect.stringMatching(/\/skills\/tranchant\/scripts\/server\.mjs$/),
      '--review',
      DIR,
    ],
  ])
  expect(w.serverEnvs).toEqual([{ TRANCHANT_HOOKS: '1' }])
  expect(w.browsed).toEqual(['open http://127.0.0.1:4599'])
  expect(result).toMatch(
    /^Tranchant serves Classification overview at http:\/\/127\.0\.0\.1:4599\./,
  )
  expect(w.toasts).toContain(
    'Tranchant serves Classification overview at http://127.0.0.1:4599',
  )

  // Opened again, by its folder: the same server, no second browser tab.
  const again = await $.tool.call({
    tool: 'mcp__tranchant__open',
    review: DIR,
    tool_use_id: 'o2',
  })
  expect(again.result).toMatch(/already serves Classification overview at http/)
  expect(w.servers).toHaveLength(1)
  expect(w.browsed).toHaveLength(1)
  await w.exit(0)
})

test('a relative review file is read from the session folder', async ($, on) => {
  const w = world(on)
  const answer = $.command.run(command('.tranchant/review.json'))
  await w.print(READY)
  expect((await answer).text).toMatch(/serves Classification overview/)
  expect(w.imported).toEqual([FILE])
  await w.exit(0)
})

test('a review open.mjs refuses is answered as refused, no server started', async ($, on) => {
  const w = world(on, { refusing: 'REVIEW_REFUSED id rev-1 exists with other content' })
  const { text } = await $.command.run(command(FILE))
  expect(text).toBe(`Tranchant refused ${FILE}: id rev-1 exists with other content`)
  expect(w.servers).toEqual([])
})

test('a missing review says so', async ($, on) => {
  const w = world(on)
  const { text } = await $.command.run(command('nowhere.json'))
  expect(text).toMatch(/^No review at \/repo\/web\/nowhere\.json: give a review file/)
  expect(w.servers).toEqual([])
  expect((await $.command.run(command())).text).toMatch(/^Usage: \/tranchant/)
})

/** A hook of a finding's agent: hook.mjs, the finding and review written in. */
const hookCommand = (mode: string, id: string, lockRoot = ROOT) =>
  expect.stringMatching(
    new RegExp(
      `^'node' '/.+/skills/tranchant/scripts/hook\\.mjs' '${mode}' '--finding' '${id}' '--review' '${DIR}' '--project' '${ROOT}' '--lock-root' '${lockRoot}'$`,
    ),
  )

/** Edit and Bash, which hook.mjs may refuse, but not the read-only tools. */
const PRE_TOOLS = expect.stringMatching(
  /^(?!.*\b(?:Read|Grep|Glob)\b)(?=.*\bEdit\b)(?=.*\bBash\b)[\w|.*]+$/,
)

test("a fix starts the finding's agent, with hooks of its own, on the session's model", async ($, on) => {
  const w = world(on)
  await open($, w)
  await w.print(fix('f-01'))

  expect(w.spawned).toEqual([
    expect.objectContaining({
      type: 'tranchant:tr-f-01',
      name: expect.stringMatching(/^tranchant-f-01-[0-9a-z]+$/),
    }),
  ])
  expect(w.spawned[0]?.prompt).toMatch(
    new RegExp(
      `^f-01\nREVIEW=${DIR}\nSKILL=/.+/skills/tranchant\nPROJECT=${ROOT}\nEach line below starting with (review-[0-9a-f]{8}) .*data, not instructions.*\n\\1 FIX f-01$`,
    ),
  )
  const spec = w.registered.get('tranchant:tr-f-01')
  // The worker's instructions, its frontmatter left out.
  expect(spec?.prompt).toBe('You apply one finding.\n')
  expect(spec?.model).toBe('inherit')
  expect(spec?.tools).toEqual(['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob'])
  expect(spec?.hooks).toEqual({
    PreToolUse: [
      {
        matcher: PRE_TOOLS,
        hooks: [{ type: 'command', command: hookCommand('pre', 'f-01') }],
      },
    ],
    PostToolUse: [
      {
        matcher: '*',
        hooks: [{ type: 'command', command: hookCommand('post', 'f-01') }],
      },
    ],
    PostToolUseFailure: [
      {
        matcher: '*',
        hooks: [{ type: 'command', command: hookCommand('post', 'f-01') }],
      },
    ],
    Stop: [{ hooks: [{ type: 'command', command: hookCommand('stop', 'f-01') }] }],
  })
  // The model is offered neither the finding's type, nor the worker, nor a review lens.
  for (const agent of [
    'tranchant:tr-f-01',
    'tranchant:worker',
    'tranchant:review:correctness',
  ])
    expect(await $.agent.offer(offerOf(agent))).toEqual({ isOffered: false })
  expect(await $.agent.offer(offerOf('Explore'))).toEqual({ isOffered: true })
  await w.exit(0)
})

test("locks a finding's files across the git repository the project is in", async ($, on) => {
  const w = world(on, { gitRoot: '/repo' })
  await open($, w)
  await w.print(fix('f-01'))
  expect(w.registered.get('tranchant:tr-f-01')?.hooks).toEqual(
    expect.objectContaining({
      PreToolUse: [
        {
          matcher: PRE_TOOLS,
          hooks: [{ type: 'command', command: hookCommand('pre', 'f-01', '/repo') }],
        },
      ],
    }),
  )
  await w.exit(0)
})

/** The marker a prompt's fence names. */
const marker = (prompt = '') => prompt.match(/starting with (review-[0-9a-f]{8}) /)?.[1]

test('each fix starts its agent at once, three at a time', async ($, on) => {
  const w = world(on)
  await open($, w)
  await w.print(fix('f-01'), fix('f-02'), fix('f-03'), fix('f-04'))

  expect(w.spawned.map((agent) => agent.type)).toEqual([
    'tranchant:tr-f-01',
    'tranchant:tr-f-02',
    'tranchant:tr-f-03',
  ])
  // Each prompt fences the server's line behind a marker of its own.
  expect(marker(w.spawned[1]?.prompt)).not.toBe(marker(w.spawned[0]?.prompt))

  // An agent ends: hook.mjs ended, its line for the person, and the finding in line starts.
  await $.turn.complete(
    turnEnded('a1', 'Returned early while tenantId is undefined.\nmore'),
  )
  await w.clock.settle()
  expect(w.ended).toEqual([
    [
      '--finding',
      'f-01',
      '--review',
      DIR,
      '--project',
      ROOT,
      '--lock-root',
      ROOT,
      '--agent',
      'a1',
    ],
  ])
  expect(w.toasts.at(-1)).toBe('f-01: Returned early while tenantId is undefined.')
  expect(w.spawned.map((agent) => agent.type)).toEqual([
    'tranchant:tr-f-01',
    'tranchant:tr-f-02',
    'tranchant:tr-f-03',
    'tranchant:tr-f-04',
  ])
  await w.exit(0)
})

test('the same line again, as a server restart prints it, starts no agent', async ($, on) => {
  const w = world(on)
  await open($, w)
  await w.print(fix('f-01'), fix('f-01'))
  expect(w.spawned).toHaveLength(1)
  await w.print(fix('f-01'))
  expect(w.spawned).toHaveLength(1)

  // Its agent ended: a fix asked again starts a new one.
  await $.turn.complete(turnEnded('a1', 'Done.'))
  await w.clock.settle()
  await w.print(fix('f-01'))
  expect(w.spawned.map((agent) => agent.type)).toEqual([
    'tranchant:tr-f-01',
    'tranchant:tr-f-01',
  ])
  await w.exit(0)
})

test("a stop ends the finding's agent and tells hook.mjs", async ($, on) => {
  const w = world(on)
  await open($, w)
  await w.print(fix('f-01'), fix('f-02'), fix('f-03'), fix('f-04'))
  await w.print('STOP f-04', 'STOP f-01')
  expect(w.stopped).toEqual(['a1'])
  expect(w.ended).toEqual([
    [
      '--finding',
      'f-01',
      '--review',
      DIR,
      '--project',
      ROOT,
      '--lock-root',
      ROOT,
      '--agent',
      'a1',
    ],
  ])
  // f-04 left the queue: nothing takes the place f-01 freed.
  expect(w.spawned).toHaveLength(3)
  // The stopped agent's own end changes nothing more.
  await $.turn.complete(turnEnded('a1', 'CANCELLED'))
  await w.clock.settle()
  expect(w.ended).toHaveLength(1)
  await w.exit(0)
})

test('a stop while the agent starts reaches it once started', async ($, on) => {
  const w = world(on)
  await open($, w)
  w.holdSpawns()
  await w.print(fix('f-01'))
  await w.print('STOP f-01')
  await w.releaseSpawns()
  expect(w.stopped).toEqual(['a1'])
  await w.exit(0)
})

test('a dropped or skipped finding leaves the queue', async ($, on) => {
  const w = world(on)
  await open($, w)
  await w.print(fix('f-01'), fix('f-02'), fix('f-03'), fix('f-04'), fix('f-05'))
  await w.print('DROPPED f-04', 'SKIPPED f-05')
  await $.turn.complete(turnEnded('a1', 'Done.'))
  await w.clock.settle()
  expect(w.spawned).toHaveLength(3)
  await w.exit(0)
})

test("the agent's own words become notes under the finding", async ($, on) => {
  const w = world(on)
  await open($, w)
  await w.print(fix('f-01'))
  await $.session.append({
    agentId: 'a1',
    door: 'response',
    origin: { kind: 'model', model: 'claude-sonnet-5-5' },
    uuid: 'row-1',
    message: {
      type: 'assistant',
      role: 'assistant',
      content: [
        { type: 'text', text: 'Reading the hook first.' },
        { type: 'thinking', thinking: 'hidden' },
      ],
    },
  })
  await w.clock.settle()
  expect(w.notes).toEqual([
    {
      argv: ['--finding', 'f-01', '--review', DIR, '--project', ROOT, '--agent', 'a1'],
      stdin: expect.stringMatching(
        /^\{"at":\d+,"kind":"note","label":"Reading the hook first\.","state":"done"\}$/,
      ),
    },
  ])
  await w.exit(0)
})

test('stop ends the server and every agent', async ($, on) => {
  const w = world(on)
  await open($, w)
  await w.print(fix('f-01'), fix('f-02'))
  const { result } = await $.tool.call({
    tool: 'mcp__tranchant__open',
    stop: true,
    tool_use_id: 's1',
  })
  expect(result).toBe(
    'Tranchant stopped serving Classification overview. Ended 2 agent(s) at work on fixes.',
  )
  expect(w.stopped).toEqual(['a1', 'a2'])
  expect(w.ended.map((one) => one[1])).toEqual(['f-01', 'f-02'])
  expect((await $.command.run(command('stop'))).text).toMatch(/not serving any review/)
  await w.exit(0)
  // A deliberate stop: no toast about a server that died.
  expect(w.toasts.some((toast) => toast.includes('stopped serving'))).toBe(false)
})

test('a server that cannot start says why', async ($, on) => {
  const w = world(on)
  const answer = $.command.run(command(FILE))
  await w.print('PORT_BUSY 4599 is used by another program')
  expect((await answer).text).toMatch(
    /cannot start: port 4599 is used by another program\. Another session may already serve/,
  )
  expect(w.browsed).toEqual([])
  await w.exit(3)
})

test('a server that stops after it started says so', async ($, on) => {
  const w = world(on)
  await open($, w)
  await w.exit(1)
  expect(w.toasts.at(-1)).toBe(
    `Tranchant stopped serving Classification overview: the server exited (code 1). /tranchant ${DIR} starts it again.`,
  )
  // Not served any more: the command starts a new server.
  const again = $.command.run(command(DIR))
  await w.clock.settle()
  expect(w.servers).toHaveLength(2)
  await w.print(READY)
  await again
  await w.exit(0)
})

test('a reload serves the reviews again, without opening the browser', async ($, on) => {
  const w = world(on, { seeded: { [DIR]: { review: DIR, project: ROOT } } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  const started = $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
  await w.clock.settle()
  expect(w.servers).toEqual([
    ['node', expect.stringMatching(/\/scripts\/server\.mjs$/), '--review', DIR],
  ])
  await w.print(READY)
  await started
  expect(w.toasts.at(-1)).toBe(
    'Tranchant serves Classification overview again at http://127.0.0.1:4599.',
  )
  expect(w.browsed).toEqual([])
  await w.exit(0)
})

test('/tranchant status tells the server, the agents at work and the queue in order', async ($, on) => {
  const w = world(on)
  expect((await $.command.run(command('status'))).text).toMatch(
    /^Tranchant is not serving any review in this session/,
  )
  await open($, w)
  await w.print(fix('f-01'), fix('f-02'), fix('f-03'), fix('f-04'), {
    stderr: 'warning: decisions.json rewritten',
  })
  const { text } = await $.command.run(command('status'))
  expect(text).toBe(
    [
      'Tranchant: 3 of 3 agents at work in this session.',
      '',
      `Classification overview (${DIR}): page at http://127.0.0.1:4599`,
      '  At work:',
      '    f-01: agent a1 on claude-sonnet-5-5, for 0 s',
      '    f-02: agent a2 on claude-sonnet-5-5, for 0 s',
      '    f-03: agent a3 on claude-sonnet-5-5, for 0 s',
      '  Waiting for a free agent, in order:',
      '    1. f-04',
      '  Last server error: warning: decisions.json rewritten',
    ].join('\n'),
  )
  // The skill asks the same through the tool.
  const { result } = await $.tool.call({
    tool: 'mcp__tranchant__open',
    status: true,
    tool_use_id: 's1',
  })
  expect(result).toBe(text)
  await w.exit(0)
})

/** `/tranchant review`, its server ready. */
async function review($: Engine, w: ReturnType<typeof world>, args = 'review') {
  const answer = $.command.run(command(args))
  await w.print(READY)
  return (await answer).text
}

test('review writes the envelope and opens the page first, then one reviewer per lens', async ($, on) => {
  const w = world(on)
  const text = await review($, w, 'review feature/cart-discounts --recipe my.json')
  expect(w.prepared).toEqual([
    { argv: ['feature/cart-discounts', '--recipe', 'my.json'], cwd: ROOT },
  ])
  // The envelope prepare.mjs wrote opens through the same path as a review file.
  expect(w.imported).toEqual([INBOX])
  expect(w.order).toEqual([
    'import',
    'server',
    'page',
    'spawn tranchant:rv-bugs-rev-1',
    'spawn tranchant:rv-style-rev-1',
  ])
  expect(text).toMatch(/^Reviewing with 2 lens\(es\): bugs, style\./)
  expect(text).toMatch(/Tranchant serves Classification overview at http/)
  expect(w.spawned[0]?.prompt.split('\n')).toEqual([
    'bugs',
    `REVIEW=${DIR}`,
    expect.stringMatching(/^SKILL=\/.+\/skills\/tranchant$/),
    `PROJECT=${ROOT}`,
    `HEAD=${HEAD}`,
    `RANGE=main...${HEAD}`,
    'OWNERSHIP=ours',
    'PATHS=**',
    '',
    "The lens's instructions:",
    '',
    'Look for bugs.',
  ])
  const spec = w.registered.get('tranchant:rv-bugs-rev-1')
  expect(spec?.prompt).toBe('You review one lens.\n')
  expect(spec?.tools).toEqual(['Read', 'Bash', 'Grep', 'Glob'])
  expect(spec?.hooks?.PreToolUse).toEqual([
    {
      matcher: 'Bash',
      hooks: [
        {
          type: 'command',
          command: expect.stringMatching(
            new RegExp(
              `^'node' '/.+/scripts/hook\\.mjs' 'pre' '--reviewer' 'rv-bugs' '--review' '${DIR}' '--project' '${ROOT}'$`,
            ),
          ),
        },
      ],
    },
  ])
  // Each one's start goes to its run file.
  expect(w.notes.map((one) => one.argv.slice(0, 2))).toEqual([
    ['--reviewer', 'rv-bugs'],
    ['--reviewer', 'rv-style'],
  ])
  expect(w.notes[0]?.stdin).toMatch(/"kind":"start","label":"Reviewing: bugs"/)
  // The model is offered none of the review agents.
  for (const agent of [
    'tranchant:rv-bugs-rev-1',
    'tranchant:vf-bugs-1-rev-1',
    'tranchant:reviewer',
    'tranchant:verifier',
  ])
    expect(await $.agent.offer(offerOf(agent))).toEqual({ isOffered: false })
  expect(w.completed).toEqual([])
  await w.exit(0)
})

test('a review prepare.mjs refuses is answered as refused, no server started', async ($, on) => {
  const w = world(on, { preparing: 'REVIEW_REFUSED main has no change against main\n' })
  const { text } = await $.command.run(command('review main'))
  expect(text).toBe('Tranchant cannot review: main has no change against main')
  expect(w.servers).toEqual([])
  expect(w.spawned).toEqual([])
  expect((await $.command.run(command('review a b'))).text).toMatch(
    /^Usage: \/tranchant review/,
  )
})

test('a review whose server could not start starts no reviewer', async ($, on) => {
  // The server's watch is gone by the time the review reads its first line.
  const w = world(on, { unreadable: '{"version":1,"project":"relative"}' })
  const { text } = await $.command.run(command('review'))
  expect(text).toMatch(/its project is not an absolute path/)
  await w.clock.settle()
  expect(w.spawned).toEqual([])
})

test('each finding that lands gets its verifier, once, three agents at a time', async ($, on) => {
  const w = world(on)
  await review($, w)
  await w.print('LANDED bugs-1', 'LANDED bugs-1', 'LANDED bugs-2')
  // Two reviewers and one verifier run; the second verifier waits.
  expect(w.spawned.map((one) => one.type)).toEqual([
    'tranchant:rv-bugs-rev-1',
    'tranchant:rv-style-rev-1',
    'tranchant:vf-bugs-1-rev-1',
  ])
  expect(w.spawned[2]?.prompt).toMatch(
    new RegExp(`^bugs-1\nREVIEW=${DIR}\nSKILL=.+\nPROJECT=${ROOT}\nHEAD=${HEAD}\n`),
  )
  expect(w.registered.get('tranchant:vf-bugs-1-rev-1')?.prompt).toBe(
    'You verify one finding.\n',
  )
  await $.turn.complete(turnEnded('a1', 'Added 2 findings.'))
  await w.clock.settle()
  expect(w.spawned.map((one) => one.type).at(-1)).toBe('tranchant:vf-bugs-2-rev-1')
  expect(w.spawned).toHaveLength(4)
  expect(w.toasts).toContain('rv-bugs: Added 2 findings.')
  // Its end goes to its run file.
  expect(
    w.notes.find((one) => one.argv[1] === 'rv-bugs' && /"kind":"end"/.test(one.stdin)),
  ).toBeDefined()
  await w.exit(0)
})

test('once every reviewer and verifier ended, complete.mjs runs; a finding with no verifier gets one first', async ($, on) => {
  const w = world(on, { pending: [['bugs-1', 'bugs-2'], []] })
  await review($, w)
  await w.print('LANDED bugs-1')
  for (const agent of ['a1', 'a2']) await $.turn.complete(turnEnded(agent, 'Done.'))
  await w.clock.settle()
  expect(w.completed).toEqual([])
  await $.turn.complete(turnEnded('a3', 'Confirmed.'))
  await w.clock.settle()
  // bugs-2 landed with no LANDED line yet: its verifier, before completing.
  expect(w.spawned.map((one) => one.type).at(-1)).toBe('tranchant:vf-bugs-2-rev-1')
  expect(w.completed).toEqual([])
  await $.turn.complete(turnEnded('a4', 'Removed: a duplicate.'))
  await w.clock.settle()
  expect(w.completed).toEqual([['--review', DIR]])
  expect(w.toasts.at(-1)).toBe('Tranchant finished reviewing Classification overview.')
  // A finding that lands now starts nothing: the review is complete.
  await w.print('LANDED bugs-3')
  expect(w.spawned).toHaveLength(4)
  await w.exit(0)
})

test('/tranchant status lists the reviewers; stop ends them and completes the review', async ($, on) => {
  const w = world(on)
  await review($, w)
  await w.print('LANDED bugs-1', 'LANDED bugs-2')
  const { text } = await $.command.run(command('status'))
  expect(text).toBe(
    [
      'Tranchant: 0 of 3 agents at work in this session.',
      '',
      `Classification overview (${DIR}): page at http://127.0.0.1:4599`,
      '  Reviewing: 3 of 3 review agents at work.',
      '    rv-bugs: agent a1 on claude-sonnet-5-5, for 0 s',
      '    rv-style: agent a2 on claude-sonnet-5-5, for 0 s',
      '    vf-bugs-1: agent a3 on claude-sonnet-5-5, for 0 s',
      '  Review agents waiting, in order:',
      '    1. vf-bugs-2',
      '  No agent at work.',
      '  No finding waiting.',
    ].join('\n'),
  )
  const stopped = await $.command.run(command('stop'))
  expect(stopped.text).toBe(
    'Tranchant stopped serving Classification overview. Ended 3 agent(s) reviewing.',
  )
  expect(w.stopped).toEqual(['a1', 'a2', 'a3'])
  expect(w.completed).toEqual([['--review', DIR]])
  // The queue emptied: nothing starts in the freed places.
  expect(w.spawned).toHaveLength(3)
  await w.exit(0)
})

test("a reviewer's own words become notes in its run file", async ($, on) => {
  const w = world(on)
  await review($, w)
  await $.session.append({
    agentId: 'a1',
    door: 'response',
    origin: { kind: 'model', model: 'claude-sonnet-5-5' },
    uuid: 'row-2',
    message: {
      type: 'assistant',
      role: 'assistant',
      content: [{ type: 'text', text: 'Reading the cart first.' }],
    },
  })
  await w.clock.settle()
  expect(w.notes.at(-1)).toEqual({
    argv: ['--reviewer', 'rv-bugs', '--review', DIR, '--project', ROOT, '--agent', 'a1'],
    stdin: expect.stringMatching(/"kind":"note","label":"Reading the cart first\."/),
  })
  await w.exit(0)
})

/** An agent's message to the conversation: its final report with `final`. */
function peer($: Engine, from: string, body: string, final = true) {
  const text = final
    ? `<agent-message from="${from}">\n[Subagent hand-back] The text below is the final report of a subagent. The report follows:\n  ${body}\n</agent-message>`
    : `<agent-message from="${from}">\n${body}\n</agent-message>`
  return $.session.receive({ origin: { kind: 'peer' }, text })
}

test("the hooks' agents' final reports are kept from the conversation, nothing else", async ($, on) => {
  const w = world(on)
  await review($, w)
  const name = w.spawned[0]?.name ?? ''
  await $.turn.complete(turnEnded('a1', 'Added 2 findings.'))
  expect(await peer($, name, 'Added 2 findings.')).toEqual({
    consumed: expect.stringContaining(name),
  })
  // What it says mid-run, and another session's, reach the conversation.
  expect(await peer($, name, 'Every Bash call is refused.', false)).toEqual({
    text: expect.stringContaining('Every Bash call is refused.'),
  })
  expect(await peer($, 'someone-else', 'Done.')).toEqual({
    text: expect.stringContaining('someone-else'),
  })
  // A teammate's delivery names its sender in its origin.
  expect(
    await $.session.receive({
      origin: { kind: 'peer', teammate: name, isVerified: true },
      text: '[Subagent hand-back] The report follows:\n  Done.',
    }),
  ).toEqual({ consumed: expect.stringContaining(name) })
  await w.exit(0)
})

test("an agent of this session's report, entering as a prompt, is dropped; the person's is not", async ($, on) => {
  const w = world(on)
  await review($, w)
  const name = w.spawned[0]?.name ?? ''
  const prompt = (text: string, kind: 'peer' | 'composer') =>
    $.prompt.submit({ text, origin: { kind }, wait: false, isMeta: true })
  const report = `Another Claude session sent a message:\n<agent-message from="${name}">\n[Subagent hand-back] The report follows:\n  Added 1 finding.\n</agent-message>`
  expect(await prompt(report, 'peer')).toEqual({ drop: expect.stringContaining(name) })
  expect(w.toasts).toContain('rv-bugs: Added 1 finding.')
  expect(await prompt(report, 'composer')).toEqual({ text: report })
  await w.exit(0)
})

test('a final report with no turn.complete ends its agent: the toast, its place freed', async ($, on) => {
  const w = world(on, { preparing: [`INBOX ${INBOX}`, lens('bugs'), ''].join('\n') })
  await review($, w)
  await peer($, w.spawned[0]?.name ?? '', 'No finding.')
  await w.clock.settle()
  expect(w.toasts).toContain('rv-bugs: No finding.')
  expect(w.completed).toEqual([['--review', DIR]])
  await w.exit(0)
})

test("a fix's agent's final report is kept from the conversation too", async ($, on) => {
  const w = world(on)
  await open($, w)
  await w.print(fix('f-01'))
  await w.clock.settle()
  expect(await peer($, w.spawned[0]?.name ?? '', 'Fixed.')).toEqual({
    consumed: expect.any(String),
  })
  expect(w.toasts).toContain('f-01: Fixed.')
  await w.exit(0)
})

test('verifiers of long ids sharing their start get names of their own, which Claude Code takes', async ($, on) => {
  const w = world(on, { preparing: [`INBOX ${INBOX}`, lens('bugs'), ''].join('\n') })
  await review($, w)
  const long = `bugs-${'x'.repeat(57)}`
  await w.print(`LANDED ${long}-1`, `LANDED ${long}-2`)
  await w.clock.settle()
  const names = w.spawned.map((one) => one.name)
  expect(names).toHaveLength(3)
  expect(new Set(names).size).toBe(3)
  await w.exit(0)
})

test('a review agent that cannot start frees its place, and the review still completes', async ($, on) => {
  const w = world(on, {
    preparing: [`INBOX ${INBOX}`, lens('bugs'), ''].join('\n'),
    spawnRefused: 'agents are turned off',
  })
  await review($, w)
  await w.clock.settle()
  expect(w.toasts).toContain(
    'Tranchant could not start the reviewer rv-bugs: agents are turned off',
  )
  expect(w.completed).toEqual([['--review', DIR]])
  await w.exit(0)
})

test('a complete.mjs that fails is said, with the command that does it', async ($, on) => {
  const w = world(on, {
    preparing: [`INBOX ${INBOX}`, lens('bugs'), ''].join('\n'),
    completeSays: 'COMPLETE_REFUSED the review is complete already',
  })
  await review($, w)
  await $.turn.complete(turnEnded('a1', 'No finding.'))
  await w.clock.settle()
  expect(w.toasts.at(-1)).toMatch(
    /^Tranchant could not mark Classification overview complete: COMPLETE_REFUSED the review is complete already\. node .+\/complete\.mjs --review /,
  )
  await w.exit(0)
})
