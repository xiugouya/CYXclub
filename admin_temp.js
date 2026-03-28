
        const STATUS_MAP = {
            pending: '待处理', in_progress: '进行中',
            completed: '已完成', cancelled: '已取消'
        };
        const SERVICE_MAP = { 1: '日卡', 2: '周卡', 3: '月卡' };

        (async () => {
            const user = await checkAuth();
            if (!user) { window.location.href = 'admin-login.html'; return; }
            if (user.role !== 'admin') {
                window.location.href = user.role === 'employee' ? 'employee-dashboard.html' : 'dashboard.html';
                return;
            }
            loadStats();
            loadUsers();

            document.querySelectorAll('.tab-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
                    btn.classList.add('active');
                    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
                    if (btn.dataset.tab === 'orders') { loadAllOrders(); loadOrderForm(); }
                    if (btn.dataset.tab === 'employees') loadEmployees();
                    if (btn.dataset.tab === 'announcements') loadAnnouncements();
                });
            });

            const hamburger = document.querySelector('.hamburger');
            const navLinks = document.querySelector('.nav-links');
            if (hamburger) {
                hamburger.addEventListener('click', () => {
                    navLinks.classList.toggle('active');
                    hamburger.classList.toggle('active');
                });
            }
        })();

        function showToast(msg, isError = false) {
            const toast = document.getElementById('toast');
            toast.innerHTML = `<i class="fas fa-${isError ? 'exclamation-circle' : 'check-circle'}"></i> ${msg}`;
            toast.className = 'toast visible' + (isError ? ' error' : '');
            setTimeout(() => toast.classList.remove('visible'), 3000);
        }

        async function loadStats() {
            const res = await apiFetch('/admin/stats');
            if (res.ok) {
                const s = res.data;
                document.getElementById('statVisits').textContent = s.visits ?? '—';
                document.getElementById('statWorkers').textContent = s.workers ?? '—';
                document.getElementById('statOrders').textContent = s.orders?.total ?? '—';
                document.getElementById('statPending').textContent = s.orders?.pending ?? '—';
            }
        }

        // === 用户管理 ===
        async function addUser() {
            const username = document.getElementById('newUsername').value.trim();
            const password = document.getElementById('newUserPwd').value.trim();
            if (!username || !password) { showToast('请填写用户名和密码', true); return; }
            const res = await apiFetch('/admin/users', {
                method: 'POST',
                body: JSON.stringify({ username, password })
            });
            if (res.ok) {
                showToast('用户添加成功');
                document.getElementById('newUsername').value = '';
                document.getElementById('newUserPwd').value = '';
                loadUsers();
            } else { showToast(res.data.data?.error || res.data.error || res.data?.error || '添加失败', true); }
        }

        async function loadUsers() {
            const wrap = document.getElementById('usersTableWrap');
            wrap.innerHTML = '<div class="loading-msg"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';
            const res = await apiFetch('/admin/users');
            if (!res.ok) { wrap.innerHTML = '<div class="empty-msg">加载失败</div>'; return; }
            const users = res.data.data || [];
            if (users.length === 0) { wrap.innerHTML = '<div class="empty-msg">暂无用户</div>'; return; }
            wrap.innerHTML = `<table class="data-table">
                <thead><tr><th>ID</th><th>用户名</th><th>创建时间</th><th>操作</th></tr></thead>
                <tbody>${users.map(u => `<tr>
                    <td>${u.id}</td>
                    <td>${u.username}</td>
                    <td>${u.created_at ? new Date(u.created_at * 1000).toLocaleString('zh-CN') : '—'}</td>
                    <td><button class="btn-action btn-red" onclick="deleteUser(${u.id})">删除</button></td>
                </tr>`).join('')}</tbody></table>`;
            
            // Also populate order user dropdown
            const sel = document.getElementById('orderUser');
            sel.innerHTML = '<option value="">请选择用户</option>';
            users.forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = u.username + ' (#' + u.id + ')';
                sel.appendChild(opt);
            });
        }

        // === 订单管理 ===
        async function loadOrderForm() {
            // Load users
            const uRes = await apiFetch('/admin/users');
            const uSel = document.getElementById('orderUser');
            uSel.innerHTML = '<option value="">请选择用户</option>';
            if (uRes.ok) (uRes.data.data||[]).forEach(u => {
                const opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = u.username + ' (#' + u.id + ')';
                uSel.appendChild(opt);
            });
        }

        async function generateOrder() {
            const userId = document.getElementById('orderUser').value;
            const product = document.getElementById('orderProduct').value;
            const password = document.getElementById('orderPwd').value.trim();
            if (!userId) { showToast('请选择用户', true); return; }
            if (!password) { showToast('请填写密码', true); return; }

            const gameMap = {GEN:'通用',YSNB:'原神',XQTD:'崩铁',JQLX:'绝区零',ZMDX:'终末地',SJZX:'三角洲',WZRY:'王者荣耀',WWQY:'无畏契约'};
            const body = {
                game: gameMap[product] || '通用',
                service_type: 1,
                password,
                product_code: product,
                user_id: parseInt(userId)
            };

            const res = await apiFetch('/admin/orders', {
                method: 'POST',
                body: JSON.stringify(body)
            });

            if (res.ok) {
                const data = res.data;
                document.getElementById('resultOrderNo').textContent = data.order_no;
                document.getElementById('resultOrderPwd').textContent = password;
                document.getElementById('orderResult').style.display = 'block';
                document.getElementById('orderPwd').value = '';
                showToast('订单号生成成功');
                loadAllOrders();
                loadStats();
            } else {
                showToast(res.data.data?.error || res.data.error || res.data?.error || '生成失败', true);
            }
        }

        async function loadAllOrders() {
            const wrap = document.getElementById('ordersTableWrap');
            wrap.innerHTML = '<div class="loading-msg"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';
            const res = await apiFetch('/admin/orders');
            if (!res.ok) { wrap.innerHTML = '<div class="empty-msg">加载失败</div>'; return; }
            const orders = res.data.data || [];
            if (orders.length === 0) { wrap.innerHTML = '<div class="empty-msg">暂无订单</div>'; return; }
            wrap.innerHTML = `<table class="data-table">
                <thead><tr><th>订单号</th><th>用户</th><th>游戏</th><th>状态</th><th>打手</th><th>创建时间</th></tr></thead>
                <tbody>${orders.map(o => `<tr>
                    <td class="mono" style="color:var(--primary-color)">${o.order_no}</td>
                    <td>${o.user_id || '—'}</td>
                    <td>${o.game}</td>
                    <td><span class="status-badge status-${o.status}">${STATUS_MAP[o.status] || o.status}</span></td>
                    <td>${o.worker_name || '—'}</td>
                    <td><button class="btn-action btn-green" onclick="editOrderStatus('','')">改状态</button> <button class="btn-action btn-red" onclick="deleteOrder('')">删除</button></td>
                    <td>${o.created_at ? new Date(o.created_at * 1000).toLocaleString('zh-CN') : '—'}</td>
                </tr>`).join('')}</tbody></table>`;
        }

        // === 员工管理 ===
        async function createEmployee() {
            const name = document.getElementById('empUsername').value.trim();
            const password = document.getElementById('empPassword').value;
            if (!name || !password) { showToast('请填写员工名称和密码', true); return; }
            const res = await apiFetch('/admin/workers', {
                method: 'POST',
                body: JSON.stringify({ name, password })
            });
            if (res.ok) {
                showToast('员工创建成功');
                document.getElementById('empUsername').value = '';
                document.getElementById('empPassword').value = '';
                loadEmployees();
                loadStats();
            } else { showToast(res.data.error || '创建失败', true); }
        }

        async function loadEmployees() {
            const wrap = document.getElementById('empTableWrap');
            wrap.innerHTML = '<div class="loading-msg"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';
            const res = await apiFetch('/admin/workers');
            if (!res.ok) { wrap.innerHTML = '<div class="empty-msg">加载失败</div>'; return; }
            const emps = res.data.data || [];
            if (emps.length === 0) { wrap.innerHTML = '<div class="empty-msg">暂无员工</div>'; return; }
            wrap.innerHTML = `<table class="data-table">
                <thead><tr><th>ID</th><th>名称</th><th>游戏</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
                <tbody>${emps.map(e => `<tr>
                    <td>${e.id}</td>
                    <td>${e.name}</td>
                    <td>${e.games || '—'}</td>
                    <td>${e.status}</td>
                    <td>${e.created_at ? new Date(e.created_at * 1000).toLocaleString('zh-CN') : '—'}</td>
                </tr>`).join('')}</tbody></table>`;
        }

        // === 公告管理 ===
        async function createAnnouncement() {
            const title = document.getElementById('annTitle').value.trim();
            const content = document.getElementById('annContent').value.trim();
            if (!title || !content) { showToast('请填写标题和内容', true); return; }
            const res = await apiFetch('/admin/announcements', {
                method: 'POST',
                body: JSON.stringify({ title, content, is_pinned: true })
            });
            if (res.ok) {
                showToast('公告发布成功');
                document.getElementById('annTitle').value = '';
                document.getElementById('annContent').value = '';
                loadAnnouncements();
            } else { showToast(res.data.error || '发布失败', true); }
        }

        async function loadAnnouncements() {
            const wrap = document.getElementById('annTableWrap');
            wrap.innerHTML = '<div class="loading-msg"><i class="fas fa-spinner fa-spin"></i> 加载中...</div>';
            const res = await apiFetch('/admin/announcements');
            if (!res.ok) { wrap.innerHTML = '<div class="empty-msg">加载失败</div>'; return; }
            const anns = res.data.data || [];
            if (anns.length === 0) { wrap.innerHTML = '<div class="empty-msg">暂无公告</div>'; return; }
            wrap.innerHTML = `<table class="data-table">
                <thead><tr><th>ID</th><th>标题</th><th>分类</th><th>置顶</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead>
                <tbody>${anns.map(a => `<tr>
                    <td>${a.id}</td>
                    <td>${a.title}</td>
                    <td>${a.category}</td>
                    <td>${a.is_pinned ? '✅' : '—'}</td>
                    <td>${a.is_active ? '启用' : '禁用'}</td>
                    <td>${a.created_at ? new Date(a.created_at * 1000).toLocaleString('zh-CN') : '—'}</td>
                </tr>`).join('')}</tbody></table>`;
        }

        // === 编辑/删除功能 ===
        async function deleteUser(id) {
            if (!confirm('确定删除该用户？')) return;
            const res = await apiFetch('/admin/users/' + id, { method: 'DELETE' });
            if (res.ok) { showToast('已删除'); loadUsers(); } else { showToast('删除失败', true); }
        }
        async function deleteOrder(id) {
            if (!confirm('确定删除该订单？')) return;
            const res = await apiFetch('/admin/orders/' + id, { method: 'DELETE' });
            if (res.ok) { showToast('已删除'); loadAllOrders(); loadStats(); } else { showToast('删除失败', true); }
        }
        async function deleteWorker(id) {
            if (!confirm('确定删除该员工？')) return;
            const res = await apiFetch('/admin/workers/' + id, { method: 'DELETE' });
            if (res.ok) { showToast('已删除'); loadEmployees(); loadStats(); } else { showToast('删除失败', true); }
        }
        async function deleteAnn(id) {
            if (!confirm('确定删除该公告？')) return;
            const res = await apiFetch('/admin/announcements/' + id, { method: 'DELETE' });
            if (res.ok) { showToast('已删除'); loadAnnouncements(); } else { showToast('删除失败', true); }
        }
        async function editOrderStatus(id, curStatus) {
            const status = prompt('输入新状态 (pending/in_progress/completed/cancelled):', curStatus);
            if (!status || status === curStatus) return;
            const res = await apiFetch('/admin/orders/' + id, { method: 'PUT', body: JSON.stringify({ status }) });
            if (res.ok) { showToast('已更新'); loadAllOrders(); } else { showToast(res.data.data?.error || '更新失败', true); }
        }
    