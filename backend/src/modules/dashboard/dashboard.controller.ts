import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

// companyId provient EXCLUSIVEMENT du paramètre d'URL, revérifié à
// chaque requête par PermissionsGuard (appartenance + permission) —
// même garantie que tous les autres contrôleurs de ce projet. Un
// utilisateur ne peut jamais accéder au dashboard d'une autre
// entreprise en modifiant l'URL sans appartenir à cette entreprise.
@Controller('companies/:companyId/dashboard')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  // REPORT.READ réutilisée (pas de nouvelle permission créée) : le
  // dashboard est une vue agrégée des mêmes données que les rapports,
  // jamais une nouvelle catégorie de donnée nécessitant son propre
  // système d'autorisation.
  @RequirePermissions('REPORT.READ')
  @Get()
  async get(@Param('companyId') companyId: string, @Query() query: DashboardQueryDto) {
    return this.service.getDashboard(companyId, query);
  }
}
