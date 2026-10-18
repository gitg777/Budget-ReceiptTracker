export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;
  EXTRACT_MODEL: string;
  /** Optional. When set, new owner accounts need this code (stops strangers using your API credit). */
  SIGNUP_CODE?: string;
}

export interface SessionUser {
  id: number;
  account_id: number;
  account_name: string;
  role: 'owner' | 'helper';
  display_name: string;
  email: string | null;
  username: string | null;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };
