export type ImportSource = 'letterboxd' | 'imdb';

export interface Film{
    key: string;
    title: string;
    year: number | null;
    rating: number | null; // normalized a 0-5 scale
    ratingDate: string | null;
    watchedDates: string[];
    diaryEntryCount?: number;
    rewatches: number;
    liked: boolean;
    sources: ImportSource[];
    metadata?: FilmMetadata;
    watchlisted: boolean;
    watched: boolean;
}

export interface FilmMetadata {
    countries: string[];
    genres: string[];
    directors: string[];
    runmtimeMinutes: number | null;
}
