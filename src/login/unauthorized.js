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

function getDashboardPath(roles) {
  const mainRole = rolePriority.find((role) => roles.includes(role));
  return dashboardByRole[mainRole] || '/src/login/index.html';
}

async function getCurrentUser() {
  const response = await fetch('/api/auth/me', {
    credentials: 'include',
  });

  if (!response.ok) {
    window.location.replace('/src/login/index.html');
    return null;
  }

  const data = await response.json();
  return data.user;
}

document.querySelector('#backToDashboard').addEventListener('click', async () => {
  const user = await getCurrentUser();

  if (user) {
    window.location.replace(getDashboardPath(user.roles));
  }
});

document.querySelector('#logoutButton').addEventListener('click', async () => {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
  });

  window.location.replace('/src/login/index.html');
});