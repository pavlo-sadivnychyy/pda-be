import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Headers,
  HttpCode,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';

import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { PlanId } from '@prisma/client';
import { BillingService } from './billing.service';

class CreateCheckoutDto {
  planId: PlanId;
}

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('paddle/checkout')
  @UseGuards(ClerkAuthGuard)
  async createCheckout(@Req() req: any, @Body() body: CreateCheckoutDto) {
    if (!body.planId) throw new BadRequestException('planId required');
    if (body.planId === 'FREE')
      throw new BadRequestException('FREE plan has no checkout');

    return this.billing.createCheckout({
      authUserId: req.authUserId,
      planId: body.planId,
    });
  }

  @Get('paddle/my-subscription')
  @UseGuards(ClerkAuthGuard)
  async mySubscription(@Req() req: any) {
    return this.billing.getMySubscription(req.authUserId);
  }

  @Post('paddle/webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('paddle-signature') sig?: string,
    @Headers('Paddle-Signature') sigAlt?: string,
  ) {
    const signature = sig ?? sigAlt;
    await this.billing.handlePaddleWebhook(req.rawBody, signature);
    return { ok: true };
  }
}
