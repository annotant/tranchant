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

/** A lens of a recipe, built: its instructions file and the files it reviews. */
export type Lens = {
  name: string
  /** The prompt lenses.mjs built, absolute: <state>/lenses/<sha256>.md. */
  prompt: string
  /** The changed files it reviews, or the globs they match. */
  paths: string[]
  /**
   * The model the lens asks for, `inherit` on Auto-detect when its source
   * names no Claude model: TRANCHANT_MODEL still wins, the settings' come after.
   */
  model?: string
  /** The topics its findings file under, when the recipe declares them. */
  topics?: string[]
}

/**
 * What waits for a free review agent: the agent summarizing the change, a
 * lens's reviewer, a finding's verifier, or the agent answering the
 * reviewer's question on a finding.
 */
export type ReviewJob =
  | { kind: 'summarizer' }
  /** `again`: queued again after Pause now, its findings so far landed. */
  | { kind: 'reviewer'; lens: Lens; again?: true }
  | { kind: 'verifier'; id: string }
  | { kind: 'discusser'; id: string }

/**
 * A review `/tranchant review` runs: the agents waiting for a free place, in
 * order, and the findings a verifier was queued for.
 */
export type ReviewRun = {
  queue: ReviewJob[]
  verifying: string[]
  /**
   * While lenses whose source changed are cleaned again: the plan the Lenses
   * step builds once they end, and their cleanings' folders still at work.
   */
  waiting?: { plan: string; cleanings: string[]; mode?: '--start' | '--replan' }
  /** Waiting for the page's Start the review: the plan lenses.mjs starts. */
  ready?: { plan: string }
  /** The page's Start or Build the lenses again at work: its plan, until lenses.mjs ends. */
  starting?: { plan: string }
  /** The page's Pause: no agent of the queue starts until Resume, and the review does not complete. */
  paused?: true
}

/**
 * An agent the hooks started for a review: the summary agent (`sm-summary`),
 * a lens's reviewer (`rv-<lens>`), a finding's verifier (`vf-<id>`) or the
 * agent discussing a finding (`ds-<id>`). `running` until its turn completes.
 */
export type ReviewAgent = {
  agent: string
  /** `sm-summary`, `rv-<lens>`, `vf-<id>` or `ds-<id>`: its run file's name, and its agent type's with the review's id. */
  name: string
  kind: 'summarizer' | 'reviewer' | 'verifier' | 'discusser'
  /** Its instructions file, absolute: its lens's, agents/review/summary.md, agents/review/verifier.md or agents/discuss.md. */
  prompt: string
  review: string
  project: string
  running: boolean
  since: number
  model?: string
  /** A reviewer's: the model its lens asks for, registered again after a reload. */
  lensModel?: string
  /** What started it: queued again from the start when Pause now ends it. */
  job?: ReviewJob
  /** TaskStop under way: still running, in its place; `turnEnded` once its turn's end came meanwhile. */
  stopping?: true
  turnEnded?: true
}

/**
 * A lens's cleaning (Add a lens, `/tranchant import`, a source that changed):
 * its agent, its folder in the state and the two files it alone may write.
 */
export type Cleaning = {
  agent: string
  /** `cl-` and the cleaning id's first 8 characters: its agent type's name. */
  name: string
  dir: string
  /** The lens it makes, or cleans again, and where that lens lives. */
  lens: string
  scope: string
  again: boolean
  source: string
  project: string
  /** The two files it writes: the lens's domain and its report. */
  writes: string[]
  running: boolean
}

/** A cleaning the page asked for, waiting for a free cleaning agent. */
export type QueuedCleaning = {
  project: string
  id: string
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
      /** With run: false waits for the page's Start, true starts at once; absent, the settings say. */
      start?: boolean
      /** A reviewer to add as a lens, cleaned first; empty, the project's are listed. */
      import?: string
      /** With import: `global` or `local`. */
      to?: string
      /** With import: the lens's name; absent, one from its source. */
      name?: string
      /** Removed: refused, as /tranchant import refuses --context. */
      context?: unknown
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
      /** When this session first served a review, in ms: a stuck agent noted before ended with an earlier session. */
      sessionSince: number
      /** By `<name>@<review folder>`: the review agents started, running or ended. */
      reviewAgents: Record<string, ReviewAgent>
      /** By review folder, the findings whose question waits for a free agent, in order. */
      discussing: Record<string, string[]>
      /** By cleaning folder: the cleanings started, running or ended. */
      cleaning: Record<string, Cleaning>
      /** The page's cleanings waiting for a free agent, in order: `maxReviewAgents` clean at a time. */
      cleanQueue: QueuedCleaning[]
    }
  }
}
