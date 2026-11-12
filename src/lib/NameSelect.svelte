<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ChevronDown } from '@lucide/svelte';
  import NameBubble from './NameBubble.svelte';
  let {
    options,
    value = $bindable('')
  }: {
    options: { name: string; color: number }[];
    value?: string;
  } = $props();
  const id = $props.id();
  let root: HTMLDivElement, field: HTMLDivElement, input: HTMLInputElement, popup: HTMLDivElement;
  let open = $state(false),
    showAll = $state(false),
    active = $state(-1);
  let left = $state(0),
    top = $state(0),
    width = $state(240),
    maxHeight = $state(240);
  const matches = $derived(
    options.filter(
      (option) =>
        showAll || option.name.toLocaleLowerCase().includes(value.trim().toLocaleLowerCase())
    )
  );
  const shown = $derived(open && matches.length > 0);
  function place() {
    if (!shown || !field || !popup) return;
    const rect = field.getBoundingClientRect();
    width = Math.min(Math.max(rect.width, 240), innerWidth - 24);
    left = Math.max(12, Math.min(rect.left, innerWidth - width - 12));
    const below = innerHeight - rect.bottom - 12,
      above = rect.top - 12;
    const upwards = below < 180 && above > below;
    maxHeight = Math.max(80, Math.min(240, (upwards ? above : below) - 6));
    const height = Math.min(popup.scrollHeight, maxHeight);
    top = upwards ? Math.max(12, rect.top - height - 6) : rect.bottom + 6;
  }
  $effect(() => {
    if (!popup) return;
    if (shown) {
      popup.showPopover();
      void tick().then(place);
    } else popup.hidePopover();
  });
  $effect(() => {
    value;
    showAll;
    if (shown) void tick().then(place);
  });
  onMount(() => {
    document.addEventListener('scroll', place, true);
    return () => document.removeEventListener('scroll', place, true);
  });
  function choose(name: string) {
    value = name;
    open = false;
    showAll = false;
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
      const forward = event.key === 'ArrowDown';
      active = matches.length
        ? active < 0
          ? forward
            ? 0
            : matches.length - 1
          : (active + (forward ? 1 : -1) + matches.length) % matches.length
        : -1;
      void tick().then(() => popup.querySelector('.active')?.scrollIntoView({ block: 'nearest' }));
    } else if (event.key === 'Enter') {
      if (shown && active >= 0 && matches[active]) {
        event.preventDefault();
        choose(matches[active].name);
      } else open = false;
    } else if (event.key === 'Tab') open = false;
  }
</script>

<svelte:window
  onresize={place}
  onclick={(event) => {
    if (root && !root.contains(event.target as Node)) open = false;
  }}
/>
<div class="name-select" bind:this={root}>
  <label for={id}>Name</label>
  <div class="name-input" bind:this={field}>
    <input
      {id}
      name="name"
      autocomplete="off"
      role="combobox"
      required
      maxlength="20"
      bind:this={input}
      bind:value
      aria-autocomplete="list"
      aria-expanded={shown}
      aria-controls={`${id}-options`}
      aria-activedescendant={shown && active >= 0 ? `${id}-option-${active}` : undefined}
      onfocus={() => (open = true)}
      onclick={() => (open = true)}
      oninput={() => {
        open = true;
        showAll = false;
        active = -1;
      }}
      onkeydown={key}
    />
    <button
      type="button"
      aria-label="Choose name"
      onclick={() => {
        if (open) open = false;
        else {
          showAll = true;
          open = true;
          active = -1;
          input.focus();
        }
      }}><ChevronDown size={18} /></button
    >
  </div>
  <div
    class="name-options"
    id={`${id}-options`}
    bind:this={popup}
    popover="manual"
    role="listbox"
    aria-label="Trip names"
    style:left={`${left}px`}
    style:top={`${top}px`}
    style:width={`${width}px`}
    style:max-height={`${maxHeight}px`}
  >
    <div class="native-scroll" style:max-height={`${Math.max(0, maxHeight - 14)}px`}>
      {#each matches as option, index (`${option.name}-${index}`)}
        <button
          type="button"
          role="option"
          id={`${id}-option-${index}`}
          aria-selected={value === option.name}
          tabindex="-1"
          class:active={active === index}
          onmousedown={(event) => event.preventDefault()}
          onclick={() => choose(option.name)}
          onkeydown={key}
        >
          <NameBubble name={option.name} color={option.color} />
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .name-select {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .name-input {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    border: 1px solid #e3e3e3;
    border-radius: 8px;
    background: #fdfdfd;
  }
  .name-input:focus-within {
    outline: 3px solid #adadad22;
    border-color: #969696;
  }
  input {
    flex: 1;
    min-width: 24px;
    width: 24px;
    border: 0;
    background: transparent;
    box-shadow: none;
  }
  input:focus {
    outline: none;
  }
  .name-input > button {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 12px;
    min-height: 44px;
  }
  .name-input :global(.field-error) {
    flex-basis: 100%;
    margin: 0 12px 10px;
  }
  .name-options {
    position: fixed;
    inset: auto;
    margin: 0;
    padding: 6px;
    background: #fff;
    border: 1px solid #e3e3e3;
    border-radius: 9px;
    box-shadow: 0 8px 24px #0000001a;
    overflow: hidden;
  }
  .name-options button {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: 42px;
    padding: 6px;
    text-align: left;
    border-radius: 5px;
  }
  .name-options button.active,
  .name-options button:hover {
    background: #f3f3f3;
  }
  .name-options :global(.name-bubble) {
    min-width: 0;
    overflow-wrap: anywhere;
  }
</style>
