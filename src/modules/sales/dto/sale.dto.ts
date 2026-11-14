import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { PaginatedResponseDto } from '../../../common/pagination/paginated-response.dto.js';
import { PaymentMethod } from '../../../generated/prisma/enums.js';

export class SaleItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  item_id: string;

  @ApiProperty()
  sku: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  unit: string;

  @ApiProperty()
  unit_price: number;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  tax_amount: number;

  @ApiProperty()
  line_total: number;
}

export class SalePaymentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ enum: PaymentMethod })
  method: PaymentMethod;

  @ApiProperty()
  amount: number;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  pos_account_id: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  account_label: string | null;
}

export class SaleListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  store_id: string;

  @ApiProperty()
  receipt_number: number;

  @ApiProperty()
  shift_id: string;

  @ApiProperty()
  staff_id: string;

  @ApiProperty()
  staff_name: string;

  @ApiProperty()
  subtotal: number;

  @ApiProperty()
  tax_total: number;

  @ApiProperty()
  total: number;

  @ApiPropertyOptional({ enum: PaymentMethod, nullable: true, type: String })
  payment_method: PaymentMethod | null;

  @ApiProperty()
  item_count: number;

  @ApiProperty({ type: String, format: 'date-time' })
  created_at: Date;
}

export class SaleResponseDto extends SaleListItemDto {
  @ApiProperty({ type: () => [SaleItemResponseDto] })
  items: SaleItemResponseDto[];

  @ApiProperty({ type: () => SalePaymentResponseDto, nullable: true })
  payment: SalePaymentResponseDto | null;
}

export class SaleListResponseDto extends PaginatedResponseDto<SaleListItemDto> {}

export class ReceiptStoreDto {
  @ApiProperty()
  name: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  address: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  phone: string | null;

  @ApiProperty()
  currency: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  receipt_footer: string | null;
}

export class ReceiptResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  print_number: number;

  @ApiProperty()
  is_copy: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  printed_at: Date;

  @ApiProperty({ type: () => SaleResponseDto })
  sale: SaleResponseDto;

  @ApiProperty({ type: () => ReceiptStoreDto })
  store: ReceiptStoreDto;
}

export class PaymentAccountOptionDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  label: string;
}

export class PaymentMethodOptionDto {
  @ApiProperty({ enum: PaymentMethod })
  method: PaymentMethod;

  @ApiProperty({ type: () => [PaymentAccountOptionDto] })
  accounts: PaymentAccountOptionDto[];
}

export class PaymentOptionsResponseDto {
  @ApiProperty({ type: () => PaymentMethodOptionDto })
  cash: PaymentMethodOptionDto;

  @ApiPropertyOptional({ type: () => PaymentMethodOptionDto })
  card?: PaymentMethodOptionDto;

  @ApiPropertyOptional({ type: () => PaymentMethodOptionDto })
  bank_transfer?: PaymentMethodOptionDto;
}

export class SalesOverviewDayDto {
  @ApiProperty({ example: '2026-11-14' })
  date: string;

  @ApiProperty()
  total: number;

  @ApiProperty()
  count: number;
}

export class SalesOverviewPaymentMethodDto {
  @ApiProperty({ enum: PaymentMethod })
  method: PaymentMethod;

  @ApiProperty()
  total: number;

  @ApiProperty()
  count: number;
}

export class SalesOverviewTodayDto extends SalesOverviewDayDto {
  @ApiProperty({ type: () => [SalesOverviewPaymentMethodDto] })
  by_method: SalesOverviewPaymentMethodDto[];
}

export class SalesOverviewResponseDto {
  @ApiProperty({ example: 'Africa/Lagos' })
  timezone: string;

  @ApiProperty({ enum: ['own', 'store'] })
  scope: 'own' | 'store';

  @ApiProperty({ type: () => SalesOverviewTodayDto })
  today: SalesOverviewTodayDto;

  @ApiProperty({ type: () => [SalesOverviewDayDto] })
  daily: SalesOverviewDayDto[];
}

export class SalesSummaryPaymentMethodDto {
  @ApiProperty({ enum: PaymentMethod })
  method: PaymentMethod;

  @ApiProperty()
  count: number;

  @ApiProperty()
  amount: number;
}

export class SalesSummaryResponseDto {
  @ApiProperty()
  sale_count: number;

  @ApiProperty()
  subtotal: number;

  @ApiProperty()
  tax_total: number;

  @ApiProperty()
  total: number;

  @ApiProperty({ type: () => [SalesSummaryPaymentMethodDto] })
  by_payment_method: SalesSummaryPaymentMethodDto[];
}
