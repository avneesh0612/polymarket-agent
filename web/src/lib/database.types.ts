/**
 * Supabase database types — generated from the SQL schema.
 * Run `bun run db:types` to regenerate after schema changes.
 */

export interface Database {
  public: {
    Tables: {
      delegations: {
        Row: {
          id: string;
          user_id: string;
          wallet_id: string;
          address: string;
          chain: string;
          wallet_api_key: string;
          key_share: unknown; // EcdsaKeygenResult (stored as JSON)
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          wallet_id: string;
          address: string;
          chain: string;
          wallet_api_key: string;
          key_share: unknown;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          wallet_id?: string;
          address?: string;
          chain?: string;
          wallet_api_key?: string;
          key_share?: unknown;
          updated_at?: string;
        };
      };
    };
  };
}
