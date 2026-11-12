export type Member = { id: string; trip_id: string; name: string; username: string; color: number };
export type Tag = { id: string; trip_id: string; name: string; members: string[] };
export type Choice = {
  member_id: string;
  mode: 'share' | 'exclude' | 'full' | 'extra';
  extra: number;
  input_extra?: number | null;
  input_currency?: 'EUR' | 'CZK';
};
export type Expense = {
  id: string;
  trip_id: string;
  title: string;
  amount: number;
  input_amount?: number | null;
  input_currency?: 'EUR' | 'CZK';
  input_nightly?: number;
  payer_id: string;
  kind: 'rent' | 'product' | 'other';
  tag_id: string | null;
  receipt_id: string | null;
  note: string;
  date: string;
  choices: Choice[];
  tag_ids?: string[];
  member_ids?: string[];
  share_explicit?: number;
};
export type Payment = {
  id: string;
  from_id: string;
  to_id: string;
  amount: number;
  date: string;
  note: string;
};
export type Balance = {
  id: string;
  spent: number;
  share: number;
  sent: number;
  received: number;
  net: number;
};
export type Transfer = { from: string; to: string; amount: number };
export type ReceiptItem = { title: string; amount: number };
