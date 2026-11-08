// What post.mjs and issue.mjs share: running glab or gh with a body on stdin,
// and the first line of what they said.
import { spawn } from 'node:child_process'

const TIMEOUT_MS = Number(process.env.TRANCHANT_TOOL_TIMEOUT_MS ?? 60_000)

// Built, not written: a control character in a regex literal fails the linter.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')

/** The tool's first line of error, without its colours or its update notice. */
export const firstLine = (/** @type {string} */ output) =>
  output
    .replaceAll(ANSI, '')
    .split('\n')
    .map((line) => line.trim())
    .find(
      (line) =>
        line !== '' &&
        !line.startsWith('[glab] Update available') &&
        !line.startsWith('A new release of gh is available'),
    ) ?? ''

/**
 * Runs `command` with `body` on stdin.
 * @param {string} command
 * @param {string[]} args
 * @param {string} body
 * @param {string | undefined} cwd
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string }>}
 */
export function runWithInput(command, args, body, cwd) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    // Posts and issues run one at a time: a tool that hangs would hold every one after it.
    const timer = setTimeout(() => {
      stderr = `${command} did not answer within ${TIMEOUT_MS / 1000} seconds`
      child.kill('SIGKILL')
    }, TIMEOUT_MS)
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => {
      clearTimeout(timer)
      const missing = /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT'
      resolve({
        code: null,
        stdout,
        stderr: missing
          ? `${command} is not installed, or not on the PATH`
          : String(error),
      })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
    child.stdin.on('error', () => undefined)
    child.stdin.end(body)
  })
}
