const FIELDS=Object.freeze([
  ['full_name','Họ và tên'],['identity_number','Số CCCD'],['date_of_birth','Ngày sinh'],
  ['sex','Giới tính'],['nationality','Quốc tịch'],['expiry_date','Ngày hết hạn'],['address','Nơi cư trú'],
]);
const esc=(value='')=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderProviderKycProfileSection(state,{loading=false,error='',testMode=false}={}){
  if(loading)return '<section class="provider-kyc-profile" data-provider-kyc-profile><p>XÁC MINH DANH TÍNH</p><h2>Xác minh danh tính</h2><small>Đang tải trạng thái xác minh…</small></section>';
  if(error)return `<section class="provider-kyc-profile" data-provider-kyc-profile><p>XÁC MINH DANH TÍNH</p><h2>Xác minh danh tính</h2><small class="kyc-profile-error">${esc(error)}</small></section>`;
  const providerStatus=state?.provider?.kycStatus;
  const submissionStatus=state?.submission?.status;
  const pending=submissionStatus==='pending_review';
  const verified=providerStatus==='verified';
  const rejected=providerStatus==='rejected'||submissionStatus==='rejected';
  const label=verified?'Đã xác minh':pending?'Đang xác minh':rejected?'Xác minh không thành công':'Chưa xác minh';
  const action=verified||pending?'':rejected?'<button type="button" data-open-provider-kyc>Thử lại</button>':'<button type="button" data-open-provider-kyc>Xác minh ngay</button>';
  // TODO(PILOT-BLOCKER): remove this verified-provider KYC preview before onboarding real providers.
  const preview=verified&&testMode?'<button type="button" class="kyc-test-preview" data-open-provider-kyc-test>TEST — Xem quy trình KYC</button>':'';
  return `<section class="provider-kyc-profile" data-provider-kyc-profile><div><span class="kyc-profile-icon" aria-hidden="true">${verified?'✓':'◇'}</span><div><p>XÁC MINH DANH TÍNH</p><h2>Xác minh danh tính</h2><strong class="kyc-profile-status ${verified?'verified':''}">${verified?'✓ ':''}${label}</strong></div></div>${action}${preview}</section>`;
}

export function renderProviderKyc(state,{stage='capture',previewUrl='',error='',busy=false,testMode=false,showBack=false}={}){
  const header=`<header class="provider-header">${showBack?'<button type="button" class="kyc-back" data-close-provider-kyc aria-label="Quay lại">‹</button>':''}<div class="brand"><span>H</span><div><strong>HOME AI</strong><small>Đối tác kỹ thuật</small></div></div></header>`;
  if(stage==='test_complete')return `${header}<main class="provider-kyc provider-kyc-status"><span>✓</span><p>CHẾ ĐỘ TEST</p><h1>Quy trình KYC đã hoàn tất.</h1><small>Không có tài liệu hoặc hồ sơ xác minh nào được lưu.</small><button type="button" data-close-provider-kyc>Quay lại Hồ sơ</button></main>`;
  if(state?.submission?.status==='pending_review')return `${header}<main class="provider-kyc provider-kyc-status"><span>✓</span><p>XÁC MINH DANH TÍNH</p><h1>Hồ sơ của bạn đang được xác minh.</h1><small>HOME AI sẽ thông báo khi quá trình xem xét hoàn tất.</small></main>`;
  if(stage==='analyzing')return `${header}<main class="provider-kyc provider-kyc-analyzing"><div class="kyc-spinner"></div><h1>HOME AI đang đọc thông tin...</h1><p>Ảnh được xử lý an toàn. Vui lòng không đóng trang.</p></main>`;
  const submission=state?.submission;
  if(stage==='confirm'&&submission){const fields=submission.confirmedFields??Object.fromEntries(Object.entries(submission.extraction?.fields??{}).map(([key,field])=>[key,field?.value]));return `${header}<main class="provider-kyc">${testMode?'<div class="kyc-test-banner">TEST · Không lưu tài liệu hoặc hồ sơ xác minh</div>':''}<p class="pricing-kicker">XÁC MINH DANH TÍNH</p><h1>Xác nhận thông tin</h1><p>Kiểm tra và sửa thông tin trước khi gửi HOME AI xem xét.</p>${previewUrl?`<img class="kyc-preview" src="${esc(previewUrl)}" alt="Mặt trước CCCD đã chọn">`:''}<form data-provider-kyc-form>${FIELDS.map(([name,label])=>`<label>${label}${submission.extraction?.fields?.[name]?.confidence<.65?'<small>Độ tin cậy thấp — vui lòng kiểm tra</small>':''}<input name="${name}" value="${esc(fields?.[name]??'')}" ${['full_name','identity_number','date_of_birth'].includes(name)?'required':''}></label>`).join('')}<button data-confirm-provider-kyc ${busy?'disabled':''}>${testMode?'Hoàn tất TEST':'Xác nhận thông tin'}</button></form><p class="app-message" role="alert">${esc(error)}</p></main>`;}
  return `${header}<main class="provider-kyc">${testMode?'<div class="kyc-test-banner">TEST · Phân tích tạm thời, không lưu dữ liệu</div>':''}<p class="pricing-kicker">HỒ SƠ PROVIDER</p><h1>Xác minh danh tính</h1><p>Chụp mặt trước CCCD để HOME AI điền trước thông tin. Kết quả luôn cần bạn xác nhận và được HOME AI xem xét.</p><div class="kyc-card-guide" aria-hidden="true"><span>CCCD</span><div></div><i></i></div><ul><li>Chụp mặt trước CCCD</li><li>Toàn bộ thẻ phải hiển thị</li><li>Ảnh rõ nét, đủ ánh sáng</li><li>Tránh phản chiếu</li></ul><div class="kyc-actions"><label>Chụp ảnh<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" capture="environment" data-provider-kyc-file></label><label>Chọn từ thư viện<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" data-provider-kyc-file></label></div>${state?.submission?.status==='rejected'?'<p class="kyc-rejected">Ảnh trước đã bị từ chối. Vui lòng gửi ảnh mới rõ hơn.</p>':''}<p class="app-message" role="alert">${esc(error)}</p></main>`;
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
