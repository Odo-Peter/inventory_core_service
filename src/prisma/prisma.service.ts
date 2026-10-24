import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma/client.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    // Connect when the Nest application starts
    await this.$connect();
  }

  async onModuleDestroy() {
    // Disconnect cleanly when the application shuts down
    await this.$disconnect();
  }
}
