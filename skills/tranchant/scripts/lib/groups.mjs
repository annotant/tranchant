// The groups of lenses of a project: named sets of lenses, one review
// running one (`/tranchant review --group <name>`, the Group select before
// Start). They lie in <settings folder>/projects/<project hash>/groups.json,
// beside the project's lenses: never in a repository. A lens in a group runs
// in its review whatever its switch; the default group is what a review runs
// with no --group, and with none, every lens that is on. Described in
// docs/settings.md.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './errors.mjs'
import { withFileLock } from './filelock.mjs'
import { LENS_NAME } from './format.mjs'
import { hashOf } from './project.mjs'
import { SETTINGS_DIR } from './settings.mjs'
import { writeJson } from './userlens.mjs'

/** @typedef {'local' | 'global' | 'recipe'} MemberScope */
/** A lens of a group: which one, by its scope and its name. @typedef {{ scope: MemberScope, name: string }} Member */
/**
 * A group as groups.json holds it; `removed`, the lenses removed since a
 * review of it last ran, which each review of it says until one runs.
 * @typedef {{ name: string, lenses: Member[], removed?: Member[] }} Group
 */
/** @typedef {{ default?: string, groups: Group[] }} Groups */

const GROUPS_VERSION = 1
const MAX_GROUPS = 100
const MAX_MEMBERS = 200
const SCOPES = new Set(['local', 'global', 'recipe'])
const MAX_NOTES = 8

/** A groups file, or a change to it, this Tranchant refuses, and why. */
export class GroupRefusal extends Error {}

/** @param {string} what @returns {never} */
const fail = (what) => {
  throw new GroupRefusal(what)
}

/** The project's groups file. */
export const groupsFile = (/** @type {string} */ project) =>
  path.join(SETTINGS_DIR, 'projects', hashOf(project), 'groups.json')

/** Whether `a` and `b` name the same lens. @param {Member} a @param {Member} b */
const same = (a, b) => a.scope === b.scope && a.name === b.name

/**
 * A list of lenses checked; `unique`, one per name, as a group's lenses are:
 * a finding's id starts with its lens's name.
 * @param {unknown} value
 * @param {string} where
 * @param {boolean} unique
 * @returns {Member[]}
 */
function checkMembers(value, where, unique) {
  if (!Array.isArray(value) || value.length > MAX_MEMBERS)
    return fail(`${where}: a list of ${MAX_MEMBERS} lenses at most`)
  const names = new Set()
  return value.map((one, i) => {
    const scope = one && typeof one === 'object' ? Reflect.get(one, 'scope') : undefined
    const name = one && typeof one === 'object' ? Reflect.get(one, 'name') : undefined
    if (!SCOPES.has(scope) || typeof name !== 'string' || !LENS_NAME.test(name))
      fail(`${where}[${i}]: { scope: local, global or recipe, name }`)
    if (unique && names.has(name))
      fail(`${where}: two lenses named ${name}, one lens per name in a group`)
    names.add(name)
    return { scope, name }
  })
}

/**
 * groups.json, checked.
 * @param {any} raw
 * @returns {Groups}
 */
function checkGroups(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('not an object')
  if (raw.version !== GROUPS_VERSION)
    fail(`version: ${GROUPS_VERSION} is the only one read`)
  if (!Array.isArray(raw.groups) || raw.groups.length > MAX_GROUPS)
    fail(`groups: a list of ${MAX_GROUPS} at most`)
  const taken = new Set()
  /** @type {Group[]} */
  const groups = raw.groups.map((/** @type {any} */ group, /** @type {number} */ i) => {
    if (
      !group ||
      typeof group !== 'object' ||
      typeof group.name !== 'string' ||
      !LENS_NAME.test(group.name)
    )
      fail(`groups[${i}].name: letters, digits, - and _ only, 40 at most`)
    if (taken.has(group.name)) fail(`groups: two groups named ${group.name}`)
    taken.add(group.name)
    const removed =
      group.removed === undefined
        ? []
        : checkMembers(group.removed, `groups[${i}].removed`, false)
    return {
      name: group.name,
      lenses: checkMembers(group.lenses, `groups[${i}].lenses`, true),
      ...(removed.length && { removed }),
    }
  })
  if (
    raw.default !== undefined &&
    (typeof raw.default !== 'string' || !taken.has(raw.default))
  )
    fail('default: the name of one of the groups')
  return { ...(raw.default !== undefined && { default: raw.default }), groups }
}

/**
 * The project's groups: none when there is no file; none too, with
 * `problem` saying why, when the file is not one this Tranchant reads, which
 * is then never written over.
 * @param {string} project
 * @returns {Promise<{ file: string, groups: Groups, problem?: string }>}
 */
export async function readGroups(project) {
  const file = groupsFile(project)
  /** @type {Groups} */
  const none = { groups: [] }
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return { file, groups: none }
    const code = errorCode(error)
    return {
      file,
      groups: none,
      problem: `${file} cannot be read (${typeof code === 'string' ? code : 'error'})`,
    }
  }
  try {
    return { file, groups: checkGroups(JSON.parse(text)) }
  } catch (error) {
    if (error instanceof SyntaxError)
      return { file, groups: none, problem: `${file} is not JSON` }
    if (error instanceof GroupRefusal)
      return { file, groups: none, problem: `${file}: ${error.message}` }
    throw error
  }
}

/**
 * `edit` applied to the groups as they stand, and written; `edit` answers
 * undefined when there is nothing to write. Refused while the file reads as
 * none.
 * @param {string} project
 * @param {(groups: Groups) => Groups | undefined} edit
 * @returns {Promise<Groups>}
 */
function change(project, edit) {
  // Locked across processes: the server, prepare.mjs and lenses.mjs all write it.
  return withFileLock(groupsFile(project), async () => {
    const { file, groups, problem } = await readGroups(project)
    if (problem) fail(`the groups are not changed: ${problem}`)
    const next = edit(structuredClone(groups))
    if (!next) return groups
    const checked = checkGroups({ version: GROUPS_VERSION, ...next })
    await writeJson(file, { version: GROUPS_VERSION, ...checked })
    return checked
  })
}

/**
 * Creates a group (`from` undefined) or changes the group named `from`: its
 * name and its lenses, at least one, one per name. Saved, a group forgets
 * the lenses removed from it since its last review: the person saw it as it
 * is.
 * @param {string} project
 * @param {string | undefined} from
 * @param {any} input `{ name, lenses: [{ scope, name }] }`
 */
export async function saveGroup(project, from, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail('the group is not an object')
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!LENS_NAME.test(name)) fail('name: letters, digits, - and _ only, 40 at most')
  const lenses = checkMembers(input.lenses, 'lenses', true)
  if (!lenses.length) fail('lenses: check at least one')
  return change(project, (groups) => {
    const at = from === undefined ? -1 : groups.groups.findIndex((g) => g.name === from)
    if (from !== undefined && at === -1) fail(`no group ${from}`)
    if (groups.groups.some((g, i) => g.name === name && i !== at))
      fail(`a group is already named ${name}`)
    if (at === -1) groups.groups.push({ name, lenses })
    else groups.groups[at] = { name, lenses }
    if (from !== undefined && groups.default === from) groups.default = name
    return groups
  })
}

/** Deletes a group; never its lenses. The default, when it was, is every lens that is on again. */
export function removeGroup(/** @type {string} */ project, /** @type {string} */ name) {
  return change(project, (groups) => {
    if (!groups.groups.some((g) => g.name === name)) fail(`no group ${name}`)
    groups.groups = groups.groups.filter((g) => g.name !== name)
    if (groups.default === name) delete groups.default
    return groups
  })
}

/** The group a review runs with no --group; `null`, every lens that is on. */
export function setDefaultGroup(
  /** @type {string} */ project,
  /** @type {string | null} */ name,
) {
  return change(project, (groups) => {
    if (name === null) delete groups.default
    else if (!groups.groups.some((g) => g.name === name)) fail(`no group ${name}`)
    else groups.default = name
    return groups
  })
}

/**
 * Applies `edit` to each group, when the file reads; answers the names of
 * the groups it changed. A file that does not read changes nothing: the lens
 * is changed all the same; once the file is mended, a review of the group
 * says the lens is gone.
 * @param {string} project
 * @param {(group: Group) => boolean} edit
 */
async function eachGroup(project, edit) {
  /** @type {string[]} */
  const names = []
  await change(project, (groups) => {
    for (const group of groups.groups) if (edit(group)) names.push(group.name)
    return names.length ? groups : undefined
  }).catch((error) => {
    if (!(error instanceof GroupRefusal)) throw error
  })
  return names
}

/** `member` recorded among a group's removed lenses, the latest kept. @param {Group} group @param {Member} member */
function noteRemoved(group, member) {
  group.removed = [...(group.removed ?? []), member].slice(-MAX_MEMBERS)
}

/**
 * A lens removed: out of every group of the project, each recording it for
 * its next review to say. Answers the groups it was in.
 * @param {string} project
 * @param {Member} member
 */
export function forgetLens(project, member) {
  return eachGroup(project, (group) => {
    if (!group.lenses.some((one) => same(one, member))) return false
    group.lenses = group.lenses.filter((one) => !same(one, member))
    noteRemoved(group, member)
    return true
  })
}

/**
 * A lens renamed or moved to another scope: the same lens in every group it
 * was in. A lens of its new name in such a group leaves it, recorded as
 * removed: one lens per name.
 * @param {string} project
 * @param {Member} from
 * @param {Member} to
 */
export function moveLens(project, from, to) {
  if (same(from, to)) return Promise.resolve([])
  return eachGroup(project, (group) => {
    if (!group.lenses.some((one) => same(one, from))) return false
    for (const twin of group.lenses.filter(
      (one) => one.name === to.name && !same(one, from),
    ))
      noteRemoved(group, twin)
    group.lenses = group.lenses.flatMap((one) =>
      same(one, from) ? [to] : one.name === to.name ? [] : [one],
    )
    return true
  })
}

/**
 * The switches of a review of group `name` saved in it: a lens turned off
 * leaves it, a lens turned on joins it in place of one of the same name.
 * Refused when no lens would be left.
 * @param {string} project
 * @param {string} name
 * @param {{ member: Member, on: boolean }[]} switches
 */
export function switchLenses(project, name, switches) {
  return change(project, (groups) => {
    const group = groups.groups.find((g) => g.name === name)
    if (!group) return fail(`no group ${name} in this project any more`)
    if (!switches.length) return undefined
    for (const { member, on } of switches) {
      group.lenses = group.lenses.filter((one) =>
        on ? one.name !== member.name : !same(one, member),
      )
      if (on) group.lenses.push(member)
    }
    if (!group.lenses.length)
      fail(`group ${name} would have no lens left: keep one on, or uncheck saving`)
    return groups
  })
}

/**
 * The lenses `said` forgotten among those removed from group `name`: a
 * review of the group ran, and said so. Every review planned before one
 * runs says them, a refused or a waiting one too. Nothing when the file does
 * not read.
 * @param {string} project
 * @param {string} name
 * @param {Member[]} said
 */
export async function forgetRemoved(project, name, said) {
  if (!said.length) return
  await change(project, (groups) => {
    const group = groups.groups.find((g) => g.name === name)
    if (!group?.removed) return undefined
    const left = group.removed.filter((one) => !said.some((two) => same(one, two)))
    if (left.length === group.removed.length) return undefined
    if (left.length) group.removed = left
    else delete group.removed
    return groups
  }).catch((error) => {
    if (!(error instanceof GroupRefusal)) throw error
  })
}

const SCOPE_WORDS = { local: "this project's", global: 'global', recipe: 'built-in' }

/**
 * What a review of `group` says of its lenses that do not run: those
 * removed since its last review, and those it names that are gone (a global
 * lens removed from another project, a recipe that changed).
 * @param {string} group
 * @param {Member[]} removed
 * @param {Member[]} missing
 */
export function groupNotes(group, removed, missing) {
  const notes = [
    ...removed.map(
      (one) =>
        `lens ${one.name} (${SCOPE_WORDS[one.scope]}) was removed: group ${group} runs without it`,
    ),
    ...missing.map(
      (one) =>
        `lens ${one.name} (${SCOPE_WORDS[one.scope]}) of group ${group} is gone: not run`,
    ),
  ]
  // A group emptied by many removals says so in a few lines, not hundreds.
  return notes.length > MAX_NOTES
    ? [
        ...notes.slice(0, MAX_NOTES - 1),
        `and ${notes.length - MAX_NOTES + 1} more lenses of group ${group} that do not run`,
      ]
    : notes
}
