const loginPage = '/src/login/index.html';
const unauthorizedPage = '/src/login/unauthorized.html';
// الروابط يتعامل معها المتصفح مباشرة؛ لا نعترض pointerdown كي لا يحدث انتقال مزدوج.

let isLeavingPage = false;

window.addEventListener('pagehide', () => {
  isLeavingPage = true;
});

function redirectTo(url) {
  if (!isLeavingPage && window.location.pathname !== url) {
    window.location.replace(url);
  }
}

export async function protectPage(allowedRoles = []) {
  const controller = new AbortController();
  let timedOut = false;

  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 10000);

  try {
    const response = await fetch('/api/auth/me', {
      credentials: 'include',
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    });

    if (response.status === 401) {
      redirectTo(loginPage);
      return null;
    }

    if (!response.ok) {
      redirectTo(unauthorizedPage);
      return null;
    }

    const data = await response.json();
    const user = data.user;
    const userRoles = user?.roles || [];

    const isAllowed =
      allowedRoles.length === 0 ||
      allowedRoles.some((role) => userRoles.includes(role));

    if (!isAllowed) {
      redirectTo(unauthorizedPage);
      return null;
    }

    return user;
  } catch (error) {
    /*
      عند التنقل السريع، المتصفح يلغي طلب الصفحة القديمة.
      هذا طبيعي، ولا يجب تحويل المستخدم لصفحة الدخول.
    */
    if (isLeavingPage) {
      return null;
    }

    if (error.name === 'AbortError' && !timedOut) {
      return null;
    }

    console.error('Authentication check failed:', error);

    redirectTo(loginPage);
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
