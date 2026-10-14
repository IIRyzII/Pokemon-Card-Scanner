// Row → API object mappers and small shared queries.

import type { AuditEntry, CollectionItem, HistoryPoint, PriceRow, SaleRow, User } from '../../shared/types.ts';
import { nowIso, type Env, type SessionUser } from './env.ts';

type Row = Record<string, unknown>;

const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function toUser(r: Row): User {
  return {
    id: String(r.id),
    email: String(r.email),
    displayName: String(r.display_name),
    role: r.role as User['role'],
    disabled: !!r.disabled,
    createdAt: String(r.created_at),
    lastLoginAt: s(r.last_login_at),
  };
}

export function toItem(r: Row): CollectionItem {
  return {
    id: String(r.id),
    cardId: String(r.card_id),
    name: String(r.name),
    setId: String(r.set_id),
    setName: String(r.set_name),
    number: String(r.number),
    setTotal: n(r.set_total),
    rarity: s(r.rarity),
    artist: s(r.artist),
    image: s(r.image),
    dexId: n(r.dex_id),
    variant: String(r.variant),
    grader: String(r.grader),
    grade: n(r.grade),
    gradeLabel: s(r.grade_label),
    condition: s(r.condition),
    quantity: Number(r.quantity),
    purchasePrice: n(r.purchase_price),
    purchaseCurrency: s(r.purchase_currency),
    purchaseDate: s(r.purchase_date),
    certNumber: s(r.cert_number),
    notes: s(r.notes),
    value: n(r.value),
    valueCurrency: s(r.value_currency),
    valueSource: s(r.value_source),
    valueDetail: s(r.value_detail),
    valueUpdatedAt: s(r.value_updated_at),
    addedBy: s(r.added_by),
    addedByName: s(r.added_by_name),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    deletedAt: s(r.deleted_at),
  };
}

export function toPrice(r: Row): PriceRow {
  return {
    source: r.source as PriceRow['source'],
    variant: String(r.variant),
    gradeKey: String(r.grade_key),
    market: n(r.market),
    low: n(r.low),
    mid: n(r.mid),
    high: n(r.high),
    currency: String(r.currency),
    label: s(r.label),
    url: s(r.url),
    updatedAt: String(r.updated_at),
  };
}

export function toSale(r: Row): SaleRow {
  return {
    id: String(r.id),
    cardId: String(r.card_id),
    grader: String(r.grader),
    grade: n(r.grade),
    gradeLabel: s(r.grade_label),
    price: Number(r.price),
    currency: s(r.currency) ?? 'USD',
    soldOn: String(r.sold_on),
    source: String(r.source),
    url: s(r.url),
    note: s(r.note),
    createdBy: s(r.created_by),
    createdAt: String(r.created_at),
  };
}

export function toHistory(r: Row): HistoryPoint {
  return {
    day: String(r.day),
    source: String(r.source),
    variant: String(r.variant),
    gradeKey: String(r.grade_key),
    price: Number(r.price),
  };
}

export function toAudit(r: Row): AuditEntry {
  return {
    id: Number(r.id),
    userId: s(r.user_id),
    userEmail: s(r.user_email),
    action: String(r.action),
    entity: String(r.entity),
    entityId: s(r.entity_id),
    details: s(r.details),
    createdAt: String(r.created_at),
  };
}

export const ITEM_SELECT = `SELECT ci.*, u.display_name AS added_by_name
  FROM collection_items ci LEFT JOIN users u ON u.id = ci.added_by`;

export async function getItem(env: Env, id: string): Promise<CollectionItem | null> {
  const row = await env.DB.prepare(`${ITEM_SELECT} WHERE ci.id = ?`).bind(id).first<Row>();
  return row ? toItem(row) : null;
}

/** An audit statement, to run inside the same batch as the change it describes. */
export function auditStmt(
  env: Env,
  user: SessionUser | null,
  action: string,
  entity: string,
  entityId: string | null,
  details?: unknown,
): D1PreparedStatement {
  return env.DB.prepare(
    'INSERT INTO audit_log (user_id, user_email, action, entity, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    user?.id ?? null,
    user?.email ?? null,
    action,
    entity,
    entityId,
    details === undefined ? null : typeof details === 'string' ? details : JSON.stringify(details),
    nowIso(),
  );
}
