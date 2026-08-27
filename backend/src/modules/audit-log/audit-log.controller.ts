import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuditLogService } from './audit-log.service';
import { ListAuditLogsDto } from './dto/list-audit-logs.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

// Volontairement AUCUNE route PATCH/PUT/DELETE dans ce contrôleur — le
// journal d'audit est une trace historique en lecture seule, y compris
// au niveau de la surface HTTP exposée (pas seulement du frontend).
@Controller('companies/:companyId/audit-logs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditLogController {
  constructor(private readonly service: AuditLogService) {}

  @RequirePermissions('AUDIT.READ')
  @Get()
  async list(@Param('companyId') companyId: string, @Query() query: ListAuditLogsDto) {
    return this.service.list(companyId, query);
  }

  // Déclaré AVANT get(':id') : une route littérale doit toujours
  // précéder une route à paramètre dynamique dans NestJS, sinon
  // ':id' intercepterait "export" comme s'il s'agissait d'un
  // identifiant d'événement.
  @RequirePermissions('AUDIT.EXPORT')
  @Get('export/csv')
  async exportCsv(@Param('companyId') companyId: string, @Query() query: ListAuditLogsDto, @Res() res: Response) {
    const csv = await this.service.exportCsv(companyId, query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="journal-audit.csv"');
    res.send(csv);
  }

  @RequirePermissions('AUDIT.READ')
  @Get(':id')
  async get(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.get(companyId, id);
  }
}
