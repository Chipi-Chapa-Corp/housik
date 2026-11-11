<script lang="ts">
  import { enhance, type SubmitFunction } from '$app/forms';
  import { goto, refreshAll } from '$app/navigation';
  import { ArrowUpRight, ArrowRight, Plus, LogOut, CalendarDays, Users } from '@lucide/svelte';
  import Modal from '#lib/Modal.svelte';
  import NameBubble from '#lib/NameBubble.svelte';
  import { departureDate } from '#lib/dates.ts';
  let { data } = $props();
  let createOpen = $state(false),
    busy = $state(false),
    error = $state('');
  const date = new Date().toISOString().slice(0, 10);
  let arrival = $state(date);
  const submit: SubmitFunction = () => {
    busy = true;
    error = '';
    return async ({ result, update }) => {
      busy = false;
      if (result.type === 'failure') error = String(result.data?.error || 'Try again.');
      else if (result.type === 'success') {
        const tripId = result.data?.tripId;
        if (tripId) await goto(`/trip/${tripId}`);
        else await refreshAll();
        createOpen = false;
      } else await update();
    };
  };
  const money = (n: number, currency: string) =>
    new Intl.NumberFormat(currency === 'CZK' ? 'cs-CZ' : 'en', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2
    }).format(n / 100);
</script>

<svelte:head
  ><title>Housik</title><meta name="description" content="Shared trip expenses." /></svelte:head
>
<div class="home-shell">
  {#if !data.user}
    <main class="auth-main">
      <section class="signin-card">
        <h1>Sign in</h1>
        <form method="POST" action="?/login" use:enhance={submit} class="stack">
          <label>Name<input name="name" autocomplete="username" required maxlength="20" /></label
          ><label
            >Password<input
              type="password"
              name="password"
              autocomplete="current-password"
              minlength="8"
              maxlength="128"
              required
            /></label
          >{#if error}<p class="form-error" role="alert">{error}</p>{/if}<button
            class="btn primary full"
            disabled={busy}>{busy ? 'Signing in…' : 'Continue'}<ArrowRight size={16} /></button
          >
        </form>
      </section>
    </main>
  {:else}
    <main class="trips-home">
      <div class="page-title">
        <button
          class="btn primary"
          onclick={() => {
            error = '';
            createOpen = true;
          }}><Plus size={16} />New trip</button
        >
        <div class="header-right">
          <NameBubble name={data.user.name} />
          <form method="POST" action="?/logout">
            <button class="icon-btn" aria-label="Sign out"><LogOut size={20} /></button>
          </form>
        </div>
      </div>
      {#if data.trips.length}<div class="trip-grid">
          {#each data.trips as trip}<a class="trip-card" href="/trip/{trip.id}"
              ><div class="trip-card-body">
                <div class="trip-card-title">
                  <h2>{trip.name}</h2>
                  <ArrowUpRight size={18} />
                </div>
                {#if trip.house}<p>{trip.house}</p>{/if}
                <div class="trip-card-meta">
                  <span><CalendarDays size={14} />{trip.nights} nights</span><span
                    ><Users size={14} />{trip.people}</span
                  ><strong>{money(trip.total, trip.currency)}</strong>
                </div>
              </div></a
            >{/each}
        </div>
      {:else}<section class="empty-state">
          <h2>No trips</h2>
        </section>{/if}
      <div class="sample-link">
        <form method="POST" action="?/demo" use:enhance={submit}>
          <button class="text-btn" disabled={busy}>Sample trip <ArrowUpRight size={14} /></button>
        </form>
      </div>
      {#if error && !createOpen}<p class="form-error" role="alert">{error}</p>{/if}
    </main>
  {/if}
</div>
<Modal bind:open={createOpen} title="New trip"
  ><form method="POST" action="?/create" use:enhance={submit} class="stack">
    <label>Trip name<input name="trip" required maxlength="60" /></label><label
      >House / place<input name="house" maxlength="100" /></label
    >
    <label>Location link<input type="url" name="location_url" maxlength="2048" /></label>
    <div class="form-grid">
      <label>Arrival<input type="date" name="start" bind:value={arrival} required /></label><label
        >Departure<input
          type="date"
          name="departure"
          value={departureDate(arrival || date, 3)}
          min={arrival ? departureDate(arrival, 1) : undefined}
          max={arrival ? departureDate(arrival, 365) : undefined}
          required
        /></label
      >
    </div>
    {#if error}<p class="form-error" role="alert">{error}</p>{/if}<button
      class="btn primary full"
      disabled={busy}>Create trip <ArrowRight size={16} /></button
    >
  </form></Modal
>
