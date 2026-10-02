import "reflect-metadata";
import { NestExpressApplication } from "@nestjs/platform-express";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import { hash } from "./crypto";
import { randomUUID } from "node:crypto";
import { AppModule } from "./app.module";
import { config } from "./config";
import { ErrorFilter, RedisService } from "./platform";
import { Request, Response, NextFunction } from "express";
export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: true,
    logger: process.env.NODE_ENV === "test" ? false : ["error", "warn", "log"],
  });
  app.setGlobalPrefix("api");
  app.useBodyParser("urlencoded", { extended: false, limit: "16kb" });
  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({
    origin: config.origin,
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "X-CSRF-Token",
      "Idempotency-Key",
      "X-Request-Id",
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new ErrorFilter());
  const redis = app.get(RedisService);
  await redis.ready;
  app.use(
    async (
      req: Request & { requestId: string },
      res: Response,
      next: NextFunction,
    ) => {
      req.requestId = randomUUID();
      res.setHeader("X-Request-Id", req.requestId);
      res.setHeader("Cache-Control", "no-store");
      const start = Date.now();
      res.on("finish", () => {
        if (process.env.NODE_ENV !== "test")
          console.log(
            JSON.stringify({
              event: "http",
              requestId: req.requestId,
              method: req.method,
              path: req.path,
              status: res.statusCode,
              durationMs: Date.now() - start,
            }),
          );
      });
      if (
        req.method === "OPTIONS" ||
        ["/api/health", "/api/ready"].includes(req.path)
      )
        return next();
      // Provider endpoints carry no session privileges. Each notification is independently verified over TLS with merchant credentials.
      const callbackPaths = [
        "/api/payment-checkout/sslcommerz/ipn",
        "/api/payment-checkout/sslcommerz/return",
        "/api/payment-checkout/bkash/return",
      ];
      if (callbackPaths.includes(req.path)) {
        try {
          if (!(await redis.limit("rate:provider:" + req.ip, 120)))
            return res.status(429).json({ message: "Callback rate exceeded" });
          return next();
        } catch {
          return res
            .status(503)
            .json({ message: "Callback temporarily unavailable" });
        }
      }
      if (req.headers.origin && req.headers.origin !== config.origin)
        return res
          .status(403)
          .json({ message: "Origin not allowed", requestId: req.requestId });
      if (req.path === "/api/payments/webhook") return next();
      try {
        const auth = req.path.startsWith("/api/auth/") && req.method === "POST";
        // Bound rotating anonymous cookies and never store raw session credentials in Redis keys.
        if (!auth && !(await redis.limit("rate:ip:" + req.ip, 600)))
          return res.status(429).json({
            message: "Too many requests; retry in a minute",
            requestId: req.requestId,
          });
        const session = req.cookies?.seatflow_session;
        const actor = typeof session === "string" ? hash(session) : req.ip;
        const key =
          "rate:" +
          (auth ? "auth:" : "api:") +
          (auth ? req.ip : actor);
        if (!(await redis.limit(key, auth ? 20 : 240)))
          return res.status(429).json({
            message: "Too many requests; retry in a minute",
            requestId: req.requestId,
          });
        next();
      } catch {
        res.status(503).json({
          message: "Rate limiter unavailable",
          requestId: req.requestId,
        });
      }
    },
  );
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("SeatFlow API")
      .setDescription(
        "Transactional seat reservation and sandbox payment API. All session mutations require X-CSRF-Token and the configured Origin.",
      )
      .setVersion("1.0.0")
      .addCookieAuth("seatflow_session")
      .build(),
  );
  SwaggerModule.setup("api/docs", app, document);
  app.enableShutdownHooks();
  return app;
}
if (require.main === module)
  createApp()
    .then((app) => app.listen(config.port, "0.0.0.0"))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
