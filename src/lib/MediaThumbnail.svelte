<script lang="ts">
  import { onMount } from 'svelte';
  import { ImageOff } from '@lucide/svelte';
  let {
    src,
    width,
    height,
    alt = '',
    loading = 'lazy',
    onReady,
    ondblclick
  }: {
    src: string;
    width?: number;
    height?: number;
    alt?: string;
    loading?: 'lazy' | 'eager';
    onReady?: (image: HTMLImageElement) => void;
    ondblclick?: (event: MouseEvent) => void;
  } = $props();
  let image: HTMLImageElement;
  let ready = $state(false);
  let failed = $state(false);
  onMount(() => {
    // Cached images can finish loading before hydration attaches the load handler.
    if (image.complete) {
      ready = image.naturalWidth > 0;
      failed = !ready;
      if (ready) onReady?.(image);
    }
  });
</script>

<span class="thumbnail" aria-busy={!ready && !failed}>
  {#if !ready && !failed}<span class="skeleton" aria-hidden="true"></span>{/if}
  <img
    bind:this={image}
    {src}
    {alt}
    {width}
    {height}
    {loading}
    draggable="false"
    {ondblclick}
    decoding="async"
    class:ready
    onload={() => {
      ready = true;
      failed = false;
      onReady?.(image);
    }}
    onerror={() => {
      ready = false;
      failed = true;
    }}
  />
  {#if failed}<span class="unavailable" aria-hidden="true"><ImageOff size={28} /></span>{/if}
</span>

<style>
  .thumbnail {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    overflow: hidden;
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    opacity: 0;
    transition: opacity 180ms ease;
  }
  img.ready {
    opacity: 1;
  }
  .skeleton {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: linear-gradient(135deg, #e2e5e9, #eceef1);
  }
  .skeleton::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(100deg, transparent 20%, #ffffff75 50%, transparent 80%);
    transform: translateX(-100%);
    animation: shimmer 1.5s ease-in-out infinite;
  }
  .unavailable {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: #747c87;
  }
  @keyframes shimmer {
    to {
      transform: translateX(100%);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    img {
      transition: none;
    }
    .skeleton::after {
      animation: none;
      transform: none;
      opacity: 0.35;
    }
  }
</style>
