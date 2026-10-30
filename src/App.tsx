import { useEffect, useState, type ChangeEvent } from 'react';
import type { Film } from './types';
import { readCsv } from './lib/readCsv';
import { parseImdbRatings } from './lib/parseImdb';
import { readLetterboxdZip } from './lib/readLetterboxdZip';
import { parseLetterboxd } from './lib/parseLetterboxd';
import { loadLibrary, saveLibrary } from './lib/libraryStorage';
import {
  getAvailableYears,
  getFilmsForPeriod,
  getPeriodWatchCount,
  getTopRatedDirector,
  getTopWatchedCountries,
  getTopWatchedFilms,
} from './lib/stats';
import { findFilmMetadata } from './lib/enrichFilm';
import {
  getTmdbMovieMetadata,
  searchTmdbMovie,
  type TmdbSearchResult,
} from './lib/tmdb';
import './App.css';

function App() {
  const [films, setFilms] = useState<Film[]>([]);
  const [status, setStatus] = useState(
    'Looking for a library saved on this device…',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState('all-time');

  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState('');
  const [enrichMessage, setEnrichMessage] = useState('');
  const [enrichError, setEnrichError] = useState<string | null>(null);

  const [manualSearchResults, setManualSearchResults] = useState<
    Record<string, TmdbSearchResult[]>
  >({});
  const [manualBusyKey, setManualBusyKey] = useState<string | null>(null);
  const [manualMessage, setManualMessage] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    loadLibrary()
      .then((savedFilms) => {
        if (cancelled) return;

        setFilms(savedFilms);
        setStatus(
          savedFilms.length
            ? `Restored ${savedFilms.length} titles from this device.`
            : 'No saved library yet. Import an export to begin.',
        );
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('Could not load a saved library from this browser.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';

    if (!file) return;

    setBusy(true);
    setError(null);
    setStatus(`Reading ${file.name}…`);

    try {
      const fileName = file.name.toLowerCase();
      let importedFilms: Film[];

      if (fileName.endsWith('.zip')) {
        const rows = await readLetterboxdZip(file);
        importedFilms = parseLetterboxd(rows);
      } else if (fileName.endsWith('.csv')) {
        const rows = await readCsv(file);
        importedFilms = parseImdbRatings(rows);
      } else {
        throw new Error('Choose a Letterboxd ZIP or IMDb ratings CSV.');
      }

      if (importedFilms.length === 0) {
        throw new Error('No films were found in that file.');
      }

      setFilms(importedFilms);
      setManualSearchResults({});
      setManualMessage('');
      setManualError(null);

      try {
        await saveLibrary(importedFilms);
        setStatus(
          `Imported and saved ${importedFilms.length} titles on this device.`,
        );
      } catch {
        setStatus(
          `Imported ${importedFilms.length} titles, but could not save them.`,
        );
        setError(
          'The library is available until you close or refresh this page.',
        );
      }
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not import this file.',
      );
      setStatus('Import failed.');
    } finally {
      setBusy(false);
    }
  }

  async function enrichLibrary() {
    const candidates = films.filter(
      (film) =>
        (film.watched || film.rating !== null) && !film.metadata?.tmdbId,
    );

    if (candidates.length === 0) {
      setEnrichMessage(
        'All watched and rated films already have TMDB metadata.',
      );
      setEnrichError(null);
      return;
    }

    setEnrichBusy(true);
    setEnrichError(null);
    setEnrichMessage('');

    const updatedFilms = [...films];
    let matchedCount = 0;
    let unmatchedCount = 0;

    try {
      for (let index = 0; index < candidates.length; index += 1) {
        const film = candidates[index];

        setEnrichProgress(
          `Looking up ${index + 1} of ${candidates.length}: ${film.title}`,
        );

        const metadata = await findFilmMetadata(film);

        if (metadata) {
          const filmIndex = updatedFilms.findIndex(
            (item) => item.key === film.key,
          );

          if (filmIndex !== -1) {
            updatedFilms[filmIndex] = {
              ...updatedFilms[filmIndex],
              metadata,
            };
            matchedCount += 1;
          }
        } else {
          unmatchedCount += 1;
        }

        const isCheckpoint = (index + 1) % 10 === 0;
        const isLastFilm = index === candidates.length - 1;

        if (isCheckpoint || isLastFilm) {
          const snapshot = [...updatedFilms];
          setFilms(snapshot);
          await saveLibrary(snapshot);
        }
      }

      setEnrichProgress('');
      setEnrichMessage(
        `Finished: ${matchedCount} matched, ${unmatchedCount} need a manual match.`,
      );
    } catch (reason) {
      const snapshot = [...updatedFilms];
      setFilms(snapshot);

      try {
        await saveLibrary(snapshot);
      } catch {
        // Keep the lookup error visible; successful metadata remains in memory.
      }

      setEnrichProgress('');
      setEnrichError(
        reason instanceof Error
          ? reason.message
          : 'TMDB lookup stopped unexpectedly.',
      );
    } finally {
      setEnrichBusy(false);
    }
  }

  async function searchManualMatches(film: Film) {
    setManualBusyKey(film.key);
    setManualError(null);
    setManualMessage('');

    try {
      const results = await searchTmdbMovie(film.title, film.year);
      setManualSearchResults((current) => ({
        ...current,
        [film.key]: results.slice(0, 8),
      }));
    } catch (reason) {
      setManualError(
        reason instanceof Error
          ? reason.message
          : `Could not search for ${film.title}.`,
      );
    } finally {
      setManualBusyKey(null);
    }
  }

  async function saveManualMatch(film: Film, match: TmdbSearchResult) {
    setManualBusyKey(film.key);
    setManualError(null);
    setManualMessage('');

    try {
      const metadata = await getTmdbMovieMetadata(match.id);
      const updatedFilms = films.map((item) =>
        item.key === film.key ? { ...item, metadata } : item,
      );

      await saveLibrary(updatedFilms);
      setFilms(updatedFilms);

      setManualSearchResults((current) => {
        const updated = { ...current };
        delete updated[film.key];
        return updated;
      });

      const year = match.release_date
        ? ` (${match.release_date.slice(0, 4)})`
        : '';

      setManualMessage(`Saved TMDB match: ${match.title}${year}.`);
    } catch (reason) {
      setManualError(
        reason instanceof Error
          ? reason.message
          : `Could not save the match for ${film.title}.`,
      );
    } finally {
      setManualBusyKey(null);
    }
  }

  const years = getAvailableYears(films);
  const watchedCount = films.filter((film) => film.watched).length;
  const ratedFilms = films.filter((film) => film.rating !== null);
  const watchlistCount = films.filter((film) => film.watchlisted).length;

  const averageRating = ratedFilms.length
    ? ratedFilms.reduce((total, film) => total + (film.rating ?? 0), 0) /
      ratedFilms.length
    : null;

  const topRatedFilms = [...ratedFilms]
    .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1))
    .slice(0, 5);

  const periodFilms = getFilmsForPeriod(films, period);
  const periodViewCount = periodFilms.reduce(
    (total, film) => total + getPeriodWatchCount(film, period),
    0,
  );
  const topWatchedFilms = getTopWatchedFilms(films, period);
  const topRatedDirector = getTopRatedDirector(films, period);
  const topWatchedCountries = getTopWatchedCountries(films, period);

  const unmatchedFilms = films.filter(
    (film) =>
      (film.watched || film.rating !== null) && !film.metadata?.tmdbId,
  );

  return (
    <main>
      <header>
        <p>MY MOVIE ARCHIVE</p>
        <h1>Your films, in perspective.</h1>
        <p>Import your Letterboxd or IMDb data to get started.</p>
      </header>

      <section>
        <label htmlFor="account-export-file">
          Choose Letterboxd ZIP or IMDb ratings CSV
        </label>
        <input
          id="account-export-file"
          type="file"
          accept=".zip,.csv,application/zip,text/csv"
          onChange={handleImport}
          disabled={busy || enrichBusy || manualBusyKey !== null}
        />
        <p role="status">{status}</p>
        {error && <p role="alert">{error}</p>}

        <h2>Movie details</h2>
        <p>
          Look up director and country information for watched and rated films.
        </p>
        <button
          type="button"
          onClick={enrichLibrary}
          disabled={
            busy || enrichBusy || manualBusyKey !== null || films.length === 0
          }
        >
          {enrichBusy ? 'Enriching library…' : 'Enrich library with TMDB'}
        </button>
        {enrichProgress && <p role="status">{enrichProgress}</p>}
        {enrichMessage && <p role="status">{enrichMessage}</p>}
        {enrichError && <p role="alert">{enrichError}</p>}
      </section>

      {unmatchedFilms.length > 0 && (
        <section>
          <h2>Review unmatched films</h2>
          <p>
            {unmatchedFilms.length} watched or rated films need a TMDB match.
            Choose a result only when the title and year are correct.
          </p>

          {manualMessage && <p role="status">{manualMessage}</p>}
          {manualError && <p role="alert">{manualError}</p>}

          <ol>
            {unmatchedFilms.map((film) => {
              const searchResults = manualSearchResults[film.key];

              return (
                <li key={film.key}>
                  <strong>
                    {film.title} ({film.year ?? 'year unknown'})
                  </strong>{' '}
                  <button
                    type="button"
                    onClick={() => void searchManualMatches(film)}
                    disabled={manualBusyKey !== null || enrichBusy}
                  >
                    {manualBusyKey === film.key
                      ? 'Searching…'
                      : 'Search TMDB'}
                  </button>

                  {searchResults && searchResults.length === 0 && (
                    <p>No TMDB results found for this title and year.</p>
                  )}

                  {searchResults && searchResults.length > 0 && (
                    <ul className="tmdb-match-list">
                      {searchResults.map((match) => (
                        <li key={match.id} className="tmdb-match-card">
                          {match.poster_path ? (
                            <img
                              className="tmdb-match-poster"
                              src={`https://image.tmdb.org/t/p/w185${match.poster_path}`}
                              alt={`Poster for ${match.title}`}
                              loading="lazy"
                            />
                          ) : (
                            <div className="tmdb-match-poster tmdb-poster-placeholder">
                              No poster
                            </div>
                          )}

                          <div className="tmdb-match-info">
                            <h4>
                              {match.title} (
                              {match.release_date
                                ? match.release_date.slice(0, 4)
                                : 'year unknown'}
                              )
                            </h4>

                            {match.original_title !== match.title && (
                              <p>Original title: {match.original_title}</p>
                            )}

                            <p className="tmdb-match-meta">
                              {match.original_language?.toUpperCase() ??
                                'Language unknown'}
                              {match.vote_average
                                ? ` · TMDB score ${match.vote_average.toFixed(1)} / 10`
                                : ''}
                            </p>

                            <p className="tmdb-match-overview">
                              {match.overview || 'No synopsis available.'}
                            </p>

                            <button
                              type="button"
                              onClick={() => void saveManualMatch(film, match)}
                              disabled={
                                manualBusyKey !== null || enrichBusy
                              }
                            >
                              {manualBusyKey === film.key
                                ? 'Saving…'
                                : 'Use this match'}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {films.length > 0 && (
        <>
          <section>
            <h2>Your library</h2>
            <p>{films.length} imported titles</p>
            <p>{watchedCount} watched films</p>
            <p>{ratedFilms.length} rated films</p>
            <p>{watchlistCount} watchlist titles</p>
            <p>Average rating: {averageRating?.toFixed(2) ?? '—'} / 5</p>

            <h3>Top-rated films</h3>
            {topRatedFilms.length > 0 ? (
              <ol>
                {topRatedFilms.map((film) => (
                  <li key={film.key}>
                    {film.title} ({film.year ?? 'year unknown'}) —{' '}
                    {film.rating?.toFixed(1)} / 5
                  </li>
                ))}
              </ol>
            ) : (
              <p>No rated films were found.</p>
            )}
          </section>

          <section>
            <h2>Wrapped preview</h2>

            <label htmlFor="viewing-period">Viewing period</label>
            <select
              id="viewing-period"
              value={period}
              onChange={(event) => setPeriod(event.target.value)}
            >
              <option value="all-time">All time</option>
              {years.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>

            <p>
              {periodFilms.length} films · {periodViewCount} logged viewings
            </p>

            <h3>Most-watched films</h3>
            {topWatchedFilms.length > 0 ? (
              <ol>
                {topWatchedFilms.map(({ film, watchCount }) => (
                  <li key={film.key}>
                    {film.title} — {watchCount}{' '}
                    {watchCount === 1 ? 'viewing' : 'viewings'}
                    {film.rating !== null && ` · ${film.rating.toFixed(1)} / 5`}
                    {film.metadata?.countries.length
                      ? ` · ${film.metadata.countries.join(', ')}`
                      : ''}
                  </li>
                ))}
              </ol>
            ) : (
              <p>
                No dated Diary entries for this period yet. All-time includes
                films marked watched without a diary date.
              </p>
            )}

            <h3>Highest-rated director</h3>
            {topRatedDirector ? (
              <p>
                {topRatedDirector.name} —{' '}
                {topRatedDirector.averageRating.toFixed(2)} / 5 across{' '}
                {topRatedDirector.ratedFilmCount} rated films
              </p>
            ) : (
              <p>
                No director has at least two rated films in this period yet.
              </p>
            )}

            <h3>Most-watched countries</h3>
            {topWatchedCountries.length > 0 ? (
              <ol>
                {topWatchedCountries.map((country) => (
                  <li key={country.name}>
                    {country.name} — {country.watchCount} associated viewings
                  </li>
                ))}
              </ol>
            ) : (
              <p>
                No country data for this period yet. Enrich the library first.
              </p>
            )}
          </section>
        </>
      )}
            <footer className="credits">
        <a
          href="https://www.themoviedb.org/"
          target="_blank"
          rel="noreferrer"
          aria-label="The Movie Database (TMDB)"
        >
          <img
            src={`${import.meta.env.BASE_URL}tmdb.svg`}
            alt="The Movie Database (TMDB)"
          />
        </a>
        <p>
          This product uses the TMDB API but is not endorsed or certified by
          TMDB.
        </p>
      </footer>
    </main>
  );
}

export default App;