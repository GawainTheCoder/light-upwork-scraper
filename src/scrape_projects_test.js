import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// Configuration
const OUTPUT_DIR = path.resolve(process.cwd(), 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'projects_test.json');

// Read project URLs from XML sitemap
const SITEMAP_PATH = path.resolve(process.cwd(), 'data/sitemap-catalog-projects-10-.xml');
const xmlContent = fs.readFileSync(SITEMAP_PATH, 'utf-8');
const urlMatches = xmlContent.match(/<loc>(https?:\/\/[^<]+)<\/loc>/g) || [];
const allUrls = urlMatches.map(url => url.replace(/<\/?loc>/g, ''));
const PROJECT_URLS = allUrls.slice(0, 5); // Use only first 5 URLs

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureOutput() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

async function maybeWaitForHumanCheck(page) {
  try {
    const found = await page.locator('text=Verifying You Are Human,Verifying you are human').first().isVisible({ timeout: 2000 }).catch(() => false);
    if (found) {
      console.log('Human verification detected. Please complete the verification in the opened browser...');
      await page.waitForFunction(() => !document.body.innerText.match(/Verifying you are human/i), { timeout: 10 * 60 * 1000 });
      console.log('Human verification cleared. Continuing...');
    }
  } catch {}
}

async function gotoWithPacing(page, url) {
  console.log(`Navigating to: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await maybeWaitForHumanCheck(page);
  await sleep(3000 + Math.floor(Math.random() * 2000));
}

// New function: extract project data by URL
async function extractProject(page, url) {
  console.log('Extracting project data...');

  // Validate it is a valid Project Catalog URL (services/product)
  if (!/^https?:\/\/www\.upwork\.com\/services\/product\/[A-Za-z0-9-]+-\d+/.test(url)) {
    console.error('Invalid URL. Must be a valid Upwork Project Catalog URL.');
    return null;
  }

  await gotoWithPacing(page, url);

  // Wait for main content to load
  try {
    await page.waitForSelector('main', { timeout: 20000 });
    console.log('Main content loaded');
  } catch {
    console.log('Main content not found, continuing...');
  }

  await sleep(2000);

  // Local helpers (same as profile to keep reference intact)
  const getText = async (selectors) => {
    for (const selector of selectors) {
      try {
        const element = await page.locator(selector).first();
        if (await element.count() > 0) {
          const text = (await element.textContent())?.trim();
          if (text) return text;
        }
      } catch {}
    }
    return null;
  };

  const getTexts = async (selector) => {
    try {
      const elements = await page.locator(selector);
      const count = await elements.count();
      const texts = [];
      for (let i = 0; i < count; i++) {
        const text = (await elements.nth(i).textContent())?.trim();
        if (text) texts.push(text);
      }
      return texts;
    } catch {
      return [];
    }
  };

  // Basic project catalogs fields (extend later as needed)
  const project = {
    url,
    projectCatalogTitle: await getText(['h1[itemprop="title"]', '[data-test="job-title"]', 'main h1']),
    projectCatalogType: await getText(['li.air3-breadcrumb-item a > span:not(.project-count)']),
    freelancer_info: await (async () => {
      try {
        const anchor = page.locator('a[href^="/freelancers/~"]').first();
        const freelancer_name = (await anchor.count()) ? ((await anchor.textContent()) || '').replace(/\s+/g, ' ').trim() : null;
        const href = (await anchor.count()) ? await anchor.getAttribute('href') : null;
        const freelancer_url = href ? new URL(href, 'https://www.upwork.com').toString() : null;

        const portfolioAnchor = page.locator('a[href^="/freelancers/~"][href*="#portfolio"]').first();
        let freelancer_portfolio_url = null;
        if (await portfolioAnchor.count()) {
          const ph = await portfolioAnchor.getAttribute('href');
          if (ph) freelancer_portfolio_url = new URL(ph, 'https://www.upwork.com').toString();
        }

        const freelancer_badge = await getText(['[data-qa="top-rate-title"]']);

        let average_score = null;
        let total_reviews = null;
        const ratingContainer = page.locator('[data-qa="average-score"]').first();
        if (await ratingContainer.count()) {
          const ratingText = (await ratingContainer.locator('[data-qa="rating"]').first().textContent())?.trim() || null;
          average_score = ratingText ? parseFloat(ratingText.replace(',', '.')) : null;
          const reviewsText = (await ratingContainer.locator('[data-qa="reviews-count"]').first().textContent())?.trim() || null;
          if (reviewsText) {
            const m = reviewsText.match(/(\d[\d.,]*)/);
            if (m) total_reviews = parseInt(m[1].replace(/[.,]/g, ''));
          }
        }

        // Location row under fl-details-info
        let location = null;
        const locRow = page.locator('.fl-details-info div:has(> [aria-label="Location"])').first();
        if (await locRow.count()) {
          const strongText = await locRow.locator('strong').first().textContent();
          if (strongText) location = strongText.replace(/\s+/g, ' ').trim();
        }

        // Job Success percentage
        let job_success = null;
        const jssContainer = page.locator('#jss-badge-20, .air3-progress-circle').first();
        if (await jssContainer.count()) {
          const pctText = (await jssContainer.locator('span').first().textContent())?.trim() || null;
          if (pctText) {
            const m = pctText.match(/(\d{1,3})%/);
            if (m) job_success = parseInt(m[1], 10);
          }
        }

        return { freelancer_name, freelancer_url, freelancer_portfolio_url, freelancer_badge, average_score, total_reviews, location, job_success };
      } catch {
        return { freelancer_name: null, freelancer_url: null, freelancer_portfolio_url: null, freelancer_badge: null, average_score: null, total_reviews: null, location: null, job_success: null };
      }
    })(),
    serviceTiers: await (async () => {
      try {
        // Header cells: tier names and prices
        const headerCells = page.locator('#up-comparison-table thead tr:has(strong:has-text("Service Tiers")) th[data-qa="pkg-price"]');
        const headerCount = await headerCells.count();
        if (headerCount === 0) return [];

        const tiers = [];
        for (let i = 0; i < headerCount; i++) {
          const th = headerCells.nth(i);
          const name = await th.evaluate((el) => {
            const clone = el.cloneNode(true);
            clone.querySelectorAll('div').forEach((n) => n.remove());
            return (clone.textContent || '').replace(/\s+/g, ' ').trim();
          });
          const price = (await th.locator('div').first().textContent())?.replace(/\s+/g, ' ').trim() || null;
          tiers.push({ name, price, features: {} });
        }

        // Body rows: each row is a feature, with one cell per tier
        const rows = page.locator('#up-comparison-table tbody tr.up-row');
        const rowCount = await rows.count();
        for (let r = 0; r < rowCount; r++) {
          const row = rows.nth(r);
          // Feature label is the first cell (may contain nested elements)
          const featureLabel = await row.locator('td, th').first().evaluate((el) => (el.textContent || '').replace(/\s+/g, ' ').trim());
          if (!featureLabel) continue;
          const cells = await row.locator('td').count();
          for (let t = 0; t < tiers.length; t++) {
            // td index 0 is the feature label; values start at index 1
            const valueIndex = t + 1;
            if (valueIndex >= cells) continue;
            const cell = row.locator('td').nth(valueIndex);
            const value = await cell.evaluate((el) => {
              if (el.querySelector('[aria-label="included"]')) return 'included';
              if (el.querySelector('[aria-label="not included"]')) return 'not included';
              const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
              if (raw === '-' || raw === '') return 'not included';
              return raw;
            });
            tiers[t].features[featureLabel] = value;
          }
        }
        return tiers;
      } catch {
        return [];
      }
    })(),
    optionalAddOns: await (async () => {
      try {
        const container = page.locator('.addons .air3-grid-container .span-lg-8');
        if (!(await container.count())) return [];
        const rows = container.locator('div.d-flex.justify-space-between');
        const count = await rows.count();
        const items = [];
        for (let i = 0; i < count; i++) {
          const row = rows.nth(i);
          const name = (await row.locator('.up-width-text').first().textContent())?.replace(/\s+/g, ' ').trim() || null;
          const price = (await row.locator('strong').last().textContent())?.replace(/\s+/g, ' ').trim() || null;
          const extraTime = await row.evaluate((el) => {
            const txt = el.querySelector('.up-width-text')?.textContent || '';
            const m = txt.match(/\(\s*\+\s*[^)]+\)/);
            return m ? m[0].replace(/[()]/g, '').trim() : null;
          });
          if (name || price || extraTime) items.push({ name, price, extraTime });
        }
        return items;
      } catch {
        return [];
      }
    })(),
    project_catalog_rating: await (async () => {
      try {
        const ratingElement = page.locator('span:has-text("This project")').first();
        if (!(await ratingElement.count())) return null;
        const ratingText = (await ratingElement.textContent())?.trim() || null;
        if (ratingText) {
          const match = ratingText.match(/This project \((\d+)\)/);
          if (match) return parseInt(match[1], 10);
        }
        return null;
      } catch {
        return null;
      }
    })(),
    scrapedAt: new Date().toISOString()
  };

  // Simple fallbacks via page text
  try {
    const mainText = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
    if (!project.type) {
      const mType = mainText.match(/Hourly|Fixed Price/i);
      if (mType) project.type = mType[0];
    }
  } catch {}

  return project;
}

async function main() {
  console.log('Starting project scraper...');
  console.log(`Found ${PROJECT_URLS.length} projects to process\n`);
  
  await ensureOutput();
  
  // Create directory for browser user data
  const persistentDir = path.resolve(process.cwd(), 'chrome-user-data');
  if (!fs.existsSync(persistentDir)) fs.mkdirSync(persistentDir, { recursive: true });
  
  // Open browser
  console.log('Opening browser...');
  const context = await chromium.launchPersistentContext(persistentDir, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1360, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--lang=en-US']
  });
  
  const page = await context.newPage();
  const allProjectsData = [];

  try {
    // Process each URL
    for (let i = 0; i < PROJECT_URLS.length; i++) {
      const url = PROJECT_URLS[i];
      console.log(`\nProcessing project ${i + 1} of ${PROJECT_URLS.length}:`);
      console.log(url);
      
      try {
        // Extract project data
        const projectData = await extractProject(page, url);
        
        if (projectData) {
          allProjectsData.push(projectData);
          console.log('Project extracted successfully');
        } else {
          console.error('Could not extract the project data');
        }
      } catch (error) {
        console.error(`Error processing project: ${error.message}`);
      }
      
      // Small delay between requests
      if (i < PROJECT_URLS.length - 1) {
        await sleep(2000);
      }
    }
    
    // Save all projects to a single file
    if (allProjectsData.length > 0) {
      fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allProjectsData, null, 2));
      console.log(`\nSuccessfully extracted ${allProjectsData.length} out of ${PROJECT_URLS.length} projects`);
      console.log('Saved to:', OUTPUT_FILE);
    } else {
      console.log('\nNo projects were successfully extracted');
    }
    
  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    // Close browser
    await context.close();
    console.log('\nBrowser closed');
  }
}

// Ejecutar el script
main().catch((error) => {
  console.error(' Fatal error:', error);
  process.exit(1);
});
