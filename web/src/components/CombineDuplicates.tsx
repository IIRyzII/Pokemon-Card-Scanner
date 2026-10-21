// Combining duplicate entries: copies of the same card with the same details that are still
// separate (added before copies were counted together, or edited to match). Offered by the
// collection page's banner and on the Account page.

import { useMemo, useState } from 'react';
import { planMerges } from '../../../shared/copies.ts';
import { api } from '../lib/api.ts';
import { useCollection } from '../lib/collection.tsx';
import { useFeedback } from './feedback.tsx';

export function useCombineDuplicates() {
  const { data, reload } = useCollection();
  const { toast, confirm } = useFeedback();
  const [merging, setMerging] = useState(false);
  const plans = useMemo(() => planMerges(data?.items ?? []), [data]);
  /** Entries that would be combined… */
  const entries = plans.reduce((n, m) => n + m.absorb.length + 1, 0);
  /** …into this many */
  const into = plans.length;

  async function combine() {
    const ok = await confirm({
      title: 'Combine duplicate entries?',
      body: `${entries} entries are copies of the same card with the same details. Each card's copies go into one entry, so they become ${into}. The number of cards and their details stay the same.`,
      confirmText: `Combine into ${into}`,
    });
    if (!ok) return;
    setMerging(true);
    try {
      const { groups, removed } = await api.mergeDuplicates();
      await reload();
      toast(`Combined ${groups + removed} entries into ${groups}`);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setMerging(false);
    }
  }

  return { entries, into, combine, merging };
}
