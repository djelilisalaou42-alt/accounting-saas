import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ReportsModule } from '../reports/reports.module';

@Module({
  imports: [ReportsModule],
  controllers: [DashboardController],
  providers: [DashboardService, PermissionsGuard],
})
export class DashboardModule {}
