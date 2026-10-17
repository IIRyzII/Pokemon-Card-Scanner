/** A thin bar showing how much of something is done, e.g. how complete a set is. */
export function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max ? Math.min(100, (100 * value) / max) : 0;
  return (
    <div
      className={`progress${value >= max && max > 0 ? ' done' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
