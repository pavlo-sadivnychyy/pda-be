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

class CancelSubscriptionDto {
  effectiveFrom?: 'next_billing_period' | 'immediately';
}

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('paddle/checkout')
  @UseGuards(ClerkAuthGuard)
  async createPaddleCheckout(@Req() req: any, @Body() body: CreateCheckoutDto) {
    if (!body.planId) throw new BadRequestException('planId is required');
    if (body.planId === 'FREE')
      throw new BadRequestException('FREE does not require checkout');

    return this.billing.createPaddleCheckout({
      authUserId: req.authUserId,
      planId: body.planId,
    });
  }

  @Get('paddle/my-subscription')
  @UseGuards(ClerkAuthGuard)
  async mySubscription(@Req() req: any) {
    return this.billing.getMySubscription(req.authUserId);
  }

  // ✅ НОВЕ: cancel
  @Post('paddle/cancel')
  @UseGuards(ClerkAuthGuard)
  async cancelMySubscription(
    @Req() req: any,
    @Body() body: CancelSubscriptionDto,
  ) {
    return this.billing.cancelMySubscription({
      authUserId: req.authUserId,
      effectiveFrom: body.effectiveFrom ?? 'next_billing_period',
    });
  }

  @Post('paddle/webhook')
  @HttpCode(200)
  async paddleWebhook(
    @Req() req: any,
    @Headers('paddle-signature') paddleSignature?: string,
    @Headers('Paddle-Signature') paddleSignatureAlt?: string,
  ) {
    const sig = paddleSignature ?? paddleSignatureAlt;
    await this.billing.handlePaddleWebhook(req.rawBody, sig);
    return { ok: true };
  }
}
