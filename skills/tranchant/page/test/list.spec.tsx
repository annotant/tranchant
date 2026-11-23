import { render, screen, within } from '@testing-library/react'
import { expect, test } from 'vitest'
import { groupFindings } from '../src/domain'
import { FindingList } from '../src/FindingList'
import { FINDINGS } from './fixture'

test('a row names the lens that found its finding; one no lens found shows no chip', () => {
  const [first, second] = FINDINGS
  render(
    <FindingList
      groups={groupFindings([{ ...first!, lens: 'silent-failures' }, second!])}
      records={{}}
      cursor={undefined}
      openId={undefined}
      selected={new Set()}
      onOpen={() => {}}
      onToggle={() => {}}
    />,
  )
  const found = document.getElementById(`tr-option-${first!.id}`)!
  const chip = within(found).getByText('silent-failures')
  expect(chip.className).toBe('tr-chip tr-chip--lens')
  expect(chip.title).toBe('Found by the silent-failures lens')
  expect(screen.getAllByRole('option')).toHaveLength(2)
  expect(document.querySelectorAll('.tr-chip--lens')).toHaveLength(1)
})

test('a row’s title, cut by an ellipsis when long, shows whole on hover', () => {
  const [first] = FINDINGS
  render(
    <FindingList
      groups={groupFindings([first!])}
      records={{}}
      cursor={undefined}
      openId={undefined}
      selected={new Set()}
      onOpen={() => {}}
      onToggle={() => {}}
    />,
  )
  const row = document.getElementById(`tr-option-${first!.id}`)!
  expect(row.querySelector('.tr-item-title')?.getAttribute('title')).toBe(first!.title)
})
