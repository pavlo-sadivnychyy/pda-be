export class MarkInvoicePaidDto {
  /**
   * Необовʼязкова дата оплати. Якщо не передати — візьмемо now().
   * Формат: ISO-строка або "YYYY-MM-DD".
   */
  paidAt?: string;
}
