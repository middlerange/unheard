import { test, expect } from '@playwright/test';

/**
 * E2E Test: Cross-Posting with Per-Platform Customization (Issue #5)
 * Tests the core flow of creating a post with different media for different platforms
 */
test.describe('Cross-Posting with Per-Platform Media', () => {
  test('should allow different media attachments per platform', async ({ page }) => {
    // Navigate to drafts
    await page.goto('/posts');
    
    // Wait for the page to load
    await expect(page.getByText('Select a post from the sidebar')).toBeVisible();
    
    // Click "New post" button
    await page.getByRole('button', { name: /new post/i }).click();
    
    // Wait for post editor to open
    await expect(page.getByText('New Post')).toBeVisible();
    
    // Select multiple platforms (Twitter + LinkedIn)
    await page.getByRole('button', { name: /twitter/i }).first().click();
    await page.getByRole('button', { name: /linkedin/i }).first().click();
    
    // Add content
    await page.getByPlaceholder(/write your post/i).or(page.getByRole('textbox')).fill('Test cross-posting with per-platform media!');
    
    // Switch to per-platform mode (disable "Same content for all platforms")
    const globalToggle = page.getByLabel(/same content for all/i);
    if (await globalToggle.isChecked()) {
      await globalToggle.click();
    }
    
    // Add media for Twitter
    await page.getByRole('button', { name: /twitter/i }).nth(1).click(); // Media tab
    const twitterFileInput = page.locator('input[type="file"]').first();
    await twitterFileInput.setInputFiles('e2e/fixtures/test-image-1.jpg');
    
    // Wait for upload
    await expect(page.getByText('1 item')).toBeVisible();
    
    // Add different media for LinkedIn
    await page.getByRole('button', { name: /linkedin/i }).nth(1).click(); // Media tab
    const linkedinFileInput = page.locator('input[type="file"]').first();
    await linkedinFileInput.setInputFiles('e2e/fixtures/test-image-2.jpg');
    
    // Wait for upload
    await expect(page.getByText('1 item')).toBeVisible();
    
    // Save as draft
    await page.getByRole('button', { name: /save draft/i }).click();
    
    // Verify success (post should be created)
    await expect(page.getByText(/draft saved|saved/i)).toBeVisible({ timeout: 5000 });
  });
  
  test('should validate character limits per platform', async ({ page }) => {
    await page.goto('/posts');
    await page.getByRole('button', { name: /new post/i }).click();
    
    // Select Twitter (280 char limit)
    await page.getByRole('button', { name: /twitter/i }).first().click();
    
    // Try to enter too many characters
    const longText = 'A'.repeat(300);
    await page.getByRole('textbox').fill(longText);
    
    // Should show validation error
    await expect(page.getByText(/exceeds.*limit|too long/i)).toBeVisible();
    
    // Save button should be disabled or show error
    const saveButton = page.getByRole('button', { name: /save draft/i });
    await expect(saveButton).toBeDisabled();
  });
});
