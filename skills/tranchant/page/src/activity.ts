// How the page words a step of a run. Pure, so it is tested alone.
import { modelName, type Step } from './domain'

const RUNNING: Record<string, string> = {
  read: 'Reading',
  edit: 'Editing',
  write: 'Writing',
  bash: 'Running',
  search: 'Searching',
  tool: 'Using',
}

const DONE: Record<string, string> = {
  read: 'Read',
  edit: 'Edited',
  write: 'Wrote',
  bash: 'Ran',
  search: 'Searched',
  tool: 'Used',
}

/** A step in words: "Reading src/a.ts", "Ran pnpm test", "Started on opus". */
export function activityOf(step: Step): string {
  if (step.kind === 'start') {
    const started = step.state === 'running' ? 'Starting' : 'Started'
    return step.model ? `${started} on ${modelName(step.model)}` : started
  }
  if (step.kind === 'note' || step.kind === 'end') return step.label
  if (step.state === 'running') return `${RUNNING[step.kind] ?? 'Using'} ${step.label}`
  if (step.state === 'failed')
    return `${RUNNING[step.kind] ?? 'Using'} ${step.label} failed`
  return `${DONE[step.kind] ?? 'Used'} ${step.label}`
}

/** The step the spinner sits on: the latest one still running. */
export const runningStep = (steps: readonly Step[]) =>
  steps.findLast((step) => step.state === 'running')

// A step keeps its timestamp from running to done, so finishing it does not
// remount its row.
export const stepKey = (step: Step) => `${step.at}-${step.kind}-${step.label}`
