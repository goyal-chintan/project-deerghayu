<script>
  import { location, push } from 'svelte-spa-router';
  import { _ } from 'svelte-i18n';

  $: tabs = [
    { path: '/dashboard',   icon: 'home',           label: 'Home'    },
    { path: '/',            icon: 'edit_note',      label: $_('nav.diary')  },
    { path: '/foods',       icon: 'restaurant',     label: $_('nav.foods')  },
    { path: '/planner',     icon: 'calendar_month', label: 'Planner' },
    { path: '/settings',    icon: 'menu',           label: 'More'    },
  ];

  $: activeIdx = (() => {
    const base = $location.split('?')[0];
    const idx = tabs.findIndex(t => t.path === base);
    if (idx >= 0) return idx;
    // Routes not surfaced as primary tabs (Nutrients, Grocery, Family,
    // Statistics, Goals, Profile…) are reachable via the overflow menu, so
    // reflect that by highlighting the "More" tab instead of falsely
    // marking "Home" active.
    return tabs.length - 1;
  })();

  function go(path) { push(path); }
</script>

<nav class="bottom-nav" role="navigation" aria-label="Main navigation">
  <!-- Sliding pill indicator -->
  <div
    class="nav-pill"
    style="left: calc({(activeIdx / tabs.length * 100).toFixed(2)}%); width: calc(100% / {tabs.length})"
  ></div>

  {#each tabs as tab, i}
    <button
      class="nav-tab"
      class:active={i === activeIdx}
      on:click={() => go(tab.path)}
      aria-label={tab.label}
      aria-current={i === activeIdx ? 'page' : undefined}
    >
      <span class="material-symbols-rounded nav-icon">{tab.icon}</span>
      <span class="nav-label">{tab.label}</span>
    </button>
  {/each}
</nav>

<style>
  .bottom-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: calc(var(--nav-h) + var(--safe-bottom));
    padding-bottom: var(--safe-bottom);
    background: var(--glass-surface);
    backdrop-filter: blur(24px) saturate(180%);
    -webkit-backdrop-filter: blur(24px) saturate(180%);
    border-top: 1px solid var(--border);
    display: flex;
    align-items: stretch;
    z-index: 50;
  }

  /* Sliding highlight pill */
  .nav-pill {
    position: absolute;
    top: 6px;
    left: 0; /* overridden by inline style */
    /* width overridden by inline style */
    height: calc(100% - 12px - var(--safe-bottom));
    background: linear-gradient(135deg, var(--accent-dim), rgba(79,255,176,0.22));
    border-radius: var(--radius-md);
    box-shadow: 0 0 16px var(--accent-dim);
    transition: left var(--dur-base) var(--ease-inout);
    pointer-events: none;
  }

  .nav-tab {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 8px 0 4px;
    position: relative;
    transition: color var(--dur-fast) var(--ease-out);
    color: var(--text-3);
    -webkit-tap-highlight-color: transparent;
  }
  .nav-tab.active  { color: var(--accent); }
  .nav-tab:active  { transform: scale(0.92); }

  .nav-icon {
    font-size: 22px;
    transition: transform var(--dur-fast) var(--ease-spring);
  }
  .nav-tab.active .nav-icon { transform: scale(1.1); }

  .nav-label {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
</style>
