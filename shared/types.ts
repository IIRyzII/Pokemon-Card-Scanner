// Shapes exchanged between the web app and the PokéVault API.

import type { FxRates } from './currency.ts';
import type { PriceRow, SaleRow } from './values.ts';

export const ROLES = ['pending', 'viewer', 'editor', 'admin'] as const;
export type Role = (typeof ROLES)[number];

const ROLE_RANK: Record<Role, number> = { pending: 0, viewer: 1, editor: 2, admin: 3 };
export const hasRole = (role: Role | undefined | null, min: Role): boolean => !!role && ROLE_RANK[role] >= ROLE_RANK[min];
export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

export const ROLE_INFO: Record<Role, { label: string; description: string }> = {
  pending: { label: 'Pending', description: 'Signed up, waiting for an admin to approve. No access to the collection.' },
  viewer: { label: 'Viewer', description: 'Can browse the collection and prices.' },
  editor: { label: 'Editor', description: 'Can add, edit and remove cards and log sales.' },
  admin: { label: 'Admin', description: 'Everything, plus managing users, roles, the trash and exports.' },
};

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface ApiStatus {
  ok: true;
  version: string;
  hasUsers: boolean;
  registration: 'open' | 'closed';
  providers: { tcgdex: true; pricecharting: boolean };
  /** The collection's home currency (values and totals are kept in it) */
  currency: string;
  /** Latest ECB exchange rates, used to show prices in other currencies */
  fx: FxRates | null;
}

export interface AuthResponse {
  token: string;
  user: User;
}

/** Card details as served by our API (normalized from the TCGdex open data). */
export interface CardInfo {
  id: string;
  name: string;
  number: string;
  setId: string;
  setName: string;
  setTotal: number | null;
  setCode: string | null;
  serieName: string | null;
  releaseDate: string | null;
  rarity: string | null;
  artist: string | null;
  /** Base image URL; append /low.webp or /high.webp */
  image: string | null;
  dexId: number | null;
  category: string | null;
  hp: number | null;
  types: string[];
  variants: string[];
  regulationMark: string | null;
}

export interface ItemFields {
  variant: string;
  grader: string;
  grade: number | null;
  gradeLabel: string | null;
  condition: string | null;
  quantity: number;
  purchasePrice: number | null;
  /** Currency the purchase price was entered in */
  purchaseCurrency: string | null;
  purchaseDate: string | null;
  certNumber: string | null;
  notes: string | null;
}

export interface NewItemInput extends ItemFields {
  cardId: string;
}

export interface CollectionItem extends ItemFields {
  id: string;
  cardId: string;
  name: string;
  setId: string;
  setName: string;
  number: string;
  setTotal: number | null;
  rarity: string | null;
  artist: string | null;
  image: string | null;
  dexId: number | null;
  value: number | null;
  /** Currency of `value` (the home currency when it was last valued) */
  valueCurrency: string | null;
  valueSource: string | null;
  valueDetail: string | null;
  valueUpdatedAt: string | null;
  addedBy: string | null;
  addedByName: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface CollectionResponse {
  items: CollectionItem[];
  summary: {
    items: number;
    cards: number;
    graded: number;
    totalValue: number;
    currency: string;
    unpriced: number;
  };
}

export interface HistoryPoint {
  day: string;
  source: string;
  variant: string;
  gradeKey: string;
  price: number;
}

export interface CardDetailResponse {
  card: CardInfo;
  prices: PriceRow[];
  sales: SaleRow[];
  history: HistoryPoint[];
  refreshedAt: string | null;
  refreshMessage: string | null;
  providers: { pricecharting: boolean };
  priceCharting: { variant: string; productId: string; productName: string; consoleName: string }[];
  owned: CollectionItem[];
}

export interface NewSaleInput {
  cardId: string;
  grader: string;
  grade: number | null;
  gradeLabel: string | null;
  price: number;
  currency: string;
  soldOn: string;
  source: string;
  url: string | null;
  note: string | null;
}

export interface AuditEntry {
  id: number;
  userId: string | null;
  userEmail: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  details: string | null;
  createdAt: string;
}

export type { FxRates, PriceRow, SaleRow };
