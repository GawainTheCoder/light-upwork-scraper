import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUTPUT_DIR = path.resolve(process.cwd(), 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'my_profile.json');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const persistentDir = path.resolve(process.cwd(), 'chrome-user-data');
  const context = await chromium.launchPersistentContext(persistentDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1360, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--lang=en-US']
  });
  const page = await context.newPage();

  // Open profile page via avatar menu if possible, else prompt user to open it manually
  await page.goto('https://www.upwork.com/ab/find-work/', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await sleep(2000);

  // Try heuristic to go to profile
  try {
    const profileLink = page.locator('a[href^="/freelancers/~"]');
    if (await profileLink.count()) {
      const href = await profileLink.first().getAttribute('href');
      if (href) {
        await page.goto(new URL(href, 'https://www.upwork.com').toString(), { waitUntil: 'domcontentloaded' });
      }
    }
  } catch {}

  // If not on a profile URL, ask user to navigate to their profile in the opened browser
  const url = page.url();
  if (!/https?:\/\/www\.upwork\.com\/freelancers\/~/.test(url)) {
    console.log('Please navigate to your profile page in the opened browser. Waiting up to 3 minutes...');
    const start = Date.now();
    while (Date.now() - start < 3 * 60 * 1000) {
      if (/https?:\/\/www\.upwork\.com\/freelancers\/~/.test(page.url())) break;
      await sleep(1000);
    }
  }

  // Extract basic fields
  const text = async (selectors) => {
    for (const s of selectors) {
      const el = page.locator(s).first();
      if (await el.count()) {
        const v = (await el.textContent())?.trim();
        if (v) return v;
      }
    }
    return null;
  };

  await sleep(1500);
  const record = {
    url: page.url(),
    name: await text(['main h1', '[data-test="profile-title"]', '[data-qa="freelancer-name"]']),
    title: await text(['[data-test="title"]', '[data-test="profile-overview-title"]', '[data-qa="freelancer-title"]']),
    rate: await text(['[data-test="rate"]', '[data-qa="rate"]']),
    earnings: await text(['text=/Total (earned|earnings)/i', '[data-test="earnings"]', '[data-qa="earnings"]']),
    jobSuccess: await text(['text=/Job Success/i', '[data-test="job-success-score"]', '[data-qa="jss"]']),
    location: await text(['[data-test="location"]', '[data-qa="location"]']),
    scrapedAt: new Date().toISOString()
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(record, null, 2));
  console.log('Saved to', OUTPUT_FILE);

  await context.close();
}

main().catch(err => { console.error(err); process.exit(1); });


