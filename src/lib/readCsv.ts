import Papa from 'papaparse';

export type CsvRow = Record<string, string>;

export function parseCsvText(text: string): CsvRow[] {
  const result = Papa.parse<CsvRow>(text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  if (result.errors.length > 0) {
    throw new Error(`Could not read CSV: ${result.errors[0].message}`);
  }

  return result.data;
}

export async function readCsv(file: File): Promise<CsvRow[]> {
  return parseCsvText(await file.text());
}