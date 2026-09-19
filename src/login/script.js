const loginForm = document.querySelector('#loginForm');
const usernameInput = document.querySelector('#username');
const passwordInput = document.querySelector('#password');
const rememberMeInput = document.querySelector('#rememberMe');
const togglePasswordButton = document.querySelector('#togglePassword');
const formMessage = document.querySelector('#formMessage');
const submitButton = document.querySelector('#submitButton');
const buttonText = document.querySelector('#buttonText');
const buttonLoader = document.querySelector('#buttonLoader');

const dashboardByRole = {
  SUPER_ADMIN: '/src/admin/dashboard.html',
  COURSE_MANAGER: '/src/course-manager/dashboard.html',
  AGENT: '/src/agent/dashboard.html',
  DEPARTMENT_MANAGER: '/src/manager/dashboard.html',
  EMPLOYEE: '/src/employee/dashboard.html',
};

const rolePriority = [
  'SUPER_ADMIN',
  'COURSE_MANAGER',
  'AGENT',
  'DEPARTMENT_MANAGER',
  'EMPLOYEE',
];

function showMessage(message, type = 'error') {
  const styles = {
    error: 'border-red-200 bg-red-50 text-red-700',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  };

  formMessage.textContent = message;
  formMessage.className = `rounded-lg border px-4 py-3 text-sm ${styles[type]}`;
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  buttonText.textContent = isLoading ? 'جارٍ تسجيل الدخول...' : 'تسجيل الدخول';
  buttonLoader.classList.toggle('hidden', !isLoading);
}

function getDashboardPath(roles) {
  const mainRole = rolePriority.find((role) => roles.includes(role));
  return dashboardByRole[mainRole] || '/src/employee/dashboard.html';
}

togglePasswordButton.addEventListener('click', () => {
  const isHidden = passwordInput.type === 'password';

  passwordInput.type = isHidden ? 'text' : 'password';
  togglePasswordButton.textContent = isHidden ? 'إخفاء' : 'إظهار';
  togglePasswordButton.setAttribute(
    'aria-label',
    isHidden ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'
  );
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  formMessage.classList.add('hidden');

  if (!username || !password) {
    showMessage('يرجى إدخال اسم المستخدم وكلمة المرور.');
    return;
  }

  try {
    setLoading(true);

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        username,
        password,
        rememberMe: rememberMeInput.checked,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      showMessage(data.message || 'تعذر تسجيل الدخول. تحقق من البيانات.');
      return;
    }

    const roles = data.user?.roles || [];

    if (!roles.length) {
      showMessage('الحساب لا يملك دورًا صالحًا داخل النظام.');
      return;
    }

    showMessage('تم تسجيل الدخول بنجاح. جارٍ تحويلك...', 'success');

    window.setTimeout(() => {
   window.location.href = getDashboardPath(roles);
    }, 400);
  } catch (error) {
    console.error('Login error:', error);
    showMessage('تعذر الاتصال بالخادم. حاول مرة أخرى.');
  } finally {
    setLoading(false);
  }
});

// عند الرجوع إلى صفحة الدخول من ذاكرة المتصفح نمسح الحقول الحساسة والرسالة القديمة.
window.addEventListener('pageshow', function (event) {
    // التحقق مما إذا كانت الصفحة قد تم استرجاعها من ذاكرة المتصفح المؤقتة (عند الضغط على زر الرجوع)
    if (event.persisted || (performance.getEntriesByType("navigation")[0]?.type === "back_forward")) {
        // تفريغ حقول الفورم تماماً
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.reset();
        }
        
        // إخفاء أي رسائل خطأ سابقة إن وجدت
        const formMessage = document.getElementById('formMessage');
        if (formMessage) {
            formMessage.classList.add('hidden');
            formMessage.textContent = '';
        }
    }
});
