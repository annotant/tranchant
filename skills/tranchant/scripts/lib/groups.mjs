// The groups of lenses: named sets of lenses, one review running one
// (`/tranchant review --group <name>`, the Group select before Start). They
// are the user's, not a project's: one file, <settings folder>/groups.json,
// that every project offers; only the default group is a project's, by its
// key (lib/settings.mjs). A lens in a group runs in its review whatever its
// switch; the default group is what a review runs with no --group, and with
// none, every lens that is on. The groups.json of each project folder, where
// they lay before, is moved into it. Described in docs/settings.md.
import { access, readFile, readdir, rename } from 'node:fs/promises'
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
 * A group as groups.json holds it; `removed`, the lenses removed since a
 * review of it last ran, which each review of it says until one runs.
 * @typedef {{ name: string, lenses: Member[], removed?: Member[] }} Group
 */
/** The groups as one project sees them: its default among them. @typedef {{ default?: string, groups: Group[] }} Groups */
/** groups.json: the groups, and by project key the project's default. @typedef {{ defaults: Record<string, string>, groups: Group[] }} Stored */

const GROUPS_VERSION = 1
const MAX_GROUPS = 100
const MAX_MEMBERS = 200
const SCOPES = new Set(['local', 'global', 'recipe'])
const MAX_NOTES = 8
const PROJECT_KEY = /^[0-9a-f]{12}$/

/** The groups file: every project's. */
export const GROUPS_FILE = path.join(SETTINGS_DIR, 'groups.json')

/** A project folder's groups.json, once moved into GROUPS_FILE: kept, never read again. */
const MOVED = '.moved'

/** A groups file, or a change to it, this Tranchant refuses, and why. */
export class GroupRefusal extends Error {}

/** @param {string} what @returns {never} */
const fail = (what) => {
  throw new GroupRefusal(what)
}

/** The key the project at `root` keeps its default group under: its settings folder's name. */
const keyOf = (/** @type {string} */ root) => path.basename(projectSettingsDir(root))

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
 * The groups of a groups file, checked, and the names they take.
 * @param {any} raw
 * @returns {{ groups: Group[], taken: Set<string> }}
 */
function checkList(raw) {
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
  return { groups, taken }
}

/**
 * groups.json, checked.
 * @param {any} raw
 * @returns {Stored}
 */
function checkGroups(raw) {
  const { groups, taken } = checkList(raw)
  const defaults = raw.defaults ?? {}
  if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults))
    fail('defaults: by project key, the name of one of the groups')
  for (const [key, name] of Object.entries(defaults))
    if (!PROJECT_KEY.test(key) || typeof name !== 'string' || !taken.has(name))
      fail(`defaults.${key}: the name of one of the groups`)
  return { defaults: { ...defaults }, groups }
}

/**
 * A project folder's groups.json, as Tranchant 0.9 and before wrote it:
 * its default the project's own.
 * @param {any} raw
 * @returns {Groups}
 */
function checkOld(raw) {
  const { groups, taken } = checkList(raw)
  if (
    raw.default !== undefined &&
    (typeof raw.default !== 'string' || !taken.has(raw.default))
  )
    fail('default: the name of one of the groups')
  return { ...(raw.default !== undefined && { default: raw.default }), groups }
}

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

/** The groups file as it stands: none when there is none. @returns {Promise<{ stored: Stored, problem?: string }>} */
async function readStored() {
  /** @type {Stored} */
  const none = { defaults: {}, groups: [] }
  let text
  try {
    text = await readFile(GROUPS_FILE, 'utf8')
  } catch (error) {
    const code = errorCode(error)
    if (code === 'ENOENT') return { stored: none }
    return {
      stored: none,
      problem: `${GROUPS_FILE} cannot be read (${typeof code === 'string' ? code : 'error'})`,
    }
  }
  try {
    return { stored: checkGroups(JSON.parse(text)) }
  } catch (error) {
    if (error instanceof SyntaxError)
      return { stored: none, problem: `${GROUPS_FILE} is not JSON` }
    if (error instanceof GroupRefusal)
      return { stored: none, problem: `${GROUPS_FILE}: ${error.message}` }
    throw error
  }
}

/**
 * The project folders' groups.json moved into GROUPS_FILE, their groups
 * merged by name and their default kept for their project; each renamed
 * `groups.json.moved` once written. Answers why those it could not move
 * stay where they are: the page says so.
 * @returns {Promise<string[]>}
 */
async function moveOld() {
  /** @type {string[]} */
  let folders
  try {
    folders = await readdir(PROJECTS_DIR)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return []
    return [`${PROJECTS_DIR} cannot be read (${String(errorCode(error) ?? error)})`]
  }
  const old = []
  for (const key of folders) {
    const file = path.join(PROJECTS_DIR, key, 'groups.json')
    // A folder's name is its key: one that is not is left alone, its groups too.
    if (!PROJECT_KEY.test(key)) continue
    const there = await access(file).then(
      () => true,
      (error) => errorCode(error) !== 'ENOENT',
    )
    if (there) old.push({ key, file })
  }
  if (!old.length) return []
  return withFileLock(GROUPS_FILE, async () => {
    const { stored, problem } = await readStored()
    if (problem)
      return [
        `the groups of ${old.length} project folders are moved into ${GROUPS_FILE} once it is mended or removed`,
      ]
    /** @type {string[]} */
    const said = []
    /** @type {string[]} */
    const moved = []
    for (const { key, file } of old) {
      let groups
      try {
        groups = checkOld(JSON.parse(await readFile(file, 'utf8')))
      } catch (error) {
        if (errorCode(error) === 'ENOENT') continue
        const why =
          error instanceof SyntaxError
            ? 'not JSON'
            : error instanceof GroupRefusal
              ? error.message
              : String(errorCode(error) ?? error)
        said.push(`${file} is not moved into ${GROUPS_FILE}: ${why}`)
        continue
      }
      /** @type {Map<string, string>} */
      const names = new Map()
      for (const group of groups.groups) names.set(group.name, merge(stored, group))
      const own = groups.default && names.get(groups.default)
      if (own && stored.defaults[key] === undefined) stored.defaults[key] = own
      moved.push(file)
    }
    if (!moved.length) return said
    let checked
    try {
      checked = checkGroups({ version: GROUPS_VERSION, ...stored })
    } catch (error) {
      if (!(error instanceof GroupRefusal)) throw error
      return [
        ...said,
        `the groups of ${moved.length} project folders stay where they are, merged they are refused: ${error.message}`,
      ]
    }
    await writeJson(GROUPS_FILE, { version: GROUPS_VERSION, ...checked })
    for (const file of moved)
      await rename(file, `${file}${MOVED}`).catch((error) =>
        // Left in place, it is merged again on each read: a group deleted since comes back.
        said.push(
          `${file} is moved into ${GROUPS_FILE} but cannot be renamed ${path.basename(file)}${MOVED} (${String(errorCode(error) ?? error)}): rename it, or a group deleted comes back`,
        ),
      )
    return said
  })
}

/**
 * The groups, as the project at `project` sees them: its default, under its
 * key, else under its path's, where an older folder kept it. None when
 * there is no file; none too, with `problem` saying why, when the file is
 * not one this Tranchant reads, which is then never written over.
 * `moving`, the project folders' groups that could not be moved in.
 * @param {string} project
 * @returns {Promise<{ file: string, groups: Groups, problem?: string, moving?: string[] }>}
 */
export async function readGroups(project) {
  const key = keyOf(project)
  // Moving them never keeps the groups from being read: it says why, and tries again next time.
  const moving = await moveOld().catch((error) => [
    `the groups of the project folders are not moved into ${GROUPS_FILE} (${String(errorCode(error) ?? error)})`,
  ])
  const { stored, problem } = await readStored()
  const own = stored.defaults[key] ?? stored.defaults[hashOf(project)]
  return {
    file: GROUPS_FILE,
    groups: { ...(own !== undefined && { default: own }), groups: stored.groups },
    ...(problem && { problem }),
    ...(moving.length && { moving }),
  }
}

/**
 * `edit` applied to the groups as they stand, and written; `edit` answers
 * undefined when there is nothing to write. Refused while the file reads as
 * none.
 * @param {(stored: Stored) => Stored | undefined} edit
 * @returns {Promise<Stored>}
 */
function change(edit) {
  // Locked across processes: the server, prepare.mjs and lenses.mjs all write it.
  return withFileLock(GROUPS_FILE, async () => {
    const { stored, problem } = await readStored()
    if (problem) fail(`the groups are not changed: ${problem}`)
    const next = edit(structuredClone(stored))
    if (!next) return stored
    const checked = checkGroups({ version: GROUPS_VERSION, ...next })
    await writeJson(GROUPS_FILE, { version: GROUPS_VERSION, ...checked })
    return checked
  })
}

/** Every project's default that names group `from`, renamed `to`, or none with `to` undefined. @param {Stored} stored @param {string} from @param {string} [to] */
function followDefaults(stored, from, to) {
  for (const [key, name] of Object.entries(stored.defaults))
    if (name === from) {
      if (to === undefined) delete stored.defaults[key]
      else stored.defaults[key] = to
    }
}

/**
 * Creates a group (`from` undefined) or changes the group named `from`: its
 * name and its lenses, at least one, one per name. Saved, a group forgets
 * the lenses removed from it since its last review: the person saw it as it
 * is. Renamed, it stays the default of each project it was.
 * @param {string | undefined} from
 * @param {any} input `{ name, lenses: [{ scope, name }] }`
 */
export async function saveGroup(from, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail('the group is not an object')
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!LENS_NAME.test(name)) fail('name: letters, digits, - and _ only, 40 at most')
  const lenses = checkMembers(input.lenses, 'lenses', true)
  if (!lenses.length) fail('lenses: check at least one')
  return change((stored) => {
    const at = from === undefined ? -1 : stored.groups.findIndex((g) => g.name === from)
    if (from !== undefined && at === -1) fail(`no group ${from}`)
    if (stored.groups.some((g, i) => g.name === name && i !== at))
      fail(`a group is already named ${name}`)
    if (at === -1) stored.groups.push({ name, lenses })
    else stored.groups[at] = { name, lenses }
    if (from !== undefined) followDefaults(stored, from, name)
    return stored
  })
}

/** Deletes a group; never its lenses. Each project it was the default of runs every lens that is on again. */
export function removeGroup(/** @type {string} */ name) {
  return change((stored) => {
    if (!stored.groups.some((g) => g.name === name)) fail(`no group ${name}`)
    stored.groups = stored.groups.filter((g) => g.name !== name)
    followDefaults(stored, name)
    return stored
  })
}

/** The group a review of the project at `project` runs with no --group; `null`, every lens that is on. */
export function setDefaultGroup(
  /** @type {string} */ project,
  /** @type {string | null} */ name,
) {
  const key = keyOf(project)
  return change((stored) => {
    // The default an older folder kept under the project's path gives way to this one.
    delete stored.defaults[hashOf(project)]
    if (name === null) delete stored.defaults[key]
    else if (!stored.groups.some((g) => g.name === name)) fail(`no group ${name}`)
    else stored.defaults[key] = name
    return stored
  })
}

/**
 * Applies `edit` to each group, when the file reads; answers the names of
 * the groups it changed. A file that does not read changes nothing: the lens
 * is changed all the same; once the file is mended, a review of the group
 * says the lens is gone.
 * @param {(group: Group) => boolean} edit
 */
async function eachGroup(edit) {
  /** @type {string[]} */
  const names = []
  await change((stored) => {
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
 * A lens removed: out of every group, each recording it for its next
 * review to say. Answers the groups it left: none for a project's lens,
 * which stays in them (another project may have a lens of its name; a
 * review of the group here says it is not here).
 * @param {Member} member
 */
export function forgetLens(member) {
  if (member.scope === 'local') return Promise.resolve([])
  return eachGroup((group) => {
    if (!group.lenses.some((one) => same(one, member))) return false
    group.lenses = group.lenses.filter((one) => !same(one, member))
    noteRemoved(group, member)
    return true
  })
}

/**
 * A lens renamed or moved to another scope: the same lens in every group it
 * was in. A project's lens renamed joins them beside its old name, which
 * another project may have. A lens of its new name in such a group leaves
 * it, recorded as removed: one lens per name.
 * @param {Member} from
 * @param {Member} to
 */
export function moveLens(from, to) {
  if (same(from, to)) return Promise.resolve([])
  const keep = from.scope === 'local' && from.name !== to.name
  return eachGroup((group) => {
    if (!group.lenses.some((one) => same(one, from))) return false
    for (const twin of group.lenses.filter(
      (one) => one.name === to.name && !same(one, from),
    ))
      noteRemoved(group, twin)
    group.lenses = group.lenses.flatMap((one) =>
      same(one, from) ? (keep ? [one, to] : [to]) : one.name === to.name ? [] : [one],
    )
    return true
  })
}

/**
 * The switches of a review of group `name` saved in it: a lens turned off
 * leaves it, a lens turned on joins it in place of one of the same name.
 * Refused when no lens would be left.
 * @param {string} name
 * @param {{ member: Member, on: boolean }[]} switches
 */
export function switchLenses(name, switches) {
  return change((stored) => {
    const group = stored.groups.find((g) => g.name === name)
    if (!group) return fail(`no group ${name} any more`)
    if (!switches.length) return undefined
    for (const { member, on } of switches) {
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
 * @param {string} name
 * @param {Member[]} said
 */
export async function forgetRemoved(name, said) {
  if (!said.length) return
  await change((stored) => {
    const group = stored.groups.find((g) => g.name === name)
    if (!group?.removed) return undefined
    const left = group.removed.filter((one) => !said.some((two) => same(one, two)))
    if (left.length === group.removed.length) return undefined
    if (left.length) group.removed = left
    else delete group.removed
    return stored
  }).catch((error) => {
    if (!(error instanceof GroupRefusal)) throw error
  })
}

const SCOPE_WORDS = { local: "this project's", global: 'global', recipe: 'built-in' }

/**
 * What a review of `group` says of its lenses that do not run: those
 * removed since its last review, and those it names that are gone (a lens
 * of another project, a recipe that changed).
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
    ...missing.map((one) =>
      one.scope === 'local'
        ? `lens ${one.name} (a project's) of group ${group} is not among this project's lenses: not run`
        : `lens ${one.name} (${SCOPE_WORDS[one.scope]}) of group ${group} is gone: not run`,
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
