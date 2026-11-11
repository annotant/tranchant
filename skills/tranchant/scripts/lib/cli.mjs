// What the agents' scripts share: the text on stdin, a question's arguments,
// and the discussion a run's end answers.
import { parseArgs } from 'node:util'
import { syncChange } from './discussion.mjs'
import { MAX_OPTIONS } from './store.mjs'

const MAX_LABEL = 80
const MAX_DESCRIPTION = 300

async function readStdin() {
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  return text
}

/**
 * The run of a change asked in finding `id`'s discussion ended: its result
 * lands there. A failure is said on stderr, never the script's: the run's
 * end is recorded, and the next sync (the hooks', the server's, the next
 * message's) lands it.
 * @param {string} dir
 * @param {string} id
 */
export async function closeDiscussion(dir, id) {
  try {
    await syncChange(dir, id)
  } catch (error) {
    console.error(
      `the discussion of ${id} is left waiting: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * A script's text argument, or the text piped on stdin when there is none.
 * @param {string | undefined} arg
 */
export const textOrStdin = async (arg) =>
  (arg ?? (process.stdin.isTTY ? '' : await readStdin())).trim()

/**
 * A question's arguments: its options, `--option "<label>: <description>"`
 * each (the description is optional), and `--multiple`; or what is wrong
 * with them.
 * @param {string[]} [argv]
 * @returns {{ problem: string } | { review?: string, args: string[], options: { label: string, description?: string }[], multiple: boolean }}
 */
export function questionArgs(argv = process.argv.slice(2)) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        review: { type: 'string' },
        option: { type: 'string', multiple: true },
        multiple: { type: 'boolean' },
      },
    })
  } catch (error) {
    // Its message says how to pass a text starting with "-".
    return { problem: error instanceof Error ? error.message : String(error) }
  }
  const { values, positionals } = parsed
  const options = (values.option ?? []).map((option) => {
    const split = option.indexOf(': ')
    const label = (split === -1 ? option : option.slice(0, split)).trim()
    const description = split === -1 ? '' : option.slice(split + 2).trim()
    return description
      ? {
          label: label.slice(0, MAX_LABEL),
          description: description.slice(0, MAX_DESCRIPTION),
        }
      : { label: label.slice(0, MAX_LABEL) }
  })
  const labels = new Set(options.map((option) => option.label))
  if (values.multiple && !options.length) return { problem: '--multiple needs options' }
  if (options.length === 1 || options.length > MAX_OPTIONS) {
    return { problem: `a question offers 2 to ${MAX_OPTIONS} options` }
  }
  if (labels.size !== options.length || labels.has('')) {
    return { problem: 'each option needs its own label' }
  }
  return {
    review: values.review,
    args: positionals,
    options,
    multiple: values.multiple ?? false,
  }
}
