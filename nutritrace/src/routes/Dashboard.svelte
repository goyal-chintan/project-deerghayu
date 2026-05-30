<script>
  import { onMount } from 'svelte';
  import { push } from 'svelte-spa-router';
  import { fade } from 'svelte/transition';
  import { NtApi } from '../lib/api.js';
  import { Nutrition, NUTRIMENTS } from '../lib/nutrition.js';
  import { localDateStr } from '../lib/db.js';
  import { goals } from '../stores/settings.js';
  import { currentUser } from '../stores/auth.js';

  // Nutriments to track on dashboard
  const TRACKED_NUTRIMENTS = [
    'calories', 'proteins', 'fat', 'carbohydrates', 'fiber',
    'calcium', 'iron', 'zinc', 'vitamin-a', 'vitamin-c', 'vitamin-d', 'b12', 'b9'
  ];

  let familyMembers = [];
  let entry = null;
  let loading = true;
  let today = localDateStr();

  // Computed data
  let memberCards = [];
  let mealsLogged = 0;
  let totalMeals = 4;
  let topDeficit = null;

  onMount(async () => {
    await loadDashboardData();
  });

  async function loadDashboardData() {
    loading = true;
    try {
      const [members, diaryEntry] = await Promise.all([
        NtApi.get('/api/family'),
        NtApi.getDiaryDate(today).catch(() => null)
      ]);
      familyMembers = Array.isArray(members) ? members : [];
      entry = diaryEntry;
      computeMemberCards();
      computeSummary();
    } catch (err) {
      console.error('[Dashboard] load error:', err);
    } finally {
      loading = false;
    }
  }

  function computeMemberCards() {
    // Build "me" + all family members
    const allMembers = [
      { id: 'me', name: $currentUser?.full_name || 'Myself', age: null, gender: null, targets: null, isMe: true },
      ...familyMembers
    ];

    // Sum nutrients per member from diary items
    const memberTotals = {};
    for (const m of allMembers) {
      memberTotals[m.id] = {};
      for (const nid of TRACKED_NUTRIMENTS) {
        memberTotals[m.id][nid] = 0;
      }
    }

    if (entry?.items) {
      for (const item of entry.items) {
        const id = item.member_id || 'me';
        if (memberTotals[id]) {
          const calc = Nutrition.calculate(item);
          for (const nid of TRACKED_NUTRIMENTS) {
            memberTotals[id][nid] += calc[nid] || 0;
          }
        }
      }
    }

    // Build cards with progress info
    memberCards = allMembers.map(m => {
      const totals = memberTotals[m.id];
      const calTarget = getTarget(m, 'calories');
      const calPct = calTarget ? Math.min(Math.round(totals.calories / calTarget * 100), 100) : 0;

      // Find lacking nutrients (< 80% of target)
      const lacking = [];
      for (const nid of TRACKED_NUTRIMENTS) {
        if (nid === 'calories') continue;
        const tgt = getTarget(m, nid);
        if (tgt && tgt > 0) {
          const pct = Math.round(totals[nid] / tgt * 100);
          if (pct < 80) {
            const nDef = NUTRIMENTS.find(n => n.id === nid);
            lacking.push({ id: nid, label: nDef?.label || nid, pct });
          }
        }
      }
      // Sort by worst deficit
      lacking.sort((a, b) => a.pct - b.pct);

      return {
        ...m,
        calPct,
        calTarget,
        calCurrent: Math.round(totals.calories),
        lacking: lacking.slice(0, 3),
        onTrack: lacking.length === 0
      };
    });
  }

  function getTarget(member, nutrientId) {
    if (member.isMe) {
      // Use user's goals store
      const g = $goals[nutrientId];
      if (!g) return null;
      if (g.isPercent) {
        const density = { fat: 9, carbohydrates: 4, proteins: 4 }[nutrientId];
        const calGoal = $goals.calories?.max ?? $goals.calories?.min ?? 2000;
        return density ? Math.round(calGoal * (g.max ?? g.min) / 100 / density) : (g.max ?? g.min);
      }
      return g.max ?? g.min ?? null;
    }
    // Family member targets
    return member.targets?.[nutrientId] ?? null;
  }

  function computeSummary() {
    // Count meals logged (non-empty meal slots)
    if (entry?.items) {
      const usedMeals = new Set(entry.items.map(i => i.meal));
      mealsLogged = usedMeals.size;
    } else {
      mealsLogged = 0;
    }

    // Top family-average deficit
    if (memberCards.length > 0) {
      const deficits = {};
      let count = 0;
      for (const card of memberCards) {
        for (const l of card.lacking) {
          if (!deficits[l.label]) deficits[l.label] = { sum: 0, count: 0 };
          deficits[l.label].sum += l.pct;
          deficits[l.label].count += 1;
        }
        count++;
      }
      let worst = null;
      for (const [label, d] of Object.entries(deficits)) {
        const avg = Math.round(d.sum / count);
        if (!worst || avg < worst.pct) {
          worst = { label, pct: avg };
        }
      }
      topDeficit = worst;
    }
  }

  function getGenderIcon(gender) {
    if (!gender) return '';
    const g = gender.toLowerCase();
    if (g === 'male' || g === 'm') return 'M';
    if (g === 'female' || g === 'f') return 'F';
    return '';
  }

  function getProgressColor(pct) {
    if (pct >= 80) return 'var(--accent, #4ffbb0)';
    if (pct >= 50) return 'var(--warning, #f59e0b)';
    return 'var(--error, #ef4444)';
  }
</script>

<div class="dashboard" in:fade={{ duration: 180 }}>
  <!-- Header -->
  <header class="dash-header">
    <div class="dash-title-row">
      <span class="material-symbols-rounded dash-icon">family_restroom</span>
      <h1 class="dash-title">Family Dashboard</h1>
    </div>
    <span class="dash-date">{today}</span>
  </header>

  {#if loading}
    <div class="dash-loading">
      <span class="material-symbols-rounded spin">progress_activity</span>
      <p>Loading...</p>
    </div>
  {:else}
    <!-- Member Cards Grid -->
    <section class="member-grid">
      {#each memberCards as card (card.id)}
        <div class="member-card" in:fade={{ duration: 150 }}>
          <div class="member-header">
            <span class="member-name">{card.name}</span>
            {#if card.age || card.gender}
              <span class="member-meta">
                {#if card.age}{card.age} yrs{/if}
                {#if card.age && getGenderIcon(card.gender)}&nbsp;·&nbsp;{/if}
                {#if getGenderIcon(card.gender)}{getGenderIcon(card.gender)}{/if}
              </span>
            {/if}
          </div>

          <!-- Calorie Progress -->
          <div class="cal-row">
            <span class="cal-label">Cal</span>
            <div class="progress-track">
              <div
                class="progress-fill"
                style="width: {card.calPct}%; background: {getProgressColor(card.calPct)}"
              ></div>
            </div>
            <span class="cal-pct" style="color: {getProgressColor(card.calPct)}">{card.calPct}%</span>
          </div>

          <!-- Lacking nutrients or on-track -->
          <div class="member-status">
            {#if card.onTrack}
              <span class="on-track">
                <span class="material-symbols-rounded status-icon">check_circle</span>
                On track
              </span>
            {:else}
              {#each card.lacking as deficit}
                <span class="deficit-tag">
                  <span class="material-symbols-rounded status-icon warn-icon">warning</span>
                  {deficit.label} {deficit.pct}%
                </span>
              {/each}
            {/if}
          </div>
        </div>
      {/each}

      {#if familyMembers.length === 0}
        <div class="empty-state">
          <span class="material-symbols-rounded empty-icon">group_add</span>
          <p>No family members yet</p>
          <button class="btn-accent" on:click={() => push('/family')}>
            Add Members
          </button>
        </div>
      {/if}
    </section>

    <!-- Quick Actions -->
    <section class="quick-actions">
      <h2 class="section-title">Quick Actions</h2>
      <div class="actions-grid">
        <button class="action-btn" on:click={() => push('/planner')}>
          <span class="material-symbols-rounded">calendar_month</span>
          <span>Plan Today</span>
        </button>
        <button class="action-btn" on:click={() => push('/nutrients')}>
          <span class="material-symbols-rounded">science</span>
          <span>Nutrients</span>
        </button>
        <button class="action-btn" on:click={() => push('/')}>
          <span class="material-symbols-rounded">edit_note</span>
          <span>Log Meal</span>
        </button>
        <button class="action-btn" on:click={() => push('/family')}>
          <span class="material-symbols-rounded">family_restroom</span>
          <span>Edit Family</span>
        </button>
      </div>
    </section>

    <!-- Today's Summary -->
    <section class="today-summary">
      <h2 class="section-title">Today's Summary</h2>
      <div class="summary-card">
        <div class="summary-row">
          <span class="material-symbols-rounded summary-icon">restaurant</span>
          <span class="summary-label">Meals logged</span>
          <span class="summary-value">{mealsLogged} of {totalMeals}</span>
        </div>
        {#if topDeficit}
          <div class="summary-row">
            <span class="material-symbols-rounded summary-icon warn-icon">warning</span>
            <span class="summary-label">Top deficit</span>
            <span class="summary-value deficit">{topDeficit.label} (avg {topDeficit.pct}%)</span>
          </div>
        {:else}
          <div class="summary-row">
            <span class="material-symbols-rounded summary-icon good-icon">check_circle</span>
            <span class="summary-label">Status</span>
            <span class="summary-value good">All on track!</span>
          </div>
        {/if}
      </div>
    </section>
  {/if}
</div>

<style>
  .dashboard {
    padding: calc(var(--page-top, var(--safe-top)) + 16px) 16px calc(var(--nav-h, 64px) + var(--safe-bottom) + 24px);
    max-width: 900px;
    margin: 0 auto;
  }

  /* Header */
  .dash-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
    padding: 0 4px;
  }
  .dash-title-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .dash-icon {
    font-size: 28px;
    color: var(--accent);
  }
  .dash-title {
    font-size: 22px;
    font-weight: 700;
    color: var(--text-1);
    margin: 0;
  }
  .dash-date {
    font-size: 13px;
    color: var(--text-3);
    font-weight: 500;
  }

  /* Loading */
  .dash-loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 80px 0;
    color: var(--text-3);
  }
  .spin {
    font-size: 32px;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* Member Grid */
  .member-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 14px;
    margin-bottom: 28px;
  }

  .member-card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg, 16px);
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    transition: transform var(--dur-fast, 0.15s), box-shadow var(--dur-fast, 0.15s);
  }
  .member-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0,0,0,0.15);
  }

  .member-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .member-name {
    font-size: 16px;
    font-weight: 650;
    color: var(--text-1);
  }
  .member-meta {
    font-size: 12px;
    color: var(--text-3);
    font-weight: 500;
  }

  /* Calorie Progress Row */
  .cal-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cal-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
    width: 28px;
    flex-shrink: 0;
  }
  .progress-track {
    flex: 1;
    height: 8px;
    background: var(--surface-2, rgba(255,255,255,0.06));
    border-radius: var(--radius-full, 999px);
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    border-radius: var(--radius-full, 999px);
    transition: width 0.6s ease;
  }
  .cal-pct {
    font-size: 12px;
    font-weight: 700;
    width: 36px;
    text-align: right;
  }

  /* Status */
  .member-status {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 22px;
  }
  .on-track {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--accent, #4ffbb0);
  }
  .deficit-tag {
    display: flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
    font-weight: 600;
    color: var(--warning, #f59e0b);
    background: color-mix(in srgb, var(--warning, #f59e0b) 10%, transparent);
    padding: 2px 8px;
    border-radius: var(--radius-full, 999px);
  }
  .status-icon {
    font-size: 14px;
  }
  .warn-icon {
    color: var(--warning, #f59e0b);
  }

  /* Empty state */
  .empty-state {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 48px 16px;
    color: var(--text-3);
  }
  .empty-icon {
    font-size: 48px;
    opacity: 0.5;
  }
  .btn-accent {
    background: var(--accent);
    color: var(--bg, #000);
    border: none;
    border-radius: var(--radius-md, 12px);
    padding: 10px 20px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: transform var(--dur-fast, 0.15s);
  }
  .btn-accent:active { transform: scale(0.95); }

  /* Quick Actions */
  .section-title {
    font-size: 15px;
    font-weight: 650;
    color: var(--text-2);
    margin: 0 0 12px 4px;
  }
  .quick-actions {
    margin-bottom: 28px;
  }
  .actions-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
  }
  .action-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px;
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md, 12px);
    color: var(--text-1);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background var(--dur-fast, 0.15s), transform var(--dur-fast, 0.15s);
    -webkit-tap-highlight-color: transparent;
  }
  .action-btn:hover {
    background: var(--surface-2);
  }
  .action-btn:active {
    transform: scale(0.96);
  }
  .action-btn .material-symbols-rounded {
    font-size: 20px;
    color: var(--accent);
  }

  /* Today's Summary */
  .today-summary {
    margin-bottom: 16px;
  }
  .summary-card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg, 16px);
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .summary-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .summary-icon {
    font-size: 20px;
    color: var(--text-3);
  }
  .summary-icon.good-icon {
    color: var(--accent, #4ffbb0);
  }
  .summary-label {
    flex: 1;
    font-size: 14px;
    color: var(--text-2);
  }
  .summary-value {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-1);
  }
  .summary-value.deficit {
    color: var(--warning, #f59e0b);
  }
  .summary-value.good {
    color: var(--accent, #4ffbb0);
  }
</style>
