/** Complete original byte lines. Coordinates never shift around corrupt lines.
 * Keep BOM/CR bytes compatible with the old valid UTF8 line identity. */
export function* completeOriginalLines(bytes:Buffer){
  for(const record of originalByteLines(bytes))yield {...record,text:decodeOriginalLine(record.bytes)};
}
export function decodeOriginalLine(bytes:Buffer){try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{return null;}}
export function* originalByteLines(bytes:Buffer){
  let start=0,line=1,end:number;
  while((end=bytes.indexOf(10,start))!==-1){
    yield {line,bytes:bytes.subarray(start,end)};start=end+1;line++;
  }
}
export const partialOriginalLine=(bytes:Buffer)=>bytes.length>0&&bytes.at(-1)!==10;
