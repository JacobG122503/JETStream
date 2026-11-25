import { expect, settled, test } from './fixtures'
import { dialog, open } from './pages'
import { newBrowser } from './people'

// The whole story, with each person in a browser of their own. Once is enough.
test.skip(({ basePath }) => basePath !== '/', 'once is enough')

test('from an hour worked to a paid invoice, with three people and a client', async ({ employeePage, leadPage, adminPage, browser, appUrl }) => {
  test.setTimeout(90_000)
  const notes = `Story ${Date.now()}`

  // The employee tracks time and an expense with a receipt, and submits the week.
  await open(employeePage, 'time', 'Timesheet')
  await employeePage.getByRole('button', { name: 'Track time' }).first().click()
  const entry = dialog(employeePage, 'Track time')
  await entry.getByRole('combobox', { name: /^Project/ }).fill('turbine')
  await employeePage.getByRole('option', { name: /Turbine foundation design/ }).click()
  await entry.getByLabel('Hours').fill('3.25')
  await entry.getByLabel('Notes').fill(notes)
  await entry.getByRole('button', { name: 'Add time' }).click()
  await expect(employeePage.getByText(notes)).toBeVisible()

  await open(employeePage, 'expenses', 'Expenses')
  await employeePage.getByRole('main').getByRole('button', { name: 'New expense' }).click()
  const expense = dialog(employeePage, 'New expense')
  await expense.getByRole('combobox', { name: /^Project/ }).fill('turbine')
  await employeePage.getByRole('option', { name: /Turbine foundation design/ }).click()
  await expense.getByLabel(/^Category/).selectOption({ label: 'Meals' })
  await expense.getByLabel(/^Amount/).fill('41.70')
  await expense.getByLabel('Notes').fill(notes)
  await expense.getByLabel('Attach receipt').setInputFiles({ name: 'receipt.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 receipt') })
  await expense.getByRole('button', { name: 'Add expense' }).click()
  await expect(employeePage.getByRole('row').filter({ hasText: notes }).getByText('Receipt', { exact: true })).toBeVisible()

  await open(employeePage, 'time', 'Timesheet')
  await employeePage.getByRole('button', { name: 'Submit week for approval' }).click()
  await dialog(employeePage).getByRole('button', { name: 'Submit week' }).click()
  await expect(employeePage.getByText('Waiting for approval')).toBeVisible()

  // The project lead is told, looks at the details and approves.
  await open(leadPage, 'approvals', 'Approvals')
  await expect(leadPage.getByRole('button', { name: /^Notifications, \d+ new/ }).first()).toBeVisible()
  const week = leadPage.locator('.approval').filter({ hasText: 'Casey Test' }).last()
  await week.getByRole('button', { name: /details of Casey Test/ }).click()
  await expect(week.getByText(notes).first()).toBeVisible()
  await week.getByRole('button', { name: 'Approve the week of Casey Test' }).click()
  await expect(leadPage.getByText('Approved Casey Test')).toBeVisible()
  // Invoices are not for the lead.
  await open(leadPage, 'invoices/new', 'New invoice')
  await expect(leadPage.getByRole('heading', { name: 'You do not have access to this page' })).toBeVisible()

  // Whoever does the billing approves the rest, if any, and invoices the client.
  await open(adminPage, 'approvals', 'Approvals')
  const rest = adminPage.getByRole('button', { name: 'Approve the week of Casey Test' })
  if (await rest.count()) {
    await rest.last().click()
    await expect(adminPage.getByText('Approved Casey Test')).toBeVisible()
  }
  await open(adminPage, 'invoices/new', 'New invoice')
  await adminPage.getByRole('button', { name: /Tallgrass/ }).click()
  await adminPage.getByRole('radio', { name: 'Entry' }).check()
  await adminPage.getByLabel('Subject').fill(notes)
  await adminPage.getByRole('button', { name: 'Create draft' }).click()
  const paper = adminPage.getByRole('article')
  await expect(paper.getByText(notes).first()).toBeVisible()
  await adminPage.getByRole('button', { name: /^Attach .*receipt/ }).click()
  await expect(adminPage.getByRole('link', { name: /^receipt-.*\.pdf$/ })).toBeVisible()

  // It is sent, which is only kept where no email service is set up. The client opens it by its link.
  await adminPage.getByRole('button', { name: 'Send', exact: true }).click()
  const message = dialog(adminPage, 'Send invoice')
  await expect(message.getByText(/nothing is sent/)).toBeVisible()
  await message.getByRole('button', { name: 'Keep in the Outbox' }).click()
  await expect(adminPage.getByText('Kept in the Outbox')).toBeVisible()
  await adminPage.getByRole('button', { name: 'More', exact: true }).click()
  await adminPage.getByRole('menuitem', { name: 'Make a client link' }).click()
  const link = await dialog(adminPage, 'Link for the client').getByLabel('Link', { exact: true }).inputValue()
  await dialog(adminPage, 'Link for the client').getByRole('button', { name: 'Close', exact: true }).last().click()

  const client = await newBrowser(browser, appUrl)
  await client.page.goto(link)
  await expect(client.page.getByRole('heading', { level: 1 })).toContainText('Invoice INV-')
  await expect(client.page.getByText(notes).first()).toBeVisible()
  expect(client.page.url()).not.toContain('#')
  const file = client.page.waitForEvent('download')
  await client.page.getByRole('button', { name: /^receipt-/ }).click()
  expect((await file).suggestedFilename()).toMatch(/^receipt-.*\.pdf$/)
  expect(client.problems).toEqual([])
  await client.context.close()

  // The money comes in, and is in the report.
  await adminPage.getByRole('button', { name: 'Record payment' }).click()
  await dialog(adminPage, 'Record payment').getByRole('button', { name: 'Record payment' }).click()
  await expect(adminPage.getByText('Paid in full')).toBeVisible()
  const number = (await adminPage.getByRole('heading', { level: 1 }).textContent())?.replace('Invoice ', '') ?? ''
  await open(adminPage, 'reports/payments', 'Payments')
  await expect(adminPage.getByRole('link', { name: number })).toBeVisible()

  // The employee sees that it is invoiced, and can no longer change it.
  await open(employeePage, 'time', 'Timesheet')
  await expect(employeePage.getByText('Invoiced').first()).toBeVisible()
  await expect(employeePage.getByRole('button', { name: /^Edit .*Turbine foundation/ })).toHaveCount(0)
  await settled(employeePage)
})

test('an estimate is accepted by a client and becomes an invoice', async ({ adminPage: page, browser, appUrl }) => {
  await open(page, 'estimates/new?client=1', 'New estimate')
  await page.getByLabel('Subject').fill('Foundation study')
  await page.getByLabel('Description').fill('Study of the soil')
  await page.getByLabel('Price').fill('1200')
  await page.getByRole('button', { name: 'Create draft' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Estimate ')
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Mark as sent' }).click()
  await dialog(page, 'Mark as sent?').getByRole('button', { name: 'Mark as sent' }).click()
  await expect(page.getByText('Sent', { exact: true }).first()).toBeVisible()
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Make a client link' }).click()
  const link = await dialog(page, 'Link for the client').getByLabel('Link', { exact: true }).inputValue()
  await dialog(page, 'Link for the client').getByRole('button', { name: 'Close', exact: true }).last().click()

  const client = await newBrowser(browser, appUrl)
  await client.page.goto(link)
  await client.page.getByLabel(/^Your name/).fill('Pat Client')
  await client.page.getByRole('button', { name: 'Accept estimate' }).click()
  await expect(client.page.getByText('This estimate was accepted')).toBeVisible()
  expect(client.problems).toEqual([])
  await client.context.close()

  await page.reload()
  await page.getByRole('button', { name: 'Create invoice' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Invoice INV-')
  await expect(page.getByRole('article')).toContainText('Study of the soil')
})
