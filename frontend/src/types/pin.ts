export interface Pin {
  id: string;
  session_id: string;
  sdk_message_id: string;
  created_at: string;
  updated_at: string;
  title?: string | null;
  excerpt?: string | null;
  note?: string | null;
  tags?: string[] | null;
}

export interface CreatePinRequest {
  sdk_message_id: string;
  title?: string;
  excerpt?: string;
  note?: string;
  tags?: string[];
}

export interface UpdatePinRequest {
  title?: string;
  excerpt?: string;
  note?: string;
  tags?: string[];
}
