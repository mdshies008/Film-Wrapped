import type { FilmMetadata } from '../types';

const TMDB_PROXY_BASE =
  'https://film-wrapped-tmdb-proxy.mdshies008.workers.dev';

export interface TmdbSearchResult {
  id: number;
  title: string;
  original_title: string;
  release_date: string;
  overview?: string;
  poster_path?: string | null;
  original_language?: string;
  vote_average?: number;
}

interface TmdbSearchResponse {
  results: TmdbSearchResult[];
}

interface TmdbMovieDetails {
  id: number;
  runtime: number | null;
  poster_path: string | null;
  genres: Array<{ name: string }>;
  production_countries: Array<{ name: string }>;
  credits: {
    crew: Array<{ job: string; name: string }>;
  };
}
async function tmdbGet<T>(url: URL): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`TMDB proxy request failed with status ${response.status}.`);
  }

  return response.json() as Promise<T>;
}

export async function searchTmdbMovie(
  title: string,
  year: number | null,
): Promise<TmdbSearchResult[]> {
  const url = new URL(`${TMDB_PROXY_BASE}/search/movie`);
  url.searchParams.set('query', title);

  if (year !== null) {
    url.searchParams.set('year', String(year));
  }

  const result = await tmdbGet<TmdbSearchResponse>(url);
  return result.results;
}

export async function getTmdbMovieMetadata(
  movieId: number,
): Promise<FilmMetadata> {
  const url = new URL(`${TMDB_PROXY_BASE}/movie/${movieId}`);
  url.searchParams.set('append_to_response', 'credits');

  const movie = await tmdbGet<TmdbMovieDetails>(url);

  return {
    tmdbId: movie.id,
    countries: movie.production_countries.map((country) => country.name),
    genres: movie.genres.map((genre) => genre.name),
    directors: [
      ...new Set(
        movie.credits.crew
          .filter((person) => person.job === 'Director')
          .map((person) => person.name),
      ),
    ],
    runtimeMinutes: movie.runtime,
    posterPath: movie.poster_path,
  };
}