import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANALYTICS_NUTRIENT_IDS,
  STATUS_THRESHOLDS,
  getCoverageStatus,
  getGoalTarget,
  getMealName,
  calculateMemberTotals,
  summarizeFamilyNutrition,
  buildAnalyticsRows,
  buildCoverageDistribution,
} from './familyNutrition.js';

const goals = {
  calories: { min: 2000, max: 2000 },
  proteins: { min: 20, max: 20, isPercent: true },
  carbohydrates: { min: 50, max: 50, isPercent: true },
  fat: { min: 30, max: 30, isPercent: true },
  iron: { min: 18, max: 18 },
  calcium: { min: 1000, max: 1000 },
  fiber: { min: 30, max: 30 },
};

const members = [
  {
    id: 'child-1',
    name: 'Aarav',
    targets: { calories: 1200, iron: 10, calcium: 700, fiber: 18, proteins: 40 },
  },
  {
    id: 'adult-1',
    name: 'Mira',
    targets: { calories: 1800, iron: 18, calcium: 1000, fiber: 28, proteins: 65 },
  },
];

const items = [
  {
    name: 'Breakfast dal',
    meal: 'Breakfast',
    member_id: 'child-1',
    quantity: 1,
    nutrition: { calories: 350, iron: 5, calcium: 120, fiber: 9, proteins: 18 },
  },
  {
    name: 'Lunch thali',
    meal: 'Lunch',
    member_id: 'adult-1',
    quantity: 1,
    nutrition: { calories: 700, iron: 8, calcium: 250, fiber: 12, proteins: 30 },
  },
];

test('getCoverageStatus uses one threshold model', () => {
  assert.deepEqual(STATUS_THRESHOLDS, { needs_attention: 60, watch: 80 });
  assert.deepEqual(getCoverageStatus(59), { key: 'needs_attention', label: 'Needs attention' });
  assert.deepEqual(getCoverageStatus(60), { key: 'watch', label: 'Watch' });
  assert.deepEqual(getCoverageStatus(79), { key: 'watch', label: 'Watch' });
  assert.deepEqual(getCoverageStatus(80), { key: 'on_track', label: 'On track' });
});

test('getGoalTarget converts percent macro goals for current user and uses member targets for family', () => {
  assert.equal(getGoalTarget('proteins', { id: 'me', isMe: true }, goals), 100);
  assert.equal(getGoalTarget('carbohydrates', { id: 'me', isMe: true }, goals), 250);
  assert.equal(getGoalTarget('fat', { id: 'me', isMe: true }, goals), 67);
  assert.equal(getGoalTarget('iron', { id: 'me', isMe: true }, goals), 18);
  assert.equal(getGoalTarget('calcium', members[0], goals), 700);
  assert.equal(getGoalTarget('proteins', members[1], goals), 65);
});

test('summarizeFamilyNutrition returns calm main-screen summary, members, meals logged, and top recommendations', () => {
  const summary = summarizeFamilyNutrition({
    members,
    currentUser: { full_name: 'Chintan' },
    goals,
    items,
    maxRecommendations: 3,
  });

  assert.equal(summary.dataState, 'ready');
  assert.equal(summary.members.length, 3);
  assert.deepEqual(summary.members.map(member => member.name), ['Chintan', 'Aarav', 'Mira']);
  assert.equal(summary.mealsLogged, 2);
  assert.equal(summary.recommendations.length, 3);
  assert.equal(summary.recommendations[0].id, 'carbohydrates');
  assert.equal(summary.recommendations[0].status.key, 'needs_attention');
  assert.equal(summary.headline, '3 high-impact improvements available');
  assert.equal(summary.bestNextAction, 'Add rice, roti, or potatoes');
});

test('summarizeFamilyNutrition distinguishes no meals from alarming deficits', () => {
  const summary = summarizeFamilyNutrition({
    members,
    currentUser: { full_name: 'Chintan' },
    goals,
    items: [],
  });

  assert.equal(summary.dataState, 'no_meals');
  assert.equal(summary.mealsLogged, 0);
  assert.equal(summary.recommendations.length, 0);
  assert.equal(summary.headline, 'Log a meal to analyze nutrition');
  assert.equal(summary.bestNextAction, 'Log first meal');
  assert.equal(summary.analyticsRows.length, 0);
  assert.deepEqual(buildCoverageDistribution(summary.analyticsRows), {
    needs_attention: 0,
    watch: 0,
    on_track: 0,
  });
  assert.ok(summary.members.every(member => member.needsAttentionCount === 0));

  const noFamilySummary = summarizeFamilyNutrition({
    members: [],
    currentUser: { full_name: 'Chintan' },
    goals,
    items: [],
  });
  assert.equal(noFamilySummary.dataState, 'no_meals');
  assert.equal(noFamilySummary.headline, 'Log a meal to analyze nutrition');
});

test('getMealName and calculateMemberTotals use real nutrition calculation and default current user items', () => {
  assert.equal(getMealName({ meal: 'Breakfast', meal_type: 'Lunch' }), 'Breakfast');
  assert.equal(getMealName({ meal_type: 'Snacks' }), 'Snacks');
  assert.equal(getMealName({}), 'Meal');

  const { people, totals } = calculateMemberTotals({
    members: [members[0]],
    currentUser: { full_name: 'Chintan' },
    items: [
      { name: 'Apple', quantity: 2, nutrition: { calories: 50, iron: 1 } },
      { name: 'Kid snack', member_id: 'child-1', quantity: 3, nutrition: { calories: 40, iron: 0.5 } },
    ],
  });

  assert.deepEqual(people.map(person => person.id), ['me', 'child-1']);
  assert.equal(totals.me.calories, 100);
  assert.equal(totals.me.iron, 2);
  assert.equal(totals['child-1'].calories, 120);
  assert.equal(totals['child-1'].iron, 1.5);
});

test('summarizeFamilyNutrition classifies threshold status from exact unrounded coverage', () => {
  const summary = summarizeFamilyNutrition({
    members: [{ id: 'child-1', name: 'Aarav', targets: { calories: 1000 } }],
    currentUser: { full_name: 'Chintan' },
    goals: {},
    items: [
      { name: 'Nearly enough', meal: 'Lunch', member_id: 'child-1', quantity: 1, nutrition: { calories: 596 } },
    ],
  });

  const calories = buildAnalyticsRows(summary).find(row => row.id === 'calories');
  assert.equal(calories.coveragePct, 60);
  assert.equal(calories.status.key, 'needs_attention');
});

test('buildAnalyticsRows returns exact percentages, status, affected members, and food moves', () => {
  const summary = summarizeFamilyNutrition({
    members,
    currentUser: { full_name: 'Chintan' },
    goals,
    items,
  });
  const rows = buildAnalyticsRows(summary);

  assert.ok(rows.every(row => ANALYTICS_NUTRIENT_IDS.includes(row.id)));

  const calories = rows.find(row => row.id === 'calories');
  assert.equal(calories.coveragePct, 21);
  assert.deepEqual(calories.status, { key: 'needs_attention', label: 'Needs attention' });
  assert.deepEqual(calories.affected.map(member => member.name), ['Chintan', 'Aarav', 'Mira']);
  assert.equal(calories.affectedLabel, '3 members');
  assert.equal(calories.foodMove, 'Increase meal portions');

  const proteins = rows.find(row => row.id === 'proteins');
  assert.equal(proteins.coveragePct, 23);
  assert.equal(proteins.status.key, 'needs_attention');
  assert.equal(proteins.foodMove, 'Add dal, paneer, eggs, or tofu');

  const fiber = rows.find(row => row.id === 'fiber');
  assert.equal(fiber.coveragePct, 28);
  assert.equal(fiber.affectedLabel, '3 members');

  assert.ok(rows.every(row => Number.isInteger(row.coveragePct)));
  assert.ok(rows.every(row => typeof row.foodMove === 'string' && row.foodMove.length > 0));
});

test('buildCoverageDistribution counts status buckets', () => {
  const rows = [
    { status: { key: 'needs_attention' } },
    { status: { key: 'needs_attention' } },
    { status: { key: 'watch' } },
    { status: { key: 'on_track' } },
  ];

  assert.deepEqual(buildCoverageDistribution(rows), {
    needs_attention: 2,
    watch: 1,
    on_track: 1,
  });
});
