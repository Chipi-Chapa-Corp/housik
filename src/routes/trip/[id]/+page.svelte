<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import { ArrowRight } from '@lucide/svelte';
  import TripWorkspace from '#lib/TripWorkspace.svelte';
  import NameBubble from '#lib/NameBubble.svelte';
  import NameSelect from '#lib/NameSelect.svelte';
  import type { PageData } from './$types';
  let { data }: { data: PageData } = $props();
  let name = $state(''),
    busy = $state(false),
    message = $state('');
  const tripName = $derived(data.access === 'member' ? data.trip.name : data.invite.name);
  const pageTitle = $derived(
    data.access === 'signin'
      ? `Sign in · ${tripName}`
      : data.access === 'join'
        ? `Join trip · ${tripName}`
        : `${tripName} · Housik`
  );
  const submit: SubmitFunction = () => {
    busy = true;
    message = '';
    return async ({ result, update }) => {
      busy = false;
      if (result.type === 'failure') message = String(result.data?.error || 'Could not continue.');
      else await update();
    };
  };
</script>

<svelte:head><title>{pageTitle}</title></svelte:head>
{#if data.access === 'member'}
  <TripWorkspace {data} />
{:else}
  <div class="home-shell">
    <main class="auth-main">
      <section class="signin-card trip-access-card">
        <h1>{data.access === 'signin' ? `Sign in · ${tripName}` : tripName}</h1>
        {#if data.access === 'join'}
          <form method="POST" action="?/join" use:enhance={submit} class="stack">
            <div class="invite-user"><NameBubble name={data.user.name} /></div>
            {#if message}<p class="form-error" role="alert">{message}</p>{/if}
            <button class="btn primary full" disabled={busy}
              >{busy ? 'Joining…' : 'Join trip'}<ArrowRight size={16} /></button
            >
          </form>
        {:else}
          <form method="POST" action="?/login" use:enhance={submit} class="stack">
            <NameSelect options={data.names} bind:value={name} />
            <label
              >Password<input
                name="password"
                type="password"
                autocomplete="current-password"
                minlength="8"
                maxlength="128"
                required
              /></label
            >
            {#if message}<p class="form-error" role="alert">{message}</p>{/if}
            <button class="btn primary full" disabled={busy}
              >{busy ? 'Signing in…' : 'Continue'}<ArrowRight size={16} /></button
            >
          </form>
        {/if}
      </section>
    </main>
  </div>
{/if}
