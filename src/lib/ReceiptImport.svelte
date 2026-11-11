<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { enhance, type SubmitFunction } from '$app/forms';
  import { Upload, X, Check, Plus, Menu, Trash2 } from '@lucide/svelte';
  import Modal from './Modal.svelte';
  import ReceiptPreview from './ReceiptPreview.svelte';
  import ReceiptViewer from './ReceiptViewer.svelte';
  import AmountInput from './AmountInput.svelte';
  import PeopleSelect from './PeopleSelect.svelte';
  import {
    maxReceipts,
    maxReceiptBytes,
    type ReceiptReviewItem,
    type ReceiptReview
  } from './receipts';
  import type { Member } from './types';
  import { cents } from './money';
  import { inputCurrency, toCzk } from './currency';

  let {
    open,
    tripId,
    members,
    rate,
    onClose,
    onSaved
  }: {
    open: boolean;
    tripId: string;
    members: Member[];
    rate: number | null;
    onClose: () => void;
    onSaved: () => void | Promise<void>;
  } = $props();
  type UploadReceipt = {
    key: string;
    file: File;
    src: string;
    mime: string;
    currency: string;
    status: 'ready' | 'processing' | 'succeeded' | 'failed';
    draft: string;
    merchant: string;
    date: string;
    members: string[];
    items: (ReceiptReviewItem & { currency: string; expanded?: boolean })[];
    error: string;
  };
  let receipts = $state<UploadReceipt[]>([]);
  let phase = $state<'select' | 'processing' | 'review'>('select');
  let error = $state(''),
    busy = $state(false);
  let enlarged = $state<{ src: string; mime: string; name: string } | null>(null);
  let fileInput = $state<HTMLInputElement>();
  let generation = 0,
    controller: AbortController | undefined,
    wasOpen = false;
  const totalItems = $derived(receipts.reduce((sum, receipt) => sum + receipt.items.length, 0));
  const money = (amount: number) =>
    new Intl.NumberFormat('cs-CZ', {
      style: 'currency',
      currency: 'CZK',
      minimumFractionDigits: 2
    }).format(amount / 100);
  function itemTotal(item: ReceiptReviewItem) {
    try {
      return toCzk(cents(item.amount || '0'), inputCurrency(item.currency), rate);
    } catch {
      return 0;
    }
  }
  function release() {
    generation++;
    controller?.abort();
    for (const receipt of receipts) URL.revokeObjectURL(receipt.src);
    receipts = [];
    phase = 'select';
    error = '';
    busy = false;
    enlarged = null;
  }
  $effect(() => {
    if (open !== wasOpen) {
      wasOpen = open;
      untrack(release);
    }
  });
  onDestroy(() => {
    controller?.abort();
    for (const receipt of receipts) URL.revokeObjectURL(receipt.src);
  });
  function discard(draft: string) {
    if (draft) void fetch(`/trip/${tripId}/receipt/${draft}`, { method: 'DELETE' }).catch(() => {});
  }
  function close() {
    controller?.abort();
    for (const receipt of receipts) discard(receipt.draft);
    onClose();
  }
  function addFiles(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    error = '';
    for (const file of Array.from(input.files || [])) {
      if (receipts.length >= maxReceipts) {
        error = `Choose up to ${maxReceipts} receipts.`;
        break;
      }
      if (!file.size || file.size > maxReceiptBytes) {
        error = `${file.name}: file limit is 10 MB.`;
        continue;
      }
      if (
        receipts.some(
          (receipt) =>
            receipt.file.name === file.name &&
            receipt.file.size === file.size &&
            receipt.file.lastModified === file.lastModified
        )
      )
        continue;
      receipts.push({
        key: crypto.randomUUID(),
        file,
        src: URL.createObjectURL(file),
        mime: file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : 'image/png'),
        currency: 'CZK',
        status: 'ready',
        draft: '',
        merchant: file.name.replace(/\.[^.]+$/, '').slice(0, 80) || 'Receipt',
        date: new Date().toISOString().slice(0, 10),
        members: members.map((member) => member.id),
        items: [{ title: '', amount: '', currency: 'CZK' }],
        error: ''
      });
    }
    input.value = '';
  }
  function remove(receipt: UploadReceipt) {
    discard(receipt.draft);
    URL.revokeObjectURL(receipt.src);
    receipts = receipts.filter((entry) => entry.key !== receipt.key);
    if (!receipts.length && phase === 'review') phase = 'select';
  }
  function enlarge(receipt: UploadReceipt) {
    enlarged = { src: receipt.src, mime: receipt.mime, name: receipt.file.name };
  }
  async function upload(receipt: UploadReceipt, manual = false) {
    const form = new FormData();
    form.set('file', receipt.file);
    form.set('manual', String(manual));
    const response = await fetch(`/trip/${tripId}/scan`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.any([
        AbortSignal.timeout(90_000),
        ...(controller ? [controller.signal] : [])
      ])
    });
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value.error || 'Upload failed. Try again.');
    return value;
  }
  async function processReceipts() {
    if (!receipts.length) return;
    phase = 'processing';
    error = '';
    controller = new AbortController();
    const token = generation,
      files = [...receipts];
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(2, files.length) }, async () => {
        while (next < files.length && token === generation && !controller?.signal.aborted) {
          const receipt = files[next++];
          receipt.status = 'processing';
          try {
            const value = await upload(receipt);
            if (token !== generation) {
              discard(value.id);
              return;
            }
            receipt.draft = value.id;
            receipt.currency = value.currency === 'EUR' ? 'EUR' : 'CZK';
            receipt.status = value.status;
            receipt.error = value.error || '';
            receipt.items = value.items.length
              ? value.items.map((item: { title: string; amount: number; currency: string }) => ({
                  title: item.title,
                  amount: (item.amount / 100).toFixed(2),
                  currency: item.currency === 'EUR' ? 'EUR' : 'CZK'
                }))
              : [{ title: '', amount: '', currency: 'CZK' }];
          } catch (cause) {
            if (token !== generation) return;
            receipt.status = 'failed';
            receipt.error = cause instanceof Error ? cause.message : 'Upload failed. Try again.';
          }
        }
      })
    );
    if (token === generation && !controller.signal.aborted) phase = 'review';
  }
  const save: SubmitFunction = async ({ formData, cancel }) => {
    busy = true;
    error = '';
    try {
      for (const receipt of receipts) {
        if (!receipt.draft) {
          const value = await upload(receipt, true);
          receipt.draft = value.id;
          receipt.currency = value.currency;
        }
      }
      const reviews: ReceiptReview[] = receipts.map(
        ({ draft, merchant, date, members, items }) => ({
          draft,
          merchant,
          date,
          members,
          items: items.map(({ title, amount, currency, date, members }) => ({
            title,
            amount,
            currency,
            date,
            members
          }))
        })
      );
      formData.set('receipts', JSON.stringify(reviews));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Upload failed. Try again.';
      busy = false;
      cancel();
      return;
    }
    return async ({ result, update }) => {
      busy = false;
      if (result.type === 'success') {
        await onSaved();
        onClose();
      } else if (result.type === 'failure')
        error = String(result.data?.error || 'Could not import receipts.');
      else await update();
    };
  };
</script>

<Modal
  {open}
  title={phase === 'review'
    ? receipts.length === 1
      ? 'Review receipt'
      : 'Review receipts'
    : 'Receipts'}
  onClose={close}
  width={phase === 'review' ? '760px' : '1000px'}
>
  <div class="receipt-workspace">
    {#if phase !== 'review'}
      <div class="stack">
        <input
          class="file-input"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,application/pdf"
          aria-label="Receipt files"
          bind:this={fileInput}
          onchange={addFiles}
          disabled={phase === 'processing'}
        />
        <button
          class="btn primary full receipt-upload"
          type="button"
          disabled={phase === 'processing'}
          onclick={() => fileInput?.click()}><Upload size={16} />Upload receipts</button
        >
        {#if receipts.length}<div class="receipt-selection" aria-label="Selected receipts">
            {#each receipts as receipt (receipt.key)}<article
                class="receipt-selection-card"
                data-status={receipt.status}
              >
                <ReceiptPreview
                  src={receipt.src}
                  mime={receipt.mime}
                  name={receipt.file.name}
                  onEnlarge={() => enlarge(receipt)}
                />
                {#if phase === 'select'}<button
                    class="icon-btn receipt-remove"
                    type="button"
                    aria-label={`Remove receipt ${receipt.file.name}`}
                    onclick={() => remove(receipt)}><Trash2 size={16} /></button
                  >{/if}
                {#if receipt.status === 'processing'}<div
                    class="neural-overlay"
                    role="status"
                    aria-label={`Processing ${receipt.file.name}`}
                  >
                    <svg viewBox="0 0 120 80" aria-hidden="true"
                      ><g class="neural-links" fill="none" stroke="currentColor" stroke-width="1.5"
                        ><path
                          d="M16 16 54 12 100 25 62 42 16 16 20 63 62 42 100 65 100 25M20 63 54 12M62 42 54 12M20 63 100 65"
                        /></g
                      ><g fill="currentColor"
                        >{#each [[16, 16], [54, 12], [100, 25], [62, 42], [20, 63], [100, 65]] as point, i}<circle
                            class="neural-node"
                            cx={point[0]}
                            cy={point[1]}
                            r="4"
                            style:animation-delay={`${i * 140}ms`}
                          />{/each}</g
                      ></svg
                    >
                  </div>{:else if receipt.status === 'succeeded' || receipt.status === 'failed'}<span
                    class="receipt-status"
                    class:succeeded={receipt.status === 'succeeded'}
                    class:failed={receipt.status === 'failed'}
                    role="img"
                    aria-label={receipt.status === 'succeeded' ? 'Scan succeeded' : 'Scan failed'}
                    >{#if receipt.status === 'succeeded'}<Check size={19} />{:else}<X
                        size={19}
                      />{/if}</span
                  >{/if}
                <span class="receipt-filename">{receipt.file.name}</span>
              </article>{/each}
          </div>{/if}
        {#if error}<p class="form-error" role="alert">{error}</p>{/if}
        <button
          class="btn primary full"
          type="button"
          disabled={!receipts.length || phase === 'processing'}
          onclick={processReceipts}>{phase === 'processing' ? 'Processing…' : 'Continue'}</button
        >
      </div>
    {:else}
      <form method="POST" action="?/importReceipts" use:enhance={save} class="stack">
        <div class="receipt-review-list">
          {#each receipts as receipt (receipt.key)}<article
              class="receipt-review-card"
              data-status={receipt.status}
            >
              <div class="receipt-review-header">
                <div class="receipt-thumbnail">
                  <ReceiptPreview
                    src={receipt.src}
                    mime={receipt.mime}
                    name={receipt.file.name}
                    onEnlarge={() => enlarge(receipt)}
                  />
                  <span
                    class="receipt-status"
                    class:succeeded={receipt.status === 'succeeded'}
                    class:failed={receipt.status === 'failed'}
                    role="img"
                    aria-label={receipt.status === 'succeeded' ? 'Scan succeeded' : 'Scan failed'}
                    >{#if receipt.status === 'succeeded'}<Check size={19} />{:else}<X
                        size={19}
                      />{/if}</span
                  >
                </div>
                <label
                  >Receipt name<input
                    name="merchant"
                    bind:value={receipt.merchant}
                    maxlength="80"
                    required
                  /></label
                >
                <button
                  class="icon-btn"
                  type="button"
                  aria-label={`Remove receipt ${receipt.file.name}`}
                  disabled={busy}
                  onclick={() => remove(receipt)}><Trash2 size={16} /></button
                >
              </div>
              <div class="receipt-defaults">
                <label>Date<input type="date" bind:value={receipt.date} required /></label>
                <PeopleSelect
                  {members}
                  selected={receipt.members}
                  onchange={(ids) => (receipt.members = ids)}
                />
              </div>
              {#if receipt.error}<p class="receipt-error">{receipt.error}</p>{/if}
              <div class="receipt-products">
                {#each receipt.items as item, i}<div class="receipt-product">
                    <input
                      aria-label="Item name"
                      bind:value={item.title}
                      required
                      maxlength="100"
                    />
                    <AmountInput
                      name={null}
                      currencyName={null}
                      compact
                      label="Item amount"
                      bind:value={item.amount}
                      bind:currency={item.currency}
                      {rate}
                    />
                    <div class="receipt-item-actions">
                      <button
                        class="icon-btn"
                        class:customized={item.date !== undefined || item.members !== undefined}
                        type="button"
                        aria-label="Item settings"
                        aria-expanded={!!item.expanded}
                        aria-controls={`item-settings-${receipt.key}-${i}`}
                        onclick={() => (item.expanded = !item.expanded)}><Menu size={18} /></button
                      >
                      <button
                        class="icon-btn"
                        type="button"
                        aria-label="Remove item"
                        onclick={() => receipt.items.splice(i, 1)}><Trash2 size={17} /></button
                      >
                    </div>
                    {#if item.expanded}
                      <div class="receipt-item-settings" id={`item-settings-${receipt.key}-${i}`}>
                        <div class="receipt-defaults">
                          <label
                            >Date<input
                              type="date"
                              value={item.date ?? receipt.date}
                              onchange={(event) => (item.date = event.currentTarget.value)}
                              required
                            /></label
                          >
                          <PeopleSelect
                            {members}
                            selected={item.members ?? receipt.members}
                            onchange={(ids) => (item.members = ids)}
                          />
                        </div>
                        {#if item.date !== undefined || item.members !== undefined}
                          <button
                            class="text-btn"
                            type="button"
                            onclick={() => {
                              delete item.date;
                              delete item.members;
                            }}>Use receipt defaults</button
                          >
                        {/if}
                      </div>
                    {/if}
                  </div>{/each}
              </div>
              {#if receipt.items.some((item) => !['EUR', 'CZK'].includes(item.currency))}<p
                  class="form-error"
                >
                  Choose EUR or CZK for each item.
                </p>{/if}
              <div class="receipt-subtotal">
                <button
                  type="button"
                  class="text-btn"
                  onclick={() =>
                    receipt.items.push({
                      title: '',
                      amount: '',
                      currency: receipt.currency === 'EUR' ? 'EUR' : 'CZK'
                    })}><Plus size={14} />Add item</button
                ><strong
                  >Total {money(
                    receipt.items.reduce((sum, item) => sum + itemTotal(item), 0)
                  )}</strong
                >
              </div>
            </article>{/each}
        </div>
        {#if error}<p class="form-error" role="alert">{error}</p>{/if}
        <div class="modal-actions">
          <button class="btn secondary" type="button" onclick={close}>Cancel</button><button
            class="btn primary"
            disabled={busy ||
              !receipts.length ||
              receipts.some(
                (receipt) =>
                  !receipt.items.length ||
                  receipt.items.some((item) => !['EUR', 'CZK'].includes(item.currency))
              )}>{busy ? 'Saving…' : `Add ${totalItems} items`}<Check size={16} /></button
          >
        </div>
      </form>
    {/if}
  </div>
</Modal>
<ReceiptViewer receipt={enlarged} onClose={() => (enlarged = null)} />

<style>
  .receipt-workspace {
    width: 100%;
    min-width: 0;
  }
  .file-input {
    display: none;
  }
  .receipt-upload {
    min-height: 46px;
  }
  .receipt-selection {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
    max-height: 56dvh;
    overflow-y: auto;
    padding: 2px;
  }
  .receipt-selection-card {
    position: relative;
    min-width: 0;
    border: 1px solid #e3e3e3;
    border-radius: 11px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .receipt-review-list {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    width: 100%;
    gap: 24px;
    min-width: 0;
  }
  .receipt-review-card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    min-width: 0;
    padding: 0 0 24px;
    border-bottom: 1px solid #e3e3e3;
  }
  .receipt-review-card:last-child {
    border-bottom: 0;
    padding-bottom: 0;
  }
  .receipt-review-header {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr) 36px;
    gap: 12px;
    align-items: start;
  }
  .receipt-review-header > * {
    min-width: 0;
  }
  .receipt-defaults {
    display: grid;
    grid-template-columns: minmax(0, 160px) minmax(0, 1fr);
    align-items: start;
    gap: 10px;
    min-width: 0;
  }
  .receipt-defaults > label {
    min-width: 0;
  }
  .receipt-defaults input {
    width: 100%;
    min-width: 0;
    padding-inline: 7px;
  }
  .receipt-filename {
    overflow-wrap: anywhere;
  }
  .receipt-remove {
    position: absolute;
    top: 18px;
    right: 18px;
    z-index: 2;
    border: 1px solid #ddd;
    border-radius: 50%;
    background: #fff;
  }
  .receipt-status {
    position: absolute;
    top: 18px;
    left: 18px;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border: 1px solid currentColor;
    border-radius: 50%;
    z-index: 1;
  }
  .receipt-status.succeeded {
    color: #21663b;
    background: #e8f5ec;
  }
  .receipt-status.failed {
    color: #a32929;
    background: #fdeeee;
  }
  .receipt-thumbnail {
    position: relative;
  }
  .receipt-thumbnail .receipt-status {
    top: 6px;
    left: 6px;
  }
  .receipt-error {
    color: #8e2929;
  }
  .receipt-products {
    display: flex;
    flex-direction: column;
    max-height: none;
    overflow: visible;
    gap: 12px;
    min-width: 0;
  }
  .receipt-product {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 210px) 76px;
    align-items: start;
    gap: 10px;
    padding-bottom: 0;
    min-width: 0;
  }
  .receipt-product > input {
    grid-column: 1;
    grid-row: 1;
  }
  .receipt-product > :global(.amount-field) {
    grid-column: 2;
    grid-row: 1;
    min-width: 0;
  }
  .receipt-item-actions {
    display: flex;
    gap: 4px;
    grid-column: 3;
    grid-row: 1;
  }
  .receipt-item-actions .customized {
    background: #e5e5e5;
    color: #343434;
  }
  .receipt-item-settings {
    grid-column: 1 / -1;
    padding: 12px;
    background: #f5f5f5;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
  }
  .receipt-subtotal {
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }
  .receipt-thumbnail :global(.receipt-preview) {
    height: 140px;
  }
  .neural-overlay {
    position: absolute;
    inset: 12px 12px auto;
    height: 160px;
    display: grid;
    place-items: center;
    background: #ffffffa8;
    color: #45576c;
    border-radius: 9px;
    pointer-events: none;
  }
  .neural-overlay svg {
    width: 120px;
    height: 80px;
  }
  .neural-links {
    stroke-dasharray: 8 8;
    animation: neural-flow 1.1s linear infinite;
  }
  .neural-node {
    animation: neural-pulse 1.1s ease-in-out infinite alternate;
    transform-box: fill-box;
    transform-origin: center;
  }
  @keyframes neural-flow {
    to {
      stroke-dashoffset: -32;
    }
  }
  @keyframes neural-pulse {
    to {
      opacity: 0.4;
      transform: scale(0.65);
    }
  }
  @media (max-width: 640px) {
    .receipt-selection {
      grid-template-columns: minmax(0, 1fr);
    }
    .receipt-product {
      grid-template-columns: minmax(0, 1fr) 76px;
    }
    .receipt-product > input {
      grid-column: 1 / -1;
      grid-row: 1;
    }
    .receipt-product > :global(.amount-field) {
      grid-column: 1;
      grid-row: 2;
    }
    .receipt-item-actions {
      grid-column: 2;
      grid-row: 2;
    }
    .receipt-defaults {
      grid-template-columns: minmax(0, 132px) minmax(0, 1fr);
    }
  }
  @media (max-width: 380px) {
    .receipt-item-settings {
      padding: 12px 4px;
    }
    .receipt-item-settings .receipt-defaults {
      grid-template-columns: minmax(0, 128px) minmax(0, 1fr);
      gap: 6px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .neural-links,
    .neural-node {
      animation: none;
    }
  }
</style>
