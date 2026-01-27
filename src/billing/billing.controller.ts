import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  BadRequestException,
  Headers,
  HttpCode,
} from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PlanId } from '@prisma/client';
import { BillingService } from './billing.service';

class CreateCheckoutDto {
  planId: PlanId;
}

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  // 1) Створюємо регулярний платіж і повертаємо pageUrl
  @Post('monobank/checkout')
  @UseGuards(ClerkAuthGuard)
  async createMonoCheckout(@Req() req: any, @Body() body: CreateCheckoutDto) {
    if (!body.planId) throw new BadRequestException('planId is required');
    if (body.planId === 'FREE')
      throw new BadRequestException('FREE does not require checkout');

    const result = await this.billing.createMonobankCheckout({
      authUserId: req.authUserId,
      planId: body.planId,
    });

    return result; // { pageUrl, subscriptionId }
  }

  // 2) Фронт після редіректу може полити статус (поки webhook підтягнеться)
  @Get('monobank/my-subscription')
  @UseGuards(ClerkAuthGuard)
  async mySubscription(@Req() req: any) {
    return this.billing.getMySubscription(req.authUserId);
  }

  /**
   * 3) Webhook (без auth guard!)
   *
   * Важливо:
   * - Mono шле підпис в header `X-Sign` (інколи може бути `x-sign` — Nest нормалізує).
   * - Для валідації підпису потрібен *raw body*, а не JSON, інакше підпис не зійдеться.
   *
   * Тому в main.ts має бути увімкнений rawBody:
   *   app.use(bodyParser.json({ verify: (req: any, _res, buf) => (req.rawBody = buf) }));
   *   app.use(bodyParser.urlencoded({ verify: (req: any, _res, buf) => (req.rawBody = buf), extended: true }));
   */
  @Post('monobank/webhook')
  @HttpCode(200) // Mono очікує 200 OK
  async monobankWebhook(
    @Req() req: any,
    @Headers('x-sign') xSign?: string,
    @Headers('x-request-id') xRequestId?: string,
  ) {
    // прокинемо корисні речі в сервіс без “магії”
    await this.billing.handleMonobankWebhook({
      rawBody: req.rawBody ?? req.body, // req.body може бути Buffer, але краще rawBody
      headers: {
        xSign,
        xRequestId,
      },
    });

    return { ok: true };
  }
}
