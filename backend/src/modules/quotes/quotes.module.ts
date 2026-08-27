import { Module } from '@nestjs/common';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Module({
  controllers: [QuotesController],
  providers: [QuotesService, PermissionsGuard],
  exports: [QuotesService],
})
export class QuotesModule {}
