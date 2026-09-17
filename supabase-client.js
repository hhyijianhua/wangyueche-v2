// ==============================================================
// 信途网约车租赁管理系统 - Supabase 云端存储客户端
// 依赖：config.js（必须先加载）+ Supabase JS SDK（CDN）
// 对外暴露：window.CloudStorage
// ==============================================================

(function () {
    'use strict';

    const BUCKET_NAME = 'wyc-documents';

    let _client = null;
    let _ready = false;
    let _error = null;
    let _listeners = [];

    const CloudStorage = {
        // ---------- 初始化 ----------
        init() {
            try {
                if (!window.supabase || !window.supabase.createClient) {
                    throw new Error('Supabase SDK 未加载，请检查 index.html 是否引入了 CDN script');
                }
                const cfg = window.SUPABASE_CONFIG;
                if (!cfg || !cfg.URL || !cfg.ANON_KEY) {
                    throw new Error('Supabase 配置缺失，请检查 config.js 是否填了 URL 和 ANON_KEY');
                }
                if (cfg.ANON_KEY === 'YOUR_ANON_KEY_HERE') {
                    throw new Error('还没填 anon key！打开 config.js 把 YOUR_ANON_KEY_HERE 替换成真实的 anon public key');
                }
                _client = window.supabase.createClient(cfg.URL, cfg.ANON_KEY, {
                    realtime: { params: { eventsPerSecond: 10 } },
                    auth: { persistSession: false, autoRefreshToken: false }
                });
                _ready = true;
                _error = null;
                return { ok: true };
            } catch (e) {
                _ready = false;
                _error = e.message;
                console.error('[CloudStorage] 初始化失败:', e);
                return { ok: false, error: e.message };
            }
        },

        isReady() { return _ready; },
        getLastError() { return _error; },
        getClient() { return _client; },

        // ---------- 健康检查（测能不能连上）----------
        async ping() {
            if (!_ready) return { ok: false, error: _error || '未初始化' };
            try {
                const { data, error } = await _client.from('vehicles').select('count', { count: 'exact', head: true });
                if (error) throw error;
                return { ok: true };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        },

        // ---------- 车辆 CRUD（聚合查询，一次返回车辆+租赁+保险+证件）----------
        async listAllVehicles() {
            if (!_ready) return { ok: false, error: _error };
            try {
                const { data: vehicles, error: ve } = await _client.from('vehicles').select('*').order('created_at', { ascending: false });
                if (ve) throw ve;
                const { data: rentals, error: re } = await _client.from('rentals').select('*');
                if (re) throw re;
                const { data: insurances, error: ie } = await _client.from('insurance').select('*');
                if (ie) throw ie;
                const { data: docs, error: de } = await _client.from('documents').select('*');
                if (de) throw de;

                const rentalMap = Object.fromEntries((rentals || []).map(r => [r.vehicle_id, r]));
                const insMap = Object.fromEntries((insurances || []).map(i => [i.vehicle_id, i]));
                const docsByVehicle = {};
                (docs || []).forEach(d => {
                    if (!docsByVehicle[d.vehicle_id]) docsByVehicle[d.vehicle_id] = {};
                    docsByVehicle[d.vehicle_id][d.slot] = d;
                });

                const merged = (vehicles || []).map(v => ({
                    id: v.id,
                    plateNumber: v.plate_no,
                    carModel: v.model || '',
                    color: v.color || '',
                    vin: v.vin || '',
                    ownerName: v.owner_name || '',
                    ownerPhone: v.owner_phone || '',
                    ownerIdCard: v.owner_id_card || '',
                    rental: rentalMap[v.id] ? {
                        driverName: rentalMap[v.id].driver_name || '',
                        driverPhone: rentalMap[v.id].driver_phone || '',
                        driverIdCard: rentalMap[v.id].driver_id_card || '',
                        startDate: rentalMap[v.id].start_date || '',
                        monthlyRent: rentalMap[v.id].monthly_rent || 0,
                        deposit: rentalMap[v.id].deposit || 0,
                        nextPayDate: rentalMap[v.id].next_pay_date || '',
                        contractNo: rentalMap[v.id].contract_no || '',
                        remark: rentalMap[v.id].remark || ''
                    } : null,
                    insurance: insMap[v.id] ? {
                        company: insMap[v.id].company || '',
                        policyNo: insMap[v.id].policy_no || '',
                        startDate: insMap[v.id].start_date || '',
                        endDate: insMap[v.id].end_date || '',
                        amount: insMap[v.id].amount || 0,
                        remark: insMap[v.id].remark || ''
                    } : null,
                    images: (() => {
                        const out = {};
                        Object.keys(docsByVehicle[v.id] || {}).forEach(slot => {
                            const d = docsByVehicle[v.id][slot];
                            if (d && d.public_url) out[slot] = d.public_url;
                        });
                        return out;
                    })(),
                    remark: v.remark || '',
                    createdAt: v.created_at,
                    updatedAt: v.updated_at
                }));
                return { ok: true, data: merged };
            } catch (e) {
                console.error('[CloudStorage] listAllVehicles 失败:', e);
                return { ok: false, error: e.message };
            }
        },

        // 按车牌 upsert（迁移用：有就更新，没有就插）
        async upsertVehicleByPlate(merged) {
            if (!_ready) return { ok: false, error: _error };
            try {
                if (!merged.plateNumber) throw new Error('缺少车牌号 plateNumber');
                const vehicleRow = {
                    plate_no: merged.plateNumber,
                    model: merged.carModel || null,
                    color: merged.color || null,
                    vin: merged.vin || null,
                    owner_name: merged.ownerName || null,
                    owner_phone: merged.ownerPhone || null,
                    owner_id_card: merged.ownerIdCard || null,
                    remark: merged.remark || null,
                    // 如果是更新操作，需要包含 id，否则 Supabase 会创建一个新 ID
                    ...(merged.id && !merged.id.startsWith('v_') ? { id: merged.id } : {})
                };

                // 使用 upsert 确保如果 plate_no 存在则更新，否则插入
                const { data: upsertedVehicles, error: upsertError } = await _client.from('vehicles')
                    .upsert(vehicleRow, { onConflict: 'plate_no' })
                    .select('id')
                    .single();

                if (upsertError) throw upsertError;
                const finalVid = upsertedVehicles.id;

                if (merged.rental && (merged.rental.driverName || merged.rental.nextPayDate || merged.rental.driverPhone)) {
                    const r = merged.rental;
                    const rentalRow = {
                        vehicle_id: finalVid,
                        driver_name: r.driverName || null,
                        driver_phone: r.driverPhone || null,
                        driver_id_card: r.driverIdCard || null,
                        start_date: r.startDate || null,
                        monthly_rent: r.monthlyRent || 0,
                        deposit: r.deposit || 0,
                        next_pay_date: r.nextPayDate || null,
                        contract_no: r.contractNo || null,
                        remark: r.remark || null
                    };
                    const { error: rconflict } = await _client.from('rentals').delete().eq('vehicle_id', finalVid);
                    if (rconflict) throw rconflict;
                    const { error: rins } = await _client.from('rentals').insert(rentalRow);
                    if (rins) throw rins;
                } else {
                    const { error: rdel } = await _client.from('rentals').delete().eq('vehicle_id', finalVid);
                    if (rdel) throw rdel;
                }

                if (merged.insurance && (merged.insurance.company || merged.insurance.endDate)) {
                    const ins = merged.insurance;
                    const insRow = {
                        vehicle_id: finalVid,
                        company: ins.company || null,
                        policy_no: ins.policyNo || null,
                        start_date: ins.startDate || null,
                        end_date: ins.endDate || null,
                        amount: ins.amount || 0,
                        remark: ins.remark || null
                    };
                    const { error: iconflict } = await _client.from('insurance').delete().eq('vehicle_id', finalVid);
                    if (iconflict) throw iconflict;
                    const { error: iins } = await _client.from('insurance').insert(insRow);
                    if (iins) throw iins;
                } else {
                    const { error: idel } = await _client.from('insurance').delete().eq('vehicle_id', finalVid);
                    if (idel) throw idel;
                }

                return { ok: true, vehicle_id: finalVid };
            } catch (e) {
                console.error('[CloudStorage] upsertVehicleByPlate 失败:', e);
                return { ok: false, error: e.message };
            }
        },

        async deleteVehicle(id) {
            if (!_ready) return { ok: false, error: _error };
            try {
                // 先删证件文件
                const { data: docs, error: de } = await _client.from('documents').select('storage_path').eq('vehicle_id', id);
                if (!de && docs && docs.length) {
                    const paths = docs.map(d => d.storage_path).filter(Boolean);
                    if (paths.length) {
                        try { await _client.storage.from(BUCKET_NAME).remove(paths); } catch (_) {}
                    }
                }
                const { error: ve } = await _client.from('vehicles').delete().eq('id', id);
                if (ve) throw ve;
                return { ok: true };
            } catch (e) {
                console.error('[CloudStorage] deleteVehicle 失败:', e);
                return { ok: false, error: e.message };
            }
        },

        // ---------- 证件图片上传/删除 ----------
        async uploadDocument(vehicleId, slot, file /* File 对象 */, fileName) {
            if (!_ready) return { ok: false, error: _error };
            try {
                const ext = (fileName || file.name || '.jpg').split('.').pop() || 'jpg';
                const path = `${vehicleId}/${slot}_${Date.now()}.${ext}`;
                const { error: ue } = await _client.storage.from(BUCKET_NAME).upload(path, file, {
                    cacheControl: '3600', upsert: true, contentType: file.type || 'image/jpeg'
                });
                if (ue) throw ue;

                // 先删旧的同槽位记录+文件
                const { data: old, error: olde } = await _client.from('documents').select('storage_path').eq('vehicle_id', vehicleId).eq('slot', slot).maybeSingle();
                if (!olde && old && old.storage_path && old.storage_path !== path) {
                    try { await _client.storage.from(BUCKET_NAME).remove([old.storage_path]); } catch (_) {}
                }
                const { error: dele } = await _client.from('documents').delete().eq('vehicle_id', vehicleId).eq('slot', slot);
                if (dele) throw dele;

                const { data: urlData } = _client.storage.from(BUCKET_NAME).getPublicUrl(path);
                const publicUrl = urlData && urlData.publicUrl ? urlData.publicUrl : `storage://${BUCKET_NAME}/${path}`;
                // 兼容：无论桶是否私有，documents 表里同时存 storage_path 和 public_url（老代码读 public_url 不会炸）
                // 前端渲染时优先调用 getSignedUrl(path) 生成 60 秒短链接，避免 URL 永久泄露
                const { data: newDoc, error: inse } = await _client.from('documents').insert({
                    vehicle_id: vehicleId,
                    slot: slot,
                    storage_path: path,
                    public_url: publicUrl,
                    file_name: fileName || file.name || slot,
                    file_size: file.size || 0,
                    mime_type: file.type || (ext === 'pdf' ? 'application/pdf' : 'image/jpeg')
                }).select('*').single();
                if (inse) throw inse;
                return { ok: true, data: newDoc };
            } catch (e) {
                console.error('[CloudStorage] uploadDocument 失败:', e);
                return { ok: false, error: e.message };
            }
        },

        // 生成 60 秒短签名链接（私桶也能访问，复制出去的 URL 1 分钟后自动失效）
        async getSignedUrl(pathOrUrl, expiresInSeconds = 60) {
            if (!_ready || !pathOrUrl) return null;
            try {
                let path = pathOrUrl;
                const storagePrefix = `storage://${BUCKET_NAME}/`;
                if (String(pathOrUrl).startsWith(storagePrefix)) {
                    path = String(pathOrUrl).slice(storagePrefix.length);
                } else if (String(pathOrUrl).startsWith('http')) {
                    const idx = String(pathOrUrl).indexOf(`/${BUCKET_NAME}/`);
                    if (idx > -1) path = String(pathOrUrl).slice(idx + BUCKET_NAME.length + 2).split('?')[0];
                }
                if (!path || path.startsWith('data:')) return null;
                const { data, error } = await _client.storage.from(BUCKET_NAME).createSignedUrl(path, expiresInSeconds || 60, { transform: {} });
                if (error || !data || !data.signedUrl) return null;
                return data.signedUrl;
            } catch (e) { return null; }
        },

        async removeDocument(vehicleId, slot) {
            if (!_ready) return { ok: false, error: _error };
            try {
                const { data: doc, error: fe } = await _client.from('documents').select('*').eq('vehicle_id', vehicleId).eq('slot', slot).maybeSingle();
                if (fe) throw fe;
                if (doc) {
                    if (doc.storage_path) {
                        try { await _client.storage.from(BUCKET_NAME).remove([doc.storage_path]); } catch (_) {}
                    }
                    const { error: de } = await _client.from('documents').delete().eq('id', doc.id);
                    if (de) throw de;
                }
                return { ok: true };
            } catch (e) {
                console.error('[CloudStorage] removeDocument 失败:', e);
                return { ok: false, error: e.message };
            }
        },

        // ---------- 实时订阅 ----------
        subscribeAll(onChange) {
            if (!_ready || !_client) return () => {};
            try {
                const tables = ['vehicles', 'rentals', 'insurance', 'documents'];
                const channels = tables.map(t => {
                    const ch = _client.channel(`tbl_${t}_${Date.now()}`)
                        .on('postgres_changes', { event: '*', schema: 'public', table: t }, payload => {
                            if (typeof onChange === 'function') onChange({ table: t, payload });
                        })
                        .subscribe();
                    return ch;
                });
                return () => { try { channels.forEach(ch => _client.removeChannel(ch)); } catch (_) {} };
            } catch (e) {
                console.error('[CloudStorage] subscribeAll 失败:', e);
                return () => {};
            }
        }
    };

    window.CloudStorage = CloudStorage;
    // 同时挂个 CloudLocalStore 别名，和 app.js 里 CloudSync 的命名保持一致，
    // 避免 CloudSync 里写的 window.CloudLocalStore.init() 找不到报错
    window.CloudLocalStore = CloudStorage;
})();
