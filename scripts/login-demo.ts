import { chromium } from 'playwright';

/**
 * Login automation script
 * Fills email and password, then signs in
 */
async function main() {
  const browser = await chromium.launch({
    headless: false, // Set to true for headless mode
    slowMo: 100,     // Slow down actions for visibility
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: './login-video/',
      size: { width: 1280, height: 720 },
    },
  });

  const page = await context.newPage();

  // Capture console logs and errors
  page.on('console', msg => console.log('[Browser Console]:', msg.text()));
  page.on('pageerror', err => console.log('[Browser Error]:', err.message));

  console.log('Opening login page...');
  await page.goto('http://localhost:3003/login');

  // Wait for form to be ready
  await page.waitForSelector('#email', { timeout: 10000 });
  console.log('Login page loaded - URL:', page.url());
  
  // Take screenshot before filling
  await page.screenshot({ path: 'login-step1-page-loaded.png' });

  // Fill email using click + fill for better reliability
  console.log('Filling email: demo@testuser.com');
  await page.locator('#email').click();
  await page.locator('#email').fill('demo@testuser.com');
  
  // Verify email was filled
  const emailValue = await page.locator('#email').inputValue();
  console.log('Email field value:', emailValue);

  // Fill password
  console.log('Filling password: andcoms');
  await page.locator('#password').click();
  await page.locator('#password').fill('andcoms');
  
  // Verify password was filled
  const passwordValue = await page.locator('#password').inputValue();
  console.log('Password field value length:', passwordValue.length);

  // Take screenshot after filling
  await page.screenshot({ path: 'login-step2-form-filled.png' });

  // Wait a moment for form validation
  await page.waitForTimeout(500);

  // Click sign in
  console.log('Clicking Sign in...');
  await page.locator('button[type="submit"]').click();

  // Wait for response
  console.log('Waiting after submit...');
  await page.waitForTimeout(2000);
  
  console.log('Current URL after submit:', page.url());
  await page.screenshot({ path: 'login-step3-after-submit.png' });

  // Check for error message
  const errorText = await page.locator('p.text-sm.text-destructive, .text-destructive').textContent().catch(() => null);
  if (errorText) {
    console.log('Error message found:', errorText);
  }

  // Wait for navigation to complete (redirects to /calendar or /posts)
  console.log('Waiting for navigation to dashboard...');
  try {
    await page.waitForURL(/(calendar|drafts)/, { timeout: 10000 });
  } catch (e) {
    console.log('Navigation timeout. Current URL:', page.url());
    await page.screenshot({ path: 'login-timeout.png' });
    
    // Check if we're still on login page with errors
    const bodyText = await page.locator('body').textContent();
    console.log('Page body text (first 500 chars):', bodyText?.substring(0, 500));
    
    await browser.close();
    process.exit(1);
  }

  const currentUrl = page.url();
  console.log('Successfully logged in! Current URL:', currentUrl);

  // Take a screenshot of the logged-in state
  await page.screenshot({ path: 'login-success.png', fullPage: true });
  console.log('Screenshot saved: login-success.png');

  // Keep browser open for a few seconds to see the result
  await page.waitForTimeout(3000);

  await context.close();
  await browser.close();
  console.log('Done!');
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
