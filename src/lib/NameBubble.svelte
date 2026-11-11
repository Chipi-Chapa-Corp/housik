<script lang="ts">
  let { name, color = 0 }: { name: string; color?: number } = $props();
</script>

<span class="name-bubble color-{color % 6}">{name}</span>
