import { test, expect } from '@playwright/test';

/**
 * E2E Test: Discord Platform Support (Issue #3)
 * Tests Discord webhook and bot connection flows
 */
test.describe('Discord Platform Integration', () => {
  test('should connect Discord via webhook URL', async ({ page }) => {
    // Navigate to settings
    await page.goto('/settings/channels');
    
    // Wait for page to load
    await expect(page.getByRole('heading', { name: /channels/i })).toBeVisible();
    
    // Click "Add account" or similar button
    await page.getByRole('button', { name: /add account/i }).click();
    
    // Select Discord platform
    await page.getByRole('button', { name: /discord/i }).click();
    
    // Fill in connection name
    await page.getByPlaceholder(/e.g. personal/i).fill('Test Discord Channel');
    
    // Enable webhook mode
    await page.getByLabel(/use webhook url/i).check();
    
    // Enter webhook URL
    await page.getByPlaceholder(/webhook url/i).fill('https://discord.com/api/webhooks/test/test-token');
    
    // Save connection
    await page.getByRole('button', { name: /add channel|save|connect/i }).click();
    
    // Verify success
    await expect(page.getByText(/test discord channel/i)).toBeVisible();
  });
  
  test('should post to Discord channel', async ({ page }) => {
    // Need to have a Discord channel connected first
    await page.goto('/posts');
    
    // Click new post
    await page.getByRole('button', { name: /new post/i }).click();
    
    // Select Discord channel
    await page.getByRole('button', { name: /discord/i }).first().click();
    
    // Add content
    await page.getByRole('textbox').fill('Test message for Discord!');
    
    // Schedule or save
    await page.getByRole('button', { name: /schedule/i }).click();
    
    // Set schedule time (next hour)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0] + 'T10:00';
    
    await page.getByLabel(/schedule/i).or(page.locator('input[type="datetime-local"]')).fill(dateStr);
    
    // Confirm schedule
    await page.getByRole('button', { name: /confirm|schedule post/i }).click();
    
    // Verify post appears in queue
    await page.goto('/posts?status=scheduled');
    await expect(page.getByText(/test message for discord/i)).toBeVisible();
  });
  
  test('should show Discord character limit (2000)', async ({ page }) => {
    await page.goto('/posts');
    await page.getByRole('button', { name: /new post/i }).click();
    
    // Select Discord
    await page.getByRole('button', { name: /discord/i }).first().click();
    
    // Enter text near the limit
    const text = 'A'.repeat(1990);
    await page.getByRole('textbox').fill(text);
    
    // Should show remaining characters
    await expect(page.getByText(/remaining|10 left/i)).toBeVisible();
    
    // Try to exceed limit
    await page.getByRole('textbox').fill('A'.repeat(2100));
    
    // Should show validation error
    await expect(page.getByText(/exceeds|limit/i)).toBeVisible();
  });
});
