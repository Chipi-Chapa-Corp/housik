<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { Check, ChevronDown, X } from '@lucide/svelte';
  import NameBubble from './NameBubble.svelte';
  import type { Member } from './types';

  let { members, selected, onchange, label = 'Share with' }: {
    members: Member[];
    selected: string[];
    onchange: (ids: string[]) => void;
    label?: string;
  } = $props();
  const id = $props.id();
  let root: HTMLDivElement, field: HTMLDivElement, input: HTMLInputElement, popup: HTMLDivElement;
  let open = $state(false), query = $state(''), active = $state(-1);
  let left = $state(0), top = $state(0), width = $state(240), maxHeight = $state(260);
  const chosen = $derived(members.filter((member) => selected.includes(member.id)));
  const matches = $derived(members.filter((member) => member.name.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())));
  const options = $derived(query ? matches : [{ id: '__all', name: 'Everyone', color: 0 }, ...matches]);

  function place() {
    if (!open || !field || !popup) return;
    const rect = field.getBoundingClientRect();
    width = Math.min(Math.max(rect.width, 240), innerWidth - 24);
    left = Math.max(12, Math.min(rect.left, innerWidth - width - 12));
    const below = innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const upwards = below < 180 && above > below;
    maxHeight = Math.max(80, Math.min(260, upwards ? above - 6 : below - 6));
    const height = Math.min(popup.scrollHeight, maxHeight);
    top = upwards ? Math.max(12, rect.top - height - 6) : rect.bottom + 6;
  }
  $effect(() => {
    if (!popup) return;
    if (open) {
      popup.showPopover();
      void tick().then(place);
    } else popup.hidePopover();
  });
  $effect(() => {
    selected;
    query;
    input?.setCustomValidity(selected.length ? '' : 'Select at least one person.');
    if (open) void tick().then(place);
  });
  onMount(() => {
    const scroll = () => place();
    document.addEventListener('scroll', scroll, true);
    return () => document.removeEventListener('scroll', scroll, true);
  });
  function choose(memberId: string) {
    if (memberId === '__all') onchange(selected.length === members.length ? [] : members.map((member) => member.id));
    else onchange(selected.includes(memberId) ? selected.filter((value) => value !== memberId) : [...selected, memberId]);
    query = '';
    active = -1;
    input.focus();
  }
  function key(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      open = false;
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open = true;
      active = options.length ? (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : -1;
    } else if (event.key === 'Enter' && open) {
      event.preventDefault();
      if (active >= 0 && options[active]) choose(options[active].id);
    } else if (event.key === 'Backspace' && !query && selected.length) {
      onchange(selected.slice(0, -1));
    } else if (event.key === 'Tab') open = false;
  }
</script>

<svelte:window
  onresize={place}
  onclick={(event) => { if (root && !root.contains(event.target as Node)) open = false; }}
/>
<div class="people-multiselect" bind:this={root}>
  <label for={id}>{label}</label>
  <div class="member-input" bind:this={field}>
    {#each chosen as member (member.id)}
      <span class="name-bubble member-chip color-{member.color % 6}" title={member.name}>
        <span class="chip-name">{member.name}</span>
        <button type="button" aria-label={`Remove ${member.name}`} onclick={() => onchange(selected.filter((value) => value !== member.id))}><X size={13} aria-hidden="true" /></button>
      </span>
    {/each}
    <input
      {id}
      bind:this={input}
      bind:value={query}
      role="combobox"
      autocomplete="off"
      aria-autocomplete="list"
      aria-expanded={open}
      aria-controls={`${id}-options`}
      aria-activedescendant={open && active >= 0 ? `${id}-option-${active}` : undefined}
      onfocus={() => (open = true)}
      oninput={() => { open = true; active = -1; }}
      onkeydown={key}
    />
    <button class="member-toggle" type="button" aria-label={`Choose ${label.toLowerCase()}`} onclick={() => { open = !open; if (open) input.focus(); }}><ChevronDown size={18} aria-hidden="true" /></button>
  </div>
  <div
    class="member-options"
    bind:this={popup}
    id={`${id}-options`}
    popover="manual"
    role="listbox"
    aria-label={label}
    aria-multiselectable="true"
    style:left={`${left}px`}
    style:top={`${top}px`}
    style:width={`${width}px`}
    style:max-height={`${maxHeight}px`}
  >
    {#each options as member, index (member.id)}
      {@const checked = member.id === '__all' ? selected.length === members.length : selected.includes(member.id)}
      <button type="button" role="option" id={`${id}-option-${index}`} aria-selected={checked} tabindex="-1" class:active={active === index}
        onmousedown={(event) => event.preventDefault()}
        onclick={() => choose(member.id)}
        onkeydown={key}
      >
        {#if member.id === '__all'}<span>Everyone</span>{:else}<NameBubble name={member.name} color={member.color} />{/if}
        {#if checked}<Check size={16} aria-hidden="true" />{/if}
      </button>
    {:else}<p>No matches</p>{/each}
  </div>
</div>

<style>
  .people-multiselect { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .member-input { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 48px; padding: 6px; border: 1px solid #e3e3e3; border-radius: 8px; background: #fdfdfd; min-width: 0; }
  .member-input:focus-within { outline: 3px solid #adadad22; border-color: #969696; }
  .member-chip { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 4px 6px; }
  .chip-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .member-chip button { display: inline-flex; align-items: center; justify-content: center; padding: 2px; flex-shrink: 0; }
  input { flex: 1; width: 24px; min-width: 24px; min-height: 28px; padding: 0 4px; background: transparent; border: 0; box-shadow: none; }
  input:focus { outline: none; }
  .member-toggle { display: flex; align-items: center; justify-content: center; padding: 0 2px; height: 28px; margin-left: auto; }
  .member-options { position: fixed; inset: auto; margin: 0; padding: 6px; border: 1px solid #e3e3e3; border-radius: 9px; background: #fff; color: #343434; box-shadow: 0 8px 24px #0000001a; overflow-y: auto; }
  .member-options button { display: flex; width: 100%; min-height: 42px; justify-content: space-between; align-items: center; gap: 8px; padding: 6px; text-align: left; border-radius: 5px; }
  .member-options button.active, .member-options button:hover { background: #f3f3f3; }
  .member-options :global(.name-bubble) { min-width: 0; overflow-wrap: anywhere; }
  .member-options p { padding: 8px; }
  .member-input :global(.field-error) { flex-basis: 100%; }
</style>
