import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Module global : PrismaService est disponible dans toute l'application
 * sans avoir à réimporter PrismaModule dans chaque module métier.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
