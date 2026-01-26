import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UseGuards,
  BadRequestException,
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

  // 3) Webhook (без auth guard!)
  @Post('monobank/webhook')
  async monobankWebhook(@Req() req: any) {
    // тут req.body буде Buffer (raw)
    await this.billing.handleMonobankWebhook(req);
    return { ok: true };
  }
}
