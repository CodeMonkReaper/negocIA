import type { ProductResponseDto } from "@negocia/contracts";
import type { ProductRecord } from "../../../domain/catalog/entities";

export function toProductResponseDto(
  record: ProductRecord,
): ProductResponseDto {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    price: record.price,
    currency: record.currency,
    type: record.type,
    category: record.category,
    durationMinutes: record.durationMinutes,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

