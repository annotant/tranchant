// `/tranchant import`: import.mjs finds the project's review processes and
// prepares an import; hook.mjs holds the import agent to its recipe file;
// lib/imports.mjs checks the recipe it wrote, lists it for the page, and puts
// it in force when the user uses it.
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { before, test } from 'node:test'
import { SCRIPTS, run, tempDir } from './helpers.mjs'

const IMPORT = path.join(SCRIPTS, 'import.mjs')
const HOOK = path.join(SCRIPTS, 'hook.mjs')

/** @type {string} */
let stateDir
/** @type {string} */
let configDir
/** @type {string} */
let claudeDir

before(async (t) => {
  stateDir = await tempDir(t)
  configDir = await tempDir(t, 'tranchant-config-')
  claudeDir = await tempDir(t, 'tranchant-claude-')
  const plugin = await tempDir(t, 'tranchant-plugin-')
  await mkdir(path.join(plugin, 'skills', 'code-review'), { recursive: true })
  await writeFile(
    path.join(plugin, 'skills', 'code-review', 'SKILL.md'),
    '---\nname: code-review\n---\n\nRun the reviewers.\n',
  )
  await mkdir(path.join(claudeDir, 'plugins'), { recursive: true })
  await writeFile(
    path.join(claudeDir, 'plugins', 'installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'workflow@team': [{ scope: 'user', installPath: plugin, version: '1.0.0' }],
      },
    }),
  )
})

const env = () => ({
  TRANCHANT_STATE_DIR: stateDir,
  XDG_CONFIG_HOME: configDir,
  CLAUDE_CONFIG_DIR: claudeDir,
})

/** A git repository with a review skill and a review agent of its own. */
async function project(/** @type {import('node:test').TestContext} */ t) {
  const dir = await tempDir(t, 'tranchant-repo-')
  assert.equal((await run('git', ['init', '-q', dir])).code, 0)
  await mkdir(path.join(dir, '.claude', 'skills', 'team-review'), { recursive: true })
  await writeFile(
    path.join(dir, '.claude', 'skills', 'team-review', 'SKILL.md'),
    'Review as the team does.\n',
  )
  await mkdir(path.join(dir, '.claude', 'agents'), { recursive: true })
  await writeFile(path.join(dir, '.claude', 'agents', 'sql-reviewer.md'), 'Read SQL.\n')
  await writeFile(path.join(dir, '.claude', 'agents', 'writer.md'), 'Writes docs.\n')
  return dir
}

const importScript = (/** @type {string} */ cwd, /** @type {string[]} */ args) =>
  run(process.execPath, [IMPORT, ...args], { cwd, env: env() })

/** The import agent's PreToolUse hook on `tool` with `input`: its refusal, or undefined. */
async function importerHook(
  /** @type {string[]} */ args,
  /** @type {string} */ tool,
  /** @type {Record<string, unknown>} */ input,
) {
  const ran = await run(process.execPath, [HOOK, 'pre', '--importer', 'im-1', ...args], {
    input: JSON.stringify({ tool_name: tool, tool_input: input }),
    env: env(),
  })
  assert.equal(ran.code, 0, ran.stderr)
  if (!ran.stdout.trim()) return undefined
  const answer = JSON.parse(ran.stdout)
  assert.equal(answer.hookSpecificOutput.permissionDecision, 'deny')
  return String(answer.hookSpecificOutput.permissionDecisionReason)
}

test("import.mjs --find lists the project's review processes, for the user to name one", async (t) => {
  const dir = await project(t)
  const ran = await importScript(dir, ['--find'])
  assert.equal(ran.code, 0, ran.stderr)
  assert.deepEqual(ran.stdout.trim().split('\n'), [
    'CANDIDATE .claude/agents/sql-reviewer.md',
    'CANDIDATE .claude/skills/team-review',
  ])
  const empty = await importScript(await tempDir(t), ['--find'])
  assert.equal(empty.stdout.trim(), 'NO_CANDIDATE')
})

test('import.mjs --prepare finds the source first, and refuses what it cannot find', async (t) => {
  const dir = await project(t)
  const ran = await importScript(dir, [
    '--prepare',
    'workflow:code-review',
    '--to',
    'local',
  ])
  assert.equal(ran.code, 0, ran.stdout + ran.stderr)
  const made = JSON.parse(ran.stdout.replace(/^IMPORT /, ''))
  assert.equal(made.source, 'workflow:code-review')
  assert.equal(made.version, '1.0.0')
  assert.equal(made.state, 'importing')
  assert.equal(path.basename(made.file), 'SKILL.md')
  assert.equal(made.recipe, path.join(made.dir, 'recipe.json'))
  assert.match(
    made.target,
    new RegExp(`^${configDir}/tranchant/projects/[0-9a-f]{12}/recipe\\.json$`),
  )
  for (const [args, why] of /** @type {const} */ ([
    [
      ['--prepare', 'nobody:review', '--to', 'project'],
      /the plugin nobody is not installed/,
    ],
    [['--prepare', './none.md', '--to', 'project'], /\.\/none\.md: no such file/],
    [
      ['--prepare', 'workflow:code-review', '--to', 'shared'],
      /project or local, not shared/,
    ],
  ])) {
    const refused = await importScript(dir, [...args])
    assert.equal(refused.code, 2)
    assert.match(refused.stdout, /^IMPORT_REFUSED /)
    assert.match(refused.stdout, why)
  }
})

test('the import agent may write its recipe file and read, nothing else', async (t) => {
  const dir = await tempDir(t)
  const recipe = path.join(dir, 'recipe.json')
  const args = ['--recipe', recipe]
  assert.equal(await importerHook(args, 'Write', { file_path: recipe }), undefined)
  assert.equal(
    await importerHook(args, 'Edit', { file_path: path.join(dir, '.', 'recipe.json') }),
    undefined,
  )
  for (const file of [path.join(dir, 'other.json'), path.join(dir, '..', 'recipe.json')])
    assert.match(
      (await importerHook(args, 'Write', { file_path: file })) ?? '',
      /writes .*recipe\.json only/,
    )
  assert.match((await importerHook(args, 'Write', {})) ?? '', /recipe\.json only/)
  assert.match(
    (await importerHook(args, 'NotebookEdit', { notebook_path: `${recipe}.ipynb` })) ??
      '',
    /only/,
  )
  assert.equal(await importerHook(args, 'Read', { file_path: '/etc/hosts' }), undefined)
  assert.equal(
    await importerHook(args, 'Bash', { command: 'git log -1 && ls' }),
    undefined,
  )
  for (const command of [
    `echo '{}' > ${recipe}`,
    'node -e "1"',
    'rm -rf .',
    'git commit -m x',
  ])
    assert.ok(await importerHook(args, 'Bash', { command }), command)
  assert.match((await importerHook(args, 'AskUserQuestion', {})) ?? '', /asks nothing/)
  // Started without its recipe, or on input it cannot read: refused, never let through.
  assert.match(
    (await importerHook([], 'Write', { file_path: recipe })) ?? '',
    /without its recipe file/,
  )
  const broken = await run(
    process.execPath,
    [HOOK, 'pre', '--importer', 'im-1', ...args],
    {
      input: '{ not json',
      env: env(),
    },
  )
  assert.match(broken.stdout, /"permissionDecision":"deny"/)
})

test('the recipe the agent wrote is checked, listed before it is used, then put in force', async (t) => {
  const dir = await project(t)
  const prepared = await importScript(dir, [
    '--prepare',
    '.claude/skills/team-review',
    '--to',
    'project',
  ])
  const made = JSON.parse(prepared.stdout.replace(/^IMPORT /, ''))
  // The state folder is read once, as the library loads.
  process.env.TRANCHANT_STATE_DIR = stateDir
  const { checkImport, listImports, useImport } =
    await import('../skills/tranchant/scripts/lib/imports.mjs')
  // Nothing written yet, or a recipe that names what does not exist: refused.
  const none = await importScript(dir, ['--check', made.dir])
  assert.equal(none.code, 2)
  assert.match(none.stdout, /^IMPORT_REFUSED the agent wrote no recipe that reads/)
  await writeFile(
    made.recipe,
    JSON.stringify({
      version: 1,
      lenses: [{ name: 'sql', source: '../.claude/agents/gone.md' }],
    }),
  )
  const gone = await importScript(dir, ['--check', made.dir])
  assert.match(
    gone.stdout,
    /^IMPORT_REFUSED lens sql: \.\.\/\.claude\/agents\/gone\.md: no such file/,
  )
  // Paths from the recipe's own folder: .tranchant/ for a project recipe.
  const recipe = {
    version: 1,
    extends: 'tranchant',
    lenses: [
      { name: 'sql', source: '../.claude/agents/sql-reviewer.md', paths: ['**/*.sql'] },
    ],
    imported: {
      source: '.claude/skills/team-review',
      leftOut: [{ what: 'Posting on GitLab', why: 'Tranchant posts from its page' }],
    },
  }
  await writeFile(made.recipe, JSON.stringify(recipe))
  const ok = await importScript(dir, ['--check', made.dir])
  assert.equal(
    ok.stdout.trim(),
    `IMPORTED ${path.join(made.project, '.tranchant', 'recipe.json')}`,
  )
  // The page's listing: lenses and what was left out, and no recipe in force yet.
  const listed = await listImports(made.project)
  assert.equal(listed.length, 1)
  assert.deepEqual(listed[0]?.lenses, [
    { name: 'sql', source: '../.claude/agents/sql-reviewer.md', paths: ['**/*.sql'] },
  ])
  assert.deepEqual(listed[0]?.leftOut, recipe.imported.leftOut)
  assert.equal(listed[0]?.extends, true)
  await assert.rejects(readFile(path.join(made.project, '.tranchant', 'recipe.json')))
  const used = await useImport(made.project, made.id)
  assert.deepEqual(used, {
    target: path.join(made.project, '.tranchant', 'recipe.json'),
    to: 'project',
  })
  assert.deepEqual(JSON.parse(await readFile(used.target, 'utf8')), recipe)
  assert.deepEqual(await listImports(made.project), [])
  await assert.rejects(useImport(made.project, made.id), /in use already/)
  // Checked again, a recipe in use stays so.
  assert.equal((await checkImport(made.dir)).state, 'used')
})
