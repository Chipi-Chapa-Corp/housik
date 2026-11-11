<script lang="ts">
  let { currency = $bindable('CZK') }: { currency?: string } = $props();
</script>

<div class="currency-toggle" role="group" aria-label="Currency">
  {#each ['EUR', 'CZK'] as option}
    <button
      type="button"
      aria-label={option}
      aria-pressed={currency === option}
      onclick={() => (currency = option)}
    >
      {option === 'CZK' ? 'Kč' : '€'}
    </button>
  {/each}
</div>
