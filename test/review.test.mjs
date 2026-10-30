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

test('the recipe maps every front-end extension to a lens, and the rest to bugs', async () => {
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
  ])
  const otherwise = recipe.lenses.filter((lens) => lens.otherwise)
  assert.deepEqual(
    otherwise.map((lens) => lens.name),
    ['bugs'],
  )
  assert.equal(otherwise[0].paths, undefined)
  const covered = new Set()
  for (const lens of recipe.lenses.filter((one) => !one.otherwise)) {
    assert.ok(lens.paths?.length, `${lens.name}: paths`)
    for (const glob of lens.paths) {
      assert.match(glob, GLOB, `${lens.name}: ${glob}`)
      covered.add(glob.slice('**/*.'.length))
    }
  }
  assert.deepEqual(
    [...covered].toSorted((a, b) => a.localeCompare(b)),
    [...FRONT_END].toSorted((a, b) => a.localeCompare(b)),
  )
})

test('each lens of the recipe has its prompt, named after it', async () => {
  const files = (await readdir(REVIEW))
    .filter((file) => file.endsWith('.md'))
    .toSorted((a, b) => a.localeCompare(b))
  assert.deepEqual(
    files,
    [...recipe.lenses.map((lens) => lens.prompt), 'verifier.md'].toSorted((a, b) =>
      a.localeCompare(b),
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
