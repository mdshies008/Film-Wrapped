import JSZip from 'jszip';
import { parseCsvText, type CsvRow } from './readCsv';

export type LetterboxdRows = {
  watched: CsvRow[];
  ratings: CsvRow[];
  diary: CsvRow[];
  watchlist: CsvRow[];
  likes: CsvRow[];
};

export async function readLetterboxdZip(file: File): Promise<LetterboxdRows> {
  if (!file.name.toLowerCase().endsWith('.zip')) {
    throw new Error('Choose a Letterboxd export ZIP file.');
  }

  const zip = await JSZip.loadAsync(await file.arrayBuffer());

  const rows: LetterboxdRows = {
    watched: [],
    ratings: [],
    diary: [],
    watchlist: [],
    likes: [],
  };

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;

    const normalizedPath = path
      .replace(/\\/g, '/')
      .replace(/^\uFEFF/, '')
      .trim()
      .toLowerCase();

    const pathParts = normalizedPath.split('/');

    // Letterboxd exports can include stale copies in these folders.
    // Ignore them so they can't overwrite the active CSV files.
    if (pathParts.some((part) => part === 'deleted' || part === 'orphaned')) {
      continue;
    }

    const filename = pathParts[pathParts.length - 1];
    let target: keyof LetterboxdRows | undefined;

    if (/(^|\/)likes\/films\.csv$/.test(normalizedPath)) {
      target = 'likes';
    } else if (
      filename === 'watched.csv' ||
      filename === 'ratings.csv' ||
      filename === 'diary.csv' ||
      filename === 'watchlist.csv'
    ) {
      target = filename.replace('.csv', '') as keyof LetterboxdRows;
    }

    if (target) {
      rows[target] = parseCsvText(await entry.async('string'));
    }
  }

  if (
    rows.watched.length === 0 &&
    rows.ratings.length === 0 &&
    rows.diary.length === 0 &&
    rows.watchlist.length === 0 &&
    rows.likes.length === 0
  ) {
    throw new Error('I could not find Letterboxd CSV files in this ZIP.');
  }

  return rows;
}