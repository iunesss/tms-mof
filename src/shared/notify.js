/** رسالة موحّدة وغير حاجبة للتفاعل، تدعم النجاح والخطأ وتُقرأ بقارئات الشاشة. */
export function notify(message, type = 'error') {
  let region = document.querySelector('#appNotifications');
  if (!region) {
    region = document.createElement('div');
    region.id = 'appNotifications';
    region.className = 'fixed bottom-4 left-4 z-[100] flex max-w-sm flex-col gap-2';
    region.setAttribute('aria-live', 'polite');
    document.body.append(region);
  }

  const item = document.createElement('div');
  item.className = type === 'success'
    ? 'rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-lg'
    : 'rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 shadow-lg';
  item.setAttribute('role', type === 'success' ? 'status' : 'alert');
  item.textContent = message || 'تعذر إتمام العملية. حاول مرة أخرى.';
  region.append(item);
  window.setTimeout(() => item.remove(), 6000);
}
