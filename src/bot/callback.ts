// Компактный кодек callback_data. Telegram лимит — 64 байта на callback_data.
// Формат: части через '~'. Разделитель — '~', а не ':', потому что значения окон
// содержат ':' (например, "08:00"), а IANA tz содержат '/' (например, "Asia/Tokyo");
// символ '~' в таких значениях не встречается. Лимит 64 байта проверяется через
// Buffer.byteLength (UTF-8), не через .length.

const SEP = '~';

export function encodeCb(parts: string[]): string {
  const data = parts.join(SEP);
  if (Buffer.byteLength(data, 'utf8') > 64) {
    throw new Error(`callback_data > 64 байт: ${data}`);
  }
  return data;
}

export function decodeCb(data: string): string[] {
  return data.split(SEP);
}
