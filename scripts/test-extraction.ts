// Runs the receipt reader over a folder of receipt photos/PDFs and prints what it found,
// so the model can be judged on real receipts before (and after) going live.
//
//   ANTHROPIC_API_KEY=sk-ant-... node --experimental-strip-types scripts/test-extraction.ts ./test-receipts [model]
//
// Writes results.json in that folder. Files over 10 MB are skipped (the app refuses them too).
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { extractReceipts } from '../worker/extract.ts';
import { DEFAULT_CATEGORIES } from '../shared/money.ts';

const dir = process.argv[2];
const model = process.argv[3] ?? 'claude-haiku-5-5';
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!dir || !apiKey) {
  console.error('Usage: ANTHROPIC_API_KEY=... node --experimental-strip-types scripts/test-extraction.ts <folder> [model]');
  process.exit(1);
}
// USD per million tokens, from Anthropic's price list as of Oct 2026 (prompts under 100K tokens).
const PRICES: Record<string, [number, number]> = { 'claude-haiku-5-5': [0.1, 0.5], 'claude-sonnet-5-5': [2, 10] };
const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' };

const results: unknown[] = [];
let inTok = 0;
let outTok = 0;
for (const name of readdirSync(dir).sort()) {
  const mime = MIME[extname(name).toLowerCase()];
  if (!mime) continue;
  const path = join(dir, name);
  if (statSync(path).size > 10 * 1024 * 1024) {
    console.log(`SKIP ${name}: over 10 MB`);
    continue;
  }
  const started = Date.now();
  try {
    const bytes = readFileSync(path);
    const r = await extractReceipts({ apiKey, model, bytes: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), mime, categories: [...DEFAULT_CATEGORIES] });
    inTok += r.input_tokens;
    outTok += r.output_tokens;
    console.log(`\n${name}  (${((Date.now() - started) / 1000).toFixed(1)}s, ${r.receipts.length} receipt(s))`);
    for (const x of r.receipts) {
      const sum = x.items.reduce((s, i) => s + i.amount, 0);
      const flag = Math.abs(sum - x.total) > 0.011 ? `  ITEMS ${sum.toFixed(2)} != TOTAL` : '';
      console.log(`  ${x.date ?? '????-??-??'}  ${x.merchant ?? '?'}  ${x.currency} ${x.total.toFixed(2)}  [${x.category}] ${x.items.length} items, ${x.confidence}${flag}`);
      if (x.notes) console.log(`    note: ${x.notes}`);
    }
    results.push({ file: name, ...r });
  } catch (e) {
    console.log(`\n${name}  FAILED: ${(e as Error).message}`);
    results.push({ file: name, error: (e as Error).message });
  }
}
const [pin, pout] = PRICES[model] ?? [0, 0];
console.log(`\nTokens: ${inTok} in, ${outTok} out. Cost about $${((inTok * pin + outTok * pout) / 1e6).toFixed(4)} (${model}).`);
writeFileSync(join(dir, 'results.json'), JSON.stringify(results, null, 2));
