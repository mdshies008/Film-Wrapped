import { useEffect, useState, type ChangeEvent } from 'react';
import type { Film } from './types';
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

function formatWatchTime(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${remainingMinutes}m`;
  return `${remainingMinutes}m`;
}

function App() {
  const [films, setFilms] = useState<Film[]>([]);
  const [status, setStatus] = useState(
    'Looking for a library saved on this device…',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'review'>(
    'dashboard',
  );
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
      if (!file.name.toLowerCase().endsWith('.zip')) {
        throw new Error('Choose a Letterboxd ZIP export.');
      }

      const rows = await readLetterboxdZip(file);
      const importedFilms: Film[] = parseLetterboxd(rows);

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

      await enrichLibrary(importedFilms);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Could not import this file.',
      );
      setStatus('Import failed.');
    } finally {
      setBusy(false);
    }
  }

  async function enrichLibrary(sourceFilms: Film[] = films) {
    const candidates = sourceFilms.filter(
      (film) =>
        (film.watched || film.rating !== null) &&
        (!film.metadata?.tmdbId ||
          film.metadata.posterPath === undefined),
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

    const updatedFilms = [...sourceFilms];
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
  const watchedFilms = films.filter((film) => film.watched);
  const ratedFilms = films.filter((film) => film.rating !== null);
  const watchlistCount = films.filter((film) => film.watchlisted).length;

  const averageRating = ratedFilms.length
    ? ratedFilms.reduce((total, film) => total + (film.rating ?? 0), 0) /
      ratedFilms.length
    : null;

  const filmsWithRuntime = watchedFilms.filter(
    (film) => typeof film.metadata?.runtimeMinutes === 'number',
  );

  const totalWatchMinutes = filmsWithRuntime.reduce(
    (total, film) =>
      total +
      (film.metadata?.runtimeMinutes ?? 0) *
        getPeriodWatchCount(film, 'all-time'),
    0,
  );

  const ratingDistribution = Array.from({ length: 10 }, (_, index) => {
    const rating = (index + 1) / 2;
    const count = ratedFilms.filter(
      (film) => Math.round((film.rating ?? 0) * 2) === index + 1,
    ).length;

    return { rating, count };
  });

  const maxRatingCount = Math.max(
    1,
    ...ratingDistribution.map((bucket) => bucket.count),
  );

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
      <header className="app-header">
        <p>MY MOVIE ARCHIVE</p>
        <h1>Your films, in perspective.</h1>
        <p>Add your Letterboxd data to explore your film history.</p>
      </header>

      <div className="app-layout">
        <nav className="app-tabs" aria-label="Main sections">
          <button
            type="button"
            className={activeTab === 'dashboard' ? 'app-tab active' : 'app-tab'}
            aria-pressed={activeTab === 'dashboard'}
            onClick={() => setActiveTab('dashboard')}
          >
            Dashboard
          </button>
          <button
            type="button"
            className={activeTab === 'review' ? 'app-tab active' : 'app-tab'}
            aria-pressed={activeTab === 'review'}
            onClick={() => setActiveTab('review')}
          >
            Year in Review
          </button>
        </nav>

        <div className="app-page-content">
          {activeTab === 'dashboard' && (
            <div className="dashboard-panel">
              <section className="dashboard-upload">
                <h2>Your library</h2>
                <label htmlFor="account-export-file">
                  Add your Letterboxd data
                </label>
                <input
                  id="account-export-file"
                  type="file"
                  accept=".zip,application/zip"
                  onChange={handleImport}
                  disabled={busy || enrichBusy || manualBusyKey !== null}
                />
                <p role="status">{status}</p>
                {error && <p role="alert">{error}</p>}

                <h3>Movie details</h3>
                <p>TMDB details are enriched automatically after import.</p>
                {enrichProgress && <p role="status">{enrichProgress}</p>}
                {enrichMessage && <p role="status">{enrichMessage}</p>}
                {enrichError && <p role="alert">{enrichError}</p>}

                {!busy && !enrichBusy && unmatchedFilms.length > 0 && (
                  <details className="dashboard-matches">
                    <summary>
                      <span>Review unmatched films</span>
                      <span className="unmatched-count">
                        {unmatchedFilms.length} left
                      </span>
                    </summary>

                    <p>
                      {unmatchedFilms.length} watched or rated films need a TMDB
                      match. Choose a result only when the title and year are
                      correct.
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
                              <p>
                                No TMDB results found for this title and year.
                              </p>
                            )}

                            {searchResults && searchResults.length > 0 && (
                              <ul className="tmdb-match-list">
                                {searchResults.map((match) => (
                                  <li
                                    key={match.id}
                                    className="tmdb-match-card"
                                  >
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
                                      {match.original_title !==
                                        match.title && (
                                        <p>
                                          Original title:{' '}
                                          {match.original_title}
                                        </p>
                                      )}
                                      <p className="tmdb-match-meta">
                                        {match.original_language?.toUpperCase() ??
                                          'Language unknown'}
                                        {match.vote_average
                                          ? ` · TMDB score ${match.vote_average.toFixed(1)} / 10`
                                          : ''}
                                      </p>
                                      <p className="tmdb-match-overview">
                                        {match.overview ||
                                          'No synopsis available.'}
                                      </p>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void saveManualMatch(film, match)
                                        }
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
                  </details>
                )}
              </section>

              {films.length > 0 && (
                <section className="dashboard-overview">
                  <div>
                    <p className="wrapped-eyebrow">YOUR LIBRARY AT A GLANCE</p>
                    <h2>General overview</h2>
                  </div>

                  <div className="dashboard-stats">
                    <article className="dashboard-stat">
                      <span>Films watched</span>
                      <strong>{watchedFilms.length}</strong>
                    </article>
                    <article className="dashboard-stat">
                      <span>Average rating</span>
                      <strong>
                        {averageRating !== null
                          ? `${averageRating.toFixed(2)} / 5`
                          : '—'}
                      </strong>
                    </article>
                    <article className="dashboard-stat">
                      <span>Estimated watch time</span>
                      <strong>
                        {filmsWithRuntime.length > 0
                          ? formatWatchTime(totalWatchMinutes)
                          : '—'}
                      </strong>
                      <small>
                        Runtime data for {filmsWithRuntime.length} of{' '}
                        {watchedFilms.length} watched films
                      </small>
                    </article>
                    <article className="dashboard-stat">
                      <span>Watchlist</span>
                      <strong>{watchlistCount}</strong>
                    </article>
                  </div>

                  <div className="dashboard-content-grid">
                    <article className="dashboard-card rating-card">
                      <h3>Rating distribution</h3>
                      {ratedFilms.length > 0 ? (
                        <div className="rating-chart">
                          <span
                            className="rating-chart-endpoint"
                            aria-label="One star"
                          >
                            ★
                          </span>

                          <div className="rating-chart-bars">
                            {ratingDistribution.map(({ rating, count }) => (
                              <div
                                className="rating-column"
                                key={rating}
                                tabIndex={0}
                                aria-label={`${count} ${
                                  count === 1 ? 'film' : 'films'
                                } rated ${rating.toFixed(1)} out of 5`}
                                data-tooltip={`${count} ${
                                  count === 1 ? 'film' : 'films'
                                } · ${rating.toFixed(1)} / 5`}
                              >
                                <span
                                  className="rating-bar-fill"
                                  style={{
                                    height: `${(count / maxRatingCount) * 100}%`,
                                  }}
                                />
                              </div>
                            ))}
                          </div>

                          <span
                            className="rating-chart-endpoint"
                            aria-label="Five stars"
                          >
                            ★★★★★
                          </span>
                        </div>
                      ) : (
                        <p>No ratings found in this library yet.</p>
                      )}
                    </article>

                    <article className="dashboard-card">
                      <h3>Top-rated films</h3>
                      {topRatedFilms.length > 0 ? (
                        <ol className="dashboard-top-films">
                          {topRatedFilms.map((film) => (
                            <li key={film.key}>
                              <span>
                                {film.title} ({film.year ?? 'year unknown'})
                              </span>
                              <strong>{film.rating?.toFixed(1)} / 5</strong>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p>No rated films were found.</p>
                      )}
                    </article>
                  </div>

                  <p className="dashboard-note">
                    Watch time is estimated from available TMDB runtimes and
                    logged viewings. Films without runtime data are not
                    included.
                  </p>
                </section>
              )}
            </div>
          )}

          {activeTab === 'review' && (
            <div className="review-panel">
              {films.length > 0 ? (
                <section className="wrapped-section">
                  <div className="wrapped-header">
                    <div>
                      <p className="wrapped-eyebrow">YOUR FILMS, IN REVIEW</p>
                      <h2>Year in Review</h2>
                      <p>Your viewing highlights for the selected period.</p>
                    </div>

                    <div className="wrapped-controls">
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
                    </div>
                  </div>

                  <div className="wrapped-metrics">
                    <div className="wrapped-metric">
                      <span>Films watched</span>
                      <strong>{periodFilms.length}</strong>
                    </div>
                    <div className="wrapped-metric">
                      <span>Logged viewings</span>
                      <strong>{periodViewCount}</strong>
                    </div>
                  </div>

                  <div className="wrapped-grid">
                    <article className="wrapped-card wrapped-card-films">
                      <h3>Most-watched films</h3>
                      {topWatchedFilms.length > 0 ? (
                        <ol className="wrapped-top-films">
                          {topWatchedFilms.map(({ film, watchCount }) => (
                            <li key={film.key}>
                              {film.metadata?.posterPath ? (
                                <img
                                  className="wrapped-film-poster"
                                  src={`https://image.tmdb.org/t/p/w185${film.metadata.posterPath}`}
                                  alt={`Poster for ${film.title}`}
                                  loading="lazy"
                                />
                              ) : (
                                <div className="wrapped-film-poster wrapped-poster-placeholder">
                                  No poster
                                </div>
                              )}

                              <div className="wrapped-film-copy">
                                <strong>{film.title}</strong>
                                <span>
                                  {watchCount}{' '}
                                  {watchCount === 1 ? 'viewing' : 'viewings'}
                                  {film.rating !== null &&
                                    ` · ${film.rating.toFixed(1)} / 5`}
                                  {film.metadata?.countries.length
                                    ? ` · ${film.metadata.countries.join(', ')}`
                                    : ''}
                                </span>
                              </div>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p>
                          No dated Diary entries for this period yet. All-time
                          includes films marked watched without a diary date.
                        </p>
                      )}
                    </article>

                    <article className="wrapped-card">
                      <h3>Highest-rated director</h3>
                      {topRatedDirector ? (
                        <p className="wrapped-highlight">
                          <strong>{topRatedDirector.name}</strong>
                          <span>
                            {topRatedDirector.averageRating.toFixed(2)} / 5
                            across {topRatedDirector.ratedFilmCount} rated films
                          </span>
                        </p>
                      ) : (
                        <p>
                          No director has at least two rated films in this
                          period yet.
                        </p>
                      )}
                    </article>

                    <article className="wrapped-card">
                      <h3>Most-watched countries</h3>
                      {topWatchedCountries.length > 0 ? (
                        <ol className="wrapped-country-list">
                          {topWatchedCountries.map((country) => (
                            <li key={country.name}>
                              <strong>{country.name}</strong>
                              <span>
                                {country.watchCount} associated viewings
                              </span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p>
                          No country data for this period yet. Enrich the
                          library first.
                        </p>
                      )}
                    </article>
                  </div>
                </section>
              ) : (
                <section className="review-empty">
                  <h2>Your Year in Review will appear here</h2>
                  <p>Add your Letterboxd data from the Dashboard.</p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('dashboard')}
                  >
                    Go to Dashboard
                  </button>
                </section>
              )}
            </div>
          )}
        </div>
      </div>

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