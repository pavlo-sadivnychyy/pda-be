import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { createClerkClient } from '@clerk/backend';

function extractBearer(req: any): string | null {
  const raw = req.headers?.authorization ?? req.headers?.Authorization;
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (!header || typeof header !== 'string') return null;
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private clerk = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY!,
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY!, // ✅ додали
  });

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();

    const token = extractBearer(req);
    if (!token) throw new UnauthorizedException('Missing Bearer token');

    const HeadersCtor = (globalThis as any).Headers;
    const RequestCtor = (globalThis as any).Request;

    if (!HeadersCtor || !RequestCtor) {
      throw new InternalServerErrorException(
        'Web Request/Headers are not available',
      );
    }

    const headers = new HeadersCtor();
    headers.set('authorization', `Bearer ${token}`);

    const clerkReq = new RequestCtor('http://localhost/auth', { headers });

    const requestState = await (this.clerk as any).authenticateRequest(
      clerkReq,
    );
    const auth = requestState.toAuth();

    const userId =
      auth && typeof auth === 'object' && 'userId' in auth ? auth.userId : null;

    const sessionId =
      auth && typeof auth === 'object' && 'sessionId' in auth
        ? auth.sessionId
        : null;

    if (!userId)
      throw new UnauthorizedException('Invalid or expired Clerk token');

    req.authUserId = userId;
    req.authSessionId = sessionId ?? null;
    req.clerkAuth = auth;

    return true;
  }
}
