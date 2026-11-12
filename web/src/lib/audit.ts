// The audit log in words: what each recorded change was, for the admin page.

import type { AuditEntry } from '../../../shared/types.ts';
import { money } from './format.ts';

type Details = Record<string, unknown>;

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
const num = (v: unknown) => (typeof v === 'number' ? v : null);
const amount = (d: Details, price = 'price', currency = 'currency') => money(num(d[price]), str(d[currency]) ?? 'USD');
const times = (d: Details) => ((num(d.quantity) ?? 1) > 1 ? `${d.quantity} × ` : '');

function onCard(e: AuditEntry, d: Details): string | null {
  const card = str(d.card) ?? 'a card';
  switch (e.action) {
    case 'add':
      return `added ${card}`;
    case 'edit':
      return `edited ${card} (${Object.keys(d).filter((k) => k !== 'card').join(', ') || 'no changes'})`;
    case 'remove':
      return `removed ${card}`;
    case 'restore':
      return `restored ${card}`;
    case 'purge':
      return `permanently deleted ${card}`;
    case 'merge':
      return `combined ${d.entries} entries of ${card} into one (×${d.quantity})`;
    case 'list':
      return `put ${d.forSale} of ${card} up for sale${num(d.askingPrice) !== null ? ` at ${amount(d, 'askingPrice', 'askingCurrency')}` : ''}`;
    case 'edit-listing':
      return `changed the listing of ${card}`;
    case 'unlist':
      return `took ${card} off sale`;
    case 'sell':
      return `sold ${times(d)}${card} for ${amount(d)}${str(d.platform) ? ` on ${d.platform}` : ''}`;
    case 'unsell':
      return `undid the sale of ${times(d)}${card}${d.restored === false ? " (its entry was gone, so the copies didn't go back)" : ''}`;
    default:
      return null;
  }
}

function describeEntry(e: AuditEntry, d: Details): string | null {
  switch (e.entity) {
    case 'item':
      return onCard(e, d);
    case 'sealed': {
      const name = str(d.name) ?? 'a sealed product';
      if (e.action === 'add') return `added ${times(d)}${name} (sealed)`;
      if (e.action === 'edit') return `edited ${name} (sealed)`;
      if (e.action === 'delete') return `removed ${name} (sealed)`;
      return null;
    }
    case 'want': {
      const card = str(d.cardId) ?? 'a card';
      if (e.action === 'add') return `put ${card} on the want list`;
      if (e.action === 'edit') return `changed ${card} on the want list`;
      if (e.action === 'delete') return `took ${card} off the want list`;
      return null;
    }
    case 'binder': {
      const name = str(d.name) ?? 'a binder';
      if (e.action === 'add') return `made the binder ${name}`;
      if (e.action === 'edit') return `changed the binder ${name}`;
      if (e.action === 'delete') return `deleted the binder ${name}`;
      if (e.action === 'reorder') return 'rearranged the binders';
      return null;
    }
    case 'card': {
      if (e.action === 'log-sale') return `logged a ${d.grader === 'RAW' ? 'raw' : `${d.grader} ${d.grade}`} sale of ${amount(d)} for ${e.entityId}`;
      if (e.action === 'delete-sale') return `deleted a sale for ${e.entityId}`;
      if (e.action === 'pricecharting-match') return `matched ${e.entityId} to a PriceCharting product`;
      if (e.action === 'pricecharting-unmatch') return `unmatched ${e.entityId} from PriceCharting`;
      return null;
    }
    case 'user':
      switch (e.action) {
        case 'register':
          return `signed up (${d.role})`;
        case 'update':
          return `updated ${d.email ?? 'a user'}: ${Object.entries(d)
            .filter(([k]) => k !== 'email')
            .map(([k, v]) => `${k} ${v}`)
            .join(', ')}`;
        case 'reset-password':
          return `reset the password of ${d.email}`;
        case 'create-user':
          return `created an account for ${d.email} (${d.role})`;
        case 'delete':
          return `deleted the account of ${d.email}`;
        case 'rename':
          return `changed their name to ${d.displayName}`;
        case 'change-password':
          return 'changed their password';
        default:
          return null;
      }
    default:
      return null;
  }
}

/** One audit entry in words ("sold 2 × Blastoise · Base Set #2 for £55.00 on eBay"). */
export function describeAudit(e: AuditEntry): string {
  let d: Details = {};
  try {
    d = e.details ? (JSON.parse(e.details) as Details) : {};
  } catch {
    // plain text details
  }
  return describeEntry(e, d) ?? `${e.action} ${e.entity} ${e.entityId ?? ''}`.trim();
}
