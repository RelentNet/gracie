/**
 * Minimal RFC-4180-ish CSV → rows of string cells. Handles quoted fields with
 * embedded commas, embedded newlines, and doubled-quote escapes (`""` → `"`) — a
 * naive `split(',')` mangles all three. Used server-side by the file-preview
 * content route; kept dependency-free (the parse is smaller than an import).
 *
 * Self-checked in ./csv.test.ts (the quoted-field/embedded-newline case).
 */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const text = input.replace(/\r\n?/g, '\n'); // normalize CRLF / lone CR → LF

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  // Flush the final field/row unless the input ended exactly on a row boundary.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
