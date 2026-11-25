import { expect, test } from './fixtures'
import { dialog, open, pageTitle } from './pages'
import { accept, accountButton, api, goodPassword, inviteLink, newBrowser, newEmail, options, signIn, signOut } from './people'

// Everything here runs at both base paths.

test('each demo account is one press away, and signing out leaves nothing behind', async ({ page, context, appUrl, basePath }) => {
  await open(page, 'sign-in', 'Sign in')
  for (const [label, role] of [['Employee', 'Member'], ['Project lead', 'Manager'], ['Administrator', 'Administrator']] as const) {
    await page.getByRole('button', { name: new RegExp(`^${label}`) }).click()
    await expect(pageTitle(page)).toHaveText('Time')
    await expect(accountButton(page)).toHaveAccessibleName(new RegExp(`${role}$`))
    const [cookie] = await context.cookies()
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: basePath, secure: false, expires: -1 })
    expect(await page.evaluate(() => document.cookie + JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(cookie?.value)
    await accountButton(page).click()
    await page.getByRole('menuitem', { name: 'Account' }).click()
    await expect(page.getByLabel(/^Name/)).toBeVisible()
    await signOut(page)
    expect(await context.cookies()).toEqual([])
    // Back to Time, as it was.
    await page.goBack()
    await expect(pageTitle(page)).toHaveText('Sign in')
    await expect(accountButton(page)).toHaveCount(0)
    await page.goto(`${appUrl}sign-in`)
  }
})

test('people can be two at once, each in their own browser', async ({ adminPage, employeePage, leadPage }) => {
  for (const [page, name] of [[adminPage, 'Avery Collins'], [leadPage, 'Jordan Blake'], [employeePage, 'Casey Lindgren']] as const) {
    await open(page, 'time', 'Time')
    await expect(accountButton(page)).toHaveAccessibleName(new RegExp(name))
  }
  await open(employeePage, 'team', 'Team')
  await expect(employeePage.getByText('You do not have access to this page')).toBeVisible()
  await open(adminPage, 'team', 'Team')
  await expect(adminPage.getByRole('link', { name: 'Casey Lindgren' })).toBeVisible()
})

test('signed out, pages lead to sign-in and back, and never elsewhere', async ({ page, appUrl }) => {
  await page.goto('reports?x=1')
  await expect(pageTitle(page)).toHaveText('Sign in')
  await page.getByRole('button', { name: /^Employee/ }).click()
  await expect(pageTitle(page)).toHaveText('Reports')
  await expect(page).toHaveURL(`${appUrl}reports?x=1`)
  await signOut(page)
  for (const next of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/\n/evil.example']) {
    await page.goto(`sign-in?next=${encodeURIComponent(next)}`)
    await page.getByRole('button', { name: /^Employee/ }).click()
    await expect(page).toHaveURL(`${appUrl}time`)
    await signOut(page)
  }
  await page.getByRole('button', { name: /^Employee/ }).click()
  await expect(pageTitle(page)).toHaveText('Time')
  await page.goto('sign-in')
  await expect(page).toHaveURL(`${appUrl}time`)
})

test('someone asks for an account, waits, is approved with a client and a project, and is in', async ({ page, adminPage }) => {
  const email = newEmail()
  await open(page, 'sign-in', 'Sign in')
  await page.getByRole('link', { name: 'Ask for an account' }).click()
  await page.getByRole('textbox', { name: /^Name/ }).fill('Noor Fictional')
  await page.getByRole('textbox', { name: /^Email/ }).fill(email.toUpperCase())
  await page.getByRole('textbox', { name: /^Password/ }).fill(goodPassword)
  const zone = page.getByRole('combobox', { name: /^Time zone/ })
  await zone.fill('denver')
  await page.getByRole('option', { name: 'America/Denver' }).click()
  await page.getByRole('button', { name: 'Send request' }).click()
  await expect(pageTitle(page)).toHaveText('Request received')
  await page.getByRole('link', { name: 'Go to sign in' }).click()
  await signIn(page, email)
  await expect(pageTitle(page)).toHaveText('Waiting for approval')

  await open(adminPage, 'team?tab=requests', 'Team')
  await adminPage.getByRole('row').filter({ hasText: email }).getByRole('button', { name: 'Approve' }).click()
  const box = dialog(adminPage, /^Approve/)
  await expect(box.getByLabel(/^Role/)).toHaveValue(/\d/)
  await box.getByRole('checkbox', { name: /^Pump station upgrade/ }).check()
  await expect(box.getByRole('checkbox', { name: 'Fernhollow Water Utility', exact: true })).toBeChecked()
  await box.getByRole('button', { name: 'Approve' }).click()
  await expect(box).toBeHidden()
  await page.getByRole('button', { name: 'Check again' }).click()
  await expect(pageTitle(page)).toHaveText('Time')

  await adminPage.getByRole('tab', { name: 'People' }).click()
  await adminPage.getByLabel('Search people').fill(email)
  await adminPage.getByRole('link', { name: 'Noor Fictional' }).click()
  await expect(pageTitle(adminPage)).toHaveText('Noor Fictional')
  await expect(adminPage.getByRole('checkbox', { name: /^Pump station upgrade/ })).toBeChecked()
  await adminPage.getByRole('checkbox', { name: 'Fernhollow Water Utility', exact: true }).uncheck()
  await adminPage.getByRole('button', { name: 'Save assignments' }).click()
  await expect(dialog(adminPage, 'Remove Fernhollow Water Utility?')).toContainText('Pump station upgrade')
  await dialog(adminPage).getByRole('button', { name: 'Remove and save' }).click()
  await expect(adminPage.getByText('Assignments saved')).toBeVisible()
  await expect(adminPage.getByRole('checkbox', { name: /^Pump station upgrade/ })).not.toBeChecked()
})

test('an invite is made, opened without a trace in the address, accepted once, and then dead', async ({ page, pageProblems, adminPage, browser, appUrl }) => {
  const email = newEmail()
  await open(adminPage, 'team?tab=invites', 'Team')
  await adminPage.getByRole('button', { name: 'Invite someone' }).click()
  const box = dialog(adminPage, 'Invite someone')
  await box.getByRole('textbox', { name: /^Name/ }).fill('Robin Fictional')
  await box.getByRole('textbox', { name: /^Email/ }).fill(email)
  await box.getByLabel(/^Role/).selectOption('Manager')
  await box.getByRole('button', { name: 'Make invite link' }).click()
  const link = await dialog(adminPage, 'Invite link').getByLabel('Invite link').inputValue()
  expect(link).toMatch(new RegExp(`^${appUrl}invite#`))
  await dialog(adminPage).getByRole('button', { name: 'Done' }).click()

  const requested: string[] = []
  page.on('request', (request) => requested.push(request.url()))
  await page.goto(link)
  await expect(pageTitle(page)).toHaveText('Accept your invite')
  await expect(page).toHaveURL(`${appUrl}invite`)
  await expect(page.getByText('Manager')).toBeVisible()
  await page.getByRole('textbox', { name: /^Password/ }).fill(goodPassword)
  await page.getByRole('button', { name: 'Accept and sign in' }).click()
  await expect(pageTitle(page)).toHaveText('Time')
  await expect(accountButton(page)).toHaveAccessibleName(/Robin Fictional.*Manager$/)
  expect(requested.join()).not.toContain(link.split('#')[1])

  const other = await newBrowser(browser, appUrl)
  await other.page.goto(link)
  await expect(pageTitle(other.page)).toHaveText('This link no longer works')
  await expect(other.page).toHaveURL(`${appUrl}invite`)
  // The browser itself notes the answer 410.
  expect(other.problems.filter((problem) => !problem.includes('410'))).toEqual([])
  await other.context.close()
  // Someone who is signed in is asked to sign out first.
  const second = await inviteLink(adminPage)
  await page.goto(second.link)
  await expect(page.getByText('You are signed in as Robin Fictional')).toBeVisible()
  await page.getByRole('button', { name: 'Sign out and go on' }).click()
  await expect(page.getByRole('textbox', { name: /^Email/ })).toHaveValue(second.email)
  expect(pageProblems).toEqual([])
})

test('a forgotten password: help is asked for, a link handed over, and all devices signed out', async ({ page, pageProblems, adminPage, browser, appUrl }) => {
  await open(adminPage, 'team', 'Team')
  const { email, link } = await inviteLink(adminPage)
  const old = await newBrowser(browser, appUrl)
  await accept(old.page, link)

  await open(page, 'sign-in', 'Sign in')
  await signIn(page, email, 'a wrong password')
  await expect(page.getByRole('alert')).toContainText('The email or password is not right.')
  await page.getByRole('link', { name: 'Forgot password?' }).click()
  await page.getByRole('textbox', { name: /^Email/ }).fill(email)
  await page.getByRole('button', { name: 'Ask for help' }).click()
  await expect(page.getByText(/an administrator now sees that you need help/)).toBeVisible()

  await open(adminPage, 'team?tab=help', 'Team')
  await adminPage.getByRole('row').filter({ hasText: email }).getByRole('button').click()
  await dialog(adminPage).getByRole('button', { name: 'Make reset link' }).click()
  const shown = dialog(adminPage, 'Reset link')
  await expect(shown).toContainText('Make sure who is asking')
  const reset = await shown.getByLabel('Reset link').inputValue()
  await page.goto(reset)
  await expect(page).toHaveURL(`${appUrl}reset-password`)
  await page.getByRole('textbox', { name: /^New password/ }).fill('another good password')
  await page.getByRole('button', { name: 'Set password' }).click()
  await expect(page.getByText('Your new password is set. Sign in with it.')).toBeVisible()
  await signIn(page, email, 'another good password')
  await expect(pageTitle(page)).toHaveText('Time')

  await old.page.getByRole('link', { name: 'Team' }).first().click()
  await accountButton(old.page).click()
  await old.page.getByRole('menuitem', { name: 'Account' }).click()
  await expect(pageTitle(old.page)).toHaveText('Sign in')
  await expect(old.page.getByText('Your session has ended. Sign in again to go on.')).toBeVisible()
  await old.context.close()
  expect(pageProblems.filter((problem) => !problem.includes('401'))).toEqual([])
  pageProblems.length = 0
})

test('in a second tab someone else signs in: the first tab becomes theirs', async ({ page, context, appUrl, pageProblems }) => {
  await open(page, 'sign-in', 'Sign in')
  await page.getByRole('button', { name: /^Employee/ }).click()
  await expect(pageTitle(page)).toHaveText('Time')
  await open(page, 'account', 'Account')
  const tab = await context.newPage()
  await open(tab, `${appUrl}time`, 'Time')
  await signOut(tab)
  await tab.getByRole('button', { name: /^Administrator/ }).click()
  await expect(pageTitle(tab)).toHaveText('Time')
  // Not through the page, which would notice on getting focus.
  const name = page.getByRole('textbox', { name: /^Name/ })
  await name.fill('Wrong person')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(page.getByText(/You are now working as Avery Collins/)).toBeVisible()
  await expect(accountButton(page)).toHaveAccessibleName(/Avery Collins/)
  await expect(name).toHaveValue('Avery Collins')
  expect(await api<{ name: string }>(tab, 'GET', 'account')).toMatchObject({ name: 'Avery Collins' })
  // Signed out in one tab, the other notices when it is looked at again.
  await signOut(tab)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(pageTitle(page)).toHaveText('Sign in')
  await context.request.post(`${appUrl}api/session/demo`, { data: { account: 'employee' } })
  expect(await (await context.request.get(`${appUrl}api/account`)).json()).toMatchObject({ name: 'Casey Lindgren' })
  expect(pageProblems.filter((problem) => !/40[13]/.test(problem))).toEqual([])
  pageProblems.length = 0
})

test('changing the password signs out other devices and keeps this one', async ({ page, adminPage, browser, appUrl, pageProblems }) => {
  await open(adminPage, 'time', 'Time')
  const { email, link } = await inviteLink(adminPage)
  await accept(page, link)
  const other = await newBrowser(browser, appUrl)
  await signIn(other.page, email)
  await expect(pageTitle(other.page)).toHaveText('Time')

  await open(page, 'account', 'Account')
  const devices = page.getByRole('table', { name: 'Devices that are signed in' })
  await expect(devices.getByRole('row')).toHaveCount(3)
  await expect(devices.getByText('This device')).toHaveCount(1)
  await page.getByRole('textbox', { name: /^Current password/ }).fill(goodPassword)
  await page.getByRole('textbox', { name: /^New password/ }).fill('jetdemo123')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByRole('link', { name: /too common/ })).toBeVisible()
  await page.getByRole('textbox', { name: /^New password/ }).fill('another good password')
  await page.getByRole('button', { name: 'Change password' }).click()
  await expect(page.getByText('Password changed. All other devices were signed out.')).toBeVisible()
  await expect(devices.getByRole('row')).toHaveCount(2)
  await other.page.reload()
  await expect(pageTitle(other.page)).toHaveText('Sign in')
  await other.context.close()
  await page.reload()
  await expect(pageTitle(page)).toHaveText('Account')
  // Keep going without signing in again: nothing is lost.
  await page.getByRole('textbox', { name: /^Name/ }).fill('Robin Renamed')
  await page.getByRole('button', { name: 'Save profile' }).click()
  await expect(accountButton(page)).toHaveAccessibleName(/Robin Renamed/)
  expect(pageProblems.filter((problem) => !problem.includes('400'))).toEqual([])
  pageProblems.length = 0
})

test('a large photo is shown as a square, shrunk, stored and removed', async ({ page, adminPage }) => {
  await open(adminPage, 'time', 'Time')
  await accept(page, (await inviteLink(adminPage)).link)
  await open(page, 'account', 'Account')
  const file = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 2400
    canvas.height = 1600
    const context = canvas.getContext('2d')
    if (!context) throw new Error('No canvas')
    context.fillStyle = 'red'
    context.fillRect(0, 0, 2400, 1600)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp'))
    return [...new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0))]
  })
  const input = page.locator('input[type="file"]')
  await input.setInputFiles({ name: 'photo.webp', mimeType: 'image/webp', buffer: Buffer.from(file) })
  await expect(page.getByAltText('Your new photo, as it will be shown')).toBeVisible()
  await page.getByRole('button', { name: 'Save photo' }).click()
  await expect(page.getByText('Photo saved')).toBeVisible()
  const picture = page.locator('.shell-header .avatar img')
  await expect(picture).toBeVisible()
  expect(await picture.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight])).toEqual([512, 512])
  await input.setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('<!doctype html>') })
  await expect(page.getByText(/could not be read/)).toBeVisible()
  await page.getByRole('button', { name: 'Remove photo' }).click()
  await dialog(page).getByRole('button', { name: 'Remove photo' }).click()
  await expect(picture).toHaveCount(0)
  await expect(page.locator('.shell-header .avatar')).toHaveText('RF')
})

test('every answer has the security headers', async ({ request, page, pageProblems }) => {
  for (const path of ['', 'time', 'favicon.svg', 'assets/missing.js', 'api/health', 'api/nope']) {
    const headers = (await request.get(path)).headers()
    for (const part of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) {
      expect(headers['content-security-policy'], path).toContain(part)
    }
    expect(headers['content-security-policy']).not.toContain('unsafe')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('same-origin')
  }
  // The policy is in force.
  await open(page, 'sign-in', 'Sign in')
  expect(await page.evaluate(() => {
    const script = document.createElement('script')
    script.textContent = 'window.ran = true'
    return new Promise((resolve) => {
      document.addEventListener('securitypolicyviolation', (event) => resolve(event.effectiveDirective))
      document.head.append(script)
    })
  })).toBe('script-src-elem')
  expect(pageProblems.splice(0).filter((problem) => !problem.includes('Content Security Policy'))).toEqual([])
})

test('requests to join can be switched off', async ({ page, adminPage }) => {
  await open(adminPage, 'team?tab=requests', 'Team')
  const control = adminPage.getByRole('switch')
  // Not uncheck(): the switch moves once the server agreed.
  await control.click()
  await expect(adminPage.getByText('Requests to join are off')).toBeVisible()
  await open(page, 'sign-up', 'Ask for an account')
  await expect(page.getByText(/turned off at the moment/)).toBeVisible()
  await open(page, 'sign-in', 'Sign in')
  await expect(page.getByRole('link', { name: 'Ask for an account' })).toHaveCount(0)
  await control.click()
  await expect(adminPage.getByText('Requests to join are on')).toBeVisible()
  expect((await options(adminPage)).clients.length).toBeGreaterThan(3)
})
