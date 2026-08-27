import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { TaxesService } from './taxes.service';
import { CreateTaxDto, UpdateTaxDto } from './dto/tax.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

// Référentiel global par pays (pas de :companyId — voir taxes.service.ts
// pour la justification). Authentifié uniquement pour la lecture (même
// pattern que /accounting-frameworks) ; écriture réservée à isSuperAdmin.
@Controller('taxes')
@UseGuards(JwtAuthGuard)
export class TaxesController {
  constructor(private readonly service: TaxesService) {}

  @Get()
  async list(@Query('country') country?: string, @Query('includeInactive') includeInactive?: string) {
    return this.service.list(country, includeInactive === 'true');
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateTaxDto) {
    return this.service.create(user, dto);
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateTaxDto) {
    return this.service.update(user, id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/disable')
  async disable(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.disable(user, id);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/enable')
  async enable(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.service.enable(user, id);
  }
}
