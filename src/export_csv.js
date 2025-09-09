import fs from 'fs';
import path from 'path';

const INPUT = path.resolve(process.cwd(), 'data', 'profiles.jsonl');
const OUTPUT = path.resolve(process.cwd(), 'data', 'profiles.csv');

function toCsvValue(v) {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('; ') : String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function normalizeUrl(u) {
  try {
    const url = new URL(u, 'https://www.upwork.com');
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return u || '';
  }
}

async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error('Input not found:', INPUT);
    process.exit(1);
  }
  const lines = fs.readFileSync(INPUT, 'utf8').trim().split('\n').filter(Boolean);
  const rows = lines.map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  const headers = ['url','name','headline','rate','earnings','jobSuccess','location','skills','scrapedAt'];
  const csv = [headers.join(',')].concat(
    rows.map(r => {
      const row = { ...r, url: normalizeUrl(r.url) };
      return headers.map(h => toCsvValue(row[h])).join(',');
    })
  ).join('\n');

  fs.writeFileSync(OUTPUT, csv);
  console.log('Wrote', OUTPUT);
}

main().catch(err => { console.error(err); process.exit(1); });


