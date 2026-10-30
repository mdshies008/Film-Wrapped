import type { Film } from '../types';
import type { LetterboxdRows } from './readLetterboxdZip';

function getColumn(row: Record<string, string>, name: string): string | undefined {
  const wanted = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = Object.keys(row).find(
    (header) => header.toLowerCase().replace(/[^a-z0-9]/g, '') === wanted,
  );
  return key ? row[key] : undefined;
}

function parseYear(value: string | undefined): number | null {
  const year = Number(value?.trim());
  return Number.isInteger(year) && year >= 1870 && year <= 2100 ? year : null;
}

function parseRating(value: string | undefined): number | null {
  const rating = Number(value?.trim());
  return Number.isFinite(rating) && rating >= 0.5 && rating <= 5
    ? Math.round(rating * 2) / 2
    : null;
}

function parseWatchedDate(value: string | undefined): string | null {
  const date = value?.trim() ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date
    ? date
    : null;
}

function makeKey(title: string, year: number | null): string {
  return `${title.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()}|${year ?? ''}`;
}

export function parseLetterboxd(rows: LetterboxdRows): Film[] {
  const films = new Map<string, Film>();

  function getFilm(row: Record<string, string>): Film | null {
    const title = (getColumn(row, 'Name') || getColumn(row, 'Title') || '').trim();
    if (!title) return null;

    const year = parseYear(getColumn(row, 'Year'));
    const key = makeKey(title, year);
    let film = films.get(key);

    if (!film) {
      film = {
        key,
        title,
        year,
        rating: null,
        ratingDate: null,
        watched: false,
        watchedDates: [],
        diaryEntryCount: 0,
        rewatches: 0,
        liked: false,
        watchlisted: false,
        sources: ['letterboxd'],
      };
      films.set(key, film);
    }

    return film;
  }

  for (const row of rows.watched) {
    const film = getFilm(row);
    if (film) film.watched = true;
  }

  for (const row of rows.diary) {
    const film = getFilm(row);
    if (!film) continue;

    film.watched = true;
    film.diaryEntryCount = (film.diaryEntryCount ?? 0) + 1;

    // Letterboxd's Watched Date is the viewing date. Date is when the
    // diary record was created, so don't use it as a viewing-date fallback.
    const watchedDate = parseWatchedDate(getColumn(row, 'Watched Date'));
    if (watchedDate) film.watchedDates.push(watchedDate);

    const rating = parseRating(getColumn(row, 'Rating'));
    if (rating !== null && film.rating === null) film.rating = rating;

    if (getColumn(row, 'Rewatch')?.trim().toLowerCase() === 'yes') {
      film.rewatches += 1;
    }

    if (getColumn(row, 'Like')?.trim().toLowerCase() === 'yes') {
      film.liked = true;
    }
  }

  for (const row of rows.ratings) {
    const film = getFilm(row);
    if (!film) continue;
    film.watched = true;
    const rating = parseRating(getColumn(row, 'Rating'));
    if (rating !== null) film.rating = rating;
  }

  for (const row of rows.watchlist) {
    const film = getFilm(row);
    if (film) film.watchlisted = true;
  }

  for (const row of rows.likes) {
    const film = getFilm(row);
    if (film) film.liked = true;
  }

  return [...films.values()].sort((a, b) => a.title.localeCompare(b.title));
}
