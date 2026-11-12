import axios from 'axios';
export default axios.create({ baseURL: '/api', withCredentials: true });
export const money = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(value / 100);
export const dateLabel = value => new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export const errorMessage = err => err.response?.data?.message || 'Unable to connect. Check that the server and MongoDB are running.';
