/** The Mock accepts literal lines only; this is not a shell interpreter. */
export function terminalCommands(value: string): string[] {
  const commands: string[] = []
  let current = '', quote = '', escaped = false
  for (const char of value.replace(/\r\n?/g, '\n')) {
    if (escaped) { if (char !== '\n') current += '\\' + char; escaped = false; continue }
    if (char === '\\' && quote !== "'") { escaped = true; continue }
    if ((char === '"' || char === "'") && (!quote || quote === char)) quote = quote ? '' : char
    if (char === '\n' && !quote) { if (current.trim()) commands.push(current.trim()); current = '' }
    else current += char
  }
  if (escaped) current += '\\'
  if (current.trim()) commands.push(current.trim())
  return commands
}

export function terminalNeedsContinuation(value: string): boolean {
  let quote = '', escaped = false
  for (const char of value) {
    if (escaped) { escaped = false; continue }
    if (char === '\\' && quote !== "'") { escaped = true; continue }
    if ((char === '"' || char === "'") && (!quote || quote === char)) quote = quote ? '' : char
  }
  return !!quote || escaped
}

const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
export function terminalGraphemes(value: string): { text: string; start: number; end: number }[] {
  return [...segments.segment(value)].map(item => ({ text: item.segment, start: item.index, end: item.index + item.segment.length }))
}
export function limitTerminalInput(value: string, limit = 16384): string {
  if (value.length <= limit) return value
  let end = 0
  for (const item of segments.segment(value)) {
    const next = item.index + item.segment.length
    if (next > limit) break
    end = next
  }
  return value.slice(0, end)
}
export function terminalCellWidth(text: string): number {
  // Match xterm's default Unicode 6 provider; deletion still uses whole graphemes.
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (/^[\p{Mark}\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]$/u.test(char)) continue
    width += code !== 0x303f && (/[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(char) || (code >= 0x20000 && code <= 0x3fffd)) ? 2 : 1
  }
  return width
}
/** Control bytes in input are never replayed as terminal instructions. */
export function cleanTerminalInput(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
}

export function terminalInputLayout(prompt: string, input: string, cols: number, cursor: number) {
  const rows: string[] = ['']
  let row = 0, column = 0, cursorRow = 0, cursorColumn = 0
  function append(text: string) {
    for (const { text: char } of terminalGraphemes(text)) {
      const width = terminalCellWidth(char)
      if (column + width > cols) { rows.push(''); ++row; column = 0 }
      rows[row] += char; column += width
      if (column >= cols) { rows.push(''); ++row; column = 0 }
    }
  }
  append(prompt + ' ')
  for (const item of terminalGraphemes(input)) {
    if (item.start === cursor) { cursorRow = row; cursorColumn = column }
    if (item.text === '\n') { rows.push(''); ++row; column = 0; append('> ') }
    else append(item.text)
  }
  if (cursor === input.length) { cursorRow = row; cursorColumn = column }
  return { rows, cursorRow, cursorColumn }
}
