import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const SEARCH_TERMS = [
  'market research'
];

const MAX_PROFILES = 3; // target sample size for iterative tests
const OUTPUT_DIR = path.resolve(process.cwd(), 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'profiles.jsonl');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseCurrencySymbolToCode(symbol) {
  if (!symbol) return null;
  const s = symbol.trim();
  if (s === '$') return 'USD';
  if (s === '€') return 'EUR';
  if (s === '£') return 'GBP';
  if (s === 'A$') return 'AUD';
  if (s === 'C$') return 'CAD';
  return null;
}

function parseHourlyRateToAmountCurrency(rateText) {
  if (!rateText) return { amount: null, currency: null };
  const m = rateText.match(/([€£$]|A\$|C\$)?\s*([\d,]+(?:\.\d+)?)/);
  const symbol = m?.[1] || (rateText.includes('$') ? '$' : null);
  const currency = parseCurrencySymbolToCode(symbol);
  const amount = m ? Number(m[2].replace(/,/g, '')) : null;
  return { amount: Number.isFinite(amount) ? amount : null, currency };
}

function parseHumanNumberToFloat(str) {
  if (!str) return null;
  const cleaned = str.replace(/[^0-9.kKmM+]/g, '').toLowerCase();
  const km = cleaned.match(/([0-9]+(?:\.[0-9]+)?)([km]?)/);
  if (!km) return null;
  let n = parseFloat(km[1]);
  const suffix = km[2];
  if (suffix === 'k') n *= 1_000;
  if (suffix === 'm') n *= 1_000_000;
  return n;
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
  // Skip your own profile (Ashter H.)
  if (url.includes('017e74df6dc8e4333e')) {
    console.log('Skipping own profile:', url);
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
        // jobs/hours counters
        if (!networkData.totalJobs && (typeof cur.totalJobs === 'number' || typeof cur.jobsCompleted === 'number')) networkData.totalJobs = cur.totalJobs || cur.jobsCompleted;
        if (!networkData.totalHours && (typeof cur.totalHours === 'number' || typeof cur.hoursWorked === 'number')) networkData.totalHours = cur.totalHours || cur.hoursWorked;
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
  // Deeper scroll to bottom to mount lazy sections
  try {
    const maxPasses = 6;
    let lastY = 0;
    for (let i = 0; i < maxPasses; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
      await sleep(800);
      const y = await page.evaluate(() => window.scrollY);
      if (y === lastY) break;
      lastY = y;
    }
  } catch {}

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

  // Helpers for meta tags and page text
  const getMeta = async (name, by = 'property') => {
    try {
      const selector = by === 'name' ? `meta[name="${name}"]` : `meta[property="${name}"]`;
      const el = page.locator(selector).first();
      if (await el.count()) {
        const c = await el.getAttribute('content');
        return c ? c.trim() : null;
      }
    } catch {}
    return null;
  };
  let mainText = '';
  try { mainText = (await page.locator('main').innerText()).replace(/\s+/g, ' '); } catch {}
  let bodyText = '';
  try { bodyText = (await page.locator('body').innerText()).replace(/\s+/g, ' '); } catch {}

  // Derive externalId and source
  const externalIdMatch = url.match(/freelancers\/~([A-Za-z0-9]+)/);
  const externalId = externalIdMatch ? externalIdMatch[1] : null;

  const record = {
    url,
    source: 'upwork',
    externalId,
    name: await text(['[data-qa="freelancer-name"]', '[data-test="profile-title"]', 'main h1', 'h1']),
    headline: await text(['[data-qa="freelancer-title"]', '[data-test="title"]', '[data-test="profile-overview-title"]']),
    rate: await text(['[data-test="rate"]', '[data-qa="rate"]', 'text=/\$\s*\d[\d,]*(?:\.\d+)?\s*\/\s*hr/i']),
    earnings: await text(['text=/Total (earned|earnings)/i', '[data-test="earnings"]', '[data-qa="earnings"]']),
    jobSuccess: await text(['text=/Job Success/i', '[data-test="job-success-score"]', '[data-qa="jss"]']),
    location: await text(['[data-test="location"]', '[data-qa="location"]']),
    skills: await allTexts('[data-test="skill-list"] li, [data-qa="skill"]'),
    scrapedAt: new Date().toISOString()
  };

  // Meta-based fallbacks and label overrides
  const ogTitle = await getMeta('og:title', 'property') || await getMeta('twitter:title', 'name');
  if ((!record.name || /^treatment$/i.test(record.name)) && ogTitle) {
    const cleaned = ogTitle.split('|')[0].split('-')[0].trim();
    if (/[A-Za-z]/.test(cleaned)) record.name = cleaned;
  }
  const ogDesc = await getMeta('og:description', 'property') || await getMeta('twitter:description', 'name');
  if (!record.headline && ogDesc) {
    const snippet = ogDesc.split('\n')[0].trim();
    if (snippet && snippet.length <= 160) record.headline = snippet;
  }

  // Additional name fallback using document.title and token filter
  try {
    const tokensToIgnore = /^(treatment|control|view profile|all work)$/i;
    if (!record.name || tokensToIgnore.test(String(record.name))) {
      const docTitle = await page.title();
      if (docTitle) {
        const cand = docTitle.split('|')[0].split('-')[0].trim();
        if (cand && !tokensToIgnore.test(cand) && /[A-Za-z]/.test(cand)) {
          record.name = cand;
        }
      }
    }
  } catch {}

  // Fallbacks using page text (override labels with actual values)
  if (!record.rate || /\/hr$/i.test(record.rate) === false) {
    const m = mainText.match(/\$\s*([\d,]+(?:\.\d+)?)\s*\/\s*hr/i);
    if (m) record.rate = `$${m[1]}/hr`;
  }
  // Stronger earnings first (prefer patterns with currency/suffix)
  if (!record.earnings || !/[\$€£]|[kKmM]\+?/.test(record.earnings)) {
    const t = bodyText || mainText;
    // Look for "$10K+" or "$1.2M+" patterns first
    let em = t.match(/\$\s*[\d.,]+\s*[kKmM]\+/i);
    if (!em) em = t.match(/Total\s*(?:earned|earnings)[^$]*(\$\s*[\d.,]+\s*[kKmM]?\+?)/i);
    if (!em) em = t.match(/Earned\s*(\$\s*[\d.,]+\s*[kKmM]?\+?)/i);
    if (em) record.earnings = (em[1] || em[0]).replace(/\s+/g, ' ').trim();
  }
  {
    let m = (bodyText || mainText).match(/Job\s*Success\s*(\d{1,3})%/i);
    if (!m) m = (bodyText || mainText).match(/(\d{1,3})%\s*Job\s*Success/i);
    if (m) {
      record.jobSuccess = `${m[1]}%`;
    } else if (record.jobSuccess && /job\s*success/i.test(record.jobSuccess) && !/\d/.test(record.jobSuccess)) {
      // Avoid keeping label-only values
      record.jobSuccess = null;
    }
  }
  if (!record.location) {
    // Prefer pattern following 'Verified' if present; avoid broad generic matches to prevent noise
    const m = mainText.match(/Verified\s+([A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+)/);
    if (m) record.location = m[1];
  }
  if (record.location) {
    // Clean common noise tokens
    record.location = record.location
      .replace(/\b(Offline|Online|Verified|Share)\b/gi, '')
      .replace(new RegExp(record.name?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') || '', 'gi'), '')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .replace(/[|•]+$/g, '')
      .trim();
  }

  // Job Success via aria attributes (progress widgets etc.)
  if (!record.jobSuccess) {
    try {
      const jssInfo = await page.evaluate(() => {
        const el = document.querySelector('[aria-label*="Job Success" i], [title*="Job Success" i], [role="progressbar"]');
        if (!el) return null;
        const aria = el.getAttribute('aria-label') || el.getAttribute('title');
        const valNow = el.getAttribute('aria-valuenow');
        return { aria, valNow };
      });
      if (jssInfo) {
        if (jssInfo.valNow && /^\d{1,3}$/.test(jssInfo.valNow)) record.jobSuccess = `${jssInfo.valNow}%`;
        else if (jssInfo.aria) {
          const m = jssInfo.aria.match(/(\d{1,3})%/);
          if (m) record.jobSuccess = `${m[1]}%`;
        }
      }
    } catch {}
  }

  // Parse stats block more precisely to avoid jobs/hours confusion
  try {
    const statsText = await page.evaluate(() => {
      // Look for the stats container with earnings/jobs/hours
      const containers = Array.from(document.querySelectorAll('div, section')).filter(el => {
        const text = el.innerText || '';
        return /Total\s+(earnings|jobs|hours)/i.test(text);
      });
      return containers.map(c => c.innerText).join(' ');
    });
    
    if (statsText) {
      // Parse earnings, jobs, and hours from the stats block context
      const earningsMatch = statsText.match(/\$([\d,]+(?:\.\d+)?)\s*Total\s+earnings/i);
      if (earningsMatch) record.earnings = `$${earningsMatch[1]}`;
      
      const jobsMatch = statsText.match(/([\d,]+)\s*Total\s+jobs/i);
      if (jobsMatch) record.totalJobs = Number(jobsMatch[1].replace(/,/g, ''));
      
      const hoursMatch = statsText.match(/([\d,]+)\s*Total\s+hours/i);
      if (hoursMatch) record.totalHours = Number(hoursMatch[1].replace(/,/g, ''));
    }
  } catch {}

  // Fallback: only if not found in stats block
  if (!record.totalJobs) {
    const jm = (bodyText || mainText).match(/Total\s+jobs\s+([\d,]+)/i);
    if (jm) record.totalJobs = Number(jm[1].replace(/,/g, ''));
  }
  if (!record.totalHours) {
    const hm = (bodyText || mainText).match(/Total\s+hours\s+([\d,]+)/i);
    if (hm) record.totalHours = Number(hm[1].replace(/,/g, ''));
  }

  // Remove redundant earnings pattern (already handled above)

  // Languages: try DOM near a section titled Languages; fallback to heuristic parsing
  if (!record.languages) {
    try {
      // Expand Languages section if truncated
      try {
        const langHeading = page.locator('h2:has-text("Languages"), h3:has-text("Languages")').first();
        if (await langHeading.count()) {
          const sec = langHeading.locator('xpath=ancestor::*[self::section or self::div][1]');
          const moreBtn = sec.locator('button:has-text("See more"), button:has-text("Show more")');
          if (await moreBtn.count()) {
            await moreBtn.first().click({ timeout: 2000 }).catch(() => {});
            await sleep(500);
          }
        }
      } catch {}
      const langs = await page.evaluate(() => {
        function text(el){return (el?.textContent||'').trim()}
        const sections = Array.from(document.querySelectorAll('section,div'));
        for (const sec of sections) {
          const heading = text(sec.querySelector('h2, h3'));
          if (/^languages$/i.test(heading)) {
            const items = [];
            const rows = sec.querySelectorAll('li, div, span');
            rows.forEach(r => {
              const t = text(r);
              // Match "English — Fluent" or "Spanish: Conversational"
              const m = t.match(/([A-Za-z][A-Za-z \-]+)\s*[—:()\-]*\s*(Native|Fluent|Conversational|Basic|Professional|Bilingual|Limited|Full\s*professional|Elementary)/i);
              if (m) items.push({ name: m[1].trim(), level: m[2].trim() });
            });
            if (items.length) return items;
          }
        }
        return [];
      });
      if (langs && langs.length) record.languages = langs;
    } catch {}
  }
  if (!record.languages) {
    const t = bodyText || mainText;
    const matches = [...t.matchAll(/\b(English|Spanish|French|German|Italian|Portuguese|Arabic|Hindi|Urdu|Bengali|Chinese|Japanese|Korean|Ukrainian|Russian|Polish|Turkish)\b\s*[—:-]\s*(Native|Fluent|Conversational|Basic|Professional|Bilingual|Limited|Full\s*professional|Elementary)/gi)];
    if (matches.length) {
      record.languages = matches.map(m => ({ name: m[1], level: m[2] }));
    }
  }

  // Skills: section-based parsing (more robust)
  if (!record.skills || record.skills.length === 0) {
    try {
      // Expand Skills section if truncated
      try {
        const skillsHeading = page.locator('h2:has-text("Skills"), h3:has-text("Skills"), h2:has-text("Skills and expertise"), h3:has-text("Skills and expertise")').first();
        if (await skillsHeading.count()) {
          const sec = skillsHeading.locator('xpath=ancestor::*[self::section or self::div][1]');
          const moreBtn = sec.locator('button:has-text("See more"), button:has-text("Show more")');
          if (await moreBtn.count()) {
            await moreBtn.first().click({ timeout: 2000 }).catch(() => {});
            await sleep(500);
          }
        }
      } catch {}
      const skills = await page.evaluate(() => {
        function text(el){return (el?.textContent||'').trim()}
        const sections = Array.from(document.querySelectorAll('section,div'));
        for (const sec of sections) {
          const heading = text(sec.querySelector('h2, h3'));
          if (/^(skills|skills and expertise)$/i.test(heading)) {
            const chips = Array.from(sec.querySelectorAll('[data-test*="skill" i], ul li, a[href*="/o/profiles/skills/"], a, button, span'))
              .map(x => text(x))
              .filter(Boolean);
            // Keep medium-length tokens to avoid noise
            const filtered = chips.filter(s => s.length >= 2 && s.length <= 40);
            const uniq = Array.from(new Set(filtered));
            if (uniq.length) return uniq;
          }
        }
        return [];
      });
      if (skills && skills.length) {
        record.skills = Array.from(new Set([...(record.skills||[]), ...skills]));
      }
    } catch {}
  }

  // Categories: section-based parsing
  if (!record.categories) {
    try {
      const cats = await page.evaluate(() => {
        function text(el){return (el?.textContent||'').trim()}
        const sections = Array.from(document.querySelectorAll('section,div'));
        for (const sec of sections) {
          const heading = text(sec.querySelector('h2, h3'));
          if (/^categories$/i.test(heading)) {
            const chips = Array.from(sec.querySelectorAll('a, button, span')).map(x => text(x)).filter(Boolean);
            const filtered = chips.filter(s => s.length >= 2 && s.length <= 60);
            const uniq = Array.from(new Set(filtered));
            if (uniq.length) return uniq;
          }
        }
        return [];
      });
      if (cats && cats.length) record.categories = cats;
    } catch {}
  }

  // Merge any network-derived values
  if (!record.name && networkData.name) record.name = String(networkData.name);
  if (!record.headline && networkData.headline) record.headline = String(networkData.headline);
  if (!record.rate && networkData.rate) record.rate = String(networkData.rate).toString();
  if (!record.earnings && networkData.earnings) record.earnings = String(networkData.earnings).toString();
  if (!record.jobSuccess && networkData.jobSuccess) record.jobSuccess = String(networkData.jobSuccess).toString();
  if (!record.location && networkData.location) record.location = String(networkData.location);
  if (!record.totalJobs && networkData.totalJobs) record.totalJobs = Number(networkData.totalJobs);
  if (!record.totalHours && networkData.totalHours) record.totalHours = Number(networkData.totalHours);
  if (record.skills.length === 0 && Array.isArray(networkData.skills) && networkData.skills.length > 0) {
    record.skills = Array.from(new Set(networkData.skills));
  }

  // Derive name if only headline captured a short name
  if (!record.name && record.headline && /[A-Za-z]/.test(record.headline)) {
    record.name = record.headline;
  }

  // Prevent headline=name duplicates
  if (record.headline && record.name && record.headline === record.name) {
    record.headline = null;
  }

  // Additional DOM-based collections for skills (broader fallback)
  try {
    if (!record.skills || record.skills.length === 0) {
      // Try multiple skill selector patterns
      const patterns = [
        'a[href*="/o/profiles/skills/"]',
        '[data-test*="skill"]',
        '[data-qa*="skill"]',
        'span[class*="skill"]',
        'div[class*="skill"] span',
        'ul li span', // generic skill chips
        'button[aria-label*="skill"]'
      ];
      
      for (const pattern of patterns) {
        try {
          const domSkills = await page.$$eval(pattern, as => Array.from(new Set(as.map(a => (a.textContent || '').trim()).filter(Boolean))));
          const filtered = domSkills.filter(s => s.length >= 2 && s.length <= 50 && !/^(see more|show more|skills|expertise)$/i.test(s));
          if (filtered.length) {
            record.skills = Array.from(new Set([...(record.skills || []), ...filtered]));
            break;
          }
        } catch {}
      }
    }
  } catch {}
  try {
    const domCategories = await page.$$eval('a[href*="/o/profiles/categories/"]', as => Array.from(new Set(as.map(a => (a.textContent || '').trim()).filter(Boolean))));
    if (domCategories.length) record.categories = domCategories;
  } catch {}

  // Badges
  const badges = [];
  if (/Top\s*Rated\s*Plus/i.test(mainText)) badges.push('top_rated_plus');
  else if (/Top\s*Rated/i.test(mainText)) badges.push('top_rated');
  if (badges.length) record.badges = badges;

  // Availability
  const avail = mainText.match(/(More than 30 hrs\/week|Less than 30 hrs\/week|As needed)/i);
  if (avail) record.availability = avail[1];

  // Hours billed/worked
  const hours = (bodyText || mainText).match(/([\d.,]+)\s+(?:hours|hrs|h)\s+(?:worked|billed)/i);
  if (hours) {
    const val = parseHumanNumberToFloat(hours[1]);
    if (val !== null) record.hoursBilled = val;
  }

  // Last active & Member since
  const lastActive = mainText.match(/Last\s+active\s+([^|\n]+)/i);
  if (lastActive) record.lastActive = lastActive[1].trim();
  const memberSince = mainText.match(/Member\s+since\s+([A-Za-z]+\s+\d{4})/i);
  if (memberSince) record.memberSince = memberSince[1];

  // Timezone
  const tz = mainText.match(/\b(GMT|UTC)\s*[+\-]\s*\d{1,2}(?::\d{2})?/i);
  if (tz) record.timezone = tz[0].replace(/\s+/g, '');

  // Normalize rate amount/currency
  const { amount: rateAmount, currency } = parseHourlyRateToAmountCurrency(record.rate);
  if (rateAmount !== null) record.hourlyRate = rateAmount;
  if (currency) record.currency = currency;

  // Normalize JSS numeric
  if (record.jobSuccess) {
    const jm = String(record.jobSuccess).match(/(\d{1,3})/);
    if (jm) record.jobSuccessScore = Number(jm[1]);
  }

  // Normalize earnings total numeric
  if (record.earnings) {
    const em = String(record.earnings).match(/\$?\s*([\d.,]+\+?\s*[kKmM]?)/);
    const val = em ? parseHumanNumberToFloat(em[1]) : null;
    if (val !== null) record.earningsTotal = val;
  }

  // Cleanup: remove raw fields after parsing
  if (record.rate) delete record.rate;
  if (record.earnings) delete record.earnings;
  if (record.jobSuccess) delete record.jobSuccess;

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
        if (rec) {
          writeJsonl(rec);
          collected.add(link);
          console.log(`Scraped ${collected.size}/${MAX_PROFILES}: ${link}`);
          await sleep(2000 + Math.floor(Math.random() * 3000));
        }
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


