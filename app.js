const AdminAuth = {
    ACCS_KEY: 'wyc_accounts_v1',
    SESS_KEY: 'wyc_current_session_v1',
    LEGACY_PWD_KEY: 'wyc_admin_pwd_v1',
    LEGACY_TOKEN_KEY: 'wyc_admin_token_v1',
    SEED_SUPER: { username: '15874580880', password: '111111', role: 'super' },
    SESS_TTL_MS: 7 * 24 * 60 * 60 * 1000,
    SUPER_NAME: '超级管理员',
    ADMIN_NAME: '管理员',

    _hash(s) {
        let h = 0x811c9dc5;
        for (let i = 0; i < s.length; i++) {
            h ^= s.charCodeAt(i);
            h = Math.imul(h, 0x01000193);
        }
        return (h >>> 0).toString(16).padStart(8, '0');
    },

    _norm(u) {
        return String(u || '').trim().toLowerCase();
    },

    _roleClean(role) {
        return role === 'super' ? 'super' : 'admin';
    },

    _seedIfEmpty() {
        if (localStorage.getItem(this.ACCS_KEY)) return;
        const list = [
            { username: this._norm(this.SEED_SUPER.username),
              pwdHash: this._hash(this.SEED_SUPER.password),
              role: 'super' }
        ];
        localStorage.setItem(this.ACCS_KEY, JSON.stringify(list));
    },

    getAccounts() {
        this._seedIfEmpty();
        try {
            const raw = localStorage.getItem(this.ACCS_KEY);
            const arr = JSON.parse(raw || '[]');
            return (Array.isArray(arr) ? arr : []).map(a => ({
                username: this._norm(a.username),
                pwdHash: String(a.pwdHash || ''),
                role: this._roleClean(a.role)
            }));
        } catch (e) {
            return [];
        }
    },

    _saveAccounts(list) {
        localStorage.setItem(this.ACCS_KEY, JSON.stringify(list || []));
    },

    findAccount(username) {
        const u = this._norm(username);
        return this.getAccounts().find(a => a.username === u) || null;
    },

    _readSession() {
        try {
            const raw = localStorage.getItem(this.SESS_KEY);
            if (!raw) return null;
            const s = JSON.parse(raw);
            if (!s || !s.username || !s.expiresAt || s.expiresAt < Date.now()) return null;
            return { username: this._norm(s.username), role: this._roleClean(s.role), token: String(s.token || ''), expiresAt: Number(s.expiresAt) || 0 };
        } catch (e) {
            return null;
        }
    },

    _writeSession(account) {
        const ts = Date.now() + this.SESS_TTL_MS;
        const tokenPart = this._hash(account.username + account.pwdHash + '|' + ts);
        const sess = { username: this._norm(account.username), role: this._roleClean(account.role), token: tokenPart, expiresAt: ts };
        localStorage.setItem(this.SESS_KEY, JSON.stringify(sess));
        return sess;
    },

    isUnlocked() {
        this._seedIfEmpty();
        return !!this._readSession();
    },

    isSuper() {
        this._seedIfEmpty();
        return this._readSession()?.role === 'super';
    },

    currentAccount() {
        this._seedIfEmpty();
        const s = this._readSession();
        if (!s) return null;
        const a = this.findAccount(s.username);
        if (!a) return null;
        return { username: a.username, role: a.role };
    },

    lock() {
        localStorage.removeItem(this.SESS_KEY);
        this._applyUI();
    },

    tryLogin(username, pwd) {
        this._seedIfEmpty();
        const u = this._norm(username);
        if (!u) return { ok: false, msg: '请输入账号' };
        if (!pwd) return { ok: false, msg: '请输入密码' };
        const a = this.findAccount(u);
        if (!a) return { ok: false, msg: '账号或密码错误' };
        if (a.pwdHash !== this._hash(pwd)) return { ok: false, msg: '账号或密码错误' };
        this._writeSession(a);
        this._applyUI();
        return { ok: true, role: a.role };
    },

    tryChangeSelfPwd(oldPwd, newPwd, newPwd2) {
        this._seedIfEmpty();
        const cur = this.currentAccount();
        if (!cur) return { ok: false, msg: '请先登录' };
        if (!oldPwd) return { ok: false, msg: '请输入当前密码' };
        if (!newPwd || !newPwd2) return { ok: false, msg: '请输入新密码' };
        if (newPwd.length < 4) return { ok: false, msg: '新密码至少 4 位' };
        if (newPwd !== newPwd2) return { ok: false, msg: '两次新密码输入不一致' };
        const list = this.getAccounts();
        const idx = list.findIndex(a => a.username === cur.username);
        if (idx < 0) return { ok: false, msg: '账号不存在' };
        if (list[idx].pwdHash !== this._hash(oldPwd)) return { ok: false, msg: '当前密码不正确' };
        list[idx].pwdHash = this._hash(newPwd);
        this._saveAccounts(list);
        this._writeSession(list[idx]);
        this._applyUI();
        return { ok: true };
    },

    _superCount(list) {
        return list.filter(a => a.role === 'super').length;
    },

    superCreateAccount(username, tempPwd, role) {
        if (!this.requireSuper('添加管理员账号')) return { ok: false, msg: '仅超级管理员可添加账号' };
        const u = this._norm(username);
        const r = this._roleClean(role);
        if (!u) return { ok: false, msg: '请输入管理员账号' };
        if (u.length < 2 || u.length > 32) return { ok: false, msg: '账号长度 2-32 位' };
        if (!tempPwd) return { ok: false, msg: '请输入初始密码' };
        if (tempPwd.length < 4) return { ok: false, msg: '密码至少 4 位' };
        const list = this.getAccounts();
        if (list.find(a => a.username === u)) return { ok: false, msg: '此账号已存在' };
        list.push({ username: u, pwdHash: this._hash(tempPwd), role: r });
        this._saveAccounts(list);
        return { ok: true };
    },

    superDeleteAccount(username) {
        if (!this.requireSuper('删除管理员账号')) return { ok: false, msg: '仅超级管理员可删除账号' };
        const u = this._norm(username);
        const cur = this.currentAccount();
        if (!cur) return { ok: false, msg: '请先登录' };
        if (cur.username === u) return { ok: false, msg: '不能删除当前在线的账号，否则自己会登出（可先退出登录再由另一超管删除）' };
        const list = this.getAccounts();
        const idx = list.findIndex(a => a.username === u);
        if (idx < 0) return { ok: false, msg: '账号不存在' };
        const target = list[idx];
        if (target.role === 'super' && this._superCount(list) <= 1) return { ok: false, msg: '这是最后一个超级管理员，不能删除（否则无人管理账号）' };
        list.splice(idx, 1);
        this._saveAccounts(list);
        return { ok: true };
    },

    superResetPassword(username, newPwd) {
        if (!this.requireSuper('重置密码')) return { ok: false, msg: '仅超级管理员可重置密码' };
        const u = this._norm(username);
        const cur = this.currentAccount();
        if (!cur) return { ok: false, msg: '请先登录' };
        if (cur.username === u) return { ok: false, msg: '自己的密码请去"我的资料"修改' };
        const np = newPwd && String(newPwd).trim() ? String(newPwd).trim() : '123456';
        if (np.length < 4) return { ok: false, msg: '新密码至少 4 位' };
        const list = this.getAccounts();
        const idx = list.findIndex(a => a.username === u);
        if (idx < 0) return { ok: false, msg: '账号不存在' };
        list[idx].pwdHash = this._hash(np);
        this._saveAccounts(list);
        return { ok: true, resetTo: np };
    },

    requireWrite(label) {
        if (!this.isUnlocked()) {
            const msg = '只读模式：请先点右上角🔒管理员登录，才能' + (label || '进行此操作');
            if (window.Toast) Toast.show(msg, 'warning', 3200);
            else alert(msg);
            if (window.AdminUI) AdminUI.openModal('login');
            return false;
        }
        return true;
    },

    requireSuper(label) {
        if (!this.isSuper()) {
            const msg = '仅超级管理员可操作：' + (label || '此功能');
            if (window.Toast) Toast.show(msg, 'warning', 3200);
            else alert(msg);
            if (window.AdminUI) AdminUI.openModal('login');
            return false;
        }
        return true;
    },

    _applyUI() {
        const unlocked = this.isUnlocked();
        const cur = this.currentAccount();
        document.body.classList.toggle('admin-readonly', !unlocked);
        const btn = document.getElementById('adminBtn');
        const icon = document.getElementById('adminIcon');
        const txt = document.getElementById('adminText');
        if (btn) {
            btn.classList.toggle('admin-unlocked', !!unlocked);
            btn.classList.toggle('admin-locked', !unlocked);
            btn.classList.toggle('admin-super', !!cur && cur.role === 'super');
        }
        if (icon) icon.textContent = unlocked ? '🔓' : '🔒';
        if (txt) {
            if (!unlocked) txt.textContent = '只读';
            else if (cur.role === 'super') txt.textContent = '超级管理员';
            else txt.textContent = '管理员';
        }
        if (typeof Render !== 'undefined' && typeof Navigation !== 'undefined' && Navigation.currentView) {
            try {
                if (Navigation.currentView === 'dashboard') Render.dashboard();
                else if (Navigation.currentView === 'vehicles') Render.vehicleList();
                else if (Navigation.currentView === 'detail' && Navigation.currentVehicleId) Render.vehicleDetail(Navigation.currentVehicleId);
            } catch (e) {}
        }
    }
};

const AdminUI = {
    mode: 'login',
    init() {
        AdminAuth._seedIfEmpty();
        const btn = document.getElementById('adminBtn');
        if (btn) btn.addEventListener('click', () => this.openModal());
        const close = document.getElementById('btnCloseAdminModal');
        if (close) close.addEventListener('click', () => this.closeModal());
        const cancel = document.getElementById('btnAdminCancel');
        if (cancel) cancel.addEventListener('click', () => this.closeModal());
        const modal = document.getElementById('adminModal');
        if (modal) modal.addEventListener('click', (e) => { if (e.target.id === 'adminModal') this.closeModal(); });
        const submit = document.getElementById('btnAdminSubmit');
        if (submit) submit.addEventListener('click', () => this._submit());
        ['btnTabLogin','btnTabProfile','btnTabManage'].forEach(function(id){ const el=document.getElementById(id); if(el) el.addEventListener('click',function(){ AdminUI.switchTab(id==='btnTabLogin'?'login':(id==='btnTabProfile'?'profile':'manage')); }); });
        const logout = document.getElementById('btnAdminLogout');
        if (logout) logout.addEventListener('click', function () { AdminAuth.lock(); AdminUI.closeModal(); Toast.show('已退出登录，系统回到只读模式', 'success'); });
        const create = document.getElementById('btnAdminCreate');
        if (create) create.addEventListener('click', () => this._createNewAdmin());
        ['adminLoginUser','adminLoginPwd','meOldPwd','meNewPwd','meNewPwd2','newAdminUser','newAdminPwd'].forEach(function(id){
            var el = document.getElementById(id);
            if (el) el.addEventListener('keydown', function(ev){ if (ev.key==='Enter') { if (id==='newAdminUser'||id==='newAdminPwd') AdminUI._createNewAdmin(); else AdminUI._submit(); }});
        });
        AdminAuth._applyUI();
    },
    switchTab(mode) {
        if (mode === 'manage' && !AdminAuth.isSuper()) { Toast.show('仅超级管理员可查看此页', 'warning'); mode = 'profile'; }
        if ((mode === 'profile' || mode === 'manage') && !AdminAuth.isUnlocked()) { Toast.show('请先登录', 'warning'); mode = 'login'; }
        this.mode = mode;
        this._render();
    },
    openModal(forceMode) {
        if (forceMode) {
            if (forceMode === 'manage' && !AdminAuth.isSuper()) forceMode = AdminAuth.isUnlocked() ? 'profile' : 'login';
            else if (forceMode === 'profile' && !AdminAuth.isUnlocked()) forceMode = 'login';
            this.mode = forceMode;
        } else {
            this.mode = AdminAuth.isUnlocked() ? 'profile' : 'login';
        }
        this._render();
        const m = document.getElementById('adminModal');
        if (m) m.classList.add('active');
        setTimeout(()=>{
            let fid = null;
            if (this.mode==='login') fid='adminLoginUser';
            else if (this.mode==='profile') fid='meOldPwd';
            else fid='newAdminUser';
            const el = document.getElementById(fid); if (el) el.focus();
        }, 120);
    },
    closeModal() {
        const m = document.getElementById('adminModal');
        if (m) m.classList.remove('active');
        ['adminLoginUser','adminLoginPwd','meOldPwd','meNewPwd','meNewPwd2','newAdminUser','newAdminPwd'].forEach(function(id){ var el=document.getElementById(id); if (el) el.value=''; });
        this._setStatus('', null);
    },
    _setStatus(cls, msg) {
        const line = document.getElementById('adminStatusLine');
        if (!line) return;
        line.className = 'admin-status' + (cls ? ' admin-' + cls : '');
        line.textContent = msg ? msg : '\u00A0';
    },
    _render() {
        const unlocked = AdminAuth.isUnlocked();
        const cur = AdminAuth.currentAccount();
        const isSuper = !!cur && cur.role === 'super';
        if (this.mode === 'manage' && !isSuper) this.mode = unlocked ? 'profile' : 'login';
        if (this.mode === 'profile' && !unlocked) this.mode = 'login';
        ['adminLoginPane','adminProfilePane','adminManagePane'].forEach(function(id){ const el=document.getElementById(id); if (el) el.style.display='none'; });
        const tabLogin = document.getElementById('adminLoginPane');
        const tabProfile = document.getElementById('adminProfilePane');
        const tabManage = document.getElementById('adminManagePane');
        const tLogin=document.getElementById('btnTabLogin'), tProfile=document.getElementById('btnTabProfile'), tManage=document.getElementById('btnTabManage');
        const title = document.getElementById('adminModalTitle');
        const sub = document.getElementById('adminModalSubtitle');
        const icon = document.getElementById('adminModalIcon');
        const submitBtn = document.getElementById('btnAdminSubmit');
        const logout = document.getElementById('btnAdminLogout');
        [tLogin,tProfile,tManage,logout].forEach(function(b){ if(b) b.classList.remove('admin-tab-active'); });
        if (this.mode === 'login' || !unlocked) {
            this.mode = 'login';
            if (tabLogin) tabLogin.style.display='';
            if (title) title.textContent = '管理员登录';
            if (sub) sub.textContent = unlocked ? ('当前已登录，可切换到"我的资料"改密码') : '输入账号密码登录，才能添加 / 编辑 / 删除数据';
            if (icon) icon.textContent = '🔐';
            if (submitBtn) { submitBtn.style.display=''; submitBtn.textContent = unlocked ? '🔓 重新登录' : '🔓 登录解锁'; }
            if (tLogin) tLogin.classList.add('admin-tab-active');
            if (tProfile) tProfile.style.display = unlocked ? '' : 'none';
            if (tManage) tManage.style.display = isSuper ? '' : 'none';
        } else if (this.mode === 'profile') {
            if (tabProfile) tabProfile.style.display='';
            if (title) title.textContent = (cur.role==='super' ? '超级管理员' : '管理员') + ' - 我的资料';
            if (sub) sub.textContent = '当前账号：' + cur.username + '（只能改自己的密码）';
            if (icon) icon.textContent = '🛡️';
            if (submitBtn) { submitBtn.style.display=''; submitBtn.textContent = '💾 保存新密码'; }
            if (tProfile) tProfile.classList.add('admin-tab-active');
            if (tLogin) tLogin.style.display = '';
            if (tManage) tManage.style.display = isSuper ? '' : 'none';
        } else if (this.mode === 'manage') {
            if (tabManage) { tabManage.style.display=''; this._renderAdminList(); }
            if (title) title.textContent = '👥 管理员列表';
            if (sub) sub.textContent = '仅超级管理员可见：增删普通管理员 / 重置账号密码';
            if (icon) icon.textContent = '👥';
            if (submitBtn) submitBtn.style.display = 'none';
            if (tManage) tManage.classList.add('admin-tab-active');
            if (tLogin) tLogin.style.display = '';
            if (tProfile) tProfile.style.display = '';
        }
        if (tLogin) tLogin.style.display = '';
        if (tProfile) tProfile.style.display = unlocked ? '' : 'none';
        if (tManage) tManage.style.display = isSuper ? '' : 'none';
        if (logout) logout.style.display = unlocked ? '' : 'none';
        this._setStatus('', null);
    },
    _renderAdminList() {
        const wrap = document.getElementById('adminListBody');
        if (!wrap) return;
        const cur = AdminAuth.currentAccount();
        const list = AdminAuth.getAccounts();
        const rows = list.map(a => {
            const isSelf = cur && cur.username === a.username;
            const roleBadge = a.role === 'super'
                ? '<span class="admin-role-badge super">超级管理员</span>'
                : '<span class="admin-role-badge admin">管理员</span>';
            let actionButtons = '';
            if (a.role === 'super') {
                actionButtons = isSelf
                    ? '<span style="color:var(--text-muted);font-size:12px;">（当前在线）</span>'
                    : '<button class="ghost-btn danger-btn-sm" title="重置为 123456" onclick="AdminUI._resetPwd(\'' + a.username + '\')">🔑 重置密码</button>';
            } else {
                const delDisabled = isSelf ? ' disabled style="opacity:.4;cursor:not-allowed;"' : '';
                actionButtons =
                    '<button class="ghost-btn admin-btn-sm" title="重置为 123456 或自定义" onclick="AdminUI._resetPwd(\'' + a.username + '\')">🔑 重置密码</button>' +
                    '<button class="ghost-btn danger admin-btn-sm danger-btn-sm" title="删除此账号" onclick="AdminUI._deleteAdmin(\'' + a.username + '\')"'+delDisabled+'>🗑️ 删除</button>';
            }
            return '<div class="admin-manage-row">' +
                '<div class="admin-manage-cell name"><div class="admin-manage-name">' + a.username + (isSelf ? ' <span class="admin-manage-self">（当前账号）' : '') + '</div><div class="admin-manage-role">' + roleBadge + '</div></div>' +
                '<div class="admin-manage-cell actions">' + actionButtons + '</div></div>';
        }).join('');
        wrap.innerHTML = rows;
    },
    _resetPwd(username) {
        if (!AdminAuth.requireSuper('重置密码')) return;
        const p = prompt('请输入 ' + username + ' 的新密码（留空则默认重置为 123456）：', '');
        if (p === null) return;
        const res = AdminAuth.superResetPassword(username, p);
        if (res.ok) {
            Toast.show('已重置 ' + username + ' 的密码为：' + (res.resetTo || '123456'), 'success');
            this._renderAdminList();
        } else {
            Toast.show(res.msg || '重置失败', 'warning');
        }
    },
    _deleteAdmin(username) {
        if (!AdminAuth.requireSuper('删除账号')) return;
        if (!confirm('确定删除账号 ' + username + ' 吗？删除后此账号将无法登录，此操作不可撤销')) return;
        const res = AdminAuth.superDeleteAccount(username);
        if (res.ok) { Toast.show('已删除账号 ' + username, 'success'); this._renderAdminList(); }
        else Toast.show(res.msg || '删除失败', 'warning');
    },
    _createNewAdmin() {
        if (!AdminAuth.requireSuper('新增管理员')) return;
        const u = (document.getElementById('newAdminUser').value || '').trim();
        const p = (document.getElementById('newAdminPwd').value || '').trim();
        const res = AdminAuth.superCreateAccount(u, p, 'admin');
        if (res.ok) {
            Toast.show('已新增管理员：' + AdminAuth._norm(u), 'success');
            const e1=document.getElementById('newAdminUser'); if(e1) e1.value='';
            const e2=document.getElementById('newAdminPwd'); if(e2) e2.value='';
            this._renderAdminList();
            this._setStatus('ok', '新增成功，初始密码：' + (p||'123456'));
        } else {
            this._setStatus('fail', ' ' + (res.msg || '新增失败'));
        }
    },
    _submit() {
        if (this.mode === 'login') {
            const u = (document.getElementById('adminLoginUser').value || '');
            const p = (document.getElementById('adminLoginPwd').value || '');
            const res = AdminAuth.tryLogin(u, p);
            if (res.ok) {
                this._setStatus('ok', '登录成功：' + (res.role==='super'?'超级管理员':'管理员') + '，现在可添加/编辑/删除数据');
                setTimeout(() => { this.closeModal(); Toast.show('管理员登录成功！', 'success'); }, 900);
            } else {
                this._setStatus('fail', ' ' + (res.msg || '登录失败'));
            }
        } else if (this.mode === 'profile') {
            const o = (document.getElementById('meOldPwd').value || '');
            const n = (document.getElementById('meNewPwd').value || '');
            const n2 = (document.getElementById('meNewPwd2').value || '');
            const res = AdminAuth.tryChangeSelfPwd(o, n, n2);
            if (res.ok) {
                this._setStatus('ok', '密码已修改，请牢记新密码');
                setTimeout(() => this.closeModal(), 900);
            } else {
                this._setStatus('fail', ' ' + (res.msg || '修改失败'));
            }
        }
    }
};

const LocalStore = {
    KEY: 'wyc_rental_data_v1',
    ANON_KEY: 'wyc_anon_key_v1',
    load() {
        try {
            const raw = localStorage.getItem(this.KEY);
            return raw ? JSON.parse(raw) : { vehicles: [] };
        } catch (e) {
            console.error('加载数据失败:', e);
            return { vehicles: [] };
        }
    },
    save(data) {
        try {
            localStorage.setItem(this.KEY, JSON.stringify(data));
            return true;
        } catch (e) {
            console.error('保存数据失败:', e);
            Toast.show('保存失败：存储空间可能不足', 'error');
            return false;
        }
    },
    getAnonKey() {
        return localStorage.getItem(this.ANON_KEY) || '';
    },
    setAnonKey(k) {
        if (!k) localStorage.removeItem(this.ANON_KEY);
        else localStorage.setItem(this.ANON_KEY, k);
    }
};

// 兜底再挂一次别名：如果 supabase-client.js 因为加载顺序先执行没挂上，这里再补一次
// CloudSync 模块里所有调用统一使用 window.CloudLocalStore.xxx
if (window.CloudStorage && !window.CloudLocalStore) {
    window.CloudLocalStore = window.CloudStorage;
}

// ============================================================
// CloudSync：负责和 Supabase 云端双向同步（双引擎：在线优先，离线自动回退本地）
// ============================================================
const CloudSync = {
    online: false,
    unsubRealtime: null,
    suppressNextReload: false,

    async bootstrap() {

        try {
            const savedKey = LocalStore.getAnonKey();
            if (savedKey && savedKey !== 'YOUR_ANON_KEY_HERE') {
                window.SUPABASE_CONFIG.ANON_KEY = savedKey;
            }
            if (!window.SUPABASE_CONFIG || !window.SUPABASE_CONFIG.URL || !window.SUPABASE_CONFIG.ANON_KEY ||
                window.SUPABASE_CONFIG.ANON_KEY === 'YOUR_ANON_KEY_HERE') {
                this.online = false;
                CloudUI.setStatus('offline', '未配置');
                return { ok: false, reason: 'no-key' };
            }
            if (!window.CloudStorage) {
                CloudUI.setStatus('error', 'SDK加载失败');
                return { ok: false, reason: 'no-sdk' };
            }
            CloudUI.setStatus('syncing', '连接中...');
            const initRes = window.CloudLocalStore.init();
            if (!initRes.ok) {
                this.online = false;
                CloudUI.setStatus('error', initRes.error || '初始化失败');
                return { ok: false, reason: initRes.error };
            }
            const ping = await window.CloudLocalStore.ping();
            if (!ping.ok) {
                this.online = false;
                CloudUI.setStatus('error', ping.error || '连接失败');
                return { ok: false, reason: ping.error };
            }
            this.online = true;
            CloudUI.setStatus('online', '已连接');
            this._subscribeRealtime();
            return { ok: true };
        } finally { }
    },

    _subscribeRealtime() {
        if (this.unsubRealtime) try { this.unsubRealtime(); } catch (_) {}
        this.unsubRealtime = window.CloudLocalStore.subscribeAll(() => {
            if (this.suppressNextReload) { this.suppressNextReload = false; return; }
            this.loadCloudAndReplaceLocal(true);
        });
    },

    async loadCloudAndReplaceLocal(silent = false) {
        if (!this.online) return { ok: false };
        if (!silent) { }
        try {
            const res = await window.CloudLocalStore.listAllVehicles();
            if (!res.ok) {
                if (!silent) Toast.show('云端读取失败：' + res.error, 'error');
                return { ok: false, error: res.error };
            }
            AppData.data.vehicles = res.data || [];
            LocalStore.save(AppData.data);
            if (!silent) {
                Render.dashboard();
                if (Navigation.currentView === 'vehicles') Render.vehicleList();
                else if (Navigation.currentView === 'detail' && Navigation.currentVehicleId) {
                    if (!AppData.getVehicleById(Navigation.currentVehicleId)) Navigation.switchView('vehicles');
                    else Render.vehicleDetail(Navigation.currentVehicleId);
                }
            }
            return { ok: true };
        } finally { }
    },

    async pushVehicle(localV) {
        if (!this.online) return { ok: false };
        // No spinner management here
        try {

            return await window.CloudLocalStore.upsertVehicleByPlate(localV);
        } finally { }
    },

    async removeVehicle(id) {
        if (!this.online) return { ok: false };
        try {

            return await window.CloudLocalStore.deleteVehicle(id);
        } finally { 
            // suppressNextReload is handled by _subscribeRealtime
        }
    },

    async uploadImage(vehicleId, slot, file, fileName) {
        if (!this.online) return { ok: false, error: '离线状态' };

        try {
            const realVid = await this._resolveRealVehicleId(vehicleId);
            if (!realVid) return { ok: false, error: '车辆尚未同步到云端，点保存后再传图' };
            this.suppressNextReload = true;
            return await window.CloudLocalStore.uploadDocument(realVid, slot, file, fileName);
        } finally { }
    },

    async deleteImage(vehicleId, slot) {
        if (!this.online) return { ok: false };

        try {
            const realVid = await this._resolveRealVehicleId(vehicleId);
            if (!realVid) return { ok: false };
            this.suppressNextReload = true;
            return await window.CloudLocalStore.removeDocument(realVid, slot);
        } finally { }
    },

    async _resolveRealVehicleId(localId) {
        if (localId && !localId.startsWith('v_')) return localId;
        const v = AppData.getVehicleById(localId);
        if (!v) return null;
        if (v.id && !v.id.startsWith('v_')) return v.id;
        const pushed = await this.pushVehicle(v);
        if (pushed.ok && pushed.vehicle_id) {
            v.id = pushed.vehicle_id;
            LocalStore.save(AppData.data);
            return pushed.vehicle_id;
        }
        return null;
    },

    async migrateLocalToCloud(onProgress) {
        if (!this.online) return { ok: false, error: '云端未连接' };

        try {
            const vehicles = AppData.getVehicles() || [];
            const total = vehicles.length;
            let okCount = 0, failCount = 0, imgNewUpload = 0, imgAlreadyCloud = 0, imgFail = 0;
            const errors = [];
            for (let i = 0; i < total; i++) {
                const v = vehicles[i];
                try {
                    if (typeof onProgress === 'function') onProgress(i + 1, total, v.plateNumber || '(未命名车辆)');
                    const cleaned = JSON.parse(JSON.stringify(v));
                    if (cleaned.rental) {
                        ['monthlyRent','deposit'].forEach(k => {
                            const raw = cleaned.rental[k];
                            if (raw === '' || raw === null || raw === undefined) cleaned.rental[k] = null;
                            else { const n = Number(raw); cleaned.rental[k] = isNaN(n) ? null : n; }
                        });
                        ['startDate','nextPayDate'].forEach(k => {
                            if (!cleaned.rental[k]) cleaned.rental[k] = null;
                        });
                    }
                    if (cleaned.insurance) {
                        ['amount'].forEach(k => {
                            const raw = cleaned.insurance[k];
                            if (raw === '' || raw === null || raw === undefined) cleaned.insurance[k] = null;
                            else { const n = Number(raw); cleaned.insurance[k] = isNaN(n) ? null : n; }
                        });
                        ['startDate','endDate'].forEach(k => {
                            if (!cleaned.insurance[k]) cleaned.insurance[k] = null;
                        });
                    }
                    const res = await this.pushVehicle(cleaned);
                    if (res.ok) {
                        if (v.id !== res.vehicle_id) { v.id = res.vehicle_id; LocalStore.save(AppData.data); }
                        const images = v.images || {};
                        for (const slot of Object.keys(images)) {
                            const dataUrl = images[slot];
                            if (!dataUrl || typeof dataUrl !== 'string') continue;
                            try {
                                const isCloudUrl = typeof dataUrl === 'string' &&
                                    (dataUrl.startsWith('http://') || dataUrl.startsWith('https://') ||
                                     dataUrl.startsWith('storage://') || (dataUrl.startsWith('/') && !dataUrl.startsWith('data:')));
                                if (isCloudUrl) {
                                    imgAlreadyCloud++;
                                    continue;
                                }
                                if (!dataUrl.startsWith('data:')) continue;
                                const isPDF = dataUrl.startsWith('data:application/pdf');
                                const fname = `${slot}.${isPDF ? 'pdf' : 'jpg'}`;
                                const file = await CloudSync._dataURLtoFile(dataUrl, fname);
                                if (file) {
                                    const store = window.CloudLocalStore || window.CloudStorage;
                                    const upload = store.uploadDocument ? store.uploadDocument.bind(store) : store.uploadImage.bind(store);
                                    const ures = await upload(res.vehicle_id, slot, file, file.name);
                                    if (ures.ok && ures.data && ures.data.public_url) {
                                        images[slot] = ures.data.public_url; imgNewUpload++;
                                        LocalStore.save(AppData.data);
                                    } else if (ures && ures.error) {
                                        imgFail++;
                                        errors.push(`${v.plateNumber || '(未命名)'} 证件[${slot}]上传失败: ${ures.error}`);
                                    } else {
                                        imgFail++;
                                        errors.push(`${v.plateNumber || '(未命名)'} 证件[${slot}]上传失败: 无返回数据`);
                                    }
                                } else {
                                    imgFail++;
                                    errors.push(`${v.plateNumber || '(未命名)'} 证件[${slot}]转换失败: 无法生成 File 对象`);
                                }
                            } catch (imgErr) {
                                imgFail++;
                                errors.push(`${v.plateNumber || '(未命名)'} 证件[${slot}]转换失败: ${imgErr.message || String(imgErr)}`);
                            }
                        }
                        okCount++;
                    } else {
                        failCount++;
                        errors.push(`${v.plateNumber || '(未命名车辆)'} 写入失败: ${res.error || res.reason || '未知错误'}`);
                    }
                } catch (e) {
                    failCount++;
                    errors.push(`${v.plateNumber || '(未命名车辆)'} 异常: ${e.message || String(e)}`);
                }
            }
            try { await this.loadCloudAndReplaceLocal(true); } catch (e) {}
            const errMsg = errors.length ? ('迁移异常详情：\n' + errors.slice(0, 10).map((s, i) => `${i + 1}. ${s}`).join('\n') + (errors.length > 10 ? `\n（另外还有 ${errors.length - 10} 条错误）` : '')) : '';
            return { ok: true, total, okCount, failCount, imgNewUpload, imgAlreadyCloud, imgFail, error: errMsg || null };
        } finally { }
    },

    _dataURLtoFile(dataUrl, filename) {
        return new Promise((resolve, reject) => {
            try {
                const arr = dataUrl.split(',');
                const mime = arr[0].match(/:(.*?);/)[1];
                const bstr = atob(arr[1]);
                let n = bstr.length;
                const u8arr = new Uint8Array(n);
                while (n--) u8arr[n] = bstr.charCodeAt(n);
                resolve(new File([u8arr], filename, { type: mime || 'image/jpeg' }));
            } catch (e) { reject(e); }
        });
    }
};

// ============================================================
// CloudUI：云同步状态栏 + 设置弹窗交互
// ============================================================
const CloudUI = {
    setStatus(level, text) {
        const dot = document.getElementById('cloudDot');
        const txt = document.getElementById('cloudText');
        if (dot) { dot.className = 'cloud-dot status-' + level; }
        if (txt) { txt.textContent = text || ''; }
    },

    openModal() {
        const m = document.getElementById('cloudSetupModal');
        if (!m) return;
        const input = document.getElementById('anonKeyInput');
        if (input) input.value = LocalStore.getAnonKey();
        this._refreshStepsUI();
        this._refreshMigrateSummary();
        m.classList.add('active');
    },
    closeModal() {
        const m = document.getElementById('cloudSetupModal');
        if (m) m.classList.remove('active');
    },

    _refreshStepsUI() {
        const hasKey = !!(LocalStore.getAnonKey && LocalStore.getAnonKey());
        const online = !!CloudSync.online;
        const stepWarn = document.getElementById('cloudStepWarn');
        if (stepWarn) {
            stepWarn.style.display = online ? 'none' : 'flex';
        }
        const applyDone = (id, done) => {
            const el = document.getElementById(id);
            if (!el) return;
            const num = el.querySelector('.step-num');
            if (done) {
                el.classList.add('done');
                if (num && num.textContent.trim() !== '✓') {
                    num._origText = num._origText || num.textContent;
                    num.textContent = '✓';
                }
            } else {
                el.classList.remove('done');
                if (num && num._origText !== undefined) {
                    num.textContent = num._origText;
                }
            }
        };
        applyDone('cloudStep1', hasKey || online);
        applyDone('cloudStep2', hasKey || online);
        applyDone('cloudStep3', online);
    },

    _refreshMigrateSummary() {
        const step = document.getElementById('migrateStep');
        const summary = document.getElementById('migrateSummary');
        if (!CloudSync.online) {
            if (step) step.style.display = 'none';
            return;
        }
        if (step) step.style.display = 'flex';
        const vehicles = AppData.getVehicles();
        let imgLocal = 0, imgCloud = 0;
        vehicles.forEach(v => {
            const imgs = v.images || {};
            Object.keys(imgs).forEach(k => {
                const u = imgs[k];
                if (typeof u === 'string' && (u.startsWith('http://') || u.startsWith('https://') || u.startsWith('storage://'))) {
                    imgCloud++;
                } else if (typeof u === 'string' && u.startsWith('data:')) {
                    imgLocal++;
                } else if (u) {
                    imgLocal++;
                }
            });
        });
        if (summary) {
            const parts = [];
            parts.push(`检测到本地有 <b style="color:#4f8cff;">${vehicles.length}</b> 台车`);
            if (imgLocal > 0) parts.push(`<b style="color:#ffa94d;">${imgLocal}</b> 张待上传原图`);
            if (imgCloud > 0) parts.push(`<b style="color:#2ed573;">${imgCloud}</b> 张已在云端（跳过不重复传）`);
            if (imgLocal === 0 && imgCloud === 0) parts.push(`暂无证件图片`);
            summary.innerHTML = parts.join(' + ') + '。<br>点击下方按钮一键同步，之后电脑和手机就都能看到啦。';
        }
    },

    init() {
        const cloudBtn = document.getElementById('cloudBtn');
        if (cloudBtn) cloudBtn.addEventListener('click', () => this.openModal());
        const closeBtn = document.getElementById('btnCloseCloudModal');
        if (closeBtn) closeBtn.addEventListener('click', () => this.closeModal());
        const cancelBtn = document.getElementById('btnCancelCloud');
        if (cancelBtn) cancelBtn.addEventListener('click', () => this.closeModal());
        const modal = document.getElementById('cloudSetupModal');
        if (modal) modal.addEventListener('click', (e) => {
            if (e.target.id === 'cloudSetupModal') this.closeModal();
        });
        const saveBtn = document.getElementById('btnSaveCloud');
        if (saveBtn) saveBtn.addEventListener('click', () => this._doTestAndSave());
        const migrateBtn = document.getElementById('btnDoMigrate');
        if (migrateBtn) migrateBtn.addEventListener('click', () => this._doMigrate());
    },

    async _doTestAndSave() {
        const input = document.getElementById('anonKeyInput');
        const resultEl = document.getElementById('cloudTestResult');
        const key = (input ? input.value || '' : '').trim();
        if (!key) {
            this._setTestResult('fail', '❌ key 是空的，先复制粘贴进来');
            return;
        }
        const looksLikeServiceRole =
            key.startsWith('sb_secret_') ||
            (key.startsWith('sb-') && key.includes('service_role')) ||
            (key.length > 200 && key.includes('service_role'));
        if (looksLikeServiceRole) {
            this._setTestResult('fail', '❌ 这是 service_role / 秘密密钥！前端绝对禁止用这个。回到 API 密钥页复制「可发布密钥 / sb_publishable_ 开头」或 Legacy → anon public 那行');
            return;
        }
        const looksLikePublicAnon =
            key.startsWith('sb_publishable_') ||
            (key.startsWith('eyJ') && key.length > 100) ||
            key.length >= 80;
        if (!looksLikePublicAnon) {
            this._setTestResult('fail', '❌ 这串不像公开密钥。正确的应该是：sb_publishable_ 开头（新版界面「可发布密钥」区，复制上面那行）或 eyJ 开头（Legacy anon public，长 100+ 字符）。');
            return;
        }
        LocalStore.setAnonKey(key);
        window.SUPABASE_CONFIG.ANON_KEY = key;
        this._setTestResult('', '⏳ 正在连接 Supabase...（第 1 步：初始化 SDK）');
        try {
            if (!window.SUPABASE_CONFIG || !window.SUPABASE_CONFIG.URL || !window.SUPABASE_CONFIG.ANON_KEY ||
                window.SUPABASE_CONFIG.ANON_KEY === 'YOUR_ANON_KEY_HERE') {
                throw new Error('配置缺失：URL 或 ANON_KEY 未填');
            }
            if (!window.CloudLocalStore) {
                if (window.CloudStorage) window.CloudLocalStore = window.CloudStorage;
                else throw new Error('云端 SDK 未加载，请检查浏览器控制台报错（如 CDN 被拦截）');
            }
            const initRes = window.CloudLocalStore.init();
            if (!initRes.ok) throw new Error('SDK 初始化失败：' + (initRes.error || '未知'));
            this._setTestResult('', '⏳ SDK OK，正在测试 vehicles 表查询权限（第 2 步）…');
            const client = window.CloudLocalStore.getClient && window.CloudLocalStore.getClient();
            let selectErrMsg = null;
            if (client) {
                try {
                    const { data, error } = await client.from('vehicles').select('id', { count: 'exact', head: true, timeout: 5000 });
                    if (error) selectErrMsg = 'vehicles 表查询失败：' + error.message;
                } catch (e) { selectErrMsg = 'vehicles 表异常：' + e.message; }
            } else {
                throw new Error('SDK init ok 但 getClient() 为空');
            }
            this._setTestResult('', '⏳ 查询 OK，正在测试 vehicles 表写入权限（第 3 步）…');
            let writeErrMsg = null;
            try {
                const testPlate = 'ZZ-TESTSYNC-' + Math.floor(Math.random()*100000);
                const { data, error } = await client.from('vehicles').insert({ plate_no: testPlate, model: 'SYNC_TEST_WRITE' }).select('id').maybeSingle();
                if (error) { writeErrMsg = 'vehicles 表写入失败：' + error.message; }
                else if (data && data.id) {
                    try { await client.from('vehicles').delete().eq('id', data.id); } catch(_) {}
                }
            } catch (e) { writeErrMsg = 'vehicles 写入异常：' + e.message; }
            this._setTestResult('', '⏳ 写入 OK，正在测试 Storage 桶 wyc-documents 是否可访问（第 4 步）…');
            let bucketMsg = 'BUCKET_OK';
            try {
                const { data, error } = await client.storage.from('wyc-documents').list('', { limit: 1, timeout: 5000 });
                if (error) bucketMsg = 'Storage 桶 wyc-documents 访问失败：' + error.message;
            } catch (e) { bucketMsg = 'Storage 异常：' + e.message; }
            if (selectErrMsg || writeErrMsg || bucketMsg.startsWith('Storage')) {
                const parts = [];
                if (selectErrMsg) parts.push('❌ ' + selectErrMsg);
                if (writeErrMsg) parts.push('❌ ' + writeErrMsg);
                if (bucketMsg.startsWith('Storage')) parts.push('❌ ' + bucketMsg);
                parts.push('👉 解决：在 Supabase SQL Editor 里粘贴这段 9 行授权 SQL 并 Run：\n' +
                    '  grant usage on schema public to postgres, anon, authenticated, service_role;\n' +
                    '  grant all privileges on all tables in schema public to postgres, anon, authenticated, service_role;\n' +
                    '  grant all privileges on all sequences in schema public to postgres, anon, authenticated, service_role;\n' +
                    '  grant all privileges on all functions in schema public to postgres, anon, authenticated, service_role;\n' +
                    '  alter default privileges in schema public grant all on tables to postgres, anon, authenticated, service_role;\n' +
                    '  alter default privileges in schema public grant all on sequences to postgres, anon, authenticated, service_role;\n' +
                    '  alter default privileges in schema public grant all on functions to postgres, anon, authenticated, service_role;\n' +
                    '  grant postgres to CURRENT_USER;');
                throw new Error(parts.join('\n'));
            }
            CloudSync.online = true;
            CloudUI.setStatus('online', '已连接');
            try { CloudSync._subscribeRealtime(); } catch(_) {}
            this._setTestResult('ok', '✅ 连接成功！4 表读写权限正常 / Storage 桶可访问（4/4 全通过）。点下面的按钮一键把本地数据传到云端吧。');
            this._refreshStepsUI();
            this._refreshMigrateSummary();
            const loaded = await CloudSync.loadCloudAndReplaceLocal(false);
            if (loaded.ok && AppData.getVehicles().length > 0) {
                Render.dashboard();
                if (Navigation.currentView === 'vehicles') Render.vehicleList();
            }
        } catch (e) {
            CloudSync.online = false;
            CloudUI.setStatus('error', '连接失败');
            const msg = (e && (e.message || String(e))) || '未知错误';
            const display = '❌ ' + (msg || '连接失败，请检查 anon key 或执行 init-db.sql');
            if (display.length > 600) this._setTestResult('fail', display.slice(0, 600) + '…');
            else this._setTestResult('fail', display);
        }
    },

    async _doMigrate() {
        if (!CloudSync.online) { Toast.show('还没连接上云端', 'warning'); return; }
        const summary = document.getElementById('migrateSummary');
        const btn = document.getElementById('btnDoMigrate');
        if (btn) { btn.disabled = true; btn.textContent = '⏳ 迁移中...'; }
        try {
            const res = await CloudSync.migrateLocalToCloud((cur, total, plate) => {
                if (summary) {
                    summary.innerHTML = `正在迁移第 <b style="color:#4f8cff;">${cur}/${total}</b> 台：<b>${plate}</b><br>（如果图片多会比较慢，耐心等待～）`;
                }
            });
            if (res && res.ok) {
                const ok = Number(res.okCount) || 0;
                const fail = Number(res.failCount) || 0;
                const imgNew = Number(res.imgNewUpload) || 0;
                const imgHad = Number(res.imgAlreadyCloud) || 0;
                const imgBad = Number(res.imgFail) || 0;
                let html = `✅ 迁移完成！车辆：成功 <b style="color:#2ed573;">${ok}</b> / 失败 <b style="color:#ff6b7a;">${fail}</b> 台<br>` +
                           `图片：新上传 <b style="color:#ffa94d;">${imgNew}</b> 张 / 已在云端（跳过）<b style="color:#2ed573;">${imgHad}</b> 张` +
                           (imgBad > 0 ? ` / 失败 <b style="color:#ff6b7a;">${imgBad}</b> 张` : '');
                if (res.error) {
                    const safe = (res.error || '').replace(/[<>&]/g, '').slice(0, 800);
                    html += `<br><span style="color:#ffa94d;font-size:12px;display:block;margin-top:8px;white-space:pre-wrap;">⚠️ ${safe}</span>`;
                }
                if (summary) summary.innerHTML = html;
                Toast.show(`迁移完成：${ok} 台车（新传 ${imgNew} / 已有 ${imgHad} 张图片）`, 'success', 5000);
                Render.dashboard();
                if (Navigation.currentView === 'vehicles') Render.vehicleList();
                else if (Navigation.currentView === 'detail' && Navigation.currentVehicleId) {
                    if (!AppData.getVehicleById(Navigation.currentVehicleId)) Navigation.switchView('vehicles');
                    else Render.vehicleDetail(Navigation.currentVehicleId);
                }
            } else {
                const msg = (res && res.error) ? String(res.error) : '未知错误';
                if (summary) summary.innerHTML = `<span style="color:#ff6b7a;">❌ 迁移出错：${msg.slice(0, 500)}</span>`;
                Toast.show('迁移出错：' + msg.slice(0, 80), 'error', 5000);
            }
        } catch (e) {
            const msg = (e && e.message) ? e.message : String(e);
            if (summary) summary.innerHTML = `<span style="color:#ff6b7a;">❌ 迁移异常：${msg.slice(0, 500)}</span>`;
            Toast.show('迁移异常：' + msg.slice(0, 80), 'error', 5000);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '📥 一键把本地数据传到云端'; }
        }
    },

    _setTestResult(cls, msg) {
        const el = document.getElementById('cloudTestResult');
        if (!el) return;
        el.className = '';
        if (cls) el.classList.add('test-' + cls);
        el.textContent = msg;
    }
};

const AppData = {
    data: LocalStore.load(),
    getAll() {
        return this.data;
    },
    getVehicles() {
        return this.data.vehicles || [];
    },
    getVehicleById(id) {
        return this.getVehicles().find(v => v.id === id);
    },
    async addVehicle(vehicle) {
        if (!AdminAuth.requireWrite('添加车辆')) return null;

        try {
            vehicle.id = 'v_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            vehicle.createdAt = new Date().toISOString();
            vehicle.images = vehicle.images || {};
            vehicle.rental = vehicle.rental || null;
            vehicle.insurance = vehicle.insurance || null;
            this.data.vehicles.push(vehicle);
            LocalStore.save(this.data);
            if (CloudSync.online) {
                const res = await CloudSync.pushVehicle(vehicle);
                if (res.ok && res.vehicle_id && vehicle.id !== res.vehicle_id) {
                    vehicle.id = res.vehicle_id;
                    LocalStore.save(this.data);
                }
            }
            return vehicle;
        } finally { }
    },
    async updateVehicle(id, updates, skipCloud = false) {
        if (!skipCloud && !AdminAuth.requireWrite('编辑车辆')) return null;

        try {
            const idx = this.data.vehicles.findIndex(v => v.id === id);
            if (idx === -1) return null;
            this.data.vehicles[idx] = { ...this.data.vehicles[idx], ...updates, updatedAt: new Date().toISOString() };
            LocalStore.save(this.data);
            const merged = this.data.vehicles[idx];
            if (!skipCloud) {
                if (CloudSync.online) {
                    const res = await CloudSync.pushVehicle(merged);
                    if (res.ok && res.vehicle_id && merged.id !== res.vehicle_id) {
                        merged.id = res.vehicle_id;
                        LocalStore.save(this.data);
                    }
                }
            }
            return merged;
        } finally { }
    },
    async deleteVehicle(id) {
        if (!AdminAuth.requireWrite('删除车辆')) return false;

        try {
            const before = this.data.vehicles.length;
            this.data.vehicles = this.data.vehicles.filter(v => v.id !== id);
            LocalStore.save(this.data);
            if (this.data.vehicles.length < before) {
                if (CloudSync.online) await CloudSync.removeVehicle(id);
                return true;
            }
            return false;
        } finally { }
    }
};

const DateUtils = {
    today() {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    },
    parse(dateStr) {
        if (!dateStr) return null;
        const parts = dateStr.split('-');
        if (parts.length === 3) {
            return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        }
        const d = new Date(dateStr);
        d.setHours(0, 0, 0, 0);
        return d;
    },
    daysBetween(dateStr) {
        const target = this.parse(dateStr);
        if (!target) return null;
        const today = this.today();
        const diff = Math.floor((target - today) / (1000 * 60 * 60 * 24));
        return diff;
    },
    getStatus(dateStr) {
        const days = this.daysBetween(dateStr);
        if (days === null) return { level: 'normal', days: null, label: '' };
        if (days < 0) return { level: 'danger', days, label: `已过期${-days}天` };
        if (days <= 7) return { level: 'danger', days, label: `${days}天后到期` };
        if (days <= 30) return { level: 'warning', days, label: `${days}天后到期` };
        return { level: 'normal', days, label: `${days}天后到期` };
    },
    format(dateStr) {
        if (!dateStr) return '—';
        const d = this.parse(dateStr);
        if (!d) return dateStr;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    todayISO() {
        const d = this.today();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    },
    addMonths(dateStr, months) {
        const d = this.parse(dateStr) || this.today();
        d.setMonth(d.getMonth() + months);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
};



const Toast = {
    el: null,
    timer: null,
    init() {
        this.el = document.getElementById('toast');
    },
    show(msg, type = 'success', duration = 2500) {
        if (!this.el) this.init();
        if (this.timer) clearTimeout(this.timer);
        this.el.className = 'toast toast-' + type + ' show';
        this.el.textContent = msg;
        this.timer = setTimeout(() => {
            this.el.classList.remove('show');
        }, duration);
    }
};

const ConfirmDialog = {
    callback: null,
    init() {
        document.getElementById('btnConfirmCancel').onclick = () => this.hide();
        document.getElementById('btnConfirmOk').onclick = () => {
            if (this.callback) this.callback();
            this.hide();
        };
    },
    show(title, text, onConfirm) {
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmText').textContent = text;
        this.callback = onConfirm;
        document.getElementById('confirmModal').classList.add('active');
    },
    hide() {
        document.getElementById('confirmModal').classList.remove('active');
        this.callback = null;
    }
};

const ImageViewer = {
    init() {
        document.getElementById('btnCloseImageModal').onclick = () => this.hide();
        document.getElementById('imageModal').onclick = (e) => {
            if (e.target.id === 'imageModal') this.hide();
        };
    },
    show(src) {
        document.getElementById('modalImage').src = src;
        document.getElementById('imageModal').classList.add('active');
    },
    hide() {
        document.getElementById('imageModal').classList.remove('active');
    }
};

const Navigation = {
    currentView: 'dashboard',
    currentFilter: 'all',
    currentVehicleId: null,
    searchKeyword: '',
    init() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.onclick = () => this.switchView(btn.dataset.view);
        });
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.currentFilter = btn.dataset.filter;
                if (this.currentView === 'vehicles') {
                    Render.vehicleList();
                } else if (this.currentView === 'dashboard') {
                    Render.dashboard();
                }
            };
        });
        document.getElementById('btnGotoAdd').onclick = () => {
            Forms.resetVehicleForm();
            this.switchView('add-vehicle');
        };
        document.getElementById('btnCancelForm').onclick = () => this.switchView('vehicles');
        document.getElementById('btnBack').onclick = () => this.switchView('vehicles');
        document.getElementById('searchInput').oninput = (e) => {
            this.searchKeyword = e.target.value.trim();
            if (this.currentView === 'vehicles') Render.vehicleList();
        };
    },
    switchView(view, vehicleId = null, options = {}) {
        this.currentView = view;
        this.currentVehicleId = vehicleId;
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === view || (view === 'detail' && btn.dataset.view === 'vehicles'));
        });
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
        const viewMap = {
            'dashboard': 'view-dashboard',
            'vehicles': 'view-vehicles',
            'add-vehicle': 'view-add-vehicle',
            'detail': 'view-detail',
            'statistics': 'view-statistics'
        };
        const targetId = viewMap[view] || 'view-vehicles';
        document.getElementById(targetId).classList.add('active-view');
        // 只有显式要求时才重置表单（防止编辑时被清空）
        if (options.resetForm) Forms.resetVehicleForm();
        if (view === 'dashboard') Render.dashboard();
        else if (view === 'vehicles') Render.vehicleList();
        else if (view === 'add-vehicle') {
            // add-vehicle 页面由调用方负责填充或重置
        }
        else if (view === 'detail' && vehicleId) Render.vehicleDetail(vehicleId);
        else if (view === 'statistics') Render.statistics();
    }
};

const Forms = {
    init() {
        document.getElementById('vehicleForm').onsubmit = (e) => {
            e.preventDefault();
            this.saveVehicle();
        };
    },
    resetVehicleForm() {
        document.getElementById('vehicleForm').reset();
        document.getElementById('vehicleId').value = '';
        document.getElementById('annualInspectionDate').value = '';
        document.getElementById('managementFeeDate').value = '';
        document.getElementById('formTitle').textContent = '添加车辆';
    },
    fillVehicleForm(vehicle) {
        document.getElementById('vehicleId').value = vehicle.id;
        document.getElementById('plateNumber').value = vehicle.plateNumber || '';
        document.getElementById('carModel').value = vehicle.carModel || '';
        document.getElementById('ownerName').value = vehicle.ownerName || '';
        document.getElementById('ownerPhone').value = vehicle.ownerPhone || '';
        // 押金已移到租赁信息表单
        document.getElementById('annualInspectionDate').value = vehicle.annualInspectionDate || '';
        document.getElementById('managementFeeDate').value = vehicle.managementFeeDate || '';
        document.getElementById('formTitle').textContent = '编辑车辆信息';
    },
    async saveVehicle() {
        const id = document.getElementById('vehicleId').value;
        const payload = {
            plateNumber: document.getElementById('plateNumber').value.trim().toUpperCase(),
            carModel: document.getElementById('carModel').value.trim(),
            ownerName: document.getElementById('ownerName').value.trim(),
            ownerPhone: document.getElementById('ownerPhone').value.trim(),
            // 押金已移到租赁信息
            annualInspectionDate: document.getElementById('annualInspectionDate').value || '',
            managementFeeDate: document.getElementById('managementFeeDate').value || '',
        };
        if (!payload.plateNumber || !payload.carModel || !payload.ownerName || !payload.ownerPhone) {
            Toast.show('请填写所有必填项', 'warning');
            return;
        }
        if (id) {
            const updated = await AppData.updateVehicle(id, payload);
            Toast.show('车辆信息已更新');
            Navigation.switchView('detail', id);
        } else {
            const v = await AppData.addVehicle(payload);
            Toast.show('车辆添加成功');
            Navigation.switchView('detail', v.id);
        }
    }
};

const Render = {
    dashboard() {
        const vehicles = AppData.getVehicles();
        const filter = Navigation.currentFilter;
        let filteredVehicles = vehicles;
        if (filter === 'rent-due') {
            filteredVehicles = vehicles.filter(v => v.rental && DateUtils.getStatus(v.rental.nextPayDate).level !== 'normal');
        } else if (filter === 'insurance-due') {
            filteredVehicles = vehicles.filter(v => v.insurance && DateUtils.getStatus(v.insurance.endDate).level !== 'normal');
        }
        let rentDueCount = 0, insDueCount = 0, driverCount = 0;
        const alerts = [];
        vehicles.forEach(v => {
            if (v.rental) {
                driverCount++;
                const s = DateUtils.getStatus(v.rental.nextPayDate);
                if (s.level !== 'normal') {
                    rentDueCount++;
                    if (s.level === 'danger' || s.days <= 15) {
                        alerts.push({ type: s.level, icon: '💰', title: `租金即将到期 - ${v.plateNumber}`, desc: `司机：${v.rental.driverName || '—'} | 下次支付：${DateUtils.format(v.rental.nextPayDate)} (${s.label})`, vehicleId: v.id });
                    }
                }
            }
            if (v.insurance) {
                const s = DateUtils.getStatus(v.insurance.endDate);
                if (s.level !== 'normal') {
                    insDueCount++;
                    if (s.level === 'danger' || s.days <= 15) {
                        alerts.push({ type: s.level, icon: '🛡️', title: `保险即将到期 - ${v.plateNumber}`, desc: `${v.insurance.company || '—'} | 到期日：${DateUtils.format(v.insurance.endDate)} (${s.label})`, vehicleId: v.id });
                    }
                }
            }
            if (v.annualInspectionDate) {
                const s = DateUtils.getStatus(v.annualInspectionDate);
                if (s.level !== 'normal') {
                    if (s.level === 'danger' || s.days <= 30) { // 年检提前30天提醒
                        alerts.push({ type: s.level, icon: '📅', title: `年检即将到期 - ${v.plateNumber}`, desc: `到期日：${DateUtils.format(v.annualInspectionDate)} (${s.label})`, vehicleId: v.id });
                    }
                }
            }
            if (v.managementFeeDate) {
                const s = DateUtils.getStatus(v.managementFeeDate);
                if (s.level !== 'normal') {
                    if (s.level === 'danger' || s.days <= 30) { // 管理费提前30天提醒
                        alerts.push({ type: s.level, icon: '💼', title: `管理费即将到期 - ${v.plateNumber}`, desc: `到期日：${DateUtils.format(v.managementFeeDate)} (${s.label})`, vehicleId: v.id });
                    }
                }
            }
        });
        document.getElementById('dashTotal').textContent = filteredVehicles.length;
        document.getElementById('dashRentDue').textContent = rentDueCount;
        document.getElementById('dashInsDue').textContent = insDueCount;
        document.getElementById('dashDrivers').textContent = driverCount;
        document.getElementById('statTotal').textContent = vehicles.length;
        document.getElementById('statRentDue').textContent = rentDueCount;
        document.getElementById('statInsDue').textContent = insDueCount;
        const alertList = document.getElementById('alertList');
        if (alerts.length === 0) {
            alertList.innerHTML = '<div class="empty-alert">✅ 暂无紧急提醒，一切正常！</div>';
        } else {
            alerts.sort((a, b) => {
                const order = { danger: 0, warning: 1 };
                return (order[a.type] ?? 2) - (order[b.type] ?? 2);
            });
            alertList.innerHTML = alerts.map(a => `
                <div class="alert-item alert-${a.type}">
                    <div class="alert-icon">${a.icon}</div>
                    <div class="alert-content">
                        <div class="alert-title">${a.title}</div>
                        <div class="alert-desc">${a.desc}</div>
                    </div>
                    <button class="alert-action" onclick="Navigation.switchView('detail', '${a.vehicleId}')">查看</button>
                </div>
            `).join('');
        }
    },
    vehicleList() {
        const vehicles = AppData.getVehicles();
        const keyword = Navigation.searchKeyword.toLowerCase();
        const filter = Navigation.currentFilter;
        let list = vehicles.slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        if (keyword) {
            list = list.filter(v => {
                return (v.plateNumber || '').toLowerCase().includes(keyword)
                    || (v.ownerName || '').toLowerCase().includes(keyword)
                    || (v.carModel || '').toLowerCase().includes(keyword)
                    || (v.rental && v.rental.driverName || '').toLowerCase().includes(keyword)
                    || (v.ownerPhone || '').includes(keyword)
                    || (v.rental && v.rental.driverPhone || '').includes(keyword);
            });
        }
        if (filter === 'rent-due') {
            list = list.filter(v => v.rental && DateUtils.getStatus(v.rental.nextPayDate).level !== 'normal');
        } else if (filter === 'insurance-due') {
            list = list.filter(v => v.insurance && DateUtils.getStatus(v.insurance.endDate).level !== 'normal');
        }
        const container = document.getElementById('vehicleList');
        if (list.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🚗</div>
                    <div class="empty-text">${keyword ? '没有找到匹配的车辆' : '暂无车辆记录，点击"添加车辆"开始'}</div>
                </div>`;
            return;
        }
        container.innerHTML = list.map(v => this._vehicleCardHTML(v)).join('');
    },
    _vehicleCardHTML(v) {
        const rentStatus = v.rental ? DateUtils.getStatus(v.rental.nextPayDate) : { level: 'normal' };
        const insStatus = v.insurance ? DateUtils.getStatus(v.insurance.endDate) : { level: 'normal' };
        const levelOrder = { danger: 3, warning: 2, normal: 1 };
        const overall = Math.max(levelOrder[rentStatus.level], levelOrder[insStatus.level]);
        const statusClass = overall === 3 ? 'status-danger' : overall === 2 ? 'status-warning' : '';
        let badge = '';
        if (overall === 3) badge = '<span class="status-badge badge-danger">⚠️ 紧急</span>';
        else if (overall === 2) badge = '<span class="status-badge badge-warning">⏰ 注意</span>';
        const rentRow = v.rental ? `
            <div class="due-row due-${rentStatus.level}">
                <span class="info-label">下次租金</span>
                <span class="due-date">${DateUtils.format(v.rental.nextPayDate)}${rentStatus.level !== 'normal' ? ' · ' + rentStatus.label : ''}</span>
            </div>` : `
            <div class="due-row">
                <span class="info-label">租赁状态</span>
                <span class="info-value" style="color: var(--text-muted);">未出租</span>
            </div>`;
        const insRow = v.insurance ? `
            <div class="due-row due-${insStatus.level}">
                <span class="info-label">保险到期</span>
                <span class="due-date">${DateUtils.format(v.insurance.endDate)}${insStatus.level !== 'normal' ? ' · ' + insStatus.label : ''}</span>
            </div>` : `
            <div class="due-row">
                <span class="info-label">保险</span>
                <span class="info-value" style="color: var(--text-muted);">未录入</span>
            </div>`;
        return `
            <div class="vehicle-card ${statusClass}" onclick="Navigation.switchView('detail', '${v.id}')">
                ${badge}
                <div class="vehicle-plate">${v.plateNumber || '—'}</div>
                <div class="vehicle-model">${v.carModel || '—'}</div>
                <div class="info-row">
                    <span class="info-label">车主</span>
                    <span class="info-value">${v.ownerName || '—'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">车主电话</span>
                    <span class="info-value">${v.ownerPhone || '—'}</span>
                </div>
                ${v.rental ? `
                <div class="info-row">
                    <span class="info-label">司机</span>
                    <span class="info-value">${v.rental.driverName || '—'}</span>
                </div>` : ''}
                <div class="due-info">
                    ${rentRow}
                    ${insRow}
                </div>
            </div>
        `;
    },
    vehicleDetail(id) {
        const v = AppData.getVehicleById(id);
        if (!v) {
            Toast.show('车辆不存在', 'error');
            Navigation.switchView('vehicles');
            return;
        }
        Navigation.currentVehicleId = id;
        document.getElementById('detailTitle').textContent = `车辆详情 · ${v.plateNumber}`;
        const rentStatus = v.rental ? DateUtils.getStatus(v.rental.nextPayDate) : null;
        const insStatus = v.insurance ? DateUtils.getStatus(v.insurance.endDate) : null;
        const content = `
            <div class="detail-layout">
                ${this._detailBasicCard(v)}
                ${this._detailRentalCard(v, rentStatus)}
                ${this._detailInsuranceCard(v, insStatus)}
                ${this._detailImagesCard(v)}
            </div>
        `;
        document.getElementById('detailContent').innerHTML = content;
        this._bindDetailEvents(v);
        // 云同步 + 管理员解锁才渲染证件图（带 60 秒签名 URL），防止截图 / 复制 URL 泄露
        setTimeout(() => this._resolveDocUrls(v.id), 50);
    },
    async _resolveDocUrls(vehicleId) {
        const v = AppData.getVehicleById(vehicleId);
        if (!v || !v.images) return;
        if (!AdminAuth.isUnlocked()) return; // 只读模式不加载真实证件图，上面渲染的是占位
        const store = window.CloudLocalStore || window.CloudStorage;
        if (!store || !CloudSync.online || !store.isReady()) return;
        const imgs = { ...(v.images || {}) };
        let changed = false;
        const allKeys = Object.keys(imgs);
        for (let i = 0; i < allKeys.length; i++) {
            const k = allKeys[i];
            const orig = imgs[k];
            if (!orig || typeof orig !== 'string' || orig.startsWith('data:') || orig.indexOf('signed_url') > -1 || orig.indexOf('token=') > -1) continue;
            try {
                const signed = await store.getSignedUrl(orig, 60);
                if (signed) { imgs[k] = signed; changed = true; }
            } catch (_) {}
        }
        if (changed && Navigation.currentView === 'detail' && Navigation.currentVehicleId === vehicleId) {
            AppData.updateVehicle(vehicleId, { images: imgs }, true); // true = skipCloud 不反写云，只换本页显示
            const v2 = AppData.getVehicleById(vehicleId);
            const rentStatus = v2.rental ? DateUtils.getStatus(v2.rental.nextPayDate) : null;
            const insStatus = v2.insurance ? DateUtils.getStatus(v2.insurance.endDate) : null;
            const rebuild = `
                <div class="detail-layout">
                    ${this._detailBasicCard(v2)}
                    ${this._detailRentalCard(v2, rentStatus)}
                    ${this._detailInsuranceCard(v2, insStatus)}
                    ${this._detailImagesCard(v2)}
                </div>
            `;
            document.getElementById('detailContent').innerHTML = rebuild;
            this._bindDetailEvents(v2);
            setTimeout(() => this._bindImageViewerFallbacks(vehicleId), 30);
        } else {
            this._bindImageViewerFallbacks(vehicleId);
        }
    },
    _bindImageViewerFallbacks(vehicleId) {
        const v = AppData.getVehicleById(vehicleId);
        if (!v || !v.images) return;
        const imgs = v.images;
        const store = window.CloudLocalStore || window.CloudStorage;
        const isCloud = CloudSync.online && store && store.isReady() && AdminAuth.isUnlocked();
        Object.keys(imgs).forEach(async slot => {
            const orig = imgs[slot];
            if (!orig || typeof orig !== 'string') return;
            const isPDF = orig.startsWith('data:application/pdf') || /\.pdf($|\?)/i.test(orig);
            const slotImgEls = document.querySelectorAll(`.detail-layout img, .detail-layout .pdf-slot`);
            slotImgEls.forEach(async (el) => {
                let needReplace = false;
                if (el.tagName === 'IMG' && el.getAttribute('data-slot') === slot && !el.getAttribute('src')) {
                    needReplace = true;
                }
                if (needReplace && isCloud && !orig.startsWith('data:')) {
                    try {
                        const signed = await store.getSignedUrl(orig, 60);
                        if (signed) el.setAttribute('src', signed);
                    } catch (_) { el.setAttribute('src', orig); }
                } else if (needReplace) {
                    el.setAttribute('src', orig);
                }
            });
        });
    },
    _detailBasicCard(v) {
        return `
            <div class="detail-card">
                <div class="detail-card-header">
                    <div class="detail-card-title"><span class="detail-card-title-icon">🚙</span>车辆与车主信息</div>
                    <div class="detail-actions">
                        <button class="icon-btn write-only" title="编辑" onclick="Render.editVehicle('${v.id}')">✏️</button>
                        <button class="icon-btn danger write-only" title="删除" onclick="Render.deleteVehicle('${v.id}')">🗑️</button>
                    </div>
                </div>
                <div class="info-grid">
                    <div class="info-cell">
                        <div class="info-cell-label">车牌号</div>
                        <div class="info-cell-value" style="color: var(--accent-primary); font-size:20px;">${v.plateNumber}</div>
                    </div>
                    <div class="info-cell">
                        <div class="info-cell-label">车型</div>
                        <div class="info-cell-value">${v.carModel}</div>
                    </div>
                    <div class="info-cell">
                        <div class="info-cell-label">车主姓名</div>
                        <div class="info-cell-value">${v.ownerName}</div>
                    </div>
                    <div class="info-cell">
                        <div class="info-cell-label">车主电话</div>
                        <div class="info-cell-value"><a href="tel:${v.ownerPhone}" style="color:var(--accent-primary);">${v.ownerPhone}</a></div>
                    </div>
                    <div class="info-cell">
                        <div class="info-cell-label">年检日期</div>
                        <div class="info-cell-value">${DateUtils.format(v.annualInspectionDate)}</div>
                    </div>
                    <div class="info-cell">
                        <div class="info-cell-label">管理费日期</div>
                        <div class="info-cell-value">${DateUtils.format(v.managementFeeDate)}</div>
                    </div>
                </div>
            </div>
        `;
    },
    _detailRentalCard(v, status) {
        const r = v.rental;
        const cardClass = status?.level === 'danger' ? 'status-danger-card' : status?.level === 'warning' ? 'status-warning-card' : '';
        if (!r) {
            return `
                <div class="detail-card">
                    <div class="detail-card-header">
                        <div class="detail-card-title"><span class="detail-card-title-icon">👤</span>租赁信息</div>
                    </div>
                    <div class="empty-placeholder">暂未录入租赁司机信息
                        <button class="secondary-btn add-placeholder-btn write-only" onclick="Render.showRentalForm('${v.id}')">+ 添加租赁信息</button>
                    </div>
                </div>
                <div class="detail-card" id="rentalFormCard" style="display:none;"></div>
            `;
        }
        const dateHL = status?.level === 'danger' ? 'highlight-danger' : status?.level === 'warning' ? 'highlight-warning' : '';
        const daysBadge = status && status.level !== 'normal' ? `<span class="days-badge days-${status.level}">${status.label}</span>` : '';
        return `
            <div class="detail-card ${cardClass}">
                <div class="detail-card-header">
                    <div class="detail-card-title"><span class="detail-card-title-icon">👤</span>租赁信息</div>
                    <div class="detail-actions">
                        <button class="icon-btn write-only" title="续租+1月" onclick="Render.renewRental('${v.id}')">➕</button>
                        <button class="icon-btn write-only" title="编辑" onclick="Render.showRentalForm('${v.id}')">✏️</button>
                        <button class="icon-btn danger write-only" title="删除" onclick="Render.deleteRental('${v.id}')">🗑️</button>
                    </div>
                </div>
                <div class="info-grid">
                    <div class="info-cell">
                        <div class="info-cell-label">司机姓名</div>
                        <div class="info-cell-value">${r.driverName || '—'}</div>
                    </div>
                    <div class="info-cell">
                        <div class="info-cell-label">司机电话</div>
                        <div class="info-cell-value">${r.driverPhone ? `<a href="tel:${r.driverPhone}" style="color:var(--accent-primary);">${r.driverPhone}</a>` : '—'}</div>
                    </div>
                    <div class="info-cell">
                        <div class="info-cell-label">租赁开始日期</div>
                        <div class="info-cell-value">${DateUtils.format(r.startDate)}</div>
                    </div>
                    <div class="info-cell">
                        <div class="info-cell-label">月租金（元）</div>
                        <div class="info-cell-value" style="color:var(--warning-text);">¥ ${Number(r.monthlyRent || 0).toLocaleString()}</div>
                    </div>
                    <div class="info-cell">
                        <div class="info-cell-label">师傅押金（元）</div>
                        <div class="info-cell-value">¥ ${Number((r.driverDeposit ?? v.driverDeposit) || 0).toLocaleString()}</div>
                    </div>
                    <div class="info-cell">
                        <div class="info-cell-label">租赁期限（月）</div>
                        <div class="info-cell-value">${r.rentalTermMonths ? `${r.rentalTermMonths}个月` : '—'}</div>
                    </div>
                    <div class="info-cell" style="grid-column: span 2;">
                        <div class="info-cell-label">下次支付租金日期 ${daysBadge}</div>
                        <div class="info-cell-value ${dateHL}">${DateUtils.format(r.nextPayDate)}</div>
                    </div>
                </div>
                <div class="inline-form" id="rentalFormCard" style="display:none; margin-top:20px;"></div>
            </div>
        `;
    },
    _detailInsuranceCard(v, status) {
        const ins = v.insurance;
        const cardClass = status?.level === 'danger' ? 'status-danger-card' : status?.level === 'warning' ? 'status-warning-card' : '';
        if (!ins) {
            return `
                <div class="detail-card">
                    <div class="detail-card-header">
                        <div class="detail-card-title"><span class="detail-card-title-icon">🛡️</span>保险信息</div>
                    </div>
                    <div class="empty-placeholder">暂未录入保险信息
                        <button class="secondary-btn add-placeholder-btn write-only" onclick="Render.showInsuranceForm('${v.id}')">+ 添加保险信息</button>
                    </div>
                </div>
                <div class="detail-card" id="insuranceFormCard" style="display:none;"></div>
            `;
        }
        const dateHL = status?.level === 'danger' ? 'highlight-danger' : status?.level === 'warning' ? 'highlight-warning' : '';
        const daysBadge = status && status.level !== 'normal' ? `<span class="days-badge days-${status.level}">${status.label}</span>` : '';
        const insSlots = [
            { key: 'insurance_policy_photo', label: '保险单正本照片', hint: '图片/扫描件', icon: '📸' },
            { key: 'insurance_policy_doc', label: '电子保单 PDF', hint: '保险公司电子件 .PDF', icon: '📕' }
        ];
        const insDocGrid = insSlots.map(s => Render._renderDocSlot(v, s)).join('');
        return `
            <div class="detail-card ${cardClass}">
                <div class="detail-card-header">
                    <div class="detail-card-title"><span class="detail-card-title-icon">🛡️</span>保险信息</div>
                    <div class="detail-actions">
                        <button class="icon-btn write-only" title="编辑" onclick="Render.showInsuranceForm('${v.id}')">✏️</button>
                        <button class="icon-btn danger write-only" title="删除" onclick="Render.deleteInsurance('${v.id}')">🗑️</button>
                    </div>
                </div>
                <div class="info-grid">
                    <div class="info-cell">
                        <div class="info-cell-label">保险公司</div>
                        <div class="info-cell-value">${ins.company || '—'}</div>
                    </div>
                    <div class="info-cell">
                        <div class="info-cell-label">保险金额（元）</div>
                        <div class="info-cell-value">¥ ${Number(ins.amount || 0).toLocaleString()}</div>
                    </div>
                    <div class="info-cell" style="grid-column: span 2;">
                        <div class="info-cell-label">保险到期日期 ${daysBadge}</div>
                        <div class="info-cell-value ${dateHL}">${DateUtils.format(ins.endDate)}</div>
                    </div>
                </div>
                <div style="margin-top:18px;padding-top:16px;border-top:1px dashed rgba(255,255,255,.08);">
                    <div style="font-weight:600;margin-bottom:12px;color:var(--text-primary);display:flex;align-items:center;gap:8px;">
                        <span>📕 保险单凭证上传</span>
                        <span style="font-weight:400;font-size:12px;color:var(--text-secondary);">支持：JPG / PNG / WEBP / BMP 图片 + PDF 电子保单（PDF 最大 15MB）</span>
                    </div>
                    <div class="image-grid">${insDocGrid}</div>
                </div>
                <div class="inline-form" id="insuranceFormCard" style="display:none; margin-top:20px;"></div>
            </div>
        `;
    },
    _renderDocSlot(v, s) {
        const images = v.images || {};
        const url = images[s.key];
        const isUnlocked = AdminAuth.isUnlocked();
        if (!url) {
            return `
                <div class="image-slot write-only" onclick="event.stopPropagation(); document.getElementById('file_${s.key}_${v.id}').click();">
                    <input type="file" id="file_${s.key}_${v.id}" accept="image/*,application/pdf" style="display:none;" onchange="Render.uploadFile(event, '${v.id}', '${s.key}', this.files?.[0]?.name || '${s.label || s.key}')">
                    <div class="image-slot-icon">${s.icon || '📷'}</div>
                    <div class="image-slot-label">${s.label}<br><span style="font-size:11px;opacity:0.7;">${s.hint || '点击上传'}</span></div>
                </div>
            `;
        }
        const isPDF = typeof url === 'string' && (url.startsWith('data:application/pdf') || url.toLowerCase().endsWith('.pdf') || (url.includes('/documents/') && url.toLowerCase().indexOf('.pdf?') > -1) || (url.includes('/storage/') && url.toLowerCase().indexOf('.pdf') > -1));
        // 🔒 未解锁时隐藏真实内容，显示模糊占位，防止路人看身份证
        const needPlaceholder = !isUnlocked && !url.startsWith('data:') && CloudSync.online && s.key && (s.key.indexOf('id_') > -1 || s.key.indexOf('license') > -1 || s.key.indexOf('insurance') > -1 || s.key.indexOf('policy') > -1 || s.key.indexOf('photo') > -1 || s.key.indexOf('doc') > -1);
        if (needPlaceholder) {
            return `
                <div class="image-slot has-image" onclick="event.stopPropagation(); AdminAuth && AdminAuth.requireWrite && AdminAuth.requireWrite('查看证件资料');">
                    <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:10px;background:rgba(10,14,24,0.75);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);color:#fff;z-index:5;">
                        <div style="font-size:44px;opacity:0.85;">🔒</div>
                        <div style="font-weight:600;font-size:13px;">已锁定 · 需管理员解锁</div>
                        <div style="font-size:11px;opacity:0.7;text-align:center;max-width:80%;padding:0 8px;">右上角点「🔒 只读」登录管理员<br>解锁后才能查看证件资料</div>
                    </div>
                    <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.75);padding:4px 8px;font-size:11px;color:#fff;text-align:center;z-index:6;">${s.label}</div>
                </div>
            `;
        }
        if (isPDF) {
            return `
                <div class="image-slot has-image pdf-slot" onclick="event.stopPropagation()">
                    <div class="pdf-icon-wrap"><div class="pdf-icon">📕</div></div>
                    <div style="padding:10px 12px 12px;flex:1;display:flex;flex-direction:column;justify-content:center;">
                        <div style="font-weight:600;font-size:13px;color:#fff;line-height:1.4;word-break:break-all;">${s.label}</div>
                        <div style="font-size:11px;color:#ffd43b;margin-top:4px;opacity:0.9;">PDF 电子保单</div>
                    </div>
                    <div class="image-slot-overlay" style="gap:6px;">
                        <button class="overlay-btn" onclick="Render.openFile('${url}', '${s.label}')">打开/下载</button>
                        <button class="overlay-btn danger write-only" onclick="Render.deleteFile('${v.id}', '${s.key}')">删除</button>
                    </div>
                </div>
            `;
        }
        return `
            <div class="image-slot has-image" onclick="event.stopPropagation()">
                <img src="${url}" alt="${s.label}" data-slot="${s.key}" loading="lazy" onerror="this.style.opacity='0.15';this.style.filter='blur(4px)';">
                <div class="image-slot-overlay">
                    <button class="overlay-btn" onclick="ImageViewer.show('${url}')">查看</button>
                    <button class="overlay-btn danger write-only" onclick="Render.deleteFile('${v.id}', '${s.key}')">删除</button>
                </div>
                <div style="position:absolute;bottom:0;left:0;right:0;background:rgba(0,0,0,0.75);padding:4px 8px;font-size:11px;color:#fff;text-align:center;">${s.label}</div>
            </div>
        `;
    },
    _detailImagesCard(v) {
        const slots = [
            { key: 'owner_id_front', label: '车主身份证正面' },
            { key: 'owner_id_back', label: '车主身份证反面' },
            { key: 'driver_id_front', label: '司机身份证正面' },
            { key: 'driver_id_back', label: '司机身份证反面' },
            { key: 'driver_license_front', label: '驾驶证正本' },
            { key: 'driver_license_back', label: '驾驶证副本' }
        ];
        const gridHTML = slots.map(s => Render._renderDocSlot(v, { key: s.key, label: s.label, icon: '📷', hint: '图片 / PDF 扫描件' })).join('');
        return `
            <div class="detail-card">
                <div class="detail-card-header">
                    <div class="detail-card-title"><span class="detail-card-title-icon">📁</span>证件图片管理</div>
                    <div style="font-weight:400;font-size:12px;color:var(--text-secondary);">支持：JPG / PNG / WEBP / BMP 图片 + PDF 扫描件（PDF 最大 15MB）</div>
                </div>
                <div class="image-grid">
                    ${gridHTML}
                </div>
            </div>
        `;
    },
    _bindDetailEvents(v) {
    },
    editVehicle(id) {
        if (!AdminAuth.requireWrite('编辑车辆')) return;
        const v = AppData.getVehicleById(id);
        if (!v) return;
        Forms.fillVehicleForm(v);
        Navigation.switchView('add-vehicle');
    },
    deleteVehicle(id) {
        if (!AdminAuth.requireWrite('删除车辆')) return;
        const v = AppData.getVehicleById(id);
        if (!v) return;
        ConfirmDialog.show('删除车辆', `确定要删除车辆 ${v.plateNumber} 吗？所有关联的租赁、保险和图片数据都将被删除，此操作不可撤销！`, () => {
            AppData.deleteVehicle(id);
            Toast.show('车辆已删除');
            Navigation.switchView('vehicles');
        });
    },
    showRentalForm(id) {
        if (!AdminAuth.requireWrite('编辑租赁信息')) return;
        const v = AppData.getVehicleById(id);
        if (!v) return;
        const r = v.rental || {};
        const card = document.getElementById('rentalFormCard');
        card.style.display = 'block';
        card.innerHTML = `
            <div style="font-weight:600;margin-bottom:14px;color:var(--text-primary);">${v.rental ? '编辑' : '添加'}租赁信息</div>
            <div class="form-grid">
                <div class="form-item">
                    <label class="form-label">司机姓名 <span class="required">*</span></label>
                    <input type="text" id="r_driverName" class="form-input" value="${r.driverName || ''}" placeholder="请输入司机姓名">
                </div>
                <div class="form-item">
                    <label class="form-label">司机电话 <span class="required">*</span></label>
                    <input type="tel" id="r_driverPhone" class="form-input" value="${r.driverPhone || ''}" placeholder="请输入联系电话">
                </div>
                <div class="form-item">
                    <label class="form-label">租赁开始日期 <span class="required">*</span></label>
                    <input type="date" id="r_startDate" class="form-input" value="${r.startDate || DateUtils.todayISO()}" onchange="Render.autoCalcNextPayDate()">
                </div>
                <div class="form-item">
                    <label class="form-label">月租金（元） <span class="required">*</span></label>
                    <input type="number" id="r_monthlyRent" class="form-input" value="${r.monthlyRent || ''}" placeholder="如：4500">
                </div>
                <div class="form-item">
                    <label class="form-label">租赁期限（月）</label>
                    <input type="number" id="r_rentalTermMonths" class="form-input" value="${r.rentalTermMonths || ''}" placeholder="如：12" onchange="Render.autoCalcNextPayDate()">
                </div>
                <div class="form-item">
                    <label class="form-label">师傅押金（元）</label>
                    <input type="number" id="r_driverDeposit" class="form-input" value="${r.driverDeposit || 0}" placeholder="如：5000">
                </div>
                <div class="form-item">
                    <label class="form-label">下次支付日期 <span class="required">*</span></label>
                    <input type="date" id="r_nextPayDate" class="form-input" value="${r.nextPayDate || DateUtils.addMonths(DateUtils.todayISO(), 1)}" onchange="Render.markNextPayDateManual()" oninput="Render.markNextPayDateManual()">
                    <div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">💡 填写租赁开始日期后自动填充，可手动调整</div>
                </div>
            </div>
            <div class="form-actions">
                <button class="cancel-btn write-only" onclick="document.getElementById('rentalFormCard').style.display='none'">取消</button>
                <button class="primary-btn write-only" onclick="Render.saveRental('${id}')">保存</button>
            </div>
        `;
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    // 自动计算下次支付日期（开始日期 + 租赁期限月数）
    autoCalcNextPayDate() {
        const startDateEl = document.getElementById('r_startDate');
        const nextPayDateEl = document.getElementById('r_nextPayDate');
        const termEl = document.getElementById('r_rentalTermMonths');
        if (!startDateEl || !nextPayDateEl) return;
        const startDate = startDateEl.value;
        if (!startDate) return;
        // 如果用户还没手动修改过，就自动同步
        if (!nextPayDateEl.value || nextPayDateEl.dataset.auto === '1') {
            // 默认顺延 1 个月（次月同日）；如果填了租赁期限，则按期限顺延
            let months = 1;
            if (termEl && termEl.value && parseInt(termEl.value) > 0) {
                months = parseInt(termEl.value);
            }
            nextPayDateEl.value = DateUtils.addMonths(startDate, months);
            nextPayDateEl.dataset.auto = '1';
        }
    },
    // 标记用户手动修改了下次支付日期
    markNextPayDateManual() {
        const el = document.getElementById('r_nextPayDate');
        if (el) el.dataset.auto = '0';
    },
    saveRental(id) {
        if (!AdminAuth.requireWrite('保存租赁信息')) return;
        const payload = {
            driverName: document.getElementById('r_driverName').value.trim(),
            driverPhone: document.getElementById('r_driverPhone').value.trim(),
            startDate: document.getElementById('r_startDate').value,
            monthlyRent: parseFloat(document.getElementById('r_monthlyRent').value) || 0,
            rentalTermMonths: parseFloat(document.getElementById('r_rentalTermMonths').value) || 0,
            driverDeposit: parseFloat(document.getElementById('r_driverDeposit').value) || 0,
            nextPayDate: document.getElementById('r_nextPayDate').value
        };
        if (!payload.driverName || !payload.driverPhone || !payload.startDate || !payload.nextPayDate) {
            Toast.show('请填写所有必填项', 'warning');
            return;
        }
        AppData.updateVehicle(id, { rental: payload });
        Toast.show('租赁信息已保存');
        this.vehicleDetail(id);
    },
    renewRental(id) {
        if (!AdminAuth.requireWrite('续租操作')) return;
        const v = AppData.getVehicleById(id);
        if (!v || !v.rental) return;
        const newDate = DateUtils.addMonths(v.rental.nextPayDate, 1);
        ConfirmDialog.show('确认续租', `将下次支付日期从 ${DateUtils.format(v.rental.nextPayDate)} 延后一个月至 ${newDate}，是否确认？`, () => {
            const updated = { ...v.rental, nextPayDate: newDate };
            AppData.updateVehicle(id, { rental: updated });
            Toast.show('已完成续租，下次支付日期 +1 个月');
            this.vehicleDetail(id);
        });
    },
    deleteRental(id) {
        if (!AdminAuth.requireWrite('删除租赁信息')) return;
        const v = AppData.getVehicleById(id);
        if (!v || !v.rental) return;
        ConfirmDialog.show('删除租赁信息', '确定删除该车辆的租赁司机信息吗？', () => {
            AppData.updateVehicle(id, { rental: null });
            Toast.show('租赁信息已删除');
            this.vehicleDetail(id);
        });
    },
    showInsuranceForm(id) {
        if (!AdminAuth.requireWrite('编辑保险信息')) return;
        const v = AppData.getVehicleById(id);
        if (!v) return;
        const ins = v.insurance || {};
        const card = document.getElementById('insuranceFormCard');
        card.style.display = 'block';
        card.innerHTML = `
            <div style="font-weight:600;margin-bottom:14px;color:var(--text-primary);">${v.insurance ? '编辑' : '添加'}保险信息</div>
            <div class="form-grid">
                <div class="form-item">
                    <label class="form-label">保险公司 <span class="required">*</span></label>
                    <input type="text" id="i_company" class="form-input" value="${ins.company || ''}" placeholder="如：中国平安">
                </div>
                <div class="form-item">
                    <label class="form-label">保险金额（元）</label>
                    <input type="number" id="i_amount" class="form-input" value="${ins.amount || ''}" placeholder="如：5000">
                </div>
                <div class="form-item" style="grid-column: span 2;">
                    <label class="form-label">保险到期日期 <span class="required">*</span></label>
                    <input type="date" id="i_endDate" class="form-input" value="${ins.endDate || DateUtils.addMonths(DateUtils.todayISO(), 12)}">
                </div>
            </div>
            <div class="form-actions">
                <button class="cancel-btn write-only" onclick="document.getElementById('insuranceFormCard').style.display='none'">取消</button>
                <button class="primary-btn write-only" onclick="Render.saveInsurance('${id}')">保存</button>
            </div>
        `;
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    saveInsurance(id) {
        if (!AdminAuth.requireWrite('保存保险信息')) return;
        const payload = {
            company: document.getElementById('i_company').value.trim(),
            amount: parseFloat(document.getElementById('i_amount').value) || 0,
            endDate: document.getElementById('i_endDate').value
        };
        if (!payload.company || !payload.endDate) {
            Toast.show('请填写必填项', 'warning');
            return;
        }
        AppData.updateVehicle(id, { insurance: payload });
        Toast.show('保险信息已保存');
        this.vehicleDetail(id);
    },
    deleteInsurance(id) {
        if (!AdminAuth.requireWrite('删除保险信息')) return;
        ConfirmDialog.show('删除保险信息', '确定删除该车辆的保险信息吗？', () => {
            AppData.updateVehicle(id, { insurance: null });
            Toast.show('保险信息已删除');
            this.vehicleDetail(id);
        });
    },
    async uploadFile(event, vehicleId, key, origFileNameHint) {
        if (!AdminAuth.requireWrite('上传证件/保单文件')) return;
        let file = event.target.files[0];
        if (!file) return;
        const isPDF = (file.type || '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(file.name || origFileNameHint || '');
        if (!isPDF && !(file.type || '').startsWith('image/')) {
            Toast.show('请上传图片或 PDF 文件', 'error');
            return;
        }
        // 图片自动压缩：> 1.5MB 或 长边 > 2560 就压到 1920px / 0.82 quality（同时清 EXIF 去拍摄位置信息）
        let compressedBytes = null;
        let compressedOK = false;
        if (!isPDF) {
            const oversize = file.size > 1.5 * 1024 * 1024;
            try {
                const resized = await Render._compressImage(file, oversize ? 1920 : 2560, 0.82);
                if (resized && resized.size && resized.size < file.size) {
                    const saved = (1 - (resized.size / file.size)) * 100;
                    if (saved >= 5) {
                        file = resized;
                        compressedBytes = file.size;
                        compressedOK = true;
                    }
                }
            } catch (_) { /* 压缩失败就用原图，不阻塞用户 */ }
        }
        const maxBytes = isPDF ? (15 * 1024 * 1024) : (8 * 1024 * 1024);
        if (file.size > maxBytes) {
            Toast.show(isPDF ? 'PDF 大小不能超过 15MB' : '图片超过 8MB，请换一张更小的或压缩后再传', 'error');
            return;
        }
        const v = AppData.getVehicleById(vehicleId);
        if (!v) return;

        if (CloudSync.online) {
            Toast.show(compressedOK ? `正在上传到云端（已压缩 ${Math.round((1 - (compressedBytes/file.size))*100)}%）...` : '正在上传到云端...', 'info', 1800);
            const store = window.CloudLocalStore || window.CloudStorage;
            const upload = store.uploadDocument ? store.uploadDocument.bind(store) : store.uploadImage.bind(store);
            const res = await upload(vehicleId, key, file, file.name || `${key}.${isPDF ? 'pdf' : 'jpg'}`);
            if (res.ok && res.data && res.data.public_url) {
                const images = { ...(v.images || {}), [key]: res.data.public_url };
                AppData.updateVehicle(vehicleId, { images });
                Toast.show(isPDF ? 'PDF 上传成功（云端）' : (compressedOK ? '图片上传成功（云端，已自动压缩+去隐私）' : '图片上传成功（云端）'));
                this.vehicleDetail(vehicleId);
                return;
            } else {
                Toast.show('云端上传失败：' + (res.error || '未知错误') + '，已改用本地存储', 'warning');
            }
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const v2 = AppData.getVehicleById(vehicleId);
            if (!v2) return;
            const images = { ...(v2.images || {}), [key]: e.target.result };
            AppData.updateVehicle(vehicleId, { images });
            Toast.show(isPDF ? 'PDF 上传成功（本地）' : (compressedOK ? '图片上传成功（本地，已自动压缩+去隐私）' : '图片上传成功（本地）'));
            this.vehicleDetail(vehicleId);
        };
        reader.onerror = () => Toast.show((isPDF ? 'PDF' : '图片') + '读取失败', 'error');
        reader.readAsDataURL(file);
    },
    _compressImage(file, maxLongEdge, quality) {
        return new Promise((resolve, reject) => {
            try {
                const reader = new FileReader();
                reader.onerror = () => reject(new Error('read_fail'));
                reader.onload = (ev) => {
                    const img = new Image();
                    img.onerror = () => reject(new Error('decode_fail'));
                    img.onload = () => {
                        try {
                            const w = img.naturalWidth || img.width;
                            const h = img.naturalHeight || img.height;
                            if (!w || !h) return resolve(null);
                            let tw = w, th = h;
                            if (Math.max(w, h) > maxLongEdge) {
                                if (w > h) { tw = maxLongEdge; th = Math.round(h * (maxLongEdge / w)); }
                                else { th = maxLongEdge; tw = Math.round(w * (maxLongEdge / h)); }
                            }
                            const canvas = document.createElement('canvas');
                            canvas.width = tw; canvas.height = th;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0, tw, th); // canvas.toDataURL 自带清 EXIF，去掉拍摄位置/手机型号
                            canvas.toBlob((blob) => {
                                if (!blob) return resolve(null);
                                const outName = file.name && /\.(png)$/i.test(file.name) ? file.name.replace(/\.(png)$/i, '.jpg') : file.name;
                                const outFile = new File([blob], outName, { type: 'image/jpeg', lastModified: Date.now() });
                                resolve(outFile);
                            }, 'image/jpeg', Math.max(0.55, Math.min(0.95, quality || 0.82)));
                        } catch (e) { reject(e); }
                    };
                    img.src = ev.target.result;
                };
                reader.readAsDataURL(file);
            } catch (e) { reject(e); }
        });
    },
    async uploadImage(event, vehicleId, key) { return this.uploadFile(event, vehicleId, key); },
    openFile(url, label) {
        if (!url) return;
        const safe = String(url);
        if (safe.startsWith('blob:') || safe.startsWith('http:') || safe.startsWith('https:') || safe.startsWith('data:')) {
            try {
                const w = window.open(safe, '_blank', 'noopener,noreferrer');
                if (!w) Toast.show('浏览器拦截了弹窗，请允许弹窗后重试', 'warning');
                return;
            } catch (e) {}
        }
        try {
            const a = document.createElement('a');
            a.href = safe;
            a.rel = 'noopener noreferrer';
            a.download = (label || 'file') + (safe.startsWith('data:application/pdf') ? '.pdf' : safe.toLowerCase().endsWith('.pdf') ? '.pdf' : '');
            document.body.appendChild(a);
            a.click();
            setTimeout(() => a.remove(), 0);
        } catch (e) { Toast.show('打开失败：' + (e.message || String(e)), 'error'); }
    },
    async deleteFile(vehicleId, key) {
        if (!AdminAuth.requireWrite('删除证件/保单文件')) return;
        ConfirmDialog.show('删除文件', '确定删除这个文件吗？', async () => {
            const v = AppData.getVehicleById(vehicleId);
            if (!v) return;
            if (CloudSync.online) {
                const store = window.CloudLocalStore || window.CloudStorage;
                const del = store.deleteDocument ? store.deleteDocument.bind(store) : store.deleteImage.bind(store);
                try { await del(vehicleId, key); } catch (_) {}
            }
            const images = { ...(v.images || {}) };
            delete images[key];
            AppData.updateVehicle(vehicleId, { images });
            Toast.show('文件已删除');
            this.vehicleDetail(vehicleId);
        });
    },
    async deleteImage(vehicleId, key) { return this.deleteFile(vehicleId, key); },

    statistics() {
        const container = document.getElementById('statisticsContent');
        if (!container) return;
        container.innerHTML = '<div class="statistics-grid"></div>';
        const grid = container.querySelector('.statistics-grid');

        const vehicles = AppData.getVehicles();
        const totalVehicles = vehicles.length;

        let rentedVehicles = 0;
        let rentDue = 0;
        let insuranceDue = 0;
        let annualInspectionDue = 0;
        let managementFeeDue = 0;
        const carModelCounts = {};
        let driverDepositTotal = 0;

        vehicles.forEach(v => {
            if (v.rental) {
                rentedVehicles++;
                const s = DateUtils.getStatus(v.rental.nextPayDate);
                if (s.level !== 'normal') rentDue++;
            }
            if (v.insurance) {
                const s = DateUtils.getStatus(v.insurance.endDate);
                if (s.level !== 'normal') insuranceDue++;
            }
            if (v.annualInspectionDate) {
                const s = DateUtils.getStatus(v.annualInspectionDate);
                if (s.level !== 'normal') annualInspectionDue++;
            }
            if (v.managementFeeDate) {
                const s = DateUtils.getStatus(v.managementFeeDate);
                if (s.level !== 'normal') managementFeeDue++;
            }
            if (v.carModel) {
                const model = v.carModel.trim();
                carModelCounts[model] = (carModelCounts[model] || 0) + 1;
            }
            driverDepositTotal += (parseFloat(v.rental?.driverDeposit ?? v.driverDeposit) || 0);
        });

        // Overview Cards
        grid.innerHTML += `
            <div class="stat-card">
                <div class="stat-card-title">车辆总数</div>
                <div class="stat-card-value">${totalVehicles}</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-title">在租车辆</div>
                <div class="stat-card-value">${rentedVehicles}</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-title">空闲车辆</div>
                <div class="stat-card-value">${totalVehicles - rentedVehicles}</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-title">待收租金提醒</div>
                <div class="stat-card-value">${rentDue}</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-title">待续保提醒</div>
                <div class="stat-card-value">${insuranceDue}</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-title">待年检提醒</div>
                <div class="stat-card-value">${annualInspectionDue}</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-title">待管理费提醒</div>
                <div class="stat-card-value">${managementFeeDue}</div>
            </div>
            <div class="stat-card">
                <div class="stat-card-title">司机押金总额</div>
                <div class="stat-card-value">¥${driverDepositTotal.toLocaleString()}</div>
            </div>
        `;

        // Charts
        grid.innerHTML += `
            <div class="chart-card">
                <div class="chart-card-title">车辆类型分布</div>
                <canvas id="carModelChart"></canvas>
            </div>
            <div class="chart-card">
                <div class="chart-card-title">车辆状态概览</div>
                <canvas id="vehicleStatusChart"></canvas>
            </div>
        `;

        // Render Car Model Chart
        const carModelCtx = document.getElementById('carModelChart').getContext('2d');
        new Chart(carModelCtx, {
            type: 'pie',
            data: {
                labels: Object.keys(carModelCounts),
                datasets: [{
                    data: Object.values(carModelCounts),
                    backgroundColor: [
                        '#4f8cff', '#2ed573', '#ffc400', '#ff4757', '#6a7bff', '#1abc9c', '#f1c40f', '#e67e22', '#e74c3c',
                        '#3498db', '#9b59b6', '#34495e', '#95a5a6', '#d35400', '#c0392b', '#7f8c8d'
                    ],
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: 'var(--text-primary)'
                        }
                    },
                    title: {
                        display: false,
                    }
                }
            },
        });

        // Render Vehicle Status Chart
        const vehicleStatusCtx = document.getElementById('vehicleStatusChart').getContext('2d');
        new Chart(vehicleStatusCtx, {
            type: 'doughnut',
            data: {
                labels: ['在租', '空闲'],
                datasets: [{
                    data: [rentedVehicles, totalVehicles - rentedVehicles],
                    backgroundColor: ['#4f8cff', '#6c7a96'],
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: {
                            color: 'var(--text-primary)'
                        }
                    },
                    title: {
                        display: false,
                    }
                }
            },
        });
    }
};

(function initApp() {
    document.addEventListener('DOMContentLoaded', async () => {
        AdminUI.init();
        Toast.init();
        ConfirmDialog.init();
        ImageViewer.init();
        Navigation.init();
        Forms.init();
        CloudUI.init();
        Navigation.switchView('dashboard');
        const boot = await CloudSync.bootstrap();
        if (boot.ok) {
            await CloudSync.loadCloudAndReplaceLocal(false);
        } else if (boot.reason !== 'no-key' && boot.reason !== 'no-sdk') {
            const msg = '云端连接失败：' + (boot.reason || '检查网络或 anon key。可点右上角 ☁️ 按钮重试');
            setTimeout(() => Toast.show(msg, 'warning', 4000), 600);
        }
    });
})();
