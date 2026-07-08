export const parseCategoryCsv = (category: string): string[] =>
  category
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);

export const normalizeCategoryCsv = (category: string): string => parseCategoryCsv(category).join(",");

export const formatCategoryCsv = (category: string): string => parseCategoryCsv(category).join(", ");
