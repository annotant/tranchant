import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import App from '../src/App'
import type { FindingRecord, Ownership, State } from '../src/domain'
import { FindingDetail } from '../src/FindingDetail'
import { fakeServer, FINDINGS, payload, record, review } from './fixture'

const bug = FINDINGS[0]!

function renderDetail({
  ownership = 'ours',
  state = 'open',
  fields = {},
  disabled = false,
}: {
  ownership?: Ownership
  state?: State
  fields?: Partial<FindingRecord>
  disabled?: boolean
} = {}) {
  const onDecide = vi.fn()
  const onAnswer = vi.fn()
  const onStop = vi.fn()
  render(
    <FindingDetail
      review={review(ownership)}
      finding={bug}
      record={
        state === 'open' && !Object.keys(fields).length
          ? undefined
          : record(state, fields)
      }
      steps={[]}
      disabled={disabled}
      onDecide={onDecide}
      onAnswer={onAnswer}
      onStop={onStop}
    />,
  )
  return { onDecide, onAnswer, onStop }
}

const button = (name: string | RegExp) => screen.queryByRole('button', { name })

test("the excerpt is highlighted in the language of the finding's path", () => {
  renderDetail()
  const excerpt = screen.getByRole('figure', {
    name: 'Excerpt of src/people/usePeople.ts',
  })
  expect(
    excerpt.querySelector('.tr-row[data-line="42"] .tr-tok--storage')?.textContent,
  ).toBe('const')
})

test('ours offers Fix now, Drop and Skip, never a post', () => {
  renderDetail()
  expect(button('Fix now')).not.toBeNull()
  expect(button('Drop')).not.toBeNull()
  expect(button('Skip')).not.toBeNull()
  expect(button(/post/i)).toBeNull()
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
  const chip = document.querySelector('.tr-chip--failed:not(.tr-runs *)')
  expect(chip?.textContent).toBe('Needs you')
  expect(chip?.getAttribute('title')).toBe('The fix did not land')
  expect(
    [...document.querySelectorAll('.tr-runs .tr-chip')].map((one) => one.textContent),
  ).toEqual(['Fixed', 'Asked you', 'Did not land', 'Stopped', 'In progress'])
})
