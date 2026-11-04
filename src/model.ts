export interface Person { id: string; name: string }
export interface Vacation { id: string; personId: string; start: string; end: string }
export interface Rule { id: string; personA: string; personB: string }
export interface PlannerData { version: 1; people: Person[]; vacations: Vacation[]; rules: Rule[] }
export interface Conflict { ruleId: string; vacationA: string; vacationB: string; personA: string; personB: string; start: string; end: string }

export const emptyData = (): PlannerData => ({ version: 1, people: [], vacations: [], rules: [] })

export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const time = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
    && value >= '1900-01-01' && value <= '9999-12-31'
}

export function dayNumber(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / 86_400_000
}

export function daysBetween(start: string, end: string): number {
  return dayNumber(end) - dayNumber(start) + 1
}

export function overlap(a: Pick<Vacation, 'start' | 'end'>, b: Pick<Vacation, 'start' | 'end'>) {
  const start = a.start > b.start ? a.start : b.start
  const end = a.end < b.end ? a.end : b.end
  return start <= end ? { start, end } : null
}

export function findConflicts(data: PlannerData): Conflict[] {
  const result: Conflict[] = []
  for (const rule of data.rules) {
    const left = data.vacations.filter(v => v.personId === rule.personA)
    const right = data.vacations.filter(v => v.personId === rule.personB)
    for (const a of left) for (const b of right) {
      const intersection = overlap(a, b)
      if (intersection) result.push({ ruleId: rule.id, vacationA: a.id, vacationB: b.id,
        personA: rule.personA, personB: rule.personB, ...intersection })
    }
  }
  return result.sort((a, b) => a.start.localeCompare(b.start))
}

// Validate the entire import before replacing any existing data.
export function validateData(input: unknown): PlannerData {
  if (!input || typeof input !== 'object') throw new Error('Некорректный формат данных.')
  const data = input as PlannerData
  if (data.version !== 1 || !Array.isArray(data.people) || !Array.isArray(data.vacations) || !Array.isArray(data.rules)) {
    throw new Error('Неизвестный формат данных.')
  }
  const ids = new Set<string>()
  const checkId = (record: { id: string } | null) => {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string' || !record.id.trim() || ids.has(record.id)) {
      throw new Error('Пустой или повторяющийся ID записи.')
    }
    ids.add(record.id)
  }
  for (const person of data.people) {
    checkId(person)
    if (typeof person.name !== 'string' || !person.name.trim() || person.name.length > 100 || /[\u0000-\u001f\u007f]/.test(person.name)) {
      throw new Error('Имя должно содержать от 1 до 100 символов без переносов строк.')
    }
  }
  const people = new Set(data.people.map(p => p.id))
  for (const vacation of data.vacations) {
    checkId(vacation)
    if (!people.has(vacation.personId)) throw new Error('Отпуск ссылается на неизвестного сотрудника.')
    if (typeof vacation.start !== 'string' || typeof vacation.end !== 'string'
      || !isDate(vacation.start) || !isDate(vacation.end) || vacation.start > vacation.end) {
      throw new Error('Проверьте даты отпуска: начало не должно быть позже окончания (формат ГГГГ-ММ-ДД).')
    }
  }
  const pairs = new Set<string>()
  for (const rule of data.rules) {
    checkId(rule)
    if (!people.has(rule.personA) || !people.has(rule.personB) || rule.personA === rule.personB) {
      throw new Error('Для ограничения нужны два разных существующих сотрудника.')
    }
    const pair = JSON.stringify([rule.personA, rule.personB].sort())
    if (pairs.has(pair)) throw new Error('Ограничение для этой пары уже существует.')
    pairs.add(pair)
  }
  // Keep only the supported fields, including when loading localStorage.
  return { version: 1,
    people: data.people.map(p => ({ id: p.id, name: p.name.trim() })),
    vacations: data.vacations.map(v => ({ id: v.id, personId: v.personId, start: v.start, end: v.end })),
    rules: data.rules.map(r => ({ id: r.id, personA: r.personA, personB: r.personB })) }
}

const columns = ['type', 'id', 'name', 'person_id', 'start', 'end', 'person_a', 'person_b']
const unsafeCell = (value: string) => /^[\s]*[=+\-@]/.test(value) || /^['\t\r\n]/.test(value)
const excelText = (value: string) => unsafeCell(value) ? `'${value}` : value
const fromExcelText = (value: string) => value.startsWith("'") && unsafeCell(value.slice(1)) ? value.slice(1) : value

export function exportCsv(data: PlannerData): string {
  const rows: string[][] = [columns,
    ...data.people.map(p => ['person', p.id, p.name, '', '', '', '', '']),
    ...data.vacations.map(v => ['vacation', v.id, '', v.personId, v.start, v.end, '', '']),
    ...data.rules.map(r => ['rule', r.id, '', '', '', '', r.personA, r.personB])]
  const quote = (value: string) => `"${excelText(value).replaceAll('"', '""')}"`
  return '\uFEFF' + rows.map(row => row.map(quote).join(';')).join('\r\n') + '\r\n'
}

function parseRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false, closed = false
  const pushCell = () => { row.push(cell); cell = ''; closed = false }
  const pushRow = () => { pushCell(); if (row.some(value => value.trim())) rows.push(row); row = [] }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ }
        else { quoted = false; closed = true }
      } else cell += char
    } else if (char === delimiter) pushCell()
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++
      pushRow()
    } else if (char === '"') {
      if (cell || closed) throw new Error('Некорректные кавычки в CSV.')
      quoted = true
    } else {
      if (closed) throw new Error('Лишние символы после кавычек в CSV.')
      cell += char
    }
  }
  if (quoted) throw new Error('В CSV не закрыты кавычки.')
  if (cell || row.length || closed) pushRow()
  return rows
}

function csvDate(value: string): string {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value)
  return match ? `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}` : value
}

export function importCsv(source: string): PlannerData {
  let text = source.replace(/^\uFEFF/, '')
  text = text.replace(/^sep=[;,]\r?\n/i, '')
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = firstLine.includes(';') ? ';' : ','
  const rows = parseRows(text, delimiter)
  const header = rows.shift()?.map(value => value.trim().toLowerCase())
  if (!header || header.join('|') !== columns.join('|')) {
    throw new Error('Неизвестные столбцы CSV. Используйте файл, экспортированный из приложения; разделитель — ; или запятая.')
  }
  const data = emptyData()
  rows.forEach((raw, index) => {
    if (raw.length !== columns.length) throw new Error(`Запись ${index + 2}: ожидается 8 столбцов.`)
    const [type, id, name, personId, start, end, personA, personB] = raw.map(fromExcelText)
    if (type === 'person') data.people.push({ id, name })
    else if (type === 'vacation') data.vacations.push({ id, personId, start: csvDate(start), end: csvDate(end) })
    else if (type === 'rule') data.rules.push({ id, personA, personB })
    else throw new Error(`Запись ${index + 2}: неизвестный тип «${type}».`)
  })
  return validateData(data)
}
