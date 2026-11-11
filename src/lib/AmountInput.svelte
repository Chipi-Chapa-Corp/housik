<script lang="ts">
  import CurrencyToggle from './CurrencyToggle.svelte';
  import { inputCurrency, toCzk } from './currency';
  import { cents } from './money';
  let {
    value = $bindable(''),
    currency = $bindable('CZK'),
    name = 'amount',
    currencyName = 'currency',
    label = 'Amount',
    rate = null,
    compact = false
  }: {
    value?: string;
    currency?: string;
    name?: string | null;
    currencyName?: string | null;
    label?: string;
    rate?: number | null;
    compact?: boolean;
  } = $props();
  const preview = $derived.by(() => {
    if (currency !== 'EUR' || !value) return '';
    if (!rate) return 'Exchange rate unavailable';
    try {
      return `≈ ${new Intl.NumberFormat('cs-CZ', {
        style: 'currency',
        currency: 'CZK',
        minimumFractionDigits: 2
      }).format(toCzk(cents(value), inputCurrency(currency), rate) / 100)}`;
    } catch {
      return '';
    }
  });
</script>

<div class="amount-field" class:compact>
  <div class="amount-row">
    <label>
      {#if !compact}{label} · {currency}{/if}
      <input
        name={name ?? undefined}
        aria-label={compact ? label : undefined}
        type="text"
        inputmode="decimal"
        pattern={'[0-9]+([.,][0-9]{1,2})?'}
        bind:value
        required
      />
    </label>
    <CurrencyToggle bind:currency />
  </div>
  {#if currencyName}<input type="hidden" name={currencyName} value={currency} />{/if}
  {#if preview}<span class="amount-preview">{preview}</span>{/if}
</div>
