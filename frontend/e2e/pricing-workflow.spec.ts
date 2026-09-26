import { expect, test, type Page } from '@playwright/test';

const DEMO_USERS = {
  Ali: 'Ali (Relationship manager)',
  Emma: 'Emma (Pricing reviewer)',
  Noah: 'Noah (Pricing reviewer)',
};

async function actAs(page: Page, userName: keyof typeof DEMO_USERS) {
  await page.getByLabel('Acting as').selectOption({ label: DEMO_USERS[userName] });
}

async function openRequest(page: Page, applicationId: string) {
  await page.getByRole('button', { name: applicationId, exact: true }).click();
  await expect(page.getByRole('heading', { name: new RegExp(applicationId) })).toBeVisible();
}

test('create → approve → revise → approval unusable → approve again → full history', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Demo · synthetic data · no real authentication')).toBeVisible();

  await actAs(page, 'Ali');
  await page.getByRole('button', { name: 'New request' }).click();
  await page.getByLabel('Application').selectOption('APP-100');
  await page.getByLabel('Discount (basis points)').fill('25');
  await expect(page.getByText('4.00% − 0.25% = 3.75% resulting rate')).toBeVisible();
  await page.getByLabel('Reason').fill('Competing offer from another lender.');
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.getByRole('heading', { name: /APP-100/ })).toBeVisible();

  await actAs(page, 'Emma');
  await openRequest(page, 'APP-100');
  await page.getByRole('button', { name: 'Approve 25 bps' }).click();
  await expect(page.getByText('Version 1 approved.')).toBeVisible();
  await expect(page.getByText('3.75% (approved)')).toBeVisible();

  await actAs(page, 'Ali');
  await openRequest(page, 'APP-100');
  await page.getByText('Revise request').click();
  await expect(page.getByText('Any existing approval stops being usable immediately.')).toBeVisible();
  await page.getByLabel('Discount (basis points)').fill('40');
  await page.getByRole('button', { name: 'Submit revision' }).click();
  await expect(page.getByText('Revision submitted for review.')).toBeVisible();
  await expect(page.getByText('None — current version is not approved')).toBeVisible();

  await actAs(page, 'Noah');
  await openRequest(page, 'APP-100');
  await page.getByRole('button', { name: 'Approve 40 bps' }).click();
  await expect(page.getByText('3.60% (approved)')).toBeVisible();

  const history = page.getByRole('table', { name: /History/ });
  await expect(history.getByRole('row')).toHaveCount(3);
  await expect(history.getByRole('row').nth(1)).toContainText('v2 (current)');
  await expect(history.getByRole('row').nth(1)).toContainText('Noah');
  await expect(history.getByRole('row').nth(2)).toContainText('Superseded');
  await expect(history.getByRole('row').nth(2)).toContainText('Approved');
  await expect(history.getByRole('row').nth(2)).toContainText('Emma');
});

test('a reviewer acting on stale data sees a conflict and the refreshed version', async ({ page, request }) => {
  await page.goto('/');
  await actAs(page, 'Emma');
  await openRequest(page, 'APP-101');

  const revised = await request.post('http://localhost:3100/requests/REQ-101/versions', {
    headers: { 'X-User-Id': 'ali' },
    data: { expectedVersion: 1, expectedRevision: 0, discountBps: 45, reason: 'Changed while under review' },
  });
  expect(revised.status()).toBe(201);

  await page.getByRole('button', { name: 'Approve 25 bps' }).click();
  await expect(page.getByRole('alert')).toContainText('The latest data is now shown.');
  await expect(page.getByRole('button', { name: 'Approve 45 bps' })).toBeVisible();
});
