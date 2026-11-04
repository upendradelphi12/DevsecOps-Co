const loginPage = document.getElementById('loginPage');
const registerPage = document.getElementById('registerPage');
const dashboardPage = document.getElementById('dashboardPage');
const loginBtn = document.getElementById('loginBtn');
const registerBtn = document.getElementById('registerBtn');
const showRegisterBtn = document.getElementById('showRegisterBtn');
const showLoginBtn = document.getElementById('showLoginBtn');
const resetPasswordBtn = document.getElementById('resetPasswordBtn');
const refreshBtn = document.getElementById('refreshBtn');
const profileName = document.getElementById('profileName');
const profileEmail = document.getElementById('profileEmail');
const toast = document.getElementById('toast');
const navButtons = document.querySelectorAll('.nav-item');

const state = {
  currentUser: null,
  demoData: {
    pipelines: [
      { name: 'Build pipeline', status: 'Succeeded', time: '4 min ago', type: 'success' },
      { name: 'Release pipeline', status: 'At risk', time: '15 min ago', type: 'warning' },
      { name: 'Integration pipeline', status: 'Failed', time: '22 min ago', type: 'error' }
    ],
    aksPods: [
      { name: 'web-app', status: 'Running (4/4)' },
      { name: 'api-service', status: 'Running (2/2)' },
      { name: 'db-migrator', status: 'Pending' }
    ],
    containerApps: [
      { name: 'auth-app', status: 'Healthy' },
      { name: 'order-processor', status: 'Degraded' },
      { name: 'report-worker', status: 'Healthy' }
    ]
  }
};

function showPage(page) {
  loginPage.classList.remove('active');
  registerPage.classList.remove('active');
  dashboardPage.classList.remove('active');
  page.classList.add('active');
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  window.setTimeout(() => toast.classList.remove('show'), 2800);
}

function getUsers() {
  try {
    const users = JSON.parse(localStorage.getItem('devopsUsers') || '[]');
    return Array.isArray(users) ? users : [];
  } catch (error) {
    return [];
  }
}

function saveUsers(users) {
  localStorage.setItem('devopsUsers', JSON.stringify(users));
}

function validateBusinessEmail(email) {
  const lower = email.toLowerCase();
  const personalDomains = ['gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com', 'live.com'];
  return lower.includes('@') && !personalDomains.some(domain => lower.endsWith(domain));
}

function resetPassword(email) {
  const users = getUsers();
  const existing = users.find((user) => user.email.toLowerCase() === email.toLowerCase());
  if (!existing) {
    return false;
  }
  const newPassword = prompt('Enter your new password:');
  if (!newPassword || newPassword.length < 6) {
    showToast('Password reset cancelled or too short.');
    return false;
  }
  existing.password = newPassword;
  saveUsers(users);
  showToast('Password updated successfully.');
  return true;
}

function getInitials(firstName, lastName) {
  return `${firstName?.trim()?.charAt(0) || ''}${lastName?.trim()?.charAt(0) || ''}`.toUpperCase();
}

function updateProfilePanel(user) {
  profileName.textContent = `${user.firstName} ${user.lastName}`;
  profileEmail.textContent = user.email;
  const avatar = document.querySelector('.user-avatar');
  avatar.textContent = getInitials(user.firstName, user.lastName);
}

function buildDashboard() {
  const pipelineCards = document.querySelectorAll('.pipeline-card');
  state.demoData.pipelines.forEach((item, index) => {
    const card = pipelineCards[index];
    if (!card) return;
    card.querySelector('h3').textContent = item.name;
    card.querySelector('p strong').textContent = item.status;
    card.querySelector('p + p').textContent = `Last run: ${item.time}`;
    card.className = `pipeline-card pipeline-card--${item.type}`;
  });
}

function setActiveNav(item) {
  navButtons.forEach((button) => button.classList.remove('active'));
  item.classList.add('active');
}

function initNav() {
  navButtons.forEach((button) => {
    button.addEventListener('click', () => setActiveNav(button));
  });
}

showRegisterBtn.addEventListener('click', () => showPage(registerPage));
showLoginBtn.addEventListener('click', () => showPage(loginPage));

loginBtn.addEventListener('click', () => {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) {
    showToast('Please enter email and password.');
    return;
  }

  const users = getUsers();
  const user = users.find((stored) => stored.email.toLowerCase() === email.toLowerCase());
  if (!user || user.password !== password) {
    showToast('Invalid login credentials.');
    return;
  }

  state.currentUser = user;
  updateProfilePanel(user);
  buildDashboard();
  showPage(dashboardPage);
  showToast(`Welcome back, ${user.firstName}!`);
});

registerBtn.addEventListener('click', () => {
  const firstName = document.getElementById('firstName').value.trim();
  const lastName = document.getElementById('lastName').value.trim();
  const phone = document.getElementById('phone').value.trim();
  const email = document.getElementById('registerEmail').value.trim();
  const password = document.getElementById('registerPassword').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (!firstName || !lastName || !phone || !email || !password || !confirmPassword) {
    showToast('Complete all fields to register.');
    return;
  }

  if (password !== confirmPassword) {
    showToast('Password and confirm password must match.');
    return;
  }

  if (password.length < 6) {
    showToast('Password must contain at least 6 characters.');
    return;
  }

  if (!validateBusinessEmail(email)) {
    showToast('Please use a valid business email address.');
    return;
  }

  const users = getUsers();
  const exists = users.some((stored) => stored.email.toLowerCase() === email.toLowerCase());
  if (exists) {
    showToast('An account with this email already exists.');
    return;
  }

  const newUser = { firstName, lastName, phone, email, password };
  users.push(newUser);
  saveUsers(users);
  showToast('Registration complete. Please login.');
  setTimeout(() => {
    showPage(loginPage);
  }, 800);
});

resetPasswordBtn.addEventListener('click', () => {
  const email = document.getElementById('loginEmail').value.trim();
  if (!email) {
    showToast('Please enter your email address first.');
    return;
  }
  if (!resetPassword(email)) {
    showToast('No account found for that email.');
  }
});

refreshBtn.addEventListener('click', () => {
  showToast('Pipeline and pod status refreshed.');
});

initNav();
showPage(loginPage);
