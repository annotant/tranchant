import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  entryPoints: ['src/main.tsx'],
  outfile: path.join(options.outdir, 'page.js'),
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
            for (const file of result.outputFiles) writeFileSync(file.path, file.contents)
            writeLicenses(result.metafile)
            console.log(`REBUILT ${buildOptions.outfile}`)
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
  writeLicenses((await build(buildOptions)).metafile)
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
      const licenseFile = readdirSync(dir).find((file) => /^licen[cs]e(\.|$)/i.test(file))
      if (!licenseFile) {
        throw new Error(`${pkg.name} is bundled but ships no license file`)
      }
      const text = readFileSync(path.join(dir, licenseFile), 'utf8').trim()
      return `${pkg.name} ${pkg.version} (${pkg.license})\n\n${text}\n`
    })
  writeFileSync(
    path.join(options.outdir, 'THIRD_PARTY_LICENSES.txt'),
    `The Tranchant page (page.js) bundles the following packages.\n\n${notices.join(
      `\n${'-'.repeat(80)}\n\n`,
    )}`,
  )
}
