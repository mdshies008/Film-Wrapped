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
  getTopWatchedFilms,
} from './lib/stats';
import './App.css';

function App() {
  const [films, setFilms] = useState<Film[]>([]);
  const [status, setStatus] = useState(
    'Looking for a library saved on this device…',
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState('all-time');

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

  const years = getAvailableYears(films);
  const diaryEntryCount = films.reduce(
    (total, film) => total + (film.diaryEntryCount ?? 0),
    0,
  );
  const datedDiaryEntryCount = films.reduce(
    (total, film) => total + film.watchedDates.length,
    0,
  );

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
          disabled={busy}
        />
        <p role="status">{status}</p>
        {error && <p role="alert">{error}</p>}
      </section>

      {films.length > 0 && (
        <>
          <section>
            <h2>Your library</h2>
            <p>{films.length} imported titles</p>
            <p>{watchedCount} watched films</p>
            <p>{ratedFilms.length} rated films</p>
            <p>{watchlistCount} watchlist titles</p>
            <p>{diaryEntryCount} Diary entries imported</p>
            <p>{datedDiaryEntryCount} with a viewing date</p>
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
                  </li>
                ))}
              </ol>
            ) : (
              <p>
                No dated Diary entries for this period yet. All-time includes
                films marked watched without a diary date.
              </p>
            )}
          </section>
        </>
      )}
    </main>
  );
}

export default App;