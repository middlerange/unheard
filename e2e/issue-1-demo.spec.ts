import { test, expect } from '@playwright/test';

/**
 * E2E Demo: Issue #1 - Platform Validation
 * Demonstrates character limit validation and media constraints
 */

test('Issue #1: Platform Validation Demo - Twitter char limit and LinkedIn validation', async ({ page }) => {
  // 0. SIGN UP (create account if it doesn't exist)
  await page.goto('/signup');
  await page.waitForLoadState('networkidle');
  
  // Try to sign up with the demo account - use keyboard type for reliability
  await page.locator('#email').click();
  await page.waitForTimeout(100);
  await page.keyboard.type('demo@testuser.com');
  
  await page.locator('#password').click();
  await page.waitForTimeout(100);
  await page.keyboard.type('andcoms');
  
  await page.locator('#teamName').click();
  await page.waitForTimeout(100);
  await page.keyboard.type('Demo Team');
  await page.waitForTimeout(500);
  await page.locator('button[type="submit"]').click();
  
  // Wait for either successful signup or "account exists" error
  try {
    await page.waitForURL(/posts/, { timeout: 5000 });
  } catch {
    // If signup failed (account exists), that's ok - proceed to login
    console.log('Signup may have failed (account exists), proceeding to login');
  }
  
  // 1. LOGIN with the demo account
  await page.goto('/login');
  
  // Wait for form to be ready and fully loaded
  await page.waitForLoadState('networkidle');
  await page.waitForSelector('#email', { timeout: 10000, state: 'visible' });
  
  // Click first to focus, then type email character by character
  await page.locator('#email').click();
  await page.waitForTimeout(100);
  await page.keyboard.type('demo@testuser.com');
  
  // Click first to focus, then type password character by character  
  await page.locator('#password').click();
  await page.waitForTimeout(100);
  await page.keyboard.type('andcoms');
  
  // Wait for form validation to settle
  await page.waitForTimeout(1000);
  
  // Click sign in
  await page.locator('button[type="submit"]').click();
  
  // Wait for navigation
  await page.waitForURL(/posts/, { timeout: 10000 });
  
  // Wait for dashboard
  await expect(page).toHaveURL(/posts/);
  
  // 2. TEST TWITTER CHARACTER LIMIT
  await page.waitForSelector('button:has-text("New post")', { timeout: 10000 });
  await page.locator('button:has-text("New post")').click();
  await page.getByRole('button', { name: /twitter/i }).first().click();
  
  // Try to enter 300 characters (exceeds 280)
  await page.locator('[contenteditable="true"]').first().fill('A'.repeat(300));
  
  // Verify error appears
  await expect(page.getByText(/exceeds|280|character limit/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /save draft/i })).toBeDisabled();
  
  // Clear and enter valid content
  await page.locator('[contenteditable="true"]').first().fill('Valid Twitter post!');
  await expect(page.getByRole('button', { name: /save draft/i })).toBeEnabled();
  
  // Save draft
  await page.getByRole('button', { name: /save draft/i }).click();
  await expect(page.getByText(/saved|success/i)).toBeVisible({ timeout: 5000 });
  
  // 3. TEST LINKEDIN CHARACTER LIMIT
  await page.getByRole('button', { name: /new post/i }).click();
  await page.getByRole('button', { name: /linkedin/i }).first().click();
  
  // Try to enter 3100 characters (exceeds 3000)
  await page.locator('[contenteditable="true"]').first().fill('B'.repeat(3100));
  await expect(page.getByText(/exceeds|3000/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /save draft/i })).toBeDisabled();
  
  // Clear and enter valid content
  await page.locator('[contenteditable="true"]').first().fill('Valid LinkedIn post with professional content.');
  await expect(page.getByRole('button', { name: /save draft/i })).toBeEnabled();
  
  // Save and verify
  await page.getByRole('button', { name: /save draft/i }).click();
  await expect(page.getByText(/saved|success/i)).toBeVisible({ timeout: 5000 });
  
  // Done - video captured showing full flow
  await page.screenshot({ path: 'test-results/issue-1-demo-complete.png' });
});