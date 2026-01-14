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
      return isNaN(num) ? value : num.toFixed(2);
    }
    // Prisma.Decimal
    // @ts-ignore
    if (value && typeof value.toNumber === 'function') {
      // @ts-ignore
      const num = value.toNumber();
      return num.toFixed(2);
    }
    return String(value);
  }

  private formatIban(iban?: string | null): string {
    const s = (iban ?? '').replace(/\s+/g, '').trim();
    if (!s) return '';
    return s.replace(/(.{4})/g, '$1 ').trim();
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
  // ===== UA PDF TEMPLATE =====
  // ===========================
  private async buildPdfBufferUa(invoice: any): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const fontsRoot = path.join(process.cwd(), 'fonts', 'Inter');
      const interVariablePath = path.join(
        fontsRoot,
        'Inter-VariableFont_opsz,wght.ttf',
      );
      doc.registerFont('Body', interVariablePath);
      doc.registerFont('BodyBold', interVariablePath);

      doc
        .font('BodyBold')
        .fontSize(20)
        .text(invoice.organization?.name || 'Invoice', { align: 'left' });

      doc.moveDown(0.5);

      doc.font('Body').fontSize(10);
      if (invoice.organization?.industry)
        doc.text(invoice.organization.industry);

      const orgLines: string[] = [];
      if (invoice.organization?.country || invoice.organization?.city) {
        orgLines.push(
          [invoice.organization.country, invoice.organization.city]
            .filter(Boolean)
            .join(', '),
        );
      }
      if (invoice.organization?.websiteUrl)
        orgLines.push(invoice.organization.websiteUrl);
      if (invoice.organization?.primaryContactEmail) {
        orgLines.push(`Email: ${invoice.organization.primaryContactEmail}`);
      }
      if (invoice.organization?.primaryContactPhone) {
        orgLines.push(`Тел: ${invoice.organization.primaryContactPhone}`);
      }
      orgLines.forEach((l) => doc.text(l));

      const issueDate = invoice.issueDate?.toISOString().slice(0, 10) ?? '-';
      const dueDate = invoice.dueDate
        ? invoice.dueDate.toISOString().slice(0, 10)
        : '-';

      doc
        .font('Body')
        .fontSize(12)
        .text(`Інвойс № ${invoice.number}`, { align: 'right' })
        .text(`Дата: ${issueDate}`, { align: 'right' })
        .text(`Термін оплати: ${dueDate}`, { align: 'right' });

      doc.moveDown(1.5);

      doc.font('BodyBold').fontSize(12).text('Клієнт', { underline: true });
      doc.font('Body').fontSize(10);

      if (invoice.client) {
        const c = invoice.client;
        doc.text(c.name || '—');
        if (c.contactName) doc.text(`Контактна особа: ${c.contactName}`);
        if (c.email) doc.text(`Email: ${c.email}`);
        if (c.phone) doc.text(`Телефон: ${c.phone}`);
        if (c.taxNumber) doc.text(`Податковий номер: ${c.taxNumber}`);
        if (c.address) doc.text(`Адреса: ${c.address}`);
      } else {
        doc.text('—');
      }

      doc.moveDown(1.5);

      const tableTop = doc.y;
      const colX = { name: 50, qty: 280, price: 330, tax: 400, total: 470 };

      doc.font('BodyBold').fontSize(10).text('Позиція', colX.name, tableTop);
      doc.text('К-сть', colX.qty, tableTop);
      doc.text('Ціна', colX.price, tableTop);
      doc.text('ПДВ, %', colX.tax, tableTop);
      doc.text('Сума', colX.total, tableTop);

      doc
        .moveTo(50, tableTop + 14)
        .lineTo(550, tableTop + 14)
        .stroke();

      let y = tableTop + 20;
      const rowHeight = 18;
      const maxY = 750;

      for (const item of invoice.items ?? []) {
        if (y > maxY) {
          doc.addPage();
          y = 50;

          doc.font('BodyBold').fontSize(10).text('Позиція', colX.name, y);
          doc.text('К-сть', colX.qty, y);
          doc.text('Ціна', colX.price, y);
          doc.text('ПДВ, %', colX.tax, y);
          doc.text('Сума', colX.total, y);

          doc
            .moveTo(50, y + 14)
            .lineTo(550, y + 14)
            .stroke();
          y += 20;
        }

        const taxRateStr =
          item.taxRate != null ? String(item.taxRate).replace('.', ',') : '-';

        doc
          .font('Body')
          .fontSize(10)
          .text(item.name ?? '—', colX.name, y, {
            width: colX.qty - colX.name - 10,
          });

        doc.text(String(item.quantity ?? 0), colX.qty, y);
        doc.text(
          `${this.formatMoney(item.unitPrice)} ${invoice.currency}`,
          colX.price,
          y,
        );
        doc.text(taxRateStr, colX.tax, y);
        doc.text(
          `${this.formatMoney(item.lineTotal)} ${invoice.currency}`,
          colX.total,
          y,
        );

        y += rowHeight;

        if (item.description) {
          doc
            .font('Body')
            .fontSize(9)
            .fillColor('#6b7280')
            .text(item.description, colX.name, y, {
              width: colX.total - colX.name,
            })
            .fillColor('#000000');

          y += rowHeight;
        }
      }

      doc.moveDown(2);

      const subtotalStr = this.formatMoney(invoice.subtotal);
      const taxAmountStr = this.formatMoney(invoice.taxAmount ?? 0);
      const totalStr = this.formatMoney(invoice.total);

      doc
        .font('Body')
        .fontSize(10)
        .text(`Сума без ПДВ: ${subtotalStr} ${invoice.currency}`, {
          align: 'right',
        });
      doc.text(`ПДВ: ${taxAmountStr} ${invoice.currency}`, { align: 'right' });
      doc
        .font('BodyBold')
        .fontSize(12)
        .text(`До оплати: ${totalStr} ${invoice.currency}`, { align: 'right' });

      doc.moveDown(1.4);

      if (invoice.notes) {
        doc
          .font('BodyBold')
          .fontSize(10)
          .text('Нотатки:', { underline: true })
          .moveDown(0.5)
          .font('Body')
          .fontSize(9)
          .text(invoice.notes);
      }

      // =========================
      // ✅ Payment details (UA) — рівний блок справа
      // =========================
      doc.moveDown(1.2);

      const org = invoice.organization ?? {};
      const left = doc.page.margins.left;
      const right = doc.page.margins.right;
      const usableWidth = doc.page.width - left - right;

      const colWidth = 300; // трохи вужче
      const colXRight = left + usableWidth - colWidth + 18; // зсув вправо

      this.ensureSpace(doc, 150);

      const blockY = doc.y;

      doc.font('BodyBold').fontSize(11);
      doc.text('Реквізити для оплати', colXRight, blockY, {
        width: colWidth,
        align: 'left',
        lineBreak: false,
      });

      const titleWidth = doc.widthOfString('Реквізити для оплати');
      const underlineY = doc.y + 2;
      doc
        .moveTo(colXRight, underlineY)
        .lineTo(colXRight + titleWidth, underlineY)
        .stroke();

      doc.y = underlineY + 10;

      const receiver = org.beneficiaryName || org.legalName || org.name || '—';

      const lines: string[] = [];
      lines.push(`Отримувач: ${receiver}`);
      if (org.iban) lines.push(`IBAN: ${this.formatIban(org.iban)}`);
      if (org.bankName) lines.push(`Банк: ${org.bankName}`);
      if (org.registrationNumber)
        lines.push(`ЄДРПОУ: ${org.registrationNumber}`);
      if (org.vatId) lines.push(`ІПН / VAT: ${org.vatId}`);
      if (org.legalAddress) lines.push(`Юр. адреса: ${org.legalAddress}`);
      lines.push(
        `Призначення: ${org.paymentReferenceHint?.trim() || 'Оплата'}`,
      );

      doc.font('Body').fontSize(10);
      doc.text(lines.join('\n'), colXRight, doc.y, {
        width: colWidth,
        align: 'left',
      });

      doc.end();
    });
  }

  // ===================================
  // ===== INTERNATIONAL TEMPLATE =======
  // ===================================
  private async buildPdfBufferInternational(invoice: any): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const fontsRoot = path.join(process.cwd(), 'fonts', 'Inter');
      const interVariablePath = path.join(
        fontsRoot,
        'Inter-VariableFont_opsz,wght.ttf',
      );
      doc.registerFont('Body', interVariablePath);
      doc.registerFont('BodyBold', interVariablePath);

      const org = invoice.organization ?? {};

      const left = doc.page.margins.left;
      const right = doc.page.margins.right;
      const usableWidth = doc.page.width - left - right;

      doc.font('BodyBold').fontSize(28).text('INVOICE', { align: 'left' });
      doc.moveDown(0.8);

      const sellerX = left;
      const sellerY = doc.y;

      doc
        .font('BodyBold')
        .fontSize(11)
        .text('Seller', sellerX, sellerY, { underline: true });
      doc.moveDown(0.3);
      doc.font('Body').fontSize(11);

      const sellerLines: string[] = [];
      sellerLines.push(org.name || '—');
      if (org.city || org.country) {
        sellerLines.push([org.city, org.country].filter(Boolean).join(', '));
      }
      if (org.websiteUrl) sellerLines.push(org.websiteUrl);
      if (org.primaryContactEmail)
        sellerLines.push(`Email: ${org.primaryContactEmail}`);
      sellerLines.forEach((l) => doc.text(l, sellerX));

      const sellerEndY = doc.y;

      const issueDate = invoice.issueDate
        ? invoice.issueDate.toISOString().slice(0, 10)
        : '-';
      const dueDate = invoice.dueDate
        ? invoice.dueDate.toISOString().slice(0, 10)
        : '-';

      const rightText = [
        `Invoice No: ${invoice.number}`,
        `Issue Date: ${issueDate}`,
        `Due Date: ${dueDate}`,
        `Currency: ${invoice.currency ?? '—'}`,
      ].join('\n');

      doc.font('Body').fontSize(12);
      doc.text(rightText, left, sellerY + 2, {
        width: usableWidth,
        align: 'right',
      });

      const rightEndY =
        sellerY +
        2 +
        doc.heightOfString(rightText, { width: usableWidth, align: 'right' });

      doc.x = left;
      doc.y = Math.max(sellerEndY, rightEndY) + 18;

      doc.font('BodyBold').fontSize(11).text('Buyer', { underline: true });
      doc.moveDown(0.3);
      doc.font('Body').fontSize(11);

      if (invoice.client) {
        const c = invoice.client;
        const buyerLines: string[] = [];
        buyerLines.push(c.name || '—');
        if (c.contactName) buyerLines.push(c.contactName);
        if (c.address) buyerLines.push(c.address);
        if (c.email) buyerLines.push(c.email);
        if (c.phone) buyerLines.push(c.phone);
        if (c.taxNumber) buyerLines.push(`Tax ID: ${c.taxNumber}`);
        doc.text(buyerLines.join('\n'), left, doc.y, {
          width: usableWidth * 0.6,
        });
      } else {
        doc.text('—');
      }

      doc.moveDown(1.2);

      const tableTop = doc.y + 10;
      const col = {
        desc: left,
        qty: left + Math.round(usableWidth * 0.6),
        unit: left + Math.round(usableWidth * 0.72),
        tax: left + Math.round(usableWidth * 0.84),
        amt: left + Math.round(usableWidth * 0.93),
      };

      doc.font('BodyBold').fontSize(11);
      doc.text('Description', col.desc, tableTop);
      doc.text('Qty', col.qty, tableTop, { width: 40 });
      doc.text('Unit', col.unit, tableTop, { width: 80 });
      doc.text('Tax %', col.tax, tableTop, { width: 60 });
      doc.text('Amount', col.amt, tableTop, { width: 80 });

      doc
        .moveTo(left, tableTop + 18)
        .lineTo(left + usableWidth, tableTop + 18)
        .stroke();

      let y = tableTop + 26;
      const rowHeight = 18;
      const maxY = doc.page.height - doc.page.margins.bottom - 230;

      doc.font('Body').fontSize(11);

      for (const item of invoice.items ?? []) {
        if (y > maxY) {
          doc.addPage();
          doc.x = left;
          y = doc.page.margins.top;

          doc.font('BodyBold').fontSize(11);
          doc.text('Description', col.desc, y);
          doc.text('Qty', col.qty, y, { width: 40 });
          doc.text('Unit', col.unit, y, { width: 80 });
          doc.text('Tax %', col.tax, y, { width: 60 });
          doc.text('Amount', col.amt, y, { width: 80 });

          doc
            .moveTo(left, y + 18)
            .lineTo(left + usableWidth, y + 18)
            .stroke();

          y += 26;
          doc.font('Body').fontSize(11);
        }

        const taxRateStr =
          item.taxRate != null ? String(item.taxRate).replace('.', ',') : '-';

        doc.text(item.name ?? '—', col.desc, y, {
          width: col.qty - col.desc - 10,
        });
        doc.text(String(item.quantity ?? 0), col.qty, y, { width: 40 });
        doc.text(this.formatMoney(item.unitPrice), col.unit, y, { width: 80 });
        doc.text(taxRateStr, col.tax, y, { width: 60 });
        doc.text(this.formatMoney(item.lineTotal), col.amt, y, { width: 80 });

        y += rowHeight;

        if (item.description) {
          doc
            .font('Body')
            .fontSize(9)
            .fillColor('#6b7280')
            .text(item.description, col.desc, y, { width: usableWidth })
            .fillColor('#000000');
          doc.font('Body').fontSize(11);
          y += rowHeight;
        }
      }

      doc.moveDown(1.2);

      const subtotalStr = this.formatMoney(invoice.subtotal);
      const taxAmountStr = this.formatMoney(invoice.taxAmount ?? 0);
      const totalStr = this.formatMoney(invoice.total);

      const totalsX = left + usableWidth * 0.7;

      doc
        .font('Body')
        .fontSize(11)
        .text('Subtotal:', totalsX, doc.y, {
          align: 'right',
          width: usableWidth * 0.28,
        });
      doc.text(`${subtotalStr} ${invoice.currency}`, { align: 'right' });

      doc.moveDown(0.3);
      doc.text('Tax:', totalsX, doc.y, {
        align: 'right',
        width: usableWidth * 0.28,
      });
      doc.text(`${taxAmountStr} ${invoice.currency}`, { align: 'right' });

      doc.moveDown(0.3);
      doc
        .font('BodyBold')
        .fontSize(14)
        .text('Total:', totalsX, doc.y, {
          align: 'right',
          width: usableWidth * 0.28,
        });
      doc.text(`${totalStr} ${invoice.currency}`, { align: 'right' });

      doc.moveDown(1.6);

      const leftColumn = [
        `Beneficiary: ${org.beneficiaryName || org.legalName || org.name || '—'}`,
        org.iban ? `IBAN: ${this.formatIban(org.iban)}` : null,
        org.swiftBic ? `SWIFT/BIC: ${org.swiftBic}` : null,
        org.bankName ? `Bank: ${org.bankName}` : null,
        org.bankAddress ? `Bank address: ${org.bankAddress}` : null,
      ].filter(Boolean) as string[];

      const rightColumn = [
        org.vatId ? `VAT/Tax ID: ${org.vatId}` : null,
        org.registrationNumber ? `Reg. No: ${org.registrationNumber}` : null,
        org.legalAddress ? `Legal address: ${org.legalAddress}` : null,
        `Reference: ${
          org.paymentReferenceHint ||
          'Please use the invoice number as payment reference.'
        }`,
      ].filter(Boolean) as string[];

      const startY = doc.y;

      // ширина блоку реквізитів
      const colWidth = 260;

      // X позиція правого блоку — зсунута ближче до правого краю
      const colXRight = left + usableWidth - colWidth + 18;

      // заголовок тепер теж вирівняний під блок
      doc
        .font('BodyBold')
        .fontSize(11)
        .text('Payment details', colXRight, startY - 16, { underline: true });

      // сам блок реквізитів одним стовпчиком
      doc.font('Body').fontSize(9);
      doc.text([...leftColumn, ...rightColumn].join('\n'), colXRight, startY, {
        width: colWidth,
      });

      doc.moveDown(6);

      doc.font('BodyBold').fontSize(11).text('Notes', { underline: true });
      doc.moveDown(0.3);
      doc
        .font('Body')
        .fontSize(10)
        .text(invoice.notes?.trim() || '—', { width: usableWidth });

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
