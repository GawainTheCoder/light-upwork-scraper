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

function currencySymbol(code) {
  switch (code) {
    case 'USD': return '$';
    case 'EUR': return '€';
    case 'GBP': return '£';
    case 'AUD': return 'A$';
    case 'CAD': return 'C$';
    default: return '';
  }
}

function formatMoney(amount, currency, withCents = false) {
  if (amount === null || amount === undefined || Number.isNaN(Number(amount))) return '';
  const symbol = currencySymbol(currency);
  const fmt = new Intl.NumberFormat('en-US', withCents ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : undefined);
  return symbol + fmt.format(Number(amount));
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

  // Include both display columns and normalized numeric columns
  const headers = [
    'url','name','title',
    'rate','earnings','jobSuccess',
    'hourlyRate','currency','earningsTotal','jobSuccessScore',
    'location','skills','scrapedAt'
  ];

  const csv = [headers.join(',')].concat(
    rows.map(r => {
      const row = { ...r, url: normalizeUrl(r.url) };
      // Compute display fields from normalized values when raw fields are absent
      const rateDisplay = row.rate || (row.hourlyRate !== undefined && row.hourlyRate !== null
        ? `${formatMoney(row.hourlyRate, row.currency, true)}/hr` : '');
      const earningsDisplay = row.earnings || (row.earningsTotal !== undefined && row.earningsTotal !== null
        ? formatMoney(row.earningsTotal, row.currency) : '');
      const jssDisplay = row.jobSuccess || (row.jobSuccessScore !== undefined && row.jobSuccessScore !== null
        ? `${row.jobSuccessScore}%` : '');

      // Backward compatibility: some older rows may still contain 'headline' instead of 'title'
      if (!row.title && row.headline) row.title = row.headline;
      const out = {
        ...row,
        rate: rateDisplay,
        earnings: earningsDisplay,
        jobSuccess: jssDisplay
      };
      return headers.map(h => toCsvValue(out[h])).join(',');
    })
  ).join('\n');

  fs.writeFileSync(OUTPUT, csv);
  console.log('Wrote', OUTPUT);
}

main().catch(err => { console.error(err); process.exit(1); });


