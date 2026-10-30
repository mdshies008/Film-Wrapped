import type { Film } from '../types';
import type { CsvRow } from './readCsv';

function makeKey(title: string, year: number | null): string {
  const normalizedTitle = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  return `${normalizedTitle}|${year ?? ''}`;
}

function parseYear(value: string | undefined): number | null {
  const year = Number(value?.trim());

  return Number.isInteger(year) && year >= 1870 && year <= 2100
    ? year
    : null;
}

function parseRating(value: string | undefined): number | null {
  const rating = Number(value?.trim());

  return Number.isFinite(rating) && rating >= 1 && rating <= 10
    ? rating / 2
    : null;
}

export function parseImdbRatings(rows: CsvRow[]): Film[] {
  const films = new Map<string, Film>();

  for (const row of rows) {
    const title = row.Title?.trim();
    if (!title) continue;

    const year = parseYear(row.Year);
    const rating = parseRating(row['Your Rating']);
    if (rating === null) continue;

    const key = makeKey(title, year);

    films.set(key, {
      key,
      title,
      year,
      rating,
      ratingDate: row['Date Rated']?.trim() || null,
      watchedDates: [],
      rewatches: 0,
      liked: false,
      watchlisted: false,
      sources: ['imdb'],
      watched: true
    });
  }

  return [...films.values()].sort((a, b) => a.title.localeCompare(b.title));
}