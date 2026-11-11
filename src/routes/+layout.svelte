<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { installValidation } from '#lib/validation.ts';
  let { children } = $props();
  onMount(() => {
    document.documentElement.dataset.hydrated = 'true';
    return installValidation(document);
  });
</script>

{@render children()}
