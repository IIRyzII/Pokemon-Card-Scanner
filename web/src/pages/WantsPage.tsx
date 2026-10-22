// The want list: every card still to get (the gaps in the binders and the cards picked by hand),
// set by set and priced for the printing wanted; what it all costs; and the best cards a budget
// gets, keeping some of it back as a buffer.

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { BINDER_COLOURS } from '../../../shared/binders.ts';
import { cardNumberText } from '../../../shared/links.ts';
import { hasRole, type Binder, type PriceRow } from '../../../shared/types.ts';
import { WANT_PRIORITIES, type WantPriority } from '../../../shared/wants.ts';
import { CardImage } from '../components/CardImage.tsx';
import { useFeedback } from '../components/feedback.tsx';
import { IconHeart, IconSearch } from '../components/Icons.tsx';
import { ProgressBar } from '../components/ProgressBar.tsx';
import { TiltCard } from '../components/TiltCard.tsx';
import { PRIORITY_STARS, WantSheet } from '../components/WantSheet.tsx';
import { api } from '../lib/api.ts';
import { ownedPrintings, printingNote } from '../lib/binders.ts';
import { normName, type CatalogCard } from '../lib/catalog.ts';
import { useCollection } from '../lib/collection.tsx';
import { useCurrency } from '../lib/currency.tsx';
import { href, useQueryParam } from '../lib/router.ts';
import { priceLookup, setLogoUrl } from '../lib/sets.ts';
import { useSession } from '../lib/session.tsx';
import { useCatalog, useMarketPrices } from '../lib/useCatalog.ts';
import {
  gotSince,
  groupBySet,
  isDeal,
  isPlanMode,
  planBudget,
  PLAN_MODES,
  priceEntry,
  snapshotOf,
  wantList,
  type BudgetPlan,
  type EntryPrice,
  type PlanMode,
  type WantEntry,
  type WantGroup,
  type WantSnapshot,
} from '../lib/wants.ts';
import { useWants } from '../lib/wantsContext.tsx';

type Show = 'all' | 'must' | 'deals' | 'budget';
type SetOrder = 'new' | 'old' | 'cost' | 'count' | 'name';

const PLAN_KEY = 'pokevault.wantPlan';
const SNAPSHOT_KEY = 'pokevault.wantSnapshot';
const BUFFERS = [0, 5, 10, 15, 20];

interface PlanSettings {
  budget: string;
  buffer: number;
  mode: PlanMode;
}

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode: it's just not remembered
  }
}
function readPlan(): PlanSettings {
  const v = readJson<Partial<PlanSettings>>(PLAN_KEY);
  return {
    budget: typeof v?.budget === 'string' ? v.budget : '',
    buffer: typeof v?.buffer === 'number' && BUFFERS.includes(v.buffer) ? v.buffer : 10,
    mode: isPlanMode(v?.mode) ? v.mode : 'priority',
  };
}

export function WantsPage() {
  const { catalog, error: catalogError } = useCatalog();
  const { data, ownedByCard } = useCollection();
  const { wants, error: wantsError, remove } = useWants();
  const prices = useMarketPrices();
  const { convert, format, currency, ctx } = useCurrency();
  const { user } = useSession();
  const { toast, confirm } = useFeedback();
  const canEdit = hasRole(user?.role, 'editor');

  const [binders, setBinders] = useState<Binder[] | null>(null);
  const [bindersError, setBindersError] = useState<string | null>(null);
  const [stored, setStored] = useState<Record<string, PriceRow[]>>({});
  const [query, setQuery] = useQueryParam('q');
  const [show, setShow] = useState<Show>('all');
  const [source, setSource] = useState('all');
  const [order, setOrder] = useState<SetOrder>('new');
  const [plan, setPlanState] = useState(readPlan);
  const [opened, setOpened] = useState<WantEntry | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [justGot, setJustGot] = useState<string[]>([]);

  const setPlan = (patch: Partial<PlanSettings>) =>
    setPlanState((p) => {
      const next = { ...p, ...patch };
      writeJson(PLAN_KEY, next);
      return next;
    });

  useEffect(() => {
    api.binders().then(
      (r) => setBinders(r.binders),
      (err: Error) => setBindersError(err.message),
    );
  }, []);

  const known = useCallback((cardId: string) => catalog?.byId.get(cardId)?.variants ?? null, [catalog]);
  const owned = useMemo(() => ownedPrintings(data?.items ?? [], known), [data, known]);
  const ready = !!(catalog && data && wants && binders);
  const { entries, got } = useMemo(
    () => (ready ? wantList(wants!, binders!, owned, known) : { entries: [] as WantEntry[], got: [] }),
    [ready, wants, binders, owned, known],
  );

  // The prices stored for each card on the list, for the printing wanted (fetched as the ids change).
  const ids = useMemo(() => [...new Set(entries.map((e) => e.cardId))].sort().join(','), [entries]);
  useEffect(() => {
    if (!ids) return;
    let alive = true;
    const list = ids.split(',');
    (async () => {
      const out: Record<string, PriceRow[]> = {};
      for (let i = 0; i < list.length; i += 1500) Object.assign(out, (await api.cardPrices(list.slice(i, i + 1500))).prices);
      if (alive) setStored(out);
    })().catch(() => undefined); // the catalog's prices stand in
    return () => {
      alive = false;
    };
  }, [ids]);

  const cardOf = useCallback((e: WantEntry) => catalog?.byId.get(e.cardId), [catalog]);
  const usualOf = useMemo(() => priceLookup(prices, convert), [prices, convert]);
  const priced = useMemo(() => {
    const map = new Map<string, EntryPrice>();
    for (const e of entries) {
      const card = cardOf(e);
      map.set(e.key, priceEntry(e, stored[e.cardId], ctx, card ? usualOf(card) : null));
    }
    return map;
  }, [entries, stored, ctx, usualOf, cardOf]);
  const priceOf = useCallback((e: WantEntry) => priced.get(e.key)?.each ?? null, [priced]);
  const dealOf = useCallback((e: WantEntry) => isDeal(e, priceOf(e), convert), [priceOf, convert]);

  // Ticked off since last time: more copies of a card that was on the list than there were then.
  useEffect(() => {
    if (!ready) return;
    const newly = gotSince(readJson<WantSnapshot>(SNAPSHOT_KEY), owned);
    if (newly.length) setJustGot((list) => [...new Set([...list, ...newly])]);
    writeJson(SNAPSHOT_KEY, snapshotOf(entries));
  }, [ready, entries, owned]);

  const q = normName(query);
  const filtered = useMemo(
    () =>
      entries.filter((e) => {
        if (source === 'picked' ? !e.want : source !== 'all' && !e.binders.some((b) => b.binderId === source)) return false;
        if (!q) return true;
        const c = cardOf(e);
        return !!c && normName(`${c.name} ${c.set.name} ${c.number} ${c.set.code ?? ''}`).includes(q);
      }),
    [entries, source, q, cardOf],
  );

  const budget = Number(plan.budget);
  const budgetPlan = useMemo(
    () => (budget > 0 ? planBudget(filtered, priceOf, budget, plan.buffer, plan.mode) : null),
    [filtered, priceOf, budget, plan.buffer, plan.mode],
  );
  const inPlan = useMemo(() => new Map(budgetPlan?.picks.map((p) => [p.entry.key, p.copies]) ?? []), [budgetPlan]);

  const shown = useMemo(
    () => filtered.filter((e) => (show === 'all' ? true : show === 'must' ? e.priority === 1 : show === 'deals' ? dealOf(e) : inPlan.has(e.key))),
    [filtered, show, dealOf, inPlan],
  );
  const groups = useMemo(() => {
    if (!catalog) return [];
    const cost = (g: WantGroup) => g.entries.reduce((sum, e) => sum + (priceOf(e) ?? 0) * e.need, 0);
    const count = (g: WantGroup) => g.entries.reduce((n, e) => n + e.need, 0);
    const date = (g: WantGroup) => g.set.date ?? '';
    return groupBySet(shown, catalog).sort((a, b) =>
      order === 'old'
        ? date(a).localeCompare(date(b))
        : order === 'cost'
          ? cost(b) - cost(a)
          : order === 'count'
            ? count(b) - count(a)
            : order === 'name'
              ? a.set.name.localeCompare(b.set.name)
              : date(b).localeCompare(date(a)),
    );
  }, [catalog, shown, order, priceOf]);

  // What it all costs (the cards in view)
  const totals = useMemo(() => {
    const t = { copies: 0, cards: 0, cost: 0, unpriced: 0, approx: 0, mustCopies: 0, mustCost: 0, deals: 0, sets: new Set<string>(), top: null as { e: WantEntry; each: number } | null };
    for (const e of filtered) {
      const each = priceOf(e);
      t.copies += e.need;
      t.cards++;
      t.sets.add(cardOf(e)?.set.id ?? '');
      if (each === null) t.unpriced += e.need;
      else {
        t.cost += each * e.need;
        if (!priced.get(e.key)?.exact) t.approx += e.need;
        if (!t.top || each > t.top.each) t.top = { e, each };
      }
      if (e.priority === 1) {
        t.mustCopies += e.need;
        t.mustCost += (each ?? 0) * e.need;
      }
      if (dealOf(e)) t.deals++;
    }
    return t;
  }, [filtered, priceOf, priced, dealOf, cardOf]);

  const money = (v: number) => format(v, currency);
  const ticked = useMemo(() => {
    const keys = new Set(justGot);
    for (const w of got) keys.add(`${w.cardId}|${w.variant}`);
    return [...keys].map((k) => {
      const [cardId, variant] = k.split('|');
      return { key: k, cardId, variant, card: catalog?.byId.get(cardId), want: got.find((w) => w.cardId === cardId && w.variant === variant) };
    });
  }, [justGot, got, catalog]);

  async function clearTicked() {
    const done = ticked.filter((t) => t.want);
    if (done.length && canEdit) {
      const ok = await confirm({
        title: `Take ${done.length === 1 ? 'it' : `these ${done.length}`} off the list?`,
        body: 'You have all the copies you wanted.',
        confirmText: 'Take off',
      });
      if (!ok) return;
      try {
        for (const t of done) await remove(t.want!.id);
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    }
    setJustGot([]);
  }

  async function share(text: string, title: string) {
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title, text });
        return;
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied: paste it anywhere');
    } catch {
      toast("Couldn't copy the list", 'error');
    }
  }

  const line = (e: WantEntry, copies = e.need) => {
    const c = cardOf(e);
    const each = priceOf(e);
    const p = priced.get(e.key);
    const price = each === null ? 'no price' : `${p?.exact ? '' : '≈'}${money(each)}${copies > 1 ? ' each' : ''}`;
    const stars = e.priority === 1 ? ' ★ must have' : '';
    return `  • ${c?.name ?? e.cardId} #${c ? cardNumberText(c.number, c.set.official) : ''} · ${printingNote(e.variant)}${copies > 1 ? ` ×${copies}` : ''} · ${price}${stars}`;
  };
  const listText = () => {
    const out = [`Want list: ${totals.copies} cards, about ${money(totals.cost)}`];
    for (const g of groups) {
      out.push('', `${g.set.name}${g.set.code ? ` (${g.set.code})` : ''}`);
      for (const e of g.entries) out.push(line(e));
    }
    return out.join('\n');
  };
  const planText = (p: BudgetPlan) => {
    const out = [
      `Shopping list: ${p.copies} cards for ${money(p.spent)} (budget ${money(p.budget)}, ${money(p.buffer)} kept back)`,
      `${PLAN_MODES[plan.mode]}`,
    ];
    for (const pick of p.picks) out.push(line(pick.entry, pick.copies));
    return out.join('\n');
  };

  const loading = !ready && !catalogError && !wantsError && !bindersError;
  const sources = binders?.filter((b) => entries.some((e) => e.binders.some((x) => x.binderId === b.id))) ?? [];

  return (
    <div className="page wants-page">
      <h1>Want list</h1>
      <p className="muted small">
        Every card still missing from your binders, and the cards you've picked with <IconHeart filled width={13} height={13} /> Want it on a
        card's page. Copies you already have count towards both.
      </p>
      {(catalogError || wantsError || bindersError) && <p className="error">{catalogError ?? wantsError ?? bindersError}</p>}
      {loading && <div className="spinner" aria-label="Loading the want list" />}

      {ready && ticked.length > 0 && (
        <section className="ticked" aria-label="Ticked off">
          <div className="ticked-head">
            <b>🎉 Ticked off</b>
            <button className="btn small ghost" onClick={clearTicked}>
              {ticked.some((t) => t.want) && canEdit ? 'Clear' : 'Dismiss'}
            </button>
          </div>
          <div className="ticked-cards">
            {ticked.map((t) => (
              <a key={t.key} className="ticked-card" href={href('card', t.cardId)} title={`${t.card?.name ?? t.cardId} · ${printingNote(t.variant)}`}>
                <CardImage base={t.card?.image} name={t.card?.name ?? t.cardId} setId={t.card?.set.id} number={t.card?.number} />
                <span className="ticked-check" aria-hidden="true">
                  ✓
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      {ready && entries.length === 0 && (
        <div className="empty">
          <p>
            <b>Nothing to get. </b>
            {binders!.length ? 'Every pocket in your binders is filled.' : 'Set up a binder and its empty pockets show up here.'}
          </p>
          <p className="muted small">Open any card and tap ♡ Want it to put it on the list, with how much you want it and the most you'd pay.</p>
          <div className="actions center">
            <a className="btn" href="#/binders">
              Binders
            </a>
            <a className="btn primary" href="#/add">
              Find a card
            </a>
          </div>
        </div>
      )}

      {ready && entries.length > 0 && (
        <>
          <section className="want-hero">
            <div className="want-hero-total">
              <span className="faint small">To get everything{source !== 'all' || q ? ' shown' : ''}</span>
              <b>{money(totals.cost)}</b>
              <span className="muted small">
                {totals.copies} card{totals.copies === 1 ? '' : 's'} · {totals.sets.size} set{totals.sets.size === 1 ? '' : 's'}
                {totals.unpriced > 0 && ` · ${totals.unpriced} without a price yet`}
              </span>
            </div>
            <dl className="set-values">
              <div>
                <dt>Must haves</dt>
                <dd>{totals.mustCopies ? money(totals.mustCost) : '—'}</dd>
              </div>
              <div>
                <dt>Deals now</dt>
                <dd className={totals.deals ? 'good' : ''}>{totals.deals}</dd>
              </div>
              <div>
                <dt>Priciest</dt>
                <dd>{totals.top ? money(totals.top.each) : '—'}</dd>
              </div>
            </dl>
            {totals.top && (
              <button className="link small" onClick={() => setOpened(totals.top!.e)}>
                Priciest: {cardOf(totals.top.e)?.name} ({printingNote(totals.top.e.variant)})
              </button>
            )}
            {totals.approx > 0 && (
              <p className="faint small">≈ marks {totals.approx === totals.copies ? 'prices' : `${totals.approx} prices`} for the card's usual printing; the exact printing's price fills in as the app fetches it.</p>
            )}
          </section>

          <BudgetPanel plan={plan} setPlan={setPlan} result={budgetPlan} money={money} cardOf={cardOf} currency={currency} onOpen={setOpened} onShare={(p) => share(planText(p), 'Shopping list')} onShow={() => setShow('budget')} />

          <div className="toolbar">
            <div className="search">
              <IconSearch />
              <input type="search" placeholder="Find a card or set" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a card or set" />
            </div>
            <select value={order} onChange={(e) => setOrder(e.target.value as SetOrder)} aria-label="Order sets">
              <option value="new">Newest sets first</option>
              <option value="old">Oldest sets first</option>
              <option value="cost">Most to spend</option>
              <option value="count">Most cards</option>
              <option value="name">A–Z</option>
            </select>
            {(sources.length > 0 || entries.some((e) => e.want)) && (
              <select value={source} onChange={(e) => setSource(e.target.value)} aria-label="Which cards">
                <option value="all">Everything</option>
                {entries.some((e) => e.want) && <option value="picked">Picked by hand</option>}
                {sources.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="toolbar">
            <div className="segmented small" role="group" aria-label="Show">
              <button className={show === 'all' ? 'on' : ''} onClick={() => setShow('all')}>
                All {totals.cards}
              </button>
              <button className={show === 'must' ? 'on' : ''} onClick={() => setShow('must')}>
                ★ Must have
              </button>
              <button className={show === 'deals' ? 'on' : ''} onClick={() => setShow('deals')}>
                Deals {totals.deals || ''}
              </button>
              {budgetPlan && (
                <button className={show === 'budget' ? 'on' : ''} onClick={() => setShow('budget')}>
                  In budget {budgetPlan.picks.length}
                </button>
              )}
            </div>
            <button className="btn small" onClick={() => share(listText(), 'Want list')}>
              Copy list
            </button>
          </div>

          {groups.length === 0 && <p className="muted center">Nothing here matches.</p>}
          {groups.map((g) => {
            const setCards = catalog!.bySet.get(g.set.id) ?? [];
            const have = setCards.filter((c) => ownedByCard.has(c.id)).length;
            const cost = g.entries.reduce((sum, e) => sum + (priceOf(e) ?? 0) * e.need, 0);
            const copies = g.entries.reduce((n, e) => n + e.need, 0);
            const closed = collapsed.has(g.set.id);
            const logo = setLogoUrl(g.set);
            return (
              <section key={g.set.id} className={`want-set${closed ? ' closed' : ''}`}>
                <button
                  className="want-set-head"
                  aria-expanded={!closed}
                  onClick={() =>
                    setCollapsed((s) => {
                      const next = new Set(s);
                      if (next.has(g.set.id)) next.delete(g.set.id);
                      else next.add(g.set.id);
                      return next;
                    })
                  }
                >
                  {logo ? <img className="want-set-logo" src={logo} alt="" onError={(e) => (e.currentTarget.style.display = 'none')} /> : null}
                  <span className="want-set-name">
                    <b>{g.set.name}</b>
                    <span className="faint small">{[g.set.serieName, g.set.date?.slice(0, 4), g.set.code].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="want-set-sum">
                    <b>{money(cost)}</b>
                    <span className="faint small">
                      {copies} to get
                    </span>
                  </span>
                  <span className="chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
                <div className="want-set-progress">
                  <ProgressBar value={have} max={setCards.length} label={`${g.set.name}: cards you have`} />
                  <span className="faint small">
                    You have {have} of {setCards.length}
                  </span>
                </div>
                {!closed && (
                  <div className="want-grid">
                    {g.entries.map((e) => (
                      <WantTile
                        key={e.key}
                        entry={e}
                        card={cardOf(e)}
                        price={priced.get(e.key) ?? null}
                        deal={dealOf(e)}
                        planned={inPlan.get(e.key) ?? 0}
                        money={money}
                        onOpen={() => setOpened(e)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </>
      )}

      {opened && <WantSheet cardId={opened.cardId} variant={opened.variant} entry={opened} onClose={() => setOpened(null)} />}
    </div>
  );
}

interface TileProps {
  entry: WantEntry;
  card: CatalogCard | undefined;
  price: EntryPrice | null;
  deal: boolean;
  /** Copies the budget plan picked */
  planned: number;
  money: (v: number) => string;
  onOpen: () => void;
}

function WantTile({ entry, card, price, deal, planned, money, onOpen }: TileProps) {
  const name = card?.name ?? entry.cardId;
  const each = price?.each ?? null;
  return (
    <button className={`want-tile p${entry.priority}${deal ? ' deal' : ''}${planned ? ' planned' : ''}`} onClick={onOpen} aria-label={`${name}, ${printingNote(entry.variant)}`}>
      <TiltCard>
        <CardImage base={card?.image} name={name} setId={card?.set.id} number={card?.number} />
        {entry.priority !== 2 && <span className={`prio-pill p${entry.priority}`}>{entry.priority === 1 ? '★ Must have' : 'Someday'}</span>}
        {entry.need > 1 && <span className="need-tag">×{entry.need}</span>}
        <span className={`price-tag${price?.exact ? '' : ' approx'}`}>{each === null ? 'No price' : `${price?.exact ? '' : '≈'}${money(each)}`}</span>
        {deal && <span className="deal-tag">Deal</span>}
        {planned > 0 && (
          <span className="plan-ribbon" title={`In budget${planned < entry.need ? `: ${planned} of ${entry.need}` : ''}`}>
            ✓{planned < entry.need ? ` ${planned}` : ''}
          </span>
        )}
      </TiltCard>
      <span className="want-tile-name">{name}</span>
      <span className="want-tile-meta">
        #{card ? cardNumberText(card.number, card.set.official) : '?'} · {printingNote(entry.variant)}
      </span>
      <span className="want-tile-from" aria-label={[entry.want ? 'picked by hand' : '', ...entry.binders.map((b) => b.name)].filter(Boolean).join(', ')}>
        {entry.want && <IconHeart filled width={12} height={12} className="heart" />}
        {entry.binders.map((b) => (
          <span key={b.binderId} className="swatch" style={{ background: BINDER_COLOURS[b.colour].hex } as CSSProperties} title={b.name} />
        ))}
      </span>
    </button>
  );
}

interface BudgetProps {
  plan: PlanSettings;
  setPlan: (patch: Partial<PlanSettings>) => void;
  result: BudgetPlan | null;
  money: (v: number) => string;
  cardOf: (e: WantEntry) => CatalogCard | undefined;
  currency: string;
  onOpen: (e: WantEntry) => void;
  onShare: (p: BudgetPlan) => void;
  onShow: () => void;
}

/** "How far does £50 go?": the best cards it gets, with a buffer kept back for prices moving and postage. */
function BudgetPanel({ plan, setPlan, result, money, cardOf, currency, onOpen, onShare, onShow }: BudgetProps) {
  const [list, setList] = useState(false);
  const [all, setAll] = useState(false);
  const r = result;
  const LONG = 30; // picks shown before "Show all"
  let running = 0;
  return (
    <section className="budget">
      <h2>Budget planner</h2>
      <div className="budget-inputs">
        <label>
          Budget ({currency})
          <input type="number" inputMode="decimal" min={0} step="1" placeholder="e.g. 50" value={plan.budget} onChange={(e) => setPlan({ budget: e.target.value })} />
        </label>
        <label>
          Buffer
          <select value={plan.buffer} onChange={(e) => setPlan({ buffer: Number(e.target.value) })}>
            {BUFFERS.map((b) => (
              <option key={b} value={b}>
                {b ? `${b}%` : 'None'}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="segmented full small" role="group" aria-label="Plan for">
        {(Object.keys(PLAN_MODES) as PlanMode[]).map((m) => (
          <button key={m} className={plan.mode === m ? 'on' : ''} aria-pressed={plan.mode === m} onClick={() => setPlan({ mode: m })}>
            {PLAN_MODES[m]}
          </button>
        ))}
      </div>
      {!r ? (
        <p className="faint small">Put in what you have to spend: it picks the best cards from the list for it, must-haves first, and keeps {plan.buffer}% back for prices moving and postage.</p>
      ) : (
        <div className="budget-result">
          <div className="budget-big">
            <span>
              <b>{r.copies}</b> card{r.copies === 1 ? '' : 's'}
            </span>
            <span className="muted">for {money(r.spent)}</span>
          </div>
          <div className="budget-bar" role="img" aria-label={`${money(r.spent)} of ${money(r.budget)}, ${money(r.buffer)} buffer`}>
            <span className="spent" style={{ width: `${r.budget ? (100 * r.spent) / r.budget : 0}%` }} />
            <span className="buffer" style={{ width: `${r.budget ? (100 * r.buffer) / r.budget : 0}%` }} />
          </div>
          <p className="faint small">
            {money(r.spendable)} to spend · {money(r.buffer)} kept back ({plan.buffer}%) · {money(Math.max(0, r.spendable - r.spent))} left over
          </p>
          <ul className="budget-tiers">
            {([1, 2, 3] as WantPriority[]).map((p) =>
              r.tiers[p].of ? (
                <li key={p}>
                  <span className={`stars p${p}`}>{PRIORITY_STARS[p]}</span>
                  <span>{WANT_PRIORITIES[p]}</span>
                  <span>
                    <b>{r.tiers[p].got}</b> of {r.tiers[p].of}
                  </span>
                  <span className="muted">{money(r.tiers[p].spent)}</span>
                </li>
              ) : null,
            )}
          </ul>
          {r.next && (
            <p className="small budget-next">
              Next up: <button className="link" onClick={() => onOpen(r.next!.entry)}>{cardOf(r.next.entry)?.name ?? r.next.entry.cardId}</button> ({WANT_PRIORITIES[r.next.entry.priority]}, {money(r.next.price)}) —{' '}
              <b>{money(r.next.short)}</b> more
            </p>
          )}
          {r.unpriced > 0 && <p className="faint small">{r.unpriced} card{r.unpriced === 1 ? '' : 's'} without a price yet left out.</p>}
          <div className="actions">
            <button className="btn small" onClick={() => setList((v) => !v)} aria-expanded={list}>
              {list ? 'Hide' : 'Show'} the shopping list
            </button>
            <button className="btn small" onClick={onShow}>
              Show them below
            </button>
            <button className="btn small" onClick={() => onShare(r)}>
              Copy
            </button>
          </div>
          {list && (
            <ol className="budget-picks">
              {(all ? r.picks : r.picks.slice(0, LONG)).map((p) => {
                running += p.price * p.copies;
                const c = cardOf(p.entry);
                return (
                  <li key={p.entry.key}>
                    <button onClick={() => onOpen(p.entry)}>
                      <CardImage base={c?.image} name={c?.name ?? p.entry.cardId} setId={c?.set.id} number={c?.number} />
                      <span className="budget-pick-info">
                        <b>{c?.name ?? p.entry.cardId}</b>
                        <span className="faint small">
                          {c?.set.name} · {printingNote(p.entry.variant)}
                        </span>
                      </span>
                      <span className={`stars p${p.entry.priority}`} title={WANT_PRIORITIES[p.entry.priority]}>
                        {PRIORITY_STARS[p.entry.priority]}
                      </span>
                      <span className="budget-pick-price">
                        {p.copies > 1 ? `${p.copies} × ${money(p.price)}` : money(p.price)}
                        <span className="faint small">{money(running)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {list && !all && r.picks.length > LONG && (
            <button className="btn small full" onClick={() => setAll(true)}>
              Show all {r.picks.length}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
