import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const path = req.path ?? req.url ?? '';
    if (path.includes('/health')) return true;

    const required = process.env.API_KEY?.trim();
    if (!required) return true;

    const header = req.headers['x-api-key'] ?? req.headers['authorization'];
    const token =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice(7)
        : header;

    if (token !== required) {
      throw new UnauthorizedException('Invalid or missing API key');
    }
    return true;
  }
}
