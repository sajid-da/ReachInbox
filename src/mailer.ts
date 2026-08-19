import nodemailer, { SentMessageInfo } from 'nodemailer';
import { config } from './config.js';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  auth: config.smtp.user && config.smtp.pass ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
});

export async function sendEmail(input: { from: string; to: string; subject: string; text: string }) {
  if (!config.smtp.host || !config.smtp.port || !config.smtp.user || !config.smtp.pass || !config.defaultSender) {
    throw new Error('SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, and DEFAULT_SENDER_EMAIL must be configured');
  }
  return transporter.sendMail(input);
}

export function getPreviewUrl(info: SentMessageInfo) {
  return nodemailer.getTestMessageUrl(info);
}
