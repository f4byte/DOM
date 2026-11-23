export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Optional R2 bucket for PDF attachments (see wrangler.jsonc). */
  ATTACHMENTS?: R2Bucket;
  APP_NAME?: string;
  SESSION_TTL_DAYS?: string;
  /** Comma-separated extra origins allowed for cookie-authenticated mutations. */
  ALLOWED_ORIGINS?: string;
  /** Secret: when set, required to create the very first account. */
  SETUP_KEY?: string;
}

export type Role = "intern" | "tl" | "admin";

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
  fullName: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: { user: AuthUser; sessionId: string };
};
