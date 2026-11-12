import { useState } from 'react';
import { X } from 'lucide-react';
import api, { errorMessage } from '../services/api';
export default function TransactionForm({ transaction, onClose, onSaved }) {
  const [form, setForm] = useState(transaction ? { ...transaction, amount: (transaction.amount / 100).toFixed(2), date: transaction.date.slice(0,10) } : { title: '', amount: '', type: 'expense', category: '', date: new Date().toLocaleDateString('en-CA'), description: '' });
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const change = e => setForm({ ...form, [e.target.name]: e.target.value });
  async function submit(e) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const [whole, decimal = ''] = String(form.amount).split('.');
      const amount = Number(whole) * 100 + Number(decimal.padEnd(2,'0'));
      if (!/^\d+(\.\d{1,2})?$/.test(form.amount) || !Number.isSafeInteger(amount) || amount < 1) throw new Error('Enter a positive amount with at most two decimals.');
      const body = { title: form.title, amount, type: form.type, category: form.category, date: form.date, description: form.description };
      await (transaction ? api.put('/transactions/' + transaction._id, body) : api.post('/transactions', body));
      onSaved(); onClose();
    } catch (err) { setError(err.response ? errorMessage(err) : err.message); } finally { setBusy(false); }
  }
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="transaction-title"><div className="panel-heading"><div><h2 id="transaction-title">{transaction ? 'Edit transaction' : 'Add transaction'}</h2><p>A little detail. A clearer financial picture.</p></div><button className="icon-button" aria-label="Close" onClick={onClose}><X size={20}/></button></div><form onSubmit={submit} className="form-stack"><label>Title<input autoFocus required name="title" maxLength={120} value={form.title} onChange={change} placeholder="e.g. Freelance project"/></label><div className="form-grid"><label>Amount (₹)<input required name="amount" type="number" min="0.01" max="1000000000" step="0.01" value={form.amount} onChange={change} placeholder="0.00"/></label><label>Type<select name="type" value={form.type} onChange={change}><option value="expense">Expense</option><option value="income">Income</option></select></label><label>Category<input required name="category" maxLength={60} list="category-options" value={form.category} onChange={change} placeholder="Select or enter category"/><datalist id="category-options">{['Salary','Freelance','Housing','Food','Utilities','Transport','Software','Shopping','Health','Other'].map(c => <option key={c}>{c}</option>)}</datalist></label><label>Date<input required type="date" name="date" value={form.date} onChange={change}/></label></div><label>Description<textarea name="description" maxLength={1000} value={form.description} onChange={change} placeholder="Add a note (optional)" rows={3}/></label>{error && <p className="error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button disabled={busy} className="button primary">{busy ? 'Saving…' : 'Save transaction'}</button></div></form></section></div>;
}
