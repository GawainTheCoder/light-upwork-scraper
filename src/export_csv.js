import fs from 'fs';
import path from 'path';

const INPUT = path.resolve(process.cwd(), 'data', 'profiles.jsonl');
const OUTPUT = path.resolve(process.cwd(), 'data', 'profiles.csv');

function parseArgs(argv = process.argv.slice(2)) {
  const out = { sourceFile: null, keyColumn: 'url' };
  for (const token of argv) {
    const [rawKey, rawVal] = token.includes('=') ? token.split(/=(.*)/, 2) : [token, null];
    const key = rawKey.replace(/^--/, '');
    const val = rawVal ?? null;
    if (key === 'source-file') {
      if (val) out.sourceFile = val.trim();
    } else if (key === 'key-column') {
      if (val) out.keyColumn = val.trim();
    }
  }
  return out;
}

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

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result.map(v => v.trim());
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
  const args = parseArgs();
  if (!fs.existsSync(INPUT)) {
    console.error('Input not found:', INPUT);
    process.exit(1);
  }
  const lines = fs.readFileSync(INPUT, 'utf8').trim().split('\n').filter(Boolean);
  const rows = lines.map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  if (args.sourceFile) {
    const sourcePath = path.isAbsolute(args.sourceFile)
      ? args.sourceFile
      : path.resolve(process.cwd(), args.sourceFile);
    if (!fs.existsSync(sourcePath)) {
      console.error('Source CSV not found:', sourcePath);
      process.exit(1);
    }

    const csvLines = fs.readFileSync(sourcePath, 'utf8').split(/\r?\n/).filter(line => line.length > 0);
    if (csvLines.length === 0) {
      console.error('Source CSV is empty:', sourcePath);
      process.exit(1);
    }

    const headerCells = parseCsvLine(csvLines[0]);
    const lowerHeader = headerCells.map(h => h.toLowerCase());
    const targetColumn = (args.keyColumn || 'url').toLowerCase();
    let urlIndex = lowerHeader.indexOf(targetColumn);
    if (urlIndex === -1) {
      console.warn(`Column "${args.keyColumn}" not found in ${sourcePath}. Using first column.`);
      urlIndex = 0;
    }

    const recordMap = new Map();
    let maxLinked = 0;
    for (const record of rows) {
      const norm = normalizeUrl(record.url);
      recordMap.set(norm, record);
      const count = Array.isArray(record.linkedAccounts) ? record.linkedAccounts.length : 0;
      if (count > maxLinked) maxLinked = count;
    }

    const appendHeaders = [];
    for (let i = 1; i <= maxLinked; i++) {
      appendHeaders.push(
        `linked_account_${i}_platform`,
        `linked_account_${i}_username`,
        `linked_account_${i}_profile_url`,
        `linked_account_${i}_profile_host`
      );
    }

    const outputLines = [];
    outputLines.push(headerCells.concat(appendHeaders).map(toCsvValue).join(','));

    for (let i = 1; i < csvLines.length; i++) {
      const cells = parseCsvLine(csvLines[i]);
      const baseValues = headerCells.map((_, idx) => toCsvValue(cells[idx] ?? ''));
      const urlRaw = cells[urlIndex] || '';
      const normalized = normalizeUrl(urlRaw);
      const record = recordMap.get(normalized);
      const linked = Array.isArray(record?.linkedAccounts) ? record.linkedAccounts : [];

      const linkedValues = [];
      for (let j = 0; j < maxLinked; j++) {
        const acc = linked[j];
        linkedValues.push(
          toCsvValue(acc?.platform || ''),
          toCsvValue(acc?.username || ''),
          toCsvValue(acc?.profileUrl || ''),
          toCsvValue(acc?.profileHost || '')
        );
      }

      outputLines.push(baseValues.concat(linkedValues).join(','));
    }

    fs.writeFileSync(OUTPUT, outputLines.join('\n'));
    console.log('Wrote', OUTPUT, '(merged with source CSV)');
    return;
  }

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
