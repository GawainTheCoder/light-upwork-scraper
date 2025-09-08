## Upwork Profile Scraper 

Lightweight Playwright-based scraper to collect public Upwork freelancer profile details for learning and market research purposes. Supports:

- Persistent Chrome session to reduce "verify you’re human" loops
- Discovery of freelancer profiles via Talent Search
- Profile extraction with slow, human-like pacing
- JSONL output and CSV export
- Optional: scrape your own profile using your saved session

> Important: This project is for personal learning. Respect Upwork’s Terms of Service and privacy. Focus on your own profile and public pages. Keep volumes tiny and human-like.

### What this is NOT
- It’s not yet a high-scale scraper.
- It avoids automated CAPTCHA solving. If a human verification appears, you complete it once and re-use the saved session.

---

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

3) Scrape ~10 "market research" profiles (public)
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
- `npm run scrape:profiles` — Discover ~10 freelancer profiles (search: "market research") and extract fields.
- `npm run scrape:myprofile` — Extract your own profile using the saved session.
- `npm run export:csv` — Convert `data/profiles.jsonl` to `data/profiles.csv`.

---

### Outputs
- `data/profiles.jsonl` — One JSON record per profile.
- `data/profiles.csv` — CSV export for quick viewing.
- `data/my_profile.json` — Your profile snapshot (if you run `scrape:myprofile`).

Example JSONL row:
```json
{
  "url": "https://www.upwork.com/freelancers/~01abc...",
  "name": "Jane D.",
  "headline": "Market Researcher",
  "rate": "$30.00/hr",
  "earnings": "Total earnings $10k+",
  "jobSuccess": "100%",
  "location": "Toronto, Canada",
  "skills": ["Market Research", "Data Analysis"],
  "scrapedAt": "2025-09-08T...Z"
}
```

---

### Current Status

Working:
- Persistent Chrome login/session (`chrome-user-data/`, `auth.json`) reduces verification loops
- Discovery of profile links from Talent Search ("market research") with robust filtering to true `.../freelancers/~...` URLs
- Slow pacing and small volume (good for learning)
- JSONL and CSV outputs

Partially Working:
- Field coverage: names and hourly rates are often captured; some profiles still return null for earnings, Job Success, and location due to lazy rendering and selector variability
- Your profile extraction works, but may need improved selectors/waits for richer fields

Not Done Yet:
- CLI flags for search terms and count (currently edit in code)
- Input list mode (provide exact profile URLs via a file)
- Stronger extraction for earnings/JSS/location (network parsing + stable attributes)

---

### Roadmap (Low-Code Improvements)
1) CLI config for search terms and MAX_PROFILES
   - Easier to switch markets without code edits
2) Input URL list mode
   - Let you provide a curated list of profile URLs
3) Stronger extraction reliability
   - Combine network-idle waits, gentle scrolling, stable data-attributes, and regex fallbacks
4) Better logging and screenshots on failures
   - Faster debugging if selectors change

---

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
  - We’ll add stronger selectors and network parsing in the roadmap

---

### Disclaimer

This project is for personal learning and experimentation. Always review and follow Upwork’s Terms of Service. Focus on public data and your own profile. Keep scraping volumes minimal and human-like.


# light-upwork-scraper
