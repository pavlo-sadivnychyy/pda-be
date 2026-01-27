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
    if (value == null) return '0,00';
    let num: number;

    if (typeof value === 'number') {
      num = value;
    } else if (typeof value === 'string') {
      num = parseFloat(value);
    } else if (value && typeof value.toNumber === 'function') {
      // @ts-ignore
      num = value.toNumber();
    } else {
      return String(value);
    }

    return isNaN(num) ? '0,00' : num.toFixed(2).replace('.', ',');
  }

  private async buildPdfBuffer(quote: any): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        margin: 48,
        size: 'A4',
        layout: 'portrait',
        bufferPages: true,
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ────────────────────────────────────────────────
      // ШРИФТИ
      // ────────────────────────────────────────────────
      const fontsRoot = path.join(process.cwd(), 'fonts', 'Inter');
      const interVar = path.join(fontsRoot, 'Inter-VariableFont_opsz,wght.ttf');

      doc.registerFont('Inter', interVar);
      doc.registerFont('Inter-Bold', interVar);

      // ────────────────────────────────────────────────
      // Колірна палітра
      // ────────────────────────────────────────────────
      const c = {
        black: '#1a1a1a',
        grayDark: '#4a4a4a',
        gray: '#6e6e6e',
        grayLight: '#9e9e9e',
        border: '#e0e0e0',
        bgLight: '#f8f9fb',
        accent: '#4a4a4a', // нейтральний замість синього
      };

      const pageWidth = doc.page.width;
      const contentWidth = pageWidth - 96;
      const padding = 8;

      // ────────────────────────────────────────────────
      // HEADER
      // ────────────────────────────────────────────────
      doc
        .font('Inter-Bold')
        .fontSize(20)
        .fillColor(c.black)
        .text(quote.organization?.name || 'Комерційна пропозиція', 48, 36);

      if (quote.organization?.industry) {
        doc
          .font('Inter')
          .fontSize(10)
          .fillColor(c.gray)
          .text(quote.organization.industry, 48, 62);
      }

      const rightBlockX = pageWidth - 48 - 220;
      let rightY = 36;

      doc
        .font('Inter-Bold')
        .fontSize(13)
        .fillColor(c.black)
        .text('Комерційна пропозиція №', rightBlockX, rightY, {
          align: 'right',
          width: 220,
        });

      rightY += 20;
      doc
        .font('Inter-Bold')
        .fontSize(15)
        .fillColor(c.accent)
        .text(quote.number || '—', rightBlockX, rightY, {
          align: 'right',
          width: 220,
        });

      rightY += 22;
      doc
        .font('Inter')
        .fontSize(10)
        .fillColor(c.gray)
        .text(
          `Дійсна до: ${quote.validUntil ? quote.validUntil.toISOString().slice(0, 10) : '—'}`,
          rightBlockX,
          rightY,
          {
            align: 'right',
            width: 220,
          },
        );

      doc
        .moveTo(48, 100)
        .lineTo(pageWidth - 48, 100)
        .lineWidth(0.75)
        .strokeColor(c.border)
        .stroke();

      doc.y = 118;

      // ────────────────────────────────────────────────
      // БЛОК ПОСТАЧАЛЬНИК / ПОКУПЕЦЬ
      // ────────────────────────────────────────────────
      const blockY = doc.y;
      const blockHeight = 108;
      const blockRadius = 6;

      // Постачальник
      doc
        .roundedRect(48, blockY, 240, blockHeight, blockRadius)
        .fillAndStroke(c.bgLight, c.border);

      doc
        .font('Inter-Bold')
        .fontSize(11)
        .fillColor(c.black)
        .text('ПОСТАЧАЛЬНИК', 48 + padding, blockY + 16);

      let supplierY = blockY + 38;
      doc.font('Inter').fontSize(9).fillColor(c.grayDark);

      const supplierLines = [
        [quote.organization?.city, quote.organization?.country]
          .filter(Boolean)
          .join(', ') || '',
        quote.organization?.primaryContactEmail
          ? `Email: ${quote.organization.primaryContactEmail}`
          : '',
        quote.organization?.primaryContactPhone
          ? `Тел: ${quote.organization.primaryContactPhone}`
          : '',
        quote.organization?.websiteUrl
          ? `Сайт: ${quote.organization.websiteUrl}`
          : '',
      ].filter(Boolean);

      supplierLines.forEach((line) => {
        doc.text(line, 48 + padding, supplierY, { width: 240 - 2 * padding });
        supplierY += 14;
      });

      // Покупець
      doc
        .roundedRect(
          pageWidth - 48 - 240,
          blockY,
          240,
          blockHeight,
          blockRadius,
        )
        .fillAndStroke(c.bgLight, c.border);

      doc
        .font('Inter-Bold')
        .fontSize(11)
        .fillColor(c.black)
        .text('ПОКУПЕЦЬ', pageWidth - 48 - 240 + padding, blockY + 16);

      let buyerY = blockY + 38;
      doc.font('Inter').fontSize(9).fillColor(c.grayDark);

      if (quote.client) {
        const buyerLines = [
          quote.client.name || '',
          quote.client.contactName
            ? `Контакт: ${quote.client.contactName}`
            : '',
          quote.client.email ? `Email: ${quote.client.email}` : '',
          quote.client.phone ? `Тел: ${quote.client.phone}` : '',
          quote.client.taxNumber ? `ЄДРПОУ/ІПН: ${quote.client.taxNumber}` : '',
          quote.client.address ? `Адреса: ${quote.client.address}` : '',
        ].filter(Boolean);

        buyerLines.forEach((line) => {
          doc.text(line, pageWidth - 48 - 240 + padding, buyerY, {
            width: 240 - 2 * padding,
          });
          buyerY += 14;
        });
      } else {
        doc.text('—', pageWidth - 48 - 240 + padding, buyerY);
      }

      doc.y = blockY + blockHeight + 24;

      // ────────────────────────────────────────────────
      // ТАБЛИЦЯ ТОВАРІВ
      // ────────────────────────────────────────────────
      const tableTop = doc.y;

      const colWidths = {
        num: 28,
        name: contentWidth - 28 - 40 - 32 - 60 - 40 - 68 - 5 * padding,
        qty: 40,
        unit: 32,
        price: 60,
        tax: 40,
        total: 68, // зменшено з 70 → 68, щоб уникнути зрізання
      };

      const colX = {
        num: 48,
        name: 48 + colWidths.num + padding,
        qty: 48 + colWidths.num + colWidths.name + 2 * padding,
        unit: 48 + colWidths.num + colWidths.name + colWidths.qty + 3 * padding,
        price:
          48 +
          colWidths.num +
          colWidths.name +
          colWidths.qty +
          colWidths.unit +
          4 * padding,
        tax:
          48 +
          colWidths.num +
          colWidths.name +
          colWidths.qty +
          colWidths.unit +
          colWidths.price +
          5 * padding,
        total: pageWidth - 48 - colWidths.total, // без +padding — ключова правка
      };

      // Заголовок таблиці
      doc.font('Inter-Bold').fontSize(9).fillColor(c.black);

      doc.text('№', colX.num, tableTop, {
        width: colWidths.num,
        align: 'center',
      });
      doc.text('Найменування', colX.name, tableTop, { width: colWidths.name });
      doc.text('К-сть', colX.qty, tableTop, {
        width: colWidths.qty,
        align: 'center',
      });
      doc.text('Од.', colX.unit, tableTop, {
        width: colWidths.unit,
        align: 'center',
      });
      doc.text('Ціна', colX.price, tableTop, {
        width: colWidths.price,
        align: 'right',
      });
      doc.text('ПДВ', colX.tax, tableTop, {
        width: colWidths.tax,
        align: 'center',
      });
      doc.text('Сума', colX.total, tableTop, {
        width: colWidths.total - 6, // запас для right align
        align: 'right',
      });

      doc
        .roundedRect(48, tableTop - 4, contentWidth, 20, 4)
        .fillOpacity(0.4)
        .fill(c.bgLight)
        .fillOpacity(1);

      doc
        .moveTo(48, tableTop + 20)
        .lineTo(pageWidth - 48, tableTop + 20)
        .lineWidth(1)
        .strokeColor(c.border)
        .stroke();

      let rowY = tableTop + 28;
      const rowHeight = 24;
      const pageBottom = 760;
      let itemIndex = 1;

      for (const item of quote.items || []) {
        if (rowY + rowHeight > pageBottom) {
          doc.addPage();
          rowY = 60;

          doc.font('Inter-Bold').fontSize(9).fillColor(c.black);

          doc.text('№', colX.num, rowY - 28, {
            width: colWidths.num,
            align: 'center',
          });
          doc.text('Найменування', colX.name, rowY - 28, {
            width: colWidths.name,
          });
          doc.text('К-сть', colX.qty, rowY - 28, {
            width: colWidths.qty,
            align: 'center',
          });
          doc.text('Од.', colX.unit, rowY - 28, {
            width: colWidths.unit,
            align: 'center',
          });
          doc.text('Ціна', colX.price, rowY - 28, {
            width: colWidths.price,
            align: 'right',
          });
          doc.text('ПДВ', colX.tax, rowY - 28, {
            width: colWidths.tax,
            align: 'center',
          });
          doc.text('Сума', colX.total, rowY - 28, {
            width: colWidths.total - 6,
            align: 'right',
          });

          doc
            .roundedRect(48, rowY - 32, contentWidth, 20, 4)
            .fillOpacity(0.4)
            .fill(c.bgLight)
            .fillOpacity(1);

          doc
            .moveTo(48, rowY - 8)
            .lineTo(pageWidth - 48, rowY - 8)
            .strokeColor(c.border)
            .stroke();

          rowY += 8;
        }

        const isEven = itemIndex % 2 === 0;

        if (isEven) {
          doc
            .roundedRect(48, rowY - 4, contentWidth, rowHeight + 4, 3)
            .fillOpacity(0.4)
            .fill(c.bgLight)
            .fillOpacity(1);
        }

        doc.font('Inter').fontSize(9).fillColor(c.black);

        doc.text(String(itemIndex), colX.num, rowY, {
          width: colWidths.num,
          align: 'center',
        });
        doc.text(item.name || '', colX.name, rowY, { width: colWidths.name });
        doc.text(String(item.quantity || '—'), colX.qty, rowY, {
          width: colWidths.qty,
          align: 'center',
        });
        doc.text(item.unit || 'шт', colX.unit, rowY, {
          width: colWidths.unit,
          align: 'center',
        });
        doc.text(this.formatMoney(item.unitPrice), colX.price, rowY, {
          width: colWidths.price,
          align: 'right',
        });
        doc.text(
          item.taxRate != null
            ? `${item.taxRate.toString().replace('.', ',')}%`
            : '—',
          colX.tax,
          rowY,
          { width: colWidths.tax, align: 'center' },
        );
        doc.text(this.formatMoney(item.lineTotal), colX.total, rowY, {
          width: colWidths.total - 6, // ← ключовий запас для уникнення зрізання
          align: 'right',
        });

        rowY += rowHeight;

        if (item.description?.trim()) {
          const descHeight = doc
            .font('Inter')
            .fontSize(8)
            .heightOfString(item.description.trim(), {
              width: colWidths.name + colWidths.qty + colWidths.unit + 40,
            });

          doc
            .font('Inter')
            .fontSize(8)
            .fillColor(c.gray)
            .text(item.description.trim(), colX.name, rowY, {
              width: colWidths.name + colWidths.qty + colWidths.unit + 40,
            });
          rowY += descHeight + padding;
        }

        doc
          .moveTo(48, rowY)
          .lineTo(pageWidth - 48, rowY)
          .lineWidth(0.4)
          .strokeColor(c.border)
          .stroke();

        rowY += padding;
        itemIndex++;
      }

      doc.y = rowY + 12;

      // ────────────────────────────────────────────────
      // Підсумки
      // ────────────────────────────────────────────────
      const totalsX = pageWidth - 48 - 240;
      const totalsY = doc.y;

      doc
        .roundedRect(
          totalsX - padding,
          totalsY - padding,
          240 + 2 * padding,
          92 + padding,
          6,
        )
        .fillAndStroke(c.bgLight, c.border);

      const valueX = totalsX + 135; // трохи більше відступу для довгих сум
      const valueWidth = 105; // зменшено для запасу

      doc
        .font('Inter')
        .fontSize(10)
        .fillColor(c.grayDark)
        .text('Сума без ПДВ:', totalsX + padding, totalsY);

      doc
        .font('Inter-Bold')
        .fillColor(c.black)
        .text(
          `${this.formatMoney(quote.subtotal)} ${quote.currency || 'грн'}`,
          valueX,
          totalsY,
          { align: 'right', width: valueWidth },
        );

      doc
        .font('Inter')
        .fillColor(c.grayDark)
        .text('ПДВ:', totalsX + padding, totalsY + 20);

      doc
        .font('Inter-Bold')
        .fillColor(c.black)
        .text(
          `${this.formatMoney(quote.taxAmount ?? 0)} ${quote.currency || 'грн'}`,
          valueX,
          totalsY + 20,
          { align: 'right', width: valueWidth },
        );

      doc
        .moveTo(totalsX + padding, totalsY + 42)
        .lineTo(totalsX + 240 + padding, totalsY + 42)
        .strokeColor(c.border)
        .stroke();

      doc
        .font('Inter-Bold')
        .fontSize(12)
        .fillColor(c.black)
        .text('Всього до сплати:', totalsX + padding, totalsY + 54);

      doc
        .font('Inter-Bold')
        .fontSize(13)
        .fillColor(c.accent)
        .text(
          `${this.formatMoney(quote.total)} ${quote.currency || 'грн'}`,
          valueX,
          totalsY + 52,
          { align: 'right', width: valueWidth },
        );

      doc.y = totalsY + 100 + padding;

      // ────────────────────────────────────────────────
      // Примітки
      // ────────────────────────────────────────────────
      if (quote.notes?.trim()) {
        doc.moveDown(1);

        doc
          .font('Inter-Bold')
          .fontSize(10)
          .fillColor(c.black)
          .text('ПРИМІТКИ:', 48 + padding, doc.y);

        doc
          .font('Inter')
          .fontSize(9)
          .fillColor(c.grayDark)
          .text(quote.notes.trim(), 48 + padding, doc.y + 16 + padding, {
            width: contentWidth - 2 * padding,
          });

        doc.y += 40 + padding;
      }

      // ────────────────────────────────────────────────
      // FOOTER
      // ────────────────────────────────────────────────
      const footerText = 'Дякуємо за довіру до співпраці!';
      doc
        .font('Inter')
        .fontSize(8)
        .fillColor(c.grayLight)
        .text(footerText, 48, doc.page.height - 54, {
          width: contentWidth,
          align: 'center',
        });

      if (quote.organization?.websiteUrl) {
        doc.text(quote.organization.websiteUrl, 48, doc.page.height - 40, {
          width: contentWidth,
          align: 'center',
        });
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

    if (!quote) throw new NotFoundException('Пропозицію не знайдено');

    const safeNumber = quote.number.replace(/[^a-zA-Z0-9\-]/g, '_');
    const fileName = `komertsijna-propozitsija-${safeNumber}.pdf`;

    const pdfBuffer = await this.buildPdfBuffer(quote);

    const storageKey = await this.fileStorage.uploadFile(
      {
        originalname: fileName,
        mimetype: 'application/pdf',
        buffer: pdfBuffer,
      } as any,
      { organizationId: quote.organizationId },
    );

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
          title: `Комерційна пропозиція ${quote.number}`,
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

    if (!quote) throw new NotFoundException('Пропозицію не знайдено');

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
        throw new NotFoundException('PDF документ для пропозиції не знайдено');
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
