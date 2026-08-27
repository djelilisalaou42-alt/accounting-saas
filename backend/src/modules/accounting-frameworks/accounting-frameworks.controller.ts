import { Controller, Get, UseGuards } from '@nestjs/common';
import { AccountingFrameworksService } from './accounting-frameworks.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('accounting-frameworks')
export class AccountingFrameworksController {
  constructor(private readonly service: AccountingFrameworksService) {}

  // Authentifié uniquement (pas de permission par entreprise : c'est un
  // référentiel global, pas une donnée d'entreprise) — utile pour
  // peupler le sélecteur de référentiel à la création d'une entreprise.
  @UseGuards(JwtAuthGuard)
  @Get()
  async list() {
    return this.service.listFrameworks();
  }
}
