import { InvoiceStatus } from '@prisma/client';
import { InvoiceItemInputDto } from './create-invoice.dto';

export class UpdateInvoiceDto {
  clientId?: string | null;

  issueDate?: string;
  dueDate?: string | null;

  currency?: string;

  status?: InvoiceStatus;

  notes?: string | null;

  // якщо передаєш items — ми повністю перезапишемо позиції інвойсу
  items?: InvoiceItemInputDto[];

  // оновлення лінку на PDF-документ, якщо ти згенеруєш його окремо
  pdfDocumentId?: string | null;
}
