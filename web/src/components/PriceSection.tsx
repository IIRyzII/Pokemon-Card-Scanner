// Every price we know for a card: raw market prices, graded price points,
// logged eBay sales, history, and links out to the marketplaces.

import { useState } from 'react';
import { PRICE_GRADE_LABELS, gradeText, priceGradeKey } from '../../../shared/grading.ts';
import {
  artOfPkmArtistUrl,
  cardmarketSearchUrl,
  ebaySoldUrl,
  priceChartingSearchUrl,
  serebiiCardexUrl,
  tcgplayerUrl,
  type CardRef,
} from '../../../shared/links.ts';
import type { CardDetailResponse } from '../../../shared/types.ts';
import { matchingSales, summarizeSales, type ItemLike } from '../../../shared/values.ts';
import { api } from '../lib/api.ts';
import { money, relativeTime, shortDate } from '../lib/format.ts';
import { variantLabel } from './CardTile.tsx';
import { useFeedback } from './feedback.tsx';
import { IconExternal, IconRefresh, IconTrash } from './Icons.tsx';
import { PriceChart, type ChartPoint } from './PriceChart.tsx';
import { SaleForm } from './SaleForm.tsx';

interface Props {
  detail: CardDetailResponse;
  /** The owned copy being viewed, if any — its grade gets highlighted and charted. */
  focus?: ItemLike | null;
  /** Display name of the artist (catalog spelling). */
  artist?: string | null;
  canEdit: boolean;
  onDetail: (d: CardDetailResponse) => void;
  onSalesChanged: () => void;
}

const COMMON_GRADES: { grader: string; grade: number; gradeLabel: string | null }[] = [
  { grader: 'PSA', grade: 10, gradeLabel: null },
  { grader: 'PSA', grade: 9, gradeLabel: null },
  { grader: 'PSA', grade: 8, gradeLabel: null },
  { grader: 'BGS', grade: 10, gradeLabel: null },
  { grader: 'BGS', grade: 9.5, gradeLabel: null },
  { grader: 'CGC', grade: 10, gradeLabel: null },
  { grader: 'SGC', grade: 10, gradeLabel: null },
  { grader: 'TAG', grade: 10, gradeLabel: null },
];

export function PriceSection({ detail, focus, artist, canEdit, onDetail, onSalesChanged }: Props) {
  const { card, prices, sales } = detail;
  const { toast, confirm } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [saleFor, setSaleFor] = useState<{ grader: string; grade: number | null; gradeLabel: string | null } | null>(null);
  const ref: CardRef = { name: card.name, number: card.number, setName: card.setName, setTotal: card.setTotal };
  const variant = focus?.variant ?? card.variants.find((v) => v !== 'reverse') ?? card.variants[0] ?? 'normal';

  const tcg = prices.filter((p) => p.source === 'tcgplayer');
  const cm = prices
    .filter((p) => p.source === 'cardmarket')
    .sort((a, b) => Number(b.variant === 'main') - Number(a.variant === 'main'));
  const pc = prices.filter((p) => p.source === 'pricecharting' && p.variant === variant);
  const pcPrice = (key: string | null) => (key ? (pc.find((p) => p.gradeKey === key)?.market ?? null) : null);
  const tcgProductId = (() => {
    const url = tcg.find((p) => p.url)?.url;
    const id = url?.match(/product\/(\d+)/)?.[1];
    return id ? Number(id) : null;
  })();

  // Graded rows: common grades + the one we own + any grade with logged sales.
  const gradeRows = [...COMMON_GRADES];
  const addRow = (g: { grader: string; grade: number | null; gradeLabel: string | null }) => {
    if (g.grader === 'RAW' || g.grade === null) return;
    if (!gradeRows.some((r) => r.grader === g.grader && r.grade === g.grade && r.gradeLabel === g.gradeLabel)) {
      gradeRows.push({ grader: g.grader, grade: g.grade, gradeLabel: g.gradeLabel });
    }
  };
  if (focus) addRow(focus);
  for (const s of sales) addRow(s);
  const isFocus = (g: { grader: string; grade: number | null; gradeLabel: string | null }) =>
    !!focus && focus.grader === g.grader && (g.grader === 'RAW' || (focus.grade === g.grade && focus.gradeLabel === g.gradeLabel));

  // History: the series matching what we're valuing.
  const focusKey = focus ? priceGradeKey(focus.grader, focus.grade, focus.gradeLabel) : 'ungraded';
  const graded = !!focus && focus.grader !== 'RAW';
  const series: ChartPoint[] = detail.history
    .filter((h) =>
      graded
        ? h.source === 'pricecharting' && h.variant === variant && h.gradeKey === focusKey
        : h.source === 'tcgplayer' && h.variant === variant,
    )
    .map((h) => ({ day: h.day, price: h.price }));
  const salePoints: ChartPoint[] = (focus ? matchingSales(sales, focus.grader, focus.grade, focus.gradeLabel) : []).map((s) => ({
    day: s.soldOn,
    price: s.price,
  }));
  const chartLabel = graded
    ? `${gradeText(focus!.grader, focus!.grade, focus!.gradeLabel)} · ${variantLabel(variant)}`
    : `Raw · ${variantLabel(variant)} (TCGplayer market)`;

  async function refresh() {
    setBusy(true);
    try {
      onDetail(await api.refreshCard(card.id, variant));
      toast('Prices refreshed');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function fixPriceCharting() {
    const input = window.prompt(
      'Paste the PriceCharting product ID (the number in the product page’s "id" / from the API) for this printing:',
    );
    if (!input) return;
    try {
      onDetail(await api.setPriceCharting(card.id, variant, input.trim()));
      toast('PriceCharting match updated');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function removeSale(id: string) {
    if (!(await confirm({ title: 'Delete this sale?', body: 'It will no longer count towards values.', confirmText: 'Delete', danger: true }))) return;
    try {
      await api.deleteSale(id);
      onSalesChanged();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  const pcMatch = detail.priceCharting.find((m) => m.variant === variant);

  return (
    <section className="prices">
      <div className="section-head">
        <h2>Prices</h2>
        <span className="faint small">updated {relativeTime(detail.refreshedAt)}</span>
        {canEdit && (
          <button className="icon-btn" onClick={refresh} disabled={busy} aria-label="Refresh prices" title="Refresh prices">
            <IconRefresh className={busy ? 'spin' : ''} />
          </button>
        )}
      </div>
      {detail.refreshMessage && <p className="note small">{detail.refreshMessage}</p>}

      <h3>Market (raw)</h3>
      {tcg.length || cm.length ? (
        <div className="table-wrap">
          <table className="price-table">
            <thead>
              <tr>
                <th>Printing</th>
                <th>Market</th>
                <th>Low</th>
                <th>High</th>
              </tr>
            </thead>
            <tbody>
              {tcg.map((p) => (
                <tr key={`t${p.variant}${p.label}`} className={!graded && focus && p.variant === focus.variant ? 'hl' : ''}>
                  <td>
                    {variantLabel(p.variant)} <span className="faint small">TCGplayer</span>
                  </td>
                  <td>
                    <strong>{money(p.market)}</strong>
                  </td>
                  <td>{money(p.low)}</td>
                  <td>{money(p.high)}</td>
                </tr>
              ))}
              {cm.map((p) => (
                <tr key={`c${p.variant}`}>
                  <td>
                    {p.variant === 'holo' ? 'Holo / reverse' : 'Main'} <span className="faint small">Cardmarket</span>
                  </td>
                  <td>
                    <strong>{money(p.market, 'EUR')}</strong>
                    <div className="faint small">trend</div>
                  </td>
                  <td>{money(p.low, 'EUR')}</td>
                  <td>
                    {money(p.mid, 'EUR')}
                    <div className="faint small">30-day avg</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="faint small">No market prices reported for this card yet.</p>
      )}

      <h3>Graded</h3>
      {!detail.providers.pricecharting && (
        <p className="faint small">
          Values for slabs come from sales you log below (use the eBay links to find recent solds). Adding a PriceCharting
          API token on the server fills this table in automatically.
        </p>
      )}
      <div className="table-wrap">
        <table className="price-table">
          <thead>
            <tr>
              <th>Grade</th>
              {detail.providers.pricecharting && <th>PriceCharting</th>}
              <th>Logged sales</th>
              <th>eBay</th>
            </tr>
          </thead>
          <tbody>
            <tr className={isFocus({ grader: 'RAW', grade: null, gradeLabel: null }) ? 'hl' : ''}>
              <td>Raw</td>
              {detail.providers.pricecharting && <td>{money(pcPrice('ungraded'))}</td>}
              <SalesCell sales={sales} grader="RAW" grade={null} gradeLabel={null} />
              <td>
                <a href={ebaySoldUrl(ref)} target="_blank" rel="noreferrer">
                  Sold <IconExternal />
                </a>
              </td>
            </tr>
            {gradeRows.map((g) => {
              const key = priceGradeKey(g.grader, g.grade, g.gradeLabel);
              return (
                <tr key={`${g.grader}${g.grade}${g.gradeLabel}`} className={isFocus(g) ? 'hl' : ''}>
                  <td>{gradeText(g.grader, g.grade, g.gradeLabel)}</td>
                  {detail.providers.pricecharting && (
                    <td title={key ? PRICE_GRADE_LABELS[key] : ''}>
                      {money(pcPrice(key))}
                      {key?.startsWith('g') && pcPrice(key) !== null && <div className="faint small">any grader</div>}
                    </td>
                  )}
                  <SalesCell sales={sales} grader={g.grader} grade={g.grade} gradeLabel={g.gradeLabel} />
                  <td>
                    <a href={ebaySoldUrl(ref, g.grader, g.grade, g.gradeLabel)} target="_blank" rel="noreferrer">
                      Sold <IconExternal />
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {detail.providers.pricecharting && (
        <p className="faint small">
          PriceCharting ({variantLabel(variant)}):{' '}
          {pcMatch ? `${pcMatch.productName} — ${pcMatch.consoleName}` : 'not matched yet'}
          {canEdit && (
            <>
              {' · '}
              <button className="link" onClick={fixPriceCharting}>
                {pcMatch ? 'Fix match' : 'Set match'}
              </button>
            </>
          )}
        </p>
      )}

      <div className="section-head">
        <h3>Logged sales</h3>
        {canEdit && (
          <button
            className="btn small"
            onClick={() => setSaleFor(focus ?? { grader: 'RAW', grade: null, gradeLabel: null })}
          >
            + Log a sale
          </button>
        )}
      </div>
      {sales.length ? (
        <ul className="sales">
          {sales.slice(0, 30).map((s) => (
            <li key={s.id}>
              <span className="sale-grade">{gradeText(s.grader, s.grade, s.gradeLabel)}</span>
              <strong>{money(s.price)}</strong>
              <span className="faint small">
                {shortDate(s.soldOn)} · {s.url ? (
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.source} <IconExternal />
                  </a>
                ) : (
                  s.source
                )}
                {s.note ? ` · ${s.note}` : ''}
              </span>
              {canEdit && (
                <button className="icon-btn small" onClick={() => removeSale(s.id)} aria-label="Delete sale">
                  <IconTrash width={16} height={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="faint small">No sales logged yet.</p>
      )}

      <h3>History</h3>
      <PriceChart series={series} sales={salePoints} label={chartLabel} />

      <h3>Look it up</h3>
      <div className="link-row">
        <a className="chip" href={ebaySoldUrl(ref, focus?.grader ?? 'RAW', focus?.grade, focus?.gradeLabel)} target="_blank" rel="noreferrer">
          eBay sold <IconExternal />
        </a>
        <a className="chip" href={priceChartingSearchUrl(ref)} target="_blank" rel="noreferrer">
          PriceCharting <IconExternal />
        </a>
        <a className="chip" href={tcgplayerUrl(ref, tcgProductId)} target="_blank" rel="noreferrer">
          TCGplayer <IconExternal />
        </a>
        <a className="chip" href={cardmarketSearchUrl(ref)} target="_blank" rel="noreferrer">
          Cardmarket <IconExternal />
        </a>
        {card.dexId && (
          <a className="chip" href={serebiiCardexUrl(card.dexId)} target="_blank" rel="noreferrer">
            Serebii <IconExternal />
          </a>
        )}
        {artist && (
          <a className="chip" href={artOfPkmArtistUrl(artist)} target="_blank" rel="noreferrer">
            Art of Pokémon <IconExternal />
          </a>
        )}
      </div>

      {saleFor && (
        <SaleForm cardId={card.id} card={ref} initial={saleFor} onClose={() => setSaleFor(null)} onSaved={onSalesChanged} />
      )}
    </section>
  );
}

function SalesCell(props: { sales: CardDetailResponse['sales']; grader: string; grade: number | null; gradeLabel: string | null }) {
  const list = matchingSales(props.sales, props.grader, props.grade, props.gradeLabel);
  const s = summarizeSales(list);
  if (!s.count) return <td className="faint">—</td>;
  return (
    <td>
      <strong>{money(s.last?.price)}</strong>
      <div className="faint small">
        {shortDate(s.last?.soldOn)}
        {s.count > 1 && ` · median ${money(s.median)} (${s.count})`}
      </div>
    </td>
  );
}
