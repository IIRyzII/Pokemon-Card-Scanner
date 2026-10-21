// Typed client for the PokéVault API.

import type {
  ApiStatus,
  AuditEntry,
  AuthResponse,
  Binder,
  BinderInput,
  CardDetailResponse,
  CollectionItem,
  CollectionResponse,
  ItemFields,
  NewItemInput,
  MergeResponse,
  NewSaleInput,
  PriceRefreshResponse,
  SaleRow,
  User,
} from '../../../shared/types.ts';

const API_URL_KEY = 'pokevault.apiUrl';
const TOKEN_KEY = 'pokevault.token';

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // private mode etc. — the session just won't survive a reload
  }
}

const clean = (url: string) => url.trim().replace(/\/+$/, '');

/** API base URL: a saved override, else the one baked in at build time (VITE_API_URL). */
export function getApiUrl(): string {
  return clean(storageGet(API_URL_KEY) ?? (import.meta.env.VITE_API_URL as string | undefined) ?? '');
}
export function setApiUrl(url: string | null) {
  storageSet(API_URL_KEY, url ? clean(url) : null);
}
export const builtInApiUrl = () => clean((import.meta.env.VITE_API_URL as string | undefined) ?? '');

let memoryToken: string | null = storageGet(TOKEN_KEY);
export const getToken = () => memoryToken;
export function setToken(token: string | null) {
  memoryToken = token;
  storageSet(TOKEN_KEY, token);
}

let unauthorizedHandler: (() => void) | null = null;
export const onUnauthorized = (fn: () => void) => {
  unauthorizedHandler = fn;
};

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const base = getApiUrl();
  if (!base) throw new ApiError(0, 'The app is not connected to a server yet. Add your API address on the sign-in screen.');
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server — check your connection or the API address.");
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) {
    if (res.status === 401 && token) unauthorizedHandler?.();
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

const enc = encodeURIComponent;

export const api = {
  status: () => request<ApiStatus>('GET', '/api/auth/status'),
  register: (email: string, displayName: string, key: string) =>
    request<AuthResponse>('POST', '/api/auth/register', { email, displayName, key }),
  login: (email: string, key: string) => request<AuthResponse>('POST', '/api/auth/login', { email, key }),
  me: () => request<{ user: User }>('GET', '/api/auth/me'),
  rename: (displayName: string) => request<{ user: User }>('PATCH', '/api/auth/me', { displayName }),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  changePassword: (currentKey: string, newKey: string) =>
    request<{ ok: true }>('POST', '/api/auth/password', { currentKey, newKey }),

  collection: (trash = false) => request<CollectionResponse>('GET', `/api/collection${trash ? '?deleted=1' : ''}`),
  item: (id: string) => request<{ item: CollectionItem }>('GET', `/api/collection/${enc(id)}`),
  /** `merged`: counted with a copy already in the collection (that entry's quantity went up). */
  addItem: (input: NewItemInput) => request<{ item: CollectionItem; merged: boolean }>('POST', '/api/collection', input),
  updateItem: (id: string, patch: Partial<ItemFields>) =>
    request<{ item: CollectionItem }>('PATCH', `/api/collection/${enc(id)}`, patch),
  removeItem: (id: string) => request<{ ok: true }>('DELETE', `/api/collection/${enc(id)}`),
  restoreItem: (id: string) => request<{ item: CollectionItem }>('POST', `/api/collection/${enc(id)}/restore`),
  purgeItem: (id: string) => request<{ ok: true }>('DELETE', `/api/collection/${enc(id)}/purge`),
  refreshPrices: () => request<PriceRefreshResponse>('POST', '/api/collection/refresh-prices'),
  mergeDuplicates: () => request<MergeResponse>('POST', '/api/collection/merge-duplicates'),

  card: (cardId: string) => request<CardDetailResponse>('GET', `/api/cards/${enc(cardId)}`),
  refreshCard: (cardId: string, variant?: string) =>
    request<CardDetailResponse>('POST', `/api/cards/${enc(cardId)}/refresh`, variant ? { variant } : {}),
  setPriceCharting: (cardId: string, variant: string, productId: string) =>
    request<CardDetailResponse>('PUT', `/api/cards/${enc(cardId)}/pricecharting`, { variant, productId }),
  clearPriceCharting: (cardId: string, variant: string) =>
    request<CardDetailResponse>('DELETE', `/api/cards/${enc(cardId)}/pricecharting/${enc(variant)}`),

  addSale: (input: NewSaleInput) => request<{ sale: SaleRow }>('POST', '/api/sales', input),
  deleteSale: (id: string) => request<{ ok: true }>('DELETE', `/api/sales/${enc(id)}`),

  binders: () => request<{ binders: Binder[] }>('GET', '/api/binders'),
  binder: (id: string) => request<{ binder: Binder }>('GET', `/api/binders/${enc(id)}`),
  createBinder: (input: BinderInput) => request<{ binder: Binder }>('POST', '/api/binders', input),
  updateBinder: (id: string, patch: Partial<BinderInput>) => request<{ binder: Binder }>('PATCH', `/api/binders/${enc(id)}`, patch),
  deleteBinder: (id: string) => request<{ ok: true }>('DELETE', `/api/binders/${enc(id)}`),

  users: () => request<{ users: User[] }>('GET', '/api/users'),
  createUser: (input: { email: string; displayName: string; role: string; key: string }) =>
    request<{ user: User }>('POST', '/api/users', input),
  updateUser: (id: string, patch: Partial<Pick<User, 'role' | 'disabled' | 'displayName'>>) =>
    request<{ user: User }>('PATCH', `/api/users/${enc(id)}`, patch),
  resetPassword: (id: string, key: string) => request<{ ok: true }>('POST', `/api/users/${enc(id)}/reset-password`, { key }),
  deleteUser: (id: string) => request<{ ok: true }>('DELETE', `/api/users/${enc(id)}`),

  audit: (before?: number) =>
    request<{ entries: AuditEntry[] }>('GET', `/api/admin/audit?limit=100${before ? `&before=${before}` : ''}`),
  exportAll: () => request<Record<string, unknown>>('GET', '/api/admin/export'),
};
