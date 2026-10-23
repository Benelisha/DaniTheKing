import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from "@nestjs/common";
import { getAuth } from "firebase-admin/auth";
import { Request } from "express";
import { authorizedEmail } from "./domain";
type AuthRequest = Request & { actor: string };
@Injectable()
export class AccessGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token) throw new UnauthorizedException("Sign in to access DaniBoy.");
    let user;
    try {
      user = await getAuth().verifyIdToken(token, true);
    } catch {
      throw new UnauthorizedException("Your session expired. Sign in again.");
    }
    if (!authorizedEmail(user.email, user.email_verified))
      throw new ForbiddenException(
        "This verified email is not on the DaniBoy whitelist.",
      );
    req.actor = user.email!.toLowerCase();
    return true;
  }
}
