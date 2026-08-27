import { Module } from '@nestjs/common';
import { AccountingEntriesController } from './accounting-entries.controller';
import { AccountingEntriesService } from './accounting-entries.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Module({
  controllers: [AccountingEntriesController],
  providers: [AccountingEntriesService, PermissionsGuard],
  exports: [AccountingEntriesService],
})
export class AccountingEntriesModule {}
