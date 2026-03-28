// CYX俱乐部 - 认证模块
const API_BASE = window.location.hostname === 'localhost'
  ? 'http://localhost:8787/api'
  : 'https://cyxclub-api.3604596288.workers.dev/api';

/**
 * 通用 API 请求封装
 */
async function apiFetch(path, options = {}) {
  const defaults = {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  };
  const merged = { ...defaults, ...options };
  if (options.headers) {
    merged.headers = { ...defaults.headers, ...options.headers };
  }
  try {
    const res = await fetch(API_BASE + path, merged);
    if (res.status === 401) {
      sessionStorage.removeItem('cyx_user');
      return { ok: false, status: 401, data: { error: '未登录' } };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: '网络错误: ' + e.message } };
  }
}

/**
 * 检查当前登录状态，返回用户信息或 null
 */
async function checkAuth() {
  const cached = sessionStorage.getItem('cyx_user');
  if (cached) {
    try { return JSON.parse(cached); } catch(e) {}
  }
  const res = await apiFetch('/auth/me');
  if (res.ok && res.data.user) {
    sessionStorage.setItem('cyx_user', JSON.stringify(res.data.user));
    return res.data.user;
  }
  return null;
}

/**
 * 登出
 */
async function logout() {
  await apiFetch('/auth/logout', { method: 'POST' });
  sessionStorage.removeItem('cyx_user');
  window.location.href = 'login.html';
}

/**
 * 更新导航栏登录/用户中心链接
 */
function updateNavbar() {
  const user = (() => {
    try { return JSON.parse(sessionStorage.getItem('cyx_user')); } catch(e) { return null; }
  })();

  // 查找登录链接
  const loginLink = document.querySelector('.nav-link-login');
  const userLink = document.querySelector('.nav-link-user');
  const empLink = document.querySelector('.nav-link-employee');

  if (user) {
    if (loginLink) loginLink.style.display = 'none';
    if (userLink) {
      userLink.style.display = '';
      if (user.role === 'employee') {
        userLink.href = 'employee-dashboard.html';
        userLink.textContent = '员工中心';
      } else if (user.role === 'admin') {
        userLink.href = '/admin';
        userLink.textContent = '管理后台';
      } else {
        userLink.href = 'dashboard.html';
        userLink.textContent = '用户中心';
      }
    }
    if (empLink) empLink.style.display = user.role === 'employee' ? '' : 'none';
  } else {
    if (loginLink) loginLink.style.display = '';
    if (userLink) userLink.style.display = 'none';
    if (empLink) empLink.style.display = 'none';
  }
}

/**
 * 显示/隐藏加载状态
 */
function setLoading(btn, loading) {
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.dataset.origText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 处理中...';
  } else {
    btn.disabled = false;
    btn.innerHTML = btn.dataset.origText || btn.innerHTML;
  }
}

/**
 * 显示表单错误
 */
function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
  el.style.animation = 'fadeInUp 0.3s ease';
}

function hideError(el) {
  if (!el) return;
  el.style.display = 'none';
}

// 页面加载后更新导航
document.addEventListener('DOMContentLoaded', () => {
  updateNavbar();
});
