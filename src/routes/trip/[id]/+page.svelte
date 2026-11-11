<script lang="ts">
  import { enhance } from '$app/forms';
  import { refreshAll } from '$app/navigation';
  import type { SubmitFunction } from '$app/forms';
  import {
    House,
    LayoutGrid,
    ArrowLeft,
    ArrowRight,
    ArrowUpRight,
    Plus,
    Users,
    ReceiptText,
    Wallet,
    LogOut,
    Settings2,
    Check,
    ChevronRight,
    Search,
    ShoppingBasket,
    Car,
    X,
    Upload,
    Trash2,
    Pencil,
    Download,
    Tag as TagIcon,
    CalendarDays,
    CircleCheck,
    Copy
  } from '@lucide/svelte';
  import Modal from '#lib/Modal.svelte';
  import Toast from '#lib/Toast.svelte';
  import NameBubble from '#lib/NameBubble.svelte';
  import TagSelect from '#lib/TagSelect.svelte';
  import AmountInput from '#lib/AmountInput.svelte';
  import ReceiptImport from '#lib/ReceiptImport.svelte';
  import ReceiptPreview from '#lib/ReceiptPreview.svelte';
  import ReceiptViewer from '#lib/ReceiptViewer.svelte';
  import { cents } from '#lib/money.ts';
  import { inputCurrency, toCzk } from '#lib/currency.ts';
  import type { Expense, Tag, Payment } from '#lib/types.ts';
  import { allocate } from '#lib/money.ts';
  import { departureDate } from '#lib/dates.ts';
  let { data } = $props();
  let tab = $state('expenses'),
    filter = $state('all'),
    search = $state('');
  let modal = $state(''),
    busy = $state(false),
    message = $state(''),
    notice = $state('');
  let expenseTags = $state<string[]>([]);
  let expenseCurrency = $state('CZK'),
    paymentCurrency = $state('CZK'),
    choiceCurrency = $state('CZK');
  let pendingPayment = $state<Payment | null>(null);
  let editing = $state<Expense | null>(null),
    selected = $state<Expense | null>(null),
    editingTag = $state<Tag | null>(null);
  let kind = $state('product'),
    expenseAmount = $state(''),
    nightly = $state(false),
    choiceMode = $state('default'),
    choiceExtra = $state('');
  let paymentFrom = $state(''),
    paymentAmount = $state('');
  let viewedReceipt = $state<{ src: string; mime: string; name: string } | null>(null);
  let memberUsername = $state('');
  let settingsArrival = $state('');
  const owner = $derived(data.session.role === 'owner');
  const total = $derived(data.expenses.reduce((s, e) => s + e.amount, 0));
  const mine = $derived(data.ledger.find((r) => r.id === data.session.member_id)!);
  const outstanding = $derived(data.ledger.reduce((s, e) => s + Math.max(0, e.net), 0));
  const visible = $derived(
    data.expenses.filter(
      (e) =>
        (filter === 'all' || (filter === 'receipt' ? !!e.receipt_id : e.kind === filter)) &&
        `${e.title} ${e.note} ${data.tags
          .filter((t) => (e.tag_ids ?? (e.tag_id ? [e.tag_id] : [])).includes(t.id))
          .map((t) => t.name)
          .join(' ')}`
          .toLowerCase()
          .includes(search.toLowerCase())
    )
  );
  const current = $derived(
    selected ? data.expenses.find((e) => e.id === selected?.id) || selected : null
  );
  const shares = $derived(
    current ? allocate(current, data.members, data.tags) : new Map<string, number>()
  );
  const today = new Date().toISOString().slice(0, 10);
  const money = (n: number) =>
    new Intl.NumberFormat(data.trip.currency === 'CZK' ? 'cs-CZ' : 'en', {
      style: 'currency',
      currency: data.trip.currency,
      minimumFractionDigits: 2
    }).format(n / 100);
  const signedMoney = (amount: number) =>
    amount === 0 ? money(0) : `${amount > 0 ? '+' : '−'}${money(Math.abs(amount))}`;
  const person = (id: string) => data.members.find((m) => m.id === id)!;
  const dateRange = $derived.by(() => {
    const start = new Date(`${data.trip.start}T12:00:00`),
      end = new Date(start);
    end.setDate(end.getDate() + data.trip.nights);
    return `${start.toLocaleDateString('en', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  });
  function open(name: string) {
    if (name === 'settings') settingsArrival = data.trip.start;
    message = '';
    modal = name;
  }
  function addExpense(type = 'product') {
    editing = null;
    expenseTags = [];
    kind = type;
    expenseAmount = '';
    expenseCurrency = 'CZK';
    nightly = false;
    open('expense');
  }
  function editExpense(e: Expense) {
    editing = e;
    expenseTags = [...(e.tag_ids ?? (e.tag_id ? [e.tag_id] : []))];
    kind = e.kind;
    expenseAmount = ((e.input_amount ?? e.amount) / 100).toFixed(2);
    expenseCurrency = e.input_currency ?? 'CZK';
    nightly = !!e.input_nightly;
    open('expense');
  }
  function viewExpense(e: Expense) {
    selected = e;
    syncChoice(data.session.member_id!, e);
    open('detail');
  }
  function syncChoice(member: string, e = current) {
    const c = e?.choices.find((c) => c.member_id === member);
    choiceCurrency = c?.input_currency ?? 'CZK';
    choiceMode = c?.mode || 'default';
    const extra = c?.input_extra ?? c?.extra;
    choiceExtra = extra ? String(extra / 100) : '';
  }
  function recordPayment(from = '', amount = 0) {
    paymentFrom = from || data.members.find((m) => m.id !== data.session.member_id)?.id || '';
    paymentAmount = amount ? String(amount / 100) : '';
    paymentCurrency = 'CZK';
    open('payment');
  }
  function newReceipt() {
    open('receipt');
  }
  const submit: SubmitFunction = () => {
    busy = true;
    message = '';
    return async ({ result, update }) => {
      busy = false;
      if (result.type === 'failure') message = String(result.data?.error || 'Could not save.');
      else if (result.type === 'success') {
        await refreshAll();
        if (modal !== 'detail' && modal !== 'tags') modal = '';
        notice = 'Saved';
        setTimeout(() => (notice = ''), 2400);
      } else await update();
    };
  };
  function czkPreview(value: string, currency: string, nights = 1) {
    try {
      return toCzk(
        cents(value || '0'),
        inputCurrency(currency),
        data.exchangeRate?.rate ?? null,
        nights
      );
    } catch {
      return 0;
    }
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      notice = 'Trip link copied';
      setTimeout(() => (notice = ''), 2500);
    } catch {
      notice = 'Copy the trip URL from your address bar.';
    }
  }
  function exportTransfers() {
    const cell = (s: string) =>
      '"' + (/^[=+@\-]/.test(s) ? "'" : '') + s.replaceAll('"', '""') + '"';
    const rows = [
      ['From', 'To', `Amount (${data.trip.currency})`, 'Status'],
      ...data.settlement.transfers.map((t) => [
        person(t.from).name,
        person(t.to).name,
        (t.amount / 100).toFixed(2),
        'Unpaid'
      ]),
      ...data.payments.map((p) => [
        person(p.from_id).name,
        person(p.to_id).name,
        (p.amount / 100).toFixed(2),
        'Paid'
      ])
    ];
    const url = URL.createObjectURL(
      new Blob([rows.map((r) => r.map(cell).join(',')).join('\r\n')], {
        type: 'text/csv;charset=utf-8'
      })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'housik-settlements.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<svelte:head><title>{data.trip.name} · Housik</title></svelte:head>
<div class="app-shell">
  <aside class="sidebar">
    <a href="/" class="brand">Housik</a>
    <a href="/" class="back-link"><ArrowLeft size={15} /> All trips</a>
    <nav aria-label="Trip">
      <button class:active={tab === 'expenses'} onclick={() => (tab = 'expenses')}
        ><LayoutGrid size={18} />Expenses</button
      ><button class:active={tab === 'people'} onclick={() => (tab = 'people')}
        ><Users size={18} />People</button
      ><button class:active={tab === 'receipts'} onclick={() => (tab = 'receipts')}
        ><ReceiptText size={18} />Receipts</button
      ><button class:active={tab === 'settle'} onclick={() => (tab = 'settle')}
        ><Wallet size={18} />Settle up{#if outstanding > 0}<span class="nav-dot"
          ></span>{/if}</button
      >
    </nav>
    <div class="sidebar-bottom">
      <div class="profile">
        <NameBubble name={data.session.user.name} color={0} />
        <form method="POST" action="?/logout">
          <button class="icon-btn" aria-label="Sign out"><LogOut size={16} /></button>
        </form>
      </div>
    </div>
  </aside>
  <main class="trip-main">
    <div class="mobile-bar">
      <a href="/" class="back-link"><ArrowLeft size={15} />Trips</a>
      <form method="POST" action="?/logout">
        <button class="icon-btn" aria-label="Sign out"><LogOut size={17} /></button>
      </form>
    </div>
    <header class="trip-heading">
      <div class="trip-title-row">
        <h1>{data.trip.name}</h1>
        {#if owner}<button
            class="icon-btn"
            aria-label="Trip settings"
            onclick={() => open('settings')}><Settings2 size={20} /></button
          >{/if}
      </div>
      <div class="trip-meta-row">
        <p class="trip-subtitle">
          <span><CalendarDays size={16} />{dateRange}</span><span class="dot-sep">·</span><span
            >{data.trip.nights} nights</span
          >{#if data.trip.house || data.trip.location_url}<span class="dot-sep">·</span
            >{#if data.trip.location_url}<a
                class="location-link"
                href={data.trip.location_url}
                target="_blank"
                rel="noopener noreferrer"
                >{data.trip.house || 'Location'}<ArrowUpRight size={16} /></a
              >{:else}<span>{data.trip.house}</span>{/if}{/if}
        </p>
        <div class="name-list">
          {#each data.members as m}<NameBubble name={m.name} color={m.color} />{/each}
        </div>
      </div>
    </header>
    <section class="stats" aria-label="Trip totals">
      <div class="stat">
        <div class="stat-label">Total</div>
        <strong>{money(total)}</strong>
      </div>
      <div class="stat">
        <div class="stat-label">{mine.net > 0 ? 'You receive' : 'You pay'}</div>
        <strong class:positive={mine.net > 0} class:negative={mine.net < 0}
          >{signedMoney(mine.net)}</strong
        >
      </div>
      <button class="stat balance-stat" onclick={() => (tab = 'settle')}
        ><div class="stat-label">
          Settle
          <ArrowUpRight size={20} />
        </div>
      </button>
    </section>
    <div class="mobile-tabs">
      <button class:active={tab === 'expenses'} onclick={() => (tab = 'expenses')}>Expenses</button
      ><button class:active={tab === 'people'} onclick={() => (tab = 'people')}>People</button
      ><button class:active={tab === 'receipts'} onclick={() => (tab = 'receipts')}>Receipts</button
      ><button class:active={tab === 'settle'} onclick={() => (tab = 'settle')}>Settle up</button>
    </div>
    {#if tab === 'expenses'}
      <div class="content-grid">
        <section class="expenses-section">
          <div class="section-heading">
            <div>
              <h2>Expenses</h2>
            </div>
            {#if owner}<button class="btn primary" onclick={() => addExpense()}
                ><Plus size={16} />Add expense</button
              >{/if}
          </div>
          <div class="expense-toolbar">
            <div class="filters" aria-label="Expense type">
              {#each [['all', 'All'], ['rent', 'Stay'], ['product', 'Groceries'], ['other', 'Extras']] as [value, label]}<button
                  class:active={filter === value}
                  onclick={() => (filter = value)}>{label}</button
                >{/each}
            </div>
            <div class="toolbar-right">
              {#if owner}<button
                  class="icon-btn"
                  aria-label="Tags"
                  title="Tags"
                  onclick={() => {
                    editingTag = null;
                    open('tags');
                  }}><TagIcon size={17} /></button
                >{/if}<label class="search-box"
                ><Search size={16} /><input
                  aria-label="Search expenses"
                  placeholder="Search"
                  bind:value={search}
                /></label
              >
            </div>
          </div>
          <div class="expense-table">
            <div class="table-labels">
              <span>EXPENSE</span><span>PAID BY</span><span>AMOUNT</span><span></span>
            </div>
            {#each visible as expense}<button
                class="expense-row"
                onclick={() => viewExpense(expense)}
                ><span class="expense-info"
                  ><span class="expense-icon {expense.kind}"
                    >{#if expense.kind === 'rent'}<House
                        size={21}
                        strokeWidth={1.6}
                      />{:else if expense.kind === 'other'}<Car
                        size={21}
                        strokeWidth={1.6}
                      />{:else}<ShoppingBasket size={21} strokeWidth={1.6} />{/if}</span
                  ><span class="expense-name"
                    ><strong>{expense.title}</strong><span class="expense-meta"
                      >{#if expense.receipt_id}<ReceiptText
                          size={11}
                        />{/if}{#if expense.tag_ids?.length}{#each expense.tag_ids as tag}<span
                            class="tag-pill">{data.tags.find((t) => t.id === tag)?.name}</span
                          >{/each}{/if}{#if expense.kind === 'rent'}<span
                          >{data.trip.nights} nights · {money(
                            Math.round(expense.amount / data.trip.nights)
                          )} / night</span
                        >{:else if !expense.tag_ids?.length}{expense.note ||
                          ''}{/if}{#if expense.choices.length}<span class="custom-share"
                          >Custom split</span
                        >{/if}</span
                    ></span
                  ></span
                ><span class="paid-by"
                  ><NameBubble
                    name={person(expense.payer_id).name}
                    color={person(expense.payer_id).color}
                  /></span
                ><strong class="expense-total">{money(expense.amount)}</strong><ChevronRight
                  size={16}
                  class="muted"
                /></button
              >{:else}<div class="empty-state">
                <ShoppingBasket size={31} strokeWidth={1.2} />
                <h3>{search ? 'No matches' : 'No expenses'}</h3>
              </div>{/each}
          </div>
        </section>
      </div>
    {:else if tab === 'people'}
      <section>
        <div class="section-heading">
          <div>
            <h2>People</h2>
          </div>
          {#if owner}<button
              class="btn primary"
              onclick={() => {
                memberUsername = '';
                open('invite');
              }}><Plus size={16} />Invite</button
            >{/if}
        </div>
        <div class="people-grid">
          {#each data.ledger as row}<article class="person-card">
              <div class="person-card-top">
                <NameBubble name={person(row.id).name} color={person(row.id).color} />
                <span class="person-status" class:positive={row.net > 0}
                  >{row.net === 0 ? 'All square' : row.net > 0 ? 'Gets back' : 'Owes'}</span
                >
              </div>
              <strong class="person-net" class:positive={row.net > 0} class:negative={row.net < 0}
                >{signedMoney(row.net)}</strong
              >
              <div class="person-details">
                <span
                  >Share<strong class:negative={row.share > 0}>{signedMoney(-row.share)}</strong
                  ></span
                ><span
                  >Purchases paid<strong class:positive={row.spent > 0}
                    >{signedMoney(row.spent)}</strong
                  ></span
                ><span
                  >Transfers sent<strong class:positive={row.sent > 0}
                    >{signedMoney(row.sent)}</strong
                  ></span
                ><span
                  >Received<strong class:negative={row.received > 0}
                    >{signedMoney(-row.received)}</strong
                  ></span
                >
              </div>
            </article>{/each}
        </div>
      </section>
    {:else if tab === 'settle'}
      <section>
        <div class="section-heading">
          <div>
            <h2>Settle up</h2>
          </div>
          <div class="button-group">
            <button class="btn secondary" onclick={exportTransfers}
              ><Download size={16} /><span class="hide-small">Export</span></button
            >{#if data.members.length > 1}<button
                class="btn primary"
                onclick={() => recordPayment()}><Plus size={16} />Payment</button
              >{/if}
          </div>
        </div>
        <div class="settlement-grid">
          <div class="panel">
            <div class="panel-title">
              <h3>Unpaid</h3>
            </div>
            {#each data.settlement.transfers as t}<div class="transfer-row">
                <div class="transfer-people">
                  <NameBubble name={person(t.from).name} color={person(t.from).color} /><ArrowRight
                    size={18}
                  /><NameBubble name={person(t.to).name} color={person(t.to).color} />
                </div>
                <strong
                  class:negative={t.from === data.session.member_id}
                  class:positive={t.to === data.session.member_id}
                  >{t.from === data.session.member_id
                    ? signedMoney(-t.amount)
                    : t.to === data.session.member_id
                      ? signedMoney(t.amount)
                      : money(t.amount)}</strong
                >{#if t.to === data.session.member_id}<button
                    class="btn secondary compact"
                    onclick={() => recordPayment(t.from, t.amount)}
                    ><Check size={14} />Confirm received</button
                  >{/if}
              </div>{:else}<div class="empty-state success-state">
                <CircleCheck size={42} strokeWidth={1.3} />
                <h3>All square.</h3>
              </div>{/each}
          </div>
          <div class="panel">
            <div class="panel-title">
              <h3>Paid</h3>
              <CircleCheck size={18} class="positive" />
            </div>
            {#each data.payments as p}<div class="payment-row">
                <span class="payment-check"><Check size={15} /></span>
                <div class="payment-details">
                  <div class="payment-parties">
                    <NameBubble
                      name={person(p.from_id).name}
                      color={person(p.from_id).color}
                    /><ArrowRight size={18} /><NameBubble
                      name={person(p.to_id).name}
                      color={person(p.to_id).color}
                    />
                  </div>
                  <span class="payment-note">{p.note || p.date}</span>
                </div>
                <strong class="positive">{signedMoney(p.amount)}</strong
                >{#if p.to_id === data.session.member_id}<button
                    class="icon-btn payment-undo"
                    type="button"
                    aria-label="Undo payment"
                    title="Undo payment"
                    disabled={busy}
                    onclick={() => {
                      pendingPayment = p;
                      open('undo');
                    }}><X size={15} /></button
                  >{/if}
              </div>{:else}<div class="empty-state small-empty">
                <Wallet size={28} strokeWidth={1.3} />
                <p>No payments</p>
              </div>{/each}
          </div>
        </div>
        {#if message && !modal}<p class="form-error" role="alert">{message}</p>{/if}
      </section>
    {:else if tab === 'receipts'}
      <section>
        <div class="section-heading">
          <div>
            <h2>Receipts</h2>
          </div>
          {#if owner}<button class="btn primary" onclick={newReceipt}
              ><Upload size={16} />Add receipt</button
            >{/if}
        </div>
        {#if data.receipts.length}<div class="receipt-grid">
            {#each data.receipts as receipt}<article class="receipt-card">
                <ReceiptPreview
                  src={`/trip/${data.trip.id}/receipt/${receipt.id}`}
                  mime={receipt.mime}
                  name={receipt.merchant}
                  onEnlarge={() =>
                    (viewedReceipt = {
                      src: `/trip/${data.trip.id}/receipt/${receipt.id}`,
                      mime: receipt.mime,
                      name: receipt.merchant
                    })}
                />
                <div class="receipt-card-top">
                  <span class="expense-icon product"><ReceiptText size={24} /></span><span
                    class="badge"
                    >{data.expenses.filter((e) => e.receipt_id === receipt.id).length} items</span
                  >
                </div>
                <h3>{receipt.merchant}</h3>
                <p class="receipt-author">
                  Uploaded by <NameBubble
                    name={person(receipt.uploader_id).name}
                    color={person(receipt.uploader_id).color}
                  />
                </p>
                <div class="receipt-card-bottom">
                  <strong
                    >{money(
                      data.expenses
                        .filter((e) => e.receipt_id === receipt.id)
                        .reduce((s, e) => s + e.amount, 0)
                    )}</strong
                  ><a
                    class="text-btn"
                    href="/trip/{data.trip.id}/receipt/{receipt.id}"
                    target="_blank"
                    rel="noreferrer">Original <ArrowUpRight size={15} /></a
                  >
                </div>
                <button
                  class="receipt-items-link text-btn"
                  onclick={() => {
                    tab = 'expenses';
                    filter = 'receipt';
                    search = receipt.merchant;
                  }}>View items <ArrowRight size={14} /></button
                >
              </article>{/each}
          </div>{:else}<div class="panel empty-state receipt-empty">
            <ReceiptText size={45} strokeWidth={1.1} />
            <h3>No receipts</h3>
          </div>{/if}
      </section>
    {/if}
  </main>
</div>
{#if notice}<Toast message={notice} layerKey={modal} />{/if}

<Modal
  onClose={() => (modal = '')}
  open={modal === 'expense'}
  title={editing ? 'Edit expense' : 'Add expense'}
>
  <form method="POST" action="?/expense" use:enhance={submit} class="stack">
    {#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
    <div class="segmented">
      {#each [['rent', 'Stay'], ['product', 'Groceries'], ['other', 'Extra']] as [v, l]}<button
          type="button"
          class:active={kind === v}
          onclick={() => {
            kind = v;
            nightly = false;
          }}>{l}</button
        >{/each}
    </div>
    <input type="hidden" name="kind" value={kind} />
    <label>Name<input name="title" value={editing?.title || ''} required maxlength="100" /></label>
    <AmountInput
      bind:value={expenseAmount}
      bind:currency={expenseCurrency}
      label={nightly ? 'Per night' : 'Amount'}
      rate={data.exchangeRate?.rate ?? null}
    />
    <input type="hidden" name="nightly" value={String(nightly)} />
    {#if kind === 'rent'}<div class="rent-calculator">
        <label class="checkbox"
          ><input type="checkbox" bind:checked={nightly} /> Amount per night</label
        ><span class="rent-summary"
          ><span>{data.trip.nights} nights</span><span class="rent-total"
            ><strong
              >{money(
                czkPreview(expenseAmount, expenseCurrency, nightly ? data.trip.nights : 1)
              )}</strong
            > total</span
          ></span
        >
      </div>{/if}
    <div class="form-grid">
      <label
        >Paid by<select
          name="payer"
          value={editing?.payer_id || data.session.member_id || data.members[0].id}
        >
          {#each data.members as m}<option value={m.id}>{m.name}</option>{/each}
        </select></label
      >
      <label>Date<input type="date" name="date" value={editing?.date || today} required /></label>
    </div>
    <TagSelect tags={data.tags} bind:selected={expenseTags} />
    <label>Note<input name="note" value={editing?.note || ''} maxlength="300" /></label>
    {#if message}<p class="form-error" role="alert">{message}</p>{/if}
    <div class="modal-actions">
      <button class="btn secondary" type="button" onclick={() => (modal = '')}>Cancel</button
      ><button class="btn primary" disabled={busy}
        >{busy ? 'Saving…' : editing ? 'Save changes' : 'Add expense'}<Plus size={16} /></button
      >
    </div>
  </form>
</Modal>
<Modal onClose={() => (modal = '')} open={modal === 'detail'} title={current?.title || 'Expense'}>
  {#if current}<div class="detail-total">
      <strong>{money(current.amount)}</strong>
      <div class="expense-payment">
        <span>Paid by</span><NameBubble
          name={person(current.payer_id).name}
          color={person(current.payer_id).color}
        /><span>{current.date}</span>
      </div>
      {#if current.note}<p>{current.note}</p>{/if}
    </div>
    <div class="split-list">
      <h3>Shares</h3>
      {#each data.members as m}<div class="split-person">
          <NameBubble
            name={m.name}
            color={m.color}
          />{#if current.choices.find((c) => c.member_id === m.id)?.mode === 'full'}<span
              class="tag-pill">Full share</span
            >{:else if current.choices.find((c) => c.member_id === m.id)?.mode === 'extra'}<span
              class="tag-pill">Extra</span
            >{/if}<strong class:muted={!shares.get(m.id)}>{money(shares.get(m.id) || 0)}</strong>
        </div>{/each}
    </div>
    <form method="POST" action="?/choice" use:enhance={submit} class="stack choice-form">
      <input type="hidden" name="expense" value={current.id} />
      <div class="form-grid">
        <label
          >Participation<select name="mode" bind:value={choiceMode}
            ><option value="default">Default</option><option value="share">Include me</option
            ><option value="exclude">Exclude me</option><option value="full"
              >Cover the full cost</option
            ><option value="extra">Extra contribution</option></select
          ></label
        >{#if choiceMode === 'extra'}
          <AmountInput
            name="extra"
            label="Extra"
            bind:value={choiceExtra}
            bind:currency={choiceCurrency}
            rate={data.exchangeRate?.rate ?? null}
          />
        {/if}
      </div>
      {#if message}<p class="form-error" role="alert">{message}</p>{/if}<button
        class="btn primary full"
        disabled={busy}>Update share <Check size={16} /></button
      >
    </form>
    {#if owner}<div class="detail-actions">
        <button class="text-btn" onclick={() => editExpense(current!)}
          ><Pencil size={14} />Edit expense</button
        >
        <form
          method="POST"
          action="?/deleteExpense"
          use:enhance={() => {
            busy = true;
            return async ({ result, update }) => {
              busy = false;
              if (result.type === 'success') {
                modal = '';
                await refreshAll();
              } else await update();
            };
          }}
        >
          <input type="hidden" name="id" value={current.id} /><button
            class="text-btn danger"
            disabled={busy}><Trash2 size={14} />Delete</button
          >
        </form>
      </div>{/if}{/if}
</Modal>
<Modal onClose={() => (modal = '')} open={modal === 'invite'} title="Invite"
  ><form method="POST" action="?/member" use:enhance={submit} class="stack">
    <label>Name<input name="name" bind:value={memberUsername} required maxlength="20" /></label>
    {#if message}<p class="form-error" role="alert">{message}</p>{/if}<button
      class="btn primary full"
      disabled={busy}>Invite to trip <Plus size={16} /></button
    ><button class="btn secondary full" type="button" onclick={copyLink}
      ><Copy size={15} />Copy trip link</button
    >
  </form></Modal
>
<Modal onClose={() => (modal = '')} open={modal === 'payment'} title="Confirm received"
  ><form method="POST" action="?/payment" use:enhance={submit} class="stack">
    <AmountInput
      bind:value={paymentAmount}
      bind:currency={paymentCurrency}
      rate={data.exchangeRate?.rate ?? null}
    />
    <div class="form-grid">
      <label
        >From<select name="from" bind:value={paymentFrom}
          >{#each data.members.filter((m) => m.id !== data.session.member_id) as m}<option
              value={m.id}>{m.name}</option
            >{/each}</select
        ></label
      >
      <input type="hidden" name="to" value={data.session.member_id} />
      <div class="received-by">
        <span>Received by</span><NameBubble
          name={data.session.user.name}
          color={person(data.session.member_id!).color}
        />
      </div>
    </div>
    <div class="form-grid">
      <label>Date<input type="date" name="date" value={today} required /></label>
    </div>
    <label>Note<input name="note" maxlength="200" /></label>
    {#if message}<p class="form-error" role="alert">{message}</p>{/if}<button
      class="btn primary full"
      disabled={busy}>Confirm received <Check size={16} /></button
    >
  </form></Modal
>
<Modal onClose={() => (modal = '')} open={modal === 'tags'} title="Tags"
  ><div class="tag-list">
    {#each data.tags as t}<button
        class:chosen={editingTag?.id === t.id}
        onclick={() => {
          editingTag = t;
          message = '';
        }}
        ><span><TagIcon size={15} /><strong>{t.name}</strong></span><span
          >{#each t.members as member}<NameBubble
              name={person(member).name}
              color={person(member).color}
            />{/each}
          <Pencil size={13} /></span
        ></button
      >{/each}
  </div>
  <form
    method="POST"
    action="?/tag"
    use:enhance={() => {
      busy = true;
      message = '';
      return async ({ result, update }) => {
        busy = false;
        if (result.type === 'success') {
          editingTag = null;
          await refreshAll();
        } else if (result.type === 'failure') message = String(result.data?.error);
        else await update();
      };
    }}
    class="stack"
  >
    {#key editingTag?.id}<input type="hidden" name="id" value={editingTag?.id || ''} /><label
        >{editingTag ? 'Edit tag' : 'New tag'}<input
          name="name"
          value={editingTag?.name || ''}
          required
          maxlength="40"
        /></label
      >
      <fieldset class="member-checkboxes">
        <legend>Shared by</legend>{#each data.members as m}<label class="checkbox"
            ><input
              type="checkbox"
              name="members"
              value={m.id}
              checked={!editingTag || editingTag.members.includes(m.id)}
            /><NameBubble name={m.name} color={m.color} /></label
          >{/each}
      </fieldset>{/key}{#if message}<p class="form-error" role="alert">{message}</p>{/if}
    <div class="modal-actions">
      {#if editingTag}<button
          type="button"
          class="btn secondary"
          onclick={() => (editingTag = null)}>New tag</button
        >{/if}<button class="btn primary" disabled={busy}
        >{editingTag ? 'Save tag' : 'Create tag'}<Check size={15} /></button
      >
    </div>
  </form>
  {#if editingTag}<form
      method="POST"
      action="?/deleteTag"
      use:enhance={() =>
        ({ result, update }) => {
          if (result.type === 'success') {
            editingTag = null;
            void refreshAll();
          } else void update();
        }}
    >
      <input type="hidden" name="id" value={editingTag.id} /><button class="text-btn danger"
        ><Trash2 size={14} />Remove tag</button
      >
    </form>{/if}</Modal
>
<Modal onClose={() => (modal = '')} open={modal === 'settings'} title="Trip"
  ><form method="POST" action="?/settings" use:enhance={submit} class="stack">
    <label>Trip name<input name="name" value={data.trip.name} required maxlength="60" /></label
    ><label>House / place<input name="house" value={data.trip.house} maxlength="100" /></label>
    <label
      >Location link<input
        type="url"
        name="location_url"
        value={data.trip.location_url}
        maxlength="2048"
      /></label
    >
    <div class="form-grid">
      <label>Arrival<input type="date" name="start" bind:value={settingsArrival} required /></label
      ><label
        >Departure<input
          name="departure"
          type="date"
          min={settingsArrival ? departureDate(settingsArrival, 1) : undefined}
          max={settingsArrival ? departureDate(settingsArrival, 365) : undefined}
          value={departureDate(data.trip.start, data.trip.nights)}
          required
        /></label
      >
    </div>
    {#if message}<p class="form-error" role="alert">{message}</p>{/if}<button
      class="btn primary full"
      disabled={busy}>Save trip <Check size={16} /></button
    >
  </form></Modal
>
<Modal onClose={() => (modal = '')} open={modal === 'undo'} title="Undo received payment?">
  {#if pendingPayment}<form method="POST" action="?/undoPayment" use:enhance={submit} class="stack">
      <input type="hidden" name="id" value={pendingPayment.id} />
      <div class="payment-parties">
        <NameBubble
          name={person(pendingPayment.from_id).name}
          color={person(pendingPayment.from_id).color}
        /><ArrowRight size={18} /><NameBubble
          name={person(pendingPayment.to_id).name}
          color={person(pendingPayment.to_id).color}
        />
      </div>
      <strong class="positive">{signedMoney(pendingPayment.amount)}</strong>
      {#if message}<p class="form-error" role="alert">{message}</p>{/if}
      <div class="modal-actions">
        <button type="button" class="btn secondary" onclick={() => (modal = '')}>Cancel</button
        ><button class="btn primary" disabled={busy}>Undo payment</button>
      </div>
    </form>{/if}
</Modal>
<ReceiptImport
  open={modal === 'receipt'}
  tripId={data.trip.id}
  members={data.members}
  rate={data.exchangeRate?.rate ?? null}
  onClose={() => (modal = '')}
  onSaved={async () => {
    await refreshAll();
    notice = 'Saved';
    setTimeout(() => (notice = ''), 2400);
  }}
/>
<ReceiptViewer receipt={viewedReceipt} onClose={() => (viewedReceipt = null)} />
