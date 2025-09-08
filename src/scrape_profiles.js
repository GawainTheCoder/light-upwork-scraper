import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SEARCH_TERMS = [
  'market research'
];

const MAX_PROFILES = 10; // target sample size
const OUTPUT_DIR = path.resolve(process.cwd(), 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'profiles.jsonl');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureOutput() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(OUTPUT_FILE)) fs.writeFileSync(OUTPUT_FILE, '');
}

function writeJsonl(record) {
  fs.appendFileSync(OUTPUT_FILE, JSON.stringify(record) + '\n');
}

async function collectProfileLinksFromSearch(page) {
  // Collect profile links from current search results page
  const links = await page.$$eval('a[href^="/freelancers/~"]', as => as
    .map(a => new URL(a.getAttribute('href'), location.origin).toString())
  );
  return Array.from(new Set(links));
}

async function maybeWaitForHumanCheck(page) {
  try {
    const found = await page.locator('text=Verifying You Are Human,Verifying you are human').first().isVisible({ timeout: 2000 }).catch(() => false);
    if (found) {
      console.log('Human verification detected. Please complete the verification in the opened browser...');
      // Wait until the text is gone
      await page.waitForFunction(() => !document.body.innerText.match(/Verifying you are human/i), { timeout: 10 * 60 * 1000 });
      console.log('Human verification cleared. Continuing...');
    }
  } catch {}
}

async function gotoWithPacing(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await maybeWaitForHumanCheck(page);
  await sleep(3000 + Math.floor(Math.random() * 4000));
}

async function extractProfile(page, url) {
  // Guard: only process valid freelancer profile URLs
  if (!/^https?:\/\/www\.upwork\.com\/freelancers\/~[A-Za-z0-9]+/.test(url)) {
    return null;
  }
  // Capture XHR/GraphQL responses for structured data (best-effort) BEFORE navigation
  const networkData = { skills: [] };
  const seenResponses = new Set();
  function tryCollectFromObject(obj) {
    try {
      const stack = [obj];
      while (stack.length) {
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object') continue;
        // name
        if (!networkData.name && typeof cur.name === 'string') networkData.name = cur.name;
        if (!networkData.name && typeof cur.fullName === 'string') networkData.name = cur.fullName;
        if (!networkData.name && typeof cur.displayName === 'string') networkData.name = cur.displayName;
        // title/headline
        if (!networkData.headline && typeof cur.title === 'string') networkData.headline = cur.title;
        if (!networkData.headline && typeof cur.headline === 'string') networkData.headline = cur.headline;
        // rate
        if (!networkData.rate && (typeof cur.hourlyRate === 'number' || typeof cur.hourlyRate === 'string')) networkData.rate = cur.hourlyRate;
        if (!networkData.rate && (typeof cur.rate === 'number' || typeof cur.rate === 'string')) networkData.rate = cur.rate;
        // earnings
        if (!networkData.earnings && (typeof cur.totalEarnings === 'number' || typeof cur.totalEarnings === 'string')) networkData.earnings = cur.totalEarnings;
        if (!networkData.earnings && (typeof cur.totalEarned === 'number' || typeof cur.totalEarned === 'string')) networkData.earnings = cur.totalEarned;
        if (!networkData.earnings && (typeof cur.earnings === 'number' || typeof cur.earnings === 'string')) networkData.earnings = cur.earnings;
        // jss
        if (!networkData.jobSuccess && (typeof cur.jobSuccessScore === 'number' || typeof cur.jobSuccessScore === 'string')) networkData.jobSuccess = cur.jobSuccessScore;
        if (!networkData.jobSuccess && (typeof cur.jss === 'number' || typeof cur.jss === 'string')) networkData.jobSuccess = cur.jss;
        if (!networkData.jobSuccess && typeof cur.jobSuccess === 'string') networkData.jobSuccess = cur.jobSuccess;
        // location
        if (!networkData.location && typeof cur.location === 'string') networkData.location = cur.location;
        if (!networkData.location && typeof cur.country === 'string') networkData.location = cur.country;
        if (!networkData.location && typeof cur.city === 'string') networkData.location = cur.city;
        // skills
        if (Array.isArray(cur.skills)) {
          for (const s of cur.skills) {
            if (typeof s === 'string') networkData.skills.push(s);
            else if (s && typeof s === 'object' && typeof s.name === 'string') networkData.skills.push(s.name);
          }
        }
        for (const k of Object.keys(cur)) {
          const v = cur[k];
          if (v && typeof v === 'object') stack.push(v);
        }
      }
    } catch {}
  }

  const onResponse = async (resp) => {
    try {
      const url = resp.url();
      if (!/graphql|api|profile|talent/i.test(url)) return;
      const key = url + ':' + resp.status();
      if (seenResponses.has(key)) return;
      seenResponses.add(key);
      const headers = await resp.headers();
      const ct = headers['content-type'] || headers['Content-Type'] || '';
      if (!ct.includes('application/json')) return;
      const json = await resp.json().catch(() => null);
      if (json) tryCollectFromObject(json);
    } catch {}
  };
  page.on('response', onResponse);

  await gotoWithPacing(page, url);
  try { await page.waitForLoadState('networkidle', { timeout: 20000 }); } catch {}
  // Gentle scroll to trigger lazy content
  for (let i = 0; i < 2; i++) {
    await page.mouse.wheel(0, 1000);
    await sleep(1000);
  }

  const text = async (selectorList) => {
    for (const selector of selectorList) {
      const el = await page.locator(selector).first();
      if (await el.count()) {
        const v = (await el.textContent())?.trim();
        if (v) return v;
      }
    }
    return null;
  };

  const allTexts = async (selector) => {
    try {
      const els = await page.locator(selector);
      const count = await els.count();
      const out = [];
      for (let i = 0; i < count; i++) {
        const v = (await els.nth(i).textContent())?.trim();
        if (v) out.push(v);
      }
      return out;
    } catch {
      return [];
    }
  };

  // Wait for main content + some network to settle
  try { await page.waitForSelector('main', { timeout: 20000 }); } catch {}
  await sleep(1500);

  const record = {
    url,
    name: await text(['main h1', '[data-test="profile-title"]', '[data-qa="freelancer-name"]', 'h1']),
    headline: await text(['[data-test="title"]', '[data-test="profile-overview-title"]', '[data-qa="freelancer-title"]', 'main h2']),
    rate: await text(['[data-test="rate"]', '[data-qa="rate"]', 'text=/\$\s*\d[\d,]*(?:\.\d+)?\s*\/\s*hr/i']),
    earnings: await text(['text=/Total (earned|earnings)/i', '[data-test="earnings"]', '[data-qa="earnings"]']),
    jobSuccess: await text(['text=/Job Success/i', '[data-test="job-success-score"]', '[data-qa="jss"]']),
    location: await text(['[data-test="location"]', '[data-qa="location"]']),
    skills: await allTexts('[data-test="skill-list"] li, [data-qa="skill"]'),
    scrapedAt: new Date().toISOString()
  };

  // Fallbacks using page text
  try {
    const mainText = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    if (!record.rate) {
      const m = mainText.match(/\$\s*([\d,]+(?:\.\d+)?)\s*\/\s*hr/i);
      if (m) record.rate = `$${m[1]}/hr`;
    }
    if (!record.earnings) {
      const m = mainText.match(/Total\s*(?:earned|earnings)[^\d]*\$?\s*([\d.,]+\+?\s*[kKmM]?)/i);
      if (m) record.earnings = m[0].trim();
    }
    if (!record.jobSuccess) {
      const m = mainText.match(/Job\s*Success\s*(\d{1,3})%/i);
      if (m) record.jobSuccess = `${m[1]}%`;
    }
  } catch {}

  // Merge any network-derived values
  if (!record.name && networkData.name) record.name = String(networkData.name);
  if (!record.headline && networkData.headline) record.headline = String(networkData.headline);
  if (!record.rate && networkData.rate) record.rate = String(networkData.rate).toString();
  if (!record.earnings && networkData.earnings) record.earnings = String(networkData.earnings).toString();
  if (!record.jobSuccess && networkData.jobSuccess) record.jobSuccess = String(networkData.jobSuccess).toString();
  if (!record.location && networkData.location) record.location = String(networkData.location);
  if (record.skills.length === 0 && Array.isArray(networkData.skills) && networkData.skills.length > 0) {
    record.skills = Array.from(new Set(networkData.skills));
  }

  // Derive name if only headline captured a short name
  if (!record.name && record.headline && /[A-Za-z]/.test(record.headline)) {
    record.name = record.headline;
  }

  page.off('response', onResponse);

  return record;
}

async function main() {
  await ensureOutput();
  const persistentDir = path.resolve(process.cwd(), 'chrome-user-data');
  if (!fs.existsSync(persistentDir)) fs.mkdirSync(persistentDir, { recursive: true });
  const context = await chromium.launchPersistentContext(persistentDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1360, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--lang=en-US']
  });
  const page = await context.newPage();

  const collected = new Set();

  for (const term of SEARCH_TERMS) {
    if (collected.size >= MAX_PROFILES) break;
    const encoded = encodeURIComponent(term);
    const urlsToTry = [
      `https://www.upwork.com/nx/search/talent/?q=${encoded}`,
      `https://www.upwork.com/search/profiles/?q=${encoded}`
    ];

    let links = [];
    for (const searchUrl of urlsToTry) {
      console.log('Navigating to search:', searchUrl);
      await gotoWithPacing(page, searchUrl);

      // Attempt to scroll to load more results
      for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, 1200);
        await sleep(1500 + Math.floor(Math.random() * 1500));
      }

      links = await collectProfileLinksFromSearch(page);
      // Filter only true profile URLs and normalize by stripping query/hash
      links = links
        .filter(h => /^https?:\/\/www\.upwork\.com\/freelancers\/~[A-Za-z0-9]+/.test(h))
        .map(h => h.split('?')[0].split('#')[0]);
      console.log(`Found ${links.length} candidate profile links on this page.`);
      if (links.length > 0) break;

      // Screenshot if empty
      await page.screenshot({ path: path.join(OUTPUT_DIR, `search_empty_${Date.now()}.png`), fullPage: true });
    }

    for (const link of links) {
      if (collected.size >= MAX_PROFILES) break;
      if (collected.has(link)) continue;
      try {
        const rec = await extractProfile(page, link);
        writeJsonl(rec);
        collected.add(link);
        console.log(`Scraped ${collected.size}/${MAX_PROFILES}: ${link}`);
        await sleep(2000 + Math.floor(Math.random() * 3000));
      } catch (e) {
        console.warn('Error on profile, capturing screenshot and continuing...', e?.message || e);
        await page.screenshot({ path: path.join(OUTPUT_DIR, `error_${Date.now()}.png`) });
      }
    }
  }

  await context.close();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});


