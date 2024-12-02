/**
 * Extracts and returns the file extension from a given filename or path.
 * The extension is returned in lowercase, without the dot.
 *
 * @param filename - The filename or path to extract the extension from
 * @returns The lowercase file extension without the dot, or empty string if no extension
 *
 * @example
 * getLanguageExtension('/file/test.tsx') // Returns 'tsx'
 * getLanguageExtension('script.js')  // Returns 'js'
 * getLanguageExtension('.gitignore')     // Returns ''
 */
export function getLanguageExtension(filePath: string) {
  // Handle empty or invalid inputs
  if (!filePath) return "";

  return filePath.split(".").pop()?.toLowerCase() || "";
}
