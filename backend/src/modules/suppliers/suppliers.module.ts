import { Module } from '@nestjs/common';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Module({
  controllers: [SuppliersController],
  providers: [SuppliersService, PermissionsGuard],
  exports: [SuppliersService],
})
export class SuppliersModule {}
