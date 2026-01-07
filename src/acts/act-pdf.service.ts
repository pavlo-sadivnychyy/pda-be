import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DocumentSource, DocumentStatus } from '@prisma/client';
import * as path from 'path';
import PDFDocument from 'pdfkit';
import { FileStorageService } from '../file-storage/file-storage.service';

@Injectable()
export class ActPdfService {
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

  private async buildPdfBuffer(act: any): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ========= ШРИФТИ З КИРИЛИЦЕЮ =========
      const fontsRoot = path.join(process.cwd(), 'fonts', 'Inter');
      const interVariablePath = path.join(
        fontsRoot,
        'Inter-VariableFont_opsz,wght.ttf',
      );

      doc.registerFont('Body', interVariablePath);
      doc.registerFont('BodyBold', interVariablePath);

      // HEADER: Організація
      doc
        .font('BodyBold')
        .fontSize(20)
        .text(act.organization.name || 'Акт наданих послуг', {
          align: 'left',
        });

      doc.moveDown(0.5);

      // Реквізити організації
      doc.font('Body').fontSize(10);
      if (act.organization.industry) {
        doc.text(act.organization.industry);
      }
      const orgLines: string[] = [];

      if (act.organization.country || act.organization.city) {
        orgLines.push(
          [act.organization.country, act.organization.city]
            .filter(Boolean)
            .join(', '),
        );
      }
      if (act.organization.websiteUrl) {
        orgLines.push(act.organization.websiteUrl);
      }
      if (act.organization.primaryContactEmail) {
        orgLines.push(`Email: ${act.organization.primaryContactEmail}`);
      }
      if (act.organization.primaryContactPhone) {
        orgLines.push(`Тел: ${act.organization.primaryContactPhone}`);
      }

      orgLines.forEach((line) => doc.text(line));

      // Праворуч — інформація про акт
      let periodText = '-';
      if (act.periodFrom || act.periodTo) {
        const fromStr = act.periodFrom
          ? act.periodFrom.toISOString().slice(0, 10)
          : '...';
        const toStr = act.periodTo
          ? act.periodTo.toISOString().slice(0, 10)
          : '...';
        periodText = `${fromStr} — ${toStr}`;
      }

      doc
        .font('Body')
        .fontSize(12)
        .text(`Акт наданих послуг № ${act.number}`, { align: 'right' })
        .text(`Період: ${periodText}`, { align: 'right' });

      if (act.relatedInvoice) {
        doc.text(`За інвойсом № ${act.relatedInvoice.number}`, {
          align: 'right',
        });
      }

      doc.moveDown(1.5);

      // BLOCK: Клієнт
      doc.font('BodyBold').fontSize(12).text('Клієнт', { underline: true });

      doc.font('Body').fontSize(10);
      if (act.client) {
        doc.text(act.client.name);
        const asAny = act.client;

        if (asAny.contactName) {
          doc.text(`Контактна особа: ${asAny.contactName}`);
        }
        if (act.client.email) {
          doc.text(`Email: ${act.client.email}`);
        }
        if (act.client.phone) {
          doc.text(`Телефон: ${act.client.phone}`);
        }
        if (asAny.taxNumber) {
          doc.text(`Податковий номер: ${asAny.taxNumber}`);
        }
        if (act.client.address) {
          doc.text(`Адреса: ${act.client.address}`);
        }
      } else {
        doc.text('—');
      }

      doc.moveDown(1.5);

      // ОПИС АКТА
      if (act.title || act.notes) {
        doc
          .font('BodyBold')
          .fontSize(12)
          .text('Опис робіт / послуг', { underline: true });
        doc.moveDown(0.5);
        doc.font('Body').fontSize(10);

        if (act.title) {
          doc.text(act.title, { paragraphGap: 4 });
        }
        if (act.notes) {
          doc.text(act.notes, { paragraphGap: 4 });
        }

        doc.moveDown(1);
      }

      // ТАБЛИЦЯ ПОЗИЦІЙ (якщо є relatedInvoice з items)
      if (act.relatedInvoice && act.relatedInvoice.items.length > 0) {
        const invoice: any = act.relatedInvoice;
        const items: any[] = invoice.items;

        const tableTop = doc.y;
        const colX = {
          name: 50,
          qty: 300,
          price: 360,
          total: 460,
        };

        doc.font('BodyBold').fontSize(10).text('Позиція', colX.name, tableTop);
        doc.font('BodyBold').text('К-сть', colX.qty, tableTop);
        doc.font('BodyBold').text('Ціна', colX.price, tableTop);
        doc.font('BodyBold').text('Сума', colX.total, tableTop);

        doc
          .moveTo(50, tableTop + 14)
          .lineTo(550, tableTop + 14)
          .stroke();

        let y = tableTop + 20;
        const rowHeight = 18;
        const maxY = 750;

        items.forEach((item) => {
          if (y > maxY) {
            doc.addPage();
            y = 50;

            // Заголовок таблиці на новій сторінці
            doc.font('BodyBold').fontSize(10).text('Позиція', colX.name, y);
            doc.font('BodyBold').text('К-сть', colX.qty, y);
            doc.font('BodyBold').text('Ціна', colX.price, y);
            doc.font('BodyBold').text('Сума', colX.total, y);
            doc
              .moveTo(50, y + 14)
              .lineTo(550, y + 14)
              .stroke();
            y += 20;
          }

          doc
            .font('Body')
            .fontSize(10)
            .text(item.name, colX.name, y, {
              width: colX.qty - colX.name - 10,
            });

          doc.text(item.quantity.toString(), colX.qty, y);
          doc.text(
            `${this.formatMoney(item.unitPrice)} ${act.currency}`,
            colX.price,
            y,
          );
          doc.text(
            `${this.formatMoney(item.lineTotal)} ${act.currency}`,
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
      }

      // ПІДСУМКИ
      const totalStr = this.formatMoney(act.total);

      doc
        .font('BodyBold')
        .fontSize(12)
        .text(`Загальна сума за актом: ${totalStr} ${act.currency}`, {
          align: 'right',
        });

      doc.moveDown(2);

      // ПІДПИСИ
      doc.font('Body').fontSize(10);

      const signTop = doc.y;
      doc.text('Виконавець:', 50, signTop);
      doc.text('Замовник:', 300, signTop);

      doc
        .moveTo(50, signTop + 30)
        .lineTo(200, signTop + 30)
        .stroke();

      doc
        .moveTo(300, signTop + 30)
        .lineTo(450, signTop + 30)
        .stroke();

      doc.end();
    });
  }

  private async generateAndAttach(actId: string, requestedByUserId: string) {
    const act = await this.prisma.act.findUnique({
      where: { id: actId },
      include: {
        organization: true,
        client: true,
        relatedInvoice: {
          include: {
            items: true,
          },
        },
      },
    });

    if (!act) {
      throw new NotFoundException('Акт не знайдено');
    }

    const safeNumber = act.number.replace(/[^a-zA-Z0-9\-]/g, '_');
    const fileName = `act-${safeNumber}.pdf`;

    // 1) Генеруємо PDF у Buffer
    const pdfBuffer = await this.buildPdfBuffer(act);

    // 2) Вантажимо в S3
    const storageKey = await this.fileStorage.uploadFile(
      {
        originalname: fileName,
        mimetype: 'application/pdf',
        buffer: pdfBuffer,
      } as any,
      {
        organizationId: act.organizationId,
      },
    );

    // 3) Створюємо / оновлюємо Document
    let documentId = act.pdfDocumentId;

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
          organizationId: act.organizationId,
          createdById: requestedByUserId,
          title: `Акт № ${act.number}`,
          originalName: fileName,
          mimeType: 'application/pdf',
          sizeBytes: pdfBuffer.length,
          storageKey,
          source: DocumentSource.MANUAL,
          status: DocumentStatus.READY,
        },
      });

      documentId = docRecord.id;

      await this.prisma.act.update({
        where: { id: actId },
        data: {
          pdfDocumentId: documentId,
        },
      });
    }

    return { documentId, storageKey };
  }

  async getOrCreatePdfForAct(actId: string) {
    const act = await this.prisma.act.findUnique({
      where: { id: actId },
      include: { organization: true, client: true, pdfDocument: true },
    });

    if (!act) {
      throw new NotFoundException('Акт не знайдено');
    }

    if (!act.pdfDocumentId || !act.pdfDocument) {
      const { storageKey } = await this.generateAndAttach(
        actId,
        act.createdById,
      );

      const updated = await this.prisma.act.findUnique({
        where: { id: actId },
        include: { pdfDocument: true },
      });

      if (!updated?.pdfDocument) {
        throw new NotFoundException('PDF-документ для акта не знайдено');
      }

      const pdfBuffer = await this.fileStorage.getFile(storageKey);

      return {
        document: updated.pdfDocument,
        pdfBuffer,
      };
    }

    const pdfBuffer = await this.fileStorage.getFile(
      act.pdfDocument.storageKey,
    );

    return {
      document: act.pdfDocument,
      pdfBuffer,
    };
  }
}
