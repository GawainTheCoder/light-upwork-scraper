import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// Use a dedicated user data dir to mimic a real Chrome profile
const USER_DATA_DIR = path.resolve(process.cwd(), 'chrome-user-data');
const STORAGE_STATE = path.resolve(process.cwd(), 'auth.json');

async function main() {
  if (!fs.existsSync(USER_DATA_DIR)) fs.mkdirSync(USER_DATA_DIR, { recursive: true });

  const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    channel: 'chrome', // use system Chrome for more realistic fingerprint
    viewport: { width: 1360, height: 900 },
    args: [
      '--disable-blink-features=AutomationControlled',
      '--lang=en-US',
    ],
  });

  const page = await browser.newPage();
  console.log('\nPersistent Chrome launched with profile at:', USER_DATA_DIR);
  console.log('Please log in to Upwork and complete any verification.');

  await page.goto('https://www.upwork.com/ab/account-security/login', { waitUntil: 'domcontentloaded', timeout: 90000 });

  const signedInSelectors = [
    'a[href*="/freelancers/"]',
    'a[href*="/messages/"]',
    'a[href*="/ab/find-work/"]',
    'a[aria-label="Profile"]'
  ];

  const start = Date.now();
  const maxMs = 20 * 60 * 1000; // 20 minutes
  let saved = false;
  while (Date.now() - start < maxMs) {
    for (const sel of signedInSelectors) {
      const count = await page.locator(sel).count();
      if (count > 0) {
        // Save storage state too (helps if we later run non-persistent context)
        await browser.storageState({ path: STORAGE_STATE });
        console.log(`\nSaved session to ${STORAGE_STATE}`);
        saved = true;
        break;
      }
    }
    if (saved) break;
    await page.waitForTimeout(2000);
  }

  if (!saved) {
    console.warn('Timed out waiting for login. Leave Chrome open if you want to keep the session within the user data dir.');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});


