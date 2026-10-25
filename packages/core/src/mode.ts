/** Compare permission bits (`actual & 0o777`) to an expected mode. */
export function modeIs(actual: number, expected: number): boolean {
  return (actual & 0o777) === expected;
}
