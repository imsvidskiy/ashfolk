export function quantile(values: readonly number[], share: number): number {
  const sorted = [...values].sort((first, second) => {
    return first - second;
  });

  return sorted[Math.floor(sorted.length * share)];
}

export function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

export function meanOf(values: readonly number[]): number {
  return (
    values.reduce((sum, value) => {
      return sum + value;
    }, 0) / values.length
  );
}

export function shareAbove(values: readonly number[], limit: number): number {
  return (
    values.filter((value) => {
      return value > limit;
    }).length / values.length
  );
}
