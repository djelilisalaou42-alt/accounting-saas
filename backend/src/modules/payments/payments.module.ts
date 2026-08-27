import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, PermissionsGuard],
  exports: [PaymentsService],
})
export class PaymentsModule {}
