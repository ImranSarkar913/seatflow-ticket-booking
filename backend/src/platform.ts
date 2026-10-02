import {
  Injectable,
  OnModuleDestroy,
  Catch,
  ExceptionFilter,
  ArgumentsHost,
  HttpException,
  ServiceUnavailableException,
  Logger,
} from "@nestjs/common";
import Redis from "ioredis";
import { config } from "./config";
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client = new Redis(config.redis, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
  });
  readonly ready: Promise<void>;
  constructor() {
    this.client.on("error", () => {});
    this.ready = this.client.connect();
    this.ready.catch(() => {});
  }
  async limit(key: string, max: number) {
    try {
      const count = (await this.client.eval(
        "local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],60) end;return n",
        1,
        key,
      )) as number;
      return count <= max;
    } catch {
      throw new ServiceUnavailableException(
        "Rate limiter temporarily unavailable",
      );
    }
  }
  async onModuleDestroy() {
    this.client.disconnect();
  }
}
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger("HTTP");
  catch(error: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp(),
      req = ctx.getRequest(),
      res = ctx.getResponse();
    let status = error instanceof HttpException ? error.getStatus() : 500;
    if (["55P03", "57014", "40P01"].includes(error.code)) status = 503;
    let message: any =
      status === 503 ? "System busy; retry shortly" : "Unexpected server error";
    if (error instanceof HttpException) {
      const body = error.getResponse();
      message = typeof body === "string" ? body : (body as any).message;
    }
    if (status === 500)
      this.logger.error(
        JSON.stringify({
          requestId: req.requestId,
          code: error.code ?? "INTERNAL",
          message: error.message,
        }),
      );
    res
      .status(status)
      .json({ statusCode: status, message, requestId: req.requestId });
  }
}
