import type { Film } from '../types';

export type RankedWatchedFilm = {
  film: Film;
  watchCount: number;
};

export type RankedDirector = {
  name: string;
  averageRating: number;
  ratedFilmCount: number;
};

export type RankedCountry = {
  name: string;
  watchCount: number;
};

export function getAvailableYears(films: Film[]): string[] {
  const years = new Set<string>();

  for (const film of films) {
    for (const date of film.watchedDates) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        years.add(date.slice(0, 4));
      }
    }
  }

  return [...years].sort((a, b) => b.localeCompare(a));
}

export function getPeriodWatchCount(film: Film, period: string): number {
  if (period === 'all-time') {
    return (
      Math.max(film.diaryEntryCount ?? 0, film.watchedDates.length) ||
      (film.watched ? 1 : 0)
    );
  }

  return film.watchedDates.filter((date) => date.startsWith(`${period}-`))
    .length;
}

export function getFilmsForPeriod(films: Film[], period: string): Film[] {
  return films.filter(
    (film) => film.watched && getPeriodWatchCount(film, period) > 0,
  );
}

export function getTopWatchedFilms(
  films: Film[],
  period: string,
): RankedWatchedFilm[] {
  return films
    .filter((film) => film.watched)
    .map((film) => ({
      film,
      watchCount: getPeriodWatchCount(film, period),
    }))
    .filter((item) => item.watchCount > 0)
    .sort(
      (a, b) =>
        b.watchCount - a.watchCount ||
        (b.film.rating ?? -1) - (a.film.rating ?? -1) ||
        a.film.title.localeCompare(b.film.title),
    )
    .slice(0, 5);
}

export function getTopRatedDirector(
  films: Film[],
  period: string,
): RankedDirector | null {
  const totals = new Map<string, { ratingTotal: number; filmCount: number }>();

  for (const film of films) {
    if (film.rating === null || getPeriodWatchCount(film, period) === 0) {
      continue;
    }

    const directors = new Set(film.metadata?.directors ?? []);

    for (const director of directors) {
      const name = director.trim();
      if (!name) continue;

      const current = totals.get(name) ?? { ratingTotal: 0, filmCount: 0 };
      current.ratingTotal += film.rating;
      current.filmCount += 1;
      totals.set(name, current);
    }
  }

  return (
    [...totals.entries()]
      .filter(([, stats]) => stats.filmCount >= 2)
      .map(([name, stats]) => ({
        name,
        averageRating: stats.ratingTotal / stats.filmCount,
        ratedFilmCount: stats.filmCount,
      }))
      .sort(
        (a, b) =>
          b.averageRating - a.averageRating ||
          b.ratedFilmCount - a.ratedFilmCount ||
          a.name.localeCompare(b.name),
      )[0] ?? null
  );
}

export function getTopWatchedCountries(
  films: Film[],
  period: string,
): RankedCountry[] {
  const totals = new Map<string, number>();

  for (const film of films) {
    const watchCount = getPeriodWatchCount(film, period);
    if (watchCount === 0) continue;

    const countries = new Set(film.metadata?.countries ?? []);

    for (const country of countries) {
      const name = country.trim();
      if (!name) continue;

      totals.set(name, (totals.get(name) ?? 0) + watchCount);
    }
  }

  return [...totals.entries()]
    .map(([name, watchCount]) => ({ name, watchCount }))
    .sort(
      (a, b) =>
        b.watchCount - a.watchCount || a.name.localeCompare(b.name),
    )
    .slice(0, 5);
}