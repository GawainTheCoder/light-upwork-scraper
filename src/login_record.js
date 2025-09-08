import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const STORAGE_STATE = path.resolve(process.cwd(), 'auth.json');

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  console.log('\nLogin window opened. Please log in to Upwork and complete any human verification.');
  console.log('After you see your Upwork home/profile page, return to this terminal to save the session.');

  // Navigate to login page
  await page.goto('https://www.upwork.com/ab/account-security/login', { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Poll for a signed-in indicator (navbar avatar, messages link, or profile link)
  const signedInSelectors = [
    'a[href*="/freelancers/"]',
    'a[href*="/messages/"]',
    'a[href*="/ab/find-work/"]',
    'a[aria-label="Profile"]'
  ];

  // Give ample time for manual login
  const start = Date.now();
  const maxMs = 15 * 60 * 1000; // 15 minutes
  let saved = false;
  while (Date.now() - start < maxMs) {
    for (const sel of signedInSelectors) {
      const count = await page.locator(sel).count();
      if (count > 0) {
        await context.storageState({ path: STORAGE_STATE });
        console.log(`\nSaved session to ${STORAGE_STATE}`);
        saved = true;
        break;
      }
    }
    if (saved) break;
    await page.waitForTimeout(2000);
  }

  if (!saved) {
    console.warn('Timed out waiting for login. Please re-run and complete login within 15 minutes.');
  }

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


