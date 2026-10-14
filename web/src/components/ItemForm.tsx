// Fields describing one copy: printing, raw condition or grade, quantity, purchase info.

import {
  CONDITIONS,
  CONDITION_LABELS,
  GRADERS,
  GRADER_LABELS,
  GRADES,
  GRADE_LABELS,
  VARIANT_LABELS,
  type Grader,
  type Variant,
} from '../../../shared/grading.ts';
import { CURRENCIES } from '../../../shared/currency.ts';
import type { ItemFields } from '../../../shared/types.ts';
import { useCurrency } from '../lib/currency.tsx';

export function defaultFields(variants: string[], currency: string): ItemFields {
  return {
    variant: variants[0] ?? 'normal',
    grader: 'RAW',
    grade: null,
    gradeLabel: null,
    condition: 'NM',
    quantity: 1,
    purchasePrice: null,
    purchaseCurrency: currency,
    purchaseDate: null,
    certNumber: null,
    notes: null,
  };
}

interface Props {
  value: ItemFields;
  onChange: (v: ItemFields) => void;
  variants: string[];
}

export function ItemForm({ value, onChange, variants }: Props) {
  const { currency } = useCurrency();
  const set = (patch: Partial<ItemFields>) => onChange({ ...value, ...patch });
  const graded = value.grader !== 'RAW';
  const labels = GRADE_LABELS[value.grader as Grader] ?? [];
  const printings = variants.includes(value.variant) ? variants : [...variants, value.variant];

  return (
    <div className="form">
      <fieldset>
        <legend>Printing</legend>
        <div className="segmented wrap">
          {printings.map((v) => (
            <button
              type="button"
              key={v}
              className={value.variant === v ? 'on' : ''}
              aria-pressed={value.variant === v}
              onClick={() => set({ variant: v })}
            >
              {VARIANT_LABELS[v as Variant] ?? v}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Raw or graded?</legend>
        <div className="segmented">
          <button
            type="button"
            className={!graded ? 'on' : ''}
            aria-pressed={!graded}
            onClick={() => set({ grader: 'RAW', grade: null, gradeLabel: null, certNumber: null, condition: value.condition ?? 'NM' })}
          >
            Raw
          </button>
          <button
            type="button"
            className={graded ? 'on' : ''}
            aria-pressed={graded}
            onClick={() => !graded && set({ grader: 'PSA', grade: 10, condition: null })}
          >
            Graded slab
          </button>
        </div>
      </fieldset>

      {!graded ? (
        <label>
          Condition
          <select value={value.condition ?? 'NM'} onChange={(e) => set({ condition: e.target.value })}>
            {CONDITIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]} ({c})
              </option>
            ))}
          </select>
        </label>
      ) : (
        <>
          <div className="row2">
            <label>
              Grading company
              <select value={value.grader} onChange={(e) => set({ grader: e.target.value, gradeLabel: null })}>
                {GRADERS.filter((g) => g !== 'RAW').map((g) => (
                  <option key={g} value={g}>
                    {GRADER_LABELS[g]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Grade
              <select
                value={value.grade ?? 10}
                onChange={(e) => set({ grade: Number(e.target.value), gradeLabel: Number(e.target.value) === 10 ? value.gradeLabel : null })}
              >
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {value.grade === 10 && labels.length > 0 && (
            <label>
              Label
              <select value={value.gradeLabel ?? ''} onChange={(e) => set({ gradeLabel: e.target.value || null })}>
                <option value="">Standard 10</option>
                {labels.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Cert number <span className="faint">(optional)</span>
            <input
              inputMode="numeric"
              value={value.certNumber ?? ''}
              maxLength={40}
              onChange={(e) => set({ certNumber: e.target.value || null })}
              placeholder="e.g. 81234567"
            />
          </label>
        </>
      )}

      <div className="row2">
        <label>
          Quantity
          <div className="stepper">
            <button type="button" onClick={() => set({ quantity: Math.max(1, value.quantity - 1) })} aria-label="Fewer">
              −
            </button>
            <input
              inputMode="numeric"
              value={value.quantity}
              onChange={(e) => set({ quantity: Math.min(999, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
              aria-label="Quantity"
            />
            <button type="button" onClick={() => set({ quantity: Math.min(999, value.quantity + 1) })} aria-label="More">
              +
            </button>
          </div>
        </label>
        <label>
          Paid (each) <span className="faint">(optional)</span>
          <div className="money-input">
            <select
              aria-label="Purchase currency"
              value={value.purchaseCurrency ?? currency}
              onChange={(e) => set({ purchaseCurrency: e.target.value })}
            >
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              aria-label="Price paid each"
              value={value.purchasePrice ?? ''}
              onChange={(e) => set({ purchasePrice: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="0.00"
            />
          </div>
        </label>
      </div>
      <label>
        Purchase date <span className="faint">(optional)</span>
        <input type="date" value={value.purchaseDate ?? ''} onChange={(e) => set({ purchaseDate: e.target.value || null })} />
      </label>
      <label>
        Notes <span className="faint">(optional)</span>
        <textarea
          rows={2}
          maxLength={1000}
          value={value.notes ?? ''}
          onChange={(e) => set({ notes: e.target.value || null })}
          placeholder="Shadowless, from a 2004 binder, centering 60/40…"
        />
      </label>
    </div>
  );
}
