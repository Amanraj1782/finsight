import { createHash } from 'node:crypto';
export function httpError(message, status = 400) { return Object.assign(new Error(message), { status }); }
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(+date) && date.toISOString().slice(0, 10) === value;
}
export function rupeesToPaise(value) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw httpError('Amount must be positive rupees with at most two decimals.');
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result <= 0 || result > 100000000000) throw httpError('Amount must be between ₹0.01 and ₹1,000,000,000.');
  return result;
}
export function validateTransaction(body, csv = false) {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const category = typeof body.category === 'string' ? body.category.trim() : '';
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!title || title.length > 120) throw httpError('Title is required (maximum 120 characters).');
  if (!category || category.length > 60) throw httpError('Category is required (maximum 60 characters).');
  if (!['income', 'expense'].includes(body.type)) throw httpError('Type must be income or expense.');
  if (!validDate(body.date)) throw httpError('Date must be a real date in YYYY-MM-DD format.');
  if (description.length > 1000) throw httpError('Description is too long.');
  const amount = csv ? rupeesToPaise(body.amount) : body.amount;
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 100000000000) throw httpError('Amount must be an integer number of paise, between 1 and 100000000000.');
  return { title, category, description, amount, type: body.type, date: body.date };
}
export function importKey(row) { return createHash('sha256').update(JSON.stringify([row.title, row.amount, row.type, row.category, new Date(row.date).toISOString().slice(0, 10), row.description || ''])).digest('hex'); }
export function filters(query, userId) {
  const filter = { userId };
  if (query.type) {
    if (!['income', 'expense'].includes(query.type)) throw httpError('Invalid type.');
    filter.type = query.type;
  }
  if (query.category) filter.category = String(query.category).slice(0, 60);
  if (query.search) filter.title = { $regex: String(query.search).slice(0, 120).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  if (query.start || query.end) {
    if ((query.start && !validDate(query.start)) || (query.end && !validDate(query.end))) throw httpError('Invalid date range.');
    if (query.start && query.end && query.start > query.end) throw httpError('Start date must precede end date.');
    filter.date = {};
    if (query.start) filter.date.$gte = new Date(query.start);
    if (query.end) filter.date.$lte = new Date(`${query.end}T23:59:59.999Z`);
  }
  return filter;
}
export function overview(rows) {
  const revenue = rows.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0);
  const expenses = rows.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0);
  return { revenue, expenses, profit: revenue - expenses, margin: revenue ? (revenue - expenses) / revenue * 100 : null, count: rows.length };
}
export function monthly(rows) {
  if (!rows.length) return [];
  const keys = rows.map(r => new Date(r.date).toISOString().slice(0, 7)).sort();
  const start = new Date(`${keys[0]}-01T00:00:00Z`);
  const end = new Date(`${keys.at(-1)}-01T00:00:00Z`);
  const buckets = {};
  for (const d = new Date(start); d <= end; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const month = d.toISOString().slice(0, 7);
    buckets[month] = { month, income: 0, expense: 0 };
  }
  for (const row of rows) buckets[new Date(row.date).toISOString().slice(0, 7)][row.type] += row.amount;
  return Object.values(buckets);
}
export function categories(rows) {
  const sums = Object.create(null);
  for (const row of rows.filter(r => r.type === 'expense')) sums[row.category] = (sums[row.category] || 0) + row.amount;
  return Object.entries(sums).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value);
}
export function insights(rows, now = new Date()) {
  const result = [], months = monthly(rows), cats = categories(rows);
  const current = now.toISOString().slice(0, 7);
  const priorDate = new Date(`${current}-01T00:00:00Z`); priorDate.setUTCMonth(priorDate.getUTCMonth() - 1);
  const previous = priorDate.toISOString().slice(0, 7);
  const thisRows = rows.filter(r => new Date(r.date).toISOString().startsWith(current));
  const lastRows = rows.filter(r => new Date(r.date).toISOString().startsWith(previous));
  const a = overview(thisRows), b = overview(lastRows);
  if (thisRows.length) result.push({ title: 'Your monthly balance', text: `This month, income ${a.profit >= 0 ? 'covers' : 'falls below'} expenses. Net balance: ₹${(a.profit / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}.`, tone: a.profit >= 0 ? 'positive' : 'negative' });
  if (thisRows.length && lastRows.length && b.expenses > 0) result.push({ title: 'Expense movement', text: `Expenses ${a.expenses >= b.expenses ? 'increased' : 'decreased'} by ${Math.abs((a.expenses - b.expenses) / b.expenses * 100).toFixed(1)}% compared with last month.`, tone: a.expenses <= b.expenses ? 'positive' : 'negative' });
  if (thisRows.length && lastRows.length) result.push({ title: 'Savings check', text: `Your net savings ${a.profit > b.profit ? 'increased' : a.profit < b.profit ? 'decreased' : 'stayed unchanged'} compared with last month.`, tone: a.profit >= b.profit ? 'positive' : 'negative' });
  if (cats.length) result.push({ title: 'Largest spending category', text: `${cats[0].name} accounts for ${(cats[0].value / overview(rows).expenses * 100).toFixed(1)}% of expenses in your recorded data.`, tone: 'neutral' });
  const best = months.filter(m => m.income > 0).sort((x,y) => y.income - x.income)[0];
  if (best) result.push({ title: 'Your strongest income month', text: `${new Date(best.month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' })} has the highest recorded income: ₹${(best.income / 100).toLocaleString('en-IN')}.`, tone: 'positive' });
  return result.slice(0, 5);
}
export function csvReport(rows) {
  const cell = value => '"' + String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"';
  return ['title,amount,type,category,date,description', ...rows.map(r => [r.title, (r.amount / 100).toFixed(2), r.type, r.category, new Date(r.date).toISOString().slice(0,10), r.description].map(cell).join(','))].join('\r\n');
}
