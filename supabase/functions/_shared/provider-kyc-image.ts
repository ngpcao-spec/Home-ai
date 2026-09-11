import convertHeic from 'npm:heic-convert@2.1.0';
import { detectProviderKycImageType } from './provider-kyc-image-signatures.ts';

export async function prepareProviderKycImage(bytes:Uint8Array,extension:string){
  const detected=detectProviderKycImageType(bytes);
  if(extension==='jpg'||extension==='jpeg'){
    if(detected!=='jpeg')throw new Error('INVALID_DOCUMENT');
    return {bytes,mimeType:'image/jpeg',converted:false};
  }
  if(extension==='png'){
    if(detected!=='png')throw new Error('INVALID_DOCUMENT');
    return {bytes,mimeType:'image/png',converted:false};
  }
  if(extension==='webp'){
    if(detected!=='webp')throw new Error('INVALID_DOCUMENT');
    return {bytes,mimeType:'image/webp',converted:false};
  }
  if((extension!=='heic'&&extension!=='heif')||detected!=='heif')throw new Error('INVALID_DOCUMENT');
  const converted=new Uint8Array(await convertHeic({buffer:bytes,format:'JPEG',quality:0.85}));
  if(detectProviderKycImageType(converted)!=='jpeg'||converted.length>16777216)throw new Error('INVALID_DOCUMENT');
  return {bytes:converted,mimeType:'image/jpeg',converted:true};
}
