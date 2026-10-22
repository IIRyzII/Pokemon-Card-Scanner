import type { Role } from '../../shared/types.ts';

export interface Env {
  DB: D1Database;
  /** Comma-separated web origins allowed to call the API */
  ALLOWED_ORIGINS: string;
  /** "open" (default) or "closed" */
  REGISTRATION?: string;
  /** Home currency for values and totals: GBP, USD, EUR, CAD or AUD */
  CURRENCY?: string;
  /** Optional paid PriceCharting API token (secret) — enables graded price points */
  PRICECHARTING_TOKEN?: string;
  /** Override for tests */
  TCGDEX_API?: string;
  /** The published card catalog (GitHub Pages), for Cardmarket's prices per set */
  CATALOG_URL?: string;
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser; tokenHash: string };
};

export class HttpError extends Error {
  status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 502;
  constructor(status: HttpError['status'], message: string) {
    super(message);
    this.status = status;
  }
}

export const nowIso = () => new Date().toISOString();
export const todayIso = () => new Date().toISOString().slice(0, 10);
