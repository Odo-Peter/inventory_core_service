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
