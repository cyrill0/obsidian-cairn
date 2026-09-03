/**
 * @file utils.ts
 * @description Shared utility functions for text manipulation, regex escaping, and anchor comment stripping.
 */

/**
 * Regular expression matching internal task anchor comments in Markdown notes.
 * Format: `%%tid:<alphanumeric>%%` (Obsidian comment syntax).
 * Used to strip internal metadata tags from display text and line comparisons.
 */
export const ANCHOR_REGEX = /\s*%%tid:[a-zA-Z0-9]+%%/g;

/**
 * Escapes characters with special meaning in regular expressions.
 * Ensures custom marker keywords containing symbols (e.g., "[TODO]") can be safely
 * used within dynamically constructed regular expressions.
 *
 * @param s - The raw string to escape.
 * @returns The regex-escaped string.
 */
export function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strips internal task anchor comments (`%%tid:...%%`) from a line of text and trims whitespace.
 * Includes a fast-path check that avoids regex evaluation when no comments are present.
 *
 * @param text - The raw text line from a note.
 * @returns Cleaned text suitable for display and comparison.
 */
export function stripAnchors(text: string): string {
    if (!text.includes('%%')) return text.trim();
    return text.replace(ANCHOR_REGEX, '').trim();
}
