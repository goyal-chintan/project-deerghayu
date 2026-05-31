import { NUTRIMENTS, Nutrition } from './nutrition.js';

export const ANALYTICS_NUTRIENT_IDS = [
  'calories',
  'proteins',
  'carbohydrates',
  'fat',
  'fiber',
  'iron',
  'calcium',
  'zinc',
  'vitamin-a',
  'vitamin-c',
  'vitamin-d',
  'b12',
  'b9',
];

export const STATUS_THRESHOLDS = {
  needs_attention: 60,
  watch: 80,
};

const MACRO_DENSITY = {
  fat: 9,
  'saturated-fat': 9,
  carbohydrates: 4,
  sugars: 4,
  proteins: 4,
};

const FOOD_MOVES = {
  iron: 'Add lentils or beans',
  calcium: 'Add curd or fortified milk',
  fiber: 'Add fruit or whole grains',
  proteins: 'Add dal, paneer, eggs, or tofu',
  carbohydrates: 'Add rice, roti, or potatoes',
  fat: 'Add nuts, seeds, or oil',
  'vitamin-a': 'Add carrots or leafy greens',
  'vitamin-c': 'Add citrus or amla',
  'vitamin-d': 'Add fortified dairy or eggs',
  b12: 'Add dairy, eggs, or fortified foods',
  b9: 'Add leafy greens or legumes',
  zinc: 'Add seeds, legumes, or dairy',
  calories: 'Increase meal portions',
};

function nutrientInfo(id) {
  return NUTRIMENTS.find(n => n.id === id) || { id, label: id, unit: '' };
}

function safeNumber(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function formatMemberName(member, currentUser) {
  if (member?.isMe) return currentUser?.full_name || currentUser?.name || 'Myself';
  return member?.name || 'Family member';
}

function allMembers(members = [], currentUser = null) {
  return [
    { id: 'me', isMe: true, name: formatMemberName({ isMe: true }, currentUser), targets: null },
    ...(members || []),
  ];
}

export function getCoverageStatus(coveragePct) {
  if (coveragePct < STATUS_THRESHOLDS.needs_attention) {
    return { key: 'needs_attention', label: 'Needs attention' };
  }
  if (coveragePct < STATUS_THRESHOLDS.watch) {
    return { key: 'watch', label: 'Watch' };
  }
  return { key: 'on_track', label: 'On track' };
}

export function getGoalTarget(nutrientId, member, goals = {}) {
  if (!member?.isMe) return safeNumber(member?.targets?.[nutrientId]);

  const goal = goals?.[nutrientId];
  if (!goal) return 0;

  const raw = goal.sharedGoal === false
    ? safeNumber(goal.days?.[new Date().getDay()] ?? goal.max ?? goal.min)
    : safeNumber(goal.max ?? goal.min);

  if (!raw) return 0;
  if (!goal.isPercent) return raw;

  const density = MACRO_DENSITY[nutrientId];
  if (!density) return raw;

  const calorieGoal = safeNumber(goals.calories?.max ?? goals.calories?.min) || 2000;
  return Math.round((calorieGoal * raw) / 100 / density);
}

export function getMealName(item) {
  return item?.meal || item?.meal_type || 'Meal';
}

export function calculateMemberTotals({ members = [], currentUser = null, items = [] } = {}) {
  const people = allMembers(members, currentUser);
  const totals = Object.fromEntries(
    people.map(member => [
      member.id,
      Object.fromEntries(ANALYTICS_NUTRIENT_IDS.map(id => [id, 0])),
    ]),
  );

  for (const item of items || []) {
    const memberId = item.member_id || 'me';
    if (!totals[memberId]) continue;
    const calculated = Nutrition.calculate(item);
    for (const id of ANALYTICS_NUTRIENT_IDS) {
      totals[memberId][id] += safeNumber(calculated[id]);
    }
  }

  return { people, totals };
}

export function summarizeFamilyNutrition({
  members = [],
  currentUser = null,
  goals = {},
  items = [],
  maxRecommendations = 3,
} = {}) {
  const { people, totals } = calculateMemberTotals({ members, currentUser, items });
  const mealsLogged = new Set((items || []).map(getMealName).filter(Boolean)).size;
  const memberSummaries = [];
  const analyticsRows = [];

  for (const member of people) {
    const rows = [];
    for (const id of ANALYTICS_NUTRIENT_IDS) {
      const target = getGoalTarget(id, member, goals);
      if (target <= 0) continue;
      const current = totals[member.id]?.[id] || 0;
      const rawCoveragePct = (current / target) * 100;
      const coveragePct = Math.min(100, Math.round(rawCoveragePct));
      const info = nutrientInfo(id);
      const status = getCoverageStatus(rawCoveragePct);
      rows.push({ id, label: info.label, unit: info.unit, current, target, coveragePct, status });
    }
    memberSummaries.push({
      id: member.id,
      name: formatMemberName(member, currentUser),
      rows,
      needsAttentionCount: rows.filter(row => row.status.key === 'needs_attention').length,
    });
  }

  for (const id of ANALYTICS_NUTRIENT_IDS) {
    const info = nutrientInfo(id);
    const affected = [];
    let currentTotal = 0;
    let targetTotal = 0;

    for (const member of memberSummaries) {
      const row = member.rows.find(memberRow => memberRow.id === id);
      if (!row) continue;
      currentTotal += row.current;
      targetTotal += row.target;
      if (row.status.key !== 'on_track') {
        affected.push({ name: member.name, coveragePct: row.coveragePct });
      }
    }

    if (targetTotal <= 0) continue;
    const rawCoveragePct = (currentTotal / targetTotal) * 100;
    const coveragePct = Math.min(100, Math.round(rawCoveragePct));
    const status = getCoverageStatus(rawCoveragePct);
    analyticsRows.push({
      id,
      label: info.label,
      unit: info.unit,
      current: currentTotal,
      target: targetTotal,
      coveragePct,
      status,
      affected,
      affectedLabel: affected.length ? `${affected.length} member${affected.length === 1 ? '' : 's'}` : 'None',
      trend: 'Today',
      foodMove: FOOD_MOVES[id] || 'Open analytics for food ideas',
    });
  }

  analyticsRows.sort((a, b) => {
    if (a.status.key !== b.status.key) {
      const rank = { needs_attention: 0, watch: 1, on_track: 2 };
      return rank[a.status.key] - rank[b.status.key];
    }
    return a.coveragePct - b.coveragePct;
  });

  const recommendations = mealsLogged === 0
    ? []
    : analyticsRows.filter(row => row.status.key !== 'on_track').slice(0, maxRecommendations);

  const overallCoverage = analyticsRows.length
    ? Math.round(analyticsRows.reduce((sum, row) => sum + row.coveragePct, 0) / analyticsRows.length)
    : 0;

  const dataState = mealsLogged === 0
    ? 'no_meals'
    : analyticsRows.length === 0
      ? 'missing_targets'
      : people.length <= 1 && members.length === 0
        ? 'no_family'
        : 'ready';

  const headline = dataState === 'no_meals'
    ? 'Log a meal to analyze nutrition'
    : dataState === 'no_family'
      ? 'Add family members to analyze nutrition'
      : dataState === 'missing_targets'
      ? 'Set nutrition targets to analyze coverage'
      : recommendations.length > 0
        ? `${recommendations.length} high-impact improvement${recommendations.length === 1 ? '' : 's'} available`
        : 'Family nutrition is on track';

  return {
    dataState,
    headline,
    mealsLogged,
    overallCoverage,
    bestNextAction: recommendations[0]?.foodMove || (mealsLogged === 0 ? 'Log first meal' : dataState === 'no_family' ? 'Add family member' : 'Review analytics'),
    members: memberSummaries,
    analyticsRows,
    recommendations,
  };
}

export function buildAnalyticsRows(summary) {
  return [...(summary?.analyticsRows || [])];
}

export function buildCoverageDistribution(rows = []) {
  return rows.reduce(
    (acc, row) => {
      const key = row?.status?.key;
      if (Object.hasOwn(acc, key)) acc[key] += 1;
      return acc;
    },
    { needs_attention: 0, watch: 0, on_track: 0 },
  );
}
