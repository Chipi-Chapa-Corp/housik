import type { Expense } from './types';

export const maxReceipts = 10;
export const receiptScanConcurrency = 5;
export const maxReceiptBytes = 10 * 1024 * 1024;
export type ReceiptProduct = { title: string; amount: number; currency: string };
export type ReceiptReviewItem = {
  title: string;
  amount: string;
  currency?: string;
  date?: string;
  members?: string[];
};
export type ReceiptReview = {
  draft: string;
  merchant: string;
  date: string;
  members: string[];
  kind?: Expense['kind'];
  items: ReceiptReviewItem[];
};
