<script lang="ts">
  import { page } from '$app/state';
  import { ArrowLeft } from '@lucide/svelte';
</script>

<main class="error-page">
  <a href="/" class="brand">Housik</a>
  <h1>{page.status}</h1>
  <p>{page.error?.message || 'Something went wrong.'}</p>
  <a class="btn primary" href="/"><ArrowLeft size={16} /> Trips</a>
</main>
