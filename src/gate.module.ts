import { Global, Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { GateService } from './gate.service';

@Global()
@Module({
  imports: [DiscoveryModule],
  providers: [GateService],
  exports: [GateService],
})
export class GateModule {}
