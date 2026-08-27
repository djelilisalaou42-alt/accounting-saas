import { Module } from '@nestjs/common';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Module({
  controllers: [CashController],
  providers: [CashService, PermissionsGuard],
  exports: [CashService],
})
export class CashModule {}
