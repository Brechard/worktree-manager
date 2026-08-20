import { useRef, type ReactNode } from 'react'
import { cn } from '../lib/utils'

/**
 * A small shell editor: a highlighted, aria-hidden `<pre>` sitting exactly
 * under a transparent `<textarea>`. The textarea keeps every native editing
 * behaviour (selection, undo, IME, spellcheck-off) and the layer behind it
 * supplies the colour, so the two must agree on font, size, line height,
 * padding and wrapping or the caret drifts away from the glyphs.
 */

const KEYWORDS = new Set([
  'if',
  'then',
  'else',
  'elif',
  'fi',
  'for',
  'while',
  'until',
  'do',
  'done',
  'case',
  'esac',
  'in',
  'function',
  'select',
  'time',
  'return',
  'exit',
  'break',
  'continue',
  'local',
  'export',
  'unset',
  'set',
  'declare',
  'readonly',
  'shift',
])

/** Commands worth colouring as commands. Anything else stays plain. */
const COMMANDS = new Set([
  'echo',
  'printf',
  'cd',
  'pwd',
  'read',
  'test',
  'eval',
  'exec',
  'source',
  'trap',
  'sed',
  'awk',
  'grep',
  'egrep',
  'head',
  'tail',
  'cut',
  'tr',
  'sort',
  'uniq',
  'wc',
  'xargs',
  'find',
  'basename',
  'dirname',
  'realpath',
  'tee',
  'cat',
  'docker',
  'docker-compose',
  'git',
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'node',
  'python3',
  'rm',
  'mv',
  'cp',
  'ls',
  'mkdir',
  'rmdir',
  'touch',
  'chmod',
  'ln',
  'sleep',
  'kill',
  'pkill',
  'true',
  'false',
  'command',
  'which',
])

const CLASS = {
  comment: 'italic text-muted',
  string: 'text-success',
  variable: 'text-warning',
  keyword: 'text-merged',
  command: 'text-primary',
  operator: 'text-highlight',
} as const

// `$name`, `${...}`, `$(`, and the usual specials like `$1` / `$?` / `$@`.
const VARIABLE = /^\$(?:\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*|[0-9?@#*$!-])/
const WORD = /^[A-Za-z0-9_./-]+/
const OPERATOR = /^(?:\|\||&&|>>|2>&1|[|;&<>(){}[\]=]|\$\()/

/**
 * Tokenize far enough to read well, not far enough to be a shell parser.
 * Unterminated quotes simply colour to end-of-input rather than throwing.
 */
function highlight(source: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let key = 0
  let index = 0
  // The first word of a command gets command colouring; `;`, `|`, `&&`, and a
  // newline start a new command, so `docker rm -f $ids` colours only `docker`.
  let atCommandStart = true

  const push = (text: string, className?: string) => {
    if (!text) return
    nodes.push(
      className ? (
        <span key={key++} className={className}>
          {text}
        </span>
      ) : (
        <span key={key++}>{text}</span>
      )
    )
  }

  // A double-quoted run still interpolates, so its variables stay highlighted
  // instead of being flattened into one green blob.
  const pushDoubleQuoted = (text: string) => {
    let rest = text
    let plain = ''
    while (rest.length > 0) {
      const variable = rest.match(VARIABLE)
      if (variable && rest.startsWith('$')) {
        push(plain, CLASS.string)
        plain = ''
        push(variable[0], CLASS.variable)
        rest = rest.slice(variable[0].length)
        continue
      }
      plain += rest[0]
      rest = rest.slice(1)
    }
    push(plain, CLASS.string)
  }

  while (index < source.length) {
    const rest = source.slice(index)
    const char = rest[0]!

    if (char === '\n') {
      push('\n')
      atCommandStart = true
      index += 1
      continue
    }

    if (/\s/.test(char)) {
      const run = rest.match(/^[^\S\n]+/)![0]
      push(run)
      index += run.length
      continue
    }

    if (char === '#') {
      const run = rest.match(/^[^\n]*/)![0]
      push(run, CLASS.comment)
      index += run.length
      continue
    }

    if (char === "'") {
      // Single quotes are literal in shell — no escapes to honour.
      const end = rest.indexOf("'", 1)
      const run = end === -1 ? rest : rest.slice(0, end + 1)
      push(run, CLASS.string)
      index += run.length
      atCommandStart = false
      continue
    }

    if (char === '"') {
      let cursor = 1
      while (cursor < rest.length) {
        if (rest[cursor] === '\\') cursor += 2
        else if (rest[cursor] === '"') {
          cursor += 1
          break
        } else cursor += 1
      }
      const run = rest.slice(0, cursor)
      pushDoubleQuoted(run)
      index += run.length
      atCommandStart = false
      continue
    }

    if (char === '$') {
      const variable = rest.match(VARIABLE)
      if (variable) {
        push(variable[0], CLASS.variable)
        index += variable[0].length
        atCommandStart = false
        continue
      }
      if (rest.startsWith('$(')) {
        push('$(', CLASS.operator)
        index += 2
        atCommandStart = true
        continue
      }
    }

    const operator = rest.match(OPERATOR)
    if (operator) {
      push(operator[0], CLASS.operator)
      index += operator[0].length
      // `>` and `<` take a filename, not a command; everything else restarts one.
      atCommandStart = !/^(?:>>|[<>])$/.test(operator[0])
      continue
    }

    const word = rest.match(WORD)
    if (word) {
      const text = word[0]
      const className = KEYWORDS.has(text)
        ? CLASS.keyword
        : atCommandStart && COMMANDS.has(text)
          ? CLASS.command
          : undefined
      push(text, className)
      index += text.length
      if (!KEYWORDS.has(text)) atCommandStart = false
      continue
    }

    push(char)
    index += 1
    atCommandStart = false
  }

  // Without a trailing newline the last line has no height, so a caret parked
  // on it sits half a row above the text.
  nodes.push(<span key={key++}>{'\n'}</span>)
  return nodes
}

interface ShellEditorProps {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function ShellEditor({ id, value, onChange, placeholder, className }: ShellEditorProps) {
  const preRef = useRef<HTMLPreElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // The textarea is the one that scrolls; the highlight layer follows it.
  const syncScroll = () => {
    const pre = preRef.current
    const textarea = textareaRef.current
    if (!pre || !textarea) return
    pre.scrollTop = textarea.scrollTop
    pre.scrollLeft = textarea.scrollLeft
  }

  // Tab indents instead of leaving the field — this is a code editor, and
  // shell scripts get indented inside `if`/`for` blocks.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab' || event.shiftKey) return
    event.preventDefault()
    const target = event.currentTarget
    const { selectionStart, selectionEnd } = target
    const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`
    onChange(next)
    requestAnimationFrame(() => {
      target.selectionStart = target.selectionEnd = selectionStart + 2
    })
  }

  const shared = 'px-3 py-2 font-mono text-xs leading-5 whitespace-pre-wrap break-words'

  return (
    <div
      className={cn(
        'relative h-56 overflow-hidden rounded-md border border-border bg-background focus-within:border-primary',
        className
      )}
    >
      <pre
        ref={preRef}
        aria-hidden="true"
        className={cn('absolute inset-0 overflow-hidden', shared)}
      >
        {value ? highlight(value) : <span className="text-muted">{placeholder}</span>}
      </pre>
      <textarea
        id={id}
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        style={{ caretColor: 'var(--color-foreground)' }}
        className={cn(
          'absolute inset-0 h-full w-full resize-none overflow-auto border-0 bg-transparent text-transparent outline-none selection:bg-primary/30',
          shared
        )}
      />
    </div>
  )
}
