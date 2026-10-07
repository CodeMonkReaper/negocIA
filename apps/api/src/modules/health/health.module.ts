import { Module } from "@nestjs/common";
import { CorrelationModule } from "../../common/correlation/correlation.module";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({
  imports: [CorrelationModule],
  controllers: [HealthController],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}