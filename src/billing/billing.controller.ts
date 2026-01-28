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

import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

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
    @Req() req: RawBodyRequest<Request>,
    @Headers('paddle-signature') s1?: string,
    @Headers('Paddle-Signature') s2?: string,
  ) {
    const sig = s1 ?? s2;
    await this.billing.handlePaddleWebhook(req.rawBody, sig);
    return { ok: true };
  }
}
