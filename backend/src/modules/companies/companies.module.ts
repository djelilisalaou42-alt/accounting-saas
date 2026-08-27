import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule], // réutilise MailService (invitations) et les guards/décorateurs d'auth
  controllers: [CompaniesController],
  providers: [CompaniesService, PermissionsGuard],
  exports: [CompaniesService],
})
export class CompaniesModule {}
