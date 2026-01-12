import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentSource, DocumentStatus } from '@prisma/client';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { FileStorageService } from '../file-storage/file-storage.service';

@Injectable()
export class QuotePdfService {
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

  /**
   * Будує PDF у Buffer для переданої пропозиції.
   */
  private async buildPdfBuffer(quote: any): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ========= ШРИФТИ (Inter) =========
      const fontsRoot = path.join(process.cwd(), 'fonts', 'Inter');
      const interVariablePath = path.join(
        fontsRoot,
        'Inter-VariableFont_opsz,wght.ttf',
      );

      doc.registerFont('Body', interVariablePath);
      doc.registerFont('BodyBold', interVariablePath);

      // HEADER
      const orgName = quote.organization?.name || 'Commercial Offer';
      doc.font('BodyBold').fontSize(20).text(orgName, { align: 'left' });
      doc.moveDown(0.5);

      // Org meta
      doc.font('Body').fontSize(10);
      if (quote.organization?.industry) doc.text(quote.organization.industry);

      const orgLines: string[] = [];

      if (quote.organization?.country || quote.organization?.city) {
        orgLines.push(
          [quote.organization.country, quote.organization.city]
            .filter(Boolean)
            .join(', '),
        );
      }
      if (quote.organization?.websiteUrl)
        orgLines.push(quote.organization.websiteUrl);
      if (quote.organization?.primaryContactEmail) {
        orgLines.push(`Email: ${quote.organization.primaryContactEmail}`);
      }
      if (quote.organization?.primaryContactPhone) {
        orgLines.push(`Phone: ${quote.organization.primaryContactPhone}`);
      }
      orgLines.forEach((l) => doc.text(l));

      // Right side: offer data
      const issueDate = quote.issueDate
        ? quote.issueDate.toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      const validUntil = quote.validUntil
        ? quote.validUntil.toISOString().slice(0, 10)
        : '-';

      doc
        .font('Body')
        .fontSize(12)
        .text(`Commercial Offer № ${quote.number}`, { align: 'right' })
        .text(`Date: ${issueDate}`, { align: 'right' })
        .text(`Valid until: ${validUntil}`, { align: 'right' });

      doc.moveDown(1.5);

      // Buyer / Client
      doc.font('BodyBold').fontSize(12).text('Buyer', { underline: true });
      doc.font('Body').fontSize(10);

      if (quote.client) {
        doc.text(quote.client.name || '—');
        if (quote.client.contactName)
          doc.text(`Contact: ${quote.client.contactName}`);
        if (quote.client.email) doc.text(`Email: ${quote.client.email}`);
        if (quote.client.phone) doc.text(`Phone: ${quote.client.phone}`);
        if (quote.client.taxNumber)
          doc.text(`Tax/VAT ID: ${quote.client.taxNumber}`);
        if (quote.client.address) doc.text(`Address: ${quote.client.address}`);
      } else {
        doc.text('—');
      }

      doc.moveDown(1.5);

      // Table header
      const tableTop = doc.y;
      const colX = {
        name: 50,
        qty: 300,
        price: 360,
        tax: 440,
        total: 500,
      };

      doc.font('BodyBold').fontSize(10).text('Item', colX.name, tableTop);
      doc.font('BodyBold').text('Qty', colX.qty, tableTop);
      doc.font('BodyBold').text('Price', colX.price, tableTop);
      doc.font('BodyBold').text('Tax, %', colX.tax, tableTop);
      doc.font('BodyBold').text('Amount', colX.total, tableTop);

      doc
        .moveTo(50, tableTop + 14)
        .lineTo(550, tableTop + 14)
        .stroke();

      let y = tableTop + 20;
      const rowHeight = 18;
      const maxY = 750;

      (quote.items || []).forEach((item: any) => {
        if (y > maxY) {
          doc.addPage();
          y = 50;

          doc.font('BodyBold').fontSize(10).text('Item', colX.name, y);
          doc.font('BodyBold').text('Qty', colX.qty, y);
          doc.font('BodyBold').text('Price', colX.price, y);
          doc.font('BodyBold').text('Tax, %', colX.tax, y);
          doc.font('BodyBold').text('Amount', colX.total, y);

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
          .text(item.name, colX.name, y, { width: colX.qty - colX.name - 10 });

        doc.text(String(item.quantity), colX.qty, y);

        doc.text(
          `${this.formatMoney(item.unitPrice)} ${quote.currency}`,
          colX.price,
          y,
        );

        doc.text(taxRateStr, colX.tax, y);

        doc.text(
          `${this.formatMoney(item.lineTotal)} ${quote.currency}`,
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

      // Totals
      const subtotalStr = this.formatMoney(quote.subtotal);
      const taxAmountStr = this.formatMoney(quote.taxAmount ?? 0);
      const totalStr = this.formatMoney(quote.total);

      doc
        .font('Body')
        .fontSize(10)
        .text(`Subtotal: ${subtotalStr} ${quote.currency}`, { align: 'right' });

      doc
        .font('Body')
        .text(`Tax: ${taxAmountStr} ${quote.currency}`, { align: 'right' });

      doc
        .font('BodyBold')
        .fontSize(12)
        .text(`Total: ${totalStr} ${quote.currency}`, { align: 'right' });

      doc.moveDown(2);

      if (quote.notes) {
        doc
          .font('BodyBold')
          .fontSize(10)
          .text('Notes:', { underline: true })
          .moveDown(0.5)
          .font('Body')
          .fontSize(9)
          .text(quote.notes);
      }

      doc.end();
    });
  }

  private async generateAndAttach(quoteId: string, requestedByUserId: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: {
        items: true,
        client: true,
        organization: true,
        createdBy: true,
      },
    });

    if (!quote) throw new NotFoundException('Quote not found');

    const safeNumber = quote.number.replace(/[^a-zA-Z0-9\-]/g, '_');
    const fileName = `quote-${safeNumber}.pdf`;

    // 1) build pdf
    const pdfBuffer = await this.buildPdfBuffer(quote);

    // 2) upload to S3
    const storageKey = await this.fileStorage.uploadFile(
      {
        originalname: fileName,
        mimetype: 'application/pdf',
        buffer: pdfBuffer,
      } as any,
      { organizationId: quote.organizationId },
    );

    // 3) create/update Document
    let documentId = quote.pdfDocumentId;

    if (documentId) {
      await this.prisma.document.update({
        where: { id: documentId },
        data: {
          originalName: fileName,
          mimeType: 'application/pdf',
          sizeBytes: pdfBuffer.length,
          storageKey,
          status: DocumentStatus.READY,
        },
      });
    } else {
      const docRecord = await this.prisma.document.create({
        data: {
          organizationId: quote.organizationId,
          createdById: requestedByUserId,
          title: `Quote ${quote.number}`,
          originalName: fileName,
          mimeType: 'application/pdf',
          sizeBytes: pdfBuffer.length,
          storageKey,
          source: DocumentSource.MANUAL,
          status: DocumentStatus.READY,
        },
      });

      documentId = docRecord.id;

      await this.prisma.quote.update({
        where: { id: quoteId },
        data: {
          pdfDocumentId: documentId,
        },
      });
    }

    return { documentId, storageKey };
  }

  async getOrCreatePdfForQuote(quoteId: string) {
    const quote = await this.prisma.quote.findUnique({
      where: { id: quoteId },
      include: { organization: true, createdBy: true, pdfDocument: true },
    });

    if (!quote) throw new NotFoundException('Quote not found');

    if (!quote.pdfDocumentId || !quote.pdfDocument) {
      const { storageKey } = await this.generateAndAttach(
        quoteId,
        quote.createdById,
      );

      const updated = await this.prisma.quote.findUnique({
        where: { id: quoteId },
        include: { pdfDocument: true },
      });

      if (!updated?.pdfDocument) {
        throw new NotFoundException('PDF document for quote not found');
      }

      const pdfBuffer = await this.fileStorage.getFile(storageKey);

      return { document: updated.pdfDocument, pdfBuffer };
    }

    const pdfBuffer = await this.fileStorage.getFile(
      quote.pdfDocument.storageKey,
    );

    return { document: quote.pdfDocument, pdfBuffer };
  }
}
