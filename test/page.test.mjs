// The built page (npm run build), as the release ships it.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'

const DIST = new URL('../skills/tranchant/page/dist/', import.meta.url).pathname

test('the bundle inlines Figtree: no font file to fetch', async () => {
  const files = await readdir(DIST, { recursive: true })
  assert.deepEqual(
    files.filter((file) => file.endsWith('.woff2')),
    [],
  )
  const page = await readFile(path.join(DIST, 'page.js'), 'utf8')
  assert.equal(page.match(/"data:font\/woff2;base64,/g)?.length, 2)
})

test('the license notices hold the Figtree one', async () => {
  const notices = await readFile(path.join(DIST, 'THIRD_PARTY_LICENSES.txt'), 'utf8')
  assert.match(notices, /^Figtree \(OFL-1\.1\)$/m)
  assert.match(notices, /SIL OPEN FONT LICENSE Version 1\.1/)
})
