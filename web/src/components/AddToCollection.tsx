// Two-step add: fill in the copy's details, then confirm before anything is saved.

import { useState } from 'react';
import { gradeText } from '../../../shared/grading.ts';
import { cardNumberText } from '../../../shared/links.ts';
import type { CardDetailResponse, CardInfo, ItemFields } from '../../../shared/types.ts';
import { valueItem } from '../../../shared/values.ts';
import { api } from '../lib/api.ts';
import { useCollection } from '../lib/collection.tsx';
import { useCurrency } from '../lib/currency.tsx';
import { money, shortDate } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import { CardImage } from './CardImage.tsx';
import { conditionLabel, variantLabel } from './CardTile.tsx';
import { useFeedback } from './feedback.tsx';
import { ItemForm, defaultFields } from './ItemForm.tsx';
import { Sheet } from './Sheet.tsx';

interface Props {
  card: CardInfo;
  detail: CardDetailResponse | null;
  onClose: () => void;
}

export function AddToCollection({ card, detail, onClose }: Props) {
  const { ctx, currency } = useCurrency();
  const [step, setStep] = useState<'details' | 'confirm'>('details');
  const [fields, setFields] = useState<ItemFields>(() => defaultFields(card.variants, currency));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useFeedback();
  const { reload } = useCollection();

  const estimate = detail ? valueItem(fields, detail.prices, detail.sales, ctx) : null;
  const number = cardNumberText(card.number, card.setTotal);
  const alreadyOwned = detail?.owned.reduce((n, i) => n + i.quantity, 0) ?? 0;

  async function confirmAdd() {
    setBusy(true);
    setError(null);
    try {
      const { item } = await api.addItem({ cardId: card.id, ...fields });
      await reload();
      toast(`Added ${item.name} to the collection`);
      onClose();
      navigate(`/item/${encodeURIComponent(item.id)}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (step === 'details') {
    return (
      <Sheet
        title="Add to collection"
        onClose={onClose}
        footer={
          <>
            <button className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn primary" onClick={() => setStep('confirm')}>
              Review →
            </button>
          </>
        }
      >
        <div className="mini-card">
          <CardImage base={card.image} name={card.name} setId={card.setId} number={card.number} />
          <div>
            <strong>{card.name}</strong>
            <div className="muted">
              {card.setName} · #{number}
            </div>
            {alreadyOwned > 0 && <div className="note">You already have {alreadyOwned} of this card.</div>}
          </div>
        </div>
        <ItemForm value={fields} onChange={setFields} variants={card.variants} />
      </Sheet>
    );
  }

  const rows: [string, string][] = [
    ['Card', `${card.name}`],
    ['Set', `${card.setName} · #${number}`],
    ['Printing', variantLabel(fields.variant)],
    ['Grade', fields.grader === 'RAW' ? `Raw · ${conditionLabel(fields.condition)}` : gradeText(fields.grader, fields.grade, fields.gradeLabel)],
    ['Quantity', String(fields.quantity)],
  ];
  if (fields.certNumber) rows.push(['Cert #', fields.certNumber]);
  if (fields.purchasePrice !== null) {
    rows.push(['Paid', `${money(fields.purchasePrice, fields.purchaseCurrency ?? currency)} each`]);
  }
  if (fields.purchaseDate) rows.push(['Bought', shortDate(fields.purchaseDate)]);
  if (fields.notes) rows.push(['Notes', fields.notes]);

  return (
    <Sheet
      title="Confirm"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={() => setStep('details')} disabled={busy}>
            ← Back
          </button>
          <button className="btn primary" onClick={confirmAdd} disabled={busy} autoFocus>
            {busy ? 'Adding…' : '✓ Confirm & add'}
          </button>
        </>
      }
    >
      <p className="confirm-q">Add this card to the collection?</p>
      <div className="confirm-card">
        <CardImage base={card.image} name={card.name} quality="high" eager setId={card.setId} number={card.number} />
        <dl className="facts">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
          <div>
            <dt>Est. value</dt>
            <dd>
              <strong>{estimate?.unit != null ? money(estimate.unit * fields.quantity, estimate.currency) : '—'}</strong>
              {estimate && <div className="faint small">{estimate.detail}</div>}
            </dd>
          </div>
        </dl>
      </div>
      {error && <p className="error">{error}</p>}
    </Sheet>
  );
}
