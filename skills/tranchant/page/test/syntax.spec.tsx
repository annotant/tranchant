import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { Markdown, parseBlocks } from '../src/markdown'
import {
  Code,
  languageOfFence,
  languageOfFile,
  sliceTokens,
  tokens,
  type Language,
} from '../src/syntax'

/** The coloured tokens of `line`, as `kind:text`. */
const colored = (line: string, language: Language) =>
  tokens(line, language).flatMap(({ text, kind }) => (kind ? [`${kind}:${text}`] : []))

describe('languages', () => {
  test("reads a file's from its extension", () => {
    expect(
      [
        'a.ts',
        'b.mts',
        'c.cts',
        'd.tsx',
        'e.js',
        'f.mjs',
        'g.cjs',
        'h.jsx',
        'i.json',
      ].map(languageOfFile),
    ).toEqual(['ts', 'ts', 'ts', 'tsx', 'js', 'js', 'js', 'js', 'json'])
    expect(languageOfFile('src/tsconfig.json')).toBe('json')
    expect(languageOfFile('src/App.TSX')).toBe('tsx')
  })

  test('has none for another file, a dotfile or a folder named like one', () => {
    expect(languageOfFile('style.css')).toBeUndefined()
    expect(languageOfFile('README')).toBeUndefined()
    expect(languageOfFile('.ts')).toBeUndefined()
    expect(languageOfFile('src.ts/README')).toBeUndefined()
    expect(languageOfFile('x.__proto__')).toBeUndefined()
  })

  test("reads a fence's word", () => {
    expect(
      ['ts', 'typescript', 'tsx', 'js', 'javascript', 'jsx', 'json', 'JSON'].map(
        languageOfFence,
      ),
    ).toEqual(['ts', 'ts', 'tsx', 'js', 'js', 'js', 'json', 'json'])
    expect(languageOfFence('python')).toBeUndefined()
    expect(languageOfFence('constructor')).toBeUndefined()
    expect(languageOfFence('')).toBeUndefined()
    expect(languageOfFence(undefined)).toBeUndefined()
  })
})

describe('tokens', () => {
  test('keep the line whole', () => {
    const line = 'const a = <B c="d">{`e${f}`}</B> // g'
    for (const language of ['ts', 'tsx', 'js', 'json'] as const)
      expect(
        tokens(line, language)
          .map(({ text }) => text)
          .join(''),
      ).toBe(line)
  })

  test('color control words, storage words, types, numbers, operators and comments', () => {
    expect(colored("export const size: number = 0x1F + 2.5e3 // in 'px'", 'ts')).toEqual([
      'keyword:export',
      'storage:const',
      'type:number',
      'operator:=',
      'number:0x1F',
      'operator:+',
      'number:2.5e3',
      "comment:// in 'px'",
    ])
    expect(colored('if (!user) return a ?? b', 'js')).toEqual([
      'keyword:if',
      'operator:!',
      'keyword:return',
      'operator:??',
    ])
  })

  test('color strings, and the code inside a template literal', () => {
    expect(colored('type A = `a ${b.c(1)}` | "c" /* d */', 'ts')).toEqual([
      'storage:type',
      'type:A',
      'operator:=',
      'string:`a ',
      'operator:${',
      'function:c',
      'number:1',
      'operator:}',
      'string:`',
      'operator:|',
      'string:"c"',
      'comment:/* d */',
    ])
    expect(colored('`${a}${b} and ${c', 'js')).toEqual([
      'string:`',
      'operator:${',
      'operator:}',
      'operator:${',
      'operator:}',
      'string: and ${c',
    ])
  })

  test("color a function's name, called or declared, a method's when called", () => {
    expect(
      colored('function guard(user: User): boolean { return check(user) }', 'ts'),
    ).toEqual([
      'storage:function',
      'function:guard',
      'type:User',
      'type:boolean',
      'keyword:return',
      'function:check',
    ])
    expect(colored('items.map((item) => item.id).join()', 'js')).toEqual([
      'function:map',
      'storage:=>',
      'function:join',
    ])
  })

  test("color a type's name: declared, built, extended, in capitals, in a type position", () => {
    expect(
      colored('class Drawer extends React.Component<Props> implements Thing {}', 'tsx'),
    ).toEqual([
      'storage:class',
      'type:Drawer',
      'keyword:extends',
      'type:React',
      'type:Props',
      'keyword:implements',
      'type:Thing',
    ])
    expect(colored('const d = new Date(); const n = Number(x)', 'js')).toEqual([
      'storage:const',
      'operator:=',
      'keyword:new',
      'type:Date',
      'storage:const',
      'operator:=',
      'function:Number',
    ])
  })

  test('color constants: literals, and names in capitals', () => {
    expect(colored('x = y ?? null || MAX_LINE * TAX', 'js')).toEqual([
      'operator:=',
      'operator:??',
      'constant:null',
      'operator:||',
      'constant:MAX_LINE',
      'operator:*',
      'constant:TAX',
    ])
    expect(colored('return this.value === true', 'ts')).toEqual([
      'keyword:return',
      'variable:this',
      'operator:===',
      'constant:true',
    ])
  })

  test("read a TypeScript type's < > as no tag", () => {
    expect(colored('const a = <T>(b: Array<string>) => b', 'ts')).toEqual([
      'storage:const',
      'operator:=',
      'type:T',
      'type:Array',
      'type:string',
      'storage:=>',
    ])
    expect(colored('useState<string>(x)', 'tsx')).toEqual([
      'function:useState',
      'type:string',
    ])
  })

  test('color JSX tags, components and attributes, in TSX and JavaScript', () => {
    const line = 'return <Button aria-label="Close" onClick={close}>Hi</Button>'
    const expected = [
      'keyword:return',
      'component:Button',
      'attr:aria-label',
      'operator:=',
      'string:"Close"',
      'attr:onClick',
      'operator:=',
      'component:Button',
    ]
    expect(colored(line, 'tsx')).toEqual(expected)
    expect(colored(line, 'js')).toEqual(expected)
    expect(colored('<div className="cart"><Row key={item.id} /></div>', 'tsx')).toEqual([
      'tag:div',
      'attr:className',
      'operator:=',
      'string:"cart"',
      'component:Row',
      'attr:key',
      'operator:=',
      'tag:div',
    ])
    // An attribute on a line of its own, its tag opened on a line before.
    expect(colored("  className='row'", 'js')).toEqual([
      'attr:className',
      'operator:=',
      "string:'row'",
    ])
  })

  test('read a comparison as no tag, JSX text or a keyword before a tag as none', () => {
    expect(colored('for (let i = 0; i < len; i++)', 'js')).toEqual([
      'keyword:for',
      'storage:let',
      'operator:=',
      'number:0',
      'operator:++',
    ])
    expect(colored('if (a < b) x', 'tsx')).toEqual(['keyword:if'])
    expect(colored('  Shop <span>Hi there</span>', 'tsx')).toEqual([
      'tag:span',
      'tag:span',
    ])
    expect(colored('x < new Date()', 'js')).toEqual(['keyword:new', 'type:Date'])
    expect(colored('return <div>', 'tsx')).toEqual(['keyword:return', 'tag:div'])
    expect(colored('ok ? <A /> : <B/>', 'js')).toEqual([
      'operator:?',
      'component:A',
      'component:B',
    ])
  })

  test('read an apostrophe in JSX text as prose, no string', () => {
    expect(colored("<p>Don't save</p>", 'tsx')).toEqual(['tag:p', 'tag:p'])
    expect(colored("f('a')", 'js')).toEqual(['function:f', "string:'a'"])
  })

  test("keep TypeScript's own words plain as keys", () => {
    expect(colored("{ type: 'added', number : 3, default: 1 }", 'ts')).toEqual([
      "string:'added'",
      'number:3',
      'keyword:default',
      'number:1',
    ])
  })

  test('take linear time on a long hyphenated line, and leave a longer one plain', () => {
    const run = 'a-'.repeat(900)
    const start = performance.now()
    expect(colored(run, 'tsx')).toEqual(['operator:-'])
    // Backtracking over 1800 characters would take seconds; a slow runner, not.
    expect(performance.now() - start).toBeLessThan(1000)
    const long = `const a = '${'x'.repeat(2000)}'`
    expect(tokens(long, 'ts')).toEqual([{ text: long }])
  })

  test('read a minus after a name as no hyphenated word', () => {
    expect(colored('items[items.length-1] + n-i', 'js')).toEqual([
      'operator:-',
      'number:1',
      'operator:+',
    ])
    expect(colored('<a data-x={n-1} />', 'tsx')).toEqual([
      'tag:a',
      'attr:data-x',
      'operator:=',
      'operator:-',
      'number:1',
    ])
  })

  test("keep TypeScript's own words plain in JavaScript", () => {
    expect(colored('let type = interface as any', 'js')).toEqual([
      'storage:let',
      'operator:=',
    ])
  })

  test("keep a property named like a keyword plain, not a spread's", () => {
    expect(colored('node.type === a?.default', 'ts')).toEqual([
      'operator:===',
      'operator:?.',
    ])
    expect(colored('f(...this)', 'ts')).toEqual([
      'function:f',
      'operator:...',
      'variable:this',
    ])
  })

  test('color a string or a comment cut by the end of the line up to it', () => {
    expect(colored('const a = "never closed', 'ts')).toEqual([
      'storage:const',
      'operator:=',
      'string:"never closed',
    ])
    expect(colored("x('ends on \\", 'js')).toEqual(['function:x', "string:'ends on \\"])
    expect(colored('a = `line one', 'ts')).toEqual(['operator:=', 'string:`line one'])
    expect(colored('b /* open', 'js')).toEqual(['comment:/* open'])
    expect(colored('"key": "cut', 'json')).toEqual(['key:"key"', 'string:"cut'])
  })

  test("color an escaped quote as its string's", () => {
    expect(colored(String.raw`'it\'s' + 1`, 'js')).toEqual([
      String.raw`string:'it\'s'`,
      'operator:+',
      'number:1',
    ])
  })

  test('color JSON keys, strings, numbers, literals and comments (JSONC)', () => {
    expect(
      colored('  "name" : "an", "n": -1.5e2, "ok": true, "x": null // why', 'json'),
    ).toEqual([
      'key:"name"',
      'string:"an"',
      'key:"n"',
      'number:-1.5e2',
      'key:"ok"',
      'constant:true',
      'key:"x"',
      'constant:null',
      'comment:// why',
    ])
  })
})

describe('sliceTokens', () => {
  test("cut a line's tokens at columns, a token astride a cut on both sides", () => {
    const line = tokens('const total = 1234 + x', 'ts')
    expect(sliceTokens(line, 0, 5)).toEqual([{ text: 'const', kind: 'storage' }])
    expect(sliceTokens(line, 16, 18)).toEqual([{ text: '34', kind: 'number' }])
    expect(sliceTokens(line, 3, 16)).toEqual([
      { text: 'st', kind: 'storage' },
      { text: ' total ' },
      { text: '=', kind: 'operator' },
      { text: ' ' },
      { text: '12', kind: 'number' },
    ])
    expect(sliceTokens(line, 18, 99)).toEqual([
      { text: ' ' },
      { text: '+', kind: 'operator' },
      { text: ' x' },
    ])
    expect(sliceTokens(line, 7, 7)).toEqual([])
  })
})

describe('Code', () => {
  test('renders a span per coloured token, never HTML', () => {
    const { container } = render(
      <pre>
        <Code code={'const a = "<b>x</b>"\nlet c'} language="ts" />
      </pre>,
    )
    expect(container.textContent).toBe('const a = "<b>x</b>"\nlet c')
    expect(container.querySelector('b')).toBeNull()
    expect(
      [...container.querySelectorAll('.tr-tok')].map(
        (span) => `${span.className}:${span.textContent}`,
      ),
    ).toEqual([
      'tr-tok tr-tok--storage:const',
      'tr-tok tr-tok--operator:=',
      'tr-tok tr-tok--string:"<b>x</b>"',
      'tr-tok tr-tok--storage:let',
    ])
  })

  test('renders the code as written without a language', () => {
    const { container } = render(
      <pre>
        <Code code="const a = 1" language={undefined} />
      </pre>,
    )
    expect(container.textContent).toBe('const a = 1')
    expect(container.querySelector('.tr-tok')).toBeNull()
  })
})

test('the summary highlights a block its fence marks ts, tsx, js, jsx or json, no other', () => {
  const { container } = render(
    <Markdown
      source={'```ts\nconst a = 1\n```\n\n```python\nimport os\n```\n\n```\nlet b\n```'}
    />,
  )
  const [ts, python, bare] = [...container.querySelectorAll('pre')]
  expect(ts?.textContent).toBe('const a = 1')
  expect([...(ts?.querySelectorAll('.tr-tok') ?? [])].map((t) => t.textContent)).toEqual([
    'const',
    '=',
    '1',
  ])
  expect(python?.textContent).toBe('import os')
  expect(python?.querySelector('.tr-tok')).toBeNull()
  expect(bare?.textContent).toBe('let b')
  expect(bare?.querySelector('.tr-tok')).toBeNull()
})

test('a fenced block keeps the language its fence names', () => {
  expect(parseBlocks('  ``` jsx\n<A />\n```')).toEqual([
    { kind: 'code', text: '<A />', language: 'js' },
  ])
  expect(parseBlocks('```tsx title="a"\n<A />\n```\n```python\nx\n```\n```\ny')).toEqual([
    { kind: 'code', text: '<A />', language: 'tsx' },
    { kind: 'code', text: 'x', language: undefined },
    { kind: 'code', text: 'y', language: undefined },
  ])
})
