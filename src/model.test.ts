import { test } from 'node:test'
import assert from 'node:assert/strict'
import { daysBetween, emptyData, exportCsv, findConflicts, importCsv, isDate, overlap, validateData } from './model.ts'
import type { PlannerData } from './model.ts'

const fixture = (): PlannerData => ({ version: 1,
  people: [{ id: 'a', name: 'Иванов; "Иван"' }, { id: 'b', name: 'Петров' }],
  vacations: [
    { id: 'v1', personId: 'a', start: '2026-12-28', end: '2027-01-05' },
    { id: 'v2', personId: 'b', start: '2027-01-05', end: '2027-01-10' }],
  rules: [{ id: 'r1', personA: 'b', personB: 'a' }] })

test('date validation, leap days and inclusive calendar counts', () => {
  assert.equal(isDate('2026-02-29'), false)
  assert.equal(isDate('2028-02-29'), true)
  assert.equal(isDate('2026-04-31'), false)
  assert.equal(isDate('2026-1-01'), false)
  assert.equal(isDate('2026-03-01T00:00:00Z'), false)
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 3)
  assert.equal(daysBetween('2028-02-28', '2028-03-01'), 3)
  assert.equal(daysBetween('2026-12-31', '2027-01-01'), 2)
})

test('inclusive boundary conflict, reversed pair and no rule = no conflict', () => {
  const data = fixture()
  assert.equal(findConflicts(data).length, 1)
  assert.equal(findConflicts(data)[0].start, '2027-01-05')
  assert.equal(findConflicts(data)[0].end, '2027-01-05')
  data.vacations[1].start = '2027-01-06'
  assert.equal(findConflicts(data).length, 0)
  data.vacations[1].start = '2027-01-01'
  data.rules = []
  assert.equal(findConflicts(data).length, 0)
})

test('all vacation pairs are checked; complete containment is an overlap', () => {
  const data = fixture()
  data.vacations.push({ id: 'v3', personId: 'a', start: '2027-01-07', end: '2027-01-08' })
  assert.equal(findConflicts(data).length, 2)
  assert.deepEqual(overlap(data.vacations[1], data.vacations[2]), { start: '2027-01-07', end: '2027-01-08' })
})

test('CSV round-trips Russian, quotes, separators, all records and an empty plan', () => {
  assert.deepEqual(importCsv(exportCsv(fixture())), fixture())
  assert.deepEqual(importCsv(exportCsv(emptyData())), emptyData())
  assert.ok(exportCsv(fixture()).startsWith('\uFEFF'))
})

test('CSV cells cannot execute spreadsheet formulas and round-trip apostrophes', () => {
  for (const name of ['=1+1', '+test', '-test', '@test', "'Имя", "'=1+1"]) {
    const data = fixture()
    data.people[0].name = name
    assert.ok(exportCsv(data).includes(`"'${name}"`))
    assert.deepEqual(importCsv(exportCsv(data)), data)
  }
})

test('accept comma delimiter, Excel separator directive, LF and Russian dates', () => {
  const csv = 'type,id,name,person_id,start,end,person_a,person_b\nperson,a,Анна,,,,,\nvacation,v,,a,01.07.2026,14.07.2026,,\n'
  assert.equal(importCsv(csv).vacations[0].start, '2026-07-01')
  assert.deepEqual(importCsv('sep=;\r\n' + exportCsv(fixture()).slice(1)), fixture())
})

test('reject invalid dates, missing people, duplicate IDs and reversed duplicate rules', () => {
  const data = fixture()
  data.vacations[0].end = '2026-01-01'
  assert.throws(() => validateData(data), /даты/)
  assert.throws(() => validateData({ ...fixture(), people: [] }), /неизвестного/)
  const duplicate = fixture()
  duplicate.people[1].id = 'a'
  assert.throws(() => validateData(duplicate), /ID/)
  const rules = fixture()
  rules.rules.push({ id: 'r2', personA: 'a', personB: 'b' })
  assert.throws(() => validateData(rules), /уже существует/)
})

test('malformed CSV, unknown record types and invalid stored records fail safely', () => {
  assert.throws(() => importCsv('name,start,end\nИван,1,2'), /столбцы/)
  assert.throws(() => importCsv(exportCsv(fixture()).replace('"person"', '"other"')), /тип/)
  assert.throws(() => importCsv(exportCsv(fixture()) + '"unclosed'), /кавычки/)
  assert.throws(() => validateData({ ...fixture(), people: [null] }), /ID/)
  assert.throws(() => validateData({ ...fixture(), version: 2 }), /формат/)
})
