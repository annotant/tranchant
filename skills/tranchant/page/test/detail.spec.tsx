import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import App from '../src/App'
import type {
  Discussion,
  FindingRecord,
  Ownership,
  Review,
  State,
  Step,
  Tracker,
} from '../src/domain'
import { FindingDetail } from '../src/FindingDetail'
import {
  fakeServer,
  FINDINGS,
  mergeRequest,
  payload,
  pullRequest,
  record,
  review,
  THREADED,
  withoutComment,
} from './fixture'

const bug = FINDINGS[0]!

function renderDetail({
  ownership = 'ours',
  state = 'open',
  fields = {},
  disabled = false,
  finding = bug,
  reviewFields = {},
  discussion,
  sent = true,
  tracker,
  steps = [],
}: {
  steps?: Step[]
  tracker?: Tracker
  discussion?: Discussion
  /** What the server answers a message. */
  sent?: boolean
  ownership?: Ownership
  state?: State
  fields?: Partial<FindingRecord>
  disabled?: boolean
  finding?: typeof bug
  reviewFields?: Partial<Review>
} = {}) {
  const onDecide = vi.fn()
  const onAnswer = vi.fn()
  const onStop = vi.fn()
  const onDiscuss = vi.fn(async () => sent)
  render(
    <FindingDetail
      review={review(ownership, reviewFields)}
      finding={finding}
      record={
        state === 'open' && !Object.keys(fields).length
          ? undefined
          : record(state, fields)
      }
      steps={steps}
      disabled={disabled}
      tracker={tracker}
      onDecide={onDecide}
      onAnswer={onAnswer}
      onStop={onStop}
      discussion={discussion}
      onDiscuss={onDiscuss}
    />,
  )
  return { onDecide, onAnswer, onStop, onDiscuss }
}

const button = (name: string | RegExp) => screen.queryByRole('button', { name })

test("the excerpt is highlighted in the language of the finding's path", () => {
  renderDetail()
  const excerpt = screen.getByRole('figure', {
    name: 'Excerpt of src/people/usePeople.ts',
  })
  expect(
    excerpt.querySelector('.tr-row[data-line="42"] .tr-tok--keyword')?.textContent,
  ).toBe('const')
})

test('problem, why and fix render as Markdown, without headings', () => {
  renderDetail({
    finding: {
      ...bug,
      problem: '# Not a heading',
      why: 'Plain words, no markup at all.',
      fix: [
        '## Guard `tenantId` first:',
        '- return early',
        '- then query',
        '```ts',
        'if (!tenantId) return',
        '```',
        'See [the hook](https://example.com/hook) and [run](javascript:alert(1)).',
      ].join('\n'),
    },
  })
  const [problem, why, fix] = Array.from(document.querySelectorAll('.tr-pwf dd'))
  expect(document.querySelector('.tr-pwf :is(h1, h2, h3, h4, h5, h6)')).toBeNull()
  expect(problem?.querySelector('strong')?.textContent).toBe('Not a heading')
  expect(fix?.querySelector('p strong code')?.textContent).toBe('tenantId')
  expect(why?.innerHTML).toBe(
    '<div class="tr-md"><p>Plain words, no markup at all.</p></div>',
  )
  expect(fix?.querySelector('p code')?.textContent).toBe('tenantId')
  expect(
    Array.from(fix?.querySelectorAll('ul li') ?? []).map((item) => item.textContent),
  ).toEqual(['return early', 'then query'])
  expect(fix?.querySelector('pre code')?.textContent).toBe('if (!tenantId) return')
  const links = Array.from(fix?.querySelectorAll('a') ?? [])
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    'https://example.com/hook',
  ])
  expect(links[0]?.getAttribute('target')).toBe('_blank')
  expect(links[0]?.getAttribute('rel')).toBe('noopener noreferrer')
  expect(fix?.textContent).toContain('run')
})

test('ours offers Fix now, Drop and Skip, never a post', () => {
  renderDetail()
  expect(button('Fix now')).not.toBeNull()
  expect(button('Drop')).not.toBeNull()
  expect(button('Skip')).not.toBeNull()
  expect(button(/post/i)).toBeNull()
})

test('ours with an MR offers Fix now first, and Post a comment as a regular button', () => {
  const { onDecide } = renderDetail({ reviewFields: { mr: mergeRequest() } })
  const fix = button('Fix now')!
  const post = button('Post a comment')!
  expect(fix.className).toContain('tr-btn--primary')
  expect(post.className).not.toContain('tr-btn--primary')
  expect(
    post.compareDocumentPosition(fix) & Node.DOCUMENT_POSITION_PRECEDING,
  ).toBeTruthy()
  expect(button('Post as written')).toBeNull()
  fireEvent.click(post)
  const box = screen.getByLabelText<HTMLTextAreaElement>('Comment to post')
  expect(box.value).toBe(bug.comment)
  fireEvent.click(button('Post')!)
  expect(onDecide).toHaveBeenLastCalledWith([{ id: 'f-01', action: 'post' }])
})

test('ours with an MR prefills a finding with no comment from its problem and fix', () => {
  const { onDecide } = renderDetail({
    reviewFields: { mr: mergeRequest() },
    finding: withoutComment(bug),
  })
  fireEvent.click(button('Post a comment')!)
  const box = screen.getByLabelText<HTMLTextAreaElement>('Comment to post')
  expect(box.value).toBe(`${bug.problem}\n\n${bug.fix}`)
  fireEvent.click(button('Post')!)
  expect(onDecide).toHaveBeenLastCalledWith([
    { id: 'f-01', action: 'post', comment: `${bug.problem}\n\n${bug.fix}` },
  ])
})

test('ours with an MR at another head disables posting, says why, and still fixes', () => {
  renderDetail({ reviewFields: { mr: mergeRequest('f'.repeat(40)) } })
  const post = button('Post a comment')!
  expect(post).toHaveProperty('disabled', true)
  const why = "push your branch first: the MR's head is not the one reviewed"
  expect(post.getAttribute('title')).toBe(why)
  expect(screen.getByText(/^Posting is off:/).textContent).toContain(why)
  expect(button('Fix now')).toHaveProperty('disabled', false)
})

test('theirs offers Post as written, Edit & post, Fix now and Drop', () => {
  renderDetail({ ownership: 'theirs' })
  expect(button('Post as written')).not.toBeNull()
  expect(button('Edit & post')).not.toBeNull()
  expect(button('Fix now')).not.toBeNull()
  expect(button('Drop')).not.toBeNull()
})

test('a fixed finding offers no Fix nor Drop, and shows the run summary and changed files', () => {
  renderDetail({
    state: 'fixed',
    fields: {
      runs: [
        {
          id: 'r1',
          model: 'claude-opus-5-5',
          startedAt: '2026-01-01T00:00:00Z',
          endedAt: '2026-01-01T00:01:00Z',
          outcome: 'fixed',
          summary: 'Returned early while tenantId is undefined.',
          changed: ['src/people/usePeople.ts'],
        },
      ],
    },
  })
  expect(button('Fix now')).toBeNull()
  expect(button('Add context for the fix')).toBeNull()
  expect(
    screen.getByText('Returned early while tenantId is undefined.', {
      selector: '.tr-outcome p',
    }),
  ).toBeDefined()
  expect(
    screen.getByText('src/people/usePeople.ts', { selector: '.tr-changed code' }),
  ).toBeDefined()
  expect(button('Drop')).toBeNull()
})

test('posted shows the discussion link; failed and dropped their reason', () => {
  render(
    <FindingDetail
      review={review('theirs')}
      finding={bug}
      record={record('posted', {
        posted: {
          discussionId: 'd1',
          url: 'https://gitlab.example/mr/1#note_1',
          at: 'now',
        },
      })}
      steps={[]}
      disabled={false}
      onDecide={vi.fn()}
      onAnswer={vi.fn()}
      onStop={vi.fn()}
      onDiscuss={vi.fn()}
    />,
  )
  expect(
    screen.getByRole('link', { name: 'https://gitlab.example/mr/1#note_1' }),
  ).toBeDefined()
  expect(button(/post/i)).toBeNull()
  cleanup()

  renderDetail({ state: 'failed', fields: { reason: 'glab: line not in diff' } })
  expect(screen.getByText('Failed: glab: line not in diff')).toBeDefined()
  expect(button('Fix now')).not.toBeNull()
  cleanup()

  renderDetail({ state: 'dropped', fields: { reason: 'intended' } })
  expect(screen.getByText('Dropped: intended')).toBeDefined()
  expect(button('Drop')).toBeNull()
})

const github: Tracker = { kind: 'github', web: 'https://github.com/acme/app', prefix: '' }

test('Open an issue prefills the title and body from the finding, and sends the edit', () => {
  const { onDecide } = renderDetail({ tracker: github })
  fireEvent.click(button('Open an issue')!)
  expect(onDecide).not.toHaveBeenCalled()
  const title = screen.getByLabelText<HTMLInputElement>('Issue title')
  const body = screen.getByLabelText<HTMLTextAreaElement>('Issue body')
  expect(title.value).toBe(bug.title)
  for (const part of [bug.problem, bug.why, bug.fix, ...bug.excerpt.lines])
    expect(body.value).toContain(part)
  const anchor = `${bug.path}:${bug.line}`
  expect(body.value).toContain(
    `[\`${anchor}\`](https://github.com/acme/app/blob/${review('ours').branch}/${bug.path}#L${bug.line})`,
  )
  fireEvent.change(title, { target: { value: '  Later: the crash  ' } })
  fireEvent.click(button('Open the issue')!)
  expect(onDecide).toHaveBeenLastCalledWith([
    { id: 'f-01', action: 'issue', title: 'Later: the crash', body: body.value.trim() },
  ])
})

test('an issue with an empty title cannot be opened; Cancel leaves the finding as it was', () => {
  const { onDecide } = renderDetail({ ownership: 'theirs' })
  fireEvent.click(button('Open an issue')!)
  fireEvent.change(screen.getByLabelText('Issue title'), { target: { value: ' ' } })
  expect(screen.getByPlaceholderText("The issue's title, one line")).toBeTruthy()
  expect(button('Open the issue')).toHaveProperty('disabled', true)
  fireEvent.click(button('Cancel')!)
  expect(screen.queryByLabelText('Issue title')).toBeNull()
  expect(onDecide).not.toHaveBeenCalled()
})

test('with no tracker, Open an issue is off and says why', () => {
  renderDetail({ tracker: { kind: null, reason: 'the project has no origin remote' } })
  const open = button('Open an issue')!
  expect(open).toHaveProperty('disabled', true)
  expect(open.getAttribute('title')).toContain('the project has no origin remote')
})

test('a finding moved to an issue shows its link, and is settled', () => {
  renderDetail({
    state: 'moved',
    fields: {
      issue: {
        title: 't',
        body: 'b',
        url: 'https://github.com/acme/app/issues/12',
        ref: '#12',
        at: 'now',
      },
    },
  })
  const link = screen.getByRole('link', { name: /issues\/12/ })
  expect(link.getAttribute('href')).toBe('https://github.com/acme/app/issues/12')
  expect(link.textContent).toContain('#12')
  for (const name of ['Fix now', 'Drop', 'Skip', 'Open an issue'])
    expect(button(name)).toBeNull()
})

test('Fix now sends the context when some was added', () => {
  const { onDecide } = renderDetail()
  fireEvent.click(button('Fix now')!)
  expect(onDecide).toHaveBeenLastCalledWith([{ id: 'f-01', action: 'fix' }])
  fireEvent.click(button('Add context for the fix')!)
  fireEvent.change(screen.getByLabelText('Context for the fix'), {
    target: { value: '  keep the early return  ' },
  })
  fireEvent.click(button('Fix now')!)
  expect(onDecide).toHaveBeenLastCalledWith([
    { id: 'f-01', action: 'fix', context: 'keep the early return' },
  ])
})

test('Drop asks for a reason inline and sends it', () => {
  const { onDecide } = renderDetail()
  fireEvent.click(button('Drop')!)
  expect(onDecide).not.toHaveBeenCalled()
  const reason = screen.getByLabelText('Reason for dropping')
  fireEvent.change(reason, { target: { value: 'intended' } })
  fireEvent.submit(reason.closest('form')!)
  expect(onDecide).toHaveBeenCalledWith([
    { id: 'f-01', action: 'drop', reason: 'intended' },
  ])
})

test('Post as written sends the comment as written; Edit & post sends the edit', () => {
  const { onDecide } = renderDetail({ ownership: 'theirs' })
  fireEvent.click(button('Post as written')!)
  expect(onDecide).toHaveBeenLastCalledWith([{ id: 'f-01', action: 'post' }])
  fireEvent.click(button('Edit & post')!)
  const box = screen.getByLabelText<HTMLTextAreaElement>('Comment to post')
  expect(box.value).toBe(bug.comment)
  fireEvent.change(box, { target: { value: 'Crashes before the query settles.' } })
  fireEvent.click(button('Post')!)
  expect(onDecide).toHaveBeenLastCalledWith([
    { id: 'f-01', action: 'post', comment: 'Crashes before the query settles.' },
  ])
})

test('while working, only Stop is offered', () => {
  const { onStop, onDecide } = renderDetail({ state: 'working' })
  expect(button('Fix now')).toBeNull()
  expect(button('Drop')).toBeNull()
  expect(button('Skip')).toBeNull()
  fireEvent.click(button('Stop')!)
  expect(onStop).toHaveBeenCalledWith('f-01')
  expect(onDecide).not.toHaveBeenCalled()
})

test('nothing is offered while the server is gone', () => {
  renderDetail({ disabled: true })
  expect(button('Fix now')).toBeNull()
  expect(button('Drop')).toBeNull()
  expect(button('Skip')).toBeNull()
})

test('the asking form posts the choice and the text to /api/answer', async () => {
  const server = fakeServer(
    payload({
      records: {
        'f-02': record('asking', {
          question: {
            text: 'Throw or return?',
            options: [
              { label: 'Throw' },
              { label: 'Return', description: 'as useFiles does' },
            ],
            multiple: false,
            at: '2026-01-01T00:00:00Z',
          },
        }),
      },
    }),
  )
  render(<App />)
  expect(await screen.findByText('Throw or return?')).toBeDefined()
  const answer = screen.getByRole('button', { name: 'Answer' })
  expect(answer).toHaveProperty('disabled', true)
  fireEvent.click(screen.getByRole('radio', { name: /Return/ }))
  fireEvent.change(screen.getByLabelText('Your answer'), {
    target: { value: ' like useFiles ' },
  })
  fireEvent.click(answer)
  await waitFor(() =>
    expect(server.posts).toEqual([
      {
        url: '/api/answer',
        body: { id: 'f-02', text: 'like useFiles', choices: ['Return'] },
      },
    ]),
  )
})

test('a multiple-choice question ticks several options', async () => {
  const server = fakeServer(
    payload({
      records: {
        'f-02': record('asking', {
          question: {
            text: 'Which files?',
            options: [{ label: 'guard.ts' }, { label: 'guard.test.ts' }],
            multiple: true,
            at: '2026-01-01T00:00:00Z',
          },
        }),
      },
    }),
  )
  render(<App />)
  fireEvent.click(await screen.findByRole('checkbox', { name: /guard\.ts/ }))
  fireEvent.click(screen.getByRole('checkbox', { name: /guard\.test\.ts/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Answer' }))
  await waitFor(() =>
    expect(server.posts).toEqual([
      {
        url: '/api/answer',
        body: { id: 'f-02', text: '', choices: ['guard.ts', 'guard.test.ts'] },
      },
    ]),
  )
})

const run = (id: string, outcome?: 'fixed' | 'asking' | 'failed' | 'stopped') => ({
  id,
  startedAt: '2026-01-01T00:00:00Z',
  ...(outcome && { outcome }),
})

test('the chip names the group and its title the state; runs end in human words', () => {
  renderDetail({
    state: 'failed',
    fields: {
      runs: [
        run('r1', 'fixed'),
        run('r2', 'asking'),
        run('r3', 'failed'),
        run('r4', 'stopped'),
        run('r5'),
      ],
    },
  })
  const chip = document.querySelector('.tr-chip--needs-you:not(.tr-runs *)')
  expect(chip?.textContent).toBe('Needs you')
  expect(chip?.getAttribute('title')).toBe('The fix, the post or the issue did not land')
  expect(
    [...document.querySelectorAll('.tr-runs .tr-chip')].map((one) => [
      one.textContent,
      one.className,
    ]),
  ).toEqual([
    ['Fixed', 'tr-chip tr-chip--done'],
    ['Asked you', 'tr-chip tr-chip--needs-you'],
    ['Did not land', 'tr-chip tr-chip--needs-you'],
    ['Stopped', 'tr-chip tr-chip--set-aside'],
    ['In progress', 'tr-chip tr-chip--in-progress'],
  ])
})

// A Record, so a new state fails to compile until it is given its family here.
const FAMILIES: Record<State, [string, string]> = {
  open: ['to-do', 'To do'],
  queued: ['in-progress', 'In progress'],
  working: ['in-progress', 'In progress'],
  asking: ['needs-you', 'Needs you'],
  failed: ['needs-you', 'Needs you'],
  fixed: ['done', 'Done'],
  posted: ['done', 'Done'],
  moved: ['done', 'Done'],
  dropped: ['set-aside', 'Set aside'],
  skipped: ['set-aside', 'Set aside'],
  stopped: ['set-aside', 'Set aside'],
}

const isState = (key: string): key is State => key in FAMILIES

test.each(Object.keys(FAMILIES).filter(isState))(
  'a %s finding wears its family',
  (state) => {
    const [family, label] = FAMILIES[state]
    renderDetail({ state })
    const chip = document.querySelector(`.tr-detail-meta .tr-chip--${family}`)
    expect(chip?.className).toBe(`tr-chip tr-chip--${family}`)
    expect(chip?.textContent).toBe(label)
  },
)

const asked = (text: string, at = '2026-11-06T10:00:00Z') =>
  ({ by: 'reviewer', text, at }) as const
const answered = (
  text: string,
  proposal?: Discussion['messages'][number]['proposal'],
): Discussion['messages'][number] => ({
  by: 'agent',
  text,
  at: '2026-11-06T10:01:00Z',
  ...(proposal && { proposal }),
})
const box = () => screen.getByRole('textbox', { name: 'Your message to the agent' })
const thread = () => screen.queryByRole('region', { name: 'Discussion' })

test('Discuss opens the thread: a suggestion fills the box, Enter sends it', async () => {
  const { onDiscuss, onDecide } = renderDetail()
  expect(thread()).toBeNull()
  const discuss = button('Discuss')!
  expect(discuss.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(discuss)
  expect(discuss.getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByText('Not sure about this finding?')).toBeDefined()
  expect(button('Send')).toHaveProperty('disabled', true)
  fireEvent.click(button('Is this really reachable?')!)
  expect(box()).toHaveProperty('value', 'Is this really reachable?')
  // Shift+Enter breaks the line; Enter sends.
  fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true })
  expect(onDiscuss).not.toHaveBeenCalled()
  fireEvent.keyDown(box(), { key: 'Enter' })
  expect(onDiscuss).toHaveBeenCalledWith('f-01', 'Is this really reachable?')
  expect(onDecide).not.toHaveBeenCalled()
  await waitFor(() => expect(box()).toHaveProperty('value', ''))
  // Discuss again folds the thread.
  fireEvent.click(discuss)
  expect(thread()).toBeNull()
})

test('a message the server refused stays in the box', async () => {
  renderDetail({ sent: false })
  fireEvent.click(button('Discuss')!)
  fireEvent.change(box(), { target: { value: 'Is it reachable?' } })
  fireEvent.click(button('Send')!)
  await waitFor(() => expect(button('Send')).toHaveProperty('disabled', false))
  expect(box()).toHaveProperty('value', 'Is it reachable?')
})

test('the thread shows by itself; while the agent answers, its step shows and the box waits', () => {
  renderDetail({
    discussion: {
      messages: [asked('Is it reachable?')],
      step: { at: 1, kind: 'read', label: 'src/people/usePeople.ts', state: 'running' },
    },
  })
  expect(thread()).not.toBeNull()
  expect(screen.getByText('Is it reachable?').className).toContain('tr-bubble--you')
  expect(screen.getByRole('status').textContent).toBe('Reading src/people/usePeople.ts')
  expect(box()).toHaveProperty('disabled', true)
  expect(box().getAttribute('placeholder')).toBe('The agent is answering…')
})

test("the agent's proposals carry over to a decision; the comment is edited in place", () => {
  const discussion: Discussion = {
    messages: [
      asked('Is it reachable?'),
      answered('Yes: **on mount**.', {
        fix: 'Guard in the hook.',
        comment: 'This crashes on mount.',
        drop: 'Not reachable.',
      }),
    ],
  }
  const { onDecide } = renderDetail({ discussion, ownership: 'theirs' })
  expect(screen.getByText('on mount').tagName).toBe('STRONG')
  fireEvent.click(button('Fix with this')!)
  expect(onDecide).toHaveBeenLastCalledWith([
    { id: 'f-01', action: 'fix', context: 'Guard in the hook.' },
  ])
  fireEvent.click(button('Drop with this reason')!)
  expect(onDecide).toHaveBeenLastCalledWith([
    { id: 'f-01', action: 'drop', reason: 'Not reachable.' },
  ])
  fireEvent.click(button('Post this')!)
  const editor = within(thread()!).getByRole('textbox', { name: 'Comment to post' })
  expect(editor).toHaveProperty('value', 'This crashes on mount.')
  fireEvent.change(editor, { target: { value: 'This crashes on first mount.' } })
  fireEvent.click(within(thread()!).getByRole('button', { name: 'Post' }))
  expect(onDecide).toHaveBeenLastCalledWith([
    { id: 'f-01', action: 'post', comment: 'This crashes on first mount.' },
  ])
  fireEvent.click(within(thread()!).getByRole('button', { name: 'Cancel' }))
  expect(button('Post this')).not.toBeNull()
})

test('a settled finding shows its thread read-only, and what was taken from it', () => {
  renderDetail({
    state: 'dropped',
    fields: { reason: 'Not reachable.' },
    discussion: {
      messages: [
        asked('Is it reachable?'),
        answered('No.', { fix: 'Guard.', drop: 'Not reachable.' }),
      ],
    },
  })
  expect(thread()).not.toBeNull()
  expect(button('Fix with this')).toBeNull()
  expect(screen.queryByRole('textbox', { name: 'Your message to the agent' })).toBeNull()
  expect(screen.getByText("You dropped it with the agent's reason")).toBeDefined()
  expect(
    screen.getByText('The finding is settled: the thread reads as it stands.'),
  ).toBeDefined()
})

test('a finding an agent works on keeps its thread read-only, for that reason', () => {
  renderDetail({
    state: 'queued',
    fields: { decision: { action: 'fix', context: 'Guard.', at: 'now' } },
    discussion: {
      messages: [asked('Is it reachable?'), answered('Yes.', { fix: 'Guard.' })],
    },
  })
  expect(
    screen.getByText('An agent is on the finding: the thread reads as it stands.'),
  ).toBeDefined()
  expect(screen.getByText("You sent it to fix with the agent's proposal")).toBeDefined()
})

test('an agent that ended without answering says so; Ask again sends the question again', () => {
  const { onDiscuss } = renderDetail({
    discussion: {
      messages: [
        asked('Why?'),
        {
          by: 'agent',
          text: 'The agent ended without answering: ask again.',
          at: '2026-11-06T10:01:00Z',
          failed: true,
        },
      ],
    },
  })
  expect(
    screen.getByText(/ended without answering/).closest('.tr-unanswered'),
  ).not.toBeNull()
  fireEvent.click(button('Ask again')!)
  expect(onDiscuss).toHaveBeenCalledWith('f-01', 'Why?')
  expect(box()).toBeDefined()
})

test('an issue that failed opens again as the reviewer wrote it', () => {
  renderDetail({
    state: 'failed',
    fields: {
      decision: { action: 'issue', at: 'now' },
      issue: { title: 'My words', body: 'My body' },
      reason: 'gh: HTTP 410',
    },
  })
  fireEvent.click(button('Open an issue')!)
  expect(screen.getByLabelText<HTMLInputElement>('Issue title').value).toBe('My words')
  expect(screen.getByLabelText<HTMLTextAreaElement>('Issue body').value).toBe('My body')
})

test('while its issue opens, the finding shows a spinner and offers nothing else', () => {
  renderDetail({
    state: 'queued',
    fields: {
      decision: { action: 'issue', at: 'now' },
      issue: { title: 'T', body: 'B' },
    },
    tracker: github,
  })
  expect(screen.getByRole('status').textContent).toBe(
    'Opening the issue on https://github.com/acme/app…',
  )
  expect(document.querySelector('.tr-pending .tr-spinner')).not.toBeNull()
  for (const name of ['Stop', 'Drop', 'Skip', 'Fix now', 'Open an issue'])
    expect(button(name)).toBeNull()
})

test('a thread shows its comments, yours marked, and is replied on, resolved if asked', () => {
  const { onDecide } = renderDetail({
    finding: THREADED,
    reviewFields: { mr: { ...pullRequest(), viewer: 'me' } },
  })
  expect(screen.getByText('@alice')).toBeDefined()
  expect(screen.getByText('missing', { selector: 'strong' })).toBeDefined()
  expect(screen.queryByText('Problem')).toBeNull()
  // Your own comment reads as yours; every choice stays.
  const mine = screen.getByText('Looking into it').closest('li')
  expect(mine?.className).toContain('tr-thread-comment--mine')
  expect(within(mine!).getByText('you')).toBeDefined()
  expect(screen.getByText('@alice').closest('li')?.className).not.toContain('--mine')
  for (const name of ['Fix now', 'Open an issue', 'Drop', 'Skip', 'Discuss'])
    expect(button(name)).not.toBeNull()
  // Fixing comes first; posting is a reply, never a comment of its own.
  expect(button('Fix now')?.className).toContain('tr-btn--primary')
  expect(button('Post a comment')).toBeNull()
  fireEvent.click(button('Reply on the thread')!)
  const reply = screen.getByLabelText<HTMLTextAreaElement>('Reply on the thread')
  expect(reply.value).toBe('')
  expect(button('Reply')?.hasAttribute('disabled')).toBe(true)
  fireEvent.change(reply, { target: { value: 'Done' } })
  fireEvent.click(screen.getByLabelText('Resolve the thread once replied'))
  fireEvent.click(button('Reply')!)
  expect(onDecide).toHaveBeenCalledWith([
    { id: THREADED.id, action: 'post', comment: 'Done', resolve: true },
  ])
  // The next reply starts afresh, unresolving.
  fireEvent.click(button('Reply on the thread')!)
  expect(screen.getByLabelText<HTMLTextAreaElement>('Reply on the thread').value).toBe('')
  expect(
    screen.getByLabelText<HTMLInputElement>('Resolve the thread once replied').checked,
  ).toBe(false)
})

test('a fixed thread offers its reply, drafted from what changed; a posted one shows it in the thread', () => {
  renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    state: 'fixed',
    fields: {
      runs: [{ id: 'r1', startedAt: '', outcome: 'fixed', summary: 'Skipped it.' }],
    },
  })
  fireEvent.click(button('Reply on the thread')!)
  expect(screen.getByLabelText<HTMLTextAreaElement>('Reply on the thread').value).toBe(
    'Fixed: Skipped it.',
  )
  cleanup()
  renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    state: 'posted',
    fields: {
      posted: {
        discussionId: 'PRRT_1',
        url: 'https://x.example/r',
        at: '',
        unresolved: 'no right',
      },
      replies: [{ text: 'Done in the next push', url: 'https://x.example/r', at: '' }],
    },
  })
  const sent = screen.getByText('Done in the next push').closest('li')
  expect(sent?.className).toContain('tr-thread-comment--mine')
  expect(within(sent!).getByText('Sent from Tranchant')).toBeDefined()
  expect(screen.getByText(/Unresolved on the pull request/)).toBeDefined()
  expect(screen.getByText('The thread is not resolved: no right')).toBeDefined()
  cleanup()
  // Resolved from here; a refresh that read the reply shows it once.
  renderDetail({
    finding: {
      ...THREADED,
      thread: {
        ...THREADED.thread!,
        comments: [
          ...THREADED.thread!.comments,
          {
            author: 'me',
            body: 'Done in the next push',
            at: '',
            url: 'https://x.example/r',
          },
        ],
      },
    },
    reviewFields: { mr: { ...pullRequest(), viewer: 'me' } },
    state: 'posted',
    fields: {
      posted: {
        discussionId: 'PRRT_1',
        url: 'https://x.example/r',
        at: '',
        resolved: true,
      },
      replies: [
        {
          text: 'Done in the next push',
          url: 'https://x.example/r',
          at: '',
          resolved: true,
        },
      ],
    },
  })
  expect(screen.getAllByText('Done in the next push')).toHaveLength(1)
  expect(screen.getByText(/Resolved on the pull request/)).toBeDefined()
})

test('a reply on a fixed thread shows while on its way, and why it failed', () => {
  renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    state: 'fixed',
    fields: { reply: { text: 'Fixed', at: '' } },
  })
  expect(screen.getByRole('status').textContent).toContain('Replying on the thread')
  expect(screen.getByRole('status').closest('li')?.textContent).toContain('Fixed')
  expect(button('Reply on the thread')).toBeNull()
  cleanup()
  renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    state: 'fixed',
    fields: {
      reply: { text: 'Fixed', at: '', failed: 'token expired' },
      posted: { discussionId: 'PRRT_1', url: 'https://x.example/first', at: '' },
    },
  })
  expect(
    screen.getByText('Did not post: token expired').closest('li')?.className,
  ).toContain('tr-thread-comment--failed')
  fireEvent.click(button('Reply on the thread')!)
  expect(screen.getByLabelText<HTMLTextAreaElement>('Reply on the thread').value).toBe(
    'Fixed',
  )
})

test('a thread is replied on while its fix runs and after a Stop, the fix left be', () => {
  const fix = { decision: { action: 'fix' as const, at: 'now' } }
  for (const state of ['queued', 'working', 'asking', 'stopped'] as const) {
    const { onDecide, onStop } = renderDetail({
      finding: THREADED,
      reviewFields: { mr: pullRequest() },
      state,
      fields:
        state === 'asking' ? { ...fix, question: { text: 'Which one?', at: '' } } : fix,
    })
    fireEvent.click(button('Reply on the thread')!)
    fireEvent.change(screen.getByLabelText('Reply on the thread'), {
      target: { value: 'On it' },
    })
    fireEvent.click(button('Reply')!)
    expect(onDecide).toHaveBeenCalledWith([
      { id: THREADED.id, action: 'post', comment: 'On it' },
    ])
    expect(onStop).not.toHaveBeenCalled()
    // Beside the fix: its Stop stays while it runs.
    if (state === 'queued' || state === 'working') expect(button('Stop')).not.toBeNull()
    cleanup()
  }
  // On its way, the reply holds the next one back; the fix runs on.
  renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    state: 'working',
    fields: { ...fix, reply: { text: 'On it', at: '' } },
  })
  expect(screen.getByRole('status').closest('li')?.textContent).toContain('On it')
  expect(button('Reply on the thread')).toBeNull()
  expect(button('Stop')).not.toBeNull()
  cleanup()
  // A post on its way is no fix: nothing beside it.
  renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    state: 'queued',
    fields: { decision: { action: 'post', at: 'now' }, comment: 'Done' },
  })
  expect(button('Reply on the thread')).toBeNull()
  cleanup()
  // A page that sends nothing offers no reply.
  renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    state: 'working',
    fields: fix,
    disabled: true,
  })
  expect(button('Reply on the thread')).toBeNull()
  cleanup()
  // Without its pull request, there is nothing to reply on.
  renderDetail({ finding: THREADED, state: 'working', fields: fix })
  expect(button('Reply on the thread')).toBeNull()
  cleanup()
  // Failed beside the fix, the reply is offered again, as written.
  renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    state: 'working',
    fields: { ...fix, reply: { text: 'On it', at: '', failed: 'token expired' } },
  })
  fireEvent.click(button('Reply on the thread')!)
  expect(screen.getByLabelText<HTMLTextAreaElement>('Reply on the thread').value).toBe(
    'On it',
  )
})

test("while a thread's fix runs, the agent's earlier reply is still offered, and only it", () => {
  const discussion: Discussion = {
    messages: [
      asked('Is she right?'),
      answered('Yes.', { fix: 'Show it.', comment: 'On it.', drop: 'Wrong.' }),
    ],
  }
  for (const state of ['queued', 'working', 'asking'] as const) {
    const { onDecide } = renderDetail({
      finding: THREADED,
      reviewFields: { mr: pullRequest() },
      state,
      fields: { decision: { action: 'fix', at: 'now' } },
      discussion,
    })
    expect(button('Fix with this')).toBeNull()
    expect(button('Drop with this reason')).toBeNull()
    fireEvent.click(button('Reply with this')!)
    expect(screen.getByLabelText<HTMLTextAreaElement>('Reply on the thread').value).toBe(
      'On it.',
    )
    expect(onDecide).not.toHaveBeenCalled()
    cleanup()
  }
  // Dropped, the thread reads as it stands: no reply is carried over from it.
  renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    state: 'dropped',
    fields: { decision: { action: 'drop', at: 'now' } },
    discussion,
  })
  expect(button('Reply with this')).toBeNull()
})

test("on a thread, the agent's comment is a reply, opened in the editor; a replied thread is still discussed", () => {
  const discussion: Discussion = {
    messages: [
      asked('Is she right?'),
      answered('Yes.', { fix: 'Show the reason.', comment: 'You are right, fixing it.' }),
    ],
  }
  const { onDecide } = renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    state: 'posted',
    fields: { posted: { discussionId: 'PRRT_1', url: 'https://x.example/r', at: '' } },
    discussion,
  })
  // Replied on, the thread lives on: the composer is open, Fix is not offered any more.
  expect(
    within(thread()!).getByRole('textbox', { name: /message to the agent/i }),
  ).toBeDefined()
  expect(button('Fix with this')).toBeNull()
  expect(button('Post this')).toBeNull()
  fireEvent.click(button('Reply with this')!)
  const editor = screen.getByLabelText<HTMLTextAreaElement>('Reply on the thread')
  expect(editor.value).toBe('You are right, fixing it.')
  expect(onDecide).not.toHaveBeenCalled()
})

test("on a thread, the agent's reply is taken once: a note after it is sent, offered again by a later answer", () => {
  const proposed = 'You are right, fixing it.'
  const edited = `${proposed} Thanks!`
  const from = '2026-11-06T10:01:00Z'
  const first: Discussion = {
    messages: [asked('Is she right?'), answered('Yes.', { comment: proposed })],
  }
  const posted = { discussionId: 'PRRT_1', url: 'https://x.example/r', at: '' }
  const sent = [{ text: edited, url: 'https://x.example/2', at: '', proposal: from }]
  const replied = "You replied with the agent's proposal"
  const onDecide = vi.fn()
  const detail = (fields: Partial<FindingRecord>, discussion = first) => (
    <FindingDetail
      review={review('ours', { mr: pullRequest() })}
      finding={THREADED}
      record={record('posted', { posted, ...fields })}
      steps={[]}
      disabled={false}
      onDecide={onDecide}
      onAnswer={vi.fn()}
      onStop={vi.fn()}
      discussion={discussion}
      onDiscuss={vi.fn(async () => true)}
    />
  )
  const { rerender } = render(detail({}))
  fireEvent.click(button('Reply with this')!)
  // The editor holds the proposal: the card is gone from under it.
  expect(button('Reply with this')).toBeNull()
  const editor = screen.getByLabelText<HTMLTextAreaElement>('Reply on the thread')
  fireEvent.change(editor, { target: { value: edited } })
  fireEvent.click(button('Reply')!)
  expect(onDecide).toHaveBeenCalledWith([
    { id: THREADED.id, action: 'post', comment: edited, proposal: from },
  ])
  // Changed before it was sent, it is still the proposal taken: on its way, then posted.
  rerender(detail({ reply: { text: edited, proposal: from, at: '' } }))
  expect(button('Reply with this')).toBeNull()
  expect(screen.getByText(replied)).toBeDefined()
  rerender(detail({ replies: sent }))
  expect(button('Reply with this')).toBeNull()
  expect(screen.getByText(replied)).toBeDefined()
  // Failed, it is offered again.
  rerender(
    detail({ reply: { text: edited, proposal: from, at: '', failed: 'token expired' } }),
  )
  expect(button('Reply with this')).not.toBeNull()
  expect(screen.queryByText(replied)).toBeNull()
  // A later answer proposes another reply: it is offered again.
  rerender(
    detail(
      { replies: sent },
      {
        messages: [
          ...first.messages,
          asked('And the tests?'),
          {
            ...answered('Missing.', { comment: 'Adding a test.' }),
            at: '2026-11-06T10:03:00Z',
          },
        ],
      },
    ),
  )
  expect(button('Reply with this')).not.toBeNull()
  expect(screen.queryByText(replied)).toBeNull()
  cleanup()
  // Mounted again, from the files: by the proposal it carries, or by its text.
  for (const replies of [
    sent,
    [{ text: proposed, url: 'https://x.example/2', at: '' }],
  ]) {
    renderDetail({
      finding: THREADED,
      reviewFields: { mr: pullRequest() },
      state: 'posted',
      fields: { posted, replies },
      discussion: first,
    })
    expect(button('Reply with this')).toBeNull()
    expect(screen.getByText(replied)).toBeDefined()
    cleanup()
  }
})

test("on a thread, a reply written by hand after the proposal was cancelled is the reviewer's own", () => {
  const { onDecide } = renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    state: 'posted',
    fields: { posted: { discussionId: 'PRRT_1', url: 'https://x.example/r', at: '' } },
    discussion: {
      messages: [asked('Is she right?'), answered('Yes.', { comment: 'You are right.' })],
    },
  })
  fireEvent.click(button('Reply with this')!)
  fireEvent.click(button('Cancel')!)
  fireEvent.click(button('Reply on the thread')!)
  // Opened by hand, the proposal is still offered beside the editor.
  expect(button('Reply with this')).not.toBeNull()
  const editor = screen.getByLabelText<HTMLTextAreaElement>('Reply on the thread')
  fireEvent.change(editor, { target: { value: 'My own words.' } })
  fireEvent.click(button('Reply')!)
  expect(onDecide).toHaveBeenCalledWith([
    { id: THREADED.id, action: 'post', comment: 'My own words.' },
  ])
})

test('a reply on its way is only in the thread: no agent to wait for, nothing else to decide', () => {
  renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    state: 'queued',
    fields: { decision: { action: 'post', at: '' }, comment: 'On it' },
  })
  expect(screen.getByRole('status').closest('li')?.textContent).toContain('On it')
  expect(screen.queryByText(/Waiting for an agent/)).toBeNull()
  for (const name of ['Stop', 'Drop', 'Skip', 'Reply on the thread'])
    expect(button(name)).toBeNull()
  cleanup()
  renderDetail({
    ownership: 'theirs',
    reviewFields: { mr: mergeRequest() },
    state: 'queued',
    fields: { decision: { action: 'post', at: '' } },
  })
  expect(screen.getByRole('status').textContent).toBe('Posting on the merge request…')
  expect(button('Stop')).toBeNull()
})

const CHANGE_AT = '2026-11-06T10:02:00Z'
const changeAsked = (text: string, at = CHANGE_AT) =>
  ({ by: 'reviewer', text, at, change: true }) as const
const changing = (fields: Partial<FindingRecord> = {}): Partial<FindingRecord> => ({
  decision: {
    action: 'fix',
    context: 'Fix it like that',
    change: CHANGE_AT,
    at: CHANGE_AT,
  },
  runs: [{ id: 'r1', startedAt: CHANGE_AT }],
  ...fields,
})

test('on a thread, Change asks the agents for a change, Enter only ever a question; elsewhere none is offered', async () => {
  const { onDiscuss } = renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    discussion: { messages: [asked('Is it right?'), answered('Yes: it crashes.')] },
  })
  fireEvent.change(box(), { target: { value: 'Fix it like that' } })
  fireEvent.click(within(thread()!).getByRole('button', { name: 'Change' }))
  await waitFor(() =>
    expect(onDiscuss).toHaveBeenCalledWith(THREADED.id, 'Fix it like that', true),
  )
  expect(screen.getByText(/Change has an agent make it/)).toBeDefined()
  cleanup()
  renderDetail({
    discussion: { messages: [asked('Is it right?'), answered('Yes: it crashes.')] },
  })
  expect(within(thread()!).queryByRole('button', { name: 'Change' })).toBeNull()
})

test('a change under way shows its step live and Stop; its question is answered in the thread', () => {
  const { onStop } = renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    state: 'working',
    fields: changing(),
    discussion: {
      messages: [
        asked('Is it right?'),
        answered('Yes.'),
        changeAsked('Fix it like that'),
      ],
    },
    steps: [{ at: 1, kind: 'edit', label: 'src/people/usePeople.ts', state: 'running' }],
  })
  const discussion = thread()!
  expect(within(discussion).getByText('Change asked')).toBeDefined()
  expect(within(discussion).getByRole('status').textContent).toBe(
    'Editing src/people/usePeople.ts',
  )
  expect(
    within(discussion).getByText('An agent is making the change: Stop ends it.'),
  ).toBeDefined()
  expect(screen.queryByRole('textbox', { name: 'Your message to the agent' })).toBeNull()
  fireEvent.click(within(discussion).getByRole('button', { name: 'Stop' }))
  expect(onStop).toHaveBeenCalledWith(THREADED.id)
  cleanup()

  const { onAnswer } = renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    state: 'asking',
    fields: changing({
      question: {
        text: 'Which test file?',
        options: [{ label: 'usePeople.test.ts' }, { label: 'people.test.ts' }],
        at: '2026-11-06T10:03:00Z',
      },
    }),
    discussion: {
      messages: [
        changeAsked('Fix it like that'),
        {
          by: 'agent',
          text: 'Which test file?',
          at: '2026-11-06T10:03:00Z',
          runs: ['r1'],
          outcome: 'asking',
        },
      ],
    },
  })
  // Asked once, in the thread: the outcome does not ask it again.
  expect(screen.getAllByRole('form', { name: 'Answer the agent' })).toHaveLength(1)
  const form = within(thread()!).getByRole('form', { name: 'Answer the agent' })
  fireEvent.click(within(form).getByLabelText(/usePeople\.test\.ts/))
  fireEvent.click(within(form).getByRole('button', { name: 'Answer' }))
  expect(onAnswer).toHaveBeenCalledWith(THREADED.id, '', ['usePeople.test.ts'])
})

test('a change made shows what changed, its own run; a follow-up on the fixed finding is a new change', async () => {
  const fetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ files: [{ path: 'src/a.ts', since: [] }], diff: '' }),
        {
          status: 200,
        },
      ),
  )
  vi.stubGlobal('fetch', fetch)
  try {
    const { onDiscuss } = renderDetail({
      finding: THREADED,
      reviewFields: { mr: pullRequest() },
      state: 'fixed',
      fields: changing({
        runs: [
          {
            id: 'r1',
            startedAt: CHANGE_AT,
            outcome: 'fixed',
            summary: 'Kept the early return.',
          },
        ],
      }),
      discussion: {
        messages: [
          changeAsked('Fix it like that'),
          {
            by: 'agent',
            text: 'Kept the early return.',
            at: '2026-11-06T10:05:00Z',
            runs: ['r1'],
            outcome: 'fixed',
          },
        ],
      },
    })
    const discussion = thread()!
    expect(within(discussion).getByText('Changed in the working tree')).toBeDefined()
    fireEvent.click(within(discussion).getByRole('button', { name: 'View changes' }))
    await within(discussion).findByRole('region', { name: 'Changes of the fix' })
    expect(fetch).toHaveBeenCalledWith(
      `/api/changes/${THREADED.id}?run=r1`,
      expect.anything(),
    )
    fireEvent.change(box(), { target: { value: 'Now the test' } })
    fireEvent.click(within(discussion).getByRole('button', { name: 'Change' }))
    await waitFor(() =>
      expect(onDiscuss).toHaveBeenCalledWith(THREADED.id, 'Now the test', true),
    )
  } finally {
    vi.unstubAllGlobals()
  }
})

test('a change that went no further says why, and Try again asks for it again', async () => {
  const { onDiscuss } = renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    state: 'stopped',
    fields: changing({ cancellation: { at: '', changed: [], steps: 0 } }),
    discussion: {
      messages: [
        changeAsked('Fix it like that'),
        {
          by: 'agent',
          text: 'You stopped the change.',
          at: '2026-11-06T10:05:00Z',
          outcome: 'stopped',
          failed: true,
        },
      ],
    },
  })
  expect(within(thread()!).getByText('You stopped the change.')).toBeDefined()
  expect(button('Ask again')).toBeNull()
  fireEvent.click(button('Try again')!)
  await waitFor(() =>
    expect(onDiscuss).toHaveBeenCalledWith(THREADED.id, 'Fix it like that', true),
  )
})

test('Try again after an answered question asks for the change, never the answer', async () => {
  const { onDiscuss } = renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    state: 'stopped',
    fields: changing({ cancellation: { at: '', changed: [], steps: 0 } }),
    discussion: {
      messages: [
        changeAsked('Fix it like that'),
        {
          by: 'agent',
          text: 'Which file?',
          at: '2026-11-06T10:03:00Z',
          outcome: 'asking',
        },
        changeAsked('usePeople.ts', '2026-11-06T10:04:00Z'),
        {
          by: 'agent',
          text: 'You stopped the change.',
          at: '2026-11-06T10:05:00Z',
          outcome: 'stopped',
          failed: true,
        },
      ],
    },
  })
  expect(within(thread()!).getByText('Your answer')).toBeDefined()
  fireEvent.click(button('Try again')!)
  await waitFor(() =>
    expect(onDiscuss).toHaveBeenCalledWith(THREADED.id, 'Fix it like that', true),
  )
})

test("a change's question not in the thread yet is answered in the outcome; a result not landed holds nothing", async () => {
  renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    state: 'asking',
    fields: changing({ question: { text: 'Which test file?', at: CHANGE_AT } }),
    discussion: { messages: [changeAsked('Fix it like that')] },
  })
  expect(screen.getByRole('form', { name: 'Answer the agent' })).toBeDefined()
  expect(screen.getByText('Which test file?')).toBeDefined()
  cleanup()

  // Fixed, its result never landed: the next message goes, and the server lands it first.
  const { onDiscuss } = renderDetail({
    finding: THREADED,
    reviewFields: { mr: pullRequest() },
    state: 'fixed',
    fields: changing({
      runs: [{ id: 'r1', startedAt: CHANGE_AT, outcome: 'fixed', summary: 'Done.' }],
    }),
    discussion: { messages: [changeAsked('Fix it like that')] },
  })
  expect(within(thread()!).queryByRole('status')).toBeNull()
  fireEvent.change(box(), { target: { value: 'Now the test' } })
  fireEvent.click(within(thread()!).getByRole('button', { name: 'Change' }))
  await waitFor(() =>
    expect(onDiscuss).toHaveBeenCalledWith(THREADED.id, 'Now the test', true),
  )
})
