// `/tranchant comments`: comments.mjs, which reads a PR's or an MR's
// unresolved review threads into a review; open.mjs --refresh, which imports
// it again keeping the decisions; and post.mjs replying on a thread.
import assert from 'node:assert/strict'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import { say } from '../skills/tranchant/scripts/lib/discussion.mjs'
import { createStore } from '../skills/tranchant/scripts/lib/store.mjs'
import { SCRIPTS, run, tempDir } from './helpers.mjs'

const COMMENTS = path.join(SCRIPTS, 'comments.mjs')
const OPEN = path.join(SCRIPTS, 'open.mjs')
const POST = path.join(SCRIPTS, 'post.mjs')

/** @type {string} */
let stateDir
/** The settings folder the scripts read: never the machine's. */
let configDir = ''

before(async (t) => {
  stateDir = await tempDir(t)
  configDir = await tempDir(t, 'tranchant-config-')
})

const CART = [
  'export function total(items) {',
  '  let sum = 0',
  '  for (const item of items) sum += item.price',
  '  return sum',
  '}',
  '',
  'export const count = (items) => items.length',
  '',
].join('\n')

/**
 * A repository on `feature/cart`, one commit ahead of `main`, its origin
 * `remote`.
 * @param {import('node:test').TestContext} t
 * @param {string} remote
 */
async function repository(t, remote) {
  const dir = await tempDir(t, 'tranchant-repo-')
  const git = async (/** @type {string[]} */ ...args) => {
    const ran = await run('git', [
      '-C',
      dir,
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@t',
      ...args,
    ])
    assert.equal(ran.code, 0, ran.stderr)
    return ran.stdout.trim()
  }
  await git('init', '-q', '-b', 'main')
  await git('remote', 'add', 'origin', remote)
  await mkdir(path.join(dir, 'src'))
  await writeFile(path.join(dir, 'src', 'cart.js'), 'export const total = () => 0\n')
  await git('add', '.')
  await git('commit', '-q', '-m', 'base')
  const base = await git('rev-parse', 'HEAD')
  await git('switch', '-q', '-c', 'feature/cart')
  await writeFile(path.join(dir, 'src', 'cart.js'), CART)
  await writeFile(
    path.join(dir, 'src', 'long.js'),
    Array.from({ length: 150 }, (_, i) => `export const n${i + 1} = ${i + 1}`).join('\n'),
  )
  await git('add', '.')
  await git('commit', '-q', '-m', 'change')
  const head = await git('rev-parse', 'HEAD')
  return { dir, git, base, head }
}

/**
 * A fake `gh` or `glab`: a Node script answering from `answers`, its
 * arguments joined by spaces matched against each key in turn, and
 * recording each call (arguments and stdin) in `calls.jsonl`.
 * @param {import('node:test').TestContext} t
 * @param {string} name
 * @param {[string, unknown][]} answers A key matches when the arguments, or stdin, include it.
 */
async function fake(t, name, answers) {
  const bin = await tempDir(t)
  const file = path.join(bin, name)
  const data = path.join(bin, 'answers.json')
  await writeFile(data, JSON.stringify(answers))
  await writeFile(
    file,
    [
      `#!${process.execPath}`,
      "const fs = require('node:fs')",
      `const answers = JSON.parse(fs.readFileSync(${JSON.stringify(data)}, 'utf8'))`,
      "const args = process.argv.slice(2).join(' ')",
      "let input = ''",
      // Only a call with a body reads stdin: execFile leaves it open on the others.
      "if (args.includes('--input -')) input = fs.readFileSync(0, 'utf8')",
      `fs.appendFileSync(${JSON.stringify(path.join(bin, 'calls.jsonl'))}, JSON.stringify({ args, input }) + '\\n')`,
      "const found = answers.find(([key]) => (args + ' ' + input).includes(key))",
      "if (!found) { console.error('no such call: ' + args); process.exit(1) }",
      "if (typeof found[1] === 'string' && found[1].startsWith('ERROR')) { console.error(found[1]); process.exit(1) }",
      'process.stdout.write(JSON.stringify(found[1]))',
      '',
    ].join('\n'),
  )
  await chmod(file, 0o755)
  /** @returns {Promise<{ args: string, input: string }[]>} */
  const calls = async () =>
    (await readFile(path.join(bin, 'calls.jsonl'), 'utf8').catch(() => ''))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  return { file, calls }
}

/**
 * Runs comments.mjs in `cwd`.
 * @param {string} cwd
 * @param {string[]} args
 * @param {Record<string, string>} env
 */
const comments = (cwd, args, env) =>
  run(process.execPath, [COMMENTS, ...args], {
    cwd,
    env: {
      TRANCHANT_STATE_DIR: stateDir,
      XDG_CONFIG_HOME: configDir,
      TRANCHANT_GH: path.join(stateDir, 'no-gh'),
      TRANCHANT_GLAB: path.join(stateDir, 'no-glab'),
      // The fixtures' remotes are not there: a fetch fails at once, never over the network.
      GIT_SSH_COMMAND: 'false',
      ...env,
    },
  })

/** The review comments.mjs wrote. @param {string} stdout */
const written = async (stdout) =>
  JSON.parse(await readFile(stdout.trim().replace(/^INBOX /, ''), 'utf8'))

const PR_URL = 'https://github.com/acme/shop/pull/7'

/**
 * A pull request and its review threads, as gh answers them.
 * @param {{ base: string, head: string }} repo
 * @param {any[]} threads
 */
const github = ({ base, head }, threads) =>
  /** @type {[string, unknown][]} */ ([
    [
      'pr view',
      {
        number: 7,
        url: PR_URL,
        title: 'Cart totals',
        headRefName: 'feature/cart',
        headRefOid: head,
        baseRefName: 'main',
        baseRefOid: base,
        author: { login: 'me' },
      },
    ],
    [
      'api graphql',
      {
        data: {
          viewer: { login: 'me' },
          repository: {
            pullRequest: {
              reviewThreads: { pageInfo: { hasNextPage: false }, nodes: threads },
            },
          },
        },
      },
    ],
  ])

/**
 * A GitHub review thread.
 * @param {string} id
 * @param {Record<string, unknown>} fields
 * @param {string[]} bodies
 */
const ghThread = (id, fields, bodies) => ({
  id,
  isResolved: false,
  isOutdated: false,
  path: 'src/cart.js',
  line: null,
  originalLine: null,
  startLine: null,
  diffSide: 'RIGHT',
  subjectType: 'LINE',
  ...fields,
  comments: {
    nodes: bodies.map((body, i) => ({
      author: { login: i === 0 ? 'alice' : 'me' },
      body,
      createdAt: `2026-11-0${i + 1}T10:00:00Z`,
      url: `${PR_URL}#discussion_r${id}${i}`,
      originalCommit: { oid: 'f'.repeat(40) },
    })),
  },
})

test('reads the unresolved threads of a pull request, one finding each, on their line', async (t) => {
  const repo = await repository(t, 'git@github.com:acme/shop.git')
  const gh = await fake(
    t,
    'gh',
    github(repo, [
      ghThread('PRRT_1', { line: 3 }, [
        'Should this skip items without a price?',
        'Good point.',
      ]),
      ghThread('PRRT_2', { line: 4, isResolved: true }, ['Done already']),
      ghThread('PRRT_3', { isOutdated: true, originalLine: 2 }, ['Name it `subtotal`']),
      ghThread('PRRT_4', { subjectType: 'FILE' }, ['Split this file']),
      ghThread('PRRT_5', { diffSide: 'LEFT', line: 1, originalLine: 1 }, [
        'Why remove this?',
      ]),
      ghThread('PRRT_6', { line: 2 }, [
        '```suggestion\n  let sum = 0n\n```\nUse a bigint',
      ]),
      ghThread('PRRT_7', { path: 'src/long.js', startLine: 10, line: 120 }, ['Too long']),
    ]),
  )
  const ran = await comments(repo.dir, [], { TRANCHANT_GH: gh.file })
  assert.equal(ran.code, 0, ran.stdout + ran.stderr)
  const review = await written(ran.stdout)
  assert.match(review.id, /^comments-[0-9a-f]{12}$/)
  assert.equal(review.ownership, 'ours')
  assert.equal(review.headSha, repo.head)
  assert.equal(review.base, repo.base)
  assert.equal(review.branch, 'feature/cart')
  assert.deepEqual(review.mr, {
    forge: 'github',
    project: 'acme/shop',
    iid: 7,
    url: PR_URL,
    author: 'me',
    // The one who imports: the page marks their comments.
    viewer: 'me',
  })
  // The resolved thread stays on the PR.
  assert.equal(review.findings.length, 6)
  const [current, outdated, file, deleted, suggestion, long] = review.findings
  assert.equal(current.line, 3)
  assert.equal(current.tag, 'question')
  assert.equal(current.title, 'Should this skip items without a price?')
  assert.equal(current.problem, 'Should this skip items without a price?')
  assert.deepEqual(current.marks, [{ line: 3 }])
  assert.deepEqual(current.excerpt, {
    startLine: 1,
    lines: CART.split('\n').slice(0, 6),
  })
  assert.deepEqual(
    current.thread.comments.map((/** @type {any} */ one) => [one.author, one.body]),
    [
      ['alice', 'Should this skip items without a price?'],
      ['me', 'Good point.'],
    ],
  )
  assert.equal(current.thread.forge, 'github')
  assert.equal(current.thread.id, 'PRRT_1')
  assert.equal(current.thread.outdated, undefined)
  // Moved since: the line it was on, no mark, its file's header.
  assert.equal(outdated.line, 2)
  assert.equal(outdated.thread.outdated, true)
  assert.equal(outdated.marks, undefined)
  assert.equal(file.thread.file, true)
  assert.equal(file.line, 1)
  // A deleted line reads in the base's file, where it was.
  assert.equal(deleted.thread.outdated, true)
  assert.deepEqual(deleted.excerpt, {
    startLine: 1,
    lines: ['export const total = () => 0'],
  })
  // A suggestion's code is no title.
  assert.equal(suggestion.tag, 'suggestion')
  assert.equal(suggestion.title, 'Use a bigint')
  // A selection longer than an excerpt keeps its anchor in it.
  assert.equal(long.excerpt.startLine, 41)
  assert.equal(long.excerpt.lines.length, 80)
  assert.deepEqual(long.marks?.[0], { line: 44 })
  assert.deepEqual(long.marks?.at(-1), { line: 120 })
  // Nobody's words in the title, which reaches the session.
  assert.equal(review.title, 'Comments on acme/shop#7')
  // From the origin's forge: the current branch's pull request.
  const [view, graphql] = await gh.calls()
  assert.match(view?.args ?? '', /^pr view --json /)
  assert.deepEqual(JSON.parse(graphql?.input ?? '{}').variables, {
    owner: 'acme',
    name: 'shop',
    number: 7,
    after: null,
  })
  // The same pull request is the same review: run again, it refreshes.
  const again = await comments(repo.dir, [PR_URL], { TRANCHANT_GH: gh.file })
  assert.equal((await written(again.stdout)).id, review.id)
})

test('refuses a pull request with no unresolved thread, or a url of neither forge', async (t) => {
  const repo = await repository(t, 'git@github.com:acme/shop.git')
  const gh = await fake(
    t,
    'gh',
    github(repo, [ghThread('PRRT_9', { line: 3, isResolved: true }, ['ok'])]),
  )
  const none = await comments(repo.dir, [], { TRANCHANT_GH: gh.file })
  assert.equal(none.code, 2)
  assert.equal(
    none.stdout,
    `REVIEW_REFUSED ${PR_URL} has no unresolved review thread on a file\n`,
  )
  const odd = await comments(repo.dir, ['https://example.com/acme/shop'], {})
  assert.equal(odd.code, 2)
  assert.match(
    odd.stdout,
    /^REVIEW_REFUSED .* is neither a pull request nor a merge request url/,
  )
})

const MR_URL = 'https://gitlab.example.com/shop/web/-/merge_requests/12'

/**
 * A GitLab discussion, a system note first, as glab answers it.
 * @param {string} id
 * @param {any} position
 * @param {boolean} [resolved]
 */
const discussion = (id, position, resolved = false) => ({
  id,
  notes: [
    { id: 1, system: true, body: 'added 1 commit' },
    {
      id: Number.parseInt(id, 16),
      body: `Comment ${id}`,
      author: { username: 'bob' },
      created_at: '2026-11-01T10:00:00Z',
      resolvable: true,
      resolved,
      ...(position && { position }),
    },
  ],
})

test('reads the unresolved discussions of a merge request; one on no file goes to the summary', async (t) => {
  const repo = await repository(t, 'git@gitlab.example.com:shop/web.git')
  // An older version of the file, its line 2 another text: the discussion written on it moved.
  const older = repo.base
  const glab = await fake(t, 'glab', [
    [
      'mr view',
      {
        iid: 12,
        title: 'Cart totals',
        web_url: MR_URL,
        source_branch: 'feature/cart',
        author: { username: 'me' },
        diff_refs: { base_sha: repo.base, head_sha: repo.head, start_sha: repo.base },
      },
    ],
    ['api user', { username: 'me' }],
    [
      'discussions?per_page=100&page=1',
      [
        discussion('a1', { new_path: 'src/cart.js', new_line: 3, head_sha: repo.head }),
        discussion(
          'b2',
          { new_path: 'src/cart.js', new_line: 4, head_sha: repo.head },
          true,
        ),
        discussion('c3', { new_path: 'src/cart.js', new_line: 1, head_sha: older }),
        discussion('d4', null),
      ],
    ],
  ])
  const ran = await comments(repo.dir, [MR_URL], { TRANCHANT_GLAB: glab.file })
  assert.equal(ran.code, 0, ran.stdout + ran.stderr)
  const review = await written(ran.stdout)
  assert.deepEqual(review.mr, {
    forge: 'gitlab',
    project: 'shop/web',
    iid: 12,
    url: MR_URL,
    author: 'me',
    viewer: 'me',
    diffRefs: { baseSha: repo.base, headSha: repo.head, startSha: repo.base },
  })
  assert.deepEqual(
    review.findings.map((/** @type {any} */ one) => [
      one.line,
      one.thread.id,
      one.thread.outdated,
    ]),
    [
      [3, 'a1', undefined],
      [1, 'c3', true],
    ],
  )
  // The system note is not a comment of the thread.
  assert.deepEqual(review.findings[0].thread.comments, [
    {
      author: 'bob',
      body: 'Comment a1',
      at: '2026-11-01T10:00:00Z',
      url: `${MR_URL}#note_161`,
    },
  ])
  assert.match(review.summary, /On the merge request itself/)
  assert.match(review.summary, /@bob, \[the thread\]\(.*#note_212\): Comment d4/)
})

test('open.mjs --refresh imports the same pull request again, its decisions kept', async (t) => {
  const repo = await repository(t, 'git@github.com:acme/shop.git')
  const first = await fake(
    t,
    'gh',
    github(repo, [ghThread('PRRT_1', { line: 3 }, ['Skip items without a price?'])]),
  )
  const ran = await comments(repo.dir, [], { TRANCHANT_GH: first.file })
  const inbox = ran.stdout.trim().replace(/^INBOX /, '')
  const env = { TRANCHANT_STATE_DIR: stateDir }
  const opened = await run(process.execPath, [OPEN, inbox, '--refresh'], { env })
  assert.equal(opened.code, 0, opened.stdout + opened.stderr)
  const dir = opened.stdout.trim().replace(/^REVIEW /, '')
  const store = createStore(dir)
  const [finding] = (await store.readReview()).findings
  await store.decide(finding?.id ?? '', { action: 'skip' })
  // A reply on the thread and a new thread since.
  const second = await fake(
    t,
    'gh',
    github(repo, [
      ghThread('PRRT_1', { line: 3 }, ['Skip items without a price?', 'Yes, please']),
      ghThread('PRRT_2', { line: 7 }, ['count could be a getter']),
    ]),
  )
  const rerun = await comments(repo.dir, [], { TRANCHANT_GH: second.file })
  const refused = await run(process.execPath, [OPEN, inbox], { env })
  assert.equal(refused.code, 2, 'without --refresh, another content is refused')
  const again = await run(
    process.execPath,
    [OPEN, rerun.stdout.trim().replace(/^INBOX /, ''), '--refresh'],
    { env },
  )
  assert.equal(again.code, 0, again.stdout + again.stderr)
  assert.equal(again.stdout.trim(), `REVIEW ${dir}`)
  assert.match(again.stderr, /1 finding\(s\) added, 1 updated/)
  const { review, decisions } = await store.readAll()
  assert.equal(review.findings.length, 2)
  assert.equal(review.findings[0]?.id, finding?.id)
  assert.equal(review.findings[0]?.addedAt, finding?.addedAt)
  assert.equal(review.findings[0]?.thread?.comments.length, 2)
  assert.equal(decisions.findings[finding?.id ?? '']?.state, 'skipped')

  // The head moved, a thread an agent holds got a reply, another is resolved since.
  await repo.git('commit', '-q', '--allow-empty', '-m', 'push')
  const moved = await repo.git('rev-parse', 'HEAD')
  const held = review.findings[1]
  await store.decide(held?.id ?? '', { action: 'fix' })
  const later = await written(rerun.stdout)
  later.headSha = moved
  later.createdAt = new Date(0).toISOString()
  later.findings = later.findings
    .filter((/** @type {any} */ one) => one.id === held?.id)
    .map((/** @type {any} */ one) => ({
      ...one,
      thread: {
        ...one.thread,
        comments: [...one.thread.comments, { author: 'x', body: 'and more', at: 'now' }],
      },
    }))
  assert.deepEqual(await store.refresh(later), { added: 0, updated: 0, kept: 1 })
  const after = await store.readReview()
  assert.equal(after.headSha, moved)
  assert.equal(after.createdAt, review.createdAt)
  // The finding the agent holds is what the reviewer decided on; the resolved one stays.
  assert.equal(
    after.findings.find((one) => one.id === held?.id)?.thread?.comments.length,
    1,
  )
  assert.equal(after.findings.length, 2)
  await assert.rejects(
    store.refresh({ ...later, mr: { ...later.mr, url: `${PR_URL}0` } }),
    /exists for another change/,
  )
})

test('a merge request on another host than the origin is refused', async (t) => {
  const repo = await repository(t, 'git@gitlab.com:shop/web.git')
  const glab = await fake(t, 'glab', [
    [
      'mr view',
      {
        iid: 12,
        web_url: MR_URL,
        author: { username: 'me' },
        diff_refs: { base_sha: repo.base, head_sha: repo.head, start_sha: repo.base },
      },
    ],
  ])
  const ran = await comments(repo.dir, [MR_URL], { TRANCHANT_GLAB: glab.file })
  assert.equal(ran.code, 2)
  assert.match(
    ran.stdout,
    /^REVIEW_REFUSED .* is on gitlab\.example\.com, the checkout's origin on gitlab\.com/,
  )
})

/**
 * A comments review imported, its first finding decided with `decision`.
 * @param {import('node:test').TestContext} t
 * @param {[string, unknown][]} answers What the fake tool answers to the post.
 * @param {'github' | 'gitlab'} forge
 */
async function replying(t, answers, forge) {
  const repo = await repository(
    t,
    forge === 'github'
      ? 'git@github.com:acme/shop.git'
      : 'git@gitlab.example.com:shop/web.git',
  )
  const reader =
    forge === 'github'
      ? await fake(
          t,
          'gh',
          github(repo, [ghThread('PRRT_1', { line: 3 }, ['Skip items?'])]),
        )
      : await fake(t, 'glab', [
          [
            'mr view',
            {
              iid: 12,
              web_url: MR_URL,
              source_branch: 'feature/cart',
              author: { username: 'me' },
              diff_refs: {
                base_sha: repo.base,
                head_sha: repo.head,
                start_sha: repo.base,
              },
            },
          ],
          [
            'discussions?',
            [
              {
                id: 'd1sc',
                notes: [
                  {
                    id: 5,
                    body: 'Skip items?',
                    author: { username: 'bob' },
                    created_at: '2026-11-01T10:00:00Z',
                    resolvable: true,
                    resolved: false,
                    position: {
                      new_path: 'src/cart.js',
                      new_line: 3,
                      head_sha: repo.head,
                    },
                  },
                ],
              },
            ],
          ],
        ])
  const tool = forge === 'github' ? 'TRANCHANT_GH' : 'TRANCHANT_GLAB'
  const ran = await comments(repo.dir, [], { [tool]: reader.file })
  assert.equal(ran.code, 0, ran.stdout + ran.stderr)
  const env = { TRANCHANT_STATE_DIR: stateDir }
  const opened = await run(
    process.execPath,
    [OPEN, ran.stdout.trim().replace(/^INBOX /, '')],
    { env },
  )
  const dir = opened.stdout.trim().replace(/^REVIEW /, '')
  const store = createStore(dir)
  const [finding] = (await store.readReview()).findings
  const poster = await fake(t, forge === 'github' ? 'gh' : 'glab', answers)
  const post = () =>
    run(process.execPath, [POST, finding?.id ?? '', '--review', dir], {
      env: { ...env, [tool]: poster.file },
    })
  return { store, dir, id: finding?.id ?? '', post, calls: poster.calls }
}

test('a post on a thread replies there with gh, then resolves it when asked', async (t) => {
  const reply = 'https://github.com/acme/shop/pull/7#discussion_r99'
  const { store, dir, id, post, calls } = await replying(
    t,
    [
      [
        'resolveReviewThread',
        { data: { resolveReviewThread: { thread: { isResolved: true } } } },
      ],
      [
        'api graphql',
        { data: { addPullRequestReviewThreadReply: { comment: { url: reply } } } },
      ],
    ],
    'github',
  )
  // A thread has no comment to post as is: the reply is the reviewer's.
  await assert.rejects(store.decide(id, { action: 'post' }), /the reply on .* is empty/)
  await store.decide(id, {
    action: 'post',
    comment: 'Done in the next push',
    resolve: true,
  })
  const ran = await post()
  assert.equal(ran.stdout, `posted ${reply}\n`, ran.stderr)
  const [first, second] = await calls()
  assert.match(first?.args ?? '', /^api graphql --method POST --hostname github\.com /)
  const asked = JSON.parse(first?.input ?? '{}')
  assert.match(asked.query, /addPullRequestReviewThreadReply/)
  assert.deepEqual(asked.variables, { thread: 'PRRT_1', body: 'Done in the next push' })
  assert.deepEqual(JSON.parse(second?.input ?? '{}').variables, { thread: 'PRRT_1' })
  const entry = (await store.readDecisions()).findings[id]
  assert.equal(entry?.state, 'posted')
  assert.equal(entry?.posted?.url, reply)
  assert.equal(entry?.posted?.resolved, true)
  // Kept for the page to show in the thread, until a refresh reads it from GitHub.
  assert.deepEqual(
    entry?.replies?.map(({ text, url, resolved }) => ({ text, url, resolved })),
    [{ text: 'Done in the next push', url: reply, resolved: true }],
  )
  // Replied on, the thread lives on: its reviewer may answer back, so it may be discussed.
  const discussed = await say(dir, id, 'What would she answer?')
  assert.equal(discussed.messages.at(-1)?.text, 'What would she answer?')
})

test('a fixed thread is replied on with glab; a resolve that fails leaves the reply posted', async (t) => {
  const { store, id, post, calls } = await replying(
    t,
    [
      ['--method PUT', 'ERROR: 403 Forbidden'],
      ['/notes', { id: 4242 }],
    ],
    'gitlab',
  )
  await store.decide(id, { action: 'fix' })
  await store.claim(id)
  await store.done(id, 'Skipped the items without a price.')
  await store.decide(id, { action: 'post', comment: 'Fixed', resolve: true })
  const ran = await post()
  assert.equal(ran.stdout, `posted ${MR_URL}#note_4242\n`, ran.stderr)
  const [reply, resolve] = await calls()
  assert.equal(
    reply?.args,
    'api --method POST --header Content-Type: application/json --input - projects/shop%2Fweb/merge_requests/12/discussions/d1sc/notes',
  )
  assert.deepEqual(JSON.parse(reply?.input ?? '{}'), { body: 'Fixed' })
  assert.match(
    resolve?.args ?? '',
    /--method PUT .* projects\/shop%2Fweb\/merge_requests\/12\/discussions\/d1sc$/,
  )
  // A reply is no move: the finding stays fixed, the reply recorded.
  const entry = (await store.readDecisions()).findings[id]
  assert.equal(entry?.state, 'fixed')
  assert.equal(entry?.reply, undefined)
  assert.equal(entry?.posted?.url, `${MR_URL}#note_4242`)
  assert.equal(entry?.posted?.resolved, undefined)
  assert.equal(entry?.posted?.unresolved, 'ERROR: 403 Forbidden')
  assert.equal(entry?.runs.at(-1)?.outcome, 'fixed')
  assert.deepEqual(
    entry?.replies?.map(({ text, url, resolved }) => ({ text, url, resolved })),
    [{ text: 'Fixed', url: `${MR_URL}#note_4242`, resolved: undefined }],
  )
})

test('a reply that fails on a fixed thread keeps it fixed; one on its way holds the next', async (t) => {
  const { store, id, post } = await replying(
    t,
    [['addPullRequestReviewThreadReply', 'ERROR: GraphQL: Could not resolve to a node']],
    'github',
  )
  await store.decide(id, { action: 'fix' })
  await store.claim(id)
  await store.done(id, 'Skipped it.')
  await store.decide(id, { action: 'post', comment: 'Fixed' })
  await assert.rejects(
    store.decide(id, { action: 'post', comment: 'Again' }),
    /is on its way/,
  )
  const ran = await post()
  assert.equal(ran.stdout, 'failed ERROR: GraphQL: Could not resolve to a node\n')
  const entry = (await store.readDecisions()).findings[id]
  assert.equal(entry?.state, 'fixed')
  assert.equal(entry?.reply?.failed, 'ERROR: GraphQL: Could not resolve to a node')
  // Failed, the reply may be written again.
  await store.decide(id, { action: 'post', comment: 'Fixed, again' })
  assert.equal((await store.readDecisions()).findings[id]?.reply?.text, 'Fixed, again')
})

test('a resolve the forge does not confirm is not recorded as resolved', async (t) => {
  const reply = 'https://github.com/acme/shop/pull/7#discussion_r99'
  const { store, id, post } = await replying(
    t,
    [
      [
        'resolveReviewThread',
        { data: { resolveReviewThread: { thread: { isResolved: false } } } },
      ],
      [
        'addPullRequestReviewThreadReply',
        { data: { addPullRequestReviewThreadReply: { comment: { url: reply } } } },
      ],
    ],
    'github',
  )
  await store.decide(id, { action: 'post', comment: 'Done', resolve: true })
  const ran = await post()
  assert.equal(ran.stdout, `posted ${reply}\n`, ran.stderr)
  const entry = (await store.readDecisions()).findings[id]
  assert.equal(entry?.state, 'posted')
  assert.equal(entry?.posted?.resolved, undefined)
  assert.match(entry?.posted?.unresolved ?? '', /^gh did not say the thread is resolved/)
  // Answered back, a posted thread is replied on again, its state kept.
  await store.decide(id, { action: 'post', comment: 'See the new commit' })
  assert.equal((await store.readDecisions()).findings[id]?.state, 'posted')
})
