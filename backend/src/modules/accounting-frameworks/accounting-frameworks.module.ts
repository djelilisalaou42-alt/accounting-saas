import { Module } from '@nestjs/common';
import { AccountingFrameworksController } from './accounting-frameworks.controller';
import { AccountingFrameworksService } from './accounting-frameworks.service';

@Module({
  controllers: [AccountingFrameworksController],
  providers: [AccountingFrameworksService],
  exports: [AccountingFrameworksService],
})
export class AccountingFrameworksModule {}
