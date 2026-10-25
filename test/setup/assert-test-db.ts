export function assertTestDatabase(url: string | undefined): void {
  const name = url ? new URL(url).pathname.replace(/^\//, '') : '';
  if (!name.endsWith('_test')) {
    throw new Error(
      `Refusing to run: database "${name || '(none)'}" does not end with "_test"`,
    );
  }
}
