import { QuoteStatus } from '@prisma/client';

export class MarkQuoteStatusDto {
  status: QuoteStatus; // SENT | ACCEPTED | REJECTED | EXPIRED ...
}
