export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  ASSETS: Fetcher;
  ANTHROPIC_API_KEY: string;
  EXTRACT_MODEL: string;
  /** Optional. When set, new owner accounts need this code (stops strangers using your API credit). */
  SIGNUP_CODE?: string;
  /** Price multiplier on Anthropic's cost (default 20). */
  MARKUP?: string;
  /** Free reading credit for new accounts, in USD (default 5). */
  FREE_CREDIT_USD?: string;
  /** Shown to people who run out of credit, e.g. a WhatsApp number. */
  SUPPORT_CONTACT?: string;
  /** Optional link for the contact, e.g. https://wa.me/263… */
  SUPPORT_LINK?: string;
}

export interface SessionUser {
  id: number;
  account_id: number;
  account_name: string;
  role: 'owner' | 'helper';
  display_name: string;
  email: string | null;
  username: string | null;
  is_admin: number;
}

export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };
