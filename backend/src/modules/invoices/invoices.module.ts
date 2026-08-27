import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Module({
  controllers: [InvoicesController],
  providers: [InvoicesService, PermissionsGuard],
  exports: [InvoicesService],
})
export class InvoicesModule {}
