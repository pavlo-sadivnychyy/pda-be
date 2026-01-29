import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentSource, DocumentStatus } from '@prisma/client';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { FileStorageService } from '../file-storage/file-storage.service';

type PdfKind = 'UA' | 'INTERNATIONAL';

@Injectable()
export class InvoicePdfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileStorage: FileStorageService,
  ) {}

  private formatMoney(value: any): string {
    if (value == null) return '0.00';
    if (typeof value === 'number') return value.toFixed(2);
    if (typeof value === 'string') {
      const num = parseFloat(value);
      return Number.isFinite(num) ? num.toFixed(2) : value;
    }
    // Prisma.Decimal
    // @ts-ignore
    if (value && typeof value.toNumber === 'function') {
      // @ts-ignore
      const num = value.toNumber();
      return Number.isFinite(num) ? num.toFixed(2) : String(value);
    }
    return String(value);
  }

  private formatIban(iban?: string | null): string {
    const s = (iban ?? '').replace(/\s+/g, '').trim();
    if (!s) return '';
    return s.replace(/(.{4})/g, '$1 ').trim();
  }

  private formatDateISO(d?: Date | string | null): string {
    if (!d) return '-';
    if (typeof d === 'string') return d.slice(0, 10);
    try {
      return d.toISOString().slice(0, 10);
    } catch {
      return '-';
    }
  }

  // ✅ avoid TS type issues with pdfkit import
  private ensureSpace(doc: any, neededPx: number) {
    const bottomY = doc.page.height - doc.page.margins.bottom;
    if (doc.y + neededPx > bottomY) {
      doc.addPage();
      doc.x = doc.page.margins.left;
      doc.y = doc.page.margins.top;
    }
  }

  // ===========================
  // ====== PDF DRAW HELPERS ===
  // ===========================
  private setupDoc(): any {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
    });

    const fontsRoot = path.join(process.cwd(), 'fonts', 'Inter');
    const interVariablePath = path.join(
      fontsRoot,
      'Inter-VariableFont_opsz,wght.ttf',
    );

    doc.registerFont('Body', interVariablePath);
    doc.registerFont('BodyBold', interVariablePath);

    doc.font('Body');
    doc.fontSize(10);
    doc.fillColor('#000000');

    return doc;
  }

  private strokeRect(doc: any, x: number, y: number, w: number, h: number) {
    doc.rect(x, y, w, h).stroke();
  }

  private drawCell(
    doc: any,
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    opts?: {
      bold?: boolean;
      fontSize?: number;
      align?: 'left' | 'right' | 'center';
      valign?: 'top' | 'middle';
      padding?: number;
      color?: string;
      lineGap?: number;
    },
  ) {
    const padding = opts?.padding ?? 6;
    const fontSize = opts?.fontSize ?? 10;
    const align = opts?.align ?? 'left';
    const valign = opts?.valign ?? 'top';

    if (opts?.color) doc.fillColor(opts.color);
    doc.font(opts?.bold ? 'BodyBold' : 'Body');
    doc.fontSize(fontSize);

    const textBoxY =
      valign === 'middle'
        ? y + Math.max(0, (h - fontSize - 2) / 2)
        : y + padding;

    doc.text(text ?? '', x + padding, textBoxY, {
      width: w - padding * 2,
      height: h - padding * 2,
      align,
      lineGap: opts?.lineGap ?? 1,
    });

    doc.fillColor('#000000');
    doc.font('Body');
    doc.fontSize(10);
  }

  private drawLabelValueBlock(
    doc: any,
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    lines: string[],
    lang: 'UA' | 'EN',
  ) {
    this.strokeRect(doc, x, y, w, h);

    const titleH = 18;
    doc
      .moveTo(x, y + titleH)
      .lineTo(x + w, y + titleH)
      .stroke();

    this.drawCell(doc, x, y, w, titleH, title, {
      bold: true,
      fontSize: 10.5,
      valign: 'middle',
      padding: 6,
    });

    const bodyText = lines.filter(Boolean).join('\n');
    this.drawCell(doc, x, y + titleH, w, h - titleH, bodyText, {
      fontSize: 9.5,
      padding: 6,
      lineGap: lang === 'UA' ? 1.2 : 1.15,
    });
  }

  private buildSupplierLines(org: any, lang: 'UA' | 'EN'): string[] {
    const name =
      org?.beneficiaryName ||
      org?.legalName ||
      org?.name ||
      (lang === 'UA' ? '—' : '—');
    const address = org?.legalAddress || '';
    const cityCountry = [org?.city, org?.country].filter(Boolean).join(', ');
    const reg = org?.registrationNumber || '';
    const vat = org?.vatId || '';

    const lines: string[] = [];
    lines.push(name);

    const addrLine = [address, cityCountry].filter(Boolean).join(', ');
    if (addrLine) lines.push(addrLine);

    if (org?.primaryContactEmail)
      lines.push(
        `${lang === 'UA' ? 'Email' : 'Email'}: ${org.primaryContactEmail}`,
      );
    if (org?.primaryContactPhone)
      lines.push(
        `${lang === 'UA' ? 'Тел' : 'Phone'}: ${org.primaryContactPhone}`,
      );

    if (reg)
      lines.push(`${lang === 'UA' ? 'ЄДРПОУ/Reg. No' : 'Reg. No'}: ${reg}`);
    if (vat) lines.push(`${lang === 'UA' ? 'ІПН/VAT' : 'VAT/Tax ID'}: ${vat}`);

    return lines;
  }

  private buildBuyerLines(client: any, lang: 'UA' | 'EN'): string[] {
    if (!client) return [lang === 'UA' ? '—' : '—'];

    const lines: string[] = [];
    if (client.name) lines.push(client.name);
    if (client.contactName) lines.push(client.contactName);

    if (client.address) lines.push(client.address);
    if (client.email) lines.push(client.email);
    if (client.phone) lines.push(client.phone);

    if (client.taxNumber) {
      lines.push(
        `${lang === 'UA' ? 'Податковий номер' : 'Tax ID'}: ${client.taxNumber}`,
      );
    }

    return lines.length ? lines : [lang === 'UA' ? '—' : '—'];
  }

  private buildPaymentLines(
    org: any,
    invoice: any,
    lang: 'UA' | 'EN',
  ): string[] {
    const beneficiary =
      org?.beneficiaryName || org?.legalName || org?.name || '—';
    const iban = this.formatIban(org?.iban);
    const swift = org?.swiftBic || org?.swift || '';
    const bankName = org?.bankName || '';
    const bankAddr = org?.bankAddress || '';
    const acc = org?.bankAccountNumber || ''; // якщо маєш окреме поле
    const reference = (
      org?.paymentReferenceHint?.trim() ||
      (lang === 'UA'
        ? `Оплата за інвойсом № ${invoice?.number ?? ''}`
        : `Payment for invoice No ${invoice?.number ?? ''}`)
    ).trim();

    const lines: string[] = [];
    lines.push(
      `${lang === 'UA' ? 'Отримувач' : 'Beneficiary'}: ${beneficiary}`,
    );
    if (iban) lines.push(`IBAN: ${iban}`);
    if (acc) lines.push(`${lang === 'UA' ? 'Рахунок' : 'Account'}: ${acc}`);
    if (swift) lines.push(`SWIFT/BIC: ${swift}`);
    if (bankName) lines.push(`${lang === 'UA' ? 'Банк' : 'Bank'}: ${bankName}`);
    if (bankAddr)
      lines.push(
        `${lang === 'UA' ? 'Адреса банку' : 'Bank address'}: ${bankAddr}`,
      );
    lines.push(`${lang === 'UA' ? 'Призначення' : 'Reference'}: ${reference}`);

    return lines;
  }

  private buildSubject(invoice: any): string {
    // Якщо маєш invoice.subject — підстав сюди.
    // Зараз зробимо “по-простому”: або industry, або “Services”.
    const org = invoice?.organization ?? {};
    const fromOrg = (org?.industry || '').trim();
    if (fromOrg) return fromOrg;

    const firstItem = invoice?.items?.[0]?.name?.trim();
    if (firstItem) return firstItem;

    return 'Services';
  }

  private termsEN(invoiceNo: string): string[] {
    return [
      `All charges of correspondent banks are at the Seller's expense.`,
      ``,
      `Payment hereof at the same time is the evidence of the service delivery, acceptance thereof in full scope and the confirmation of final mutual settlements between Parties.`,
      ``,
      `The Parties shall not be liable for non-performance or improper performance of the obligations under the agreement during the term of insuperable force circumstances.`,
      ``,
      `Payment according hereto shall be also the confirmation that Parties have no claims to each other and have no intention to submit any claims.`,
      ``,
      `Any disputes arising out of the agreement between the Parties shall be settled by the competent court at the location of a defendant.`,
      ``,
      `Reference: Invoice No ${invoiceNo}`,
    ];
  }

  private termsUA(invoiceNo: string): string[] {
    return [
      `Усі комісії банків-кореспондентів сплачує Виконавець.`,
      ``,
      `Оплата цього інвойсу одночасно є свідченням надання послуг, їх прийняття в повному обсязі, а також підтвердженням кінцевих розрахунків між Сторонами.`,
      ``,
      `Сторони звільняються від відповідальності за невиконання чи неналежне виконання зобов'язань за договором на час дії форс-мажорних обставин.`,
      ``,
      `Оплата згідно цього інвойсу є підтвердженням того, що Сторони не мають взаємних претензій та не мають наміру заявляти рекламації.`,
      ``,
      `Усі спори, що виникнуть між Сторонами, будуть вирішуватись компетентним судом за місцезнаходженням відповідача.`,
      ``,
      `Призначення: Інвойс № ${invoiceNo}`,
    ];
  }

  // ===========================
  // ===== UA PDF TEMPLATE =====
  // ===========================
  private async buildPdfBufferUa(invoice: any): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = this.setupDoc();

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const right = doc.page.margins.right;
      const top = doc.page.margins.top;
      const usableW = doc.page.width - left - right;

      const org = invoice.organization ?? {};

      // Header line like: "Invoice / Інвойс № ..."
      doc.font('BodyBold').fontSize(12);
      doc.text(`Інвойс № ${invoice.number}`, left, top, { align: 'left' });

      doc.font('Body').fontSize(10);
      doc.text(
        `Дата інвойсу: ${this.formatDateISO(invoice.issueDate)}`,
        left,
        top,
        {
          align: 'right',
          width: usableW,
        },
      );

      doc.moveDown(0.8);

      // Blocks layout (like on screenshot): 2 columns
      const colGap = 10;
      const colW = Math.floor((usableW - colGap) / 2);

      const xL = left;
      const xR = left + colW + colGap;

      let y = doc.y;

      // Row 1: Supplier (left) / Invoice meta (right)
      const row1H = 86;
      this.drawLabelValueBlock(
        doc,
        xL,
        y,
        colW,
        row1H,
        'Виконавець',
        this.buildSupplierLines(org, 'UA'),
        'UA',
      );

      const metaLinesUA = [
        `Номер: ${invoice.number ?? '—'}`,
        `Дата: ${this.formatDateISO(invoice.issueDate)}`,
        `Термін оплати: ${invoice.dueDate ? this.formatDateISO(invoice.dueDate) : '—'}`,
        `Валюта: ${invoice.currency ?? '—'}`,
      ];
      this.drawLabelValueBlock(
        doc,
        xR,
        y,
        colW,
        row1H,
        'Дані інвойсу',
        metaLinesUA,
        'UA',
      );

      y += row1H;

      // Row 2: Buyer full width
      const row2H = 74;
      this.drawLabelValueBlock(
        doc,
        left,
        y,
        usableW,
        row2H,
        'Замовник',
        this.buildBuyerLines(invoice.client, 'UA'),
        'UA',
      );
      y += row2H;

      // Row 3: Subject/Currency/Price/Terms (left) + Payment details (right)
      const row3H = 108;

      const subject = this.buildSubject(invoice);
      const totalStr = this.formatMoney(invoice.total);
      const termsPay =
        org?.paymentTermsTextUa?.trim?.() ||
        (invoice?.paymentTermsUa?.trim?.() as string) ||
        'Післяплата 100% після надання послуг.';

      const leftInfoUA = [
        `Предмет: ${subject}`,
        `Валюта: ${invoice.currency ?? '—'}`,
        `Ціна (загальна вартість): ${totalStr} ${invoice.currency ?? ''}`.trim(),
        `Умови оплати: ${termsPay}`,
      ];

      this.drawLabelValueBlock(
        doc,
        xL,
        y,
        colW,
        row3H,
        'Інформація',
        leftInfoUA,
        'UA',
      );

      this.drawLabelValueBlock(
        doc,
        xR,
        y,
        colW,
        row3H,
        'Реквізити для оплати',
        this.buildPaymentLines(org, invoice, 'UA'),
        'UA',
      );

      y += row3H + 10;

      // Items table
      const tableX = left;
      const tableW = usableW;

      const headerH = 22;
      const rowH = 22;

      const cols = {
        no: Math.floor(tableW * 0.06),
        desc: Math.floor(tableW * 0.58),
        qty: Math.floor(tableW * 0.12),
        rate: Math.floor(tableW * 0.12),
        amt:
          tableW -
          (Math.floor(tableW * 0.06) +
            Math.floor(tableW * 0.58) +
            Math.floor(tableW * 0.12) +
            Math.floor(tableW * 0.12)),
      };

      const colX = {
        no: tableX,
        desc: tableX + cols.no,
        qty: tableX + cols.no + cols.desc,
        rate: tableX + cols.no + cols.desc + cols.qty,
        amt: tableX + cols.no + cols.desc + cols.qty + cols.rate,
      };

      const drawItemsHeader = (yy: number) => {
        this.strokeRect(doc, tableX, yy, tableW, headerH);
        doc
          .moveTo(colX.desc, yy)
          .lineTo(colX.desc, yy + headerH)
          .stroke();
        doc
          .moveTo(colX.qty, yy)
          .lineTo(colX.qty, yy + headerH)
          .stroke();
        doc
          .moveTo(colX.rate, yy)
          .lineTo(colX.rate, yy + headerH)
          .stroke();
        doc
          .moveTo(colX.amt, yy)
          .lineTo(colX.amt, yy + headerH)
          .stroke();

        this.drawCell(doc, colX.no, yy, cols.no, headerH, '№', {
          bold: true,
          align: 'center',
          valign: 'middle',
        });
        this.drawCell(doc, colX.desc, yy, cols.desc, headerH, 'Опис', {
          bold: true,
          valign: 'middle',
        });
        this.drawCell(doc, colX.qty, yy, cols.qty, headerH, 'Кількість', {
          bold: true,
          align: 'center',
          valign: 'middle',
        });
        this.drawCell(doc, colX.rate, yy, cols.rate, headerH, 'Тариф', {
          bold: true,
          align: 'center',
          valign: 'middle',
        });
        this.drawCell(doc, colX.amt, yy, cols.amt, headerH, 'Сума', {
          bold: true,
          align: 'center',
          valign: 'middle',
        });
      };

      const maxTableBottom = doc.page.height - doc.page.margins.bottom - 140;

      let tableY = y;
      drawItemsHeader(tableY);
      tableY += headerH;

      const items = invoice.items ?? [];
      let idx = 1;

      for (const it of items) {
        // if not enough space -> new page with header again
        if (tableY + rowH > maxTableBottom) {
          doc.addPage();
          tableY = doc.page.margins.top;
          drawItemsHeader(tableY);
          tableY += headerH;
        }

        // row outer box
        this.strokeRect(doc, tableX, tableY, tableW, rowH);

        // vertical separators
        doc
          .moveTo(colX.desc, tableY)
          .lineTo(colX.desc, tableY + rowH)
          .stroke();
        doc
          .moveTo(colX.qty, tableY)
          .lineTo(colX.qty, tableY + rowH)
          .stroke();
        doc
          .moveTo(colX.rate, tableY)
          .lineTo(colX.rate, tableY + rowH)
          .stroke();
        doc
          .moveTo(colX.amt, tableY)
          .lineTo(colX.amt, tableY + rowH)
          .stroke();

        const qty = it.quantity ?? 0;
        const rate = this.formatMoney(it.unitPrice);
        const amount = this.formatMoney(it.lineTotal);

        // description (name + optional description)
        const descText = [it.name, it.description].filter(Boolean).join('\n');

        this.drawCell(doc, colX.no, tableY, cols.no, rowH, String(idx), {
          align: 'center',
          valign: 'middle',
        });
        this.drawCell(
          doc,
          colX.desc,
          tableY,
          cols.desc,
          rowH,
          descText || '—',
          {
            fontSize: 9.5,
            padding: 6,
            lineGap: 1.1,
          },
        );
        this.drawCell(doc, colX.qty, tableY, cols.qty, rowH, String(qty), {
          align: 'center',
          valign: 'middle',
        });
        this.drawCell(doc, colX.rate, tableY, cols.rate, rowH, `${rate}`, {
          align: 'center',
          valign: 'middle',
        });
        this.drawCell(doc, colX.amt, tableY, cols.amt, rowH, `${amount}`, {
          align: 'center',
          valign: 'middle',
        });

        tableY += rowH;
        idx += 1;
      }

      // Totals row (like screenshot bottom)
      const totalsH = 22;

      // ensure space for totals block
      if (
        tableY + totalsH * 2 + 24 >
        doc.page.height - doc.page.margins.bottom
      ) {
        doc.addPage();
        tableY = doc.page.margins.top;
      }

      // Total line (right side)
      const subtotalVal =
        `${this.formatMoney(invoice.subtotal)} ${invoice.currency ?? ''}`.trim();
      const vatVal =
        `${this.formatMoney(invoice.taxAmount ?? 0)} ${invoice.currency ?? ''}`.trim();
      const totalVal =
        `${this.formatMoney(invoice.total)} ${invoice.currency ?? ''}`.trim();

      const totals = [
        { label: 'Сума без ПДВ:', value: subtotalVal, bold: false },
        { label: 'ПДВ:', value: vatVal, bold: false },
        { label: 'Усього до сплати:', value: totalVal, bold: true },
      ];

      for (const row of totals) {
        this.strokeRect(doc, tableX, tableY, tableW, totalsH);
        doc
          .moveTo(colX.amt, tableY)
          .lineTo(colX.amt, tableY + totalsH)
          .stroke();

        this.drawCell(
          doc,
          tableX,
          tableY,
          tableW - cols.amt,
          totalsH,
          row.label,
          {
            align: 'right',
            valign: 'middle',
            bold: row.bold,
          },
        );
        this.drawCell(doc, colX.amt, tableY, cols.amt, totalsH, row.value, {
          align: 'center',
          valign: 'middle',
          bold: row.bold,
        });

        tableY += totalsH;
      }

      doc.y = tableY + 18;

      // Terms + signature on page 2 (or same if fits)
      const termsLines = this.termsUA(String(invoice.number ?? ''));
      const termsText = termsLines.join('\n');

      this.ensureSpace(doc, 260);

      // if still close to bottom -> new page for terms
      const bottomY = doc.page.height - doc.page.margins.bottom;
      if (doc.y + 240 > bottomY) {
        doc.addPage();
        doc.y = doc.page.margins.top;
      }

      doc.font('Body').fontSize(9.5);
      doc.text(termsText, left, doc.y, {
        width: usableW,
        lineGap: 1.2,
      });

      doc.moveDown(2);

      // Signature line
      const signerName =
        invoice?.createdBy?.fullName ||
        invoice?.createdBy?.name ||
        org?.signatoryName ||
        '';

      const signLabel = 'Виконавець:';
      const signY = doc.y + 10;

      doc.font('Body').fontSize(10);
      doc.text(signLabel, left, signY);

      // line
      const lineX1 = left + 78;
      const lineX2 = left + 250;
      doc
        .moveTo(lineX1, signY + 12)
        .lineTo(lineX2, signY + 12)
        .stroke();

      // name at right
      doc.text(
        signerName ? `(${signerName})` : '',
        left + usableW - 220,
        signY,
        { width: 220, align: 'right' },
      );

      doc.end();
    });
  }

  // ===================================
  // ===== INTERNATIONAL TEMPLATE =======
  // ===================================
  private async buildPdfBufferInternational(invoice: any): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = this.setupDoc();

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const left = doc.page.margins.left;
      const right = doc.page.margins.right;
      const top = doc.page.margins.top;
      const usableW = doc.page.width - left - right;

      const org = invoice.organization ?? {};

      // Header line like screenshot
      doc.font('BodyBold').fontSize(12);
      doc.text(`Invoice No ${invoice.number}`, left, top, { align: 'left' });

      doc.font('Body').fontSize(10);
      doc.text(
        `Date of invoice: ${this.formatDateISO(invoice.issueDate)}`,
        left,
        top,
        {
          align: 'right',
          width: usableW,
        },
      );

      doc.moveDown(0.8);

      // 2-column blocks
      const colGap = 10;
      const colW = Math.floor((usableW - colGap) / 2);

      const xL = left;
      const xR = left + colW + colGap;

      let y = doc.y;

      const row1H = 86;

      this.drawLabelValueBlock(
        doc,
        xL,
        y,
        colW,
        row1H,
        'Supplier',
        this.buildSupplierLines(org, 'EN'),
        'EN',
      );

      const metaLinesEN = [
        `Invoice No: ${invoice.number ?? '—'}`,
        `Issue Date: ${this.formatDateISO(invoice.issueDate)}`,
        `Due Date: ${invoice.dueDate ? this.formatDateISO(invoice.dueDate) : '—'}`,
        `Currency: ${invoice.currency ?? '—'}`,
      ];
      this.drawLabelValueBlock(
        doc,
        xR,
        y,
        colW,
        row1H,
        'Invoice details',
        metaLinesEN,
        'EN',
      );

      y += row1H;

      const row2H = 74;
      this.drawLabelValueBlock(
        doc,
        left,
        y,
        usableW,
        row2H,
        'Customer',
        this.buildBuyerLines(invoice.client, 'EN'),
        'EN',
      );

      y += row2H;

      const row3H = 108;
      const subject = this.buildSubject(invoice);
      const totalStr = this.formatMoney(invoice.total);

      const termsPay =
        org?.paymentTermsTextEn?.trim?.() ||
        (invoice?.paymentTermsEn?.trim?.() as string) ||
        'Post payment of 100% upon the services delivery.';

      const leftInfoEN = [
        `Subject matter: ${subject}`,
        `Currency: ${invoice.currency ?? '—'}`,
        `Price (amount) of the services: ${totalStr} ${invoice.currency ?? ''}`.trim(),
        `Terms of payment: ${termsPay}`,
      ];

      this.drawLabelValueBlock(
        doc,
        xL,
        y,
        colW,
        row3H,
        'Information',
        leftInfoEN,
        'EN',
      );

      this.drawLabelValueBlock(
        doc,
        xR,
        y,
        colW,
        row3H,
        'Payment details',
        this.buildPaymentLines(org, invoice, 'EN'),
        'EN',
      );

      y += row3H + 10;

      // Items table: №, Description, Hours(Qty), Rate, Amount
      const tableX = left;
      const tableW = usableW;

      const headerH = 22;
      const rowH = 22;

      const cols = {
        no: Math.floor(tableW * 0.06),
        desc: Math.floor(tableW * 0.58),
        qty: Math.floor(tableW * 0.12),
        rate: Math.floor(tableW * 0.12),
        amt:
          tableW -
          (Math.floor(tableW * 0.06) +
            Math.floor(tableW * 0.58) +
            Math.floor(tableW * 0.12) +
            Math.floor(tableW * 0.12)),
      };

      const colX = {
        no: tableX,
        desc: tableX + cols.no,
        qty: tableX + cols.no + cols.desc,
        rate: tableX + cols.no + cols.desc + cols.qty,
        amt: tableX + cols.no + cols.desc + cols.qty + cols.rate,
      };

      const drawItemsHeader = (yy: number) => {
        this.strokeRect(doc, tableX, yy, tableW, headerH);
        doc
          .moveTo(colX.desc, yy)
          .lineTo(colX.desc, yy + headerH)
          .stroke();
        doc
          .moveTo(colX.qty, yy)
          .lineTo(colX.qty, yy + headerH)
          .stroke();
        doc
          .moveTo(colX.rate, yy)
          .lineTo(colX.rate, yy + headerH)
          .stroke();
        doc
          .moveTo(colX.amt, yy)
          .lineTo(colX.amt, yy + headerH)
          .stroke();

        this.drawCell(doc, colX.no, yy, cols.no, headerH, 'No', {
          bold: true,
          align: 'center',
          valign: 'middle',
        });
        this.drawCell(doc, colX.desc, yy, cols.desc, headerH, 'Description', {
          bold: true,
          valign: 'middle',
        });
        this.drawCell(doc, colX.qty, yy, cols.qty, headerH, 'Amount', {
          bold: true,
          align: 'center',
          valign: 'middle',
        });
        this.drawCell(doc, colX.rate, yy, cols.rate, headerH, 'Rate', {
          bold: true,
          align: 'center',
          valign: 'middle',
        });
        this.drawCell(doc, colX.amt, yy, cols.amt, headerH, 'Amount', {
          bold: true,
          align: 'center',
          valign: 'middle',
        });
      };

      const maxTableBottom = doc.page.height - doc.page.margins.bottom - 140;

      let tableY = y;
      drawItemsHeader(tableY);
      tableY += headerH;

      const items = invoice.items ?? [];
      let idx = 1;

      for (const it of items) {
        if (tableY + rowH > maxTableBottom) {
          doc.addPage();
          tableY = doc.page.margins.top;
          drawItemsHeader(tableY);
          tableY += headerH;
        }

        this.strokeRect(doc, tableX, tableY, tableW, rowH);
        doc
          .moveTo(colX.desc, tableY)
          .lineTo(colX.desc, tableY + rowH)
          .stroke();
        doc
          .moveTo(colX.qty, tableY)
          .lineTo(colX.qty, tableY + rowH)
          .stroke();
        doc
          .moveTo(colX.rate, tableY)
          .lineTo(colX.rate, tableY + rowH)
          .stroke();
        doc
          .moveTo(colX.amt, tableY)
          .lineTo(colX.amt, tableY + rowH)
          .stroke();

        const qty = it.quantity ?? 0;
        const rate = this.formatMoney(it.unitPrice);
        const amount = this.formatMoney(it.lineTotal);

        const descText = [it.name, it.description].filter(Boolean).join('\n');

        this.drawCell(doc, colX.no, tableY, cols.no, rowH, String(idx), {
          align: 'center',
          valign: 'middle',
        });
        this.drawCell(
          doc,
          colX.desc,
          tableY,
          cols.desc,
          rowH,
          descText || '—',
          {
            fontSize: 9.5,
            padding: 6,
            lineGap: 1.1,
          },
        );
        this.drawCell(doc, colX.qty, tableY, cols.qty, rowH, String(qty), {
          align: 'center',
          valign: 'middle',
        });
        this.drawCell(doc, colX.rate, tableY, cols.rate, rowH, `${rate}`, {
          align: 'center',
          valign: 'middle',
        });
        this.drawCell(doc, colX.amt, tableY, cols.amt, rowH, `${amount}`, {
          align: 'center',
          valign: 'middle',
        });

        tableY += rowH;
        idx += 1;
      }

      // Totals rows like screenshot
      const totalsH = 22;

      if (
        tableY + totalsH * 2 + 24 >
        doc.page.height - doc.page.margins.bottom
      ) {
        doc.addPage();
        tableY = doc.page.margins.top;
      }

      const subtotalVal =
        `${this.formatMoney(invoice.subtotal)} ${invoice.currency ?? ''}`.trim();
      const vatVal =
        `${this.formatMoney(invoice.taxAmount ?? 0)} ${invoice.currency ?? ''}`.trim();
      const totalVal =
        `${this.formatMoney(invoice.total)} ${invoice.currency ?? ''}`.trim();

      const totals = [
        { label: 'Subtotal:', value: subtotalVal, bold: false },
        { label: 'VAT/Tax:', value: vatVal, bold: false },
        { label: 'Total to pay:', value: totalVal, bold: true },
      ];

      for (const row of totals) {
        this.strokeRect(doc, tableX, tableY, tableW, totalsH);
        doc
          .moveTo(colX.amt, tableY)
          .lineTo(colX.amt, tableY + totalsH)
          .stroke();

        this.drawCell(
          doc,
          tableX,
          tableY,
          tableW - cols.amt,
          totalsH,
          row.label,
          {
            align: 'right',
            valign: 'middle',
            bold: row.bold,
          },
        );
        this.drawCell(doc, colX.amt, tableY, cols.amt, totalsH, row.value, {
          align: 'center',
          valign: 'middle',
          bold: row.bold,
        });

        tableY += totalsH;
      }

      doc.y = tableY + 18;

      // Terms + signature
      const termsLines = this.termsEN(String(invoice.number ?? ''));
      const termsText = termsLines.join('\n');

      this.ensureSpace(doc, 260);

      const bottomY = doc.page.height - doc.page.margins.bottom;
      if (doc.y + 240 > bottomY) {
        doc.addPage();
        doc.y = doc.page.margins.top;
      }

      doc.font('Body').fontSize(9.5);
      doc.text(termsText, left, doc.y, {
        width: usableW,
        lineGap: 1.15,
      });

      doc.moveDown(2);

      const signerName =
        invoice?.createdBy?.fullName ||
        invoice?.createdBy?.name ||
        org?.signatoryName ||
        '';

      const signLabel = 'Supplier:';
      const signY = doc.y + 10;

      doc.font('Body').fontSize(10);
      doc.text(signLabel, left, signY);

      const lineX1 = left + 60;
      const lineX2 = left + 240;
      doc
        .moveTo(lineX1, signY + 12)
        .lineTo(lineX2, signY + 12)
        .stroke();

      doc.text(
        signerName ? `(${signerName})` : '',
        left + usableW - 220,
        signY,
        {
          width: 220,
          align: 'right',
        },
      );

      doc.end();
    });
  }

  private async generateAndAttach(
    invoiceId: string,
    requestedByUserId: string,
    kind: PdfKind,
  ) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
        client: true,
        organization: true,
        createdBy: true,
        pdfDocument: true,
        pdfInternationalDocument: true,
      },
    });

    if (!invoice) throw new NotFoundException('Інвойс не знайдено');

    const safeNumber = String(invoice.number).replace(/[^a-zA-Z0-9\-]/g, '_');
    const fileName =
      kind === 'UA'
        ? `invoice-ua-${safeNumber}.pdf`
        : `invoice-intl-${safeNumber}.pdf`;

    const pdfBuffer =
      kind === 'UA'
        ? await this.buildPdfBufferUa(invoice)
        : await this.buildPdfBufferInternational(invoice);

    const storageKey = await this.fileStorage.uploadFile(
      {
        originalname: fileName,
        mimetype: 'application/pdf',
        buffer: pdfBuffer,
      } as any,
      { organizationId: invoice.organizationId },
    );

    const existingDocumentId =
      kind === 'UA'
        ? invoice.pdfDocumentId
        : invoice.pdfInternationalDocumentId;

    if (existingDocumentId) {
      await this.prisma.document.update({
        where: { id: existingDocumentId },
        data: {
          originalName: fileName,
          mimeType: 'application/pdf',
          sizeBytes: pdfBuffer.length,
          storageKey,
          status: DocumentStatus.READY,
        },
      });

      return { storageKey, documentId: existingDocumentId };
    }

    const docRecord = await this.prisma.document.create({
      data: {
        organizationId: invoice.organizationId,
        createdById: requestedByUserId,
        title:
          kind === 'UA'
            ? `Invoice UA ${invoice.number}`
            : `Invoice International ${invoice.number}`,
        originalName: fileName,
        mimeType: 'application/pdf',
        sizeBytes: pdfBuffer.length,
        storageKey,
        source: DocumentSource.MANUAL,
        status: DocumentStatus.READY,
      },
    });

    if (kind === 'UA') {
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { pdfDocumentId: docRecord.id },
      });
    } else {
      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: { pdfInternationalDocumentId: docRecord.id },
      });
    }

    return { storageKey, documentId: docRecord.id };
  }

  private async getOrCreate(invoiceId: string, kind: PdfKind) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        organization: true,
        createdBy: true,
        pdfDocument: true,
        pdfInternationalDocument: true,
      },
    });

    if (!invoice) throw new NotFoundException('Інвойс не знайдено');

    const hasPdf =
      kind === 'UA'
        ? Boolean(invoice.pdfDocumentId && invoice.pdfDocument)
        : Boolean(
            invoice.pdfInternationalDocumentId &&
            invoice.pdfInternationalDocument,
          );

    if (!hasPdf) {
      const { storageKey } = await this.generateAndAttach(
        invoiceId,
        invoice.createdById,
        kind,
      );

      const pdfBuffer = await this.fileStorage.getFile(storageKey);

      const updated = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { pdfDocument: true, pdfInternationalDocument: true },
      });

      const document =
        kind === 'UA'
          ? updated?.pdfDocument
          : updated?.pdfInternationalDocument;

      if (!document)
        throw new NotFoundException('PDF-документ для інвойсу не знайдено');

      return { document, pdfBuffer };
    }

    const storageKey =
      kind === 'UA'
        ? invoice.pdfDocument!.storageKey
        : invoice.pdfInternationalDocument!.storageKey;

    const pdfBuffer = await this.fileStorage.getFile(storageKey);

    const document =
      kind === 'UA' ? invoice.pdfDocument : invoice.pdfInternationalDocument;

    if (!document)
      throw new NotFoundException('PDF-документ для інвойсу не знайдено');

    return { document, pdfBuffer };
  }

  async getOrCreatePdfForInvoiceUa(invoiceId: string) {
    return this.getOrCreate(invoiceId, 'UA');
  }

  async getOrCreatePdfForInvoiceInternational(invoiceId: string) {
    return this.getOrCreate(invoiceId, 'INTERNATIONAL');
  }
}
