import type { Film, FilmMetadata } from '../types';
import {
  getTmdbMovieMetadata,
  searchTmdbMovie,
} from './tmdb';

function normalizeTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function getReleaseYear(releaseDate: string): number | null {
  const year = Number(releaseDate.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

export async function findFilmMetadata(
  film: Film,
): Promise<FilmMetadata | null> {
  if (film.metadata?.tmdbId) {
    return film.metadata;
  }

  const results = await searchTmdbMovie(film.title, film.year);
  const filmTitle = normalizeTitle(film.title);

  const exactMatches = results.filter((result) => {
    const sameTitle =
      normalizeTitle(result.title) === filmTitle ||
      normalizeTitle(result.original_title) === filmTitle;

    const sameYear =
      film.year === null || getReleaseYear(result.release_date) === film.year;

    return sameTitle && sameYear;
  });

  if (exactMatches.length !== 1) {
    return null;
  }

  return getTmdbMovieMetadata(exactMatches[0].id);
}