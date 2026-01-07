export class CreateClientDto {
  organizationId: string;
  createdById: string;

  name: string; // назва компанії або ПІБ
  contactName?: string;
  email?: string;
  phone?: string;
  taxNumber?: string;
  address?: string;
  notes?: string;
}
