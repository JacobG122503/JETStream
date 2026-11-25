import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectRoot } from '../server/paths'
import {
  administratorOnly, asManagerExtras, baseByArea, type Catalogue, chooseExtra, chooseLevel, compareGrants, countChoices, describePermission, everything, grantedKeys, type Grants,
  managerExtras, managerGrants, missingFrom, permissionCatalogue, permissionOf, personGrants, problemWith, problemWithExtras, profileGrants, reaches, readGrants,
  roleGrants, writeGrants,
} from './permissions'

const doc = readFileSync(join(projectRoot, 'docs', 'permissions.md'), 'utf8')

describe('docs/permissions.md', () => {
  const rows = doc
    .split('\n')
    .filter((line) => /^\| `[a-z]+\.[a-z]+` \|/.test(line))
    .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))

  it('has the catalogue of the code: keys, words, levels, needs and Manager', () => {
    expect(rows).toEqual(
      permissionCatalogue.map(({ key, allows, levels, needs, manager }) => [
        `\`${key}\``, allows, levels.join(', '), needs.join(', '), manager,
      ]),
    )
    expect(rows).toHaveLength(28)
  })

  it('names what only administrators do', () => {
    for (const operation of administratorOnly) expect(doc).toContain(`- ${operation}\n`)
  })
})

describe('the catalogue', () => {
  it('has unique keys, and needs that exist and can be held at each level', () => {
    expect(new Set(permissionCatalogue.map(({ key }) => key)).size).toBe(permissionCatalogue.length)
    for (const { key, levels, needs } of permissionCatalogue) {
      for (const need of needs) {
        for (const level of levels) expect(permissionOf(need).levels, `${key} needs ${need}`).toContain(level)
      }
      expect(levels).toContain('all')
    }
  })

  it('lets every extra and the Manager role be complete', () => {
    expect(problemWithExtras([])).toBeNull()
    expect(problemWithExtras(managerExtras)).toBeNull()
    expect(problemWith(managerGrants())).toBeNull()
    expect(problemWith(everything())).toBeNull()
  })
})

describe('built-in roles', () => {
  const role = (key: string) => ({ key, builtIn: true, permissions: ['cost.view:all'] })

  it('Member holds nothing, whatever is stored with it', () => {
    expect(roleGrants(role('member'), [...managerExtras])).toEqual({})
  })

  it('Manager holds exactly what is marked yes, at managed', () => {
    expect(roleGrants(role('manager'))).toEqual({
      'people.view': 'managed', 'clients.view': 'managed', 'projects.view': 'managed', 'projects.edit': 'managed',
      'time.view': 'managed', 'schedule.view': 'managed',
    })
  })

  it.each([
    'projects.create', 'time.edit', 'time.approve', 'billable.view', 'billable.edit', 'cost.view', 'invoices.manage',
    'payments.manage', 'estimates.manage', 'schedule.edit', 'timeoff.approve',
  ] as const)('Manager with the extra %s holds that as well, and nothing more', (key) => {
    const level = key === 'projects.create' ? 'all' : 'managed'
    expect(roleGrants(role('manager'), [key])).toEqual({ ...roleGrants(role('manager')), [key]: level })
  })

  it('has no other extras, and what is not one gives nothing', () => {
    expect(managerExtras).toHaveLength(11)
    expect(roleGrants(role('manager'), ['people.manage', 'roles.manage', 'cost.edit', 'old.key', ''])).toEqual(roleGrants(role('manager')))
  })

  it('a permission added later is held by administrators at once and by nobody else', () => {
    const list: Catalogue<string> = [
      ...permissionCatalogue, { key: 'time.fly', area: 'Account', label: 'fly', allows: 'Fly', levels: ['managed', 'all'], needs: [], manager: 'no' },
    ]
    expect(roleGrants(role('administrator'), [], list)).toMatchObject({ 'time.fly': 'all' })
    const custom = { key: null, builtIn: false, permissions: writeGrants(everything()) }
    for (const other of [role('manager'), role('member'), custom]) {
      expect(roleGrants(other, [...managerExtras, 'time.fly'], list)).not.toHaveProperty('time.fly')
    }
    // Once it is stored with a role, it counts there.
    expect(roleGrants({ ...custom, permissions: ['time.fly:managed'] }, [], list)).toEqual({ 'time.fly': 'managed' })
  })
})

describe('profiles', () => {
  it('are complete, and as their descriptions say', () => {
    for (const [key, grants] of Object.entries(profileGrants)) {
      expect(problemWith(grants), key).toBeNull()
      expect(roleGrants({ key, builtIn: true, permissions: ['settings.manage:all'] })).toEqual(grants)
      // Nobody but administrators gives permissions or changes settings.
      for (const none of ['roles.manage', 'settings.manage', 'outbox.view', 'billable.edit', 'cost.edit'] as const) expect(grants).not.toHaveProperty([none])
    }
    for (const none of ['billable.view', 'cost.view', 'invoices.manage'] as const) expect(profileGrants.people_admin).not.toHaveProperty([none])
    for (const none of ['people.view', 'people.manage', 'time.edit'] as const) expect(profileGrants.accounting).not.toHaveProperty([none])
    expect(roleGrants({ key: 'constructor', builtIn: true, permissions: [] })).toEqual({})
  })

  it('give way to the list of one person, except for administrators', () => {
    const manager = { key: 'manager', builtIn: true, permissions: [] }
    expect(personGrants(manager, ['time.approve'], null)).toEqual(managerGrants(['time.approve']))
    expect(personGrants(manager, ['time.approve'], ['time.view:all', 'old.key:all'])).toEqual({ 'time.view': 'all' })
    expect(personGrants(manager, [], [])).toEqual({})
    expect(personGrants({ key: 'administrator', builtIn: true, permissions: [] }, [], [])).toEqual(everything())
  })

  it('a list that the Manager role can give with extras is told as these', () => {
    expect(asManagerExtras(managerGrants(['billable.view', 'time.approve']))).toEqual(['time.approve', 'billable.view'])
    expect(asManagerExtras(managerGrants())).toEqual([])
    expect(asManagerExtras({ ...managerGrants(), 'time.view': 'all' })).toBeNull()
    expect(asManagerExtras({ 'time.view': 'managed' })).toBeNull()
  })
})

describe('what can be ticked', () => {
  it('is every permission at every level, and what everyone has', () => {
    const { of } = countChoices({})
    expect(of).toBe(permissionCatalogue.reduce((sum, { levels }) => sum + levels.length, 0) + Object.keys(baseByArea).length)
    expect(countChoices({}).on).toBe(Object.keys(baseByArea).length)
    expect(countChoices(everything())).toEqual({ on: of, of })
  })

  it('everything includes what they manage', () => {
    expect(countChoices({ 'time.view': 'managed' }, ['Time'])).toEqual({ on: 2, of: 6 })
    expect(countChoices({ 'time.view': 'all' }, ['Time'])).toEqual({ on: 3, of: 6 })
  })
})

describe('stored lists', () => {
  it('are read back as written', () => {
    const grants: Grants = { 'time.view': 'managed', 'people.view': 'all' }
    expect(writeGrants(grants)).toEqual(['people.view:all', 'time.view:managed'])
    expect(readGrants(writeGrants(grants))).toEqual(grants)
  })

  it.each([
    [['old.key', 'old.key:all', 'time.view', 'time.view:', 'time.view:own', 'clients.manage:managed', 'time.view:all:x', 7, null, { key: 'time.view' }]],
    [null], ['time.view:all'], [{ 'time.view': 'all' }], [undefined], [['__proto__:all', 'constructor:all']],
  ])('give nothing for what the catalogue does not know: %j', (stored) => {
    expect(roleGrants({ key: null, builtIn: false, permissions: stored })).toEqual({})
  })

  it('count the higher of two levels', () => {
    expect(readGrants(['time.view:all', 'time.view:managed'])).toEqual({ 'time.view': 'all' })
  })

  it.each([
    [{ 'time.fly': 'all' }], [{ 'clients.manage': 'managed', 'clients.view': 'managed' }], [{ 'time.approve': 'managed' }],
    [{ 'time.approve': 'all', 'time.view': 'managed' }], [{ 'time.view': 'own' }], [{ 'time.view': null }], [[]], [null], ['time.view'], [7],
    [{ constructor: 'all' }],
  ])('are refused when sent wrong: %j', (sent) => {
    expect(problemWith(sent)).toBeTruthy()
  })

  it('are accepted when complete', () => {
    expect(problemWith({})).toBeNull()
    expect(problemWith({ 'time.approve': 'managed', 'time.view': 'all' })).toBeNull()
  })

  it('of extras are refused when unknown or incomplete', () => {
    expect(problemWithExtras(['invoices.manage'])).toContain('needs')
    expect(problemWithExtras(['invoices.manage', 'billable.view'])).toBeNull()
    expect(problemWithExtras(['people.manage'])).toBeTruthy()
    expect(problemWithExtras(['time.view'])).toBeTruthy()
  })
})

describe('comparing', () => {
  it('all includes managed, and nothing includes neither', () => {
    expect([reaches('all', 'managed'), reaches('managed', 'managed'), reaches('managed', 'all'), reaches(undefined, 'managed')]).toEqual([true, true, false, false])
    expect(missingFrom({ 'time.view': 'managed' }, { 'time.view': 'all', 'people.view': 'managed' })).toEqual(['people.view', 'time.view'])
    expect(missingFrom(everything(), managerGrants(managerExtras))).toEqual([])
  })

  it('tells what is gained and lost', () => {
    expect(compareGrants({ 'time.view': 'all', 'people.view': 'all' }, { 'time.view': 'managed', 'cost.view': 'managed', 'people.view': 'all' })).toEqual({
      gained: { 'cost.view': 'managed' }, lost: { 'time.view': 'all' },
    })
  })

  it('has words for each permission', () => {
    expect(describePermission('time.view', 'managed')).toBe("see others' time and expenses (managed)")
    expect(describePermission('projects.create', 'all')).toBe('create projects and manage them')
  })
})

describe('choosing', () => {
  it('a permission also chooses what it needs, at the same level', () => {
    expect(chooseLevel({}, 'schedule.edit', 'all')).toEqual({
      grants: { 'schedule.edit': 'all', 'schedule.view': 'all' }, added: ['schedule.view'], removed: [],
    })
    const { grants, added } = chooseLevel({ 'time.view': 'managed' }, 'payments.manage', 'all')
    expect(grants).toEqual({
      'payments.manage': 'all', 'invoices.manage': 'all', 'billable.view': 'all', 'time.view': 'all', 'clients.view': 'all',
    })
    expect(added.sort()).toEqual(['billable.view', 'clients.view', 'invoices.manage', 'time.view'])
    expect(chooseLevel({ 'time.view': 'all' }, 'time.edit', 'managed')).toMatchObject({ grants: { 'time.view': 'all' }, added: [] })
  })

  it('removing a needed one removes what depends on it', () => {
    const full = chooseLevel({}, 'payments.manage', 'managed').grants
    const { grants, removed } = chooseLevel(full, 'billable.view', null)
    expect(grants).toEqual({ 'time.view': 'managed', 'clients.view': 'managed' })
    expect(removed.sort()).toEqual(['invoices.manage', 'payments.manage'])
  })

  it('lowering a needed one lowers what depends on it, or removes what has no lower level', () => {
    const before: Grants = { 'time.view': 'all', 'time.edit': 'all', 'time.unlock': 'all' }
    const { grants, removed } = chooseLevel(before, 'time.view', 'managed')
    expect(grants).toEqual({ 'time.view': 'managed', 'time.edit': 'managed' })
    expect(removed.sort()).toEqual(['time.edit', 'time.unlock'])
  })

  it('always ends complete, whatever is chosen', () => {
    for (const { key, levels } of permissionCatalogue) {
      for (const level of [...levels, null]) {
        for (const start of [{}, everything(), managerGrants(managerExtras)]) {
          expect(problemWith(chooseLevel(start, key, level).grants), `${key} ${level}`).toBeNull()
        }
      }
    }
  })

  it('an extra brings the extras it needs, and takes along those that need it', () => {
    expect(chooseExtra([], 'invoices.manage', true)).toEqual({ extras: ['billable.view', 'invoices.manage'], added: ['billable.view'], removed: [] })
    expect(chooseExtra(['billable.view', 'invoices.manage'], 'billable.view', false)).toEqual({ extras: [], added: [], removed: ['invoices.manage'] })
    expect(chooseExtra([], 'projects.create', true).extras).toEqual(['projects.create'])
    expect(grantedKeys(managerGrants(['projects.create']))).toContain('projects.create')
  })
})
