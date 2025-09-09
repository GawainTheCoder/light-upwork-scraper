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
- `npm run scrape:profiles` — Discover ~10 freelancer profiles (search: "market research"), deduping across runs.
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
  "name": "Jane D.",
  "headline": "Market Researcher",
  "hourlyRate": 30,
  "currency": "USD",
  "earningsTotal": 10000,
  "jobSuccessScore": 100,
  "location": "Toronto, Canada",
  "skills": ["Market Research", "Data Analysis"],
  "scrapedAt": "2025-09-08T...Z"
}
```

---

### Current Status

Working:
- Persistent Chrome login/session (`chrome-user-data/`, `auth.json`) reduces verification loops
- Discovery of profile links from Talent Search ("market research") with strict `.../freelancers/~...` filtering
- Cross-run dedupe and safe re-runs
- Normalized core fields: `hourlyRate`, `currency`, `earningsTotal`, `jobSuccessScore`
- CSV exporter computes `$xx.xx/hr`, `$X,XXX`, and `JSS%` for quick viewing

Partially Working / Next Up:
- Section scrapers for Portfolio, Work History, Overview, and Linked Accounts (planned as separate JSONL outputs)
- CLI flags for search terms, count, and section selection
- Input URL list mode (provide curated profile links)

---

### Roadmap (Low-Code Improvements)
1) Section scraper (`src/scrape_sections.js`)
   - Read `data/profiles.jsonl`, output per-section JSONLs:
     - `data/portfolio.jsonl`, `data/work_history.jsonl`, `data/overviews.jsonl`, `data/accounts.jsonl`
   - Network-first parsing with DOM fallbacks
2) CLI config for search terms and MAX_PROFILES
3) Input URL list mode
4) Better logging and screenshots on failures

---

### Tech Stack & How It Works

- Language/Runtime: JavaScript on Node.js
- Core Library: Playwright
- Browser: Persistent Google Chrome profile via Playwright
- Storage: Local JSONL and CSV files in `data/`
- No external scraping APIs or cloud services

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

- Stuck on "Verifying you are human":
  - Use `npm run login:persistent` and complete the check in real Chrome
  - Keep volumes tiny; navigate slowly; retry later if blocked
- Empty fields:
  - Profile content may be lazy-loaded; re-run `scrape:profiles` and consider increasing waits
  - Network-first capture + scroll depth usually resolves this

---

### Disclaimer

This project is for personal learning and experimentation. Always review and follow Upwork’s Terms of Service. Focus on public data and your own profile. Keep scraping volumes minimal and human-like.


# light-upwork-scraper
