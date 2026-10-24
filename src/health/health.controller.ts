import { Controller, Get } from '@nestjs/common';
import {
  DiskHealthIndicator,
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
} from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly disk: DiskHealthIndicator,
  ) {}

  /**
   * Liveness probe – is the process alive?
   * Used by Kubernetes / orchestrators for restart decisions.
   */
  @Get('live')
  @HealthCheck()
  checkLiveness() {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024), // 300 MB
      () => this.memory.checkRSS('memory_rss', 500 * 1024 * 1024), // 500 MB
    ]);
  }

  /**
   * Readiness probe – is the application ready to receive traffic?
   * Add database, cache, external services here later.
   */
  @Get('ready')
  @HealthCheck()
  checkReadiness() {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
      () =>
        this.disk.checkStorage('disk', {
          path: '/',
          thresholdPercent: 0.9, // 90% usage
        }),
      // Example for later:
      // () => this.db.pingCheck('database'),
    ]);
  }

  /**
   * General health endpoint (commonly used by monitoring tools)
   */
  @Get()
  @HealthCheck()
  check() {
    return this.checkReadiness();
  }
}
