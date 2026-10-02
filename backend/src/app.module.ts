import "reflect-metadata";
import { Module } from "@nestjs/common";
import { CheckoutController } from "./payment-controller";
import { CheckoutService } from "./payment-checkout";
import { APP_GUARD } from "@nestjs/core";
import { Database } from "./db";
import { AuthService, SessionGuard } from "./auth";
import { BookingService } from "./booking";
import { RedisService } from "./platform";
import {
  AuthController,
  EventController,
  BookingController,
  PaymentController,
  OperationsController,
} from "./controllers";
@Module({
  controllers: [
    CheckoutController,
    AuthController,
    EventController,
    BookingController,
    PaymentController,
    OperationsController,
  ],
  providers: [
    CheckoutService,
    Database,
    AuthService,
    BookingService,
    RedisService,
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
})
export class AppModule {}
