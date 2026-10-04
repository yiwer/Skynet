/** One request's decoded records. This is never retained across raw reads.
 * Large originals keep the streaming readers' existing memory bound. BOM
 * inputs retain each reader's original decoding policy. */
export type PreparedOriginal = {
  records: { line: number; text: string; parsed: boolean; value: any }[];
  complete: boolean;
};
export function prepareOriginal(bytes: Buffer): PreparedOriginal | undefined {
  if (bytes.length > 1024 * 1024 || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) return undefined;
  const lines = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes).split('\n');
  const complete = !lines.pop();
  const records = lines.map((text, index) => {
    try { return { line: index + 1, text, parsed: true, value: JSON.parse(text) }; }
    catch { return { line: index + 1, text, parsed: false, value: undefined }; }
  });
  return { records, complete };
}
