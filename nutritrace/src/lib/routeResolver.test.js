import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveRoute } from './routeResolver.js';

test('resolveRoute selects exact routes before parameterized routes', () => {
  const ExactEditor = Symbol('exact editor');
  const ParameterizedEditor = Symbol('parameterized editor');
  const routes = {
    '/foods/edit': ExactEditor,
    '/foods/edit/:id': ParameterizedEditor,
    '*': Symbol('fallback'),
  };

  assert.deepEqual(resolveRoute(routes, '/foods/edit'), {
    component: ExactEditor,
    params: null,
    route: '/foods/edit',
  });
});

test('resolveRoute extracts params for dynamic route segments', () => {
  const FoodEditor = Symbol('food editor');
  const routes = {
    '/foods/edit': Symbol('exact editor'),
    '/foods/edit/:id': FoodEditor,
    '*': Symbol('fallback'),
  };

  assert.deepEqual(resolveRoute(routes, '/foods/edit/abc-123'), {
    component: FoodEditor,
    params: { id: 'abc-123' },
    route: '/foods/edit/:id',
  });
});

test('resolveRoute falls back to wildcard route for unknown paths', () => {
  const Fallback = Symbol('fallback');
  const routes = {
    '/': Symbol('diary'),
    '*': Fallback,
  };

  assert.deepEqual(resolveRoute(routes, '/missing'), {
    component: Fallback,
    params: null,
    route: '*',
  });
});
