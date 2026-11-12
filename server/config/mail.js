import nodemailer from 'nodemailer';
import { httpError } from '../controllers/finance.js';

export function mailOptions(env = process.env) {
  if (!env.SMTP_HOST || !env.SMTP_FROM) throw httpError('Verification email is not configured yet. Ask the administrator to configure SMTP in server/.env.', 503);
  const port = Number(env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || /[\r\n]/.test(env.SMTP_FROM) || (!!env.SMTP_USER !== !!env.SMTP_PASS)) throw httpError('Email configuration is invalid. Contact the administrator.', 503);
  const local = ['localhost','127.0.0.1','::1'].includes(env.SMTP_HOST) && env.NODE_ENV !== 'production';
  return {
    host: env.SMTP_HOST, port, secure: port === 465,
    requireTLS: !local && port !== 465,
    // Plain SMTP is allowed only for a local development mail catcher.
    ignoreTLS: local,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS } } : {}),
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true,
  };
}
export async function sendVerificationEmail(email, code) {
  const options = mailOptions();
  const transport = nodemailer.createTransport(options);
  try {
    const info = await transport.sendMail({
      from: process.env.SMTP_FROM, to: email, subject: 'Your FinSight email verification OTP',
      text: `Your FinSight email verification code is:\n\n${code}\n\nEnter this 6-digit code in the FinSight verification screen. It expires in 10 minutes and can be used only once. Only the most recent code will work.\n\nIf you did not request this code, ignore this email. Never share your OTP. FinSight will not ask you to send it through chat.`,
    });
    if (!info.accepted?.some(address => String(address).toLowerCase() === email.toLowerCase())) throw new Error('Recipient not accepted');
  } catch {
    // Never expose SMTP credentials, provider errors or the OTP in logs or API responses.
    throw httpError('The verification email could not be sent. Check the email configuration, then use Resend verification email.', 503);
  } finally { transport.close(); }
}
