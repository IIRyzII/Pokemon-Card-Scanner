import { useState, type FormEvent } from 'react';
import { CURRENCIES, CURRENCY_INFO, isCurrency } from '../../../shared/currency.ts';
import { MIN_PASSWORD_LENGTH } from '../../../shared/password.ts';
import { ROLE_INFO, hasRole } from '../../../shared/types.ts';
import { useCombineDuplicates } from '../components/CombineDuplicates.tsx';
import { useFeedback } from '../components/feedback.tsx';
import { api, getApiUrl } from '../lib/api.ts';
import { useCurrency } from '../lib/currency.tsx';
import { derivePasswordKey } from '../lib/password.ts';
import { navigate } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import { useCatalog } from '../lib/useCatalog.ts';
import { shortDate } from '../lib/format.ts';

export function AccountPage() {
  const { user, setUser, signOut, server } = useSession();
  const { catalog } = useCatalog();
  const { toast } = useFeedback();
  const { currency, home, chosen, setCurrency, ratesDate, ebayDomain } = useCurrency();
  const [name, setName] = useState(user?.displayName ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [busy, setBusy] = useState(false);
  if (!user) return null;

  async function rename(e: FormEvent) {
    e.preventDefault();
    try {
      setUser((await api.rename(name.trim())).user);
      toast('Name updated');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (next.length < MIN_PASSWORD_LENGTH) return toast(`Use at least ${MIN_PASSWORD_LENGTH} characters`, 'error');
    if (next !== next2) return toast("The new passwords don't match", 'error');
    setBusy(true);
    try {
      await api.changePassword(await derivePasswordKey(user.email, current), await derivePasswordKey(user.email, next));
      setCurrent('');
      setNext('');
      setNext2('');
      toast('Password changed — other devices were signed out');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page narrow">
      <h1>Account</h1>
      <section className="card-section">
        <p>
          Signed in as <b>{user.email}</b>
        </p>
        <p>
          Role: <span className="badge">{ROLE_INFO[user.role].label}</span>{' '}
          <span className="muted small">{ROLE_INFO[user.role].description}</span>
        </p>
        <form className="form inline" onSubmit={rename}>
          <label>
            Display name
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} required />
          </label>
          <button className="btn" type="submit" disabled={name.trim() === user.displayName}>
            Save
          </button>
        </form>
      </section>

      <section className="card-section">
        <h2>Currency</h2>
        <label>
          Show prices in
          <select
            value={chosen ? currency : ''}
            onChange={(e) => setCurrency(isCurrency(e.target.value) ? e.target.value : null)}
            aria-label="Currency"
          >
            <option value="">Collection default — {CURRENCY_INFO[home].label}</option>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {CURRENCY_INFO[c].label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          TCGplayer and PriceCharting (US dollars) and Cardmarket (euros) prices are converted using the European Central
          Bank&apos;s daily rates{ratesDate ? ` (${shortDate(ratesDate)})` : ''}. eBay links open {ebayDomain}.
        </p>
      </section>

      {hasRole(user.role, 'editor') && <DuplicateEntries />}

      <section className="card-section">
        <h2>Change password</h2>
        <form className="form" onSubmit={changePassword}>
          <label>
            Current password
            <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </label>
          <label>
            New password
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
          </label>
          <label>
            Confirm new password
            <input type="password" autoComplete="new-password" value={next2} onChange={(e) => setNext2(e.target.value)} required />
          </label>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </section>

      <section className="card-section">
        <h2>Use it like an app</h2>
        <p className="muted small">
          <b>iPhone:</b> open this page in Safari → Share → <i>Add to Home Screen</i>.<br />
          <b>Android:</b> open it in Chrome → ⋮ menu → <i>Install app</i> (or <i>Add to Home screen</i>).
        </p>
      </section>

      <section className="card-section">
        <h2>About the data</h2>
        <ul className="muted small">
          <li>
            Card names, sets, numbers, artists and images: the open{' '}
            <a href="https://tcgdex.dev" target="_blank" rel="noreferrer">
              TCGdex
            </a>{' '}
            database, rebuilt into PokéVault's own catalog every week
            {catalog && ` (current copy: ${shortDate(catalog.builtAt)}, ${catalog.cards.length.toLocaleString()} cards)`}.
          </li>
          <li>
            Raw market prices: TCGplayer (USD) and Cardmarket (EUR), refreshed by the PokéVault API when you open the app
            (and daily in the background), which keeps its own price history, and converted to your currency. TCGplayer only
            sells English cards, so English copies are valued from it; French, German, Italian, Spanish and Portuguese copies
            from Cardmarket, whose price covers a card in any language (it doesn&apos;t give one per language).
          </li>
          <li>
            Graded prices: eBay sold prices logged in the app, plus PriceCharting
            {server?.providers.pricecharting ? ' (connected)' : ' (if a token is configured)'}.
          </li>
          <li>Card scanning runs entirely on this device — photos are never uploaded.</li>
          <li>Pokémon and all related names are trademarks of Nintendo, Creatures and GAME FREAK. PokéVault is a fan project.</li>
        </ul>
        <p className="faint small">Server: {getApiUrl()}</p>
      </section>

      <button
        className="btn danger-outline block"
        onClick={async () => {
          await signOut();
          navigate('/', true);
        }}
      >
        Sign out
      </button>
    </div>
  );
}

/** Combining copies of the same card that are still separate entries. */
function DuplicateEntries() {
  const { entries, into, combine, merging } = useCombineDuplicates();
  return (
    <section className="card-section">
      <h2>Duplicate entries</h2>
      <p className="muted small">
        Copies of the same card with the same details (printing, condition or grade, price paid, notes) share one entry. Ones added before
        that, or edited to match, can be combined here. The number of cards stays the same.
      </p>
      {into > 0 ? (
        <button className="btn primary" onClick={combine} disabled={merging}>
          {merging ? 'Combining…' : `Combine ${entries} entries into ${into}`}
        </button>
      ) : (
        <p className="small">No duplicate entries: nothing to combine.</p>
      )}
    </section>
  );
}
