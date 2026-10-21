import { chromium } from 'playwright';

/**
 * Standalone Login Test - Opens Chrome and tests login
 * Run with: npx tsx scripts/test-login-chrome.ts
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3003';
const TEST_EMAIL = 'demo@testuser.com';
const TEST_PASSWORD = 'andcoms';

async function testLogin() {
  console.log('🚀 Starting login test in Chrome...');
  console.log('URL:', BASE_URL);
  
  // Launch Chrome with visible window
  const browser = await chromium.launch({
    headless: false,
    slowMo: 100, // Slow down by 100ms for visibility
  });
  
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });
  
  const page = await context.newPage();
  
  try {
    // Navigate to login page
    console.log('📍 Navigating to login page...');
    await page.goto(`${BASE_URL}/login`);
    await page.waitForLoadState('networkidle');
    
    // Wait for form to be ready
    await page.waitForSelector('#email', { timeout: 10000, state: 'visible' });
    console.log('✅ Login page loaded');
    
    // Fill in email
    console.log('⌨️  Typing email...');
    await page.locator('#email').click();
    await page.waitForTimeout(100);
    await page.keyboard.type(TEST_EMAIL);
    
    // Fill in password
    console.log('⌨️  Typing password...');
    await page.locator('#password').click();
    await page.waitForTimeout(100);
    await page.keyboard.type(TEST_PASSWORD);
    
    // Wait for validation
    await page.waitForTimeout(500);
    
    // Click sign in
    console.log('🖱️  Clicking sign in button...');
    await page.locator('button[type="submit"]').click();
    
    // Wait for navigation
    console.log('⏳ Waiting for navigation...');
    await page.waitForURL(/posts/, { timeout: 10000 });
    
    // Verify logged in
    const currentUrl = page.url();
    console.log('📍 Current URL:', currentUrl);
    
    if (currentUrl.includes('/posts')) {
      console.log('✅ LOGIN SUCCESSFUL!');
      
      // Take success screenshot
      await page.screenshot({ path: 'test-results/login-success.png' });
      console.log('📸 Screenshot saved: test-results/login-success.png');
      
      // Keep browser open for 5 seconds to see result
      console.log('⏱️  Keeping browser open for 5 seconds...');
      await page.waitForTimeout(5000);
    } else {
      console.log('❌ Login failed - did not redirect to /posts');
      await page.screenshot({ path: 'test-results/login-failed.png' });
    }
    
  } catch (error) {
    console.error('❌ Error during login test:', error);
    await page.screenshot({ path: 'test-results/login-error.png' });
  } finally {
    console.log('🔒 Closing browser...');
    await browser.close();
  }
}

// Create test-results directory if needed
import { mkdirSync } from 'fs';
try {
  mkdirSync('test-results', { recursive: true });
} catch {}

console.log('='.repeat(50));
console.log('  LOGIN TEST - CHROME');
console.log('='.repeat(50));
testLogin();
