export interface ConnectedPeer {
  sid: string;
  user_id: string | null;
  display_name: string;
}

export interface DashboardUser {
  row_key: string;
  sid: string | null;
  db_user_id: number | null;
  user_id: string | null;
  display_name: string;
  role: string;
  presence: 'in_call' | 'waiting' | 'offline';
  is_anonymous: boolean;
  gender: string | null;
  birth_year: number | null;
  country: string | null;
  language: string | null;
  connected_to: ConnectedPeer | null;
  exempt_from_ban?: boolean;
  exempt_from_ai_censorship?: boolean;
  is_premium?: boolean;
  premium_source?: string | null;
  match_room_id?: string | null;
  match_zone?: string | null;
}
