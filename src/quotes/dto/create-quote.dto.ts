export class CreateQuoteItemDto {
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
}

export class CreateQuoteDto {
  organizationId: string;
  createdById: string;

  clientId?: string;

  issueDate?: string; // ISO
  validUntil?: string; // ISO

  currency?: string;
  status?: any;
  notes?: string;

  items: CreateQuoteItemDto[];
}
