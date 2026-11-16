<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { Play } from '@lucide/svelte';
  import ImageViewer from '#lib/ImageViewer.svelte';
  import { refreshAll } from '$app/navigation';
  import type { PlacePhoto } from '#lib/types.ts';
  import { photoRows } from '#lib/photo-layout.ts';
  let {
    photos,
    tripId,
    onViewerChange,
    onRemoved
  }: {
    photos: PlacePhoto[];
    tripId: string;
    onViewerChange: (open: boolean) => void;
    onRemoved: () => void;
  } = $props();
  let width = $state(0);
  let gallery: HTMLElement;
  let selected = $state<string | null>(null);
  let removing = $state(false),
    removeError = $state('');
  const rows = $derived(photoRows(photos, width || 1000));
  const index = $derived(photos.findIndex((photo) => photo.id === selected));
  const current = $derived(index >= 0 ? photos[index] : null);
  $effect(() => onViewerChange(!!current));
  const source = (photo: PlacePhoto, thumbnail = false) =>
    `/trip/${tripId}/photos/${photo.id}${thumbnail ? '?size=thumbnail' : ''}`;
  const viewerItems = $derived(
    photos.map((photo, position) => ({
      src: source(photo),
      mime: photo.mime || 'image/webp',
      poster: source(photo, true),
      name: `Place ${photo.mime?.startsWith('video/') ? 'video' : 'photo'} ${position + 1}`,
      width: photo.width,
      height: photo.height
    }))
  );
  async function remove() {
    if (!current || removing) return;
    const photo = current;
    const notifyRemoved = onRemoved;
    const next = photos[index + 1] ?? photos[index - 1];
    removing = true;
    removeError = '';
    try {
      const response = await fetch(source(photo), { method: 'DELETE' });
      const result = await response.json().catch(() => ({}));
      if (response.status !== 404 && (!response.ok || result.success !== true))
        throw new Error(result.error || 'Could not remove the photo.');
      if (selected === photo.id) {
        if (next) selected = next.id;
        else close();
      }
      await refreshAll();
      notifyRemoved();
    } catch (error) {
      removeError = error instanceof Error ? error.message : 'Could not remove the photo.';
    } finally {
      removing = false;
    }
  }
  function view(photo: PlacePhoto) {
    selected = photo.id;
    removeError = '';
    onViewerChange(true);
  }
  function close() {
    selected = null;
    onViewerChange(false);
  }
  onDestroy(() => onViewerChange(false));
  onMount(() => {
    let frame = 0;
    const update = () => {
      if (width !== gallery.clientWidth) width = gallery.clientWidth;
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      // Updating row heights inside a ResizeObserver notification causes feedback
      // notifications. Measure the width on the next frame instead.
      frame = requestAnimationFrame(update);
    });
    observer.observe(gallery);
    update();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  });
</script>

<section class="place-photos" aria-label="Place photos" bind:this={gallery}>
  {#each rows as row}
    <div
      class="photo-row"
      style:height={width ? `${row.height}px` : '220px'}
      style:width={width ? `${row.width}px` : '100%'}
    >
      {#each row.photos as photo}
        {@const position = photos.indexOf(photo) + 1}
        <button
          type="button"
          class="photo-tile"
          style:flex-grow={photo.width / photo.height / row.ratio}
          aria-label={photo.mime?.startsWith('video/')
            ? `Play place video ${position}`
            : `Enlarge place photo ${position}`}
          onclick={() => view(photo)}
        >
          <img
            src={source(photo, true)}
            alt={`Place photo ${position}`}
            width={photo.width}
            height={photo.height}
            loading="lazy"
            decoding="async"
          />
          {#if photo.mime?.startsWith('video/')}<span class="video-play" aria-hidden="true"
              ><Play size={22} fill="currentColor" /></span
            >{/if}
        </button>
      {/each}
    </div>
  {/each}
</section>

<ImageViewer
  items={viewerItems}
  index={current ? index : null}
  onNavigate={(index) => {
    selected = photos[index].id;
    removeError = '';
  }}
  onClose={close}
  onRemove={remove}
  {removing}
  error={removeError}
/>

<style>
  .place-photos {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .photo-row {
    display: flex;
    gap: 10px;
    max-width: 100%;
    margin-inline: auto;
  }
  .photo-tile {
    position: relative;
    display: block;
    flex-basis: 0;
    min-width: 0;
    height: 100%;
    padding: 0;
    border: 0;
    border-radius: 12px;
    overflow: hidden;
    background: #edeff2;
    cursor: zoom-in;
  }
  .video-play {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: #1c2029aa;
    color: #fff;
    pointer-events: none;
  }
  .photo-tile img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
</style>
