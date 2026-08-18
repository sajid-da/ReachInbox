import nodemailer from 'nodemailer';
import { config } from './config.js';

const transporter = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: config.smtp.port === 465,
  auth: config.smtp.user && config.smtp.pass ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
});

export async function sendEmail(input: { from: string; to: string; subject: string; text: string }) {
  if (!config.smtp.user || !config.smtp.pass) {
    throw new Error('SMTP_USER and SMTP_PASS must be configured');
  }
  return transporter.sendMail(input);
}
