<script lang="ts">
  import { ReceiptText } from '@lucide/svelte';
  let {
    src,
    mime,
    name,
    label,
    onEnlarge,
    joined = false
  }: {
    src: string;
    mime: string;
    name: string;
    label?: string;
    onEnlarge: () => void;
    joined?: boolean;
  } = $props();
  let broken = $state(false);
</script>

<button
  type="button"
  class="receipt-preview"
  class:joined
  aria-label={label ?? `Enlarge receipt ${name}`}
  onclick={onEnlarge}
>
  {#if mime.startsWith('image/') && !broken}<img {src} alt={name} onerror={() => (broken = true)} />
  {:else}<ReceiptText size={32} /><span>{mime === 'application/pdf' ? 'PDF' : name}</span>{/if}
</button>

<style>
  .receipt-preview {
    display: flex;
    width: 100%;
    height: 160px;
    padding: 10px;
    gap: 8px;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    background: #f3f3f3;
    border-radius: 9px;
    overflow: hidden;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .receipt-preview.joined {
    border-bottom-left-radius: 0;
    border-bottom-right-radius: 0;
  }
  span {
    overflow-wrap: anywhere;
  }
</style>
