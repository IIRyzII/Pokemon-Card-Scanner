// Two-step add: fill in the copy's details, then confirm before anything is saved.

import { useState } from 'react';
import { entryFor } from '../../../shared/copies.ts';
import { gradeText } from '../../../shared/grading.ts';
import { languageLabel } from '../../../shared/languages.ts';
import { preferPrintings } from '../../../shared/printings.ts';
import { cardNumberText } from '../../../shared/links.ts';
import type { CardDetailResponse, CardInfo, ItemFields } from '../../../shared/types.ts';
import { valueItem } from '../../../shared/values.ts';
import { api } from '../lib/api.ts';
import { allPrintingsOf } from '../lib/binders.ts';
import { useCollection } from '../lib/collection.tsx';
import { useCurrency } from '../lib/currency.tsx';
import { useCatalog } from '../lib/useCatalog.ts';
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
  /** The printing to start with (else the card's most likely one) */
  variant?: string;
  /** Called once added, instead of opening the new copy (the want list stays where it is) */
  onAdded?: () => void;
}

export function AddToCollection({ card, detail, onClose, variant, onAdded }: Props) {
  const { ctx, currency } = useCurrency();
  const { catalog } = useCatalog();
  // The catalog knows (or has worked out) printings TCGdex doesn't: its best guess comes first.
  const known = catalog?.byId.get(card.id);
  const printings = preferPrintings(card.variants, known?.variants ? allPrintingsOf(known) : null);
  const [step, setStep] = useState<'details' | 'confirm'>('details');
  const [fields, setFields] = useState<ItemFields>(() => {
    const start = defaultFields(printings, currency);
    return variant && printings.includes(variant) ? { ...start, variant } : start;
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useFeedback();
  const { reload } = useCollection();

  const estimate = detail ? valueItem(fields, detail.prices, detail.sales, ctx) : null;
  const number = cardNumberText(card.number, card.setTotal);
  const alreadyOwned = detail?.owned.reduce((n, i) => n + i.quantity, 0) ?? 0;
  // The copy this one will be counted with, as the API picks it (the oldest the same).
  const countedWith = detail ? entryFor([...detail.owned].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), fields) : undefined;

  async function confirmAdd() {
    setBusy(true);
    setError(null);
    try {
      const { item, merged } = await api.addItem({ cardId: card.id, ...fields });
      await reload();
      toast(merged ? `Counted with your other ${item.name}: now ×${item.quantity}` : `Added ${item.name} to the collection`);
      onClose();
      if (onAdded) onAdded();
      else navigate(`/item/${encodeURIComponent(item.id)}`);
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
        <ItemForm value={fields} onChange={setFields} variants={printings} />
      </Sheet>
    );
  }

  const rows: [string, string][] = [
    ['Card', `${card.name}`],
    ['Set', `${card.setName} · #${number}`],
    ['Printing', variantLabel(fields.variant)],
    ['Language', languageLabel(fields.language)],
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
      {countedWith && (
        <p className="note">
          You already have {countedWith.quantity} like this, so it's counted with {countedWith.quantity === 1 ? 'it' : 'them'}: one
          entry, ×{countedWith.quantity + fields.quantity}.
        </p>
      )}
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
