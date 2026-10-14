import { useCallback, useEffect, useState } from 'react';
import { cardNumberText } from '../../../shared/links.ts';
import { hasRole, type CardDetailResponse, type CollectionItem, type ItemFields } from '../../../shared/types.ts';
import { CardImage } from '../components/CardImage.tsx';
import { conditionLabel, gradeBadge, variantLabel } from '../components/CardTile.tsx';
import { useFeedback } from '../components/feedback.tsx';
import { IconBack, IconEdit, IconExternal, IconTrash } from '../components/Icons.tsx';
import { ItemForm } from '../components/ItemForm.tsx';
import { PriceSection } from '../components/PriceSection.tsx';
import { Sheet } from '../components/Sheet.tsx';
import { api } from '../lib/api.ts';
import { canonicalArtist } from '../lib/catalog.ts';
import { useCollection } from '../lib/collection.tsx';
import { useCurrency } from '../lib/currency.tsx';
import { relativeTime, shortDate } from '../lib/format.ts';
import { goBack, href, navigate } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import { useCatalog } from '../lib/useCatalog.ts';

export function ItemPage({ id }: { id: string }) {
  const [item, setItem] = useState<CollectionItem | null>(null);
  const [detail, setDetail] = useState<CardDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<ItemFields | null>(null);
  const [saving, setSaving] = useState(false);
  const { user } = useSession();
  const { catalog } = useCatalog();
  const { reload } = useCollection();
  const { toast, confirm } = useFeedback();
  const { convert, format, currency } = useCurrency();
  const canEdit = hasRole(user?.role, 'editor');

  const load = useCallback(async () => {
    try {
      const { item } = await api.item(id);
      setItem(item);
      setDetail(await api.card(item.cardId));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!item) return <div className="spinner" aria-label="Loading" />;

  const artist = canonicalArtist(catalog, item.artist);
  // Everything shown in the viewer's currency.
  const each = convert(item.value, item.valueCurrency ?? 'USD');
  const total = each !== null ? each * item.quantity : null;
  const paidEach = convert(item.purchasePrice, item.purchaseCurrency ?? 'USD');
  const paid = paidEach !== null ? paidEach * item.quantity : null;
  const gain = total !== null && paid !== null ? total - paid : null;

  async function save() {
    if (!editing || !item) return;
    setSaving(true);
    try {
      const { item: updated } = await api.updateItem(item.id, editing);
      setItem(updated);
      setEditing(null);
      toast('Saved');
      void reload();
      setDetail(await api.card(updated.cardId));
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!item) return;
    const ok = await confirm({
      title: 'Remove this card?',
      body: `${item.name} (${gradeBadge(item)}, ×${item.quantity}) will move to "Recently removed", where an editor can restore it.`,
      confirmText: 'Remove',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.removeItem(item.id);
      await reload();
      toast(`Removed ${item.name}`);
      navigate('/');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  return (
    <div className="page detail">
      <button className="back" onClick={() => goBack('/')}>
        <IconBack /> Back
      </button>
      <div className="hero">
        <CardImage
          base={item.image}
          name={item.name}
          quality="high"
          eager
          className="hero-img"
          setId={item.setId}
          number={item.number}
        />
        <div className="hero-info">
          <h1>{item.name}</h1>
          <p className="muted">
            <a href={href('card', item.cardId)}>{item.setName}</a> · #{cardNumberText(item.number, item.setTotal)}
            {item.rarity && ` · ${item.rarity}`}
          </p>
          {artist && (
            <p className="muted">
              🖌 <a href={href('artist', artist)}>{artist}</a>
            </p>
          )}
          <div className="chips">
            <span className={`badge ${item.grader !== 'RAW' ? 'grade' : ''}`}>{gradeBadge(item)}</span>
            <span className="badge">{variantLabel(item.variant)}</span>
            {item.quantity > 1 && <span className="badge">×{item.quantity}</span>}
          </div>

          <div className="value-box">
            <div className="muted small">
              {item.quantity > 1 ? `Value (${item.quantity} × ${format(each, currency)})` : 'Value'}
            </div>
            <div className="big-value">{format(total, currency)}</div>
            <div className="faint small">
              {item.valueDetail} {item.valueUpdatedAt && `· ${relativeTime(item.valueUpdatedAt)}`}
            </div>
            {gain !== null && (
              <div className={gain >= 0 ? 'up' : 'down'}>
                {gain >= 0 ? '▲' : '▼'} {format(Math.abs(gain), currency)} vs. {format(paid, currency)} paid
              </div>
            )}
          </div>

          <dl className="facts">
            {item.grader === 'RAW' && item.condition && (
              <div>
                <dt>Condition</dt>
                <dd>{conditionLabel(item.condition)}</dd>
              </div>
            )}
            {item.certNumber && (
              <div>
                <dt>Cert #</dt>
                <dd>
                  {item.grader === 'PSA' ? (
                    <a href={`https://www.psacard.com/cert/${encodeURIComponent(item.certNumber)}`} target="_blank" rel="noreferrer">
                      {item.certNumber} <IconExternal />
                    </a>
                  ) : (
                    item.certNumber
                  )}
                </dd>
              </div>
            )}
            {item.purchaseDate && (
              <div>
                <dt>Bought</dt>
                <dd>{shortDate(item.purchaseDate)}</dd>
              </div>
            )}
            {item.notes && (
              <div>
                <dt>Notes</dt>
                <dd>{item.notes}</dd>
              </div>
            )}
            <div>
              <dt>Added</dt>
              <dd>
                {shortDate(item.createdAt)}
                {item.addedByName && ` by ${item.addedByName}`}
              </dd>
            </div>
          </dl>

          {canEdit && (
            <div className="actions">
              <button
                className="btn"
                onClick={() =>
                  setEditing({
                    variant: item.variant,
                    grader: item.grader,
                    grade: item.grade,
                    gradeLabel: item.gradeLabel,
                    condition: item.condition,
                    quantity: item.quantity,
                    purchasePrice: item.purchasePrice,
                    purchaseCurrency: item.purchaseCurrency ?? (item.purchasePrice !== null ? 'USD' : currency),
                    purchaseDate: item.purchaseDate,
                    certNumber: item.certNumber,
                    notes: item.notes,
                  })
                }
              >
                <IconEdit width={18} height={18} /> Edit
              </button>
              <button className="btn danger-outline" onClick={remove}>
                <IconTrash width={18} height={18} /> Remove
              </button>
            </div>
          )}
        </div>
      </div>

      {detail ? (
        <PriceSection
          detail={detail}
          focus={item}
          artist={artist}
          canEdit={canEdit}
          onDetail={setDetail}
          onSalesChanged={() => {
            void load();
            void reload();
          }}
        />
      ) : (
        <div className="spinner" aria-label="Loading prices" />
      )}

      {editing && (
        <Sheet
          title={`Edit ${item.name}`}
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn ghost" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={save} disabled={saving}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </>
          }
        >
          <ItemForm value={editing} onChange={setEditing} variants={detail?.card.variants ?? [item.variant]} />
        </Sheet>
      )}
    </div>
  );
}
