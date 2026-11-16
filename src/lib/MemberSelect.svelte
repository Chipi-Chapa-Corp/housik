<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';
  import NameBubble from '#lib/NameBubble.svelte';
  import type { Member } from '#lib/types.ts';
  let {
    members,
    value = $bindable(''),
    name,
    label,
    disabled = false
  }: {
    members: Member[];
    value: string;
    name: string;
    label: string;
    disabled?: boolean;
  } = $props();
  const id = $props.id();
  const selected = $derived(members.find((member) => member.id === value));
  let trigger: HTMLButtonElement;
  let menu: HTMLDivElement;
  let expanded = $state(false);
  let active = $state(0);
  function close() {
    expanded = false;
    menu?.hidePopover();
  }
  function scrollActive() {
    const option = menu.children.item(active) as HTMLElement | null;
    if (!option) return;
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight)
      menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
  }
  function open() {
    if (disabled || !members.length) return;
    active = Math.max(
      0,
      members.findIndex((member) => member.id === value)
    );
    menu.showPopover();
    expanded = true;
    const bounds = trigger.getBoundingClientRect();
    const popup = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(12, Math.min(bounds.left, innerWidth - popup.width - 12))}px`;
    menu.style.top = `${
      bounds.bottom + popup.height + 6 <= innerHeight - 12
        ? bounds.bottom + 6
        : Math.max(12, bounds.top - popup.height - 6)
    }px`;
    scrollActive();
  }
  function choose(index: number) {
    value = members[index].id;
    close();
    trigger.focus();
  }
  function keydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!expanded) open();
      else {
        active =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? members.length - 1
              : (active + (event.key === 'ArrowDown' ? 1 : -1) + members.length) % members.length;
        scrollActive();
      }
    } else if ((event.key === 'Enter' || event.key === ' ') && expanded) {
      event.preventDefault();
      choose(active);
    } else if (event.key === 'Tab') close();
  }
  $effect(() => {
    if (disabled) close();
  });
</script>

<svelte:window
  onresize={close}
  onclick={(event) => {
    if (expanded && !trigger.contains(event.target as Node) && !menu.contains(event.target as Node))
      close();
  }}
/>
<input type="hidden" {name} {value} />
<button
  bind:this={trigger}
  type="button"
  role="combobox"
  class="name-bubble color-{(selected?.color ?? 0) % 6} member-picker"
  aria-label={label}
  aria-expanded={expanded}
  aria-controls={`${id}-options`}
  aria-activedescendant={expanded ? `${id}-option-${active}` : undefined}
  {disabled}
  onclick={() => (expanded ? close() : open())}
  onkeydown={keydown}
>
  <span>{selected?.name ?? ''}</span>{#if !disabled}<ChevronDown size={16} />{/if}
</button>
<div
  bind:this={menu}
  popover="manual"
  id={`${id}-options`}
  role="listbox"
  aria-label={label}
  class="member-options native-scroll"
  ontoggle={(event) => {
    expanded = event.newState === 'open';
  }}
>
  {#each members as member, index}
    <button
      type="button"
      role="option"
      id={`${id}-option-${index}`}
      aria-selected={value === member.id}
      class:active={active === index}
      tabindex="-1"
      onmouseenter={() => (active = index)}
      onclick={() => choose(index)}><NameBubble name={member.name} color={member.color} /></button
    >
  {/each}
</div>

<style>
  .member-picker {
    gap: 6px;
    min-width: 0;
    max-width: 100%;
    border: 0;
    text-align: center;
  }
  .member-picker :global(svg) {
    flex-shrink: 0;
  }
  .member-picker:disabled {
    opacity: 1;
    cursor: default;
  }
  .member-options {
    position: fixed;
    inset: auto;
    margin: 0;
    padding: 6px;
    width: max-content;
    max-width: calc(100vw - 24px);
    max-height: min(260px, 50dvh);
    border: 1px solid #d7dbe0;
    border-radius: 12px;
    background: #f1f2f4;
    color: #38414d;
    box-shadow: 0 8px 24px #30374018;
  }
  .member-options > button {
    display: flex;
    width: 100%;
    padding: 7px;
    border-radius: 8px;
    text-align: left;
  }
  .member-options > button.active {
    background: #e0e3e8;
  }
</style>
