// The groups of lenses: named sets of lenses, one review running one
// (`/tranchant review --group <name>`, the Group select before Start). A
// group is a project's or global, chosen when it is made: a project's lies
// in the project's settings folder (lib/settings.mjs), with its default
// group, and holds any of its lenses; a global one lies in
// <settings folder>/groups.json, every project offers it, and it holds only
// global and built-in lenses. A lens in a group runs in its review whatever
// its switch; the default group is what a review runs with no --group, and
// with none, every lens that is on. Described in docs/settings.md.
import { readFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { errorCode } from './errors.mjs'
import { withFileLock } from './filelock.mjs'
import { LENS_NAME } from './format.mjs'
import { hashOf } from './project.mjs'
import { PROJECTS_DIR, SETTINGS_DIR, projectSettingsDir } from './settings.mjs'
import { writeJson } from './userlens.mjs'

/** @typedef {'local' | 'global' | 'recipe'} MemberScope */
/** A lens of a group: which one, by its scope and its name. @typedef {{ scope: MemberScope, name: string }} Member */
/**
 * A group as its file holds it; `removed`, the lenses removed since a
 * review of it last ran, which each review of it says until one runs.
 * @typedef {{ name: string, lenses: Member[], removed?: Member[] }} Group
 */
/** Where a group lies: the project's file, or the global one. @typedef {'local' | 'global'} GroupScope */
/** A group as a project sees it. @typedef {Group & { scope: GroupScope }} SeenGroup */
/** A groups file: the project's holds its default, which may name a global group. @typedef {{ default?: string, groups: Group[] }} Stored */
/** The groups as one project sees them: its own, then the global ones. @typedef {{ default?: string, groups: SeenGroup[] }} Groups */

const GROUPS_VERSION = 1
const MAX_GROUPS = 100
const MAX_MEMBERS = 200
const SCOPES = new Set(['local', 'global', 'recipe'])
const MAX_NOTES = 8

/** The global groups' file: every project's. */
export const GROUPS_FILE = path.join(SETTINGS_DIR, 'groups.json')

/** The groups file of the project at `project`: its groups and its default. */
export const groupsFile = (/** @type {string} */ project) =>
  path.join(projectSettingsDir(project), 'groups.json')

/** A groups file, or a change to it, this Tranchant refuses, and why. */
export class GroupRefusal extends Error {}

/** @param {string} what @returns {never} */
const fail = (what) => {
  throw new GroupRefusal(what)
}

/** Whether `a` and `b` name the same lens. @param {Member} a @param {Member} b */
const same = (a, b) => a.scope === b.scope && a.name === b.name

const KIND_WORDS = { local: "this project's", global: 'global' }

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

/** Refused when a global group would hold a project's lens. @param {string} where @param {Member[]} lenses */
function onlyShared(where, lenses) {
  const own = lenses.filter((one) => one.scope === 'local')
  if (own.length)
    fail(
      `${where}: a global group holds global and built-in lenses only, not ${own.map((one) => one.name).join(', ')} of a project`,
    )
}

/**
 * A groups file, checked: the project's (`local`) has its default, a
 * group's name, its own or a global one; the global one none, and none of
 * a project's lenses.
 * @param {any} raw
 * @param {GroupScope} scope
 * @returns {Stored}
 */
function checkGroups(raw, scope) {
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
    const lenses = checkMembers(group.lenses, `groups[${i}].lenses`, true)
    if (scope === 'global') onlyShared(`groups[${i}].lenses`, lenses)
    const removed =
      group.removed === undefined
        ? []
        : checkMembers(group.removed, `groups[${i}].removed`, false)
    return { name: group.name, lenses, ...(removed.length && { removed }) }
  })
  if (raw.default === undefined) return { groups }
  if (scope === 'global') fail('default: a project keeps its own, in its groups file')
  if (typeof raw.default !== 'string' || !LENS_NAME.test(raw.default))
    fail("default: the name of one of the project's groups or of a global one")
  return { default: raw.default, groups }
}

/**
 * A groups file as it stands: none when there is none; none too, with
 * `problem` saying why, when it is not one this Tranchant reads, which is
 * then never written over.
 * @param {string} file
 * @param {GroupScope} scope
 * @returns {Promise<{ stored: Stored, problem?: string }>}
 */
async function readStored(file, scope) {
  /** @type {Stored} */
  const none = { groups: [] }
  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT') return { stored: none }
    return {
      stored: none,
      problem: `${file} cannot be read (${typeof code === 'string' ? code : 'error'})`,
    }
  }
  try {
    return { stored: checkGroups(JSON.parse(text), scope) }
  } catch (error) {
    if (error instanceof SyntaxError)
      return { stored: none, problem: `${file} is not JSON` }
    if (error instanceof GroupRefusal)
      return { stored: none, problem: `${file}: ${error.message}` }
    throw error
  }
}

/** Whether `stored` holds a group named `name`. @param {Stored} stored @param {string} name */
const lies = (stored, name) => stored.groups.some((group) => group.name === name)

/** The file of the groups of `scope`, for the project at `project`. @param {string} project @param {GroupScope} scope */
const fileOf = (project, scope) => (scope === 'local' ? groupsFile(project) : GROUPS_FILE)

/** Whether two groups hold the same lenses, in any order. @param {Group} a @param {Group} b */
const sameLenses = (a, b) =>
  a.lenses.length === b.lenses.length &&
  a.lenses.every((one) => b.lenses.some((two) => same(one, two)))

/**
 * `group` among `stored`'s: the group of its name when it holds the same
 * lenses, else under its name and the first free `-2`, `-3`… Answers the
 * name it goes by: merging the same file twice adds nothing.
 * @param {Stored} stored
 * @param {Group} group
 */
function merge(stored, group) {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? '' : `-${n}`
    const name = `${group.name.slice(0, 40 - suffix.length)}${suffix}`
    const there = stored.groups.find((one) => one.name === name)
    if (!there) {
      stored.groups.push({ ...group, name })
      return name
    }
    if (sameLenses(there, group)) return name
  }
}

/** Why a file was not read or moved, in a few words. @param {unknown} error */
const why = (error) =>
  error instanceof SyntaxError
    ? 'not JSON'
    : error instanceof GroupRefusal
      ? error.message
      : String(errorCode(error) ?? error)

/**
 * The groups file of the project's own path, where Tranchant 0.9 kept it,
 * merged into the project's when both are there (lib/settings.mjs moves it
 * only when the project's has none: another worktree's came first), then
 * renamed `groups.json.moved`. Answers why it is not, when it is not.
 * @param {string} project
 * @returns {Promise<string[]>}
 */
async function adoptOld(project) {
  const file = groupsFile(project)
  const old = path.join(PROJECTS_DIR, hashOf(project), 'groups.json')
  if (old === file) return []
  let found
  try {
    found = checkGroups(JSON.parse(await readFile(old, 'utf8')), 'local')
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return []
    return [`${old} is not merged into ${file}: ${why(error)}`]
  }
  return withFileLock(file, async () => {
    const { stored, problem } = await readStored(file, 'local')
    // Said as the project's file's problem: merged once it is mended.
    if (problem) return []
    const names = new Map(found.groups.map((group) => [group.name, merge(stored, group)]))
    if (stored.default === undefined && found.default !== undefined)
      stored.default = names.get(found.default) ?? found.default
    let checked
    try {
      checked = checkGroups({ version: GROUPS_VERSION, ...stored }, 'local')
    } catch (error) {
      if (!(error instanceof GroupRefusal)) throw error
      return [`${old} is not merged into ${file}: ${error.message}`]
    }
    await writeJson(file, { version: GROUPS_VERSION, ...checked })
    /** @type {string[]} */
    const said = []
    // Left in place, it is merged again on each read: a group deleted since comes back.
    await rename(old, `${old}.moved`).catch((error) =>
      said.push(
        `${old} is merged into ${file} but cannot be renamed groups.json.moved (${why(error)}): rename it, or a group deleted comes back`,
      ),
    )
    return said
  })
}

/** Both groups files of the project at `project`, as they stand. @param {string} project */
async function readBoth(project) {
  const [local, global] = await Promise.all([
    readStored(groupsFile(project), 'local'),
    readStored(GROUPS_FILE, 'global'),
  ])
  return { local, global }
}

/**
 * The groups, as the project at `project` sees them: its own, then the
 * global ones, a global group of the name of one of its own hidden. None
 * while a file does not read, with `problem` saying why. `notes`, what the
 * page and a review say of them: a global group hidden, a default gone.
 * @param {string} project
 * @returns {Promise<{ file: string, local: string, groups: Groups, problem?: string, notes?: string[] }>}
 */
export async function readGroups(project) {
  // Merging never keeps the groups from being read: it says why, and tries again next time.
  const adopting = await adoptOld(project).catch((error) => [
    `the groups of this project's own path are not merged in (${String(errorCode(error) ?? error)})`,
  ])
  const { local, global } = await readBoth(project)
  const problem = [local.problem, global.problem].filter(Boolean).join('; ')
  // One file that does not read and none of the groups is: a default may name a group of either.
  if (problem)
    return {
      file: GROUPS_FILE,
      local: groupsFile(project),
      groups: { groups: [] },
      problem,
      ...(adopting.length && { notes: adopting }),
    }
  const own = new Set(local.stored.groups.map((group) => group.name))
  const notes = [...adopting]
  /** @type {SeenGroup[]} */
  const groups = [
    ...local.stored.groups.map((group) => ({
      ...group,
      scope: /** @type {const} */ ('local'),
    })),
    ...global.stored.groups.flatMap((group) => {
      if (!own.has(group.name))
        return [{ ...group, scope: /** @type {const} */ ('global') }]
      notes.push(
        `the global group ${group.name} is hidden here by this project's group of its name: rename one`,
      )
      return []
    }),
  ]
  let fallback = local.stored.default
  if (fallback !== undefined && !groups.some((group) => group.name === fallback)) {
    // A global group deleted or renamed in another project: its defaults elsewhere do not follow.
    notes.push(
      `the default group ${fallback} is gone: a review runs every lens that is on`,
    )
    fallback = undefined
  }
  return {
    file: GROUPS_FILE,
    local: groupsFile(project),
    groups: { ...(fallback !== undefined && { default: fallback }), groups },
    ...(notes.length && { notes }),
  }
}

/**
 * `edit` applied to the groups of one file as they stand, and written;
 * `edit` answers undefined when there is nothing to write. Refused while the
 * file reads as none.
 * @param {string} file
 * @param {GroupScope} scope
 * @param {(stored: Stored) => Stored | undefined} edit
 * @returns {Promise<Stored>}
 */
function change(file, scope, edit) {
  // Locked across processes: the server, prepare.mjs and lenses.mjs all write it.
  return withFileLock(file, async () => {
    const { stored, problem } = await readStored(file, scope)
    if (problem) fail(`the groups are not changed: ${problem}`)
    const next = edit(structuredClone(stored))
    if (!next) return stored
    const checked = checkGroups({ version: GROUPS_VERSION, ...next }, scope)
    await writeJson(file, { version: GROUPS_VERSION, ...checked })
    return checked
  })
}

/**
 * Where the group `name` lies, as the project at `project` sees it: its own
 * first. Refused when neither file reads, or none is of that name.
 * @param {string} project
 * @param {string} name
 * @param {string} [gone] What to say when there is none.
 * @returns {Promise<GroupScope>}
 */
async function scopeOf(project, name, gone = `no group ${name}`) {
  const { local, global } = await readBoth(project)
  if (local.stored.groups.some((group) => group.name === name)) return 'local'
  if (global.stored.groups.some((group) => group.name === name)) return 'global'
  return fail(local.problem ?? global.problem ?? gone)
}

/**
 * The project's default, when it names group `from`, renamed `to`, or none
 * with `to` undefined. A project's file that does not read is left: the
 * global group changed all the same, and the default reads as gone.
 * @param {string} project
 * @param {string} from
 * @param {string} [to]
 */
async function followDefault(project, from, to) {
  await change(groupsFile(project), 'local', (stored) => {
    if (stored.default !== from) return undefined
    if (to === undefined) delete stored.default
    else stored.default = to
    return stored
  }).catch((error) => {
    if (!(error instanceof GroupRefusal)) throw error
  })
}

/**
 * Creates a group (`from` undefined) or changes the group named `from`: its
 * name and its lenses, at least one, one per name. A group made says where
 * it lies, `local` or `global`, and keeps it: a global one holds no
 * project's lens. Its name is free among the project's groups and the
 * global ones. Saved, a group forgets the lenses removed from it since its
 * last review: the person saw it as it is. Renamed, it stays the project's
 * default when it was.
 * @param {string} project
 * @param {string | undefined} from
 * @param {any} input `{ name, scope, lenses: [{ scope, name }] }`
 */
export async function saveGroup(project, from, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail('the group is not an object')
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!LENS_NAME.test(name)) fail('name: letters, digits, - and _ only, 40 at most')
  if (input.scope !== undefined && input.scope !== 'local' && input.scope !== 'global')
    fail("scope: local (this project's) or global")
  const lenses = checkMembers(input.lenses, 'lenses', true)
  if (!lenses.length) fail('lenses: check at least one')
  const { local, global } = await readBoth(project)
  const problem = local.problem ?? global.problem
  if (problem) fail(`the groups are not changed: ${problem}`)
  /** @type {GroupScope} */
  let scope
  if (from === undefined) {
    if (input.scope === undefined) fail("scope: local (this project's) or global")
    scope = input.scope
  } else {
    scope = lies(local.stored, from) ? 'local' : 'global'
    if (!lies(local.stored, from) && !lies(global.stored, from)) fail(`no group ${from}`)
    if (input.scope !== undefined && input.scope !== scope)
      fail(`group ${from} is ${KIND_WORDS[scope]}: a group keeps where it was made`)
  }
  if (scope === 'global') onlyShared('lenses', lenses)
  const other = scope === 'local' ? global : local
  // A project's group hides a global one of its name: kept, it is saved; made or renamed so, refused.
  if (from !== name && lies(other.stored, name))
    fail(
      `a ${KIND_WORDS[scope === 'local' ? 'global' : 'local']} group is already named ${name}`,
    )
  const saved = await change(fileOf(project, scope), scope, (stored) => {
    const at = from === undefined ? -1 : stored.groups.findIndex((g) => g.name === from)
    if (from !== undefined && at === -1) fail(`no group ${from}`)
    if (stored.groups.some((g, i) => g.name === name && i !== at))
      fail(`a group is already named ${name}`)
    if (at === -1) stored.groups.push({ name, lenses })
    else stored.groups[at] = { name, lenses }
    if (scope === 'local' && from !== undefined && stored.default === from)
      stored.default = name
    return stored
  })
  if (scope === 'global' && from !== undefined && from !== name)
    await followDefault(project, from, name)
  return saved
}

/** Deletes a group; never its lenses. The project's default, when it was, is every lens that is on again. */
export async function removeGroup(
  /** @type {string} */ project,
  /** @type {string} */ name,
) {
  const scope = await scopeOf(project, name)
  await change(fileOf(project, scope), scope, (stored) => {
    if (!stored.groups.some((g) => g.name === name)) fail(`no group ${name}`)
    stored.groups = stored.groups.filter((g) => g.name !== name)
    if (stored.default === name) delete stored.default
    return stored
  })
  if (scope === 'global') await followDefault(project, name)
}

/** The group a review of the project at `project` runs with no --group; `null`, every lens that is on. */
export async function setDefaultGroup(
  /** @type {string} */ project,
  /** @type {string | null} */ name,
) {
  if (name !== null) await scopeOf(project, name)
  return change(groupsFile(project), 'local', (stored) => {
    if (name === null) delete stored.default
    else stored.default = name
    return stored
  })
}

/**
 * Applies `edit` to each group of one file, when it reads; answers the
 * names of the groups it changed. A file that does not read changes
 * nothing: the lens is changed all the same; once the file is mended, a
 * review of the group says the lens is gone.
 * @param {string} file
 * @param {GroupScope} scope
 * @param {(group: Group) => boolean} edit
 */
async function eachGroup(file, scope, edit) {
  /** @type {string[]} */
  const names = []
  await change(file, scope, (stored) => {
    for (const group of stored.groups) if (edit(group)) names.push(group.name)
    return names.length ? stored : undefined
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
 * A lens removed: out of the project's groups and, a global one, of the
 * global groups, each recording it for its next review to say. Answers the
 * groups it left. Another project's groups are not reached: a review of
 * one says the lens is gone.
 * @param {string} project
 * @param {Member} member
 */
export async function forgetLens(project, member) {
  const edit = (/** @type {Group} */ group) => {
    if (!group.lenses.some((one) => same(one, member))) return false
    group.lenses = group.lenses.filter((one) => !same(one, member))
    noteRemoved(group, member)
    return true
  }
  const own = await eachGroup(groupsFile(project), 'local', edit)
  if (member.scope === 'local') return own
  return [...own, ...(await eachGroup(GROUPS_FILE, 'global', edit))]
}

/**
 * A lens renamed or moved to another scope: the same lens in every group of
 * the project and every global group it was in; moved into the project, it
 * leaves the global groups, recorded as removed. A lens of its new name in
 * such a group leaves it, recorded as removed: one lens per name.
 * @param {string} project
 * @param {Member} from
 * @param {Member} to
 */
export async function moveLens(project, from, to) {
  if (same(from, to)) return []
  const follow = (/** @type {Group} */ group) => {
    if (!group.lenses.some((one) => same(one, from))) return false
    for (const twin of group.lenses.filter(
      (one) => one.name === to.name && !same(one, from),
    ))
      noteRemoved(group, twin)
    group.lenses = group.lenses.flatMap((one) =>
      same(one, from) ? [to] : one.name === to.name ? [] : [one],
    )
    return true
  }
  const leave = (/** @type {Group} */ group) => {
    if (!group.lenses.some((one) => same(one, from))) return false
    group.lenses = group.lenses.filter((one) => !same(one, from))
    noteRemoved(group, from)
    return true
  }
  const own = await eachGroup(groupsFile(project), 'local', follow)
  // A project's lens is in no global group: nothing there to follow.
  if (from.scope === 'local') return own
  return [
    ...own,
    ...(await eachGroup(GROUPS_FILE, 'global', to.scope === 'local' ? leave : follow)),
  ]
}

/**
 * The switches of a review of group `name` saved in it: a lens turned off
 * leaves it, a lens turned on joins it in place of one of the same name,
 * but a project's lens, which a global group never holds (the page says
 * so). Refused when no lens would be left.
 * @param {string} project
 * @param {string} name
 * @param {{ member: Member, on: boolean }[]} switches
 */
export async function switchLenses(project, name, switches) {
  const scope = await scopeOf(project, name, `no group ${name} any more`)
  const saved =
    scope === 'global'
      ? switches.filter(({ member, on }) => !on || member.scope !== 'local')
      : switches
  return change(fileOf(project, scope), scope, (stored) => {
    const group = stored.groups.find((g) => g.name === name)
    if (!group) return fail(`no group ${name} any more`)
    if (!saved.length) return undefined
    for (const { member, on } of saved) {
      group.lenses = group.lenses.filter((one) =>
        on ? one.name !== member.name : !same(one, member),
      )
      if (on) group.lenses.push(member)
    }
    if (!group.lenses.length)
      fail(`group ${name} would have no lens left: keep one on, or uncheck saving`)
    return stored
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
  try {
    const scope = await scopeOf(project, name)
    await change(fileOf(project, scope), scope, (stored) => {
      const group = stored.groups.find((g) => g.name === name)
      if (!group?.removed) return undefined
      const left = group.removed.filter((one) => !said.some((two) => same(one, two)))
      if (left.length === group.removed.length) return undefined
      if (left.length) group.removed = left
      else delete group.removed
      return stored
    })
  } catch (error) {
    if (!(error instanceof GroupRefusal)) throw error
  }
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
