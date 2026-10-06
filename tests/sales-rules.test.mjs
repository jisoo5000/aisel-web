import assert from 'node:assert/strict';
import test from 'node:test';
import { extendSalesRules } from '../scripts/sales-rules.mjs';
const baseline = () => ({ rules: { '.read': false, '.write': false,
  salesPerformance: { current: {
    '.read': "auth != null && (auth.uid === 'fixture-machine' || (auth.token.email_verified === true && auth.token.email === 'owner@example.invalid'))",
    '.write': "auth != null && auth.uid === 'fixture-machine' && newData.exists()",
    '.validate': 'existing validation',
  } }, '$existingPath': { '.read': "$existingPath !== 'salesPerformance'", '.write': "$existingPath !== 'salesPerformance'" },
  existingConfiguration: { '.validate': 'newData.isString()' },
} });
const owner = { uid: 'owner-fixture', token: { email_verified: true, email: 'owner@example.invalid' } };
const machine = { uid: 'fixture-machine', token: {} };
const outsider = { uid: 'other-fixture', token: { email_verified: true, email: 'other@example.invalid' } };
const snapshot = (value) => ({ val: () => value, exists: () => value !== null && value !== undefined,
  child: (path) => snapshot(path.split('/').reduce((v, key) => v?.[key], value)),
  hasChildren: (keys) => keys.every((key) => value?.[key] !== undefined && value[key] !== null),
  isString: () => typeof value === 'string', isNumber: () => typeof value === 'number' && Number.isFinite(value),
  isBoolean: () => typeof value === 'boolean' });
// Offline contract evaluator for the exact supported expressions generated here.
// The deployed Firebase console must still compile the complete actual rules.
function evaluate(expression, { auth = null, next = null, previous = null, code = 'AS-26F-TEST', review = '-fixture', date = '2026-10-02' } = {}) {
  if (typeof expression === 'boolean') return expression;
  const js = expression.replace(/(newData\.val\(\)|\$code|\$review|\$date)\.matches\((\/[^\n]+?\/)\)/gu, '$2.test($1)');
  return Function('auth','newData','data','now','$code','$review','$date', `return (${js});`)(auth, snapshot(next), snapshot(previous), 1000, code, review, date);
}
function valid(node, value) {
  if (value === null || value === undefined) return true;
  if (Object.hasOwn(node, '.validate') && !evaluate(node['.validate'], { next: value })) return false;
  if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
    const rule = node[key] ?? node[Object.keys(node).find((name) => name.startsWith('$'))];
    if (rule && !valid(rule, child)) return false;
  }
  return true;
}

test('migration changes only salesPerformance and never stores real account identifiers', () => {
  const before = baseline(), next = extendSalesRules(before);
  const { salesPerformance: beforeSales, ...beforeOther } = before.rules;
  const { salesPerformance: afterSales, ...afterOther } = next.rules;
  assert.deepEqual(afterOther, beforeOther);
  assert.equal(beforeSales.current['.validate'], 'existing validation');
  assert.equal(afterSales.current['.read'], beforeSales.current['.read']);
  assert.equal(afterSales.current['.write'], beforeSales.current['.write']);
  assert.deepEqual(Object.keys(afterSales).sort(), ['current','daily','products','reviews']);
});

test('only machine writes current/daily; owner reads protected aggregates; anonymous/outsider denied', () => {
  const rules = extendSalesRules(baseline()).rules.salesPerformance;
  for (const node of [rules.current, rules.daily.$date]) {
    assert.equal(evaluate(node['.write'], { auth: machine, next: {} }), true);
    for (const auth of [owner, outsider, null]) assert.equal(evaluate(node['.write'], { auth, next: {} }), false);
    assert.equal(evaluate(node['.write'], { auth: machine, next: null }), false);
    for (const auth of [owner, machine]) assert.equal(evaluate(node['.read'], { auth }), true);
    for (const auth of [outsider, null]) assert.equal(evaluate(node['.read'], { auth }), false);
  }
  assert.equal(evaluate(rules.daily.$date['.write'], { auth: machine, next: {}, date: '../current' }), false);
  assert.equal(evaluate(rules.daily['.read'], { auth: machine }), false);
});

test('owner can update product metadata and append reviews, never replace or delete a review', () => {
  const rules = extendSalesRules(baseline()).rules.salesPerformance;
  const product = rules.products.$code, review = rules.reviews.$code.$review;
  assert.equal(evaluate(product['.write'], { auth: owner, next: {} }), true);
  assert.equal(evaluate(review['.write'], { auth: owner, next: {}, previous: null }), true);
  assert.equal(evaluate(review['.write'], { auth: owner, next: {}, previous: {} }), false);
  assert.equal(evaluate(review['.write'], { auth: owner, next: null, previous: {} }), false);
  for (const auth of [machine, outsider, null, { ...owner, token: { ...owner.token, email_verified: false } }]) {
    assert.equal(evaluate(product['.write'], { auth, next: {} }), false);
    assert.equal(evaluate(review['.write'], { auth, next: {} }), false);
  }
  assert.equal(evaluate(product['.write'], { auth: owner, next: {}, code: 'invalid' }), false);
  assert.equal(evaluate(review['.write'], { auth: owner, next: {}, review: '../other' }), false);
});

test('metadata/review fields are bounded, unknown private fields rejected, unknown metric null allowed', () => {
  const rules = extendSalesRules(baseline()).rules.salesPerformance;
  const meta = { group: 'new', launchDate: '', coreSku: true, updatedAt: 1000 };
  const review = { reviewedAt: 1000, periodStart: '2026-09-26', periodEnd: '2026-10-02', asOf: '2026-10-02T21:00:00Z',
    group: 'new', launchDate: '', coreSku: false, netQty: null, previousNetQty: null, recent28NetQty: null,
    stockNote: '', conditionsNote: '', judgment: 'observe', reason: '', nextAction: '', nextReviewDate: '2026-10-09' };
  assert.equal(valid(rules.products.$code, meta), true);
  assert.equal(valid(rules.reviews.$code.$review, review), true);
  for (const extra of [{ customerEmail: 'private' }, { group: 'guessed' }, { coreSku: 'true' }, { updatedAt: 100000 }]) {
    assert.equal(valid(rules.products.$code, { ...meta, ...extra }), false);
  }
  for (const extra of [{ buyer: {} }, { reason: 'x'.repeat(2001) }, { stockNote: 'x'.repeat(1001) }, { judgment: 'reorder_now' }]) {
    assert.equal(valid(rules.reviews.$code.$review, { ...review, ...extra }), false);
  }
});

test('migration refuses unread or broadened ancestor auth rules rather than silently replacing them', () => {
  for (const mutate of [
    (v) => { v.rules['.read'] = true; }, (v) => { v.rules['.write'] = 'auth != null'; },
    (v) => { v.rules.salesPerformance['.write'] = true; },
    (v) => { v.rules.$existingPath['.write'] = true; },
    (v) => { v.rules.salesPerformance.current['.read'] = true; },
  ]) { const input = baseline(); mutate(input); assert.throws(() => extendSalesRules(input)); }
});
