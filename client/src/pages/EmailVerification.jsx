import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { MailCheck, Mail, ShieldCheck, LogOut, RefreshCw } from 'lucide-react';
import api, { errorMessage } from '../services/api';
import { useAuth } from '../context/AuthContext';

function VerificationCard({ children }) {
  return <main className="verification-page"><section className="verification-card"><Link to="/" className="verification-brand">FinSight<span>.</span></Link>{children}<p className="verification-footer"><ShieldCheck size={14}/>A verified email helps protect your financial workspace.</p></section></main>;
}
export function EmailPending() {
  const { user, setUser } = useAuth();
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const [code, setCode] = useState('');
  const [message, setMessage] = useState(user.verificationMessage || 'Request an OTP below, then enter the 6-digit code from your email.');
  const [waitUntil, setWaitUntil] = useState(() => Date.now() + (user.retryAfter || 0) * 1000), [remaining, setRemaining] = useState(user.retryAfter || 0);
  useEffect(() => { const tick = () => setRemaining(Math.max(0, Math.ceil((waitUntil-Date.now())/1000))); tick(); const id = setInterval(tick,1000); return () => clearInterval(id); }, [waitUntil]);
  async function resend() {
    setBusy('resend'); setError(''); setMessage('');
    try { const { data } = await api.post('/auth/resend-verification'); setMessage(data.message); setCode(''); if(data.retryAfter)setWaitUntil(Date.now()+data.retryAfter*1000); }
    catch(err) { setError(errorMessage(err)); if(err.response?.data?.retryAfter)setWaitUntil(Date.now()+err.response.data.retryAfter*1000); }
    finally { setBusy(''); }
  }
  async function check() {
    setBusy('check'); setError('');
    try { const {data} = await api.get('/auth/me'); if(data.user.emailVerified)setUser(data.user); else setError('Your email is not verified yet. Enter the latest email OTP and choose Verify OTP.'); }
    catch(err) { if(err.response?.status===401)setUser(null); else setError(errorMessage(err)); }
    finally { setBusy(''); }
  }
  async function logout() {
    setBusy('logout');setError('');
    try { await api.post('/auth/logout');setUser(null); } catch(err){setError(errorMessage(err));}finally{setBusy('');}
  }
  async function verify(e) {
    e.preventDefault();setBusy('verify');setError('');setMessage('');
    try { const {data}=await api.post('/auth/verify-email',{code});setUser(data.user); }
    catch(err) { if(err.response?.status===401)setUser(null); else {setError(errorMessage(err));if(err.response?.data?.retryAfter)setWaitUntil(Date.now()+err.response.data.retryAfter*1000);} }
    finally {setBusy('');}
  }
  return <VerificationCard><span className="verification-icon"><Mail size={30}/></span><h1>Verify your email.</h1><p>Enter the email OTP for <strong>{user.email}</strong> to open your financial workspace.</p>{message&&<div className="notice" role="status">{message}</div>}<p className="helper">Check your spam folder too. The 6-digit code expires in 10 minutes; only the newest code works. Never share your OTP.</p>{error&&<div className="error" role="alert">{error}</div>}<form className="form-stack verification-otp-form" onSubmit={verify}><label>Email OTP<input autoFocus className="email-otp-input" required type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,''))} placeholder="000000" disabled={!!busy}/></label><button className="button primary" disabled={!!busy||code.length!==6}><MailCheck size={17}/>{busy==='verify'?'Verifying…':'Verify OTP'}</button></form><div className="verification-actions"><button className="button secondary" onClick={resend} disabled={!!busy||remaining>0}>{busy==='resend'?'Sending…':remaining>0?`Resend available in ${remaining}s`:'Send / resend OTP'}</button><button className="button secondary" onClick={check} disabled={!!busy}><RefreshCw size={15}/>Refresh verification status</button><button className="button secondary" onClick={logout} disabled={!!busy}><LogOut size={16}/>Sign out / use another account</button></div></VerificationCard>;
}
export default function VerifyEmail() {
  const { user } = useAuth();
  useEffect(() => { window.history.replaceState(null, '', window.location.pathname); }, []);
  if(user?.emailVerified)return <Navigate to="/" replace/>;
  if(user)return <EmailPending/>;
  return <VerificationCard><span className="verification-icon"><MailCheck size={30}/></span><h1>Email OTP verification.</h1><p>FinSight now uses a 6-digit email OTP. Sign in and request a fresh code; earlier verification links no longer work.</p><div className="verification-actions"><Link to="/login" className="button primary">Sign in to verify</Link></div></VerificationCard>;
}
