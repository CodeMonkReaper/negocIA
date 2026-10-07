import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { CorrelationIdMiddleware } from "./correlation-id.middleware";
import { CorrelationService } from "./correlation.service";

@Module({
  providers: [CorrelationService],
  exports: [CorrelationService],
})
export class CorrelationModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}