import type { Film } from '../types';

export type RankedWatchedFilm = {
  film: Film;
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
    return Math.max(film.diaryEntryCount ?? 0, film.watchedDates.length) || (film.watched ? 1 : 0);
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
