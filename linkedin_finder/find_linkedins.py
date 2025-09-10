#!/usr/bin/env python3
"""
Minimal LinkedIn finder from Upwork profiles (v0)

Usage:
  python find_linkedins.py --in data/profiles_copy_test.jsonl --out out/enriched.csv --sleep 2.0 --limit 5 --verbose

Environment:
  SERPER_API_KEY must be set. Optionally, a .env file is loaded if python-dotenv is installed.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Tuple

try:
  from dotenv import load_dotenv  # type: ignore
  load_dotenv()
except Exception:
  pass

import requests


SERPER_ENDPOINT = "https://google.serper.dev/search"


def load_records(path: str, fmt: Optional[str] = None) -> List[Dict[str, Any]]:
  """Load input records from JSONL or CSV. Returns a list of dicts."""
  if fmt is None:
    if path.lower().endswith(".jsonl"):
      fmt = "jsonl"
    elif path.lower().endswith(".csv"):
      fmt = "csv"
    else:
      raise ValueError("Cannot auto-detect format. Pass --format=jsonl|csv")

  records: List[Dict[str, Any]] = []
  if fmt == "jsonl":
    with open(path, "r", encoding="utf-8") as f:
      for line in f:
        line = line.strip()
        if not line:
          continue
        try:
          obj = json.loads(line)
          if isinstance(obj, dict):
            records.append(obj)
        except Exception:
          continue
  elif fmt == "csv":
    with open(path, newline="", encoding="utf-8") as f:
      reader = csv.DictReader(f)
      for row in reader:
        records.append(dict(row))
  else:
    raise ValueError(f"Unsupported format: {fmt}")

  return records


def normalize_whitespace(s: str) -> str:
  return re.sub(r"\s+", " ", s or "").strip()


def first_name_from(name: str) -> str:
  name = normalize_whitespace(name)
  return name.split(" ")[0] if name else ""


def tokenize_location(loc: str) -> List[str]:
  loc = normalize_whitespace(loc)
  if not loc:
    return []
  tokens = re.split(r"[\s,]+", loc)
  # keep 2+ length tokens (retain state codes like GA)
  return [t for t in tokens if len(t) >= 2]


def tokenize_skill(skill: str) -> List[str]:
  s = normalize_whitespace(skill)
  if not s:
    return []
  return [t for t in re.split(r"\s+", s) if t]


def build_queries(name: str, location: Optional[str], skills: Optional[List[str]], role: str = "", country: str = "", primary_category: str = "") -> List[str]:
  """Build targeted queries prioritizing most specific searches first.
  
  Focus on most likely matches: name + location, then name + professional context.
  Special handling for truncated names (e.g., "John D." -> try "John" variations)
  """
  name_q = f'"{normalize_whitespace(name)}"' if name else ""
  loc_q = normalize_whitespace(location or "")
  country_q = normalize_whitespace(country or "")
  role_q = normalize_whitespace(role or "")
  top_skill = normalize_whitespace((skills or [None])[0] or "")
  first_only = first_name_from(name)
  first_q = f'"{first_only}"' if first_only else ""

  queries: List[str] = []
  
  # Check if we have a truncated name (e.g., "Amna M.")
  name_parts = name.split()
  is_truncated = (len(name_parts) == 2 and 
                  len(name_parts[1]) <= 2 and 
                  name_parts[1].endswith('.'))
  
  # Priority 1: For truncated names, try first name + context first
  if is_truncated and first_q:
    if loc_q:
      queries.append(f"{first_q} freelancer {loc_q} site:linkedin.com/in")
      queries.append(f"{first_q} {loc_q} site:linkedin.com/in")
    if top_skill and loc_q:
      queries.append(f"{first_q} {top_skill} {loc_q} site:linkedin.com/in")
    # Try without quotes for broader matching
    queries.append(f"{first_only} freelancer {loc_q} site:linkedin.com/in")
    
  # Priority 2: Original name queries  
  if name_q and loc_q:
    queries.append(f"{name_q} freelancer {loc_q} site:linkedin.com/in")
    queries.append(f"{name_q} {loc_q} site:linkedin.com/in")
    if role_q:
      queries.append(f"{name_q} {role_q} {loc_q} site:linkedin.com/in")
    if top_skill:
      queries.append(f"{name_q} {top_skill} {loc_q} site:linkedin.com/in")
    
  # Priority 3: Name + country fallback
  if name_q and country_q and country_q != loc_q:
    queries.append(f"{name_q} {country_q} site:linkedin.com/in")
    
  # Priority 4: Name only (broader search)
  if name_q:
    queries.append(f"{name_q} site:linkedin.com/in")
  
  # De-duplicate while preserving order
  seen = set()
  deduped: List[str] = []
  for q in queries:
    if q not in seen:
      seen.add(q)
      deduped.append(q)
  return deduped[:8]  # Limit to 8 focused queries instead of 20


def require_api_key() -> str:
  key = os.environ.get("SERPER_API_KEY")
  if not key:
    raise RuntimeError("SERPER_API_KEY is not set. Export it or put it in a .env file.")
  return key


def search_serper(query: str, api_key: str, timeout: float = 20.0, gl: Optional[str] = None, hl: Optional[str] = None) -> Dict[str, Any]:
  headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}
  payload: Dict[str, Any] = {"q": query, "num": 10}
  if gl:
    payload["gl"] = gl
  if hl:
    payload["hl"] = hl
  resp = requests.post(SERPER_ENDPOINT, headers=headers, json=payload, timeout=timeout)
  if resp.status_code >= 400:
    raise RuntimeError(f"Serper error {resp.status_code}: {resp.text[:200]}")
  return resp.json()


def extract_candidates(serp_json: Dict[str, Any]) -> List[Dict[str, str]]:
  org = serp_json.get("organic") or []
  cands: List[Dict[str, str]] = []
  for item in org:
    link = item.get("link") or ""
    if not isinstance(link, str):
      continue
    # canonicalize and whitelist linkedin profile URLs (in/ or pub/)
    link_l = link.lower().split("?")[0].split("#")[0]
    if not (link_l.startswith("https://www.linkedin.com/in/") or link_l.startswith("https://linkedin.com/in/") or link_l.startswith("https://www.linkedin.com/pub/") or link_l.startswith("https://linkedin.com/pub/")):
      continue
    title = item.get("title") or ""
    snippet = item.get("snippet") or ""
    cands.append({"url": link_l, "title": title, "snippet": snippet})
    if len(cands) >= 5:
      break
  return cands


def country_to_gl(country: str) -> Optional[str]:
  c = (country or "").strip().lower()
  if not c:
    return None
  mapping = {
    "united states": "us", "usa": "us", "u.s.": "us", "u.s.a": "us",
    "pakistan": "pk", "india": "in", "nigeria": "ng", "philippines": "ph",
    "bangladesh": "bd", "canada": "ca", "morocco": "ma", "albania": "al",
    "venezuela": "ve", "united kingdom": "gb", "uk": "gb",
  }
  return mapping.get(c)


def pick_candidate(full_name: str, first_name: str, loc_tokens: List[str], skill_tokens: List[str], candidates: List[Dict[str, str]], role_tokens: Optional[List[str]] = None) -> Optional[Dict[str, str]]:
  """Improved candidate selection with better scoring and name matching."""
  fn = first_name.lower()
  full_name_lower = full_name.lower()
  role_tokens = role_tokens or []
  
  best_candidate = None
  best_score = 0
  
  for cand in candidates:
    title = (cand.get("title") or "").lower()
    snippet = (cand.get("snippet") or "").lower()
    url = (cand.get("url") or "").lower()
    combined_text = f"{title} {snippet}"
    
    score = 0
    
    # Name matching (most important signal)
    if fn in title:
      score += 3  # First name in title is strong signal
      
      # Bonus for full name or parts of full name
      name_parts = full_name_lower.split()
      if len(name_parts) > 1:
        # Check if multiple name parts appear
        matching_parts = sum(1 for part in name_parts if len(part) > 1 and part in combined_text)
        if matching_parts >= 2:
          score += 3  # Multiple name parts match
        elif matching_parts == 1 and len(name_parts[1]) > 2:  # Not just initials
          score += 1
    else:
      # If first name not in title, this is likely wrong profile
      continue
    
    # Location matching (high value signal for personal profiles)
    location_matches = sum(1 for t in loc_tokens if t.lower() in combined_text)
    if location_matches > 0:
      score += min(location_matches * 2, 4)  # Max 4 points for location
    
    # Professional context (moderate signal)
    if any(k in combined_text for k in ["freelancer", "upwork", "self employed", "self-employed", "consultant"]):
      score += 2
      
    # URL pattern matching (good signal)  
    if url.startswith("https://www.linkedin.com/in/" + fn) or url.startswith("https://linkedin.com/in/" + fn):
      score += 2
    elif any(part in url for part in full_name_lower.split() if len(part) > 2):
      score += 1
    
    # Skills/role matching (supporting signal)
    if role_tokens and any(t.lower() in combined_text for t in role_tokens):
      score += 1
    if skill_tokens and any(t.lower() in combined_text for t in skill_tokens):
      score += 1
    
    # Keep track of best candidate
    if score > best_score:
      best_score = score
      best_candidate = cand
  
  # Return best candidate if score is strong enough
  # Lower threshold since we're being more selective with queries
  return best_candidate if best_score >= 5 else None


def save_checkpoint(rows: List[Dict[str, Any]], out_csv: str) -> None:
  tmp = out_csv + ".tmp.csv"
  os.makedirs(os.path.dirname(out_csv) or ".", exist_ok=True)
  headers = [
    "externalId","name","location",
    "linkedin_url","match_status","query_used","candidates_json"
  ]
  with open(tmp, "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=headers)
    w.writeheader()
    for r in rows:
      w.writerow({k: r.get(k, "") for k in headers})


def write_final(rows: List[Dict[str, Any]], out_csv: str) -> None:
  save_checkpoint(rows, out_csv)
  tmp = out_csv + ".tmp.csv"
  # overwrite final
  os.replace(tmp, out_csv)


def process_records(records: List[Dict[str, Any]], args: argparse.Namespace) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
  api_key = require_api_key()
  start = max(0, int(args.start))
  limit = int(args.limit) if args.limit is not None else None
  sleep_s = float(args.sleep)
  verbose = bool(args.verbose)

  out_rows: List[Dict[str, Any]] = []
  counts = {"processed": 0, "matched": 0, "needs_review": 0, "not_found": 0, "error": 0}

  end_idx = start + limit if limit is not None else len(records)
  for idx in range(start, min(len(records), end_idx)):
    r = records[idx]
    # Derive name
    name = str(r.get("name") or r.get("full_name") or r.get("Short Name") or "").strip()
    if not name:
      first = str(r.get("First Name") or r.get("first_name") or r.get("first") or "").strip()
      last = str(r.get("Last Name") or r.get("last_name") or r.get("last") or "").strip()
      name = (first + " " + last).strip()
    # Derive location
    location = str(r.get("location") or "").strip()
    if not location:
      city = str(r.get("City") or r.get("city") or "").strip()
      state = str(r.get("State") or r.get("state") or "").strip()
      country = str(r.get("Country") or r.get("country") or "").strip()
      parts = [p for p in [city, state, country] if p]
      location = ", ".join(parts)
    # Role/title and country for query building
    role = str(r.get("title") or r.get("Title") or r.get("headline") or r.get("Headline") or "").strip()
    country = str(r.get("Country") or r.get("country") or "").strip()
    primary_category = str(r.get("primaryCategory") or r.get("primary_category") or "").strip()
    # Skills may be a list or comma-separated string
    skills_raw = r.get("skills") or r.get("Skills")
    if isinstance(skills_raw, list):
      skills = [str(s) for s in skills_raw if s]
    elif isinstance(skills_raw, str) and skills_raw:
      try:
        # CSV may have comma or semicolon separated skills
        delim = ";" if ";" in skills_raw else ","
        skills = [s.strip() for s in skills_raw.split(delim) if s.strip()]
      except Exception:
        skills = []
    else:
      skills = []

    queries = build_queries(name, location, skills, role=role, country=country, primary_category=primary_category)
    first_skill = (skills[0] if skills else "")
    second_skill = (skills[1] if skills and len(skills) > 1 else "")
    loc_tokens = tokenize_location(location) + tokenize_location(country)
    skill_tokens = tokenize_skill(first_skill) + tokenize_skill(second_skill)
    role_tokens = tokenize_skill(role)
    first_name = first_name_from(name)
    gl = country_to_gl(country)
    hl = "en"

    best_url = ""
    match_status = "not_found"
    query_used = ""
    all_candidates: List[Dict[str, str]] = []

    if not queries:
      # no usable name
      match_status = "not_found"
    else:
      for q in queries:
        if verbose:
          print(f"Q: {q}")
        # politeness sleep before each API call
        time.sleep(max(0.0, sleep_s))
        # call with retries for 429/5xx
        backoff = 5.0
        attempts = 0
        while True:
          attempts += 1
          try:
            serp = search_serper(q, api_key, gl=gl, hl=hl)
            cands = extract_candidates(serp)
            if not all_candidates and cands:
              all_candidates = cands[:]
            cand = pick_candidate(name, first_name, loc_tokens, skill_tokens, cands, role_tokens=role_tokens)
            if cand:
              best_url = cand.get("url") or ""
              match_status = "matched"
              query_used = q
              break
            # no acceptable match; continue to next query
            break
          except Exception as e:
            msg = str(e)
            if any(code in msg for code in ["429", "500", "502", "503", "504"]) and attempts < 3:
              time.sleep(min(60.0, backoff))
              backoff *= 2
              continue
            match_status = "error"
            query_used = q
            break
        if match_status in ("matched", "error"):
          break

      if match_status == "not_found" and all_candidates:
        match_status = "needs_review"
        # leave best_url blank per spec; keep query_used as first query that produced candidates if available
        if not query_used and queries:
          query_used = queries[0]

    out = {
      "externalId": r.get("externalId") or r.get("external_id") or "",
      "name": name,
      "location": location,
      "linkedin_url": best_url,
      "match_status": match_status,
      "query_used": query_used,
      "candidates_json": json.dumps(all_candidates[:5], ensure_ascii=False, separators=(",", ":")),
    }
    out_rows.append(out)
    counts["processed"] += 1
    if match_status in counts:
      counts[match_status] += 1

    if counts["processed"] % 100 == 0:
      save_checkpoint(out_rows, args.out)

  return out_rows, counts


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
  p = argparse.ArgumentParser(description="Find likely LinkedIn profiles from Upwork records (v0)")
  p.add_argument("--in", dest="in_path", required=True, help="Path to input JSONL or CSV")
  p.add_argument("--out", dest="out", required=True, help="Path to output CSV")
  p.add_argument("--sleep", dest="sleep", type=float, default=2.0, help="Seconds to sleep between API calls")
  p.add_argument("--limit", dest="limit", type=int, default=None, help="Process only first N rows")
  p.add_argument("--start", dest="start", type=int, default=0, help="Start index offset for resume")
  p.add_argument("--format", dest="format", choices=["jsonl", "csv"], default=None, help="Input format (auto by extension)")
  p.add_argument("--verbose", dest="verbose", action="store_true", help="Verbose logging")
  return p.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> None:
  args = parse_args(argv)
  try:
    records = load_records(args.in_path, args.format)
  except Exception as e:
    print(f"Failed to load records: {e}", file=sys.stderr)
    sys.exit(1)

  if not records:
    print("No input records found.", file=sys.stderr)
    # still write empty output with header
    write_final([], args.out)
    print("processed=0 matched=0 needs_review=0 not_found=0 error=0")
    return

  try:
    rows, counts = process_records(records, args)
  except RuntimeError as e:
    # missing API key or similar config issue
    print(str(e), file=sys.stderr)
    sys.exit(2)

  write_final(rows, args.out)
  print(
    f"processed={counts['processed']} matched={counts['matched']} needs_review={counts['needs_review']} not_found={counts['not_found']} error={counts['error']}"
  )


if __name__ == "__main__":
  main()


