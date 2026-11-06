/**
 * Maps the explicit boolean strings accepted by JSON and query inputs.
 * Anything else is left untouched so `@IsBoolean()` can reject it.
 */
export const toBoolean = ({ value }: { value: unknown }): unknown => {
  if (value === true || value === 'true') {
    return true;
  }
  if (value === false || value === 'false') {
    return false;
  }
  return value;
};
