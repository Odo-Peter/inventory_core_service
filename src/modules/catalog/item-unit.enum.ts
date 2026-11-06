import { AppException } from '../../common/errors/app.exception.js';

export enum ItemUnit {
  // Countable
  PIECE = 'piece',
  PAIR = 'pair',
  SET = 'set',
  DOZEN = 'dozen',

  // Packaging
  PACK = 'pack',
  BOX = 'box',
  CARTON = 'carton',
  CASE = 'case',
  BAG = 'bag',
  SACHET = 'sachet',
  ROLL = 'roll',

  // Containers
  BOTTLE = 'bottle',
  CAN = 'can',
  JAR = 'jar',
  TIN = 'tin',
  TUBE = 'tube',
}

export const ITEM_UNITS = Object.values(ItemUnit);

/**
 * Service-layer guard for `Item.unit`. The column is plain text, so DTO
 * validation alone is not enough: seeds, scripts and imports can bypass it.
 */
export function assertValidUnit(unit: string): asserts unit is ItemUnit {
  if (!ITEM_UNITS.includes(unit as ItemUnit)) {
    throw new AppException(
      400,
      'invalid_unit',
      `unit must be one of: ${ITEM_UNITS.join(', ')}`,
    );
  }
}
