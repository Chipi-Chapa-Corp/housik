<script lang="ts">
  import { ReceiptText } from '@lucide/svelte';
  let { total, count }: { total: string; count: number } = $props();
</script>

<div class="receipt-card-summary">
  <span class="receipt-summary-icon" aria-label="Receipt"><ReceiptText size={24} /></span>
  <strong class="receipt-summary-total">{total}</strong>
  <span class="receipt-summary-count">{count} items</span>
</div>
