import { readProviderActivityInput, readProviderActivityPricing, renderProviderActivities } from './provider-activities.js';
import { readProviderAvailabilitySchedule, renderProviderAvailabilitySchedule, syncProviderAvailabilityScheduleForm } from './provider-availability-schedule.js';
import { readProviderProfessionalProfile, renderProviderProfessionalProfile, updateProviderProfessionalProfileDraft } from './provider-professional-profile.js';
import { readProviderServiceArea, renderProviderServiceArea, updateProviderServiceAreaPreview } from './provider-service-area.js';
import { readProviderIdentityAssistForm, renderProviderKyc, validateProviderKycFile } from './provider-kyc.js';

const esc=(value='')=>String(value).replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

export function getProviderOnboardingStep(state={}) {
  if (!state.providerExists) return 'welcome';
  if (!state.identityAssistComplete && !state.professionalProfileComplete) return 'identity-assist';
  if (!state.professionalProfileComplete) return 'profile';
  if (!state.hasActivity) return 'activities';
  if (!state.serviceAreaComplete) return 'service-area';
  if (!state.availabilityComplete) return 'availability';
  return 'complete';
}

const shell=(content,step)=>`<div class="provider-onboarding" data-provider-onboarding="${esc(step)}">
  <div class="brand"><span>H</span><div><strong>HOME AI</strong><small>Đối tác kỹ thuật</small></div></div>${content}</div>`;

export function renderProviderOnboarding(state,{content='',error='',busy=false}={}) {
  const step=getProviderOnboardingStep(state);
  if(step==='welcome')return shell(`<p class="onboarding-kicker">ĐỐI TÁC HOME AI</p><h1>Chào mừng bạn đến với HOME AI</h1><p>Hãy hoàn tất hồ sơ để bắt đầu nhận nhiệm vụ.</p><button type="button" data-start-provider-onboarding ${busy?'disabled':''}>Bắt đầu</button><p class="app-message" role="status">${esc(error)}</p>`,step);
  if(step==='complete')return shell('<h1>Hồ sơ đã sẵn sàng</h1><p>Đang mở HOME AI Provider…</p>',step);
  return shell(`<p class="onboarding-kicker">HOÀN TẤT HỒ SƠ</p>${content}<p class="app-message" role="status">${esc(error)}</p>`,step);
}

export async function initialiseProviderOnboarding(root,repository,{onComplete,onLogout}={}) {
  let state=await repository.getOnboardingState();let busy=false;let error='';let data=null;let photoFile=null;let photoPreview='';
  let identityState=null;let identityStage='capture';let identityPreview='';
  let activityFlow={step:'choose',mode:null,input:'',proposal:null,reference:null,error:''};
  const releasePhoto=()=>{if(photoPreview){globalThis.URL?.revokeObjectURL?.(photoPreview);photoPreview='';}};
  const refresh=async()=>{state=await repository.getOnboardingState();data=null;identityState=null;error='';await draw();};
  const draw=async()=>{
    const step=getProviderOnboardingStep(state);
    if(step==='complete'){root.innerHTML=renderProviderOnboarding(state);releasePhoto();root.removeEventListener('input',inputHandler);root.removeEventListener('change',changeHandler);root.removeEventListener('click',clickHandler);await onComplete?.();return;}
    if(step==='identity-assist'&&!identityState){identityState=await repository.loadKyc();identityStage=identityState?.submission?.status==='draft'?'confirm':'capture';if(identityStage==='confirm'&&identityState.submission?.documentPath)try{identityPreview=await repository.getIdentityPreview(identityState.submission.documentPath);}catch{identityPreview='';}}
    if(step==='profile'&&!data)data=await repository.getProfessionalProfile();
    if(step==='activities'&&!data)data=await repository.getServices();
    if(step==='service-area'&&!data)data=await repository.getServiceArea();
    if(step==='availability'&&!data)data=await repository.getAvailabilityPreferences();
    if(step==='identity-assist'){root.innerHTML=renderProviderKyc(identityState,{stage:identityStage,previewUrl:identityPreview,error,busy,assistMode:true});return;}
    let content='';
    if(step==='profile')content=renderProviderProfessionalProfile(data,{busy,previewUrl:photoPreview});
    if(step==='activities')content=renderProviderActivities(data,activityFlow);
    if(step==='service-area')content=renderProviderServiceArea(data,{busy});
    if(step==='availability')content=renderProviderAvailabilitySchedule(data,{busy});
    root.innerHTML=renderProviderOnboarding(state,{content,error,busy});
  };
  const finishMutation=async action=>{busy=true;error='';await draw();try{await action();await refresh();}catch(e){error=e?.message??'Không thể lưu. Vui lòng thử lại.';}finally{busy=false;await draw();}};
  const inputHandler=event=>{
    if(event.target?.matches?.('[data-professional-photo-input]')){photoFile=event.target.files?.[0]??null;releasePhoto();photoPreview=photoFile?URL.createObjectURL(photoFile):'';updateProviderProfessionalProfileDraft(root,photoPreview);}
    else if(event.target?.closest?.('[data-professional-profile-form]'))updateProviderProfessionalProfileDraft(root,photoPreview);
    else if(event.target?.closest?.('[data-availability-form]'))syncProviderAvailabilityScheduleForm(root);
    else if(event.target?.closest?.('[data-service-area-form]'))updateProviderServiceAreaPreview(root);
  };
  const changeHandler=async event=>{
    if(getProviderOnboardingStep(state)!=='identity-assist')return;
    const input=event.target.closest?.('[data-provider-kyc-file]');if(!input||busy)return;
    const file=input.files?.[0];if(!validateProviderKycFile(file)){error='Vui lòng chọn ảnh JPG, PNG, WebP, HEIC hoặc HEIF dưới 8 MB.';await draw();return;}
    busy=true;identityStage='analyzing';error='';await draw();
    try{identityState=await repository.uploadIdentity(file);identityStage='confirm';identityPreview='';if(identityState.submission?.documentPath)try{identityPreview=await repository.getIdentityPreview(identityState.submission.documentPath);}catch{identityPreview='';}}
    catch{identityStage='capture';error='Không thể đọc rõ CCCD. Bạn có thể chụp lại hoặc nhập thông tin thủ công.';}
    finally{busy=false;await draw();}
  };
  const clickHandler=async event=>{
    if(event.target.closest?.('[data-provider-logout]')){releasePhoto();await onLogout?.();return;}
    if(event.target.closest?.('[data-onboarding-refresh]')){await refresh();return;}
    if(event.target.closest?.('[data-start-provider-onboarding]')){await finishMutation(async()=>{state=await repository.provision();});return;}
    if(event.target.closest?.('[data-skip-provider-identity-assist]')){if(busy)return;await finishMutation(()=>repository.markStep('identity_assist'));return;}
    if(event.target.closest?.('[data-confirm-provider-kyc]')&&getProviderOnboardingStep(state)==='identity-assist'){
      if(busy)return;
      event.preventDefault();const draft=readProviderIdentityAssistForm(root);if(!draft.valid){error='Vui lòng kiểm tra họ tên và số CCCD nếu đã nhập.';await draw();return;}
      await finishMutation(()=>repository.completeIdentityAssist(identityState.submission.id,draft.fields));return;
    }
    if(event.target.closest?.('[data-save-professional-profile]')){event.preventDefault();const draft=readProviderProfessionalProfile(event.target.closest('[data-professional-profile-form]'),photoFile);if(!draft.valid){error='Vui lòng kiểm tra thông tin hồ sơ.';await draw();return;}await finishMutation(async()=>{await repository.saveProfessionalProfile(draft);releasePhoto();photoFile=null;});return;}
    const mode=event.target.closest?.('[data-activity-mode]');if(mode){activityFlow={...activityFlow,mode:mode.dataset.activityMode,error:''};await draw();return;}
    if(event.target.closest?.('[data-analyze-activity]')){event.preventDefault();const input=readProviderActivityInput(root,activityFlow.mode);if(!input.valid){activityFlow={...activityFlow,error:'Vui lòng nhập ít nhất 2 ký tự.'};await draw();return;}busy=true;await draw();try{const proposal=await repository.analyzeActivity(input);const reference=proposal.pricingModel==='hourly'?await repository.getHourlyRateReference(proposal.serviceCategory):{medianHourlyRate:null,providerCount:0,radiusKm:null};activityFlow={...activityFlow,step:'proposal',input:input.text,proposal,reference,error:''};}catch(e){activityFlow={...activityFlow,error:e?.message??'Không thể phân tích hoạt động.'};}finally{busy=false;await draw();}return;}
    if(event.target.closest?.('[data-activity-continue]')){activityFlow={...activityFlow,step:'rate'};await draw();return;}
    const back=event.target.closest?.('[data-activity-back]');if(back){activityFlow={...activityFlow,step:back.dataset.activityBack,error:''};await draw();return;}
    if(event.target.closest?.('[data-edit-activity]')){activityFlow={...activityFlow,step:'choose'};await draw();return;}
    if(event.target.closest?.('[data-create-activity]')){event.preventDefault();const pricing=readProviderActivityPricing(root);if(!pricing.valid){activityFlow={...activityFlow,error:'Vui lòng nhập đơn giá và mức phí tối thiểu hợp lệ.'};await draw();return;}await finishMutation(()=>repository.createActivity(activityFlow.proposal,pricing));return;}
    if(event.target.closest?.('[data-save-service-area]')){event.preventDefault();const draft=readProviderServiceArea(root);if(!draft.valid){error='Vui lòng chọn bán kính hợp lệ.';await draw();return;}await finishMutation(async()=>{await repository.setServiceArea(draft.serviceRadiusKm);await repository.markStep('service_area');});return;}
    if(event.target.closest?.('[data-save-availability]')){event.preventDefault();const draft=readProviderAvailabilitySchedule(root);if(!draft.valid){error='Vui lòng chọn lịch hợp lệ.';await draw();return;}await finishMutation(async()=>{await repository.setAvailabilityPreferences(draft);await repository.markStep('availability');});}
  };
  root.addEventListener('input',inputHandler);root.addEventListener('change',changeHandler);root.addEventListener('click',clickHandler);await draw();
  return{stop(){releasePhoto();root.removeEventListener('input',inputHandler);root.removeEventListener('change',changeHandler);root.removeEventListener('click',clickHandler);}};
}
