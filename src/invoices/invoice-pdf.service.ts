import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentSource, DocumentStatus } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import PDFDocument from 'pdfkit';

@Injectable()
export class InvoicePdfService {
  constructor(private readonly prisma: PrismaService) {}

  private getUploadsRoot() {
    // можна винести в env: UPLOADS_ROOT=/var/app/uploads
    return process.env.UPLOADS_ROOT || path.join(process.cwd(), 'uploads');
  }

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

  /**
   * Генерує PDF для інвойсу, зберігає Document і лінкує до Invoice.pdfDocumentId.
   * Якщо файл/Document уже існує і ти хочеш завжди перевиготовляти — він перезапише файл,
   * але створювати новий Document не буде — можна надалі розширити.
   */
  async generateAndAttach(invoiceId: string, requestedByUserId: string) {
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

    const uploadsRoot = this.getUploadsRoot();
    const invoicesDir = path.join(uploadsRoot, 'invoices');
    await fs.promises.mkdir(invoicesDir, { recursive: true });

    const safeNumber = invoice.number.replace(/[^a-zA-Z0-9\-]/g, '_');
    const fileName = `invoice-${safeNumber}.pdf`;
    const filePath = path.join(invoicesDir, fileName);
    const storageKey = path.posix.join('invoices', fileName);

    // ==== PDF ====
    const doc = new PDFDocument({ margin: 50 });

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // ========= ШРИФТИ З КИРИЛИЦЕЮ =========
    // Очікуємо, що шрифт лежить за шляхом: <root>/fonts/Inter/Inter-VariableFont_opsz,wght.ttf
    const fontsRoot = path.join(process.cwd(), 'fonts', 'Inter');
    const interVariablePath = path.join(
      fontsRoot,
      'Inter-VariableFont_opsz,wght.ttf',
    );

    doc.registerFont('Body', interVariablePath);
    doc.registerFont('BodyBold', interVariablePath);

    // HEADER: Організація + Invoice info
    doc
      .font('BodyBold')
      .fontSize(20)
      .text(invoice.organization.name || 'Invoice', { align: 'left' });

    doc.moveDown(0.5);

    // Реквізити організації
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

    // Праворуч — номер інвойсу / дати
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

    // BLOCK: Клієнт
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

    // ТАБЛИЦЯ ПОЗИЦІЙ
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

    invoice.items.forEach((item) => {
      if (y > maxY) {
        doc.addPage();
        y = 50;

        // повторити заголовок таблиці на новій сторінці
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

    // ПІДСУМКИ
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

    await new Promise<void>((resolve, reject) => {
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    });

    const stats = await fs.promises.stat(filePath);

    // Якщо вже був pdfDocumentId — оновлюємо існуючий Document; інакше створюємо новий
    let documentId = invoice.pdfDocumentId;

    if (documentId) {
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          originalName: fileName,
          mimeType: 'application/pdf',
          sizeBytes: stats.size,
          storageKey,
          status: DocumentStatus.READY,
        },
      });
    } else {
      const docRecord = await this.prisma.document.create({
        data: {
          organizationId: invoice.organizationId,
          createdById: requestedByUserId,
          title: `Invoice ${invoice.number}`,
          originalName: fileName,
          mimeType: 'application/pdf',
          sizeBytes: stats.size,
          storageKey,
          source: DocumentSource.MANUAL,
          status: DocumentStatus.READY,
        },
      });

      documentId = docRecord.id;

      await this.prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          pdfDocumentId: documentId,
        },
      });
    }

    return { documentId, storageKey, filePath };
  }

  /**
   * Повертає Document + абсолютний шлях до файлу для інвойсу.
   * Якщо немає pdfDocumentId — генерує PDF.
   */
  async getOrCreatePdfForInvoice(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { organization: true, createdBy: true },
    });

    if (!invoice) {
      throw new NotFoundException('Інвойс не знайдено');
    }

    if (!invoice.pdfDocumentId) {
      await this.generateAndAttach(invoiceId, invoice.createdById);
    }

    const updated = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        pdfDocument: true,
      },
    });

    if (!updated?.pdfDocument) {
      throw new NotFoundException('PDF-документ для інвойсу не знайдено');
    }

    const uploadsRoot = this.getUploadsRoot();
    const filePath = path.join(uploadsRoot, updated.pdfDocument.storageKey);

    return { document: updated.pdfDocument, filePath };
  }
}
