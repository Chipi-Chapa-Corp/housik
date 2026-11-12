<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { enhance, type SubmitFunction } from '$app/forms';
  import { Upload, X, Check, Plus, Pencil, Trash2 } from '@lucide/svelte';
  import Modal from './Modal.svelte';
  import ReceiptPreview from './ReceiptPreview.svelte';
  import ReceiptSummary from './ReceiptSummary.svelte';
  import ReceiptViewer from './ReceiptViewer.svelte';
  import AmountInput from './AmountInput.svelte';
  import PeopleSelect from './PeopleSelect.svelte';
  import {
    maxReceipts,
    maxReceiptBytes,
    receiptScanConcurrency,
    type ReceiptReviewItem,
    type ReceiptReview
  } from './receipts';
  import type { Member, Expense, Tag } from './types';
  import { cents } from './money';
  import { inputCurrency, toCzk } from './currency';

  let {
    open,
    tripId,
    members,
    tags,
    rate,
    onClose,
    onSaved
  }: {
    open: boolean;
    tripId: string;
    members: Member[];
    tags: Tag[];
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
    kind: Expense['kind'];
    date: string;
    members: string[];
    tag_ids: string[];
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
  const totalAmount = $derived(
    receipts.reduce(
      (sum, receipt) => sum + receipt.items.reduce((total, item) => total + itemTotal(item), 0),
      0
    )
  );
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
  function itemPrice(item: ReceiptReviewItem) {
    try {
      return new Intl.NumberFormat('cs-CZ', {
        style: 'currency',
        currency: inputCurrency(item.currency),
        minimumFractionDigits: 2
      }).format(cents(item.amount || '0') / 100);
    } catch {
      return '—';
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
        kind: 'product',
        date: new Date().toISOString().slice(0, 10),
        members: members.map((member) => member.id),
        tag_ids: [],
        items: [{ title: '', amount: '', currency: 'CZK', expanded: true }],
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
      Array.from({ length: Math.min(receiptScanConcurrency, files.length) }, async () => {
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
              : [{ title: '', amount: '', currency: 'CZK', expanded: true }];
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
        ({ draft, kind, date, members, tag_ids, items }) => ({
          draft,
          kind,
          date,
          members,
          tag_ids,
          items: items.map(({ title, amount, currency, date, members, tag_ids }) => ({
            title,
            amount,
            currency,
            date,
            members,
            tag_ids
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
  width={phase === 'review' ? '620px' : '1000px'}
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
                    class="receipt-scan"
                    role="status"
                    aria-label={`Processing ${receipt.file.name}`}
                  >
                    <div class="receipt-scan-band" aria-hidden="true"></div>
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
                    joined
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
                  >
                    {#if receipt.status === 'succeeded'}<Check size={19} />{:else}<X
                        size={19}
                      />{/if}
                  </span>
                  <ReceiptSummary
                    total={money(receipt.items.reduce((sum, item) => sum + itemTotal(item), 0))}
                    count={receipt.items.length}
                  />
                </div>
              </div>
              <div class="segmented receipt-type" role="group" aria-label="Receipt type">
                {#each [['product', 'Groceries'], ['other', 'Extra'], ['rent', 'Rent']] as [value, label]}
                  <button
                    type="button"
                    class:active={receipt.kind === value}
                    aria-pressed={receipt.kind === value}
                    onclick={() => (receipt.kind = value as Expense['kind'])}>{label}</button
                  >
                {/each}
              </div>
              <div class="receipt-defaults">
                <label>Date<input type="date" bind:value={receipt.date} required /></label>
                <PeopleSelect
                  {members}
                  {tags}
                  selectedTags={receipt.tag_ids}
                  onTagsChange={(ids) => (receipt.tag_ids = ids)}
                  selected={receipt.members}
                  onchange={(ids) => (receipt.members = ids)}
                />
              </div>
              {#if receipt.error}<p class="receipt-error">{receipt.error}</p>{/if}
              <div class="receipt-products">
                {#each receipt.items as item, i}<div class="receipt-product">
                    <div class="receipt-detail-item">
                      <button
                        type="button"
                        class="receipt-item-open"
                        onclick={() => (item.expanded = !item.expanded)}
                      >
                        <span>{item.title || 'New item'}</span><strong>{itemPrice(item)}</strong>
                      </button>
                      <button
                        class="icon-btn"
                        class:customized={item.date !== undefined ||
                          item.members !== undefined ||
                          item.tag_ids !== undefined}
                        type="button"
                        aria-label={item.expanded ? 'Done editing item' : 'Edit item'}
                        aria-expanded={!!item.expanded}
                        aria-controls={`item-settings-${receipt.key}-${i}`}
                        onclick={() => (item.expanded = !item.expanded)}
                      >
                        {#if item.expanded}<Check size={18} />{:else}<Pencil size={18} />{/if}
                      </button>
                      <button
                        class="icon-btn"
                        type="button"
                        aria-label="Remove item"
                        onclick={() => receipt.items.splice(i, 1)}><Trash2 size={17} /></button
                      >
                    </div>
                    {#if item.expanded}
                      <div class="receipt-item-settings" id={`item-settings-${receipt.key}-${i}`}>
                        <div class="receipt-item-fields">
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
                        </div>
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
                            {tags}
                            selectedTags={item.tag_ids ?? receipt.tag_ids}
                            onTagsChange={(ids) => (item.tag_ids = ids)}
                            selected={item.members ?? receipt.members}
                            onchange={(ids) => (item.members = ids)}
                          />
                        </div>
                        {#if item.date !== undefined || item.members !== undefined || item.tag_ids !== undefined}
                          <button
                            class="text-btn"
                            type="button"
                            onclick={() => {
                              delete item.date;
                              delete item.members;
                              delete item.tag_ids;
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
                      currency: receipt.currency === 'EUR' ? 'EUR' : 'CZK',
                      expanded: true
                    })}><Plus size={14} />Add item</button
                ><button
                  class="icon-btn"
                  type="button"
                  aria-label={`Remove receipt ${receipt.file.name}`}
                  disabled={busy}
                  onclick={() => remove(receipt)}><Trash2 size={18} /></button
                >
              </div>
            </article>{/each}
        </div>
        {#if error}<p class="form-error" role="alert">{error}</p>{/if}
        <div class="modal-actions receipt-actions">
          <button class="btn secondary" type="button" onclick={close}>Cancel</button><button
            class="btn primary"
            disabled={busy ||
              !receipts.length ||
              receipts.some(
                (receipt) =>
                  !receipt.items.length ||
                  receipt.items.some((item) => !['EUR', 'CZK'].includes(item.currency))
              )}
            >{busy
              ? 'Saving…'
              : `Add ${totalItems} ${totalItems === 1 ? 'item' : 'items'} for ${money(totalAmount)}`}<Check
              size={16}
            /></button
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
    grid-template-columns: minmax(0, 1fr);
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
    gap: 0;
    min-width: 0;
  }
  .receipt-product {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    min-width: 0;
  }
  .receipt-detail-item .customized {
    background: #e5e5e5;
    color: #343434;
  }
  .receipt-item-fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 210px);
    gap: 10px;
    min-width: 0;
  }
  .receipt-item-fields > :global(.amount-field) {
    min-width: 0;
  }
  .receipt-thumbnail :global(.receipt-card-summary) {
    margin-bottom: 0;
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
  .receipt-scan {
    position: absolute;
    inset: 12px 12px auto;
    height: 160px;
    overflow: hidden;
    background: #45576c08;
    border-radius: 9px;
    pointer-events: none;
  }
  .receipt-scan-band {
    position: absolute;
    inset: 0 0 auto;
    height: 35%;
    background: linear-gradient(transparent, #769ca52e);
    border-bottom: 2px solid #567d89;
    box-shadow: 0 4px 12px #567d8933;
    animation: receipt-sweep 1.6s ease-in-out infinite alternate;
  }
  @keyframes receipt-sweep {
    from {
      transform: translateY(-100%);
    }
    to {
      transform: translateY(186%);
    }
  }
  .receipt-type button {
    min-width: 0;
  }
  .receipt-actions {
    flex-wrap: wrap;
  }
  .receipt-actions .primary {
    white-space: normal;
  }
  @media (max-width: 480px) {
    .receipt-actions {
      flex-direction: column-reverse;
      align-items: stretch;
    }
    .receipt-actions button {
      width: 100%;
    }
  }
  @media (max-width: 640px) {
    .receipt-selection {
      grid-template-columns: minmax(0, 1fr);
    }
    .receipt-item-fields {
      grid-template-columns: minmax(0, 1fr);
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
    .receipt-scan-band {
      animation: none;
      top: 50%;
      transform: translateY(-50%);
    }
  }
</style>
