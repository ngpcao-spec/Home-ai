const ascii=(bytes:Uint8Array,start:number,length:number)=>String.fromCharCode(...bytes.subarray(start,start+length));
const heifBrands=new Set(['heic','heix','hevc','hevx','heim','heis','mif1','msf1']);

export function detectProviderKycImageType(bytes:Uint8Array){
  if(bytes.length>3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return 'jpeg';
  if(bytes.length>8&&[0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value,index)=>bytes[index]===value))return 'png';
  if(bytes.length>12&&ascii(bytes,0,4)==='RIFF'&&ascii(bytes,8,4)==='WEBP')return 'webp';
  if(bytes.length>=12&&ascii(bytes,4,4)==='ftyp'
    && Array.from({length:Math.min(13,Math.floor((bytes.length-8)/4))},(_,index)=>ascii(bytes,8+index*4,4)).some(brand=>heifBrands.has(brand)))return 'heif';
  return null;
}
