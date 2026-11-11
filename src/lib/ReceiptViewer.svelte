<script lang="ts">
  import { ZoomIn, ZoomOut, ArrowUpRight } from '@lucide/svelte';
  import Modal from './Modal.svelte';
  let {
    receipt,
    onClose
  }: { receipt: { src: string; mime: string; name: string } | null; onClose: () => void } =
    $props();
  let zoom = $state(false);
</script>

<Modal
  open={!!receipt}
  title={receipt?.name || 'Receipt'}
  onClose={() => {
    zoom = false;
    onClose();
  }}
  width="1000px"
>
  {#if receipt}
    <div class="viewer-actions">
      {#if receipt.mime.startsWith('image/')}<button
          type="button"
          class="btn secondary"
          onclick={() => (zoom = !zoom)}
          >{#if zoom}<ZoomOut size={16} />Zoom out{:else}<ZoomIn size={16} />Zoom in{/if}</button
        >{/if}
      <a class="btn secondary" href={receipt.src} target="_blank" rel="noreferrer"
        >Open original<ArrowUpRight size={16} /></a
      >
    </div>
    <div class="enlarged-receipt">
      {#if receipt.mime === 'application/pdf'}<iframe title={receipt.name} src={receipt.src}
        ></iframe>
      {:else}<img src={receipt.src} alt={receipt.name} style:width={zoom ? '200%' : '100%'} />{/if}
    </div>
  {/if}
</Modal>

<style>
  .viewer-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-bottom: 16px;
  }
  .enlarged-receipt {
    max-height: 65dvh;
    overflow: auto;
    border-radius: 9px;
    background: #f3f3f3;
  }
  img {
    display: block;
    max-width: none;
    height: auto;
  }
  iframe {
    display: block;
    width: 100%;
    height: 65dvh;
    border: 0;
  }
</style>
