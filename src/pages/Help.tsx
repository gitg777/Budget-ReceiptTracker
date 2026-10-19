import type { ReactNode } from 'react';
import type { Me } from '../api';
import { formatCredit, receiptsFor, TOPUP_PACKS_USD } from '../../shared/pricing';
import { RockStack } from '../art';
import { LinkButton } from '../ui';
import { Contact } from './Home';

// How the app works, in plain words. One open/close section per topic so it stays short on a phone.

function Section({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group rounded-[18px] border border-line bg-surface">
      <summary className="flex min-h-13 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-display text-base font-semibold text-ink">
        {title}
        <span aria-hidden="true" className="text-xl leading-none text-brand transition group-open:rotate-45">+</span>
      </summary>
      <div className="space-y-2 px-4 pb-4 text-[15px] leading-relaxed text-body [&_b]:text-ink [&_li]:ml-5 [&_li]:list-disc">{children}</div>
    </details>
  );
}

export function Help({ me }: { me: Me }) {
  const owner = me.user.role === 'owner';
  const c = me.credit;
  const perReceipt = c?.per_receipt_micros ?? 0;
  return (
    <div className="space-y-3">
      <section className="relative overflow-hidden rounded-[18px] bg-band p-5 text-on-band">
        <RockStack className="absolute -right-2 -bottom-2 h-28 w-36" />
        <h1 className="relative font-display text-2xl font-extrabold text-on-band">How it works</h1>
        <p className="relative mt-1 max-w-[70%] text-sm text-[#d3ddd5]">Snap the receipt, check it, save it. The app does the adding up.</p>
      </section>

      <Section title="1. Snap a receipt" open>
        <p>Tap <b>Snap receipt</b> on Home. Lay the receipt flat in good light with the whole width in the frame, then tap the gold button.</p>
        <p>One photo can hold several small receipts side by side. Each comes back as its own receipt.</p>
        <p>Then tap <b>Done</b>. After a few seconds it appears under <b>To check and save</b> on Home.</p>
      </Section>

      <Section title="2. Long receipts (several photos)">
        <ul>
          <li>Start at the <b>top</b> of the slip and snap.</li>
          <li>Slide the phone down. The bottom of your last photo shows <b>faintly at the top</b> of the camera. Line it up with the same lines on the paper, so the photos overlap a little, and snap again.</li>
          <li>Keep going until the <b>TOTAL</b> is in your last photo (up to 6 photos), then tap <b>Done — read all as one receipt</b>.</li>
        </ul>
        <p>All the photos are read together as one receipt. Lines that appear twice in the overlap are counted once.</p>
        <p>Each photo costs about as much to read as one ordinary receipt.</p>
      </Section>

      <Section title="3. Totals only">
        <p>For a very long slip where you don't need every item, switch to <b>Totals only</b> on the camera screen. Only the shop, date and total are read.</p>
        <p>You can photograph just the top (shop and date) and the bottom (the total). It is quicker and cheaper.</p>
      </Section>

      <Section title="4. Check and save">
        <p>Look over what was read: shop, date, total and the lines. Fix anything that's wrong, then tap <b>Save receipt</b>.</p>
        <p>If the lines don't add up to the total, you'll see a gold warning. Usually part of a long receipt was missed: tap <b>Add the missing photo</b> and it is read again with the extra photo. Or correct the lines by hand.</p>
        <p>If something was changed after reading, say why in the box at the bottom. Every change is kept with your name.</p>
      </Section>

      <Section title="5. Choosing the exchange rate">
        <p>Each receipt in another currency (ZiG, Rand, Pula…) picks its own rate to US dollars:</p>
        <ul>
          <li><b>Going rate</b>: the official rate, fetched automatically twice a day.</li>
          <li><b>Last used</b>: the same rate as your last receipt in that currency.</li>
          <li><b>Printed on receipt</b>: when the slip shows its own rate (ZESA tokens often do).</li>
          <li><b>New rate</b>: type the rate you actually paid.</li>
        </ul>
        <p>The rate is saved with the receipt and never changes afterwards.</p>
      </Section>

      <Section title="6. Files, PDFs and e-receipts">
        <p>Tap <b>Upload a file, PDF or screenshot</b> on Home to read receipts you already have on the phone, such as a PDF invoice or a screenshot of an EcoCash or bank payment.</p>
        <p>On Android, once the app is on your home screen, you can also <b>Share</b> a photo or PDF from WhatsApp, Gmail or Gallery straight to <b>Budget</b>.</p>
      </Section>

      <Section title="7. No signal or no power">
        <p>Photos are saved on the phone first and send by themselves when there's signal. You'll see them under <b>Waiting to send</b>. Don't clear the app's data while photos are waiting.</p>
      </Section>

      {owner ? (
        <Section title="8. Helpers and cash">
          <p>Under <b>Helpers</b>, add someone (a driver or housekeeper) with a username and PIN, and give them an allowance: weekly, monthly or no limit, with or without carry-over.</p>
          <p>Record cash you give them. Their receipts count against it, and the app works out how much cash they should have.</p>
          <p>They can <b>cash up</b> in one tap by counting their change. If they pay with their own money, they mark it, and you can <b>pay back</b> from their page.</p>
        </Section>
      ) : (
        <Section title="8. Your allowance and cash-up">
          <p>Home shows how much allowance you have left and how much cash you should have.</p>
          <p>Use <b>Cash-up</b> to count your change and hand it back if asked. If you run out of cash and pay with your own money, choose <b>My own money</b> when saving, and it will be paid back.</p>
        </Section>
      )}

      {owner && (
        <Section title="9. Reports and Excel">
          <p><b>Reports</b> shows each month by category against your budgets, by shop and by person, plus a search for any item ("milk", "diesel").</p>
          <p><b>Export to Excel</b> gives you every receipt, every line and every change.</p>
        </Section>
      )}

      {c && !c.unlimited && (
        <Section title={owner ? '10. Reading credit' : '9. Reading credit'}>
          <p>Each account starts with <b>$5 free</b> reading credit. A typical receipt costs about <b>{formatCredit(perReceipt)}</b>, so $1 reads about {receiptsFor(1_000_000, perReceipt).toLocaleString()} receipts. Long receipts cost a little more for each extra photo.</p>
          <p>Typing a receipt in by hand is always free.</p>
          {owner && (
            <p>
              To top up ({TOPUP_PACKS_USD.map((p) => `$${p}`).join(', ')}), contact <Contact c={c} />.
            </p>
          )}
        </Section>
      )}

      <Section title="Put the app on your home screen">
        <p>In Chrome tap ⋮ then <b>Add to Home screen</b>. On iPhone (Safari) tap Share then <b>Add to Home Screen</b>. It then opens like any other app and works without signal.</p>
      </Section>

      <Section title="Day and Night">
        <p>Choose <b>Day</b>, <b>Night</b> or <b>Same as phone</b> on Home or under More.</p>
      </Section>

      <div className="flex flex-col gap-2 pt-2">
        <LinkButton variant="gold" href="#/capture" className="min-h-13">Snap my first receipt</LinkButton>
        <LinkButton variant="secondary" href="#/feedback">Something unclear? Send feedback</LinkButton>
      </div>
    </div>
  );
}
