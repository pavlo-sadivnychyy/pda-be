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

  private formatDateISO(d?: Date | string | null): string {
    if (!d) return '-';
    if (typeof d === 'string') return d.slice(0, 10);
    try {
      return d.toISOString().slice(0, 10);
    } catch {
      return '-';
    }
  }

  private formatIban(iban?: string | null): string {
    const s = (iban ?? '').replace(/\s+/g, '').trim();
    if (!s) return '';
    return s.replace(/(.{4})/g, '$1 ').trim();
  }

  // ===== PDF helpers =====
  private setupDoc(): any {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 40,
    });

    // fonts (cyrillic)
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

  private ensureSpace(doc: any, neededPx: number) {
    const bottomY = doc.page.height - doc.page.margins.bottom;
    if (doc.y + neededPx > bottomY) {
      doc.addPage();
      doc.x = doc.page.margins.left;
      doc.y = doc.page.margins.top;
    }
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
      lineGap?: number;
    },
  ) {
    const padding = opts?.padding ?? 6;
    const fontSize = opts?.fontSize ?? 10;
    const align = opts?.align ?? 'left';
    const valign = opts?.valign ?? 'top';

    doc.font(opts?.bold ? 'BodyBold' : 'Body');
    doc.fontSize(fontSize);

    const textY =
      valign === 'middle'
        ? y + Math.max(0, (h - fontSize - 2) / 2)
        : y + padding;

    doc.text(text ?? '', x + padding, textY, {
      width: w - padding * 2,
      height: h - padding * 2,
      align,
      lineGap: opts?.lineGap ?? 1.1,
    });

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

    const bodyText = lines.filter(Boolean).join('\n') || '—';
    this.drawCell(doc, x, y + titleH, w, h - titleH, bodyText, {
      fontSize: 9.5,
      padding: 6,
      lineGap: 1.15,
    });
  }

  // ✅ Supplier lines (UA) for Act: береться з ua* полів
  private buildOrgLines(org: any): string[] {
    const lines: string[] = [];

    const beneficiary =
      (org?.uaBeneficiaryName ?? '').trim() ||
      (org?.uaCompanyName ?? '').trim() ||
      (org?.name ?? '').trim() ||
      '—';

    lines.push(beneficiary);

    // якщо beneficiary != company name — покажемо і назву компанії окремо
    const companyName = (org?.uaCompanyName ?? '').trim();
    if (companyName && companyName !== beneficiary) {
      lines.push(`Назва: ${companyName}`);
    }

    const addr = (org?.uaCompanyAddress ?? '').trim();
    const cityCountry = [org?.city, org?.country].filter(Boolean).join(', ');
    const addrLine = [addr, cityCountry].filter(Boolean).join(', ');
    if (addrLine) lines.push(addrLine);

    if ((org?.uaEdrpou ?? '').trim()) lines.push(`ЄДРПОУ: ${org.uaEdrpou}`);
    if ((org?.uaIpn ?? '').trim()) lines.push(`ІПН: ${org.uaIpn}`);

    if (org?.primaryContactEmail)
      lines.push(`Email: ${org.primaryContactEmail}`);
    if (org?.primaryContactPhone) lines.push(`Тел: ${org.primaryContactPhone}`);
    if (org?.websiteUrl) lines.push(org.websiteUrl);

    return lines.length ? lines : ['—'];
  }

  private buildClientLines(client: any): string[] {
    if (!client) return ['—'];
    const lines: string[] = [];
    if (client.name) lines.push(client.name);
    if (client.contactName)
      lines.push(`Контактна особа: ${client.contactName}`);
    if (client.taxNumber) lines.push(`Податковий номер: ${client.taxNumber}`);
    if (client.address) lines.push(`Адреса: ${client.address}`);
    if (client.email) lines.push(`Email: ${client.email}`);
    if (client.phone) lines.push(`Телефон: ${client.phone}`);
    return lines.length ? lines : ['—'];
  }

  private buildActMetaLines(act: any): string[] {
    let periodText = '-';
    if (act.periodFrom || act.periodTo) {
      const fromStr = act.periodFrom
        ? this.formatDateISO(act.periodFrom)
        : '...';
      const toStr = act.periodTo ? this.formatDateISO(act.periodTo) : '...';
      periodText = `${fromStr} — ${toStr}`;
    }

    const lines: string[] = [];
    lines.push(`Акт №: ${act.number ?? '—'}`);
    const actDate = act?.date
      ? this.formatDateISO(act.date)
      : this.formatDateISO(act.createdAt);
    lines.push(`Дата: ${actDate}`);
    lines.push(`Період: ${periodText}`);
    if (act.relatedInvoice?.number)
      lines.push(`Підстава: Інвойс № ${act.relatedInvoice.number}`);

    return lines;
  }

  private calcTotalsFromInvoice(invoice: any) {
    const subtotal = invoice?.subtotal ?? null;
    const taxAmount = invoice?.taxAmount ?? 0;
    const total = invoice?.total ?? null;
    return { subtotal, taxAmount, total };
  }

  private acceptanceTextUA(act: any) {
    const title = (act?.title || '').trim();
    return [
      'Сторони підтверджують, що Послуги/Роботи надані (виконані) належним чином, у повному обсязі, у встановлені терміни.',
      'Замовник претензій щодо обсягу, якості та термінів надання Послуг/Робіт не має.',
      title ? `Предмет: ${title}` : null,
    ].filter(Boolean) as string[];
  }

  // ✅ NEW: UA payment lines for Act PDF (тільки UA, згідно твоєї схеми)
  private buildUaPaymentLines(org: any, act: any): string[] {
    const beneficiary =
      (org?.uaBeneficiaryName ?? '').trim() ||
      (org?.uaCompanyName ?? '').trim() ||
      (org?.name ?? '').trim() ||
      '—';

    const iban = this.formatIban(org?.uaIban);
    const bankName = (org?.uaBankName ?? '').trim();
    const mfo = (org?.uaMfo ?? '').trim();
    const accountNumber = (org?.uaAccountNumber ?? '').trim();

    const purpose = (
      (org?.uaPaymentPurposeHint ?? '').trim() ||
      `Оплата за актом № ${act?.number ?? ''}`
    ).trim();

    const lines: string[] = [];
    lines.push(`Отримувач: ${beneficiary}`);

    const companyName = (org?.uaCompanyName ?? '').trim();
    if (companyName && companyName !== beneficiary) {
      lines.push(`Назва: ${companyName}`);
    }

    const addr = (org?.uaCompanyAddress ?? '').trim();
    if (addr) lines.push(`Адреса: ${addr}`);

    const edrpou = (org?.uaEdrpou ?? '').trim();
    if (edrpou) lines.push(`ЄДРПОУ: ${edrpou}`);

    const ipn = (org?.uaIpn ?? '').trim();
    if (ipn) lines.push(`ІПН: ${ipn}`);

    lines.push(''); // spacer

    if (iban) lines.push(`IBAN: ${iban}`);
    if (accountNumber) lines.push(`Рахунок (не-IBAN): ${accountNumber}`);
    if (bankName) lines.push(`Банк: ${bankName}`);
    if (mfo) lines.push(`МФО: ${mfo}`);

    lines.push('');
    lines.push(`Призначення: ${purpose}`);

    return lines;
  }

  private async buildPdfBuffer(act: any): Promise<Buffer> {
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

      const org = act.organization ?? {};
      const client = act.client ?? null;

      // ===== Header =====
      doc.font('BodyBold').fontSize(12);
      doc.text('АКТ НАДАНИХ ПОСЛУГ', left, top, { align: 'left' });

      doc.font('Body').fontSize(10);
      doc.text(`Валюта: ${act.currency ?? '—'}`, left, top, {
        align: 'right',
        width: usableW,
      });

      doc.moveDown(0.9);

      // ===== Blocks layout =====
      const colGap = 10;
      const colW = Math.floor((usableW - colGap) / 2);
      const xL = left;
      const xR = left + colW + colGap;

      let y = doc.y;

      // Row 1: Supplier / Act meta
      const row1H = 92;
      this.drawLabelValueBlock(
        doc,
        xL,
        y,
        colW,
        row1H,
        'Виконавець',
        this.buildOrgLines(org),
      );
      this.drawLabelValueBlock(
        doc,
        xR,
        y,
        colW,
        row1H,
        'Дані акта',
        this.buildActMetaLines(act),
      );
      y += row1H;

      // Row 2: Customer (full width)
      const row2H = 80;
      this.drawLabelValueBlock(
        doc,
        left,
        y,
        usableW,
        row2H,
        'Замовник',
        this.buildClientLines(client),
      );
      y += row2H + 10;

      doc.y = y;

      // ===== Optional description block =====
      const hasDesc = Boolean(
        (act.title ?? '').trim() || (act.notes ?? '').trim(),
      );
      if (hasDesc) {
        const boxH = 70;
        this.ensureSpace(doc, boxH + 10);

        const title = (act.title ?? '').trim();
        const notes = (act.notes ?? '').trim();

        const lines: string[] = [];
        if (title) lines.push(title);
        if (notes) lines.push(notes);

        this.drawLabelValueBlock(
          doc,
          left,
          doc.y,
          usableW,
          boxH,
          'Опис робіт / послуг',
          lines,
        );
        doc.y += boxH + 10;
      }

      // ===== Items table =====
      const invoice = act.relatedInvoice ?? null;
      const items: any[] = invoice?.items ?? [];

      const tableX = left;
      const tableW = usableW;
      const headerH = 22;
      const rowH = 22;

      const cols = {
        no: Math.floor(tableW * 0.06),
        desc: Math.floor(tableW * 0.6),
        qty: Math.floor(tableW * 0.12),
        rate: Math.floor(tableW * 0.1),
        amt:
          tableW -
          (Math.floor(tableW * 0.06) +
            Math.floor(tableW * 0.6) +
            Math.floor(tableW * 0.12) +
            Math.floor(tableW * 0.1)),
      };

      const colX = {
        no: tableX,
        desc: tableX + cols.no,
        qty: tableX + cols.no + cols.desc,
        rate: tableX + cols.no + cols.desc + cols.qty,
        amt: tableX + cols.no + cols.desc + cols.qty + cols.rate,
      };

      const drawHeader = (yy: number) => {
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
        this.drawCell(doc, colX.qty, yy, cols.qty, headerH, 'К-сть', {
          bold: true,
          align: 'center',
          valign: 'middle',
        });
        this.drawCell(doc, colX.rate, yy, cols.rate, headerH, 'Ціна', {
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

      const maxTableBottom = doc.page.height - doc.page.margins.bottom - 220;

      if (items.length) {
        this.ensureSpace(doc, headerH + rowH * 3);

        let tableY = doc.y;
        drawHeader(tableY);
        tableY += headerH;

        let idx = 1;

        for (const it of items) {
          if (tableY + rowH > maxTableBottom) {
            doc.addPage();
            tableY = doc.page.margins.top;
            drawHeader(tableY);
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

          const descText = [it.name, it.description].filter(Boolean).join('\n');
          const qty = it.quantity ?? 0;

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
              lineGap: 1.1,
            },
          );
          this.drawCell(doc, colX.qty, tableY, cols.qty, rowH, String(qty), {
            align: 'center',
            valign: 'middle',
          });
          this.drawCell(
            doc,
            colX.rate,
            tableY,
            cols.rate,
            rowH,
            this.formatMoney(it.unitPrice),
            {
              align: 'center',
              valign: 'middle',
            },
          );
          this.drawCell(
            doc,
            colX.amt,
            tableY,
            cols.amt,
            rowH,
            this.formatMoney(it.lineTotal),
            {
              align: 'center',
              valign: 'middle',
            },
          );

          tableY += rowH;
          idx += 1;
        }

        // ===== Totals =====
        const totalsH = 22;

        const totalsFromInv = this.calcTotalsFromInvoice(invoice);
        const subtotalVal =
          `${this.formatMoney(totalsFromInv.subtotal ?? act.total ?? 0)} ${act.currency ?? ''}`.trim();
        const vatVal =
          `${this.formatMoney(totalsFromInv.taxAmount ?? 0)} ${act.currency ?? ''}`.trim();
        const totalVal =
          `${this.formatMoney(act.total ?? totalsFromInv.total ?? 0)} ${act.currency ?? ''}`.trim();

        const totals = [
          { label: 'Сума без ПДВ:', value: subtotalVal, bold: false },
          { label: 'ПДВ:', value: vatVal, bold: false },
          { label: 'Загальна сума за актом:', value: totalVal, bold: true },
        ];

        if (
          tableY + totalsH * totals.length + 20 >
          doc.page.height - doc.page.margins.bottom
        ) {
          doc.addPage();
          tableY = doc.page.margins.top;
        }

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

        doc.y = tableY + 14;
      } else {
        this.ensureSpace(doc, 70);
        const boxH = 54;
        const totalVal =
          `${this.formatMoney(act.total ?? 0)} ${act.currency ?? ''}`.trim();
        this.drawLabelValueBlock(doc, left, doc.y, usableW, boxH, 'Підсумок', [
          `Загальна сума за актом: ${totalVal}`,
        ]);
        doc.y += boxH + 10;
      }

      // ===== Acceptance =====
      this.ensureSpace(doc, 140);
      const accH = 92;
      this.drawLabelValueBlock(
        doc,
        left,
        doc.y,
        usableW,
        accH,
        'Підтвердження',
        this.acceptanceTextUA(act),
      );
      doc.y += accH + 14;

      // ✅ NEW: Payment details (UA)
      this.ensureSpace(doc, 170);
      const payH = 135;
      this.drawLabelValueBlock(
        doc,
        left,
        doc.y,
        usableW,
        payH,
        'Реквізити для оплати',
        this.buildUaPaymentLines(org, act),
      );
      doc.y += payH + 14;

      // ===== Signatures =====
      this.ensureSpace(doc, 120);

      const signTop = doc.y;
      const signBoxH = 78;
      const colGap2 = 20;
      const signColW = Math.floor((usableW - colGap2) / 2);

      const sxL = left;
      const sxR = left + signColW + colGap2;

      this.strokeRect(doc, sxL, signTop, signColW, signBoxH);
      this.strokeRect(doc, sxR, signTop, signColW, signBoxH);

      this.drawCell(doc, sxL, signTop, signColW, 18, 'Виконавець', {
        bold: true,
        valign: 'middle',
      });
      this.drawCell(doc, sxR, signTop, signColW, 18, 'Замовник', {
        bold: true,
        valign: 'middle',
      });

      doc
        .moveTo(sxL, signTop + 18)
        .lineTo(sxL + signColW, signTop + 18)
        .stroke();
      doc
        .moveTo(sxR, signTop + 18)
        .lineTo(sxR + signColW, signTop + 18)
        .stroke();

      const lineY = signTop + 52;
      doc
        .moveTo(sxL + 10, lineY)
        .lineTo(sxL + signColW - 10, lineY)
        .stroke();
      doc
        .moveTo(sxR + 10, lineY)
        .lineTo(sxR + signColW - 10, lineY)
        .stroke();

      doc.font('Body').fontSize(9);
      doc.text('Підпис / П.І.Б.', sxL + 10, lineY + 6);
      doc.text('Підпис / П.І.Б.', sxR + 10, lineY + 6);

      const supplierSigner =
        org?.signatoryName ||
        act?.createdBy?.fullName ||
        act?.createdBy?.name ||
        '';
      const customerSigner = act?.client?.contactName || '';

      if (supplierSigner) {
        doc.text(`(${supplierSigner})`, sxL + 10, signTop + 26, {
          width: signColW - 20,
        });
      }
      if (customerSigner) {
        doc.text(`(${customerSigner})`, sxR + 10, signTop + 26, {
          width: signColW - 20,
        });
      }

      doc.end();
    });
  }

  private async generateAndAttach(actId: string, requestedByUserId: string) {
    const act = await this.prisma.act.findUnique({
      where: { id: actId },
      include: {
        organization: true,
        client: true,
        createdBy: true,
        relatedInvoice: {
          include: { items: true },
        },
      },
    });

    if (!act) throw new NotFoundException('Акт не знайдено');

    const safeNumber = String(act.number).replace(/[^a-zA-Z0-9\-]/g, '_');
    const fileName = `act-${safeNumber}.pdf`;

    const pdfBuffer = await this.buildPdfBuffer(act);

    const storageKey = await this.fileStorage.uploadFile(
      {
        originalname: fileName,
        mimetype: 'application/pdf',
        buffer: pdfBuffer,
      } as any,
      { organizationId: act.organizationId },
    );

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
        data: { pdfDocumentId: documentId },
      });
    }

    return { documentId, storageKey };
  }

  async getOrCreatePdfForAct(actId: string) {
    const act = await this.prisma.act.findUnique({
      where: { id: actId },
      include: { organization: true, client: true, pdfDocument: true },
    });

    if (!act) throw new NotFoundException('Акт не знайдено');

    if (!act.pdfDocumentId || !act.pdfDocument) {
      const { storageKey } = await this.generateAndAttach(
        actId,
        act.createdById,
      );

      const updated = await this.prisma.act.findUnique({
        where: { id: actId },
        include: { pdfDocument: true },
      });

      if (!updated?.pdfDocument)
        throw new NotFoundException('PDF-документ для акта не знайдено');

      const pdfBuffer = await this.fileStorage.getFile(storageKey);

      return { document: updated.pdfDocument, pdfBuffer };
    }

    const pdfBuffer = await this.fileStorage.getFile(
      act.pdfDocument.storageKey,
    );
    return { document: act.pdfDocument, pdfBuffer };
  }
}
