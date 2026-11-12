<script lang="ts">
  import { ChevronDown } from '@lucide/svelte';
  import type { Tag, Member } from './types';
  import NameBubble from './NameBubble.svelte';
  let {
    tags,
    members,
    selected = $bindable<string[]>([]),
    selectedMembers = $bindable<string[]>([])
  }: { tags: Tag[]; members: Member[]; selected?: string[]; selectedMembers?: string[] } = $props();
  const id = $props.id();
  const chosenPeople = $derived(members.filter((member) => selectedMembers.includes(member.id)));
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
<input type="hidden" name="share_explicit" value="true" />
<input type="hidden" name="member_ids" value={JSON.stringify(selectedMembers)} />
<div class="people-select" bind:this={root}>
  <span class="select-label" id={`${id}-label`}>Share with</span>
  <button
    type="button"
    class="people-trigger"
    aria-labelledby={`${id}-label`}
    aria-expanded={open}
    aria-controls={`${id}-options`}
    onclick={() => (open = !open)}
    onkeydown={(event) => {
      if (event.key === 'Escape') open = false;
    }}
  >
    <span class="selected-people">
      {#each chosen as tag}<span class="tag-pill">{tag.name}</span>{/each}
      {#each chosenPeople as member}<NameBubble name={member.name} color={member.color} />{/each}
      {#if !chosenPeople.length && !chosen.length}Everyone{/if}</span
    ><ChevronDown size={20} />
  </button>
  <fieldset id={`${id}-options`} class="people-options" class:open aria-label="Share with">
    <div class="people-options-scroll native-scroll">
      <label class="checkbox"
        ><input
          type="checkbox"
          onkeydown={escape}
          checked={selected.length === 0 && selectedMembers.length === 0}
          onchange={() => {
            selected = [];
            selectedMembers = [];
          }}
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
      {#each members as member}<label class="checkbox">
          <input
            type="checkbox"
            onkeydown={escape}
            value={member.id}
            bind:group={selectedMembers}
          />
          <NameBubble name={member.name} color={member.color} />
        </label>{/each}
    </div>
  </fieldset>
</div>
