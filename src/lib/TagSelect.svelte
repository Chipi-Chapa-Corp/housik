<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';
  import type { Tag } from './types';
  let { tags, selected = $bindable<string[]>([]) }: { tags: Tag[]; selected?: string[] } = $props();
  let open = $state(false);
  let root: HTMLDivElement;
  const chosen = $derived(tags.filter((tag) => selected.includes(tag.id)));
  function escape(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      open = false;
    }
  }
</script>

<svelte:window
  onclick={(event) => {
    if (root && !root.contains(event.target as Node)) open = false;
  }}
/>
<div class="people-select" bind:this={root}>
  <span class="select-label" id="expense-tags-label">Share with</span>
  <button
    type="button"
    class="people-trigger"
    aria-labelledby="expense-tags-label"
    aria-expanded={open}
    aria-controls="expense-tags-options"
    onclick={() => (open = !open)}
    onkeydown={(event) => {
      if (event.key === 'Escape') open = false;
    }}
  >
    <span class="selected-people"
      >{#each chosen as tag}<span class="tag-pill">{tag.name}</span>{:else}Everyone{/each}</span
    ><ChevronDown size={20} />
  </button>
  <fieldset id="expense-tags-options" class="people-options" class:open aria-label="Share with">
    <label class="checkbox"
      ><input
        type="checkbox"
        onkeydown={escape}
        checked={selected.length === 0}
        onchange={() => (selected = [])}
      />Everyone</label
    >
    {#each tags as tag}<label class="checkbox"
        ><input
          type="checkbox"
          onkeydown={escape}
          name="tag_ids"
          value={tag.id}
          bind:group={selected}
        /><span class="tag-pill">{tag.name}</span></label
      >{/each}
  </fieldset>
</div>
