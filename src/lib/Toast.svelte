<script lang="ts">
  import { tick } from 'svelte';
  import { Check } from '@lucide/svelte';
  let { message, layerKey }: { message: string; layerKey: string } = $props();
  let toast = $state<HTMLDivElement>();
  $effect(() => {
    const currentMessage = message;
    layerKey;
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
