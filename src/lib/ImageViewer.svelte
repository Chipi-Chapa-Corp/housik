<script lang="ts">
  import { ChevronLeft, ChevronRight, Trash2 } from '@lucide/svelte';
  import { tick } from 'svelte';
  import type { ViewerItem } from './types';
  let {
    items,
    index,
    onNavigate,
    onClose,
    onRemove,
    removing = false,
    error = '',
    zoomable = false
  }: {
    items: ViewerItem[];
    index: number | null;
    onNavigate: (index: number) => void;
    onClose: () => void;
    onRemove?: () => void | Promise<void>;
    removing?: boolean;
    error?: string;
    zoomable?: boolean;
  } = $props();
  let dialog: HTMLDialogElement;
  let video = $state<HTMLVideoElement>();
  $effect(() => {
    const active = video;
    return () => active?.pause();
  });
  let zoomed = $state(false);
  let zoomSource = '';
  let viewportWidth = $state(1024),
    viewportHeight = $state(768);
  let loaded = $state<{ src: string; width: number; height: number } | null>(null);
  const current = $derived(index === null ? null : (items[index] ?? null));
  const ratio = $derived(
    current?.width && current.height
      ? current.width / current.height
      : loaded && loaded.src === current?.src && loaded.height > 0
        ? loaded.width / loaded.height
        : 0.75
  );
  const availableHeight = $derived(
    Math.max(1, viewportHeight - (onRemove ? 76 : 16) - (error ? 44 : 0))
  );
  const imageWidth = $derived(Math.min(Math.max(1, viewportWidth - 16), availableHeight * ratio));
  const imageHeight = $derived(imageWidth / ratio);
  const zoomScale = $derived(
    zoomed ? Math.min(8, Math.max(2, (viewportWidth - 16) / imageWidth)) : 1
  );
  const arrowOffset = $derived(Math.max(-20, 8 - (viewportWidth - imageWidth) / 2));
  let touch: { id: number; x: number; y: number; time: number } | null = null;
  const pointers = new Set<number>();
  let swipeClick: { x: number; y: number; until: number } | null = null;
  function move(direction: number) {
    if (index !== null && items.length > 1 && !removing) {
      zoomed = false;
      onNavigate((index + direction + items.length) % items.length);
    }
  }
  async function zoom(event: MouseEvent) {
    if (!zoomable) return;
    const image = event.currentTarget as HTMLImageElement;
    const before = image.getBoundingClientRect();
    const x = (event.clientX - before.x) / before.width;
    const y = (event.clientY - before.y) / before.height;
    zoomed = !zoomed;
    await tick();
    if (!image.isConnected) return;
    if (!zoomed) dialog.scrollTo(0, 0);
    else {
      const after = image.getBoundingClientRect();
      dialog.scrollLeft += after.x + after.width * x - event.clientX;
      dialog.scrollTop += after.y + after.height * y - event.clientY;
    }
  }
  function dismiss() {
    onClose();
  }
  function pointerDown(event: PointerEvent) {
    if (event.pointerType !== 'touch') return;
    pointers.add(event.pointerId);
    if (
      zoomed ||
      pointers.size !== 1 ||
      !(event.target as Element).closest('.media-image, .media-video')
    ) {
      touch = null;
      return;
    }
    if (
      event.target instanceof HTMLVideoElement &&
      event.clientY > event.target.getBoundingClientRect().bottom - 60
    ) {
      touch = null;
      return;
    }
    touch = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp };
  }
  function pointerUp(event: PointerEvent) {
    pointers.delete(event.pointerId);
    const start = touch;
    touch = null;
    if (!start || event.pointerId !== start.id || pointers.size) return;
    const dx = event.clientX - start.x,
      dy = event.clientY - start.y;
    if (
      Math.abs(dx) >= 48 &&
      Math.abs(dx) > Math.abs(dy) * 1.3 &&
      event.timeStamp - start.time < 1200
    ) {
      swipeClick = { x: event.clientX, y: event.clientY, until: performance.now() + 500 };
      move(dx < 0 ? 1 : -1);
    }
  }
  $effect(() => {
    if (current?.src !== zoomSource) {
      zoomSource = current?.src ?? '';
      zoomed = false;
    }
    if (!dialog) return;
    if (current && !dialog.open) {
      dialog.showModal();
      dialog.focus({ preventScroll: true });
    } else if (!current && dialog.open) {
      touch = null;
      pointers.clear();
      dialog.close();
    }
  });
</script>

<svelte:window bind:innerWidth={viewportWidth} bind:innerHeight={viewportHeight} />
<dialog
  bind:this={dialog}
  class="image-viewer"
  class:zoomed
  class:zoomable
  aria-label={current?.name || 'Image'}
  tabindex="-1"
  oncancel={(event) => {
    event.preventDefault();
    dismiss();
  }}
  onclick={(event) => {
    if (
      swipeClick &&
      performance.now() < swipeClick.until &&
      Math.hypot(event.clientX - swipeClick.x, event.clientY - swipeClick.y) < 12
    )
      return;
    if (!(event.target as Element).closest('.media-image, .media-video, .media-pdf, button'))
      dismiss();
  }}
  onkeydown={(event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismiss();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if ((event.target as Element).closest('.media-video')) return;
      event.preventDefault();
      event.stopPropagation();
      move(event.key === 'ArrowRight' ? 1 : -1);
    }
  }}
  onpointerdown={pointerDown}
  onpointerup={pointerUp}
  onpointercancel={(event) => {
    pointers.delete(event.pointerId);
    touch = null;
  }}
>
  {#if current}
    <div
      class="media-shell"
      style:width={`${imageWidth * zoomScale}px`}
      style:height={`${imageHeight * zoomScale + (onRemove ? 60 : 0) + (error ? 44 : 0)}px`}
    >
      <div class="media-content" style:height={`${imageHeight * zoomScale}px`}>
        {#key current.src}
          {#if current.mime === 'application/pdf'}
            <iframe class="media-pdf" src={current.src} title={current.name}></iframe>
          {:else if current.mime.startsWith('video/')}
            <!-- svelte-ignore a11y_media_has_caption (User videos may not include caption tracks.) -->
            <video
              bind:this={video}
              class="media-video"
              src={current.src}
              poster={current.poster}
              controls
              playsinline
              preload="metadata"
              aria-label={current.name}
              onloadedmetadata={(event) => {
                loaded = {
                  src: event.currentTarget.getAttribute('src') || '',
                  width: event.currentTarget.videoWidth,
                  height: event.currentTarget.videoHeight
                };
              }}
            ></video>
          {:else}
            <img
              class="media-image"
              src={current.src}
              alt={current.name}
              draggable="false"
              ondblclick={zoom}
              onload={(event) => {
                const image = event.currentTarget as HTMLImageElement;
                loaded = {
                  src: image.getAttribute('src') || '',
                  width: image.naturalWidth,
                  height: image.naturalHeight
                };
              }}
            />
          {/if}
        {/key}
        {#if items.length > 1}
          <button
            type="button"
            class="media-arrow previous"
            style:left={zoomed ? '8px' : `${arrowOffset}px`}
            aria-label="Previous image"
            disabled={removing}
            onclick={() => move(-1)}><ChevronLeft size={24} /></button
          >
          <button
            type="button"
            class="media-arrow next"
            style:right={zoomed ? '8px' : `${arrowOffset}px`}
            aria-label="Next image"
            disabled={removing}
            onclick={() => move(1)}><ChevronRight size={24} /></button
          >
        {/if}
      </div>
      {#if onRemove}<div class="media-actions" style:top={`${imageHeight + 10}px`}>
          <button type="button" class="media-remove" disabled={removing} onclick={onRemove}
            ><Trash2 size={16} />{removing ? 'Removing…' : 'Remove'}</button
          >
          {#if error}<p role="alert">{error}</p>{/if}
        </div>{/if}
    </div>
  {/if}
</dialog>

<style>
  dialog.image-viewer {
    position: fixed;
    inset: 0;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    width: 100vw;
    max-width: none;
    height: 100dvh;
    max-height: none;
    background: transparent;
    box-shadow: none;
    overflow: hidden;
    outline: none;
    touch-action: pan-y pinch-zoom;
  }
  dialog.image-viewer[open] {
    display: grid;
    place-items: center;
  }
  dialog.image-viewer.zoomed[open] {
    display: block;
    overflow: auto;
    touch-action: pan-x pan-y pinch-zoom;
  }
  .zoomed .media-shell {
    max-width: none;
    margin: 8px auto;
  }
  .zoomable .media-image {
    cursor: zoom-in;
  }
  .zoomed .media-image {
    cursor: zoom-out;
  }
  .zoomed .media-arrow {
    position: fixed;
  }
  dialog.image-viewer::backdrop {
    background: #1c2029cc;
    backdrop-filter: blur(3px);
  }
  .media-shell {
    position: relative;
    max-width: 100%;
  }
  .media-content {
    position: relative;
    width: 100%;
  }
  .media-image,
  .media-video,
  .media-pdf {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }
  .media-image,
  .media-video {
    object-fit: contain;
    user-select: none;
  }
  .media-arrow,
  .media-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #d9dde3;
    background: #f7f8faed;
    color: #303740;
    box-shadow: 0 3px 14px #12161c33;
  }
  .media-arrow {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 40px;
    height: 40px;
    padding: 0;
    border-radius: 50%;
  }
  .media-actions {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    text-align: center;
    width: max-content;
    max-width: calc(100vw - 24px);
  }
  .media-remove {
    gap: 8px;
    padding: 8px 16px;
    min-height: 40px;
    border-radius: 999px;
  }
  .media-actions p {
    margin: 8px 0 0;
    color: #fff;
  }
</style>
