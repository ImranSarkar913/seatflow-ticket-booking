import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Res,
  Headers,
  ParseUUIDPipe,
  BadRequestException,
  UnauthorizedException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiTags, ApiCookieAuth, ApiHeader } from "@nestjs/swagger";
import { Response, Request } from "express";
import { AuthService, AuthRequest, Public, Roles } from "./auth";
import { BookingService } from "./booking";
import { Database } from "./db";
import { RedisService } from "./platform";
import {
  LoginDto,
  RegisterDto,
  HoldDto,
  SettleDto,
  WebhookDto,
  EventDto,
  CheckinDto,
  StaffDto,
} from "./dto";
import { verifySignature } from "./crypto";
import { config } from "./config";
function page(s: string | undefined) {
  if (s === undefined) return 1;
  if (!/^[1-9]\d{0,3}$/.test(s)) throw new BadRequestException("Invalid page");
  return Number(s);
}
@ApiTags("Authentication")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public() @Post("register") async register(@Body() d: RegisterDto) {
    return this.auth.register(d.email, d.name, d.password);
  }
  @Public() @Post("login") async login(
    @Body() d: LoginDto,
    @Res({ passthrough: true }) r: Response,
  ) {
    return this.auth.login(d.email, d.password, r);
  }
  @Get("me") me(@Req() r: AuthRequest) {
    return { user: r.user, csrf: r.session.csrf };
  }
  @Post("logout") logout(
    @Req() r: AuthRequest,
    @Res({ passthrough: true }) s: Response,
  ) {
    return this.auth.logout(r, s);
  }
}
@ApiTags("Events")
@Controller("events")
export class EventController {
  constructor(private readonly booking: BookingService) {}
  @Public() @Get() list(
    @Query("search") search = "",
    @Query("page") p?: string,
  ) {
    if (search.length > 100)
      throw new BadRequestException("Search is too long");
    return this.booking.events(search, page(p));
  }
  @Public() @Get(":id") detail(@Param("id", ParseUUIDPipe) id: string) {
    return this.booking.event(id);
  }
  @Roles("ADMIN") @Post() create(@Body() d: EventDto) {
    return this.booking.createEvent(d);
  }
}
@ApiTags("Bookings")
@ApiCookieAuth()
@Controller("bookings")
export class BookingController {
  constructor(private readonly booking: BookingService) {}
  @ApiHeader({ name: "Idempotency-Key", required: true }) @Post("holds") hold(
    @Req() r: AuthRequest,
    @Headers("idempotency-key") key: string,
    @Body() d: HoldDto,
  ) {
    return this.booking.hold(r.user, key, d);
  }
  @Get() list(@Req() r: AuthRequest, @Query("page") p?: string) {
    return this.booking.list(r.user, page(p));
  }
  @Get(":id") detail(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.booking.detail(id, r.user);
  }
  @Get(":id/audit") audit(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.booking.history(id, r.user);
  }
  @Post(":id/payment-intent") payment(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.booking.paymentIntent(id, r.user);
  }
  @Post(":id/cancel") cancel(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.booking.cancel(id, r.user);
  }
}
@ApiTags("Payments")
@Controller("payments")
export class PaymentController {
  constructor(private readonly booking: BookingService) {}
  @Post(":id/sandbox-settle") settle(
    @Req() r: AuthRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: SettleDto,
  ) {
    return this.booking.sandboxSettle(id, r.user, d.outcome);
  }
  @Public() @Post("webhook") webhook(
    @Req() r: Request & { rawBody?: Buffer },
    @Body() d: WebhookDto,
    @Headers("x-webhook-timestamp") time: string,
    @Headers("x-webhook-signature") sig: string,
  ) {
    if (
      !r.rawBody ||
      !verifySignature(config.webhookSecret, time ?? "", r.rawBody, sig ?? "")
    )
      throw new UnauthorizedException("Invalid or expired webhook signature");
    return this.booking.applyWebhook(d);
  }
}
@ApiTags("Operations")
@Controller()
export class OperationsController {
  constructor(
    private readonly booking: BookingService,
    private readonly db: Database,
    private readonly redis: RedisService,
  ) {}
  @Get("notifications") notifications(@Req() r: AuthRequest) {
    return this.booking.notifications(r.user);
  }
  @Roles("ADMIN", "STAFF") @Post("check-in") checkin(
    @Req() r: AuthRequest,
    @Body() d: CheckinDto,
  ) {
    return this.booking.checkin(d.token, r.user);
  }
  @Roles("ADMIN") @Get("admin/staff") async staff() {
    return (
      await this.db.query(
        "SELECT id,name,email FROM users WHERE role='STAFF' ORDER BY name",
      )
    ).rows;
  }
  @Roles("ADMIN") @Post("admin/events/:id/staff") async assignStaff(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: StaffDto,
  ) {
    const result = await this.db.query(
      "INSERT INTO event_staff(event_id,user_id) SELECT e.id,u.id FROM events e CROSS JOIN users u WHERE e.id=$1 AND u.id=$2 AND u.role='STAFF' ON CONFLICT DO NOTHING RETURNING event_id",
      [id, d.userId],
    );
    if (!result.rowCount) {
      const valid = (
        await this.db.query(
          "SELECT 1 FROM event_staff WHERE event_id=$1 AND user_id=$2",
          [id, d.userId],
        )
      ).rowCount;
      if (!valid)
        throw new BadRequestException("Event or staff account not found");
    }
    return { ok: true };
  }
  @Roles("ADMIN") @Get("admin/summary") summary() {
    return this.booking.adminSummary();
  }
  @Roles("ADMIN") @Post("admin/jobs/:id/retry") async retry(
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    const q = await this.db.query(
      "UPDATE outbox SET attempts=0,last_error=NULL WHERE id=$1 AND processed_at IS NULL RETURNING id",
      [id],
    );
    return { retried: !!q.rowCount };
  }
  @Public() @Get("health") health() {
    return {
      ok: true,
      service: "seatflow-api",
      paymentMode: config.sandbox ? "sandbox" : "external-webhook",
      serverTime: new Date().toISOString(),
    };
  }
  @Public() @Get("ready") async ready() {
    try {
      await this.db.query("SELECT 1");
      await this.redis.client.ping();
      return { ok: true };
    } catch {
      throw new ServiceUnavailableException("Dependencies unavailable");
    }
  }
}
