/** Complete original byte lines. Coordinates never shift around corrupt lines.
 * Keep BOM/CR bytes compatible with the old valid UTF8 line identity. */
export function* completeOriginalLines(bytes:Buffer){
  const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});let start=0,line=1,end:number;
  while((end=bytes.indexOf(10,start))!==-1){
    const original=bytes.subarray(start,end);let text:string|null;
    try{text=decoder.decode(original);}catch{text=null;}
    yield {line,bytes:original,text};start=end+1;line++;
  }
}
export const partialOriginalLine=(bytes:Buffer)=>bytes.length>0&&bytes.at(-1)!==10;
