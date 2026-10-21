import { test, expect } from '@playwright/test';

/**
 * E2E Test: Analytics Dashboard (Issue #4)
 * Tests the analytics dashboard functionality
 */
test.describe('Analytics Dashboard', () => {
  test('should display analytics dashboard', async ({ page }) => {
    // Navigate to analytics
    await page.goto('/analytics');
    
    // Wait for dashboard to load
    await expect(page.getByRole('heading', { name: /analytics dashboard/i })).toBeVisible();
    
    // Verify summary cards are present
    await expect(page.getByText(/total impressions/i)).toBeVisible();
    await expect(page.getByText(/total engagements/i)).toBeVisible();
    await expect(page.getByText(/engagement rate/i)).toBeVisible();
    await expect(page.getByText(/posts published/i)).toBeVisible();
    
    // Verify chart sections
    await expect(page.getByText(/impressions.*engagements over time/i)).toBeVisible();
    await expect(page.getByText(/platform breakdown/i)).toBeVisible();
  });
  
  test('should filter by platform', async ({ page }) => {
    await page.goto('/analytics');
    
    // Open platform filter
    await page.getByRole('combobox').filter({ hasText: /all platforms|platform/i }).first().click();
    
    // Select Twitter
    await page.getByRole('option', { name: /twitter/i }).click();
    
    // Verify filter applied (numbers should update)
    await expect(page.getByText(/twitter/i).first()).toBeVisible();
  });
  
  test('should filter by date range', async ({ page }) => {
    await page.goto('/analytics');
    
    // Open date range filter
    await page.getByRole('combobox').filter({ hasText: /last 30 days|7 days|90 days/i }).first().click();
    
    // Select 7 days
    await page.getByRole('option', { name: /last 7 days/i }).click();
    
    // Verify dashboard still loads
    await expect(page.getByText(/total impressions/i)).toBeVisible();
  });
  
  test('should export analytics to CSV', async ({ page }) => {
    await page.goto('/analytics');
    
    // Click export button
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /export/i }).click(),
    ]);
    
    // Verify download started
    expect(download.suggestedFilename()).toMatch(/analytics.*\.csv/i);
  });
  
  test('should display top performing posts', async ({ page }) => {
    await page.goto('/analytics');
    
    // Verify top posts section
    await expect(page.getByText(/top performing posts/i)).toBeVisible();
    
    // Should show at least one post with metrics
    await expect(page.getByText(/impressions/i).nth(1)).toBeVisible();
    await expect(page.getByText(/engagements/i).nth(1)).toBeVisible();
  });
});
