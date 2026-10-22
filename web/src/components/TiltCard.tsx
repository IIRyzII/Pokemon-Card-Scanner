import { useRef, type PointerEvent, type ReactNode } from 'react';

/** A card that leans towards the pointer with a holo shine across it (still for reduced motion). */
export function TiltCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const move = (e: PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    el.style.setProperty('--rx', `${((0.5 - y) * 16).toFixed(2)}deg`);
    el.style.setProperty('--ry', `${((x - 0.5) * 16).toFixed(2)}deg`);
    el.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    el.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    el.classList.add('tilting');
  };
  const leave = () => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove('tilting');
    for (const v of ['--rx', '--ry', '--mx', '--my']) el.style.removeProperty(v);
  };
  return (
    <span ref={ref} className={`tilt ${className}`} onPointerMove={move} onPointerLeave={leave} onPointerUp={leave} onPointerCancel={leave}>
      {children}
    </span>
  );
}
