#!/usr/bin/env python3
"""
LinkedIn finder using Google Custom Search Engine (FREE alternative to Serper)

Usage:
  python find_linkedins_cse.py --in data/profiles.jsonl --out out/enriched.csv --sleep 2.0 --limit 5 --verbose

Environment:
  GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID must be set. Optionally, a .env file is loaded if python-dotenv is installed.

Setup:
  1. Get API key: https://developers.google.com/custom-search/v1/overview
  2. Create search engine: https://programmablesearchengine.google.com/
  3. Configure search engine to search site:linkedin.com
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


GOOGLE_CSE_ENDPOINT = "https://www.googleapis.com/customsearch/v1"


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


def build_cse_queries(name: str, location: Optional[str], skills: Optional[List[str]], role: str = "", country: str = "") -> List[str]:
  """Build targeted LinkedIn search queries for Google Custom Search Engine.
  
  Focus on most likely matches using site:linkedin.com/in restriction.
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
  
  # For truncated names, try first name variations first
  if is_truncated and first_q:
    if loc_q:
      queries.append(f"{first_q} freelancer {loc_q} site:linkedin.com/in")
      queries.append(f"{first_q} {loc_q} site:linkedin.com/in")
    # Try without quotes for broader matching
    queries.append(f"{first_only} freelancer {loc_q} site:linkedin.com/in")
    if top_skill and loc_q:
      queries.append(f"{first_q} {top_skill} {loc_q} site:linkedin.com/in")
    
  # Original name queries  
  if name_q:
    if loc_q:
      queries.append(f"{name_q} freelancer {loc_q} site:linkedin.com/in")
      queries.append(f"{name_q} {loc_q} site:linkedin.com/in")
      if role_q:
        queries.append(f"{name_q} {role_q} {loc_q} site:linkedin.com/in")
      if top_skill:
        queries.append(f"{name_q} {top_skill} {loc_q} site:linkedin.com/in")
    
    # Country fallback
    if country_q and country_q != loc_q:
      queries.append(f"{name_q} {country_q} site:linkedin.com/in")
    
    # Name only (broader search)
    queries.append(f"{name_q} site:linkedin.com/in")
  
  # De-duplicate while preserving order
  seen = set()
  deduped: List[str] = []
  for q in queries:
    if q not in seen:
      seen.add(q)
      deduped.append(q)
  return deduped[:6]  # Limit to 6 queries to stay within free tier


def require_cse_credentials() -> Tuple[str, str]:
  api_key = os.environ.get("GOOGLE_CSE_API_KEY")
  cse_id = os.environ.get("GOOGLE_CSE_ID")
  
  if not api_key:
    raise RuntimeError("GOOGLE_CSE_API_KEY is not set. Get one from: https://developers.google.com/custom-search/v1/overview")
  if not cse_id:
    raise RuntimeError("GOOGLE_CSE_ID is not set. Create one at: https://programmablesearchengine.google.com/")
    
  return api_key, cse_id


def search_google_cse(query: str, api_key: str, cse_id: str, timeout: float = 20.0) -> Dict[str, Any]:
  """Search using Google Custom Search Engine API"""
  params = {
    'key': api_key,
    'cx': cse_id,
    'q': query,
    'num': 10  # Return up to 10 results
  }
  
  resp = requests.get(GOOGLE_CSE_ENDPOINT, params=params, timeout=timeout)
  if resp.status_code >= 400:
    raise RuntimeError(f"Google CSE error {resp.status_code}: {resp.text[:200]}")
  return resp.json()


def extract_linkedin_candidates(cse_json: Dict[str, Any]) -> List[Dict[str, str]]:
  """Extract LinkedIn profile candidates from Google CSE results"""
  items = cse_json.get("items", [])
  candidates: List[Dict[str, str]] = []
  
  for item in items:
    link = item.get("link", "")
    if not isinstance(link, str):
      continue
      
    # Filter for LinkedIn profile URLs
    link_clean = link.lower().split("?")[0].split("#")[0]
    if not (link_clean.startswith("https://www.linkedin.com/in/") or 
            link_clean.startswith("https://linkedin.com/in/")):
      continue
      
    title = item.get("title", "")
    snippet = item.get("snippet", "")
    candidates.append({
      "url": link_clean, 
      "title": title, 
      "snippet": snippet
    })
    
    if len(candidates) >= 5:  # Limit candidates
      break
      
  return candidates


def pick_best_linkedin_candidate(full_name: str, first_name: str, loc_tokens: List[str], 
                                skill_tokens: List[str], candidates: List[Dict[str, str]], 
                                role_tokens: Optional[List[str]] = None) -> Optional[Dict[str, str]]:
  """Improved candidate selection with better scoring for LinkedIn profiles."""
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
    
    # Name matching (most important)
    if fn in title:
      score += 3
      
      # Bonus for multiple name parts matching
      name_parts = full_name_lower.split()
      if len(name_parts) > 1:
        matching_parts = sum(1 for part in name_parts if len(part) > 1 and part in combined_text)
        if matching_parts >= 2:
          score += 4  # Strong signal for full name match
        elif matching_parts == 1 and len(name_parts[1]) > 2:
          score += 1
    else:
      continue  # Skip if first name not in title
    
    # Location matching
    location_matches = sum(1 for t in loc_tokens if t.lower() in combined_text)
    if location_matches > 0:
      score += min(location_matches * 2, 4)
    
    # Professional context
    if any(k in combined_text for k in ["freelancer", "upwork", "consultant", "self employed"]):
      score += 2
      
    # URL pattern matching
    if any(part in url for part in full_name_lower.split() if len(part) > 2):
      score += 2
    elif url.startswith("https://www.linkedin.com/in/" + fn):
      score += 1
    
    # Skills/role matching
    if role_tokens and any(t.lower() in combined_text for t in role_tokens):
      score += 1
    if skill_tokens and any(t.lower() in combined_text for t in skill_tokens):
      score += 1
    
    if score > best_score:
      best_score = score
      best_candidate = cand
  
  # Return best candidate if score is reasonable
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
  os.replace(tmp, out_csv)


def process_records(records: List[Dict[str, Any]], args: argparse.Namespace) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
  api_key, cse_id = require_cse_credentials()
  start = max(0, int(args.start))
  limit = int(args.limit) if args.limit is not None else None
  sleep_s = float(args.sleep)
  verbose = bool(args.verbose)

  out_rows: List[Dict[str, Any]] = []
  counts = {"processed": 0, "matched": 0, "needs_review": 0, "not_found": 0, "error": 0}

  end_idx = start + limit if limit is not None else len(records)
  for idx in range(start, min(len(records), end_idx)):
    r = records[idx]
    
    # Extract profile data (same as original)
    name = str(r.get("name") or r.get("full_name") or r.get("Short Name") or "").strip()
    if not name:
      first = str(r.get("First Name") or r.get("first_name") or r.get("first") or "").strip()
      last = str(r.get("Last Name") or r.get("last_name") or r.get("last") or "").strip()
      name = (first + " " + last).strip()
    
    location = str(r.get("location") or "").strip()
    if not location:
      city = str(r.get("City") or r.get("city") or "").strip()
      state = str(r.get("State") or r.get("state") or "").strip()
      country = str(r.get("Country") or r.get("country") or "").strip()
      parts = [p for p in [city, state, country] if p]
      location = ", ".join(parts)
    
    role = str(r.get("title") or r.get("Title") or r.get("headline") or r.get("Headline") or "").strip()
    country = str(r.get("Country") or r.get("country") or "").strip()
    
    # Skills processing
    skills_raw = r.get("skills") or r.get("Skills")
    if isinstance(skills_raw, list):
      skills = [str(s) for s in skills_raw if s]
    elif isinstance(skills_raw, str) and skills_raw:
      try:
        delim = ";" if ";" in skills_raw else ","
        skills = [s.strip() for s in skills_raw.split(delim) if s.strip()]
      except Exception:
        skills = []
    else:
      skills = []

    # Build search queries
    queries = build_cse_queries(name, location, skills, role=role, country=country)
    first_skill = (skills[0] if skills else "")
    second_skill = (skills[1] if skills and len(skills) > 1 else "")
    loc_tokens = tokenize_location(location)
    skill_tokens = tokenize_skill(first_skill) + tokenize_skill(second_skill)
    role_tokens = tokenize_skill(role)
    first_name = first_name_from(name)

    best_url = ""
    match_status = "not_found"
    query_used = ""
    all_candidates: List[Dict[str, str]] = []

    if not queries:
      match_status = "not_found"
    else:
      for q in queries:
        if verbose:
          print(f"CSE Query: {q}")
        
        # Respectful delay
        time.sleep(max(0.0, sleep_s))
        
        try:
          cse_result = search_google_cse(q, api_key, cse_id)
          candidates = extract_linkedin_candidates(cse_result)
          
          if not all_candidates and candidates:
            all_candidates = candidates[:]
            
          best_candidate = pick_best_linkedin_candidate(name, first_name, loc_tokens, 
                                                      skill_tokens, candidates, role_tokens=role_tokens)
          if best_candidate:
            best_url = best_candidate.get("url") or ""
            match_status = "matched"
            query_used = q
            break
            
        except Exception as e:
          if verbose:
            print(f"Error with query '{q}': {e}")
          match_status = "error"
          query_used = q
          break
          
        if match_status in ("matched", "error"):
          break

      # If no match but we have candidates, mark for review
      if match_status == "not_found" and all_candidates:
        match_status = "needs_review"
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

    if counts["processed"] % 50 == 0:
      save_checkpoint(out_rows, args.out)

  return out_rows, counts


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
  p = argparse.ArgumentParser(description="Find LinkedIn profiles using Google Custom Search Engine (FREE)")
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
    write_final([], args.out)
    print("processed=0 matched=0 needs_review=0 not_found=0 error=0")
    return

  try:
    rows, counts = process_records(records, args)
  except RuntimeError as e:
    print(str(e), file=sys.stderr)
    sys.exit(2)

  write_final(rows, args.out)
  print(
    f"processed={counts['processed']} matched={counts['matched']} needs_review={counts['needs_review']} not_found={counts['not_found']} error={counts['error']}"
  )


if __name__ == "__main__":
  main()