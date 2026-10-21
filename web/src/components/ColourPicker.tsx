import { BINDER_COLOURS, BINDER_COLOUR_KEYS, type BinderColour } from '../../../shared/binders.ts';

/** A row of binder colours to pick from. */
export function ColourPicker({ value, onChange }: { value: BinderColour; onChange: (colour: BinderColour) => void }) {
  return (
    <div className="colour-picker" role="radiogroup" aria-label="Colour">
      {BINDER_COLOUR_KEYS.map((c) => (
        <button
          type="button"
          key={c}
          role="radio"
          aria-checked={value === c}
          aria-label={BINDER_COLOURS[c].label}
          title={BINDER_COLOURS[c].label}
          className={`colour-dot${value === c ? ' on' : ''}`}
          style={{ background: BINDER_COLOURS[c].hex }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}
