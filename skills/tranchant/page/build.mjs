import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { build, context } from 'esbuild'

// --outdir: somewhere else than dist/. --watch: rebuilds on every change to src/,
// and type-checks next to it (npm run watch).
const { values: options } = parseArgs({
  options: {
    outdir: { type: 'string', default: 'dist' },
    watch: { type: 'boolean', default: false },
  },
})

// The page shows the plugin's version: plugin.json is its only source.
const { version } = JSON.parse(
  readFileSync(new URL('../../../.claude-plugin/plugin.json', import.meta.url), 'utf8'),
)

/** @type {import('esbuild').BuildOptions & { metafile: true }} */
const buildOptions = {
  // page.js, and the chunks it loads on demand (Mermaid) in chunks/, which the server serves.
  entryPoints: { page: 'src/main.tsx' },
  outdir: options.outdir,
  chunkNames: 'chunks/[name]-[hash]',
  splitting: true,
  bundle: true,
  format: 'esm',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  // Keep the bundled dependencies' license notices (React is MIT): at the end of the file.
  legalComments: 'eof',
  metafile: true,
  define: {
    'process.env.NODE_ENV': '"production"',
    TRANCHANT_VERSION: JSON.stringify(version),
  },
  banner: {
    js: '/* tranchant page: served by the tranchant skill on 127.0.0.1 only */',
  },
}
const PAGE = path.join(options.outdir, 'page.js')
const CHUNKS = path.join(options.outdir, 'chunks')

if (options.watch) {
  const ctx = await context({
    ...buildOptions,
    // Written below, on success only: esbuild would delete the bundle on a failed
    // rebuild, and the server would serve no page until the next good one.
    write: false,
    plugins: [
      {
        name: 'rebuilt',
        setup(rebuilt) {
          rebuilt.onEnd((result) => {
            if (result.errors.length || !result.metafile || !result.outputFiles) return
            // Old chunks stay: an open page, never reloaded, still imports them by name.
            mkdirSync(CHUNKS, { recursive: true })
            for (const file of result.outputFiles) writeFileSync(file.path, file.contents)
            writeLicenses(result.metafile)
            console.log(`REBUILT ${PAGE}`)
          })
        },
      },
    ],
  })
  mkdirSync(options.outdir, { recursive: true })
  await ctx.watch()
  // esbuild does not type-check: tsc reports the type errors, and never holds a rebuild back.
  const typescript = createRequire(import.meta.url).resolve('typescript/package.json')
  const tsc = spawn(
    process.execPath,
    [
      path.join(path.dirname(typescript), 'bin', 'tsc'),
      '-p',
      '.',
      '--watch',
      '--preserveWatchOutput',
    ],
    { stdio: 'inherit' },
  )
  for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP'])) {
    process.on(signal, () => {
      tsc.kill()
      process.exit(0)
    })
  }
} else {
  rmSync(CHUNKS, { recursive: true, force: true })
  writeLicenses((await build(buildOptions)).metafile)
}

/**
 * A package's license: its license file, else its README's License section
 * (fastdom ships no file); undefined when it has neither.
 * @param {string} dir
 */
function licenseText(dir) {
  const files = readdirSync(dir)
  const licenseFile = files.find((file) => /^licen[cs]e(\.|$)/i.test(file))
  if (licenseFile) return readFileSync(path.join(dir, licenseFile), 'utf8').trim()
  const readme = files.find((file) => /^readme(\.|$)/i.test(file))
  if (!readme) return undefined
  const section = /^(#+)\s*licen[cs]e\s*$([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/im.exec(
    readFileSync(path.join(dir, readme), 'utf8'),
  )
  return section?.[2]?.trim() || undefined
}

/**
 * Writes THIRD_PARTY_LICENSES.txt next to the bundle.
 * @param {import('esbuild').Metafile} metafile
 */
function writeLicenses(metafile) {
  const packageDirs = new Set()
  for (const input of Object.keys(metafile.inputs)) {
    const match = /^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input)
    if (match?.[1]) packageDirs.add(match[1])
  }
  const notices = [...packageDirs]
    .toSorted((a, b) => a.localeCompare(b))
    .map((dir) => {
      const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
      const text = licenseText(dir)
      if (!text) throw new Error(`${pkg.name} is bundled but ships no license text`)
      // Some (khroma) name no license in package.json: their license file says it.
      const name = pkg.license ? ` (${pkg.license})` : ''
      return `${pkg.name} ${pkg.version}${name}\n\n${text}\n`
    })
  writeFileSync(
    path.join(options.outdir, 'THIRD_PARTY_LICENSES.txt'),
    `The Tranchant page (page.js and chunks/) bundles the following packages.\n\n${notices.join(
      `\n${'-'.repeat(80)}\n\n`,
    )}`,
  )
}
