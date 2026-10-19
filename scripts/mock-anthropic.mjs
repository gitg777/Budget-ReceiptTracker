// Stand-in for the Anthropic API for local tests: answers every request with one fixed receipt
// and the token counts of the first real reading (5,360 in / 726 out).
// Usage: node scripts/mock-anthropic.mjs   (port 9999), with ANTHROPIC_BASE_URL=http://127.0.0.1:9999 in .dev.vars
import { createServer } from 'node:http';

const receipt = {
  receipts: [{
    document_type: 'till_slip', merchant: 'Greenvale', date: '2026-10-18', currency: 'USD', total: 2.6, payment_method: 'Cash',
    printed_exchange_rate: null, category: 'Personal Care', confidence: 'high', notes: null,
    items: [
      { raw_text: 'LIL LETS SUPER 10S', name: 'Sanitary pads, Lil-Lets Super, 10', quantity: 1, amount: 1.3, category: 'Personal Care' },
      { raw_text: 'LIL LETS SUPER PLUS 10S', name: 'Sanitary pads, Lil-Lets Super Plus, 10', quantity: 1, amount: 1.3, category: 'Personal Care' },
    ],
  }],
};

// GET /last tells a test what the app sent in its last request (how many photos, which instructions).
let last = { images: 0, documents: 0, text: '' };

createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/last') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify(last));
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    try {
      const content = JSON.parse(body).messages?.[0]?.content ?? [];
      last = {
        images: content.filter((b) => b.type === 'image').length,
        documents: content.filter((b) => b.type === 'document').length,
        text: content.filter((b) => b.type === 'text').map((b) => b.text).join('\n'),
      };
    } catch {
      /* not JSON: leave last as it was */
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      id: 'msg_mock', type: 'message', role: 'assistant', model: 'claude-haiku-5-5',
      content: [{ type: 'text', text: JSON.stringify(receipt) }],
      stop_reason: 'end_turn', stop_sequence: null,
      usage: { input_tokens: 5360, output_tokens: 726 },
    }));
  });
}).listen(9999, '127.0.0.1', () => console.log('mock Anthropic on :9999'));
