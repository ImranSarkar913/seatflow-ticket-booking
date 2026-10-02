import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Res,
  ParseUUIDPipe,
  Req,
} from "@nestjs/common";
import { ApiTags, ApiProperty } from "@nestjs/swagger";
import { IsIn, IsString, Matches } from "class-validator";
import { Response } from "express";
import { Public, AuthRequest } from "./auth";
import { CheckoutService } from "./payment-checkout";
import { config } from "./config";
import { Provider } from "./payment-provider";
class CheckoutDto {
  @ApiProperty({ enum: ["sslcommerz", "bkash"] })
  @IsIn(["sslcommerz", "bkash"])
  provider!: Provider;
  @ApiProperty({
    description: "Bangladesh mobile number; no wallet PIN or OTP is collected",
  })
  @IsString()
  @Matches(/^01[3-9][0-9]{8}$/)
  phone!: string;
}
@ApiTags("Payment checkout")
@Controller("payment-checkout")
export class CheckoutController {
  constructor(private readonly checkout: CheckoutService) {}
  @Public() @Get("methods") methods() {
    return this.checkout.methods();
  }
  @Post("bookings/:id") start(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: CheckoutDto,
    @Req() req: AuthRequest,
  ) {
    return this.checkout.start(id, req.user, dto.provider, dto.phone);
  }
  @Post(":id/refresh") refresh(
    @Param("id", ParseUUIDPipe) id: string,
    @Req() req: AuthRequest,
  ) {
    return this.checkout.ownRefresh(id, req.user);
  }
  @Public() @Post("sslcommerz/ipn") ipn(@Body() body: Record<string, unknown>) {
    return this.checkout.sslCallback(body.tran_id, body.val_id);
  }
  @Public() @Post("sslcommerz/return") async sslReturn(
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    // The redirect is just navigation, never proof of a successful payment.
    try {
      const r = await this.checkout.sslCallback(body.tran_id, body.val_id);
      res.redirect(
        303,
        config.origin +
          "/?payment_return=1" +
          ("bookingId" in r
            ? "&booking=" + encodeURIComponent(r.bookingId as string)
            : ""),
      );
    } catch {
      res.redirect(303, config.origin + "/?payment_return=1");
    }
  }
  @Public() @Get("bkash/return") async bkashReturn(
    @Query("paymentID") id: string,
    @Query("status") status: string,
    @Res() res: Response,
  ) {
    try {
      const r = await this.checkout.bkashCallback(id, status);
      res.redirect(
        303,
        config.origin +
          "/?payment_return=1" +
          ("bookingId" in r
            ? "&booking=" + encodeURIComponent(r.bookingId as string)
            : ""),
      );
    } catch {
      res.redirect(303, config.origin + "/?payment_return=1");
    }
  }
}
