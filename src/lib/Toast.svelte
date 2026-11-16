<script lang="ts">
  import { tick, onMount } from 'svelte';
  import { Check } from '@lucide/svelte';
  let { message, layerKey }: { message: string; layerKey: string } = $props();
  let toast = $state<HTMLDivElement>();
  let dialogChange = $state(0);
  onMount(() => {
    const observer = new MutationObserver((records) => {
      if (records.some((record) => record.target instanceof HTMLDialogElement)) dialogChange++;
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    return () => observer.disconnect();
  });
  $effect(() => {
    const currentMessage = message;
    layerKey;
    dialogChange;
    if (!toast) return;
    let cancelled = false;
    // Add the toast after dialogs have entered the browser's top layer.
    tick().then(() => {
      if (cancelled || !toast) return;
      if (toast.matches(':popover-open')) toast.hidePopover();
      if (currentMessage) toast.showPopover();
    });
    return () => {
      cancelled = true;
    };
  });
</script>

<div class="toast" popover="manual" role="status" bind:this={toast}>
  <Check size={18} />{message}
</div>
