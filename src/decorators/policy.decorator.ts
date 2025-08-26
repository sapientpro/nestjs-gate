import { ForwardReference, Type } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';

export const Policy = DiscoveryService.createDecorator<Type | ForwardReference>();
