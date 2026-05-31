<script>
  import { onMount } from 'svelte';
  import { fade, slide } from 'svelte/transition';
  import { push } from 'svelte-spa-router';
  import { NtApi } from '../lib/api.js';
  import { NUTRIMENTS } from '../lib/nutrition.js';
  import { summarizeFamilyNutrition, buildCoverageDistribution, getGoalTarget } from '../lib/familyNutrition.js';
  import { isAllowedInVegMode } from '../lib/dietType.js';
  import { generateGapSuggestions } from '../lib/nutrientRecommendations.js';
  import { vegetarianMode, goals } from '../stores/settings.js';
  import { currentUser } from '../stores/auth.js';
  import Sheet from '../components/ui/Sheet.svelte';

  // ── State ────────────────────────────────────────────────────────────────
  let plans = [];
  let members = [];
  let loading = true;
  let currentDate = new Date().toISOString().slice(0, 10);

  // Week view state
  let viewMode = 'day'; // 'day' | 'week'
  let weekPlans = []; // Array of 7 plan arrays (Mon-Sun)
  let weekLoading = false;
  let weekCollapsed = [false, false, false, false, false, false, false]; // mobile collapse state

  // Food search sheet state
  let showFoodSearch = false;
  let searchQuery = '';
  let searchResults = [];
  let searching = false;
  let searchTimeout = null;
  let activeMealType = 'Lunch';

  // Selected food staging (quantity picker before adding)
  let stagedFood = null;
  let stagedPortion = 100;
  let stagedUnit = 'g';
  let stagedServings = 1;

  // Member allocation editing
  let showAllocSheet = false;
  let allocPlanId = null;
  let allocItemIdx = 0;
  let allocEdits = {}; // { memberId: fraction }

  // All food library (cached)
  let allFoods = [];
  let allMeals = [];
  let foodsLoaded = false;

  // Tracked nutrient IDs for the coverage panel
  const TRACKED_NUTRIENTS = [
    'calories', 'proteins', 'carbohydrates', 'fat', 'fiber',
    'iron', 'calcium', 'zinc', 'vitamin-a', 'vitamin-c', 'vitamin-d', 'b12', 'b9'
  ];

  // Per-member view toggle
  let showPerMember = false;

  // ── Lifecycle ────────────────────────────────────────────────────────────
  onMount(async () => {
    await fetchAll();
  });

  async function fetchAll() {
    loading = true;
    try {
      const [mRes, pRes] = await Promise.all([
        NtApi.get('/api/family'),
        NtApi.get(`/api/meal_plans?date=${currentDate}`)
      ]);
      members = Array.isArray(mRes) ? mRes : (mRes?.data || []);
      plans = Array.isArray(pRes) ? pRes : (pRes?.data || []);
    } catch (err) {
      console.error(err);
      members = [];
      plans = [];
    } finally {
      loading = false;
    }
  }

  async function loadFoodLibrary() {
    if (foodsLoaded) return;
    try {
      const [foods, meals] = await Promise.all([
        NtApi.getFoods(),
        NtApi.getMeals()
      ]);
      allFoods = foods;
      allMeals = meals;
      foodsLoaded = true;
    } catch (err) {
      console.error('Failed to load food library:', err);
    }
  }

  // ── Date navigation ──────────────────────────────────────────────────────
  function changeDate(delta) {
    if (viewMode === 'week') {
      changeWeek(delta);
      return;
    }
    const d = new Date(currentDate);
    d.setUTCDate(d.getUTCDate() + delta);
    currentDate = d.toISOString().slice(0, 10);
    fetchAll();
  }

  function goToday() {
    currentDate = new Date().toISOString().slice(0, 10);
    if (viewMode === 'week') {
      fetchWeekPlans();
    } else {
      fetchAll();
    }
  }

  // ── Week View Helpers ────────────────────────────────────────────────────
  function getWeekMonday(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const day = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
    const diff = day === 0 ? -6 : 1 - day; // Adjust so Monday is first
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  function getWeekDates(dateStr) {
    const monday = getWeekMonday(dateStr);
    const dates = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday + 'T00:00:00');
      d.setDate(d.getDate() + i);
      dates.push(d.toISOString().slice(0, 10));
    }
    return dates;
  }

  $: weekDates = getWeekDates(currentDate);
  $: todayStr = new Date().toISOString().slice(0, 10);

  $: weekLabel = (() => {
    const mon = new Date(weekDates[0] + 'T00:00:00');
    return 'Week of ' + mon.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  })();

  async function fetchWeekPlans() {
    weekLoading = true;
    try {
      const dates = getWeekDates(currentDate);
      const results = await Promise.all(
        dates.map(d => NtApi.get(`/api/meal_plans?date=${d}`).catch(() => []))
      );
      weekPlans = results;
    } catch (err) {
      console.error('Failed to load week plans:', err);
      weekPlans = [[], [], [], [], [], [], []];
    } finally {
      weekLoading = false;
    }
  }

  function switchToWeekView() {
    viewMode = 'week';
    fetchWeekPlans();
  }

  function switchToDayView(date) {
    if (date) currentDate = date;
    viewMode = 'day';
    fetchAll();
  }

  function changeWeek(delta) {
    const d = new Date(currentDate + 'T00:00:00');
    d.setDate(d.getDate() + (delta * 7));
    currentDate = d.toISOString().slice(0, 10);
    fetchWeekPlans();
  }

  function toggleWeekCollapse(idx) {
    weekCollapsed = weekCollapsed.map((v, i) => i === idx ? !v : v);
  }

  // Compute nutrition totals for a given day's plans
  function dayNutritionTotals(dayPlans) {
    const totals = {};
    for (const plan of dayPlans) {
      for (const item of (plan.items || [])) {
        if (!item.nutrition) continue;
        // Nutrition values are already scaled to actual intake
        for (const [key, val] of Object.entries(item.nutrition)) {
          if (key === '_derived') continue;
          totals[key] = (totals[key] || 0) + (parseFloat(val) || 0);
        }
      }
    }
    return totals;
  }

  // Compute coverage % for a day's nutrition relative to family targets
  function dayCoveragePct(dayPlans, nutrientId) {
    const target = aggTargets[nutrientId] || 0;
    if (target <= 0) return 0;
    const totals = dayNutritionTotals(dayPlans);
    return Math.min(100, Math.round(((totals[nutrientId] || 0) / target) * 100));
  }

  // Get meals grouped by type for a day
  function dayMealsByType(dayPlans) {
    const grouped = { Breakfast: [], Lunch: [], Dinner: [], Snacks: [] };
    for (const plan of dayPlans) {
      const type = plan.meal_type || 'Snacks';
      if (!grouped[type]) grouped[type] = [];
      for (const item of (plan.items || [])) {
        grouped[type].push(item.name || 'Unknown');
      }
    }
    return grouped;
  }

  // Weekly average coverage
  $: weeklyAverages = (() => {
    if (weekPlans.length !== 7) return {};
    const KEY_NUTRIENTS = ['calories', 'proteins', 'iron', 'calcium', 'fiber'];
    const avgs = {};
    for (const nid of KEY_NUTRIENTS) {
      const target = aggTargets[nid] || 0;
      if (target <= 0) { avgs[nid] = 0; continue; }
      let totalPct = 0;
      let daysWithData = 0;
      for (const dayPlans of weekPlans) {
        if (dayPlans.length > 0) {
          daysWithData++;
          const totals = dayNutritionTotals(dayPlans);
          totalPct += Math.min(100, Math.round(((totals[nid] || 0) / target) * 100));
        }
      }
      avgs[nid] = daysWithData > 0 ? Math.round(totalPct / daysWithData) : 0;
    }
    return avgs;
  })();

  const WEEK_DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MEAL_TYPE_SHORT = { Breakfast: 'Bkfst', Lunch: 'Lunch', Dinner: 'Dinner', Snacks: 'Snack' };

  // ── Nutrient Aggregation ─────────────────────────────────────────────────
  function getAggregatedTargets(memberList) {
    let agg = {};
    for (const id of TRACKED_NUTRIENTS) agg[id] = 0;
    for (const m of memberList) {
      if (!m.targets) continue;
      for (const id of TRACKED_NUTRIENTS) {
        agg[id] += m.targets[id] || 0;
      }
    }
    return agg;
  }

  function getCurrentUserTargets(userGoals) {
    const targets = {};
    const currentMember = { isMe: true };
    for (const id of TRACKED_NUTRIENTS) {
      targets[id] = getGoalTarget(id, currentMember, userGoals);
    }
    return targets;
  }

  function getPlannerSuggestionTargets(memberList, userGoals) {
    const targets = getAggregatedTargets(memberList);
    const currentTargets = getCurrentUserTargets(userGoals);
    for (const id of TRACKED_NUTRIENTS) {
      targets[id] = (targets[id] || 0) + (currentTargets[id] || 0);
    }
    return targets;
  }

  // NOTE: members is passed explicitly so Svelte tracks it as a reactive
  // dependency — referencing it only inside the function body would not
  // re-run this statement when family data loads (cards would stay empty).
  $: aggTargets = getAggregatedTargets(members);
  $: plannerSuggestionTargets = getPlannerSuggestionTargets(members, $goals);

  // Compute planned nutrition for the day across all plans
  $: plannedNutrition = (() => {
    const totals = {};
    for (const plan of plans) {
      for (const item of (plan.items || [])) {
        if (!item.nutrition) continue;
        // Nutrition values are already scaled to actual intake when stored
        for (const [key, val] of Object.entries(item.nutrition)) {
          if (key === '_derived') continue;
          totals[key] = (totals[key] || 0) + (parseFloat(val) || 0);
        }
      }
    }
    return totals;
  })();

  // Per-member nutrient computation
  $: memberNutrition = (() => {
    const result = {};
    for (const m of members) {
      result[m.id] = {};
    }
    for (const plan of plans) {
      for (const item of (plan.items || [])) {
        if (!item.nutrition) continue;
        // Nutrition values are already scaled to actual intake
        const allocs = item.member_allocations || {};
        const hasAllocs = Object.keys(allocs).length > 0;
        for (const m of members) {
          const share = hasAllocs ? (parseFloat(allocs[m.id]) || 0) : (1 / members.length);
          for (const [key, val] of Object.entries(item.nutrition)) {
            if (key === '_derived') continue;
            if (!result[m.id]) result[m.id] = {};
            result[m.id][key] = (result[m.id][key] || 0) + (parseFloat(val) || 0) * share;
          }
        }
      }
    }
    return result;
  })();

  function parseNutrition(nutrition) {
    if (!nutrition) return {};
    if (typeof nutrition === 'string') {
      try {
        return JSON.parse(nutrition) || {};
      } catch {
        return {};
      }
    }
    return nutrition;
  }

  function scaleNutritionForShare(nutrition, share) {
    const scaled = {};
    for (const [key, val] of Object.entries(parseNutrition(nutrition))) {
      if (key === '_derived') continue;
      scaled[key] = (parseFloat(val) || 0) * share;
    }
    return scaled;
  }

  function buildPlannerNutritionItems(planList, memberList) {
    const family = memberList || [];
    const participants = [{ id: 'me', isMe: true }, ...family];
    return (planList || []).flatMap(plan => (plan.items || []).flatMap(item => {
      const allocations = item.member_allocations || {};
      const hasAllocations = Object.values(allocations).some(value => (parseFloat(value) || 0) > 0);
      const allocatedFamilyShare = family.reduce((sum, member) => sum + (parseFloat(allocations[member.id]) || 0), 0);
      const equalShare = 1 / participants.length;

      return participants
        .map(participant => {
          const share = hasAllocations
            ? participant.isMe
              ? Math.max(0, 1 - allocatedFamilyShare)
              : (parseFloat(allocations[participant.id]) || 0)
            : equalShare;
          if (share <= 0) return null;
          return {
            ...item,
            meal: plan.meal_type || 'Meal',
            member_id: participant.id,
            quantity: 1,
            nutrition: scaleNutritionForShare(item.nutrition, share)
          };
        })
        .filter(Boolean);
    }));
  }

  $: plannerNutritionItems = buildPlannerNutritionItems(plans, members);
  $: plannerSummary = summarizeFamilyNutrition({
    members,
    currentUser: $currentUser,
    goals: $goals,
    items: plannerNutritionItems,
    maxRecommendations: 3
  });
  $: coverageDistribution = buildCoverageDistribution(plannerSummary.analyticsRows);
  $: planningRecommendations = plannerSummary.recommendations.slice(0, 3);
  $: hasPlanningGaps = planningRecommendations.length > 0;

  // ── Gap Suggestions (reactive) ──────────────────────────────────────────
  $: if (hasPlanningGaps && !foodsLoaded) loadFoodLibrary();

  $: gapSuggestions = (() => {
    if (!foodsLoaded || !hasPlanningGaps) return [];
    return generateGapSuggestions(plannedNutrition, plannerSuggestionTargets, allFoods, $vegetarianMode).slice(0, 3);
  })();

  let showGapSuggestions = false;

  async function addSuggestedFood(suggestion, mealType = 'Lunch') {
    const food = suggestion.food;
    const portion = suggestion.servingToFill || 100;
    const origPortion = parseFloat(food.portion) || 100;
    const scale = (portion / origPortion) * 1; // servings = 1
    const nutrition = typeof food.nutrition === 'string' ? JSON.parse(food.nutrition) : (food.nutrition || {});
    const scaledNutrition = {};
    for (const [key, val] of Object.entries(nutrition)) {
      if (key === '_derived') continue;
      scaledNutrition[key] = (parseFloat(val) || 0) * scale;
    }

    const item = {
      food_id: food.id || null,
      name: food.name,
      portion,
      unit: food.unit || 'g',
      servings: 1,
      category: food.category || '',
      nutrition: scaledNutrition, // Already scaled to actual intake
      member_allocations: {}
    };

    const existingPlan = plans.find(p => p.meal_type === mealType);
    if (existingPlan) {
      const updatedItems = [...(existingPlan.items || []), item];
      try {
        await NtApi.put(`/api/meal_plans/${existingPlan.id}`, {
          date: currentDate, meal_type: mealType, items: updatedItems
        });
      } catch {
        try {
          await NtApi.del(`/api/meal_plans/${existingPlan.id}`);
          await NtApi.post('/api/meal_plans', {
            date: currentDate, meal_type: mealType, items: updatedItems
          });
        } catch (e2) { console.error('Failed to add suggested food:', e2); }
      }
    } else {
      try {
        await NtApi.post('/api/meal_plans', {
          date: currentDate, meal_type: mealType, items: [item]
        });
      } catch (err) { console.error('Failed to add suggested food:', err); }
    }
    await fetchAll();
  }

  // ── Food Search ──────────────────────────────────────────────────────────
  function openFoodSearch(mealType) {
    activeMealType = mealType;
    searchQuery = '';
    searchResults = [];
    stagedFood = null;
    showFoodSearch = true;
    loadFoodLibrary();
  }

  function onSearchInput() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => doSearch(), 200);
  }

  function doSearch() {
    const q = searchQuery.toLowerCase().trim();
    if (!q) {
      searchResults = [];
      return;
    }
    searching = true;
    // Search local foods + meals
    let results = [...allFoods, ...allMeals]
      .filter(f => {
        const name = (f.name || '').toLowerCase();
        const brand = (f.brand || '').toLowerCase();
        return name.includes(q) || brand.includes(q);
      });
    // Apply vegetarian filter
    if ($vegetarianMode) {
      results = results.filter(f => isAllowedInVegMode(f));
    }
    // Sort by relevance (starts-with first, then includes)
    results.sort((a, b) => {
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      const aStarts = aName.startsWith(q) ? 0 : 1;
      const bStarts = bName.startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return aName.localeCompare(bName);
    });
    searchResults = results.slice(0, 30);
    searching = false;
  }

  function selectFood(food) {
    stagedFood = food;
    stagedPortion = parseFloat(food.portion) || 100;
    stagedUnit = food.unit || 'g';
    stagedServings = 1;
  }

  function cancelStaged() {
    stagedFood = null;
  }

  // Compute staged nutrition preview
  $: stagedNutritionPreview = (() => {
    if (!stagedFood?.nutrition) return {};
    const origPortion = parseFloat(stagedFood.portion) || 100;
    const factor = (stagedPortion / origPortion) * stagedServings;
    const result = {};
    for (const [key, val] of Object.entries(stagedFood.nutrition)) {
      if (key === '_derived') continue;
      result[key] = Math.round((parseFloat(val) || 0) * factor * 10) / 10;
    }
    return result;
  })();

  async function addStagedFood() {
    if (!stagedFood) return;
    const origPortion = parseFloat(stagedFood.portion) || 100;
    // Scale nutrition to represent actual intake (portion × servings)
    const scale = (stagedPortion / origPortion) * stagedServings;
    const scaledNutrition = {};
    if (stagedFood.nutrition) {
      for (const [key, val] of Object.entries(stagedFood.nutrition)) {
        if (key === '_derived') continue;
        scaledNutrition[key] = (parseFloat(val) || 0) * scale;
      }
    }

    const item = {
      food_id: stagedFood.id || null,
      name: stagedFood.name,
      portion: stagedPortion,
      unit: stagedUnit,
      servings: stagedServings,
      nutrition: scaledNutrition, // Already scaled to actual intake
      member_allocations: {}
    };

    // Check if there's already a plan for this meal_type today
    const existingPlan = plans.find(p => p.meal_type === activeMealType);
    if (existingPlan) {
      // Update existing plan by adding item
      const updatedItems = [...(existingPlan.items || []), item];
      try {
        await NtApi.put(`/api/meal_plans/${existingPlan.id}`, {
          date: currentDate,
          meal_type: activeMealType,
          items: updatedItems
        });
      } catch (err) {
        // If PUT not supported, delete and recreate
        try {
          await NtApi.del(`/api/meal_plans/${existingPlan.id}`);
          await NtApi.post('/api/meal_plans', {
            date: currentDate,
            meal_type: activeMealType,
            items: updatedItems
          });
        } catch (e2) {
          console.error('Failed to update plan:', e2);
        }
      }
    } else {
      // Create new plan
      try {
        await NtApi.post('/api/meal_plans', {
          date: currentDate,
          meal_type: activeMealType,
          items: [item]
        });
      } catch (err) {
        console.error('Failed to create plan:', err);
      }
    }

    stagedFood = null;
    showFoodSearch = false;
    await fetchAll();
  }

  // ── Plan Item Management ─────────────────────────────────────────────────
  async function removeItem(plan, itemIdx) {
    const updatedItems = (plan.items || []).filter((_, i) => i !== itemIdx);
    if (updatedItems.length === 0) {
      await NtApi.del(`/api/meal_plans/${plan.id}`);
    } else {
      try {
        await NtApi.put(`/api/meal_plans/${plan.id}`, {
          date: currentDate,
          meal_type: plan.meal_type,
          items: updatedItems
        });
      } catch {
        await NtApi.del(`/api/meal_plans/${plan.id}`);
        if (updatedItems.length > 0) {
          await NtApi.post('/api/meal_plans', {
            date: currentDate,
            meal_type: plan.meal_type,
            items: updatedItems
          });
        }
      }
    }
    await fetchAll();
  }

  async function removePlan(id) {
    try {
      await NtApi.del(`/api/meal_plans/${id}`);
      await fetchAll();
    } catch (err) {
      console.error(err);
    }
  }

  // ── Member Allocation ────────────────────────────────────────────────────
  function openAllocEditor(plan, itemIdx) {
    allocPlanId = plan.id;
    allocItemIdx = itemIdx;
    const item = plan.items[itemIdx];
    const allocs = item.member_allocations || {};
    // Initialize with equal splits if empty
    allocEdits = {};
    if (Object.keys(allocs).length > 0) {
      for (const m of members) {
        allocEdits[m.id] = parseFloat(allocs[m.id]) || 0;
      }
    } else {
      const equal = members.length > 0 ? Math.round((1 / members.length) * 100) / 100 : 1;
      for (const m of members) {
        allocEdits[m.id] = equal;
      }
    }
    showAllocSheet = true;
  }

  function adjustAlloc(memberId, delta) {
    const current = allocEdits[memberId] || 0;
    const newVal = Math.max(0, Math.min(1, Math.round((current + delta) * 100) / 100));
    allocEdits = { ...allocEdits, [memberId]: newVal };
  }

  async function saveAllocations() {
    const plan = plans.find(p => p.id === allocPlanId);
    if (!plan) return;
    const items = [...plan.items];
    items[allocItemIdx] = { ...items[allocItemIdx], member_allocations: { ...allocEdits } };
    try {
      await NtApi.put(`/api/meal_plans/${plan.id}`, {
        date: currentDate,
        meal_type: plan.meal_type,
        items
      });
    } catch {
      await NtApi.del(`/api/meal_plans/${plan.id}`);
      await NtApi.post('/api/meal_plans', {
        date: currentDate,
        meal_type: plan.meal_type,
        items
      });
    }
    showAllocSheet = false;
    await fetchAll();
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  function nutrientInfo(id) {
    return NUTRIMENTS.find(n => n.id === id) || { id, label: id, unit: '' };
  }

  function coveragePct(nutrientId) {
    const target = aggTargets[nutrientId] || 0;
    if (target <= 0) return 0;
    return Math.min(100, Math.round(((plannedNutrition[nutrientId] || 0) / target) * 100));
  }

  function coverageColor(pct) {
    if (pct >= 80) return 'var(--success)';
    if (pct >= 50) return 'var(--warning)';
    return 'var(--danger)';
  }

  function memberCoveragePct(memberId, nutrientId) {
    const member = members.find(m => m.id === memberId);
    if (!member?.targets) return 0;
    const target = member.targets[nutrientId] || 0;
    if (target <= 0) return 0;
    const current = (memberNutrition[memberId] || {})[nutrientId] || 0;
    return Math.min(100, Math.round((current / target) * 100));
  }

  function formatPortionLabel(item) {
    const p = parseFloat(item.portion) || 100;
    const u = item.unit || 'g';
    const s = parseFloat(item.servings) || 1;
    if (s === 1) return `${p}${u}`;
    return `${s} × ${p}${u}`;
  }

  const MEAL_ICONS = {
    Breakfast: 'bakery_dining',
    Lunch: 'lunch_dining',
    Dinner: 'dinner_dining',
    Snacks: 'cookie'
  };

  $: isToday = currentDate === new Date().toISOString().slice(0, 10);
  $: dateLabel = (() => {
    const d = new Date(currentDate + 'T00:00:00');
    if (isToday) return 'Today';
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    if (currentDate === yesterday.toISOString().slice(0, 10)) return 'Yesterday';
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    if (currentDate === tomorrow.toISOString().slice(0, 10)) return 'Tomorrow';
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  })();
</script>

<div class="page-shell">
  <header class="page-header">
    <div class="ph-left">
      <button class="icon-btn" on:click={() => push('/')}>
        <span class="material-symbols-rounded">arrow_back</span>
      </button>
      <h1 class="page-title">Meal Planner</h1>
    </div>
    <div class="ph-actions">
      <button class="icon-btn" on:click={() => push('/grocery')} title="Grocery List">
        <span class="material-symbols-rounded">shopping_cart</span>
      </button>
    </div>
  </header>

  <!-- View mode toggle -->
  <div class="view-toggle-bar">
    <div class="view-toggle">
      <button class="vt-btn" class:active={viewMode === 'day'} on:click={() => switchToDayView(null)}>
        <span class="material-symbols-rounded" style="font-size:16px">today</span>
        Day
      </button>
      <button class="vt-btn" class:active={viewMode === 'week'} on:click={switchToWeekView}>
        <span class="material-symbols-rounded" style="font-size:16px">date_range</span>
        Week
      </button>
    </div>
  </div>

  <!-- Date navigation bar -->
  <div class="diary-date-bar">
    <button class="icon-btn" on:click={() => changeDate(-1)}>
      <span class="material-symbols-rounded">chevron_left</span>
    </button>
    <button class="date-lbl" on:click={goToday}>
      {#if viewMode === 'week'}
        <strong>{weekLabel}</strong>
      {:else}
        <strong>{dateLabel}</strong>
        {#if !isToday}
          <span class="date-sub">{currentDate}</span>
        {/if}
      {/if}
    </button>
    <button class="icon-btn" on:click={() => changeDate(1)}>
      <span class="material-symbols-rounded">chevron_right</span>
    </button>
  </div>

  <div class="page-content">
    {#if viewMode === 'week'}
      <!-- ═══ WEEK VIEW ═══════════════════════════════════════════════ -->
      {#if weekLoading}
        <div class="empty-state"><span class="material-symbols-rounded spin">progress_activity</span></div>
      {:else}
        <!-- Desktop: 7-column grid -->
        <div class="week-grid">
          {#each weekDates as date, idx}
            {@const dayPlans = weekPlans[idx] || []}
            {@const meals = dayMealsByType(dayPlans)}
            {@const isCurrentDay = date === todayStr}
            {@const isEmpty = dayPlans.length === 0}
            <div
              class="week-col"
              class:today={isCurrentDay}
              class:empty={isEmpty}
              on:click={() => switchToDayView(date)}
              on:keydown={(e) => e.key === 'Enter' && switchToDayView(date)}
              role="button"
              tabindex="0"
            >
              <div class="wc-header">
                <span class="wc-day">{WEEK_DAY_LABELS[idx]}</span>
                <span class="wc-date">{new Date(date + 'T00:00:00').getDate()}</span>
              </div>
              <div class="wc-body">
                {#if isEmpty}
                  <div class="wc-empty">
                    <span class="material-symbols-rounded" style="font-size:20px">add_circle_outline</span>
                    <span>Plan meals</span>
                  </div>
                {:else}
                  {#each ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as mType}
                    {#if meals[mType] && meals[mType].length > 0}
                      <div class="wc-meal">
                        <span class="wc-meal-type">{MEAL_TYPE_SHORT[mType]}:</span>
                        <span class="wc-meal-items">{meals[mType].slice(0, 2).join(', ')}{meals[mType].length > 2 ? '...' : ''}</span>
                      </div>
                    {/if}
                  {/each}
                {/if}
              </div>
              <div class="wc-footer">
                {#if !isEmpty}
                  {@const calPct = dayCoveragePct(dayPlans, 'calories')}
                  {@const ironPct = dayCoveragePct(dayPlans, 'iron')}
                  <span class="wc-pill" style="color:{coverageColor(calPct)}">Cal:{calPct}%</span>
                  <span class="wc-pill" style="color:{coverageColor(ironPct)}">Fe:{ironPct}%</span>
                {:else}
                  <span class="wc-pill empty-pill">Empty</span>
                {/if}
              </div>
            </div>
          {/each}
        </div>

        <!-- Mobile: vertical list of collapsible day cards -->
        <div class="week-list">
          {#each weekDates as date, idx}
            {@const dayPlans = weekPlans[idx] || []}
            {@const meals = dayMealsByType(dayPlans)}
            {@const isCurrentDay = date === todayStr}
            {@const isEmpty = dayPlans.length === 0}
            <div class="wl-card" class:today={isCurrentDay}>
              <button class="wl-header" on:click={() => toggleWeekCollapse(idx)}>
                <div class="wl-day-info">
                  <span class="wl-day">{WEEK_DAY_LABELS[idx]}</span>
                  <span class="wl-date">{new Date(date + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
                </div>
                <div class="wl-summary">
                  {#if !isEmpty}
                    {@const calPct = dayCoveragePct(dayPlans, 'calories')}
                    <span class="wc-pill" style="color:{coverageColor(calPct)}">Cal:{calPct}%</span>
                    <span class="wl-item-count">{dayPlans.reduce((s, p) => s + (p.items?.length || 0), 0)} items</span>
                  {:else}
                    <span class="wl-empty-label">No meals</span>
                  {/if}
                </div>
                <span class="material-symbols-rounded wl-chevron" class:expanded={weekCollapsed[idx]}>expand_more</span>
              </button>
              {#if weekCollapsed[idx]}
                <div class="wl-body" transition:slide={{ duration: 200 }}>
                  {#if isEmpty}
                    <button class="wl-plan-btn" on:click={() => switchToDayView(date)}>
                      <span class="material-symbols-rounded">add</span>
                      Plan meals for this day
                    </button>
                  {:else}
                    {#each ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as mType}
                      {#if meals[mType] && meals[mType].length > 0}
                        <div class="wl-meal-row">
                          <span class="wl-meal-type">{mType}:</span>
                          <span class="wl-meal-items">{meals[mType].join(', ')}</span>
                        </div>
                      {/if}
                    {/each}
                    <button class="wl-edit-btn" on:click={() => switchToDayView(date)}>
                      <span class="material-symbols-rounded" style="font-size:16px">edit</span>
                      Edit this day
                    </button>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>

        <!-- Weekly average summary -->
        <div class="card week-summary-card">
          <h4 class="ws-title">Weekly Average</h4>
          <div class="ws-pills">
            {#each Object.entries(weeklyAverages) as [nid, pct]}
              {@const info = nutrientInfo(nid)}
              <span class="ws-pill" style="color:{coverageColor(pct)}">
                {info.label} {pct}%{pct < 50 ? ' \u26A0\uFE0F' : ''}
              </span>
            {/each}
          </div>
        </div>
      {/if}

    {:else}
      <!-- ═══ DAY VIEW (existing) ═══════════════════════════════════ -->
      {#if loading}
        <div class="empty-state"><span class="material-symbols-rounded spin">progress_activity</span></div>
      {:else}

      <!-- ─── Nutrient Coverage Panel ─────────────────────────────── -->
      <div class="card coverage-card mb-3">
        <div class="coverage-header">
          <h3>Family Daily Coverage</h3>
          {#if members.length > 1}
            <button class="pill-toggle" class:active={showPerMember} on:click={() => showPerMember = !showPerMember}>
              <span class="material-symbols-rounded" style="font-size:16px">group</span>
              Per member
            </button>
          {/if}
        </div>

        {#if !showPerMember}
          <div class="nutrient-grid">
            {#each TRACKED_NUTRIENTS as nid}
              {@const pct = coveragePct(nid)}
              {@const info = nutrientInfo(nid)}
              {@const target = aggTargets[nid] || 0}
              {@const current = plannedNutrition[nid] || 0}
              {#if target > 0}
                <div class="nutrient-row">
                  <div class="nr-label">
                    <span class="nr-name">{info.label}</span>
                    <span class="nr-values">{Math.round(current)}/{Math.round(target)} {info.unit}</span>
                  </div>
                  <div class="nr-bar">
                    <div class="nr-fill" style="width:{pct}%; background:{coverageColor(pct)}"></div>
                  </div>
                </div>
              {/if}
            {/each}
          </div>
        {:else}
          <!-- Per member breakdown -->
          {#each members as member (member.id)}
            <div class="member-section" transition:slide={{ duration: 200 }}>
              <h4 class="member-name">{member.name}</h4>
              <div class="nutrient-grid compact">
                {#each TRACKED_NUTRIENTS as nid}
                  {@const pct = memberCoveragePct(member.id, nid)}
                  {@const info = nutrientInfo(nid)}
                  {@const target = member.targets?.[nid] || 0}
                  {@const current = (memberNutrition[member.id] || {})[nid] || 0}
                  {#if target > 0}
                    <div class="nutrient-row">
                      <div class="nr-label">
                        <span class="nr-name">{info.label}</span>
                        <span class="nr-values">{Math.round(current)}/{Math.round(target)}</span>
                      </div>
                      <div class="nr-bar">
                        <div class="nr-fill" style="width:{pct}%; background:{coverageColor(pct)}"></div>
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            </div>
          {/each}
        {/if}
      </div>

      <!-- ─── Planning Insights ───────────────────────────────────── -->
      <div class="card planning-insights-card mb-3" transition:slide={{ duration: 200 }}>
        <div class="pi-header">
          <div class="pi-title-block">
            <span class="pi-eyebrow">Planning insights</span>
            <h3>{plannerSummary.headline}</h3>
            <p>{plannerSummary.mealsLogged} meal{plannerSummary.mealsLogged === 1 ? '' : 's'} planned · {plannerSummary.bestNextAction}</p>
          </div>
          <button class="analytics-action" on:click={() => push('/nutrients')} aria-label="View nutrition analytics">
            View analytics
          </button>
        </div>

        <div class="coverage-distribution" aria-label="Nutrient coverage distribution">
          <div class="distribution-item needs">
            <span class="di-count">{coverageDistribution.needs_attention}</span>
            <span class="di-label">Needs attention</span>
          </div>
          <div class="distribution-item watch">
            <span class="di-count">{coverageDistribution.watch}</span>
            <span class="di-label">Watch</span>
          </div>
          <div class="distribution-item track">
            <span class="di-count">{coverageDistribution.on_track}</span>
            <span class="di-label">On track</span>
          </div>
        </div>

        {#if planningRecommendations.length > 0}
          <div class="recommendation-list">
            {#each planningRecommendations as recommendation, idx (recommendation.id)}
              <div class="recommendation-row">
                <div class="rec-rank">{idx + 1}</div>
                <div class="rec-copy">
                  <span class="rec-title">{recommendation.label}</span>
                  <span class="rec-meta">{recommendation.status.label} · {recommendation.affectedLabel}</span>
                  <p>{recommendation.foodMove}</p>
                </div>
                <button
                  class="details-btn"
                  on:click={() => push('/nutrients')}
                  aria-label="View nutrition analytics details for {recommendation.label}"
                >
                  Details
                </button>
              </div>
            {/each}
          </div>
        {:else}
          <div class="planning-empty">
            <span class="material-symbols-rounded">check_circle</span>
            <span>Open analytics for the full nutrient breakdown when you need more detail.</span>
          </div>
        {/if}
      </div>

      <!-- ─── Gap Suggestions ─────────────────────────────────────── -->
      {#if gapSuggestions.length > 0}
        <div class="card suggestions-card mb-3" transition:slide={{ duration: 200 }}>
          <button class="suggestions-header" on:click={() => showGapSuggestions = !showGapSuggestions}>
            <span style="display:flex;align-items:center;gap:6px">
              <span style="font-size:16px">💡</span>
              <span>Food ideas for top planning gaps</span>
            </span>
            <span class="material-symbols-rounded suggestions-chevron" class:open={showGapSuggestions}>expand_more</span>
          </button>
          {#if showGapSuggestions}
            <div class="suggestions-body" transition:slide={{ duration: 150 }}>
              {#each gapSuggestions as { nutrient, suggestions }}
                {#if suggestions.length > 0}
                  <div class="suggestion-group">
                    <span class="sg-label">{NUTRIMENTS.find(n => n.id === nutrient.key)?.label || nutrient.key} (need {nutrient.gap}{NUTRIMENTS.find(n => n.id === nutrient.key)?.unit || ''} more)</span>
                    {#each suggestions as s}
                      <div class="suggestion-item">
                        <span class="si-text">{s.name} ({s.servingToFill}g)</span>
                        <button class="si-add-btn" on:click={() => addSuggestedFood(s)} title="Add to Lunch">+ Add</button>
                      </div>
                    {/each}
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- ─── Meal Slots ─────────────────────────────────────────── -->
      <div class="meals-list">
        {#each ['Breakfast', 'Lunch', 'Dinner', 'Snacks'] as mealType}
          {@const mealPlans = plans.filter(p => p.meal_type === mealType)}
          {@const mealItems = mealPlans.flatMap(p => p.items || [])}
          <div class="meal-group">
            <div class="mg-header">
              <div class="mg-title">
                <span class="material-symbols-rounded mg-icon">{MEAL_ICONS[mealType]}</span>
                <h3>{mealType}</h3>
                {#if mealItems.length > 0}
                  <span class="mg-count">{mealItems.length}</span>
                {/if}
              </div>
              <button class="add-btn" on:click={() => openFoodSearch(mealType)}>
                <span class="material-symbols-rounded">add</span>
              </button>
            </div>

            {#each mealPlans as plan (plan.id)}
              {#each (plan.items || []) as item, itemIdx}
                <div class="food-item card" transition:slide={{ duration: 150 }}>
                  <div class="fi-main">
                    <div class="fi-info">
                      <span class="fi-name">{item.name}</span>
                      <span class="fi-portion">{formatPortionLabel(item)}</span>
                      {#if item.nutrition?.calories}
                        <span class="fi-cal">{Math.round(item.nutrition.calories || 0)} kcal</span>
                      {/if}
                    </div>
                    <div class="fi-actions">
                      {#if members.length > 1}
                        <button class="icon-btn xs" on:click={() => openAllocEditor(plan, itemIdx)} title="Allocate to members">
                          <span class="material-symbols-rounded">group</span>
                        </button>
                      {/if}
                      <button class="icon-btn xs danger" on:click={() => removeItem(plan, itemIdx)} title="Remove">
                        <span class="material-symbols-rounded">close</span>
                      </button>
                    </div>
                  </div>
                  <!-- Member allocation pills -->
                  {#if members.length > 1 && item.member_allocations && Object.keys(item.member_allocations).length > 0}
                    <div class="fi-allocs">
                      {#each members as m}
                        {@const share = item.member_allocations[m.id]}
                        {#if share > 0}
                          <span class="alloc-pill">{m.name}: {Math.round(share * 100)}%</span>
                        {/if}
                      {/each}
                    </div>
                  {/if}
                </div>
              {/each}
            {:else}
              <div class="empty-slot" on:click={() => openFoodSearch(mealType)} on:keydown={(e) => e.key === 'Enter' && openFoodSearch(mealType)} role="button" tabindex="0">
                <span class="material-symbols-rounded">add_circle_outline</span>
                <span>Add food</span>
              </div>
            {/each}
          </div>
        {/each}
      </div>
    {/if}
    {/if}
  </div>
</div>

<!-- ─── Food Search Sheet ──────────────────────────────────────────────── -->
<Sheet bind:open={showFoodSearch} title="Add to {activeMealType}" height="full">
  {#if !stagedFood}
    <!-- Search input -->
    <div class="search-box">
      <span class="material-symbols-rounded">search</span>
      <input
        type="text"
        placeholder="Search foods..."
        bind:value={searchQuery}
        on:input={onSearchInput}
        autofocus
      />
      {#if searchQuery}
        <button class="icon-btn xs" on:click={() => { searchQuery = ''; searchResults = []; }}>
          <span class="material-symbols-rounded">close</span>
        </button>
      {/if}
    </div>

    {#if $vegetarianMode}
      <div class="veg-badge">
        <span class="material-symbols-rounded" style="font-size:14px; color:var(--diet-veg)">eco</span>
        Vegetarian filter active
      </div>
    {/if}

    <!-- Results list -->
    <div class="search-results">
      {#if searching}
        <div class="empty-state"><span class="material-symbols-rounded spin">progress_activity</span></div>
      {:else if searchQuery && searchResults.length === 0}
        <div class="empty-state">
          <span class="material-symbols-rounded" style="font-size:36px; color:var(--text-3)">search_off</span>
          <p>No foods found for "{searchQuery}"</p>
        </div>
      {:else}
        {#each searchResults as food (food.id || food.name)}
          <button class="search-item" on:click={() => selectFood(food)}>
            <div class="si-info">
              <span class="si-name">{food.name}</span>
              {#if food.brand}<span class="si-brand">{food.brand}</span>{/if}
            </div>
            <div class="si-cal">
              {Math.round(food.nutrition?.calories || 0)} kcal
              <span class="si-per">per {food.portion || 100}{food.unit || 'g'}</span>
            </div>
          </button>
        {/each}
      {/if}
    </div>
  {:else}
    <!-- Staged food: quantity picker -->
    <div class="staged-food">
      <button class="staged-back" on:click={cancelStaged}>
        <span class="material-symbols-rounded">arrow_back</span>
        Back to search
      </button>

      <div class="staged-header">
        <h3>{stagedFood.name}</h3>
        {#if stagedFood.brand}<span class="text-3">{stagedFood.brand}</span>{/if}
      </div>

      <div class="staged-controls">
        <label class="input-group">
          <span>Portion</span>
          <div class="input-row">
            <input type="number" bind:value={stagedPortion} min="1" step="10" />
            <select bind:value={stagedUnit}>
              <option value="g">g</option>
              <option value="ml">ml</option>
              <option value="oz">oz</option>
              <option value="cup">cup</option>
              <option value="tbsp">tbsp</option>
              <option value="tsp">tsp</option>
            </select>
          </div>
        </label>
        <label class="input-group">
          <span>Servings</span>
          <div class="qty-row">
            <button class="qty-btn" on:click={() => stagedServings = Math.max(0.5, stagedServings - 0.5)}>−</button>
            <span class="qty-val">{stagedServings}</span>
            <button class="qty-btn" on:click={() => stagedServings += 0.5}>+</button>
          </div>
        </label>
      </div>

      <!-- Nutrition preview -->
      <div class="staged-preview">
        <h4>Nutrition</h4>
        <div class="sp-grid">
          {#if stagedNutritionPreview.calories}
            <div class="sp-item"><span class="sp-val">{Math.round(stagedNutritionPreview.calories)}</span><span class="sp-lbl">kcal</span></div>
          {/if}
          {#if stagedNutritionPreview.proteins}
            <div class="sp-item"><span class="sp-val">{Math.round(stagedNutritionPreview.proteins)}g</span><span class="sp-lbl">Protein</span></div>
          {/if}
          {#if stagedNutritionPreview.carbohydrates}
            <div class="sp-item"><span class="sp-val">{Math.round(stagedNutritionPreview.carbohydrates)}g</span><span class="sp-lbl">Carbs</span></div>
          {/if}
          {#if stagedNutritionPreview.fat}
            <div class="sp-item"><span class="sp-val">{Math.round(stagedNutritionPreview.fat)}g</span><span class="sp-lbl">Fat</span></div>
          {/if}
          {#if stagedNutritionPreview.fiber}
            <div class="sp-item"><span class="sp-val">{Math.round(stagedNutritionPreview.fiber)}g</span><span class="sp-lbl">Fiber</span></div>
          {/if}
        </div>
      </div>

      <button class="primary-btn full-width mt-3" on:click={addStagedFood}>
        <span class="material-symbols-rounded">add</span>
        Add to {activeMealType}
      </button>
    </div>
  {/if}
</Sheet>

<!-- ─── Member Allocation Sheet ────────────────────────────────────────── -->
<Sheet bind:open={showAllocSheet} title="Allocate Portions">
  <div class="alloc-editor">
    <p class="alloc-desc">Set each member's share of this food item. Values should total ~100%.</p>
    {#each members as member (member.id)}
      <div class="alloc-row">
        <span class="alloc-name">{member.name}</span>
        <div class="alloc-controls">
          <button class="qty-btn" on:click={() => adjustAlloc(member.id, -0.1)}>−</button>
          <span class="alloc-val">{Math.round((allocEdits[member.id] || 0) * 100)}%</span>
          <button class="qty-btn" on:click={() => adjustAlloc(member.id, 0.1)}>+</button>
        </div>
      </div>
    {/each}
    <div class="alloc-total" class:over={Math.round(Object.values(allocEdits).reduce((s, v) => s + v, 0) * 100) > 100}>
      Total: {Math.round(Object.values(allocEdits).reduce((s, v) => s + v, 0) * 100)}%
    </div>
    <button class="primary-btn full-width mt-3" on:click={saveAllocations}>
      Save Allocation
    </button>
  </div>
</Sheet>

<style>
  /* ─── View Toggle ────────────────────────────────────────────── */
  .view-toggle-bar {
    display: flex; align-items: center; justify-content: center;
    padding: 8px 16px 4px; background: var(--surface-1);
  }
  .view-toggle {
    display: flex; gap: 4px;
    background: var(--surface-2); border-radius: var(--radius-full);
    padding: 3px;
  }
  .vt-btn {
    display: flex; align-items: center; gap: 4px;
    padding: 6px 14px; border-radius: var(--radius-full);
    background: none; border: none;
    color: var(--text-2); font-size: 13px; font-weight: 500;
    cursor: pointer; transition: all var(--dur-fast);
  }
  .vt-btn.active {
    background: var(--accent-dim); color: var(--accent);
    border: 1px solid var(--accent);
  }
  .vt-btn:not(.active):hover { color: var(--text-1); }

  /* ─── Week Grid (desktop ≥768px) ─────────────────────────────── */
  .week-grid {
    display: none;
    grid-template-columns: repeat(7, 1fr);
    gap: 6px;
    margin-bottom: 16px;
  }
  @media (min-width: 768px) {
    .week-grid { display: grid; }
    .week-list { display: none !important; }
  }

  .week-col {
    display: flex; flex-direction: column;
    background: var(--surface-1); border: 1px solid var(--border);
    border-radius: var(--radius-md); cursor: pointer;
    transition: border-color var(--dur-fast), box-shadow var(--dur-fast);
    min-height: 140px;
  }
  .week-col:hover { border-color: var(--border-strong); box-shadow: var(--shadow-sm); }
  .week-col.today { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent-dim); }
  .week-col.empty { opacity: 0.7; }

  .wc-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 10px 4px; border-bottom: 1px solid var(--border);
  }
  .wc-day { font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text-2); }
  .wc-date { font-size: 11px; color: var(--text-3); }
  .week-col.today .wc-day { color: var(--accent); }

  .wc-body { flex: 1; padding: 6px 8px; display: flex; flex-direction: column; gap: 3px; }
  .wc-empty {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    flex: 1; gap: 4px; color: var(--text-3); font-size: 11px;
  }
  .wc-meal { display: flex; flex-direction: column; gap: 0; }
  .wc-meal-type { font-size: 10px; font-weight: 600; color: var(--text-2); }
  .wc-meal-items {
    font-size: 11px; color: var(--text-1);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .wc-footer {
    display: flex; gap: 4px; padding: 6px 8px;
    border-top: 1px solid var(--border); flex-wrap: wrap;
  }
  .wc-pill {
    font-size: 10px; font-weight: 600;
    padding: 2px 5px; border-radius: var(--radius-xs);
    background: var(--surface-2);
  }
  .wc-pill.empty-pill { color: var(--text-3); }

  /* ─── Week List (mobile <768px) ──────────────────────────────── */
  .week-list {
    display: flex; flex-direction: column; gap: 8px;
    margin-bottom: 16px;
  }
  @media (min-width: 768px) {
    .week-list { display: none; }
  }

  .wl-card {
    background: var(--surface-1); border: 1px solid var(--border);
    border-radius: var(--radius-md); overflow: hidden;
  }
  .wl-card.today { border-color: var(--accent); }

  .wl-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 12px; background: none; border: none; width: 100%;
    cursor: pointer; color: var(--text-1); text-align: left;
  }
  .wl-day-info { display: flex; align-items: baseline; gap: 8px; }
  .wl-day { font-size: 14px; font-weight: 600; }
  .wl-date { font-size: 12px; color: var(--text-3); }
  .wl-summary { display: flex; align-items: center; gap: 8px; }
  .wl-item-count { font-size: 11px; color: var(--text-3); }
  .wl-empty-label { font-size: 12px; color: var(--text-3); font-style: italic; }
  .wl-chevron { font-size: 20px; color: var(--text-3); transition: transform var(--dur-fast); }
  .wl-chevron.expanded { transform: rotate(180deg); }

  .wl-body { padding: 0 12px 12px; }
  .wl-meal-row { display: flex; gap: 6px; padding: 3px 0; align-items: baseline; }
  .wl-meal-type { font-size: 12px; font-weight: 600; color: var(--text-2); min-width: 60px; }
  .wl-meal-items { font-size: 12px; color: var(--text-1); }
  .wl-plan-btn, .wl-edit-btn {
    display: flex; align-items: center; gap: 4px;
    padding: 8px 12px; margin-top: 8px;
    border-radius: var(--radius-md); border: 1px dashed var(--border-strong);
    background: none; color: var(--accent); font-size: 12px;
    cursor: pointer; width: 100%; justify-content: center;
  }
  .wl-edit-btn { border-style: solid; border-color: var(--accent-dim); }

  /* ─── Week Summary ───────────────────────────────────────────── */
  .week-summary-card { padding: 12px 16px; }
  .ws-title { font-size: 14px; font-weight: 600; margin: 0 0 8px; }
  .ws-pills { display: flex; flex-wrap: wrap; gap: 8px; }
  .ws-pill {
    font-size: 12px; font-weight: 600;
    padding: 4px 10px; border-radius: var(--radius-full);
    background: var(--surface-2);
  }

  /* ─── Date bar ───────────────────────────────────────────────── */
  .diary-date-bar {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 16px; background: var(--surface-1);
    border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 10;
  }
  .date-lbl {
    display: flex; flex-direction: column; align-items: center;
    gap: 2px; background: none; border: none; color: var(--text-1);
    cursor: pointer; padding: 4px 12px; border-radius: var(--radius-md);
    transition: background var(--dur-fast);
  }
  .date-lbl:active { background: var(--surface-2); }
  .date-sub { font-size: 11px; color: var(--text-3); font-weight: 400; }

  /* ─── Coverage card ──────────────────────────────────────────── */
  .coverage-card { padding: 16px; }
  .coverage-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 12px;
  }
  .coverage-header h3 { font-size: 15px; font-weight: 600; margin: 0; }
  .pill-toggle {
    display: flex; align-items: center; gap: 4px;
    padding: 4px 10px; border-radius: var(--radius-full);
    background: var(--surface-2); border: 1px solid var(--border);
    color: var(--text-2); font-size: 12px; cursor: pointer;
    transition: all var(--dur-fast);
  }
  .pill-toggle.active {
    background: var(--accent-dim); border-color: var(--accent);
    color: var(--accent);
  }

  .nutrient-grid { display: flex; flex-direction: column; gap: 8px; }
  .nutrient-grid.compact { gap: 5px; }
  .nutrient-row { display: flex; flex-direction: column; gap: 2px; }
  .nr-label {
    display: flex; justify-content: space-between; align-items: baseline;
    font-size: 12px;
  }
  .nr-name { color: var(--text-2); font-weight: 500; }
  .nr-values { color: var(--text-3); font-size: 11px; }
  .nr-bar {
    height: 5px; background: var(--surface-3); border-radius: 3px;
    overflow: hidden;
  }
  .nr-fill {
    height: 100%; border-radius: 3px;
    transition: width 0.3s ease;
  }

  .member-section { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border); }
  .member-name { font-size: 13px; font-weight: 600; margin: 0 0 8px; color: var(--accent); }

  /* ─── Planning Insights ──────────────────────────────────────── */
  .planning-insights-card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
    background: var(--surface-1);
    border: 1px solid var(--border);
  }
  .pi-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 14px;
  }
  .pi-title-block { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .pi-eyebrow {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
  }
  .pi-title-block h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 700;
    color: var(--text-1);
    line-height: 1.25;
  }
  .pi-title-block p {
    margin: 0;
    font-size: 12px;
    color: var(--text-2);
    line-height: 1.4;
  }
  .analytics-action,
  .details-btn {
    min-height: 44px;
    border-radius: var(--radius-full);
    border: 1px solid var(--accent);
    background: var(--accent-dim);
    color: var(--accent);
    font-weight: 700;
    cursor: pointer;
    transition: transform var(--dur-fast), border-color var(--dur-fast), background var(--dur-fast);
  }
  .analytics-action {
    flex: 0 0 auto;
    padding: 0 16px;
    font-size: 12px;
  }
  .analytics-action:active,
  .details-btn:active { transform: scale(0.97); }
  .coverage-distribution {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .distribution-item {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 10px;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    border: 1px solid var(--border);
  }
  .di-count {
    font-size: 20px;
    font-weight: 800;
    line-height: 1;
    color: var(--text-1);
  }
  .di-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-2);
    line-height: 1.2;
  }
  .distribution-item.needs { border-color: var(--danger); }
  .distribution-item.watch { border-color: var(--warning); }
  .distribution-item.track { border-color: var(--success); }
  .recommendation-list { display: flex; flex-direction: column; gap: 8px; }
  .recommendation-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 10px;
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    border: 1px solid var(--border);
  }
  .rec-rank {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-full);
    background: var(--surface-3);
    color: var(--text-2);
    font-size: 12px;
    font-weight: 800;
  }
  .rec-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .rec-title { font-size: 13px; font-weight: 700; color: var(--text-1); }
  .rec-meta { font-size: 11px; font-weight: 600; color: var(--text-3); }
  .rec-copy p {
    margin: 2px 0 0;
    font-size: 12px;
    color: var(--text-2);
    line-height: 1.35;
  }
  .details-btn {
    padding: 0 14px;
    font-size: 12px;
  }
  .planning-empty {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--text-2);
    font-size: 12px;
    line-height: 1.4;
  }
  .planning-empty .material-symbols-rounded { color: var(--success); font-size: 18px; }
  @media (max-width: 520px) {
    .pi-header { flex-direction: column; }
    .analytics-action { width: 100%; }
    .coverage-distribution { grid-template-columns: 1fr; }
    .recommendation-row { grid-template-columns: auto minmax(0, 1fr); }
    .details-btn { grid-column: 1 / -1; width: 100%; }
  }

  /* ─── Gap Suggestions ────────────────────────────────────────── */
  .suggestions-card {
    padding: 0;
    background: var(--surface-1);
    border: 1px solid var(--border);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
  .suggestions-header {
    display: flex; align-items: center; justify-content: space-between;
    width: 100%; min-height: 48px; padding: 12px 16px;
    background: none; border: none; color: var(--text-1);
    font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .suggestions-chevron {
    font-size: 20px; color: var(--text-3);
    transition: transform 0.2s ease;
  }
  .suggestions-chevron.open { transform: rotate(180deg); }
  .suggestions-body {
    padding: 0 16px 14px; display: flex; flex-direction: column; gap: 12px;
  }
  .suggestion-group { display: flex; flex-direction: column; gap: 4px; }
  .sg-label {
    font-size: 11px; font-weight: 600; color: var(--text-2);
    text-transform: uppercase; letter-spacing: 0.02em;
  }
  .suggestion-item {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 8px; border-radius: var(--radius-md);
    background: var(--surface-2);
  }
  .si-text { font-size: 12px; color: var(--text-1); }
  .si-add-btn {
    min-height: 44px;
    min-width: 56px;
    font-size: 11px; font-weight: 600; padding: 0 12px;
    border-radius: var(--radius-full); border: 1px solid var(--accent);
    background: rgba(79, 255, 176, 0.1); color: var(--accent);
    cursor: pointer; white-space: nowrap;
    transition: all var(--dur-fast);
  }
  .si-add-btn:active { transform: scale(0.95); background: rgba(79, 255, 176, 0.2); }

  /* ─── Meal groups ────────────────────────────────────────────── */
  .meals-list { display: flex; flex-direction: column; gap: 20px; padding-bottom: 20px; }
  .meal-group {}
  .mg-header {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 8px;
  }
  .mg-title { display: flex; align-items: center; gap: 8px; }
  .mg-title h3 { margin: 0; font-size: 16px; font-weight: 600; }
  .mg-icon { font-size: 20px; color: var(--accent); }
  .mg-count {
    font-size: 11px; font-weight: 600; color: var(--accent-text);
    background: var(--accent); border-radius: var(--radius-full);
    width: 18px; height: 18px; display: flex; align-items: center; justify-content: center;
  }
  .add-btn {
    display: flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border-radius: var(--radius-full);
    background: var(--accent-dim); border: 1px solid var(--accent);
    color: var(--accent); cursor: pointer;
    transition: transform var(--dur-fast);
  }
  .add-btn:active { transform: scale(0.9); }

  /* ─── Food items ─────────────────────────────────────────────── */
  .food-item { padding: 10px 12px; margin-bottom: 6px; }
  .fi-main { display: flex; justify-content: space-between; align-items: center; }
  .fi-info { display: flex; flex-direction: column; gap: 1px; }
  .fi-name { font-size: 14px; font-weight: 600; }
  .fi-portion { font-size: 12px; color: var(--text-3); }
  .fi-cal { font-size: 12px; color: var(--accent); font-weight: 500; }
  .fi-actions { display: flex; gap: 4px; align-items: center; }
  .fi-allocs { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .alloc-pill {
    font-size: 10px; padding: 2px 6px; border-radius: var(--radius-full);
    background: var(--surface-2); color: var(--text-2);
    border: 1px solid var(--border);
  }

  .empty-slot {
    display: flex; align-items: center; gap: 6px;
    padding: 12px 14px; border-radius: var(--radius-lg);
    border: 1px dashed var(--border-strong); color: var(--text-3);
    font-size: 13px; cursor: pointer;
    transition: all var(--dur-fast);
  }
  .empty-slot:hover, .empty-slot:focus-visible {
    border-color: var(--accent); color: var(--accent);
    background: var(--accent-dim);
  }
  .empty-slot .material-symbols-rounded { font-size: 18px; }

  /* ─── Food search ────────────────────────────────────────────── */
  .search-box {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px; border-radius: var(--radius-lg);
    background: var(--surface-2); border: 1px solid var(--border);
    margin-bottom: 10px;
  }
  .search-box .material-symbols-rounded { color: var(--text-3); font-size: 20px; }
  .search-box input {
    flex: 1; background: none; border: none; outline: none;
    color: var(--text-1); font-size: 15px;
  }
  .search-box input::placeholder { color: var(--text-3); }

  .veg-badge {
    display: flex; align-items: center; gap: 4px;
    font-size: 11px; color: var(--diet-veg); margin-bottom: 10px;
    padding: 4px 8px; background: var(--diet-veg-dim);
    border-radius: var(--radius-md); width: fit-content;
  }

  .search-results { display: flex; flex-direction: column; }
  .search-item {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 4px; border: none; background: none;
    border-bottom: 1px solid var(--border); cursor: pointer;
    text-align: left; color: var(--text-1);
    transition: background var(--dur-fast);
  }
  .search-item:active { background: var(--surface-2); }
  .si-info { display: flex; flex-direction: column; gap: 1px; }
  .si-name { font-size: 14px; font-weight: 500; }
  .si-brand { font-size: 12px; color: var(--text-3); }
  .si-cal { font-size: 13px; color: var(--accent); font-weight: 500; text-align: right; }
  .si-per { display: block; font-size: 10px; color: var(--text-3); font-weight: 400; }

  /* ─── Staged food (quantity picker) ──────────────────────────── */
  .staged-food { padding-top: 4px; }
  .staged-back {
    display: flex; align-items: center; gap: 4px;
    background: none; border: none; color: var(--accent);
    font-size: 13px; cursor: pointer; padding: 4px 0; margin-bottom: 12px;
  }
  .staged-back .material-symbols-rounded { font-size: 18px; }
  .staged-header { margin-bottom: 16px; }
  .staged-header h3 { margin: 0; font-size: 18px; }

  .staged-controls {
    display: flex; gap: 12px; margin-bottom: 16px;
  }
  .staged-controls .input-group { flex: 1; }
  .staged-controls .input-group span { font-size: 12px; color: var(--text-2); margin-bottom: 4px; display: block; }
  .input-row { display: flex; gap: 6px; }
  .input-row input {
    flex: 1; padding: 8px 10px; border-radius: var(--radius-md);
    background: var(--surface-2); border: 1px solid var(--border);
    color: var(--text-1); font-size: 14px; min-width: 0;
  }
  .input-row select {
    padding: 8px 6px; border-radius: var(--radius-md);
    background: var(--surface-2); border: 1px solid var(--border);
    color: var(--text-1); font-size: 13px;
  }

  .qty-row {
    display: flex; align-items: center; gap: 12px;
    justify-content: center;
  }
  .qty-btn {
    width: 44px; height: 44px; min-width: 44px; min-height: 44px; border-radius: var(--radius-full);
    background: var(--surface-2); border: 1px solid var(--border);
    color: var(--text-1); font-size: 18px; font-weight: 600;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    transition: all var(--dur-fast);
  }
  .qty-btn:active { transform: scale(0.9); background: var(--accent-dim); }
  .qty-val { font-size: 18px; font-weight: 600; min-width: 32px; text-align: center; }

  .staged-preview { margin-top: 4px; }
  .staged-preview h4 { font-size: 13px; color: var(--text-2); margin: 0 0 8px; }
  .sp-grid { display: flex; flex-wrap: wrap; gap: 8px; }
  .sp-item {
    display: flex; flex-direction: column; align-items: center;
    padding: 8px 12px; border-radius: var(--radius-md);
    background: var(--surface-2); min-width: 56px;
  }
  .sp-val { font-size: 15px; font-weight: 600; }
  .sp-lbl { font-size: 10px; color: var(--text-3); }

  .full-width { width: 100%; }

  /* ─── Allocation editor ──────────────────────────────────────── */
  .alloc-editor { padding-top: 4px; }
  .alloc-desc { font-size: 13px; color: var(--text-2); margin: 0 0 16px; }
  .alloc-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 10px 0; border-bottom: 1px solid var(--border);
  }
  .alloc-name { font-size: 14px; font-weight: 500; }
  .alloc-controls { display: flex; align-items: center; gap: 10px; }
  .alloc-val { font-size: 15px; font-weight: 600; min-width: 40px; text-align: center; }
  .alloc-total {
    margin-top: 12px; text-align: center;
    font-size: 13px; font-weight: 600; color: var(--text-2);
  }
  .alloc-total.over { color: var(--danger); }

  /* ─── Utilities ──────────────────────────────────────────────── */
  .mb-3 { margin-bottom: 12px; }
  .mt-3 { margin-top: 12px; }
  .empty-state {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 8px; padding: 32px 16px;
    text-align: center; color: var(--text-3);
  }
  .icon-btn.xs {
    width: 44px; height: 44px; min-width: 44px; min-height: 44px; border-radius: var(--radius-full);
    display: flex; align-items: center; justify-content: center;
  }
  .icon-btn.xs .material-symbols-rounded { font-size: 18px; }
  .icon-btn.xs.danger { color: var(--danger); }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to   { transform: rotate(360deg); }
  }
  .spin { animation: spin 1s linear infinite; }
</style>
