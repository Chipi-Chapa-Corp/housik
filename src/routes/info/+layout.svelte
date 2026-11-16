<script lang="ts">
  let { children } = $props();
</script>

<main class="information-page">
  {@render children()}
  <nav aria-label="Information">
    <a href="/">Open app</a>
    <a href="/info/about">About</a>
    <a href="/info/privacy">Privacy</a>
    <a href="/info/terms">Terms</a>
  </nav>
</main>

<style>
  .information-page {
    max-width: 740px;
    margin: 48px auto;
    padding: 28px;
    color: #343a40;
    line-height: 1.7;
  }
  .information-page :global(h1),
  .information-page :global(h2) {
    font-size: 1rem;
    margin: 24px 0 12px;
  }
  .information-page :global(p) {
    margin: 0 0 16px;
  }
  .information-page :global(a) {
    color: #344d69;
    text-decoration: underline;
  }
  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
    margin-top: 32px;
  }
  @media (max-width: 600px) {
    .information-page {
      margin: 16px auto;
      padding: 20px;
    }
  }
</style>
