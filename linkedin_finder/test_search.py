#!/usr/bin/env python3
"""Test specific search queries to debug LinkedIn profile matching"""

import os
import requests
from dotenv import load_dotenv

load_dotenv()

SERPER_ENDPOINT = "https://google.serper.dev/search"

def search_serper(query: str, api_key: str) -> dict:
    headers = {"X-API-KEY": api_key, "Content-Type": "application/json"}
    payload = {"q": query, "num": 10}
    resp = requests.post(SERPER_ENDPOINT, headers=headers, json=payload, timeout=20)
    if resp.status_code >= 400:
        raise RuntimeError(f"Serper error {resp.status_code}: {resp.text[:200]}")
    return resp.json()

def extract_candidates(serp_json: dict) -> list:
    org = serp_json.get("organic", [])
    candidates = []
    for item in org:
        link = item.get("link", "")
        if not isinstance(link, str):
            continue
        link_l = link.lower().split("?")[0].split("#")[0]
        if not (link_l.startswith("https://www.linkedin.com/in/") or 
                link_l.startswith("https://linkedin.com/in/")):
            continue
        title = item.get("title", "")
        snippet = item.get("snippet", "")
        candidates.append({"url": link_l, "title": title, "snippet": snippet})
    return candidates

# Test different search queries
queries = [
    '"Amna M." freelancer Lahore, Pakistan site:linkedin.com/in',
    '"Amna M." Lahore, Pakistan site:linkedin.com/in', 
    '"Amna Mubarak" Lahore site:linkedin.com/in',
    '"Amna Mubarak" Pakistan site:linkedin.com/in',
    'Amna Mubarak freelancer site:linkedin.com/in',
    '"Amna" Market Research Lahore site:linkedin.com/in',
    'Amna Market Research Pakistan site:linkedin.com/in',
]

api_key = os.environ.get("SERPER_API_KEY")
if not api_key:
    print("SERPER_API_KEY not set")
    exit(1)

for i, query in enumerate(queries, 1):
    print(f"\n=== Query {i}: {query} ===")
    try:
        result = search_serper(query, api_key)
        candidates = extract_candidates(result)
        if candidates:
            for j, cand in enumerate(candidates, 1):
                print(f"{j}. {cand['url']}")
                print(f"   Title: {cand['title']}")
                print(f"   Snippet: {cand['snippet'][:100]}...")
        else:
            print("No LinkedIn candidates found")
    except Exception as e:
        print(f"Error: {e}")