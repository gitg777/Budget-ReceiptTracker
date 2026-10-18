// Reads receipts from a photo or PDF with Claude and returns structured data.
// The JSON schema is enforced by the API (structured outputs), so the reply always parses.

import Anthropic from '@anthropic-ai/sdk';

export interface ExtractedItem {
  raw_text: string;
  name: string;
  quantity: number | null;
  amount: number;
  category: string;
}

export interface ExtractedReceipt {
  document_type: string;
  merchant: string | null;
  date: string | null;
  currency: string;
  total: number;
  payment_method: string | null;
  printed_exchange_rate: number | null;
  category: string;
  confidence: 'high' | 'medium' | 'low';
  notes: string | null;
  items: ExtractedItem[];
}

export interface ExtractionResult {
  receipts: ExtractedReceipt[];
  model: string;
  input_tokens: number;
  output_tokens: number;
  raw: string;
}

const nullable = (type: 'string' | 'number') => ({ anyOf: [{ type }, { type: 'null' }] });

function buildSchema(categories: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['receipts'],
    properties: {
      receipts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'document_type', 'merchant', 'date', 'currency', 'total', 'payment_method',
            'printed_exchange_rate', 'category', 'confidence', 'notes', 'items',
          ],
          properties: {
            document_type: {
              type: 'string',
              enum: ['till_slip', 'fiscal_invoice', 'handwritten_receipt', 'airtime_voucher', 'utility_token', 'medical', 'toll', 'other'],
            },
            merchant: nullable('string'),
            date: { ...nullable('string'), description: 'YYYY-MM-DD' },
            currency: { type: 'string', description: 'ISO 4217 code, e.g. USD, ZWG, ZAR, BWP' },
            total: { type: 'number', description: 'Amount actually paid, in the receipt currency' },
            payment_method: nullable('string'),
            printed_exchange_rate: { ...nullable('number'), description: 'ZWG (or other) per 1 USD if printed on the receipt' },
            category: { type: 'string', enum: categories },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            notes: nullable('string'),
            items: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['raw_text', 'name', 'quantity', 'amount', 'category'],
                properties: {
                  raw_text: { type: 'string' },
                  name: { type: 'string' },
                  quantity: nullable('number'),
                  amount: { type: 'number', description: 'Line total in the receipt currency; negative for discounts' },
                  category: { type: 'string', enum: categories },
                },
              },
            },
          },
        },
      },
    },
  };
}

const SYSTEM_PROMPT = `You read shopping receipts and payment documents photographed in Zimbabwe and turn them into data for a household budget.

One image or PDF can contain several separate receipts (a page of scanned slips). Return one entry per separate receipt or payment document. Ignore pages that are not records of money spent.

For each receipt:
- merchant: the shop or payee name as a person would say it ("Fortwell Wholesale", "ZESA", "ZINARA"). For handwritten receipt books, the business that issued the receipt.
- date: YYYY-MM-DD. Zimbabwean handwritten and till dates are usually day/month/year. Fiscal tax invoices from point-of-sale systems are often month/day/year with a time ("10/23/2025 2:48:51 PM"); pick the reading that gives a real date that is not in the future. Use null if there is no date.
- currency: the currency the customer paid in (USD, ZWG, ZAR, BWP...). "ZiG" and "ZWG" are the same currency: use ZWG. "$" alone on a Zimbabwean receipt usually means USD unless the receipt says ZWG/ZiG.
- total: the amount actually paid. Do not use "amount tendered" or "cash" if change was given; use the invoice total.
- printed_exchange_rate: if the receipt prints a conversion rate (for example "1 USD 27.83 ZWG" on a ZESA token), give units per 1 USD; otherwise null.
- items: every purchased line. raw_text is exactly as printed (keep abbreviations). name is a clear, plain description a person would search for, starting with the product type ("Milk, fresh, 2L", "Washing powder, Hippo, 10kg", "Bananas"). amount is the line total including VAT if the printed prices include VAT. Discounts are negative lines. VAT summaries, subtotals, change, tendered amounts, plastic-bag levies already inside another line, and payment lines are NOT items.
- If a receipt has no itemised lines (a handwritten rent receipt, a toll slip, a medical aid levy), return one item that describes what was paid for, with the full total.
- category: the best category for the receipt as a whole; each item also gets its own category, because one supermarket slip can mix groceries, household goods and personal care.
- Airtime and data vouchers: never copy the recharge PIN, scratch code or serial number into any field. Record only the network, value and "Airtime" as the item.
- Medical aid claim forms: record only the amount the patient paid (levy or shortfall), not the gross amount claimed from the medical aid.
- Do not copy personal details (ID numbers, medical aid member numbers, account or meter numbers, phone numbers) into any field.
- confidence: "low" if the image is blurred, cut off, faded or handwritten in a way you had to guess at, or if your item amounts do not add up to the total; "medium" if a few values were hard to read; "high" otherwise.
- notes: one short sentence about anything the person should check (unclear amount, items not adding up, guessed date). null if nothing.`;

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) {
    binary += String.fromCharCode(...view.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export async function extractReceipts(opts: {
  apiKey: string;
  model: string;
  bytes: ArrayBuffer;
  mime: string;
  categories: string[];
}): Promise<ExtractionResult> {
  const client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 2 });
  const data = toBase64(opts.bytes);

  const fileBlock: Anthropic.ContentBlockParam =
    opts.mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
      : {
          type: 'image',
          source: { type: 'base64', media_type: opts.mime as (typeof SUPPORTED_IMAGE_TYPES)[number], data },
        };

  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: 'json_schema', schema: buildSchema(opts.categories) } },
    messages: [
      {
        role: 'user',
        content: [fileBlock, { type: 'text', text: 'Extract every receipt in this file.' }],
      },
    ],
  });

  if (response.stop_reason === 'refusal') throw new Error('The reader declined this file. Please enter it by hand.');
  if (response.stop_reason === 'max_tokens') throw new Error('This file has too many lines to read in one go. Try photographing fewer receipts at a time.');

  const text = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  const parsed = JSON.parse(text) as { receipts: ExtractedReceipt[] };

  return {
    receipts: parsed.receipts,
    model: response.model,
    input_tokens: response.usage.input_tokens,
    output_tokens: response.usage.output_tokens,
    raw: text,
  };
}
