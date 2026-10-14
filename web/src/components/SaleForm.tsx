// Log a sold comp (e.g. an eBay "last sold") for this card.

import { useState } from 'react';
import { GRADERS, GRADER_LABELS, GRADES, GRADE_LABELS, type Grader } from '../../../shared/grading.ts';
import { ebaySoldUrl, type CardRef } from '../../../shared/links.ts';
import { api } from '../lib/api.ts';
import { todayIso } from '../lib/format.ts';
import { useFeedback } from './feedback.tsx';
import { IconExternal } from './Icons.tsx';
import { Sheet } from './Sheet.tsx';

interface Props {
  cardId: string;
  card: CardRef;
  initial?: { grader: string; grade: number | null; gradeLabel: string | null };
  onClose: () => void;
  onSaved: () => void;
}

export function SaleForm({ cardId, card, initial, onClose, onSaved }: Props) {
  const [grader, setGrader] = useState(initial?.grader ?? 'RAW');
  const [grade, setGrade] = useState<number>(initial?.grade ?? 10);
  const [label, setLabel] = useState<string | null>(initial?.gradeLabel ?? null);
  const [price, setPrice] = useState('');
  const [soldOn, setSoldOn] = useState(todayIso());
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useFeedback();
  const labels = GRADE_LABELS[grader as Grader] ?? [];
  const graded = grader !== 'RAW';

  async function save() {
    const amount = Number(price);
    if (!price || !Number.isFinite(amount) || amount < 0) {
      setError('Enter the sold price');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.addSale({
        cardId,
        grader,
        grade: graded ? grade : null,
        gradeLabel: graded && grade === 10 ? label : null,
        price: amount,
        soldOn,
        source: 'eBay',
        url: url.trim() || null,
        note: note.trim() || null,
      });
      toast('Sale logged');
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Sheet
      title="Log a sold price"
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save sale'}
          </button>
        </>
      }
    >
      <p className="muted small">
        Look up recent sales, then enter one here. Your logged sales are used to value graded copies.{' '}
        <a href={ebaySoldUrl(card, grader, graded ? grade : null, label)} target="_blank" rel="noreferrer">
          Open eBay sold listings <IconExternal />
        </a>
      </p>
      <div className="form">
        <div className="row2">
          <label>
            Grade
            <select value={grader} onChange={(e) => setGrader(e.target.value)}>
              {GRADERS.map((g) => (
                <option key={g} value={g}>
                  {GRADER_LABELS[g]}
                </option>
              ))}
            </select>
          </label>
          {graded && (
            <label>
              &nbsp;
              <select value={grade} onChange={(e) => setGrade(Number(e.target.value))}>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {graded && grade === 10 && labels.length > 0 && (
          <label>
            Label
            <select value={label ?? ''} onChange={(e) => setLabel(e.target.value || null)}>
              <option value="">Standard 10</option>
              {labels.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
        )}
        <div className="row2">
          <label>
            Sold for (USD)
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0.00"
              autoFocus
            />
          </label>
          <label>
            Sold on
            <input type="date" value={soldOn} max={todayIso()} onChange={(e) => setSoldOn(e.target.value)} />
          </label>
        </div>
        <label>
          Listing link <span className="faint">(optional)</span>
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.ebay.com/itm/…" />
        </label>
        <label>
          Note <span className="faint">(optional)</span>
          <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Best offer accepted, auction…" />
        </label>
      </div>
      {error && <p className="error">{error}</p>}
    </Sheet>
  );
}
