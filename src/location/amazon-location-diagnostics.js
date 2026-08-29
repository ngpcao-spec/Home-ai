const SAFE_CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/;

export function amazonLocationFailure(error, fallbackCode = 'UnknownError') {
  const status = Number(error?.status ?? error?.response?.status ?? error?.error?.status);
  const candidate = error?.awsErrorCode ?? error?.code ?? error?.name;
  return {
    status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    awsErrorCode: typeof candidate === 'string' && SAFE_CODE.test(candidate) ? candidate : fallbackCode,
  };
}

export function logAmazonLocationDiagnostic(component, success, details = {}) {
  const payload = {
    component,
    success,
    region: 'ap-southeast-1',
    status: details.status ?? null,
    awsErrorCode: details.awsErrorCode ?? null,
  };
  (success ? console.info : console.error)('[HOME AI][Amazon Location]', payload);
}
