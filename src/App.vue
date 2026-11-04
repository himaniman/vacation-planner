<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { daysBetween, emptyData, exportCsv, findConflicts, importCsv, isDate, overlap, validateData } from './model'
import type { PlannerData, Vacation } from './model'

const STORAGE_KEY = 'vacation-planner-v1'
const message = ref('')
const error = ref('')
const storageError = ref('')
const data = ref<PlannerData>(emptyData())
let storageBlocked = false
try {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) data.value = validateData(JSON.parse(saved))
} catch {
  storageBlocked = true
  storageError.value = 'Не удалось прочитать сохранённый график. Старые данные не перезаписываются. Можно работать временно и экспортировать CSV; импорт CSV заменит старое сохранение.'
}
watch(data, () => {
  if (storageBlocked) return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data.value))
    storageError.value = ''
  } catch {
    storageError.value = 'Браузер не смог сохранить изменения. Не закрывайте страницу — экспортируйте график в CSV.'
  }
}, { deep: true })

const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const now = new Date()
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
const year = ref(now.getFullYear())
const month = ref('all')
const safeYear = computed(() => Number.isInteger(Number(year.value)) && Number(year.value) >= 1900 && Number(year.value) <= 9999 ? Number(year.value) : now.getFullYear())
const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const monthDays = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
const period = computed(() => {
  const y = safeYear.value
  const first = month.value === 'all' ? 0 : Number(month.value)
  const last = month.value === 'all' ? 11 : first
  return { start: iso(y, first, 1), end: iso(y, last, monthDays(y, last)) }
})
const periodDays = computed(() => daysBetween(period.value.start, period.value.end))
const periodTitle = computed(() => month.value === 'all' ? `${safeYear.value} год` : `${months[Number(month.value)]} ${safeYear.value}`)
const dayCells = computed(() => Array.from({ length: periodDays.value }, (_, i) => {
  const date = new Date(Date.parse(`${period.value.start}T00:00:00Z`) + i * 86_400_000)
  return { iso: date.toISOString().slice(0, 10), day: date.getUTCDate(), weekend: [0, 6].includes(date.getUTCDay()) }
}))
const monthCells = computed(() => Array.from({ length: 12 }, (_, m) => ({
  name: months[m], start: iso(safeYear.value, m, 1), end: iso(safeYear.value, m, monthDays(safeYear.value, m))
})))
const conflicts = computed(() => findConflicts(data.value))
const visibleConflicts = computed(() => conflicts.value.filter(c => overlap(c, period.value)))
const visibleVacations = computed(() => data.value.vacations.filter(v => overlap(v, period.value)).sort((a, b) => a.start.localeCompare(b.start)))
const personName = (id: string) => data.value.people.find(p => p.id === id)?.name ?? 'Неизвестный сотрудник'
const shortDate = (value: string) => value.split('-').reverse().join('.')
const rangeText = (v: { start: string; end: string }) => `${shortDate(v.start)} — ${shortDate(v.end)}`
const hasConflict = (id: string) => conflicts.value.some(c => c.vacationA === id || c.vacationB === id)
const daysText = (count: number) => `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'день' : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? 'дня' : 'дней'}`
const colors = ['#387e70', '#527ba1', '#9a7245', '#8267a4', '#a6657a', '#598247']
const personColor = (id: string) => colors[Math.max(0, data.value.people.findIndex(p => p.id === id)) % colors.length]

function position(range: { start: string; end: string }, within = period.value) {
  const clipped = overlap(range, within)
  if (!clipped) return { display: 'none' }
  const total = daysBetween(within.start, within.end)
  return { left: `${(daysBetween(within.start, clipped.start) - 1) / total * 100}%`, width: `${daysBetween(clipped.start, clipped.end) / total * 100}%` }
}

// Stack overlapping vacations belonging to the same person instead of hiding them.
const rows = computed(() => data.value.people.map(person => {
  const laneEnds: string[] = []
  const bars = visibleVacations.value.filter(v => v.personId === person.id).map(v => {
    let lane = laneEnds.findIndex(end => end < v.start)
    if (lane === -1) lane = laneEnds.length
    laneEnds[lane] = v.end
    const clipped = overlap(v, period.value)!
    const segments = conflicts.value.filter(c => (c.vacationA === v.id || c.vacationB === v.id) && overlap(c, clipped))
    return { vacation: v, lane, clipped, segments }
  })
  return { person, bars, height: Math.max(1, laneEnds.length) * 32 + 16 }
}))

function notify(text: string) { error.value = ''; message.value = text }
function fail(text: string) { message.value = ''; error.value = text }

const personInput = ref<HTMLInputElement>()
const personDraft = ref('')
const editingPerson = ref('')
function savePerson() {
  const name = personDraft.value.trim()
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) return fail('Введите имя: от 1 до 100 символов без переносов строк.')
  if (editingPerson.value) {
    const person = data.value.people.find(p => p.id === editingPerson.value)
    if (person) person.name = name
  } else {
    const id = crypto.randomUUID()
    data.value.people.push({ id, name })
    if (!vacationPerson.value) vacationPerson.value = id
  }
  personDraft.value = ''; editingPerson.value = ''
  notify('Сотрудник сохранён.')
}
function editPerson(id: string) {
  editingPerson.value = id
  personDraft.value = personName(id)
  nextTick(() => personInput.value?.focus())
}
function deletePerson(id: string) {
  if (!confirm(`Удалить сотрудника «${personName(id)}», все его отпуска и ограничения?`)) return
  data.value.people = data.value.people.filter(p => p.id !== id)
  data.value.vacations = data.value.vacations.filter(v => v.personId !== id)
  data.value.rules = data.value.rules.filter(r => r.personA !== id && r.personB !== id)
  if (editingPerson.value === id) { editingPerson.value = ''; personDraft.value = '' }
  if (vacationPerson.value === id) resetVacation()
  if (ruleA.value === id) ruleA.value = ''
  if (ruleB.value === id) ruleB.value = ''
  notify('Сотрудник удалён.')
}

const vacationForm = ref<HTMLElement>()
const editingVacation = ref('')
const vacationPerson = ref(data.value.people[0]?.id ?? '')
const vacationStart = ref(today)
const vacationEnd = ref(today)
function resetVacation() {
  editingVacation.value = ''
  vacationPerson.value = data.value.people[0]?.id ?? ''
  vacationStart.value = today; vacationEnd.value = today
}
function saveVacation() {
  if (!data.value.people.some(p => p.id === vacationPerson.value)) return fail('Сначала добавьте и выберите сотрудника.')
  if (!isDate(vacationStart.value) || !isDate(vacationEnd.value) || vacationStart.value > vacationEnd.value) return fail('Проверьте даты: начало отпуска не должно быть позже окончания.')
  const vacation: Vacation = { id: editingVacation.value || crypto.randomUUID(), personId: vacationPerson.value, start: vacationStart.value, end: vacationEnd.value }
  const existing = data.value.vacations.findIndex(v => v.id === vacation.id)
  if (existing >= 0) data.value.vacations[existing] = vacation
  else data.value.vacations.push(vacation)
  year.value = Number(vacation.start.slice(0, 4))
  if (month.value !== 'all') month.value = String(Number(vacation.start.slice(5, 7)) - 1)
  editingVacation.value = ''
  notify(hasConflict(vacation.id) ? 'Отпуск сохранён. Есть пересечение по ограничению — проверьте предупреждение над графиком.' : 'Отпуск сохранён.')
}
function editVacation(v: Vacation) {
  editingVacation.value = v.id; vacationPerson.value = v.personId
  vacationStart.value = v.start; vacationEnd.value = v.end
  nextTick(() => {
    vacationForm.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    vacationForm.value?.querySelector('select')?.focus({ preventScroll: true })
  })
}
function deleteVacation(v: Vacation) {
  if (!confirm(`Удалить отпуск: ${personName(v.personId)}, ${rangeText(v)}?`)) return
  data.value.vacations = data.value.vacations.filter(item => item.id !== v.id)
  if (editingVacation.value === v.id) resetVacation()
  notify('Отпуск удалён.')
}

const ruleA = ref('')
const ruleB = ref('')
function addRule() {
  if (!ruleA.value || !ruleB.value || ruleA.value === ruleB.value) return fail('Выберите двух разных сотрудников.')
  if (data.value.rules.some(r => (r.personA === ruleA.value && r.personB === ruleB.value) || (r.personA === ruleB.value && r.personB === ruleA.value))) return fail('Для этой пары ограничение уже есть.')
  data.value.rules.push({ id: crypto.randomUUID(), personA: ruleA.value, personB: ruleB.value })
  ruleA.value = ''; ruleB.value = ''
  notify('Ограничение добавлено. Совпадения отпусков подсвечены автоматически.')
}
function deleteRule(id: string) {
  data.value.rules = data.value.rules.filter(r => r.id !== id)
  notify('Ограничение удалено.')
}

const fileInput = ref<HTMLInputElement>()
function downloadCsv() {
  const url = URL.createObjectURL(new Blob([exportCsv(data.value)], { type: 'text/csv;charset=utf-8;' }))
  const link = document.createElement('a')
  link.href = url; link.download = `vacations-${today}.csv`
  document.body.append(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  notify('CSV экспортирован. В нём сотрудники, отпуска и ограничения.')
}
async function uploadCsv(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    if (file.size > 5 * 1024 * 1024) throw new Error('CSV слишком большой. Максимум — 5 МБ.')
    const imported = importCsv(await file.text())
    if ((data.value.people.length || storageBlocked) && !confirm(`Импорт заменит весь текущий график. В файле: ${imported.people.length} сотрудников, ${imported.vacations.length} отпусков, ${imported.rules.length} ограничений. Продолжить?`)) return
    storageBlocked = false
    data.value = imported
    resetVacation(); editingPerson.value = ''; personDraft.value = ''; ruleA.value = ''; ruleB.value = ''
    if (imported.vacations.length) year.value = Number([...imported.vacations].sort((a, b) => a.start.localeCompare(b.start))[0].start.slice(0, 4))
    month.value = 'all'
    notify('CSV загружен. График заменён данными из файла.')
  } catch (cause) {
    fail(cause instanceof Error ? cause.message : 'Не удалось прочитать CSV.')
  } finally { input.value = '' }
}
</script>

<template>
  <main>
    <header class="page-header">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">☀</div>
        <div><div class="eyebrow">БЕЗ СУЕТЫ И НАКЛАДОК</div><h1>График отпусков</h1></div>
      </div>
      <div class="header-actions">
        <span class="local-badge"><span class="status-dot" :class="{ warning: storageError }"></span>{{ storageError ? 'Не сохранено' : 'Локально в браузере' }}</span>
        <button class="button secondary" @click="fileInput?.click()">↑ Импорт CSV</button>
        <button class="button primary" @click="downloadCsv">↓ Экспорт CSV</button>
        <input ref="fileInput" class="visually-hidden" type="file" accept=".csv,text/csv" aria-label="Импорт CSV" tabindex="-1" @change="uploadCsv" />
      </div>
    </header>

    <p class="intro">Вся команда на одной линии. Сразу видно, кто отдыхает и где нужна подстраховка.</p>
    <div v-if="storageError" class="notice danger" role="alert">{{ storageError }}</div>
    <div v-if="error" class="notice danger" role="alert"><span>{{ error }}</span><button class="dismiss" aria-label="Закрыть ошибку" @click="error = ''">×</button></div>
    <div v-if="message" class="notice success" role="status"><span>{{ message }}</span><button class="dismiss" aria-label="Закрыть уведомление" @click="message = ''">×</button></div>

    <section class="card timeline-card" aria-labelledby="timeline-title">
      <div class="section-heading timeline-heading">
        <div><div class="eyebrow">ОБЩАЯ КАРТИНА</div><h2 id="timeline-title">{{ periodTitle }}</h2></div>
        <div class="period-controls">
          <label class="compact-label">Год<input v-model.number="year" type="number" min="1900" max="9999" aria-label="Год графика" /></label>
          <label class="compact-label">Период<select v-model="month" aria-label="Период графика"><option value="all">Весь год</option><option v-for="(name, i) in months" :key="i" :value="String(i)">{{ name }}</option></select></label>
          <button class="button secondary today-button" @click="year = now.getFullYear(); month = String(now.getMonth())">Текущий месяц</button>
        </div>
      </div>
      <div class="chart-summary">
        <div class="summary-items"><span><strong>{{ data.people.length }}</strong> сотрудников</span><span><strong>{{ visibleVacations.length }}</strong> отпусков в периоде</span></div>
        <span class="legend"><i></i> Отпуск <i class="conflict-key"></i> Конфликт</span>
      </div>

      <div v-if="!data.people.length" class="empty-chart">
        <span class="empty-icon" aria-hidden="true">☀</span><h3>Начнём с команды</h3><p>Добавьте сотрудников и даты отпусков.<br />Здесь появится ваш график.</p>
        <button class="button primary" @click="personInput?.focus(); personInput?.scrollIntoView({ behavior: 'smooth', block: 'center' })">Добавить первого сотрудника</button>
      </div>
      <div v-else class="chart-scroll" tabindex="0" role="region" aria-label="График отпусков, прокручивается по горизонтали">
        <div class="chart" :style="{ '--rail-width': month === 'all' ? '1000px' : `${periodDays * 28}px` }">
          <div class="chart-row chart-header"><div class="person-cell">Сотрудник</div><div class="rail header-rail">
            <template v-if="month === 'all'"><span v-for="cell in monthCells" :key="cell.start" class="month-cell" :style="position(cell)">{{ cell.name.slice(0, 3) }}</span></template>
            <template v-else><span v-for="(day, i) in dayCells" :key="day.iso" class="day-cell" :class="{ weekend: day.weekend, 'is-today': day.iso === today }" :style="{ left: `${i / periodDays * 100}%`, width: `${100 / periodDays}%` }">{{ day.day }}</span></template>
          </div></div>
          <div v-for="row in rows" :key="row.person.id" class="chart-row" :style="{ height: `${row.height}px` }">
            <div class="person-cell" :title="row.person.name"><span class="person-dot" :style="{ background: personColor(row.person.id) }"></span><span class="truncate">{{ row.person.name }}</span></div>
            <div class="rail">
              <template v-if="month !== 'all'"><span v-for="(day, i) in dayCells" :key="day.iso" class="grid-day" :class="{ weekend: day.weekend }" :style="{ left: `${i / periodDays * 100}%`, width: `${100 / periodDays}%` }"></span></template>
              <template v-else><span v-for="cell in monthCells" :key="cell.start" class="month-line" :style="position(cell)"></span></template>
              <span v-if="today >= period.start && today <= period.end" class="today-line" :style="position({ start: today, end: today })"></span>
              <button v-for="bar in row.bars" :key="bar.vacation.id" class="vacation-bar" :class="{ 'has-conflict': bar.segments.length }" :style="{ ...position(bar.vacation), top: `${bar.lane * 32 + 10}px`, backgroundColor: bar.segments.length ? undefined : personColor(row.person.id) }" :title="`${row.person.name}: ${rangeText(bar.vacation)}, ${daysText(daysBetween(bar.vacation.start, bar.vacation.end))}${bar.segments.length ? ' · Есть конфликт' : ''}. Нажмите для изменения.`" :aria-label="`Изменить отпуск: ${row.person.name}, ${rangeText(bar.vacation)}${bar.segments.length ? ', есть конфликт' : ''}`" @click="editVacation(bar.vacation)">
                <span v-for="(segment, i) in bar.segments" :key="i" class="conflict-segment" :style="position(segment, bar.clipped)"></span>
                <span class="bar-label">{{ shortDate(bar.vacation.start).slice(0, 5) }} — {{ shortDate(bar.vacation.end).slice(0, 5) }}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="chart-footer"><span>Обе даты отпуска включены. Нажмите на полоску, чтобы изменить отпуск.</span><span v-if="data.people.length">↔ График можно прокручивать</span></div>
    </section>

    <section v-if="visibleConflicts.length" class="conflicts-panel" aria-labelledby="conflicts-title">
      <div class="conflicts-heading"><span aria-hidden="true">!</span><h2 id="conflicts-title">Есть пересечения: {{ visibleConflicts.length }}</h2><small>за выбранный период</small></div>
      <ul><li v-for="c in visibleConflicts" :key="`${c.ruleId}-${c.vacationA}-${c.vacationB}`"><strong>{{ personName(c.personA) }} и {{ personName(c.personB) }}</strong><span>{{ rangeText(c) }} · {{ daysText(daysBetween(c.start, c.end)) }}</span></li></ul>
      <p>Этим сотрудникам нельзя в отпуск одновременно. Сохранение не блокируется.</p>
    </section>
    <div v-else-if="data.people.length" class="check-summary"><span aria-hidden="true">{{ data.rules.length ? '✓' : '↳' }}</span>{{ data.rules.length ? 'В выбранном периоде нет конфликтов по заданным ограничениям.' : 'Пока нет ограничений. Добавьте пары сотрудников, которым нельзя отдыхать одновременно.' }}<span v-if="conflicts.length" class="muted">Всего конфликтов за все годы: {{ conflicts.length }}.</span></div>

    <div class="workspace">
      <section class="card editor-card" aria-labelledby="people-title">
        <div class="section-heading"><h2 id="people-title">Команда <span class="count">{{ data.people.length }}</span></h2><span class="step-label">01</span></div>
        <form @submit.prevent="savePerson">
          <label for="person-name">{{ editingPerson ? 'Новое имя' : 'Имя сотрудника' }}</label>
          <div class="input-action"><input id="person-name" ref="personInput" v-model="personDraft" required maxlength="100" placeholder="Например, Анна Иванова" autocomplete="off" /><button class="button primary" type="submit">{{ editingPerson ? 'Сохранить' : 'Добавить' }}</button></div>
          <button v-if="editingPerson" class="text-button" type="button" @click="editingPerson = ''; personDraft = ''">Отмена изменения</button>
        </form>
        <ul v-if="data.people.length" class="people-list"><li v-for="person in data.people" :key="person.id"><span class="person-dot" :style="{ background: personColor(person.id) }"></span><button class="name-button" :title="`Переименовать: ${person.name}`" @click="editPerson(person.id)">{{ person.name }}</button><button class="icon-button delete" :aria-label="`Удалить сотрудника ${person.name}`" @click="deletePerson(person.id)">×</button></li></ul>
        <p v-else class="empty-copy">Добавьте всех, чьи отпуска нужно видеть на графике.</p>
      </section>

      <section ref="vacationForm" class="card editor-card" :class="{ editing: editingVacation }" aria-labelledby="vacation-title">
        <div class="section-heading"><h2 id="vacation-title">{{ editingVacation ? 'Изменить отпуск' : 'Добавить отпуск' }}</h2><span class="step-label">02</span></div>
        <form @submit.prevent="saveVacation">
          <label for="vacation-person">Сотрудник</label><select id="vacation-person" v-model="vacationPerson" required :disabled="!data.people.length"><option disabled value="">Выберите сотрудника</option><option v-for="person in data.people" :key="person.id" :value="person.id">{{ person.name }}</option></select>
          <div class="date-fields"><div><label for="vacation-start">С даты</label><input id="vacation-start" v-model="vacationStart" type="date" min="1900-01-01" max="9999-12-31" required /></div><div><label for="vacation-end">По дату</label><input id="vacation-end" v-model="vacationEnd" type="date" :min="vacationStart || '1900-01-01'" max="9999-12-31" required /></div></div>
          <p class="field-hint">{{ isDate(vacationStart) && isDate(vacationEnd) && vacationEnd >= vacationStart ? `${daysText(daysBetween(vacationStart, vacationEnd))}, включая выходные` : 'Укажите начало и окончание отпуска' }}</p>
          <div class="form-actions"><button class="button primary" type="submit" :disabled="!data.people.length">{{ editingVacation ? 'Сохранить изменения' : '+ Добавить отпуск' }}</button><button v-if="editingVacation" class="button secondary" type="button" @click="resetVacation">Отмена</button></div>
        </form>
      </section>

      <section class="card editor-card" aria-labelledby="rules-title">
        <div class="section-heading"><h2 id="rules-title">Не вместе <span class="count">{{ data.rules.length }}</span></h2><span class="step-label">03</span></div>
        <p class="card-description">Кто не должен уходить в отпуск одновременно?</p>
        <form @submit.prevent="addRule">
          <label class="visually-hidden" for="rule-a">Первый сотрудник</label><select id="rule-a" v-model="ruleA" required :disabled="data.people.length < 2"><option disabled value="">Первый сотрудник</option><option v-for="person in data.people" :key="person.id" :value="person.id" :disabled="person.id === ruleB">{{ person.name }}</option></select>
          <label class="visually-hidden" for="rule-b">Второй сотрудник</label><select id="rule-b" v-model="ruleB" class="second-select" required :disabled="data.people.length < 2"><option disabled value="">Второй сотрудник</option><option v-for="person in data.people" :key="person.id" :value="person.id" :disabled="person.id === ruleA">{{ person.name }}</option></select>
          <button class="button secondary full-width" type="submit" :disabled="data.people.length < 2">+ Добавить ограничение</button>
        </form>
        <ul v-if="data.rules.length" class="rules-list"><li v-for="rule in data.rules" :key="rule.id"><span>{{ personName(rule.personA) }} <span class="pair-sign">↔</span> {{ personName(rule.personB) }}</span><button class="icon-button delete" :aria-label="`Удалить ограничение: ${personName(rule.personA)} и ${personName(rule.personB)}`" @click="deleteRule(rule.id)">×</button></li></ul>
        <p v-else class="empty-copy">{{ data.people.length < 2 ? 'Для ограничения нужны хотя бы два сотрудника.' : 'Обычные совпадения не считаются ошибкой — только для заданных пар.' }}</p>
      </section>
    </div>

    <section v-if="visibleVacations.length" class="card vacation-list" aria-labelledby="list-title">
      <div class="section-heading"><h2 id="list-title">Отпуска за выбранный период <span class="count">{{ visibleVacations.length }}</span></h2></div>
      <div class="table-scroll"><table><thead><tr><th>Сотрудник</th><th>Даты</th><th>Длительность</th><th>Проверка</th><th><span class="visually-hidden">Действия</span></th></tr></thead><tbody><tr v-for="v in visibleVacations" :key="v.id"><td><span class="person-dot" :style="{ background: personColor(v.personId) }"></span>{{ personName(v.personId) }}</td><td>{{ rangeText(v) }}</td><td>{{ daysText(daysBetween(v.start, v.end)) }}</td><td><span class="table-status" :class="{ bad: hasConflict(v.id) }">{{ hasConflict(v.id) ? '! Есть конфликт' : '—' }}</span></td><td class="row-actions"><button class="text-button" :aria-label="`Изменить отпуск: ${personName(v.personId)}, ${rangeText(v)}`" @click="editVacation(v)">Изменить</button><button class="text-button delete" :aria-label="`Удалить отпуск: ${personName(v.personId)}, ${rangeText(v)}`" @click="deleteVacation(v)">Удалить</button></td></tr></tbody></table></div>
    </section>

    <footer class="page-footer"><span>Только ваш браузер. Без регистрации и отправки данных.</span><details><summary>Как сохранить и открыть в Excel?</summary><p>Экспортируйте CSV — это резервная копия всего графика. В Excel: кодировка UTF-8, разделитель «точка с запятой». Строки person — сотрудники, vacation — отпуска, rule — ограничения; связи задаются через ID. Не меняйте заголовки и ID. Даты: ГГГГ-ММ-ДД или ДД.ММ.ГГГГ. Сохраняйте как CSV UTF-8. Импорт полностью заменяет график после проверки файла и подтверждения.</p><p>Данные привязаны к этому браузеру и адресу сайта. Очистка данных браузера удалит график — регулярно экспортируйте CSV.</p></details></footer>
  </main>
</template>
