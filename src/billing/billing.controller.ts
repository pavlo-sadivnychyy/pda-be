import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ClerkAuthGuard } from '../auth/clerk-auth.guard';
import { BillingService } from './billing.service';
import { PlanId } from '@prisma/client';

class CreateCheckoutDto {
  planId: PlanId;
}

class SyncTransactionDto {
  transactionId: string;
}

@Controller('billing/paddle')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /**
   * ✅ Create a checkout session for upgrading to a paid plan
   * Returns transactionId that can be used to open Paddle checkout
   */
  @Post('checkout')
  @UseGuards(ClerkAuthGuard)
  @HttpCode(HttpStatus.OK)
  async createCheckout(@Req() req: any, @Body() body: CreateCheckoutDto) {
    return this.billing.createCheckout({
      authUserId: req.authUserId,
      planId: body.planId,
    });
  }

  /**
   * ✅ Sync transaction status after user completes checkout
   * Called from frontend after Paddle checkout success
   */
  @Post('sync-transaction')
  @UseGuards(ClerkAuthGuard)
  @HttpCode(HttpStatus.OK)
  async syncTransaction(@Req() req: any, @Body() body: SyncTransactionDto) {
    return this.billing.syncTransactionToDb({
      authUserId: req.authUserId,
      transactionId: body.transactionId,
    });
  }

  /**
   * ✅ Cancel subscription at period end
   * User keeps access until currentPeriodEnd, then downgrades to FREE
   */
  @Post('cancel')
  @UseGuards(ClerkAuthGuard)
  @HttpCode(HttpStatus.OK)
  async cancel(@Req() req: any) {
    return this.billing.cancelAtPeriodEnd({
      authUserId: req.authUserId,
    });
  }

  /**
   * ✅ Paddle webhook endpoint
   * Receives events from Paddle (subscription updates, payments, etc.)
   * NO authentication guard - uses Paddle signature verification
   */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Req() req: any, @Body() body: any, @Headers() headers: any) {
    // rawBody is available when main.ts has rawBody: true
    const rawBody: Buffer | undefined = req?.rawBody;

    return this.billing.handleWebhook({
      body,
      headers,
      rawBody,
    });
  }
}
