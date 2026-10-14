import { useCallback, useEffect, useState } from 'react';
import { cardNumberText } from '../../../shared/links.ts';
import { hasRole, type CollectionItem } from '../../../shared/types.ts';
import { CardImage } from '../components/CardImage.tsx';
import { gradeBadge } from '../components/CardTile.tsx';
import { useFeedback } from '../components/feedback.tsx';
import { IconBack } from '../components/Icons.tsx';
import { api } from '../lib/api.ts';
import { useCollection } from '../lib/collection.tsx';
import { relativeTime } from '../lib/format.ts';
import { goBack } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';

export function TrashPage() {
  const [items, setItems] = useState<CollectionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { user } = useSession();
  const { reload } = useCollection();
  const { toast, confirm } = useFeedback();
  const isAdmin = hasRole(user?.role, 'admin');

  const load = useCallback(async () => {
    try {
      setItems((await api.collection(true)).items);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function restore(item: CollectionItem) {
    try {
      await api.restoreItem(item.id);
      toast(`Restored ${item.name}`);
      void load();
      void reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function purge(item: CollectionItem) {
    const ok = await confirm({
      title: 'Delete forever?',
      body: `${item.name} will be permanently deleted. This can't be undone.`,
      confirmText: 'Delete forever',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.purgeItem(item.id);
      void load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  return (
    <div className="page">
      <button className="back" onClick={() => goBack('/')}>
        <IconBack /> Back
      </button>
      <h1>Recently removed</h1>
      {error && <p className="error">{error}</p>}
      {!items && !error && <div className="spinner" />}
      {items?.length === 0 && <p className="muted">Nothing here.</p>}
      <ul className="trash">
        {items?.map((item) => (
          <li key={item.id}>
            <CardImage base={item.image} name={item.name} setId={item.setId} number={item.number} />
            <div>
              <strong>{item.name}</strong>
              <div className="faint small">
                {item.setName} · #{cardNumberText(item.number, item.setTotal)} · {gradeBadge(item)} ×{item.quantity}
              </div>
              <div className="faint small">removed {relativeTime(item.deletedAt)}</div>
              <div className="actions">
                <button className="btn small primary" onClick={() => restore(item)}>
                  Restore
                </button>
                {isAdmin && (
                  <button className="btn small danger-outline" onClick={() => purge(item)}>
                    Delete forever
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
