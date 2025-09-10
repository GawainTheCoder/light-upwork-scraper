# Google Custom Search Engine Setup Guide

## Free Alternative to Serper API

Google Custom Search Engine provides **100 free searches per day** - perfect for testing LinkedIn profile matching!

## Step 1: Get Google CSE API Key

1. Go to: https://developers.google.com/custom-search/v1/overview
2. Click "Get a Key" 
3. Create a new project or select existing one
4. Copy your API key

## Step 2: Create Custom Search Engine

1. Go to: https://programmablesearchengine.google.com/
2. Click "Add" or "Create a custom search engine"
3. Configure:
   - **Sites to search**: `linkedin.com/in/*` (to search LinkedIn profiles only)
   - **Name**: "LinkedIn Profile Finder" 
   - **Language**: English
4. Click "Create"
5. Copy your **Search Engine ID** (from the Overview page)

## Step 3: Set Environment Variables

Add to your `.env` file:
```bash
GOOGLE_CSE_API_KEY=your_api_key_here
GOOGLE_CSE_ID=your_search_engine_id_here
```

Or export them:
```bash
export GOOGLE_CSE_API_KEY="your_api_key_here"
export GOOGLE_CSE_ID="your_search_engine_id_here"
```

## Step 4: Test the Implementation

```bash
# Install requirements if needed
pip install requests python-dotenv

# Test with sample profile
python find_linkedins_cse.py --in fixtures/sample.jsonl --out out_cse_test.csv --sleep 1.0 --limit 1 --verbose
```

## Benefits vs Serper API

- ✅ **100 searches/day FREE** (vs paid Serper)
- ✅ **Better LinkedIn coverage** - searches Google's full index  
- ✅ **More discoverable profiles** - finds profiles Serper might miss
- ✅ **Official Google API** - reliable and stable
- ✅ **No rate limiting** for small-scale testing

## Usage Tips

- **Stay within free tier**: 100 searches/day = ~16 profiles with 6 queries each
- **Optimize queries**: The algorithm tries most likely matches first
- **Monitor usage**: Check your quota at Google Cloud Console
- **Batch processing**: Process profiles in small batches to manage quota

## Troubleshooting

**"API key not valid"**: Make sure you enabled the Custom Search API for your project
**"Search engine not found"**: Double-check your GOOGLE_CSE_ID 
**"Daily limit exceeded"**: Wait until tomorrow or upgrade to paid tier ($5/1000 queries)
**No results**: Make sure your CSE is configured to search `linkedin.com/in/*`