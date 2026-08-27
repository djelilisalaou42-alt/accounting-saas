import { Module } from '@nestjs/common';
import { BankController } from './bank.controller';
import { BankService } from './bank.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Module({
  controllers: [BankController],
  providers: [BankService, PermissionsGuard],
  exports: [BankService],
})
export class BankModule {}
