import test from 'node:test';
import assert from 'node:assert/strict';
import { rupeesToPaise, validDate, validateTransaction, overview, monthly, categories, insights, csvReport, filters, importKey } from './controllers/finance.js';
const row = { title: 'Salary', amount: 10000, type: 'income', category: 'Salary', date: '2026-10-01', description: '' };
test('money stays in integer paise and rejects unsafe values', () => {
  assert.equal(rupeesToPaise('1.01'), 101); assert.equal(rupeesToPaise('0.29'), 29);
  for (const value of ['0', '-1', '1.001', 'NaN', '1e5', '1000000001']) assert.throws(() => rupeesToPaise(value));
  assert.throws(() => validateTransaction({ ...row, amount: 10.2 }));
});
test('dates and filters are validated', () => {
  assert.equal(validDate('2026-02-30'), false); assert.equal(validDate('2024-02-29'), true);
  assert.throws(() => filters({ start: '2026-10-02', end: '2026-10-01' }, 'user'));
  assert.equal(filters({ search: 'a.*' }, 'user').title.$regex, 'a\\.\\*');
});
test('analytics handle empty data and missing months', () => {
  assert.equal(overview([]).margin, null);
  const rows = [row, { ...row, type: 'expense', amount: 2500, category: 'Food' }, { ...row, date: '2026-08-01' }];
  assert.deepEqual(overview(rows), { revenue: 20000, expenses: 2500, profit: 17500, margin: 87.5, count: 3 });
  assert.equal(monthly(rows)[1].income, 0); assert.deepEqual(categories(rows), [{ name: 'Food', value: 2500 }]);
  assert.deepEqual(insights([]), []); assert.ok(insights(rows, new Date('2026-10-20')).length >= 3);
  assert.deepEqual(categories([{ ...row, type: 'expense', category: '__proto__' }]), [{ name: '__proto__', value: 10000 }]);
});
test('CSV export escapes formulas and duplicate identity is stable', () => {
  assert.match(csvReport([{ ...row, title: '=SUM(A1)' }]), /'\=SUM/);
  assert.equal(importKey(row), importKey({ ...row, date: new Date(row.date), userId: 'ignored' }));
});
