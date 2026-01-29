import {
  Body,
  Controller,
  Headers,
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

@Controller('billing/paddle')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('checkout')
  @UseGuards(ClerkAuthGuard)
  async createCheckout(@Req() req: any, @Body() body: CreateCheckoutDto) {
    return this.billing.createCheckout({
      authUserId: req.authUserId,
      planId: body.planId,
    });
  }

  @Post('sync-transaction')
  @UseGuards(ClerkAuthGuard)
  async syncTransaction(
    @Req() req: any,
    @Body() body: { transactionId: string },
  ) {
    return this.billing.syncTransactionToDb({
      authUserId: req.authUserId,
      transactionId: body.transactionId,
    });
  }

  // Paddle webhook
  @Post('webhook')
  async webhook(@Body() body: any, @Headers() headers: any) {
    return this.billing.handleWebhook(body, headers);
  }
}
