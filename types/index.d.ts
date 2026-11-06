// The values Tranchant's hooks module keeps in $.state for the session.

/**
 * The agent the hooks started for a finding's fix, the review folder it works
 * in and the model it runs on. `running` until its turn completes.
 */
export type Worker = {
  agent: string
  review: string
  project: string
  running: boolean
  /** When its agent started. */
  since?: number
  model?: string
}

/** A lens of a recipe: its instructions file and the path globs it applies to. */
export type Lens = {
  name: string
  /** Absolute, as prepare.mjs prints it (a recipe names it relative to itself). */
  prompt: string
  paths: string[]
}

/**
 * What waits for a free review agent: a lens's reviewer, a finding's
 * verifier, or the agent answering the reviewer's question on a finding.
 */
export type ReviewJob =
  | { kind: 'reviewer'; lens: Lens }
  | { kind: 'verifier'; id: string }
  | { kind: 'discusser'; id: string }

/**
 * A review `/tranchant review` runs: the agents waiting for a free place, in
 * order, and the findings a verifier was queued for.
 */
export type ReviewRun = {
  queue: ReviewJob[]
  verifying: string[]
}

/**
 * An agent the hooks started for a review: a lens's reviewer (`rv-<lens>`), a
 * finding's verifier (`vf-<id>`) or the agent discussing a finding
 * (`ds-<id>`). `running` until its turn completes.
 */
export type ReviewAgent = {
  agent: string
  /** `rv-<lens>`, `vf-<id>` or `ds-<id>`: its run file's name, and its agent type's with the review's id. */
  name: string
  kind: 'reviewer' | 'verifier' | 'discusser'
  /** Its instructions file, absolute: its lens's, agents/review/verifier.md or agents/discuss.md. */
  prompt: string
  review: string
  project: string
  running: boolean
  since: number
  model?: string
}

/** A review the hooks serve: its folder and the project it lies in. */
export type Served = {
  review: string
  project: string
}

declare module 'claude-code' {
  interface McpToolInputs {
    /**
     * The skill's way in: `review` is a review file to import and open, or a
     * review folder already imported; `stop` ends the server and every agent;
     * `status` says what runs; `run` reviews `target` (a branch, a merge
     * request url, or a folder starting with `.` or `/`, another repository
     * at its current branch; the current branch when absent) with `recipe`.
     */
    mcp__tranchant__open: {
      review?: string
      stop?: boolean
      status?: boolean
      run?: boolean
      target?: string
      recipe?: string
    }
  }
  interface PluginState {
    tranchant: {
      /** By finding id. */
      workers: Record<string, Worker>
      /**
       * The reviews `/tranchant` serves, by review folder: their servers die
       * with the module, and a reload starts them again.
       */
      serving: Record<string, Served>
      /**
       * By finding id, the decision an agent or a post last took, `<action>@<at>`:
       * a line about it again starts nothing. Kept until the session ends.
       */
      handed: Record<string, string>
      /** The reviews `/tranchant review` runs, by review folder, until they complete. */
      reviewRuns: Record<string, ReviewRun>
      /** By `<name>@<review folder>`: the review agents started, running or ended. */
      reviewAgents: Record<string, ReviewAgent>
      /** By review folder, the findings whose question waits for a free agent, in order. */
      discussing: Record<string, string[]>
    }
  }
}
