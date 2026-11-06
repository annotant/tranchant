#!/usr/bin/env node
// hook.mjs <pre|post|stop|note|ended> --finding <id> --review <dir> --project <root> [--lock-root <dir>] [--agent <id>]
// hook.mjs <pre|post|note> --reviewer <name> --review <dir> --project <root> [--agent <id>]
// The hooks of one finding's agent: Claude Code runs them around each of its
// tools with the event as JSON on stdin. Claude Code runs no plugin mod hook
// for an agent a plugin starts, so the plugin's hooks module registers each
// finding's agent with these, the finding, the review and the project
// written in.
//
// pre: refuses AskUserQuestion and Bash commands that write files, locks the
//      file an edit writes (another finding's agent may hold it), and records
//      the step for the page.
// post: records the step done or failed; after done.mjs or ask.mjs, ends the
//      run: the agent's locks are released.
// stop: the agent stopped; it holds nothing.
// note: the hooks module's steps (what the agent says), as JSON lines on stdin.
// ended: the hooks module, once the agent's turn ended: a finding it left
//      working, neither done nor asked about, fails, so the reviewer can
//      send it again. Prints `AGENT_ENDED <id>` when it did.
//
// `--reviewer`: a review agent's (a lens's reviewer, `rv-<lens>`, a
// finding's verifier, `vf-<id>`, or the agent discussing a finding with the
// reviewer, `ds-<id>`): it has no writing tool and takes no lock;
// its steps go to reviewers/<name>.jsonl. pre allows only reading commands
// and its own review script in Bash (reviewerRefusal).
//
// `--lock-root`: the git repository the project is in, which the hooks module
// found; the locks are tabled per repository. A hook never fails the agent:
// on any error, it lets the tool run.
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { withFileLock } from './lib/filelock.mjs'
import { currentRun, parseDecisions } from './lib/format.mjs'
import { STATE_ROOT, lockRoot as repositoryOf, locksDir } from './lib/project.mjs'
import { createStore, historyPath, progressPath, reviewAgentPath } from './lib/store.mjs'

/** @typedef {import('./lib/format.mjs').Entry} Entry */
/** @typedef {import('./lib/format.mjs').Step} Step */
/**
 * `review`: the folder of the owner's review. One table serves the whole
 * repository, which may hold several reviews.
 * @typedef {{ owner: string, review?: string, at: number }} Lock
 */
/**
 * What Claude Code sends a PreToolUse, PostToolUse or PostToolUseFailure hook.
 * @typedef {object} HookInput
 * @property {string} [hook_event_name]
 * @property {string} [tool_name]
 * @property {Record<string, unknown>} [tool_input]
 * @property {string} [tool_use_id]
 * @property {string} [error]
 * @property {string} [agent_id]
 */

// A hook's time is bounded: past this, the edit is refused and retried.
const LOCK_WAIT_MS = Number(process.env.TRANCHANT_LOCK_WAIT_MS) || 6_000
const LOCK_POLL_MS = 200
const STALE_MS = 20 * 60 * 1000

const BUILD = /\b(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?build\b|\b(?:next|vite)\s+build\b/
const WORD = String.raw`[^\s;&|()<>]+`
// The agent's scripts, called by any path.
const CLAIM = new RegExp(String.raw`\bclaim\.mjs\s+(${WORD})`)
const ENDS = new RegExp(String.raw`\b(?:done|ask)\.mjs\s+(${WORD})`)
// What a review agent may run: it reads untrusted code, so its Bash is an
// allowlist of reading commands and its own review scripts, not a denylist.
const READERS = new Set([
  'git',
  'cat',
  'head',
  'tail',
  'wc',
  'ls',
  'grep',
  'nl',
  'sort',
  'uniq',
  'cut',
  'jq',
  'echo',
  'pwd',
  'diff',
])
const GIT_READS = new Set([
  'diff',
  'show',
  'log',
  'rev-parse',
  'ls-files',
  'ls-tree',
  'blame',
  'cat-file',
  'grep',
  'status',
  'merge-base',
  'rev-list',
])
// git options that write a file or run a program.
const GIT_RISKY = /^(?:--output|--ext-diff|-O|--open-files-in-pager)/
const REVIEW_SCRIPT = /\/scripts\/(add|verify|remove|reply)\.mjs$/
/** The scripts each kind of review agent runs, by the prefix of its name. */
const SCRIPTS_OF = /** @type {Record<string, string[]>} */ ({
  rv: ['add'],
  vf: ['verify', 'remove'],
  ds: ['reply'],
})
// A Bash command that writes files takes no lock: refused, the agent must use
// Edit or Write. Best effort, on the usual forms. What an inline script writes
// cannot be told: always refused.
const SCRIPT_WRITES = [
  /\bopen\([^)]*,\s*['"][wax]b?\+?['"]/,
  /\.write_(?:text|bytes)\(/,
  /\b(?:writeFile|appendFile)(?:Sync)?\s*\(/,
]
// An in-place editor, cat or tee names its files: refused only when one may be
// in the repository (a relative path, after some `cd`, may be).
const IN_PLACE = /\b(?:sed|perl)\s+(?:-\S+\s+)*-[\w-]*i/
const CAT_INTO = /\bcat\s*>>?\s*(\S+)/
const TEE = /\btee\b((?:\s+[^\s|;&<>]+)*)/
const MAX_LABEL = 80

/** @param {string} name */
function flag(name) {
  const at = process.argv.indexOf(name)
  return at === -1 ? undefined : process.argv[at + 1]
}

const short = (text = '', max = MAX_LABEL) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text
const unquote = (/** @type {string} */ value) => value.replace(/^["']|["']$/g, '')
/** `file` under `root`, relative; undefined outside it. */
function within(root, file) {
  const relative = path.relative(root, file)
  return relative.startsWith('..') || path.isAbsolute(relative) ? undefined : relative
}

/**
 * A tool's string argument.
 * @param {Record<string, unknown>} input
 * @param {string} key
 */
function textOf(input, key) {
  const value = input[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * The file a tool writes, `@build` for a build, or undefined.
 * @param {string} tool
 * @param {Record<string, unknown>} input
 */
function writeTarget(tool, input) {
  if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit')
    return textOf(input, 'file_path')
  if (tool === 'NotebookEdit') return textOf(input, 'notebook_path')
  if (tool === 'Bash' && BUILD.test(textOf(input, 'command') ?? '')) return '@build'
  return undefined
}

/** The hook log the hooks module writes too: on while its marker exists. */
async function debug(agent, finding, message) {
  try {
    await readFile(path.join(STATE_ROOT, 'debug'))
  } catch {
    return
  }
  const line = `${new Date().toISOString()} ${agent} ${finding} ${message}\n`
  await appendFile(path.join(STATE_ROOT, 'hook.log'), line).catch(() => undefined)
}

/** Waiting for its agent, or worked on by one. */
const mayWorkOn = (/** @type {Entry | undefined} */ entry) =>
  entry?.state === 'queued' || entry?.state === 'working'

const REFUSED_SHELL = 'a redirection, a substitution or an unquoted heredoc'
// The two redirections a reading command may keep: they write no file.
const KEPT_REDIRECTION = /^(?:&\d|\s*\/dev\/null)(?=[\s;&|]|$)/

/**
 * A command's words, by segment, split on `;`, `|`, `&` and newlines outside
 * quotes; or why it is refused: a redirection but `2>&1` and `>/dev/null`, a
 * substitution outside single quotes, an unquoted heredoc. A quoted heredoc's
 * body is data, skipped: the finding a review script reads.
 * @param {string} text
 * @returns {{ segments: string[][] } | { refusal: string }}
 */
function shellWords(text) {
  /** @type {string[][]} */
  const segments = [[]]
  let word = ''
  // `""` is a word: whether one is under way.
  let started = false
  let quote = ''
  /** @type {string[]} */
  const heredocs = []
  const end = () => {
    if (started) segments.at(-1)?.push(word)
    word = ''
    started = false
  }
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? ''
    if (quote === "'") {
      if (c === "'") quote = ''
      else word += c
      continue
    }
    if (c === '\\' && i + 1 < text.length) {
      const escaped = text[++i] ?? ''
      if (escaped === '\n') continue
      // Within double quotes, a backslash escapes these alone.
      word += quote === '"' && !/[$`"\\\n]/.test(escaped) ? `\\${escaped}` : escaped
      started = true
      continue
    }
    if (c === '`' || (c === '$' && text[i + 1] === '(')) return { refusal: REFUSED_SHELL }
    if (quote === '"') {
      if (c === '"') quote = ''
      else word += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      started = true
      continue
    }
    if (c === '<' && text[i + 1] === '<') {
      const marker = /^<<-?[ \t]*(['"])([\w-]+)\1/.exec(text.slice(i))
      if (!marker) return { refusal: REFUSED_SHELL }
      heredocs.push(marker[2] ?? '')
      end()
      i += marker[0].length - 1
      continue
    }
    if (c === '<' || c === '>') {
      const kept = c === '>' && (!started || /^\d$/.test(word))
      const rest = kept ? KEPT_REDIRECTION.exec(text.slice(i + 1)) : null
      if (!rest) return { refusal: REFUSED_SHELL }
      word = ''
      started = false
      i += rest[0].length
      continue
    }
    if (/[;|&\n]/.test(c)) {
      end()
      segments.push([])
      // The bodies start on the next line: each ends on its delimiter alone.
      if (c === '\n')
        for (const delimiter of heredocs.splice(0)) {
          const line = new RegExp(String.raw`^[ \t]*${delimiter}[ \t]*$`, 'm')
          const found = line.exec(text.slice(i + 1))
          if (!found) return { refusal: 'a heredoc with no end' }
          i += found.index + found[0].length
        }
      continue
    }
    if (/\s/.test(c)) end()
    else {
      word += c
      started = true
    }
  }
  if (quote) return { refusal: 'an unclosed quote' }
  if (heredocs.length) return { refusal: 'a heredoc with no end' }
  end()
  return { segments }
}

/**
 * Why a reading command's arguments would write or run something, or
 * undefined: sort's output file or compressor (GNU takes any prefix of a
 * long option), uniq's output operand, git's.
 * @param {string} program
 * @param {string[]} args
 */
function argumentRefusal(program, args) {
  if (program === 'sort' && args.some((arg) => /^--(?:o|co)|^-[^-]*o/.test(arg)))
    return 'sort writes a file or runs a program with that option'
  if (program === 'uniq') {
    // Its counts follow -f, -s and -w; any other operand is a file, the second written.
    const operands = args.filter(
      (arg, i) => !arg.startsWith('-') && !/^-[fsw]$/.test(args[i - 1] ?? ''),
    )
    if (operands.length > 1) return 'uniq writes its second file'
  }
  if (program !== 'git') return undefined
  const sub = args[0] === '-C' ? args[2] : args[0]
  if (!sub || !GIT_READS.has(sub)) return `git ${sub ?? ''} is not a reading command`
  if (args.some((arg) => GIT_RISKY.test(arg)))
    return 'a git option that writes or runs a program'
  return undefined
}

/**
 * Why review agent `name` may not run `command`, or undefined when it may: a
 * chain of reading commands, and the agent's own script (a reviewer's
 * add.mjs; a verifier's verify.mjs or remove.mjs, a discussing agent's
 * reply.mjs, on its own finding).
 * @param {string} name `rv-<lens>`, `vf-<finding id>` or `ds-<finding id>`.
 * @param {string} command
 */
function reviewerRefusal(name, command) {
  const parsed = shellWords(command)
  if ('refusal' in parsed) return parsed.refusal
  const kind = name.slice(0, 2)
  const own = SCRIPTS_OF[kind] ?? []
  for (const [program, ...args] of parsed.segments) {
    if (!program) continue
    if (program === 'node') {
      const script = REVIEW_SCRIPT.exec(args[0] ?? '')?.[1]
      if (!script) return 'node runs only the review scripts'
      if (!own.includes(script))
        return kind === 'rv'
          ? `a reviewer adds findings, ${script}.mjs is not its script`
          : kind === 'vf'
            ? script === 'add'
              ? 'a verifier checks a finding, it adds none'
              : `a verifier gives its verdict, ${script}.mjs is not its script`
            : `a discussing agent answers with reply.mjs, ${script}.mjs is not its script`
      if (kind !== 'rv' && args[1] !== name.slice(3))
        return `${kind === 'vf' ? 'a verifier gives its verdict' : 'it answers'} on ${name.slice(3)} only`
      continue
    }
    if (!READERS.has(program)) return `${program} is not a reading command`
    const refused = argumentRefusal(program, args)
    if (refused) return refused
  }
  return undefined
}

/**
 * The hooks of one finding's agent, or with `reviewer`, of a review agent:
 * `finding` is then its name.
 * @param {{ finding: string, review: string, root: string, lockRoot: string, agent: string, reviewer?: boolean }} options
 */
function hooksFor({ finding, review, root, lockRoot, agent, reviewer = false }) {
  const log = (/** @type {string} */ message) => debug(agent, finding, message)
  const scripts = path.dirname(new URL(import.meta.url).pathname)
  const table = path.join(locksDir(lockRoot), 'table.json')

  /**
   * The decisions of a review; undefined when they cannot be read.
   * @param {string} [where] Another review's folder.
   * @returns {Promise<Record<string, Entry> | undefined>}
   */
  async function decisionsOf(where = review) {
    try {
      return parseDecisions(await readFile(path.join(where, 'decisions.json'), 'utf8'))
        .findings
    } catch {
      return undefined
    }
  }
  /** The finding's entry, null when it has none yet, undefined when unreadable. */
  async function readEntry() {
    const all = await decisionsOf()
    return all && (all[finding] ?? null)
  }

  /**
   * Whether finding `owner` of the review at `where` may still be at work:
   * when its decisions cannot be read, it may.
   * @param {string} owner
   * @param {string} [where]
   */
  async function mayWork(owner, where = review) {
    const all = await decisionsOf(where)
    return all === undefined || mayWorkOn(all[owner])
  }

  /**
   * Changes the lock table, one process at a time.
   * @template T
   * @param {(locks: Record<string, Lock>) => T | Promise<T>} change
   */
  async function withLocks(change) {
    await mkdir(path.dirname(table), { recursive: true })
    return withFileLock(table, async () => {
      /** @type {Record<string, Lock>} */
      let locks = {}
      try {
        locks = JSON.parse(await readFile(table, 'utf8'))
      } catch {}
      const before = JSON.stringify(locks)
      const result = await change(locks)
      if (JSON.stringify(locks) !== before) await writeFile(table, JSON.stringify(locks))
      return result
    })
  }

  /**
   * Whether this finding holds `lock`: finding ids repeat across reviews
   * (`f-01` in each), so the review tells them apart.
   * @param {Lock | undefined} lock
   */
  const mine = (lock) =>
    lock !== undefined && lock.owner === finding && (lock.review ?? review) === review

  /** The finding holding `target`, or undefined once this one holds it. */
  async function tryLock(target) {
    return withLocks(async (locks) => {
      const held = locks[target]
      if (held && !mine(held)) {
        const stale =
          Date.now() - held.at > STALE_MS || !(await mayWork(held.owner, held.review))
        if (!stale) return held.owner
      }
      locks[target] = { owner: finding, review, at: Date.now() }
      return undefined
    })
  }

  async function releaseAll() {
    return withLocks((locks) => {
      const released = Object.keys(locks).filter((key) => mine(locks[key]))
      for (const key of released) delete locks[key]
      return released
    })
  }

  /** @param {string} target */
  function unlock(target) {
    return withLocks((locks) => {
      if (mine(locks[target])) delete locks[target]
    })
  }

  /**
   * Into the run in progress only: before the claim, and once the reviewer
   * stopped the finding, there is none.
   * @param {Step[]} steps
   */
  async function record(steps) {
    if (reviewer) {
      if (!steps.length) return
      const file = reviewAgentPath(review, finding)
      await mkdir(path.dirname(file), { recursive: true })
      await appendFile(
        file,
        steps.map((step) => `${JSON.stringify({ ...step, agent })}\n`).join(''),
      )
      return
    }
    const entry = await readEntry()
    const run = entry ? currentRun(entry)?.id : undefined
    if (!run || !steps.length) return
    await mkdir(path.dirname(progressPath(review, finding)), { recursive: true })
    await appendFile(
      progressPath(review, finding),
      steps.map((step) => `${JSON.stringify({ ...step, run, agent })}\n`).join(''),
    )
    for (const step of steps) {
      const state = step.state ? ` ${step.state}` : ''
      await log(`recorded ${step.kind}${state} "${step.label}"`)
    }
  }

  /** A path as the reviewer sees it: from the project, else its name. */
  function shown(file = '') {
    const full = path.resolve(root, file)
    return within(lockRoot, full) === undefined
      ? path.basename(file)
      : path.relative(root, full)
  }

  /**
   * A write's label, and its path from the project: a label outside the
   * repository is only a name, which would read as a file of the project.
   * @param {string} file
   */
  function written(file) {
    return { label: shown(file), file: path.relative(root, path.resolve(root, file)) }
  }

  /**
   * @param {string} tool
   * @param {Record<string, unknown>} input
   * @returns {{ kind: string, label: string, file?: string }}
   */
  function describe(tool, input) {
    const text = (/** @type {string} */ key) => textOf(input, key) ?? ''
    if (tool.startsWith('mcp__')) {
      const [, server, name] = tool.split('__')
      return { kind: 'tool', label: `${server} · ${name}` }
    }
    switch (tool) {
      case 'Read':
        return { kind: 'read', label: shown(text('file_path')) }
      case 'Edit':
      case 'Write':
        return { kind: tool.toLowerCase(), ...written(text('file_path')) }
      case 'MultiEdit':
        return { kind: 'edit', ...written(text('file_path')) }
      case 'NotebookEdit':
        return { kind: 'edit', ...written(text('notebook_path')) }
      case 'Bash':
        return CLAIM.test(text('command'))
          ? { kind: 'start', label: 'Started' }
          : { kind: 'bash', label: short(text('description') || text('command')) }
      case 'Grep':
      case 'Glob':
        return { kind: 'search', label: short(text('pattern')) }
      case 'WebSearch':
        return { kind: 'tool', label: short(text('query')) }
      case 'Skill':
        return { kind: 'tool', label: text('skill') }
      default:
        return { kind: 'tool', label: tool }
    }
  }

  /** The agent's own scripts pass: a summary or a question may quote anything. */
  function writesFromBash(command) {
    if (CLAIM.test(command) || ENDS.test(command)) return false
    if (SCRIPT_WRITES.some((pattern) => pattern.test(command))) return true
    const targets = []
    for (const segment of command.split(/&&|\|\||[;|\n]/)) {
      const words = segment.trim().split(/\s+/)
      if (IN_PLACE.test(segment)) targets.push(words.at(-1) ?? '')
      const into = CAT_INTO.exec(segment)?.[1]
      if (into) targets.push(into)
      const teed = TEE.exec(segment)?.[1]
      if (teed)
        targets.push(
          ...teed
            .trim()
            .split(/\s+/)
            .filter((word) => !word.startsWith('-')),
        )
    }
    return targets.some((target) => {
      const file = unquote(target)
      return (
        !path.isAbsolute(file) || within(lockRoot, path.normalize(file)) !== undefined
      )
    })
  }

  /** The deny message, or undefined once the agent holds the lock. */
  async function lockTarget(target, step) {
    const entry = await readEntry()
    if (entry !== undefined && !mayWorkOn(entry ?? undefined)) {
      await log(`refused ${target}: the reviewer stopped, dropped or settled the finding`)
      return `Finding ${finding} was stopped, dropped or settled by the reviewer. Stop now: make no further changes and reply "CANCELLED".`
    }
    const key =
      target === '@build' ? target : within(lockRoot, path.resolve(root, target))
    if (key === undefined) {
      await log(`no lock for ${target}: outside ${lockRoot}`)
      return undefined
    }
    const deadline = Date.now() + LOCK_WAIT_MS
    let waited = false
    for (;;) {
      const holder = await tryLock(key)
      if (holder === undefined) {
        await log(`locked ${key}`)
        return undefined
      }
      if (!waited) await log(`waiting for ${key}, held by finding ${holder}`)
      waited = true
      if (Date.now() >= deadline) {
        const released = await releaseAll()
        await log(
          `refused ${key}: still held by finding ${holder}; released ${released.length} lock(s)`,
        )
        await record([
          {
            ...step,
            state: 'failed',
            detail: `${key} is being changed by another finding's agent`,
          },
        ])
        return (
          `${key} is being changed by the agent of finding ${holder}. ` +
          `Your ${released.length} lock(s) were released to avoid a deadlock: ` +
          're-read the files you are changing, then retry this step.'
        )
      }
      await new Promise((done) => setTimeout(done, LOCK_POLL_MS))
    }
  }

  /**
   * AskUserQuestion would reach the session's terminal, never the reviewer,
   * who is on the page: the agent asks under the finding instead.
   */
  const askOnPage = () =>
    'The reviewer answers on the page, where AskUserQuestion never shows. Ask under ' +
    `the finding instead: node ${JSON.stringify(path.join(scripts, 'ask.mjs'))} ` +
    `${finding} --review ${JSON.stringify(review)} ` +
    '"<question>" --option "<label>: <description>" --option "…" (2 to 6 options; ' +
    'add --multiple to let the reviewer pick several), then reply "QUESTION: <your question>".'

  return {
    /**
     * @param {HookInput} event
     * @returns {Promise<string | undefined>} why the tool is refused
     */
    async pre({ tool_name: tool = '', tool_input: input = {}, tool_use_id: id }) {
      if (tool === 'AskUserQuestion') {
        await log('refused AskUserQuestion: ask on the page')
        return askOnPage()
      }
      /** @type {Step} */
      const step = { at: Date.now(), ...(id && { id }), ...describe(tool, input) }
      const command = (tool === 'Bash' && textOf(input, 'command')) || ''
      const refused = reviewer && command ? reviewerRefusal(finding, command) : undefined
      if (refused) {
        await log(`refused a review agent's command: ${short(command, 120)}`)
        await record([{ ...step, state: 'failed', detail: refused }])
        return (
          `Refused: ${refused}. A review agent runs reading commands only (git ` +
          `${[...GIT_READS].join('/')}, ${[...READERS].filter((one) => one !== 'git').join(', ')}), ` +
          'one at a time or chained, without redirections or substitutions, and its own review script ' +
          'with the finding in a quoted heredoc. Use the Read, Grep and Glob tools for the rest.'
        )
      }
      if (!reviewer && command && writesFromBash(command)) {
        await log(`refused a Bash write: ${short(command, 120)}`)
        await record([
          {
            ...step,
            state: 'failed',
            detail: 'writes files from Bash; use Edit or Write',
          },
        ])
        return (
          'This command writes files from Bash, where Tranchant cannot lock them against ' +
          "the other findings' agents. Make the change with the Edit or Write tool instead."
        )
      }
      const target = reviewer ? undefined : writeTarget(tool, input)
      if (target) {
        const deny = await lockTarget(target, step)
        if (deny) return deny
      }
      await record([{ ...step, state: 'running' }])
      return undefined
    },

    /** @param {HookInput} event */
    async post({ tool_name: tool = '', tool_input: input = {}, tool_use_id: id, error }) {
      const failed = error !== undefined
      const command = (tool === 'Bash' && textOf(input, 'command')) || ''
      /** @type {Step} */
      const step = {
        at: Date.now(),
        ...(id && { id }),
        ...describe(tool, input),
        state: failed ? 'failed' : 'done',
        ...(failed && { detail: short(error.trim().split('\n')[0] ?? '', 160) }),
      }
      if (reviewer) {
        await record([step])
        return
      }
      const entry = await readEntry()
      if (CLAIM.test(command) && entry) {
        // The Started step says which model the agent runs on: claim.mjs
        // recorded it on the run.
        const model = currentRun(entry)?.model
        if (model) step.model = model
      }
      const ended = ENDS.exec(command)?.[1]
      if (ended && unquote(ended) === finding && !(entry && mayWorkOn(entry))) {
        await endRun(step)
        return
      }
      if (BUILD.test(command)) {
        await unlock('@build')
        await log('build ended: released the build lock')
      }
      await record([step])
    },

    async stop() {
      const released = await releaseAll()
      await log(`agent stopped: released ${released.length} lock(s)`)
    },

    /** Whether the finding, left working by the agent, failed. */
    async ended() {
      const failed = await createStore(review).abandon(finding, agent)
      if (!failed) return false
      const released = await releaseAll()
      await log(
        `turn ended with the finding working: failed it, released ${released.length} lock(s)`,
      )
      return true
    },

    /** @param {Step[]} steps */
    note: record,
  }

  /**
   * The script that ended the run, done: the store filed the run's steps in
   * the history while it still ran; this last step joins them.
   * @param {Step} last
   */
  async function endRun(last) {
    await mkdir(path.dirname(historyPath(review, finding)), { recursive: true })
    await appendFile(
      historyPath(review, finding),
      `${JSON.stringify({ ...last, agent })}\n`,
    )
    const released = await releaseAll()
    await rm(progressPath(review, finding), { force: true })
    await log(`run ended (done or asked): released ${released.length} lock(s)`)
  }
}

async function main() {
  const [mode] = process.argv.slice(2)
  const reviewer = flag('--reviewer')
  const finding = reviewer ?? flag('--finding')
  const review = flag('--review')
  const root = flag('--project')
  if (!mode || !finding || !review || !root) {
    console.error(
      'usage: hook.mjs <pre|post|stop|note|ended> --finding <id> --review <dir> --project <root> [--lock-root <dir>] [--agent <id>], or --reviewer <name> in place of --finding',
    )
    process.exit(2)
  }
  // A review agent's file is named after it: nothing outside reviewers/.
  if (reviewer && !/^[\w-]{1,80}$/.test(reviewer)) process.exit(2)
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  /** @type {HookInput} */
  const event =
    mode === 'note' || mode === 'ended' || !text.trim() ? {} : JSON.parse(text)
  const hooks = hooksFor({
    finding,
    review: path.resolve(review),
    root,
    lockRoot: flag('--lock-root') ?? repositoryOf(root),
    agent: event.agent_id ?? flag('--agent') ?? '-',
    reviewer: reviewer !== undefined,
  })
  // A review agent holds no lock and no finding: nothing to release or fail.
  if (reviewer && (mode === 'stop' || mode === 'ended')) return
  if (mode === 'pre') {
    const deny = await hooks.pre(event)
    if (deny)
      console.log(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: deny,
          },
        }),
      )
  } else if (mode === 'post') await hooks.post(event)
  else if (mode === 'stop') await hooks.stop()
  else if (mode === 'ended') {
    // The hooks module logs why it could not fail the finding.
    const failed = await hooks.ended().catch((error) => {
      console.error(String(error))
      return false
    })
    if (failed) console.log(`AGENT_ENDED ${finding}`)
  } else if (mode === 'note')
    await hooks.note(
      text
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line)),
    )
}

try {
  await main()
} catch (error) {
  // Never in the agent's way: its tool runs, unlocked and unrecorded.
  await debug('-', flag('--finding') ?? '-', `hook.mjs failed: ${String(error)}`)
}
