import { test, expect } from '@playwright/test';

test.describe('Deployment login smoke test', () => {
  test('login page loads correctly', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input#email')).toBeVisible();
    await expect(page.locator('input#password')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toHaveText('Sign in');
    await expect(page.locator('a[href="/signup"]')).toBeVisible();
  });

  test('required fields prevent empty submission', async ({ page }) => {
    await page.goto('/login');
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/\/login$/);
    expect(await page.locator('input#email').evaluate((input: HTMLInputElement) => input.validity.valueMissing)).toBe(true);
  });

  test('signup link navigates correctly', async ({ page }) => {
    await page.goto('/login');
    await page.locator('a[href="/signup"]').click();
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.locator('input#email')).toBeVisible();
  });

  test('signs in with an explicitly configured test account', async ({ page }) => {
    const email = process.env.E2E_TEST_EMAIL;
    const password = process.env.E2E_TEST_PASSWORD;
    test.skip(!email || !password, 'Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD for the optional authenticated check.');
    await page.goto('/login');
    await page.locator('input#email').fill(email!);
    await page.locator('input#password').fill(password!);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/\/(posts|calendar)(?:[/?#]|$)/);
  });
});
