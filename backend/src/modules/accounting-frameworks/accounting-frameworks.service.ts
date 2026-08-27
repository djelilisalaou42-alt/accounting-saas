import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AccountingFrameworksService {
  constructor(private readonly prisma: PrismaService) {}

  /** Liste publique (authentifiée) des référentiels disponibles, avec leurs classes. */
  async listFrameworks() {
    return this.prisma.accountingFramework.findMany({
      where: { isActive: true },
      include: { accountClasses: { orderBy: { displayOrder: 'asc' } } },
      orderBy: { name: 'asc' },
    });
  }
}
