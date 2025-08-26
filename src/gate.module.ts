import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { GateService } from './gate.service';

@Module({
  imports: [DiscoveryModule],
  providers: [GateService],
  exports: [GateService],
})
export class GateModule {}
