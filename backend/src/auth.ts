import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  SetMetadata,
  ConflictException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Database } from "./db";
import { hash, token, passwordHash, verifyPassword } from "./crypto";
import { config } from "./config";
import type { Request, Response } from "express";
export interface User {
  id: string;
  email: string;
  name: string;
  role: "CUSTOMER" | "STAFF" | "ADMIN";
}
export interface AuthRequest extends Request {
  user: User;
  session: { id_hash: string; csrf: string };
  requestId: string;
}
export const Public = () => SetMetadata("public", true);
export const Roles = (...roles: string[]) => SetMetadata("roles", roles);
@Injectable()
export class AuthService {
  constructor(private readonly db: Database) {}
  async register(email: string, name: string, password: string) {
    try {
      const u = (
        await this.db.query(
          "INSERT INTO users(id,email,name,password_hash,role) VALUES(gen_random_uuid(),$1,$2,$3,'CUSTOMER') RETURNING id,email,name,role",
          [
            email.toLowerCase().trim(),
            name.trim(),
            await passwordHash(password),
          ],
        )
      ).rows[0];
      return u;
    } catch (e: any) {
      if (e.code === "23505")
        throw new ConflictException("Email is already registered");
      throw e;
    }
  }
  async login(email: string, password: string, res: Response) {
    const u = (
      await this.db.query("SELECT * FROM users WHERE email=$1", [
        email.toLowerCase().trim(),
      ])
    ).rows[0];
    const dummy = "00000000000000000000000000000000:" + "00".repeat(64);
    const valid = await verifyPassword(password, u?.password_hash ?? dummy);
    if (!u || !valid)
      throw new UnauthorizedException("Invalid email or password");
    const secret = token(),
      csrf = token();
    await this.db.tx(async (c) => {
      await c.query("DELETE FROM sessions WHERE expires_at<now()");
      await c.query(
        "INSERT INTO sessions(id_hash,user_id,csrf,expires_at) VALUES($1,$2,$3,now()+interval '12 hours')",
        [hash(secret), u.id, csrf],
      );
    });
    res.cookie("seatflow_session", secret, {
      httpOnly: true,
      secure: config.secure,
      sameSite: "strict",
      path: "/api",
      maxAge: 43200000,
    });
    return {
      user: { id: u.id, email: u.email, name: u.name, role: u.role },
      csrf,
    };
  }
  async logout(req: AuthRequest, res: Response) {
    await this.db.query("DELETE FROM sessions WHERE id_hash=$1", [
      req.session.id_hash,
    ]);
    res.clearCookie("seatflow_session", {
      path: "/api",
      httpOnly: true,
      secure: config.secure,
      sameSite: "strict",
    });
    return { ok: true };
  }
}
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly db: Database,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride<boolean>("public", [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const secret = req.cookies?.seatflow_session;
    if (typeof secret !== "string" || !/^[a-f0-9]{64}$/.test(secret))
      throw new UnauthorizedException("Please sign in");
    const row = (
      await this.db.query(
        "SELECT u.id,u.email,u.name,u.role,s.id_hash,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id_hash=$1 AND s.expires_at>now()",
        [hash(secret)],
      )
    ).rows[0];
    if (!row) throw new UnauthorizedException("Session expired");
    req.user = { id: row.id, email: row.email, name: row.name, role: row.role };
    req.session = { id_hash: row.id_hash, csrf: row.csrf };
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (
        req.headers.origin !== config.origin ||
        req.headers["x-csrf-token"] !== row.csrf
      )
        throw new ForbiddenException("Invalid request origin or CSRF token");
    }
    const roles = this.reflector.getAllAndOverride<string[]>("roles", [
      context.getHandler(),
      context.getClass(),
    ]);
    if (roles && !roles.includes(row.role))
      throw new ForbiddenException("Permission denied");
    return true;
  }
}
