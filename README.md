## Upwork Profile Scraper (Node.js + Playwright)

Lightweight Playwright-based scraper to collect public Upwork freelancer profile details for learning and market research purposes. Supports:

- Persistent Chrome session to reduce "verify you’re human" loops
- Discovery of freelancer profiles via Talent Search
- Profile extraction with slow, human-like pacing
- JSONL output and CSV export
- Optional: scrape your own profile using your saved session
- Cross-run dedupe (re-runs add only new profiles)
- Normalized numeric fields (hourlyRate, earningsTotal, jobSuccessScore)
- Cleaner CSV with computed display values ($/hr, earnings, JSS)

> Important: This project is for personal learning. Respect Upwork’s Terms of Service and privacy. Focus on your own profile and public pages. Keep volumes tiny and human-like.

### What this is NOT
- It’s not yet a high-scale scraper.
- It avoids automated CAPTCHA solving. If a human verification appears, you complete it once and re-use the saved session.

### Quick Start

1) Install dependencies
```bash
npm install
```

2) One-time login using persistent Chrome
```bash
npm run login:persistent
# A real Chrome window opens using a local profile in chrome-user-data/
# Log in to Upwork and complete any verification. Keep the window open until you see your dashboard/profile.
# The session will be saved locally.
```

3) Scrape ~10 "market research" profiles (public, cross-run dedupe)
```bash
npm run scrape:profiles
# Outputs:
# - data/profiles.jsonl
# - data/profiles.csv
```
Optional CLI flags (pass after --):
```bash
# Search one or multiple terms
npm run scrape:profiles -- --search="market research, social media manager"

# Load search terms from a file (one per line)
npm run scrape:profiles -- --search-file=terms.txt

# Limit total new profiles this run
npm run scrape:profiles -- --max=5

# Scrape specific profile URLs (comma-separated)
npm run scrape:profiles -- --urls=https://www.upwork.com/freelancers/~01abc...,https://www.upwork.com/freelancers/~01def...
```

4) Scrape your own profile (optional)
```bash
npm run scrape:myprofile
# A Chrome window opens. If needed, navigate to your profile tab.
# Output: data/my_profile.json
```

Notes:
- Persistent session lives in `chrome-user-data/` (gitignored).
- No credentials are stored in code. Any session data is local only.

---

### Scripts
- `npm run login:persistent` — Launch Chrome with a persistent profile and save session.
- `npm run scrape:profiles` — Discover freelancer profiles, deduping across runs, or target specific URLs. Supports `--search`, `--search-file`, `--max`, and `--urls`.
- `npm run scrape:myprofile` — Extract your own profile using the saved session.
- `npm run export:csv` — Convert `data/profiles.jsonl` to `data/profiles.csv`.

---

### Outputs
- `data/profiles.jsonl` — One JSON record per profile.
- `data/profiles.csv` — CSV export with normalized values and human-friendly display columns.
- `data/my_profile.json` — Your profile snapshot (if you run `scrape:myprofile`).

Example JSONL row:
```json
{
  "url": "https://www.upwork.com/freelancers/~01abc...",
  "source": "upwork",
  "externalId": "01abc123def456",
  "name": "Jane D.",
  "title": "Market Researcher & Data Analysis Specialist",
  "description": "Hi! I'm Jane, a market researcher with 5+ years of experience helping businesses understand their customers and competitors. I specialize in quantitative analysis, survey design, and competitive intelligence...",
  "hourlyRate": 30,
  "currency": "USD",
  "earningsTotal": 10000,
  "jobSuccessScore": 100,
  "location": "Toronto, Canada",
  "skills": ["Market Research", "Data Analysis", "Survey Design", "Competitive Analysis"],
  "categories": ["Market Research"],
  "primaryCategory": "Sales & Marketing", 
  "searchQuery": "market research",
  "totalJobs": 45,
  "totalHours": 520,
  "linkedAccounts": [{"platform": "GitHub", "username": "janedoe", "profileUrl": "https://github.com/janedoe"}],
  "languages": [{"name": "English", "level": "Native"}, {"name": "French", "level": "Conversational"}],
  "badges": ["top_rated"],
  "availability": "More than 30 hrs/week",
  "scrapedAt": "2025-09-10T...Z"
}
```

---

### Current Status

Working:
- Persistent Chrome login/session (`chrome-user-data/`, `auth.json`) reduces verification loops
- Discovery of profile links from Talent Search with strict `.../freelancers/~...` filtering
- Cross-run dedupe and safe re-runs
- Full profile extraction: titles, descriptions, skills, rates, stats, languages, badges, availability
- Professional title extraction from DOM structure (`h2.h4` selectors)
- Profile description extraction from line-clamped content areas
- Title fallback extraction from first line of profile descriptions
- Normalized core fields: `hourlyRate`, `currency`, `earningsTotal`, `jobSuccessScore`
- CSV exporter computes `$xx.xx/hr`, `$X,XXX`, and `JSS%` for quick viewing
- Full CLI support: `--search`, `--search-file`, `--max`, `--urls` flags
- Search query tracking per profile
- Category detection (basic - primary/secondary when available)
- Linked accounts extraction with resolved external profile URLs (GitHub, StackOverflow, etc.)

Known Limitations:
- **Rate limiting**: Upwork implements anti-bot measures. Keep volumes small (1-5 profiles per session) and space out runs by hours to avoid timeouts
- **Session degradation**: Persistent sessions may get flagged over time. Refresh login if experiencing timeouts

Next Up:
- Section scrapers for Portfolio, Work History, and Linked Accounts (planned as separate JSONL outputs)
- Enhanced category extraction  
- Better anti-detection measures (human-like scrolling, mouse movements)

---

### Roadmap (Future Improvements)
1) Section scraper (`src/scrape_sections.js`)
   - Read `data/profiles.jsonl`, output per-section JSONLs:
     - `data/portfolio.jsonl`, `data/work_history.jsonl`, `data/accounts.jsonl`
   - Network-first parsing with DOM fallbacks
2) Linked account enrichment (normalize URLs, capture additional metadata)
3) Better anti-detection measures:
   - Human-like mouse movements and scrolling
   - Randomized timing patterns
   - Session rotation strategies
4) Enhanced logging and error screenshots

---

### Tech Stack & How It Works

- Language/Runtime: JavaScript on Node.js
- Core Library: Playwright
- Browser: Persistent Google Chrome profile via Playwright
- Storage: Local JSONL and CSV files in `data/`
- No external scraping APIs or cloud services
  
Related tools
- See `linkedin_finder/` for a minimal LinkedIn finder that enriches Upwork profiles with likely LinkedIn URLs via search APIs. It has its own README.

Flow:
1) You authenticate once using a real Chrome window (persistent profile). This saves your session locally.
2) Discovery visits Upwork Talent Search (e.g., "market research") to collect freelancer profile URLs.
3) For each profile URL, the scraper opens the page with slow, human-like pacing, waits for content, and extracts key fields.
4) Results are written incrementally to `data/profiles.jsonl` (deduped across runs) and can be exported to CSV.

Why Playwright + persistent Chrome?
- Realistic browser fingerprint and behavior reduces human-verification loops.
- Simple, readable code with good control over waits, scrolling, and events.
- Session persists across runs without storing credentials in code.

### Architecture & Approach

- Playwright with a persistent Chrome profile
  - Realistic browser fingerprint
  - Session persists, reducing repeated verifications
- Discovery via Talent Search
  - Collect links from search results, filter strictly to `.../freelancers/~...`
- Extraction
  - Prefer stable selectors and data-attributes
  - Wait for `networkidle` and scroll to trigger lazy content
  - Fallback regex on page text
- Safety
  - Single-threaded, randomized delays
  - Tiny sample sizes (10–50)
  - Immediate backoff if challenges appear

---

### Scalability & Limitations

- Suited for small personal runs
- To scale responsibly:
  - Add residential proxies and sticky sessions
  - Distribute across time windows, keep concurrency very low
  - Prefer parsing structured XHR/GraphQL responses over DOM when possible
  - Add a job queue and persistence (SQLite/Postgres) for dedupe and resumes
  - Implement alerting when selectors or responses change

---

### Security & Privacy

- Do not commit credentials or session files. `.gitignore` excludes `auth.json`, `chrome-user-data/`, and `data/` outputs.
- Session remains on your machine; no external services are used.

---

### Troubleshooting

**Rate Limiting & Timeouts:**
- **Symptoms**: Page timeouts, slow loading, "Timeout 90000ms exceeded" errors
- **Cause**: Upwork's anti-bot detection flagging repeated automated requests
- **Solutions**:
  - Wait 2-4 hours between scraping sessions
  - Keep volumes very small (1-3 profiles max per session)
  - Refresh login session: `npm run login:persistent`
  - Delete and recreate `chrome-user-data/` directory if sessions are persistently flagged

**Stuck on "Verifying you are human":**
- Use `npm run login:persistent` and complete the verification manually
- Sessions may degrade over time - refresh periodically
- Avoid rapid consecutive runs

**Empty or Missing Fields (title, description):**
- Modern extraction uses `h2.h4` selectors for titles and `.air3-line-clamp` for descriptions
- If fields are null, the profile may use a different layout structure
- Content may be lazy-loaded - the scraper includes scrolling and wait logic

**General Best Practices:**
- Space out scraping sessions by hours, not minutes
- Keep total profiles per day under 10-15
- Monitor for behavior changes in Upwork's anti-bot systems

---

### Disclaimer

This project is for personal learning and experimentation. Always review and follow Upwork’s Terms of Service. Focus on public data and your own profile. Keep scraping volumes minimal and human-like.


# light-upwork-scraper
