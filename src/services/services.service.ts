import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from '../plan/plan.service';

import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';

function normalizeStr(v: any): string {
  return typeof v === 'string' ? v.trim() : '';
}

// приймаємо "12", "12.3", "12,30" і т.д.
function normalizePriceInput(v: any): string {
  const s = normalizeStr(v).replace(/,/g, '.');
  if (!s) throw new BadRequestException('Поле price є обовʼязковим');

  // до 2 знаків після коми
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new BadRequestException('Некоректна ціна. Формат: 10 або 10.50');
  }

  const n = Number(s);
  if (!Number.isFinite(n)) {
    throw new BadRequestException('Некоректна ціна');
  }
  if (n < 0) {
    throw new BadRequestException('Ціна не може бути відʼємною');
  }

  return n.toFixed(2);
}

@Injectable()
export class ServicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plan: PlanService,
  ) {}

  async create(authUserId: string, dto: CreateServiceDto) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const name = normalizeStr((dto as any).name);
    const description = normalizeStr((dto as any).description);
    const price = normalizePriceInput((dto as any).price);

    if (!name) {
      throw new BadRequestException('Поле name є обовʼязковим');
    }

    return this.prisma.userService.create({
      data: {
        userId: dbUserId,
        name,
        description: description ? description : null,
        price, // Prisma Decimal приймає string
      },
    });
  }

  async findAll(
    authUserId: string,
    params: {
      search?: string;
    },
  ) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);
    const { search } = params;

    const where: any = { userId: dbUserId };

    if (search?.trim()) {
      const q = search.trim();
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        // якщо хочеш — дозволимо пошук по точній ціні
        // { price: q } // але Decimal так просто не фільтрується по contains, тому краще без цього
      ];
    }

    return this.prisma.userService.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(authUserId: string, id: string) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const service = await this.prisma.userService.findUnique({ where: { id } });
    if (!service) throw new NotFoundException('Послугу не знайдено');

    // ✅ ownership check (бо послуги привʼязані до юзера)
    if (service.userId !== dbUserId) {
      throw new NotFoundException('Послугу не знайдено');
    }

    return service;
  }

  async update(authUserId: string, id: string, dto: UpdateServiceDto) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const existing = await this.prisma.userService.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Послугу не знайдено');

    if (existing.userId !== dbUserId) {
      throw new NotFoundException('Послугу не знайдено');
    }

    const data: any = {};

    if ((dto as any).name !== undefined) {
      const name = normalizeStr((dto as any).name);
      if (!name) throw new BadRequestException('Поле name є обовʼязковим');
      data.name = name;
    }

    if ((dto as any).description !== undefined) {
      const description = normalizeStr((dto as any).description);
      data.description = description ? description : null;
    }

    if ((dto as any).price !== undefined) {
      data.price = normalizePriceInput((dto as any).price);
    }

    return this.prisma.userService.update({
      where: { id },
      data,
    });
  }

  async remove(authUserId: string, id: string) {
    const dbUserId = await this.plan.resolveDbUserId(authUserId);

    const existing = await this.prisma.userService.findUnique({
      where: { id },
      select: { id: true, userId: true },
    });
    if (!existing) throw new NotFoundException('Послугу не знайдено');

    if (existing.userId !== dbUserId) {
      throw new NotFoundException('Послугу не знайдено');
    }

    await this.prisma.userService.delete({ where: { id } });
    return { success: true };
  }
}
