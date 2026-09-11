const FIELDS=Object.freeze([
  ['full_name','Họ và tên'],['identity_number','Số CCCD'],['date_of_birth','Ngày sinh'],
  ['sex','Giới tính'],['nationality','Quốc tịch'],['expiry_date','Ngày hết hạn'],['address','Nơi cư trú'],
]);
const esc=(value='')=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderProviderKyc(state,{stage='capture',previewUrl='',error='',busy=false}={}){
  const header='<header class="provider-header"><div class="brand"><span>H</span><div><strong>HOME AI</strong><small>Đối tác kỹ thuật</small></div></div></header>';
  if(state?.submission?.status==='pending_review')return `${header}<main class="provider-kyc provider-kyc-status"><span>✓</span><p>XÁC MINH DANH TÍNH</p><h1>Hồ sơ của bạn đang được xác minh.</h1><small>HOME AI sẽ thông báo khi quá trình xem xét hoàn tất.</small></main>`;
  if(stage==='analyzing')return `${header}<main class="provider-kyc provider-kyc-analyzing"><div class="kyc-spinner"></div><h1>HOME AI đang đọc thông tin...</h1><p>Ảnh được xử lý an toàn. Vui lòng không đóng trang.</p></main>`;
  const submission=state?.submission;
  if(stage==='confirm'&&submission){const fields=submission.confirmedFields??Object.fromEntries(Object.entries(submission.extraction?.fields??{}).map(([key,field])=>[key,field?.value]));return `${header}<main class="provider-kyc"><p class="pricing-kicker">XÁC MINH DANH TÍNH</p><h1>Xác nhận thông tin</h1><p>Kiểm tra và sửa thông tin trước khi gửi HOME AI xem xét.</p>${previewUrl?`<img class="kyc-preview" src="${esc(previewUrl)}" alt="Mặt trước CCCD đã chọn">`:''}<form data-provider-kyc-form>${FIELDS.map(([name,label])=>`<label>${label}${submission.extraction?.fields?.[name]?.confidence<.65?'<small>Độ tin cậy thấp — vui lòng kiểm tra</small>':''}<input name="${name}" value="${esc(fields?.[name]??'')}" ${['full_name','identity_number','date_of_birth'].includes(name)?'required':''}></label>`).join('')}<button data-confirm-provider-kyc ${busy?'disabled':''}>Xác nhận thông tin</button></form><p class="app-message" role="alert">${esc(error)}</p></main>`;}
  return `${header}<main class="provider-kyc"><p class="pricing-kicker">HỒ SƠ PROVIDER</p><h1>Xác minh danh tính</h1><p>Chụp mặt trước CCCD để HOME AI điền trước thông tin. Kết quả luôn cần bạn xác nhận và được HOME AI xem xét.</p><div class="kyc-card-guide" aria-hidden="true"><span>CCCD</span><div></div><i></i></div><ul><li>Chụp mặt trước CCCD</li><li>Toàn bộ thẻ phải hiển thị</li><li>Ảnh rõ nét, đủ ánh sáng</li><li>Tránh phản chiếu</li></ul><div class="kyc-actions"><label>Chụp ảnh<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" capture="environment" data-provider-kyc-file></label><label>Chọn từ thư viện<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" data-provider-kyc-file></label></div>${state?.submission?.status==='rejected'?'<p class="kyc-rejected">Ảnh trước đã bị từ chối. Vui lòng gửi ảnh mới rõ hơn.</p>':''}<p class="app-message" role="alert">${esc(error)}</p></main>`;
}

export function readProviderKycForm(root){const form=root.querySelector('[data-provider-kyc-form]');const fields=Object.fromEntries(FIELDS.map(([name])=>[name,form?.elements?.namedItem(name)?.value?.trim()||null]));const valid=Boolean(fields.full_name&&/^\d{9,12}$/.test(fields.identity_number??'')&&fields.date_of_birth);return Object.freeze({fields:Object.freeze(fields),valid});}

export function getProviderKycFileFormat(file){
  const type=String(file?.type??'').toLowerCase();
  const extension=String(file?.name??'').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]??'';
  const formats={
    'image/jpeg':{extension:'jpg',contentType:'image/jpeg'},'image/png':{extension:'png',contentType:'image/png'},
    'image/webp':{extension:'webp',contentType:'image/webp'},'image/heic':{extension:'heic',contentType:'image/heic'},
    'image/heif':{extension:'heif',contentType:'image/heif'},'image/x-heic':{extension:'heic',contentType:'image/heic'},
    'image/x-heif':{extension:'heif',contentType:'image/heif'},
  };
  return formats[type]??({jpg:formats['image/jpeg'],jpeg:formats['image/jpeg'],png:formats['image/png'],webp:formats['image/webp'],heic:formats['image/heic'],heif:formats['image/heif']}[extension]??null);
}

export function validateProviderKycFile(file){return Boolean(file&&file.size>0&&file.size<=8388608&&getProviderKycFileFormat(file));}
