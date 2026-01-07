import { InvoiceStatus } from '@prisma/client';

export class InvoiceItemInputDto {
  name: string;
  description?: string;
  quantity: number; // штук / годин / одиниць
  unitPrice: number; // ціна за одиницю
  taxRate?: number; // у %, наприклад 20
}

export class CreateInvoiceDto {
  organizationId: string;
  createdById: string;

  clientId?: string;

  issueDate?: string; // ISO-строка або "YYYY-MM-DD"
  dueDate?: string;

  currency?: string; // за замовчуванням візьмемо "UAH"

  status?: InvoiceStatus; // за замовчуванням DRAFT

  notes?: string;

  items: InvoiceItemInputDto[];
}
