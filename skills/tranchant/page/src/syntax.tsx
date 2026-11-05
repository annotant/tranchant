import { Fragment, type ReactNode } from 'react'

/**
 * A language the page highlights: TypeScript without JSX (`ts`, where `<T>`
 * is a type), TypeScript with it (`tsx`), JavaScript with or without it
 * (`js`), and JSON with or without comments (`json`).
 */
export type Language = 'ts' | 'tsx' | 'js' | 'json'

/**
 * What a token is, for its colour, after Monokai: a control word (`if`,
 * `return`, `import`), a storage word (`const`, `function`, `class`), a
 * constant (`true`, `null`, `MAX`), a number, a language variable (`this`),
 * a function's name, a type's or class's name, a string, a comment, a JSX
 * tag or component, an attribute, an operator, a JSON key. Plain text has none.
 */
type TokenKind =
  | 'keyword'
  | 'storage'
  | 'constant'
  | 'number'
  | 'variable'
  | 'function'
  | 'type'
  | 'string'
  | 'comment'
  | 'tag'
  | 'component'
  | 'attr'
  | 'operator'
  | 'key'

export type Token = { text: string; kind?: TokenKind }

const BY_EXTENSION: Readonly<Record<string, Language>> = {
  ts: 'ts',
  mts: 'ts',
  cts: 'ts',
  tsx: 'tsx',
  js: 'js',
  mjs: 'js',
  cjs: 'js',
  jsx: 'js',
  json: 'json',
  jsonc: 'json',
}

const BY_FENCE: Readonly<Record<string, Language>> = {
  ts: 'ts',
  typescript: 'ts',
  tsx: 'tsx',
  js: 'js',
  javascript: 'js',
  jsx: 'js',
  json: 'json',
  jsonc: 'json',
}

/** The language of the file at `path`, from its extension; none for any other. */
export function languageOfFile(path: string): Language | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  // `hasOwn`: `.constructor` or ```` ```__proto__ ```` would read a prototype's property as a language.
  return Object.hasOwn(BY_EXTENSION, extension) ? BY_EXTENSION[extension] : undefined
}

/** The language a code block's fence names (```` ```tsx ````); none for any other. */
export function languageOfFence(word: string | undefined): Language | undefined {
  const name = word?.toLowerCase() ?? ''
  return Object.hasOwn(BY_FENCE, name) ? BY_FENCE[name] : undefined
}

const words = (list: string) => new Set(list.split(' '))

/** Control flow, modules, operators spelled out: Monokai's pink. */
const CONTROL = words(
  'as async await break case catch continue debugger default delete do else export ' +
    'extends finally for from if implements import in instanceof new of return ' +
    'satisfies switch throw try typeof void while with yield',
)
/** What declares something: Monokai's blue, in italics. */
const STORAGE = words(
  'abstract class const declare enum function interface let namespace ' +
    'private protected public readonly static type var',
)
const CONSTANT = words('true false null undefined NaN Infinity')
const VARIABLE = words('this super arguments')
/** The primitive types' names: a type's blue. */
const PRIMITIVE = words(
  'any bigint boolean never number object string symbol unknown keyof infer is asserts unique',
)
/**
 * TypeScript's own words, most of them contextual (`type`, `string` can name a
 * variable): coloured anywhere but after a `.` or before a `:`, an
 * approximation; plain names in JavaScript.
 */
const TS_ONLY = words(
  'abstract any as asserts bigint boolean declare enum implements infer interface ' +
    'is keyof namespace never number object private protected public readonly ' +
    'satisfies string symbol type unique unknown',
)
/** After one of these, the next name is the thing declared or built: a type. */
const BEFORE_TYPE = words('class interface enum extends implements new instanceof type')

// A comment, or a string, runs to the end of the line when it is not closed there:
// one over several lines is seen one line at a time.
const COMMENT = String.raw`\/\/.*|\/\*(?:[^*]|\*(?!\/))*(?:\*\/|$)`
const QUOTED = (quote: string) =>
  String.raw`${quote}(?:[^${quote}\\]|\\.)*(?:${quote}|\\?$)`
// An apostrophe right after a letter is prose's (JSX text's `Don't`), no string.
const SINGLE = String.raw`(?<![A-Za-z])${QUOTED("'")}`
const NUMBER = String.raw`\b(?:0[xXbBoO][\da-fA-F_]+n?|\d[\d_]*(?:\.[\d_]*)?(?:[eE][+-]?\d+)?n?)\b`
// Longest first; a bare `<` or `>` stays plain, a tag's or a type's bracket as often as a
// comparison, and so does the `/` of `/>`.
const OPERATOR = String.raw`=>|===|!==|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\*\*|\+\+|--|\.\.\.|[-+*%=!&|^~?]|\/(?!>)`

/**
 * One line of JavaScript or TypeScript: a comment, a string (a template
 * literal up to its next backtick, `${}` included; a quote in a regular
 * expression's literal opens one too), with JSX a `<` or `</` and the name after
 * it (`opensTag` tells a tag from a type; a comparison's `<` has a space after
 * it), a number, then a word, with JSX its hyphens included (`aria-label`,
 * never `length-1`), then an operator. A word is matched whole, never retried
 * from inside: one pass over the line, however long.
 */
const script = (jsx: boolean) =>
  new RegExp(
    [
      `(${COMMENT})`,
      `(${SINGLE}|${QUOTED('"')}|${QUOTED('`')})`,
      // Without JSX, the same groups, never matched (`(?!)` always fails).
      String.raw`${jsx ? '' : '(?!)'}(<\/?)([A-Za-z][\w.:-]*)`,
      `(${NUMBER})`,
      jsx
        ? String.raw`([A-Za-z_$][\w$]*(?:-[A-Za-z_$][\w$]*)*)`
        : String.raw`([A-Za-z_$][\w$]*)`,
      `(${OPERATOR})`,
    ].join('|'),
    'g',
  )

const PATTERNS = { plain: script(false), jsx: script(true) }

/** A JSON line: a comment (JSONC), a string, a key's when a `:` follows it, a number, a literal. */
const JSON_LINE = new RegExp(
  `(${COMMENT})|(${QUOTED('"')})(\\s*:)?|(-?${NUMBER})|\\b(true|false|null)\\b`,
  'g',
)

/** The longest line `tokens` highlights. */
const MAX_LINE = 2000

/**
 * `line` cut into tokens, each with its kind, the text between them plain:
 * one line at a time, so that a line's colours never depend on another's (a
 * comment or a template literal over several lines loses its colour after
 * its first). A line longer than `MAX_LINE` stays plain: a minified bundle's
 * would cost a span per token. Joined, the tokens' texts are `line`.
 */
export function tokens(line: string, language: Language): Token[] {
  if (line.length > MAX_LINE) return line ? [{ text: line }] : []
  const result: Token[] = []
  const push = (text: string, kind?: TokenKind) => {
    if (!text) return
    const last = result[result.length - 1]
    if (!kind && last && !last.kind) last.text += text
    else result.push(kind ? { text, kind } : { text })
  }
  let from = 0
  if (language === 'json') {
    for (const match of line.matchAll(JSON_LINE)) {
      push(line.slice(from, match.index))
      from = match.index + match[0].length
      const [, comment, string, colon, number, literal] = match
      if (comment) push(comment, 'comment')
      else if (string) {
        push(string, colon ? 'key' : 'string')
        push(colon ?? '')
      } else if (number) push(number, 'number')
      else if (literal) push(literal, 'constant')
    }
    push(line.slice(from))
    return result
  }
  // The word before, its kind: `function f` names a function, `new Foo` a type.
  let before: { word: string; kind: TokenKind | undefined } | undefined
  for (const match of line.matchAll(PATTERNS[language === 'ts' ? 'plain' : 'jsx'])) {
    push(line.slice(from, match.index))
    from = match.index + match[0].length
    const [, comment, string, open, tag, number, word, operator] = match
    if (comment) push(comment, 'comment')
    else if (string) {
      if (string.startsWith('`'))
        for (const token of template(string, language)) push(token.text, token.kind)
      else push(string, 'string')
    } else if (open && tag) {
      push(open)
      if (open === '</' || opensTag(line, match.index))
        push(tag, /^[A-Z]/.test(tag) ? 'component' : 'tag')
      else push(tag, kindOfWord(tag, language, line, match.index + 1, before))
      before = { word: tag, kind: undefined }
    } else if (number) push(number, 'number')
    else if (word) {
      const end = match.index + word.length
      const kind =
        // With JSX, a name right before `="`, `='` or `={` is an attribute's.
        language !== 'ts' && line[end] === '=' && /["'{]/.test(line[end + 1] ?? '')
          ? 'attr'
          : kindOfWord(word, language, line, match.index, before)
      push(word, kind)
      before = { word, kind }
      // Monokai's arrow is a storage word's blue, like `function`.
    } else if (operator) push(operator, operator === '=>' ? 'storage' : 'operator')
  }
  push(line.slice(from))
  return result
}

/**
 * The tokens of a template literal: its text a string, each `${}` the
 * expression inside highlighted as code, its braces an operator.
 */
function template(string: string, language: Language): Token[] {
  const result: Token[] = []
  let at = 0
  for (;;) {
    const open = string.indexOf('${', at)
    if (open === -1) break
    let depth = 0
    let close = open + 2
    for (; close < string.length; close++) {
      if (string[close] === '{') depth++
      else if (string[close] === '}' && depth-- === 0) break
    }
    if (close >= string.length) break
    result.push(
      { text: string.slice(at, open), kind: 'string' },
      { text: '${', kind: 'operator' },
    )
    result.push(...tokens(string.slice(open + 2, close), language), {
      text: '}',
      kind: 'operator',
    })
    at = close + 1
  }
  if (at < string.length) result.push({ text: string.slice(at), kind: 'string' })
  return result
}

/**
 * Whether the `<` at `at` in `line`, a name right after it, opens a JSX tag:
 * not right after a name or a bracket, where it is a type's (`Array<T>`,
 * `f<T>()`). A comparison has a space after its `<` (`i < n`): never matched.
 */
function opensTag(line: string, at: number) {
  return !/[\w$)\]]/.test(line[at - 1] ?? '')
}

/**
 * The kind of `word`, at `at` in `line`, after the word `before` it: a
 * property's name after `.` (a spread's `...this` is not one) is plain unless
 * called; then the language's own words, TypeScript's not as a key before
 * `:` (`{ type: 'a' }`), where `default:` stays a keyword; then a name: called
 * or declared with `function`, a function's; after `new` or `class`, in
 * capitals, or a primitive, a type's; in CAPITALS, a constant's; else plain.
 */
function kindOfWord(
  word: string,
  language: Language,
  line: string,
  at: number,
  before: { word: string; kind: TokenKind | undefined } | undefined,
): TokenKind | undefined {
  // Called: a `(` follows, type arguments or not (`useState<string>(`).
  const called = /^\s*(?:<[^<>]*>)?\s*\(/.test(line.slice(at + word.length))
  if (line[at - 1] === '.' && line[at - 2] !== '.') return called ? 'function' : undefined
  if (TS_ONLY.has(word) && (language === 'js' || isKey(line, at + word.length)))
    return undefined
  if (CONTROL.has(word)) return 'keyword'
  if (STORAGE.has(word)) return 'storage'
  if (CONSTANT.has(word)) return 'constant'
  if (VARIABLE.has(word)) return 'variable'
  if (PRIMITIVE.has(word)) return 'type'
  if (before?.word === 'function') return 'function'
  if (before && BEFORE_TYPE.has(before.word) && before.kind) return 'type'
  if (called && !/^[A-Z]/.test(word)) return 'function'
  if (/^[A-Z][A-Z\d_$]+$/.test(word)) return 'constant'
  // A capital letter makes a type's name in code only: after `>` or a plain
  // word it is JSX text (`<p>Don't`), prose a reviewer wrote.
  const inCode =
    /[=:<,([{|&?!+\-*/%~]\s*$/.test(line.slice(0, at)) ||
    (before?.kind && before.kind !== 'type' && before.kind !== 'attr')
  if (
    /^[A-Z]/.test(word) &&
    (inCode || /^(?:\s*[.([]|<[A-Za-z_])/.test(line.slice(at + word.length)))
  )
    return called ? 'function' : 'type'
  return undefined
}

/** Whether a `:` follows `end` in `line`: the word before it is a key's, not a keyword. */
const isKey = (line: string, end: number) => /^\s*:/.test(line.slice(end))

/** Tokens as React elements, never HTML: a span for each coloured one. */
export function spans(line: readonly Token[]): ReactNode[] {
  return line.map(({ text, kind }, index) =>
    kind ? (
      // oxlint-disable-next-line react/no-array-index-key -- the tokens of one line never move
      <span key={index} className={`tr-tok tr-tok--${kind}`}>
        {text}
      </span>
    ) : (
      // oxlint-disable-next-line react/no-array-index-key -- the tokens of one line never move
      <Fragment key={index}>{text}</Fragment>
    ),
  )
}

/**
 * `line`, a line's tokens, cut to the columns `from` (included) to `to`
 * (excluded): a token astride a cut is split, its kind kept on both sides.
 */
export function sliceTokens(line: readonly Token[], from: number, to: number): Token[] {
  const result: Token[] = []
  let at = 0
  for (const token of line) {
    const start = Math.max(at, from)
    const end = Math.min(at + token.text.length, to)
    if (start < end) {
      const text = token.text.slice(start - at, end - at)
      result.push(token.kind ? { text, kind: token.kind } : { text })
    }
    at += token.text.length
    if (at >= to) break
  }
  return result
}

/**
 * `code` with its syntax highlighted, line by line, in `language`; as written
 * without one.
 */
export function Code({
  code,
  language,
}: {
  code: string
  language: Language | undefined
}) {
  if (!language) return code
  return code.split('\n').map((line, index) => (
    // oxlint-disable-next-line react/no-array-index-key -- the lines of one block never move
    <Fragment key={index}>
      {index > 0 && '\n'}
      {spans(tokens(line, language))}
    </Fragment>
  ))
}
