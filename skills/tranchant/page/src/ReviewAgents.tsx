import { activityOf } from './activity'
import type { ReviewAgent } from './domain'

/** Who a review agent is, in words: a lens's reviewer or a finding's verifier. */
function roleOf(name: string) {
  if (name.startsWith('rv-')) return `Reviewer · ${name.slice(3)}`
  if (name.startsWith('vf-')) return `Verifier · ${name.slice(3)}`
  return name
}

/** What the review's agents are doing: one line each, its last step. */
export function ReviewAgents({ agents }: { agents: readonly ReviewAgent[] }) {
  if (!agents.length) return null
  return (
    <section className="tr-agents" aria-label="Review agents">
      <ul>
        {agents.map((agent) => {
          const last = agent.steps.at(-1)
          return (
            <li
              key={agent.name}
              className={`tr-agent ${agent.running ? '' : 'tr-agent--ended'}`}
            >
              {agent.running ? (
                <span className="tr-spinner" aria-label="running" />
              ) : (
                <span
                  className={`tr-agent-dot ${agent.outcome === 'failed' ? 'tr-agent-dot--failed' : ''}`}
                  aria-label={agent.outcome === 'failed' ? 'stopped' : 'ended'}
                />
              )}
              <span className="tr-agent-name">{roleOf(agent.name)}</span>
              {last && <span className="tr-agent-step">{activityOf(last)}</span>}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
