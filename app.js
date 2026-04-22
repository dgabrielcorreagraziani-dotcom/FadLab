// URL do backend — em produção será a URL do Railway
// Em desenvolvimento local, use http://localhost:3000
const API_URL = (() => {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return 'http://localhost:3000';
  }
  // Substitua pela URL do Railway após o deploy
  return window.FADLAB_API_URL || location.origin;
})();

// Cache local para evitar buscas desnecessárias
const _cache = {};

async function apiGet(key) {
  try {
    const res = await fetch(`${API_URL}/api/${key}`);
    if (!res.ok) throw new Error();
    const data = await res.json();
    _cache[key] = data;
    return data;
  } catch {
    return _cache[key] ?? [];
  }
}

async function apiPut(key, data) {
  _cache[key] = data;
  try {
    await fetch(`${API_URL}/api/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  } catch {
    // Fallback: salva local se servidor cair
    localStorage.setItem('fadlab.' + key, JSON.stringify(data));
  }
}

const STORAGE_KEYS = {
  users: 'fadlab.users',
  session: 'fadlab.session',
  songs: 'fadlab.songs',
  messages: 'fadlab.messages',
  notifications: 'fadlab.notifications',
  scale: 'fadlab.scale'
};

const DEFAULT_TEMP_PASSWORD = 'FadLab@123';
const PASSWORD_POLICY_VERSION = 2;
const ROLE_OPTIONS = ['Usuario', 'Lider', 'Admin'];
const NOTIFICATION_RECIPIENT_ALL = 'all';
const REQUIRED_SEED_USERS = [
  {
    id: 'seed-admin',
    name: 'Administrador FadLab',
    username: 'admin',
    role: 'Admin'
  },
  {
    id: 'seed-admin-teste',
    name: 'Admin Teste',
    username: 'admin.teste',
    role: 'Admin'
  }
];

const THEME_PRESETS = {
  aurora: {
    label: 'Aurora',
    accent: '#57E6FF',
    bgStart: '#071726',
    bgEnd: '#2A0F3F',
    surface: '#102236'
  },
  sunset: {
    label: 'Sunset',
    accent: '#FFB347',
    bgStart: '#341521',
    bgEnd: '#6B2410',
    surface: '#3A1F2A'
  },
  forest: {
    label: 'Forest',
    accent: '#7FF0B8',
    bgStart: '#071A16',
    bgEnd: '#18362C',
    surface: '#123129'
  },
  graphite: {
    label: 'Graphite',
    accent: '#D6E3FF',
    bgStart: '#10131A',
    bgEnd: '#252C3A',
    surface: '#1A2230'
  }
};

const DEFAULT_THEME_KEY = 'aurora';
let currentUser = null;
let currentTab = 'calendar';
let activeChatUserId = null;

document.addEventListener('DOMContentLoaded', async () => {
  renderThemePresetOptions();
  wireEventListeners();
  await initApp();
});

async function initApp() {
  // Carrega todos os dados do servidor antes de iniciar
  await syncFromServer();
  await ensureSeedData();

  const session = loadSession();

  if (session?.userId) {
    const storedUser = getUserById(session.userId);

    if (storedUser) {
      currentUser = withSafeTheme(storedUser);
      if (currentUser.mustChangePassword) {
        enterFirstAccessFlow(
          'Sua conta ainda usa a senha temporaria. Defina uma nova senha para continuar.',
          'info'
        );
      } else {
        setScreen('app');
        renderApp();
        setMessage(
          document.getElementById('themeMessage'),
          'Sessao restaurada com o seu tema salvo.',
          'info'
        );
      }
      return;
    }

    clearSession();
  }

  applyTheme(createTheme());
  setScreen('login');
  showAuthMode('login');
}

function wireEventListeners() {
  document.getElementById('loginModeBtn').addEventListener('click', () => {
    showAuthMode('login');
  });

  document.getElementById('registerModeBtn').addEventListener('click', () => {
    showAuthMode('register');
  });

  document.getElementById('loginForm').addEventListener('submit', handleLogin);
  document.getElementById('registerForm').addEventListener('submit', handleRegister);
  document.getElementById('firstAccessForm').addEventListener('submit', handleFirstAccessPasswordChange);
  document.getElementById('firstAccessLogoutBtn').addEventListener('click', logout);
  document.getElementById('membersList').addEventListener('submit', handleRoleUpdate);
  document.getElementById('membersList').addEventListener('submit', handlePasswordReset);
  document.getElementById('membersList').addEventListener('click', handleUserRemoval);
  document.getElementById('chatContactList').addEventListener('click', handleChatSelection);
  document.getElementById('chatSearch').addEventListener('input', handleChatSearch);
  document.getElementById('songForm').addEventListener('submit', addSong);
  document.getElementById('messageForm').addEventListener('submit', handleSendMessage);
  document.getElementById('notificationForm').addEventListener('submit', handleSendNotification);
  document.getElementById('themeForm').addEventListener('submit', saveThemePreferences);
  document.getElementById('logoutBtn').addEventListener('click', logout);
  document.getElementById('resetTheme').addEventListener('click', resetThemeToPreset);

  document.getElementById('themePreset').addEventListener('change', handleThemePresetChange);

  ['themeAccent', 'themeBgStart', 'themeBgEnd', 'themeSurface'].forEach((fieldId) => {
    document.getElementById(fieldId).addEventListener('input', previewThemeFromForm);
  });

  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => showTab(button.dataset.tab));
  });

  // Enter para enviar mensagem no chat
  document.getElementById('messageText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.getElementById('messageForm').dispatchEvent(new Event('submit'));
    }
  });

  // Lyrics modal
  document.getElementById('lyricsModalClose').addEventListener('click', closeLyricsModal);
  document.getElementById('lyricsModalOverlay').addEventListener('click', closeLyricsModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLyricsModal(); });

  // Escala: adicionar culto
  document.getElementById('scaleAddBtn').addEventListener('click', handleAddCulto);
  wireCalendarNav();
}

async function syncFromServer() {
  try {
    const res = await fetch(`${API_URL}/api`);
    if (!res.ok) return;
    const db = await res.json();
    Object.keys(db).forEach(key => { _cache[key] = db[key]; });
  } catch {
    // Servidor indisponível — usa dados locais
  }
}

async function ensureSeedData() {
  const defaultPasswordHash = await hashPassword(DEFAULT_TEMP_PASSWORD);
  let users = loadUsers();

  if (!users.length) {
    users = [];
  }

  REQUIRED_SEED_USERS.forEach((seedUser) => {
    const seedAlreadyExists = users.some((user) => user.username === seedUser.username);

    if (!seedAlreadyExists) {
      users.push(createSeedUser(seedUser, defaultPasswordHash));
    }
  });

  const normalizedUsers = users.map((user) => {
    return normalizeStoredUser(user, defaultPasswordHash);
  });

  saveUsers(normalizedUsers);

  if (!localStorage.getItem(STORAGE_KEYS.songs)) {
    saveSongs([
      {
        id: 'song-1',
        title: 'Casa de Deus',
        createdBy: 'Administrador FadLab',
        createdAt: new Date().toISOString()
      }
    ]);
  }
}

function createSeedUser(seedUser, defaultPasswordHash) {
  return {
    id: seedUser.id,
    name: seedUser.name,
    username: seedUser.username,
    role: seedUser.role,
    passwordHash: defaultPasswordHash,
    mustChangePassword: true,
    passwordPolicyVersion: PASSWORD_POLICY_VERSION,
    createdAt: new Date().toISOString(),
    theme: createTheme()
  };
}

async function handleLogin(event) {
  event.preventDefault();

  const username = normalizeUsername(document.getElementById('loginUser').value);
  const password = document.getElementById('loginPass').value;
  const authMessage = document.getElementById('authMessage');

  if (!username || !password) {
    setMessage(authMessage, 'Preencha usuario e senha para continuar.', 'error');
    return;
  }

  const user = getUserByUsername(username);

  if (!user) {
    setMessage(authMessage, 'Usuario nao encontrado.', 'error');
    return;
  }

  const passwordHash = await hashPassword(password);

  if (passwordHash !== user.passwordHash) {
    setMessage(authMessage, 'Senha invalida.', 'error');
    return;
  }

  currentUser = withSafeTheme(user);
  saveSession({
    userId: currentUser.id,
    loggedAt: new Date().toISOString()
  });

  document.getElementById('loginForm').reset();

  if (currentUser.mustChangePassword) {
    enterFirstAccessFlow(
      'Primeiro login detectado. Troque a senha temporaria para liberar o acesso.',
      'info'
    );
    return;
  }

  setScreen('app');
  renderApp();
  setMessage(
    document.getElementById('themeMessage'),
    'Login realizado. Seu tema foi carregado automaticamente.',
    'success'
  );
}

async function handleRegister(event) {
  event.preventDefault();

  const name = document.getElementById('registerName').value.trim();
  const username = normalizeUsername(document.getElementById('registerUser').value);
  const authMessage = document.getElementById('authMessage');

  if (!name || !username) {
    setMessage(authMessage, 'Preencha todos os campos para criar a conta.', 'error');
    return;
  }

  if (getUserByUsername(username)) {
    setMessage(authMessage, 'Esse usuario ja existe. Escolha outro.', 'error');
    return;
  }

  const users = loadUsers();
  const newUser = {
    id: `user-${Date.now()}`,
    name,
    username,
    role: 'Usuario',
    passwordHash: await hashPassword(DEFAULT_TEMP_PASSWORD),
    mustChangePassword: true,
    passwordPolicyVersion: PASSWORD_POLICY_VERSION,
    createdAt: new Date().toISOString(),
    theme: createTheme()
  };

  users.push(newUser);
  saveUsers(users);

  document.getElementById('registerForm').reset();
  showAuthMode('login');
  document.getElementById('loginUser').value = username;
  setMessage(
    authMessage,
    `Conta criada. Entre com a senha temporaria ${DEFAULT_TEMP_PASSWORD} e troque no primeiro login.`,
    'success'
  );
}

async function handleFirstAccessPasswordChange(event) {
  event.preventDefault();

  if (!currentUser) {
    return;
  }

  const password = document.getElementById('firstAccessPass').value;
  const confirmPassword = document.getElementById('firstAccessPassConfirm').value;
  const firstAccessMessage = document.getElementById('firstAccessMessage');

  if (!password || !confirmPassword) {
    setMessage(firstAccessMessage, 'Preencha os dois campos para criar a nova senha.', 'error');
    return;
  }

  if (password.length < 6) {
    setMessage(firstAccessMessage, 'A nova senha precisa ter pelo menos 6 caracteres.', 'error');
    return;
  }

  if (password !== confirmPassword) {
    setMessage(firstAccessMessage, 'As senhas nao coincidem.', 'error');
    return;
  }

  if (password.trim() === DEFAULT_TEMP_PASSWORD) {
    setMessage(firstAccessMessage, 'A nova senha nao pode ser igual a senha temporaria padrao.', 'error');
    return;
  }

  const updatedUser = {
    ...currentUser,
    passwordHash: await hashPassword(password),
    mustChangePassword: false,
    passwordPolicyVersion: PASSWORD_POLICY_VERSION,
    passwordChangedAt: new Date().toISOString()
  };

  updateStoredUser(updatedUser);
  currentUser = withSafeTheme(updatedUser);
  saveSession({
    userId: currentUser.id,
    loggedAt: new Date().toISOString()
  });

  document.getElementById('firstAccessForm').reset();
  setScreen('app');
  renderApp();
  setMessage(
    document.getElementById('themeMessage'),
    'Senha atualizada com sucesso. O acesso completo foi liberado.',
    'success'
  );
}

function logout() {
  clearSession();
  currentUser = null;
  currentTab = 'calendar';
  activeChatUserId = null;
  applyTheme(createTheme());
  setScreen('login');
  showAuthMode('login');
  document.getElementById('firstAccessForm').reset();
  document.getElementById('songForm').reset();
  document.getElementById('messageForm').reset();
  document.getElementById('notificationForm').reset();
  setMessage(document.getElementById('authMessage'), 'Sessao encerrada.', 'info');
  setMessage(document.getElementById('firstAccessMessage'), '');
  setMessage(document.getElementById('membersMessage'), '');
  setMessage(document.getElementById('messageFormMessage'), '');
  setMessage(document.getElementById('notificationComposerMessage'), '');
}

function showAuthMode(mode) {
  const isLoginMode = mode === 'login';

  document.getElementById('loginModeBtn').classList.toggle('active', isLoginMode);
  document.getElementById('registerModeBtn').classList.toggle('active', !isLoginMode);
  document.getElementById('loginForm').classList.toggle('active', isLoginMode);
  document.getElementById('registerForm').classList.toggle('active', !isLoginMode);

  if (isLoginMode) {
    document.getElementById('registerForm').reset();
  } else {
    document.getElementById('loginForm').reset();
  }

  setMessage(document.getElementById('authMessage'), '');
}

function setScreen(screenId) {
  ['login', 'passwordSetup', 'app'].forEach((id) => {
    document.getElementById(id).classList.toggle('active', id === screenId);
  });

  if (screenId === 'app' && currentUser) {
    document.getElementById('sessionBadge').textContent = `${currentUser.name} · ${currentUser.role}`;
    return;
  }

  if (screenId === 'passwordSetup' && currentUser) {
    document.getElementById('sessionBadge').textContent = `${currentUser.name} · Primeiro acesso`;
    return;
  }

  document.getElementById('sessionBadge').textContent = '';
}

function showTab(id) {
  currentTab = id;

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.classList.remove('active');
  });

  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === id);
  });

  document.getElementById(id).classList.add('active');
}

function renderApp() {
  if (!currentUser) {
    return;
  }

  currentUser = withSafeTheme(getUserById(currentUser.id) || currentUser);
  document.getElementById('sessionBadge').textContent = `${currentUser.name} · ${currentUser.role}`;

  applyTheme(currentUser.theme);
  renderProfileInfo();
  renderMembers();
  renderScale();
  renderCalendar();
  renderSongs();
  renderMessages();
  renderNotifications();
  fillThemeForm(currentUser.theme);
  updateSongComposerState();
  showTab(currentTab);
}

// Calendar state
let calViewYear = new Date().getFullYear();
let calViewMonth = new Date().getMonth();
let calSelectedDate = null;

function renderCalendar() {
  const welcome = document.getElementById('sessionWelcome');
  if (welcome) welcome.textContent = `Ola, ${currentUser.name} · ${currentUser.role}`;
  buildCalendarGrid();
}

function buildCalendarGrid() {
  const MONTHS = ['Janeiro','Fevereiro','Marco','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const label = document.getElementById('calMonthLabel');
  const grid = document.getElementById('calGrid');
  if (!label || !grid) return;

  label.textContent = `${MONTHS[calViewMonth]} ${calViewYear}`;

  const cultos = loadScale();
  const today = new Date();
  today.setHours(0,0,0,0);

  const firstDay = new Date(calViewYear, calViewMonth, 1).getDay();
  const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();

  grid.innerHTML = '';

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement('div');
    empty.className = 'cal-cell cal-cell--empty';
    grid.append(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${calViewYear}-${String(calViewMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cellDate = new Date(calViewYear, calViewMonth, d);
    const isToday = cellDate.getTime() === today.getTime();
    const isSelected = dateStr === calSelectedDate;

    const cultosOnDay = cultos.filter(c => c.date === dateStr);
    const myResponse = cultosOnDay.length > 0 ? cultosOnDay[0].responses[currentUser?.id] : null;

    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cal-cell' +
      (isToday ? ' cal-cell--today' : '') +
      (isSelected ? ' cal-cell--selected' : '') +
      (cultosOnDay.length > 0 ? ' cal-cell--event' : '');

    const num = document.createElement('span');
    num.className = 'cal-cell-num';
    num.textContent = d;
    cell.append(num);

    if (cultosOnDay.length > 0) {
      const dot = document.createElement('span');
      dot.className = 'cal-dot' +
        (myResponse === 'sim' ? ' cal-dot--confirmed' :
         myResponse === 'nao' ? ' cal-dot--declined' : '');
      cell.append(dot);
    }

    cell.addEventListener('click', () => {
      calSelectedDate = dateStr;
      buildCalendarGrid();
      showCalDayDetail(dateStr, cultosOnDay);
    });

    grid.append(cell);
  }
}

function showCalDayDetail(dateStr, cultos) {
  const detail = document.getElementById('calDayDetail');
  const dayLabel = document.getElementById('calDayLabel');
  const eventsList = document.getElementById('calDayEvents');

  const [y, m, d] = dateStr.split('-');
  dayLabel.textContent = `${d}/${m}/${y}`;
  detail.style.display = 'block';

  if (!cultos.length) {
    eventsList.innerHTML = '<li class="cal-event-empty">Nenhum culto neste dia.</li>';
    return;
  }

  eventsList.innerHTML = '';
  cultos.forEach(culto => {
    const li = document.createElement('li');
    li.className = 'cal-event-item';

    const myResp = culto.responses[currentUser?.id];
    const isMember = culto.members.some(m => m.id === currentUser?.id);

    li.innerHTML = `
      <strong>${culto.description}</strong>
      <span>${culto.members.map(m => m.name).join(', ')}</span>
      ${isMember && !myResp ? '<em class="cal-event-pending">Aguardando sua confirmacao</em>' : ''}
      ${myResp === 'sim' ? '<em class="cal-event-confirmed">✓ Voce confirmou presenca</em>' : ''}
      ${myResp === 'nao' ? '<em class="cal-event-declined">✗ Voce recusou presenca</em>' : ''}
    `;
    eventsList.append(li);
  });
}

function wireCalendarNav() {
  const prev = document.getElementById('calPrevBtn');
  const next = document.getElementById('calNextBtn');
  if (!prev || !next) return;
  prev.addEventListener('click', () => {
    calViewMonth--;
    if (calViewMonth < 0) { calViewMonth = 11; calViewYear--; }
    calSelectedDate = null;
    document.getElementById('calDayDetail').style.display = 'none';
    buildCalendarGrid();
  });
  next.addEventListener('click', () => {
    calViewMonth++;
    if (calViewMonth > 11) { calViewMonth = 0; calViewYear++; }
    calSelectedDate = null;
    document.getElementById('calDayDetail').style.display = 'none';
    buildCalendarGrid();
  });
}

function renderScale() {
  const isAdmin = currentUser?.role === 'Admin';
  const adminPanel = document.getElementById('scaleAdminPanel');
  const roleNote = document.getElementById('scaleRoleNote');

  roleNote.textContent = isAdmin
    ? 'Voce pode adicionar cultos e escalar membros.'
    : 'Visualize os cultos e sua escala.';

  adminPanel.style.display = isAdmin ? 'block' : 'none';

  if (isAdmin) {
    // Populate member checkboxes
    const users = loadUsers().filter(u => u.id !== currentUser.id);
    const container = document.getElementById('scaleMemberCheckboxes');
    container.innerHTML = '';
    users.forEach(u => {
      const label = document.createElement('label');
      label.className = 'scale-checkbox-label';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = u.id;
      cb.dataset.name = u.name;
      label.append(cb, document.createTextNode(' ' + u.name));
      container.append(label);
    });
  }

  renderScaleCalendar();
}

function handleAddCulto() {
  const dateVal = document.getElementById('scaleDate').value;
  const descVal = document.getElementById('scaleDesc').value.trim();
  const msgEl = document.getElementById('scaleAddMessage');

  if (!dateVal) {
    setMessage(msgEl, 'Escolha uma data para o culto.', 'error');
    return;
  }

  const checkboxes = document.querySelectorAll('#scaleMemberCheckboxes input:checked');
  if (checkboxes.length === 0) {
    setMessage(msgEl, 'Selecione ao menos um membro para escalar.', 'error');
    return;
  }

  const members = Array.from(checkboxes).map(cb => ({ id: cb.value, name: cb.dataset.name }));

  const cultos = loadScale();
  const culto = {
    id: 'culto-' + Date.now(),
    date: dateVal,
    description: descVal || 'Culto',
    members,
    responses: {},
    createdAt: new Date().toISOString()
  };
  cultos.push(culto);
  cultos.sort((a, b) => a.date.localeCompare(b.date));
  saveScale(cultos);

  // Notify each member
  const notifications = loadNotifications();
  const dateFormatted = formatScaleDate(dateVal);
  members.forEach(member => {
    notifications.unshift({
      id: 'scale-notif-' + Date.now() + '-' + member.id,
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderRole: currentUser.role,
      targetType: 'user',
      recipientId: member.id,
      recipientName: member.name,
      title: 'Voce foi escalado!',
      body: 'Voce foi escalado para o culto do dia ' + dateFormatted + '. Voce vai estar presente?',
      isScaleNotif: true,
      cultoId: culto.id,
      cultoDate: dateVal,
      createdAt: new Date().toISOString()
    });
  });
  saveNotifications(notifications);

  // Reset form
  document.getElementById('scaleDate').value = '';
  document.getElementById('scaleDesc').value = '';
  document.querySelectorAll('#scaleMemberCheckboxes input').forEach(cb => cb.checked = false);

  setMessage(msgEl, 'Culto adicionado e membros notificados!', 'success');
  renderScaleCalendar();
}

function renderScaleCalendar() {
  const container = document.getElementById('scaleCalendar');
  const cultos = loadScale();

  if (!cultos.length) {
    container.innerHTML = '<p class="scale-empty">Nenhum culto agendado ainda.</p>';
    return;
  }

  const isAdmin = currentUser?.role === 'Admin';

  container.innerHTML = '';
  cultos.forEach(culto => {
    const card = document.createElement('div');
    card.className = 'scale-card';

    const dateStr = formatScaleDate(culto.date);
    const myEntry = culto.members.find(m => m.id === currentUser.id);
    const myResponse = culto.responses[currentUser.id];

    const header = document.createElement('div');
    header.className = 'scale-card-header';

    const dateEl = document.createElement('strong');
    dateEl.className = 'scale-card-date';
    dateEl.textContent = dateStr;

    const descEl = document.createElement('span');
    descEl.className = 'scale-card-desc';
    descEl.textContent = culto.description;

    header.append(dateEl, descEl);

    // Members list
    const membersList = document.createElement('div');
    membersList.className = 'scale-members-list';
    culto.members.forEach(m => {
      const resp = culto.responses[m.id];
      const chip = document.createElement('span');
      chip.className = 'scale-member-chip' + (resp === 'sim' ? ' confirmed' : resp === 'nao' ? ' declined' : '');
      chip.textContent = m.name + (resp === 'sim' ? ' ✓' : resp === 'nao' ? ' ✗' : '');
      membersList.append(chip);
    });

    card.append(header, membersList);

    // Response buttons for current user if escalado
    if (myEntry && !myResponse) {
      const respSection = document.createElement('div');
      respSection.className = 'scale-response';
      const prompt = document.createElement('p');
      prompt.textContent = 'Voce vai estar presente?';
      const btnSim = document.createElement('button');
      btnSim.type = 'button';
      btnSim.className = 'scale-btn-sim';
      btnSim.textContent = 'Sim';
      btnSim.addEventListener('click', () => respondCulto(culto.id, 'sim'));
      const btnNao = document.createElement('button');
      btnNao.type = 'button';
      btnNao.className = 'scale-btn-nao secondary';
      btnNao.textContent = 'Nao';
      btnNao.addEventListener('click', () => respondCulto(culto.id, 'nao'));
      respSection.append(prompt, btnSim, btnNao);
      card.append(respSection);
    } else if (myEntry && myResponse) {
      const confirmed = document.createElement('p');
      confirmed.className = 'scale-response-confirmed';
      confirmed.textContent = myResponse === 'sim' ? '✓ Voce confirmou presenca' : '✗ Voce recusou presenca';
      card.append(confirmed);
    }

    // Admin delete
    if (isAdmin) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'secondary danger-button scale-del-btn';
      delBtn.textContent = 'Remover culto';
      delBtn.addEventListener('click', () => {
        const cultos2 = loadScale().filter(c => c.id !== culto.id);
        saveScale(cultos2);
        renderScaleCalendar();
      });
      card.append(delBtn);
    }

    container.append(card);
  });
}

function respondCulto(cultoId, response) {
  const cultos = loadScale();
  const culto = cultos.find(c => c.id === cultoId);
  if (!culto) return;
  culto.responses[currentUser.id] = response;
  saveScale(cultos);
  renderScaleCalendar();
  buildCalendarGrid();
}

function formatScaleDate(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return d + '/' + m + '/' + y;
}

function loadScale() {
  return readJson(STORAGE_KEYS.scale, []);
}

function saveScale(cultos) {
  localStorage.setItem(STORAGE_KEYS.scale, JSON.stringify(cultos));
}

function renderMembers() {
  const membersList = document.getElementById('membersList');
  const membersAdminNote = document.getElementById('membersAdminNote');
  const roleOrder = {
    Admin: 0,
    Lider: 1,
    Usuario: 2
  };
  const isAdmin = currentUser?.role === 'Admin';

  const users = loadUsers()
    .map(withSafeTheme)
    .sort((a, b) => {
      const roleDifference = (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3);
      return roleDifference || a.name.localeCompare(b.name, 'pt-BR');
    });

  membersAdminNote.textContent = isAdmin
    ? 'Voce pode administrar a funcao, redefinir a senha e remover usuarios nesta lista.'
    : 'Todos os perfis cadastrados neste navegador aparecem aqui. A funcao e administrada por um admin.';

  const items = users.map((user) => {
    const item = document.createElement('li');

    if (currentUser && currentUser.id === user.id) {
      item.classList.add('is-current');
    }

    const title = document.createElement('strong');
    title.textContent = user.name;

    const subtitle = document.createElement('span');
    subtitle.textContent = `@${user.username}`;

    const description = document.createElement('p');
    description.textContent = `Funcao: ${user.role}`;

    item.append(title, subtitle, description);

    if (isAdmin) {
      item.append(createMemberAdminTools(user));
    }

    return item;
  });

  membersList.replaceChildren(...items);
}

function renderSongs() {
  const songList = document.getElementById('songList');
  const songs = loadSongs().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const canEdit = canManageSongs();

  if (!songs.length) {
    const emptyItem = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = 'Nenhuma musica cadastrada';
    const description = document.createElement('p');
    description.textContent = 'Adicione a primeira musica para montar o repertorio do mes.';
    emptyItem.append(title, description);
    songList.replaceChildren(emptyItem);
  } else {
    const items = songs.map((song) => {
      const item = document.createElement('li');
      item.className = 'song-item';

      const info = document.createElement('div');
      info.className = 'song-info';

      const title = document.createElement('strong');
      title.textContent = song.title;

      const subtitle = document.createElement('span');
      subtitle.textContent = `Adicionada por ${song.createdBy} · ${formatDate(song.createdAt)}`;

      info.append(title, subtitle);

      const actions = document.createElement('div');
      actions.className = 'song-actions';

      // Lyrics button (everyone can view, only editors can edit)
      const lyricsBtn = document.createElement('button');
      lyricsBtn.type = 'button';
      lyricsBtn.className = 'song-lyrics-btn';
      lyricsBtn.innerHTML = song.lyrics
        ? '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M4 4h12v2H4zm0 4h12v2H4zm0 4h7v2H4z"/></svg> Ver letra'
        : '<svg viewBox="0 0 20 20" fill="currentColor"><path d="M4 4h12v2H4zm0 4h12v2H4zm0 4h7v2H4z"/></svg> Letra';
      lyricsBtn.addEventListener('click', () => openLyricsModal(song));
      actions.append(lyricsBtn);

      if (canEdit) {
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'song-remove-btn secondary danger-button';
        removeBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/></svg> Remover';
        removeBtn.addEventListener('click', () => removeSong(song.id));
        actions.append(removeBtn);
      }

      item.append(info, actions);
      return item;
    });

    songList.replaceChildren(...items);
  }

  document.getElementById('songPermission').textContent = canEdit
    ? 'Seu cargo pode adicionar e remover musicas.'
    : 'Seu cargo pode consultar o repertorio e as letras.';
}

function removeSong(songId) {
  const songs = loadSongs().filter(s => s.id !== songId);
  saveSongs(songs);
  renderSongs();
  setMessage(document.getElementById('songsMessage'), 'Musica removida.', 'success');
}

function openLyricsModal(song) {
  const canEdit = canManageSongs();
  const modal = document.getElementById('lyricsModal');
  const modalTitle = document.getElementById('lyricsModalTitle');
  const lyricsTextarea = document.getElementById('lyricsTextarea');
  const saveBtn = document.getElementById('lyricsSaveBtn');
  const lyricsReadonly = document.getElementById('lyricsReadonly');

  modalTitle.textContent = song.title;

  if (canEdit) {
    lyricsTextarea.value = song.lyrics || '';
    lyricsTextarea.style.display = 'block';
    lyricsReadonly.style.display = 'none';
    saveBtn.style.display = 'inline-flex';
    saveBtn.onclick = () => saveLyrics(song.id);
  } else {
    lyricsTextarea.style.display = 'none';
    saveBtn.style.display = 'none';
    lyricsReadonly.style.display = 'block';
    lyricsReadonly.textContent = song.lyrics || 'Nenhuma letra cadastrada para esta musica.';
  }

  modal.classList.add('active');
  document.getElementById('lyricsModalOverlay').classList.add('active');
  document.getElementById('lyricsModalSongId').value = song.id;
}

function saveLyrics(songId) {
  const lyrics = document.getElementById('lyricsTextarea').value.trim();
  const songs = loadSongs();
  const song = songs.find(s => s.id === songId);
  if (song) {
    song.lyrics = lyrics;
    saveSongs(songs);
    setMessage(document.getElementById('songsMessage'), 'Letra salva!', 'success');
    renderSongs();
  }
  closeLyricsModal();
}

function closeLyricsModal() {
  document.getElementById('lyricsModal').classList.remove('active');
  document.getElementById('lyricsModalOverlay').classList.remove('active');
}

function updateSongComposerState() {
  const canEdit = canManageSongs();
  const songInput = document.getElementById('songInput');
  const songButton = document.querySelector('#songForm button[type="submit"]');

  songInput.disabled = !canEdit;
  songButton.disabled = !canEdit;
}

function renderProfileInfo() {
  const profileInfo = document.getElementById('profileInfo');

  const cards = [
    createInfoCard('Nome', currentUser.name, `Usuario @${currentUser.username}`),
    createInfoCard('Funcao', currentUser.role, 'Essas permissoes controlam o que o perfil pode editar e sao definidas por um admin.'),
    createInfoCard('Conta criada', formatDate(currentUser.createdAt), 'O tema salvo abaixo pertence somente a esta conta.'),
    createInfoCard('Senha', formatPasswordStatus(currentUser), 'A senha temporaria padrao so vale no primeiro login.')
  ];

  profileInfo.replaceChildren(...cards);
}

function createMemberAdminTools(user) {
  const wrapper = document.createElement('div');
  wrapper.className = 'member-admin-tools';

  const form = document.createElement('form');
  form.className = 'member-role-form';
  form.dataset.userId = user.id;

  const label = document.createElement('label');
  label.className = 'member-role-label';
  label.textContent = 'Administrar funcao';

  const select = document.createElement('select');
  select.name = 'role';

  ROLE_OPTIONS.forEach((role) => {
    const option = document.createElement('option');
    option.value = role;
    option.textContent = role;
    option.selected = user.role === role;
    select.append(option);
  });

  const button = document.createElement('button');
  button.type = 'submit';
  button.className = 'secondary compact-button';
  button.textContent = 'Salvar funcao';

  label.append(select);
  form.append(label, button);

  const passwordForm = document.createElement('form');
  passwordForm.className = 'member-password-form';
  passwordForm.dataset.userId = user.id;

  const passwordLabel = document.createElement('label');
  passwordLabel.className = 'member-role-label';
  passwordLabel.textContent = 'Redefinir senha';

  const passwordInput = document.createElement('input');
  passwordInput.name = 'tempPassword';
  passwordInput.type = 'password';
  passwordInput.minLength = 6;
  passwordInput.placeholder = 'Nova senha temporaria';

  const passwordButton = document.createElement('button');
  passwordButton.type = 'submit';
  passwordButton.className = 'secondary compact-button';
  passwordButton.textContent = 'Salvar senha';

  const passwordNote = document.createElement('p');
  passwordNote.className = 'member-password-note';
  passwordNote.textContent = 'A senha definida aqui vira temporaria e exigira troca no proximo login.';

  passwordLabel.append(passwordInput);
  passwordForm.append(passwordLabel, passwordButton, passwordNote);

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'secondary compact-button danger-button';
  removeButton.dataset.action = 'remove-user';
  removeButton.dataset.userId = user.id;
  removeButton.textContent = currentUser?.id === user.id ? 'Conta atual' : 'Remover usuario';
  removeButton.disabled = currentUser?.id === user.id;

  wrapper.append(form, passwordForm, removeButton);
  return wrapper;
}

function handleRoleUpdate(event) {
  const form = event.target;

  if (!form.classList.contains('member-role-form')) {
    return;
  }

  event.preventDefault();

  const membersMessage = document.getElementById('membersMessage');

  if (!currentUser || currentUser.role !== 'Admin') {
    setMessage(membersMessage, 'Apenas administradores podem alterar a funcao de um usuario.', 'error');
    return;
  }

  const userId = form.dataset.userId;
  const nextRole = form.elements.role.value;
  const targetUser = getUserById(userId);

  if (!targetUser) {
    setMessage(membersMessage, 'Usuario nao encontrado para atualizacao.', 'error');
    return;
  }

  if (targetUser.role === nextRole) {
    setMessage(membersMessage, 'Nenhuma alteracao de funcao foi feita.', 'info');
    return;
  }

  if (targetUser.role === 'Admin' && nextRole !== 'Admin' && countUsersByRole('Admin') === 1) {
    setMessage(membersMessage, 'O ultimo admin do sistema nao pode perder a funcao.', 'error');
    return;
  }

  const updatedUser = {
    ...targetUser,
    role: nextRole
  };

  updateStoredUser(updatedUser);

  if (currentUser.id === updatedUser.id) {
    currentUser = withSafeTheme(updatedUser);
  }

  renderApp();
  setMessage(
    membersMessage,
    `Funcao de ${updatedUser.name} atualizada para ${nextRole}.`,
    'success'
  );
}

async function handlePasswordReset(event) {
  const form = event.target;

  if (!form.classList.contains('member-password-form')) {
    return;
  }

  event.preventDefault();

  const membersMessage = document.getElementById('membersMessage');

  if (!currentUser || currentUser.role !== 'Admin') {
    setMessage(membersMessage, 'Apenas administradores podem redefinir a senha de um usuario.', 'error');
    return;
  }

  const userId = form.dataset.userId;
  const targetUser = getUserById(userId);
  const nextPassword = form.elements.tempPassword.value.trim();

  if (!targetUser) {
    setMessage(membersMessage, 'Usuario nao encontrado para redefinicao de senha.', 'error');
    return;
  }

  if (!nextPassword) {
    setMessage(membersMessage, 'Digite uma nova senha temporaria para continuar.', 'error');
    return;
  }

  if (nextPassword.length < 6) {
    setMessage(membersMessage, 'A senha temporaria precisa ter pelo menos 6 caracteres.', 'error');
    return;
  }

  const updatedUser = {
    ...targetUser,
    passwordHash: await hashPassword(nextPassword),
    mustChangePassword: true,
    passwordPolicyVersion: PASSWORD_POLICY_VERSION,
    passwordChangedAt: null
  };

  updateStoredUser(updatedUser);

  if (currentUser.id === updatedUser.id) {
    currentUser = withSafeTheme(updatedUser);
  }

  form.reset();
  renderApp();
  setMessage(
    membersMessage,
    `Senha de ${updatedUser.name} redefinida. No proximo login essa pessoa sera obrigada a trocar a senha.`,
    'success'
  );
}

function handleUserRemoval(event) {
  const removeButton = event.target.closest('[data-action="remove-user"]');

  if (!removeButton) {
    return;
  }

  const membersMessage = document.getElementById('membersMessage');

  if (!currentUser || currentUser.role !== 'Admin') {
    setMessage(membersMessage, 'Apenas administradores podem remover usuarios.', 'error');
    return;
  }

  const userId = removeButton.dataset.userId;
  const targetUser = getUserById(userId);

  if (!targetUser) {
    setMessage(membersMessage, 'Usuario nao encontrado para remocao.', 'error');
    return;
  }

  if (targetUser.id === currentUser.id) {
    setMessage(membersMessage, 'Voce nao pode remover a propria conta por aqui.', 'error');
    return;
  }

  if (targetUser.role === 'Admin' && countUsersByRole('Admin') === 1) {
    setMessage(membersMessage, 'O ultimo admin do sistema nao pode ser removido.', 'error');
    return;
  }

  if (!window.confirm(`Deseja remover o usuario ${targetUser.name}? Essa acao apaga mensagens e avisos ligados a essa conta.`)) {
    setMessage(membersMessage, 'Remocao cancelada.', 'info');
    return;
  }

  removeStoredUser(targetUser.id);
  renderApp();
  setMessage(
    membersMessage,
    `Usuario ${targetUser.name} removido com sucesso.`,
    'success'
  );
}

function renderMessages() {
  const chatContactList = document.getElementById('chatContactList');
  const chatThread = document.getElementById('chatThread');
  const chatRecipientName = document.getElementById('chatRecipientName');
  const chatRecipientMeta = document.getElementById('chatRecipientMeta');
  const chatSearch = document.getElementById('chatSearch');
  const messageInput = document.getElementById('messageText');
  const sendButton = document.querySelector('#messageForm button[type="submit"]');
  let allMessages = loadMessages();
  const users = loadUsers()
    .filter((user) => user.id !== currentUser.id)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  let messages = allMessages.filter((message) => {
    return message.senderId === currentUser.id || message.recipientId === currentUser.id;
  });
  const searchTerm = normalizeSearchValue(chatSearch.value);

  if (!users.length) {
    activeChatUserId = null;
    chatContactList.replaceChildren(
      createChatEmptyState(
        'Nenhum destinatario disponivel',
        'Crie ou mantenha outro usuario no sistema para iniciar uma conversa.'
      )
    );
    chatThread.replaceChildren(
      createChatEmptyState(
        'Nenhum chat disponivel',
        'Assim que existir outro usuario no sistema, voce podera iniciar uma conversa aqui.'
      )
    );
    chatRecipientName.textContent = 'Nenhuma conversa selecionada';
    chatRecipientMeta.textContent = 'Escolha um contato para abrir o historico de mensagens.';
    messageInput.disabled = true;
    sendButton.disabled = true;
    messageInput.placeholder = 'Crie outro usuario para iniciar uma conversa';
    return;
  }

  let conversationSummaries = buildConversationSummaries(users, messages);
  let visibleConversationSummaries = filterConversationSummaries(conversationSummaries, searchTerm);

  if (searchTerm) {
    activeChatUserId = resolveActiveChatUserId(visibleConversationSummaries);
  } else if (!activeChatUserId || !users.some((user) => user.id === activeChatUserId)) {
    activeChatUserId = conversationSummaries[0]?.user.id || users[0].id;
  }

  allMessages = markConversationAsRead(allMessages, activeChatUserId);
  messages = allMessages.filter((message) => {
    return message.senderId === currentUser.id || message.recipientId === currentUser.id;
  });
  conversationSummaries = buildConversationSummaries(users, messages);
  visibleConversationSummaries = filterConversationSummaries(conversationSummaries, searchTerm);

  if (searchTerm && !visibleConversationSummaries.some((summary) => summary.user.id === activeChatUserId)) {
    activeChatUserId = resolveActiveChatUserId(visibleConversationSummaries);
    allMessages = markConversationAsRead(allMessages, activeChatUserId);
    messages = allMessages.filter((message) => {
      return message.senderId === currentUser.id || message.recipientId === currentUser.id;
    });
    conversationSummaries = buildConversationSummaries(users, messages);
    visibleConversationSummaries = filterConversationSummaries(conversationSummaries, searchTerm);
  }

  if (!visibleConversationSummaries.length) {
    chatContactList.replaceChildren(
      createChatEmptyState(
        'Nenhuma conversa encontrada',
        'Tente buscar por outro nome, usuario ou trecho de mensagem.'
      )
    );
    chatThread.replaceChildren(
      createChatEmptyState(
        'Nenhum resultado na busca',
        'Limpe a busca para voltar a ver todas as conversas do chat.'
      )
    );
    chatRecipientName.textContent = 'Nenhum resultado';
    chatRecipientMeta.textContent = 'A busca atual nao encontrou conversas para exibir.';
    messageInput.disabled = true;
    sendButton.disabled = true;
    messageInput.placeholder = 'Escolha uma conversa encontrada para enviar';
    return;
  }

  const activeUser = users.find((user) => user.id === activeChatUserId) || null;
  const contactButtons = visibleConversationSummaries.map((summary) => createChatContactItem(summary));
  chatContactList.replaceChildren(...contactButtons);

  if (!activeUser) {
    chatThread.replaceChildren(
      createChatEmptyState(
        'Nenhuma conversa selecionada',
        'Escolha um contato para abrir ou iniciar um chat.'
      )
    );
    chatRecipientName.textContent = 'Nenhuma conversa selecionada';
    chatRecipientMeta.textContent = 'Escolha um contato para abrir o historico de mensagens.';
    messageInput.disabled = true;
    sendButton.disabled = true;
    messageInput.placeholder = 'Escolha um contato para enviar mensagens';
    return;
  }

  const conversationMessages = messages
    .filter((message) => isMessageBetweenUsers(message, currentUser.id, activeUser.id))
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

  chatRecipientName.textContent = activeUser.name;
  chatRecipientMeta.textContent = `@${activeUser.username} · ${activeUser.role}`;
  const avatarEl = document.getElementById('chatAvatar');
  if (avatarEl) avatarEl.textContent = activeUser.name.charAt(0);
  messageInput.disabled = false;
  sendButton.disabled = false;
  messageInput.placeholder = `Escreva uma mensagem para ${activeUser.name}`;

  if (!conversationMessages.length) {
    chatThread.replaceChildren(
      createChatEmptyState(
        'Conversa vazia',
        `Envie a primeira mensagem para ${activeUser.name} e comece o chat.`
      )
    );
    return;
  }

  const items = conversationMessages.map((message) => createChatBubble(message));
  chatThread.replaceChildren(...items);
  chatThread.scrollTop = chatThread.scrollHeight;
}

function renderNotifications() {
  const notificationPermission = document.getElementById('notificationPermission');
  const notificationComposerCard = document.getElementById('notificationComposerCard');
  const notificationRecipient = document.getElementById('notificationRecipient');
  const notificationList = document.getElementById('notificationList');
  const canSend = canSendNotifications();
  const otherUsers = loadUsers()
    .filter((user) => user.id !== currentUser.id)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const visibleNotifications = loadNotifications()
    .filter((notification) => {
      return notification.senderId === currentUser.id
        || notification.targetType === NOTIFICATION_RECIPIENT_ALL
        || notification.recipientId === currentUser.id;
    })
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  notificationPermission.textContent = canSend
    ? 'Seu perfil pode enviar avisos para todos os usuarios ou para um destinatario especifico.'
    : 'Voce pode consultar os avisos recebidos. O envio e liberado apenas para Admin e Lider.';

  notificationComposerCard.hidden = !canSend;

  if (canSend) {
    const allOption = document.createElement('option');
    allOption.value = NOTIFICATION_RECIPIENT_ALL;
    allOption.textContent = 'Todos os usuarios';

    const options = otherUsers.map((user) => {
      const option = document.createElement('option');
      option.value = user.id;
      option.textContent = `${user.name} · @${user.username}`;
      return option;
    });

    notificationRecipient.replaceChildren(allOption, ...options);
    document.getElementById('notificationText').disabled = false;
    document.getElementById('notificationTitle').disabled = false;
    document.querySelector('#notificationForm button[type="submit"]').disabled = false;
  }

  if (!visibleNotifications.length) {
    notificationList.replaceChildren(
      createFeedEmptyItem(
        'Nenhum aviso disponivel',
        canSend
          ? 'Envie o primeiro aviso para comecar a comunicacao oficial do time.'
          : 'Quando um admin ou lider enviar um aviso, ele aparecera aqui.'
      )
    );
    return;
  }

  const items = visibleNotifications.map((notification) => createNotificationItem(notification));
  notificationList.replaceChildren(...items);
}

function handleSendMessage(event) {
  event.preventDefault();

  if (!currentUser) {
    return;
  }

  const messageFormMessage = document.getElementById('messageFormMessage');
  const text = document.getElementById('messageText').value.trim();
  const recipient = getUserById(activeChatUserId);

  if (!recipient) {
    setMessage(messageFormMessage, 'Escolha um contato na lista para enviar a mensagem.', 'error');
    return;
  }

  if (!text) {
    setMessage(messageFormMessage, 'Digite uma mensagem antes de enviar.', 'error');
    return;
  }

  const messages = loadMessages();
  messages.unshift({
    id: `msg-${Date.now()}`,
    senderId: currentUser.id,
    senderName: currentUser.name,
    recipientId: recipient.id,
    recipientName: recipient.name,
    body: text,
    readAt: null,
    createdAt: new Date().toISOString()
  });

  saveMessages(messages);
  document.getElementById('messageForm').reset();
  renderMessages();
  setMessage(
    messageFormMessage,
    `Mensagem enviada para ${recipient.name}.`,
    'success'
  );
}

function handleSendNotification(event) {
  event.preventDefault();

  if (!currentUser || !canSendNotifications()) {
    setMessage(
      document.getElementById('notificationComposerMessage'),
      'Seu perfil nao pode enviar avisos.',
      'error'
    );
    return;
  }

  const notificationComposerMessage = document.getElementById('notificationComposerMessage');
  const recipientId = document.getElementById('notificationRecipient').value;
  const title = document.getElementById('notificationTitle').value.trim();
  const text = document.getElementById('notificationText').value.trim();

  if (!title || !text) {
    setMessage(notificationComposerMessage, 'Preencha titulo e mensagem do aviso.', 'error');
    return;
  }

  const targetUser = recipientId === NOTIFICATION_RECIPIENT_ALL ? null : getUserById(recipientId);

  if (recipientId !== NOTIFICATION_RECIPIENT_ALL && !targetUser) {
    setMessage(notificationComposerMessage, 'Escolha um destinatario valido para o aviso.', 'error');
    return;
  }

  const notifications = loadNotifications();
  notifications.unshift({
    id: `alert-${Date.now()}`,
    senderId: currentUser.id,
    senderName: currentUser.name,
    senderRole: currentUser.role,
    targetType: recipientId === NOTIFICATION_RECIPIENT_ALL ? NOTIFICATION_RECIPIENT_ALL : 'user',
    recipientId: targetUser?.id || null,
    recipientName: targetUser?.name || 'Todos os usuarios',
    title,
    body: text,
    createdAt: new Date().toISOString()
  });

  saveNotifications(notifications);
  document.getElementById('notificationForm').reset();
  renderNotifications();
  setMessage(
    notificationComposerMessage,
    recipientId === NOTIFICATION_RECIPIENT_ALL
      ? 'Aviso enviado para todos os usuarios.'
      : `Aviso enviado para ${targetUser.name}.`,
    'success'
  );
}

function handleChatSelection(event) {
  const chatButton = event.target.closest('[data-chat-user-id]');

  if (!chatButton) {
    return;
  }

  activeChatUserId = chatButton.dataset.chatUserId;
  renderMessages();
}

function handleChatSearch() {
  renderMessages();
}

function createChatContactItem(summary) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'chat-contact-item';
  button.dataset.chatUserId = summary.user.id;
  button.classList.toggle('active', summary.user.id === activeChatUserId);

  // Avatar
  const avatar = document.createElement('div');
  avatar.className = 'chat-contact-avatar';
  avatar.textContent = summary.user.name.charAt(0);

  // Body
  const body = document.createElement('div');
  body.className = 'chat-contact-body';

  const topRow = document.createElement('div');
  topRow.className = 'chat-contact-top';

  const name = document.createElement('strong');
  name.textContent = summary.user.name;

  const timeEl = document.createElement('span');
  timeEl.className = 'chat-contact-time';
  timeEl.textContent = summary.lastMessage ? formatDate(summary.lastMessage.createdAt) : '';

  topRow.append(name, timeEl);

  const bottomRow = document.createElement('div');
  bottomRow.style.display = 'flex';
  bottomRow.style.alignItems = 'center';
  bottomRow.style.justifyContent = 'space-between';
  bottomRow.style.gap = '8px';

  const preview = document.createElement('p');
  preview.textContent = summary.lastMessage
    ? truncateText(summary.lastMessage.body, 50)
    : 'Nenhuma mensagem ainda.';

  bottomRow.append(preview);

  if (summary.unreadCount > 0) {
    const unreadBadge = document.createElement('span');
    unreadBadge.className = 'chat-unread-badge';
    unreadBadge.textContent = String(summary.unreadCount);
    bottomRow.append(unreadBadge);
  }

  body.append(topRow, bottomRow);
  button.append(avatar, body);
  return button;
}

function createChatBubble(message) {
  const article = document.createElement('article');
  article.className = `chat-bubble ${message.senderId === currentUser.id ? 'is-mine' : 'is-theirs'}`;

  const body = document.createElement('p');
  body.className = 'chat-bubble-body';
  body.textContent = message.body;

  const meta = document.createElement('span');
  meta.className = 'chat-bubble-meta';
  // Format: hour:minute
  const d = new Date(message.createdAt);
  meta.textContent = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  article.append(body, meta);
  return article;
}

function createChatEmptyState(titleText, descriptionText) {
  const emptyState = document.createElement('article');
  emptyState.className = 'chat-empty-state';

  const title = document.createElement('strong');
  title.textContent = titleText;

  const description = document.createElement('p');
  description.textContent = descriptionText;

  emptyState.append(title, description);
  return emptyState;
}

function isMessageBetweenUsers(message, firstUserId, secondUserId) {
  return (
    (message.senderId === firstUserId && message.recipientId === secondUserId)
    || (message.senderId === secondUserId && message.recipientId === firstUserId)
  );
}

function buildConversationSummaries(users, messages) {
  return users.map((user) => {
    const conversationMessages = messages
      .filter((message) => isMessageBetweenUsers(message, currentUser.id, user.id))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    return {
      user,
      lastMessage: conversationMessages[0] || null,
      totalMessages: conversationMessages.length,
      unreadCount: conversationMessages.filter((message) => {
        return message.senderId === user.id && message.recipientId === currentUser.id && !message.readAt;
      }).length
    };
  }).sort((a, b) => {
    if (a.lastMessage && b.lastMessage) {
      return new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt);
    }

    if (a.lastMessage) {
      return -1;
    }

    if (b.lastMessage) {
      return 1;
    }

    return a.user.name.localeCompare(b.user.name, 'pt-BR');
  });
}

function filterConversationSummaries(summaries, searchTerm) {
  if (!searchTerm) {
    return summaries;
  }

  return summaries.filter((summary) => {
    const haystack = normalizeSearchValue(
      `${summary.user.name} ${summary.user.username} ${summary.user.role} ${summary.lastMessage?.body || ''}`
    );

    return haystack.includes(searchTerm);
  });
}

function resolveActiveChatUserId(visibleConversationSummaries) {
  if (visibleConversationSummaries.some((summary) => summary.user.id === activeChatUserId)) {
    return activeChatUserId;
  }

  return visibleConversationSummaries[0]?.user.id || null;
}

function markConversationAsRead(messages, chatUserId) {
  if (!chatUserId) {
    return messages;
  }

  let didChange = false;

  const updatedMessages = messages.map((message) => {
    if (message.senderId === chatUserId && message.recipientId === currentUser.id && !message.readAt) {
      didChange = true;
      return {
        ...message,
        readAt: new Date().toISOString()
      };
    }

    return message;
  });

  if (didChange) {
    saveMessages(updatedMessages);
  }

  return updatedMessages;
}

function createNotificationItem(notification) {
  const item = document.createElement('li');
  item.className = `feed-item ${notification.senderId === currentUser.id ? 'is-outgoing' : 'is-notification'}`;

  const label = document.createElement('span');
  label.className = 'feed-tag';
  label.textContent = buildNotificationAudienceLabel(notification);

  const title = document.createElement('strong');
  title.textContent = notification.title;

  const description = document.createElement('p');
  description.textContent = notification.body;

  const meta = document.createElement('span');
  meta.className = 'feed-meta';
  meta.textContent = `${notification.senderName} · ${notification.senderRole} · ${formatDate(notification.createdAt)}`;

  item.append(label, title, description, meta);

  // Scale response buttons inside notification
  if (notification.isScaleNotif && notification.recipientId === currentUser.id && notification.cultoId) {
    const cultos = loadScale();
    const culto = cultos.find(c => c.id === notification.cultoId);
    const myResponse = culto?.responses[currentUser.id];

    if (culto && !myResponse) {
      const respRow = document.createElement('div');
      respRow.className = 'notif-scale-response';
      const btnSim = document.createElement('button');
      btnSim.type = 'button';
      btnSim.className = 'scale-btn-sim';
      btnSim.textContent = 'Sim';
      btnSim.addEventListener('click', () => { respondCulto(notification.cultoId, 'sim'); renderNotifications(); });
      const btnNao = document.createElement('button');
      btnNao.type = 'button';
      btnNao.className = 'scale-btn-nao secondary';
      btnNao.textContent = 'Nao';
      btnNao.addEventListener('click', () => { respondCulto(notification.cultoId, 'nao'); renderNotifications(); });
      respRow.append(btnSim, btnNao);
      item.append(respRow);
    } else if (myResponse) {
      const confirmed = document.createElement('p');
      confirmed.className = 'scale-response-confirmed';
      confirmed.textContent = myResponse === 'sim' ? '✓ Presenca confirmada' : '✗ Presenca recusada';
      item.append(confirmed);
    }
  }

  return item;
}

function createFeedEmptyItem(titleText, descriptionText) {
  const item = document.createElement('li');
  item.className = 'feed-item is-empty-feed';

  const title = document.createElement('strong');
  title.textContent = titleText;

  const description = document.createElement('p');
  description.textContent = descriptionText;

  item.append(title, description);
  return item;
}

function summarizeInbox() {
  const totalMessages = loadMessages().filter((message) => {
    return message.recipientId === currentUser.id && !message.readAt;
  }).length;
  const totalNotifications = loadNotifications().filter((notification) => {
    return notification.targetType === NOTIFICATION_RECIPIENT_ALL || notification.recipientId === currentUser.id;
  }).length;

  return `Voce tem ${totalMessages} mensagem(ns) nao lida(s) e ${totalNotifications} aviso(s) disponiveis.`;
}

function buildNotificationAudienceLabel(notification) {
  if (notification.senderId === currentUser.id) {
    return notification.targetType === NOTIFICATION_RECIPIENT_ALL
      ? 'Aviso enviado para todos'
      : `Aviso enviado para ${notification.recipientName}`;
  }

  return notification.targetType === NOTIFICATION_RECIPIENT_ALL
    ? `Aviso geral de ${notification.senderName}`
    : `Aviso de ${notification.senderName} para voce`;
}

function createInfoCard(label, value, description) {
  const card = document.createElement('article');
  card.className = 'info-card';

  const cardLabel = document.createElement('span');
  cardLabel.className = 'card-label';
  cardLabel.textContent = label;

  const cardValue = document.createElement('strong');
  cardValue.textContent = value;

  const cardDescription = document.createElement('p');
  cardDescription.textContent = description;

  card.append(cardLabel, cardValue, cardDescription);
  return card;
}

function addSong(event) {
  event.preventDefault();

  if (!currentUser || !canManageSongs()) {
    setMessage(
      document.getElementById('songsMessage'),
      'Seu perfil nao tem permissao para adicionar musicas.',
      'error'
    );
    return;
  }

  const input = document.getElementById('songInput');
  const title = input.value.trim();

  if (!title) {
    setMessage(document.getElementById('songsMessage'), 'Digite o nome da musica.', 'error');
    return;
  }

  const songs = loadSongs();
  songs.unshift({
    id: `song-${Date.now()}`,
    title,
    createdBy: currentUser.name,
    createdAt: new Date().toISOString()
  });

  saveSongs(songs);
  renderSongs();
  input.value = '';
  setMessage(document.getElementById('songsMessage'), 'Musica adicionada com sucesso.', 'success');
}

function saveThemePreferences(event) {
  event.preventDefault();

  if (!currentUser) {
    return;
  }

  const nextTheme = sanitizeTheme(readThemeFormValues());
  const updatedUser = {
    ...currentUser,
    theme: nextTheme
  };

  updateStoredUser(updatedUser);
  currentUser = withSafeTheme(updatedUser);
  applyTheme(currentUser.theme);
  setScreen('app');
  setMessage(
    document.getElementById('themeMessage'),
    'Tema salvo para este usuario. Ele sera restaurado no proximo login.',
    'success'
  );
}

function handleThemePresetChange() {
  const theme = createTheme(document.getElementById('themePreset').value);
  fillThemeForm(theme);
  applyTheme(theme);
  setMessage(
    document.getElementById('themeMessage'),
    'Preset aplicado em pre-visualizacao. Salve para vincular ao seu perfil.',
    'info'
  );
}

function resetThemeToPreset() {
  const presetKey = document.getElementById('themePreset').value || DEFAULT_THEME_KEY;
  const theme = createTheme(presetKey);
  fillThemeForm(theme);
  applyTheme(theme);
  setMessage(
    document.getElementById('themeMessage'),
    'Cores do preset reaplicadas. Clique em salvar para persistir.',
    'info'
  );
}

function previewThemeFromForm() {
  if (!currentUser) {
    return;
  }

  applyTheme(readThemeFormValues());
}

function readThemeFormValues() {
  return {
    preset: document.getElementById('themePreset').value,
    accent: document.getElementById('themeAccent').value,
    bgStart: document.getElementById('themeBgStart').value,
    bgEnd: document.getElementById('themeBgEnd').value,
    surface: document.getElementById('themeSurface').value
  };
}

function fillThemeForm(theme) {
  const safeTheme = sanitizeTheme(theme);
  document.getElementById('themePreset').value = safeTheme.preset;
  document.getElementById('themeAccent').value = safeTheme.accent;
  document.getElementById('themeBgStart').value = safeTheme.bgStart;
  document.getElementById('themeBgEnd').value = safeTheme.bgEnd;
  document.getElementById('themeSurface').value = safeTheme.surface;
}

function renderThemePresetOptions() {
  const themePreset = document.getElementById('themePreset');
  const options = Object.entries(THEME_PRESETS).map(([key, preset]) => {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = preset.label;
    return option;
  });

  themePreset.replaceChildren(...options);
  themePreset.value = DEFAULT_THEME_KEY;
}

function createTheme(presetKey = DEFAULT_THEME_KEY, overrides = {}) {
  const preset = THEME_PRESETS[presetKey] || THEME_PRESETS[DEFAULT_THEME_KEY];

  return {
    preset: presetKey,
    accent: preset.accent,
    bgStart: preset.bgStart,
    bgEnd: preset.bgEnd,
    surface: preset.surface,
    ...overrides
  };
}

function sanitizeTheme(theme) {
  const preset = theme?.preset && THEME_PRESETS[theme.preset] ? theme.preset : DEFAULT_THEME_KEY;
  const baseTheme = createTheme(preset);

  return {
    preset,
    accent: normalizeHex(theme?.accent, baseTheme.accent),
    bgStart: normalizeHex(theme?.bgStart, baseTheme.bgStart),
    bgEnd: normalizeHex(theme?.bgEnd, baseTheme.bgEnd),
    surface: normalizeHex(theme?.surface, baseTheme.surface)
  };
}

function withSafeTheme(user) {
  return {
    ...user,
    theme: sanitizeTheme(user.theme)
  };
}

function applyTheme(theme) {
  const safeTheme = sanitizeTheme(theme);
  const root = document.documentElement;

  root.style.setProperty('--accent', safeTheme.accent);
  root.style.setProperty('--accent-rgb', hexToRgbString(safeTheme.accent));
  root.style.setProperty('--bg-start', safeTheme.bgStart);
  root.style.setProperty('--bg-end', safeTheme.bgEnd);
  root.style.setProperty('--surface-rgb', hexToRgbString(safeTheme.surface));
  root.style.setProperty('--button-text', isLightColor(safeTheme.accent) ? '#08131B' : '#F5FBFF');
}

function canManageSongs() {
  return currentUser && (currentUser.role === 'Admin' || currentUser.role === 'Lider');
}

function canSendNotifications() {
  return currentUser && (currentUser.role === 'Admin' || currentUser.role === 'Lider');
}

function countUsersByRole(role) {
  return loadUsers().filter((user) => user.role === role).length;
}

function enterFirstAccessFlow(message, tone = 'info') {
  if (!currentUser) {
    return;
  }

  applyTheme(currentUser.theme);
  populateFirstAccessScreen();
  setScreen('passwordSetup');
  document.getElementById('firstAccessForm').reset();
  setMessage(document.getElementById('firstAccessMessage'), message, tone);
}

function populateFirstAccessScreen() {
  if (!currentUser) {
    return;
  }

  document.getElementById('firstAccessUser').textContent =
    `${currentUser.name} · @${currentUser.username}`;
}

function normalizeStoredUser(user, defaultPasswordHash) {
  if ((user.passwordPolicyVersion || 0) < PASSWORD_POLICY_VERSION) {
    return {
      ...user,
      passwordHash: defaultPasswordHash,
      mustChangePassword: true,
      passwordPolicyVersion: PASSWORD_POLICY_VERSION,
      passwordChangedAt: null,
      theme: sanitizeTheme(user.theme)
    };
  }

  return {
    ...user,
    mustChangePassword: Boolean(user.mustChangePassword),
    passwordPolicyVersion: user.passwordPolicyVersion || PASSWORD_POLICY_VERSION,
    passwordChangedAt: user.passwordChangedAt || null,
    theme: sanitizeTheme(user.theme)
  };
}

function updateStoredUser(updatedUser) {
  const users = loadUsers().map((user) => {
    return user.id === updatedUser.id ? updatedUser : user;
  });

  saveUsers(users);
}

function removeStoredUser(userId) {
  const remainingUsers = loadUsers().filter((user) => user.id !== userId);
  const remainingMessages = loadMessages().filter((message) => {
    return message.senderId !== userId && message.recipientId !== userId;
  });
  const remainingNotifications = loadNotifications().filter((notification) => {
    return notification.senderId !== userId && notification.recipientId !== userId;
  });

  saveUsers(remainingUsers);
  saveMessages(remainingMessages);
  saveNotifications(remainingNotifications);
}

function getUserById(id) {
  return loadUsers().find((user) => user.id === id) || null;
}

function getUserByUsername(username) {
  return loadUsers().find((user) => user.username === username) || null;
}

// ── Dados na nuvem (com fallback local) ──────────────────────

function loadUsers() {
  return _cache['users'] ?? readJsonLocal('fadlab.users', []);
}

function saveUsers(users) {
  apiPut('users', users);
}

function loadSongs() {
  return _cache['songs'] ?? readJsonLocal('fadlab.songs', []);
}

function saveSongs(songs) {
  apiPut('songs', songs);
}

function loadMessages() {
  const raw = _cache['messages'] ?? readJsonLocal('fadlab.messages', []);
  return raw.map(normalizeStoredMessage);
}

function saveMessages(messages) {
  apiPut('messages', messages);
}

function loadNotifications() {
  return _cache['notifications'] ?? readJsonLocal('fadlab.notifications', []);
}

function saveNotifications(notifications) {
  apiPut('notifications', notifications);
}

function loadScale() {
  return _cache['scale'] ?? readJsonLocal('fadlab.scale', []);
}

function saveScale(scale) {
  apiPut('scale', scale);
}

// Sessão ainda fica local (é por dispositivo mesmo)
function loadSession() {
  return readJsonLocal('fadlab.session', null);
}

function saveSession(session) {
  localStorage.setItem('fadlab.session', JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem('fadlab.session');
}

function readJsonLocal(key, fallbackValue) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function readJson(key, fallbackValue) {
  return readJsonLocal(key, fallbackValue);
}

function normalizeUsername(value) {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeSearchValue(value) {
  return value.trim().toLowerCase();
}

function truncateText(value, maxLength) {
  return value.length > maxLength
    ? `${value.slice(0, maxLength - 1).trimEnd()}...`
    : value;
}

function normalizeStoredMessage(message) {
  return {
    ...message,
    readAt: Object.prototype.hasOwnProperty.call(message, 'readAt')
      ? message.readAt
      : message.createdAt
  };
}

function formatPasswordStatus(user) {
  return user.passwordChangedAt ? formatDate(user.passwordChangedAt) : 'Troca pendente';
}

function normalizeHex(value, fallback) {
  return /^#([0-9a-f]{6})$/i.test(value || '') ? value.toUpperCase() : fallback;
}

function hexToRgbString(hex) {
  const normalizedHex = normalizeHex(hex, '#000000').slice(1);
  const red = parseInt(normalizedHex.slice(0, 2), 16);
  const green = parseInt(normalizedHex.slice(2, 4), 16);
  const blue = parseInt(normalizedHex.slice(4, 6), 16);
  return `${red}, ${green}, ${blue}`;
}

function isLightColor(hex) {
  const normalizedHex = normalizeHex(hex, '#000000').slice(1);
  const red = parseInt(normalizedHex.slice(0, 2), 16);
  const green = parseInt(normalizedHex.slice(2, 4), 16);
  const blue = parseInt(normalizedHex.slice(4, 6), 16);
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;

  return luminance > 0.64;
}

async function hashPassword(value) {
  const normalizedValue = value.trim();

  if (window.crypto?.subtle) {
    const data = new TextEncoder().encode(normalizedValue);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  return btoa(unescape(encodeURIComponent(normalizedValue)));
}

function formatDate(value) {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

function setMessage(element, message, tone = 'neutral') {
  element.textContent = message;

  if (message) {
    element.dataset.tone = tone;
  } else {
    delete element.dataset.tone;
  }
}
