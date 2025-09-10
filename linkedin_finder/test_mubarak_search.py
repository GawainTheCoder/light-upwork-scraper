#!/usr/bin/env python3
"""Test specific searches for Amna Mubarak profile"""

import os
import requests
from dotenv import load_dotenv

load_dotenv()

def search_google_cse(query: str, api_key: str, cse_id: str) -> dict:
    params = {
        'key': api_key,
        'cx': cse_id,
        'q': query,
        'num': 10
    }
    resp = requests.get("https://www.googleapis.com/customsearch/v1", params=params, timeout=20)
    if resp.status_code >= 400:
        raise RuntimeError(f"Google CSE error {resp.status_code}: {resp.text[:200]}")
    return resp.json()

def extract_linkedin_candidates(cse_json: dict) -> list:
    items = cse_json.get("items", [])
    candidates = []
    
    for item in items:
        link = item.get("link", "")
        if not isinstance(link, str):
            continue
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
    return candidates

# Test different search queries for Amna Mubarak
queries = [
    '"Amna Mubarak" Lahore Pakistan site:linkedin.com/in',
    'Amna Mubarak Lahore freelancer site:linkedin.com/in',
    '"Amna Mubarak" Pakistan site:linkedin.com/in',
    'Amna Mubarak "Market Research" site:linkedin.com/in',
    'Amna Mubarak site:linkedin.com/in',
    '"Amna" Mubarak Pakistan site:linkedin.com/in',
    'site:linkedin.com/in "amna-mubarak"',
    'site:linkedin.com/in "ab3302199"',
]

api_key = os.environ.get("GOOGLE_CSE_API_KEY")
cse_id = os.environ.get("GOOGLE_CSE_ID")

if not api_key or not cse_id:
    print("GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID must be set")
    exit(1)

target_profile = "https://www.linkedin.com/in/amna-mubarak-ab3302199"
found_target = False

for i, query in enumerate(queries, 1):
    print(f"\n=== Query {i}: {query} ===")
    try:
        result = search_google_cse(query, api_key, cse_id)
        candidates = extract_linkedin_candidates(result)
        
        if candidates:
            for j, cand in enumerate(candidates, 1):
                url = cand['url']
                print(f"{j}. {url}")
                print(f"   Title: {cand['title']}")
                print(f"   Snippet: {cand['snippet'][:100]}...")
                
                # Check if we found the target profile
                if target_profile.lower() in url.lower():
                    print(f"🎯 FOUND TARGET PROFILE! Query: {query}")
                    found_target = True
        else:
            print("No LinkedIn candidates found")
            
    except Exception as e:
        print(f"Error: {e}")

print(f"\n{'='*50}")        
if found_target:
    print("✅ SUCCESS: Target profile was found!")
else:
    print("❌ TARGET PROFILE NOT DISCOVERABLE through Google search")
    print(f"Target: {target_profile}")
    print("\nPossible reasons:")
    print("- Profile privacy settings")
    print("- Not indexed by Google")
    print("- SEO/ranking issues") 
    print("- Profile is too new or inactive")