import { test, expect } from '@playwright/test';

/**
 * E2E Test: Issue #1 - Platform Validation & Media Attachment Fixes
 * Full flow: Login → Create Post → Test Validation
 * 
 * Prerequisites:
 * - Dev server running on port 3003
 * - Test account: e2e@test.com / TestPassword123!
 */

test.describe('Issue #1: Platform Validation & Media Attachments - Full Flow', () => {
  
  // Login before all tests
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.waitForSelector('#email', { timeout: 10000, state: 'visible' });
    await page.locator('#email').clear();
    await page.locator('#email').fill('demo@testuser.com');
    await page.locator('#password').clear();
    await page.locator('#password').fill('andcoms');
    await page.waitForTimeout(500);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL(/posts/, { timeout: 10000 });
    await expect(page).toHaveURL(/posts/);
  });

  test('should block Twitter post exceeding 280 characters', async ({ page }) => {
    // Click New Post
    await page.getByRole('button', { name: /new post/i }).click();
    
    // Wait for editor
    await expect(page.getByText(/new post|edit post/i)).toBeVisible();
    
    // Select Twitter
    await page.getByRole('button', { name: /twitter/i }).first().click();
    
    // Type content exceeding 280 chars
    const longContent = 'A'.repeat(300);
    await page.locator('[contenteditable="true"]').first().fill(longContent);
    
    // Verify character limit warning appears
    await expect(page.getByText(/exceeds|280|character limit/i)).toBeVisible();
    
    // Verify save button is disabled
    const saveButton = page.getByRole('button', { name: /save draft/i });
    await expect(saveButton).toBeDisabled();
    
    // Verify schedule button is disabled
    const scheduleButton = page.getByRole('button', { name: /schedule/i });
    await expect(scheduleButton).toBeDisabled();
    
    // Take screenshot for proof
    await page.screenshot({ path: 'test-results/twitter-limit-blocked.png' });
  });

  test('should allow valid Twitter post under 280 characters', async ({ page }) => {
    // Click New Post
    await page.getByRole('button', { name: /new post/i }).click();
    
    // Select Twitter
    await page.getByRole('button', { name: /twitter/i }).first().click();
    
    // Type valid content
    await page.locator('[contenteditable="true"]').first().fill('Test post content that is within limits');
    
    // Verify no error
    await expect(page.getByText(/exceeds|character limit/i)).not.toBeVisible();
    
    // Verify save button is enabled
    await expect(page.getByRole('button', { name: /save draft/i })).toBeEnabled();
    
    // Save the draft
    await page.getByRole('button', { name: /save draft/i }).click();
    
    // Verify success message or redirect
    await expect(page.getByText(/saved|draft saved|success/i)).toBeVisible({ timeout: 5000 });
  });

  test('should block LinkedIn post exceeding 3000 characters', async ({ page }) => {
    // Click New Post
    await page.getByRole('button', { name: /new post/i }).click();
    
    // Select LinkedIn
    await page.getByRole('button', { name: /linkedin/i }).first().click();
    
    // Type content exceeding 3000 chars
    const longContent = 'B'.repeat(3100);
    await page.locator('[contenteditable="true"]').first().fill(longContent);
    
    // Verify character limit warning
    await expect(page.getByText(/exceeds|3000|character limit/i)).toBeVisible();
    
    // Verify save disabled
    await expect(page.getByRole('button', { name: /save draft/i })).toBeDisabled();
  });

  test('should show character counter for remaining count', async ({ page }) => {
    // Click New Post
    await page.getByRole('button', { name: /new post/i }).click();
    
    // Select Twitter
    await page.getByRole('button', { name: /twitter/i }).first().click();
    
    // Type some text
    await page.locator('[contenteditable="true"]').first().fill('Hello world from test suite');
    
    // Verify counter shows remaining
    await expect(page.getByText(/remaining|of 280/i)).toBeVisible();
    
    // Screenshot for proof
    await page.screenshot({ path: 'test-results/character-counter.png' });
  });

  test('should enforce media limits per platform', async ({ page }) => {
    // Click New Post
    await page.getByRole('button', { name: /new post/i }).click();
    
    // Select Twitter
    await page.getByRole('button', { name: /twitter/i }).first().click();
    
    // Add content
    await page.locator('[contenteditable="true"]').first().fill('Post with media attachments');
    
    // Add media (simulate with 5 images to exceed Twitter's 4 limit)
    const fileInput = page.locator('input[type="file"]').first();
    
    // Create test files programmatically
    const files = [
      'e2e/fixtures/test-image-1.jpg',
      'e2e/fixtures/test-image-2.jpg',
      'e2e/fixtures/test-image-3.jpg',
      'e2e/fixtures/test-image-4.jpg',
      'e2e/fixtures/test-image-5.jpg',
    ];
    
    await fileInput.setInputFiles(files);
    
    // Verify warning about media limit
    await expect(page.getByText(/maximum 4|allows maximum 4/i)).toBeVisible();
    
    // Verify save is blocked
    await expect(page.getByRole('button', { name: /save draft/i })).toBeDisabled();
    
    // Screenshot
    await page.screenshot({ path: 'test-results/media-limit-warning.png' });
  });

  test('should support per-platform content customization', async ({ page }) => {
    // Click New Post
    await page.getByRole('button', { name: /new post/i }).click();
    
    // Select multiple platforms
    await page.getByRole('button', { name: /twitter/i }).first().click();
    await page.getByRole('button', { name: /linkedin/i }).first().click();
    
    // Verify "Same content for all" checkbox exists
    const globalToggle = page.getByLabel(/same content for all/i);
    await expect(globalToggle).toBeVisible();
    
    // Uncheck to enable per-platform content
    if (await globalToggle.isChecked()) {
      await globalToggle.click();
    }
    
    // Verify platform tabs appear
    await expect(page.getByRole('button', { name: /twitter/i }).nth(1)).toBeVisible();
    await expect(page.getByRole('button', { name: /linkedin/i }).nth(1)).toBeVisible();
    
    // Add different content for each platform
    // Twitter version (short)
    await page.getByRole('button', { name: /twitter/i }).nth(1).click();
    await page.locator('[contenteditable="true"]').first().fill('Short Twitter version');
    
    // LinkedIn version (longer)
    await page.getByRole('button', { name: /linkedin/i }).nth(1).click();
    await page.locator('[contenteditable="true"]').first().fill('Longer LinkedIn version with more professional context and details for the professional network audience');
    
    // Screenshot showing per-platform customization
    await page.screenshot({ path: 'test-results/per-platform-content.png', fullPage: true });
  });

  test('complete flow: create and schedule valid post', async ({ page }) => {
    // Click New Post
    await page.getByRole('button', { name: /new post/i }).click();
    
    // Select Twitter
    await page.getByRole('button', { name: /twitter/i }).first().click();
    
    // Add valid content
    await page.locator('[contenteditable="true"]').first().fill('Test scheduled post created via E2E test suite on ' + new Date().toISOString());
    
    // Click Schedule
    await page.getByRole('button', { name: /schedule/i }).click();
    
    // Set date/time (tomorrow at 10am)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateTime = tomorrow.toISOString().split('T')[0] + 'T10:00';
    
    await page.locator('input[type="datetime-local"]').fill(dateTime);
    
    // Confirm schedule
    await page.getByRole('button', { name: /schedule post|confirm/i }).click();
    
    // Verify success
    await expect(page.getByText(/scheduled|success/i)).toBeVisible({ timeout: 5000 });
    
    // Navigate to queue and verify post appears
    await page.goto('/posts?status=scheduled');
    await expect(page.getByText(/test scheduled post/i)).toBeVisible();
    
    // Final screenshot
    await page.screenshot({ path: 'test-results/scheduled-post-in-queue.png' });
  });
});
