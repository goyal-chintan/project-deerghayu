<script>
  import { onMount } from 'svelte';
  import { fade, slide } from 'svelte/transition';
  import { push } from 'svelte-spa-router';
  import { NtApi } from '../lib/api.js';
  import { generateGroceryList, groupByCategory, formatAmount } from '../lib/groceryList.js';

  // ── State ────────────────────────────────────────────────────────────────
  let groceryItems = [];
  let groupedItems = {};
  let loading = true;
  let checkedItems = {};
  let rangeMode = 'this-week'; // 'this-week' | 'next-week' | 'custom'
  let customStart = '';
  let customEnd = '';

  // ── Date helpers ─────────────────────────────────────────────────────────
  function getWeekMonday(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  function getWeekDates(mondayStr) {
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(mondayStr + 'T00:00:00');
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }

  function getDateRange() {
    const today = new Date();
    if (rangeMode === 'this-week') {
      const monday = getWeekMonday(today);
      return getWeekDates(monday);
    } else if (rangeMode === 'next-week') {
      const nextMonday = new Date(today);
      nextMonday.setDate(today.getDate() + (7 - today.getDay() + 1));
      const monday = getWeekMonday(nextMonday);
      return getWeekDates(monday);
    } else {
      // Custom range
      if (!customStart || !customEnd) return [];
      const dates = [];
      const start = new Date(customStart + 'T00:00:00');
      const end = new Date(customEnd + 'T00:00:00');
      const d = new Date(start);
      while (d <= end) {
        dates.push(d.toISOString().slice(0, 10));
        d.setDate(d.getDate() + 1);
      }
      return dates;
    }
  }

  $: weekLabel = (() => {
    const dates = getDateRange();
    if (dates.length === 0) return '';
    const first = new Date(dates[0] + 'T00:00:00');
    return 'Week of ' + first.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  })();

  // ── Load/save checked state ──────────────────────────────────────────────
  function loadChecked() {
    try {
      const stored = localStorage.getItem('nt:grocery-checked');
      if (stored) checkedItems = JSON.parse(stored);
    } catch { checkedItems = {}; }
  }

  function saveChecked() {
    try {
      localStorage.setItem('nt:grocery-checked', JSON.stringify(checkedItems));
    } catch {}
  }

  function toggleChecked(name) {
    const key = name.toLowerCase().trim();
    if (checkedItems[key]) {
      delete checkedItems[key];
    } else {
      checkedItems[key] = true;
    }
    checkedItems = { ...checkedItems };
    saveChecked();
  }

  function isChecked(name) {
    return !!checkedItems[(name || '').toLowerCase().trim()];
  }

  // ── Fetch & generate ─────────────────────────────────────────────────────
  async function generateList() {
    loading = true;
    const dates = getDateRange();
    if (dates.length === 0) {
      groceryItems = [];
      groupedItems = {};
      loading = false;
      return;
    }

    try {
      const [results, meals] = await Promise.all([
        Promise.all(dates.map(d => NtApi.get(`/api/meal_plans?date=${d}`).catch(() => []))),
        NtApi.getMeals().catch(() => [])
      ]);

      // Flatten all plan items with date and meal_type context
      const allItems = [];
      results.forEach((dayPlans, idx) => {
        const date = dates[idx];
        for (const plan of dayPlans) {
          for (const item of (plan.items || [])) {
            allItems.push({
              ...item,
              date,
              meal_type: plan.meal_type,
            });
          }
        }
      });

      groceryItems = generateGroceryList(allItems, meals);
      groupedItems = groupByCategory(groceryItems);
    } catch (err) {
      console.error('Failed to generate grocery list:', err);
      groceryItems = [];
      groupedItems = {};
    } finally {
      loading = false;
    }
  }

  // ── Actions ──────────────────────────────────────────────────────────────
  function copyAsText() {
    const lines = groceryItems.map(item => `- ${item.name}: ${formatAmount(item.totalAmount, item.unit)}`);
    const text = lines.join('\n');
    navigator.clipboard.writeText(text).then(() => {
      showCopied = true;
      setTimeout(() => showCopied = false, 2000);
    }).catch(() => {});
  }

  function shareList() {
    const lines = groceryItems.map(item => `${item.name} — ${formatAmount(item.totalAmount, item.unit)}`);
    const text = `Grocery List (${weekLabel})\n\n` + lines.join('\n');
    if (navigator.share) {
      navigator.share({ title: 'Grocery List', text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(() => {
        showCopied = true;
        setTimeout(() => showCopied = false, 2000);
      }).catch(() => {});
    }
  }

  let showCopied = false;

  // ── Computed ─────────────────────────────────────────────────────────────
  $: totalItems = groceryItems.length;
  $: checkedCount = groceryItems.filter(i => isChecked(i.name)).length;

  // Category icons
  const CATEGORY_ICONS = {
    'Dairy': 'water_drop',
    'Grains & Cereals': 'grain',
    'Vegetables': 'eco',
    'Fruits': 'nutrition',
    'Pulses & Legumes': 'spa',
    'Meat & Poultry': 'kebab_dining',
    'Seafood': 'set_meal',
    'Oils & Fats': 'water_drop',
    'Spices & Condiments': 'local_fire_department',
    'Beverages': 'local_cafe',
    'Snacks': 'cookie',
    'Other': 'grocery',
  };

  function getCategoryIcon(cat) {
    return CATEGORY_ICONS[cat] || 'grocery';
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────
  onMount(() => {
    loadChecked();
    generateList();
  });

  // Regenerate on range change
  function onRangeChange() {
    generateList();
  }
</script>

<div class="page-shell">
  <header class="page-header">
    <div class="ph-left">
      <button class="icon-btn" on:click={() => push('/planner')}>
        <span class="material-symbols-rounded">arrow_back</span>
      </button>
      <h1 class="page-title">Grocery List</h1>
    </div>
    <div class="ph-actions">
      {#if groceryItems.length > 0}
        <button class="icon-btn" on:click={shareList} title="Share list">
          <span class="material-symbols-rounded">share</span>
        </button>
        <button class="icon-btn" on:click={copyAsText} title="Copy as text">
          <span class="material-symbols-rounded">content_copy</span>
        </button>
      {/if}
    </div>
  </header>

  <!-- Controls -->
  <div class="grocery-controls">
    <div class="range-selector">
      <select bind:value={rangeMode} on:change={onRangeChange}>
        <option value="this-week">This week</option>
        <option value="next-week">Next week</option>
        <option value="custom">Custom range</option>
      </select>
      <button class="btn-generate" on:click={generateList}>
        <span class="material-symbols-rounded" style="font-size:18px">refresh</span>
        Generate
      </button>
    </div>
    {#if rangeMode === 'custom'}
      <div class="custom-range" transition:slide={{ duration: 150 }}>
        <input type="date" bind:value={customStart} on:change={onRangeChange} />
        <span class="range-sep">to</span>
        <input type="date" bind:value={customEnd} on:change={onRangeChange} />
      </div>
    {/if}
    {#if weekLabel}
      <span class="week-label">{weekLabel}</span>
    {/if}
  </div>

  <!-- Copied toast -->
  {#if showCopied}
    <div class="copied-toast" transition:fade={{ duration: 150 }}>
      <span class="material-symbols-rounded" style="font-size:16px">check</span>
      Copied to clipboard
    </div>
  {/if}

  <div class="page-content">
    {#if loading}
      <div class="empty-state">
        <span class="material-symbols-rounded spin">progress_activity</span>
      </div>
    {:else if groceryItems.length === 0}
      <div class="empty-state">
        <span class="material-symbols-rounded" style="font-size:48px; color:var(--text-3)">shopping_cart</span>
        <p class="empty-title">No meals planned</p>
        <p class="empty-desc">No meals planned for this period. Go to Planner to add meals.</p>
        <button class="btn-primary mt-3" on:click={() => push('/planner')}>
          <span class="material-symbols-rounded" style="font-size:18px">calendar_month</span>
          Go to Planner
        </button>
      </div>
    {:else}
      <!-- Grocery list grouped by category -->
      <div class="grocery-list">
        {#each Object.entries(groupedItems) as [category, items] (category)}
          <div class="category-group" transition:slide={{ duration: 150 }}>
            <div class="cg-header">
              <span class="material-symbols-rounded cg-icon">{getCategoryIcon(category)}</span>
              <h3>{category}</h3>
              <span class="cg-count">{items.length}</span>
            </div>
            <div class="cg-items">
              {#each items as item (item.name)}
                {@const checked = isChecked(item.name)}
                <button
                  class="grocery-item"
                  class:checked
                  on:click={() => toggleChecked(item.name)}
                >
                  <span class="gi-check">
                    <span class="material-symbols-rounded">
                      {checked ? 'check_box' : 'check_box_outline_blank'}
                    </span>
                  </span>
                  <span class="gi-name">{item.name}</span>
                  <span class="gi-amount">{formatAmount(item.totalAmount, item.unit)}</span>
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </div>

      <!-- Summary footer -->
      <div class="grocery-summary">
        <span>Total items: {totalItems}</span>
        <span class="summary-sep">&#8226;</span>
        <span>Checked: {checkedCount}/{totalItems}</span>
      </div>
    {/if}
  </div>
</div>

<style>
  /* ─── Controls ───────────────────────────────────────────────── */
  .grocery-controls {
    padding: 12px 16px;
    background: var(--surface-1);
    border-bottom: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .range-selector {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .range-selector select {
    flex: 1;
    padding: 10px 12px;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-1);
    font-size: 14px;
    font-weight: 500;
  }
  .btn-generate {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 10px 14px;
    border-radius: var(--radius-md);
    background: var(--accent-dim);
    border: 1px solid var(--accent);
    color: var(--accent);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all var(--dur-fast);
  }
  .btn-generate:active { transform: scale(0.96); }
  .btn-generate:hover { background: color-mix(in srgb, var(--accent) 20%, transparent); }

  .custom-range {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .custom-range input {
    flex: 1;
    padding: 8px 10px;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-1);
    font-size: 13px;
  }
  .range-sep {
    font-size: 12px;
    color: var(--text-3);
  }
  .week-label {
    font-size: 12px;
    color: var(--text-2);
    font-weight: 500;
  }

  /* ─── Copied toast ───────────────────────────────────────────── */
  .copied-toast {
    position: fixed;
    top: 80px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 16px;
    border-radius: var(--radius-full);
    background: var(--surface-1);
    border: 1px solid var(--accent);
    color: var(--accent);
    font-size: 13px;
    font-weight: 500;
    box-shadow: var(--shadow-lg);
    z-index: 100;
  }

  /* ─── Grocery list ───────────────────────────────────────────── */
  .grocery-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding-bottom: 80px;
  }

  .category-group {
    background: var(--surface-1);
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    overflow: hidden;
  }
  .cg-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .cg-icon {
    font-size: 20px;
    color: var(--accent);
  }
  .cg-header h3 {
    flex: 1;
    font-size: 14px;
    font-weight: 600;
    margin: 0;
    color: var(--text-1);
  }
  .cg-count {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-3);
    background: var(--surface-3);
    border-radius: var(--radius-full);
    padding: 2px 7px;
  }

  .cg-items {
    display: flex;
    flex-direction: column;
  }

  .grocery-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 16px;
    min-height: 48px;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    color: var(--text-1);
    border-bottom: 1px solid var(--border);
    transition: background var(--dur-fast), opacity var(--dur-fast);
    -webkit-tap-highlight-color: transparent;
  }
  .grocery-item:last-child { border-bottom: none; }
  .grocery-item:active { background: var(--surface-2); }

  .grocery-item.checked {
    opacity: 0.5;
  }
  .grocery-item.checked .gi-name {
    text-decoration: line-through;
    color: var(--text-3);
  }

  .gi-check {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-3);
    transition: color var(--dur-fast);
  }
  .gi-check .material-symbols-rounded {
    font-size: 22px;
  }
  .grocery-item.checked .gi-check {
    color: var(--accent);
  }

  .gi-name {
    flex: 1;
    font-size: 14px;
    font-weight: 500;
    transition: color var(--dur-fast);
  }

  .gi-amount {
    font-size: 13px;
    color: var(--text-2);
    font-weight: 500;
    white-space: nowrap;
  }

  /* ─── Summary footer ─────────────────────────────────────────── */
  .grocery-summary {
    position: fixed;
    bottom: 0;
    left: var(--sidebar-w, 0px);
    right: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 14px 16px;
    padding-bottom: calc(14px + var(--safe-bottom, 0px));
    background: var(--glass-surface);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border-top: 1px solid var(--border);
    font-size: 13px;
    font-weight: 500;
    color: var(--text-2);
    z-index: 10;
  }
  .summary-sep {
    color: var(--text-3);
  }

  /* ─── Empty state ────────────────────────────────────────────── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 48px 24px;
    text-align: center;
    color: var(--text-3);
  }
  .empty-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-1);
    margin: 0;
  }
  .empty-desc {
    font-size: 14px;
    color: var(--text-2);
    margin: 0;
  }
  .btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 12px 20px;
    border-radius: var(--radius-md);
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    color: var(--accent-text);
    font-size: 14px;
    font-weight: 600;
    border: none;
    cursor: pointer;
    box-shadow: 0 2px 12px rgba(79,255,176,0.25);
    transition: opacity var(--dur-fast), transform var(--dur-fast);
  }
  .btn-primary:active { transform: scale(0.96); }
  .mt-3 { margin-top: 12px; }

  /* ─── Page layout ────────────────────────────────────────────── */
  .page-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: calc(var(--page-top, var(--safe-top)) + 10px + var(--hamburger-row, 0px)) var(--page-px, 16px) 12px;
    padding-left: max(var(--page-px, 16px), var(--hamburger-offset, 0px));
    background: var(--glass-surface);
    backdrop-filter: blur(20px) saturate(180%);
    -webkit-backdrop-filter: blur(20px) saturate(180%);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 10;
  }
  .ph-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .ph-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .page-title {
    font-size: 20px;
    font-weight: 700;
    margin: 0;
    background: linear-gradient(135deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .icon-btn {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    border: 1px solid var(--border);
    color: var(--text-1);
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: background var(--dur-fast);
  }
  .icon-btn:active { transform: scale(0.92); }
  .icon-btn:hover { background: var(--surface-3); }

  .page-content {
    padding: 16px;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  .spin { animation: spin 1s linear infinite; }
</style>
