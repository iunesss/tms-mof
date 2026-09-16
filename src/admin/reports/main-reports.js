import { protectPage } from '../../shared/auth-guard.js';
import { logout } from '../manage-courses/course-api.js';

document.querySelector('#logoutButton').addEventListener('click', logout);

async function initialize() {
  await protectPage(['SUPER_ADMIN']);
}

initialize();