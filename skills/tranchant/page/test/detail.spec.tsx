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
  Tracker,
} from '../src/domain'
import { FindingDetail } from '../src/FindingDetail'
import {
  fakeServer,
  FINDINGS,
  mergeRequest,
  payload,
  record,
  review,
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
}: {
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
      steps={[]}
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
