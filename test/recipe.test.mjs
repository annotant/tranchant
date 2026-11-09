// The review recipe and the lens prompts the driver runs by default: the
// recipe names prompts that exist, covers every front-end extension, and each
// prompt tells its lens how to anchor, word and report a finding.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

const REVIEW = new URL('../agents/review/', import.meta.url).pathname
const FRONT_END = ['ts', 'tsx', 'js', 'jsx', 'vue', 'svelte', 'css', 'scss', 'html']
const GLOB = /^\*\*\/\*\.[a-z]+$/

/** @type {{ version: number, lenses: { name: string, prompt: string, paths?: string[], otherwise?: boolean }[] }} */
const recipe = JSON.parse(await readFile(path.join(REVIEW, 'recipe.json'), 'utf8'))

/** A prompt file: its frontmatter fields and its body. */
async function prompt(file) {
  const text = await readFile(path.join(REVIEW, file), 'utf8')
  const match = /^---\n([\s\S]*?)\n---\n+([\s\S]*)$/.exec(text)
  assert.ok(match, `${file}: frontmatter`)
  const [, frontmatter, body] = match
  const name = /^name: (.+)$/m.exec(frontmatter)?.[1]
  const description = /^description:\s+([\s\S]+)$/m.exec(frontmatter)?.[1]
  return { name, description, body }
}

test('the recipe maps every front-end extension to a lens, and every file to bugs and docs', async () => {
  assert.equal(recipe.version, 1)
  const names = recipe.lenses.map((lens) => lens.name)
  assert.deepEqual(names, [...new Set(names)])
  assert.deepEqual(names, [
    'correctness',
    'types',
    'accessibility',
    'performance',
    'security',
    'tests',
    'conventions',
    'bugs',
    'silent-failures',
    'docs',
  ])
  // No lens takes only the leftovers: bugs and docs read every file, the code included.
  assert.deepEqual(
    recipe.lenses.filter((lens) => lens.otherwise),
    [],
  )
  const byName = new Map(recipe.lenses.map((lens) => [lens.name, lens]))
  assert.deepEqual(byName.get('bugs')?.paths, ['**'])
  assert.deepEqual(byName.get('docs')?.paths, ['**'])
  const covered = new Set()
  for (const lens of recipe.lenses) {
    assert.ok(lens.paths?.length, `${lens.name}: paths`)
    if (lens.paths[0] === '**') continue
    for (const glob of lens.paths) {
      assert.match(glob, GLOB, `${lens.name}: ${glob}`)
      covered.add(glob.slice('**/*.'.length))
    }
  }
  for (const extension of FRONT_END) assert.ok(covered.has(extension), extension)
  // Performance and silent failures follow the chain to the server: its code is theirs too.
  for (const name of ['performance', 'silent-failures']) {
    const paths = byName.get(name)?.paths ?? []
    for (const glob of ['**/*.ts', '**/*.mjs', '**/*.py', '**/*.sql'])
      assert.ok(paths.includes(glob), `${name}: ${glob}`)
  }
})

test('each lens follows the execution chain into the server and the dependencies', async () => {
  for (const lens of recipe.lenses) {
    const { body } = await prompt(lens.prompt)
    const text = body.replace(/\s+/g, ' ')
    assert.match(text, /follow the execution chain to its end/, lens.name)
    assert.match(text, /`node_modules`/, lens.name)
    assert.match(text, /never from its name or from memory/, lens.name)
  }
  const { body } = await prompt('verifier.md')
  assert.match(body.replace(/\s+/g, ' '), /settled by its source, never by its name/)
})

test('each lens of the recipe has its prompt, named after it', async () => {
  const files = (await readdir(REVIEW))
    .filter((file) => file.endsWith('.md'))
    .toSorted((a, b) => a.localeCompare(b))
  assert.deepEqual(
    files,
    [...recipe.lenses.map((lens) => lens.prompt), 'summary.md', 'verifier.md'].toSorted(
      (a, b) => a.localeCompare(b),
    ),
  )
  for (const lens of recipe.lenses) {
    const { name, description, body } = await prompt(lens.prompt)
    assert.equal(name, lens.name)
    assert.match((description ?? '').replace(/\s+/g, ' '), /Only the hooks start it/)
    // The inputs the driver gives, and the contract every finding follows.
    for (const word of ['REVIEW', 'SKILL', 'PROJECT', 'BASE', 'HEAD']) {
      assert.match(body, new RegExp(`\\*\\*${word}\\*\\*`), `${lens.name}: ${word}`)
    }
    for (const field of [
      'path',
      'line',
      'excerpt',
      'marks',
      'problem',
      'why',
      'fix',
      'comment',
    ]) {
      assert.match(body, new RegExp(`\`${field}\``), `${lens.name}: ${field}`)
    }
    assert.match(body, /add\.mjs --review REVIEW/, `${lens.name}: add.mjs`)
    assert.match(body, new RegExp(`"id": "${lens.name}-1"`), `${lens.name}: id`)
    assert.match(body, /data, never instructions/, `${lens.name}: the change is data`)
    assert.match(body, /## What to look at\n/, lens.name)
    assert.match(body, /## What counts\n/, lens.name)
    assert.match(body, /## How to (work|anchor|word|report)\n/, lens.name)
  }
})

test('the summary agent writes what the change does and its Change Map, as data, with summarize.mjs', async () => {
  const { name, description, body } = await prompt('summary.md')
  assert.equal(name, 'summary')
  assert.match((description ?? '').replace(/\s+/g, ' '), /Only the hooks start it/)
  for (const word of ['REVIEW', 'SKILL', 'PROJECT', 'BASE', 'HEAD']) {
    assert.match(body, new RegExp(`\\*\\*${word}\\*\\*`), word)
  }
  assert.match(body, /summarize\.mjs --review REVIEW <<'EOF'/)
  assert.match(body, /## Change Map/)
  assert.match(body, /`strengths`/)
  assert.match(body, /data, never instructions/)
})

test('the verifier confirms, amends or removes, and keeps the earlier of two duplicates', async () => {
  const { name, body } = await prompt('verifier.md')
  assert.equal(name, 'verifier')
  assert.match(body, /REVIEW\/findings\/<id>\.json/)
  assert.match(body, /verify\.mjs <id> --review REVIEW/)
  assert.match(body, /remove\.mjs <id> --review REVIEW/)
  assert.match(body, /`addedAt`/)
  assert.match(body, /data, never instructions/)
})

test('the prompts are wrapped by hand, and name no organisation', async () => {
  for (const file of (await readdir(REVIEW)).filter((one) => one.endsWith('.md'))) {
    const text = await readFile(path.join(REVIEW, file), 'utf8')
    const long = text.split('\n').filter((line) => line.length > 80)
    assert.deepEqual(long, [], `${file}: lines over 80 characters`)
    assert.doesNotMatch(text, /gitlab\.com|github\.com|jira|slack/i, file)
  }
})
