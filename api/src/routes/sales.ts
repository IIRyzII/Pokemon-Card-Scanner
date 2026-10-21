// Sold comps ("eBay last solds") logged by editors — raw or graded.

import { Hono } from 'hono';
import { CURRENCIES } from '../../../shared/currency.ts';
import { GRADERS, GRADE_LABELS, isGrade } from '../../../shared/grading.ts';
import { authenticate, requireRole } from '../auth.ts';
import { auditStmt, toSale } from '../db.ts';
import { HttpError, nowIso, todayIso, type AppEnv } from '../env.ts';
import { homeCurrency } from '../fx.ts';
import { recomputeValues } from '../prices.ts';
import { cardId as parseCardId, httpUrl, isoDate, number, oneOf, readJson, text } from '../validate.ts';

const sales = new Hono<AppEnv>();
sales.use('*', authenticate, requireRole('viewer'));

sales.get('/', async (c) => {
  const cardId = parseCardId(c.req.query('cardId'));
  const { results } = await c.env.DB.prepare('SELECT * FROM sales WHERE card_id = ? ORDER BY sold_on DESC, created_at DESC')
    .bind(cardId)
    .all();
  return c.json({ sales: results.map(toSale) });
});

sales.post('/', requireRole('editor'), async (c) => {
  const body = await readJson(c.req.raw);
  const cardId = parseCardId(body.cardId);
  const grader = oneOf(body.grader ?? 'RAW', GRADERS, 'Grader')!;
  let grade: number | null = null;
  let gradeLabel: string | null = null;
  if (grader !== 'RAW') {
    grade = number(body.grade, 'Grade', { min: 1, max: 10 });
    if (!isGrade(grade)) throw new HttpError(400, 'Grade must be 1–10 in half steps');
    if (grade === 10) gradeLabel = oneOf(body.gradeLabel, GRADE_LABELS[grader] ?? [], 'Grade label', { optional: true });
  }
  const price = number(body.price, 'Price', { min: 0, max: 10_000_000 })!;
  const currency = oneOf(body.currency ?? homeCurrency(c.env), CURRENCIES, 'Currency')!;
  const soldOn = isoDate(body.soldOn ?? todayIso(), 'Sold date')!;
  // The app sends the user's local date, which can already be tomorrow in UTC (in the UK just after
  // midnight in summer, in Australia for half the day): allow any date that's today somewhere.
  const latestToday = new Date(Date.now() + 14 * 3_600_000).toISOString().slice(0, 10);
  if (soldOn > latestToday) throw new HttpError(400, "The sold date can't be in the future");
  const source = text(body.source, 'Source', { optional: true, max: 40 }) ?? 'eBay';
  const url = httpUrl(body.url, 'Listing link');
  const note = text(body.note, 'Note', { optional: true, max: 300 });
  const user = c.get('user');
  const id = crypto.randomUUID();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO sales (id, card_id, grader, grade, grade_label, price, currency, sold_on, source, url, note, created_by,
         created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      cardId,
      grader,
      grade,
      gradeLabel,
      Math.round(price * 100) / 100,
      currency,
      soldOn,
      source,
      url,
      note,
      user.id,
      nowIso(),
    ),
    auditStmt(c.env, user, 'log-sale', 'card', cardId, { grader, grade, gradeLabel, price, currency, soldOn, source }),
  ]);
  await recomputeValues(c.env, cardId);
  const row = await c.env.DB.prepare('SELECT * FROM sales WHERE id = ?').bind(id).first();
  return c.json({ sale: toSale(row!) }, 201);
});

sales.delete('/:id', requireRole('editor'), async (c) => {
  const row = await c.env.DB.prepare('SELECT * FROM sales WHERE id = ?').bind(c.req.param('id')).first();
  if (!row) throw new HttpError(404, 'Sale not found');
  const sale = toSale(row);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sales WHERE id = ?').bind(sale.id),
    auditStmt(c.env, c.get('user'), 'delete-sale', 'card', sale.cardId, {
      grader: sale.grader,
      grade: sale.grade,
      price: sale.price,
      soldOn: sale.soldOn,
    }),
  ]);
  await recomputeValues(c.env, sale.cardId);
  return c.json({ ok: true });
});

export default sales;
