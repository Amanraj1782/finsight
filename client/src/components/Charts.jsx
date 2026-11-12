import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area } from 'recharts';
import { money } from '../services/api';
export const colors = ['#5965e8', '#30b7a0', '#f4b45d', '#91a4ee', '#ef8094', '#8b77bb'];
const axis = { tickLine: false, axisLine: false, tick: { fill: '#8993a6', fontSize: 11 } };
const tip = { contentStyle: { borderRadius: 12, border: '1px solid #dce1eb', color: '#152340', background: '#fff' }, formatter: value => money(value) };
export function MonthlyChart({ data, kind = 'bar' }) {
  if (!data.length) return <div className="chart-empty">Add transactions to see your financial story.</div>;
  const chartData = data.map(d => ({ ...d, label: new Date(d.month + '-01').toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' }) }));
  const common = <><CartesianGrid strokeDasharray="3 5" vertical={false} stroke="var(--line)"/><XAxis dataKey="label" {...axis} dy={8}/><YAxis {...axis} width={55} tickFormatter={v => '₹' + (v / 100000).toFixed(0) + 'k'}/><Tooltip {...tip}/></>;
  return <div className="chart"><ResponsiveContainer width="100%" height="100%">{kind === 'line' ? <LineChart data={chartData} margin={{ top: 12, right: 10, bottom: 5, left: 0 }}>{common}<Line dataKey="income" name="Revenue" stroke="#5965e8" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }}/></LineChart> : kind === 'area' ? <AreaChart data={chartData} margin={{ top: 12, right: 10, bottom: 5, left: 0 }}>{common}<Area dataKey="income" name="Revenue" stroke="#5965e8" fill="#5965e8" fillOpacity={0.12} strokeWidth={2}/><Area dataKey="expense" name="Expenses" stroke="#30b7a0" fill="#30b7a0" fillOpacity={0.12} strokeWidth={2}/></AreaChart> : <BarChart data={chartData} barGap={5} margin={{ top: 12, right: 10, bottom: 5, left: 0 }}>{common}<Bar dataKey="income" name="Revenue" fill="#5965e8" radius={[4,4,0,0]} maxBarSize={27}/><Bar dataKey="expense" name="Expenses" fill="#acb4f6" radius={[4,4,0,0]} maxBarSize={27}/></BarChart>}</ResponsiveContainer></div>;
}
export function CategoryChart({ data }) {
  const total = data.reduce((s,d) => s + d.value, 0);
  if (!data.length) return <div className="chart-empty">Your expense categories will appear here.</div>;
  return <><div className="donut-wrap"><ResponsiveContainer width="100%" height={195}><PieChart><Pie data={data} dataKey="value" nameKey="name" innerRadius={66} outerRadius={86} paddingAngle={3} stroke="none">{data.map((d,i) => <Cell key={d.name} fill={colors[i % colors.length]}/>)}</Pie><Tooltip {...tip}/></PieChart></ResponsiveContainer><div className="donut-center"><span>Total expenses</span><strong>{money(total)}</strong></div></div><div className="category-legend">{data.map((d,i) => <div key={d.name}><span><i style={{ background: colors[i % colors.length] }}/>{d.name}</span><b>{(d.value / total * 100).toFixed(0)}%</b></div>)}</div></>;
}
