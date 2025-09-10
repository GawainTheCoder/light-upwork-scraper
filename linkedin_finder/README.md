LinkedIn Finder (v0.6)

Minimal utility to enrich Upwork profiles with likely LinkedIn profile URLs using search APIs.

Features
- Reads JSONL or CSV (auto-detected or via --format)
- Query builder prioritizes: name + location → name + role/skill → country → name-only
- Special handling for truncated names (e.g., “Jane D.”)
- Deterministic candidate scoring (no LLM by default)
- Serper.dev support with localization; optional Google CSE fallback
- Checkpointing to *.tmp.csv for long runs

Setup
1) Create .env at repo root and add keys as needed:
SERPER_API_KEY=your_serper_key
# Optional Google CSE (free 100/day):
GOOGLE_CSE_API_KEY=your_google_api_key
GOOGLE_CSE_ID=your_cse_id
2) Install deps in a venv:
python3 -m venv .venv && source .venv/bin/activate
pip install -r linkedin_finder/requirements.txt

Usage (Serper)
python3 linkedin_finder/find_linkedins.py \
  --in data/profiles_copy_test.jsonl \
  --out linkedin_finder/out.csv \
  --sleep 1.5 \
  --limit 10 \
  --verbose
- Input fields used when present: name (or first/last), location (or City/State/Country), title/headline, skills.
- Output columns: externalId,name,location,linkedin_url,match_status,query_used,candidates_json.

Usage (Google CSE fallback)
See linkedin_finder/setup_google_cse.md then run:
python3 linkedin_finder/find_linkedins_cse.py \
  --in linkedin_finder/fixtures/sample.jsonl \
  --out linkedin_finder/out_cse_test.csv \
  --sleep 1.0 \
  --limit 1 \
  --verbose

Query Strategy (summary)
- Name + Location (with “freelancer” hint)
- Name + Role/Skill + Location
- Name + Country
- Name only (site:linkedin.com/in)
- For truncated names, first-name + location/skill variants

Scoring (summary)
- First name in title (required; +3)
- Full-name parts in title/snippet (+1..+3)
- Location tokens in title/snippet (+2 per, capped)
- Professional context: freelancer/upwork/consultant (+2)
- URL contains name tokens (+2) or starts with first name (+1)
- Role/skill tokens (+1 each)
- Threshold: ≥5 → matched; else needs_review/not_found

Tips
- Keep --sleep ≥1.0s to be polite and reduce throttling
- Use small --limit slices while tuning
- Side-by-side review: join source CSV and out.csv by index for quick QA

Notes
- This tool does not scrape LinkedIn content; it only selects likely public profile URLs from search results.
- Respect privacy and platform ToS. Keep volumes low during testing.

