<script lang="ts">
  import ImageViewer from './ImageViewer.svelte';
  import type { ViewerItem } from './types';
  let {
    receipt = $bindable(null),
    receipts = [],
    onClose
  }: {
    receipt: ViewerItem | null;
    receipts?: ViewerItem[];
    onClose: () => void;
  } = $props();
  const items = $derived(
    receipt ? (receipts.some((item) => item.src === receipt?.src) ? receipts : [receipt]) : []
  );
  const index = $derived(receipt ? items.findIndex((item) => item.src === receipt?.src) : null);
</script>

<ImageViewer {items} {index} onNavigate={(index) => (receipt = items[index])} {onClose} zoomable />
