<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { RefreshCw } from '@lucide/svelte';
  import type { GooglePhotosProgress } from '#lib/server/google-photos-picker.ts';

  let {
    tripId,
    configured,
    connected,
    onImported
  }: {
    tripId: string;
    configured: boolean;
    connected: boolean;
    onImported: (added: number) => Promise<void>;
  } = $props();
  let running = $state(false);
  let status = $state('');
  let problem = $state('');
  let jobId = '';
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  const storageKey = () => `housik:google-photos:${tripId}`;
  const endpoint = () => `/trip/${tripId}/google-photos`;
  function remember(value: string) {
    try {
      if (value) sessionStorage.setItem(storageKey(), value);
      else sessionStorage.removeItem(storageKey());
    } catch {
      /* Storage may be disabled. */
    }
  }
  function pause(ms: number) {
    return new Promise<void>((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, ms);
    });
  }
  function stopWaiting() {
    clearTimeout(timer);
    wake?.();
    wake = undefined;
  }
  async function poll(id: string, run: number) {
    try {
      while (run === generation) {
        const response = await fetch(`${endpoint()}/${encodeURIComponent(id)}`, { method: 'POST' });
        const result: GooglePhotosProgress = await response.json();
        if (run !== generation) return;
        if (!response.ok)
          throw new Error(result.error || 'Could not check Google Photos. Reload to try again.');
        status =
          result.status === 'importing'
            ? `Importing photos (${result.processed}/${result.total})`
            : result.status === 'connecting'
              ? 'Waiting for Google sign-in'
              : 'Select photos in Google Photos';
        if (
          result.status === 'done' ||
          result.status === 'error' ||
          result.status === 'cancelled'
        ) {
          remember('');
          jobId = '';
          status = `${result.added} added · ${result.skipped} skipped${result.failed ? ` · ${result.failed} failed` : ''}`;
          problem =
            result.error ||
            (result.failed ? 'Some photos could not be imported. Reload to retry them.' : '');
          await onImported(result.added);
          return;
        }
        await pause(Math.min(60_000, Math.max(1000, result.retryAfter || 1000)));
      }
    } catch (cause) {
      if (run === generation)
        problem =
          cause instanceof Error ? cause.message : 'Could not import photos. Reload to try again.';
    } finally {
      if (run === generation) running = false;
    }
  }
  async function start() {
    if (running || !configured) return;
    const opened = window.open('about:blank', '_blank');
    if (!opened) {
      problem = 'Allow pop-ups to open Google Photos.';
      return;
    }
    opened.opener = null;
    running = true;
    problem = '';
    status = 'Opening Google Photos';
    const run = ++generation;
    try {
      // Explicit Reload starts a fresh picker; recoverable progress is resumed on
      // page reload instead. A previous failed attempt is safe to repeat.
      if (jobId) await fetch(`${endpoint()}/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
      const response = await fetch(endpoint(), { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not open Google Photos.');
      if (run !== generation) {
        opened.close();
        await fetch(`${endpoint()}/${encodeURIComponent(result.jobId)}`, {
          method: 'DELETE'
        }).catch(() => {});
        return;
      }
      jobId = result.jobId;
      remember(jobId);
      opened.location.href = result.url;
      await poll(jobId, run);
    } catch (cause) {
      opened.close();
      if (run === generation) {
        running = false;
        status = '';
        problem = cause instanceof Error ? cause.message : 'Could not open Google Photos.';
      }
    }
  }
  async function cancel() {
    const id = jobId;
    ++generation;
    stopWaiting();
    running = false;
    jobId = '';
    remember('');
    status = 'Import cancelled';
    problem = '';
    if (id) {
      await fetch(`${endpoint()}/${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => {});
      await onImported(0);
    }
  }
  onMount(() => {
    try {
      jobId = sessionStorage.getItem(storageKey()) || '';
    } catch {
      /* Storage may be disabled. */
    }
    if (jobId && configured) {
      running = true;
      void poll(jobId, ++generation);
    }
  });
  onDestroy(() => {
    ++generation;
    stopWaiting();
  });
</script>

<div class="google-photos-settings">
  <div class="google-photos-row">
    <span>Google Photos</span>
    <button type="button" class="btn secondary" disabled={!configured || running} onclick={start}>
      {#if connected}<RefreshCw size={18} />Reload{:else}Connect{/if}
    </button>
    {#if running}<button type="button" class="text-btn" onclick={cancel}>Cancel</button>{/if}
  </div>
  {#if !configured}
    <p class="muted">Google Photos is not configured.</p>
  {:else}
    <p class="muted">Selected photos are saved to this trip for all participants.</p>
  {/if}
  {#if status}<p role="status">{status}</p>{/if}
  {#if problem}<p class="form-error" role="alert">{problem}</p>{/if}
</div>

<style>
  .google-photos-settings {
    display: grid;
    gap: 10px;
  }
  .google-photos-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .google-photos-row > span {
    margin-right: auto;
  }
  p {
    margin: 0;
  }
</style>
