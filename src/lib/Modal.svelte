<script lang="ts">
  import { X } from '@lucide/svelte';
  import type { Snippet } from 'svelte';
  let {
    open = $bindable(false),
    title,
    children,
    wide = false,
    width,
    onClose
  }: {
    open?: boolean;
    title: string;
    children: Snippet;
    wide?: boolean;
    width?: string;
    onClose?: () => void;
  } = $props();
  let dialog: HTMLDialogElement;
  function dismiss() {
    open = false;
    onClose?.();
  }
  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  });
</script>

<dialog
  bind:this={dialog}
  class:wide
  style:width
  onclose={() => {
    if (open) dismiss();
  }}
  onclick={(e) => {
    if (e.target === dialog) dismiss();
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss();
    }
  }}
>
  <div class="modal-header">
    <h2>{title}</h2>
    <button class="icon-btn" type="button" aria-label="Close" onclick={dismiss}
      ><X size={20} /></button
    >
  </div>
  {@render children()}
</dialog>
