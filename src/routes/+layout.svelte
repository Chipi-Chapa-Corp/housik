<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  let { children } = $props();
  onMount(() => {
    document.documentElement.dataset.hydrated = 'true';
  });
</script>

{@render children()}
