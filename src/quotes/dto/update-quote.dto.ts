export class UpdateQuoteItemDto {
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  taxRate?: number;
}

export class UpdateQuoteDto {
  clientId?: string | null;

  issueDate?: string;
  validUntil?: string | null;

  currency?: string;
  status?: any;
  notes?: string | null;

  items?: UpdateQuoteItemDto[];
}
