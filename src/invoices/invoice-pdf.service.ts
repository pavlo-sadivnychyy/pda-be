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
    if (typeof value.toNumber === 'function') {
      // @ts-ignore
      const num = value.toNumber();
      return num.toFixed(2);
    }
    return String(value);
  }

  // ===== UA PDF (твій поточний) =====
  private async buildUaPdfBuffer(invoice: any): Promise<Buffer> {
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
        .text(invoice.organization.name || 'Invoice', { align: 'left' });

      doc.moveDown(0.5);

      doc.font('Body').fontSize(10);
      if (invoice.organization.industry) {
        doc.text(invoice.organization.industry);
      }
      const orgLines: string[] = [];

      if (invoice.organization.country || invoice.organization.city) {
        orgLines.push(
          [invoice.organization.country, invoice.organization.city]
            .filter(Boolean)
            .join(', '),
        );
      }
      if (invoice.organization.websiteUrl) {
        orgLines.push(invoice.organization.websiteUrl);
      }
      if (invoice.organization.primaryContactEmail) {
        orgLines.push(`Email: ${invoice.organization.primaryContactEmail}`);
      }
      if (invoice.organization.primaryContactPhone) {
        orgLines.push(`Тел: ${invoice.organization.primaryContactPhone}`);
      }

      orgLines.forEach((line) => doc.text(line));

      const issueDate = invoice.issueDate.toISOString().slice(0, 10);
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
        doc.text(invoice.client.name);
        if (invoice.client.contactName) {
          doc.text(`Контактна особа: ${invoice.client.contactName}`);
        }
        if (invoice.client.email) {
          doc.text(`Email: ${invoice.client.email}`);
        }
        if (invoice.client.phone) {
          doc.text(`Телефон: ${invoice.client.phone}`);
        }
        if (invoice.client.taxNumber) {
          doc.text(`Податковий номер: ${invoice.client.taxNumber}`);
        }
        if (invoice.client.address) {
          doc.text(`Адреса: ${invoice.client.address}`);
        }
      } else {
        doc.text('—');
      }

      doc.moveDown(1.5);

      const tableTop = doc.y;
      const colX = {
        name: 50,
        qty: 280,
        price: 330,
        tax: 400,
        total: 470,
      };

      doc.font('BodyBold').fontSize(10).text('Позиція', colX.name, tableTop);
      doc.font('BodyBold').text('К-сть', colX.qty, tableTop);
      doc.font('BodyBold').text('Ціна', colX.price, tableTop);
      doc.font('BodyBold').text('ПДВ, %', colX.tax, tableTop);
      doc.font('BodyBold').text('Сума', colX.total, tableTop);

      doc
        .moveTo(50, tableTop + 14)
        .lineTo(550, tableTop + 14)
        .stroke();

      let y = tableTop + 20;

      const rowHeight = 18;
      const maxY = 750;

      invoice.items.forEach((item: any) => {
        if (y > maxY) {
          doc.addPage();
          y = 50;

          doc.font('BodyBold').fontSize(10).text('Позиція', colX.name, y);
          doc.font('BodyBold').text('К-сть', colX.qty, y);
          doc.font('BodyBold').text('Ціна', colX.price, y);
          doc.font('BodyBold').text('ПДВ, %', colX.tax, y);
          doc.font('BodyBold').text('Сума', colX.total, y);
          doc
            .moveTo(50, y + 14)
            .lineTo(550, y + 14)
            .stroke();
          y += 20;
        }

        const taxRateStr =
          item.taxRate != null
            ? `${item.taxRate.toString().replace('.', ',')}`
            : '-';

        doc
          .font('Body')
          .fontSize(10)
          .text(item.name, colX.name, y, {
            width: colX.qty - colX.name - 10,
          });

        doc.text(item.quantity.toString(), colX.qty, y);
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
      });

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
      doc
        .font('Body')
        .text(`ПДВ: ${taxAmountStr} ${invoice.currency}`, { align: 'right' });
      doc
        .font('BodyBold')
        .fontSize(12)
        .text(`До оплати: ${totalStr} ${invoice.currency}`, {
          align: 'right',
        });

      doc.moveDown(2);

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

      doc.end();
    });
  }

  // ✅ INTERNATIONAL PDF (новий)
  private async buildInternationalPdfBuffer(invoice: any): Promise<Buffer> {
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

      // Header
      doc.font('BodyBold').fontSize(22).text('INVOICE', { align: 'left' });

      doc.moveDown(0.5);

      // Seller (Organization)
      doc.font('BodyBold').fontSize(11).text('Seller', { underline: true });
      doc.font('Body').fontSize(10);

      const org = invoice.organization;
      const sellerLines: string[] = [];

      sellerLines.push(org.name || '—');

      const sellerLocation = [org.city, org.country].filter(Boolean).join(', ');
      if (sellerLocation) sellerLines.push(sellerLocation);

      if (org.websiteUrl) sellerLines.push(org.websiteUrl);
      if (org.primaryContactEmail)
        sellerLines.push(`Email: ${org.primaryContactEmail}`);
      if (org.primaryContactPhone)
        sellerLines.push(`Phone: ${org.primaryContactPhone}`);

      sellerLines.forEach((l) => doc.text(l));

      // Invoice info (right)
      const issueDate = invoice.issueDate.toISOString().slice(0, 10);
      const dueDate = invoice.dueDate
        ? invoice.dueDate.toISOString().slice(0, 10)
        : '-';

      doc
        .font('Body')
        .fontSize(11)
        .text(`Invoice No: ${invoice.number}`, { align: 'right' })
        .text(`Issue Date: ${issueDate}`, { align: 'right' })
        .text(`Due Date: ${dueDate}`, { align: 'right' })
        .text(`Currency: ${invoice.currency}`, { align: 'right' });

      doc.moveDown(1);

      // Buyer
      doc.font('BodyBold').fontSize(11).text('Buyer', { underline: true });
      doc.font('Body').fontSize(10);

      const client = invoice.client;
      if (client) {
        doc.text(client.name || '—');
        if (client.contactName) doc.text(`Contact: ${client.contactName}`);
        if (client.email) doc.text(`Email: ${client.email}`);
        if (client.phone) doc.text(`Phone: ${client.phone}`);
        if (client.taxNumber) doc.text(`Tax/VAT ID: ${client.taxNumber}`);
        if (client.address) doc.text(`Address: ${client.address}`);
      } else {
        doc.text('—');
      }

      doc.moveDown(1.2);

      // Items table
      const tableTop = doc.y;
      const colX = {
        desc: 50,
        qty: 300,
        price: 360,
        tax: 430,
        total: 490,
      };

      doc
        .font('BodyBold')
        .fontSize(10)
        .text('Description', colX.desc, tableTop);
      doc.font('BodyBold').text('Qty', colX.qty, tableTop);
      doc.font('BodyBold').text('Unit', colX.price, tableTop);
      doc.font('BodyBold').text('Tax %', colX.tax, tableTop);
      doc.font('BodyBold').text('Amount', colX.total, tableTop);

      doc
        .moveTo(50, tableTop + 14)
        .lineTo(550, tableTop + 14)
        .stroke();

      let y = tableTop + 20;
      const rowHeight = 18;
      const maxY = 750;

      invoice.items.forEach((item: any) => {
        if (y > maxY) {
          doc.addPage();
          y = 50;

          doc.font('BodyBold').fontSize(10).text('Description', colX.desc, y);
          doc.font('BodyBold').text('Qty', colX.qty, y);
          doc.font('BodyBold').text('Unit', colX.price, y);
          doc.font('BodyBold').text('Tax %', colX.tax, y);
          doc.font('BodyBold').text('Amount', colX.total, y);

          doc
            .moveTo(50, y + 14)
            .lineTo(550, y + 14)
            .stroke();

          y += 20;
        }

        const taxRateStr = item.taxRate != null ? `${item.taxRate}` : '-';

        doc
          .font('Body')
          .fontSize(10)
          .text(item.name, colX.desc, y, {
            width: colX.qty - colX.desc - 10,
          });

        doc.text(String(item.quantity), colX.qty, y);
        doc.text(this.formatMoney(item.unitPrice), colX.price, y);
        doc.text(taxRateStr, colX.tax, y);
        doc.text(this.formatMoney(item.lineTotal), colX.total, y);

        y += rowHeight;

        if (item.description) {
          doc
            .font('Body')
            .fontSize(9)
            .fillColor('#6b7280')
            .text(item.description, colX.desc, y, {
              width: 520 - colX.desc,
            })
            .fillColor('#000000');
          y += rowHeight;
        }
      });

      doc.moveDown(1.5);

      // Totals
      const subtotalStr = this.formatMoney(invoice.subtotal);
      const taxAmountStr = this.formatMoney(invoice.taxAmount ?? 0);
      const totalStr = this.formatMoney(invoice.total);

      doc
        .font('Body')
        .fontSize(10)
        .text(`Subtotal: ${subtotalStr} ${invoice.currency}`, {
          align: 'right',
        });
      doc
        .font('Body')
        .text(`Tax: ${taxAmountStr} ${invoice.currency}`, { align: 'right' });
      doc
        .font('BodyBold')
        .fontSize(12)
        .text(`Total: ${totalStr} ${invoice.currency}`, { align: 'right' });

      doc.moveDown(1.5);

      // Notes / Payment instructions
      doc.font('BodyBold').fontSize(10).text('Notes', { underline: true });
      doc.font('Body').fontSize(9);
      doc.text(
        invoice.notes
          ? String(invoice.notes)
          : 'Payment instructions: please use invoice number as payment reference.',
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
      },
    });

    if (!invoice) {
      throw new NotFoundException('Інвойс не знайдено');
    }

    const safeNumber = invoice.number.replace(/[^a-zA-Z0-9\-]/g, '_');

    const fileName =
      kind === 'UA'
        ? `invoice-${safeNumber}.pdf`
        : `invoice-${safeNumber}-international.pdf`;

    const pdfBuffer =
      kind === 'UA'
        ? await this.buildUaPdfBuffer(invoice)
        : await this.buildInternationalPdfBuffer(invoice);

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
        : invoice.internationalPdfDocumentId;

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

      return { documentId: existingDocumentId, storageKey };
    }

    const docRecord = await this.prisma.document.create({
      data: {
        organizationId: invoice.organizationId,
        createdById: requestedByUserId,
        title:
          kind === 'UA'
            ? `Invoice ${invoice.number} (UA)`
            : `Invoice ${invoice.number} (International)`,
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
        data: { internationalPdfDocumentId: docRecord.id },
      });
    }

    return { documentId: docRecord.id, storageKey };
  }

  // ===== Public methods =====

  async getOrCreatePdfForInvoiceUa(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { createdBy: true, pdfDocument: true },
    });

    if (!invoice) throw new NotFoundException('Інвойс не знайдено');

    if (!invoice.pdfDocumentId || !invoice.pdfDocument) {
      const { storageKey } = await this.generateAndAttach(
        invoiceId,
        invoice.createdById,
        'UA',
      );

      const updated = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { pdfDocument: true },
      });

      if (!updated?.pdfDocument) {
        throw new NotFoundException('PDF-документ для інвойсу не знайдено');
      }

      const pdfBuffer = await this.fileStorage.getFile(storageKey);
      return { document: updated.pdfDocument, pdfBuffer };
    }

    const pdfBuffer = await this.fileStorage.getFile(
      invoice.pdfDocument.storageKey,
    );

    return { document: invoice.pdfDocument, pdfBuffer };
  }

  async getOrCreatePdfForInvoiceInternational(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { createdBy: true, internationalPdfDocument: true },
    });

    if (!invoice) throw new NotFoundException('Інвойс не знайдено');

    if (
      !invoice.internationalPdfDocumentId ||
      !invoice.internationalPdfDocument
    ) {
      const { storageKey } = await this.generateAndAttach(
        invoiceId,
        invoice.createdById,
        'INTERNATIONAL',
      );

      const updated = await this.prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { internationalPdfDocument: true },
      });

      if (!updated?.internationalPdfDocument) {
        throw new NotFoundException('International PDF-документ не знайдено');
      }

      const pdfBuffer = await this.fileStorage.getFile(storageKey);
      return { document: updated.internationalPdfDocument, pdfBuffer };
    }

    const pdfBuffer = await this.fileStorage.getFile(
      invoice.internationalPdfDocument.storageKey,
    );

    return { document: invoice.internationalPdfDocument, pdfBuffer };
  }
}
