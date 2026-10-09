/** "Showing in 5 areas. Turns off in an area when you add your own record there." */
export function exampleAreasLine(count: number): string {
  return `Showing in ${count} ${count === 1 ? "area" : "areas"}. Turns off in an area when you add your own record there.`;
}
