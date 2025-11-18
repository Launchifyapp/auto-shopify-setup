import parse from "csv-parse/lib/sync";

export function parseCsvShopify(csvText: string): any[] {
  return parse(csvText, {
    delimiter: ";",        // Ton CSV utilise des ";"
    columns: true,         // Donne un objet par ligne
    skip_empty_lines: true,
    relax_column_count: true,
    quote: '"',            // Gère le multi-ligne/HTML/;
    trim: true             // Nettoie auto espaces
  });
}
