import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';

export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType?: string;
};

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter;

  constructor() {
    const host = process.env.MAIL_HOST;
    const port = Number(process.env.MAIL_PORT || 587);

    // Для SendGrid SMTP: 587 + secure=false (STARTTLS)
    // Для 465: secure=true
    const secure =
      process.env.MAIL_SECURE != null
        ? String(process.env.MAIL_SECURE) === 'true'
        : port === 465;

    const user = process.env.MAIL_USER;
    const pass = process.env.MAIL_PASS;

    if (!host || !user || !pass) {
      console.warn(
        '[EmailService] Missing MAIL_HOST/MAIL_USER/MAIL_PASS env vars',
      );
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },

      // Щоб не ловити “self signed cert” в деяких інфрах
      tls: {
        rejectUnauthorized: true,
      },

      // Корисно для діагностики (можеш вимкнути потім)
      logger: process.env.MAIL_LOGGER === 'true',
      debug: process.env.MAIL_DEBUG === 'true',
    });
  }

  async sendMail(params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    attachments?: EmailAttachment[];
  }) {
    const from = process.env.MAIL_FROM || process.env.MAIL_USER;

    const info = await this.transporter.sendMail({
      from,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      attachments: params.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType || 'application/octet-stream',
      })),
    });

    return info;
  }
}
